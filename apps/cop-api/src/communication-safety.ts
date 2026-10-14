import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { MobilityStore, MobilityTransaction } from "./mobility-store.js";
import type { AuthenticatedActor } from "./security.js";
import { actorFromRequest } from "./security.js";
import { correlationIdFrom, sendError } from "./errors.js";
import { readBoundedBody } from "./bounded-upstream.js";
import type { AccountErasureAdapter, AccountErasureAssessment, AccountErasureProof } from "./account-erasure.js";

export class CommunicationSafetyError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export interface CommunicationPolicy {
  block(owner: string, peer: string, blocked?: boolean): Promise<boolean>;
  directAllowed(owner: string, peer: string): Promise<boolean>;
  eventMatchesPeer(owner: string, peer: string, room: string, event: string): Promise<boolean>;
}
export interface CommunicationReportInput {
  target: { kind: "user" | "message" | "call"; peerSubjectId: string; conversationId?: string; eventId?: string; callId?: string };
  reason: "harassment" | "threats" | "spam" | "sexual_content" | "other";
  evidence?: { selectedText: string; explicitlyConfirmed: true };
}
export const COMMUNICATION_RETENTION_POLICY_ID = "cop-communication-retention-90d-30d-180d-v1";
export const COMMUNICATION_SAFETY_CONFIG_KEY = "communication-safety:configuration-v1";
export const COMMUNICATION_RETENTION_POLICY = {
  selectedTextMaxAgeDays: 90, selectedTextAfterClosureMaxAgeDays: 30, auditMaxAgeDays: 180,
  blocking: "until_unblocked_or_account_deleted"
} as const;
const dayMs = 86_400_000;
const reportPrefix = "communication-safety:report:";
const pendingIndexKey = "communication-safety:pending-index";
const erasurePrefix = "communication-safety:erasure-fence:";
interface Report {
  target?: CommunicationReportInput["target"]; reason?: CommunicationReportInput["reason"];
  evidence?: CommunicationReportInput["evidence"];
  reportId: string; reporter?: string; reporterIssuer?: string; ownerKey?: string; targetIssuer?: string; createdAt: string;
  status: "submitted" | "reviewing" | "resolved"; closedAt?: string; detailsExpiredAt?: string; evidenceExpiresAt?: string;
  resolution?: "no_action" | "action_taken"; revision: number;
  provenance?: { contractVersion: "cop-communication-report-v1"; retentionPolicyId: string; receivedAt: string };
  audit: { actor: string; actorIssuer?: string; at: string; action: string }[];
}
interface StoredReport { sealed: string }
interface ReportOperation { hash: string; hashVersion?: "hmac-v1"; reportId: string }
export interface CommunicationRetentionResult { reportsChanged: number; evidencePurged: number; detailsPurged: number; auditEventsPurged: number }
export type ValidateReportTarget = (actor: AuthenticatedActor, input: CommunicationReportInput["target"]) => Promise<void | { peerIssuer: string }>;

/** All endpoints use the authenticated COP subject. No caller can supply a reporter or payer. */
export class CommunicationSafetyService {
  private pruning?: Promise<CommunicationRetentionResult>;
  private initialized?: Promise<void>;
  constructor(readonly options: { store: MobilityStore; policy: CommunicationPolicy; encryptionSecret: string;
    validateTarget: ValidateReportTarget; now?: () => Date; moderatorRole: string; contactEmail: string; retentionPolicyId: string;
    /** Disables new reports/blocks, never retention, receipts, unblock or canonical enforcement. */
    intakeEnabled?: boolean }) {
    if (options.encryptionSecret.length < 32 || !options.moderatorRole || !options.contactEmail || options.retentionPolicyId !== COMMUNICATION_RETENTION_POLICY_ID) {
      throw new Error("Communication safety requires encryption, an operator and the approved retention policy.");
    }
  }
  now() { return this.options.now?.() ?? new Date(); }
  async init(): Promise<void> {
    if (!this.initialized) this.initialized = this.options.store.transact([COMMUNICATION_SAFETY_CONFIG_KEY], async tx => {
      const fingerprint = createHash("sha256").update("cop-communication-configuration-v1\0").update(this.options.encryptionSecret).digest("hex");
      const saved = await tx.get<{ fingerprint: string; retentionPolicyId: string }>(COMMUNICATION_SAFETY_CONFIG_KEY);
      if (saved && (saved.fingerprint !== fingerprint || saved.retentionPolicyId !== COMMUNICATION_RETENTION_POLICY_ID)) {
        throw new CommunicationSafetyError(503, "COMMUNICATION_CONFIGURATION_CHANGED");
      }
      if (!saved) {
        // Legacy evidence must decrypt before recording its key ownership. A wrong key
        // cannot silently become authoritative merely because the marker is absent.
        for (const row of await tx.scan<StoredReport>(reportPrefix)) this.prune(this.open(row.value.sealed));
        await tx.set(COMMUNICATION_SAFETY_CONFIG_KEY, { fingerprint, retentionPolicyId: COMMUNICATION_RETENTION_POLICY_ID });
      }
    }).catch(error => {
      this.initialized = undefined;
      throw error instanceof CommunicationSafetyError ? error : new CommunicationSafetyError(503, "COMMUNICATION_CONFIGURATION_UNAVAILABLE");
    });
    await this.initialized;
  }
  assertIntake(): void {
    if (this.options.intakeEnabled === false) throw new CommunicationSafetyError(503, "COMMUNICATION_SAFETY_INTAKE_DISABLED");
  }
  capabilities() { return { contractVersion: "cop-account-safety-v1", reporting: this.options.intakeEnabled !== false, blocking: this.options.intakeEnabled !== false,
    accountDeletion: false, accountDeletionUrl: null, accountDeletionUnavailableReason: "erasure_adapters_not_accepted",
    reportContactEmail: this.options.contactEmail, retentionPolicyId: COMMUNICATION_RETENTION_POLICY_ID,
    evidence: "explicitly_selected_text_only", blockDelivery: "matrix_ignore_policy" }; }
  private reportOwner(report: Report): string {
    if (report.ownerKey) return report.ownerKey;
    if (report.reporter && report.reporterIssuer) return digest(JSON.stringify([report.reporterIssuer, report.reporter]));
    throw new CommunicationSafetyError(503, "REPORT_RETENTION_INVALID");
  }
  private inputHash(input: CommunicationReportInput): string {
    // An idempotency receipt keeps no recoverable excerpt or unkeyed text fingerprint.
    return createHmac("sha256", this.options.encryptionSecret).update("cop-communication-idempotency-v1\0").update(JSON.stringify(canonical(input))).digest("hex");
  }
  private async previous(tx: MobilityTransaction, key: string, ownerKey: string, input: CommunicationReportInput) {
    const previous = await tx.get<ReportOperation>(key);
    if (!previous) return undefined;
    const hash = previous.hashVersion === "hmac-v1" ? this.inputHash(input) : digest(JSON.stringify(canonical(input)));
    if (previous.hash !== hash) throw new CommunicationSafetyError(409, "IDEMPOTENCY_CONFLICT");
    const row = await tx.get<StoredReport>(reportPrefix + previous.reportId);
    if (!row) throw new CommunicationSafetyError(503, "REPORT_STORE_UNAVAILABLE");
    const report = this.open(row.sealed);
    if (this.reportOwner(report) !== ownerKey) throw new CommunicationSafetyError(503, "REPORT_STORE_UNAVAILABLE");
    await this.retain(tx, report);
    return this.publicReport(report);
  }
  async submit(actor: AuthenticatedActor, value: CommunicationReportInput, operationId: string) {
    this.requireErasureIdentity(actor);
    const input = normalizeCommunicationReport(value);
    if (!input) throw new CommunicationSafetyError(400, "VALIDATION_ERROR");
    await this.init();
    const ownerKey = digest(JSON.stringify([actor.issuer, actor.subjectId])), key = `communication-safety:operation:${ownerKey}:${operationId}`;
    const existing = await this.options.store.transact([key], async tx => {
      await this.assertWriterAllowed(tx, actor);
      return this.previous(tx, key, ownerKey, input);
    });
    if (existing) return existing; // A verified original receipt survives later removal of its target.
    this.assertIntake();
    const targetWitness = await this.options.validateTarget(actor, input.target);
    const now = this.now().toISOString();
    return this.options.store.transact([key], async tx => {
      // The target check can await a provider. Recheck the permanent fence in the
      // same transaction as every local write; a late validated request cannot
      // recreate deleted content or refer to an erased account.
      await this.assertWriterAllowed(tx, actor);
      await this.assertWriterAllowed(tx, { ...actor, issuer: targetWitness?.peerIssuer ?? actor.issuer, subjectId: input.target.peerSubjectId });
      const previous = await this.previous(tx, key, ownerKey, input);
      if (previous) return previous;
      const hour = now.slice(0, 13), rateKey = `communication-safety:rate:${ownerKey}:${hour}`;
      const count = await tx.get<number>(rateKey) ?? 0;
      if (count >= 20) throw new CommunicationSafetyError(429, "REPORT_RATE_LIMITED");
      const countAll = await tx.get<number>("communication-safety:report-count") ?? 0;
      if (countAll >= 10000) throw new CommunicationSafetyError(503, "REPORT_CAPACITY_UNAVAILABLE");
      const report: Report = { ...input, ownerKey, reporterIssuer: actor.issuer!,
        ...(targetWitness?.peerIssuer ? { targetIssuer: targetWitness.peerIssuer } : {}), reportId: randomUUID(), reporter: actor.subjectId, createdAt: now,
        status: "submitted", revision: 1, audit: [{ actor: actor.subjectId, actorIssuer: actor.issuer!, at: now, action: "submitted" }],
        provenance: { contractVersion: "cop-communication-report-v1", retentionPolicyId: COMMUNICATION_RETENTION_POLICY_ID, receivedAt: now } };
      this.prune(report);
      await tx.set(reportPrefix + report.reportId, { sealed: this.seal(report) });
      await tx.set(key, { hash: this.inputHash(input), hashVersion: "hmac-v1", reportId: report.reportId });
      await tx.set(rateKey, count + 1);
      await tx.set("communication-safety:report-count", countAll + 1);
      const index = await tx.get<Array<ReturnType<CommunicationSafetyService["summary"]>>>(pendingIndexKey) ?? [];
      index.push(this.summary(report));
      await tx.set(pendingIndexKey, index);
      return this.publicReport(report);
    });
  }
  async read(actor: AuthenticatedActor, id: string, operator = false) {
    this.requireErasureIdentity(actor);
    await this.init();
    const report = await this.options.store.transact([reportPrefix + id], async tx => {
      await this.assertWriterAllowed(tx, actor);
      const row = await tx.get<StoredReport>(reportPrefix + id);
      if (!row) throw new CommunicationSafetyError(404, "NOT_FOUND");
      const report = this.open(row.sealed);
      if (!operator && this.reportOwner(report) !== digest(JSON.stringify([actor.issuer, actor.subjectId]))) throw new CommunicationSafetyError(404, "NOT_FOUND");
      await this.retain(tx, report);
      return report;
    });
    // Retention has committed before this response; a 410 must not roll back the deletion.
    if (operator && report.detailsExpiredAt) throw new CommunicationSafetyError(410, "REPORT_DETAIL_EXPIRED");
    if (!operator) return this.publicReport(report);
    const detail = structuredClone(report);
    detail.audit = detail.audit.map(({ actorIssuer: _privateIssuer, ...entry }) => entry);
    delete detail.ownerKey; delete detail.provenance; delete detail.detailsExpiredAt; delete detail.targetIssuer;
    return detail;
  }
  async queue() {
    await this.pruneExpired();
    return this.options.store.transact([], async tx => (await tx.get<Array<ReturnType<CommunicationSafetyService["summary"]>>>(pendingIndexKey) ?? [])
      .sort((a,b) => a.createdAt.localeCompare(b.createdAt)).slice(0,100));
  }
  private summary(report: Report) { return {reportId:report.reportId,createdAt:report.createdAt,reason:report.reason!,status:report.status,revision:report.revision}; }
  async review(actor: AuthenticatedActor, id: string, input: { expectedRevision: number; status: "reviewing" | "resolved"; resolution?: "no_action" | "action_taken" }) {
    this.requireErasureIdentity(actor);
    await this.init();
    const result = await this.options.store.transact([reportPrefix + id], async tx => {
      await this.assertWriterAllowed(tx, actor);
      const row = await tx.get<StoredReport>(reportPrefix + id);
      if (!row) throw new CommunicationSafetyError(404, "NOT_FOUND");
      const report = this.open(row.sealed);
      await this.retain(tx, report);
      if (report.detailsExpiredAt) return { expired: true as const };
      if (report.revision !== input.expectedRevision || report.status === "resolved") return { conflict: true as const };
      report.status = input.status; report.revision += 1;
      if (input.resolution) report.resolution = input.resolution;
      const at = this.now().toISOString();
      if (input.status === "resolved") report.closedAt = earliest(report.closedAt, at);
      report.audit.push({ actor: actor.subjectId, actorIssuer: actor.issuer!, at, action: input.status });
      this.prune(report); // Closing never extends the original 90-day deadline.
      const index = (await tx.get<Array<ReturnType<CommunicationSafetyService["summary"]>>>(pendingIndexKey) ?? []).filter(entry => entry.reportId !== id);
      if (report.status !== "resolved") index.push(this.summary(report));
      await tx.set(pendingIndexKey, index);
      await tx.set(reportPrefix + id, { sealed: this.seal(report) });
      return { expired: false as const, receipt: this.publicReport(report) };
    });
    if ("expired" in result && result.expired) throw new CommunicationSafetyError(410, "REPORT_DETAIL_EXPIRED");
    if ("conflict" in result && result.conflict) throw new CommunicationSafetyError(409, "REPORT_REVISION_CONFLICT");
    if ("receipt" in result && result.receipt) return result.receipt;
    throw new CommunicationSafetyError(503, "REPORT_STORE_UNAVAILABLE");
  }

  /** COP-local moderation only. Canonical Matrix blocks are erased by the
   * messaging_matrix adapter, never inferred from local report removal. */
  accountErasureAdapter(): AccountErasureAdapter {
    return {
      id: "moderation_audit",
      ready: async () => { try { await this.init(); return true; } catch { return false; } },
      preflight: (actor, context) => this.erasurePreflight(actor, context.signal),
      erase: (actor, context) => this.eraseAccount(actor, context)
    };
  }

  async erasurePreflight(actor: AuthenticatedActor, signal: AbortSignal): Promise<AccountErasureAssessment> {
    this.requireErasureIdentity(actor); signal.throwIfAborted(); await this.init();
    try {
      return await this.options.store.transact([], async tx => {
        signal.throwIfAborted();
        const reports = await tx.scan<StoredReport>(reportPrefix);
        for (const row of reports) if (!this.erasureProvenanceKnown(this.open(row.value.sealed), actor)) {
          return { ready: false, reason: "ownership_unresolved" };
        }
        return { ready: true, version: "cop-moderation-erasure-v1" };
      });
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof CommunicationSafetyError) throw error;
      throw new CommunicationSafetyError(503, "MODERATION_ERASURE_UNAVAILABLE");
    }
  }

  async eraseAccount(actor: AuthenticatedActor, context: { operationId: string; signal: AbortSignal }): Promise<AccountErasureProof> {
    this.requireErasureIdentity(actor); context.signal.throwIfAborted(); await this.init();
    const ownerKey = this.erasureOwner(actor), fence = erasurePrefix + ownerKey;
    try {
      return await this.options.store.transact([fence], async tx => {
        context.signal.throwIfAborted();
        const existing = await tx.get<{ operationId: string; proofId?: string }>(fence);
        if (existing && existing.operationId !== context.operationId) throw new CommunicationSafetyError(409, "MODERATION_ERASURE_OPERATION_CONFLICT");
        // The fence is committed even when historical provenance remains unknown.
        // It contains no subject, display name, excerpt or provider credential.
        await tx.set(fence, existing ?? { operationId: context.operationId });
        const reports = await tx.scan<StoredReport>(reportPrefix);
        if (reports.some(row => !this.erasureProvenanceKnown(this.open(row.value.sealed), actor))) {
          return { status: "pending", remaining: "cleanup_pending" };
        }
        const removed = new Set<string>();
        for (const row of reports) {
          context.signal.throwIfAborted();
          const report = this.open(row.value.sealed);
          if (this.reportOwner(report) === ownerKey) {
            removed.add(report.reportId); await tx.remove(row.key); continue;
          }
          const before = JSON.stringify(report);
          report.audit = report.audit.filter(entry => !(entry.actor === actor.subjectId && entry.actorIssuer === actor.issuer));
          if (report.target?.peerSubjectId === actor.subjectId && report.targetIssuer === actor.issuer) {
            // Another reporter's content-free status remains. Their selected text
            // can mention the erased person and is not retained as an audit body.
            delete report.target; delete report.targetIssuer; delete report.evidence; delete report.reason;
            report.detailsExpiredAt = this.now().toISOString();
          }
          if (JSON.stringify(report) !== before) await tx.set(row.key, { sealed: this.seal(report) });
        }
        for (const prefix of [`communication-safety:operation:${ownerKey}:`, `communication-safety:rate:${ownerKey}:`]) {
          for (const row of await tx.scan(prefix)) await tx.remove(row.key);
        }
        const index = await tx.get<Array<ReturnType<CommunicationSafetyService["summary"]>>>(pendingIndexKey) ?? [];
        const active = new Set((await tx.scan<StoredReport>(reportPrefix)).map(row => this.open(row.value.sealed))
          .filter(report => !report.detailsExpiredAt && report.status !== "resolved").map(report => report.reportId));
        await tx.set(pendingIndexKey, index.filter(entry => active.has(entry.reportId)));
        const count = await tx.get<number>("communication-safety:report-count") ?? 0;
        await tx.set("communication-safety:report-count", Math.max(0, count - removed.size));
        // Read back all retained reports and idempotency/rate links before proof.
        for (const row of await tx.scan<StoredReport>(reportPrefix)) {
          if (this.reportHasActorLink(this.open(row.value.sealed), actor)) return { status: "pending", remaining: "cleanup_pending" };
        }
        for (const prefix of [`communication-safety:operation:${ownerKey}:`, `communication-safety:rate:${ownerKey}:`]) {
          if ((await tx.scan(prefix)).length) return { status: "pending", remaining: "cleanup_pending" };
        }
        context.signal.throwIfAborted();
        const proofId = existing?.proofId ?? randomUUID(); await tx.set(fence, { operationId: context.operationId, proofId });
        return { status: "completed", proofId };
      });
    } catch (error) {
      context.signal.throwIfAborted();
      if (error instanceof CommunicationSafetyError) throw error;
      throw new CommunicationSafetyError(503, "MODERATION_ERASURE_UNAVAILABLE");
    }
  }

  private requireErasureIdentity(actor: AuthenticatedActor): void {
    if (actor.authMode !== "oidc" || !actor.issuer || !actor.subjectId) throw new CommunicationSafetyError(401, "UNAUTHORIZED");
  }
  private erasureOwner(actor: AuthenticatedActor): string { return digest(JSON.stringify([actor.issuer, actor.subjectId])); }
  private async assertWriterAllowed(tx: MobilityTransaction, actor: AuthenticatedActor): Promise<void> {
    if (await tx.get(erasurePrefix + this.erasureOwner(actor))) throw new CommunicationSafetyError(403, "ACCOUNT_ERASURE_FENCED");
  }
  private erasureProvenanceKnown(report: Report, actor: AuthenticatedActor): boolean {
    if (report.reporter === actor.subjectId && !report.reporterIssuer) return false;
    if (report.reporter === actor.subjectId && report.reporterIssuer === actor.issuer && this.reportOwner(report) !== this.erasureOwner(actor)) return false;
    if (report.target?.peerSubjectId === actor.subjectId && !report.targetIssuer) return false;
    if (report.audit.some(entry => entry.actor === actor.subjectId && !entry.actorIssuer)) return false;
    return true;
  }
  private reportHasActorLink(report: Report, actor: AuthenticatedActor): boolean {
    return this.reportOwner(report) === this.erasureOwner(actor)
      || (report.reporter === actor.subjectId && report.reporterIssuer === actor.issuer)
      || (report.target?.peerSubjectId === actor.subjectId && report.targetIssuer === actor.issuer)
      || report.audit.some(entry => entry.actor === actor.subjectId && entry.actorIssuer === actor.issuer);
  }
  /** Trusted periodic worker. Concurrent callers share one run; all purges/checkpoints/index changes commit atomically. */
  pruneExpired(): Promise<CommunicationRetentionResult> {
    if (!this.pruning) this.pruning = this.init().then(() => this.options.store.transact(["communication-safety:retention-worker-v1"], async tx => {
      const result: CommunicationRetentionResult = { reportsChanged: 0, evidencePurged: 0, detailsPurged: 0, auditEventsPurged: 0 };
      for (const entry of await tx.scan<StoredReport>(reportPrefix)) {
        const report = this.open(entry.value.sealed), before = JSON.stringify(report), hadEvidence = !!report.evidence,
          auditCount = report.audit.length, hadDetails = !report.detailsExpiredAt;
        this.prune(report);
        if (JSON.stringify(report) !== before) {
          await tx.set(entry.key, { sealed: this.seal(report) }); result.reportsChanged += 1;
          if (hadEvidence && !report.evidence) result.evidencePurged += 1;
          if (hadDetails && report.detailsExpiredAt) result.detailsPurged += 1;
          result.auditEventsPurged += auditCount - report.audit.length;
        }
      }
      const index = await tx.get<Array<ReturnType<CommunicationSafetyService["summary"]>>>(pendingIndexKey) ?? [];
      const now = this.now().getTime();
      await tx.set(pendingIndexKey, index.filter(entry => Number.isFinite(Date.parse(entry.createdAt)) && Date.parse(entry.createdAt) + 180 * dayMs > now));
      return result;
    })).catch(() => { throw new CommunicationSafetyError(503, "REPORT_RETENTION_UNAVAILABLE"); }).finally(() => { this.pruning = undefined; });
    return this.pruning;
  }
  private async retain(tx: MobilityTransaction, report: Report): Promise<void> {
    const before = JSON.stringify(report); this.prune(report);
    if (JSON.stringify(report) !== before) await tx.set(reportPrefix + report.reportId, { sealed: this.seal(report) });
    if (report.detailsExpiredAt) {
      const index = await tx.get<Array<ReturnType<CommunicationSafetyService["summary"]>>>(pendingIndexKey) ?? [];
      await tx.set(pendingIndexKey, index.filter(entry => entry.reportId !== report.reportId));
    }
  }
  private prune(report: Report): void {
    const created = Date.parse(report.createdAt), now = this.now().getTime();
    if (!Number.isFinite(created) || !Number.isFinite(now)) throw new CommunicationSafetyError(503, "REPORT_RETENTION_INVALID");
    report.ownerKey = this.reportOwner(report);
    report.provenance ??= { contractVersion: "cop-communication-report-v1", retentionPolicyId: COMMUNICATION_RETENTION_POLICY_ID, receivedAt: report.createdAt };
    for (const entry of report.audit) if (entry.action === "resolved" && Number.isFinite(Date.parse(entry.at))) report.closedAt = earliest(report.closedAt, entry.at);
    // Legacy terminal reports without a closure timestamp expire conservatively; no guessed later deadline.
    if (report.status === "resolved" && !report.closedAt) report.closedAt = report.createdAt;
    if (report.closedAt && !Number.isFinite(Date.parse(report.closedAt))) throw new CommunicationSafetyError(503, "REPORT_RETENTION_INVALID");
    const evidenceExpiry = Math.min(created + 90 * dayMs, report.closedAt ? Date.parse(report.closedAt) + 30 * dayMs : Infinity);
    report.evidenceExpiresAt = new Date(Math.min(evidenceExpiry, report.evidenceExpiresAt ? Date.parse(report.evidenceExpiresAt) : Infinity)).toISOString();
    if (now >= Date.parse(report.evidenceExpiresAt)) delete report.evidence;
    report.audit = report.audit.filter(entry => Number.isFinite(Date.parse(entry.at)) && Date.parse(entry.at) + 180 * dayMs > now);
    if (now >= created + 180 * dayMs) {
      report.detailsExpiredAt ??= new Date(created + 180 * dayMs).toISOString();
      delete report.target; delete report.reason; delete report.reporter; delete report.reporterIssuer; delete report.evidence;
      report.audit = []; // The durable own receipt carries no moderator identities or historical report body.
    }
  }
  private publicReport(report: Report) { return { reportId: report.reportId, createdAt: report.createdAt, status: report.status,
    revision: report.revision, ...(report.resolution ? { resolution: report.resolution } : {}) }; }
  private seal(report: Report) {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", createHash("sha256").update("cop-communication-reports-v1\0").update(this.options.encryptionSecret).digest(), iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(report)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
  }
  private open(value: string): Report {
    const bytes = Buffer.from(value, "base64"), cipher = createDecipheriv("aes-256-gcm", createHash("sha256").update("cop-communication-reports-v1\0").update(this.options.encryptionSecret).digest(), bytes.subarray(0,12));
    cipher.setAuthTag(bytes.subarray(12,28));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8")) as Report;
  }
}
function earliest(existing: string | undefined, candidate: string): string { return !existing || Date.parse(candidate) < Date.parse(existing) ? candidate : existing; }
export class MessagingCommunicationPolicy implements CommunicationPolicy {
  constructor(private readonly config: { baseUrl: string; token?: string; timeoutMs: number }) {}
  async block(owner: string, peer: string, blocked?: boolean) {
    const body = await this.request(owner, `/api/v1/communication/blocks/${encodeURIComponent(peer)}`,
      blocked === undefined ? "GET" : "PUT", blocked === undefined ? undefined : { blocked });
    const result = body.result;
    const value = blocked === undefined ? result : isRecord(result) ? result.blocked : undefined;
    if (typeof value !== "boolean") throw new CommunicationSafetyError(503, "COMMUNICATION_POLICY_UNAVAILABLE");
    return value;
  }
  async directAllowed(owner: string, peer: string) {
    const body = await this.request(owner, "/api/v1/communication/direct-allowed", "POST", { peerId: peer });
    if (typeof body.result !== "boolean") throw new CommunicationSafetyError(503, "COMMUNICATION_POLICY_UNAVAILABLE");
    return body.result;
  }
  async eventMatchesPeer(owner: string, peer: string, room: string, event: string) {
    const body = await this.request(owner, "/api/v1/communication/event-verified", "POST", { peerId: peer, roomId: room, eventId: event });
    if (typeof body.result !== "boolean") throw new CommunicationSafetyError(503, "COMMUNICATION_POLICY_UNAVAILABLE");
    return body.result;
  }
  private async request(owner: string, path: string, method: string, input?: unknown): Promise<Record<string,unknown>> {
    try {
      if (!this.config.token) throw new Error("not configured");
      const response = await fetch(this.config.baseUrl.replace(/\/$/u, "") + path, { method,
        headers: { authorization: `Bearer ${this.config.token}`, "x-csm-user-id": owner, "content-type": "application/json" },
        redirect: "error", signal: AbortSignal.timeout(Math.min(this.config.timeoutMs, 10000)), ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
      if (!response.ok) { await response.body?.cancel(); throw new Error("unavailable"); }
      const bytes = await readBoundedBody(response, 32 * 1024);
      const body: unknown = JSON.parse(bytes.toString("utf8"));
      if (!isRecord(body) || body.contractVersion !== "csm-communication-safety-v1") throw new Error("invalid response");
      return body;
    } catch { throw new CommunicationSafetyError(503, "COMMUNICATION_POLICY_UNAVAILABLE"); }
  }
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])]));
  return value;
}
function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
function isRecord(value: unknown): value is Record<string,unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function exactKeys(input: Record<string,unknown>, required: string[], optional: string[] = []) {
  return required.every(key => Object.hasOwn(input,key)) && Object.keys(input).every(key => [...required,...optional].includes(key));
}
export function normalizeCommunicationReport(value: unknown): CommunicationReportInput | null {
  if (!isRecord(value) || !exactKeys(value,["target","reason"],["evidence"]) || !isRecord(value.target) ||
    typeof value.reason !== "string" || !["harassment","threats","spam","sexual_content","other"].includes(value.reason)) return null;
  const target = value.target;
  if (typeof target.peerSubjectId !== "string" || !target.peerSubjectId.trim() || Buffer.byteLength(target.peerSubjectId, "utf8") > 256) return null;
  const refs = target.kind === "call" ? ["callId"] : target.kind === "message" ? ["conversationId","eventId"] : target.kind === "user" ? ["conversationId"] : [];
  if (!refs.length || !exactKeys(target,["kind","peerSubjectId",...refs]) || refs.some(key => typeof target[key] !== "string" || !(target[key] as string).trim() || Buffer.byteLength(target[key] as string, "utf8") > 255)) return null;
  if (target.kind === "message" && !(target.eventId as string).startsWith("$")) return null;
  if (target.kind === "call" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(target.callId as string)) return null;
  if (value.evidence !== undefined && (!isRecord(value.evidence) || !exactKeys(value.evidence,["selectedText","explicitlyConfirmed"]) ||
    value.evidence.explicitlyConfirmed !== true || typeof value.evidence.selectedText !== "string" || !value.evidence.selectedText.trim() ||
    Buffer.byteLength(value.evidence.selectedText) > 4096)) return null;
  return structuredClone(value) as unknown as CommunicationReportInput;
}
export function registerCommunicationSafetyRoutes(app: FastifyInstance, service?: CommunicationSafetyService, verifiedActor: (request: FastifyRequest) => AuthenticatedActor | null = actorFromRequest,
  accountDeletion?: () => Promise<{ accountDeletion: boolean }>) {
  const actor = (request: FastifyRequest) => {
    const value = verifiedActor(request);
    if (!value || value.authMode !== "oidc" || !value.issuer) throw new CommunicationSafetyError(401,"UNAUTHORIZED");
    return value;
  };
  const route = (method: "GET"|"POST"|"PUT"|"PATCH", url: string, handler: (r: FastifyRequest, a: AuthenticatedActor, s: CommunicationSafetyService) => Promise<unknown>, operator = false) => {
    app.route({ method,url,bodyLimit:16384,config:{ rateLimit: { max:60,timeWindow:"1 minute" } },async handler(request,reply) {
      reply.header("Cache-Control","no-store");
      try {
        const a = actor(request);
        if (!service) throw new CommunicationSafetyError(503,"COMMUNICATION_SAFETY_UNAVAILABLE");
        await service.init();
        if (operator && !a.roles?.includes(service.options.moderatorRole)) throw new CommunicationSafetyError(403,"FORBIDDEN");
        const value = await handler(request,a,service);
        return reply.send(value);
      } catch(error) {
        const known = error instanceof CommunicationSafetyError ? error : new CommunicationSafetyError(503,"COMMUNICATION_SAFETY_UNAVAILABLE");
        if (known.status === 429) reply.header("Retry-After","3600");
        return sendError(reply,known.status,known.code,"Požadavek nyní nelze dokončit.",correlationIdFrom(request.headers["x-correlation-id"]));
      }
    } });
  };
  app.get("/api/v1/me/account-safety/capabilities", async (request,reply) => {
    reply.header("Cache-Control","no-store");
    try { actor(request); }
    catch { return sendError(reply,401,"UNAUTHORIZED","Je nutná ověřená relace COP.",correlationIdFrom(request.headers["x-correlation-id"])); }
    try {
      const capabilities = service?.capabilities() ?? { contractVersion:"cop-account-safety-v1", reporting:false,blocking:false,accountDeletion:false,
      accountDeletionUrl:null,accountDeletionUnavailableReason:"erasure_adapters_not_accepted", reportContactEmail:"podpora@zeleznalady.cz",
      evidence:"explicitly_selected_text_only",blockDelivery:"matrix_ignore_policy" };
      // Published native v1 decoders intentionally accept only false/null.
      // Explicit negotiation prevents an activation from breaking their report
      // and block UI. The web deletion controller has its own capability route.
      if (!accountDeletion || request.headers["x-cop-account-erasure-link"] !== "canonical-web-v1") return capabilities;
      const deletion = await accountDeletion();
      return { ...capabilities, accountDeletion: deletion.accountDeletion === true,
        accountDeletionUrl: deletion.accountDeletion === true ? "/account/delete" : null,
        accountDeletionUnavailableReason: deletion.accountDeletion === true ? null : "erasure_adapters_not_accepted" };
    } catch { return sendError(reply,503,"COMMUNICATION_SAFETY_UNAVAILABLE","Dostupnost správy účtu nyní nelze ověřit.",correlationIdFrom(request.headers["x-correlation-id"])); }
  });
  route("POST","/api/v1/me/communication/reports", async(r,a,s) => {
    const input = normalizeCommunicationReport(r.body), operation = r.headers["idempotency-key"];
    if (!input || typeof operation !== "string" || !/^[A-Za-z0-9_-]{16,128}$/u.test(operation)) throw new CommunicationSafetyError(400,"VALIDATION_ERROR");
    return s.submit(a,input,operation);
  });
  route("GET","/api/v1/me/communication/reports/:reportId", (r,a,s) => s.read(a, (r.params as {reportId:string}).reportId));
  route("POST","/api/v1/me/communication/blocks/query", async(r,a,s) => {
    if (!isRecord(r.body) || !exactKeys(r.body,["peerSubjectId"])) throw new CommunicationSafetyError(400,"VALIDATION_ERROR");
    const peer = r.body.peerSubjectId;
    if (typeof peer !== "string" || !peer || Buffer.byteLength(peer, "utf8") > 256 || peer === a.subjectId) throw new CommunicationSafetyError(400,"VALIDATION_ERROR");
    return { peerSubjectId:peer,blocked:await s.options.policy.block(a.subjectId,peer) };
  });
  route("PUT","/api/v1/me/communication/blocks", async(r,a,s) => {
    const peer = isRecord(r.body) ? r.body.peerSubjectId : undefined;
    if (typeof peer !== "string" || !peer || Buffer.byteLength(peer, "utf8") > 256 || peer === a.subjectId || !isRecord(r.body) || !exactKeys(r.body,["peerSubjectId","blocked"]) || typeof r.body.blocked !== "boolean") throw new CommunicationSafetyError(400,"VALIDATION_ERROR");
    if (r.body.blocked) s.assertIntake();
    return { peerSubjectId:peer,blocked:await s.options.policy.block(a.subjectId,peer,r.body.blocked) };
  });
  route("GET","/api/v1/moderation/communication/reports", async(_r,_a,s) => ({items:await s.queue()}),true);
  route("GET","/api/v1/moderation/communication/reports/:reportId", (r,a,s) => s.read(a,(r.params as {reportId:string}).reportId,true),true);
  route("PATCH","/api/v1/moderation/communication/reports/:reportId", async(r,a,s) => {
    const input = r.body;
    if (!isRecord(input) || !exactKeys(input,["expectedRevision","status"],["resolution"]) || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision)<1 ||
      typeof input.status !== "string" || !["reviewing","resolved"].includes(input.status) || (input.status === "resolved" ? (typeof input.resolution !== "string" || !["no_action","action_taken"].includes(input.resolution)) : input.resolution !== undefined)) throw new CommunicationSafetyError(400,"VALIDATION_ERROR");
    return s.review(a,(r.params as {reportId:string}).reportId,input as unknown as Parameters<CommunicationSafetyService["review"]>[2]);
  },true);
}
