import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { PostgresCommunityReportStore } from "./community-report-store.js";
import type { AuthenticatedActor } from "./security.js";
const connectionString = process.env.COP_LEGACY_PROVENANCE_TEST_URL;
if (connectionString) { const u = new URL(connectionString); if (u.hostname !== "127.0.0.1" || u.pathname !== "/cop_legacy_provenance_test") throw new Error("Owned loopback provenance fixture required"); }
const issuer = "https://legacy-provenance.synthetic.invalid/realms/cop", now = new Date("2026-10-10T00:00:00Z");
const actor = (subjectId: string): AuthenticatedActor => ({ authMode: "oidc", issuer, subjectId, username: "Synthetic", displayName: "Synthetic" });
const lab = { subjectId: "lab", username: "Lab", displayName: "Lab" };
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
async function fixture() {
 const admin = new Pool({ connectionString, max: 2 }), schema = "cop_nonaccount_" + randomUUID().replaceAll("-", "");
 await admin.query(`CREATE SCHEMA ${schema}`);
 const store = new PostgresCommunityReportStore({ connectionString, max: 3, options: `-c search_path=${schema},public` }); await store.init();
 const mark = async (kind: string, table: string, key: string, rowKey: string) => {
  const text = (await admin.query(`SELECT to_jsonb(r)::text t FROM ${schema}.${table} r WHERE ${key}=$1`, [rowKey])).rows[0].t;
  const witness = (await admin.query(`SELECT to_jsonb(o)::text t FROM ${schema}.cop_community_erasure_ownership o WHERE kind=$1 AND row_key=$2`, [kind, rowKey])).rows[0]?.t ?? "null";
  await admin.query(`INSERT INTO ${schema}.cop_legacy_nonaccount_provenance VALUES($1,$2,'hardcoded_lab','b13fbdc71f3d9821f8b857c3f73255a75c46fa76',$3,$4,$5)`, [kind, rowKey, "a".repeat(64), sha(text), sha(witness)]);
 };
 const report = () => store.createReport({ createdBy: lab, category: "hazard", title: "Synthetic lab", visibility: "public", observedAt: now.toISOString(), location: { lat: 50, lon: 14, source: "manual" } }, now);
 return { admin, schema, store, mark, report, async close() { await store.close(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } };
}
describe.skipIf(!connectionString)("actual PostgreSQL typed non-account legacy boundary", () => {
 it("recognizes only exact approved lab rows and preserves them while another verified account is erased", async () => {
  const f = await fixture(); try {
   const report = await f.report(); expect(await f.store.accountErasureComponent().ready!()).toBe(false);
   await f.mark("report", "cop_community_reports", "report_id::text", report.reportId); expect(await f.store.accountErasureComponent().ready!()).toBe(true);
   expect(await f.store.readVerifiedProjectionOwner("report", report.reportId)).toBeUndefined();
   const b = actor(randomUUID()), own = await f.store.withVerifiedActor(b, () => f.store.createReport({ createdBy: b, category: "hazard", title: "Synthetic B", visibility: "private", observedAt: now.toISOString(), location: { lat: 50, lon: 14, source: "manual" } }, now));
   const component = f.store.accountErasureComponent({ projections: { erase: async () => true } });
   expect(await component.erase(b, { operationId: randomUUID(), signal: new AbortController().signal })).toMatchObject({ status: "completed" });
   expect(await f.store.getReport(own.reportId)).toBeNull(); expect(await f.store.getReport(report.reportId)).toEqual(report);
  } finally { await f.close(); }
 });
 it("blocks readiness after any complete-row mutation, without reclassifying the new content", async () => {
  const f = await fixture(); try { const r = await f.report(); await f.mark("report", "cop_community_reports", "report_id::text", r.reportId); expect(await f.store.accountErasureComponent().ready!()).toBe(true);
   await f.admin.query(`UPDATE ${f.schema}.cop_community_reports SET title='Synthetic changed' WHERE report_id=$1`, [r.reportId]); expect(await f.store.accountErasureComponent().ready!()).toBe(false);
  } finally { await f.close(); }
 });
 it("blocks readiness after a nullable insertion witness changes or is attributed to any OIDC account", async () => {
  const f = await fixture(); try { const r = await f.report(); await f.mark("report", "cop_community_reports", "report_id::text", r.reportId);
   await f.admin.query(`UPDATE ${f.schema}.cop_community_erasure_ownership SET issuer=$1 WHERE kind='report' AND row_key=$2`, [issuer, r.reportId]); expect(await f.store.accountErasureComponent().ready!()).toBe(false);
  } finally { await f.close(); }
 });
 it("rejects foreign OIDC writes and the literal OIDC subject lab without adopting system rows", async () => {
  const f = await fixture(); try { const r = await f.report(); await f.mark("report", "cop_community_reports", "report_id::text", r.reportId);
   for (const identity of [actor(randomUUID()), actor("lab")]) {
    await expect(f.store.withVerifiedActor(identity, () => f.store.updateReport(r.reportId, identity.subjectId, { title: "Forbidden" }, now))).rejects.toMatchObject({ status: 404 });
    await expect(f.store.withVerifiedActor(identity, () => f.store.createReport({ reportId: r.reportId, createdBy: identity, category: "hazard", title: "Forbidden", visibility: "public", observedAt: now.toISOString(), location: { lat: 50, lon: 14, source: "manual" } }, now))).rejects.toMatchObject({ status: 404 });
   }
   expect(await f.store.getReport(r.reportId)).toEqual(r); expect(await f.store.readVerifiedProjectionOwner("report", r.reportId)).toBeUndefined();
  } finally { await f.close(); }
 });
 it("protects a classified lab group from metadata/member writes and treats new lab rows as unknown", async () => {
  const f = await fixture(); try {
   const group = await f.store.createGroup({ createdBy: lab, name: "Synthetic lab group", visibility: "public" }, now);
   await f.mark("group", "cop_community_groups", "group_id::text", group.groupId);
   await f.mark("membership", "cop_community_group_members", "group_id::text||':'||subject_id", group.groupId + ":lab");
   expect(await f.store.accountErasureComponent().ready!()).toBe(true); const b = actor(randomUUID());
   await expect(f.store.withVerifiedActor(b, () => f.store.updateGroupMetadata({ actor: b, groupId: group.groupId, metadata: { blocked: true } }, now))).rejects.toMatchObject({ status: 404 });
   await f.report(); expect(await f.store.accountErasureComponent().ready!()).toBe(false);
  } finally { await f.close(); }
 });
 it("recognizes an exact legacy lab confirmation by composite key and blocks mutation or OIDC adoption", async () => {
  const f = await fixture(); try {
   const report = await f.report();
   await f.store.upsertReportConfirmation(report.reportId, "lab", "still_there", now);
   await f.mark("report", "cop_community_reports", "report_id::text", report.reportId);
   expect(await f.store.accountErasureComponent().ready!()).toBe(false);
   await f.mark("confirmation", "cop_community_report_confirmations", "report_id::text||':'||subject_id", report.reportId + ":lab");
   expect(await f.store.accountErasureComponent().ready!()).toBe(true);
   await expect(f.store.withVerifiedActor(actor("lab"), () => f.store.upsertReportConfirmation(report.reportId, "lab", "not_there", now))).rejects.toMatchObject({ status: 404 });
   await f.admin.query(`UPDATE ${f.schema}.cop_community_report_confirmations SET confirmation='not_there' WHERE report_id=$1 AND subject_id='lab'`, [report.reportId]);
   expect(await f.store.accountErasureComponent().ready!()).toBe(false);
  } finally { await f.close(); }
 });
 it("fails closed on an orphan marker and never assigns it to a current account", async () => {
  const f = await fixture(); try { const r = await f.report(); await f.mark("report", "cop_community_reports", "report_id::text", r.reportId); await f.admin.query(`DELETE FROM ${f.schema}.cop_community_reports WHERE report_id=$1`, [r.reportId]);
   expect(await f.store.accountErasureComponent().ready!()).toBe(false); expect(await f.store.readVerifiedProjectionOwner("report", r.reportId)).toBeUndefined();
  } finally { await f.close(); }
 });
});
