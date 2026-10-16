#!/usr/bin/env node
/** Owned local PostgreSQL 18 acceptance for the administrative installer.
 * No SSH, containers, provider calls, production configuration or real accounts.
 * Run with Node 24 after reviewing the helper; every failure is output-redacted.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdtemp, chmod, mkdir, writeFile, readFile, rm, realpath, rename, symlink } from "node:fs/promises";
import { join } from "node:path";
const require = createRequire(new URL("../apps/cop-api/package.json", import.meta.url));
const run = promisify(execFile);
const BIN = "/opt/homebrew/Cellar/postgresql@18/18.3/bin";
const forbidden =
  /^(?:PG(?:HOST|HOSTADDR|PORT|DATABASE|USER|PASSWORD|PASSFILE|SERVICE|SERVICEFILE|OPTIONS|SSLMODE|SSLROOTCERT)|COP_.*(?:DATABASE|SECRET|TOKEN|ENABLED)|DATABASE_URL)$/u;
let root,
  startAttempted = false,
  admin,
  business,
  successes = 0;
const pools = new Set();
const names = new Set();
const ALLOWED_CODES = new Set([
  "DEPENDENCY_PG_UNAVAILABLE",
  "INVALID_OPTIONS",
  "PRIVATE_FILE_INVALID",
  "MANIFEST_INVALID",
  "SOURCE_MISMATCH",
  "ENV_INVALID",
  "IDENTITY_CONFLICT",
  "ERASURE_SECRET_MISSING",
  "FLAGS_NOT_DISABLED",
  "POSTGRES_PREFLIGHT_FAILED",
  "WRONG_CLUSTER",
  "ADMIN_REQUIRED",
  "BUSINESS_STATE_CONFLICT",
  "ROLE_CONFLICT",
  "GUARD_STATE_CONFLICT",
  "PRIVILEGE_CONFLICT",
  "RUNTIME_CREDENTIALS_REJECTED",
  "DATABASE_STAGE_FAILED",
  "ENV_CHANGED"
]);
const secret = () => randomBytes(32).toString("hex");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let options, baseEnv, manifest, envPath, manifestPath, businessRelationOid, provision, Pool;
const canonical = (value) =>
  Array.isArray(value)
    ? "[" + value.map(canonical).join(",") + "]"
    : value && typeof value === "object"
      ? "{" +
        Object.keys(value)
          .sort()
          .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
          .join(",") +
        "}"
      : JSON.stringify(value);

async function command(binary, args) {
  // Never inherit ambient database, credentials, NODE_OPTIONS or shell hooks.
  return run(join(BIN, binary), args, {
    env: { PATH: BIN + ":/usr/bin:/bin", HOME: root, LC_ALL: "C" },
    maxBuffer: 1024 * 1024,
    timeout: 30000
  });
}
function pool(database, user = options.admin.user, password = options.admin.password, extra = {}) {
  const result = new Pool({
    host: "127.0.0.1",
    port: options.admin.port,
    database,
    user,
    password,
    ssl: false,
    max: 2,
    connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 1000,
    ...extra
  });
  result.on("error", () => {});
  pools.add(result);
  return result;
}
async function closePool(value) {
  if (pools.delete(value)) await value.end();
}
async function owned() {
  const row = (
    await admin.query(
      "SELECT current_setting('cluster_name') name,current_setting('data_directory') directory,current_setting('server_version_num')::int version"
    )
  ).rows[0];
  assert.equal(row.name, "cop_guard_installer_test");
  assert.equal(await realpath(row.directory), join(root, "pgdata"));
  assert.ok(row.version >= 180000 && row.version < 190000);
}
async function saveEnv(text = baseEnv) {
  await writeFile(envPath, text, { mode: 0o600 });
  await chmod(envPath, 0o600);
}
async function saveManifest(value = manifest) {
  await writeFile(manifestPath, JSON.stringify(value) + "\n", { mode: 0o600 });
  await chmod(manifestPath, 0o600);
}
const envValue = (text, name) =>
  text
    .split("\n")
    .find((line) => line.startsWith(name + "="))
    ?.slice(name.length + 1);
async function apply(overrides = {}) {
  return provision({ ...options, mode: "apply", ...overrides });
}
async function check(overrides = {}) {
  return provision({ ...options, mode: "check", ...overrides });
}
async function refusal(runCase, codes) {
  let rejected = false;
  try {
    await runCase();
  } catch (error) {
    rejected = true;
    assert.ok(ALLOWED_CODES.has(error?.code));
    if (codes) assert.ok(codes.includes(error.code));
    // Full exceptions, SQL, DSNs and password values must not escape this harness.
  }
  assert.ok(rejected);
}
async function pass(name, task) {
  assert.match(name, /^[a-z0-9_]+$/u);
  assert.ok(!names.has(name));
  names.add(name);
  try {
    await task();
  } catch {
    throw Object.assign(new Error("OWNED_POSTGRES_CASE_FAILED"), { caseName: name });
  }
  successes += 1;
  process.stdout.write("PASS " + name + "\n");
}
async function reset() {
  await owned();
  // Only the exact schema and two helper-owned roles inside our private cluster.
  await admin.query("DROP SCHEMA IF EXISTS cop_safety_v2 CASCADE");
  for (const name of ["cop_safety_v2_runtime", "cop_safety_v2_owner"]) {
    if ((await admin.query("SELECT EXISTS(SELECT FROM pg_roles WHERE rolname=$1) present", [name])).rows[0].present)
      await business.query("DROP OWNED BY " + name);
    await admin.query(
      `DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='${name}') THEN REVOKE ALL ON DATABASE cop_account_safety_guard FROM ${name}; DROP OWNED BY ${name}; DROP ROLE ${name}; END IF; END $$`
    );
  }
  await business.query("TRUNCATE cop_mobility_v1");
  await saveEnv();
  await saveManifest();
}
async function sentinels() {
  assert.deepEqual((await admin.query("SELECT value FROM cop_guard.fixture_sentinel")).rows, [
    { value: "existing-cop-guard" }
  ]);
  assert.deepEqual((await admin.query("SELECT value FROM sim_erasure_guard_v2.fixture_sentinel")).rows, [
    { value: "existing-sim-guard" }
  ]);
  assert.equal(
    (await admin.query("SELECT count(*)::int n FROM pg_roles WHERE rolname='cop_guard_fixture_runtime'")).rows[0].n,
    1
  );
}
async function snapshots() {
  return {
    env: await readFile(envPath, "utf8"),
    role: (
      await admin.query(
        "SELECT rolname,rolpassword,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_authid WHERE rolname IN ('cop_safety_v2_runtime','cop_safety_v2_owner') ORDER BY rolname"
      )
    ).rows,
    configuration: (await admin.query("SELECT * FROM cop_safety_v2.configuration")).rows,
    replay: (await admin.query("SELECT * FROM cop_safety_v2.dataset_replays")).rows,
    functions: (
      await admin.query(
        "SELECT p.proname,p.prosrc,p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='cop_safety_v2' ORDER BY p.proname"
      )
    ).rows,
    triggers: (
      await admin.query(
        "SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='cop_safety_v2' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname"
      )
    ).rows,
    business: (await business.query("SELECT key,value FROM cop_mobility_v1 ORDER BY key")).rows
  };
}
async function awaitLock(query, args = []) {
  const until = Date.now() + 3500;
  while (Date.now() < until) {
    if ((await admin.query(query, args)).rows[0]?.ready) return;
    await sleep(20);
  }
  throw new Error("OWNED_EXPECTED_LOCK_NOT_OBSERVED");
}
async function deniedSQL(client, sql, args = []) {
  let denied = false;
  try {
    await client.query(sql, args);
  } catch (error) {
    denied = ["42501", "55000", "23514", "23505", "P0001"].includes(error.code);
  }
  assert.ok(denied);
}

async function main() {
  assert.equal(process.platform, "darwin");
  assert.ok(process.getuid() !== 0);
  assert.ok(
    !Object.keys(process.env).some((name) => forbidden.test(name)),
    "Ambient database configuration is forbidden"
  );
  ({ Pool } = require("pg"));
  ({ provision } = await import("./account-safety/provision-database-v2.mjs"));
  root = await realpath(await mkdtemp("/private/tmp/cop-guard-installer-"));
  await chmod(root, 0o700);
  assert.match(root, /^\/private\/tmp\/cop-guard-installer-[A-Za-z0-9]+$/u);
  await mkdir(join(root, "socket"), { mode: 0o700 });
  const password = secret(),
    pwFile = join(root, "admin.pw");
  await writeFile(pwFile, password + "\n", { mode: 0o600 });
  const listener = createServer();
  await new Promise((resolve, reject) => listener.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  assert.ok(port >= 1024 && port <= 65535);
  await command("initdb", [
    "-D",
    join(root, "pgdata"),
    "-U",
    "cop_guard_fixture_admin",
    "--auth-local=trust",
    "--auth-host=scram-sha-256",
    "--pwfile=" + pwFile,
    "--no-locale",
    "-E",
    "UTF8"
  ]);
  await rm(pwFile);
  await writeFile(
    join(root, "pgdata", "postgresql.auto.conf"),
    `cluster_name='cop_guard_installer_test'\nlisten_addresses='127.0.0.1'\nport=${port}\nunix_socket_directories='${join(root, "socket")}'\nlog_statement='none'\nlog_min_error_statement='panic'\nlog_min_duration_statement=0\nlog_min_duration_sample=0\nlog_statement_sample_rate=1\nlog_transaction_sample_rate=1\nlog_connections=off\nlog_disconnections=off\n`,
    { mode: 0o600 }
  );
  startAttempted = true;
  await command("pg_ctl", ["-D", join(root, "pgdata"), "-l", join(root, "postgres.log"), "-w", "start"]);
  options = {
    syntheticRoot: root,
    admin: { host: "127.0.0.1", port, user: "cop_guard_fixture_admin", password },
    manifestPath: join(root, "manifest.json")
  };
  const bootstrap = pool("postgres");
  await bootstrap.query("CREATE DATABASE cop_account_safety_guard");
  await bootstrap.query("CREATE DATABASE cop");
  await closePool(bootstrap);
  admin = pool("cop_account_safety_guard");
  business = pool("cop");
  await owned();
  await admin.query(
    "CREATE SCHEMA cop_guard; CREATE TABLE cop_guard.fixture_sentinel(value text); INSERT INTO cop_guard.fixture_sentinel VALUES('existing-cop-guard'); REVOKE ALL ON SCHEMA cop_guard FROM PUBLIC; CREATE SCHEMA sim_erasure_guard_v2; CREATE TABLE sim_erasure_guard_v2.fixture_sentinel(value text); INSERT INTO sim_erasure_guard_v2.fixture_sentinel VALUES('existing-sim-guard'); REVOKE ALL ON SCHEMA sim_erasure_guard_v2 FROM PUBLIC; CREATE ROLE cop_guard_fixture_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'synthetic-sentinel-not-production';"
  );
  await business.query(
    "CREATE TABLE cop_mobility_v1(key text PRIMARY KEY,value jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())"
  );
  businessRelationOid = (await business.query("SELECT 'cop_mobility_v1'::regclass::oid id")).rows[0].id;
  const actor = secret(),
    userKey = secret(),
    issuer = "https://synthetic.invalid/realms/cop";
  envPath = join(root, "cop.env");
  manifestPath = options.manifestPath;
  baseEnv = `# Synthetic owned installer fixture only\nCOP_OIDC_ISSUER=${issuer}\nCOP_AI_CHAT_ROUTER_USER_ID_SECRET=${userKey}\nCOP_SIM_ERASURE_ACTOR_SECRET=${actor}\nCOP_ACCOUNT_ERASURE_ENABLED=false\nCOP_DRIVER_MEASUREMENTS_ENABLED=false\nCOP_AI_CHAT_ROUTER_FULL_ENABLED=false\nUNRELATED_VALUE=preserve-me\n`;
  manifest = {
    contractVersion: "cop-database-safety-provision-v1",
    firstEnrollment: true,
    allowGenerateErasureSecret: true,
    applicationStoreId: randomUUID(),
    incarnationId: randomUUID(),
    guardStoreId: randomUUID(),
    restoreGeneration: 1,
    initialDigest: hash("synthetic-initial-head"),
    identityEvidenceDigest: hash("synthetic-existing-router-review"),
    identityBinding: {
      contractVersion: "cop-existing-router-identity-v1",
      issuer,
      routerKeyFingerprint: createHash("sha256").update("cop-router-identity-key-v1\0").update(userKey).digest("hex"),
      evidenceDigest: hash("synthetic-existing-router-review")
    },
    postgresCaSha256: hash("synthetic-ca-not-used-over-owned-loopback")
  };
  await saveEnv();
  await saveManifest();

  await pass("check_is_read_only_and_secret_absent", async () => {
    const before = await readFile(envPath);
    const result = await check();
    assert.equal(result.phase, "preflight_checked");
    assert.equal(result.needsSecretGeneration, true);
    assert.equal(result.wholeAccountComplete, false);
    assert.deepEqual(await readFile(envPath), before);
    assert.equal((await admin.query("SELECT to_regnamespace('cop_safety_v2') present")).rows[0].present, null);
    assert.equal((await business.query("SELECT count(*)::int n FROM cop_mobility_v1")).rows[0].n, 0);
  });
  await pass("rejects_missing_explicit_generation_permission", async () => {
    await saveManifest({ ...manifest, allowGenerateErasureSecret: false });
    await refusal(() => apply(), ["ERASURE_SECRET_MISSING"]);
    await saveManifest();
  });
  await pass("rejects_unreviewed_identity_and_unknown_manifest_fields", async () => {
    await saveManifest({ ...manifest, unexpected: true });
    await refusal(() => apply(), ["MANIFEST_INVALID"]);
    await saveManifest({ ...manifest, identityEvidenceDigest: "e".repeat(64) });
    await refusal(() => apply(), ["MANIFEST_INVALID"]);
    await saveManifest({
      ...manifest,
      identityBinding: { ...manifest.identityBinding, routerKeyFingerprint: "f".repeat(64) }
    });
    await refusal(() => apply(), ["IDENTITY_CONFLICT"]);
    await saveManifest();
  });
  await pass("rejects_enabled_flags_without_mutation", async () => {
    await saveEnv(baseEnv.replace("COP_ACCOUNT_ERASURE_ENABLED=false", "COP_ACCOUNT_ERASURE_ENABLED=true"));
    const before = await readFile(envPath);
    await refusal(() => apply(), ["FLAGS_NOT_DISABLED"]);
    assert.deepEqual(await readFile(envPath), before);
    await saveEnv();
  });
  await pass("rejects_nonprivate_manifest_without_database_change", async () => {
    const before = await readFile(envPath);
    await chmod(manifestPath, 0o644);
    try {
      await refusal(() => apply(), ["PRIVATE_FILE_INVALID"]);
    } finally {
      await chmod(manifestPath, 0o600);
    }
    assert.deepEqual(await readFile(envPath), before);
    assert.equal((await admin.query("SELECT to_regnamespace('cop_safety_v2') value")).rows[0].value, null);
  });
  await pass("rejects_symlink_manifest_without_database_or_secret_write", async () => {
    const before = await readFile(envPath),
      actual = manifestPath + ".actual";
    await rename(manifestPath, actual);
    await symlink(actual, manifestPath);
    try {
      await refusal(() => apply(), ["PRIVATE_FILE_INVALID"]);
    } finally {
      await rm(manifestPath);
      await rename(actual, manifestPath);
    }
    assert.deepEqual(await readFile(envPath), before);
    assert.equal((await admin.query("SELECT to_regnamespace('cop_safety_v2') value")).rows[0].value, null);
  });
  await pass("first_enrollment_locks_real_business_table", async () => {
    await business.query("INSERT INTO cop_mobility_v1 VALUES('fixture:unrelated-business','{\"keep\":true}',now())");
    const blocker = await admin.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock(1932540802,2)");
    const installing = apply();
    let installError;
    installing.catch((error) => {
      installError = error;
    });
    try {
      await awaitLock(
        "SELECT EXISTS(SELECT FROM pg_locks l JOIN pg_database d ON d.oid=l.database WHERE d.datname='cop' AND l.relation=$1 AND l.mode='ShareRowExclusiveLock' AND l.granted) ready",
        [businessRelationOid]
      );
      const writer = await business.connect();
      try {
        await writer.query("SET statement_timeout='250ms'");
        let blocked = false;
        try {
          await writer.query("INSERT INTO cop_mobility_v1 VALUES('account-erasure:job:blocked','{}',now())");
        } catch (error) {
          blocked = error.code === "57014";
        }
        assert.ok(blocked);
        await writer.query("RESET statement_timeout");
      } finally {
        writer.release();
      }
      assert.equal(installError, undefined);
      await blocker.query("COMMIT");
      const result = await installing;
      assert.equal(result.wholeAccountComplete, false);
    } finally {
      await blocker.query("ROLLBACK").catch(() => {});
      blocker.release();
      await installing.catch(() => {});
    }
    const current = await readFile(envPath, "utf8");
    assert.equal(envValue(current, "COP_SIM_ERASURE_ACTOR_SECRET"), actor);
    assert.equal(envValue(current, "COP_AI_CHAT_ROUTER_USER_ID_SECRET"), userKey);
    assert.equal(envValue(current, "COP_ACCOUNT_ERASURE_ENABLED"), "false");
    assert.equal(envValue(current, "UNRELATED_VALUE"), "preserve-me");
    assert.ok(envValue(current, "COP_ACCOUNT_ERASURE_SECRET")?.length >= 32);
    const config = (await admin.query("SELECT * FROM cop_safety_v2.configuration")).rows[0];
    assert.equal(config.application_store_id, manifest.applicationStoreId);
    assert.equal(config.guard_store_id, manifest.guardStoreId);
    assert.deepEqual(config.identity_binding, manifest.identityBinding);
    assert.deepEqual(
      (await business.query("SELECT value FROM cop_mobility_v1 WHERE key='fixture:unrelated-business'")).rows,
      [{ value: { keep: true } }]
    );
    await sentinels();
  });
  await pass("check_and_apply_retry_preserve_exact_credentials_and_bindings", async () => {
    const before = await snapshots();
    await check();
    assert.deepEqual(await snapshots(), before);
    await apply();
    assert.deepEqual(await snapshots(), before);
  });
  await pass("rejects_changed_store_incarnation_guard_generation_and_head", async () => {
    const before = await snapshots();
    for (const delta of [
      { applicationStoreId: randomUUID() },
      { incarnationId: randomUUID() },
      { guardStoreId: randomUUID() },
      { restoreGeneration: 2 },
      { initialDigest: "a".repeat(64) }
    ]) {
      await saveManifest({ ...manifest, ...delta });
      await refusal(() => apply());
      assert.deepEqual(await snapshots(), before);
    }
    await saveManifest();
  });
  await pass("rejects_changed_router_key_and_erasure_secret", async () => {
    const current = await readFile(envPath, "utf8");
    for (const name of ["COP_AI_CHAT_ROUTER_USER_ID_SECRET", "COP_ACCOUNT_ERASURE_SECRET"]) {
      const changed = current.replace(new RegExp("^" + name + "=.*$", "mu"), name + "=" + secret());
      await saveEnv(changed);
      await refusal(() => apply());
      assert.equal(await readFile(envPath, "utf8"), changed);
    }
    await saveEnv(current);
  });
  await pass("rejects_unreviewed_additional_runtime_privilege", async () => {
    const before = await snapshots();
    await admin.query("GRANT DELETE ON cop_safety_v2.fences TO cop_safety_v2_runtime");
    try {
      await refusal(() => apply(), ["PRIVILEGE_CONFLICT"]);
      assert.deepEqual(await snapshots(), before);
    } finally {
      await admin.query("REVOKE DELETE ON cop_safety_v2.fences FROM cop_safety_v2_runtime");
    }
  });
  await pass("tampered_guard_function_refused_without_repair", async () => {
    const original = (
      await admin.query("SELECT pg_get_functiondef('cop_safety_v2.immutable()'::regprocedure) definition")
    ).rows[0].definition;
    await admin.query(
      "CREATE OR REPLACE FUNCTION cop_safety_v2.immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$"
    );
    const before = await snapshots();
    try {
      await refusal(() => apply(), ["GUARD_STATE_CONFLICT"]);
      assert.deepEqual(await snapshots(), before);
    } finally {
      await admin.query(original);
    }
  });
  await pass("missing_immutable_trigger_refused_without_repair", async () => {
    const original = (
      await admin.query(
        "SELECT pg_get_triggerdef(oid) definition FROM pg_trigger WHERE tgrelid='cop_safety_v2.configuration'::regclass AND tgname='immutable_rows'"
      )
    ).rows[0].definition;
    await admin.query("DROP TRIGGER immutable_rows ON cop_safety_v2.configuration");
    const before = await snapshots();
    try {
      await refusal(() => apply(), ["GUARD_STATE_CONFLICT"]);
      assert.deepEqual(await snapshots(), before);
    } finally {
      await admin.query(original);
    }
  });
  await pass("runtime_can_read_append_and_advance_cursor_only", async () => {
    const env = await readFile(envPath, "utf8"),
      connection = new URL(envValue(env, "COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL"));
    assert.equal(connection.hostname, "127.0.0.1");
    assert.equal(Number(connection.port), options.admin.port);
    assert.equal(connection.pathname, "/cop_account_safety_guard");
    const runtime = pool(
      "cop_account_safety_guard",
      decodeURIComponent(connection.username),
      decodeURIComponent(connection.password)
    );
    try {
      const row = (await runtime.query("SELECT * FROM cop_safety_v2.configuration")).rows[0];
      const key = hash("synthetic-no-account"),
        operationId = randomUUID(),
        when = new Date().toISOString();
      const entry = {
        contractVersion: "cop-erasure-fence-entry-v1",
        applicationStoreId: manifest.applicationStoreId,
        configurationFingerprint: row.configuration_fingerprint,
        accountKey: key,
        job: {
          operationId,
          requestedAt: when,
          required: [
            "keycloak",
            "cop_sessions_profiles",
            "cop_devices",
            "messaging_matrix",
            "voice_livekit",
            "cop_content_media",
            "mobility_dispatch",
            "sim_measurements",
            "ai_router",
            "moderation_audit",
            "backup_restore"
          ],
          checkpoints: {}
        }
      };
      const digest = hash(canonical({ sequence: 1, previousDigest: manifest.initialDigest, entry }));
      await runtime.query(
        "INSERT INTO cop_safety_v2.fences(sequence,account_key,operation_id,requested_at,entry,previous_digest,digest) VALUES(1,$1,$2,$3,$4,$5,$6)",
        [key, operationId, when, entry, manifest.initialDigest, digest]
      );
      await runtime.query(
        "UPDATE cop_safety_v2.dataset_replays SET replay_sequence=1,replay_digest=$1 WHERE owner='cop'",
        [digest]
      );
      assert.equal(
        (await runtime.query("SELECT replay_sequence FROM cop_safety_v2.dataset_replays")).rows[0].replay_sequence,
        "1"
      );
      for (const sql of [
        "DELETE FROM cop_safety_v2.fences",
        "TRUNCATE cop_safety_v2.fences",
        "UPDATE cop_safety_v2.configuration SET configuration_fingerprint='" + "b".repeat(64) + "'",
        "UPDATE cop_safety_v2.dataset_replays SET restore_generation=2",
        "UPDATE cop_safety_v2.dataset_replays SET incarnation_id='" + randomUUID() + "'",
        "DELETE FROM cop_safety_v2.dataset_replays",
        "SELECT * FROM cop_guard.fixture_sentinel",
        "SELECT * FROM sim_erasure_guard_v2.fixture_sentinel",
        "CREATE TABLE cop_safety_v2.unauthorized(x int)",
        "CREATE ROLE unauthorized_guard_role LOGIN"
      ])
        await deniedSQL(runtime, sql);
      const role = (
        await admin.query(
          "SELECT rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='cop_safety_v2_runtime'"
        )
      ).rows[0];
      assert.ok(Object.values(role).every((value) => value === false));
      assert.equal(
        (await admin.query("SELECT rolcanlogin FROM pg_roles WHERE rolname='cop_safety_v2_owner'")).rows[0].rolcanlogin,
        false
      );
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int n FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='cop_safety_v2_runtime'"
          )
        ).rows[0].n,
        0
      );
    } finally {
      await closePool(runtime);
    }
    await sentinels();
  });
  await pass("foreign_runtime_cannot_read_cop_guard", async () => {
    const foreign = pool("cop_account_safety_guard", "cop_guard_fixture_runtime", "synthetic-sentinel-not-production");
    try {
      await deniedSQL(foreign, "SELECT * FROM cop_safety_v2.configuration");
    } finally {
      await closePool(foreign);
    }
  });
  await pass("progressed_state_refused_without_reset_or_reenrollment", async () => {
    const before = await snapshots();
    const count = (await admin.query("SELECT count(*)::int n FROM cop_safety_v2.fences")).rows[0].n;
    await refusal(() => apply(), ["GUARD_STATE_CONFLICT"]);
    assert.deepEqual(await snapshots(), before);
    assert.equal((await admin.query("SELECT count(*)::int n FROM cop_safety_v2.fences")).rows[0].n, count);
  });
  await pass("existing_jobs_block_first_enrollment", async () => {
    await reset();
    await business.query("INSERT INTO cop_mobility_v1 VALUES('account-erasure:job:synthetic','{}',now())");
    const before = await readFile(envPath);
    await refusal(() => apply(), ["BUSINESS_STATE_CONFLICT"]);
    assert.deepEqual(await readFile(envPath), before);
    assert.equal((await admin.query("SELECT to_regnamespace('cop_safety_v2') value")).rows[0].value, null);
  });
  await pass("partial_business_identity_refused_without_adoption", async () => {
    await reset();
    await business.query("INSERT INTO cop_mobility_v1 VALUES('account-safety:store-identity-v1',$1,now())", [
      { storeId: manifest.applicationStoreId, incarnationId: manifest.incarnationId }
    ]);
    const before = await readFile(envPath),
      rows = (await business.query("SELECT key,value FROM cop_mobility_v1")).rows;
    await refusal(() => apply(), ["BUSINESS_STATE_CONFLICT"]);
    assert.deepEqual(await readFile(envPath), before);
    assert.deepEqual((await business.query("SELECT key,value FROM cop_mobility_v1")).rows, rows);
    assert.equal((await admin.query("SELECT to_regnamespace('cop_safety_v2') value")).rows[0].value, null);
  });
  await pass("metadata_rechecked_after_waiting_for_business_lock", async () => {
    await reset();
    const holder = await business.connect();
    await holder.query("BEGIN");
    await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('mobility-v1',731031))");
    const installing = apply();
    installing.catch(() => {});
    try {
      await awaitLock(
        "SELECT EXISTS(SELECT FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.datname='cop' AND a.application_name='cop-database-v2-provision' AND l.locktype='advisory' AND NOT l.granted) ready"
      );
      await holder.query("INSERT INTO cop_mobility_v1 VALUES('account-erasure:job:raced','{}',now())");
      await holder.query("COMMIT");
      await refusal(() => installing, ["BUSINESS_STATE_CONFLICT"]);
    } finally {
      await holder.query("ROLLBACK").catch(() => {});
      holder.release();
      await installing.catch(() => {});
    }
    assert.equal((await admin.query("SELECT to_regnamespace('cop_safety_v2') value")).rows[0].value, null);
  });
  await pass("partial_guard_schema_refused_without_adoption", async () => {
    await reset();
    await admin.query("CREATE SCHEMA cop_safety_v2; CREATE TABLE cop_safety_v2.unknown_partial(value int)");
    const before = await readFile(envPath);
    await refusal(() => apply(), ["GUARD_STATE_CONFLICT"]);
    assert.deepEqual(await readFile(envPath), before);
    assert.equal((await admin.query("SELECT count(*)::int n FROM cop_safety_v2.unknown_partial")).rows[0].n, 0);
    await sentinels();
  });
  await pass("unrelated_existing_runtime_role_refused", async () => {
    await reset();
    await admin.query("CREATE ROLE cop_safety_v2_runtime LOGIN PASSWORD 'synthetic-unrelated-role'");
    const before = await readFile(envPath);
    await refusal(() => apply(), ["ROLE_CONFLICT"]);
    assert.deepEqual(await readFile(envPath), before);
    await sentinels();
  });
  await pass("nonloopback_nonowned_root_and_unprivileged_admin_rejected", async () => {
    await reset();
    await refusal(() => check({ admin: { ...options.admin, host: "example.invalid" } }), ["INVALID_OPTIONS"]);
    await refusal(() => check({ syntheticRoot: "/private/tmp/unowned-cop-guard-fixture" }));
    await refusal(
      () =>
        check({
          admin: { ...options.admin, user: "cop_guard_fixture_runtime", password: "synthetic-sentinel-not-production" }
        }),
      ["ADMIN_REQUIRED"]
    );
  });
  await pass("existing_erasure_secret_is_preserved_on_first_enrollment", async () => {
    await reset();
    const preexisting = secret();
    await saveEnv(baseEnv + "COP_ACCOUNT_ERASURE_SECRET=" + preexisting + "\n");
    await saveManifest({ ...manifest, allowGenerateErasureSecret: false });
    await apply();
    assert.equal(envValue(await readFile(envPath, "utf8"), "COP_ACCOUNT_ERASURE_SECRET"), preexisting);
    await sentinels();
  });
  await pass("effective_public_foreign_access_refused_without_changing_grant", async () => {
    const before = await snapshots();
    await admin.query(
      "GRANT USAGE ON SCHEMA sim_erasure_guard_v2 TO PUBLIC; GRANT SELECT ON sim_erasure_guard_v2.fixture_sentinel TO PUBLIC"
    );
    try {
      await refusal(() => apply(), ["PRIVILEGE_CONFLICT"]);
      assert.deepEqual(await snapshots(), before);
      assert.equal(
        (
          await admin.query(
            "SELECT has_table_privilege('cop_safety_v2_runtime','sim_erasure_guard_v2.fixture_sentinel','SELECT') allowed"
          )
        ).rows[0].allowed,
        true
      );
    } finally {
      await admin.query(
        "REVOKE SELECT ON sim_erasure_guard_v2.fixture_sentinel FROM PUBLIC; REVOKE USAGE ON SCHEMA sim_erasure_guard_v2 FROM PUBLIC"
      );
    }
  });
  await pass("known_env_only_interruption_reuses_credentials_and_refuses_retarget", async () => {
    const persisted = await readFile(envPath, "utf8");
    await reset();
    await saveEnv(persisted);
    await saveManifest({ ...manifest, applicationStoreId: randomUUID() });
    await refusal(() => apply(), ["IDENTITY_CONFLICT"]);
    assert.equal(await readFile(envPath, "utf8"), persisted);
    assert.equal((await admin.query("SELECT to_regnamespace('cop_safety_v2') value")).rows[0].value, null);
    await saveManifest();
    const result = await apply();
    assert.equal(result.credentialsReused, true);
    assert.equal(await readFile(envPath, "utf8"), persisted);
    assert.equal((await business.query("SELECT count(*)::int n FROM cop_mobility_v1")).rows[0].n, 2);
    await sentinels();
  });
  await pass("known_guard_commit_before_business_reuses_exact_binding", async () => {
    // Construct the actual durable cross-database crash boundary in this owned
    // fixture, not a simulated network failure or a production restore proof.
    await business.query(
      "DELETE FROM cop_mobility_v1 WHERE key IN('account-safety:store-identity-v1','account-erasure:configuration-v1')"
    );
    const before = await snapshots();
    await saveManifest({ ...manifest, guardStoreId: randomUUID() });
    await refusal(() => apply(), ["GUARD_STATE_CONFLICT"]);
    assert.deepEqual(await snapshots(), before);
    await saveManifest();
    const result = await apply();
    assert.equal(result.firstEnrollment, false);
    assert.equal(result.credentialsReused, true);
    const after = await snapshots();
    assert.deepEqual({ ...after, business: [] }, before);
    assert.equal(after.business.length, 2);
    await sentinels();
  });
  await pass("duration_and_sample_logging_do_not_capture_credentials", async () => {
    // pg_authid values stay in memory; suppress fixture verifier read logging.
    const client = await admin.connect();
    let verifier;
    try {
      await client.query(
        "SET log_min_duration_statement=-1; SET log_min_duration_sample=-1; SET log_transaction_sample_rate=0"
      );
      verifier = (await client.query("SELECT rolpassword FROM pg_authid WHERE rolname='cop_safety_v2_runtime'")).rows[0]
        .rolpassword;
    } finally {
      client.release();
    }
    assert.ok(verifier?.startsWith("SCRAM-SHA-256$"));
    const env = await readFile(envPath, "utf8"),
      url = new URL(envValue(env, "COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL"));
    // A sentinel proves the fixture really enabled duration logging. Its text
    // contains no account, credential, operation, partner data or SQL parameters.
    await business.query("SELECT 1 AS fixture_duration_logging_sentinel");
    await sleep(100);
    const log = await readFile(join(root, "postgres.log"), "utf8");
    assert.match(log, /duration:.*fixture_duration_logging_sentinel/u);
    for (const value of [
      verifier,
      decodeURIComponent(url.password),
      envValue(env, "COP_ACCOUNT_ERASURE_SECRET"),
      actor,
      userKey
    ])
      assert.ok(!log.includes(value));
    assert.ok(!/CREATE ROLE cop_safety_v2_runtime[^\n]*SCRAM-SHA-256/u.test(log));
  });
  await pass("audit_setting_placeholder_refused_without_mutation", async () => {
    // This exercises an unresolved audit setting, not a loaded pgaudit module.
    const before = await snapshots();
    await business.query("ALTER DATABASE cop SET pgaudit.log='none'");
    try {
      await refusal(() => apply(), ["POSTGRES_PREFLIGHT_FAILED"]);
      assert.deepEqual(await snapshots(), before);
    } finally {
      await business.query("ALTER DATABASE cop RESET pgaudit.log");
    }
  });
}

let failed = false;
try {
  await main();
} catch (error) {
  failed = true;
  const name = /^[a-z0-9_]+$/u.test(error?.caseName ?? "") ? error.caseName : "fixture_preflight_or_setup";
  process.stderr.write("FAIL " + name + " REDACTED\n");
} finally {
  for (const value of [...pools])
    await closePool(value).catch(() => {
      failed = true;
    });
  let stopped = !startAttempted;
  if (startAttempted) {
    await command("pg_ctl", ["-D", join(root, "pgdata"), "-m", "immediate", "-w", "stop"])
      .then(() => {
        stopped = true;
      })
      .catch(async () => {
        // Never remove a possibly live server's files. A failed start may already
        // be stopped; pg_ctl status3 is the explicit owned no-server result.
        await command("pg_ctl", ["-D", join(root, "pgdata"), "status"]).catch((error) => {
          if (error.code === 3) stopped = true;
        });
        if (!stopped) failed = true;
      });
  }
  if (stopped && root && /^\/private\/tmp\/cop-guard-installer-[A-Za-z0-9]+$/u.test(root))
    await rm(root, { recursive: true, force: true }).catch(() => {
      failed = true;
    });
}
process.stdout.write(
  JSON.stringify({
    contractVersion: "cop-guard-installer-owned-postgres-test-v1",
    passed: successes,
    failed,
    productionContacted: false,
    providerCalled: false,
    realAccountDeleted: false,
    wholeAccountComplete: false
  }) + "\n"
);
if (failed) process.exitCode = 1;
