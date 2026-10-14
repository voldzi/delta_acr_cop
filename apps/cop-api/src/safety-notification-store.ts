import { randomUUID } from "node:crypto";
import { type Pool as PgPool, type PoolConfig } from "pg";
import { createCopPgPool } from "./cop-pg-pool.js";
import { fenceProjectionResources, loadProjectionFences, projectionTransaction, resourceProjectionFenceTableSql, assertProjectionPayloadAllowed,
  projectionReferences, type ProjectionFenceSnapshot, type ProjectionReference, type ProjectionEraseContext, type ProjectionResources } from "./resource-projection-erasure.js";
import { MemoryRuntimeOwnerFences, requireRuntimeOwner, runtimeAssessment, runtimeOwnerHash, runtimeSubjectHash,
  type RuntimeOwner, type RuntimeOwnerAssessment } from "./runtime-owner-erasure.js";
import { resolveCopSessionDatabaseUrl } from "./cop-session-database.js";

export interface SafetyNotificationCooldown {
  key: string;
  durationMs: number;
}

export interface SafetyNotificationClaim {
  idempotencyKey: string;
  leaseToken: string;
}

/** Stores opaque deduplication keys only; never candidate bodies, areas or GPS. */
export interface SafetyNotificationStore {
  readonly name: string;
  projectionErasureReady?(): Promise<boolean>;
  loadProjectionFences?(): ReturnType<typeof loadProjectionFences>;
  preflightActorProjections?(owner: RuntimeOwner): Promise<RuntimeOwnerAssessment>;
  eraseResourceProjections?(resources: ProjectionResources, context: ProjectionEraseContext): Promise<boolean>;
  init(): Promise<void>;
  close(): Promise<void>;
  withWorkerLease<T>(operation: (leaseValid: () => boolean) => Promise<T>): Promise<T | undefined>;
  setWebDeviceEligibility(subjectId: string, deviceId: string, eligible: boolean, owner?: RuntimeOwner): Promise<void>;
  hasEligibleWebDevice(subjectId: string): Promise<boolean>;
  claim(idempotencyKey: string, expiresAt: Date, now: Date, leaseMs: number, cooldown?: SafetyNotificationCooldown, owner?: RuntimeOwner): Promise<SafetyNotificationClaim | null>;
  markAccepted(claim: SafetyNotificationClaim, notificationId: string, now: Date): Promise<void>;
  markRetry(claim: SafetyNotificationClaim, retryAt: Date, attempted?: boolean): Promise<void>;
}

export function createSafetyNotificationStoreFromEnv(env: Record<string, string | undefined> = process.env): SafetyNotificationStore {
  const mode = (env.COP_SAFETY_NOTIFICATION_STORE ?? "postgres").trim().toLowerCase();
  if (mode === "memory") {
    if (env.NODE_ENV === "production") throw new Error("Production safety notifications require a durable ledger.");
    return new InMemorySafetyNotificationStore();
  }
  const connectionString = env.COP_DATABASE_URL?.trim();
  if (mode !== "postgres" || !connectionString) {
    throw new Error("Automatic safety notifications require an explicit durable PostgreSQL store.");
  }
  const leaseConnectionString = resolveCopSessionDatabaseUrl(env, "COP_LEASE_DATABASE_URL");
  const sslMode = env.COP_DATABASE_SSL?.trim().toLowerCase();
  const config: PoolConfig = {
    connectionString,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: 3,
    ssl: ["true", "1", "require"].includes(sslMode ?? "") ? { rejectUnauthorized: env.COP_DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" } : false
  };
  return new PostgresSafetyNotificationStore(config, env.COP_LEASE_DATABASE_URL?.trim() ? { ...config, connectionString: leaseConnectionString } : undefined);
}

interface MemoryDelivery {
  accepted: boolean;
  attemptCount: number;
  expiresAt: number;
  leaseToken: string;
  nextAttemptAt: number;
  notificationId?: string;
  cooldownKey?: string;
  owner?: RuntimeOwner;
}

/** Isolated tests only: production must not silently replace its durable ledger. */
export class InMemorySafetyNotificationStore implements SafetyNotificationStore {
  readonly name = "memory";
  private leased = false;
  private readonly cooldowns = new Map<string, number>();
  private readonly webDevices = new Map<string, Map<string, boolean>>();
  private readonly deliveries = new Map<string, MemoryDelivery>();
  private readonly deviceOwners = new Map<string, RuntimeOwner | undefined>();
  private readonly ownerFences = new MemoryRuntimeOwnerFences();
  private projectionGuardAccepted = false;
  private readonly projectionResources = new Map<string, ProjectionReference>();
  private readonly projectionOwners = new Set<string>();
  private readonly projectionSubjects = new Set<string>();

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async projectionErasureReady(): Promise<boolean> { return true; }
  async loadProjectionFences(): Promise<ProjectionFenceSnapshot> {
    const value = { resources: [...this.projectionResources.values()], ownerHashes: [...this.projectionOwners], subjectHashes: [...this.projectionSubjects] };
    return { ...value, version: runtimeAssessment([value]).version };
  }
  async preflightActorProjections(owner: RuntimeOwner): Promise<RuntimeOwnerAssessment> {
    requireRuntimeOwner(owner);
    const devices = [...this.deviceOwners].filter(([key]) => JSON.parse(key)[0] === owner.subjectId);
    const deliveries = [...this.deliveries.values()].filter(item => !item.owner || item.owner.subjectId === owner.subjectId);
    const orphans = [...this.cooldowns.keys()].filter(key => ![...this.deliveries.values()].some(item => item.cooldownKey === key));
    return { ...runtimeAssessment([devices, deliveries, orphans]), ready: orphans.length === 0 && devices.every(([, value]) => value?.issuer === owner.issuer) && deliveries.every(item => item.owner?.issuer === owner.issuer) };
  }
  async eraseResourceProjections(resources: ProjectionResources, context: ProjectionEraseContext): Promise<boolean> {
    if (!context.actor) return false;
    const actor = context.actor; requireRuntimeOwner(actor); context.signal.throwIfAborted(); this.ownerFences.fence(actor); this.projectionGuardAccepted = true;
    this.projectionOwners.add(runtimeOwnerHash(actor)); this.projectionSubjects.add(runtimeSubjectHash(actor.subjectId));
    for (const ref of projectionReferences(resources)) this.projectionResources.set(`${ref.kind}:${ref.id}`, ref);
    const before = await this.preflightActorProjections(actor);
    if (!before.ready) return false;
    this.webDevices.delete(actor.subjectId);
    for (const [key, value] of this.deviceOwners) if (value?.subjectId === actor.subjectId && value.issuer === actor.issuer) this.deviceOwners.delete(key);
    const cooldowns = new Set<string>();
    for (const [key, value] of this.deliveries) if (value.owner?.issuer === actor.issuer && value.owner.subjectId === actor.subjectId) {
      if (value.cooldownKey) cooldowns.add(value.cooldownKey); this.deliveries.delete(key);
    }
    for (const key of cooldowns) if (![...this.deliveries.values()].some(value => value.cooldownKey === key)) this.cooldowns.delete(key);
    context.signal.throwIfAborted();
    return !this.webDevices.has(actor.subjectId) && ![...this.deliveries.values()].some(value => value.owner?.subjectId === actor.subjectId);
  }

  async withWorkerLease<T>(operation: (leaseValid: () => boolean) => Promise<T>): Promise<T | undefined> {
    if (this.leased) return undefined;
    this.leased = true;
    try { return await operation(() => this.leased); } finally { this.leased = false; }
  }

  async setWebDeviceEligibility(subjectId: string, deviceId: string, eligible: boolean, owner?: RuntimeOwner): Promise<void> {
    validateDeviceInput(subjectId, deviceId);
    if (this.projectionGuardAccepted && !owner) throw new Error("Unproven safety device owner");
    this.ownerFences.assertAllowed(subjectId);
    if (owner) { requireRuntimeOwner(owner); if (owner.subjectId !== subjectId) throw new Error("Unproven safety device owner"); }
    const key = JSON.stringify([subjectId, deviceId]);
    const existingOwner = this.deviceOwners.get(key);
    if (existingOwner && (existingOwner.issuer !== owner?.issuer || existingOwner.subjectId !== owner?.subjectId)) throw new Error("CONTENT_PROJECTION_OWNER_CONFLICT");
    if (!this.deviceOwners.has(key)) this.deviceOwners.set(key, owner ? { ...owner } : undefined);
    const devices = this.webDevices.get(subjectId) ?? new Map<string, boolean>();
    devices.set(deviceId, eligible);
    this.webDevices.set(subjectId, devices);
  }

  async hasEligibleWebDevice(subjectId: string): Promise<boolean> {
    return [...(this.webDevices.get(subjectId)?.values() ?? [])].some(Boolean);
  }

  async claim(idempotencyKey: string, expiresAt: Date, now: Date, leaseMs: number, cooldown?: SafetyNotificationCooldown, owner?: RuntimeOwner): Promise<SafetyNotificationClaim | null> {
    validateClaimInput(idempotencyKey, expiresAt, now, leaseMs);
    if (this.projectionGuardAccepted && !owner) throw new Error("Unproven safety recipient owner");
    if (owner) { requireRuntimeOwner(owner); this.ownerFences.assertAllowed(owner.subjectId); }
    validateCooldown(cooldown);
    if (cooldown && (this.cooldowns.get(cooldown.key) ?? 0) > now.getTime() - cooldown.durationMs) return null;
    const existing = this.deliveries.get(idempotencyKey);
    if (existing?.owner && (existing.owner.issuer !== owner?.issuer || existing.owner.subjectId !== owner?.subjectId)) throw new Error("CONTENT_PROJECTION_OWNER_CONFLICT");
    if (expiresAt.getTime() <= now.getTime() || (existing?.attemptCount ?? 0) >= 5 || existing?.accepted || (existing && existing.nextAttemptAt > now.getTime())) return null;
    if (!existing && this.deliveries.size >= 10000) throw new Error("Test safety notification ledger capacity exceeded.");
    const leaseToken = randomUUID();
    this.deliveries.set(idempotencyKey, { accepted: false, attemptCount: (existing?.attemptCount ?? 0) + 1, expiresAt: expiresAt.getTime(), leaseToken, nextAttemptAt: now.getTime() + leaseMs, ...(cooldown ? { cooldownKey: cooldown.key } : {}), ...(existing ? { owner: existing.owner } : owner ? { owner: { ...owner } } : {}) });
    return { idempotencyKey, leaseToken };
  }

  async markAccepted(claim: SafetyNotificationClaim, notificationId: string, now: Date): Promise<void> {
    const current = this.deliveries.get(claim.idempotencyKey);
    if (!current || current.leaseToken !== claim.leaseToken || current.accepted) throw new Error("Safety notification claim is no longer owned.");
    current.accepted = true;
    if (current.cooldownKey) this.cooldowns.set(current.cooldownKey, now.getTime());
    current.notificationId = notificationId;
    current.nextAttemptAt = now.getTime();
  }

  async markRetry(claim: SafetyNotificationClaim, retryAt: Date, attempted = true): Promise<void> {
    const current = this.deliveries.get(claim.idempotencyKey);
    if (!current || current.leaseToken !== claim.leaseToken || current.accepted) throw new Error("Safety notification claim is no longer owned.");
    current.nextAttemptAt = retryAt.getTime();
    if (!attempted) current.attemptCount = Math.max(0, current.attemptCount - 1);
  }
}

export class PostgresSafetyNotificationStore implements SafetyNotificationStore {
  readonly name = "postgres";
  private readonly pool: PgPool;
  private readonly leasePool: PgPool;

  constructor(config: PoolConfig, leaseConfig?: PoolConfig) {
    this.pool = createCopPgPool("safety-notification", { ...config, max: Math.max(2, config.max ?? 3) });
    // pg requires an idle error listener; callers observe active query failures.
    this.pool.on("error", () => {});
    this.leasePool = leaseConfig ? createCopPgPool("safety-notification-lease", { ...leaseConfig, max: 1 }) : this.pool;
  }

  async init(): Promise<void> { await this.pool.query(resourceProjectionFenceTableSql + createSafetyNotificationTableSql); }
  async close(): Promise<void> { await Promise.all(this.leasePool === this.pool ? [this.pool.end()] : [this.pool.end(), this.leasePool.end()]); }

  async projectionErasureReady(): Promise<boolean> {
    await this.pool.query("SELECT 1 FROM cop_content_projection_fences LIMIT 0; SELECT owner_issuer FROM cop_safety_notification_web_devices LIMIT 0; SELECT owner_issuer,owner_subject_hash FROM cop_safety_notification_deliveries LIMIT 0; SELECT cooldown_key FROM cop_safety_notification_cooldowns LIMIT 0");
    return true;
  }
  loadProjectionFences(): ReturnType<typeof loadProjectionFences> { return loadProjectionFences(this.pool); }
  async preflightActorProjections(owner: RuntimeOwner): Promise<RuntimeOwnerAssessment> {
    requireRuntimeOwner(owner);
    const devices = await this.pool.query<{ owner_issuer: string | null }>("SELECT owner_issuer FROM cop_safety_notification_web_devices WHERE subject_id=$1", [owner.subjectId]);
    const deliveries = await this.pool.query<{ owner_issuer: string | null; owner_subject_hash: string | null }>("SELECT owner_issuer,owner_subject_hash FROM cop_safety_notification_deliveries WHERE owner_subject_hash=$1 OR owner_subject_hash IS NULL LIMIT 10001", [runtimeSubjectHash(owner.subjectId)]);
    const orphans = await this.pool.query("SELECT cooldown_key FROM cop_safety_notification_cooldowns c WHERE NOT EXISTS(SELECT 1 FROM cop_safety_notification_deliveries d WHERE d.cooldown_key=c.cooldown_key) LIMIT 1");
    return { ...runtimeAssessment([devices.rows, deliveries.rows, orphans.rows]), ready: !orphans.rowCount && deliveries.rows.length <= 10000 && devices.rows.every(row => row.owner_issuer === owner.issuer) && deliveries.rows.every(row => row.owner_issuer === owner.issuer && row.owner_subject_hash === runtimeSubjectHash(owner.subjectId)) };
  }
  async eraseResourceProjections(resources: ProjectionResources, context: ProjectionEraseContext): Promise<boolean> {
    if (!context.actor) return false;
    const owner = context.actor;
    return projectionTransaction(this.pool, async client => {
      await fenceProjectionResources(client, resources, context);
      const unknown = await client.query("SELECT 1 FROM cop_safety_notification_web_devices WHERE subject_id=$1 AND owner_issuer IS DISTINCT FROM $2 UNION ALL SELECT 1 FROM cop_safety_notification_deliveries WHERE owner_subject_hash IS NULL OR (owner_subject_hash=$3 AND owner_issuer IS DISTINCT FROM $2) UNION ALL SELECT 1 FROM cop_safety_notification_cooldowns c WHERE NOT EXISTS(SELECT 1 FROM cop_safety_notification_deliveries d WHERE d.cooldown_key=c.cooldown_key) LIMIT 1", [owner.subjectId, owner.issuer, runtimeSubjectHash(owner.subjectId)]);
      if (unknown.rowCount) return false;
      await client.query("DELETE FROM cop_safety_notification_web_devices WHERE subject_id=$1 AND owner_issuer=$2", [owner.subjectId, owner.issuer]);
      const removed = await client.query<{ cooldown_key: string | null }>("DELETE FROM cop_safety_notification_deliveries WHERE owner_subject_hash=$1 AND owner_issuer=$2 RETURNING cooldown_key", [runtimeSubjectHash(owner.subjectId), owner.issuer]);
      for (const row of removed.rows) if (row.cooldown_key) await client.query("DELETE FROM cop_safety_notification_cooldowns WHERE cooldown_key=$1 AND NOT EXISTS(SELECT 1 FROM cop_safety_notification_deliveries WHERE cooldown_key=$1)", [row.cooldown_key]);
      const remaining = await client.query("SELECT 1 FROM cop_safety_notification_web_devices WHERE subject_id=$1 UNION ALL SELECT 1 FROM cop_safety_notification_deliveries WHERE owner_subject_hash=$2 LIMIT 1", [owner.subjectId, runtimeSubjectHash(owner.subjectId)]);
      context.signal.throwIfAborted(); return !remaining.rowCount;
    }, true);
  }

  async withWorkerLease<T>(operation: (leaseValid: () => boolean) => Promise<T>): Promise<T | undefined> {
    const client = await this.leasePool.connect();
    let leased = false;
    let leaseLost = false;
    const onError = (): void => { leaseLost = true; };
    client.on("error", onError);
    try {
      const result = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock(18101202, 1) AS acquired");
      leased = result.rows[0]?.acquired === true;
      if (!leased) return undefined;
      const value = await operation(() => leased && !leaseLost);
      if (leaseLost) throw new Error("Safety worker lease connection was lost.");
      return value;
    } finally {
      try {
        if (leased && !leaseLost) await client.query("SELECT pg_advisory_unlock(18101202, 1)");
      } catch (error) {
        leaseLost = true;
        throw error;
      } finally {
        client.off("error", onError);
        client.release(leaseLost);
      }
    }
  }

  async setWebDeviceEligibility(subjectId: string, deviceId: string, eligible: boolean, owner?: RuntimeOwner): Promise<void> {
    validateDeviceInput(subjectId, deviceId);
    if (owner) { requireRuntimeOwner(owner); if (owner.subjectId !== subjectId) throw new Error("Unproven safety device owner"); }
    return projectionTransaction(this.pool, async client => {
      if (!owner && (await client.query("SELECT 1 FROM cop_content_projection_fences LIMIT 1")).rowCount) throw new Error("Unproven safety device owner");
      await assertProjectionPayloadAllowed(client, { subjectId, deviceId }, owner);
      const existing = await client.query<{ owner_issuer: string | null }>("SELECT owner_issuer FROM cop_safety_notification_web_devices WHERE subject_id=$1 AND device_id=$2", [subjectId, deviceId]);
      if (existing.rows[0]?.owner_issuer && existing.rows[0].owner_issuer !== owner?.issuer) throw new Error("CONTENT_PROJECTION_OWNER_CONFLICT");
    await client.query(
      `INSERT INTO cop_safety_notification_web_devices (subject_id, device_id, eligible, owner_issuer)
       VALUES ($1, $2, $3, $4) ON CONFLICT (subject_id, device_id) DO UPDATE
       SET eligible = EXCLUDED.eligible, updated_at = now()`, [subjectId, deviceId, eligible, owner?.issuer ?? null]
    );
    });
  }

  async hasEligibleWebDevice(subjectId: string): Promise<boolean> {
    const result = await this.pool.query<{ eligible: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM cop_safety_notification_web_devices WHERE subject_id = $1 AND eligible = true) AS eligible`, [subjectId]
    );
    return result.rows[0]?.eligible === true;
  }

  async claim(idempotencyKey: string, expiresAt: Date, now: Date, leaseMs: number, cooldown?: SafetyNotificationCooldown, owner?: RuntimeOwner): Promise<SafetyNotificationClaim | null> {
    validateClaimInput(idempotencyKey, expiresAt, now, leaseMs);
    if (expiresAt.getTime() <= now.getTime()) return null;
    const leaseToken = randomUUID();
    validateCooldown(cooldown);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))", ["cop-content-projection-admission-v1"]);
      if (!owner && (await client.query("SELECT 1 FROM cop_content_projection_fences LIMIT 1")).rowCount) throw new Error("Unproven safety recipient owner");
      await assertProjectionPayloadAllowed(client, { idempotencyKey }, owner);
      const existing = await client.query<{ owner_issuer: string | null; owner_subject_hash: string | null }>("SELECT owner_issuer,owner_subject_hash FROM cop_safety_notification_deliveries WHERE idempotency_key=$1", [idempotencyKey]);
      if (existing.rows[0]?.owner_issuer && (existing.rows[0].owner_issuer !== owner?.issuer || existing.rows[0].owner_subject_hash !== (owner ? runtimeSubjectHash(owner.subjectId) : null))) throw new Error("CONTENT_PROJECTION_OWNER_CONFLICT");
      if (cooldown) {
        await client.query("SELECT pg_advisory_xact_lock(18101203, hashtext($1))", [cooldown.key]);
        const recent = await client.query<{ present: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM cop_safety_notification_cooldowns
           WHERE cooldown_key = $1 AND last_accepted_at > $2::timestamptz) AS present`,
          [cooldown.key, new Date(now.getTime() - cooldown.durationMs).toISOString()]
        );
        if (recent.rows[0]?.present === true) { await client.query("COMMIT"); return null; }
      }
      const result = await client.query<{ idempotency_key: string }>(
      `INSERT INTO cop_safety_notification_deliveries (idempotency_key, expires_at, lease_token, next_attempt_at, attempt_count, cooldown_key, owner_issuer, owner_subject_hash)
       VALUES ($1, $2::timestamptz, $3::uuid, $4::timestamptz, 1, $6, $7, $8)
       ON CONFLICT (idempotency_key) DO UPDATE SET
         lease_token = EXCLUDED.lease_token, next_attempt_at = EXCLUDED.next_attempt_at,
         attempt_count = cop_safety_notification_deliveries.attempt_count + 1, updated_at = now()
       WHERE cop_safety_notification_deliveries.accepted_at IS NULL
         AND cop_safety_notification_deliveries.attempt_count < 5
         AND cop_safety_notification_deliveries.next_attempt_at <= $5::timestamptz
         AND cop_safety_notification_deliveries.expires_at > $5::timestamptz
       RETURNING idempotency_key`,
      [idempotencyKey, expiresAt.toISOString(), leaseToken, new Date(now.getTime() + leaseMs).toISOString(), now.toISOString(), cooldown?.key ?? null, owner?.issuer ?? null, owner ? runtimeSubjectHash(owner.subjectId) : null]
    );
      await client.query("COMMIT");
      return result.rows[0] ? { idempotencyKey, leaseToken } : null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async markAccepted(claim: SafetyNotificationClaim, notificationId: string, now: Date): Promise<void> {
    return projectionTransaction(this.pool, async client => {
      const result = await client.query(
        `WITH accepted AS (
           UPDATE cop_safety_notification_deliveries SET accepted_at = $3::timestamptz,
           notification_id = $4, updated_at = now() WHERE idempotency_key = $1 AND lease_token = $2::uuid AND accepted_at IS NULL
           RETURNING cooldown_key
         ), cooldown_update AS (
           INSERT INTO cop_safety_notification_cooldowns (cooldown_key, last_accepted_at)
           SELECT cooldown_key, $3::timestamptz FROM accepted WHERE cooldown_key IS NOT NULL
           ON CONFLICT (cooldown_key) DO UPDATE SET last_accepted_at = EXCLUDED.last_accepted_at
         ) SELECT cooldown_key FROM accepted`,
        [claim.idempotencyKey, claim.leaseToken, now.toISOString(), notificationId]
      );
      if (result.rowCount !== 1) throw new Error("Safety notification claim is no longer owned.");
    });
  }

  async markRetry(claim: SafetyNotificationClaim, retryAt: Date, attempted = true): Promise<void> {
    return projectionTransaction(this.pool, async client => {
      const result = await client.query(
        `UPDATE cop_safety_notification_deliveries SET next_attempt_at = $3::timestamptz,
         attempt_count = CASE WHEN $4::boolean THEN attempt_count ELSE greatest(0, attempt_count - 1) END, updated_at = now()
         WHERE idempotency_key = $1 AND lease_token = $2::uuid AND accepted_at IS NULL`,
        [claim.idempotencyKey, claim.leaseToken, retryAt.toISOString(), attempted]
      );
      if (result.rowCount !== 1) throw new Error("Safety notification claim is no longer owned.");
    });
  }
}

export const createSafetyNotificationTableSql = `
CREATE TABLE IF NOT EXISTS cop_safety_notification_web_devices (
  subject_id text NOT NULL,
  device_id text NOT NULL,
  eligible boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_id, device_id)
);
CREATE INDEX IF NOT EXISTS cop_safety_notification_web_active_idx
  ON cop_safety_notification_web_devices (subject_id) WHERE eligible = true;
CREATE TABLE IF NOT EXISTS cop_safety_notification_cooldowns (
  cooldown_key text PRIMARY KEY,
  last_accepted_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS cop_safety_notification_deliveries (
  idempotency_key text PRIMARY KEY,
  cooldown_key text,
  expires_at timestamptz NOT NULL,
  lease_token uuid NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  accepted_at timestamptz,
  notification_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cop_safety_notification_web_devices ADD COLUMN IF NOT EXISTS owner_issuer text;
ALTER TABLE cop_safety_notification_deliveries ADD COLUMN IF NOT EXISTS owner_issuer text;
ALTER TABLE cop_safety_notification_deliveries ADD COLUMN IF NOT EXISTS owner_subject_hash text;
CREATE INDEX IF NOT EXISTS cop_safety_notification_owner_idx ON cop_safety_notification_deliveries(owner_subject_hash);
CREATE INDEX IF NOT EXISTS cop_safety_notification_retry_idx
  ON cop_safety_notification_deliveries (next_attempt_at) WHERE accepted_at IS NULL;
`;

function validateClaimInput(key: string, expiresAt: Date, now: Date, leaseMs: number): void {
  if (!/^cop\.safety:[a-f0-9]{64}$/u.test(key) || !Number.isFinite(expiresAt.getTime())
    || !Number.isFinite(now.getTime()) || !Number.isFinite(leaseMs) || leaseMs < 1000 || leaseMs > 600000) {
    throw new Error("Invalid safety notification claim.");
  }
}

function validateDeviceInput(subjectId: string, deviceId: string): void {
  if (!subjectId || subjectId.length > 256 || !/^[A-Za-z0-9._=-]{1,96}$/u.test(deviceId)) {
    throw new Error("Invalid authenticated safety notification device reference.");
  }
}

function validateCooldown(cooldown: SafetyNotificationCooldown | undefined): void {
  if (cooldown && (!/^cop\.safety\.cooldown:[a-f0-9]{64}$/u.test(cooldown.key)
    || !Number.isInteger(cooldown.durationMs) || cooldown.durationMs < 60000 || cooldown.durationMs > 86400000)) {
    throw new Error("Invalid safety notification cooldown.");
  }
}
