import { createHash } from "node:crypto";
import type { AccountErasureAdapter, AccountErasureAssessment, AccountErasureProof } from "./account-erasure.js";
import type { AuthenticatedActor } from "./security.js";
import type { DriverConsentOwner, DriverMeasurementConsentStore } from "./driver-measurement-consent-store.js";
import { createSimMeasurementsAccountErasureAdapter, type SimMeasurementsErasureAdapter, type SimMeasurementsErasureOptions } from "./sim-account-erasure.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const pending = (): AccountErasureProof => ({ status: "pending", remaining: "cleanup_pending" });
const unavailable = (): AccountErasureAssessment => ({ ready: false, reason: "adapter_unavailable" });
function owner(actor: AuthenticatedActor, issuer: string): DriverConsentOwner {
  if (actor.authMode !== "oidc" || actor.issuer !== issuer || !actor.subjectId) throw new Error("DRIVER_CONSENT_OWNER_UNPROVEN");
  return { issuer, subjectId: actor.subjectId };
}

/** The native identity/key/outbox review remains mandatory. This wrapper adds
 * actual COP consent metadata; no absent local row can substitute for SIM's
 * historical coverage or completed immutable operation manifest. */
export function createCOPDriverMeasurementsErasureAdapter(options: SimMeasurementsErasureOptions,
  store: DriverMeasurementConsentStore | undefined): AccountErasureAdapter {
  const implemented = () => !!store?.erasureReady && !!store.preflightActorErasure && !!store.erasureCheckpoint
    && !!store.fenceActorErasure && !!store.purgeActorErasure;
  const remote = createSimMeasurementsAccountErasureAdapter({ ...options, inventory: options.inventory ? async (actor, context) => {
    if (!implemented()) return null;
    const principal = owner(actor, options.issuer), native = await options.inventory!(actor, context);
    if (!native) return null;
    const checkpoint = await store!.erasureCheckpoint!(principal, context.operationId);
    const local = checkpoint ? undefined : await store!.preflightActorErasure!(principal);
    if (local && !local.ready) return null;
    // The exact COP outbox dates survive the eventual deletion of the consent
    // row, so provider retries cannot silently shrink the accepted manifest.
    const days = [...new Set(checkpoint?.pendingDays ?? local?.pendingDays ?? [])].sort();
    return { ...native, outboxDays: [...new Set([...native.outboxDays, ...days])].sort(), version: hash([native.version, days]) };
  } : undefined });
  return composeCOPDriverConsentErasureAdapter(remote, store, options.issuer);
}

/** Separately exported to exercise the real local store with an isolated owner
 * fixture. Production uses the strict HTTP SIM adapter above. */
export function composeCOPDriverConsentErasureAdapter(remote: AccountErasureAdapter & Partial<Pick<SimMeasurementsErasureAdapter, "verifiedCompletedOperationProof">>,
  store: DriverMeasurementConsentStore | undefined, issuer: string): AccountErasureAdapter {
  if (remote.id !== "sim_measurements" || !issuer) throw new Error("Explicit SIM measurement owner required");
  const implemented = () => !!store?.erasureReady && !!store.preflightActorErasure && !!store.erasureCheckpoint
    && !!store.fenceActorErasure && !!store.purgeActorErasure;
  const completedProof = async (actor: AuthenticatedActor, context: Parameters<AccountErasureAdapter["erase"]>[1]): Promise<AccountErasureProof> => {
    const principal = owner(actor, issuer), checkpoint = await store!.erasureCheckpoint!(principal, context.operationId);
    if (!checkpoint?.completed || !checkpoint.remoteProofId || checkpoint.pendingDays.length || !remote.verifiedCompletedOperationProof) return pending();
    const remoteProof = await remote.verifiedCompletedOperationProof(actor, context);
    context.signal.throwIfAborted();
    const local = await store!.preflightActorErasure!(principal);
    if (remoteProof.status !== "completed" || remoteProof.proofId !== checkpoint.remoteProofId || !local.ready || local.present) return pending();
    return { status: "completed", proofId: hash(["cop-sim-driver-consent-erasure-v1", context.accountKey, context.operationId, remoteProof.proofId, checkpoint.inventoryVersion]) };
  };
  return {
    id: "sim_measurements",
    async ready() { return implemented() && await store!.erasureReady!() && await remote.ready(); },
    async readyForAcceptedOperation(actor, context) {
      if (!implemented() || !await store!.erasureReady!()) return false;
      const principal = owner(actor, issuer);
      const checkpoint = await store!.erasureCheckpoint!(principal, context.operationId);
      if (!checkpoint) return false;
      if (checkpoint.completed) return (await completedProof(actor, context)).status === "completed";
      return remote.readyForAcceptedOperation ? remote.readyForAcceptedOperation(actor, context) : remote.ready();
    },
    async preflight(actor, context) {
      if (!implemented() || !remote.preflight) return unavailable();
      const principal = owner(actor, issuer), checked = await remote.preflight(actor, context);
      if (!checked.ready) return checked;
      context.signal.throwIfAborted();
      const local = await store!.preflightActorErasure!(principal);
      return local.ready ? { ready: true, version: hash([checked.version, local.version]) }
        : { ready: false, reason: "ownership_unresolved" };
    },
    async erase(actor, context) {
      if (!implemented() || !remote.preflight) return pending();
      const principal = owner(actor, issuer);
      let checkpoint = await store!.erasureCheckpoint!(principal, context.operationId);
      if (checkpoint?.completed) return completedProof(actor, context);
      if (!checkpoint) {
        const local = await store!.preflightActorErasure!(principal);
        if (!local.ready) return pending();
        const reviewed = await remote.preflight(actor, { signal: context.signal, operationId: context.operationId });
        if (!reviewed.ready || !await store!.fenceActorErasure!(principal, context.operationId, reviewed.version, local.version)) return pending();
        checkpoint = await store!.erasureCheckpoint!(principal, context.operationId);
        if (!checkpoint) return pending();
      }
      context.signal.throwIfAborted();
      // SIM commits its immutable contributors manifest and completed readback
      // before COP removes the consent/retained pending dates. Pending or outage
      // leaves them fenced and available to the same operation after restart.
      const result = await remote.erase(actor, context);
      context.signal.throwIfAborted();
      if (result.status !== "completed" || !/^[A-Za-z0-9_-]{8,128}$/u.test(result.proofId)) return pending();
      if (!await store!.purgeActorErasure!(principal, context.operationId, result.proofId)) return pending();
      const readback = await store!.erasureCheckpoint!(principal, context.operationId);
      if (!readback?.completed || readback.remoteProofId !== result.proofId) return pending();
      return { status: "completed", proofId: hash(["cop-sim-driver-consent-erasure-v1", context.accountKey, context.operationId, result.proofId, readback.inventoryVersion]) };
    }
  };
}
