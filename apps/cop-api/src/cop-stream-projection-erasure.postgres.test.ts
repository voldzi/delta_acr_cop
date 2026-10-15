import { randomUUID } from "node:crypto";
import { Pool, type PoolConfig } from "pg";
import { describe, expect, it } from "vitest";
import type { ObservedObject } from "@cop/canonical-model";
import { PostgresCopStreamBus } from "./cop-stream-bus.js";
import { contentErasureSchema, contentOwnerKey } from "./content-erasure.js";
import type { CopStreamMessage } from "./cop-stream.js";

const connectionString = process.env.COP_ERASURE_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/cop_erasure_test") throw new Error("Requires isolated loopback cop_erasure_test database");
}
const a = { issuer: "https://identity.synthetic.test/realms/cop", subjectId: "synthetic-stream-a" }, b = { ...a, subjectId: "synthetic-stream-b" };
function message(ids: string[]): CopStreamMessage {
  return { type: "delta", sequence: 7, serverTimestamp: "2026-10-15T00:00:00Z", changes: ids.map(id => ({ changeType: "OBJECT_UPSERT",
    object: { objectId: id, objectType: "REPORT", affiliation: "NEUTRAL", domain: "LAND", status: "ACTIVE", synthetic: true,
      attributes: { provenance: { sourceSystemId: "community_reports" } } } as ObservedObject })) };
}
async function fixture() {
  const admin = new Pool({ connectionString, max: 2 }), schema = "cop_stream_" + randomUUID().replaceAll("-", "");
  await admin.query(`CREATE SCHEMA ${schema}`);
  const config: PoolConfig = { connectionString, max: 3, options: `-c search_path=${schema}`, application_name: schema };
  const sql = new Pool(config), bus = new PostgresCopStreamBus(config, { projectionGuard: true, channel: schema });
  await sql.query(contentErasureSchema + `CREATE TABLE cop_community_erasure_ownership(kind text NOT NULL,row_key text NOT NULL,subject_id text NOT NULL,issuer text NOT NULL,PRIMARY KEY(kind,row_key));`);
  await bus.init();
  return { admin, sql, config, bus, schema, owner: bus.projectionErasureStore()!, async close() { await bus.close(); await sql.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } };
}
async function source(f: Awaited<ReturnType<typeof fixture>>, id: string, owner = a) {
  await f.sql.query("INSERT INTO cop_community_erasure_ownership(kind,row_key,subject_id,issuer) VALUES('report',$1,$2,$3)", [id, owner.subjectId, owner.issuer]);
}
async function manifest(f: Awaited<ReturnType<typeof fixture>>, id: string, operationId: string, owner = a) {
  await f.sql.query("INSERT INTO cop_content_erasure_fences(owner_key,subject_key,operation_id) VALUES($1,'synthetic',$2) ON CONFLICT DO NOTHING", [contentOwnerKey(owner), operationId]);
  await f.sql.query("INSERT INTO cop_content_erasure_projection_manifest(owner_key,operation_id,kind,row_key) VALUES($1,$2,'report',$3)", [contentOwnerKey(owner), operationId, id]);
}
const context = (operationId: string) => ({ actor: a, operationId, signal: new AbortController().signal });
async function waiting(f: Awaited<ReturnType<typeof fixture>>, count: number) {
  const deadline = Date.now() + 3000;
  do {
    const result = await f.admin.query<{ count: string }>("SELECT count(*)::text FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory'", [f.schema]);
    if (Number(result.rows[0]?.count) >= count) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  } while (Date.now() < deadline);
  throw new Error("Actual stream admission contention was not observed");
}

describe.skipIf(!connectionString)("actual PG guarded shared stream", () => {
  it("preserves mixed B changes, reindexes their proven bindings, and prevents A replay", async () => {
    const f = await fixture(), ownId = randomUUID(), otherId = randomUUID(), operation = randomUUID();
    try {
      await source(f, ownId); await source(f, otherId, b);
      await f.bus.publish(message([ownId, otherId]));
      expect((await f.owner.preflightActorProjections(a)).ready).toBe(true);
      await manifest(f, ownId, operation);
      const resources = { reportIds: [ownId], groupIds: [] };
      expect(await f.owner.eraseResourceProjections(resources, context(operation))).toBe(true);
      const rows = await f.sql.query("SELECT payload FROM cop_stream_bus_events");
      expect(rows.rows).toHaveLength(1); expect(rows.rows[0]!.payload.message.changes).toEqual((message([otherId]) as { changes: unknown[] }).changes);
      expect((await f.sql.query("SELECT change_index,owner_key,resource_id FROM cop_stream_bus_projection_ownership")).rows)
        .toEqual([{ change_index: 0, owner_key: contentOwnerKey(b), resource_id: otherId }]);
      const delivered: CopStreamMessage[] = []; f.bus.subscribe(value => delivered.push(value));
      await expect(f.bus.publish(message([ownId]))).rejects.toThrow("STREAM_PUBLISH_UNAVAILABLE"); expect(delivered).toEqual([]);
      await f.bus.init(); await f.bus.publish(message([otherId])); expect(delivered).toHaveLength(1);
    } finally { await f.close(); }
  });
  it("rejects forged foreign resources and wrong operations before modifying any row or fence", async () => {
    const f = await fixture(), id = randomUUID(), operation = randomUUID();
    try {
      await source(f, id, b); await f.bus.publish(message([id])); await manifest(f, id, operation, b);
      const before = (await f.sql.query("SELECT * FROM cop_stream_bus_events")).rows;
      expect(await f.owner.eraseResourceProjections({ reportIds: [id], groupIds: [] }, context(operation))).toBe(false);
      expect((await f.sql.query("SELECT * FROM cop_stream_bus_events")).rows).toEqual(before);
      expect((await f.sql.query("SELECT 1 FROM cop_content_projection_fences")).rowCount).toBe(0);
    } finally { await f.close(); }
  });
  it("leaves historical unbound rows intact and pending", async () => {
    const f = await fixture(), id = randomUUID(), operation = randomUUID();
    try {
      await source(f, id); await manifest(f, id, operation);
      await f.sql.query("INSERT INTO cop_stream_bus_events(event_id,origin_id,payload) VALUES($1,'synthetic-old',$2)", [randomUUID(), JSON.stringify({ originId: "synthetic-old", message: message([id]) })]);
      expect((await f.owner.preflightActorProjections(a)).ready).toBe(false);
      expect(await f.owner.eraseResourceProjections({ reportIds: [id], groupIds: [] }, context(operation))).toBe(false);
      expect((await f.sql.query("SELECT 1 FROM cop_stream_bus_events")).rowCount).toBe(1);
    } finally { await f.close(); }
  });
  it("does not emit a local fallback when source ownership or persistence fails", async () => {
    const f = await fixture(), delivered: CopStreamMessage[] = [];
    try {
      f.bus.subscribe(value => delivered.push(value));
      await expect(f.bus.publish(message([randomUUID()]))).rejects.toThrow("STREAM_PUBLISH_UNAVAILABLE");
      expect(delivered).toEqual([]); expect((await f.sql.query("SELECT 1 FROM cop_stream_bus_events")).rowCount).toBe(0);
    } finally { await f.close(); }
  });
  it.each(["publish first", "erase first"])("serializes real concurrent admission: %s", async order => {
    const f = await fixture(), id = randomUUID(), operation = randomUUID(), blocker = await f.sql.connect();
    const delivered: CopStreamMessage[] = [];
    try {
      await source(f, id); await manifest(f, id, operation); f.bus.subscribe(value => delivered.push(value));
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('cop-content-projection-admission-v1',0))");
      let published: Promise<void>, erased: Promise<boolean>;
      const publish = () => { const promise = f.bus.publish(message([id])); void promise.catch(() => undefined); return promise; };
      if (order === "publish first") {
        published = publish(); await waiting(f, 1);
        erased = f.owner.eraseResourceProjections({ reportIds: [id], groupIds: [] }, context(operation));
      } else {
        erased = f.owner.eraseResourceProjections({ reportIds: [id], groupIds: [] }, context(operation)); await waiting(f, 1);
        published = publish();
      }
      await waiting(f, 2); await blocker.query("COMMIT");
      expect(await erased).toBe(true);
      if (order === "publish first") { await published; expect(delivered).toHaveLength(1); }
      else { await expect(published).rejects.toThrow("STREAM_PUBLISH_UNAVAILABLE"); expect(delivered).toEqual([]); }
      expect((await f.sql.query("SELECT 1 FROM cop_stream_bus_events")).rowCount).toBe(0);
    } finally { await blocker.query("ROLLBACK").catch(() => undefined); blocker.release(); await f.close(); }
  });
});
