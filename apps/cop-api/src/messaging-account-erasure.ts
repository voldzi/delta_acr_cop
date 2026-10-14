import { createHash } from "node:crypto";
import type { AccountErasureAdapter, AccountErasureAssessment, AccountErasureProof } from "./account-erasure.js";
import { AccountErasureError } from "./account-erasure.js";
import { readBoundedBody } from "./bounded-upstream.js";
import type { MobilityProviderEffects, MobilityProviderManifest } from "./mobility-account-erasure.js";
import type { MessagingProviderConfig } from "./messaging-provider.js";
import type { AuthenticatedActor } from "./security.js";

export type MessagingErasureOwnerScope = "whole_owner" | "mobility_effects";
export interface MessagingActorScopeProof {
  appScope: "cop_jizda_exclusive"; scopeVersion: string;
  exclusiveBindingProven: true; simNamespacePreserved: true;
  scopeCoverage: readonly ["matrix", "notifications", "conversations", "devices", "policy_metadata"];
}
export interface MessagingAccountErasureOptions {
  config: MessagingProviderConfig;
  issuer: string;
  /** Server-only authority port, backed by actual accepted native/provider/store/
   * restore binding for this origin and scope. An env flag or runtime label is
   * insufficient. The published owner contract has no global whole-owner cap.
   * Absence of this verifier deliberately leaves ready=false. */
  /** Actual actor-specific namespace authority, including all local metadata.
   * Unknown/shared bindings cannot use global MXID/account fences. This cannot
   * be selected by the browser or replaced by an origin/configuration flag. */
  verifyActorScope?: (actor: AuthenticatedActor, context: { scope: MessagingErasureOwnerScope; origin: string; operationId?: string; signal: AbortSignal }) => Promise<MessagingActorScopeProof | null>;
  verifyConfiguredOwner?: (scope: MessagingErasureOwnerScope,
    context: { origin: string; signal: AbortSignal }) => Promise<boolean>;
}
const WHOLE = "csm-account-erasure-owner-v2", READINESS = "csm-account-erasure-owner-readiness-v1";
const EFFECTS = "csm-cop-mobility-effects-erasure-v1", POLICY = "matrix-opaque-protocol-tombstones-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const HEX = /^[0-9a-f]{64}$/u;
const preflightReasons = new Set(["ownership_unresolved", "historical_provenance", "native_acceptance", "native_owner_scope", "provider_unavailable"]);
const wholeReasons = new Set(["matrix_history_media", "historical_provenance", "owner_metadata_readback", "restore_continuity_readback", "ownership_unresolved", "native_owner_scope"]);
const effectsReasons = new Set(["notification_metadata", "conversation_metadata", "source_provenance", "actor_scope"]);
const pending = (): AccountErasureProof => ({ status: "pending", remaining: "cleanup_pending" });
const unavailable = (): AccountErasureAssessment => ({ ready: false, reason: "adapter_unavailable" });
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MESSAGING_ERASURE_UNPROVEN");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function reasons(value: unknown, known: Set<string>, empty: boolean): boolean {
  return Array.isArray(value) && value.length <= known.size && value.every(v => typeof v === "string" && known.has(v)) &&
    new Set(value).size === value.length && (empty ? value.length === 0 : value.length > 0);
}
const scopeFields = ["appScope", "scopeVersion", "exclusiveBindingProven", "simNamespacePreserved", "scopeCoverage"] as const;
function scopeProof(value: Record<string, unknown>, expected?: string): boolean {
  return value.appScope === "cop_jizda_exclusive" && value.exclusiveBindingProven === true && value.simNamespacePreserved === true &&
    typeof value.scopeVersion === "string" && HEX.test(value.scopeVersion) && (!expected || value.scopeVersion === expected) &&
    JSON.stringify(value.scopeCoverage) === JSON.stringify(["matrix", "notifications", "conversations", "devices", "policy_metadata"]);
}
function requireActor(actor: AuthenticatedActor, issuer: string): void {
  if (actor.authMode !== "oidc" || actor.issuer !== issuer || !actor.subjectId || Buffer.byteLength(actor.subjectId) > 256 ||
      /[\u0000-\u001f\u007f]/u.test(actor.subjectId)) throw new AccountErasureError(401, "UNAUTHORIZED");
}
function operation(value: string): string {
  if (!UUID.test(value)) throw new AccountErasureError(400, "INVALID_ERASURE_OPERATION");
  return value.toLowerCase();
}
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let listener: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    listener = () => reject(new Error("MESSAGING_ERASURE_UNAVAILABLE"));
    signal.addEventListener("abort", listener, { once: true });
  });
  try { return await Promise.race([promise, interrupted]); }
  finally { if (listener) signal.removeEventListener("abort", listener); }
}
class Transport {
  private readonly url?: URL;
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly enabled: boolean;
  constructor(private readonly options: MessagingAccountErasureOptions) {
    const config = options.config;
    let validIssuer = false;
    try { const issuer = new URL(options.issuer); validIssuer = issuer.protocol === "https:" && !issuer.username && !issuer.password && !issuer.search && !issuer.hash; } catch { /* Unconfigured issuer is unavailable. */ }
    this.enabled = config.enabled && validIssuer;
    this.token = config.token;
    this.timeoutMs = Math.max(1, Math.min(10_000, Number.isFinite(config.timeoutMs) ? Math.trunc(config.timeoutMs) : 10_000));
    try {
      const url = new URL(config.baseUrl);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
          !this.token || /[\u0000-\u001f\u007f]/u.test(this.token)) return;
      // Use only the configured API origin. publicUrl and Matrix public URLs are
      // intentionally irrelevant; the authority verifier binds this exact origin.
      this.url = url;
    } catch { /* Missing server-owned configuration keeps the adapter unavailable. */ }
  }
  bounded(signal?: AbortSignal): AbortSignal {
    return signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs);
  }
  async authority(scope: MessagingErasureOwnerScope, signal: AbortSignal): Promise<boolean> {
    if (!this.enabled || !this.url || !this.options.verifyConfiguredOwner || signal.aborted) return false;
    try {
      return await abortable(this.options.verifyConfiguredOwner(scope, { origin: this.url.origin, signal }), signal) === true;
    } catch { return false; }
  }
  async actorScope(actor: AuthenticatedActor, scope: MessagingErasureOwnerScope, signal: AbortSignal, operationId?: string): Promise<MessagingActorScopeProof | null> {
    if (!this.url || !this.options.verifyActorScope || signal.aborted) return null;
    requireActor(actor, this.options.issuer);
    try { const proof = await abortable(this.options.verifyActorScope(actor, { scope, origin: this.url.origin, signal, ...(operationId ? { operationId } : {}) }), signal);
      return proof && exact(proof as unknown as Record<string, unknown>, scopeFields) && scopeProof(proof as unknown as Record<string, unknown>) ? proof : null;
    } catch { return null; }
  }
  async call(path: string, signal: AbortSignal, actor?: AuthenticatedActor, body?: unknown, operationId?: string) {
    if (!this.url || !this.token || !this.enabled) throw new Error("MESSAGING_ERASURE_UNAVAILABLE");
    signal.throwIfAborted();
    const headers: Record<string, string> = { authorization: `Bearer ${this.token}`, accept: "application/json", "cache-control": "no-store" };
    if (actor) { requireActor(actor, this.options.issuer); headers["x-csm-user-id"] = actor.subjectId; headers["x-csm-oidc-issuer"] = this.options.issuer; }
    if (operationId) headers["idempotency-key"] = operation(operationId);
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await abortable(fetch(new URL(path, this.url), { method: body === undefined ? "GET" : "POST",
      redirect: "error", signal, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), signal);
    if (response.status !== 200 && response.status !== 202) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("MESSAGING_ERASURE_UNAVAILABLE");
    }
    if ((response.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      await response.body?.cancel().catch(() => undefined); throw new Error("MESSAGING_ERASURE_UNPROVEN");
    }
    const bytes = await abortable(readBoundedBody(response, 16_384), signal);
    signal.throwIfAborted();
    return { status: response.status, value: object(JSON.parse(bytes.toString("utf8"))) };
  }
  async assess(actor: AuthenticatedActor, signal: AbortSignal, scopeVersion: string): Promise<AccountErasureAssessment> {
    requireActor(actor, this.options.issuer);
    const response = await this.call("/api/v1/communication/account-erasure/preflight", signal, actor, {});
    const value = response.value;
    if (response.status !== 200 || !exact(value, ["contractVersion", "wholeAccountReady", "localContentProviderReady", "remaining"], ["version", ...scopeFields]) ||
        value.contractVersion !== READINESS) return unavailable();
    if (value.wholeAccountReady === true && value.localContentProviderReady === true && reasons(value.remaining, preflightReasons, true) &&
        typeof value.version === "string" && HEX.test(value.version) && scopeProof(value, scopeVersion)) return { ready: true, version: value.version };
    if (value.wholeAccountReady !== false || value.localContentProviderReady !== false || value.version !== undefined || !reasons(value.remaining, preflightReasons, false)) return unavailable();
    return { ready: false, reason: (value.remaining as string[]).includes("ownership_unresolved") ? "ownership_unresolved" : "adapter_unavailable" };
  }
}
function wholeProof(status: number, value: Record<string, unknown>, operationId: string, scopeVersion: string): AccountErasureProof {
  if (!exact(value, ["contractVersion", "operationId", "status", "wholeAccountErased", "localOwnerDataErased", "externalCopiesErased", "revocationEnforced", "remaining", "proofId"], ["technicalRetentionPolicyId", ...scopeFields]) ||
      value.contractVersion !== WHOLE || value.operationId !== operationId || value.externalCopiesErased !== false || value.revocationEnforced !== true) return pending();
  if (status === 200 && scopeProof(value, scopeVersion) && value.status === "completed" && value.wholeAccountErased === true && value.localOwnerDataErased === true &&
      value.technicalRetentionPolicyId === POLICY && reasons(value.remaining, wholeReasons, true) && typeof value.proofId === "string" && HEX.test(value.proofId)) return { status: "completed", proofId: value.proofId };
  return pending();
}
function normalizeManifest(input: MobilityProviderManifest): MobilityProviderManifest {
  const value = object(input);
  if (!exact(value, ["version", "invitationIds", "notificationIdempotencyKeys", "conversationIds", "roomIds"]) || value.version !== 1) throw new Error("MESSAGING_SOURCE_MANIFEST_INVALID");
  const validators = {
    invitationIds: (v: string) => UUID.test(v),
    notificationIdempotencyKeys: (v: string) => { const parts = v.split(":"); return parts.length === 3 && parts[0] === "cop-mobility-invitation-v1" && UUID.test(parts[1]!) && UUID.test(parts[2]!); },
    conversationIds: (v: string) => v.length <= 128 && /^[ -~]+$/u.test(v),
    roomIds: (v: string) => v.length <= 255 && /^[ -~]+$/u.test(v)
  };
  const result: MobilityProviderManifest = { version: 1, invitationIds: [], notificationIdempotencyKeys: [], conversationIds: [], roomIds: [] };
  for (const key of Object.keys(validators) as Array<keyof typeof validators>) {
    const list = value[key];
    if (!Array.isArray(list) || list.length > 1000 || new Set(list).size !== list.length || list.some(v => typeof v !== "string" || !validators[key](v))) throw new Error("MESSAGING_SOURCE_MANIFEST_INVALID");
    result[key] = [...list].sort();
  }
  return result;
}
function effectsProof(status: number, value: Record<string, unknown>, operationId: string, scopeVersion: string): AccountErasureProof {
  if (!exact(value, ["contractVersion", "operationId", "status", "localMetadataErased", "sourceRevocationEnforced", "wholeAccountErased", "externalCopiesErased", "remaining", "proofId"], scopeFields) ||
      value.contractVersion !== EFFECTS || value.operationId !== operationId || value.wholeAccountErased !== false || value.externalCopiesErased !== false) return pending();
  if (status === 200 && scopeProof(value, scopeVersion) && value.status === "completed" && value.localMetadataErased === true && value.sourceRevocationEnforced === true &&
      reasons(value.remaining, effectsReasons, true) && typeof value.proofId === "string" && HEX.test(value.proofId)) return { status: "completed", proofId: value.proofId };
  return pending();
}
export function createMessagingAccountErasureAdapter(options: MessagingAccountErasureOptions): AccountErasureAdapter {
  const bound = { ...options, config: { ...options.config } }, transport = new Transport(bound);
  return {
    id: "messaging_matrix",
    async ready() { return !!bound.verifyActorScope && transport.authority("whole_owner", transport.bounded()); },
    async preflight(actor, { signal }) {
      requireActor(actor, bound.issuer);
      const bounded = transport.bounded(signal);
      if (!await transport.authority("whole_owner", bounded)) return unavailable();
      try { const scope = await transport.actorScope(actor, "whole_owner", bounded);
        if (!scope) return unavailable();
        const assessed = await transport.assess(actor, bounded, scope.scopeVersion);
        return assessed.ready ? { ready: true, version: hash([WHOLE, assessed.version, scope.scopeVersion]) } : assessed; } catch { return unavailable(); }
    },
    async erase(actor, context) {
      requireActor(actor, bound.issuer); const op = operation(context.operationId), signal = transport.bounded(context.signal);
      if (!await transport.authority("whole_owner", signal)) return pending();
      try { const scope = await transport.actorScope(actor, "whole_owner", signal, op); if (!scope) return pending();
        const response = await transport.call("/api/v1/communication/account-erasure/owner-v2", signal, actor, {}, op);
        if (!await transport.authority("whole_owner", signal)) return pending();
        const after = await transport.actorScope(actor, "whole_owner", signal, op);
        return after?.scopeVersion === scope.scopeVersion ? wholeProof(response.status, response.value, op, scope.scopeVersion) : pending();
      } catch { return pending(); }
    }
  };
}
export function createMessagingMobilityProviderEffects(options: MessagingAccountErasureOptions): MobilityProviderEffects {
  const bound = { ...options, config: { ...options.config } }, transport = new Transport(bound);
  async function sourceReady(signal: AbortSignal): Promise<boolean> {
    if (!bound.verifyActorScope || !await transport.authority("mobility_effects", signal)) return false;
    try { const { status, value } = await transport.call("/api/v1/communication/mobility-effects-erasure/capabilities", signal);
      return status === 200 && exact(value, ["contractVersion", "localMetadataErasure", "wholeAccountErasure", "externalCopiesErased"]) &&
        value.contractVersion === EFFECTS && value.localMetadataErasure === true && value.wholeAccountErasure === false && value.externalCopiesErased === false;
    } catch { return false; }
  }
  return {
    async ready() { return sourceReady(transport.bounded()); },
    async preflight(actor, signal) {
      requireActor(actor, bound.issuer); const bounded = transport.bounded(signal);
      if (!await sourceReady(bounded)) return unavailable();
      try { const scope = await transport.actorScope(actor, "mobility_effects", bounded); if (!scope) return unavailable();
        const result = await transport.assess(actor, bounded, scope.scopeVersion);
        return result.ready ? { ready: true, version: hash([EFFECTS, result.version, scope.scopeVersion]) } : result;
      } catch { return unavailable(); }
    },
    async erase(actor, input, context) {
      requireActor(actor, bound.issuer); const op = operation(context.operationId), signal = transport.bounded(context.signal);
      try { const manifest = normalizeManifest(input);
        if (!await sourceReady(signal)) return pending();
        const scope = await transport.actorScope(actor, "mobility_effects", signal, op); if (!scope) return pending();
        const response = await transport.call("/api/v1/communication/mobility-effects-erasure", signal, actor, manifest, op);
        if (!await transport.authority("mobility_effects", signal)) return pending();
        const after = await transport.actorScope(actor, "mobility_effects", signal, op);
        return after?.scopeVersion === scope.scopeVersion ? effectsProof(response.status, response.value, op, scope.scopeVersion) : pending();
      } catch { return pending(); }
    }
  };
}
