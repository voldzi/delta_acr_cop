import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { PostgresCommunityReportStore } from "../apps/cop-api/dist/community-report-store.js";

const require = createRequire(new URL("../apps/cop-api/package.json", import.meta.url));
const { Pool } = require("pg");
if (!process.env.COP_DATABASE_URL) throw new Error("COP_DATABASE_URL is required. Build the API first.");
const schema = `cop_report_smoke_${randomUUID().replaceAll("-", "")}`;
assert.match(schema, /^cop_report_smoke_[a-f0-9]{32}$/);
const config = {
  connectionString: process.env.COP_DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 5000,
  ssl:
    process.env.COP_DATABASE_SSL === "true"
      ? { rejectUnauthorized: process.env.COP_DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" }
      : false
};
const admin = new Pool(config);
const store = new PostgresCommunityReportStore({
  ...config,
  options: `-c search_path=${schema},public`,
  max: 1
});
let createdSchema = false;
try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  createdSchema = true;
  await store.init();
  const tables = await admin.query("SELECT table_name FROM information_schema.tables WHERE table_schema = $1", [
    schema
  ]);
  assert(tables.rows.some((row) => row.table_name === "cop_community_report_confirmations"));
  const now = new Date("2026-09-21T10:00:00Z");
  const actor = { subjectId: "smoke-author", username: "smoke-author", displayName: "Isolated store smoke" };
  const location = { lat: 50.08, lon: 14.42, accuracyM: 5, source: "device" };
  const report = await store.createReport(
    {
      category: "traffic_accident",
      createdBy: actor,
      location,
      observedAt: now.toISOString(),
      title: "Isolated smoke",
      visibility: "private",
      properties: { validUntil: "2026-09-21T14:00:00Z" }
    },
    now
  );
  assert(await store.submitReport(report.reportId, actor.subjectId, now));
  await store.upsertReportConfirmation(report.reportId, actor.subjectId, "still_there", now);
  await store.upsertReportConfirmation(report.reportId, "witness-1", "still_there", now);
  await store.upsertReportConfirmation(report.reportId, "witness-2", "still_there", now);
  let summary = (await store.listConfirmationSummaries([report.reportId], actor.subjectId))[report.reportId];
  assert.equal(summary.totalCount, 3);
  assert.equal(summary.independentStillThereCount, 2);
  assert.equal(summary.currentActorValue, "still_there");
  await store.upsertReportConfirmation(report.reportId, "witness-2", "not_there", now);
  summary = (await store.listConfirmationSummaries([report.reportId], "witness-2"))[report.reportId];
  assert.equal(summary.totalCount, 3);
  assert.equal(summary.independentStillThereCount, 1);
  assert.equal(summary.independentNotThereCount, 1);
  assert.equal(summary.currentActorValue, "not_there");
  assert.equal(
    (
      await store.listReports({
        subjectId: actor.subjectId,
        activeAt: now.toISOString(),
        bbox: { west: 14.4, east: 14.5, south: 50, north: 50.1 }
      })
    ).length,
    1
  );
  assert.equal((await store.listReports({ subjectId: actor.subjectId, activeAt: "2026-09-21T14:00:00Z" })).length, 0);
  assert.equal(
    (await store.listReports({ subjectId: actor.subjectId, activeAt: "2026-09-21T14:00:00Z", includeExpired: true }))
      .length,
    1
  );
  const group = await store.createGroup(
    { createdBy: actor, name: "Isolated smoke discussion", visibility: "private" },
    now
  );
  assert(await store.updateGroupMetadata({ actor, groupId: group.groupId, metadata: { smoke: true } }, now));
  console.log(
    JSON.stringify({
      result: "passed",
      checks: [
        "postgres-author-exclusion",
        "replace-one-vote",
        "spatial-filter",
        "expiry-boundary",
        "history",
        "group-metadata"
      ]
    })
  );
} finally {
  await store.close();
  if (createdSchema) {
    // Only this invocation's randomly named schema can be removed.
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    console.log(JSON.stringify({ isolatedSchemaRemoved: true }));
  }
  await admin.end();
}
