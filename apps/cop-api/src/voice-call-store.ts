import { type Pool as PgPool, type PoolConfig, type QueryResultRow, type PoolClient } from "pg";
import { createCopPgPool } from "./cop-pg-pool.js";
import { randomUUID } from "node:crypto";
import { assertRuntimeOwnerAllowed, fenceRuntimeOwner, MemoryRuntimeOwnerFences, requireRuntimeOwner,
  runtimeAssessment, runtimeOwnerFenceTableSql, runtimeOwnerHash, runtimeOwnerTransaction, lockRuntimeSubjects, runtimeSubjectHash,
  type RuntimeOwner, type RuntimeOwnerAssessment } from "./runtime-owner-erasure.js";

export type VoiceCallKind = "direct";
export type VoiceCallPhase =
  | "created"
  | "ringing"
  | "accepted"
  | "connecting_media"
  | "connected"
  | "declined"
  | "missed"
  | "cancelled"
  | "failed"
  | "ended";
export type VoiceCallTerminalPhase = Extract<VoiceCallPhase, "declined" | "missed" | "cancelled" | "failed" | "ended">;

export interface VoiceCallRecord {
  /** Verified realm for the canonical conversation subjects, supplied by the server. */
  ownerIssuer?: string;
  acceptedByEndpointId?: string;
  acceptedBySubjectId?: string;
  callId: string;
  connectedAt?: string;
  createdAt: string;
  endedAt?: string;
  endReason?: string;
  expiresAt: string;
  initiatorSubjectId: string;
  kind: VoiceCallKind;
  participantSubjectIds: string[];
  phase: VoiceCallPhase;
  revision: number;
  roomId: string;
  title: string;
  updatedAt: string;
}

export interface VoiceCallCreateInput {
  ownerIssuer?: string;
  expiresAt: string;
  initiatorSubjectId: string;
  kind: VoiceCallKind;
  now: string;
  participantSubjectIds: string[];
  roomId: string;
  title: string;
}

export type VoiceCallAction =
  "accept" | "cancel" | "decline" | "end" | "heartbeat" | "media_connected" | "media_failed";

export interface VoiceCallTransitionInput {
  action: VoiceCallAction;
  actorSubjectId: string;
  endpointId?: string;
  expectedRevision?: number;
  now: string;
  reason?: string;
}

export interface VoiceCallTransitionResult {
  changed: boolean;
  conflict?: "claimed" | "revision" | "terminal" | "transition";
  record: VoiceCallRecord;
}

export interface VoiceCallStore {
  readonly name: string;
  erasureReady?(): Promise<boolean>;
  assertSubjectAllowed?(subjectId: string): Promise<void>;
  preflightActorErasure?(owner: RuntimeOwner): Promise<RuntimeOwnerAssessment>;
  recordMediaGrant?(owner: RuntimeOwner, callId: string, expiresAt: string, now: string): Promise<void>;
  fenceActor?(owner: RuntimeOwner, operationId: string, requestedAt: string): Promise<{ calls: VoiceCallRecord[]; notBefore: string }>;
  purgeActor?(owner: RuntimeOwner, operationId: string, requestedAt: string): Promise<{ complete: boolean }>;
  close(): Promise<void>;
  create(input: VoiceCallCreateInput): Promise<VoiceCallRecord>;
  expireDue(now: string): Promise<VoiceCallRecord[]>;
  get(callId: string): Promise<VoiceCallRecord | null>;
  init(): Promise<void>;
  listForSubject(
    subjectId: string,
    options?: { activeOnly?: boolean; limit?: number; roomId?: string }
  ): Promise<VoiceCallRecord[]>;
  transition(callId: string, input: VoiceCallTransitionInput): Promise<VoiceCallTransitionResult | null>;
}

export function createVoiceCallStoreFromEnv(env: Record<string, string | undefined> = process.env): VoiceCallStore {
  const mode = (env.COP_VOICE_CALL_STORE ?? "auto").trim().toLowerCase();
  const connectionString = env.COP_DATABASE_URL?.trim();

  if (mode === "memory" || mode === "disabled") {
    return new InMemoryVoiceCallStore(mode === "disabled" ? "memory-disabled" : "memory");
  }
  if (mode === "auto" && !connectionString) {
    return new InMemoryVoiceCallStore("memory");
  }
  if ((mode === "auto" || mode === "postgres" || mode === "postgresql") && connectionString) {
    return new PostgresVoiceCallStore({
      connectionString,
      connectionTimeoutMillis: readPositiveInteger(env.COP_DATABASE_CONNECT_TIMEOUT_MS, 5_000),
      idleTimeoutMillis: readPositiveInteger(env.COP_DATABASE_IDLE_TIMEOUT_MS, 30_000),
      max: readPositiveInteger(env.COP_DATABASE_POOL_MAX, 5),
      ssl: readSslConfig(env)
    });
  }

  throw new Error(`Unsupported COP_VOICE_CALL_STORE value: ${mode}`);
}

export class InMemoryVoiceCallStore implements VoiceCallStore {
  readonly name: string;
  private readonly calls = new Map<string, VoiceCallRecord>();
  private readonly ownerFences = new MemoryRuntimeOwnerFences();
  private readonly mediaGrants = new Map<string, { ownerHash: string; subjectId: string; callId: string; expiresAt: string }>();

  constructor(name = "memory") {
    this.name = name;
  }

  async init(): Promise<void> {}

  async close(): Promise<void> {}
  async erasureReady(): Promise<boolean> { return true; }
  async assertSubjectAllowed(subjectId: string): Promise<void> { this.ownerFences.assertAllowed(subjectId); }
  async preflightActorErasure(owner: RuntimeOwner): Promise<RuntimeOwnerAssessment> {
    requireRuntimeOwner(owner);
    return this.ownerFences.transact([], () => {
      const calls = [...this.calls.values()].filter(record => voiceCallReferencesSubject(record, owner.subjectId));
      const grants = [...this.mediaGrants.values()].filter(record => record.subjectId === owner.subjectId);
      return { ...runtimeAssessment([calls, grants]), ready: calls.every(record => record.ownerIssuer === owner.issuer) && grants.every(record => record.ownerHash === runtimeOwnerHash(owner)) };
    }, true);
  }
  async recordMediaGrant(owner: RuntimeOwner, callId: string, expiresAt: string, now: string): Promise<void> {
    requireRuntimeOwner(owner); validateMediaGrantExpiry(expiresAt, now);
    return this.ownerFences.transact([owner.subjectId], () => {
      const call = this.calls.get(callId);
      if (!call || (call.ownerIssuer && call.ownerIssuer !== owner.issuer) || !voiceCallIncludesSubject(call, owner.subjectId)) throw new Error("Unproven media grant owner");
      if (!canRecordMediaGrant(call, owner.subjectId)) throw new Error("Media call inactive or not accepted");
      for (const subject of [call.initiatorSubjectId, ...call.participantSubjectIds]) this.ownerFences.assertAllowed(subject);
      const key = JSON.stringify([runtimeOwnerHash(owner), callId]);
      const current = this.mediaGrants.get(key);
      this.mediaGrants.set(key, { ownerHash: runtimeOwnerHash(owner), subjectId: owner.subjectId, callId, expiresAt: current && current.expiresAt > expiresAt ? current.expiresAt : expiresAt });
    });
  }
  async fenceActor(owner: RuntimeOwner, _operationId: string, requestedAt: string): Promise<{ calls: VoiceCallRecord[]; notBefore: string }> {
    requireRuntimeOwner(owner);
    return this.ownerFences.transact([owner.subjectId], () => {
      this.ownerFences.fence(owner);
      const calls = [...this.calls.values()].filter(record => voiceCallReferencesSubject(record, owner.subjectId) && record.ownerIssuer === owner.issuer).map(cloneRecord);
      const grants = [...this.mediaGrants.values()].filter(record => record.ownerHash === runtimeOwnerHash(owner));
      return { calls, notBefore: tokenNotBefore(requestedAt, grants.map(record => record.expiresAt)) };
    }, true);
  }
  async purgeActor(owner: RuntimeOwner, _operationId: string, requestedAt: string): Promise<{ complete: boolean }> {
    requireRuntimeOwner(owner);
    return this.ownerFences.transact([owner.subjectId], () => {
      this.ownerFences.fence(owner);
      if ([...this.calls.values()].some(record => voiceCallReferencesSubject(record, owner.subjectId) && record.ownerIssuer !== owner.issuer) ||
          [...this.mediaGrants.values()].some(record => record.subjectId === owner.subjectId && record.ownerHash !== runtimeOwnerHash(owner))) return { complete: false };
      for (const [callId, record] of this.calls) if (voiceCallReferencesSubject(record, owner.subjectId) && record.ownerIssuer === owner.issuer) {
        const scrubbed = removeVoiceActor(record, owner.subjectId, requestedAt);
        if (scrubbed) this.calls.set(callId, scrubbed); else this.calls.delete(callId);
      }
      for (const [key, record] of this.mediaGrants) if (record.ownerHash === runtimeOwnerHash(owner)) this.mediaGrants.delete(key);
      return { complete: ![...this.calls.values()].some(record => voiceCallReferencesSubject(record, owner.subjectId)) && ![...this.mediaGrants.values()].some(record => record.subjectId === owner.subjectId) };
    }, true);
  }

  async create(input: VoiceCallCreateInput): Promise<VoiceCallRecord> {
    return this.ownerFences.transact([input.initiatorSubjectId, ...input.participantSubjectIds], async () => {
      const participantSubjectIds = normalizeParticipants(input.participantSubjectIds, input.initiatorSubjectId);
      if (participantSubjectIds.length === 0) {
        throw new Error("Voice call requires at least one recipient.");
      }
      const callId = randomUUID().toLowerCase();
      const record: VoiceCallRecord = {
        ...(input.ownerIssuer ? { ownerIssuer: input.ownerIssuer } : {}),
        callId,
        createdAt: input.now,
        expiresAt: input.expiresAt,
        initiatorSubjectId: input.initiatorSubjectId,
        kind: input.kind,
        participantSubjectIds,
        phase: "ringing",
        revision: 1,
        roomId: input.roomId,
        title: input.title,
        updatedAt: input.now
      };
      this.calls.set(callId, record);
      return cloneRecord(record);
    });
  }

  async get(callId: string): Promise<VoiceCallRecord | null> {
    const record = this.calls.get(callId);
    return record ? cloneRecord(record) : null;
  }

  async listForSubject(
    subjectId: string,
    options: { activeOnly?: boolean; limit?: number; roomId?: string } = {}
  ): Promise<VoiceCallRecord[]> {
    return [...this.calls.values()]
      .filter(
        (record) =>
          voiceCallIncludesSubject(record, subjectId) &&
          (!options.roomId || record.roomId === options.roomId) &&
          (!options.activeOnly || !isTerminalPhase(record.phase))
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, normalizeListLimit(options.limit))
      .map(cloneRecord);
  }

  async transition(callId: string, input: VoiceCallTransitionInput): Promise<VoiceCallTransitionResult | null> {
    return this.ownerFences.transact([input.actorSubjectId], async () => {
      const current = this.calls.get(callId);
      if (!current) {
        return null;
      }
      for (const subject of [current.initiatorSubjectId, ...current.participantSubjectIds]) this.ownerFences.assertAllowed(subject);
      const result = applyTransition(current, input);
      if (result.changed) {
        this.calls.set(callId, result.record);
      }
      return { ...result, record: cloneRecord(result.record) };
    });
  }

  async expireDue(now: string): Promise<VoiceCallRecord[]> {
    const expired: VoiceCallRecord[] = [];
    for (const [callId, current] of this.calls) {
      if (
        (current.phase === "created" ||
          current.phase === "ringing" ||
          current.phase === "accepted" ||
          current.phase === "connecting_media") &&
        current.expiresAt <= now
      ) {
        const waitingForAnswer = current.phase === "created" || current.phase === "ringing";
        const next = terminalRecord(
          current,
          waitingForAnswer ? "missed" : "failed",
          now,
          waitingForAnswer ? "ring_timeout" : "media_timeout"
        );
        this.calls.set(callId, next);
        expired.push(cloneRecord(next));
      }
    }
    return expired;
  }
}

export class PostgresVoiceCallStore implements VoiceCallStore {
  readonly name = "postgres";
  private readonly pool: PgPool;

  constructor(config: PoolConfig) {
    this.pool = createCopPgPool("voice-call", config);
  }

  async init(): Promise<void> {
    await this.pool.query(runtimeOwnerFenceTableSql + createVoiceCallTableSql);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async create(input: VoiceCallCreateInput): Promise<VoiceCallRecord> {
    return runtimeOwnerTransaction(this.pool, "voice_livekit", [input.initiatorSubjectId, ...input.participantSubjectIds], async client => {
      const participantSubjectIds = normalizeParticipants(input.participantSubjectIds, input.initiatorSubjectId);
      if (participantSubjectIds.length === 0) {
        throw new Error("Voice call requires at least one recipient.");
      }
      const callId = randomUUID().toLowerCase();
      const result = await client.query<VoiceCallRow>(
        `INSERT INTO cop_voice_calls (
          call_id, room_id, title, kind, initiator_subject_id, participant_subject_ids, owner_issuer,
          phase, revision, expires_at, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $9, 'ringing', 1, $7::timestamptz, $8::timestamptz, $8::timestamptz)
        RETURNING *`,
        [
          callId,
          input.roomId,
          input.title,
          input.kind,
          input.initiatorSubjectId,
          JSON.stringify(participantSubjectIds),
          input.expiresAt,
          input.now,
          input.ownerIssuer ?? null
        ]
      );
      return recordFromRow(requireRow(result.rows[0]));
    });
  }

  async erasureReady(): Promise<boolean> {
    await this.pool.query("SELECT 1 FROM cop_runtime_owner_fences LIMIT 0");
    await this.pool.query("SELECT 1 FROM cop_voice_media_grants LIMIT 0");
    return true;
  }
  async assertSubjectAllowed(subjectId: string): Promise<void> { await assertRuntimeOwnerAllowed(this.pool, "voice_livekit", subjectId); }
  async preflightActorErasure(owner: RuntimeOwner): Promise<RuntimeOwnerAssessment> {
    requireRuntimeOwner(owner);
    return runtimeOwnerTransaction(this.pool, "voice_livekit", [owner.subjectId], async client => {
      const rows = await voiceOwnerRows(client, owner.subjectId);
      return { ...runtimeAssessment([rows.calls, rows.grants]), ready: rows.calls.every(record => record.owner_issuer === owner.issuer) && rows.grants.every(record => record.owner_hash === runtimeOwnerHash(owner)) };
    }, true);
  }
  async recordMediaGrant(owner: RuntimeOwner, callId: string, expiresAt: string, now: string): Promise<void> {
    requireRuntimeOwner(owner); validateMediaGrantExpiry(expiresAt, now);
    return runtimeOwnerTransaction(this.pool, "voice_livekit", [], async client => {
      const discovered = await client.query<VoiceCallRow>("SELECT * FROM cop_voice_calls WHERE call_id=$1", [callId]);
      if (!discovered.rows[0]) throw new Error("Unproven media grant owner");
      const known = recordFromRow(discovered.rows[0]);
      await lockRuntimeSubjects(client, "voice_livekit", [owner.subjectId, known.initiatorSubjectId, ...known.participantSubjectIds]);
      const selected = await client.query<VoiceCallRow>("SELECT * FROM cop_voice_calls WHERE call_id=$1", [callId]);
      const call = selected.rows[0] ? recordFromRow(selected.rows[0]) : null;
      if (!call || (call.ownerIssuer && call.ownerIssuer !== owner.issuer) || !voiceCallIncludesSubject(call, owner.subjectId)) throw new Error("Unproven media grant owner");
      if (!canRecordMediaGrant(call, owner.subjectId)) throw new Error("Media call inactive or not accepted");
      await client.query(`INSERT INTO cop_voice_media_grants (owner_hash, subject_hash, call_id, expires_at) VALUES ($1,$2,$3,$4)
        ON CONFLICT (owner_hash, call_id) DO UPDATE SET expires_at = GREATEST(cop_voice_media_grants.expires_at, EXCLUDED.expires_at)`,
        [runtimeOwnerHash(owner), runtimeSubjectHash(owner.subjectId), callId, expiresAt]);
    });
  }
  async fenceActor(owner: RuntimeOwner, operationId: string, requestedAt: string): Promise<{ calls: VoiceCallRecord[]; notBefore: string }> {
    requireRuntimeOwner(owner);
    return runtimeOwnerTransaction(this.pool, "voice_livekit", [owner.subjectId], async client => {
      await fenceRuntimeOwner(client, "voice_livekit", owner, operationId, requestedAt);
      const rows = await voiceOwnerRows(client, owner.subjectId);
      return { calls: rows.calls.filter(record => record.owner_issuer === owner.issuer).map(recordFromRow), notBefore: tokenNotBefore(requestedAt, rows.grants.filter(record => record.owner_hash === runtimeOwnerHash(owner)).map(record => isoTimestamp(record.expires_at))) };
    }, true);
  }
  async purgeActor(owner: RuntimeOwner, operationId: string, requestedAt: string): Promise<{ complete: boolean }> {
    requireRuntimeOwner(owner);
    return runtimeOwnerTransaction(this.pool, "voice_livekit", [owner.subjectId], async client => {
      await fenceRuntimeOwner(client, "voice_livekit", owner, operationId, requestedAt);
      const rows = await voiceOwnerRows(client, owner.subjectId, true);
      if (rows.calls.some(row => row.owner_issuer !== owner.issuer) || rows.grants.some(row => row.owner_hash !== runtimeOwnerHash(owner))) return { complete: false };
      for (const row of rows.calls) if (row.owner_issuer === owner.issuer) {
        const record = removeVoiceActor(recordFromRow(row), owner.subjectId, requestedAt);
        if (!record) { await client.query("DELETE FROM cop_voice_calls WHERE call_id=$1", [row.call_id]); continue; }
        await client.query(`UPDATE cop_voice_calls SET initiator_subject_id=$2, participant_subject_ids=$3::jsonb,
          accepted_by_subject_id=$4, accepted_by_endpoint_id=$5, title=$6, phase=$7, revision=$8,
          ended_at=$9, end_reason=$10, updated_at=$11 WHERE call_id=$1`,
          [record.callId, record.initiatorSubjectId, JSON.stringify(record.participantSubjectIds), record.acceptedBySubjectId ?? null, record.acceptedByEndpointId ?? null,
           record.title, record.phase, record.revision, record.endedAt ?? null, record.endReason ?? null, record.updatedAt]);
      }
      await client.query("DELETE FROM cop_voice_media_grants WHERE owner_hash=$1", [runtimeOwnerHash(owner)]);
      const remaining = await voiceOwnerRows(client, owner.subjectId);
      return { complete: remaining.calls.length === 0 && remaining.grants.length === 0 };
    }, true);
  }

  async get(callId: string): Promise<VoiceCallRecord | null> {
    const result = await this.pool.query<VoiceCallRow>("SELECT * FROM cop_voice_calls WHERE call_id = $1", [callId]);
    return result.rows[0] ? recordFromRow(result.rows[0]) : null;
  }

  async listForSubject(
    subjectId: string,
    options: { activeOnly?: boolean; limit?: number; roomId?: string } = {}
  ): Promise<VoiceCallRecord[]> {
    const clauses = ["(initiator_subject_id = $1 OR participant_subject_ids ? $1)"];
    const values: unknown[] = [subjectId];
    if (options.roomId) {
      values.push(options.roomId);
      clauses.push(`room_id = $${values.length}`);
    }
    if (options.activeOnly) {
      clauses.push("phase NOT IN ('declined', 'missed', 'cancelled', 'failed', 'ended')");
    }
    values.push(normalizeListLimit(options.limit));
    const result = await this.pool.query<VoiceCallRow>(
      `SELECT * FROM cop_voice_calls
       WHERE ${clauses.join(" AND ")}
       ORDER BY updated_at DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows.map(recordFromRow);
  }

  async transition(callId: string, input: VoiceCallTransitionInput): Promise<VoiceCallTransitionResult | null> {
    return runtimeOwnerTransaction(this.pool, "voice_livekit", [], async client => {
      const discovered = await client.query<VoiceCallRow>("SELECT * FROM cop_voice_calls WHERE call_id=$1", [callId]);
      if (!discovered.rows[0]) return null;
      const known = recordFromRow(discovered.rows[0]);
      await lockRuntimeSubjects(client, "voice_livekit", [input.actorSubjectId, known.initiatorSubjectId, ...known.participantSubjectIds]);
      const selected = await client.query<VoiceCallRow>("SELECT * FROM cop_voice_calls WHERE call_id = $1 FOR UPDATE", [
        callId
      ]);
      const row = selected.rows[0];
      if (!row) {
        return null;
      }
      const current = recordFromRow(row);
      const result = applyTransition(current, input);
      if (!result.changed) {
        return result;
      }
      const next = result.record;
      const updated = await client.query<VoiceCallRow>(
        `UPDATE cop_voice_calls SET
          phase = $2,
          revision = $3,
          accepted_by_subject_id = $4,
          accepted_by_endpoint_id = $5,
          connected_at = $6::timestamptz,
          ended_at = $7::timestamptz,
          end_reason = $8,
          updated_at = $9::timestamptz
        WHERE call_id = $1
        RETURNING *`,
        [
          callId,
          next.phase,
          next.revision,
          next.acceptedBySubjectId ?? null,
          next.acceptedByEndpointId ?? null,
          next.connectedAt ?? null,
          next.endedAt ?? null,
          next.endReason ?? null,
          next.updatedAt
        ]
      );
      return { changed: true, record: recordFromRow(requireRow(updated.rows[0])) };
    });
  }

  async expireDue(now: string): Promise<VoiceCallRecord[]> {
    const result = await this.pool.query<VoiceCallRow>(
      `UPDATE cop_voice_calls SET
        phase = CASE
          WHEN phase IN ('created', 'ringing') THEN 'missed'
          ELSE 'failed'
        END,
        revision = revision + 1,
        ended_at = $1::timestamptz,
        end_reason = CASE
          WHEN phase IN ('created', 'ringing') THEN 'ring_timeout'
          ELSE 'media_timeout'
        END,
        updated_at = $1::timestamptz
      WHERE phase IN ('created', 'ringing', 'accepted', 'connecting_media')
        AND expires_at <= $1::timestamptz
      RETURNING *`,
      [now]
    );
    return result.rows.map(recordFromRow);
  }
}

export function voiceCallIncludesSubject(record: VoiceCallRecord, subjectId: string): boolean {
  return record.initiatorSubjectId === subjectId || record.participantSubjectIds.includes(subjectId);
}

export function isTerminalPhase(phase: VoiceCallPhase): phase is VoiceCallTerminalPhase {
  return phase === "declined" || phase === "missed" || phase === "cancelled" || phase === "failed" || phase === "ended";
}

function applyTransition(current: VoiceCallRecord, input: VoiceCallTransitionInput): VoiceCallTransitionResult {
  if (input.action === "accept" && current.phase === "accepted") {
    const sameEndpoint =
      current.acceptedBySubjectId === input.actorSubjectId &&
      Boolean(input.endpointId) &&
      current.acceptedByEndpointId === input.endpointId;
    return sameEndpoint
      ? { changed: false, record: current }
      : { changed: false, conflict: "claimed", record: current };
  }
  if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
    return { changed: false, conflict: "revision", record: current };
  }
  if (isTerminalPhase(current.phase)) {
    return { changed: false, conflict: "terminal", record: current };
  }
  if (input.action === "heartbeat") {
    return {
      changed: true,
      record: { ...current, revision: current.revision + 1, updatedAt: input.now }
    };
  }

  const isInitiator = input.actorSubjectId === current.initiatorSubjectId;
  const isRecipient = current.participantSubjectIds.includes(input.actorSubjectId);
  let nextPhase: VoiceCallPhase | undefined;

  switch (input.action) {
    case "accept":
      if (isRecipient && current.phase === "ringing") {
        nextPhase = "accepted";
      }
      break;
    case "decline":
      if (isRecipient && current.phase === "ringing") {
        nextPhase = "declined";
      }
      break;
    case "cancel":
      if (isInitiator && (current.phase === "created" || current.phase === "ringing")) {
        nextPhase = "cancelled";
      }
      break;
    case "media_connected":
      if (
        (isInitiator || isRecipient) &&
        (current.phase === "accepted" || current.phase === "connecting_media" || current.phase === "connected")
      ) {
        nextPhase = "connected";
      }
      break;
    case "media_failed":
      if (isInitiator || isRecipient) {
        nextPhase = "failed";
      }
      break;
    case "end":
      if (isInitiator || isRecipient) {
        nextPhase = "ended";
      }
      break;
  }

  if (!nextPhase) {
    return { changed: false, conflict: "transition", record: current };
  }

  const terminalPhase = isTerminalPhase(nextPhase) ? nextPhase : undefined;
  return {
    changed: true,
    record: {
      ...current,
      ...(input.action === "accept"
        ? {
            acceptedBySubjectId: input.actorSubjectId,
            ...(input.endpointId ? { acceptedByEndpointId: input.endpointId } : {})
          }
        : {}),
      ...(nextPhase === "connected" && !current.connectedAt ? { connectedAt: input.now } : {}),
      ...(terminalPhase ? { endedAt: input.now, endReason: input.reason ?? defaultEndReason(terminalPhase) } : {}),
      phase: nextPhase,
      revision: current.revision + 1,
      updatedAt: input.now
    }
  };
}

function terminalRecord(
  current: VoiceCallRecord,
  phase: VoiceCallTerminalPhase,
  now: string,
  reason: string
): VoiceCallRecord {
  return {
    ...current,
    endedAt: now,
    endReason: reason,
    phase,
    revision: current.revision + 1,
    updatedAt: now
  };
}

function defaultEndReason(phase: VoiceCallTerminalPhase): string {
  switch (phase) {
    case "cancelled":
      return "caller_cancelled";
    case "declined":
      return "recipient_declined";
    case "failed":
      return "media_failed";
    case "missed":
      return "ring_timeout";
    case "ended":
      return "participant_ended";
  }
}

function normalizeParticipants(values: string[], initiatorSubjectId: string): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0 && value !== initiatorSubjectId))
  ).sort();
}

function cloneRecord(record: VoiceCallRecord): VoiceCallRecord {
  return { ...record, participantSubjectIds: [...record.participantSubjectIds] };
}

function requireRow(row: VoiceCallRow | undefined): VoiceCallRow {
  if (!row) {
    throw new Error("Voice call store query returned no row.");
  }
  return row;
}

interface VoiceCallRow extends QueryResultRow {
  owner_issuer: string | null;
  accepted_by_endpoint_id: string | null;
  accepted_by_subject_id: string | null;
  call_id: string;
  connected_at: Date | string | null;
  created_at: Date | string;
  ended_at: Date | string | null;
  end_reason: string | null;
  expires_at: Date | string;
  initiator_subject_id: string;
  kind: VoiceCallKind;
  participant_subject_ids: unknown;
  phase: VoiceCallPhase;
  revision: number;
  room_id: string;
  title: string;
  updated_at: Date | string;
}

function recordFromRow(row: VoiceCallRow): VoiceCallRecord {
  return {
    ...(row.owner_issuer ? { ownerIssuer: row.owner_issuer } : {}),
    ...(row.accepted_by_endpoint_id ? { acceptedByEndpointId: row.accepted_by_endpoint_id } : {}),
    ...(row.accepted_by_subject_id ? { acceptedBySubjectId: row.accepted_by_subject_id } : {}),
    callId: row.call_id,
    ...(row.connected_at ? { connectedAt: isoTimestamp(row.connected_at) } : {}),
    createdAt: isoTimestamp(row.created_at),
    ...(row.ended_at ? { endedAt: isoTimestamp(row.ended_at) } : {}),
    ...(row.end_reason ? { endReason: row.end_reason } : {}),
    expiresAt: isoTimestamp(row.expires_at),
    initiatorSubjectId: row.initiator_subject_id,
    kind: row.kind,
    participantSubjectIds: parseParticipantSubjectIds(row.participant_subject_ids),
    phase: row.phase,
    revision: Number(row.revision),
    roomId: row.room_id,
    title: row.title,
    updatedAt: isoTimestamp(row.updated_at)
  };
}

function parseParticipantSubjectIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    try {
      return parseParticipantSubjectIds(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

function isoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeListLimit(value: number | undefined): number {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) {
    return 50;
  }
  return Math.min(value as number, 200);
}

function readSslConfig(env: Record<string, string | undefined>): PoolConfig["ssl"] {
  const enabled = /^(1|true|yes|on)$/iu.test(env.COP_DATABASE_SSL?.trim() ?? "");
  if (!enabled) {
    return undefined;
  }
  return {
    rejectUnauthorized: !/^(0|false|no|off)$/iu.test(env.COP_DATABASE_SSL_REJECT_UNAUTHORIZED?.trim() ?? "")
  };
}

const createVoiceCallTableSql = `
CREATE TABLE IF NOT EXISTS cop_voice_calls (
  call_id text PRIMARY KEY,
  room_id text NOT NULL,
  title text NOT NULL,
  kind text NOT NULL CHECK (kind = 'direct'),
  initiator_subject_id text NOT NULL,
  participant_subject_ids jsonb NOT NULL,
  phase text NOT NULL CHECK (
    phase IN (
      'created', 'ringing', 'accepted', 'connecting_media', 'connected',
      'declined', 'missed', 'cancelled', 'failed', 'ended'
    )
  ),
  revision integer NOT NULL CHECK (revision > 0),
  expires_at timestamptz NOT NULL,
  accepted_by_subject_id text,
  accepted_by_endpoint_id text,
  connected_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
ALTER TABLE cop_voice_calls ADD COLUMN IF NOT EXISTS accepted_by_endpoint_id text;
ALTER TABLE cop_voice_calls ADD COLUMN IF NOT EXISTS owner_issuer text;
CREATE TABLE IF NOT EXISTS cop_voice_media_grants (
  owner_hash text NOT NULL,
  subject_hash text NOT NULL,
  call_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (owner_hash, call_id)
);
CREATE INDEX IF NOT EXISTS cop_voice_media_grants_subject_idx ON cop_voice_media_grants (subject_hash);
CREATE INDEX IF NOT EXISTS cop_voice_calls_room_updated_idx
  ON cop_voice_calls (room_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS cop_voice_calls_expiry_idx
  ON cop_voice_calls (expires_at)
  WHERE phase IN ('created', 'ringing', 'accepted', 'connecting_media');
`;

function voiceCallReferencesSubject(record: VoiceCallRecord, subjectId: string): boolean {
  return voiceCallIncludesSubject(record, subjectId) || record.acceptedBySubjectId === subjectId;
}
function canRecordMediaGrant(record: VoiceCallRecord, subjectId: string): boolean {
  return !isTerminalPhase(record.phase) && (record.initiatorSubjectId === subjectId || record.acceptedBySubjectId === subjectId);
}
function validateMediaGrantExpiry(expiresAt: string, now: string): void {
  const expiry = Date.parse(expiresAt), issued = Date.parse(now);
  if (!Number.isFinite(expiry) || !Number.isFinite(issued) || expiry <= issued || expiry > issued + 3_600_000) throw new Error("Unsupported media grant expiry");
}
function tokenNotBefore(requestedAt: string, expiries: string[]): string {
  const requested = Date.parse(requestedAt);
  if (!Number.isFinite(requested)) throw new Error("Invalid erasure time");
  // Previously issued, unused JWTs are not revoked by removing an active participant.
  // The issuer caps JWT lifetime at one hour. LiveKit1.13.3 still accepts
  // a token for60s after exp (verified against the actual provider); retain
  // another30s clock margin before acknowledging irreversible cleanup.
  return new Date(Math.max(requested + 3_690_000, ...expiries.map(value => Date.parse(value) + 90_000))).toISOString();
}
function removeVoiceActor(record: VoiceCallRecord, subjectId: string, requestedAt: string): VoiceCallRecord | null {
  const initiatorSubjectId = record.initiatorSubjectId === subjectId ? "erased-account" : record.initiatorSubjectId;
  const participantSubjectIds = record.participantSubjectIds.filter(subject => subject !== subjectId);
  if (initiatorSubjectId === "erased-account" && participantSubjectIds.length === 0) return null;
  const next = { ...record, initiatorSubjectId, participantSubjectIds, title: "COP hovor", revision: record.revision + 1,
    ...(isTerminalPhase(record.phase) ? {} : { phase: "ended" as const, endedAt: requestedAt }), endReason: "account_removed", updatedAt: requestedAt };
  if (next.acceptedBySubjectId === subjectId) { delete next.acceptedBySubjectId; delete next.acceptedByEndpointId; }
  return next;
}
interface VoiceMediaGrantRow extends QueryResultRow { owner_hash: string; expires_at: Date | string }
async function voiceOwnerRows(client: Pick<PoolClient, "query">, subjectId: string, lockRows = false) {
  const calls = await client.query<VoiceCallRow>(`SELECT * FROM cop_voice_calls WHERE initiator_subject_id=$1 OR participant_subject_ids ? $1 OR accepted_by_subject_id=$1 ORDER BY call_id${lockRows ? " FOR UPDATE" : ""}`, [subjectId]);
  const grants = await client.query<VoiceMediaGrantRow>("SELECT * FROM cop_voice_media_grants WHERE subject_hash=$1 ORDER BY owner_hash, call_id", [runtimeSubjectHash(subjectId)]);
  return { calls: calls.rows, grants: grants.rows };
}
