import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { MobilityStore } from "./mobility-store.js";
import type { AuthenticatedActor } from "./security.js";

export const ACCOUNT_ERASURE_ADAPTER_IDS = [
  "keycloak", "cop_sessions_profiles", "cop_devices", "messaging_matrix", "voice_livekit",
  "cop_content_media", "mobility_dispatch", "sim_measurements", "ai_router", "moderation_audit", "backup_restore"
] as const;
export type AccountErasureAdapterId = typeof ACCOUNT_ERASURE_ADAPTER_IDS[number];
export type AccountErasurePendingReason = "cleanup_pending" | "adapter_missing" | "adapter_unavailable" | "not_accepted";
export type AccountErasureProof = { status: "completed"; proofId: string } |
  { status: "pending"; remaining: "cleanup_pending" };
export interface AccountErasureAdapter {
  readonly id: AccountErasureAdapterId;
  ready(): Promise<boolean>;
  /** Idempotent per operationId; cancellation never reverses a revocation fence. */
  erase(actor: AuthenticatedActor, context: { operationId: string; requestedAt: string; accountKey: string; signal: AbortSignal }): Promise<AccountErasureProof>;
}
export interface AccountErasureReceipt {
  contractVersion: "cop-account-erasure-v1";
  operationId: string;
  status: "deleting" | "deleted";
  requestedAt: string;
  completedAt?: string;
  accountDeleted: boolean;
  revocationEnforced: true;
  remaining: AccountErasureAdapterId[];
  pendingReasons: Partial<Record<AccountErasureAdapterId, AccountErasurePendingReason>>;
}
interface Checkpoint { status: "pending" | "completed"; reason?: AccountErasurePendingReason; proofId?: string }
interface Job {
  operationId: string; requestedAt: string; completedAt?: string; required: AccountErasureAdapterId[];
  checkpoints: Partial<Record<AccountErasureAdapterId, Checkpoint>>;
  sealedPrincipal?: string;
  lease?: { token: string; expiresAt: number };
}
export class AccountErasureError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
const PREFIX = "account-erasure:job:";
const CONFIG = "account-erasure:configuration-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const freshAuthSeconds = 300;
const leaseMs = 60_000;
const adapterTimeoutMs = 10_000;

/** Source-only orchestration. Completion requires every domain's accepted real cleanup proof.
 * Callers must pass actors only after signature verification, never browser-selected identity.
 */
export class AccountErasureService {
  private readonly adapters: Map<AccountErasureAdapterId, AccountErasureAdapter>;
  private readonly required: AccountErasureAdapterId[];
  private readonly sealKey: Buffer;
  private initialized?: Promise<void>;
  constructor(readonly options: { store: MobilityStore; identitySecret: string; issuer: string;
    requiredAdapters: readonly AccountErasureAdapterId[]; adapters: readonly AccountErasureAdapter[];
    accepted: boolean; now?: () => Date }) {
    this.required = [...options.requiredAdapters];
    if (options.identitySecret.length < 32 || !options.issuer || this.required.length !== ACCOUNT_ERASURE_ADAPTER_IDS.length ||
        new Set(this.required).size !== this.required.length || ACCOUNT_ERASURE_ADAPTER_IDS.some(id => !this.required.includes(id)) ||
        options.adapters.some(adapter => !this.required.includes(adapter.id)) || new Set(options.adapters.map(a => a.id)).size !== options.adapters.length) {
      throw new Error("Account erasure requires the explicit complete provider boundary and dedicated identity secret.");
    }
    this.adapters = new Map(options.adapters.map(adapter => [adapter.id, adapter]));
    this.sealKey = createHash("sha256").update("cop-account-erasure-principal-v1\0").update(options.identitySecret).digest();
  }
  private now() { return this.options.now?.() ?? new Date(); }
  private requireActor(actor: AuthenticatedActor, fresh = false) {
    if (actor.authMode !== "oidc" || actor.issuer !== this.options.issuer || !actor.subjectId || Buffer.byteLength(actor.subjectId) > 512) {
      throw new AccountErasureError(401, "UNAUTHORIZED");
    }
    const seconds = Math.floor(this.now().getTime() / 1000);
    if (fresh && (!Number.isSafeInteger(actor.authTime) || Number(actor.authTime) > seconds || seconds - Number(actor.authTime) > freshAuthSeconds)) {
      throw new AccountErasureError(401, "FRESH_AUTH_REQUIRED");
    }
  }
  private accountKey(actor: AuthenticatedActor) {
    return createHmac("sha256", this.options.identitySecret).update("cop-account-erasure-identity-v1\0")
      .update(JSON.stringify([actor.issuer, actor.subjectId])).digest("hex");
  }
  async init(): Promise<void> {
    if (!this.initialized) this.initialized = this.options.store.transact([CONFIG], async tx => {
      const fingerprint = createHash("sha256").update("cop-account-erasure-config-v1\0").update(this.options.identitySecret).digest("hex");
      const saved = await tx.get<{ fingerprint: string }>(CONFIG);
      if (saved && saved.fingerprint !== fingerprint) throw new AccountErasureError(503, "ERASURE_CONFIGURATION_CHANGED");
      if (!saved) await tx.set(CONFIG, { fingerprint });
    }).catch(error => { this.initialized = undefined; throw error instanceof AccountErasureError ? error : new AccountErasureError(503, "ERASURE_STORE_UNAVAILABLE"); });
    await this.initialized;
  }
  async capabilities() {
    if (!this.options.accepted) return { contractVersion: "cop-account-erasure-v1", accountDeletion: false, unavailableReason: "not_accepted" };
    if (this.required.some(id => !this.adapters.has(id))) return { contractVersion: "cop-account-erasure-v1", accountDeletion: false, unavailableReason: "required_adapters_missing" };
    try {
      await this.init();
      for (const id of this.required) if (!(await bounded(this.adapters.get(id)!.ready(), AbortSignal.timeout(adapterTimeoutMs)))) {
        return { contractVersion: "cop-account-erasure-v1", accountDeletion: false, unavailableReason: "adapter_unavailable" };
      }
      return { contractVersion: "cop-account-erasure-v1", accountDeletion: true };
    } catch { return { contractVersion: "cop-account-erasure-v1", accountDeletion: false, unavailableReason: "adapter_unavailable" }; }
  }
  /** Used by the authenticated/BFF guard for every ordinary account operation, even old JWTs. */
  async assertAllowed(actor: AuthenticatedActor): Promise<void> {
    this.requireActor(actor);
    await this.init();
    try {
      const job = await this.options.store.transact([], tx => tx.get<Job>(PREFIX + this.accountKey(actor)));
      if (job) throw new AccountErasureError(403, "ACCOUNT_ERASURE_FENCED");
    } catch (error) { throw known(error); }
  }
  /** Receipt recovery is the explicit exception to the ordinary-operation fence. */
  async read(actor: AuthenticatedActor, operationId: string): Promise<AccountErasureReceipt> {
    this.requireActor(actor, true); validateOperation(operationId); await this.init();
    try {
      const job = await this.options.store.transact([PREFIX + this.accountKey(actor)], async tx => {
        const value = await tx.get<Job>(PREFIX + this.accountKey(actor));
        if (value && this.finalize(value)) await tx.set(PREFIX + this.accountKey(actor), value);
        return value;
      });
      if (!job || job.operationId !== operationId.toLowerCase()) throw new AccountErasureError(404, "NOT_FOUND");
      return this.receipt(job);
    } catch (error) { throw known(error); }
  }
  async request(actor: AuthenticatedActor, operationId: string, input: unknown): Promise<AccountErasureReceipt> {
    this.requireActor(actor, true); validateOperation(operationId);
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1 ||
        (input as Record<string, unknown>).confirmAccountDeletion !== true) throw new AccountErasureError(400, "VALIDATION_ERROR");
    await this.init();
    const accountKey = this.accountKey(actor), key = PREFIX + accountKey;
    try {
      const existing = await this.options.store.transact([], tx => tx.get<Job>(key));
      if (!existing && !(await this.capabilities()).accountDeletion) throw new AccountErasureError(503, "ERASURE_NOT_READY");
      const job = await this.options.store.transact([key], async tx => {
        const saved = await tx.get<Job>(key);
        if (saved) {
          if (saved.operationId !== operationId.toLowerCase()) throw new AccountErasureError(409, "IDEMPOTENCY_CONFLICT");
          return saved;
        }
        const value: Job = { operationId: operationId.toLowerCase(), requestedAt: this.now().toISOString(),
          required: [...this.required], checkpoints: {}, sealedPrincipal: this.seal(actor) };
        await tx.set(key, value); // Durable global tombstone before every downstream handoff.
        return value;
      });
      if (job.completedAt) return this.receipt(job);
      return await this.run(accountKey);
    } catch (error) { throw known(error); }
  }
  /** Trusted worker only: resumes previously confirmed jobs without requiring new login after Keycloak removal. */
  async resumePending(limit = 20, signal?: AbortSignal): Promise<void> {
    await this.init();
    const jobs = await this.options.store.transact([], tx => tx.scan<Job>(PREFIX)).catch(error => { throw known(error); });
    for (const entry of jobs.filter(entry => !entry.value.completedAt).slice(0, Math.max(0, Math.min(limit, 20)))) {
      if (signal?.aborted) break;
      await this.run(entry.key.slice(PREFIX.length), signal).catch(() => undefined);
    }
  }
  private async run(accountKey: string, workerSignal?: AbortSignal): Promise<AccountErasureReceipt> {
    if (!this.options.accepted) throw new AccountErasureError(503, "ERASURE_NOT_READY");
    const key = PREFIX + accountKey, token = randomUUID();
    const claimed = await this.options.store.transact([key], async tx => {
      const job = await tx.get<Job>(key);
      if (!job) throw new AccountErasureError(503, "ERASURE_STORE_UNAVAILABLE");
      if (this.finalize(job)) await tx.set(key, job);
      if (job.completedAt || (job.lease && job.lease.expiresAt > this.now().getTime())) return { job, owned: false };
      job.lease = { token, expiresAt: this.now().getTime() + leaseMs }; await tx.set(key, job);
      return { job, owned: true };
    });
    if (!claimed.owned) return this.receipt(claimed.job);
    let unavailable = claimed.job.required.some(id => !this.adapters.has(id));
    try {
      const actor = this.open(claimed.job.sealedPrincipal!);
      if (this.accountKey(actor) !== accountKey) throw new AccountErasureError(503, "ERASURE_PRINCIPAL_INVALID");
      for (const id of claimed.job.required) {
        workerSignal?.throwIfAborted();
        if (completeCheckpoint(claimed.job.checkpoints[id])) continue;
        await this.renew(key, token); // Readiness probes and unavailable providers also keep the durable lease valid.
        const adapter = this.adapters.get(id);
        let proof: AccountErasureProof | undefined;
        let reason: AccountErasurePendingReason = "cleanup_pending";
        if (!adapter) { reason = "adapter_missing"; unavailable = true; }
        else {
          try {
            const readinessSignal = timedSignal(workerSignal);
            if (!(await bounded(adapter.ready(), readinessSignal))) { reason = "adapter_unavailable"; unavailable = true; }
            else {
              await this.renew(key, token);
              const signal = timedSignal(workerSignal);
              proof = await bounded(adapter.erase(actor, { accountKey, operationId: claimed.job.operationId,
                requestedAt: claimed.job.requestedAt, signal }), signal);
              validateProof(proof);
            }
          } catch { proof = undefined; reason = "adapter_unavailable"; unavailable = true; }
        }
        await this.options.store.transact([key], async tx => {
          const job = await tx.get<Job>(key);
          if (!job || job.lease?.token !== token) throw new AccountErasureError(503, "ERASURE_LEASE_LOST");
          job.checkpoints[id] = proof?.status === "completed" ? { status: "completed", proofId: proof.proofId } : { status: "pending", reason };
          this.finalize(job); // Last real proof and terminal receipt are one durable commit.
          await tx.set(key, job);
        });
      }
      const result = await this.options.store.transact([key], async tx => {
        const job = await tx.get<Job>(key);
        if (!job || job.lease?.token !== token) throw new AccountErasureError(503, "ERASURE_LEASE_LOST");
        this.finalize(job);
        delete job.lease; await tx.set(key, job); return this.receipt(job);
      });
      if (unavailable) throw new AccountErasureError(503, "ERASURE_ADAPTER_UNAVAILABLE");
      return result;
    } finally {
      await this.options.store.transact([key], async tx => {
        const job = await tx.get<Job>(key);
        if (job?.lease?.token === token) { delete job.lease; await tx.set(key, job); }
      }).catch(() => undefined);
    }
  }
  private async renew(key: string, token: string) {
    await this.options.store.transact([key], async tx => {
      const job = await tx.get<Job>(key);
      if (!job || job.lease?.token !== token) throw new AccountErasureError(503, "ERASURE_LEASE_LOST");
      job.lease.expiresAt = this.now().getTime() + leaseMs; await tx.set(key, job);
    });
  }
  private finalize(job: Job): boolean {
    this.validateBoundary(job);
    if (!job.completedAt && job.required.length === ACCOUNT_ERASURE_ADAPTER_IDS.length &&
        ACCOUNT_ERASURE_ADAPTER_IDS.every(id => job.required.includes(id) && completeCheckpoint(job.checkpoints[id]))) {
      job.completedAt = this.now().toISOString(); delete job.sealedPrincipal;
      return true;
    }
    return false;
  }
  private receipt(job: Job): AccountErasureReceipt {
    this.validateBoundary(job);
    const remaining = job.required.filter(id => !completeCheckpoint(job.checkpoints[id]));
    const accountDeleted = !!job.completedAt && remaining.length === 0 && job.required.length === ACCOUNT_ERASURE_ADAPTER_IDS.length &&
      ACCOUNT_ERASURE_ADAPTER_IDS.every(id => job.required.includes(id) && completeCheckpoint(job.checkpoints[id]));
    return { contractVersion: "cop-account-erasure-v1", operationId: job.operationId, requestedAt: job.requestedAt,
      status: accountDeleted ? "deleted" : "deleting", accountDeleted, revocationEnforced: true, remaining,
      ...(accountDeleted ? { completedAt: job.completedAt } : {}),
      pendingReasons: Object.fromEntries(remaining.map(id => [id, job.checkpoints[id]?.reason ?? "cleanup_pending"])) };
  }
  private validateBoundary(job: Job): void {
    if (!Array.isArray(job.required) || job.required.length !== ACCOUNT_ERASURE_ADAPTER_IDS.length ||
        new Set(job.required).size !== job.required.length || ACCOUNT_ERASURE_ADAPTER_IDS.some(id => !job.required.includes(id)) ||
        typeof job.operationId !== "string" || !UUID.test(job.operationId) || !job.checkpoints || typeof job.checkpoints !== "object" ||
        !Number.isFinite(Date.parse(job.requestedAt)) || (job.completedAt && !Number.isFinite(Date.parse(job.completedAt)))) {
      throw new AccountErasureError(503, "ERASURE_CHECKPOINT_INVALID");
    }
  }
  private seal(actor: AuthenticatedActor) {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.sealKey, iv);
    const bytes = Buffer.concat([cipher.update(JSON.stringify({ issuer: actor.issuer, subjectId: actor.subjectId })), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64");
  }
  private open(value: string): AuthenticatedActor {
    const bytes = Buffer.from(value, "base64"), decipher = createDecipheriv("aes-256-gcm", this.sealKey, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const principal = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")) as { issuer: string; subjectId: string };
    const actor: AuthenticatedActor = { ...principal, authMode: "oidc", username: "", displayName: "" };
    this.requireActor(actor); return actor;
  }
}
function validateOperation(operation: string) {
  if (typeof operation !== "string" || !UUID.test(operation)) throw new AccountErasureError(400, "VALIDATION_ERROR");
}
function validateProof(value: AccountErasureProof) {
  if (!value || typeof value !== "object" || (value.status === "completed"
    ? Object.keys(value).length !== 2 || typeof value.proofId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/u.test(value.proofId)
    : value.status !== "pending" || Object.keys(value).length !== 2 || value.remaining !== "cleanup_pending")) {
    throw new AccountErasureError(503, "ERASURE_PROOF_INVALID");
  }
}
function completeCheckpoint(value: Checkpoint | undefined): boolean {
  return value?.status === "completed" && typeof value.proofId === "string" && /^[A-Za-z0-9_-]{8,128}$/u.test(value.proofId);
}
function known(error: unknown) { return error instanceof AccountErasureError ? error : new AccountErasureError(503, "ERASURE_UNAVAILABLE"); }
function timedSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(adapterTimeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(new AccountErasureError(503, "ERASURE_ADAPTER_UNAVAILABLE")); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort)).catch(() => undefined);
  });
}
