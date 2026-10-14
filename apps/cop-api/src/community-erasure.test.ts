import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { InMemoryCommunityReportStore } from "./community-report-store.js";
import type { AuthenticatedActor } from "./security.js";
import type { MediaStorage } from "./media-storage.js";

const actor = (subjectId: string, issuer = "https://identity.test/cop"): AuthenticatedActor => ({ authMode: "oidc", issuer, subjectId, displayName: "Synthetic", username: "Synthetic" });
const now = new Date("2026-10-14T00:00:00Z");
const context = () => ({ operationId: randomUUID(), signal: new AbortController().signal });
const projections = { erase: vi.fn(async () => true) };
const media: MediaStorage = { name: "synthetic-media-fixture", close: async () => {}, init: async () => {},
  createUploadSlot: vi.fn(), createReadUrl: vi.fn(), getObject: vi.fn(), putObject: vi.fn(), eraseVerifiedObject: vi.fn(async () => "absent" as const) };
async function report(store: InMemoryCommunityReportStore, owner: AuthenticatedActor, reportId?: string) {
  return store.withVerifiedActor(owner, () => store.createReport({ createdBy: owner, ...(reportId ? { reportId } : {}), category: "hazard", title: "Synthetic owned report", observedAt: now.toISOString(), visibility: "public", location: { lat: 50, lon: 15, source: "manual" } }, now));
}
describe("actual RAM community erasure boundary", () => {
  it("reads only the immutable original projection owner and never adopts legacy ownership or a deleted row", async () => {
    const store = new InMemoryCommunityReportStore(), a = actor("read-owner"), own = await report(store, a);
    expect(own.createdBy).not.toHaveProperty("issuer");
    const witness = await store.readVerifiedProjectionOwner("report", own.reportId);
    expect(witness).toEqual({ issuer: a.issuer, subjectId: a.subjectId });
    witness!.issuer = "https://mutated-copy.test";
    expect(await store.readVerifiedProjectionOwner("report", own.reportId)).toEqual({ issuer: a.issuer, subjectId: a.subjectId });
    const old = await store.createReport({ createdBy: { ...a, issuer: undefined }, category: "hazard", title: "Legacy", visibility: "public", observedAt: now.toISOString(), location: { lat: 50, lon: 15, source: "manual" } }, now);
    await store.withVerifiedActor(a, () => store.updateReport(old.reportId, a.subjectId, { title: "Current login cannot attest" }, now));
    expect(await store.readVerifiedProjectionOwner("report", old.reportId)).toBeUndefined();
    const other = await report(store, actor("read-other"));
    expect([...await store.readVerifiedProjectionOwners("report", [own.reportId, other.reportId, own.reportId, old.reportId, randomUUID(), "invalid"])].sort()).toEqual([
      [own.reportId, { issuer: a.issuer, subjectId: a.subjectId }], [other.reportId, { issuer: a.issuer, subjectId: "read-other" }]
    ].sort());
    await expect(store.readVerifiedProjectionOwners("report", Array(1001).fill(own.reportId))).rejects.toMatchObject({ status: 503 });
    await store.withVerifiedActor(a, () => store.deleteReport(own.reportId, a.subjectId, now));
    expect(await store.readVerifiedProjectionOwner("report", own.reportId)).toBeUndefined();
    expect(await store.readVerifiedProjectionOwner("report", "not-a-proven-uuid")).toBeUndefined();
  });
  it("removes own reports, memberships, confirmations and fields while preserving other authors and namespaces", async () => {
    const store = new InMemoryCommunityReportStore(), a = actor("a"), b = actor("b"), foreign = actor("a", "https://foreign.test/cop"), operation = context();
    const own = await report(store, a), other = await report(store, b), otherIssuer = await report(store, foreign);
    const group = await store.withVerifiedActor(b, () => store.createGroup({ createdBy: b, name: "Synthetic shared", visibility: "public" }, now));
    await store.withVerifiedActor(b, () => store.upsertGroupMember({ actor: b, groupId: group.groupId, member: a, status: "active" }, now));
    await store.withVerifiedActor(a, () => store.updateGroupMetadata({ actor: a, groupId: group.groupId, metadata: { ownOne: "remove", ownTwo: "remove" } }, now));
    await store.withVerifiedActor(b, () => store.updateGroupMetadata({ actor: b, groupId: group.groupId, metadata: { other: "keep" } }, now));
    await store.withVerifiedActor(a, () => store.upsertReportConfirmation(other.reportId, a.subjectId, "still_there", now));
    const component = store.accountErasureComponent({ projections });
    expect(await component.preflight(a, operation.signal)).toMatchObject({ ready: true });
    expect(await store.accountErasureComponent().erase(a, operation)).toMatchObject({ status: "pending" });
    expect(await component.erase(a, operation)).toMatchObject({ status: "completed" });
    expect(await store.getReport(own.reportId)).toBeNull(); expect(await store.getReport(other.reportId)).toHaveProperty("reportId", other.reportId);
    expect(await store.getReport(otherIssuer.reportId)).toHaveProperty("reportId", otherIssuer.reportId);
    expect((await store.getGroup(group.groupId))?.metadata).toEqual({ other: "keep" });
    expect((await store.getGroup(group.groupId))?.members.map(member => member.subjectId)).toEqual([b.subjectId]);
    expect((await store.listConfirmationSummaries([other.reportId]))[other.reportId]?.totalCount ?? 0).toBe(0);
    await expect(report(store, a)).rejects.toMatchObject({ status: 403 });
    expect(await report(store, foreign)).toHaveProperty("reportId");
    expect(own.createdBy).not.toHaveProperty("issuer");
  });

  it("rejects mismatched verified writer identity and a report ID collision belonging to another account", async () => {
    const store = new InMemoryCommunityReportStore(), a = actor("a"), b = actor("b"), own = await report(store, a);
    await expect(store.withVerifiedActor(b, () => store.createReport({ createdBy: a, reportId: randomUUID(), category: "hazard", title: "spoof", visibility: "public", observedAt: now.toISOString(), location: { lat: 50, lon: 15, source: "manual" } }, now))).rejects.toMatchObject({ status: 401 });
    await expect(report(store, b, own.reportId)).rejects.toMatchObject({ status: 404 });
    await expect(store.withVerifiedActor(actor("a", "https://foreign.test/cop"), () => store.updateReport(own.reportId, a.subjectId, { title: "foreign attempt" }, now))).rejects.toMatchObject({ status: 404 });
  });

  it("does not infer ownership of legacy rows from a new authenticated operation", async () => {
    const store = new InMemoryCommunityReportStore(), a = actor("a");
    const legacy = await store.createReport({ createdBy: { ...a, issuer: undefined }, category: "hazard", title: "Legacy", visibility: "public", observedAt: now.toISOString(), location: { lat: 50, lon: 15, source: "manual" } }, now);
    await store.withVerifiedActor(a, () => store.updateReport(legacy.reportId, a.subjectId, { title: "Updated legacy" }, now));
    expect(await store.accountErasureComponent().preflight(a, context().signal)).toEqual({ ready: false, reason: "ownership_unresolved" });
    expect(await store.accountErasureComponent().erase(a, context())).toMatchObject({ status: "pending" });
    expect(await store.getReport(legacy.reportId)).toHaveProperty("reportId", legacy.reportId);
  });

  it("requires shared group ownership resolution before fencing and removing any group data", async () => {
    const store = new InMemoryCommunityReportStore(), a = actor("a"), group = await store.withVerifiedActor(a, () => store.createGroup({ createdBy: a, name: "Shared", visibility: "public" }, now));
    expect(await store.accountErasureComponent().preflight(a, context().signal)).toEqual({ ready: false, reason: "choice_required" });
    expect(await store.accountErasureComponent().erase(a, context())).toMatchObject({ status: "pending" });
    expect(await store.getGroup(group.groupId)).toHaveProperty("groupId", group.groupId);
  });

  it("preserves exact original/derivative manifests and waits for an admitted media write and expiry", async () => {
    const store = new InMemoryCommunityReportStore(), a = actor("a"), own = await report(store, a), attachmentId = randomUUID(), operation = context();
    const objectKey = `community-reports/${own.reportId}/${attachmentId}/file.mov`;
    await store.withVerifiedActor(a, () => store.createAttachment({ attachmentId, reportId: own.reportId, subjectId: a.subjectId, bucket: "synthetic-bucket", objectKey,
      kind: "video", contentType: "video/quicktime", byteSize: 12, uploadExpiresAt: "2026-01-01T00:00:00Z" }));
    let finish!: () => void; const derivative = `community-reports/${own.reportId}/${attachmentId}/derivatives/xr-sbs.mp4`;
    const write = store.withOwnedMediaWrite({ reportId: own.reportId, attachmentId, objectKey: derivative }, () => new Promise<void>(resolve => { finish = resolve; }));
    while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
    const component = store.accountErasureComponent({ media, projections, now: () => new Date("2027-01-01T00:00:00Z") });
    expect(await component.erase(a, operation)).toMatchObject({ status: "pending" });
    finish(); await write; expect(await component.erase(a, operation)).toMatchObject({ status: "completed" });
    expect(media.eraseVerifiedObject).toHaveBeenCalledWith({ bucket: "synthetic-bucket", objectKey: derivative }, new Date("2027-01-01T00:00:00Z"), operation.signal);
    expect(await store.getReport(own.reportId)).toBeNull();
  });
  it("keeps the longest retried upload URL deadline and rejects retries once permanent erasure wins", async () => {
    const store = new InMemoryCommunityReportStore(), a = actor("a"), own = await report(store, a), attachmentId = randomUUID(), operation = context(); let instant = now.getTime();
    const objectKey = `community-reports/${own.reportId}/${attachmentId}/file.jpg`;
    await store.withVerifiedActor(a, () => store.createAttachment({ attachmentId, reportId: own.reportId, subjectId: a.subjectId, bucket: "synthetic-bucket", objectKey, kind: "photo", byteSize: 12, contentType: "image/jpeg", uploadExpiresAt: new Date(instant + 1000).toISOString() }));
    const retry = { reportId: own.reportId, attachmentId, objectKey, subjectId: a.subjectId, issuer: a.issuer!, expiresAt: new Date(instant + 120000).toISOString() };
    await store.extendOwnedMediaUpload(retry); await store.extendOwnedMediaUpload({ ...retry, expiresAt: new Date(instant + 500).toISOString() });
    const eraseObject = vi.fn(async () => "absent" as const), component = store.accountErasureComponent({ media: { ...media, eraseVerifiedObject: eraseObject }, projections, now: () => new Date(instant) });
    instant += 31000; expect(await component.erase(a, operation)).toMatchObject({ status: "pending" }); expect(eraseObject).not.toHaveBeenCalled();
    await expect(store.extendOwnedMediaUpload(retry)).rejects.toMatchObject({ status: 403 });
    instant = now.getTime() + 150000; expect(await component.erase(a, operation)).toMatchObject({ status: "completed" });
  });
});
