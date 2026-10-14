import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { canonicalProjectionReference, createCommunityProjectionEraser, projectionPayloadMatch, projectionReferences,
  projectionSearchPatterns, type ProjectionResources, type ProjectionStateOwner, type ResourceProjectionStore } from "./resource-projection-erasure.js";
import { InMemorySafetyNotificationStore } from "./safety-notification-store.js";

const actor = { issuer: "https://identity.synthetic.test/realms/cop", subjectId: "synthetic-projection-actor" };
const other = { ...actor, subjectId: "synthetic-projection-other" };
const resources: ProjectionResources = { reportIds: ["afbb0534-ce82-4a9b-8780-cf5dfbf6c152"], groupIds: [] };
const context = () => ({ operationId: randomUUID(), actor, signal: new AbortController().signal });
const key = (value: string) => `cop.safety:${createHash("sha256").update(value).digest("hex")}`;
const now = new Date("2026-10-14T00:00:00Z"), expires = new Date(now.getTime() + 60_000);

describe("content projection proof boundaries", () => {
  it("binds resource projections to actual COP namespaces and preserves foreign or untyped references", () => {
    const refs = projectionReferences(resources), id = resources.reportIds[0]!;
    expect(projectionPayloadMatch({ entityType: "communityReport", entityId: id, producerNodeId: "node_central_cop" }, refs)).toBe("owned");
    expect(projectionPayloadMatch({ source: "urn:csm:node:node_central_cop", data: { producerNodeId: "node_central_cop", entityType: "communityReport", entityId: id } }, refs)).toBe("owned");
    expect(projectionPayloadMatch({ entityType: "communityReport", entityId: id, producerNodeId: "foreign_edge" }, refs)).toBe("unknown");
    expect(projectionPayloadMatch({ entityType: "communityReport", entityId: id, producerNodeId: "node_central_cop", source: "urn:foreign" }, refs)).toBe("unknown");
    expect(projectionPayloadMatch({ note: id }, refs)).toBe("unknown");
    expect(projectionPayloadMatch({ id, properties: { sourceId: "community_reports", reportId: id, featureId: `community:${id}` } }, refs)).toBe("owned");
    expect(canonicalProjectionReference(`community:${id}`, "community_reports")).toEqual(refs[0]);
    expect(canonicalProjectionReference(id, "foreign_source")).toBeUndefined();
    expect(() => projectionReferences({ ...resources, reportIds: ["guessed-alias"] })).toThrow("Unproven");
  });

  it("does not trust issuer fields inside a payload, and bounds unverified structures", () => {
    expect(projectionPayloadMatch({ ownerIssuer: actor.issuer, subject: actor.subjectId }, [], actor)).toBe("unknown");
    expect(projectionPayloadMatch({ actor: { issuer: actor.issuer, subjectId: actor.subjectId } }, [], actor)).toBe("unknown");
    expect(projectionPayloadMatch({ note: "other" }, [], actor)).toBe("none");
    expect(projectionSearchPatterns([], { ...actor, subjectId: "a_b%" })).toEqual(["%a\\_b\\%%"]);
    expect(() => projectionPayloadMatch({ note: "x".repeat(1_048_577) }, [])).toThrow("bound");
  });

  it("requires actual producer, all stores and remote erasure readiness instead of accepting labels", async () => {
    const state: ProjectionStateOwner = { ready: vi.fn(async () => true), preflight: vi.fn(async () => ({ ready: true, version: "state-a" })), erase: vi.fn(async () => true) };
    const store: ResourceProjectionStore = { projectionErasureReady: vi.fn(async () => true), preflightActorProjections: vi.fn(async () => ({ ready: true, version: "store-a" })), eraseResourceProjections: vi.fn(async () => true) };
    const options = { stores: [store], state, producerFenceInstalled: () => true, remoteRequired: false };
    expect(await createCommunityProjectionEraser({ ...options, producerFenceInstalled: () => false }).ready()).toBe(false);
    expect(await createCommunityProjectionEraser({ ...options, remoteRequired: true }).ready()).toBe(false);
    const adapter = createCommunityProjectionEraser(options);
    expect(await adapter.ready()).toBe(true);
    const before = await adapter.preflight(actor, context().signal);
    vi.mocked(store.preflightActorProjections).mockResolvedValueOnce({ ready: false, version: "store-b" });
    const after = await adapter.preflight(actor, context().signal);
    expect(after.ready).toBe(false); expect(after.version).not.toBe(before.version);
    vi.mocked(store.eraseResourceProjections).mockResolvedValueOnce(false);
    expect(await adapter.erase(resources, context())).toBe(false);
    expect(state.erase).toHaveBeenCalledWith(resources, expect.objectContaining({ actor }));
    expect(await adapter.erase(resources, { operationId: randomUUID(), signal: context().signal })).toBe(false);
    const remote = { ready: vi.fn(async () => true), erase: vi.fn(async () => false) };
    expect(await createCommunityProjectionEraser({ ...options, remoteRequired: true, remote }).erase(resources, context())).toBe(false);
  });
});

describe("safety recipient projection erasure", () => {
  it("removes only actor devices, recipient ledger and cooldown while fencing late claims and completions", async () => {
    const store = new InMemorySafetyNotificationStore();
    await store.setWebDeviceEligibility(actor.subjectId, "synthetic-device", true, actor);
    await store.setWebDeviceEligibility(other.subjectId, "other-device", true, other);
    const own = await store.claim(key("own"), expires, now, 1000, undefined, actor);
    const retained = await store.claim(key("other"), expires, now, 1000, undefined, other);
    expect((await store.preflightActorProjections(actor)).ready).toBe(true);
    expect(await store.eraseResourceProjections(resources, context())).toBe(true);
    expect(await store.hasEligibleWebDevice(actor.subjectId)).toBe(false);
    expect(await store.hasEligibleWebDevice(other.subjectId)).toBe(true);
    await expect(store.claim(key("late"), expires, now, 1000, undefined, actor)).rejects.toMatchObject({ code: "ACCOUNT_REVOKED" });
    await expect(store.claim(key("unproved"), expires, now, 1000)).rejects.toThrow("Unproven");
    await expect(store.markAccepted(own!, "late-result", now)).rejects.toThrow("owned");
    await store.markAccepted(retained!, "retained-result", now);
    expect(await store.claim(key("other"), expires, new Date(now.getTime() + 2000), 1000, undefined, other)).toBeNull();
  });

  it("preserves unknown historical recipient ownership and never adopts it on renewal", async () => {
    const store = new InMemorySafetyNotificationStore();
    await store.setWebDeviceEligibility(actor.subjectId, "old-device", true);
    await store.setWebDeviceEligibility(actor.subjectId, "old-device", false, actor);
    await store.claim(key("legacy"), expires, now, 1000);
    await store.claim(key("legacy"), expires, new Date(now.getTime() + 2000), 1000, undefined, actor);
    expect((await store.preflightActorProjections(actor)).ready).toBe(false);
    expect(await store.eraseResourceProjections(resources, context())).toBe(false);
    await expect(store.setWebDeviceEligibility(actor.subjectId, "late-device", true, actor)).rejects.toMatchObject({ code: "ACCOUNT_REVOKED" });
    await expect(store.setWebDeviceEligibility(other.subjectId, "unproved-device", true)).rejects.toThrow("Unproven");
  });
});
