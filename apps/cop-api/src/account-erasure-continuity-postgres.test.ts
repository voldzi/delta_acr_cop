import { readFile } from "node:fs/promises";
import { createHash, createHmac, createSign, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_ERASURE_ADAPTER_IDS, AccountErasureService } from "./account-erasure.js";
import { PostgresMobilityStore } from "./mobility-store.js";
import { PostgresDriverMeasurementConsentStore } from "./driver-measurement-consent-store.js";
import { opaqueUserId } from "./ai-router-chat.js";
import { contributorIdDay } from "./driver-measurement-contract.js";
import { createSimRouterAccountErasureAdapter } from "./sim-account-erasure.js";
import { createCOPDriverMeasurementsErasureAdapter } from "./cop-driver-consent-erasure.js";
import { buildServer } from "./server.js";
import { clearJwksCacheForTests } from "./security.js";
import { PostgresAccountErasureContinuity } from "./account-erasure-continuity-postgres.js";
import { transitionAccountErasureDataset } from "./account-erasure-dataset-transition.js";
import type { AccountErasureFenceEntry } from "./account-erasure-continuity.js";

const url = process.env.COP_SAFETY_V2_TEST_DATABASE_URL;
const local = process.env.COP_ERASURE_TEST_DATABASE_URL;
for (const value of [url, local].filter(Boolean)) {
  const parsed = new URL(value!);
  if (parsed.hostname !== "127.0.0.1" || parsed.username !== "cop_safety_test_admin" ||
    !["/cop_account_safety_guard", "/cop_erasure_test"].includes(parsed.pathname)) throw new Error("Owned loopback fixture required");
}
const secret = "synthetic-owned-database-erasure-secret-more-than-32";
const binding = { guardStoreId: "9b2af0e5-1a62-4ed6-9986-65e9dd5ee835", applicationStoreId: "813a2260-ac1a-40bd-926b-3654c8ac347d",
  incarnationId: "064cb1d9-5da3-4b1a-8de2-fd37401dfe87", configurationFingerprint:
    createHash("sha256").update("cop-account-erasure-config-v1\0").update(secret).digest("hex") };
const initial = "0".repeat(64);
const routerKey = "synthetic-current-router-alias-key-more-than-32";
interface JointFixture { cluster: string; port: number; issuer: string; driverUrl: string; routerUrl: string; copToken: string; actorSecret: string; driverHashSecret: string; driverCheckpoint: string }
const jointPath = process.env.COP_SIM_SAFETY_JOINT_FIXTURE;
if (jointPath && jointPath !== "/private/tmp/sim-erasure-http-fixture-20261015.json") throw new Error("Only the coordinated private synthetic fixture is allowed");
const joint = jointPath ? JSON.parse(await readFile(jointPath, "utf8")) as JointFixture : undefined;
if (joint && (joint.cluster !== "cop_erasure_owned_test" || joint.port !== 57587 ||
  ![joint.driverUrl, joint.routerUrl].every(v => new URL(v).hostname === "127.0.0.1"))) throw new Error("Wrong coordinated fixture");
const identityIssuer = joint?.issuer ?? "https://synthetic.test/realms/cop";
const entry = (accountKey = "b".repeat(64), operationId: string = randomUUID()): AccountErasureFenceEntry => ({
  contractVersion: "cop-erasure-fence-entry-v1", applicationStoreId: binding.applicationStoreId,
  configurationFingerprint: binding.configurationFingerprint, accountKey,
  job: { operationId, requestedAt: new Date().toISOString(), required: [...ACCOUNT_ERASURE_ADAPTER_IDS], checkpoints: {} }
});
let admin: Pool, target: Pool;
const open: PostgresAccountErasureContinuity[] = [];
function client(incarnationId = binding.incarnationId) {
  const connection = new URL(url!); connection.username = "cop_safety_v2_test_runtime";
  const reader = new URL(local!); reader.username = "cop_safety_v2_test_runtime";
  const result = new PostgresAccountErasureContinuity(new Pool({ connectionString: connection.href, max: 2 }),
    new Pool({ connectionString: reader.href, max: 2 }), { ...binding, incarnationId });
  open.push(result); return result;
}
describe.skipIf(!url || !local)("actual PostgreSQL independent deletion journal v2", () => {
  beforeEach(async () => {
    admin = new Pool({ connectionString: url, max: 2 }); target = new Pool({ connectionString: local, max: 2 });
    for (const pool of [admin, target]) {
      if ((await pool.query("SHOW cluster_name")).rows[0]?.cluster_name !== "cop_erasure_owned_test") throw new Error("Refusing non-owned cluster");
    }
    await admin.query("DROP SCHEMA IF EXISTS cop_safety_v2 CASCADE");
    await admin.query(await readFile(new URL("../../../scripts/account-safety/010_database_safety_v2.sql", import.meta.url), "utf8"));
    await admin.query("DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='cop_safety_v2_test_runtime') THEN CREATE ROLE cop_safety_v2_test_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF; END $$");
    await admin.query("INSERT INTO cop_safety_v2.configuration(singleton,contract_version,guard_store_id,application_store_id,configuration_fingerprint,initial_digest,identity_binding) VALUES(true,'cop-database-safety-v2',$1,$2,$3,$4,$5)",
      [binding.guardStoreId, binding.applicationStoreId, binding.configurationFingerprint, initial, {
        contractVersion: "cop-existing-router-identity-v1", issuer: identityIssuer,
        routerKeyFingerprint: createHash("sha256").update("cop-router-identity-key-v1\0").update(routerKey).digest("hex"), evidenceDigest: "1".repeat(64)
      }]);
    await admin.query("INSERT INTO cop_safety_v2.dataset_replays(owner,store_id,incarnation_id,restore_generation,replay_sequence,replay_digest) VALUES('cop',$1,$2,1,0,$3)",
      [binding.applicationStoreId, binding.incarnationId, initial]);
    await admin.query("GRANT USAGE ON SCHEMA cop_safety_v2 TO cop_safety_v2_test_runtime; GRANT SELECT ON ALL TABLES IN SCHEMA cop_safety_v2 TO cop_safety_v2_test_runtime; GRANT INSERT ON cop_safety_v2.fences TO cop_safety_v2_test_runtime; GRANT UPDATE(replay_sequence,replay_digest) ON cop_safety_v2.dataset_replays TO cop_safety_v2_test_runtime; GRANT EXECUTE ON FUNCTION cop_safety_v2.append_fence() TO cop_safety_v2_test_runtime");
    await target.query("CREATE TABLE IF NOT EXISTS cop_mobility_v1(key text PRIMARY KEY,value jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())");
    await target.query("TRUNCATE cop_mobility_v1");
    await target.query("INSERT INTO cop_mobility_v1(key,value) VALUES('account-safety:store-identity-v1',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [{ storeId: binding.applicationStoreId, incarnationId: binding.incarnationId }]);
    await target.query("GRANT SELECT ON cop_mobility_v1 TO cop_safety_v2_test_runtime");
  });
  afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); clearJwksCacheForTests();
    await Promise.all(open.splice(0).map(c => c.close())); await admin?.end(); await target?.end(); });
  it("commits immutable exact-account evidence, serializes two clients and recovers the original operation", async () => {
    const a = client(), b = client(); await a.snapshot(); await b.snapshot();
    const input = entry(); const results = await Promise.all([a.publishFence(input), b.publishFence({ ...input, job: { ...input.job, requestedAt: new Date(Date.now() + 10).toISOString() } })]);
    expect(results[0]!.entry).toEqual(results[1]!.entry);
    expect((await admin.query("SELECT count(*) FROM cop_safety_v2.fences")).rows[0]?.count).toBe("1");
    const other = await b.publishFence(entry("c".repeat(64)));
    expect(other.frontier.sequence).toBe(2);
    expect((await a.snapshot()).entries).toHaveLength(2);
    await expect(a.publishFence(entry("d".repeat(64), input.job.operationId))).rejects.toMatchObject({ status: 503 });
    await expect(a.publishFence(entry(input.accountKey))).rejects.toMatchObject({ status: 503 });
  });
  it("returns evidence for replay, but never approves a restored application without actual local fences", async () => {
    const a = client(); await a.snapshot(); const saved = await a.publishFence(entry());
    const restored = client(); expect((await restored.snapshot()).entries).toEqual([saved.entry]);
    await expect(restored.assertCurrent(saved.frontier)).rejects.toMatchObject({ status: 503 });
    expect((await admin.query("SELECT replay_sequence FROM cop_safety_v2.dataset_replays")).rows[0]?.replay_sequence).toBe("0");
    await target.query("INSERT INTO cop_mobility_v1(key,value) VALUES($1,$2),($3,$4)", ["account-erasure:job:" + saved.entry.accountKey, saved.entry.job,
      "account-erasure:configuration-v1", { fingerprint: binding.configurationFingerprint, storeId: binding.applicationStoreId, version: 4,
        datasetBinding: { incarnationId: binding.incarnationId, restoreGeneration: 1 } }]);
    await restored.assertCurrent(saved.frontier);
    expect((await admin.query("SELECT replay_sequence FROM cop_safety_v2.dataset_replays")).rows[0]?.replay_sequence).toBe("1");
  });
  it("rejects foreign incarnation, unknown enrollment and mismatched current head", async () => {
    const a = client(), empty = await a.snapshot();
    await expect(a.assertCurrent({ sequence: 1, digest: initial })).rejects.toMatchObject({ status: 503 });
    await target.query("UPDATE cop_mobility_v1 SET value=$1 WHERE key='account-safety:store-identity-v1'", [{ storeId: binding.applicationStoreId, incarnationId: randomUUID() }]);
    await expect(a.assertCurrent(empty.frontier)).rejects.toMatchObject({ status: 503 });
    await expect(client().snapshot()).rejects.toMatchObject({ status: 503 });
  });
  it("does not permit runtime rewrite, deletion, truncate or replay approval", async () => {
    const a = client(); await a.snapshot(); await a.publishFence(entry());
    const connection = new URL(url!); connection.username = "cop_safety_v2_test_runtime";
    const runtime = new Pool({ connectionString: connection.href });
    try {
      for (const sql of ["DELETE FROM cop_safety_v2.fences", "TRUNCATE cop_safety_v2.fences", "UPDATE cop_safety_v2.dataset_replays SET restore_generation=2",
        "UPDATE cop_safety_v2.configuration SET initial_digest=repeat('1',64)"]) await expect(runtime.query(sql)).rejects.toMatchObject({ code: "42501" });
      await expect(admin.query("DELETE FROM cop_safety_v2.fences")).rejects.toMatchObject({ code: "55000" });
    } finally { await runtime.end(); }
  });
  it("snapshots queued input and refuses free context or recoverable identity in permanent evidence", async () => {
    const a = client(); await a.snapshot(); const input = entry(); const expected = structuredClone(input);
    const pending = a.publishFence(input); input.accountKey = "e".repeat(64); input.job.required.length = 0;
    expect((await pending).entry).toEqual(expected);
    await expect(a.publishFence({ ...entry(), privateContext: "forbidden" } as AccountErasureFenceEntry)).rejects.toMatchObject({ status: 503 });
    const bad = entry(); Object.assign(bad.job, { sealedPrincipal: "forbidden" });
    await expect(a.publishFence(bad)).rejects.toMatchObject({ status: 503 });
    expect(JSON.stringify((await a.snapshot()).entries)).not.toContain("forbidden");
  });
  it("replays durable controller jobs after a local restore before admitting account A, while B stays available", async () => {
    const store = new PostgresMobilityStore({ connectionString: local }, {}, undefined, true); await store.init();
    const issuer = "https://synthetic.test/realms/cop";
    const actor = { issuer, subjectId: "synthetic-a", authMode: "oidc" as const, username: "", displayName: "", authTime: Math.floor(Date.now() / 1000) };
    // Owner effects are deliberately pending: this gate proves actual DB
    // controller/journal integration, not completion of external providers.
    const adapters = ACCOUNT_ERASURE_ADAPTER_IDS.map(id => ({ id, ready: async () => true,
      preflight: async () => ({ ready: true as const, version: "synthetic-owner-v1" }),
      erase: async () => ({ status: "pending" as const, remaining: "cleanup_pending" as const }) }));
    const options = { store, issuer, identitySecret: secret, requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS, adapters, accepted: true,
      expectedGuardStoreId: binding.applicationStoreId, continuityRequired: true };
    try {
      const service = new AccountErasureService({ ...options, continuity: client() });
      const operationId = randomUUID(), plan = await service.preflight(actor, operationId);
      const result = await service.request(actor, operationId, { confirmAccountDeletion: true }, { planId: plan.response.planId!, capability: plan.capability! });
      expect(result).toMatchObject({ accountDeleted: false, status: "deleting", revocationEnforced: true });
      await expect(service.assertAllowed(actor)).rejects.toMatchObject({ status: 403 });
      await service.assertAllowed({ ...actor, subjectId: "synthetic-b" });
      // Model restoration of the local pre-deletion store only. The independent
      // journal and enrollment marker survive; no real account is touched.
      await target.query("DELETE FROM cop_mobility_v1 WHERE key<>'account-safety:store-identity-v1'");
      const recovered = new AccountErasureService({ ...options, continuity: client() });
      await recovered.init();
      await expect(recovered.assertAllowed(actor)).rejects.toMatchObject({ status: 403 });
      await recovered.assertAllowed({ ...actor, subjectId: "synthetic-b" });
      expect((await recovered.read(actor, operationId)).accountDeleted).toBe(false);
      expect((await admin.query("SELECT count(*) FROM cop_safety_v2.fences")).rows[0]?.count).toBe("1");
    } finally { await store.close(); }
  });
  it("reads explicitly enrolled identity review and denies a new alias, foreign issuer or changed key", async () => {
    const a = client(); await a.snapshot();
    const actor = { authMode: "oidc" as const, issuer: identityIssuer, subjectId: "synthetic-a", username: "", displayName: "" };
    const context = { routerUserId: opaqueUserId(routerKey, actor.subjectId), signal: AbortSignal.timeout(1000) };
    expect(await a.reviewRouterIdentity(actor, context, { issuer: identityIssuer, userIdSecret: routerKey })).toMatchObject({ reviewed: true });
    for (const [owner, request, config] of [
      [actor, { ...context, routerUserId: opaqueUserId(routerKey, "synthetic-b") }, { issuer: identityIssuer, userIdSecret: routerKey }],
      [{ ...actor, issuer: "https://foreign.test" }, context, { issuer: identityIssuer, userIdSecret: routerKey }],
      [actor, { ...context, routerUserId: opaqueUserId(routerKey + "changed", actor.subjectId) }, { issuer: identityIssuer, userIdSecret: routerKey + "changed" }]
    ] as const) expect(await a.reviewRouterIdentity(owner, request, config)).toEqual({ reviewed: false });
  });
  it("invalidates SQL-persisted terminal receipts after explicit dataset restore enrollment, but not an ordinary restart", async () => {
    const store = new PostgresMobilityStore({ connectionString: local }, {}, undefined, true);
    await store.init();
    const owner = { authMode: "oidc" as const, issuer: identityIssuer, subjectId: "synthetic-restored-owner",
      username: "", displayName: "", authTime: Math.floor(Date.now() / 1000) };
    const adapters = ACCOUNT_ERASURE_ADAPTER_IDS.map(id => ({ id, ready: async () => true,
      preflight: async () => ({ ready: true as const, version: "explicit-synthetic-owner" }),
      erase: vi.fn(async () => ({ status: "completed" as const, proofId: "explicit-synthetic-owner-proof" })) }));
    const options = { store, identitySecret: secret, issuer: identityIssuer, adapters,
      requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS, accepted: true,
      expectedGuardStoreId: binding.applicationStoreId, continuityRequired: true };
    const operationId = randomUUID();
    try {
      const first = new AccountErasureService({ ...options, continuity: client() });
      const plan = await first.preflight(owner, operationId);
      expect((await first.request(owner, operationId, { confirmAccountDeletion: true },
        { planId: plan.response.planId!, capability: plan.capability! })).accountDeleted).toBe(true);
      const ordinary = new AccountErasureService({ ...options, continuity: client() });
      await ordinary.resumePending();
      expect((await ordinary.read(owner, operationId)).accountDeleted).toBe(true);
      adapters.forEach(adapter => expect(adapter.erase).toHaveBeenCalledTimes(1));
      const original = (await admin.query("SELECT sequence,digest,entry FROM cop_safety_v2.fences")).rows;
      // Deliberately perform the operator's binding change in the owned fixture.
      // Provider effects remain synthetic; this is not production restore approval.
      const nextIncarnation = randomUUID();
      const transition = { ...binding, previous: { incarnationId: binding.incarnationId, restoreGeneration: 1 },
        restoredLocal: { incarnationId: binding.incarnationId, restoreGeneration: 1 },
        next: { incarnationId: nextIncarnation, restoreGeneration: 2 } };
      await expect(transitionAccountErasureDataset(admin, target, { ...transition, next: { ...transition.next, restoreGeneration: 1 } }))
        .rejects.toThrow("RESTORE_TRANSITION_UNPROVEN");
      const transitionResult = await transitionAccountErasureDataset(admin, target, transition);
      expect(transitionResult).toMatchObject({ status: "replay_required", datasetBinding: transition.next, journalSequence: original.length });
      // Retry the real committed transition before controller replay. Local
      // configuration deliberately still has the old generation.
      expect(await transitionAccountErasureDataset(admin, target, transition)).toEqual(transitionResult);
      await expect(ordinary.assertAllowed(owner)).rejects.toMatchObject({ status: 503 });
      const restored = new AccountErasureService({ ...options, continuity: client(nextIncarnation) });
      await restored.init();
      await restored.resumePending();
      const jobs = (await target.query("SELECT value FROM cop_mobility_v1 WHERE key LIKE 'account-erasure:job:%'")).rows;
      expect(jobs[0]!.value).toMatchObject({ operationId, checkpoints: {} });
      expect(jobs[0]!.value.completedAt).toBeUndefined();
      expect(jobs[0]!.value.sealedPrincipal).toBeUndefined();
      adapters.forEach(adapter => expect(adapter.erase).toHaveBeenCalledTimes(1));
      expect((await restored.read(owner, operationId)).accountDeleted).toBe(false);
      await restored.resumePending();
      expect((await restored.read(owner, operationId)).accountDeleted).toBe(true);
      adapters.forEach(adapter => expect(adapter.erase).toHaveBeenCalledTimes(2));
      expect((await admin.query("SELECT sequence,digest,entry FROM cop_safety_v2.fences")).rows).toEqual(original);
    } finally { await store.close(); }
  });
  it("derives the driver key inventory from actual immutable startup fingerprint and exact-owner consent", async () => {
    const schema = "inventory_" + randomUUID().replaceAll("-", ""); await target.query(`CREATE SCHEMA ${schema}`);
    const config = { connectionString: local, options: `-c search_path=${schema}` };
    const first = new PostgresDriverMeasurementConsentStore(config), changed = new PostgresDriverMeasurementConsentStore(config);
    const owner = { issuer: identityIssuer, subjectId: "synthetic-inventory-a" };
    try {
      await first.init(secret); await first.grant(owner.subjectId, new Date(), owner);
      await first.revoke(owner.subjectId, new Date(), owner);
      const actual = await first.accountErasureInventory(owner);
      expect(actual).toMatchObject({ retainedComplete: true, outboxComplete: true, keyVersionsComplete: true });
      expect(actual?.outboxDays).toEqual((await first.get(owner.subjectId)).pendingDays);
      expect(actual?.keys).toHaveLength(1); expect(actual?.keys[0]?.secret).toBe(secret);
      expect(await first.accountErasureInventory({ ...owner, issuer: "https://foreign.test" })).toBeNull();
      await first.grant("synthetic-unknown-owner", new Date());
      expect(await first.accountErasureInventory({ ...owner, subjectId: "synthetic-unknown-owner" })).toBeNull();
      await expect(changed.init(secret + "changed")).rejects.toThrow("HMAC secret changed");
      expect(await changed.accountErasureInventory(owner)).toBeNull();
    } finally { await first.close(); await changed.close(); await target.query(`DROP SCHEMA ${schema} CASCADE`); }
  });
  it.skipIf(!joint)("runs COP's actual controller and adapters through the actual SIM HTTP/PG owners without positive authority callbacks", async () => {
    const f = joint!;
    const suffix = randomUUID(), owner = { issuer: identityIssuer, subjectId: "synthetic-cop-joint-" + suffix };
    const dsn = (database: string) => `postgresql://cop_safety_test_admin@127.0.0.1:57587/${database}`;
    const driver = new Pool({ connectionString: dsn("sim_driver_measurements") });
    const router = new Pool({ connectionString: dsn("sim_ai_router") });
    const store = new PostgresMobilityStore({ connectionString: local }, {}, undefined, true); await store.init();
    const consents = new PostgresDriverMeasurementConsentStore({ connectionString: local }); await consents.init(f.driverHashSecret);
    const continuity = client(); const alias = opaqueUserId(routerKey, owner.subjectId);
    const simHash = (text: string) => createHmac("sha256", f.driverHashSecret).update(text).digest("hex");
    const contribution = simHash("cop:" + contributorIdDay(f.driverHashSecret, owner.subjectId, new Date().toISOString().slice(0, 10)));
    const routerHash = (client: string) => createHash("sha256").update(f.driverHashSecret).update("\0").update(client).update("\0").update(alias).digest("hex");
    const targetHash = routerHash("cop"), preservedHash = routerHash("sim");
    const batch = randomUUID(), otherBatch = randomUUID(), otherContributor = simHash("cop:synthetic-preserved-driver-" + suffix);
    let app: ReturnType<typeof buildServer> | undefined;
    try {
      const seed = await driver.connect();
      try {
        await seed.query("BEGIN");
        await seed.query("SELECT set_config('sim.driver_erasure_context','driver-account-erasure-v1',true),set_config('sim.driver_erasure_checkpoint',$1,true)",
          [simHash("cop:account-erasure-checkpoint:" + f.driverCheckpoint)]);
        for (const [id, contributor] of [[batch, contribution], [otherBatch, otherContributor]]) {
          await seed.query("INSERT INTO driver_measurement_receipts VALUES('cop',$1,$2,$3,now(),now()+interval '7 days','{}')", [id, contributor, "a".repeat(64)]);
          await seed.query("INSERT INTO driver_measurement_intervals VALUES('cop',$1,$2,'synthetic-graph','1',now(),50,50,3)", [id, createHash("sha256").update(id!).digest("hex")]);
        }
        await seed.query("SAVEPOINT mismatched_eta");
        await expect(seed.query("INSERT INTO driver_measurement_eta VALUES('cop',$1,$2,$3,'synthetic-graph',now(),50,60)",
          [otherBatch, randomUUID(), contribution])).rejects.toMatchObject({ code: "23503" });
        await seed.query("ROLLBACK TO SAVEPOINT mismatched_eta");
        for (const [id, contributor] of [[batch, contribution], [otherBatch, otherContributor]])
          await seed.query("INSERT INTO driver_measurement_eta VALUES('cop',$1,$2,$3,'synthetic-graph',now(),50,60)", [id, randomUUID(), contributor]);
        await seed.query("COMMIT");
      } catch (error) { await seed.query("ROLLBACK"); throw error; } finally { seed.release(); }
      // Synthetic opaque ciphertext: no real API key, model or provider call.
      for (const hash of [targetHash, preservedHash]) await router.query("INSERT INTO ai_router_user_key(user_hash,ciphertext,nonce,auth_tag,fingerprint) VALUES($1,$2,$3,$4,$5)",
        [hash, randomBytes(32), randomBytes(12), randomBytes(16), "synthetic-test-01"]);
      await consents.grant(owner.subjectId, new Date(), owner);
      const base = { authorityMode: "database_v2" as const, token: f.copToken, issuer: identityIssuer, actorSecret: f.actorSecret, userIdSecret: routerKey,
        reviewExistingIdentity: (actor: Parameters<PostgresAccountErasureContinuity["reviewRouterIdentity"]>[0], context: Parameters<PostgresAccountErasureContinuity["reviewRouterIdentity"]>[1]) =>
          continuity.reviewRouterIdentity(actor, context, { issuer: identityIssuer, userIdSecret: routerKey }) };
      const actual = [createSimRouterAccountErasureAdapter({ ...base, baseUrl: f.routerUrl }),
        createCOPDriverMeasurementsErasureAdapter({ ...base, baseUrl: f.driverUrl, inventory: actor => consents.accountErasureInventory({ issuer: actor.issuer!, subjectId: actor.subjectId! }) }, consents)];
      const adapters = ACCOUNT_ERASURE_ADAPTER_IDS.map(id => actual.find(a => a.id === id) ?? ({ id,
        ready: async () => true, preflight: async () => ({ ready: true as const, version: "explicit-unaccepted-other-owner-fixture" }),
        erase: async () => ({ status: "pending" as const, remaining: "cleanup_pending" as const }) }));
      const service = new AccountErasureService({ store, issuer: identityIssuer, identitySecret: secret,
        requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS, adapters, accepted: true, expectedGuardStoreId: binding.applicationStoreId,
        continuityRequired: true, continuity });
      const actor = { ...owner, authMode: "oidc" as const, username: "", displayName: "", authTime: Math.floor(Date.now() / 1000) };
      const op = randomUUID();
      const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const jwk = { ...publicKey.export({ format: "jwk" }), kid: "joint-synthetic", alg: "RS256", use: "sig" };
      const realFetch = globalThis.fetch;
      vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input) === identityIssuer + "/protocol/openid-connect/certs") return new Response(JSON.stringify({ keys: [jwk] }));
        return realFetch(input, init);
      });
      for (const [key, value] of Object.entries({ COP_DATABASE_URL: "", COP_AUTH_MODE: "oidc", COP_OIDC_ISSUER: identityIssuer,
        COP_OIDC_ALLOWED_CLIENTS: "cop-web,csm-mobile", COP_OIDC_REQUIRED_ROLE: "", COP_ALLOW_LAB_TOKEN: "false",
        COP_ACCOUNT_ERASURE_ENABLED: "false", COP_ACCOUNT_ERASURE_SECRET: secret, COP_ACCOUNT_SAFETY_GUARD_REQUIRED: "false",
        COP_SHARED_MOBILITY_ENABLED: "false", COP_PRIVATE_DISPATCH_ENABLED: "false", COP_WEB_BFF_SESSION_ENABLED: "false",
        COP_DRIVER_MEASUREMENTS_ENABLED: "false", COP_DRIVER_MEASUREMENTS_CLEANUP_ENABLED: "false", COP_DRIVER_MEASUREMENTS_HASH_SECRET: f.driverHashSecret,
        COP_MEDIA_STORE: "disabled" })) vi.stubEnv(key, value);
      const token = (subject: string) => {
        const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
        const body = encode({ alg: "RS256", kid: jwk.kid }) + "." + encode({ iss: identityIssuer, sub: subject, azp: "cop-web",
          iat: actor.authTime, auth_time: actor.authTime, exp: actor.authTime + 300 });
        return body + "." + createSign("RSA-SHA256").update(body).end().sign(privateKey).toString("base64url");
      };
      const headers = { authorization: "Bearer " + token(owner.subjectId), "idempotency-key": op };
      app = buildServer({ accountErasure: service, mobilityStore: store, accountSafetyStore: store, driverMeasurementConsentStore: consents });
      const plan = await app.inject({ method: "POST", url: "/api/v1/me/account-deletion/preflight", headers, payload: {} });
      expect(plan.statusCode).toBe(200); expect(plan.json().canConfirm).toBe(true);
      const inFlight = await driver.connect();
      let response: Awaited<ReturnType<typeof app.inject>>;
      try {
        await inFlight.query("BEGIN");
        const pid = (await inFlight.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        await inFlight.query("SELECT set_config('sim.driver_erasure_context','driver-account-erasure-v1',true),set_config('sim.driver_erasure_checkpoint',$1,true)",
          [simHash("cop:account-erasure-checkpoint:" + f.driverCheckpoint)]);
        const racingBatch = randomUUID();
        await inFlight.query("INSERT INTO driver_measurement_receipts VALUES('cop',$1,$2,$3,now(),now()+interval '7 days','{}')", [racingBatch, contribution, "c".repeat(64)]);
        await inFlight.query("INSERT INTO driver_measurement_intervals VALUES('cop',$1,$2,'synthetic-graph','1',now(),50,50,3)", [racingBatch, createHash("sha256").update(racingBatch).digest("hex")]);
        let finished = false;
        const confirmation = app.inject({ method: "POST", url: "/api/v1/me/account-deletion", headers: { ...headers,
          "x-cop-erasure-plan": plan.json().planId, "x-cop-erasure-receipt-capability": plan.headers["x-cop-erasure-receipt-capability"] as string }, payload: { confirmAccountDeletion: true } })
          .then(result => { finished = true; return result; });
        let actualWait = false; const deadline = Date.now() + 1200;
        while (!actualWait && Date.now() < deadline) {
          actualWait = (await driver.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname='sim_driver_measurements' AND $1=ANY(pg_blocking_pids(pid))) AS waiting", [pid])).rows[0].waiting;
          if (!actualWait) await new Promise(resolve => setTimeout(resolve, 15));
        }
        // Observe an actual database lock waiter, not just a delayed promise.
        // Always commit/release the admitted batch before asserting or awaiting
        // the response, so even a failed fixture cannot strand another service.
        const completedEarly = finished;
        await inFlight.query("COMMIT"); response = await confirmation;
        expect(actualWait).toBe(true); expect(completedEarly).toBe(false);
      } catch (error) { await inFlight.query("ROLLBACK").catch(() => undefined); throw error; }
      finally { inFlight.release(); }
      expect(response.statusCode).toBe(202); const receipt = response.json();
      expect(receipt.accountDeleted).toBe(false); // Other real production owners are deliberately not claimed.
      expect(receipt.remaining).not.toContain("ai_router"); expect(receipt.remaining).not.toContain("sim_measurements");
      expect((await driver.query("SELECT count(*) FROM driver_measurement_receipts WHERE contributor_hash=$1", [contribution])).rows[0].count).toBe("0");
      expect((await driver.query("SELECT count(*) FROM driver_measurement_eta WHERE contributor_hash=$1", [contribution])).rows[0].count).toBe("0");
      expect((await driver.query("SELECT count(*) FROM driver_measurement_receipts WHERE batch_id=$1 AND contributor_hash=$2", [otherBatch, otherContributor])).rows[0].count).toBe("1");
      expect((await driver.query("SELECT count(*) FROM driver_measurement_eta WHERE batch_id=$1 AND contributor_hash=$2", [otherBatch, otherContributor])).rows[0].count).toBe("1");
      expect((await router.query("SELECT count(*) FROM ai_router_user_key WHERE user_hash=$1", [targetHash])).rows[0].count).toBe("0");
      expect((await router.query("SELECT count(*) FROM ai_router_user_key WHERE user_hash=$1", [preservedHash])).rows[0].count).toBe("1");
      expect((await consents.get(owner.subjectId)).grantedAt).toBeNull();
      await expect(service.assertAllowed(actor)).rejects.toMatchObject({ status: 403 });
      await service.assertAllowed({ ...actor, subjectId: "synthetic-unaffected-other" });
      expect((await app.inject({ url: "/api/v1/me/preferences", headers })).statusCode).toBe(403);
      expect((await app.inject({ url: "/api/v1/me/preferences", headers: { authorization: "Bearer " + token("synthetic-unaffected-other") } })).statusCode).toBe(200);
      expect((await app.inject({ url: "/api/v1/me/account-deletion/" + op, headers: { authorization: "Bearer " + token("synthetic-unaffected-other") } })).statusCode).toBe(404);
      const rows = await admin.query("SELECT operation_id FROM cop_safety_v2.fences"); expect(rows.rows).toEqual([{ operation_id: op }]);
    } finally { await app?.close(); await driver.query("ROLLBACK").catch(() => undefined); await driver.end(); await router.end();
      await consents.close().catch(() => undefined); await store.close().catch(() => undefined); }
  });
});
