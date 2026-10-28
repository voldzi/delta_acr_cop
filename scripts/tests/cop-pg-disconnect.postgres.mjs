// Run only in the disposable network-none fixture described in the runbook.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { createRequire } from "node:module";
const pg = createRequire(new URL("../../apps/cop-api/package.json", import.meta.url))("pg");
import { createCopPgPool } from "../../apps/cop-api/dist/cop-pg-pool.js";
import { PostgresMobilityStore } from "../../apps/cop-api/dist/mobility-store.js";
import { PostgresAccountErasureContinuity } from "../../apps/cop-api/dist/account-erasure-continuity-postgres.js";
import { PostgresCopStreamBus } from "../../apps/cop-api/dist/cop-stream-bus.js";

assert.equal(process.env.COP_DISCONNECT_OWNED_FIXTURE, "network-none-unix-v1");
const config = { host: "/var/run/postgresql", user: "cop_disconnect_runtime", database: "cop_disconnect_test", max: 1, connectionTimeoutMillis: 1000, query_timeout: 2000 };
const admin = new pg.Pool({ ...config, user: "postgres", max: 2 });
assert.equal((await admin.query("SHOW cluster_name")).rows[0].cluster_name, "cop_pg_disconnect_owned");
const pools = [];
const pool = (component = "mobility") => {
  const result = createCopPgPool(component, config); pools.push(result); return result;
};
const until = async (predicate) => {
  for (let i = 0; i < 100; i++) { if (await predicate()) return; await delay(20); }
  throw new Error("SYNTHETIC_WAIT_EXPIRED");
};
const terminate = async (pid) => assert.equal((await admin.query("SELECT pg_terminate_backend($1)", [pid])).rows[0].pg_terminate_backend, true);
await test("owned PostgreSQL disconnect suite", async t => {
t.after(async () => { await Promise.all(pools.map(p => p.end())); await admin.end(); });

await t.test("idle disconnect evicts the connection and the next query reconnects", async () => {
  const p = pool();
  const pid = (await p.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  await terminate(pid); await until(() => p.totalCount === 0);
  assert.notEqual((await p.query("SELECT pg_backend_pid() AS pid")).rows[0].pid, pid);
});

await t.test("borrowed connection lost between queries does not crash or succeed", async () => {
  const p = pool(), client = await p.connect();
  const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  const failed = new Promise(resolve => client.once("error", resolve));
  await terminate(pid); await failed;
  await assert.rejects(client.query("SELECT 1"));
  client.release();
  assert.equal((await p.query("SELECT 1 AS ok")).rows[0].ok, 1);
});

await t.test("active query rejects on real backend termination and is not retried", async () => {
  const p = pool(), client = await p.connect();
  const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  const failed = assert.rejects(client.query("SELECT pg_sleep(20)"));
  await until(async () => (await admin.query("SELECT wait_event FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0]?.wait_event === "PgSleep");
  await terminate(pid); await failed; client.release(true);
  assert.equal((await p.query("SELECT 1 AS ok")).rows[0].ok, 1);
});

await t.test("lost COMMIT acknowledgement rejects without replaying a committed write", async () => {
  const p = pool(), client = await p.connect();
  await client.query("CREATE TABLE cop_disconnect_commit(id integer PRIMARY KEY)");
  await client.query("BEGIN"); await client.query("INSERT INTO cop_disconnect_commit VALUES(1)");
  const socket = client.connection.stream;
  socket.pause(); // Server can commit; its acknowledgement cannot reach the parser.
  const rejected = assert.rejects(client.query("COMMIT"));
  try {
    await until(async () => (await admin.query("SELECT count(*)::integer AS n FROM cop_disconnect_commit")).rows[0].n === 1);
  } finally { socket.destroy(); }
  await rejected; client.release();
  assert.equal((await p.query("SELECT count(*)::integer AS n FROM cop_disconnect_commit")).rows[0].n, 1);
});

await t.test("actual mobility transaction rolls back a disconnect and recovers independently", async () => {
  const store = new PostgresMobilityStore(config, {}, config, true);
  try {
    await store.init();
    let calls = 0;
    await assert.rejects(store.transact([], async tx => {
      calls++; await tx.set("synthetic-disconnect", { test: true });
      const pid = (await admin.query("SELECT pid FROM pg_stat_activity WHERE application_name='cop-api:mobility' AND state='idle in transaction'")).rows[0]?.pid;
      assert.ok(pid); await terminate(pid); await delay(50);
    }));
    assert.equal(calls, 1);
    assert.equal(await store.transact([], tx => tx.get("synthetic-disconnect")), undefined);
  } finally { await store.close(); }
});

await t.test("actual database-v2 continuity fails closed on disconnect and recovers without guard changes", async () => {
  const binding = { guardStoreId: "9b2af0e5-1a62-4ed6-9986-65e9dd5ee835", applicationStoreId: "813a2260-ac1a-40bd-926b-3654c8ac347d", incarnationId: "064cb1d9-5da3-4b1a-8de2-fd37401dfe87", configurationFingerprint: "a".repeat(64) };
  const initial = "0".repeat(64);
  await admin.query("CREATE DATABASE cop_account_safety_guard");
  const guardAdmin = new pg.Pool({ ...config, user: "postgres", database: "cop_account_safety_guard" });
  pools.push(guardAdmin);
  await guardAdmin.query(await readFile(new URL("../account-safety/010_database_safety_v2.sql", import.meta.url), "utf8"));
  await guardAdmin.query("INSERT INTO cop_safety_v2.configuration(singleton,contract_version,guard_store_id,application_store_id,configuration_fingerprint,initial_digest) VALUES(true,'cop-database-safety-v2',$1,$2,$3,$4)", [binding.guardStoreId,binding.applicationStoreId,binding.configurationFingerprint,initial]);
  await guardAdmin.query("INSERT INTO cop_safety_v2.dataset_replays(owner,store_id,incarnation_id,restore_generation,replay_sequence,replay_digest) VALUES('cop',$1,$2,1,0,$3)", [binding.applicationStoreId,binding.incarnationId,initial]);
  await admin.query("INSERT INTO cop_mobility_v1(key,value) VALUES('account-safety:store-identity-v1',$1)", [{ storeId:binding.applicationStoreId,incarnationId:binding.incarnationId }]);
  await guardAdmin.query("GRANT USAGE ON SCHEMA cop_safety_v2 TO cop_disconnect_runtime; GRANT SELECT ON ALL TABLES IN SCHEMA cop_safety_v2 TO cop_disconnect_runtime");
  const guard = createCopPgPool("account-safety-guard", { ...config, database: "cop_account_safety_guard" }), target = pool("account-safety-target");
  pools.push(guard);
  const continuity = new PostgresAccountErasureContinuity(guard, target, binding);
  const originalQuery = target.query.bind(target);
  let interrupt = true;
  target.query = async (...args) => {
    if (interrupt) {
      interrupt = false;
      const pid = (await admin.query("SELECT pid FROM pg_stat_activity WHERE application_name='cop-api:account-safety-guard' AND state='idle in transaction'")).rows[0]?.pid;
      assert.ok(pid); await terminate(pid); await delay(50);
    }
    return originalQuery(...args);
  };
  await assert.rejects(continuity.snapshot(), error => error.code === "ERASURE_CONTINUITY_UNAVAILABLE");
  const recovered = await continuity.snapshot();
  assert.equal(recovered.frontier.sequence, 0);
  await guardAdmin.query("UPDATE cop_safety_v2.dataset_replays SET incarnation_id='164cb1d9-5da3-4b1a-8de2-fd37401dfe87'");
  await assert.rejects(continuity.snapshot(), error => error.code === "ERASURE_CONTINUITY_UNAVAILABLE");
});

await t.test("real LISTEN disconnect resubscribes once and receives a new notification without replay", async () => {
  const bus = new PostgresCopStreamBus({ ...config, application_name: "cop-disconnect-listener" }, { channel: "cop_disconnect_events", instanceId: "owned-listener" });
  const received = [];
  bus.subscribe(message => received.push(message));
  try {
    await bus.init();
    const pid = (await admin.query("SELECT pid FROM pg_stat_activity WHERE application_name='cop-disconnect-listener' AND query LIKE 'LISTEN %'")).rows[0]?.pid;
    assert.ok(pid); await terminate(pid);
    await until(() => !bus.metrics.ready);
    await until(() => bus.metrics.ready);
    const listeners = (await admin.query("SELECT pid FROM pg_stat_activity WHERE application_name='cop-disconnect-listener' AND query LIKE 'LISTEN %'")).rows;
    assert.equal(listeners.length, 1); assert.notEqual(listeners[0].pid, pid);
    const id = "42478008-a7e8-47b9-aea1-b448370ae5c0";
    const message = { type: "heartbeat", sequence: 1, serverTimestamp: new Date().toISOString() };
    await admin.query("INSERT INTO cop_stream_bus_events(event_id,origin_id,payload) VALUES($1,'owned-sender',$2)", [id, { originId: "owned-sender", message }]);
    await admin.query("SELECT pg_notify('cop_disconnect_events',$1)", [id]);
    await until(() => received.length === 1);
    assert.deepEqual(received, [message]);
  } finally { await bus.close(); }
  await delay(600);
  assert.equal((await admin.query("SELECT count(*)::integer AS n FROM pg_stat_activity WHERE application_name='cop-disconnect-listener'")).rows[0].n, 0);
});

});
