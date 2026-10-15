import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ACCOUNT_ERASURE_ADAPTER_IDS, AccountErasureError } from "./account-erasure.js";
import type { AccountErasureContinuity, AccountErasureFenceEntry, AccountErasureFrontier, AccountErasureReplay } from "./account-erasure-continuity.js";
import type { AuthenticatedActor } from "./security.js";
import { opaqueUserId } from "./ai-router-chat.js";

const hex = /^[0-9a-f]{64}$/u;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const exact = (v: object, keys: string[]) => Object.keys(v).sort().join() === keys.sort().join();
function need(value: unknown): asserts value {
  if (!value) throw new AccountErasureError(503, "ERASURE_CONTINUITY_UNAVAILABLE");
}
function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, child]) => JSON.stringify(key) + ":" + canonical(child)).join(",") + "}";
  return JSON.stringify(value);
}
export function databaseFenceDigest(sequence: number, previousDigest: string, entry: AccountErasureFenceEntry): string {
  return createHash("sha256").update(canonical({ sequence, previousDigest, entry })).digest("hex");
}
interface Configuration { contract_version: string; guard_store_id: string; application_store_id: string; configuration_fingerprint: string; initial_digest: string }
interface ReplayBinding { store_id: string; incarnation_id: string; restore_generation: string; replay_sequence: string; replay_digest: string; accepted_at: Date }
interface Fence { sequence: string; account_key: string; operation_id: string; requested_at: Date; entry: AccountErasureFenceEntry; previous_digest: string; digest: string }
export interface DatabaseContinuityBinding { guardStoreId: string; applicationStoreId: string; incarnationId: string; configurationFingerprint: string }

/** Trusted application/database model, ADR0055. This is an explicit alternative
 * to the uninstalled native authority, never a fallback from a failed check.
 * The independent DB must not be restored together with the application DB.
 * Runtime has no enrollment/replay-acceptance/update/delete permissions. */
export class PostgresAccountErasureContinuity implements AccountErasureContinuity {
  private boot?: { binding: string; frontier: AccountErasureFrontier };
  private observed?: { frontier: AccountErasureFrontier; entries: AccountErasureFenceEntry[] };
  private localVerified?: string;
  constructor(private readonly guard: Pool, private readonly target: Pool, private readonly expected: DatabaseContinuityBinding) {
    need([expected.guardStoreId, expected.applicationStoreId, expected.incarnationId].every(v => uuid.test(v)) && hex.test(expected.configurationFingerprint));
  }
  async close(): Promise<void> { await Promise.all([this.guard.end(), this.target.end()]); }
  /** Current derivation must match an explicit historical-alias review enrolled
   * by the operator, not a newly generated alias or configuration label. */
  async reviewRouterIdentity(actor: AuthenticatedActor, context: { routerUserId: string; signal: AbortSignal },
    configured: { issuer: string; userIdSecret: string }): Promise<{ reviewed: true; version: string } | { reviewed: false }> {
    if (context.signal.aborted || actor.authMode !== "oidc" || actor.issuer !== configured.issuer || !actor.subjectId || configured.userIdSecret.length < 32 ||
      opaqueUserId(configured.userIdSecret, actor.subjectId) !== context.routerUserId) return { reviewed: false };
    try {
      const policy = await this.transaction(false, async client => {
        await this.binding(client);
        return (await client.query<{ identity_binding: Record<string, unknown> | null }>("SELECT identity_binding FROM cop_safety_v2.configuration WHERE singleton")).rows[0]?.identity_binding;
      });
      if (!policy || !exact(policy, ["contractVersion", "issuer", "routerKeyFingerprint", "evidenceDigest"]) ||
        policy.contractVersion !== "cop-existing-router-identity-v1" || policy.issuer !== configured.issuer ||
        policy.routerKeyFingerprint !== createHash("sha256").update("cop-router-identity-key-v1\0").update(configured.userIdSecret).digest("hex") ||
        typeof policy.evidenceDigest !== "string" || !hex.test(policy.evidenceDigest) || context.signal.aborted) return { reviewed: false };
      return { reviewed: true, version: createHash("sha256").update(canonical(policy)).digest("hex") };
    } catch { return { reviewed: false }; }
  }
  private validateEntry(entry: AccountErasureFenceEntry): void {
    need(entry && typeof entry === "object" && exact(entry, ["contractVersion", "applicationStoreId", "configurationFingerprint", "accountKey", "job"]) &&
      entry.contractVersion === "cop-erasure-fence-entry-v1" && entry.applicationStoreId === this.expected.applicationStoreId &&
      entry.configurationFingerprint === this.expected.configurationFingerprint && hex.test(entry.accountKey) && entry.job &&
      exact(entry.job, ["operationId", "requestedAt", "required", "checkpoints"]) && uuid.test(entry.job.operationId) &&
      Number.isFinite(Date.parse(entry.job.requestedAt)) && new Date(entry.job.requestedAt).toISOString() === entry.job.requestedAt &&
      entry.job.checkpoints && exact(entry.job.checkpoints, []) && Array.isArray(entry.job.required) &&
      entry.job.required.length === ACCOUNT_ERASURE_ADAPTER_IDS.length && new Set(entry.job.required).size === ACCOUNT_ERASURE_ADAPTER_IDS.length &&
      ACCOUNT_ERASURE_ADAPTER_IDS.every(id => entry.job.required.includes(id)) && Buffer.byteLength(canonical(entry)) <= 16384);
  }
  private async binding(client: PoolClient): Promise<{ config: Configuration; replay: ReplayBinding; key: string }> {
    const config = (await client.query<Configuration>("SELECT contract_version,guard_store_id,application_store_id,configuration_fingerprint,initial_digest FROM cop_safety_v2.configuration WHERE singleton")).rows[0];
    const replay = (await client.query<ReplayBinding>("SELECT store_id,incarnation_id,restore_generation,replay_sequence,replay_digest,accepted_at FROM cop_safety_v2.dataset_replays WHERE owner='cop'")).rows[0];
    const marker = (await this.target.query<{ value: { storeId?: string; incarnationId?: string } }>("SELECT value FROM cop_mobility_v1 WHERE key='account-safety:store-identity-v1'")).rows[0]?.value;
    need(config && replay && marker && config.contract_version === "cop-database-safety-v2" && config.guard_store_id === this.expected.guardStoreId &&
      config.application_store_id === this.expected.applicationStoreId && config.configuration_fingerprint === this.expected.configurationFingerprint &&
      hex.test(config.initial_digest) && replay.store_id === marker.storeId && marker.storeId === this.expected.applicationStoreId &&
      replay.incarnation_id === marker.incarnationId && marker.incarnationId === this.expected.incarnationId &&
      Number.isSafeInteger(Number(replay.restore_generation)) && Number(replay.restore_generation) > 0 &&
      Number.isSafeInteger(Number(replay.replay_sequence)) && Number(replay.replay_sequence) >= 0 && hex.test(replay.replay_digest));
    const key = canonical({ config, replay: { store_id: replay.store_id, incarnation_id: replay.incarnation_id,
      restore_generation: replay.restore_generation, accepted_at: replay.accepted_at } });
    const acceptedPrefix = Number(replay.replay_sequence) === 0 ? config.initial_digest :
      (await client.query<{ digest: string }>("SELECT digest FROM cop_safety_v2.fences WHERE sequence=$1", [replay.replay_sequence])).rows[0]?.digest;
    need(acceptedPrefix === replay.replay_digest);
    if (this.boot) {
      need(this.boot.binding === key);
      const watermark = this.observed?.frontier ?? this.boot.frontier;
      const prefix = watermark.sequence === 0 ? config.initial_digest :
        (await client.query<{ digest: string }>("SELECT digest FROM cop_safety_v2.fences WHERE sequence=$1", [watermark.sequence])).rows[0]?.digest;
      need(prefix === watermark.digest);
    }
    return { config, replay, key };
  }
  private async head(client: PoolClient, config: Configuration): Promise<AccountErasureFrontier> {
    const row = (await client.query<{ sequence: string; digest: string }>("SELECT sequence,digest FROM cop_safety_v2.fences ORDER BY sequence DESC LIMIT 1")).rows[0];
    const result = row ? { sequence: Number(row.sequence), digest: row.digest } : { sequence: 0, digest: config.initial_digest };
    need(Number.isSafeInteger(result.sequence) && result.sequence >= 0 && hex.test(result.digest));
    return result;
  }
  private async transaction<T>(write: boolean, run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.guard.connect().catch(() => { throw new AccountErasureError(503, "ERASURE_CONTINUITY_UNAVAILABLE"); });
    try {
      await client.query(write ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      if (write) await client.query("SELECT pg_advisory_xact_lock(1932540802,2)");
      const result = await run(client); await client.query("COMMIT"); return result;
    } catch { await client.query("ROLLBACK").catch(() => undefined); throw new AccountErasureError(503, "ERASURE_CONTINUITY_UNAVAILABLE"); }
    finally { client.release(); }
  }
  async snapshot(): Promise<AccountErasureReplay> {
    const observed = await this.transaction(false, async client => {
      const { config, replay, key } = await this.binding(client);
      const rows = (await client.query<Fence>("SELECT sequence,account_key,operation_id,requested_at,entry,previous_digest,digest FROM cop_safety_v2.fences ORDER BY sequence LIMIT 100001")).rows;
      need(rows.length <= 100000);
      let frontier = { sequence: 0, digest: config.initial_digest };
      const entries: AccountErasureFenceEntry[] = [];
      for (const row of rows) {
        this.validateEntry(row.entry);
        need(Number(row.sequence) === frontier.sequence + 1 && row.previous_digest === frontier.digest &&
          row.account_key === row.entry.accountKey && row.operation_id === row.entry.job.operationId &&
          row.requested_at.toISOString() === row.entry.job.requestedAt &&
          row.digest === databaseFenceDigest(Number(row.sequence), row.previous_digest, row.entry));
        frontier = { sequence: Number(row.sequence), digest: row.digest }; entries.push(row.entry);
      }
      return { key, frontier, entries, accepted: { sequence: Number(replay.replay_sequence), digest: replay.replay_digest } };
    });
    // Do not cache enrollment until the actual outer read transaction committed.
    this.boot ??= { binding: observed.key, frontier: observed.accepted };
    this.observed = { frontier: observed.frontier, entries: observed.entries };
    return { contractVersion: "cop-erasure-replay-v1", applicationStoreId: this.expected.applicationStoreId,
      configurationFingerprint: this.expected.configurationFingerprint, frontier: observed.frontier, entries: observed.entries };
  }
  async assertCurrent(frontier: AccountErasureFrontier): Promise<{ validUntil: string }> {
    need(this.boot);
    await this.transaction(this.localVerified !== frontier.digest, async client => {
      const { config } = await this.binding(client), head = await this.head(client, config);
      need(frontier.sequence === head.sequence && frontier.digest === head.digest);
      if (this.localVerified !== head.digest) {
        need(this.observed && canonical(this.observed.frontier) === canonical(head));
        const rows = (await this.target.query<{ key: string; operation_id: string; requested_at: string; required: string[] }>(
          "SELECT key,value->>'operationId' operation_id,value->>'requestedAt' requested_at,value->'required' required FROM cop_mobility_v1 WHERE left(key,length($1))=$1 LIMIT 100001", ["account-erasure:job:"])).rows;
        need(rows.length === this.observed.entries.length);
        const entries = new Map(this.observed.entries.map(e => ["account-erasure:job:" + e.accountKey, e]));
        for (const row of rows) {
          const saved = entries.get(row.key);
          need(saved && saved.job.operationId === row.operation_id && saved.job.requestedAt === row.requested_at && canonical(saved.job.required) === canonical(row.required));
        }
        const local = (await this.target.query<{ value: { fingerprint?: string; storeId?: string; version?: number } }>(
          "SELECT value FROM cop_mobility_v1 WHERE key='account-erasure:configuration-v1'")).rows[0]?.value;
        need(local?.fingerprint === this.expected.configurationFingerprint && local.storeId === this.expected.applicationStoreId && local.version === 4);
        await client.query("UPDATE cop_safety_v2.dataset_replays SET replay_sequence=$1,replay_digest=$2 WHERE owner='cop'", [head.sequence, head.digest]);
      }
    });
    this.localVerified = frontier.digest;
    return { validUntil: new Date(Date.now() + 5000).toISOString() };
  }
  async publishFence(input: AccountErasureFenceEntry): Promise<{ frontier: AccountErasureFrontier; entry: AccountErasureFenceEntry }> {
    // Snapshot caller input before the first await; it cannot change queued work.
    const entry = JSON.parse(JSON.stringify(input)) as AccountErasureFenceEntry;
    this.validateEntry(entry); need(this.boot);
    return this.transaction(true, async client => {
      const { config } = await this.binding(client);
      const existing = (await client.query<Fence>("SELECT entry FROM cop_safety_v2.fences WHERE account_key=$1 OR operation_id=$2", [entry.accountKey, entry.job.operationId])).rows;
      if (existing.length) {
        need(existing.length === 1); const saved = existing[0]!.entry; this.validateEntry(saved);
        need(saved.accountKey === entry.accountKey && saved.job.operationId === entry.job.operationId && canonical(saved.job.required) === canonical(entry.job.required));
        return { frontier: await this.head(client, config), entry: saved };
      }
      const prior = await this.head(client, config), sequence = prior.sequence + 1;
      need(Number.isSafeInteger(sequence)); const digest = databaseFenceDigest(sequence, prior.digest, entry);
      await client.query("INSERT INTO cop_safety_v2.fences(sequence,account_key,operation_id,requested_at,entry,previous_digest,digest) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [sequence, entry.accountKey, entry.job.operationId, entry.job.requestedAt, entry, prior.digest, digest]);
      return { frontier: { sequence, digest }, entry };
    });
  }
}
