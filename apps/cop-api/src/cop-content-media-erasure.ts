import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { AccountErasureAdapter, AccountErasureAssessment, AccountErasureProof } from "./account-erasure.js";
import type { AuthenticatedActor } from "./security.js";
import type { CommunityReportStore } from "./community-report-store.js";
import type { SketchDrawingStore } from "./sketch-store.js";
import type { IncidentStore } from "./incident-store.js";
import type { MediaStorage } from "./media-storage.js";
import type { CommunityProjectionEraser } from "./community-erasure.js";
import { requireContentActor } from "./content-erasure.js";

export interface COPContentAdmissionGuard {
  run<T>(actor: AuthenticatedActor, signal: AbortSignal, run: () => Promise<T>): Promise<T>;
}
export function createCOPContentMediaErasureAdapter(options: {
  communityStores: readonly CommunityReportStore[];
  sketchStores: readonly SketchDrawingStore[];
  incidentStores: readonly IncidentStore[];
  media?: MediaStorage;
  projections?: CommunityProjectionEraser & { ready(): Promise<boolean> };
  assertAllowed(actor: { issuer: string; subjectId: string }): Promise<void>;
  /** Must compare the actual controller's configured guard pointer. A deployment
   * label or boolean environment assertion is not an atomic admission proof. */
  usesAdmissionGuard(guard: COPContentAdmissionGuard): boolean;
  now?: () => Date;
}): { adapter: AccountErasureAdapter; admissionGuard: COPContentAdmissionGuard } {
  const community = [...new Set(options.communityStores)].map(store => store.accountErasureComponent?.({ media: options.media, projections: options.projections, now: options.now }));
  const sketches = [...new Set(options.sketchStores)].map(store => store.accountErasureComponent?.({ projections: options.projections }));
  const incidents = [...new Set(options.incidentStores)].map(store => store.accountErasureComponent?.({ projections: options.projections }));
  const components = [...community, ...sketches, ...incidents];
  const complete = community.length > 0 && sketches.length > 0 && incidents.length > 0 && components.every(component => !!component?.withAdmission && !!component.bindWriterGuard && !!component.writerGuardMatches);
  const scoped = new AsyncLocalStorage<boolean>();
  let prerequisitesAt = 0, prerequisites = false;
  const guardBound = complete && components.every(component => component!.bindWriterGuard!(options.assertAllowed));
  const writerBindingsMatch = () => guardBound && components.every(component => component!.writerGuardMatches!(options.assertAllowed));
  async function refreshPrerequisites(): Promise<boolean> {
    if (!options.projections?.ready || !options.projections.preflight || !options.media?.verifiedErasureReady || !options.media.eraseVerifiedObject) return false;
    try {
      prerequisites = (await options.projections.ready()) && (await options.media.verifiedErasureReady());
      prerequisitesAt = Date.now(); return prerequisites;
    } catch { prerequisites = false; return false; }
  }
  async function locked<T>(index: number, run: () => Promise<T>): Promise<T> {
    if (index === components.length) return run();
    return components[index]!.withAdmission!(() => locked(index + 1, run));
  }
  const admissionGuard: COPContentAdmissionGuard = {
    async run(actor, signal, run) {
      requireContentActor(actor); signal.throwIfAborted();
      // Network/provider readiness happens before taking local transaction locks.
      // Inside the lock only a fresh, already checked witness can authorize intake.
      if (!complete || !writerBindingsMatch() || !await refreshPrerequisites()) throw new Error("COP_CONTENT_ADMISSION_UNAVAILABLE");
      return locked(0, () => scoped.run(true, async () => { signal.throwIfAborted(); const result = await run(); signal.throwIfAborted(); return result; }));
    }
  };
  const adapter: AccountErasureAdapter = {
    id: "cop_content_media",
    async ready() {
      if (!complete || !writerBindingsMatch() || !options.usesAdmissionGuard(admissionGuard)) return false;
      if (scoped.getStore()) { if (!prerequisites || Date.now() - prerequisitesAt > 5000) return false; }
      else if (!await refreshPrerequisites()) return false;
      for (const component of components) if (!await component!.ready()) return false;
      return true;
    },
    async preflight(actor, context): Promise<AccountErasureAssessment> {
      requireContentActor(actor); context.signal.throwIfAborted();
      if (!complete || !writerBindingsMatch() || !options.usesAdmissionGuard(admissionGuard)) return { ready: false, reason: "adapter_unavailable" };
      const assess = async (): Promise<AccountErasureAssessment> => {
        const versions: string[] = [];
        for (let i = 0; i < components.length; i++) {
          if (!await components[i]!.ready()) return { ready: false, reason: "ownership_unresolved" };
          context.signal.throwIfAborted(); const result = await components[i]!.preflight(actor, context.signal);
          if (!result.ready) return result;
          versions.push(`${i}:${components[i]!.component}:${result.version}`);
        }
        if (!options.projections?.preflight) return { ready: false, reason: "adapter_unavailable" };
        const projection = await options.projections.preflight({ issuer: actor.issuer!, subjectId: actor.subjectId }, context.signal);
        if (!projection.ready) return projection;
        versions.push("projections:" + projection.version);
        return { ready: true, version: createHash("sha256").update(JSON.stringify(versions)).digest("hex") };
      };
      return scoped.getStore() ? assess() : admissionGuard.run(actor, context.signal, assess);
    },
    async erase(actor, context): Promise<AccountErasureProof> {
      requireContentActor(actor); context.signal.throwIfAborted();
      if (!complete || !writerBindingsMatch() || !options.usesAdmissionGuard(admissionGuard)) return { status: "pending", remaining: "cleanup_pending" };
      const proofs: string[] = [];
      let allCompleted = true;
      // Provider/object erasure runs outside admission locks and never holds a
      // long transaction while waiting for external storage or projection cleanup.
      for (let i = 0; i < components.length; i++) {
        context.signal.throwIfAborted(); const proof = await components[i]!.erase(actor, context);
        // Every independent component must contribute its owned manifest. An
        // earlier pending projection can need references discovered by a later
        // component; returning early would prevent the next safe retry forever.
        if (proof.status !== "completed") { allCompleted = false; continue; }
        proofs.push(`${i}:${components[i]!.component}:${proof.proofId}`);
      }
      context.signal.throwIfAborted();
      if (!allCompleted) return { status: "pending", remaining: "cleanup_pending" };
      return { status: "completed", proofId: createHash("sha256").update(JSON.stringify([context.operationId, proofs])).digest("hex") };
    }
  };
  return { adapter, admissionGuard };
}
