import { createHash } from "node:crypto";
import type { AccountErasureAdapter } from "./account-erasure.js";
import type { MobileDeviceStore } from "./mobile-device-store.js";

/** Device-token deletion at Messaging is separately required by messaging_matrix. */
export function createCOPDevicesErasureAdapter(options: {
  issuer: string;
  /** Every primary and fallback, including inactive memory fallback, must be included. */
  stores: readonly MobileDeviceStore[];
}): AccountErasureAdapter {
  if (!options.issuer || !options.stores.length || new Set(options.stores).size !== options.stores.length) throw new Error("Every device store and verified issuer is required");
  const verifiedOwner = (actor: Parameters<AccountErasureAdapter["erase"]>[0]) => {
    if (actor.authMode !== "oidc" || actor.issuer !== options.issuer || !actor.subjectId) throw new Error("Verified OIDC owner required");
    return { issuer: options.issuer, subjectId: actor.subjectId };
  };
  return {
    id: "cop_devices",
    async ready() {
      for (const store of options.stores) if (!store.erasureReady || !store.preflightActorErasure || !store.purgeActor || !store.assertSubjectAllowed || !await store.erasureReady()) return false;
      return true;
    },
    async preflight(actor, context) {
      const owner = verifiedOwner(actor), versions: string[] = [];
      for (const store of options.stores) {
        context.signal.throwIfAborted();
        if (!store.preflightActorErasure) return { ready: false, reason: "adapter_preflight_missing" };
        const result = await store.preflightActorErasure(owner);
        if (!result.ready) return { ready: false, reason: "ownership_unresolved" };
        versions.push(result.version);
      }
      context.signal.throwIfAborted();
      return { ready: true, version: createHash("sha256").update(JSON.stringify(versions)).digest("hex") };
    },
    async erase(actor, context) {
      const owner = verifiedOwner(actor);
      let complete = true;
      for (const store of options.stores) {
        context.signal.throwIfAborted();
        if (!store.purgeActor || !(await store.purgeActor(owner, context.operationId, context.requestedAt)).complete) complete = false;
      }
      context.signal.throwIfAborted();
      if (!complete) return { status: "pending", remaining: "cleanup_pending" };
      return { status: "completed", proofId: createHash("sha256").update(JSON.stringify(["cop-devices-erasure-v1", context.operationId, context.accountKey])).digest("hex") };
    }
  };
}
