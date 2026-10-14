import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresIncidentStore } from "./incident-store.js";
import type { AuthenticatedActor } from "./security.js";

const url = process.env.COP_ERASURE_TEST_DATABASE_URL;
if (url) { const parsed = new URL(url); if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || parsed.pathname !== "/cop_erasure_test") throw new Error("Incident erasure tests require the isolated local cop_erasure_test fixture."); }
const suite = url ? describe : describe.skip, schema = "incident_erasure_test_" + randomUUID().replaceAll("-", "");
const at = new Date("2026-10-14T00:00:00Z"), actor = (subjectId: string, issuer = "https://identity.test/cop"): AuthenticatedActor => ({ authMode: "oidc", issuer, subjectId, displayName: "Synthetic", username: "Synthetic" });
const context = () => ({ operationId: randomUUID(), signal: new AbortController().signal });
const projections = { erase: async () => true }; // Isolated external fixture; no production/provider acceptance claim.
suite("real native PostgreSQL incident account boundary", () => {
  let admin: Pool, db: Pool, store: PostgresIncidentStore;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url, max: 1 }); await admin.query(`CREATE SCHEMA ${schema}`);
    const config = { connectionString: url, max: 1, options: `-c search_path=${schema},public` };
    db = new Pool(config); store = new PostgresIncidentStore(config); await store.init();
  });
  afterAll(async () => { await store?.close(); await db?.end(); if (admin) { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); } });
  const make = (owner: AuthenticatedActor) => store.createIncident({ createdBy: owner, category: "other", severity: "info", location: { lat: 50, lon: 15, source: "manual" }, title: "Synthetic incident", properties: { history: ["SYNTHETIC_OWN_BODY"] } }, at);
  it("reads the original immutable incident creator from real JSON/owner rows, with no attribution of legacy or missing records", async () => {
    const a = actor("native-read-owner"), b = actor("native-read-contributor"), own = await make(a);
    await store.updateIncident(own.incidentId, b, { description: "Another author" }, at);
    const before = await db.query("SELECT * FROM cop_incident_erasure_owners WHERE row_key=$1", [own.incidentId]);
    expect(await store.readVerifiedProjectionOwner("incident", own.incidentId)).toEqual({ issuer: a.issuer, subjectId: a.subjectId });
    expect((await db.query("SELECT * FROM cop_incident_erasure_owners WHERE row_key=$1", [own.incidentId])).rows).toEqual(before.rows);
    const old = await make({ ...a, issuer: undefined }); await store.updateIncident(old.incidentId, a, { title: "Still unproven" }, at);
    expect(await store.readVerifiedProjectionOwner("incident", old.incidentId)).toBeUndefined();
    const other = await make(b);
    expect([...await store.readVerifiedProjectionOwners("incident", [own.incidentId, other.incidentId, old.incidentId, randomUUID(), own.incidentId])].sort()).toEqual([
      [own.incidentId, { issuer: a.issuer, subjectId: a.subjectId }], [other.incidentId, { issuer: b.issuer, subjectId: b.subjectId }]
    ].sort());
    await expect(store.readVerifiedProjectionOwners("incident", Array(1001).fill(own.incidentId))).rejects.toMatchObject({ status: 503 });
    await db.query("DELETE FROM cop_incidents WHERE incident_id=$1", [own.incidentId]);
    expect((await db.query("SELECT 1 FROM cop_incident_erasure_owners WHERE row_key=$1", [own.incidentId])).rowCount).toBe(1);
    expect(await store.readVerifiedProjectionOwner("incident", own.incidentId)).toBeUndefined();
  });
  it("deletes actual own incident/task JSON and witnesses only after verified projection cleanup", async () => {
    const a = actor("native-own"), b = actor("native-other"), own = await make(a), other = await make(b), operation = context();
    const task = await store.createTask({ createdBy: a, incidentId: own.incidentId, title: "Own task", assigneeSubjectId: a.subjectId }, at);
    await store.updateIncident(own.incidentId, a, { description: "Own updated text" }, at);
    const component = store.accountErasureComponent({ projections }); expect(await component.preflight(a, operation.signal)).toMatchObject({ ready: true });
    expect(await store.accountErasureComponent().erase(a, operation)).toMatchObject({ status: "pending" });
    const proof = await component.erase(a, operation); expect(proof.status).toBe("completed"); expect(await component.erase(a, operation)).toEqual(proof);
    expect(await store.getIncident(own.incidentId)).toBeNull(); expect(await store.getTask(task.taskId)).toBeNull(); expect(await store.getIncident(other.incidentId)).not.toBeNull();
    expect(await db.query("SELECT 1 FROM cop_incident_erasure_contributors WHERE subject_id=$1", [a.subjectId])).toHaveProperty("rowCount", 0);
    await expect(make(a)).rejects.toMatchObject({ status: 403 });
  });
  it("serializes a genuinely slow incident UPSERT and deletion with no late recreation", async () => {
    const a = actor("native-race"), own = await make(a), operation = context();
    await db.query("CREATE FUNCTION pause_incident_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.record->'createdBy'->>'subjectId'='native-race' THEN PERFORM pg_sleep(0.15); END IF; RETURN NEW; END $$");
    await db.query("CREATE TRIGGER pause_incident_write BEFORE INSERT ON cop_incidents FOR EACH ROW EXECUTE FUNCTION pause_incident_write()");
    try {
      const update = store.updateIncident(own.incidentId, a, { description: "Admitted before fence" }, at); await new Promise(resolve => setTimeout(resolve, 40));
      const erase = store.accountErasureComponent({ projections }).erase(a, operation);
      await update; expect(await erase).toMatchObject({ status: "completed" }); expect(await store.getIncident(own.incidentId)).toBeNull();
      expect(await db.query("SELECT 1 FROM cop_incident_erasure_owners WHERE creator_subject=$1", [a.subjectId])).toHaveProperty("rowCount", 0);
    } finally { await db.query("DROP TRIGGER pause_incident_write ON cop_incidents"); await db.query("DROP FUNCTION pause_incident_write()"); }
  });
  it("preserves foreign incident edits and a foreign child task rather than using FK cascade as erasure permission", async () => {
    const a = actor("native-shared"), b = actor("native-contributor"), own = await make(a);
    await store.updateIncident(own.incidentId, b, { description: "Preserve foreign contribution" }, at);
    const foreign = await store.createTask({ createdBy: b, incidentId: own.incidentId, title: "Foreign task" }, at), component = store.accountErasureComponent({ projections });
    expect(await component.preflight(a, context().signal)).toEqual({ ready: false, reason: "ownership_unresolved" });
    expect(await component.preflight(b, context().signal)).toEqual({ ready: false, reason: "ownership_unresolved" });
    expect(await component.erase(a, context())).toMatchObject({ status: "pending" });
    expect(await store.getTask(foreign.taskId)).not.toBeNull(); expect(await store.getIncident(own.incidentId)).toHaveProperty("description", "Preserve foreign contribution");
  });
  it("refuses legacy issuer adoption and blocks unresolved shared assignment until its owner unassigns it", async () => {
    const a = actor("native-legacy"), old = await make({ ...a, issuer: undefined } as AuthenticatedActor);
    await store.updateIncident(old.incidentId, a, { title: "Still legacy" }, at);
    expect(await store.accountErasureComponent().preflight(a, context().signal)).toEqual({ ready: false, reason: "ownership_unresolved" });
    expect(await store.accountErasureComponent().ready()).toBe(false);
    const b = actor("native-assignment-owner"), c = actor("native-assignee"), parent = await make(b);
    const task = await store.createTask({ createdBy: b, incidentId: parent.incidentId, title: "Shared assignment", assigneeSubjectId: c.subjectId, assigneeIssuer: c.issuer }, at);
    expect(await store.accountErasureComponent().preflight(c, context().signal)).toEqual({ ready: false, reason: "choice_required" });
    await store.updateTask(task.taskId, b, { assigneeSubjectId: null }, at);
    expect(await store.accountErasureComponent().preflight(c, context().signal)).toMatchObject({ ready: true });
  });
});
