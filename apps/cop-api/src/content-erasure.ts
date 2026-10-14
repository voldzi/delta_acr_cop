import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient } from "pg";
import type { AuthenticatedActor } from "./security.js";
import type { AccountErasureAssessment, AccountErasureProof } from "./account-erasure.js";

/** A component proves only its actual local store, never an external projection
 * or the whole cop_content_media domain. All configured components are required. */
export interface ContentErasureComponent {
  readonly component: string;
  ready(): Promise<boolean>;
  preflight(actor: AuthenticatedActor, signal: AbortSignal): Promise<AccountErasureAssessment>;
  erase(actor: AuthenticatedActor, context: { operationId: string; signal: AbortSignal }): Promise<AccountErasureProof>;
  withAdmission?<T>(run: () => Promise<T>): Promise<T>;
  bindWriterGuard?(guard: ContentAccountGuard): boolean;
  writerGuardMatches?(guard: ContentAccountGuard): boolean;
}
export class ContentErasureStoreError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export function contentOwnerKey(actor: { issuer?: string; subjectId: string }): string {
  if (!actor.issuer || !actor.subjectId) throw new ContentErasureStoreError(401, "CONTENT_OWNER_IDENTITY_REQUIRED");
  return createHash("sha256").update(JSON.stringify([actor.issuer, actor.subjectId])).digest("hex");
}
export function contentSubjectKey(subjectId: string): string { return createHash("sha256").update(subjectId).digest("hex"); }
export function requireContentActor(actor: AuthenticatedActor): void {
  if (actor.authMode !== "oidc") throw new ContentErasureStoreError(401, "CONTENT_OWNER_IDENTITY_REQUIRED");
  contentOwnerKey(actor);
}
const sqlScope = new AsyncLocalStorage<{ client: PoolClient; binding: string }>();
const memoryScope = new AsyncLocalStorage<Set<ContentSerialLock>>();
export type ContentAccountGuard = (actor: { issuer: string; subjectId: string }) => Promise<void>;
/** Each actual store owns its controller binding. Another application instance
 * cannot replace it through a process-global setter or shared test fixture. */
export class ContentWriterGuardBinding {
  private installed?: ContentAccountGuard;
  get guard(): ContentAccountGuard | undefined { return this.installed; }
  bind(guard: ContentAccountGuard): boolean { if (this.installed && this.installed !== guard) return false; this.installed = guard; return true; }
  matches(guard: ContentAccountGuard): boolean { return this.installed === guard; }
}
export async function assertGlobalContentWriter(actor: { issuer?: string; subjectId: string }, accountGuard?: ContentAccountGuard): Promise<void> {
  if (!accountGuard) return;
  if (!actor.issuer) throw new ContentErasureStoreError(503, "CONTENT_OWNER_IDENTITY_UNVERIFIED");
  await accountGuard({ issuer: actor.issuer, subjectId: actor.subjectId });
}
export class ContentSerialLock {
  private queue: Promise<unknown> = Promise.resolve();
  run<T>(run: () => Promise<T>): Promise<T> {
    const held = memoryScope.getStore(); if (held?.has(this)) return run();
    const task = this.queue.then(() => memoryScope.run(new Set([...(held ?? []), this]), run));
    this.queue = task.catch(() => undefined); return task;
  }
}
function databaseBinding(pool: Pool): string {
  const options = pool.options;
  // Pool size/timeouts do not change the authority. Database/user/schema and
  // transport do; mismatching stores cannot silently borrow an admission client.
  return createHash("sha256").update(JSON.stringify([options.connectionString, options.host, options.port,
    options.database, options.user, options.options, options.ssl])).digest("hex");
}
export async function contentTransaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const existing = sqlScope.getStore(), binding = databaseBinding(pool);
  if (existing) {
    if (existing.binding !== binding) throw new ContentErasureStoreError(503, "CONTENT_STORE_BINDING_MISMATCH");
    return run(existing.client);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN"); await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 731032))", ["cop-content-writers-v1"]);
    const result = await sqlScope.run({ client, binding }, () => run(client)); await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
export async function assertContentWriter(client: PoolClient, actor: { issuer?: string; subjectId: string }, accountGuard?: ContentAccountGuard): Promise<void> {
  await assertGlobalContentWriter(actor, accountGuard);
  const result = actor.issuer
    ? await client.query("SELECT 1 FROM cop_content_erasure_fences WHERE owner_key=$1", [contentOwnerKey(actor)])
    : await client.query("SELECT 1 FROM cop_content_erasure_fences WHERE subject_key=$1 LIMIT 1", [contentSubjectKey(actor.subjectId)]);
  if (result.rowCount) throw new ContentErasureStoreError(403, "ACCOUNT_ERASURE_FENCED");
}
export async function fenceContentOwner(client: PoolClient, actor: AuthenticatedActor, operationId: string): Promise<void> {
  const ownerKey = contentOwnerKey(actor);
  const existing = await client.query<{ operation_id: string }>("SELECT operation_id FROM cop_content_erasure_fences WHERE owner_key=$1", [ownerKey]);
  if (existing.rows[0] && existing.rows[0].operation_id !== operationId) throw new ContentErasureStoreError(409, "CONTENT_ERASURE_OPERATION_CONFLICT");
  await client.query("INSERT INTO cop_content_erasure_fences(owner_key,subject_key,operation_id) VALUES($1,$2,$3) ON CONFLICT(owner_key) DO NOTHING",
    [ownerKey, contentSubjectKey(actor.subjectId), operationId]);
}
export const contentErasureSchema = `
CREATE TABLE IF NOT EXISTS cop_content_erasure_fences (
  owner_key text PRIMARY KEY, subject_key text NOT NULL, operation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cop_content_erasure_fences_subject_idx ON cop_content_erasure_fences(subject_key);
CREATE TABLE IF NOT EXISTS cop_content_erasure_component_proofs (
  owner_key text NOT NULL REFERENCES cop_content_erasure_fences(owner_key),
  component text NOT NULL, operation_id text NOT NULL, proof_id text NOT NULL,
  PRIMARY KEY(owner_key,component)
);
CREATE TABLE IF NOT EXISTS cop_content_erasure_projection_manifest (
  owner_key text NOT NULL REFERENCES cop_content_erasure_fences(owner_key),operation_id text NOT NULL,
  kind text NOT NULL,row_key text NOT NULL,PRIMARY KEY(owner_key,kind,row_key)
);`;
