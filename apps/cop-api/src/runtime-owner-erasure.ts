import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

/** Internal provenance: supplied only by a verified server-side OIDC actor. */
export interface RuntimeOwner { issuer: string; subjectId: string }
export interface RuntimeOwnerAssessment { ready: boolean; version: string }
export class RuntimeOwnerErasedError extends Error {
  readonly status = 403;
  readonly code = "ACCOUNT_REVOKED";
  constructor() { super("ACCOUNT_REVOKED"); }
}
export class RuntimeOwnerUnknownError extends Error {
  readonly status = 503;
  readonly code = "ACCOUNT_OWNERSHIP_UNRESOLVED";
  constructor() { super("ACCOUNT_OWNERSHIP_UNRESOLVED"); }
}
export function requireRuntimeOwner(owner: RuntimeOwner): void {
  if (!owner.issuer || !owner.subjectId || Buffer.byteLength(owner.issuer) > 2048 || Buffer.byteLength(owner.subjectId) > 512) {
    throw new RuntimeOwnerUnknownError();
  }
}
export function runtimeOwnerHash(owner: RuntimeOwner): string {
  requireRuntimeOwner(owner);
  return createHash("sha256").update(JSON.stringify([owner.issuer, owner.subjectId])).digest("hex");
}
function subjectHash(subject: string): string { return createHash("sha256").update(subject).digest("hex"); }
export const runtimeSubjectHash = subjectHash;
export function runtimeOwnerLock(domain: string, subject: string): string { return `cop-runtime-owner:${domain}:${subjectHash(subject)}`; }
export function runtimeAssessment(values: unknown[]): RuntimeOwnerAssessment {
  return { ready: true, version: createHash("sha256").update(JSON.stringify(values)).digest("hex") };
}
export function assertSameProvenance(existingIssuer: string | undefined, incomingIssuer: string | undefined): void {
  // Unknown history stays unknown at the caller's update; normal renewal need
  // not stop. A known different issuer must never overwrite another owner.
  if (existingIssuer && existingIssuer !== incomingIssuer) throw new RuntimeOwnerUnknownError();
}

/** One local queue makes memory fixtures obey the same erase-versus-write ordering. */
export class MemoryRuntimeOwnerFences {
  private readonly erasedSubjects = new Map<string, string>();
  private tail: Promise<void> = Promise.resolve();
  async transact<T>(subjects: readonly string[], work: () => T | Promise<T>, allowFenced = false): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      if (!allowFenced) for (const subject of subjects) this.assertAllowed(subject);
      return await work();
    } finally { release(); }
  }
  assertAllowed(subject: string): void { if (this.erasedSubjects.has(subjectHash(subject))) throw new RuntimeOwnerErasedError(); }
  fence(owner: RuntimeOwner): void {
    requireRuntimeOwner(owner);
    const subject = subjectHash(owner.subjectId), existing = this.erasedSubjects.get(subject);
    if (existing && existing !== runtimeOwnerHash(owner)) throw new RuntimeOwnerUnknownError();
    this.erasedSubjects.set(subject, runtimeOwnerHash(owner));
  }
}

export const runtimeOwnerFenceTableSql = `
CREATE TABLE IF NOT EXISTS cop_runtime_owner_fences (
  domain text NOT NULL,
  subject_hash text NOT NULL,
  owner_hash text NOT NULL,
  operation_id text NOT NULL,
  requested_at timestamptz NOT NULL,
  PRIMARY KEY (domain, subject_hash)
);`;

/** Pooling-safe: locks, fence checks and mutation share one short transaction. */
export async function runtimeOwnerTransaction<T>(pool: Pool, domain: string, subjects: readonly string[],
  work: (client: PoolClient) => Promise<T>, allowFenced = false): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockRuntimeSubjects(client, domain, subjects, allowFenced);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export async function lockRuntimeSubjects(client: PoolClient, domain: string, subjects: readonly string[], allowFenced = false): Promise<void> {
  for (const subject of [...new Set(subjects)].sort()) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [runtimeOwnerLock(domain, subject)]);
    if (!allowFenced) await assertRuntimeOwnerAllowed(client, domain, subject);
  }
}
export async function assertRuntimeOwnerAllowed(client: Pick<PoolClient, "query">, domain: string, subject: string): Promise<void> {
  const result = await client.query("SELECT 1 FROM cop_runtime_owner_fences WHERE domain = $1 AND subject_hash = $2", [domain, subjectHash(subject)]);
  if (result.rows.length) throw new RuntimeOwnerErasedError();
}
export async function fenceRuntimeOwner(client: PoolClient, domain: string, owner: RuntimeOwner,
  operationId: string, requestedAt: string): Promise<void> {
  await client.query(`INSERT INTO cop_runtime_owner_fences (domain, subject_hash, owner_hash, operation_id, requested_at)
    VALUES ($1,$2,$3,$4,$5) ON CONFLICT (domain, subject_hash) DO NOTHING`,
  [domain, subjectHash(owner.subjectId), runtimeOwnerHash(owner), operationId, requestedAt]);
  const selected = await client.query<{ owner_hash: string }>("SELECT owner_hash FROM cop_runtime_owner_fences WHERE domain=$1 AND subject_hash=$2", [domain, subjectHash(owner.subjectId)]);
  if (selected.rows[0]?.owner_hash !== runtimeOwnerHash(owner)) throw new RuntimeOwnerUnknownError();
}
