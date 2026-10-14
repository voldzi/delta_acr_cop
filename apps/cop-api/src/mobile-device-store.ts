import { type Pool as PgPool, type PoolConfig, type QueryResultRow, type PoolClient } from "pg";
import { createCopPgPool } from "./cop-pg-pool.js";
import { randomBytes } from "node:crypto";
import { assertRuntimeOwnerAllowed, assertSameProvenance, fenceRuntimeOwner, MemoryRuntimeOwnerFences,
  requireRuntimeOwner, runtimeAssessment, runtimeOwnerFenceTableSql, runtimeOwnerTransaction,
  runtimeOwnerLock, type RuntimeOwner, type RuntimeOwnerAssessment } from "./runtime-owner-erasure.js";

export type MobilePlatform = "ios" | "ipados";
export type MobileDeviceStatus = "paired" | "revoked";
export type MobilePairingSessionStatus = "pending" | "claimed" | "confirmed" | "expired" | "revoked";
export type MobileMeshAckStatus = "accepted" | "duplicate" | "rejected" | "delivered" | "expired";

export interface MobileDeviceRegistrationInput {
  /** Verified server-side issuer; never read from request JSON. */
  ownerIssuer?: string;
  appVersion: string;
  buildNumber?: string;
  capabilities: string[];
  deviceId: string;
  deviceModel?: string;
  deviceSessionId: string;
  matrixDeviceId?: string;
  osVersion?: string;
  platform: MobilePlatform;
  pushTokenRegistered: boolean;
  registeredAt: string;
  subjectId: string;
}

export interface MobileDeviceRecord extends MobileDeviceRegistrationInput {
  lastSeenAt: string;
  pairedAt: string;
  pairingCode?: string;
  revokedAt?: string;
  status: MobileDeviceStatus;
}

export interface MobilePairingActorRecord {
  /** Verified server-side issuer; never read from request JSON. */
  ownerIssuer?: string;
  displayName: string;
  subjectId: string;
  username: string;
}

export interface MobilePairingSessionRecord {
  claimedAt?: string;
  claimedBy?: MobilePairingActorRecord;
  claimedDevice?: MobileDeviceRegistrationInput;
  code: string;
  confirmedAt?: string;
  createdAt: string;
  createdBy: MobilePairingActorRecord;
  expiresAt: string;
  status: MobilePairingSessionStatus;
}

export interface MobileMeshBundleIngestInput {
  /** Verified server-side issuer; never read from request JSON. */
  ownerIssuer?: string;
  bundleType?: string;
  deviceId?: string;
  envelopeId: string;
  expiresAt?: string;
  payloadSizeBytes?: number;
  receivedAt: string;
  subjectId: string;
}

export interface MobileMeshAckRecord {
  /** Verified server-side issuer; never read from request JSON. */
  ownerIssuer?: string;
  bundleType?: string;
  deviceId?: string;
  envelopeId: string;
  expiresAt?: string;
  payloadSizeBytes?: number;
  receivedAt: string;
  status: MobileMeshAckStatus;
  subjectId: string;
  updatedAt: string;
}

export interface MobilePairingSessionCreateInput {
  actor: MobilePairingActorRecord;
  expiresAt: string;
  now: string;
}

export interface MobileDeviceStore {
  readonly name: string;
  erasureReady?(): Promise<boolean>;
  assertSubjectAllowed?(subjectId: string): Promise<void>;
  preflightActorErasure?(owner: RuntimeOwner): Promise<RuntimeOwnerAssessment>;
  purgeActor?(owner: RuntimeOwner, operationId: string, requestedAt: string): Promise<{ complete: boolean }>;
  claimPairingSession(code: string, actor: MobilePairingActorRecord, device: MobileDeviceRegistrationInput, now: string): Promise<MobilePairingSessionRecord | null>;
  close(): Promise<void>;
  confirmPairingSession(code: string, now: string): Promise<MobilePairingSessionRecord | null>;
  createPairingSession(input: MobilePairingSessionCreateInput): Promise<MobilePairingSessionRecord>;
  diagnostics?(): string | undefined;
  getPairingSession(code: string, now: string): Promise<MobilePairingSessionRecord | null>;
  ingestMeshBundle(input: MobileMeshBundleIngestInput): Promise<{ duplicate: boolean; record: MobileMeshAckRecord }>;
  init(): Promise<void>;
  listDevices(subjectId: string): Promise<MobileDeviceRecord[]>;
  listMeshAcks(subjectId: string, since: string | undefined, limit: number): Promise<MobileMeshAckRecord[]>;
  revokeDevice(subjectId: string, deviceId: string, now: string): Promise<MobileDeviceRecord | null>;
  upsertDevice(device: MobileDeviceRegistrationInput, status: MobileDeviceStatus, now: string, pairingCode?: string): Promise<MobileDeviceRecord>;
}

export function createMobileDeviceStoreFromEnv(env: Record<string, string | undefined> = process.env): MobileDeviceStore {
  const mode = (env.COP_MOBILE_DEVICE_STORE ?? "auto").trim().toLowerCase();
  const connectionString = env.COP_DATABASE_URL?.trim();

  if (mode === "memory" || mode === "disabled") {
    return new InMemoryMobileDeviceStore(mode === "disabled" ? "memory-disabled" : "memory");
  }
  if (mode === "auto" && !connectionString) {
    return new InMemoryMobileDeviceStore("memory");
  }
  if ((mode === "auto" || mode === "postgres" || mode === "postgresql") && connectionString) {
    return new PostgresMobileDeviceStore({
      connectionString,
      connectionTimeoutMillis: readPositiveInteger(env.COP_DATABASE_CONNECT_TIMEOUT_MS, 5000),
      idleTimeoutMillis: readPositiveInteger(env.COP_DATABASE_IDLE_TIMEOUT_MS, 30000),
      max: readPositiveInteger(env.COP_DATABASE_POOL_MAX, 5),
      ssl: readSslConfig(env)
    });
  }

  throw new Error(`Unsupported COP_MOBILE_DEVICE_STORE value: ${mode}`);
}

export class InMemoryMobileDeviceStore implements MobileDeviceStore {
  readonly name: string;
  private readonly devices = new Map<string, MobileDeviceRecord>();
  private readonly meshAcks = new Map<string, MobileMeshAckRecord>();
  private readonly pairingSessions = new Map<string, MobilePairingSessionRecord>();
  private readonly ownerFences = new MemoryRuntimeOwnerFences();

  constructor(name = "memory") {
    this.name = name;
  }

  async init(): Promise<void> {}

  async createPairingSession(input: MobilePairingSessionCreateInput): Promise<MobilePairingSessionRecord> {
    return this.ownerFences.transact([input.actor.subjectId], async () => {
      const session: MobilePairingSessionRecord = {
        code: createPairingCode(),
        createdAt: input.now,
        createdBy: input.actor,
        expiresAt: input.expiresAt,
        status: "pending"
      };
      this.pairingSessions.set(session.code, structuredClone(session));
      return structuredClone(session);
    });
  }

  async getPairingSession(code: string, now: string): Promise<MobilePairingSessionRecord | null> {
    const session = normalizePairingSessionExpiry(this.pairingSessions.get(code) ?? null, now);
    return session ? structuredClone(session) : null;
  }

  async claimPairingSession(code: string, actor: MobilePairingActorRecord, device: MobileDeviceRegistrationInput, now: string): Promise<MobilePairingSessionRecord | null> {
    return this.ownerFences.transact([actor.subjectId, device.subjectId], async () => {
      const current = normalizePairingSessionExpiry(this.pairingSessions.get(code) ?? null, now);
      if (!current || current.status !== "pending") {
        return current;
      }
      requirePairingOwner(current, actor, device);
      this.ownerFences.assertAllowed(current.createdBy.subjectId);
      if (current.claimedBy) this.ownerFences.assertAllowed(current.claimedBy.subjectId);
      const next: MobilePairingSessionRecord = {
        ...current,
        claimedAt: now,
        claimedBy: actor,
        claimedDevice: device,
        status: "claimed"
      };
      this.pairingSessions.set(code, structuredClone(next));
      return structuredClone(next);
    });
  }

  async confirmPairingSession(code: string, now: string): Promise<MobilePairingSessionRecord | null> {
    return this.ownerFences.transact([], async () => {
      const current = normalizePairingSessionExpiry(this.pairingSessions.get(code) ?? null, now);
      if (!current || current.status !== "claimed") {
        return current;
      }
      this.ownerFences.assertAllowed(current.createdBy.subjectId);
      if (current.claimedBy) this.ownerFences.assertAllowed(current.claimedBy.subjectId);
      const next: MobilePairingSessionRecord = {
        ...current,
        confirmedAt: now,
        status: "confirmed"
      };
      this.pairingSessions.set(code, next);
      return structuredClone(next);
    });
  }

  async upsertDevice(device: MobileDeviceRegistrationInput, status: MobileDeviceStatus, now: string, pairingCode?: string): Promise<MobileDeviceRecord> {
    return this.ownerFences.transact([device.subjectId], async () => {
      if (pairingCode) {
        const pairing = this.pairingSessions.get(pairingCode);
        if (!pairing) throw new Error("Unknown pairing session");
        requireConfirmedPairingDevice(pairing, device);
        this.ownerFences.assertAllowed(pairing.createdBy.subjectId);
        if (pairing.claimedBy) this.ownerFences.assertAllowed(pairing.claimedBy.subjectId);
      }
      const key = deviceKey(device.subjectId, device.deviceId);
      const existing = this.devices.get(key);
      if (existing) assertSameProvenance(existing.ownerIssuer, device.ownerIssuer);
      const record: MobileDeviceRecord = {
        ...device,
        ...(existing ? { ownerIssuer: existing.ownerIssuer } : {}),
        lastSeenAt: now,
        pairedAt: existing?.pairedAt ?? now,
        ...(pairingCode ?? existing?.pairingCode ? { pairingCode: pairingCode ?? existing?.pairingCode } : {}),
        ...(status === "revoked" ? { revokedAt: now } : {}),
        status
      };
      this.devices.set(key, structuredClone(record));
      return structuredClone(record);
    });
  }

  async listDevices(subjectId: string): Promise<MobileDeviceRecord[]> {
    return Array.from(this.devices.values())
      .filter((device) => device.subjectId === subjectId)
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt)).map(record => structuredClone(record));
  }

  async revokeDevice(subjectId: string, deviceId: string, now: string): Promise<MobileDeviceRecord | null> {
    return this.ownerFences.transact([subjectId], async () => {
      const current = this.devices.get(deviceKey(subjectId, deviceId));
      if (!current) {
        return null;
      }
      const next: MobileDeviceRecord = {
        ...current,
        lastSeenAt: now,
        revokedAt: now,
        status: "revoked"
      };
      this.devices.set(deviceKey(subjectId, deviceId), next);
      return structuredClone(next);
    });
  }

  async ingestMeshBundle(input: MobileMeshBundleIngestInput): Promise<{ duplicate: boolean; record: MobileMeshAckRecord }> {
    return this.ownerFences.transact([input.subjectId], async () => {
      const key = meshAckKey(input.subjectId, input.envelopeId);
      const current = this.meshAcks.get(key);
      if (current) assertSameProvenance(current.ownerIssuer, input.ownerIssuer);
      if (current) {
        const duplicate: MobileMeshAckRecord = {
          ...current,
          status: "duplicate",
          updatedAt: input.receivedAt
        };
        this.meshAcks.set(key, duplicate);
        return { duplicate: true, record: structuredClone(duplicate) };
      }
      const record: MobileMeshAckRecord = {
        ...(input.ownerIssuer ? { ownerIssuer: input.ownerIssuer } : {}),
        ...(input.bundleType ? { bundleType: input.bundleType } : {}),
        ...(input.deviceId ? { deviceId: input.deviceId } : {}),
        envelopeId: input.envelopeId,
        ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
        ...(typeof input.payloadSizeBytes === "number" ? { payloadSizeBytes: input.payloadSizeBytes } : {}),
        receivedAt: input.receivedAt,
        status: "accepted",
        subjectId: input.subjectId,
        updatedAt: input.receivedAt
      };
      this.meshAcks.set(key, record);
      return { duplicate: false, record: structuredClone(record) };
    });
  }

  async listMeshAcks(subjectId: string, since: string | undefined, limit: number): Promise<MobileMeshAckRecord[]> {
    const sinceMs = since ? Date.parse(since) : Number.NEGATIVE_INFINITY;
    return Array.from(this.meshAcks.values())
      .filter((ack) => ack.subjectId === subjectId && Date.parse(ack.updatedAt) >= sinceMs)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit).map(record => structuredClone(record));
  }

  async erasureReady(): Promise<boolean> { return true; }
  async assertSubjectAllowed(subjectId: string): Promise<void> { this.ownerFences.assertAllowed(subjectId); }
  async preflightActorErasure(owner: RuntimeOwner): Promise<RuntimeOwnerAssessment> {
    requireRuntimeOwner(owner);
    return this.ownerFences.transact([], () => this.actorAssessment(owner), true);
  }
  private actorAssessment(owner: RuntimeOwner): RuntimeOwnerAssessment {
    const devices = [...this.devices.values()].filter(item => item.subjectId === owner.subjectId);
    const acks = [...this.meshAcks.values()].filter(item => item.subjectId === owner.subjectId);
    const pairings = [...this.pairingSessions.values()].filter(item => item.createdBy.subjectId === owner.subjectId || item.claimedBy?.subjectId === owner.subjectId || item.claimedDevice?.subjectId === owner.subjectId);
    const unresolved = [...devices, ...acks].some(item => item.ownerIssuer !== owner.issuer) || pairings.some(item =>
      (item.createdBy.subjectId === owner.subjectId && item.createdBy.ownerIssuer !== owner.issuer) ||
      (item.claimedBy?.subjectId === owner.subjectId && item.claimedBy.ownerIssuer !== owner.issuer) ||
      (item.claimedDevice?.subjectId === owner.subjectId && item.claimedDevice.ownerIssuer !== owner.issuer));
    return { ...runtimeAssessment([devices, acks, pairings]), ready: !unresolved };
  }
  async purgeActor(owner: RuntimeOwner, _operationId: string, _requestedAt: string): Promise<{ complete: boolean }> {
    requireRuntimeOwner(owner);
    return this.ownerFences.transact([owner.subjectId], () => {
      this.ownerFences.fence(owner);
      if (!this.actorAssessment(owner).ready) return { complete: false };
      for (const [key, item] of this.devices) if (item.subjectId === owner.subjectId && item.ownerIssuer === owner.issuer) this.devices.delete(key);
      for (const [key, item] of this.meshAcks) if (item.subjectId === owner.subjectId && item.ownerIssuer === owner.issuer) this.meshAcks.delete(key);
      for (const [key, item] of this.pairingSessions) if ((item.createdBy.subjectId === owner.subjectId && item.createdBy.ownerIssuer === owner.issuer) ||
        (item.claimedBy?.subjectId === owner.subjectId && item.claimedBy.ownerIssuer === owner.issuer) ||
        (item.claimedDevice?.subjectId === owner.subjectId && item.claimedDevice.ownerIssuer === owner.issuer)) this.pairingSessions.delete(key);
      const remaining = [...this.devices.values(), ...this.meshAcks.values()].some(item => item.subjectId === owner.subjectId) ||
        [...this.pairingSessions.values()].some(item => item.createdBy.subjectId === owner.subjectId || item.claimedBy?.subjectId === owner.subjectId || item.claimedDevice?.subjectId === owner.subjectId);
      return { complete: !remaining };
    }, true);
  }
  async close(): Promise<void> {}
}

export class PostgresMobileDeviceStore implements MobileDeviceStore {
  readonly name = "postgres";
  private lastIdleClientError: string | undefined;
  private readonly pool: PgPool;

  constructor(config: PoolConfig) {
    this.pool = createCopPgPool("mobile-device", config);
    this.pool.on("error", (error) => {
      this.lastIdleClientError = errorMessage(error);
    });
  }

  async init(): Promise<void> {
    await this.pool.query(runtimeOwnerFenceTableSql + createMobileDeviceTablesSql);
  }

  async createPairingSession(input: MobilePairingSessionCreateInput): Promise<MobilePairingSessionRecord> {
    return runtimeOwnerTransaction(this.pool, "cop_devices", [input.actor.subjectId], async client => {
      const code = createPairingCode();
      const result = await client.query<MobilePairingSessionRow>(
        `INSERT INTO cop_mobile_pairing_sessions (
          code,
          created_by_subject_id,
          created_by_owner_issuer,
          created_by_username,
          created_by_display_name,
          status,
          created_at,
          expires_at
        )
        VALUES ($1, $2, $7, $3, $4, 'pending', $5, $6)
        RETURNING *`,
        [code, input.actor.subjectId, input.actor.username, input.actor.displayName, input.now, input.expiresAt, input.actor.ownerIssuer ?? null]
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error("Mobile pairing session insert did not return a row.");
      }
      return pairingSessionFromRow(row);
    });
  }

  async getPairingSession(code: string, now: string): Promise<MobilePairingSessionRecord | null> {
    await expirePairingSessions(this.pool, now, code);
    const result = await this.pool.query<MobilePairingSessionRow>(
      `SELECT * FROM cop_mobile_pairing_sessions WHERE code = $1`,
      [code]
    );
    return result.rows[0] ? pairingSessionFromRow(result.rows[0]) : null;
  }

  async claimPairingSession(code: string, actor: MobilePairingActorRecord, device: MobileDeviceRegistrationInput, now: string): Promise<MobilePairingSessionRecord | null> {
    return runtimeOwnerTransaction(this.pool, "cop_devices", [], async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`cop-mobile-pairing:${code}`]);
      const current = await client.query<MobilePairingSessionRow>("SELECT * FROM cop_mobile_pairing_sessions WHERE code=$1", [code]);
      const existing = current.rows[0];
      if (existing) {
        requirePairingOwner(pairingSessionFromRow(existing), actor, device);
        for (const subject of [...new Set([actor.subjectId, device.subjectId, existing.created_by_subject_id, existing.claimed_by_subject_id].filter((value): value is string => !!value))].sort()) {
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [runtimeOwnerLock("cop_devices", subject)]);
          await assertRuntimeOwnerAllowed(client, "cop_devices", subject);
        }
      }
      await expirePairingSessions(client, now, code);
      const result = await client.query<MobilePairingSessionRow>(
        `UPDATE cop_mobile_pairing_sessions
        SET status = 'claimed',
          claimed_at = $2,
          claimed_by_subject_id = $3,
          claimed_by_owner_issuer = $8,
          claimed_by_username = $4,
          claimed_by_display_name = $5,
          claimed_device_id = $6,
          device_payload = $7::jsonb
        WHERE code = $1 AND status = 'pending'
        RETURNING *`,
        [code, now, actor.subjectId, actor.username, actor.displayName, device.deviceId, JSON.stringify(device), actor.ownerIssuer ?? null]
      );
      if (result.rows[0]) {
        return pairingSessionFromRow(result.rows[0]);
      }
      const fallback = await client.query<MobilePairingSessionRow>("SELECT * FROM cop_mobile_pairing_sessions WHERE code=$1", [code]);
      return fallback.rows[0] ? pairingSessionFromRow(fallback.rows[0]) : null;
    });
  }

  async confirmPairingSession(code: string, now: string): Promise<MobilePairingSessionRecord | null> {
    return runtimeOwnerTransaction(this.pool, "cop_devices", [], async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`cop-mobile-pairing:${code}`]);
      const current = await client.query<MobilePairingSessionRow>("SELECT * FROM cop_mobile_pairing_sessions WHERE code=$1", [code]);
      const existing = current.rows[0];
      if (existing) {
        for (const subject of [existing.created_by_subject_id, existing.claimed_by_subject_id].filter((value): value is string => !!value).sort()) {
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [runtimeOwnerLock("cop_devices", subject)]);
          await assertRuntimeOwnerAllowed(client, "cop_devices", subject);
        }
      }
      await expirePairingSessions(client, now, code);
      const result = await client.query<MobilePairingSessionRow>(
        `UPDATE cop_mobile_pairing_sessions
        SET status = 'confirmed',
          confirmed_at = $2
        WHERE code = $1 AND status = 'claimed'
        RETURNING *`,
        [code, now]
      );
      if (result.rows[0]) {
        return pairingSessionFromRow(result.rows[0]);
      }
      const fallback = await client.query<MobilePairingSessionRow>("SELECT * FROM cop_mobile_pairing_sessions WHERE code=$1", [code]);
      return fallback.rows[0] ? pairingSessionFromRow(fallback.rows[0]) : null;
    });
  }

  async upsertDevice(device: MobileDeviceRegistrationInput, status: MobileDeviceStatus, now: string, pairingCode?: string): Promise<MobileDeviceRecord> {
    return runtimeOwnerTransaction(this.pool, "cop_devices", [device.subjectId], async client => {
      const existing = await client.query<MobileDeviceRow>("SELECT * FROM cop_mobile_devices WHERE subject_id=$1 AND device_id=$2", [device.subjectId, device.deviceId]);
      if (existing.rows[0]) assertSameProvenance(existing.rows[0].owner_issuer ?? undefined, device.ownerIssuer);
      if (pairingCode) {
        const pairing = await client.query<MobilePairingSessionRow>("SELECT * FROM cop_mobile_pairing_sessions WHERE code=$1", [pairingCode]);
        if (!pairing.rows[0]) throw new Error("Unknown pairing session");
        requireConfirmedPairingDevice(pairingSessionFromRow(pairing.rows[0]), device);
        await assertRuntimeOwnerAllowed(client, "cop_devices", pairing.rows[0].created_by_subject_id);
        if (pairing.rows[0].claimed_by_subject_id) await assertRuntimeOwnerAllowed(client, "cop_devices", pairing.rows[0].claimed_by_subject_id);
      }
      const result = await client.query<MobileDeviceRow>(
        `INSERT INTO cop_mobile_devices (
          subject_id,
          owner_issuer,
          device_id,
          matrix_device_id,
          platform,
          app_version,
          build_number,
          device_model,
          os_version,
          capabilities,
          push_token_registered,
          device_session_id,
          pairing_code,
          status,
          paired_at,
          last_seen_at,
          revoked_at
        )
        VALUES ($1, $16, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $14, $15)
        ON CONFLICT (subject_id, device_id) DO UPDATE SET
          matrix_device_id = EXCLUDED.matrix_device_id,
          platform = EXCLUDED.platform,
          app_version = EXCLUDED.app_version,
          build_number = EXCLUDED.build_number,
          device_model = EXCLUDED.device_model,
          os_version = EXCLUDED.os_version,
          capabilities = EXCLUDED.capabilities,
          push_token_registered = EXCLUDED.push_token_registered,
          device_session_id = EXCLUDED.device_session_id,
          pairing_code = COALESCE(EXCLUDED.pairing_code, cop_mobile_devices.pairing_code),
          status = EXCLUDED.status,
          last_seen_at = EXCLUDED.last_seen_at,
          revoked_at = EXCLUDED.revoked_at
        RETURNING *`,
        [
          device.subjectId,
          device.deviceId,
          device.matrixDeviceId ?? null,
          device.platform,
          device.appVersion,
          device.buildNumber ?? null,
          device.deviceModel ?? null,
          device.osVersion ?? null,
          JSON.stringify(device.capabilities),
          device.pushTokenRegistered,
          device.deviceSessionId,
          pairingCode ?? null,
          status,
          now,
          status === "revoked" ? now : null,
          device.ownerIssuer ?? null
        ]
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error("Mobile device upsert did not return a row.");
      }
      return deviceFromRow(row);
    });
  }

  async listDevices(subjectId: string): Promise<MobileDeviceRecord[]> {
    const result = await this.pool.query<MobileDeviceRow>(
      `SELECT * FROM cop_mobile_devices
      WHERE subject_id = $1
      ORDER BY last_seen_at DESC`,
      [subjectId]
    );
    return result.rows.map(deviceFromRow);
  }

  async revokeDevice(subjectId: string, deviceId: string, now: string): Promise<MobileDeviceRecord | null> {
    return runtimeOwnerTransaction(this.pool, "cop_devices", [subjectId], async client => {
      const result = await client.query<MobileDeviceRow>(
        `UPDATE cop_mobile_devices
        SET status = 'revoked',
          revoked_at = $3,
          last_seen_at = $3
        WHERE subject_id = $1 AND device_id = $2
        RETURNING *`,
        [subjectId, deviceId, now]
      );
      return result.rows[0] ? deviceFromRow(result.rows[0]) : null;
    });
  }

  async ingestMeshBundle(input: MobileMeshBundleIngestInput): Promise<{ duplicate: boolean; record: MobileMeshAckRecord }> {
    return runtimeOwnerTransaction(this.pool, "cop_devices", [input.subjectId], async client => {
      const existing = await client.query<MobileMeshAckRow>("SELECT * FROM cop_mobile_mesh_acks WHERE subject_id=$1 AND envelope_id=$2", [input.subjectId, input.envelopeId]);
      if (existing.rows[0]) assertSameProvenance(existing.rows[0].owner_issuer ?? undefined, input.ownerIssuer);
      const inserted = await client.query<MobileMeshAckRow>(
        `INSERT INTO cop_mobile_mesh_acks (
          subject_id,
          owner_issuer,
          envelope_id,
          device_id,
          bundle_type,
          status,
          received_at,
          updated_at,
          expires_at,
          payload_size_bytes
        )
        VALUES ($1, $8, $2, $3, $4, 'accepted', $5, $5, $6, $7)
        ON CONFLICT (subject_id, envelope_id) DO NOTHING
        RETURNING *`,
        [
          input.subjectId,
          input.envelopeId,
          input.deviceId ?? null,
          input.bundleType ?? null,
          input.receivedAt,
          input.expiresAt ?? null,
          input.payloadSizeBytes ?? null,
          input.ownerIssuer ?? null
        ]
      );
      if (inserted.rows[0]) {
        return { duplicate: false, record: meshAckFromRow(inserted.rows[0]) };
      }
      const duplicate = await client.query<MobileMeshAckRow>(
        `UPDATE cop_mobile_mesh_acks
        SET status = 'duplicate',
          updated_at = $3
        WHERE subject_id = $1 AND envelope_id = $2
        RETURNING *`,
        [input.subjectId, input.envelopeId, input.receivedAt]
      );
      const row = duplicate.rows[0];
      if (!row) {
        throw new Error("Mobile mesh ack upsert did not return a row.");
      }
      return { duplicate: true, record: meshAckFromRow(row) };
    });
  }

  async listMeshAcks(subjectId: string, since: string | undefined, limit: number): Promise<MobileMeshAckRecord[]> {
    const result = since
      ? await this.pool.query<MobileMeshAckRow>(
        `SELECT * FROM cop_mobile_mesh_acks
        WHERE subject_id = $1 AND updated_at >= $2
        ORDER BY updated_at DESC
        LIMIT $3`,
        [subjectId, since, limit]
      )
      : await this.pool.query<MobileMeshAckRow>(
        `SELECT * FROM cop_mobile_mesh_acks
        WHERE subject_id = $1
        ORDER BY updated_at DESC
        LIMIT $2`,
        [subjectId, limit]
      );
    return result.rows.map(meshAckFromRow);
  }

  async erasureReady(): Promise<boolean> {
    await this.pool.query("SELECT 1 FROM cop_runtime_owner_fences LIMIT 0");
    return true;
  }
  async assertSubjectAllowed(subjectId: string): Promise<void> { await assertRuntimeOwnerAllowed(this.pool, "cop_devices", subjectId); }
  async preflightActorErasure(owner: RuntimeOwner): Promise<RuntimeOwnerAssessment> {
    requireRuntimeOwner(owner);
    return runtimeOwnerTransaction(this.pool, "cop_devices", [owner.subjectId], async client => {
      const rows = await mobileOwnerRows(client, owner.subjectId);
      return mobileRowsAssessment(rows, owner);
    }, true);
  }
  async purgeActor(owner: RuntimeOwner, operationId: string, requestedAt: string): Promise<{ complete: boolean }> {
    requireRuntimeOwner(owner);
    return runtimeOwnerTransaction(this.pool, "cop_devices", [owner.subjectId], async client => {
      await fenceRuntimeOwner(client, "cop_devices", owner, operationId, requestedAt);
      if (!mobileRowsAssessment(await mobileOwnerRows(client, owner.subjectId), owner).ready) return { complete: false };
      await client.query("DELETE FROM cop_mobile_devices WHERE subject_id=$1 AND owner_issuer=$2", [owner.subjectId, owner.issuer]);
      await client.query("DELETE FROM cop_mobile_mesh_acks WHERE subject_id=$1 AND owner_issuer=$2", [owner.subjectId, owner.issuer]);
      await client.query(`DELETE FROM cop_mobile_pairing_sessions WHERE
        (created_by_subject_id=$1 AND created_by_owner_issuer=$2) OR (claimed_by_subject_id=$1 AND claimed_by_owner_issuer=$2) OR
        (device_payload->>'subjectId'=$1 AND device_payload->>'ownerIssuer'=$2)`, [owner.subjectId, owner.issuer]);
      const rows = await mobileOwnerRows(client, owner.subjectId);
      return { complete: rows.devices.length === 0 && rows.acks.length === 0 && rows.pairings.length === 0 };
    }, true);
  }

  diagnostics(): string | undefined {
    return this.lastIdleClientError ? `last idle client error: ${this.lastIdleClientError}` : undefined;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function createPairingCode(): string {
  return randomBytes(18).toString("base64url");
}

function requirePairingOwner(session: MobilePairingSessionRecord, actor: Pick<MobilePairingActorRecord, "subjectId" | "ownerIssuer">,
  device: MobileDeviceRegistrationInput): void {
  if (session.createdBy.subjectId !== actor.subjectId || device.subjectId !== actor.subjectId) throw new Error("Pairing owner mismatch");
  assertSameProvenance(session.createdBy.ownerIssuer, actor.ownerIssuer);
  assertSameProvenance(actor.ownerIssuer, device.ownerIssuer);
}

function requireConfirmedPairingDevice(session: MobilePairingSessionRecord, device: MobileDeviceRegistrationInput): void {
  requirePairingOwner(session, device, device);
  if (session.status !== "confirmed" || session.claimedBy?.subjectId !== device.subjectId || session.claimedDevice?.deviceId !== device.deviceId) throw new Error("Pairing device not confirmed");
  assertSameProvenance(session.claimedBy.ownerIssuer, device.ownerIssuer);
  assertSameProvenance(session.claimedDevice.ownerIssuer, device.ownerIssuer);
}

function deviceKey(subjectId: string, deviceId: string): string {
  return `${subjectId}:${deviceId}`;
}

function meshAckKey(subjectId: string, envelopeId: string): string {
  return `${subjectId}:${envelopeId}`;
}

function normalizePairingSessionExpiry(session: MobilePairingSessionRecord | null, now: string): MobilePairingSessionRecord | null {
  if (!session || session.status !== "pending" && session.status !== "claimed") {
    return session;
  }
  return Date.parse(session.expiresAt) <= Date.parse(now)
    ? { ...session, status: "expired" }
    : session;
}

async function expirePairingSessions(pool: Pick<PoolClient, "query">, now: string, code: string): Promise<void> {
  await pool.query(
    `UPDATE cop_mobile_pairing_sessions
    SET status = 'expired'
    WHERE code = $2 AND status IN ('pending', 'claimed') AND expires_at <= $1`,
    [now, code]
  );
}

interface MobileDeviceRow extends QueryResultRow {
  owner_issuer: string | null;
  app_version: string;
  build_number: string | null;
  capabilities: unknown;
  device_id: string;
  device_model: string | null;
  device_session_id: string;
  last_seen_at: Date;
  matrix_device_id: string | null;
  os_version: string | null;
  paired_at: Date;
  pairing_code: string | null;
  platform: MobilePlatform;
  push_token_registered: boolean;
  revoked_at: Date | null;
  status: MobileDeviceStatus;
  subject_id: string;
}

interface MobilePairingSessionRow extends QueryResultRow {
  created_by_owner_issuer: string | null;
  claimed_by_owner_issuer: string | null;
  claimed_at: Date | null;
  claimed_by_display_name: string | null;
  claimed_by_subject_id: string | null;
  claimed_by_username: string | null;
  code: string;
  confirmed_at: Date | null;
  created_at: Date;
  created_by_display_name: string;
  created_by_subject_id: string;
  created_by_username: string;
  device_payload: unknown;
  expires_at: Date;
  status: MobilePairingSessionStatus;
}

interface MobileMeshAckRow extends QueryResultRow {
  owner_issuer: string | null;
  bundle_type: string | null;
  device_id: string | null;
  envelope_id: string;
  expires_at: Date | null;
  payload_size_bytes: number | null;
  received_at: Date;
  status: MobileMeshAckStatus;
  subject_id: string;
  updated_at: Date;
}

function deviceFromRow(row: MobileDeviceRow): MobileDeviceRecord {
  return {
    ...(row.owner_issuer ? { ownerIssuer: row.owner_issuer } : {}),
    appVersion: row.app_version,
    ...(row.build_number ? { buildNumber: row.build_number } : {}),
    capabilities: Array.isArray(row.capabilities) ? row.capabilities.filter((item): item is string => typeof item === "string") : [],
    deviceId: row.device_id,
    ...(row.device_model ? { deviceModel: row.device_model } : {}),
    deviceSessionId: row.device_session_id,
    lastSeenAt: row.last_seen_at.toISOString(),
    ...(row.matrix_device_id ? { matrixDeviceId: row.matrix_device_id } : {}),
    ...(row.os_version ? { osVersion: row.os_version } : {}),
    pairedAt: row.paired_at.toISOString(),
    ...(row.pairing_code ? { pairingCode: row.pairing_code } : {}),
    platform: row.platform,
    pushTokenRegistered: row.push_token_registered,
    ...(row.revoked_at ? { revokedAt: row.revoked_at.toISOString() } : {}),
    status: row.status,
    subjectId: row.subject_id,
    registeredAt: row.paired_at.toISOString()
  };
}

function meshAckFromRow(row: MobileMeshAckRow): MobileMeshAckRecord {
  return {
    ...(row.owner_issuer ? { ownerIssuer: row.owner_issuer } : {}),
    ...(row.bundle_type ? { bundleType: row.bundle_type } : {}),
    ...(row.device_id ? { deviceId: row.device_id } : {}),
    envelopeId: row.envelope_id,
    ...(row.expires_at ? { expiresAt: row.expires_at.toISOString() } : {}),
    ...(typeof row.payload_size_bytes === "number" ? { payloadSizeBytes: row.payload_size_bytes } : {}),
    receivedAt: row.received_at.toISOString(),
    status: row.status,
    subjectId: row.subject_id,
    updatedAt: row.updated_at.toISOString()
  };
}

function pairingSessionFromRow(row: MobilePairingSessionRow): MobilePairingSessionRecord {
  const claimedDevice = normalizeDevicePayload(row.device_payload);
  return {
    ...(row.claimed_at ? { claimedAt: row.claimed_at.toISOString() } : {}),
    ...(row.claimed_by_subject_id && row.claimed_by_username && row.claimed_by_display_name ? {
      claimedBy: {
        ...(row.claimed_by_owner_issuer ? { ownerIssuer: row.claimed_by_owner_issuer } : {}),
        displayName: row.claimed_by_display_name,
        subjectId: row.claimed_by_subject_id,
        username: row.claimed_by_username
      }
    } : {}),
    ...(claimedDevice ? { claimedDevice } : {}),
    code: row.code,
    ...(row.confirmed_at ? { confirmedAt: row.confirmed_at.toISOString() } : {}),
    createdAt: row.created_at.toISOString(),
    createdBy: {
      ...(row.created_by_owner_issuer ? { ownerIssuer: row.created_by_owner_issuer } : {}),
      displayName: row.created_by_display_name,
      subjectId: row.created_by_subject_id,
      username: row.created_by_username
    },
    expiresAt: row.expires_at.toISOString(),
    status: row.status
  };
}

function normalizeDevicePayload(value: unknown): MobileDeviceRegistrationInput | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const deviceId = typeof value.deviceId === "string" ? value.deviceId : undefined;
  const subjectId = typeof value.subjectId === "string" ? value.subjectId : undefined;
  const appVersion = typeof value.appVersion === "string" ? value.appVersion : undefined;
  const deviceSessionId = typeof value.deviceSessionId === "string" ? value.deviceSessionId : undefined;
  const platform = value.platform === "ios" || value.platform === "ipados" ? value.platform : undefined;
  if (!deviceId || !subjectId || !appVersion || !deviceSessionId || !platform) {
    return undefined;
  }
  return {
    appVersion,
    ...(typeof value.buildNumber === "string" ? { buildNumber: value.buildNumber } : {}),
    capabilities: Array.isArray(value.capabilities) ? value.capabilities.filter((item): item is string => typeof item === "string") : [],
    deviceId,
    ...(typeof value.deviceModel === "string" ? { deviceModel: value.deviceModel } : {}),
    deviceSessionId,
    ...(typeof value.matrixDeviceId === "string" ? { matrixDeviceId: value.matrixDeviceId } : {}),
    ...(typeof value.osVersion === "string" ? { osVersion: value.osVersion } : {}),
    platform,
    pushTokenRegistered: value.pushTokenRegistered === true,
    registeredAt: typeof value.registeredAt === "string" ? value.registeredAt : new Date(0).toISOString(),
    ...(typeof value.ownerIssuer === "string" ? { ownerIssuer: value.ownerIssuer } : {}),
    subjectId
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const createMobileDeviceTablesSql = `
CREATE TABLE IF NOT EXISTS cop_mobile_pairing_sessions (
  code text PRIMARY KEY,
  created_by_subject_id text NOT NULL,
  created_by_username text NOT NULL,
  created_by_display_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'claimed', 'confirmed', 'expired', 'revoked')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  claimed_by_subject_id text,
  claimed_by_username text,
  claimed_by_display_name text,
  claimed_device_id text,
  confirmed_at timestamptz,
  device_payload jsonb
);

CREATE INDEX IF NOT EXISTS cop_mobile_pairing_sessions_created_by_idx
  ON cop_mobile_pairing_sessions (created_by_subject_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cop_mobile_devices (
  subject_id text NOT NULL,
  device_id text NOT NULL,
  matrix_device_id text,
  platform text NOT NULL CHECK (platform IN ('ios', 'ipados')),
  app_version text NOT NULL,
  build_number text,
  device_model text,
  os_version text,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  push_token_registered boolean NOT NULL DEFAULT false,
  device_session_id text NOT NULL,
  pairing_code text,
  status text NOT NULL CHECK (status IN ('paired', 'revoked')),
  paired_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (subject_id, device_id)
);

CREATE INDEX IF NOT EXISTS cop_mobile_devices_subject_status_idx
  ON cop_mobile_devices (subject_id, status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS cop_mobile_mesh_acks (
  subject_id text NOT NULL,
  envelope_id text NOT NULL,
  device_id text,
  bundle_type text,
  status text NOT NULL CHECK (status IN ('accepted', 'duplicate', 'rejected', 'delivered', 'expired')),
  received_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz,
  payload_size_bytes integer,
  PRIMARY KEY (subject_id, envelope_id)
);

ALTER TABLE cop_mobile_devices ADD COLUMN IF NOT EXISTS owner_issuer text;
ALTER TABLE cop_mobile_mesh_acks ADD COLUMN IF NOT EXISTS owner_issuer text;
ALTER TABLE cop_mobile_pairing_sessions ADD COLUMN IF NOT EXISTS created_by_owner_issuer text;
ALTER TABLE cop_mobile_pairing_sessions ADD COLUMN IF NOT EXISTS claimed_by_owner_issuer text;

CREATE INDEX IF NOT EXISTS cop_mobile_mesh_acks_subject_updated_idx
  ON cop_mobile_mesh_acks (subject_id, updated_at DESC);
`;

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readSslConfig(env: Record<string, string | undefined>): PoolConfig["ssl"] {
  const mode = env.COP_DATABASE_SSL?.trim().toLowerCase();
  if (!mode || mode === "false" || mode === "0" || mode === "disable") {
    return undefined;
  }
  if (mode === "true" || mode === "1" || mode === "require") {
    return { rejectUnauthorized: env.COP_DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" };
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function mobileOwnerRows(client: Pick<PoolClient, "query">, subjectId: string) {
  const devices = await client.query<MobileDeviceRow>("SELECT * FROM cop_mobile_devices WHERE subject_id=$1 ORDER BY device_id", [subjectId]);
  const acks = await client.query<MobileMeshAckRow>("SELECT * FROM cop_mobile_mesh_acks WHERE subject_id=$1 ORDER BY envelope_id", [subjectId]);
  const pairings = await client.query<MobilePairingSessionRow>("SELECT * FROM cop_mobile_pairing_sessions WHERE created_by_subject_id=$1 OR claimed_by_subject_id=$1 OR device_payload->>'subjectId'=$1 ORDER BY code", [subjectId]);
  return { devices: devices.rows, acks: acks.rows, pairings: pairings.rows };
}
function mobileRowsAssessment(rows: Awaited<ReturnType<typeof mobileOwnerRows>>, owner: RuntimeOwner): RuntimeOwnerAssessment {
  const unresolved = [...rows.devices, ...rows.acks].some(row => row.owner_issuer !== owner.issuer) || rows.pairings.some(row =>
    (row.created_by_subject_id === owner.subjectId && row.created_by_owner_issuer !== owner.issuer) ||
    (row.claimed_by_subject_id === owner.subjectId && row.claimed_by_owner_issuer !== owner.issuer) ||
    (normalizeDevicePayload(row.device_payload)?.subjectId === owner.subjectId && normalizeDevicePayload(row.device_payload)?.ownerIssuer !== owner.issuer));
  return { ...runtimeAssessment([rows.devices, rows.acks, rows.pairings]), ready: !unresolved };
}
