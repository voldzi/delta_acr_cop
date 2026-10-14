import { describe, expect, it } from "vitest";
import { InMemorySketchDrawingStore, type SketchDrawingActor } from "./sketch-store.js";
import type { AuthenticatedActor } from "./security.js";

const actor = (subjectId: string, issuer = "https://identity.test/cop"): AuthenticatedActor => ({
  authMode: "oidc", issuer, subjectId, displayName: "Synthetic", username: "Synthetic"
});
const projections = { erase: async () => true };
const now = new Date("2026-10-14T00:00:00Z");
const context = () => ({ operationId: "dfcbb0af-b688-41ae-9bd8-e8699e008738", signal: new AbortController().signal });
async function create(store: InMemorySketchDrawingStore, owner: SketchDrawingActor) {
  return store.create({ actor: owner, kind: "point", geometry: { type: "Point", coordinates: [15, 50] }, visibility: "public", label: "SYNTHETIC_PRIVATE_DRAWING" }, now);
}

describe("sketch erasure component", () => {
  it("hard removes own visible and previously deleted drawings and audit links, preserving others and issuer isolation", async () => {
    const store = new InMemorySketchDrawingStore(), a = actor("a"), own = await create(store, a), prior = await create(store, a);
    const b = await create(store, actor("b")), otherIssuer = await create(store, actor("a", "https://other.test/cop"));
    await store.delete(prior.id, a, now);
    const component = store.accountErasureComponent({ projections });
    expect(await component.preflight(a, context().signal)).toEqual({ ready: true, version: "cop-sketch-erasure-v1" });
    const result = await component.erase(a, context()); expect(result.status).toBe("completed");
    expect(await component.erase(a, context())).toEqual(result);
    expect(await store.get(own.id)).toBeNull(); expect(await store.get(prior.id)).toBeNull();
    expect(await store.get(b.id)).toEqual(b); expect(await store.get(otherIssuer.id)).toEqual(otherIssuer);
    expect(await store.list({})).toHaveLength(2);
    await expect(create(store, a)).rejects.toMatchObject({ status: 403 });
    await expect(store.update(own.id, a, { label: "late update" }, now)).rejects.toMatchObject({ status: 403 });
    await expect(store.delete(own.id, a, now)).rejects.toMatchObject({ status: 403 });
    // An old caller that lacks issuer cannot evade a permanent subject fence.
    await expect(create(store, { ...a, issuer: undefined })).rejects.toMatchObject({ status: 403 });
    expect(await create(store, actor("a", "https://other.test/cop"))).toHaveProperty("id");
  });

  it("does not let a foreign issuer with a matching subject update or delete a known owner", async () => {
    const store = new InMemorySketchDrawingStore(), own = await create(store, actor("a")), foreign = actor("a", "https://foreign.test/cop");
    expect(await store.update(own.id, foreign, { label: "attempt" }, now)).toBeNull();
    expect(await store.delete(own.id, foreign, now)).toBe(false);
    expect(await store.get(own.id)).toEqual(own);
  });

  it("keeps unknown legacy ownership pending, fences late writes, and never adopts a JWT issuer into an existing drawing", async () => {
    const store = new InMemorySketchDrawingStore(), a = actor("a"), legacy = await create(store, { ...a, issuer: undefined });
    await store.update(legacy.id, a, { label: "new issuer must not migrate ownership" }, now);
    const component = store.accountErasureComponent({ projections });
    expect(await component.preflight(a, context().signal)).toEqual({ ready: false, reason: "ownership_unresolved" });
    expect(await component.erase(a, context())).toEqual({ status: "pending", remaining: "cleanup_pending" });
    expect(await store.get(legacy.id)).toHaveProperty("id", legacy.id);
    await expect(create(store, a)).rejects.toMatchObject({ status: 403 });
  });

  it("rejects conflicting erasure IDs and cancellation without inventing a whole-domain proof", async () => {
    const store = new InMemorySketchDrawingStore(), component = store.accountErasureComponent({ projections }), a = actor("a");
    const controller = new AbortController(); controller.abort();
    await expect(component.erase(a, { ...context(), signal: controller.signal })).rejects.toBeDefined();
    expect(await create(store, a)).toHaveProperty("id");
    await component.erase(a, context());
    await expect(component.erase(a, { ...context(), operationId: "other-operation" })).rejects.toMatchObject({ status: 409 });
    expect(component.component).toBe("sketch_drawings:memory");
    expect(component).not.toHaveProperty("id", "cop_content_media");
  });
});
