/** Actual owned local PG18 controller/journal tests. No production or provider.
 * Random credentials are synthetic and never printed or passed in argv. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, readFile, access } from "node:fs/promises";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
const run = promisify(execFile);
const require = createRequire(new URL("../apps/cop-api/package.json", import.meta.url));
const { Pool } = require("pg");
const bin = "/opt/homebrew/opt/postgresql@18/bin";
let root, started = false, attempted = false, admin, phase = "runtime", fixturePassword;
const base = { PATH: dirname(process.execPath) + ":" + bin + ":/usr/bin:/bin", HOME: process.env.HOME, LC_ALL: "C" };
const command = (name, args) => run(bin + "/" + name, args, { env: base, timeout: 30000, maxBuffer: 1024 * 1024 });
try {
  if (Number(process.versions.node.split(".")[0]) !== 24 || process.getuid?.() === 0) throw Error("fixture_runtime");
  if (!/PostgreSQL\) 18\./u.test((await command("postgres", ["--version"])).stdout)) throw Error("fixture_version");
  phase = "workspace_dependencies";
  for (const dependency of ["@cop/ai-gateway", "@cop/canonical-model", "@cop/ingest-contracts", "@cop/nato-symbol-renderer", "@cop/policy-engine"])
    await access(new URL("../apps/cop-api/node_modules/" + dependency + "/dist/index.js", import.meta.url));
  root = await mkdtemp("/private/tmp/cop-dataset-restore-");
  phase = "initdb";
  await mkdir(root + "/socket", { mode: 0o700 });
  const password = fixturePassword = randomBytes(32).toString("hex"), pw = root + "/synthetic-init-password";
  await writeFile(pw, password + "\n", { mode: 0o600, flag: "wx" });
  const listener = createServer();
  await new Promise((ok, bad) => { listener.once("error", bad); listener.listen(0, "127.0.0.1", ok); });
  const port = listener.address().port;
  await new Promise((ok, bad) => listener.close(error => error ? bad(error) : ok()));
  await command("initdb", ["-D", root + "/data", "--username=cop_safety_test_admin", "--auth-local=trust",
    "--auth-host=scram-sha-256", "--pwfile=" + pw, "--encoding=UTF8", "--locale=C"]);
  await rm(pw);
  attempted = true;
  phase = "start_fixture";
  await command("pg_ctl", ["-D", root + "/data", "-l", root + "/private-server.log", "-o",
    "-h 127.0.0.1 -p " + port + " -k " + root + "/socket -c cluster_name=cop_erasure_owned_test -c log_statement=none -c log_min_error_statement=panic", "-w", "start"]);
  started = true;
  phase = "fixture_sql";
  admin = new Pool({ host: "127.0.0.1", port, user: "cop_safety_test_admin", database: "postgres", password,
    ssl: false, max: 1, connectionTimeoutMillis: 2000 });
  admin.on("error", () => undefined);
  const observed = (await admin.query("SELECT current_setting('cluster_name') name,current_setting('data_directory') directory,pg_is_in_recovery() standby")).rows[0];
  if (observed.name !== "cop_erasure_owned_test" || observed.directory !== root + "/data" || observed.standby) throw Error("fixture_identity");
  await admin.query("CREATE DATABASE cop_account_safety_guard");
  await admin.query("CREATE DATABASE cop_erasure_test");
  // The runtime uses the same synthetic password through its dedicated role;
  // the actual journal tests grant only their reviewed target privileges.
  await admin.query("CREATE ROLE cop_safety_v2_test_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '" + password + "'");
  const dsn = database => "postgresql://cop_safety_test_admin:" + password + "@127.0.0.1:" + port + "/" + database;
  const env = { ...base, COP_SAFETY_V2_TEST_DATABASE_URL: dsn("cop_account_safety_guard"),
    COP_ERASURE_TEST_DATABASE_URL: dsn("cop_erasure_test") };
  phase = "controller_tests";
  const result = await run(process.execPath, [resolve("node_modules/vitest/vitest.mjs"), "run",
    "apps/cop-api/src/account-erasure-continuity-postgres.test.ts"], { env, timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
  process.stdout.write(result.stdout);
  // Source imports and tests must not have contacted the optional SIM fixture.
  if (env.COP_SIM_SAFETY_JOINT_FIXTURE) throw Error("fixture_external_scope");
} catch (error) {
  // Vitest's console report is useful but never print connection config or the
  // full child error object. Only emit its fixed-format summary on failure.
  const lines = String(error.stdout ?? "").split("\n").filter(line => /^\s*(?:Test Files|Tests|FAIL|❯|×)/u.test(line));
  process.stderr.write(JSON.stringify({ scope: "owned_local_pg_dataset_restore", phase, failed: true,
    code: typeof error.code === "string" && /^[A-Z0-9_]{1,32}$/u.test(error.code) ? error.code : "FIXTURE_STEP_FAILED",
    summary: lines }) + "\n");
  if (phase === "controller_tests") {
    const diagnostic = String(error.stderr ?? "").replaceAll(fixturePassword, "[redacted fixture credential]")
      .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gu, "[redacted fixture DSN]").slice(0, 6000);
    process.stderr.write(diagnostic);
  }
  process.exitCode = 1;
} finally {
  await admin?.end();
  if (attempted) {
    try {
      const pid = (await readFile(root + "/data/postmaster.pid", "utf8")).split("\n");
      if (pid[1] !== root + "/data") throw Error("fixture_stop_identity");
      await command("pg_ctl", ["-D", root + "/data", "-m", "immediate", "-w", "stop"]);
      started = false;
    } catch {
      if (started) {
        process.stderr.write('{"fixtureCleanupFailed":true}\n');
        process.exitCode = 1;
      }
    }
  }
  if (!started && root) await rm(root, { recursive: true, force: true });
  if (!started) process.stdout.write('{"ownedFixtureRemoved":true,"productionContacted":false}\n');
}
