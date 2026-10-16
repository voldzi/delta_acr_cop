import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { MobilityStore, MobilityTransaction } from "./mobility-store.js";
import type { AuthenticatedActor } from "./security.js";
import type { AccountErasureContinuity, AccountErasureDatasetBinding, AccountErasureFenceEntry, AccountErasureFrontier } from "./account-erasure-continuity.js";

export const ACCOUNT_ERASURE_ADAPTER_IDS = [
  "keycloak", "cop_sessions_profiles", "cop_devices", "messaging_matrix", "voice_livekit",
  "cop_content_media", "mobility_dispatch", "sim_measurements", "ai_router", "moderation_audit", "backup_restore"
] as const;
export const ACCOUNT_ERASURE_SCOPE = "cop_jizda_preserve_shared_identity_sim" as const;
export type AccountErasureAdapterId = typeof ACCOUNT_ERASURE_ADAPTER_IDS[number];
export type AccountErasurePendingReason = "cleanup_pending" | "adapter_missing" | "adapter_unavailable" | "not_accepted";
export type AccountErasurePreflightReason = "ownership_unresolved" | "choice_required" | "adapter_preflight_missing" | "adapter_unavailable";
export type AccountErasureAssessment = { ready: true; version: string; transactionVersion?: string } | { ready: false; reason: AccountErasurePreflightReason };
export type AccountErasureProof = { status: "completed"; proofId: string } |
  { status: "pending"; remaining: "cleanup_pending" };
export interface AccountErasureOperationContext {
  operationId: string; requestedAt: string; accountKey: string; signal: AbortSignal;
  /** Actual administrator-enrolled recovery binding, never browser input.
   * Owners with durable sub-checkpoints must also reverify them after restore. */
  datasetBinding?: AccountErasureDatasetBinding;
}
export interface AccountErasureAdapter {
  readonly id: AccountErasureAdapterId;
  ready(): Promise<boolean>;
  /** Read-only readiness for the exact already-confirmed durable job. Never
   * used by capability/preflight or to authorize a new provider operation. */
  readyForAcceptedOperation?(actor: AuthenticatedActor, context: AccountErasureOperationContext): Promise<boolean>;
  /** Read-only, actor-specific impact/provenance assessment. No implicit legacy fallback. */
  preflight?(actor: AuthenticatedActor, context: { signal: AbortSignal; operationId?: string }): Promise<AccountErasureAssessment>;
  /** Read-only local impact under this exact store transaction; no network or nested transactions. */
  preflightWithin?(actor: AuthenticatedActor, context: { transaction: MobilityTransaction; signal: AbortSignal; operationId: string }): Promise<AccountErasureAssessment>;
  /** Idempotent per operationId; cancellation never reverses a revocation fence. */
  erase(actor: AuthenticatedActor, context: AccountErasureOperationContext): Promise<AccountErasureProof>;
}
/** Admission locks must be shared with the actual domain writers. */
export interface AccountErasureAdmissionGuard {
  run<T>(actor: AuthenticatedActor, signal: AbortSignal, run: () => Promise<T>): Promise<T>;
}
export interface AccountErasureOwnerReadiness {
  contractVersion: "cop-account-erasure-owner-readiness-v1";
  ready: boolean;
  checkedAt: string;
  unavailableReason?: "required_adapters_missing" | "adapter_unavailable";
}
export interface AccountErasureReceipt {
  contractVersion: "cop-account-erasure-v1";
  deletionScope: typeof ACCOUNT_ERASURE_SCOPE;
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
  lastAttemptAt?: string;
}
export interface AccountErasurePreflight {
  contractVersion: "cop-account-erasure-preflight-v1"; deletionScope: typeof ACCOUNT_ERASURE_SCOPE; operationId: string; canConfirm: boolean;
  planId?: string; confirmBy?: string;
  blockers: Array<{ domain: AccountErasureAdapterId; reason: AccountErasurePreflightReason }>;
}
interface Plan { operationId: string; planId: string; confirmBy: string; versions: Record<string, string>; transactionVersions?: Record<string, string>; receiptHash: string; receiptExpiresAt: string }
interface ReceiptAccess { accountKey: string; operationId: string; planId: string; expiresAt: string }
export class AccountErasureError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
const PREFIX = "account-erasure:job:";
const CONFIG = "account-erasure:configuration-v1";
const PLAN = "account-erasure:plan:";
const ACCESS = "account-erasure:receipt-access:";
const receiptLifetimeMs = 30 * 86_400_000;
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
  private readonly cachedFenceKeys = new Set<string>();
  private cacheLoaded = false;
  private cacheGeneration = 0;
  private continuityFrontier?: AccountErasureFrontier;
  private datasetBinding?: AccountErasureDatasetBinding;
  private continuityVerifiedUntil = 0;
  private cacheFence(key: string): void {
    if (!this.cachedFenceKeys.has(key)) { this.cachedFenceKeys.add(key); this.cacheGeneration += 1; }
  }
  constructor(readonly options: { store: MobilityStore; identitySecret: string; issuer: string;
    requiredAdapters: readonly AccountErasureAdapterId[]; adapters: readonly AccountErasureAdapter[];
    accepted: boolean; expectedGuardStoreId?: string; allowUnboundSyntheticStore?: boolean; adapterTimeoutMs?: number; now?: () => Date;
    admissionGuard?: AccountErasureAdmissionGuard; continuity?: AccountErasureContinuity; continuityRequired?: boolean }) {
    this.required = [...options.requiredAdapters];
    if (options.identitySecret.length < 32 || !options.issuer || this.required.length !== ACCOUNT_ERASURE_ADAPTER_IDS.length ||
        new Set(this.required).size !== this.required.length || ACCOUNT_ERASURE_ADAPTER_IDS.some(id => !this.required.includes(id)) ||
        options.adapters.some(adapter => !this.required.includes(adapter.id)) || new Set(options.adapters.map(a => a.id)).size !== options.adapters.length) {
      throw new Error("Account erasure requires the explicit complete provider boundary and dedicated identity secret.");
    }
    this.adapters = new Map(options.adapters.map(adapter => [adapter.id, adapter]));
    this.sealKey = createHash("sha256").update("cop-account-erasure-principal-v1\0").update(options.identitySecret).digest();
  }
  private get timeoutMs() { return Math.max(1, Math.min(adapterTimeoutMs, this.options.adapterTimeoutMs ?? adapterTimeoutMs)); }
  usesAdmissionGuard(guard: AccountErasureAdmissionGuard): boolean { return this.options.admissionGuard === guard; }
  /** Synchronous local producer barrier for the accepted single-writer runtime.
   * The durable request/SQL guards remain authoritative; this is not a replica
   * substitute or proof that a restored snapshot contains the current frontier.
   */
  assertCachedActorAllowed(owner: { issuer: string; subjectId: string }): void {
    const actor: AuthenticatedActor = { authMode: "oidc", ...owner, username: "", displayName: "" };
    this.requireActor(actor);
    if (!this.cachedGuardReady()) throw new AccountErasureError(503, "ERASURE_STORE_UNAVAILABLE");
    if (this.cachedFenceKeys.has(this.accountKey(actor))) throw new AccountErasureError(403, "ACCOUNT_ERASURE_FENCED");
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
  private configurationFingerprint(): string {
    return createHash("sha256").update("cop-account-erasure-config-v1\0").update(this.options.identitySecret).digest("hex");
  }
  private invalidateContinuity(): void {
    this.initialized = undefined; this.cacheLoaded = false; this.continuityFrontier = undefined; this.continuityVerifiedUntil = 0;
    this.datasetBinding = undefined;
  }
  private validateReplayEntry(entry: AccountErasureFenceEntry): void {
    if (!entry || entry.contractVersion !== "cop-erasure-fence-entry-v1" ||
      entry.applicationStoreId !== this.options.expectedGuardStoreId || entry.configurationFingerprint !== this.configurationFingerprint() ||
      !/^[0-9a-f]{64}$/u.test(entry.accountKey) || Object.keys(entry).sort().join(",") !==
        "accountKey,applicationStoreId,configurationFingerprint,contractVersion,job" ||
      Object.keys(entry.job ?? {}).sort().join(",") !== "checkpoints,operationId,requestedAt,required" ||
      !entry.job.checkpoints || Array.isArray(entry.job.checkpoints) || Object.keys(entry.job.checkpoints).length !== 0 ||
      !Number.isFinite(Date.parse(entry.job.requestedAt)) ||
      new Date(entry.job.requestedAt).toISOString() !== entry.job.requestedAt) throw new AccountErasureError(503, "ERASURE_REPLAY_UNPROVEN");
    this.validateBoundary(entry.job);
  }
  private async assertContinuityCurrent(): Promise<void> {
    if (!this.options.continuityRequired && !this.options.continuity) return;
    try {
      if (!this.options.continuity || !this.continuityFrontier) throw new Error();
      const observation = await this.options.continuity.assertCurrent(this.continuityFrontier);
      const validUntil = Date.parse(observation.validUntil), now = this.now().getTime();
      if (!Number.isFinite(validUntil) || validUntil <= now || validUntil - now > 5000) throw new Error();
      this.continuityVerifiedUntil = validUntil;
    } catch { this.invalidateContinuity(); throw new AccountErasureError(503, "ERASURE_CONTINUITY_UNAVAILABLE"); }
  }
  async init(): Promise<void> {
    if (!this.initialized) this.initialized = (async () => {
      const required = this.options.continuityRequired || this.options.continuity !== undefined;
      if (required && (!this.options.continuity || !this.options.expectedGuardStoreId)) throw new AccountErasureError(503, "ERASURE_CONTINUITY_UNAVAILABLE");
      const replay = required ? await this.options.continuity!.snapshot() : undefined;
      if (replay && (replay.contractVersion !== "cop-erasure-replay-v1" || replay.applicationStoreId !== this.options.expectedGuardStoreId ||
        replay.configurationFingerprint !== this.configurationFingerprint() || !Number.isSafeInteger(replay.frontier?.sequence) ||
        replay.frontier.sequence < 0 || !/^[0-9a-f]{64}$/u.test(replay.frontier.digest) || !Array.isArray(replay.entries) ||
        replay.entries.length > 100_000)) throw new AccountErasureError(503, "ERASURE_REPLAY_UNPROVEN");
      const seen = new Set<string>();
      const dataset = replay?.datasetBinding === undefined ? undefined : structuredClone(replay.datasetBinding);
      if ((this.options.continuity?.requiresDatasetBinding && dataset === undefined) ||
        (dataset !== undefined && !validDatasetBinding(dataset)))
        throw new AccountErasureError(503, "ERASURE_REPLAY_UNPROVEN");
      for (const entry of replay?.entries ?? []) {
        this.validateReplayEntry(entry);
        if (seen.has(entry.accountKey)) throw new AccountErasureError(503, "ERASURE_REPLAY_UNPROVEN");
        seen.add(entry.accountKey);
      }
      await this.options.store.transact([CONFIG], async tx => {
      const fingerprint = this.configurationFingerprint();
      const saved = await tx.get<{ fingerprint: string; storeId?: string; issuerFingerprint?: string; version?: number; accepted?: boolean;
        deletionScope?: string; datasetBinding?: AccountErasureDatasetBinding }>(CONFIG);
      if (this.options.expectedGuardStoreId && (await tx.get<{ storeId: string }>("account-safety:store-identity-v1"))?.storeId !== this.options.expectedGuardStoreId) throw new AccountErasureError(503, "ERASURE_STORE_ID_MISMATCH");
      if (saved?.accepted && !this.options.expectedGuardStoreId && !this.options.allowUnboundSyntheticStore) throw new AccountErasureError(503, "ERASURE_GUARD_BINDING_REQUIRED");
      if (saved && saved.fingerprint !== fingerprint) throw new AccountErasureError(503, "ERASURE_CONFIGURATION_CHANGED");
      const issuerFingerprint = createHash("sha256").update(this.options.issuer).digest("hex");
      const version = required ? 4 : 3;
      if (saved && (saved.version !== version || saved.deletionScope !== ACCOUNT_ERASURE_SCOPE || !saved.storeId || saved.issuerFingerprint !== issuerFingerprint)) throw new AccountErasureError(503, "ERASURE_CONFIGURATION_UNSUPPORTED");
      if (saved && this.options.expectedGuardStoreId && saved.storeId !== this.options.expectedGuardStoreId) throw new AccountErasureError(503, "ERASURE_STORE_ID_MISMATCH");
      const jobs = await tx.scan<Job>(PREFIX);
      const hadDataset = !!saved && Object.hasOwn(saved, "datasetBinding");
      if (hadDataset && (dataset === undefined || !validDatasetBinding(saved!.datasetBinding!)))
        throw new AccountErasureError(503, "ERASURE_REPLAY_UNPROVEN");
      if (dataset && !hadDataset && (saved?.accepted || jobs.length))
        throw new AccountErasureError(503, "ERASURE_DATASET_HISTORY_UNPROVEN");
      const restored = !!(dataset && saved?.datasetBinding && (
        dataset.incarnationId !== saved.datasetBinding.incarnationId || dataset.restoreGeneration !== saved.datasetBinding.restoreGeneration));
      if (restored && (dataset!.restoreGeneration <= saved!.datasetBinding!.restoreGeneration ||
        dataset!.incarnationId === saved!.datasetBinding!.incarnationId))
        throw new AccountErasureError(503, "ERASURE_DATASET_HISTORY_UNPROVEN");
      if (!saved) await tx.set(CONFIG, { fingerprint, issuerFingerprint, version, deletionScope: ACCOUNT_ERASURE_SCOPE,
        storeId: this.options.expectedGuardStoreId ?? randomUUID(), accepted: false, ...(dataset ? { datasetBinding: dataset } : {}) });
      else if (dataset) await tx.set(CONFIG, { ...saved, datasetBinding: dataset });
      for (const entry of replay?.entries ?? []) {
        const key = PREFIX + entry.accountKey, existing = await tx.get<Job>(key);
        if (existing) {
          this.validateBoundary(existing);
          if (existing.operationId !== entry.job.operationId || existing.requestedAt !== entry.job.requestedAt)
            throw new AccountErasureError(503, "ERASURE_REPLAY_CONFLICT");
          if (restored) {
            // A receipt/checkpoint copied from the restored dataset cannot prove
            // that its provider effects still hold. Keep the original operation
            // and date, but require every owner to perform current readback again.
            let sealedPrincipal: string | undefined;
            if (existing.sealedPrincipal) {
              if (this.accountKey(this.open(existing.sealedPrincipal)) !== entry.accountKey)
                throw new AccountErasureError(503, "ERASURE_PRINCIPAL_INVALID");
              sealedPrincipal = existing.sealedPrincipal;
            }
            await tx.set(key, { ...entry.job, ...(sealedPrincipal ? { sealedPrincipal } : {}) });
          }
        } else await tx.set(key, entry.job);
      }
      if (replay?.entries.length) {
        const config = await tx.get<Record<string, unknown>>(CONFIG);
        await tx.set(CONFIG, { ...config, accepted: true });
      }
      for (const entry of await tx.scan<Job>(PREFIX)) {
        if (replay && !seen.has(entry.key.slice(PREFIX.length))) throw new AccountErasureError(503, "ERASURE_REPLAY_CONFLICT");
        this.cacheFence(entry.key.slice(PREFIX.length));
      }
      });
      if (replay) { this.continuityFrontier = replay.frontier; await this.assertContinuityCurrent(); }
      this.datasetBinding = dataset;
      this.cacheGeneration += 1;
      this.cacheLoaded = true;
    })().catch(error => { this.invalidateContinuity(); throw error instanceof AccountErasureError ? error : new AccountErasureError(503, "ERASURE_STORE_UNAVAILABLE"); });
    await this.initialized;
  }
  async capabilities() {
    if (!this.options.accepted) return { contractVersion: "cop-account-erasure-v1", accountDeletion: false, unavailableReason: "not_accepted" };
    if (this.required.some(id => !this.adapters.get(id)?.preflight)) return { contractVersion: "cop-account-erasure-v1", accountDeletion: false, unavailableReason: "required_adapters_missing" };
    try {
      await this.init();
      await this.assertContinuityCurrent();
      for (const id of this.required) if (!(await bounded(this.adapters.get(id)!.ready(), AbortSignal.timeout(this.timeoutMs)))) {
        return { contractVersion: "cop-account-erasure-v1", accountDeletion: false, unavailableReason: "adapter_unavailable" };
      }
      return { contractVersion: "cop-account-erasure-v1", accountDeletion: true };
    } catch { return { contractVersion: "cop-account-erasure-v1", accountDeletion: false, unavailableReason: "adapter_unavailable" }; }
  }
  /** Diagnostic readiness remains independent of permission to accept new erasure.
   * It never initializes/replays jobs, changes acceptance or publishes a fence. */
  async ownerReadiness(): Promise<AccountErasureOwnerReadiness> {
    const result = (ready: boolean, unavailableReason?: AccountErasureOwnerReadiness["unavailableReason"]): AccountErasureOwnerReadiness => ({
      contractVersion: "cop-account-erasure-owner-readiness-v1", ready, checkedAt: this.now().toISOString(),
      ...(unavailableReason ? { unavailableReason } : {})
    });
    if (this.required.some(id => !this.adapters.get(id)?.preflight)) return result(false, "required_adapters_missing");
    try {
      const verify = async () => {
        const required = this.options.continuityRequired || this.options.continuity !== undefined;
        if (required && (!this.options.continuity || !this.options.expectedGuardStoreId)) throw new Error();
        const replay = required ? await bounded(this.options.continuity!.snapshot(), AbortSignal.timeout(this.timeoutMs)) : undefined;
        if (replay && (replay.contractVersion !== "cop-erasure-replay-v1" || replay.applicationStoreId !== this.options.expectedGuardStoreId ||
          replay.configurationFingerprint !== this.configurationFingerprint() || !Number.isSafeInteger(replay.frontier?.sequence) ||
          replay.frontier.sequence < 0 || !/^[0-9a-f]{64}$/u.test(replay.frontier.digest) || !Array.isArray(replay.entries) || replay.entries.length > 100_000)) throw new Error();
        const dataset = replay?.datasetBinding;
        if ((this.options.continuity?.requiresDatasetBinding && dataset === undefined) || (dataset !== undefined && !validDatasetBinding(dataset))) throw new Error();
        const entries = new Map<string, AccountErasureFenceEntry>();
        for (const entry of replay?.entries ?? []) {
          this.validateReplayEntry(entry);
          if (entries.has(entry.accountKey)) throw new Error();
          entries.set(entry.accountKey, entry);
        }
        await this.options.store.transact([], async tx => {
          const config = await tx.get<{ fingerprint?: string; storeId?: string; issuerFingerprint?: string; version?: number;
            accepted?: boolean; deletionScope?: string; datasetBinding?: AccountErasureDatasetBinding }>(CONFIG);
          if (!config || config.fingerprint !== this.configurationFingerprint() || config.version !== (required ? 4 : 3) ||
            config.deletionScope !== ACCOUNT_ERASURE_SCOPE || typeof config.storeId !== "string" || !config.storeId ||
            typeof config.accepted !== "boolean" || config.issuerFingerprint !== createHash("sha256").update(this.options.issuer).digest("hex") ||
            (this.options.expectedGuardStoreId && config.storeId !== this.options.expectedGuardStoreId) ||
            (!this.options.expectedGuardStoreId && !this.options.allowUnboundSyntheticStore)) throw new Error();
          if (this.options.expectedGuardStoreId && (await tx.get<{ storeId: string }>("account-safety:store-identity-v1"))?.storeId !== this.options.expectedGuardStoreId) throw new Error();
          if (dataset ? !config.datasetBinding || config.datasetBinding.incarnationId !== dataset.incarnationId || config.datasetBinding.restoreGeneration !== dataset.restoreGeneration
            : config.datasetBinding !== undefined) throw new Error();
          const jobs = await tx.scan<Job>(PREFIX);
          if (replay && jobs.length !== entries.size) throw new Error();
          for (const { key, value } of jobs) {
            this.validateBoundary(value);
            const entry = entries.get(key.slice(PREFIX.length));
            if (replay && (!entry || value.operationId !== entry.job.operationId || value.requestedAt !== entry.job.requestedAt)) throw new Error();
          }
        });
        return replay ? JSON.stringify([replay.frontier, replay.datasetBinding, replay.entries]) : "local";
      };
      const before = await verify();
      const readiness = await Promise.all(this.required.map(id => bounded(this.adapters.get(id)!.ready(), AbortSignal.timeout(this.timeoutMs))));
      if (readiness.some(value => value !== true) || await verify() !== before) return result(false, "adapter_unavailable");
      return result(true);
    } catch { return result(false, "adapter_unavailable"); }
  }
  /** Used by the authenticated/BFF guard for every ordinary account operation, even old JWTs. */
  async assertAllowed(actor: AuthenticatedActor): Promise<void> {
    this.requireActor(actor);
    await this.init();
    await this.assertContinuityCurrent();
    try {
      const job = await this.options.store.transact([], tx => tx.get<Job>(PREFIX + this.accountKey(actor)));
      if (job) { this.cacheFence(this.accountKey(actor)); throw new AccountErasureError(403, "ACCOUNT_ERASURE_FENCED"); }
    } catch (error) { throw known(error); }
  }
  cachedGuardReady(): boolean { return this.cacheLoaded && (!this.options.continuityRequired && !this.options.continuity || this.continuityVerifiedUntil > this.now().getTime()); }
  cachedFenceGeneration(): number { return this.cacheGeneration; }
  /** Owner-private readback for final COP grant revocation; never a public API. */
  async operationFenceConfirmed(actor: AuthenticatedActor, context: { operationId: string; accountKey: string }): Promise<boolean> {
    this.requireActor(actor); validateOperation(context.operationId); await this.init();
    await this.assertContinuityCurrent();
    if (this.accountKey(actor) !== context.accountKey) return false;
    return this.options.store.transact([], async tx => {
      const job = await tx.get<Job>(PREFIX + context.accountKey);
      const config = await tx.get<{ accepted?: boolean }>(CONFIG);
      return config?.accepted === true && job?.operationId === context.operationId.toLowerCase();
    });
  }
  /** For writers sharing this exact durable store: guard and write under the same xact lock.
   * Call only after init; never start a nested transaction from this hook.
   */
  async assertAllowedWithin(tx: MobilityTransaction, actor: AuthenticatedActor): Promise<void> {
    this.requireActor(actor);
    if (!this.initialized) throw new AccountErasureError(503, "ERASURE_STORE_UNAVAILABLE");
    await this.assertContinuityCurrent();
    if (await tx.get(PREFIX + this.accountKey(actor))) throw new AccountErasureError(403, "ACCOUNT_ERASURE_FENCED");
  }
  /** Receipt recovery is the explicit exception to the ordinary-operation fence. */
  async read(actor: AuthenticatedActor, operationId: string): Promise<AccountErasureReceipt> {
    this.requireActor(actor, true); validateOperation(operationId); await this.init();
    await this.assertContinuityCurrent();
    try {
      const job = await this.options.store.transact([PREFIX + this.accountKey(actor)], async tx => {
        const value = await tx.get<Job>(PREFIX + this.accountKey(actor));
        if (value && value.operationId === operationId.toLowerCase() && !value.completedAt && !value.sealedPrincipal) {
          // Recovery of a previously accepted fence, bound to this fresh verified
          // actor. This never creates a new operation or chooses another account.
          value.sealedPrincipal = this.seal(actor); await tx.set(PREFIX + this.accountKey(actor), value);
        }
        if (value && this.finalize(value)) await tx.set(PREFIX + this.accountKey(actor), value);
        return value;
      });
      if (!job || job.operationId !== operationId.toLowerCase()) throw new AccountErasureError(404, "NOT_FOUND");
      return this.receipt(job);
    } catch (error) { throw known(error); }
  }
  async preflight(actor: AuthenticatedActor, operationId: string): Promise<{ response: AccountErasurePreflight; capability?: string }> {
    this.requireActor(actor, true); validateOperation(operationId); await this.init();
    await this.assertContinuityCurrent();
    if (!this.options.accepted) throw new AccountErasureError(503, "ERASURE_NOT_READY");
    const accountKey = this.accountKey(actor);
    if (await this.options.store.transact([], tx => tx.get<Job>(PREFIX + accountKey))) throw new AccountErasureError(409, "ERASURE_ALREADY_REQUESTED");
    const assessed = await this.assess(actor, operationId.toLowerCase());
    const response: AccountErasurePreflight = { contractVersion: "cop-account-erasure-preflight-v1", deletionScope: ACCOUNT_ERASURE_SCOPE, operationId: operationId.toLowerCase(), canConfirm: assessed.blockers.length === 0, blockers: assessed.blockers };
    if (!response.canConfirm) return { response };
    this.requireActor(actor, true);
    const capability = randomBytes(32).toString("base64url"), receiptHash = this.accessHash(capability);
    const planId = randomUUID(), confirmBy = new Date(this.now().getTime() + freshAuthSeconds * 1000).toISOString();
    const receiptExpiresAt = new Date(this.now().getTime() + receiptLifetimeMs).toISOString();
    await this.options.store.transact([PREFIX + accountKey, PLAN + accountKey], async tx => {
      if (await tx.get(PREFIX + accountKey)) throw new AccountErasureError(409, "ERASURE_ALREADY_REQUESTED");
      const previous = await tx.get<Plan>(PLAN + accountKey);
      if (previous) await tx.remove(ACCESS + previous.receiptHash);
      await tx.set(PLAN + accountKey, { operationId: response.operationId, planId, confirmBy, versions: assessed.versions,
        transactionVersions: assessed.transactionVersions, receiptHash, receiptExpiresAt } satisfies Plan);
      await tx.set(ACCESS + receiptHash, { accountKey, operationId: response.operationId, planId, expiresAt: receiptExpiresAt } satisfies ReceiptAccess);
    });
    return { response: { ...response, planId, confirmBy }, capability };
  }
  async readWithCapability(operationId: string, capability: string): Promise<AccountErasureReceipt> {
    validateOperation(operationId); await this.init();
    await this.assertContinuityCurrent();
    const hash = this.accessHash(capability);
    return this.options.store.transact([ACCESS + hash], async tx => {
      const access = await tx.get<ReceiptAccess>(ACCESS + hash);
      if (!access || access.operationId !== operationId.toLowerCase() || !validUntil(access.expiresAt, this.now().getTime())) throw new AccountErasureError(401, "ERASURE_RECEIPT_UNAUTHORIZED");
      const job = await tx.get<Job>(PREFIX + access.accountKey);
      if (!job || job.operationId !== access.operationId) throw new AccountErasureError(404, "NOT_FOUND");
      return this.receipt(job);
    }).catch(error => { throw known(error); });
  }
  private accessHash(capability: string) {
    if (typeof capability !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(capability)) throw new AccountErasureError(401, "ERASURE_RECEIPT_UNAUTHORIZED");
    return createHmac("sha256", this.options.identitySecret).update("cop-erasure-read-capability-v1\0").update(capability).digest("hex");
  }
  private async assess(actor: AuthenticatedActor, operationId: string) {
    const blockers: AccountErasurePreflight["blockers"] = [], versions: Record<string, string> = {}, transactionVersions: Record<string, string> = {};
    for (const id of this.required) {
      const adapter = this.adapters.get(id);
      if (!adapter?.preflight) { blockers.push({ domain: id, reason: "adapter_preflight_missing" }); continue; }
      try {
        const signal = AbortSignal.timeout(this.timeoutMs);
        if (!await bounded(adapter.ready(), signal)) { blockers.push({ domain: id, reason: "adapter_unavailable" }); continue; }
        const result = await bounded(adapter.preflight(actor, { signal, operationId }), signal);
        if (result.ready === false) {
          if (!["ownership_unresolved", "choice_required", "adapter_preflight_missing", "adapter_unavailable"].includes(result.reason)) throw new Error("Invalid preflight blocker");
          blockers.push({ domain: id, reason: result.reason }); continue;
        }
        if (result.ready !== true) throw new Error("Invalid preflight assessment");
        if (!/^[A-Za-z0-9_-]{8,128}$/u.test(result.version)) throw new Error("Invalid preflight version");
        if (adapter.preflightWithin) {
          if (!result.transactionVersion || !/^[A-Za-z0-9_-]{8,128}$/u.test(result.transactionVersion)) throw new Error("Atomic impact version missing");
          transactionVersions[id] = result.transactionVersion;
        }
        versions[id] = result.version;
      } catch { blockers.push({ domain: id, reason: "adapter_unavailable" }); }
    }
    return { blockers, versions, transactionVersions };
  }
  async request(actor: AuthenticatedActor, operationId: string, input: unknown, authorization?: { planId: string; capability: string }): Promise<AccountErasureReceipt> {
    this.requireActor(actor, true); validateOperation(operationId);
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1 ||
        (input as Record<string, unknown>).confirmAccountDeletion !== true) throw new AccountErasureError(400, "VALIDATION_ERROR");
    await this.init();
    await this.assertContinuityCurrent();
    const accountKey = this.accountKey(actor), key = PREFIX + accountKey;
    try {
      const existing = await this.options.store.transact([], tx => tx.get<Job>(key));
      if (!existing && !(await this.capabilities()).accountDeletion) throw new AccountErasureError(503, "ERASURE_NOT_READY");
      const admit = async () => {
      let prepared: Plan | undefined;
      if (!existing) {
        if (!authorization || !UUID.test(authorization.planId)) throw new AccountErasureError(409, "ERASURE_PREFLIGHT_REQUIRED");
        prepared = await this.options.store.transact([], tx => tx.get<Plan>(PLAN + accountKey));
        if (!prepared || prepared.planId !== authorization.planId || prepared.operationId !== operationId.toLowerCase() || prepared.receiptHash !== this.accessHash(authorization.capability) || !validUntil(prepared.confirmBy, this.now().getTime())) throw new AccountErasureError(409, "ERASURE_PLAN_EXPIRED_OR_CHANGED");
        const current = await this.assess(actor, operationId.toLowerCase());
        this.requireActor(actor, true);
        if (current.blockers.length || this.required.some(id => current.versions[id] !== prepared!.versions[id])) throw new AccountErasureError(409, "ERASURE_PLAN_EXPIRED_OR_CHANGED");
      }
      const acceptedJob = await this.options.store.transact([key], async tx => {
        const saved = await tx.get<Job>(key);
        if (saved) {
          if (saved.operationId !== operationId.toLowerCase()) throw new AccountErasureError(409, "IDEMPOTENCY_CONFLICT");
          if (!saved.completedAt && !saved.sealedPrincipal) { saved.sealedPrincipal = this.seal(actor); await tx.set(key, saved); }
          return saved;
        }
        const currentPlan = await tx.get<Plan>(PLAN + accountKey);
        if (!prepared || currentPlan?.planId !== prepared.planId || !validUntil(currentPlan.confirmBy, this.now().getTime())) throw new AccountErasureError(409, "ERASURE_PLAN_EXPIRED_OR_CHANGED");
        // Keep local ownership checks and global fence commit atomic with admitted
        // writers. A vehicle/group created after the earlier impact probe cannot
        // strand its owner behind a permanent fence without a transfer choice.
        for (const id of this.required) {
          const adapter = this.adapters.get(id);
          if (!adapter?.preflightWithin) continue;
          const signal = AbortSignal.timeout(this.timeoutMs);
          const impact = await bounded(adapter.preflightWithin(actor, { transaction: tx, operationId: operationId.toLowerCase(), signal }), signal);
          if (!impact.ready || impact.version !== currentPlan.transactionVersions?.[id]) throw new AccountErasureError(409, "ERASURE_PLAN_EXPIRED_OR_CHANGED");
        }
        this.requireActor(actor, true);
        let value: Job = { operationId: operationId.toLowerCase(), requestedAt: this.now().toISOString(),
          required: [...this.required], checkpoints: {}, sealedPrincipal: this.seal(actor) };
        if (this.options.continuityRequired || this.options.continuity) {
          if (!this.options.continuity || !this.options.expectedGuardStoreId) throw new AccountErasureError(503, "ERASURE_CONTINUITY_UNAVAILABLE");
          try {
            const published = await this.options.continuity.publishFence({ contractVersion: "cop-erasure-fence-entry-v1",
              applicationStoreId: this.options.expectedGuardStoreId, configurationFingerprint: this.configurationFingerprint(),
              accountKey, job: { operationId: value.operationId, requestedAt: value.requestedAt, required: value.required, checkpoints: {} } });
            this.validateReplayEntry(published.entry);
            if (published.entry.accountKey !== accountKey || published.entry.job.operationId !== operationId.toLowerCase())
              throw new AccountErasureError(503, "ERASURE_REPLAY_UNPROVEN");
            value = { ...published.entry.job, sealedPrincipal: this.seal(actor) };
          } finally { this.invalidateContinuity(); }
        }
        await tx.set(key, value); // Durable global tombstone before every downstream handoff.
        const configuration = await tx.get<Record<string, unknown>>(CONFIG);
        await tx.set(CONFIG, { ...configuration, accepted: true });
        await tx.remove(PLAN + accountKey);
        return value;
      });
      // Commit happens before the RAM barrier is published; admission remains
      // held until this synchronous update, before any downstream erase await.
      this.cacheFence(accountKey);
      if (this.options.continuityRequired || this.options.continuity) await this.init();
      return acceptedJob;
      };
      // Lock order: domain admission -> global store. The external worker runs
      // after release. A protected content writer cannot slip between the
      // actor-specific reassessment and the permanent global fence.
      const job = this.options.admissionGuard && !existing
        ? await this.options.admissionGuard.run(actor, AbortSignal.timeout(180_000), admit)
        : await admit();
      if (job.completedAt) return this.receipt(job);
      return await this.run(accountKey);
    } catch (error) { throw known(error); }
  }
  /** Trusted worker only: resumes previously confirmed jobs without requiring new login after Keycloak removal. */
  async resumePending(limit = 20, signal?: AbortSignal): Promise<void> {
    await this.init();
    await this.assertContinuityCurrent();
    await this.options.store.transact([], async tx => {
      for (const entry of await tx.scan<Plan>(PLAN)) if (!validUntil(entry.value.confirmBy, this.now().getTime())) {
        await tx.remove(ACCESS + entry.value.receiptHash); await tx.remove(entry.key);
      }
      for (const entry of await tx.scan<ReceiptAccess>(ACCESS)) if (!validUntil(entry.value.expiresAt, this.now().getTime())) await tx.remove(entry.key);
    });
    const jobs = await this.options.store.transact([], tx => tx.scan<Job>(PREFIX)).catch(error => { throw known(error); });
    for (const entry of jobs.filter(entry => !entry.value.completedAt && (!entry.value.lease || entry.value.lease.expiresAt <= this.now().getTime()))
      .sort((a, b) => (a.value.lastAttemptAt ?? "").localeCompare(b.value.lastAttemptAt ?? "") || a.value.requestedAt.localeCompare(b.value.requestedAt) || a.key.localeCompare(b.key))
      .slice(0, Math.max(0, Math.min(limit, 20)))) {
      if (signal?.aborted) break;
      await this.run(entry.key.slice(PREFIX.length), signal).catch(() => undefined);
    }
  }
  private async run(accountKey: string, workerSignal?: AbortSignal): Promise<AccountErasureReceipt> {
    await this.assertContinuityCurrent();
    const key = PREFIX + accountKey, token = randomUUID();
    const claimed = await this.options.store.transact([key], async tx => {
      const job = await tx.get<Job>(key);
      if (!job) throw new AccountErasureError(503, "ERASURE_STORE_UNAVAILABLE");
      if (this.finalize(job)) await tx.set(key, job);
      if (job.completedAt || !job.sealedPrincipal || (job.lease && job.lease.expiresAt > this.now().getTime())) return { job, owned: false };
      job.lease = { token, expiresAt: this.now().getTime() + leaseMs }; await tx.set(key, job);
      job.lastAttemptAt = this.now().toISOString(); await tx.set(key, job);
      return { job, owned: true };
    });
    if (!claimed.owned) return this.receipt(claimed.job);
    let unavailable = claimed.job.required.some(id => !this.adapters.has(id));
    try {
      const actor = this.open(claimed.job.sealedPrincipal!);
      if (this.accountKey(actor) !== accountKey) throw new AccountErasureError(503, "ERASURE_PRINCIPAL_INVALID");
      for (const id of [...claimed.job.required.filter(id => id !== "keycloak"), ...(claimed.job.required.includes("keycloak") ? ["keycloak" as const] : [])]) {
        workerSignal?.throwIfAborted();
        await this.assertContinuityCurrent();
        if (completeCheckpoint(claimed.job.checkpoints[id])) continue;
        if (id === "keycloak") {
          const blocked = await this.options.store.transact([key], async tx => {
            const job = await tx.get<Job>(key);
            if (!job || job.lease?.token !== token) throw new AccountErasureError(503, "ERASURE_LEASE_LOST");
            return job.required.some(domain => domain !== "keycloak" && !completeCheckpoint(job.checkpoints[domain]));
          });
          if (blocked) continue;
        }
        await this.renew(key, token); // Readiness probes and unavailable providers also keep the durable lease valid.
        const adapter = this.adapters.get(id);
        let proof: AccountErasureProof | undefined;
        let reason: AccountErasurePendingReason = "cleanup_pending";
        if (!adapter) { reason = "adapter_missing"; unavailable = true; }
        else {
          try {
            const readinessSignal = timedSignal(workerSignal, this.timeoutMs);
            // Enabled intake authorizes the first provider handoff for this
            // durable COP job. Only a disabled/unready provider needs its own
            // existing-operation proof; requiring that before first handoff
            // would leave every new job permanently stuck at provider404.
            let ready = await bounded(adapter.ready(), readinessSignal);
            if (!ready && adapter.readyForAcceptedOperation)
              ready = await bounded(adapter.readyForAcceptedOperation(actor, { accountKey,
                operationId: claimed.job.operationId, requestedAt: claimed.job.requestedAt,
                ...(this.datasetBinding ? { datasetBinding: structuredClone(this.datasetBinding) } : {}),
                signal: readinessSignal }), readinessSignal);
            if (!ready) { reason = "adapter_unavailable"; unavailable = true; }
            else {
              await this.renew(key, token);
              const signal = timedSignal(workerSignal, this.timeoutMs);
              proof = await bounded(adapter.erase(actor, { accountKey, operationId: claimed.job.operationId,
                ...(this.datasetBinding ? { datasetBinding: structuredClone(this.datasetBinding) } : {}),
                requestedAt: claimed.job.requestedAt, signal }), signal);
              validateProof(proof);
            }
          } catch { proof = undefined; reason = "adapter_unavailable"; unavailable = true; }
        }
        await this.options.store.transact([key], async tx => {
          await this.assertContinuityCurrent();
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
    return { contractVersion: "cop-account-erasure-v1", deletionScope: ACCOUNT_ERASURE_SCOPE, operationId: job.operationId, requestedAt: job.requestedAt,
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
function validUntil(value: string, now: number): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.parse(value) > now;
}
function validDatasetBinding(value: AccountErasureDatasetBinding): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === "incarnationId,restoreGeneration" &&
    typeof value.incarnationId === "string" && UUID.test(value.incarnationId) &&
    Number.isSafeInteger(value.restoreGeneration) && value.restoreGeneration > 0;
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
function timedSignal(signal?: AbortSignal, timeoutMs = adapterTimeoutMs): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
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
