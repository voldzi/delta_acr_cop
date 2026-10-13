import { createHash } from "node:crypto";
import type { AccountErasureAdapter, AccountErasureProof } from "./account-erasure.js";
import type { UserProfileStore } from "./user-profile-store.js";
import type { WebSessionStore } from "./web-session-store.js";

/** Actual local cleanup only. Other provider domains remain independently required. */
export function createCOPSessionsProfilesErasureAdapter(options: {
  issuer: string;
  sessions: WebSessionStore | undefined;
  /** Include every configured fallback; a omitted custom store cannot be accepted. */
  profiles: readonly UserProfileStore[];
}): AccountErasureAdapter {
  if (!options.issuer || options.profiles.length === 0 || new Set(options.profiles).size !== options.profiles.length) {
    throw new Error("COP session/profile erasure requires an explicit verified issuer and every profile store.");
  }
  return {
    id: "cop_sessions_profiles",
    async ready() {
      if (!options.sessions?.erasureReady || !options.sessions.revokeActor ||
          options.profiles.some(store => !store.erasureReady || !store.purgeActor)) return false;
      if (!(await options.sessions.erasureReady())) return false;
      for (const store of options.profiles) if (!(await store.erasureReady!())) return false;
      return true;
    },
    async preflight(actor, context) {
      if (actor.authMode !== "oidc" || actor.issuer !== options.issuer || !actor.subjectId) throw new Error("Verified owner required");
      if (!options.sessions?.preflightActorErasure || options.profiles.some(store => !store.preflightActorErasure)) return { ready: false, reason: "adapter_preflight_missing" };
      context.signal.throwIfAborted();
      const owner = { issuer: options.issuer, subjectId: actor.subjectId };
      const results = [await options.sessions.preflightActorErasure(owner)];
      for (const store of options.profiles) { context.signal.throwIfAborted(); results.push(await store.preflightActorErasure!(owner)); }
      context.signal.throwIfAborted();
      if (results.some(result => !result.ready)) return { ready: false, reason: "ownership_unresolved" };
      return { ready: true, version: createHash("sha256").update(JSON.stringify(results.map(result => result.version))).digest("hex") };
    },
    async erase(actor, context): Promise<AccountErasureProof> {
      if (actor.authMode !== "oidc" || actor.issuer !== options.issuer || !actor.subjectId) {
        throw new Error("Verified OIDC owner is required for COP session/profile erasure.");
      }
      if (!options.sessions?.revokeActor || options.profiles.some(store => !store.purgeActor)) {
        return { status: "pending", remaining: "cleanup_pending" };
      }
      context.signal.throwIfAborted();
      const owner = { issuer: options.issuer, subjectId: actor.subjectId };
      const results = [await options.sessions.revokeActor(owner)];
      for (const store of options.profiles) {
        context.signal.throwIfAborted();
        results.push(await store.purgeActor!(owner));
      }
      context.signal.throwIfAborted();
      if (results.some(result => result.complete !== true)) return { status: "pending", remaining: "cleanup_pending" };
      const proofId = createHash("sha256").update("cop-sessions-profiles-erasure-v1\0")
        .update(JSON.stringify([context.operationId, context.accountKey])).digest("hex");
      return { status: "completed", proofId };
    }
  };
}
