import { randomUUID } from "node:crypto";
import pg, { type Pool as PgPool, type PoolConfig } from "pg";

const { Pool } = pg;

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
  init(): Promise<void>;
  close(): Promise<void>;
  withWorkerLease<T>(operation: (leaseValid: () => boolean) => Promise<T>): Promise<T | undefined>;
  setWebDeviceEligibility(subjectId: string, deviceId: string, eligible: boolean): Promise<void>;
  hasEligibleWebDevice(subjectId: string): Promise<boolean>;
  claim(idempotencyKey: string, expiresAt: Date, now: Date, leaseMs: number, cooldown?: SafetyNotificationCooldown): Promise<SafetyNotificationClaim | null>;
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
  const sslMode = env.COP_DATABASE_SSL?.trim().toLowerCase();
  return new PostgresSafetyNotificationStore({
    connectionString,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: 3,
    ssl: ["true", "1", "require"].includes(sslMode ?? "") ? { rejectUnauthorized: env.COP_DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" } : false
  });
}

interface MemoryDelivery {
  accepted: boolean;
  attemptCount: number;
  expiresAt: number;
  leaseToken: string;
  nextAttemptAt: number;
  notificationId?: string;
  cooldownKey?: string;
}

/** Isolated tests only: production must not silently replace its durable ledger. */
export class InMemorySafetyNotificationStore implements SafetyNotificationStore {
  readonly name = "memory";
  private leased = false;
  private readonly cooldowns = new Map<string, number>();
  private readonly webDevices = new Map<string, Map<string, boolean>>();
  private readonly deliveries = new Map<string, MemoryDelivery>();

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async withWorkerLease<T>(operation: (leaseValid: () => boolean) => Promise<T>): Promise<T | undefined> {
    if (this.leased) return undefined;
    this.leased = true;
    try { return await operation(() => this.leased); } finally { this.leased = false; }
  }

  async setWebDeviceEligibility(subjectId: string, deviceId: string, eligible: boolean): Promise<void> {
    validateDeviceInput(subjectId, deviceId);
    const devices = this.webDevices.get(subjectId) ?? new Map<string, boolean>();
    devices.set(deviceId, eligible);
    this.webDevices.set(subjectId, devices);
  }

  async hasEligibleWebDevice(subjectId: string): Promise<boolean> {
    return [...(this.webDevices.get(subjectId)?.values() ?? [])].some(Boolean);
  }

  async claim(idempotencyKey: string, expiresAt: Date, now: Date, leaseMs: number, cooldown?: SafetyNotificationCooldown): Promise<SafetyNotificationClaim | null> {
    validateClaimInput(idempotencyKey, expiresAt, now, leaseMs);
    validateCooldown(cooldown);
    if (cooldown && (this.cooldowns.get(cooldown.key) ?? 0) > now.getTime() - cooldown.durationMs) return null;
    const existing = this.deliveries.get(idempotencyKey);
    if (expiresAt.getTime() <= now.getTime() || (existing?.attemptCount ?? 0) >= 5 || existing?.accepted || (existing && existing.nextAttemptAt > now.getTime())) return null;
    if (!existing && this.deliveries.size >= 10000) throw new Error("Test safety notification ledger capacity exceeded.");
    const leaseToken = randomUUID();
    this.deliveries.set(idempotencyKey, { accepted: false, attemptCount: (existing?.attemptCount ?? 0) + 1, expiresAt: expiresAt.getTime(), leaseToken, nextAttemptAt: now.getTime() + leaseMs, ...(cooldown ? { cooldownKey: cooldown.key } : {}) });
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

  constructor(config: PoolConfig) {
    this.pool = new Pool({ ...config, max: Math.max(2, config.max ?? 3) });
    // pg requires an idle error listener; callers observe active query failures.
    this.pool.on("error", () => {});
  }

  async init(): Promise<void> { await this.pool.query(createSafetyNotificationTableSql); }
  async close(): Promise<void> { await this.pool.end(); }

  async withWorkerLease<T>(operation: (leaseValid: () => boolean) => Promise<T>): Promise<T | undefined> {
    const client = await this.pool.connect();
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

  async setWebDeviceEligibility(subjectId: string, deviceId: string, eligible: boolean): Promise<void> {
    validateDeviceInput(subjectId, deviceId);
    await this.pool.query(
      `INSERT INTO cop_safety_notification_web_devices (subject_id, device_id, eligible)
       VALUES ($1, $2, $3) ON CONFLICT (subject_id, device_id) DO UPDATE
       SET eligible = EXCLUDED.eligible, updated_at = now()`, [subjectId, deviceId, eligible]
    );
  }

  async hasEligibleWebDevice(subjectId: string): Promise<boolean> {
    const result = await this.pool.query<{ eligible: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM cop_safety_notification_web_devices WHERE subject_id = $1 AND eligible = true) AS eligible`, [subjectId]
    );
    return result.rows[0]?.eligible === true;
  }

  async claim(idempotencyKey: string, expiresAt: Date, now: Date, leaseMs: number, cooldown?: SafetyNotificationCooldown): Promise<SafetyNotificationClaim | null> {
    validateClaimInput(idempotencyKey, expiresAt, now, leaseMs);
    if (expiresAt.getTime() <= now.getTime()) return null;
    const leaseToken = randomUUID();
    validateCooldown(cooldown);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
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
      `INSERT INTO cop_safety_notification_deliveries (idempotency_key, expires_at, lease_token, next_attempt_at, attempt_count, cooldown_key)
       VALUES ($1, $2::timestamptz, $3::uuid, $4::timestamptz, 1, $6)
       ON CONFLICT (idempotency_key) DO UPDATE SET
         lease_token = EXCLUDED.lease_token, next_attempt_at = EXCLUDED.next_attempt_at,
         attempt_count = cop_safety_notification_deliveries.attempt_count + 1, updated_at = now()
       WHERE cop_safety_notification_deliveries.accepted_at IS NULL
         AND cop_safety_notification_deliveries.attempt_count < 5
         AND cop_safety_notification_deliveries.next_attempt_at <= $5::timestamptz
         AND cop_safety_notification_deliveries.expires_at > $5::timestamptz
       RETURNING idempotency_key`,
      [idempotencyKey, expiresAt.toISOString(), leaseToken, new Date(now.getTime() + leaseMs).toISOString(), now.toISOString(), cooldown?.key ?? null]
    );
      await client.query("COMMIT");
      return result.rows[0] ? { idempotencyKey, leaseToken } : null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async markAccepted(claim: SafetyNotificationClaim, notificationId: string, now: Date): Promise<void> {
    const result = await this.pool.query(
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
  }

  async markRetry(claim: SafetyNotificationClaim, retryAt: Date, attempted = true): Promise<void> {
    const result = await this.pool.query(
      `UPDATE cop_safety_notification_deliveries SET next_attempt_at = $3::timestamptz,
       attempt_count = CASE WHEN $4::boolean THEN attempt_count ELSE greatest(0, attempt_count - 1) END, updated_at = now()
       WHERE idempotency_key = $1 AND lease_token = $2::uuid AND accepted_at IS NULL`,
      [claim.idempotencyKey, claim.leaseToken, retryAt.toISOString(), attempted]
    );
    if (result.rowCount !== 1) throw new Error("Safety notification claim is no longer owned.");
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
