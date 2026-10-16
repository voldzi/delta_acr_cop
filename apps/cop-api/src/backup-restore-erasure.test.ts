import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { join } from "node:path";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACCOUNT_ERASURE_ADAPTER_IDS, AccountErasureService, type AccountErasureAdapter } from "./account-erasure.js";
import { PostgresAccountErasureContinuity } from "./account-erasure-continuity-postgres.js";
import { PostgresMobilityStore } from "./mobility-store.js";
import { transitionAccountErasureDataset } from "./account-erasure-dataset-transition.js";
import { createBackupRestoreErasureAdapter } from "./backup-restore-erasure.js";
import type { AccountErasureFenceEntry } from "./account-erasure-continuity.js";

const run = promisify(execFile);
const guardUrl = process.env.COP_SAFETY_V2_TEST_DATABASE_URL, localUrl = process.env.COP_ERASURE_TEST_DATABASE_URL;
const fixtureRoot = process.env.COP_BACKUP_RESTORE_TEST_WORKDIR;
for (const value of [guardUrl, localUrl].filter(Boolean)) {
  const url = new URL(value!);
  if (url.hostname !== "127.0.0.1" || url.username !== "cop_safety_test_admin" ||
    !["/cop_account_safety_guard", "/cop_erasure_test"].includes(url.pathname)) throw Error("Owned loopback fixture required");
}
if (fixtureRoot && !/^\/private\/tmp\/cop-backup-restore-[a-zA-Z0-9]+$/u.test(fixtureRoot)) throw Error("Owned backup fixture directory required");
const issuer = "https://synthetic.test/realms/cop", secret = "synthetic-backup-restore-owner-secret-more-than-32";
const fingerprint = createHash("sha256").update("cop-account-erasure-config-v1\0").update(secret).digest("hex");
const binding = { guardStoreId: "9b2af0e5-1a62-4ed6-9986-65e9dd5ee835", applicationStoreId: "813a2260-ac1a-40bd-926b-3654c8ac347d",
  incarnationId: "064cb1d9-5da3-4b1a-8de2-fd37401dfe87", configurationFingerprint: fingerprint };
const dataset = { incarnationId: binding.incarnationId, restoreGeneration: 1 };
const actor = (subjectId = "synthetic-a") => ({ issuer, subjectId, authMode: "oidc" as const, username: "", displayName: "", authTime: Math.floor(Date.now() / 1000) });
const mac = (subjectId = "synthetic-a") => createHmac("sha256", secret).update("cop-account-erasure-identity-v1\0").update(JSON.stringify([issuer, subjectId])).digest("hex");
const fence = (): AccountErasureFenceEntry => ({ contractVersion: "cop-erasure-fence-entry-v1", applicationStoreId: binding.applicationStoreId,
  configurationFingerprint: fingerprint, accountKey: mac(), job: { operationId: randomUUID(), requestedAt: new Date().toISOString(), required: [...ACCOUNT_ERASURE_ADAPTER_IDS], checkpoints: {} } });
let admin: Pool, target: Pool;
const clients: PostgresAccountErasureContinuity[] = [];
function continuity(incarnationId = binding.incarnationId) {
  const guard = new URL(guardUrl!), local = new URL(localUrl!); guard.username = local.username = "cop_safety_v2_test_runtime";
  const value = new PostgresAccountErasureContinuity(new Pool({ connectionString: guard.href, max: 2 }),
    new Pool({ connectionString: local.href, max: 2 }), { ...binding, incarnationId }); clients.push(value); return value;
}
function adapter(value = continuity()) { return createBackupRestoreErasureAdapter({ continuity: value, issuer, identitySecret: secret }); }
async function installFence(value = continuity()) {
  await value.snapshot(); const saved = (await value.publishFence(fence())).entry;
  await target.query("INSERT INTO cop_mobility_v1(key,value) VALUES($1,$2),('account-erasure:configuration-v1',$3)", [
    "account-erasure:job:" + saved.accountKey, saved.job, { fingerprint, storeId: binding.applicationStoreId, version: 4, datasetBinding: dataset }]);
  return { value, saved, context: { accountKey: saved.accountKey, ...saved.job, datasetBinding: dataset, signal: AbortSignal.timeout(5000) } };
}

describe.skipIf(!guardUrl || !localUrl)("actual PostgreSQL backup restore owner", () => {
  beforeEach(async () => {
    admin = new Pool({ connectionString: guardUrl, max: 2 }); target = new Pool({ connectionString: localUrl, max: 2 });
    for (const pool of [admin, target]) if ((await pool.query("SHOW cluster_name")).rows[0]?.cluster_name !== "cop_erasure_owned_test") throw Error("Foreign cluster refused");
    await admin.query("DROP SCHEMA IF EXISTS cop_safety_v2 CASCADE");
    await admin.query(await readFile(new URL("../../../scripts/account-safety/010_database_safety_v2.sql", import.meta.url), "utf8"));
    await admin.query("INSERT INTO cop_safety_v2.configuration VALUES(true,'cop-database-safety-v2',$1,$2,$3,$4,NULL)",
      [binding.guardStoreId, binding.applicationStoreId, fingerprint, "0".repeat(64)]);
    await admin.query("INSERT INTO cop_safety_v2.dataset_replays VALUES('cop',$1,$2,1,0,$3,clock_timestamp())", [binding.applicationStoreId, binding.incarnationId, "0".repeat(64)]);
    await admin.query("GRANT USAGE ON SCHEMA cop_safety_v2 TO cop_safety_v2_test_runtime; GRANT SELECT ON ALL TABLES IN SCHEMA cop_safety_v2 TO cop_safety_v2_test_runtime; GRANT INSERT ON cop_safety_v2.fences TO cop_safety_v2_test_runtime; GRANT UPDATE(replay_sequence,replay_digest) ON cop_safety_v2.dataset_replays TO cop_safety_v2_test_runtime; GRANT EXECUTE ON FUNCTION cop_safety_v2.append_fence() TO cop_safety_v2_test_runtime");
    await target.query("CREATE TABLE IF NOT EXISTS cop_mobility_v1(key text PRIMARY KEY,value jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now()); TRUNCATE cop_mobility_v1");
    await target.query("INSERT INTO cop_mobility_v1(key,value) VALUES('account-safety:store-identity-v1',$1)", [{ storeId: binding.applicationStoreId, incarnationId: binding.incarnationId }]);
    await target.query("GRANT SELECT ON cop_mobility_v1 TO cop_safety_v2_test_runtime");
  });
  afterEach(async () => { await Promise.all(clients.splice(0).map(value => value.close())); await admin?.end(); await target?.end(); });
  it("refuses a journal whose local replay is missing, instead of accepting catalog or configuration labels", async () => {
    const value = continuity(); await value.snapshot(); await value.publishFence(fence());
    expect(await adapter(value).ready()).toBe(false);
    expect(await adapter(value).preflight!(actor(), { signal: AbortSignal.timeout(2000) })).toEqual({ ready: false, reason: "adapter_unavailable" });
  });
  it("completes exactly the durable account, operation and original date with actual replay readback", async () => {
    const { value, context } = await installFence(); const owner = adapter(value);
    expect(await owner.ready()).toBe(true);
    expect(await owner.preflight!(actor(), { signal: context.signal })).toMatchObject({ ready: true });
    const result = await owner.erase(actor(), context);
    expect(result).toMatchObject({ status: "completed", proofId: expect.stringMatching(/^[0-9a-f]{64}$/u) });
    expect(await owner.erase(actor(), context)).toEqual(result);
    expect((await admin.query("SELECT replay_sequence FROM cop_safety_v2.dataset_replays")).rows[0].replay_sequence).toBe("1");
  });
  it("rejects a foreign actor, account, operation, date, incarnation and generation without another principal fallback", async () => {
    const { value, context } = await installFence(); const owner = adapter(value);
    for (const [identity, request] of [
      [actor("synthetic-b"), context], [{ ...actor(), issuer: "https://foreign.test" }, context],
      [actor(), { ...context, accountKey: mac("synthetic-b") }], [actor(), { ...context, operationId: randomUUID() }],
      [actor(), { ...context, requestedAt: new Date(Date.parse(context.requestedAt) + 1).toISOString() }],
      [actor(), { ...context, datasetBinding: { ...dataset, incarnationId: randomUUID() } }],
      [actor(), { ...context, datasetBinding: { ...dataset, restoreGeneration: 2 } }],
      [actor(), { ...context, datasetBinding: undefined }]
    ] as const) await expect(owner.erase(identity, request)).rejects.toThrow(/BACKUP_RESTORE_/u);
    expect((await admin.query("SELECT count(*) FROM cop_safety_v2.fences")).rows[0].count).toBe("1");
  });
  it("refuses changed database identity, revoked read permission and cancellation", async () => {
    const { value, context } = await installFence(); const owner = adapter(value);
    expect(await owner.ready()).toBe(true);
    await expect(owner.erase(actor(), { ...context, signal: AbortSignal.abort() })).rejects.toThrow();
    await admin.query("REVOKE SELECT ON cop_safety_v2.fences FROM cop_safety_v2_test_runtime");
    expect(await owner.ready()).toBe(false);
    await expect(owner.erase(actor(), context)).rejects.toThrow();
    await admin.query("GRANT SELECT ON cop_safety_v2.fences TO cop_safety_v2_test_runtime");
    await target.query("UPDATE cop_mobility_v1 SET value=$1 WHERE key='account-safety:store-identity-v1'", [{ storeId: binding.applicationStoreId, incarnationId: randomUUID() }]);
    expect(await owner.ready()).toBe(false);
  });
  it.skipIf(!fixtureRoot)("restores a real pg_dump without rolling back the independent journal, quarantines A and requires fresh verified identity", async () => {
    const store = new PostgresMobilityStore({ connectionString: localUrl }, {}, undefined, true); await store.init();
    const first = continuity();
    const owners: AccountErasureAdapter[] = ACCOUNT_ERASURE_ADAPTER_IDS.filter(id => id !== "backup_restore").map(id => ({
      id, ready: async () => true, preflight: async () => ({ ready: true as const, version: "synthetic-owner-v1" }),
      erase: async (_identity, context) => {
        if (id === "cop_content_media") await store.transact([], tx => tx.remove("synthetic-backup:content:" + context.accountKey));
        return { status: "completed" as const, proofId: "synthetic-provider-proof" };
      }
    }));
    const options = { store, issuer, identitySecret: secret, requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS, accepted: true,
      expectedGuardStoreId: binding.applicationStoreId, continuityRequired: true };
    let service = new AccountErasureService({ ...options, continuity: first, adapters: [...owners, adapter(first)] });
    try {
      await service.init();
      await store.transact([], async tx => {
        await tx.set("synthetic-backup:content:" + mac(), { fixture: "synthetic A content" });
        await tx.set("synthetic-backup:content:" + mac("synthetic-b"), { fixture: "synthetic B content" });
      });
      const url = new URL(localUrl!), env = { PATH: "/usr/bin:/bin", LC_ALL: "C", PGHOST: url.hostname, PGPORT: url.port,
        PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: url.pathname.slice(1) };
      const dump = join(fixtureRoot!, "owned-business-before-deletion.dump");
      await run("/opt/homebrew/opt/postgresql@18/bin/pg_dump", ["--format=custom", "--file=" + dump, "--table=cop_mobility_v1"], { env, timeout: 20000 });
      const operation = randomUUID(), plan = await service.preflight(actor(), operation);
      expect((await service.request(actor(), operation, { confirmAccountDeletion: true }, { planId: plan.response.planId!, capability: plan.capability! })).accountDeleted).toBe(true);
      const original = (await admin.query("SELECT sequence,digest,entry FROM cop_safety_v2.fences ORDER BY sequence")).rows;
      await run("/opt/homebrew/opt/postgresql@18/bin/pg_restore", ["--clean", "--if-exists", "--no-owner", "--dbname=cop_erasure_test", dump], { env, timeout: 20000 });
      // Exposure remains closed by the operator throughout this interval. A
      // copied backup contains stale content; it has not physically been erased.
      expect(await store.transact([], tx => tx.get("synthetic-backup:content:" + mac()))).toBeTruthy();
      const next = { incarnationId: randomUUID(), restoreGeneration: 2 };
      await transitionAccountErasureDataset(admin, target, { ...binding, previous: dataset, restoredLocal: dataset, next });
      await expect(service.assertAllowed(actor("synthetic-b"))).rejects.toMatchObject({ status: 503 });
      const restored = continuity(next.incarnationId);
      service = new AccountErasureService({ ...options, continuity: restored, adapters: [...owners, adapter(restored)] });
      await service.init(); await service.resumePending();
      await expect(service.assertAllowed(actor())).rejects.toMatchObject({ status: 403 });
      await service.assertAllowed(actor("synthetic-b"));
      const job = await store.transact([], tx => tx.get<Record<string, unknown>>("account-erasure:job:" + mac()));
      expect(job?.sealedPrincipal).toBeUndefined(); expect(job?.completedAt).toBeUndefined();
      // Only the existing fresh verified-actor receipt-recovery path supplies
      // identity. There is no automatic recovery from a journal MAC or op ID.
      expect((await service.read(actor(), operation)).accountDeleted).toBe(false);
      await service.resumePending();
      expect((await service.read(actor(), operation)).accountDeleted).toBe(true);
      expect(await store.transact([], tx => tx.get("synthetic-backup:content:" + mac()))).toBeUndefined();
      expect(await store.transact([], tx => tx.get("synthetic-backup:content:" + mac("synthetic-b")))).toEqual({ fixture: "synthetic B content" });
      expect((await admin.query("SELECT sequence,digest,entry FROM cop_safety_v2.fences ORDER BY sequence")).rows).toEqual(original);
    } finally { await store.close(); }
  });
});
