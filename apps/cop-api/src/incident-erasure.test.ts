import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryIncidentStore } from "./incident-store.js";
import type { AuthenticatedActor } from "./security.js";
const actor = (subjectId: string, issuer = "https://identity.test/cop"): AuthenticatedActor => ({ authMode: "oidc", issuer, subjectId, displayName: "Synthetic", username: "Synthetic" });
const now = new Date("2026-10-14T00:00:00Z");
const context = () => ({ operationId: randomUUID(), signal: new AbortController().signal });
const projections = { erase: async () => true };
const incident = (store: InMemoryIncidentStore, owner: AuthenticatedActor) => store.createIncident({ createdBy: owner, category: "community", severity: "info", location: { lat: 50, lon: 15, source: "manual" }, title: "Synthetic own incident" }, now);
describe("actual incident/task erasure", () => {
  it("exposes a detached immutable creator witness, retaining unknown legacy and absent records as unproven", async () => {
    const store = new InMemoryIncidentStore(), a = actor("read-owner"), b = actor("read-contributor"), own = await incident(store, a);
    await store.updateIncident(own.incidentId, b, { description: "Separate contributor" }, now);
    expect(await store.readVerifiedProjectionOwner("incident", own.incidentId)).toEqual({ issuer: a.issuer, subjectId: a.subjectId });
    const old = await store.createIncident({ createdBy: { ...a, issuer: undefined }, category: "other", severity: "info", location: { lat: 50, lon: 15, source: "manual" }, title: "Legacy" }, now);
    await store.updateIncident(old.incidentId, a, { title: "Current login cannot attest creator" }, now);
    expect(await store.readVerifiedProjectionOwner("incident", old.incidentId)).toBeUndefined();
    const other = await incident(store, b);
    expect([...await store.readVerifiedProjectionOwners("incident", [own.incidentId, other.incidentId, old.incidentId, own.incidentId, randomUUID(), "invalid"])].sort()).toEqual([
      [own.incidentId, { issuer: a.issuer, subjectId: a.subjectId }], [other.incidentId, { issuer: b.issuer, subjectId: b.subjectId }]
    ].sort());
    await expect(store.readVerifiedProjectionOwners("incident", Array(1001).fill(own.incidentId))).rejects.toMatchObject({ status: 503 });
    expect(await store.readVerifiedProjectionOwner("incident", randomUUID())).toBeUndefined();
    expect(await store.readVerifiedProjectionOwner("incident", "non-uuid")).toBeUndefined();
  });
  it("removes own incident and tasks only after projected copies are verified, preserving another issuer and other authors", async () => {
    const store = new InMemoryIncidentStore(), a = actor("a"), b = actor("b"), foreign = actor("a", "https://foreign.test/cop"), operation = context();
    const own = await incident(store, a), other = await incident(store, b), otherIssuer = await incident(store, foreign);
    const task = await store.createTask({ createdBy: a, incidentId: own.incidentId, title: "Own task", assigneeSubjectId: a.subjectId }, now);
    expect(await store.accountErasureComponent().preflight(a, operation.signal)).toMatchObject({ ready: true });
    expect(await store.accountErasureComponent().erase(a, operation)).toMatchObject({ status: "pending" });
    const component = store.accountErasureComponent({ projections }); expect(await component.erase(a, operation)).toMatchObject({ status: "completed" });
    expect(await store.getIncident(own.incidentId)).toBeNull(); expect(await store.getTask(task.taskId)).toBeNull();
    expect(await store.getIncident(other.incidentId)).toHaveProperty("incidentId", other.incidentId);
    expect(await store.getIncident(otherIssuer.incidentId)).toHaveProperty("incidentId", otherIssuer.incidentId);
    await expect(incident(store, a)).rejects.toMatchObject({ status: 403 });
    await expect(store.updateIncident(own.incidentId, a, { title: "late" }, now)).rejects.toMatchObject({ status: 403 });
  });
  it("blocks shared edits for both the creator and contributor, preserving the other person's contribution", async () => {
    const store = new InMemoryIncidentStore(), a = actor("a"), b = actor("b"), shared = await incident(store, a);
    await store.updateIncident(shared.incidentId, b, { description: "Other author contribution" }, now);
    const component = store.accountErasureComponent({ projections });
    expect(await component.preflight(a, context().signal)).toEqual({ ready: false, reason: "ownership_unresolved" });
    expect(await component.preflight(b, context().signal)).toEqual({ ready: false, reason: "ownership_unresolved" });
    expect(await component.erase(a, context())).toMatchObject({ status: "pending" });
    expect(await store.getIncident(shared.incidentId)).toHaveProperty("description", "Other author contribution");
  });
  it("blocks a foreign child task cascade and unresolved shared assignment before any deletion", async () => {
    const store = new InMemoryIncidentStore(), a = actor("a"), b = actor("b"), own = await incident(store, a);
    const foreignTask = await store.createTask({ createdBy: b, incidentId: own.incidentId, title: "Preserve foreign task" }, now);
    const component = store.accountErasureComponent({ projections }); expect(await component.preflight(a, context().signal)).toEqual({ ready: false, reason: "ownership_unresolved" });
    expect(await component.erase(a, context())).toMatchObject({ status: "pending" }); expect(await store.getTask(foreignTask.taskId)).not.toBeNull();
    const another = await incident(store, b), assigned = await store.createTask({ createdBy: b, incidentId: another.incidentId, title: "Third-party assignment", assigneeSubjectId: "c", assigneeIssuer: a.issuer }, now);
    expect(await component.preflight(actor("c"), context().signal)).toEqual({ ready: false, reason: "choice_required" });
    await store.updateTask(assigned.taskId, b, { assigneeSubjectId: null }, now);
    expect(await component.preflight(actor("c"), context().signal)).toMatchObject({ ready: true });
  });
  it("does not adopt an issuer into a legacy incident and rejects dangling tasks on a removed incident", async () => {
    const store = new InMemoryIncidentStore(), a = actor("a");
    const legacy = await store.createIncident({ createdBy: { ...a, issuer: undefined }, category: "other", severity: "info", location: { lat: 50, lon: 15, source: "manual" }, title: "Legacy" }, now);
    await store.updateIncident(legacy.incidentId, a, { title: "Still legacy" }, now);
    expect(await store.accountErasureComponent({ projections }).preflight(a, context().signal)).toEqual({ ready: false, reason: "ownership_unresolved" });
    await expect(store.createTask({ createdBy: actor("b"), incidentId: "not-existing", title: "No phantom parent" }, now)).rejects.toMatchObject({ status: 404 });
  });
});
