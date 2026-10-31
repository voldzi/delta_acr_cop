import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createInitialState, appendAudit } from "./state.js";
import { installCopStateProjectionOwner, runWithProjectionActor, runWithProjectionHydration, runWithVerifiedProjectionOwner, type CopStateProjectionOptions } from "./cop-state-erasure.js";
import { runtimeOwnerHash, runtimeSubjectHash } from "./runtime-owner-erasure.js";
import type { ProjectionFenceSnapshot, ProjectionStateOwner } from "./resource-projection-erasure.js";
import type { ObservedObject } from "@cop/canonical-model";
import { ContentErasureStoreError } from "./content-erasure.js";

const actor = { issuer: "https://identity.synthetic.test/realms/cop", subjectId: "synthetic-state-owner" };
const other = { ...actor, subjectId: "synthetic-state-other" };
const context = () => ({ operationId: randomUUID(), signal: new AbortController().signal, actor });
const emptyFrontier = (): ProjectionFenceSnapshot => ({ resources: [], ownerHashes: [], subjectHashes: [], version: "synthetic" });
const object = (owner: string, id = randomUUID()): ObservedObject => ({ objectId: id, objectType: "REPORT", affiliation: "NEUTRAL", domain: "COMMUNITY", status: "ACTIVE", ownerSubjectId: owner });
function fixture(initial?: ReturnType<typeof createInitialState>, frontier = emptyFrontier()) {
  const state = initial ?? createInitialState(), revoked = new Set<string>();
  const retainedCopies: ProjectionStateOwner = { ready: vi.fn(async () => true), preflight: vi.fn(async () => ({ ready: true, version: "copied-a" })), erase: vi.fn(async () => true) };
  const options: CopStateProjectionOptions = { issuer: actor.issuer, cachedGuard: { ready: () => true, assertActorAllowed(owner) { if (revoked.has(runtimeOwnerHash(owner))) throw new ContentErasureStoreError(403, "CACHED_ACCOUNT_FENCE"); } },
    loadFences: async () => frontier, retainedCopies };
  const port = installCopStateProjectionOwner(state, options);
  return { state, port, options, retainedCopies, revoked };
}

describe("actual COP RAM projection ownership and producer boundary", () => {
  it("checks the final batch record and keeps per-record limits and durable fences", async () => {
    const id = randomUUID(), frontier = emptyFrontier();
    frontier.resources.push({ kind: "communityReport", id });
    frontier.subjectHashes.push(runtimeSubjectHash(actor.subjectId));
    const f = fixture(undefined, frontier); await f.port.init();
    const batch = Array.from({ length: 204 }, () => ({ syntheticDescription: "s".repeat(6144) }));
    expect(Buffer.byteLength(JSON.stringify(batch))).toBeGreaterThan(1_048_576);
    expect(() => f.port.assertWriteAllowed(batch)).not.toThrow();
    expect(() => f.port.assertWriteAllowed([...batch, { nested: { sourceReference: id } }])).toThrow("FENCED");
    expect(() => f.port.assertWriteAllowed([...batch, { nested: { subjectId: actor.subjectId } }])).toThrow("FENCED");
    expect(() => f.port.assertWriteAllowed([...batch, { syntheticDescription: "s".repeat(1_048_576) }])).toThrow("UNAVAILABLE");
    expect(() => f.port.assertWriteAllowed(Array.from({ length: 100001 }, () => null))).toThrow("UNAVAILABLE");
  });

  it("binds all actual collection pointers, preserves detached/frozen records and supports ordinary cloneable views", async () => {
    const f = fixture();
    expect(await f.port.ready()).toBe(false);
    await expect(Promise.resolve().then(() => f.state.objects.set("unready", object(actor.subjectId)))).rejects.toThrow("UNAVAILABLE");
    await f.port.init(); expect(f.port.producerBindingInstalled()).toBe(true); expect(f.port.usesState(f.state)).toBe(true);
    expect(f.port.usesState(createInitialState())).toBe(false);
    const original = object(actor.subjectId);
    runWithProjectionActor(actor, () => f.state.objects.set(original.objectId, original));
    original.ownerSubjectId = other.subjectId;
    const actual = f.state.objects.get(original.objectId)!;
    expect(actual.ownerSubjectId).toBe(actor.subjectId); expect(Object.isFrozen(actual)).toBe(true);
    expect(() => { actual.ownerSubjectId = other.subjectId; }).toThrow();
    expect(structuredClone(actual)).toEqual(actual);
    expect(structuredClone(f.state.federatedNodes)).toBeInstanceOf(Map);
    expect(JSON.stringify(actual)).not.toContain("ownerIssuer");
    expect(() => Object.defineProperty(f.state, "objects", { value: new Map() })).toThrow();
    vi.mocked(f.retainedCopies.ready).mockResolvedValueOnce(false); expect(await f.port.ready()).toBe(false);
  });

  it("erases actor-owned canonical state, acknowledgements, audits, idempotency and history while preserving other users", async () => {
    const f = fixture(); await f.port.init();
    for (const owner of [actor, other]) runWithVerifiedProjectionOwner(owner, () => {
      const value = object(owner.subjectId);
      f.state.objects.set(value.objectId, value);
      f.state.alertAcknowledgements.set(value.objectId, { alertId: value.objectId, acknowledgedAt: "2026-10-14T00:00:00Z", acknowledgedBy: owner.subjectId });
      f.state.idempotency.set(owner.subjectId, { hash: "synthetic", response: { subjectId: owner.subjectId } });
      f.state.trackHistory.set(value.objectId, [{ objectId: value.objectId, eventId: randomUUID(), objectType: "REPORT", affiliation: "NEUTRAL", status: "ACTIVE", lat: 50, lon: 14,
        timestamp: "2026-10-14T00:00:00Z", producerTimestamp: "2026-10-14T00:00:00Z", sourceSystemId: "community_reports", synthetic: true }]);
      appendAudit(f.state, "SYNTHETIC", { subjectId: owner.subjectId });
    });
    expect((await f.port.preflight(actor)).ready).toBe(true);
    expect(await f.port.erase({ reportIds: [], groupIds: [] }, context())).toBe(true);
    expect([...f.state.objects.values()].map(row => row.ownerSubjectId)).toEqual([other.subjectId]);
    expect([...f.state.alertAcknowledgements.values()].map(row => row.acknowledgedBy)).toEqual([other.subjectId]);
    expect([...f.state.idempotency.keys()]).toEqual([other.subjectId]); expect(f.state.trackHistory.size).toBe(1);
    expect(f.state.auditEvents).toEqual([expect.objectContaining({ subjectId: other.subjectId })]);
    expect(f.retainedCopies.erase).toHaveBeenCalledWith({ reportIds: [], groupIds: [] }, expect.objectContaining({ actor }));
    expect(() => runWithProjectionActor(actor, () => appendAudit(f.state, "LATE", { subjectId: actor.subjectId }))).toThrow("FENCED");
    expect(() => runWithProjectionActor(actor, () => f.state.objects.clear())).toThrow("FENCED");
    expect(() => runWithProjectionActor(actor, () => f.state.auditEvents.pop())).toThrow("FENCED");
  });

  it("never adopts legacy or hydrated witnesses, or trusts forged issuer fields", async () => {
    const state = createInitialState(), value = object(actor.subjectId);
    state.objects.set(value.objectId, value); state.auditEvents.push({ auditId: randomUUID(), subjectId: actor.subjectId, ownerIssuer: actor.issuer });
    const f = fixture(state); await f.port.init();
    runWithProjectionActor(actor, () => f.state.objects.set(value.objectId, { ...value, status: "ACTIVE" }));
    expect((await f.port.preflight(actor)).ready).toBe(false);
    expect(await f.port.erase({ reportIds: [], groupIds: [] }, context())).toBe(false);
    expect(f.state.objects.size).toBe(1); expect(f.state.auditEvents).toHaveLength(1);
    expect(() => { f.state.auditEvents[0]!.subjectId = other.subjectId; }).toThrow();
  });

  it("purges only proven resource namespaces and leaves foreign/untyped copies pending", async () => {
    const f = fixture(); await f.port.init(); const id = randomUUID(), foreignId = randomUUID();
    const own = object("unattributed", id), foreign = object("unattributed", foreignId);
    own.attributes = { provenance: { sourceSystemId: "community_reports" } };
    foreign.attributes = { provenance: { sourceSystemId: "foreign_edge" }, reportId: id };
    f.state.objects.set(id, own); f.state.objects.set(foreignId, foreign);
    f.state.domainDeadLetters.push({ deadLetterId: randomUUID(), channel: "cop.domain.events", correlationId: "synthetic", errorCode: "SYNTHETIC", message: "synthetic", receivedAt: "2026-10-14T00:00:00Z",
      body: { entityType: "communityReport", entityId: id, producerNodeId: "node_central_cop" } });
    expect(await f.port.erase({ reportIds: [id], groupIds: [] }, context())).toBe(false);
    expect(f.state.objects.has(id)).toBe(false); expect(f.state.objects.has(foreignId)).toBe(true); expect(f.state.domainDeadLetters).toHaveLength(1);
    expect(() => f.state.objects.set(id, own)).toThrow("FENCED");
    expect(() => { f.state.domainDeadLetters = [...f.state.domainDeadLetters, { ...f.state.domainDeadLetters[0]!, deadLetterId: randomUUID() }]; }).toThrow("FENCED");
  });

  it("restores durable actor/resource frontiers before writers and rejects asynchronous work after commit", async () => {
    const id = randomUUID(), frontier = emptyFrontier(); frontier.resources.push({ kind: "communityReport", id }); frontier.ownerHashes.push(runtimeOwnerHash(actor)); frontier.subjectHashes.push(runtimeSubjectHash(actor.subjectId));
    const restored = fixture(undefined, frontier); await restored.port.init();
    expect(() => restored.state.objects.set(id, object("other", id))).toThrow("FENCED");
    expect(() => runWithProjectionActor(actor, () => appendAudit(restored.state, "LATE", {}))).toThrow("FENCED");
    const live = fixture(); await live.port.init();
    let release!: () => void; const awaiting = new Promise<void>(resolve => { release = resolve; });
    const late = runWithProjectionActor(actor, async () => { await awaiting; appendAudit(live.state, "ASYNC", {}); });
    live.revoked.add(runtimeOwnerHash(actor)); live.port.fence(actor); release();
    await expect(late).rejects.toThrow("CACHED_ACCOUNT_FENCE"); expect(live.state.auditEvents).toEqual([]);
    const before = await live.port.preflight(other);
    vi.mocked(live.retainedCopies.preflight).mockResolvedValueOnce({ ready: false, version: "copied-b" });
    const after = await live.port.preflight(other); expect(after.ready).toBe(false); expect(after.version).not.toBe(before.version);
  });

  it("invalidates cached admission proofs when the accepted durable job frontier changes", async () => {
    const state = createInitialState(); let generation = 1, revoked = false;
    const guard = { ready: () => true, version: () => generation, assertActorAllowed: vi.fn((owner: typeof actor) => { if (revoked && owner.subjectId === actor.subjectId) throw new ContentErasureStoreError(403, "CACHED_ACCOUNT_FENCE"); }) };
    const port = installCopStateProjectionOwner(state, { issuer: actor.issuer, cachedGuard: guard, loadFences: async () => emptyFrontier(),
      retainedCopies: { ready: async () => true, preflight: async () => ({ ready: true, version: "empty" }), erase: async () => true } });
    await port.init(); runWithProjectionActor(actor, () => appendAudit(state, "FIRST", {}));
    revoked = true; generation++;
    expect(() => runWithProjectionActor(actor, () => appendAudit(state, "AFTER_COMMIT", {}))).toThrow("CACHED_ACCOUNT_FENCE");
    expect(state.auditEvents).toHaveLength(1);
  });

  it("rechecks lease expiry and the durable frontier for previously accepted immutable records", async () => {
    const f = fixture(); let generation = 1, ready = true;
    f.options.cachedGuard.version = () => generation;
    f.options.cachedGuard.ready = () => ready;
    await f.port.init();
    const original = object(actor.subjectId);
    f.state.objects.set(original.objectId, original);
    const retained = f.state.objects.get(original.objectId)!;
    f.port.assertWriteAllowed(retained); f.port.assertWriteAllowed(retained);
    ready = false;
    expect(() => f.port.assertWriteAllowed(retained)).toThrow("UNAVAILABLE");
    ready = true; generation++; f.revoked.add(runtimeOwnerHash(actor));
    expect(() => f.port.assertWriteAllowed(retained)).toThrow("CACHED_ACCOUNT_FENCE");
    expect(() => f.state.objects.set(original.objectId, retained)).toThrow("CACHED_ACCOUNT_FENCE");
    expect(() => f.state.objects.set(original.objectId, { ...retained, confidence: 0.25 })).toThrow("CACHED_ACCOUNT_FENCE");
    expect(f.state.objects.get(original.objectId)).toBe(retained);
  });

  it("does not transfer an immutable admission to changed payloads when a state snapshot is replaced", async () => {
    const f = fixture(); let generation = 1;
    f.options.cachedGuard.version = () => generation;
    await f.port.init();
    const original = object(other.subjectId); f.state.objects.set(original.objectId, original);
    const retained = f.state.objects.get(original.objectId)!;
    f.port.assertWriteAllowed(retained);
    f.state.objects = new Map([[original.objectId, retained]]);
    expect(f.state.objects.get(original.objectId)).toBe(retained);
    generation++; f.revoked.add(runtimeOwnerHash(actor));
    expect(() => { f.state.objects = new Map([[original.objectId, { ...retained, ownerSubjectId: actor.subjectId }]]); }).toThrow("CACHED_ACCOUNT_FENCE");
    expect(f.state.objects.get(original.objectId)).toBe(retained);
    expect(() => f.port.assertWriteAllowed(retained)).not.toThrow();
  });

  it("invalidates immutable admissions for local resource fences and reloaded fences without a durable version change", async () => {
    const frontier = emptyFrontier(), f = fixture(undefined, frontier);
    f.options.cachedGuard.version = () => 1;
    await f.port.init();
    const first = object(other.subjectId), second = object(other.subjectId);
    f.state.objects.set(first.objectId, first); f.state.objects.set(second.objectId, second);
    const a = f.state.objects.get(first.objectId)!, b = f.state.objects.get(second.objectId)!;
    f.port.assertWriteAllowed(a); f.port.assertWriteAllowed(b);
    f.port.fence(actor, { reportIds: [first.objectId], groupIds: [] });
    expect(() => f.port.assertWriteAllowed(a)).toThrow("FENCED");
    expect(() => f.port.assertWriteAllowed(b)).not.toThrow();
    frontier.resources.push({ kind: "communityReport", id: second.objectId });
    await f.port.init();
    expect(() => f.port.assertWriteAllowed(b)).toThrow("FENCED");
  });

  it("never treats an externally shallow-frozen object as an immutable admission witness", async () => {
    const f = fixture(); f.options.cachedGuard.version = () => 1;
    await f.port.init();
    const nested = { note: "synthetic-safe" }, external = Object.freeze({ nested });
    f.port.assertWriteAllowed(external); f.port.assertWriteAllowed(external);
    f.port.fence(actor);
    nested.note = actor.subjectId;
    expect(() => f.port.assertWriteAllowed(external)).toThrow("FENCED");
  });

  it("does not reuse immutable admission when the guard has no version or for a fenced explicit caller", async () => {
    const f = fixture(); await f.port.init();
    const original = object(actor.subjectId); f.state.objects.set(original.objectId, original);
    const retained = f.state.objects.get(original.objectId)!;
    f.port.assertWriteAllowed(retained);
    f.revoked.add(runtimeOwnerHash(actor));
    expect(() => f.port.assertWriteAllowed(retained)).toThrow("CACHED_ACCOUNT_FENCE");
    f.revoked.clear(); f.options.cachedGuard.version = () => 1;
    f.port.assertWriteAllowed(retained, other); f.port.assertWriteAllowed(retained, other);
    f.port.fence(other);
    expect(() => f.port.assertWriteAllowed(retained, other)).toThrow("FENCED");
  });

  it("clears a newly verified resolver association while preserving another author's payload", async () => {
    const f = fixture(); await f.port.init();
    const value = { deadLetterId: randomUUID(), channel: "cop.domain.events" as const, correlationId: "synthetic", errorCode: "SYNTHETIC", message: "synthetic", receivedAt: "2026-10-14T00:00:00Z", body: { thirdParty: other.subjectId } };
    runWithVerifiedProjectionOwner(other, () => f.state.domainDeadLetters.push(value));
    runWithProjectionActor(actor, () => { f.state.domainDeadLetters[0] = { ...f.state.domainDeadLetters[0]!, resolvedBy: actor.subjectId }; });
    expect((await f.port.preflight(actor)).ready).toBe(true);
    expect(await f.port.erase({ reportIds: [], groupIds: [] }, context())).toBe(true);
    expect(f.state.domainDeadLetters).toEqual([value]);
  });

  it("does not adopt legacy hydrated bodies under a signed viewer context, including asynchronous reads", async () => {
    const f = fixture(); await f.port.init();
    const record = { deadLetterId: randomUUID(), channel: "cop.domain.events" as const, correlationId: "synthetic", errorCode: "SYNTHETIC", message: "synthetic", receivedAt: "2026-10-14T00:00:00Z", body: { subjectId: actor.subjectId } };
    await runWithProjectionActor(actor, () => runWithProjectionHydration(async () => {
      await Promise.resolve(); f.state.domainDeadLetters.push(record);
    }));
    expect((await f.port.preflight(actor)).ready).toBe(false);
    expect(await f.port.erase({ reportIds: [], groupIds: [] }, context())).toBe(false);
    expect(f.state.domainDeadLetters).toHaveLength(1);
    expect(() => runWithProjectionHydration(() => f.state.domainDeadLetters.push({ ...record, deadLetterId: randomUUID() }))).toThrow("FENCED");
  });

  it("keeps the established 5000-point history capacity with individually bounded immutable records", async () => {
    const f = fixture(); await f.port.init(); const id = randomUUID();
    const point = { objectId: id, objectType: "REPORT" as const, affiliation: "NEUTRAL" as const, status: "ACTIVE" as const, lat: 50, lon: 14,
      timestamp: "2026-10-14T00:00:00Z", producerTimestamp: "2026-10-14T00:00:00Z", sourceSystemId: "synthetic-source", synthetic: true };
    const points = Array.from({ length: 5000 }, () => ({ ...point, eventId: randomUUID() }));
    f.state.trackHistory.set(id, points);
    expect(f.state.trackHistory.get(id)).toHaveLength(5000);
    const existing = f.state.trackHistory.get(id)!;
    f.state.trackHistory.set(id, [...existing.slice(1), { ...point, eventId: randomUUID() }]);
    expect(f.state.trackHistory.get(id)).toHaveLength(5000);
    expect(f.state.trackHistory.get(id)![0]).toBe(existing[1]);
  });
});
