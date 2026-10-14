import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_ERASURE_ADAPTER_IDS, AccountErasureService, type AccountErasureAdapter } from "./account-erasure.js";
import { createCOPContentMediaErasureAdapter } from "./cop-content-media-erasure.js";
import { InMemoryCommunityReportStore } from "./community-report-store.js";
import { InMemoryIncidentStore } from "./incident-store.js";
import { InMemorySketchDrawingStore } from "./sketch-store.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import type { AuthenticatedActor } from "./security.js";
import type { MediaStorage } from "./media-storage.js";
const now = new Date("2026-10-14T00:00:00Z");
const actor: AuthenticatedActor = { authMode: "oidc", issuer: "https://identity.test/cop", subjectId: "synthetic-account", authTime: now.getTime() / 1000, displayName: "Synthetic", username: "Synthetic" };
const media: MediaStorage = { name: "synthetic-unversioned-fixture", close: async () => {}, init: async () => {},
  createUploadSlot: vi.fn(), createReadUrl: vi.fn(), getObject: vi.fn(), putObject: vi.fn(), eraseVerifiedObject: vi.fn(async () => "absent" as const), verifiedErasureReady: async () => true };
const projections = { preflight: async () => ({ ready: true as const, version: "synthetic-projection-v1" }), ready: async () => true, erase: vi.fn(async () => true) };
function fixture() {
  const community = new InMemoryCommunityReportStore("primary"), fallback = new InMemoryCommunityReportStore("fallback");
  const sketch = new InMemorySketchDrawingStore("primary"), sketchFallback = new InMemorySketchDrawingStore("fallback"), store = new MemoryMobilityStore();
  const incidents = new InMemoryIncidentStore("primary"), incidentFallback = new InMemoryIncidentStore("fallback");
  let controller: AccountErasureService | undefined, block = false, haltCleanup = false, projectionAvailable = true, entered!: () => void, release!: () => void;
  const wait = new Promise<void>(resolve => { entered = resolve; }), pause = new Promise<void>(resolve => { release = resolve; });
  const content = createCOPContentMediaErasureAdapter({ communityStores: [community, fallback], sketchStores: [sketch, sketchFallback], incidentStores: [incidents, incidentFallback], media, projections: { ...projections, ready: async () => projectionAvailable },
    usesAdmissionGuard: guard => controller?.usesAdmissionGuard(guard) === true,
    assertAllowed: value => controller!.assertAllowed({ ...actor, ...value }) });
  const otherAdapters: AccountErasureAdapter[] = ACCOUNT_ERASURE_ADAPTER_IDS.filter(id => id !== "cop_content_media").map(id => ({ id,
    ready: async () => true, preflight: async () => { if (id === "keycloak" && block) { entered(); await pause; } return { ready: true, version: "synthetic-other-domain-v1" }; },
    erase: async () => { if (id === "cop_sessions_profiles" && haltCleanup) projectionAvailable = false; return { status: "pending", remaining: "cleanup_pending" }; } }));
  controller = new AccountErasureService({ store, identitySecret: "synthetic-content-admission-identity-secret-32", issuer: actor.issuer!, requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS,
    adapters: [...otherAdapters, content.adapter], accepted: true, allowUnboundSyntheticStore: true, admissionGuard: content.admissionGuard, now: () => now });
  return { community, fallback, sketch, sketchFallback, incidents, incidentFallback, controller, content, stall() { block = true; }, haltContentCleanup() { haltCleanup = true; }, wait, release };
}
async function report(store: InMemoryCommunityReportStore) { return store.withVerifiedActor(actor, () => store.createReport({ createdBy: actor, title: "Synthetic owned report", category: "hazard", visibility: "public", observedAt: now.toISOString(), location: { lat: 50, lon: 15, source: "manual" } }, now)); }
describe("whole COP content boundary and atomic admission", () => {
  it("requires the actual configured controller guard, all configured store components, verified storage and projections", async () => {
    const community = new InMemoryCommunityReportStore(), sketch = new InMemorySketchDrawingStore();
    const missingBinding = createCOPContentMediaErasureAdapter({ communityStores: [community], sketchStores: [sketch], incidentStores: [new InMemoryIncidentStore()], media, projections,
      assertAllowed: async () => {}, usesAdmissionGuard: () => false }); expect(await missingBinding.adapter.ready()).toBe(false);
    const missingProjection = createCOPContentMediaErasureAdapter({ communityStores: [community], sketchStores: [sketch], incidentStores: [new InMemoryIncidentStore()], media,
      assertAllowed: async () => {}, usesAdmissionGuard: () => true }); expect(await missingProjection.adapter.ready()).toBe(false);
    const missingMedia = createCOPContentMediaErasureAdapter({ communityStores: [community], sketchStores: [sketch], incidentStores: [new InMemoryIncidentStore()], projections,
      assertAllowed: async () => {}, usesAdmissionGuard: () => true }); expect(await missingMedia.adapter.ready()).toBe(false);
    const missingStores = createCOPContentMediaErasureAdapter({ communityStores: [community], sketchStores: [], incidentStores: [new InMemoryIncidentStore()], media, projections,
      assertAllowed: async () => {}, usesAdmissionGuard: () => true }); expect(await missingStores.adapter.ready()).toBe(false);
  });
  it("combines proofs only after every primary and RAM fallback store is actually purged", async () => {
    const f = fixture(), primary = await report(f.community), fallback = await report(f.fallback);
    const draw = await f.sketch.create({ actor, kind: "point", geometry: { type: "Point", coordinates: [15, 50] }, visibility: "public" }, now);
    const fallbackDraw = await f.sketchFallback.create({ actor, kind: "point", geometry: { type: "Point", coordinates: [15, 50] }, visibility: "public" }, now);
    expect(await f.content.adapter.ready()).toBe(true);
    const context = { operationId: randomUUID(), requestedAt: now.toISOString(), accountKey: "synthetic-account-key", signal: new AbortController().signal };
    const proof = await f.content.adapter.erase(actor, context); expect(proof.status).toBe("completed");
    expect(await f.content.adapter.erase(actor, context)).toEqual(proof);
    expect(await f.community.getReport(primary.reportId)).toBeNull(); expect(await f.fallback.getReport(fallback.reportId)).toBeNull();
    expect(await f.sketch.get(draw.id)).toBeNull(); expect(await f.sketchFallback.get(fallbackDraw.id)).toBeNull();
  });
  it("holds admission locks through actual global fence commit and rejects a previously started group write afterwards", async () => {
    const f = fixture(), own = await report(f.community), operation = randomUUID();
    const prepared = await f.controller.preflight(actor, operation); expect(prepared.response.canConfirm).toBe(true);
    f.stall(); const deleting = f.controller.request(actor, operation, { confirmAccountDeletion: true }, { planId: prepared.response.planId!, capability: prepared.capability! });
    await f.wait;
    const group = f.community.withVerifiedActor(actor, () => f.community.createGroup({ createdBy: actor, name: "Late shared group", visibility: "public" }, now));
    // Attach the expected rejection immediately; do not allow an unhandled late promise.
    const groupResult = expect(group).rejects.toMatchObject({ status: 403 });
    f.release(); expect(await deleting).toMatchObject({ accountDeleted: false, status: "deleting" }); await groupResult;
    expect(await f.community.listGroups({ subjectId: actor.subjectId })).toEqual([]);
    expect(await f.community.getReport(own.reportId)).toBeNull();
    await expect(f.controller.assertAllowed(actor)).rejects.toMatchObject({ status: 403 });
  });
  it("reassesses a group created after the first plan and refuses confirmation before writing the global fence", async () => {
    const f = fixture(), operation = randomUUID(), prepared = await f.controller.preflight(actor, operation);
    expect(prepared.response.canConfirm).toBe(true);
    const group = await f.community.withVerifiedActor(actor, () => f.community.createGroup({ createdBy: actor, name: "New owned shared group", visibility: "public" }, now));
    await expect(f.controller.request(actor, operation, { confirmAccountDeletion: true }, { planId: prepared.response.planId!, capability: prepared.capability! })).rejects.toMatchObject({ status: 409 });
    await expect(f.controller.assertAllowed(actor)).resolves.toBeUndefined(); expect(await f.community.getGroup(group.groupId)).toHaveProperty("groupId", group.groupId);
  });
  it("keeps writer guards scoped to each real store when another controller/application instance is constructed", async () => {
    const first = fixture(), own = await report(first.community), operation = randomUUID(), prepared = await first.controller.preflight(actor, operation);
    first.haltContentCleanup();
    await expect(first.controller.request(actor, operation, { confirmAccountDeletion: true }, { planId: prepared.response.planId!, capability: prepared.capability! })).rejects.toMatchObject({ status: 503 });
    expect(await first.controller.read(actor, operation)).toMatchObject({ accountDeleted: false, revocationEnforced: true });
    // Content cleanup did not run. Only the first controller's durable global
    // fence can prevent this write; a local component fence is not masking it.
    expect(await first.community.getReport(own.reportId)).not.toBeNull();
    const second = fixture(); expect(await report(second.community)).toHaveProperty("reportId");
    await expect(report(first.community)).rejects.toMatchObject({ status: 403 });
    const conflicting = createCOPContentMediaErasureAdapter({ communityStores: [first.community], sketchStores: [first.sketch], incidentStores: [first.incidents], media, projections,
      assertAllowed: async () => {}, usesAdmissionGuard: () => true });
    expect(await conflicting.adapter.ready()).toBe(false);
    await expect(report(first.community)).rejects.toMatchObject({ status: 403 });
  });
  it("blocks unmapped historical aliases globally instead of treating absence of the current subject as empty ownership", async () => {
    const community = new InMemoryCommunityReportStore(), sketch = new InMemorySketchDrawingStore(), incidents = new InMemoryIncidentStore();
    await community.createGroup({ createdBy: { subjectId: "old-preferred-name", username: "old-preferred-name", displayName: "Synthetic legacy" }, name: "Unmapped historical group", visibility: "private" }, now);
    const content = createCOPContentMediaErasureAdapter({ communityStores: [community], sketchStores: [sketch], incidentStores: [incidents], media, projections,
      assertAllowed: async () => {}, usesAdmissionGuard: () => true });
    expect(await content.adapter.ready()).toBe(false);
    expect(await content.adapter.preflight!(actor, { signal: new AbortController().signal })).toEqual({ ready: false, reason: "ownership_unresolved" });
  });
});
