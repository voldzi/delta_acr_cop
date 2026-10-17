import { createHash } from "node:crypto";
import { z } from "zod";
import { readBoundedBody } from "./bounded-upstream.js";
import { signedCleanLifecycleActor, validateCleanLifecycleConfig, type CleanLifecycleActorConfig } from "./clean-lifecycle-actor.js";
import type { AccountErasureAdapter, AccountErasureOperationContext } from "./account-erasure.js";
import type { AuthenticatedActor } from "./security.js";
const version = "cop-sim-user-lifecycle-v1", scope = "cop_sim_shared_identity_v1";
const receiptSchema = z.strictObject({ contractVersion: z.literal(version), scope: z.literal(scope), resetEpoch: z.uuid(),
  operationId: z.uuid(), state: z.enum(["deletion_pending", "deleted"]), component: z.enum(["ai", "driver"]), wholeAccountComplete: z.literal(false) });
const capSchema = z.strictObject({ contractVersion: z.literal(version), scope: z.literal(scope), resetEpoch: z.uuid(),
  component: z.enum(["ai", "driver"]), ready: z.boolean(), wholeAccountComplete: z.literal(false) });
interface Config extends CleanLifecycleActorConfig { baseUrl: string; token: string; component: "ai" | "driver"; now?: () => Date }
export function createSimCleanLifecycleErasureAdapter(config: Config): AccountErasureAdapter & { verifiedCompletedOperationProof(actor: AuthenticatedActor, context: AccountErasureOperationContext): Promise<import("./account-erasure.js").AccountErasureProof> } {
  validateCleanLifecycleConfig(config);
  const root = new URL(config.baseUrl);
  if (!["http:", "https:"].includes(root.protocol) || root.username || root.password || root.search || root.hash || root.pathname !== "/" ||
    config.token.length < 32 || /[\u0000-\u001f\u007f]/u.test(config.token)) throw Error("CLEAN_SIM_CONFIG_INVALID");
  const path = config.component === "ai" ? "/api/v1/ai-router/internal/user-lifecycle/v1" : "/api/v1/internal/user-lifecycle/v1";
  async function call(suffix: string, signal: AbortSignal, actor?: AuthenticatedActor, context?: AccountErasureOperationContext) {
    if (actor && (actor.authMode !== "oidc" || actor.issuer !== config.issuer || !context)) throw Error("CLEAN_SIM_OWNER_INVALID");
    const body = suffix === "/deletions" && context ? { contractVersion: version, scope, resetEpoch: config.resetEpoch,
      operationId: context.operationId, requestedAt: context.requestedAt } : undefined;
    const headers = actor && context ? signedCleanLifecycleActor(config, actor.subjectId,
      { operationId: context.operationId, requestedAt: context.requestedAt, now: config.now?.(), tokenIssuedAt: actor.tokenIssuedAt }) : {};
    const response = await fetch(new URL(path + suffix, root), { method: body ? "POST" : "GET", redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      headers: { authorization: "Bearer " + config.token, "cache-control": "no-store", ...headers,
        ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (![200, 202].includes(response.status)) { await response.body?.cancel(); throw Error("CLEAN_SIM_UNAVAILABLE"); }
    if (!(response.headers.get("cache-control") ?? "").split(",").map(x => x.trim().toLowerCase()).includes("no-store") ||
      response.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
      await response.body?.cancel(); throw Error("CLEAN_SIM_UNPROVEN");
    }
    const value: unknown = JSON.parse((await readBoundedBody(response, 16384)).toString("utf8"));
    if (!context) {
      const cap = capSchema.parse(value);
      if (cap.resetEpoch !== config.resetEpoch || cap.component !== config.component || !cap.ready) throw Error("CLEAN_SIM_NOT_READY");
      return cap;
    }
    const receipt = receiptSchema.parse(value);
    if (receipt.resetEpoch !== config.resetEpoch || receipt.operationId !== context.operationId || receipt.component !== config.component ||
      (response.status === 202 && receipt.state === "deleted")) throw Error("CLEAN_SIM_UNPROVEN");
    return receipt;
  }
  async function ready(): Promise<boolean> { try { await call("/capabilities", AbortSignal.timeout(10000)); return true; } catch { return false; } }
  async function verifiedCompletedOperationProof(actor: AuthenticatedActor, context: AccountErasureOperationContext) {
    const current = await call("/deletions/" + encodeURIComponent(context.operationId), context.signal, actor, context);
    return "state" in current && current.state === "deleted"
      ? { status: "completed" as const, proofId: createHash("sha256").update(JSON.stringify([context.accountKey,current])).digest("hex") }
      : { status: "pending" as const, remaining: "cleanup_pending" as const };
  }
  return { id: config.component === "ai" ? "ai_router" : "sim_measurements", ready, verifiedCompletedOperationProof,
    async preflight(actor, context) {
      if (actor.authMode !== "oidc" || actor.issuer !== config.issuer) return { ready: false, reason: "ownership_unresolved" };
      try { signedCleanLifecycleActor(config, actor.subjectId, { tokenIssuedAt: actor.tokenIssuedAt }); await call("/capabilities", context.signal);
        return { ready: true, version: createHash("sha256").update(JSON.stringify([version,config.resetEpoch,config.component,actor.issuer,actor.subjectId])).digest("hex") };
      } catch { return { ready: false, reason: "adapter_unavailable" }; }
    },
    async erase(actor, context) {
      await call("/deletions", context.signal, actor, context);
      return verifiedCompletedOperationProof(actor, context);
    }
  };
}
