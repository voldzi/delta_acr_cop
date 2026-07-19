import pg, { type Pool as PgPool, type PoolConfig, type QueryResultRow } from "pg";
import { randomUUID } from "node:crypto";

const { Pool } = pg;

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
  expectedRevision?: number;
  now: string;
  reason?: string;
}

export interface VoiceCallTransitionResult {
  changed: boolean;
  conflict?: "revision" | "terminal" | "transition";
  record: VoiceCallRecord;
}

export interface VoiceCallStore {
  readonly name: string;
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

  constructor(name = "memory") {
    this.name = name;
  }

  async init(): Promise<void> {}

  async close(): Promise<void> {}

  async create(input: VoiceCallCreateInput): Promise<VoiceCallRecord> {
    const participantSubjectIds = normalizeParticipants(input.participantSubjectIds, input.initiatorSubjectId);
    if (participantSubjectIds.length === 0) {
      throw new Error("Voice call requires at least one recipient.");
    }
    const callId = randomUUID().toLowerCase();
    const record: VoiceCallRecord = {
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
    const current = this.calls.get(callId);
    if (!current) {
      return null;
    }
    const result = applyTransition(current, input);
    if (result.changed) {
      this.calls.set(callId, result.record);
    }
    return { ...result, record: cloneRecord(result.record) };
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
    this.pool = new Pool(config);
  }

  async init(): Promise<void> {
    await this.pool.query(createVoiceCallTableSql);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async create(input: VoiceCallCreateInput): Promise<VoiceCallRecord> {
    const participantSubjectIds = normalizeParticipants(input.participantSubjectIds, input.initiatorSubjectId);
    if (participantSubjectIds.length === 0) {
      throw new Error("Voice call requires at least one recipient.");
    }
    const callId = randomUUID().toLowerCase();
    const result = await this.pool.query<VoiceCallRow>(
      `INSERT INTO cop_voice_calls (
        call_id, room_id, title, kind, initiator_subject_id, participant_subject_ids,
        phase, revision, expires_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'ringing', 1, $7::timestamptz, $8::timestamptz, $8::timestamptz)
      RETURNING *`,
      [
        callId,
        input.roomId,
        input.title,
        input.kind,
        input.initiatorSubjectId,
        JSON.stringify(participantSubjectIds),
        input.expiresAt,
        input.now
      ]
    );
    return recordFromRow(requireRow(result.rows[0]));
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
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<VoiceCallRow>("SELECT * FROM cop_voice_calls WHERE call_id = $1 FOR UPDATE", [
        callId
      ]);
      const row = selected.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }
      const current = recordFromRow(row);
      const result = applyTransition(current, input);
      if (!result.changed) {
        await client.query("COMMIT");
        return result;
      }
      const next = result.record;
      const updated = await client.query<VoiceCallRow>(
        `UPDATE cop_voice_calls SET
          phase = $2,
          revision = $3,
          accepted_by_subject_id = $4,
          connected_at = $5::timestamptz,
          ended_at = $6::timestamptz,
          end_reason = $7,
          updated_at = $8::timestamptz
        WHERE call_id = $1
        RETURNING *`,
        [
          callId,
          next.phase,
          next.revision,
          next.acceptedBySubjectId ?? null,
          next.connectedAt ?? null,
          next.endedAt ?? null,
          next.endReason ?? null,
          next.updatedAt
        ]
      );
      await client.query("COMMIT");
      return { changed: true, record: recordFromRow(requireRow(updated.rows[0])) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
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
      ...(input.action === "accept" ? { acceptedBySubjectId: input.actorSubjectId } : {}),
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
  connected_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS cop_voice_calls_room_updated_idx
  ON cop_voice_calls (room_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS cop_voice_calls_expiry_idx
  ON cop_voice_calls (expires_at)
  WHERE phase IN ('created', 'ringing', 'accepted', 'connecting_media');
`;
