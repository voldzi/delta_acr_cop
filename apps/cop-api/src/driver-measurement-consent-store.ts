import { createHash } from "node:crypto";
import pg, { type Pool as PgPool } from "pg";
import { deletionDays, type DriverConsent } from "./driver-measurement-contract.js";

const { Pool } = pg;

export interface DriverMeasurementConsentStore {
  init(secret: string): Promise<void>;
  close(): Promise<void>;
  get(subjectId: string): Promise<DriverConsent>;
  grant(subjectId: string, now: Date): Promise<DriverConsent | null>;
  revoke(subjectId: string, now: Date): Promise<DriverConsent>;
  markDeleted(subjectId: string, day: string): Promise<void>;
  pending(): Promise<Array<{ subjectId: string; days: string[] }>>;
  withActive<T>(subjectId: string, operation: (consent: DriverConsent) => Promise<T>): Promise<T | null>;
}

const emptyConsent = (): DriverConsent => ({ grantedAt: null, lastRevokedDay: null, pendingDays: [], revokedAt: null });

export class InMemoryDriverMeasurementConsentStore implements DriverMeasurementConsentStore {
  private readonly records = new Map<string, DriverConsent>();
  private readonly tails = new Map<string, Promise<void>>();
  async init(_secret: string): Promise<void> {}
  async close(): Promise<void> {}
  async get(subjectId: string): Promise<DriverConsent> { return { ...(this.records.get(subjectId) ?? emptyConsent()) }; }
  private async locked<T>(subjectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(subjectId) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => { release = resolve; });
    this.tails.set(subjectId, tail);
    await previous;
    try { return await operation(); }
    finally { release(); if (this.tails.get(subjectId) === tail) this.tails.delete(subjectId); }
  }
  async grant(subjectId: string, now: Date): Promise<DriverConsent | null> {
    return this.locked(subjectId, async () => {
      const current = await this.get(subjectId);
      const day = now.toISOString().slice(0, 10);
      if (current.pendingDays.length || current.lastRevokedDay === day) return null;
      if (current.grantedAt && !current.revokedAt) return current;
      const next = { ...current, grantedAt: now.toISOString(), revokedAt: null };
      this.records.set(subjectId, next);
      return next;
    });
  }
  async revoke(subjectId: string, now: Date): Promise<DriverConsent> {
    return this.locked(subjectId, async () => {
      const current = await this.get(subjectId);
      if (!current.grantedAt || current.revokedAt) return current;
      const next = {
        ...current,
        revokedAt: now.toISOString(),
        lastRevokedDay: now.toISOString().slice(0, 10),
        pendingDays: deletionDays(now)
      };
      this.records.set(subjectId, next);
      return next;
    });
  }
  async markDeleted(subjectId: string, day: string): Promise<void> {
    await this.locked(subjectId, async () => {
      const current = await this.get(subjectId);
      this.records.set(subjectId, { ...current, pendingDays: current.pendingDays.filter((entry) => entry !== day) });
    });
  }
  async pending(): Promise<Array<{ subjectId: string; days: string[] }>> {
    return [...this.records].filter(([, record]) => record.pendingDays.length)
      .map(([subjectId, record]) => ({ subjectId, days: [...record.pendingDays] }));
  }
  async withActive<T>(subjectId: string, operation: (consent: DriverConsent) => Promise<T>): Promise<T | null> {
    return this.locked(subjectId, async () => {
      const consent = await this.get(subjectId);
      return consent.grantedAt && !consent.revokedAt ? operation(consent) : null;
    });
  }
}

interface ConsentRow { granted_at: Date | null; last_revoked_day: string | null; pending_days: string[]; revoked_at: Date | null }
function fromRow(row?: ConsentRow): DriverConsent {
  return row ? {
    grantedAt: row.granted_at?.toISOString() ?? null,
    lastRevokedDay: row.last_revoked_day,
    pendingDays: row.pending_days,
    revokedAt: row.revoked_at?.toISOString() ?? null
  } : emptyConsent();
}

export class PostgresDriverMeasurementConsentStore implements DriverMeasurementConsentStore {
  private readonly pool: PgPool;
  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000,
      statement_timeout: 15_000, query_timeout: 20_000 });
  }
  async init(secret: string): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS cop_driver_measurement_config (
      id boolean PRIMARY KEY DEFAULT true CHECK (id), secret_fingerprint text NOT NULL);
      CREATE TABLE IF NOT EXISTS cop_driver_measurement_consents (
      subject_id text PRIMARY KEY, granted_at timestamptz, revoked_at timestamptz,
      last_revoked_day text, pending_days text[] NOT NULL DEFAULT '{}');`);
    const fingerprint = createHash("sha256").update("cop-driver-secret-v1\0").update(secret).digest("hex");
    await this.pool.query(`INSERT INTO cop_driver_measurement_config (id, secret_fingerprint)
      VALUES (true, $1) ON CONFLICT (id) DO NOTHING`, [fingerprint]);
    const result = await this.pool.query<{ secret_fingerprint: string }>(
      "SELECT secret_fingerprint FROM cop_driver_measurement_config WHERE id = true");
    if (result.rows[0]?.secret_fingerprint !== fingerprint) throw new Error("Driver measurement HMAC secret changed; retained revocations cannot be derived.");
  }
  async close(): Promise<void> { await this.pool.end(); }
  async get(subjectId: string): Promise<DriverConsent> {
    const result = await this.pool.query<ConsentRow>(
      "SELECT granted_at, revoked_at, last_revoked_day, pending_days FROM cop_driver_measurement_consents WHERE subject_id=$1", [subjectId]);
    return fromRow(result.rows[0]);
  }
  private async transaction<T>(subjectId: string, operation: (client: pg.PoolClient, current: DriverConsent) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '12s'");
      await client.query("INSERT INTO cop_driver_measurement_consents (subject_id) VALUES ($1) ON CONFLICT DO NOTHING", [subjectId]);
      const result = await client.query<ConsentRow>(
        "SELECT granted_at, revoked_at, last_revoked_day, pending_days FROM cop_driver_measurement_consents WHERE subject_id=$1 FOR UPDATE", [subjectId]);
      const value = await operation(client, fromRow(result.rows[0]));
      await client.query("COMMIT");
      return value;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async grant(subjectId: string, now: Date): Promise<DriverConsent | null> {
    return this.transaction(subjectId, async (client, current) => {
      if (current.pendingDays.length || current.lastRevokedDay === now.toISOString().slice(0, 10)) return null;
      if (current.grantedAt && !current.revokedAt) return current;
      await client.query("UPDATE cop_driver_measurement_consents SET granted_at=$2, revoked_at=NULL WHERE subject_id=$1", [subjectId, now]);
      return { ...current, grantedAt: now.toISOString(), revokedAt: null };
    });
  }
  async revoke(subjectId: string, now: Date): Promise<DriverConsent> {
    return this.transaction(subjectId, async (client, current) => {
      if (!current.grantedAt || current.revokedAt) return current;
      const days = deletionDays(now);
      await client.query(`UPDATE cop_driver_measurement_consents
        SET revoked_at=$2, last_revoked_day=$3, pending_days=$4 WHERE subject_id=$1`,
      [subjectId, now, now.toISOString().slice(0, 10), days]);
      return { ...current, revokedAt: now.toISOString(), lastRevokedDay: now.toISOString().slice(0, 10), pendingDays: days };
    });
  }
  async markDeleted(subjectId: string, day: string): Promise<void> {
    await this.pool.query("UPDATE cop_driver_measurement_consents SET pending_days=array_remove(pending_days,$2) WHERE subject_id=$1", [subjectId, day]);
  }
  async pending(): Promise<Array<{ subjectId: string; days: string[] }>> {
    const result = await this.pool.query<{ subject_id: string; pending_days: string[] }>(
      "SELECT subject_id, pending_days FROM cop_driver_measurement_consents WHERE cardinality(pending_days)>0 ORDER BY revoked_at ASC");
    return result.rows.map((row) => ({ subjectId: row.subject_id, days: row.pending_days }));
  }
  async withActive<T>(subjectId: string, operation: (consent: DriverConsent) => Promise<T>): Promise<T | null> {
    return this.transaction(subjectId, async (_client, consent) =>
      consent.grantedAt && !consent.revokedAt ? operation(consent) : null);
  }
}
