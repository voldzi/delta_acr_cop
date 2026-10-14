import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { opaqueUserId } from "./ai-router-chat.js";
import { contributorIdDay } from "./driver-measurement-contract.js";
import { readBoundedBody } from "./bounded-upstream.js";
import { AccountErasureError, type AccountErasureAdapter, type AccountErasureAssessment, type AccountErasureProof } from "./account-erasure.js";
import type { AuthenticatedActor } from "./security.js";

export type SimErasureOwner = "ai_router" | "sim_measurements";
export interface SimAccountErasureOptions {
  baseUrl: string; token: string; issuer: string; actorSecret: string; userIdSecret: string;
  timeoutMs?: number; now?: () => Date;
  /** Live protected native/runtime/store/restore authority for this exact source.
   * No env boolean, historical health or process generation substitutes for it.
   * Must cover the approved COP/Jizda-only boundary, preserve SIM/IZS identity
   * and usage, and accept explicitly excluded provider retention. */
  verifyConfiguredOwner?: (owner: SimErasureOwner, context: { origin: string; signal: AbortSignal }) => Promise<boolean>;
  /** Actual issuer + legacy alias/derivation/key-version review. A new alias or
   * guessed historical mapping must never be used to produce an empty proof. */
  reviewExistingIdentity?: (actor: AuthenticatedActor, context: { routerUserId: string; signal: AbortSignal }) => Promise<{ reviewed: true; version: string } | { reviewed: false }>;
}
export interface SimDriverErasureInventory {
  /** Immutable actual operation inventory, stable after its first SIM acceptance.
   * The owner must preserve this review across local cleanup/restart/restore. */
  version: string; retainedComplete: true; outboxComplete: true; keyVersionsComplete: true;
  retainedDays: string[]; outboxDays: string[];
  /** All actually used historical versions, supplied by a protected server-only
   * inventory. Secrets remain memory-only; no key/version goes into HTTP body. */
  keys: Array<{ version: string; secret: string }>;
}
export interface SimMeasurementsErasureOptions extends SimAccountErasureOptions {
  inventory?: (actor: AuthenticatedActor, context: { operationId: string; coverageAnchorAt: string; signal: AbortSignal }) => Promise<SimDriverErasureInventory | null>;
}
const VERSION = "sim-account-erasure-v1", COST = "aggregate-costs-current-month-v1";
const ROUTER = "/api/v1/ai-router/cop/users/me/erasure-operations", DRIVER = "/api/v1/internal/driver-measurements/v1/account-erasure-operations";
const HEX = /^[0-9a-f]{64}$/u, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const bool = z.boolean(), time = z.iso.datetime({ offset: false }), count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const protections = z.enum(["unverified", "no_report", "enforced_single_writer", "shared_generation_fence"]);
const blockers = z.enum(["erasure_disabled", "schema_not_ready", "permissions_not_ready", "identity_review_required", "restore_checkpoint_not_current", "retention_review_required", "publication_proof_required", "provider_requests_pending", "identity_binding_review_required"]);
const checks = { schemaReady: bool, permissionsReady: bool, identityReviewed: bool, restoreCheckpointCurrent: bool, retentionReviewed: bool };
const probe = { contractVersion: z.literal(VERSION), enabled: bool, ready: bool, checkedAt: time, blockers: z.array(blockers).max(9),
  mutates: z.literal(false), providerCalls: z.literal(false), wholeAccountComplete: z.literal(false) };
const routerCap = z.strictObject({ ...probe, owner: z.literal("ai_router"), scope: z.literal("cop_router_primary_database"), checks: z.strictObject(checks), costPolicy: z.enum(["pending_requires_review", COST]) });
const driverCap = z.strictObject({ ...probe, owner: z.literal("sim_measurements"), scope: z.literal("online_driver_scope"), checks: z.strictObject({ ...checks, publicationFenceVerified: bool }), reportProtection: protections });
const routerPreflight = routerCap.extend({ operationId: z.uuid(), identityBinding: z.literal("cop_attested_existing_router_alias"), checks: z.strictObject({ ...checks, identityBindingReviewed: bool, providerRequestsSettled: bool }) });
const driverPreflight = driverCap.extend({ operationId: z.uuid(), identityBinding: z.literal("cop_attested_daily_manifest"), checks: z.strictObject({ ...checks, publicationFenceVerified: bool, identityBindingReviewed: bool, manifestShapeAndCoverageValid: bool }),
  coverageAnchor: z.strictObject({ kind: z.enum(["checked_at", "first_accepted_at"]), at: time }), contributorCount: count.min(9).max(40), manifestValid: z.literal(true) });
const routerReceipt = z.strictObject({ contractVersion: z.literal(VERSION), operationId: z.uuid(), status: z.enum(["pending", "online_complete"]), scope: z.literal("cop_router_primary_database"),
  pendingReasons: z.array(z.enum(["provider_requests_pending", "cost_retention_review_required", "backup_replay_not_ready", "erasure_processing_pending"])).max(4), pendingRequestCount: count, onlineScopeComplete: bool,
  wholeAccountComplete: z.literal(false), backupsComplete: z.literal(false), providerRetentionComplete: z.literal(false), retainedMinimumReplayFence: z.literal(true), aliasScope: z.literal("sim_izs_preserved_out_of_scope") });
const driverReceipt = z.strictObject({ contractVersion: z.literal(VERSION), operationId: z.uuid(), status: z.enum(["pending", "completed"]), scope: z.literal("online_driver_scope"),
  wholeAccountComplete: z.literal(false), backupReplayRequired: z.literal(true), acceptedAt: time, updatedAt: time, contributorCount: count.min(9).max(40), deletedBatchCount: count, remainingBatchCount: count,
  databaseZeroVerified: bool, derivedReportAcknowledged: bool, reportProtection: protections, publicationFenceVerified: bool, replayReady: bool, retentionReviewed: bool,
  pendingReason: z.enum(["replay_review_required", "publisher_review_required", "retention_review_required", "derived_report_pending", "stored_rows_remaining"]).nullable() });
const pending = (): AccountErasureProof => ({ status: "pending", remaining: "cleanup_pending" });
const unavailable = (): AccountErasureAssessment => ({ ready: false, reason: "adapter_unavailable" });
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function requireActor(actor: AuthenticatedActor, issuer: string): void {
  if (actor.authMode !== "oidc" || actor.issuer !== issuer || !actor.subjectId || actor.subjectId.length > 512 || /[\u0000-\u001f\u007f]/u.test(actor.subjectId)) throw new AccountErasureError(401, "UNAUTHORIZED");
}
function requireOperation(value?: string): string {
  if (!value || !UUID.test(value)) throw new AccountErasureError(400, "INVALID_ERASURE_OPERATION"); return value.toLowerCase();
}
async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void promise.catch(() => undefined); signal.throwIfAborted(); }
  let listener: (() => void) | undefined;
  const abort = new Promise<never>((_, reject) => { listener = () => reject(new Error("SIM_ERASURE_UNAVAILABLE")); signal.addEventListener("abort", listener, { once: true }); });
  try { return await Promise.race([promise, abort]); } finally { if (listener) signal.removeEventListener("abort", listener); }
}
class Client {
  readonly options: SimAccountErasureOptions;
  private readonly root?: URL;
  private readonly path: string;
  constructor(options: SimAccountErasureOptions, readonly owner: SimErasureOwner) {
    this.options = { ...options }; this.path = owner === "ai_router" ? ROUTER : DRIVER;
    try {
      const root = new URL(options.baseUrl), issuer = new URL(options.issuer);
      if (!["http:", "https:"].includes(root.protocol) || root.username || root.password || root.search || root.hash ||
          issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.search || issuer.hash ||
          options.actorSecret.length < 32 || options.userIdSecret.length < 32 || options.token.length < 32 || /[\u0000-\u001f\u007f]/u.test(options.token)) return;
      const prefix = root.pathname.replace(/\/$/u, "");
      if (owner === "ai_router" && prefix !== "") return;
      if (owner === "sim_measurements") {
        if (prefix === "/situation-data") this.path = "/situation-data" + DRIVER;
        else if (prefix === "/api/v1/internal/driver-measurements/v1" || prefix === "/situation-data/api/v1/internal/driver-measurements/v1") this.path = prefix + "/account-erasure-operations";
        else if (prefix !== "") return;
      }
      root.pathname = "/"; this.root = root;
    } catch { /* Source unavailable, never substitute a public endpoint. */ }
  }
  now(): Date { return this.options.now?.() ?? new Date(); }
  signal(source?: AbortSignal): AbortSignal { const timeout = AbortSignal.timeout(Math.max(1, Math.min(10_000, Math.trunc(this.options.timeoutMs ?? 10_000)))); return source ? AbortSignal.any([source, timeout]) : timeout; }
  async authority(signal: AbortSignal): Promise<boolean> {
    if (!this.root || !this.options.verifyConfiguredOwner || signal.aborted) return false;
    try { return await bounded(this.options.verifyConfiguredOwner(this.owner, { origin: this.root.origin, signal }), signal) === true; } catch { return false; }
  }
  routerId(actor: AuthenticatedActor): string { requireActor(actor, this.options.issuer); return opaqueUserId(this.options.userIdSecret, actor.subjectId); }
  async identity(actor: AuthenticatedActor, signal: AbortSignal): Promise<string | null> {
    if (!this.options.reviewExistingIdentity) return null;
    const result = await bounded(this.options.reviewExistingIdentity(actor, { routerUserId: this.routerId(actor), signal }), signal);
    return result.reviewed === true && HEX.test(result.version) ? result.version : null;
  }
  async request(suffix: string, signal: AbortSignal, actor?: AuthenticatedActor, operationId?: string, body?: unknown) {
    if (!this.root) throw new Error("SIM_ERASURE_UNAVAILABLE"); signal.throwIfAborted();
    const headers: Record<string, string> = { authorization: `Bearer ${this.options.token}`, accept: "application/json", "cache-control": "no-store" };
    if (actor) {
      const op = requireOperation(operationId), iat = Math.floor(this.now().getTime() / 1000);
      const claim = { iss: this.options.issuer, sub: actor.subjectId, aud: "sim-account-erasure", iat, exp: iat + 60, operationId: op, routerUserId: this.routerId(actor) };
      const encoded = Buffer.from(JSON.stringify(claim)).toString("base64url");
      headers["x-cop-actor"] = encoded; headers["x-cop-actor-signature"] = createHmac("sha256", this.options.actorSecret).update(encoded).digest("hex");
    }
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await bounded(fetch(new URL(this.path + suffix, this.root), { method: body === undefined ? "GET" : "POST", redirect: "error", signal, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), signal);
    if (response.status === 404 && suffix.startsWith("/") && UUID.test(suffix.slice(1))) { await response.body?.cancel().catch(() => undefined); return { status: 404, value: null }; }
    if (![200, 202].includes(response.status)) { await response.body?.cancel().catch(() => undefined); throw new Error("SIM_ERASURE_UNAVAILABLE"); }
    if (response.headers.get("cache-control")?.toLowerCase() !== "no-store" || (response.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() !== "application/json") { await response.body?.cancel().catch(() => undefined); throw new Error("SIM_ERASURE_UNPROVEN"); }
    const bytes = await bounded(readBoundedBody(response, 16_384), signal); signal.throwIfAborted(); return { status: response.status, value: JSON.parse(bytes.toString("utf8")) as unknown };
  }
  validateProbe(input: unknown, actor = false) {
    const schema = this.owner === "ai_router" ? actor ? routerPreflight : routerCap : actor ? driverPreflight : driverCap;
    const value = schema.parse(input), ready = value.enabled && Object.values(value.checks).every(v => v === true) &&
      ("costPolicy" in value ? value.costPolicy === COST : value.reportProtection !== "unverified");
    if (value.ready !== ready || new Set(value.blockers).size !== value.blockers.length || (ready ? value.blockers.length !== 0 : value.blockers.length === 0) ||
        Math.abs(this.now().getTime() - Date.parse(value.checkedAt)) > 30_000) throw new Error("SIM_ERASURE_UNPROVEN");
    return value;
  }
  async capability(signal: AbortSignal): Promise<boolean> {
    if (!await this.authority(signal)) return false;
    const result = await this.request("/capability", signal); return result.status === 200 && this.validateProbe(result.value).ready;
  }
}
/** Completes only the declared COP Router primary-DB subdomain. The three
 * explicit false fields are preserved boundaries, never whole-COP completion or
 * anonymization claims. backup_restore remains an independently required owner.
 * No model version, provider eraser or OpenAI request is used here. */
function routerProof(status: number, input: unknown, op: string, identity: string): AccountErasureProof {
  const receipt = routerReceipt.parse(input);
  if (receipt.operationId !== op || new Set(receipt.pendingReasons).size !== receipt.pendingReasons.length) return pending();
  return status === 200 && receipt.status === "online_complete" && receipt.pendingRequestCount === 0 && receipt.pendingReasons.length === 0 && receipt.onlineScopeComplete
    ? { status: "completed", proofId: hash(["cop-router-online-erasure-v1", identity, receipt]) } : pending();
}
/** Online driver rows/derived publication only; backup replay is still a
 * separate owner obligation. False wholeAccountComplete is never promoted. */
function measurementProof(status: number, input: unknown, op: string, size: number, identity: string): AccountErasureProof {
  const receipt = driverReceipt.parse(input);
  return status === 200 && receipt.operationId === op && receipt.contributorCount === size && receipt.status === "completed" && receipt.remainingBatchCount === 0 &&
    receipt.databaseZeroVerified && receipt.derivedReportAcknowledged && receipt.publicationFenceVerified && receipt.replayReady && receipt.retentionReviewed &&
    receipt.reportProtection !== "unverified" && receipt.pendingReason === null ? { status: "completed", proofId: hash(["cop-measurements-online-erasure-v1", identity, receipt]) } : pending();
}
export function createSimRouterAccountErasureAdapter(options: SimAccountErasureOptions): AccountErasureAdapter {
  const client = new Client(options, "ai_router");
  return {
    id: "ai_router",
    async ready() { if (!client.options.reviewExistingIdentity) return false; try { return await client.capability(client.signal()); } catch { return false; } },
    async preflight(actor, context) {
      requireActor(actor, options.issuer); if (!context.operationId) return unavailable(); const op = requireOperation(context.operationId), signal = client.signal(context.signal);
      try { if (!await client.capability(signal)) return unavailable(); const identity = await client.identity(actor, signal); if (!identity) return unavailable();
        const response = await client.request("/preflight", signal, actor, op, { contractVersion: VERSION, operationId: op });
        const value = client.validateProbe(response.value, true); if (response.status !== 200 || !("operationId" in value) || value.operationId !== op || !value.ready) return unavailable();
        return { ready: true, version: hash([identity, client.routerId(actor), value.checks, "costPolicy" in value ? value.costPolicy : null]) };
      } catch { return unavailable(); }
    },
    async erase(actor, context) {
      requireActor(actor, options.issuer); const op = requireOperation(context.operationId), signal = client.signal(context.signal);
      try { if (!await client.capability(signal) || !await client.identity(actor, signal)) return pending();
        const response = await client.request("", signal, actor, op, { contractVersion: VERSION, operationId: op });
        if (!await client.authority(signal)) return pending(); return routerProof(response.status, response.value, op, hash([options.issuer, client.routerId(actor)]));
      } catch { return pending(); }
    }
  };
}
async function manifest(options: SimMeasurementsErasureOptions, client: Client, actor: AuthenticatedActor, op: string, signal: AbortSignal) {
  if (!options.inventory) throw new Error("SIM_CONTRIBUTOR_INVENTORY_UNPROVEN");
  const previous = await client.request("/" + op, signal, actor, op);
  let anchorAt = client.now().toISOString();
  if (previous.status !== 404) { const receipt = driverReceipt.parse(previous.value); if (receipt.operationId !== op || (previous.status === 200 ? receipt.status !== "completed" || receipt.pendingReason !== null || !receipt.databaseZeroVerified || !receipt.derivedReportAcknowledged || !receipt.publicationFenceVerified || !receipt.replayReady || !receipt.retentionReviewed || receipt.reportProtection === "unverified" || receipt.remainingBatchCount !== 0 : receipt.status !== "pending" || receipt.pendingReason === null)) throw new Error("SIM_OPERATION_UNPROVEN"); anchorAt = receipt.acceptedAt; }
  const inventory = await bounded(options.inventory(actor, { operationId: op, coverageAnchorAt: anchorAt, signal }), signal);
  if (!inventory || !HEX.test(inventory.version) || inventory.retainedComplete !== true || inventory.outboxComplete !== true || inventory.keyVersionsComplete !== true ||
      !Array.isArray(inventory.keys) || inventory.keys.length < 1 || inventory.keys.length > 4 || new Set(inventory.keys.map(k => k.version)).size !== inventory.keys.length ||
      inventory.keys.some(k => !k.version || k.secret.length < 32)) throw new Error("SIM_CONTRIBUTOR_INVENTORY_UNPROVEN");
  const days = new Set<string>();
  const anchor = Date.parse(anchorAt), first = new Date(anchor - 8 * 86_400_000).toISOString().slice(0, 10), last = new Date(anchor + 30_000).toISOString().slice(0, 10);
  for (let ms = Date.parse(first); ms <= Date.parse(last); ms += 86_400_000) days.add(new Date(ms).toISOString().slice(0, 10));
  for (const day of [...inventory.retainedDays, ...inventory.outboxDays]) { if (!z.iso.date().safeParse(day).success) throw new Error("SIM_CONTRIBUTOR_INVENTORY_UNPROVEN"); days.add(day); }
  const contributors = inventory.keys.flatMap(key => [...days].sort().map(day => ({ contributorDay: day, contributorIdDay: contributorIdDay(key.secret, actor.subjectId, day) })))
    .sort((a, b) => a.contributorDay.localeCompare(b.contributorDay) || a.contributorIdDay.localeCompare(b.contributorIdDay));
  if (contributors.length < 9 || contributors.length > 40 || new Set(contributors.map(v => JSON.stringify(v))).size !== contributors.length) throw new Error("SIM_CONTRIBUTOR_INVENTORY_UNPROVEN");
  return { version: inventory.version, anchorAt, existing: previous.status !== 404, body: { contractVersion: VERSION, operationId: op, contributors, attestation: "cop-account-erasure-contributors-reviewed-v1" } };
}
export function createSimMeasurementsAccountErasureAdapter(options: SimMeasurementsErasureOptions): AccountErasureAdapter {
  const bound = { ...options }, client = new Client(bound, "sim_measurements");
  return {
    id: "sim_measurements",
    async ready() { if (!bound.inventory || !bound.reviewExistingIdentity) return false; try { return await client.capability(client.signal()); } catch { return false; } },
    async preflight(actor, context) {
      requireActor(actor, bound.issuer); if (!context.operationId) return unavailable(); const op = requireOperation(context.operationId), signal = client.signal(context.signal);
      try { if (!await client.capability(signal)) return unavailable(); const identity = await client.identity(actor, signal); if (!identity) return unavailable();
        const snapshot = await manifest(bound, client, actor, op, signal), response = await client.request("/preflight", signal, actor, op, snapshot.body);
        const value = driverPreflight.parse(response.value); client.validateProbe(value, true);
        if (response.status !== 200 || !value.ready || value.operationId !== op || value.contributorCount !== snapshot.body.contributors.length ||
            value.coverageAnchor.kind !== (snapshot.existing ? "first_accepted_at" : "checked_at") ||
            (snapshot.existing ? value.coverageAnchor.at !== snapshot.anchorAt : value.coverageAnchor.at !== value.checkedAt)) return unavailable();
        return { ready: true, version: hash([identity, snapshot.version, snapshot.body, value.checks, value.reportProtection, snapshot.existing ? snapshot.anchorAt : null]) };
      } catch { return unavailable(); }
    },
    async erase(actor, context) {
      requireActor(actor, bound.issuer); const op = requireOperation(context.operationId), signal = client.signal(context.signal);
      try { if (!await client.capability(signal) || !await client.identity(actor, signal)) return pending(); const snapshot = await manifest(bound, client, actor, op, signal);
        const response = await client.request("", signal, actor, op, snapshot.body);
        if (!await client.authority(signal)) return pending(); return measurementProof(response.status, response.value, op, snapshot.body.contributors.length, hash([bound.issuer, client.routerId(actor), snapshot.body]));
      } catch { return pending(); }
    }
  };
}
