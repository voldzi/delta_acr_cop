import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PostgresSketchDrawingStore } from "./sketch-store.js";
import { PostgresCommunityReportStore } from "./community-report-store.js";
import type { AuthenticatedActor } from "./security.js";
import type { MediaStorage } from "./media-storage.js";
import { contentOwnerKey } from "./content-erasure.js";
import { PostgresIncidentStore } from "./incident-store.js";

const url = process.env.COP_ERASURE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || parsed.pathname !== "/cop_erasure_test") throw new Error("Content erasure tests require the isolated local cop_erasure_test fixture.");
}
const suite = url ? describe : describe.skip;
const schema = "content_erasure_test_" + randomUUID().replaceAll("-", "");
const actor = (subjectId: string, issuer = "https://identity.test/cop"): AuthenticatedActor => ({ authMode: "oidc", issuer, subjectId, displayName: "Synthetic", username: "Synthetic" });
const at = new Date("2026-10-14T00:00:00Z");
const context = () => ({ operationId: randomUUID(), signal: new AbortController().signal });
suite("real PostgreSQL content erasure", () => {
  let admin: Pool, db: Pool, sketch: PostgresSketchDrawingStore, community: PostgresCommunityReportStore, incidents: PostgresIncidentStore;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url, max: 1 }); await admin.query(`CREATE SCHEMA ${schema}`);
    const config = { connectionString: url, max: 2, options: `-c search_path=${schema},public` };
    db = new Pool(config); sketch = new PostgresSketchDrawingStore(config); community = new PostgresCommunityReportStore(config);
    incidents = new PostgresIncidentStore(config); await sketch.init(); await community.init(); await incidents.init();
  }, 30000);
  afterAll(async () => {
    await sketch?.close(); await community?.close(); await incidents?.close(); await db?.end();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); }
  });
  async function report(owner: AuthenticatedActor, id = randomUUID()) {
    return community.withVerifiedActor(owner, () => community.createReport({ reportId: id, createdBy: owner, category: "hazard", title: "SYNTHETIC_OWN_CONTENT",
      location: { lat: 50, lon: 15, source: "manual" }, observedAt: at.toISOString(), visibility: "public" }, at));
  }
  const projections = { erase: vi.fn(async () => true) }; // Synthetic external proof; real provider acceptance is a separate gate.
  const media: MediaStorage = { name: "synthetic-owned-object-fixture", close: async () => {}, init: async () => {},
    createUploadSlot: vi.fn(), createReadUrl: vi.fn(), getObject: vi.fn(), putObject: vi.fn(), eraseVerifiedObject: vi.fn(async () => "absent" as const) };

  it("reads a real immutable report-owner witness only while the exact authoritative row exists, with no legacy backfill", async () => {
    const a = actor("pg-read-owner"), own = await report(a);
    expect(await community.readVerifiedProjectionOwner("report", own.reportId)).toEqual({ issuer: a.issuer, subjectId: a.subjectId });
    const before = await db.query("SELECT * FROM cop_community_erasure_ownership WHERE row_key=$1", [own.reportId]);
    await community.readVerifiedProjectionOwner("report", own.reportId);
    expect((await db.query("SELECT * FROM cop_community_erasure_ownership WHERE row_key=$1", [own.reportId])).rows).toEqual(before.rows);
    const old = await community.createReport({ createdBy: { ...a, issuer: undefined }, category: "hazard", title: "Legacy", location: { lat: 50, lon: 15, source: "manual" }, observedAt: at.toISOString(), visibility: "private" }, at);
    await community.withVerifiedActor(a, () => community.updateReport(old.reportId, a.subjectId, { title: "Still unproven" }, at));
    expect(await community.readVerifiedProjectionOwner("report", old.reportId)).toBeUndefined();
    const b = actor("pg-read-other"), other = await report(b);
    expect([...await community.readVerifiedProjectionOwners("report", [own.reportId, other.reportId, old.reportId, randomUUID(), own.reportId])].sort()).toEqual([
      [own.reportId, { issuer: a.issuer, subjectId: a.subjectId }], [other.reportId, { issuer: b.issuer, subjectId: b.subjectId }]
    ].sort());
    await expect(community.readVerifiedProjectionOwners("report", Array(1001).fill(own.reportId))).rejects.toMatchObject({ status: 503 });
    await db.query("DELETE FROM cop_community_reports WHERE report_id=$1", [own.reportId]);
    expect((await db.query("SELECT 1 FROM cop_community_erasure_ownership WHERE row_key=$1", [own.reportId])).rowCount).toBe(1);
    expect(await community.readVerifiedProjectionOwner("report", own.reportId)).toBeUndefined();
  });

  it("hard removes sketches plus their existing soft-deleted geometry and actor audit while preserving another issuer", async () => {
    const a = actor("pg-sketch-a"), b = actor("pg-sketch-a", "https://foreign.test/cop"), operation = context();
    const make = (owner: AuthenticatedActor) => sketch.create({ actor: owner, kind: "point", geometry: { type: "Point", coordinates: [15, 50] }, visibility: "public" }, at);
    const own = await make(a), old = await make(a), foreign = await make(b); await sketch.delete(old.id, a, at);
    const component = sketch.accountErasureComponent({ projections }); expect(await component.preflight(a, operation.signal)).toMatchObject({ ready: true });
    const proof = await component.erase(a, operation); expect(proof.status).toBe("completed"); expect(await component.erase(a, operation)).toEqual(proof);
    expect(await db.query("SELECT 1 FROM cop_user_drawings WHERE drawing_id=ANY($1::uuid[])", [[own.id, old.id]])).toHaveProperty("rowCount", 0);
    expect(await db.query("SELECT 1 FROM cop_user_drawing_audit WHERE drawing_id=ANY($1::uuid[])", [[own.id, old.id]])).toHaveProperty("rowCount", 0);
    expect(await sketch.get(foreign.id)).toHaveProperty("id", foreign.id);
    await expect(make(a)).rejects.toMatchObject({ status: 403 });
  });

  it("serializes a real slow sketch INSERT with deletion, preventing an admitted write from surviving the fence", async () => {
    const a = actor("pg-race-sketch"), operation = context();
    await db.query("CREATE FUNCTION pause_sketch_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.owner_subject_id='pg-race-sketch' THEN PERFORM pg_sleep(0.15); END IF; RETURN NEW; END $$");
    await db.query("CREATE TRIGGER pause_sketch_write BEFORE INSERT ON cop_user_drawings FOR EACH ROW EXECUTE FUNCTION pause_sketch_write()");
    try {
      const admitted = sketch.create({ actor: a, kind: "point", geometry: { type: "Point", coordinates: [15, 50] }, visibility: "private" }, at);
      await new Promise(resolve => setTimeout(resolve, 40));
      const erased = sketch.accountErasureComponent({ projections }).erase(a, operation);
      await admitted; expect(await erased).toMatchObject({ status: "completed" });
      expect(await db.query("SELECT 1 FROM cop_user_drawings WHERE owner_subject_id=$1", [a.subjectId])).toHaveProperty("rowCount", 0);
      expect(await db.query("SELECT 1 FROM cop_user_drawing_audit WHERE actor_subject_id=$1", [a.subjectId])).toHaveProperty("rowCount", 0);
    } finally { await db.query("DROP TRIGGER pause_sketch_write ON cop_user_drawings"); await db.query("DROP FUNCTION pause_sketch_write()"); }
  });

  it("rolls back a sketch INSERT when its same-transaction audit fails", async () => {
    const a = actor("pg-failed-audit");
    await db.query("CREATE FUNCTION fail_sketch_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor_subject_id='pg-failed-audit' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$");
    await db.query("CREATE TRIGGER fail_sketch_audit BEFORE INSERT ON cop_user_drawing_audit FOR EACH ROW EXECUTE FUNCTION fail_sketch_audit()");
    try {
      await expect(sketch.create({ actor: a, kind: "point", geometry: { type: "Point", coordinates: [15, 50] }, visibility: "private" }, at)).rejects.toBeDefined();
      expect(await db.query("SELECT 1 FROM cop_user_drawings WHERE owner_subject_id=$1", [a.subjectId])).toHaveProperty("rowCount", 0);
    } finally { await db.query("DROP TRIGGER fail_sketch_audit ON cop_user_drawing_audit"); await db.query("DROP FUNCTION fail_sketch_audit()"); }
  });

  it("keeps legacy sketch and community ownership unresolved and never adopts the signed actor on a later update", async () => {
    const a = actor("pg-legacy");
    const drawing = await sketch.create({ actor: { ...a, issuer: undefined }, kind: "point", geometry: { type: "Point", coordinates: [15, 50] }, visibility: "private" }, at);
    await sketch.update(drawing.id, a, { label: "synthetic update" }, at);
    expect(await sketch.accountErasureComponent({ projections }).preflight(a, context().signal)).toEqual({ ready: false, reason: "ownership_unresolved" });
    const old = await community.createReport({ createdBy: { ...a, issuer: undefined }, category: "hazard", title: "legacy", location: { lat: 50, lon: 15, source: "manual" }, observedAt: at.toISOString(), visibility: "private" }, at);
    await community.withVerifiedActor(a, () => community.updateReport(old.reportId, a.subjectId, { title: "still legacy" }, at));
    expect(await community.accountErasureComponent().preflight(a, context().signal)).toEqual({ ready: false, reason: "ownership_unresolved" });
    expect(await community.accountErasureComponent().erase(a, context())).toMatchObject({ status: "pending" });
    expect(await community.getReport(old.reportId)).toHaveProperty("reportId", old.reportId);
  });

  it("removes own report, confirmations and metadata fields while preserving other authors and requiring projection readback", async () => {
    const a = actor("pg-community-a"), b = actor("pg-community-b"), operation = context();
    const own = await report(a), other = await report(b);
    const group = await community.withVerifiedActor(b, () => community.createGroup({ createdBy: b, name: "Synthetic shared group", visibility: "public" }, at));
    await community.withVerifiedActor(b, () => community.upsertGroupMember({ actor: b, groupId: group.groupId, member: a, status: "active" }, at));
    await community.withVerifiedActor(a, () => community.updateGroupMetadata({ actor: a, groupId: group.groupId, metadata: { ownField: "remove", ownSecond: "remove" } }, at));
    await community.withVerifiedActor(b, () => community.updateGroupMetadata({ actor: b, groupId: group.groupId, metadata: { otherField: "keep" } }, at));
    await community.withVerifiedActor(a, () => community.upsertReportConfirmation(other.reportId, a.subjectId, "still_there", at));
    const component = community.accountErasureComponent({ projections });
    expect(await component.preflight(a, operation.signal)).toMatchObject({ ready: true });
    expect(await community.accountErasureComponent().erase(a, operation)).toMatchObject({ status: "pending" });
    expect(await db.query("SELECT 1 FROM cop_content_erasure_projection_manifest WHERE owner_key=$1", [contentOwnerKey(a)])).toHaveProperty("rowCount", 1);
    expect(await component.erase(a, operation)).toMatchObject({ status: "completed" });
    expect(await community.getReport(own.reportId)).toBeNull(); expect(await community.getReport(other.reportId)).toHaveProperty("reportId", other.reportId);
    const remaining = await community.getGroup(group.groupId); expect(remaining?.metadata).toEqual({ otherField: "keep" });
    expect(remaining?.members.map(member => member.subjectId)).toEqual([b.subjectId]);
    expect(await db.query("SELECT 1 FROM cop_community_report_confirmations WHERE subject_id=$1", [a.subjectId])).toHaveProperty("rowCount", 0);
    await expect(report(a)).rejects.toMatchObject({ status: 403 });
    await expect(community.withVerifiedActor(a, () => community.upsertReportConfirmation(other.reportId, a.subjectId, "still_there", at))).rejects.toMatchObject({ status: 403 });
  });

  it("blocks an unresolved shared group owner instead of removing others' shared data", async () => {
    const a = actor("pg-group-owner"); const group = await community.withVerifiedActor(a, () => community.createGroup({ createdBy: a, name: "Keep shared resource", visibility: "public" }, at));
    const component = community.accountErasureComponent({ projections });
    expect(await component.preflight(a, context().signal)).toEqual({ ready: false, reason: "choice_required" });
    expect(await component.erase(a, context())).toMatchObject({ status: "pending" });
    expect(await community.getGroup(group.groupId)).toHaveProperty("groupId", group.groupId);
  });

  it("keeps exact attachment manifests across ordinary draft deletion and waits for expiry plus successful provider absence", async () => {
    const a = actor("pg-media"), own = await report(a), attachmentId = randomUUID(), operation = context(); let instant = at.getTime();
    const key = `community-reports/${own.reportId}/${attachmentId}/file.jpg`;
    await community.withVerifiedActor(a, () => community.createAttachment({ attachmentId, reportId: own.reportId, subjectId: a.subjectId, bucket: "synthetic-bucket", objectKey: key,
      kind: "photo", byteSize: 12, contentType: "image/jpeg", uploadExpiresAt: new Date(instant + 60000).toISOString() }));
    await community.withVerifiedActor(a, () => community.deleteReport(own.reportId, a.subjectId, at));
    const deleteObject = vi.fn(async () => "absent" as "absent" | "pending"), ownedMedia = { ...media, eraseVerifiedObject: deleteObject };
    const component = community.accountErasureComponent({ media: ownedMedia, projections, now: () => new Date(instant) });
    expect(await component.erase(a, operation)).toMatchObject({ status: "pending" }); expect(deleteObject).not.toHaveBeenCalled();
    instant += 90000; deleteObject.mockResolvedValueOnce("pending");
    expect(await component.erase(a, operation)).toMatchObject({ status: "pending" });
    expect(await component.erase(a, operation)).toMatchObject({ status: "completed" });
    expect(deleteObject).toHaveBeenCalledWith({ bucket: "synthetic-bucket", objectKey: key }, new Date(instant), operation.signal);
    expect(await db.query("SELECT 1 FROM cop_community_owned_media WHERE subject_id=$1", [a.subjectId])).toHaveProperty("rowCount", 0);
  });

  it("holds erasure pending while an admitted derivative PUT is in flight and never drops unknown-outcome leases", async () => {
    const a = actor("pg-active-media"), own = await report(a), attachmentId = randomUUID(), operation = context();
    const input = { attachmentId, reportId: own.reportId, subjectId: a.subjectId, bucket: "synthetic-bucket", objectKey: `community-reports/${own.reportId}/${attachmentId}/file.mov`,
      kind: "video" as const, byteSize: 12, contentType: "video/quicktime", uploadExpiresAt: "2026-01-01T00:00:00Z" };
    await community.withVerifiedActor(a, () => community.createAttachment(input));
    let finish!: () => void;
    const write = community.withOwnedMediaWrite({ reportId: own.reportId, attachmentId, objectKey: `community-reports/${own.reportId}/${attachmentId}/derivatives/xr-sbs.mp4` },
      () => new Promise<void>(resolve => { finish = resolve; }));
    while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
    const component = community.accountErasureComponent({ media, projections, now: () => new Date("2027-01-01T00:00:00Z") });
    expect(await component.erase(a, operation)).toMatchObject({ status: "pending" });
    expect(await db.query("SELECT 1 FROM cop_content_erasure_media_manifest WHERE owner_key=$1", [contentOwnerKey(a)])).toHaveProperty("rowCount", 2);
    finish(); await write; expect(await component.erase(a, operation)).toMatchObject({ status: "completed" });
    const c = actor("pg-unknown-media"), another = await report(c), second = randomUUID();
    await community.withVerifiedActor(c, () => community.createAttachment({ ...input, attachmentId: second, reportId: another.reportId, subjectId: c.subjectId, objectKey: `community-reports/${another.reportId}/${second}/file.mov` }));
    await expect(community.withOwnedMediaWrite({ reportId: another.reportId, attachmentId: second, objectKey: `community-reports/${another.reportId}/${second}/file.mov` }, async () => { throw new Error("synthetic unknown provider result"); })).rejects.toBeDefined();
    expect(await component.erase(c, context())).toMatchObject({ status: "pending" });
    expect(await db.query("SELECT 1 FROM cop_community_media_write_leases WHERE subject_id=$1", [c.subjectId])).toHaveProperty("rowCount", 1);
  });

  it("prevents a second issuer with the same subject from altering a known user's report", async () => {
    const a = actor("pg-cross-issuer"), b = actor(a.subjectId, "https://foreign.test/cop"), own = await report(a);
    await expect(community.withVerifiedActor(b, () => community.updateReport(own.reportId, b.subjectId, { title: "foreign mutation" }, at))).rejects.toMatchObject({ status: 404 });
    expect(await community.getReport(own.reportId)).toHaveProperty("title", "SYNTHETIC_OWN_CONTENT");
  });

  it("extends a retried presigned upload deadline monotonically before any erasure can take its manifest", async () => {
    const a = actor("pg-retry-media"), own = await report(a), attachmentId = randomUUID(), operation = context(); let instant = at.getTime();
    const objectKey = `community-reports/${own.reportId}/${attachmentId}/file.jpg`;
    await community.withVerifiedActor(a, () => community.createAttachment({ attachmentId, reportId: own.reportId, subjectId: a.subjectId, bucket: "synthetic-bucket", objectKey, kind: "photo", byteSize: 12, contentType: "image/jpeg", uploadExpiresAt: new Date(instant + 60000).toISOString() }));
    const retry = { reportId: own.reportId, attachmentId, objectKey, subjectId: a.subjectId, issuer: a.issuer!, expiresAt: new Date(instant + 180000).toISOString() };
    await community.extendOwnedMediaUpload(retry);
    await community.extendOwnedMediaUpload({ ...retry, expiresAt: new Date(instant + 1000).toISOString() });
    const deleteObject = vi.fn(async () => "absent" as const), component = community.accountErasureComponent({ media: { ...media, eraseVerifiedObject: deleteObject }, projections, now: () => new Date(instant) });
    instant += 90000; expect(await component.erase(a, operation)).toMatchObject({ status: "pending" }); expect(deleteObject).not.toHaveBeenCalled();
    await expect(community.extendOwnedMediaUpload(retry)).rejects.toMatchObject({ status: 403 });
    const pending = await db.query<{ not_before: Date }>("SELECT not_before FROM cop_content_erasure_media_manifest WHERE owner_key=$1", [contentOwnerKey(a)]);
    expect(pending.rows[0]?.not_before.toISOString()).toBe(new Date(at.getTime() + 210000).toISOString());
    instant = at.getTime() + 210000; expect(await component.erase(a, operation)).toMatchObject({ status: "completed" });
  });

  it("hard removes actually owned incidents, tasks, JSON history and actor witnesses after projection absence", async () => {
    const a = actor("pg-incident-owner"), b = actor("pg-other-incident-owner"), operation = context();
    const make = (owner: AuthenticatedActor) => incidents.createIncident({ createdBy: owner, category: "community", severity: "info", location: { lat: 50, lon: 15, source: "manual" }, title: "Synthetic incident", properties: { ownHistory: ["SYNTHETIC_PRIVATE_BODY"] } }, at);
    const own = await make(a), other = await make(b), task = await incidents.createTask({ createdBy: a, incidentId: own.incidentId, title: "Own task", assigneeSubjectId: a.subjectId }, at);
    await incidents.updateIncident(own.incidentId, a, { description: "Own updated prose" }, at);
    const component = incidents.accountErasureComponent({ projections }); expect(await component.preflight(a, operation.signal)).toMatchObject({ ready: true });
    expect(await incidents.accountErasureComponent().erase(a, operation)).toMatchObject({ status: "pending" });
    expect(await component.erase(a, operation)).toMatchObject({ status: "completed" });
    expect(await incidents.getIncident(own.incidentId)).toBeNull(); expect(await incidents.getTask(task.taskId)).toBeNull(); expect(await incidents.getIncident(other.incidentId)).not.toBeNull();
    expect(await db.query("SELECT 1 FROM cop_incident_erasure_contributors WHERE subject_id=$1", [a.subjectId])).toHaveProperty("rowCount", 0);
    expect(await db.query("SELECT 1 FROM cop_incident_erasure_owners WHERE creator_subject=$1", [a.subjectId])).toHaveProperty("rowCount", 0);
    await expect(make(a)).rejects.toMatchObject({ status: 403 });
  });

  it("keeps shared incident edits, foreign tasks and unknown incident owner provenance before deletion", async () => {
    const a = actor("pg-shared-incident"), b = actor("pg-shared-contributor");
    const own = await incidents.createIncident({ createdBy: a, category: "other", severity: "info", location: { lat: 50, lon: 15, source: "manual" }, title: "Preserve shared incident" }, at);
    await incidents.updateIncident(own.incidentId, b, { description: "Foreign contribution" }, at);
    expect(await incidents.accountErasureComponent().preflight(a, context().signal)).toEqual({ ready: false, reason: "ownership_unresolved" });
    expect(await incidents.accountErasureComponent().preflight(b, context().signal)).toEqual({ ready: false, reason: "ownership_unresolved" });
    expect(await incidents.accountErasureComponent().erase(a, context())).toMatchObject({ status: "pending" });
    expect(await incidents.getIncident(own.incidentId)).toHaveProperty("description", "Foreign contribution");
    const legacyActor = actor("pg-legacy-incident"), legacy = await incidents.createIncident({ createdBy: { ...legacyActor, issuer: undefined }, category: "other", severity: "info", location: { lat: 50, lon: 15, source: "manual" }, title: "Legacy" }, at);
    await incidents.updateIncident(legacy.incidentId, legacyActor, { title: "Still legacy" }, at);
    expect(await incidents.accountErasureComponent().preflight(legacyActor, context().signal)).toEqual({ ready: false, reason: "ownership_unresolved" });
  });
});
