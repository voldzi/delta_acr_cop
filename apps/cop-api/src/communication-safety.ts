import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { MobilityStore } from "./mobility-store.js";
import type { AuthenticatedActor } from "./security.js";
import { actorFromRequest } from "./security.js";
import { correlationIdFrom, sendError } from "./errors.js";
import { readBoundedBody } from "./bounded-upstream.js";

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
interface Report extends CommunicationReportInput {
  reportId: string; reporter: string; reporterIssuer: string; createdAt: string; status: "submitted" | "reviewing" | "resolved";
  resolution?: "no_action" | "action_taken"; revision: number;
  audit: { actor: string; at: string; action: string }[];
}
export type ValidateReportTarget = (actor: AuthenticatedActor, input: CommunicationReportInput["target"]) => Promise<void>;

/** All endpoints use the authenticated COP subject. No caller can supply a reporter or payer. */
export class CommunicationSafetyService {
  constructor(readonly options: { store: MobilityStore; policy: CommunicationPolicy; encryptionSecret: string;
    validateTarget: ValidateReportTarget; now?: () => Date; moderatorRole: string; contactEmail: string; retentionPolicyId: string }) {
    if (options.encryptionSecret.length < 32 || !options.moderatorRole || !options.contactEmail || !options.retentionPolicyId) {
      throw new Error("Communication safety requires encryption, an operator and an approved retention policy.");
    }
  }
  now() { return this.options.now?.() ?? new Date(); }
  capabilities() { return { contractVersion: "cop-account-safety-v1", reporting: true, blocking: true,
    accountDeletion: false, accountDeletionUnavailableReason: "scope_and_erasure_adapters_not_accepted",
    reportContactEmail: this.options.contactEmail, retentionPolicyId: this.options.retentionPolicyId,
    evidence: "explicitly_selected_text_only", blockDelivery: "matrix_ignore_policy" }; }
  async submit(actor: AuthenticatedActor, input: CommunicationReportInput, operationId: string) {
    await this.options.validateTarget(actor, input.target);
    const now = this.now().toISOString();
    const ownerKey = digest(JSON.stringify([actor.issuer, actor.subjectId])), key = `communication-safety:operation:${ownerKey}:${operationId}`;
    const hash = digest(JSON.stringify(canonical(input)));
    return this.options.store.transact([key], async tx => {
      const previous = await tx.get<{ hash: string; reportId: string }>(key);
      if (previous) {
        if (previous.hash !== hash) throw new CommunicationSafetyError(409, "IDEMPOTENCY_CONFLICT");
        const report = await tx.get<{ sealed: string }>(`communication-safety:report:${previous.reportId}`);
        if (!report) throw new CommunicationSafetyError(503, "REPORT_STORE_UNAVAILABLE");
        return this.publicReport(this.open(report.sealed));
      }
      const hour = now.slice(0, 13), rateKey = `communication-safety:rate:${ownerKey}:${hour}`;
      const count = await tx.get<number>(rateKey) ?? 0;
      if (count >= 20) throw new CommunicationSafetyError(429, "REPORT_RATE_LIMITED");
      const countAll = await tx.get<number>("communication-safety:report-count") ?? 0;
      if (countAll >= 10000) throw new CommunicationSafetyError(503, "REPORT_CAPACITY_UNAVAILABLE");
      const report: Report = { ...input, reporterIssuer: actor.issuer!, reportId: randomUUID(), reporter: actor.subjectId, createdAt: now,
        status: "submitted", revision: 1, audit: [{ actor: actor.subjectId, at: now, action: "submitted" }] };
      await tx.set(`communication-safety:report:${report.reportId}`, { sealed: this.seal(report) });
      await tx.set(key, { hash, reportId: report.reportId });
      await tx.set(rateKey, count + 1);
      await tx.set("communication-safety:report-count", countAll + 1);
      const index = await tx.get<Array<ReturnType<CommunicationSafetyService["summary"]>>>("communication-safety:pending-index") ?? [];
      index.push(this.summary(report));
      await tx.set("communication-safety:pending-index", index);
      return this.publicReport(report);
    });
  }
  async read(actor: AuthenticatedActor, id: string, operator = false) {
    return this.options.store.transact([], async tx => {
      const row = await tx.get<{ sealed: string }>(`communication-safety:report:${id}`);
      if (!row) throw new CommunicationSafetyError(404, "NOT_FOUND");
      const report = this.open(row.sealed);
      if (!operator && (report.reporter !== actor.subjectId || report.reporterIssuer !== actor.issuer)) throw new CommunicationSafetyError(404, "NOT_FOUND");
      return operator ? report : this.publicReport(report);
    });
  }
  async queue() {
    return this.options.store.transact([], async tx => (await tx.get<Array<ReturnType<CommunicationSafetyService["summary"]>>>("communication-safety:pending-index") ?? [])
      .sort((a,b) => a.createdAt.localeCompare(b.createdAt)).slice(0,100));
  }
  private summary(report: Report) { return {reportId:report.reportId,createdAt:report.createdAt,reason:report.reason,status:report.status,revision:report.revision}; }
  async review(actor: AuthenticatedActor, id: string, input: { expectedRevision: number; status: "reviewing" | "resolved"; resolution?: "no_action" | "action_taken" }) {
    return this.options.store.transact([`communication-safety:report:${id}`], async tx => {
      const row = await tx.get<{ sealed: string }>(`communication-safety:report:${id}`);
      if (!row) throw new CommunicationSafetyError(404, "NOT_FOUND");
      const report = this.open(row.sealed);
      if (report.revision !== input.expectedRevision || report.status === "resolved") throw new CommunicationSafetyError(409, "REPORT_REVISION_CONFLICT");
      report.status = input.status; report.revision += 1;
      if (input.resolution) report.resolution = input.resolution;
      report.audit.push({ actor: actor.subjectId, at: this.now().toISOString(), action: input.status });
      const index = (await tx.get<Array<ReturnType<CommunicationSafetyService["summary"]>>>("communication-safety:pending-index") ?? []).filter(entry => entry.reportId !== id);
      if (report.status !== "resolved") index.push(this.summary(report));
      await tx.set("communication-safety:pending-index", index);
      await tx.set(`communication-safety:report:${id}`, { sealed: this.seal(report) });
      return this.publicReport(report);
    });
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
  if (typeof target.peerSubjectId !== "string" || !target.peerSubjectId.trim() || target.peerSubjectId.length > 256) return null;
  const refs = target.kind === "call" ? ["callId"] : target.kind === "message" ? ["conversationId","eventId"] : target.kind === "user" ? ["conversationId"] : [];
  if (!refs.length || !exactKeys(target,["kind","peerSubjectId",...refs]) || refs.some(key => typeof target[key] !== "string" || !(target[key] as string).trim() || (target[key] as string).length > 255)) return null;
  if (target.kind === "message" && !(target.eventId as string).startsWith("$")) return null;
  if (target.kind === "call" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(target.callId as string)) return null;
  if (value.evidence !== undefined && (!isRecord(value.evidence) || !exactKeys(value.evidence,["selectedText","explicitlyConfirmed"]) ||
    value.evidence.explicitlyConfirmed !== true || typeof value.evidence.selectedText !== "string" || !value.evidence.selectedText.trim() ||
    Buffer.byteLength(value.evidence.selectedText) > 4096)) return null;
  return structuredClone(value) as unknown as CommunicationReportInput;
}
export function registerCommunicationSafetyRoutes(app: FastifyInstance, service?: CommunicationSafetyService, verifiedActor: (request: FastifyRequest) => AuthenticatedActor | null = actorFromRequest) {
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
    try { actor(request); return service?.capabilities() ?? { contractVersion:"cop-account-safety-v1", reporting:false,blocking:false,accountDeletion:false,
      accountDeletionUnavailableReason:"scope_and_erasure_adapters_not_accepted", evidence:"explicitly_selected_text_only",blockDelivery:"matrix_ignore_policy" }; }
    catch { return sendError(reply,401,"UNAUTHORIZED","Je nutná ověřená relace COP.",correlationIdFrom(request.headers["x-correlation-id"])); }
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
    if (typeof peer !== "string" || !peer || peer.length > 256 || peer === a.subjectId) throw new CommunicationSafetyError(400,"VALIDATION_ERROR");
    return { peerSubjectId:peer,blocked:await s.options.policy.block(a.subjectId,peer) };
  });
  route("PUT","/api/v1/me/communication/blocks", async(r,a,s) => {
    const peer = isRecord(r.body) ? r.body.peerSubjectId : undefined;
    if (typeof peer !== "string" || !peer || peer.length > 256 || peer === a.subjectId || !isRecord(r.body) || !exactKeys(r.body,["peerSubjectId","blocked"]) || typeof r.body.blocked !== "boolean") throw new CommunicationSafetyError(400,"VALIDATION_ERROR");
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
