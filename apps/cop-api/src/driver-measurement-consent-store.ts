import { createHash, createHmac } from "node:crypto";
import pg, { type Pool as PgPool, type PoolConfig } from "pg";
import { createCopPgPool } from "./cop-pg-pool.js";
import { readCopDatabasePoolMode, resolveCopSessionDatabaseUrl } from "./cop-session-database.js";
import { deletionDays, type DriverConsent } from "./driver-measurement-contract.js";

export interface DriverConsentOwner { issuer: string; subjectId: string }
export interface DriverConsentErasureAssessment { ready: boolean; version: string; present: boolean; pendingDays: string[] }
export interface DriverConsentErasureCheckpoint { operationId: string; inventoryVersion: string; ownerIssuer: string; pendingDays: string[]; completed: boolean; remoteProofId?: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const proof = /^[A-Za-z0-9_-]{8,128}$/u;
function requireOwner(owner: DriverConsentOwner, subjectId = owner.subjectId): void {
  if (!owner.issuer || !owner.subjectId || owner.subjectId !== subjectId || /[\u0000-\u001f\u007f]/u.test(owner.subjectId + owner.issuer)) throw new Error("DRIVER_CONSENT_OWNER_UNPROVEN");
}
function requireOperation(operationId: string, inventoryVersion?: string): void {
  if (!uuid.test(operationId) || inventoryVersion !== undefined && !proof.test(inventoryVersion)) throw new Error("DRIVER_CONSENT_ERASURE_UNPROVEN");
}
const version = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function subjectFence(secret: string, subjectId: string): string {
  if (secret.length < 32) throw new Error("DRIVER_CONSENT_ERASURE_UNAVAILABLE");
  return createHmac("sha256", secret).update("cop-driver-consent-erasure-v1\0").update(subjectId).digest("hex");
}

export interface DriverMeasurementConsentStore {
  init(secret: string): Promise<void>;
  close(): Promise<void>;
  get(subjectId: string): Promise<DriverConsent>;
  grant(subjectId: string, now: Date, owner?: DriverConsentOwner): Promise<DriverConsent | null>;
  revoke(subjectId: string, now: Date, owner?: DriverConsentOwner): Promise<DriverConsent>;
  markDeleted(subjectId: string, day: string): Promise<void>;
  pending(): Promise<Array<{ subjectId: string; days: string[] }>>;
  /** Checks the durable fence and pending day under the writer lock before any
   * remote handoff, waits for its local terminal result, then settles this day. */
  withPendingDeletion?(subjectId: string, day: string, operation: () => Promise<void>): Promise<boolean>;
  withActive<T>(subjectId: string, operation: (consent: DriverConsent) => Promise<T>, owner?: DriverConsentOwner): Promise<T | null>;
  erasureReady?(): Promise<boolean>;
  preflightActorErasure?(owner: DriverConsentOwner): Promise<DriverConsentErasureAssessment>;
  erasureCheckpoint?(owner: DriverConsentOwner, operationId: string): Promise<DriverConsentErasureCheckpoint | null>;
  fenceActorErasure?(owner: DriverConsentOwner, operationId: string, inventoryVersion: string, expectedLocalVersion: string): Promise<boolean>;
  purgeActorErasure?(owner: DriverConsentOwner, operationId: string, remoteProofId: string): Promise<boolean>;
}

export function createDriverMeasurementConsentStoreFromEnv(
  env: Record<string, string | undefined> = process.env
): PostgresDriverMeasurementConsentStore {
  if (!env.COP_DATABASE_URL?.trim()) throw new Error("Driver measurement COP adapter requires COP_DATABASE_URL.");
  // This store retains its startup statement timeout. In transaction mode its
  // entire pool therefore uses the validated direct/session route, never the
  // business broker. Preserve the exact original main DSN in other modes.
  const connectionString = readCopDatabasePoolMode(env) === "transaction"
    ? resolveCopSessionDatabaseUrl(env, "COP_LEASE_DATABASE_URL")
    : env.COP_DATABASE_URL;
  if (!connectionString?.trim()) throw new Error("Driver measurement COP adapter requires COP_DATABASE_URL.");
  return new PostgresDriverMeasurementConsentStore(connectionString);
}

const emptyConsent = (): DriverConsent => ({ grantedAt: null, lastRevokedDay: null, pendingDays: [], revokedAt: null });

export class InMemoryDriverMeasurementConsentStore implements DriverMeasurementConsentStore {
  private readonly records = new Map<string, DriverConsent>();
  private readonly issuers = new Map<string, string | undefined>();
  private readonly erasures = new Map<string, DriverConsentErasureCheckpoint>();
  private secret = "";
  private readonly tails = new Map<string, Promise<void>>();
  async init(secret: string): Promise<void> {
    if (this.secret && this.secret !== secret) throw new Error("Driver measurement HMAC secret changed; retained revocations cannot be derived.");
    this.secret = secret;
  }
  private assertWritable(subjectId: string, owner?: DriverConsentOwner): void {
    if (owner) requireOwner(owner, subjectId);
    if (this.secret && this.erasures.has(subjectFence(this.secret, subjectId))) throw new Error("DRIVER_CONSENT_ACCOUNT_ERASURE_FENCED");
    if (owner && this.issuers.get(subjectId) && this.issuers.get(subjectId) !== owner.issuer) throw new Error("DRIVER_CONSENT_OWNER_UNPROVEN");
  }
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
  async grant(subjectId: string, now: Date, owner?: DriverConsentOwner): Promise<DriverConsent | null> {
    return this.locked(subjectId, async () => {
      this.assertWritable(subjectId, owner);
      const current = await this.get(subjectId);
      const day = now.toISOString().slice(0, 10);
      if (current.pendingDays.length || current.lastRevokedDay === day) return null;
      if (current.grantedAt && !current.revokedAt) return current;
      const next = { ...current, grantedAt: now.toISOString(), revokedAt: null };
      if (!this.records.has(subjectId)) this.issuers.set(subjectId, owner?.issuer);
      this.records.set(subjectId, next);
      return next;
    });
  }
  async revoke(subjectId: string, now: Date, owner?: DriverConsentOwner): Promise<DriverConsent> {
    return this.locked(subjectId, async () => {
      this.assertWritable(subjectId, owner);
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
      this.assertWritable(subjectId);
      const current = await this.get(subjectId);
      this.records.set(subjectId, { ...current, pendingDays: current.pendingDays.filter((entry) => entry !== day) });
    });
  }
  async pending(): Promise<Array<{ subjectId: string; days: string[] }>> {
    return [...this.records].filter(([subjectId, record]) => record.pendingDays.length && (!this.secret || !this.erasures.has(subjectFence(this.secret, subjectId))))
      .map(([subjectId, record]) => ({ subjectId, days: [...record.pendingDays] }));
  }
  async withPendingDeletion(subjectId: string, day: string, operation: () => Promise<void>): Promise<boolean> {
    return this.locked(subjectId, async () => {
      if (this.secret && this.erasures.has(subjectFence(this.secret, subjectId))) return false;
      const consent = this.records.get(subjectId);
      if (!consent?.pendingDays.includes(day)) return false;
      await operation();
      this.records.set(subjectId, { ...consent, pendingDays: consent.pendingDays.filter(value => value !== day) });
      return true;
    });
  }
  async withActive<T>(subjectId: string, operation: (consent: DriverConsent) => Promise<T>, owner?: DriverConsentOwner): Promise<T | null> {
    return this.locked(subjectId, async () => {
      this.assertWritable(subjectId, owner);
      const consent = await this.get(subjectId);
      return consent.grantedAt && !consent.revokedAt ? operation(consent) : null;
    });
  }
  async erasureReady(): Promise<boolean> { return this.secret.length >= 32; }
  async preflightActorErasure(owner: DriverConsentOwner): Promise<DriverConsentErasureAssessment> {
    requireOwner(owner); subjectFence(this.secret, owner.subjectId);
    return this.locked(owner.subjectId, async () => {
      const consent = this.records.get(owner.subjectId), issuer = this.issuers.get(owner.subjectId);
      return { ready: !consent || issuer === owner.issuer, present: !!consent, pendingDays: [...(consent?.pendingDays ?? [])], version: version([consent ?? null, issuer ?? null]) };
    });
  }
  async erasureCheckpoint(owner: DriverConsentOwner, operationId: string): Promise<DriverConsentErasureCheckpoint | null> {
    requireOwner(owner); requireOperation(operationId);
    const checkpoint = this.erasures.get(subjectFence(this.secret, owner.subjectId));
    if (checkpoint && (checkpoint.operationId !== operationId.toLowerCase() || checkpoint.ownerIssuer !== owner.issuer)) throw new Error("DRIVER_CONSENT_ERASURE_CONFLICT");
    return checkpoint ? { ...checkpoint, pendingDays: [...checkpoint.pendingDays] } : null;
  }
  async fenceActorErasure(owner: DriverConsentOwner, operationId: string, inventoryVersion: string, expectedLocalVersion: string): Promise<boolean> {
    requireOwner(owner); requireOperation(operationId, inventoryVersion);
    return this.locked(owner.subjectId, async () => {
      const key = subjectFence(this.secret, owner.subjectId), previous = await this.erasureCheckpoint(owner, operationId);
      if (previous) return true;
      if (this.records.has(owner.subjectId) && this.issuers.get(owner.subjectId) !== owner.issuer) return false;
      if (version([this.records.get(owner.subjectId) ?? null, this.issuers.get(owner.subjectId) ?? null]) !== expectedLocalVersion) return false;
      this.erasures.set(key, { operationId: operationId.toLowerCase(), ownerIssuer: owner.issuer, inventoryVersion,
        pendingDays: [...(this.records.get(owner.subjectId)?.pendingDays ?? [])], completed: false });
      return true;
    });
  }
  async purgeActorErasure(owner: DriverConsentOwner, operationId: string, remoteProofId: string): Promise<boolean> {
    requireOwner(owner); requireOperation(operationId, remoteProofId);
    return this.locked(owner.subjectId, async () => {
      const checkpoint = await this.erasureCheckpoint(owner, operationId);
      if (!checkpoint || this.records.has(owner.subjectId) && this.issuers.get(owner.subjectId) !== owner.issuer) return false;
      if (checkpoint.remoteProofId && checkpoint.remoteProofId !== remoteProofId) return false;
      this.records.delete(owner.subjectId); this.issuers.delete(owner.subjectId);
      this.erasures.set(subjectFence(this.secret, owner.subjectId), { ...checkpoint, pendingDays: [], completed: true, remoteProofId });
      return !this.records.has(owner.subjectId);
    });
  }
}

interface ConsentRow { granted_at: Date | null; last_revoked_day: string | null; pending_days: string[]; revoked_at: Date | null; owner_issuer?: string | null }
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
  private secret = "";
  constructor(connection: string | PoolConfig) {
    this.pool = createCopPgPool("driver-consent", { max: 5, connectionTimeoutMillis: 5000,
      statement_timeout: 15_000, query_timeout: 20_000,
      ...(typeof connection === "string" ? { connectionString: connection } : connection) });
  }
  async init(secret: string): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS cop_driver_measurement_config (
      id boolean PRIMARY KEY DEFAULT true CHECK (id), secret_fingerprint text NOT NULL);
      CREATE TABLE IF NOT EXISTS cop_driver_measurement_consents (
      subject_id text PRIMARY KEY, granted_at timestamptz, revoked_at timestamptz,
      last_revoked_day text, pending_days text[] NOT NULL DEFAULT '{}', owner_issuer text);
      ALTER TABLE cop_driver_measurement_consents ADD COLUMN IF NOT EXISTS owner_issuer text;
      CREATE TABLE IF NOT EXISTS cop_driver_consent_erasure_fences (
        subject_hash text PRIMARY KEY, owner_issuer text NOT NULL, operation_id uuid NOT NULL,
        inventory_version text NOT NULL, pending_days text[] NOT NULL, completed boolean NOT NULL DEFAULT false, remote_proof_id text);`);
    const fingerprint = createHash("sha256").update("cop-driver-secret-v1\0").update(secret).digest("hex");
    await this.pool.query(`INSERT INTO cop_driver_measurement_config (id, secret_fingerprint)
      VALUES (true, $1) ON CONFLICT (id) DO NOTHING`, [fingerprint]);
    const result = await this.pool.query<{ secret_fingerprint: string }>(
      "SELECT secret_fingerprint FROM cop_driver_measurement_config WHERE id = true");
    if (result.rows[0]?.secret_fingerprint !== fingerprint) throw new Error("Driver measurement HMAC secret changed; retained revocations cannot be derived.");
    this.secret = secret;
  }
  async close(): Promise<void> { await this.pool.end(); }
  async get(subjectId: string): Promise<DriverConsent> {
    const result = await this.pool.query<ConsentRow>(
      "SELECT granted_at, revoked_at, last_revoked_day, pending_days FROM cop_driver_measurement_consents WHERE subject_id=$1", [subjectId]);
    return fromRow(result.rows[0]);
  }
  private async transaction<T>(subjectId: string, operation: (client: pg.PoolClient, current: DriverConsent) => Promise<T>, owner?: DriverConsentOwner, createMissing = true): Promise<T> {
    if (owner) requireOwner(owner, subjectId);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '12s'");
      await client.query("SELECT pg_advisory_xact_lock(18101401, hashtext($1))", [subjectId]);
      const fenced = await client.query("SELECT 1 FROM cop_driver_consent_erasure_fences WHERE subject_hash=$1", [subjectFence(this.secret, subjectId)]);
      if (fenced.rows.length) throw new Error("DRIVER_CONSENT_ACCOUNT_ERASURE_FENCED");
      if (createMissing) await client.query("INSERT INTO cop_driver_measurement_consents (subject_id,owner_issuer) VALUES ($1,$2) ON CONFLICT DO NOTHING", [subjectId, owner?.issuer ?? null]);
      const result = await client.query<ConsentRow>(
        "SELECT granted_at, revoked_at, last_revoked_day, pending_days, owner_issuer FROM cop_driver_measurement_consents WHERE subject_id=$1 FOR UPDATE", [subjectId]);
      if (owner && result.rows[0]?.owner_issuer && result.rows[0].owner_issuer !== owner.issuer) throw new Error("DRIVER_CONSENT_OWNER_UNPROVEN");
      const value = await operation(client, fromRow(result.rows[0]));
      await client.query("COMMIT");
      return value;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async grant(subjectId: string, now: Date, owner?: DriverConsentOwner): Promise<DriverConsent | null> {
    return this.transaction(subjectId, async (client, current) => {
      if (current.pendingDays.length || current.lastRevokedDay === now.toISOString().slice(0, 10)) return null;
      if (current.grantedAt && !current.revokedAt) return current;
      await client.query("UPDATE cop_driver_measurement_consents SET granted_at=$2, revoked_at=NULL WHERE subject_id=$1", [subjectId, now]);
      return { ...current, grantedAt: now.toISOString(), revokedAt: null };
    }, owner);
  }
  async revoke(subjectId: string, now: Date, owner?: DriverConsentOwner): Promise<DriverConsent> {
    return this.transaction(subjectId, async (client, current) => {
      if (!current.grantedAt || current.revokedAt) return current;
      const days = deletionDays(now);
      await client.query(`UPDATE cop_driver_measurement_consents
        SET revoked_at=$2, last_revoked_day=$3, pending_days=$4 WHERE subject_id=$1`,
      [subjectId, now, now.toISOString().slice(0, 10), days]);
      return { ...current, revokedAt: now.toISOString(), lastRevokedDay: now.toISOString().slice(0, 10), pendingDays: days };
    }, owner);
  }
  async markDeleted(subjectId: string, day: string): Promise<void> {
    await this.transaction(subjectId, async client => {
      await client.query("UPDATE cop_driver_measurement_consents SET pending_days=array_remove(pending_days,$2) WHERE subject_id=$1", [subjectId, day]);
    }, undefined, false);
  }
  async pending(): Promise<Array<{ subjectId: string; days: string[] }>> {
    // SQL cannot derive the keyed subject hash; the private local result is
    // filtered before it can be used for handoff, and every stale snapshot is
    // checked again by withPendingDeletion under the same subject lock.
    const result = await this.pool.query<{ subject_id: string; pending_days: string[] }>(
      "SELECT subject_id, pending_days FROM cop_driver_measurement_consents WHERE cardinality(pending_days)>0 ORDER BY revoked_at ASC");
    const denied = new Set<string>();
    for (let index = 0; index < result.rows.length; index += 256) {
      const hashes = result.rows.slice(index, index + 256).map(row => subjectFence(this.secret, row.subject_id));
      const fences = await this.pool.query<{ subject_hash: string }>("SELECT subject_hash FROM cop_driver_consent_erasure_fences WHERE subject_hash=ANY($1::text[])", [hashes]);
      for (const fence of fences.rows) denied.add(fence.subject_hash);
    }
    return result.rows.filter(row => !denied.has(subjectFence(this.secret, row.subject_id))).map((row) => ({ subjectId: row.subject_id, days: row.pending_days }));
  }
  async withPendingDeletion(subjectId: string, day: string, operation: () => Promise<void>): Promise<boolean> {
    return this.transaction(subjectId, async (client, consent) => {
      if (!consent.pendingDays.includes(day)) return false;
      await operation();
      await client.query("UPDATE cop_driver_measurement_consents SET pending_days=array_remove(pending_days,$2) WHERE subject_id=$1", [subjectId, day]);
      return true;
    }, undefined, false);
  }
  async withActive<T>(subjectId: string, operation: (consent: DriverConsent) => Promise<T>, owner?: DriverConsentOwner): Promise<T | null> {
    return this.transaction(subjectId, async (_client, consent) =>
      consent.grantedAt && !consent.revokedAt ? operation(consent) : null, owner);
  }
  async erasureReady(): Promise<boolean> {
    if (this.secret.length < 32) return false;
    await this.pool.query("SELECT 1 FROM cop_driver_consent_erasure_fences LIMIT 1"); return true;
  }
  async preflightActorErasure(owner: DriverConsentOwner): Promise<DriverConsentErasureAssessment> {
    requireOwner(owner); subjectFence(this.secret, owner.subjectId);
    const result = await this.pool.query<ConsentRow>("SELECT granted_at,revoked_at,last_revoked_day,pending_days,owner_issuer FROM cop_driver_measurement_consents WHERE subject_id=$1", [owner.subjectId]);
    const row = result.rows[0], consent = row ? fromRow(row) : null;
    return { ready: !row || row.owner_issuer === owner.issuer, present: !!row, pendingDays: [...(consent?.pendingDays ?? [])], version: version([consent, row?.owner_issuer ?? null]) };
  }
  async erasureCheckpoint(owner: DriverConsentOwner, operationId: string): Promise<DriverConsentErasureCheckpoint | null> {
    requireOwner(owner); requireOperation(operationId);
    const result = await this.pool.query<ConsentErasureRow>("SELECT owner_issuer,operation_id,inventory_version,pending_days,completed,remote_proof_id FROM cop_driver_consent_erasure_fences WHERE subject_hash=$1", [subjectFence(this.secret, owner.subjectId)]);
    return checkpointFrom(result.rows[0], owner, operationId);
  }
  private async erasureTransaction<T>(owner: DriverConsentOwner, operation: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    requireOwner(owner); const client = await this.pool.connect();
    try {
      await client.query("BEGIN"); await client.query("SET LOCAL lock_timeout = '12s'");
      await client.query("SELECT pg_advisory_xact_lock(18101401, hashtext($1))", [owner.subjectId]);
      const result = await operation(client); await client.query("COMMIT"); return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async fenceActorErasure(owner: DriverConsentOwner, operationId: string, inventoryVersion: string, expectedLocalVersion: string): Promise<boolean> {
    requireOwner(owner); requireOperation(operationId, inventoryVersion);
    return this.erasureTransaction(owner, async client => {
      const key = subjectFence(this.secret, owner.subjectId);
      const previous = await client.query<ConsentErasureRow>("SELECT owner_issuer,operation_id,inventory_version,pending_days,completed,remote_proof_id FROM cop_driver_consent_erasure_fences WHERE subject_hash=$1", [key]);
      if (checkpointFrom(previous.rows[0], owner, operationId)) return true;
      const existing = await client.query<ConsentRow>("SELECT granted_at,revoked_at,last_revoked_day,pending_days,owner_issuer FROM cop_driver_measurement_consents WHERE subject_id=$1 FOR UPDATE", [owner.subjectId]);
      if (existing.rows[0] && existing.rows[0].owner_issuer !== owner.issuer) return false;
      if (version([existing.rows[0] ? fromRow(existing.rows[0]) : null, existing.rows[0]?.owner_issuer ?? null]) !== expectedLocalVersion) return false;
      await client.query("INSERT INTO cop_driver_consent_erasure_fences(subject_hash,owner_issuer,operation_id,inventory_version,pending_days) VALUES($1,$2,$3,$4,$5)", [key, owner.issuer, operationId.toLowerCase(), inventoryVersion, existing.rows[0]?.pending_days ?? []]);
      return true;
    });
  }
  async purgeActorErasure(owner: DriverConsentOwner, operationId: string, remoteProofId: string): Promise<boolean> {
    requireOwner(owner); requireOperation(operationId, remoteProofId);
    return this.erasureTransaction(owner, async client => {
      const key = subjectFence(this.secret, owner.subjectId);
      const result = await client.query<ConsentErasureRow>("SELECT owner_issuer,operation_id,inventory_version,pending_days,completed,remote_proof_id FROM cop_driver_consent_erasure_fences WHERE subject_hash=$1 FOR UPDATE", [key]);
      const checkpoint = checkpointFrom(result.rows[0], owner, operationId);
      if (!checkpoint || checkpoint.remoteProofId && checkpoint.remoteProofId !== remoteProofId) return false;
      const existing = await client.query<{ owner_issuer: string | null; pending_days: string[] }>("SELECT owner_issuer,pending_days FROM cop_driver_measurement_consents WHERE subject_id=$1 FOR UPDATE", [owner.subjectId]);
      if (existing.rows[0] && existing.rows[0].owner_issuer !== owner.issuer) return false;
      await client.query("DELETE FROM cop_driver_measurement_consents WHERE subject_id=$1 AND owner_issuer=$2", [owner.subjectId, owner.issuer]);
      await client.query("UPDATE cop_driver_consent_erasure_fences SET completed=true,remote_proof_id=$2,pending_days='{}' WHERE subject_hash=$1", [key, remoteProofId]);
      const absent = await client.query("SELECT 1 FROM cop_driver_measurement_consents WHERE subject_id=$1", [owner.subjectId]);
      const saved = await client.query<ConsentErasureRow>("SELECT owner_issuer,operation_id,inventory_version,pending_days,completed,remote_proof_id FROM cop_driver_consent_erasure_fences WHERE subject_hash=$1", [key]);
      const verified = checkpointFrom(saved.rows[0], owner, operationId);
      return absent.rows.length === 0 && verified?.completed === true && verified.remoteProofId === remoteProofId;
    });
  }
}
interface ConsentErasureRow { owner_issuer: string; operation_id: string; inventory_version: string; pending_days: string[]; completed: boolean; remote_proof_id: string | null }
function checkpointFrom(row: ConsentErasureRow | undefined, owner: DriverConsentOwner, operationId: string): DriverConsentErasureCheckpoint | null {
  if (!row) return null;
  if (row.owner_issuer !== owner.issuer || row.operation_id !== operationId.toLowerCase() || !proof.test(row.inventory_version)) throw new Error("DRIVER_CONSENT_ERASURE_CONFLICT");
  return { ownerIssuer: row.owner_issuer, operationId: row.operation_id, inventoryVersion: row.inventory_version, pendingDays: [...row.pending_days], completed: row.completed,
    ...(row.remote_proof_id ? { remoteProofId: row.remote_proof_id } : {}) };
}
