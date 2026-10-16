#!/usr/bin/env node
/** Explicit first administrator enrollment, not an upgrade, application startup
 * or restore approval. Any progressed jobs/fences/cursor are refused without
 * mutation; this bounded installer never re-enrolls or resets accepted history.
 * No production action runs on import. CLI has only the fixed production route;
 * the local test route is available solely through the imported provision API. */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fchownSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { hostname } from "node:os";
import { pathToFileURL } from "node:url";

const SOURCE_SQL = new URL("./010_database_safety_v2.sql", import.meta.url);
const SQL_SHA = "03247e41e3af241af1a29a3899473f0eff2ad480dab304c549f2fc484b7c2674";
const CA = "/etc/vcode-cop-pgbouncer/postgres-ca.crt";
const CA_SHA = "7a3f9d9373cd63361148230e6c2804c6fb76dc204e18d5039aad7c7838d7a14a";
const OWNER = "cop_safety_v2_owner",
  RUNTIME = "cop_safety_v2_runtime";
const ADMIN_LOGGING = Object.freeze({
  log_statement: "none",
  log_min_error_statement: "panic",
  log_min_duration_statement: "-1",
  log_min_duration_sample: "-1",
  log_statement_sample_rate: "0",
  log_transaction_sample_rate: "0",
  log_parameter_max_length: "0",
  log_parameter_max_length_on_error: "0",
  log_duration: "off",
  debug_print_parse: "off",
  debug_print_rewritten: "off",
  debug_print_plan: "off"
});
const ADMIN_STARTUP_OPTIONS = Object.entries(ADMIN_LOGGING)
  .map(([name, value]) => "-c " + name + "=" + value)
  .join(" ");
const SCHEMA = "cop_safety_v2",
  BUSINESS = "cop",
  GUARD = "cop_account_safety_guard";
const STORE = "account-safety:store-identity-v1",
  CONFIG = "account-erasure:configuration-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HEX = /^[0-9a-f]{64}$/u;
const ERROR_CODES = new Set([
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
export class ProvisionError extends Error {
  constructor(code) {
    super(code);
    this.code = ERROR_CODES.has(code) ? code : "DATABASE_STAGE_FAILED";
  }
}
function need(value, code) {
  if (!value) throw new ProvisionError(code);
}
const hash = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (v) =>
  Array.isArray(v)
    ? "[" + v.map(canonical).join(",") + "]"
    : v && typeof v === "object"
      ? "{" +
        Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
          .join(",") +
        "}"
      : JSON.stringify(v);
const same = (a, b) => canonical(a) === canonical(b);
const exact = (v, keys) =>
  v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join("\0") === [...keys].sort().join("\0");
function loadPg() {
  try {
    need(!process.env.NODE_PATH && !process.env.NODE_OPTIONS, "DEPENDENCY_PG_UNAVAILABLE");
    const packageUrl = new URL("../../apps/cop-api/package.json", import.meta.url);
    const declaration = JSON.parse(readFileSync(packageUrl, "utf8"));
    need(["^8.23.1", "8.23.1"].includes(declaration.dependencies?.pg), "DEPENDENCY_PG_UNAVAILABLE");
    const require = createRequire(packageUrl),
      metadata = require("pg/package.json"),
      { Pool } = require("pg");
    need(metadata.version === "8.23.1" && typeof Pool === "function", "DEPENDENCY_PG_UNAVAILABLE");
    return Pool;
  } catch {
    throw new ProvisionError("DEPENDENCY_PG_UNAVAILABLE");
  }
}
function privateFile(path, rootOwner = false) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const s = fstatSync(fd);
    need(
      s.isFile() && s.nlink === 1 && (s.mode & 0o777) === 0o600 && s.size <= 1024 * 1024 && (!rootOwner || s.uid === 0),
      "PRIVATE_FILE_INVALID"
    );
    const bytes = readFileSync(fd),
      after = fstatSync(fd);
    need(
      bytes.length === s.size &&
        after.size === s.size &&
        after.mtimeMs === s.mtimeMs &&
        after.ctimeMs === s.ctimeMs &&
        after.nlink === 1,
      "PRIVATE_FILE_INVALID"
    );
    return { bytes, stat: s };
  } catch (error) {
    if (error instanceof ProvisionError) throw error;
    throw new ProvisionError("PRIVATE_FILE_INVALID");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
function atomic(path, original, bytes) {
  need(readFileSync(path).equals(original.bytes), "ENV_CHANGED");
  const current = lstatSync(path);
  need(
    current.ino === original.stat.ino &&
      current.uid === original.stat.uid &&
      current.gid === original.stat.gid &&
      (current.mode & 0o777) === 0o600 &&
      current.nlink === 1,
    "ENV_CHANGED"
  );
  const temporary = path + ".database-v2-" + randomBytes(12).toString("hex");
  let fd;
  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    fchmodSync(fd, 0o600);
    if (process.getuid?.() === 0) fchownSync(fd, current.uid, current.gid);
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    need(readFileSync(path).equals(original.bytes), "ENV_CHANGED");
    renameSync(temporary, path);
    const directory = openSync(dirname(path), constants.O_RDONLY);
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
    try {
      unlinkSync(temporary);
    } catch {}
  }
}
export function parseEnvironment(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim() || /^\s*#/u.test(line)) continue;
    const found = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    need(found && !map.has(found[1]), "ENV_INVALID");
    let value = found[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    need(!/[\u0000\r\n]/u.test(value), "ENV_INVALID");
    map.set(found[1], value);
  }
  return map;
}
function appendFields(original, fields) {
  const text = original.bytes.toString("utf8"),
    env = parseEnvironment(text);
  let out = text;
  for (const [key, value] of Object.entries(fields)) {
    need(!/[\r\n\u0000]/u.test(value), "ENV_INVALID");
    if (env.has(key)) {
      need(env.get(key) === value, "IDENTITY_CONFLICT");
      continue;
    }
    if (out && !out.endsWith("\n")) out += "\n";
    out += key + "=" + value + "\n";
  }
  return Buffer.from(out);
}
export function validateManifest(v) {
  need(
    exact(v, [
      "contractVersion",
      "firstEnrollment",
      "allowGenerateErasureSecret",
      "applicationStoreId",
      "incarnationId",
      "guardStoreId",
      "restoreGeneration",
      "initialDigest",
      "identityEvidenceDigest",
      "identityBinding",
      "postgresCaSha256"
    ]),
    "MANIFEST_INVALID"
  );
  need(
    v.contractVersion === "cop-database-safety-provision-v1" &&
      v.firstEnrollment === true &&
      typeof v.allowGenerateErasureSecret === "boolean" &&
      v.restoreGeneration === 1 &&
      [v.applicationStoreId, v.incarnationId, v.guardStoreId].every((x) => typeof x === "string" && UUID.test(x)) &&
      [v.initialDigest, v.identityEvidenceDigest, v.postgresCaSha256].every(
        (x) => typeof x === "string" && HEX.test(x)
      ),
    "MANIFEST_INVALID"
  );
  const identity = v.identityBinding;
  need(
    exact(identity, ["contractVersion", "issuer", "routerKeyFingerprint", "evidenceDigest"]) &&
      identity.contractVersion === "cop-existing-router-identity-v1" &&
      [identity.routerKeyFingerprint, identity.evidenceDigest].every((x) => typeof x === "string" && HEX.test(x)) &&
      v.identityEvidenceDigest === identity.evidenceDigest,
    "MANIFEST_INVALID"
  );
  try {
    const url = new URL(identity.issuer);
    need(
      url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.href === identity.issuer,
      "MANIFEST_INVALID"
    );
  } catch {
    throw new ProvisionError("MANIFEST_INVALID");
  }
  return v;
}
function settings(options) {
  need(
    options && ["check", "apply"].includes(options.mode) && typeof options.manifestPath === "string",
    "INVALID_OPTIONS"
  );
  const synthetic = options.syntheticRoot !== undefined;
  let root;
  if (synthetic) {
    try {
      root = realpathSync(options.syntheticRoot);
    } catch {
      throw new ProvisionError("INVALID_OPTIONS");
    }
    need(
      root === options.syntheticRoot &&
        /^\/private\/tmp\/cop-guard-installer-[A-Za-z0-9_-]+$/u.test(root) &&
        realpathSync(dirname(options.manifestPath)) === root,
      "INVALID_OPTIONS"
    );
  } else {
    need(
      process.getuid?.() === 0 && process.geteuid?.() === 0 && ["docker", "docker.home.cz"].includes(hostname()),
      "ADMIN_REQUIRED"
    );
    root = "/srv/cop";
  }
  const admin = options.admin ?? {};
  need(
    typeof admin.password === "string" && admin.password.length > 0 && !/[\u0000\r\n]/u.test(admin.password),
    "INVALID_OPTIONS"
  );
  if (synthetic)
    need(
      admin.host === "127.0.0.1" &&
        Number.isInteger(admin.port) &&
        admin.port >= 1024 &&
        admin.port <= 65535 &&
        typeof admin.user === "string" &&
        /^[a-z_][a-z0-9_]*$/u.test(admin.user),
      "INVALID_OPTIONS"
    );
  else
    need(
      (admin.host === undefined || admin.host === "haproxy.home.cz") &&
        (admin.port === undefined || admin.port === 5000) &&
        (admin.user === undefined || admin.user === "postgres"),
      "INVALID_OPTIONS"
    );
  return {
    root,
    synthetic,
    envPath: synthetic ? join(root, "cop.env") : "/srv/cop/.env",
    manifestPath: options.manifestPath,
    admin: {
      host: synthetic ? admin.host : "haproxy.home.cz",
      port: synthetic ? admin.port : 5000,
      user: synthetic ? admin.user : "postgres",
      password: admin.password
    }
  };
}
function verifyIdentity(env, manifest) {
  need(
    env.get("COP_OIDC_ISSUER") === manifest.identityBinding.issuer &&
      (env.get("COP_SIM_ERASURE_ACTOR_SECRET") ?? "").length >= 32 &&
      (env.get("COP_AI_CHAT_ROUTER_USER_ID_SECRET") ?? "").length >= 32,
    "IDENTITY_CONFLICT"
  );
  need(
    hash("cop-router-identity-key-v1\0" + env.get("COP_AI_CHAT_ROUTER_USER_ID_SECRET")) ===
      manifest.identityBinding.routerKeyFingerprint,
    "IDENTITY_CONFLICT"
  );
  for (const key of ["COP_ACCOUNT_ERASURE_ENABLED", "COP_ACCOUNT_SAFETY_GUARD_REQUIRED"])
    need(!env.has(key) || env.get(key) === "false", "FLAGS_NOT_DISABLED");
  if (env.has("COP_ACCOUNT_ERASURE_SECRET"))
    need((env.get("COP_ACCOUNT_ERASURE_SECRET") ?? "").length >= 32, "ERASURE_SECRET_MISSING");
  else need(manifest.allowGenerateErasureSecret, "ERASURE_SECRET_MISSING");
}
function runtimeUrl(s, password) {
  const url = new URL("postgresql://" + s.admin.host + ":" + s.admin.port + "/" + GUARD);
  url.username = RUNTIME;
  url.password = password;
  url.searchParams.set("sslmode", s.synthetic ? "disable" : "verify-full");
  if (!s.synthetic) url.searchParams.set("sslrootcert", CA);
  return url.href;
}
function runtimePassword(s, env) {
  if (!env.has("COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL")) return undefined;
  try {
    const url = new URL(env.get("COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL"));
    need(
      url.protocol === "postgresql:" &&
        url.hostname === s.admin.host &&
        Number(url.port) === s.admin.port &&
        url.pathname === "/" + GUARD &&
        decodeURIComponent(url.username) === RUNTIME &&
        !url.hash &&
        [...url.searchParams.keys()].sort().join() === (s.synthetic ? "sslmode" : "sslmode,sslrootcert") &&
        url.searchParams.get("sslmode") === (s.synthetic ? "disable" : "verify-full") &&
        (s.synthetic || url.searchParams.get("sslrootcert") === CA),
      "IDENTITY_CONFLICT"
    );
    const password = decodeURIComponent(url.password);
    need(password.length >= 32 && !/[\r\n\u0000]/u.test(password), "IDENTITY_CONFLICT");
    return password;
  } catch {
    throw new ProvisionError("IDENTITY_CONFLICT");
  }
}
function scram(password) {
  const salt = randomBytes(16),
    salted = pbkdf2Sync(password, salt, 4096, 32, "sha256");
  const client = createHmac("sha256", salted).update("Client Key").digest(),
    server = createHmac("sha256", salted).update("Server Key").digest();
  return (
    "SCRAM-SHA-256$4096:" +
    salt.toString("base64") +
    "$" +
    createHash("sha256").update(client).digest("base64") +
    ":" +
    server.toString("base64")
  );
}
async function cluster(client, s, expectedDatabase) {
  const identity = (
    await client.query(
      "SELECT current_database() db,current_user usr,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) administrator"
    )
  ).rows[0];
  need(
    identity.db === expectedDatabase && identity.usr === s.admin.user && identity.administrator === true,
    "ADMIN_REQUIRED"
  );
  // No secret-bearing statement is issued until actual administrator identity
  // has been verified and statement/error SQL logging has been disabled.
  await client.query(
    Object.entries(ADMIN_LOGGING)
      .map(([name, value]) => "SET SESSION " + name + "='" + value + "'")
      .join("; ")
  );
  const logging = (
    await client.query("SELECT name,setting FROM pg_settings WHERE name=ANY($1::text[]) ORDER BY name", [
      Object.keys(ADMIN_LOGGING)
    ])
  ).rows;
  need(
    same(
      logging.map((x) => [x.name, x.setting]),
      Object.entries(ADMIN_LOGGING).sort(([a], [b]) => a.localeCompare(b))
    ),
    "POSTGRES_PREFLIGHT_FAILED"
  );
  // Core SQL/duration sampling controls do not govern extension hooks. There
  // is no approval in this first-enrollment manifest to alter such an auditor.
  // Refuse before credential/verifier SQL if an audit hook is installed,
  // preloaded, or exposes settings, even if its current "log" value says none.
  const audit = (
    await client.query(
      "SELECT EXISTS(SELECT FROM pg_extension WHERE extname ~* 'audit') extension, EXISTS(SELECT FROM pg_settings WHERE name ~* '(^|[._])audit([._]|$)|pgaudit') settings, current_setting('pgaudit.log',true) pgaudit_log, current_setting('shared_preload_libraries') shared_libraries, current_setting('session_preload_libraries') session_libraries, current_setting('local_preload_libraries') local_libraries"
    )
  ).rows[0];
  need(
    audit &&
      !audit.extension &&
      !audit.settings &&
      audit.pgaudit_log === null &&
      [audit.shared_libraries, audit.session_libraries, audit.local_libraries].every(
        (value) => typeof value === "string" && !/audit/iu.test(value)
      ),
    "POSTGRES_PREFLIGHT_FAILED"
  );
  const row = (
    await client.query(
      "SELECT current_setting('server_version_num')::integer version,current_setting('cluster_name') cluster,current_setting('data_directory') data"
    )
  ).rows[0];
  if (s.synthetic)
    need(
      row.version >= 180000 &&
        row.version < 190000 &&
        row.cluster === "cop_guard_installer_test" &&
        row.data === join(s.root, "pgdata"),
      "WRONG_CLUSTER"
    );
  else
    need(
      (await client.query("SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()")).rows[0]?.ssl === true,
      "POSTGRES_PREFLIGHT_FAILED"
    );
}
function expectedConfig(manifest, secret) {
  return {
    fingerprint: hash("cop-account-erasure-config-v1\0" + secret),
    issuerFingerprint: hash(manifest.identityBinding.issuer),
    version: 4,
    deletionScope: "cop_jizda_preserve_shared_identity_sim",
    storeId: manifest.applicationStoreId,
    accepted: false
  };
}
async function businessState(client, manifest, config) {
  const rows = (
    await client.query("SELECT key,value FROM public.cop_mobility_v1 WHERE key=ANY($1::text[])", [[STORE, CONFIG]])
  ).rows;
  // The SQL prefix is deliberately explicit; never reinterpret a v3 config.
  const jobs = (
    await client.query("SELECT count(*)::integer n FROM public.cop_mobility_v1 WHERE left(key,length($1))=$1", [
      "account-erasure:job:"
    ])
  ).rows[0].n;
  need(jobs === 0, "BUSINESS_STATE_CONFLICT");
  const store = rows.find((x) => x.key === STORE)?.value,
    local = rows.find((x) => x.key === CONFIG)?.value;
  if (store === undefined && local === undefined) return "empty";
  need(
    config &&
      same(store, { storeId: manifest.applicationStoreId, incarnationId: manifest.incarnationId }) &&
      same(local, config),
    "BUSINESS_STATE_CONFLICT"
  );
  return "same_enrollment";
}
async function roleState(client) {
  const roles = (
    await client.query(
      "SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil FROM pg_roles WHERE rolname=ANY($1::text[])",
      [[OWNER, RUNTIME]]
    )
  ).rows;
  for (const row of roles)
    need(
      !row.rolsuper &&
        !row.rolinherit &&
        !row.rolcreaterole &&
        !row.rolcreatedb &&
        !row.rolreplication &&
        !row.rolbypassrls &&
        row.rolcanlogin === (row.rolname === RUNTIME) &&
        row.rolconnlimit === (row.rolname === RUNTIME ? 8 : -1) &&
        row.rolvaliduntil === null,
      "ROLE_CONFLICT"
    );
  need(
    (
      await client.query(
        "SELECT count(*)::integer n FROM pg_auth_members WHERE roleid IN(SELECT oid FROM pg_roles WHERE rolname=ANY($1::text[])) OR member IN(SELECT oid FROM pg_roles WHERE rolname=ANY($1::text[]))",
        [[OWNER, RUNTIME]]
      )
    ).rows[0].n === 0,
    "ROLE_CONFLICT"
  );
  return roles;
}
const normalizeConstraint = (value) => value.replace(/::text\b/gu, "").replace(/[\s()]/gu, "");
async function schemaDefinition(client, namespaceOid, migration) {
  const columns = {
    configuration: [
      ["singleton", "boolean", true],
      ["contract_version", "text", true],
      ["guard_store_id", "uuid", true],
      ["application_store_id", "uuid", true],
      ["configuration_fingerprint", "text", true],
      ["initial_digest", "text", true],
      ["identity_binding", "jsonb", false]
    ],
    fences: [
      ["sequence", "bigint", true],
      ["account_key", "text", true],
      ["operation_id", "uuid", true],
      ["requested_at", "timestamp with time zone", true],
      ["entry", "jsonb", true],
      ["previous_digest", "text", true],
      ["digest", "text", true]
    ],
    dataset_replays: [
      ["owner", "text", true],
      ["store_id", "uuid", true],
      ["incarnation_id", "uuid", true],
      ["restore_generation", "bigint", true],
      ["replay_sequence", "bigint", true],
      ["replay_digest", "text", true],
      ["accepted_at", "timestamp with time zone", true]
    ]
  };
  const checks = {
    configuration: [
      "PRIMARY KEY(singleton)",
      "CHECK(singleton)",
      "CHECK(contract_version='cop-database-safety-v2')",
      "CHECK(configuration_fingerprint~'^[0-9a-f]{64}$')",
      "CHECK(initial_digest~'^[0-9a-f]{64}$')",
      "CHECK(identity_binding IS NULL OR jsonb_typeof(identity_binding)='object')"
    ],
    fences: [
      "PRIMARY KEY(sequence)",
      "UNIQUE(account_key)",
      "UNIQUE(operation_id)",
      "UNIQUE(digest)",
      "CHECK(sequence>0)",
      "CHECK(account_key~'^[0-9a-f]{64}$')",
      "CHECK(jsonb_typeof(entry)='object' AND octet_length(entry::text)<=16384)",
      "CHECK(previous_digest~'^[0-9a-f]{64}$')",
      "CHECK(digest~'^[0-9a-f]{64}$')"
    ],
    dataset_replays: [
      "PRIMARY KEY(owner)",
      "CHECK(owner='cop')",
      "CHECK(restore_generation>0)",
      "CHECK(replay_sequence>=0)",
      "CHECK(replay_digest~'^[0-9a-f]{64}$')"
    ]
  };
  for (const table of Object.keys(columns)) {
    const actual = (
      await client.query(
        "SELECT a.attname,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) default_expression FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum",
        [SCHEMA + "." + table]
      )
    ).rows;
    need(
      same(
        actual.map((x) => [x.attname, x.type, x.attnotnull]),
        columns[table]
      ) &&
        actual.every(
          (x) =>
            x.attidentity === "" &&
            x.attgenerated === "" &&
            x.default_expression ===
              (table === "dataset_replays" && x.attname === "accepted_at" ? "clock_timestamp()" : null)
        ),
      "GUARD_STATE_CONFLICT"
    );
    const constraints = (
      await client.query(
        "SELECT pg_get_constraintdef(oid,true) definition,convalidated,condeferrable,condeferred,conislocal FROM pg_constraint WHERE conrelid=$1::regclass AND contype<>'n' ORDER BY oid",
        [SCHEMA + "." + table]
      )
    ).rows;
    need(
      constraints.every((x) => x.convalidated && !x.condeferrable && !x.condeferred && x.conislocal) &&
        same(
          constraints.map((x) => normalizeConstraint(x.definition)).sort(),
          checks[table].map(normalizeConstraint).sort()
        ),
      "GUARD_STATE_CONFLICT"
    );
  }
  const functions = (
    await client.query(
      "SELECT p.proname,p.prosrc,p.prosecdef,p.pronargs,p.proconfig,l.lanname FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.pronamespace=$1 ORDER BY p.proname",
      [namespaceOid]
    )
  ).rows;
  need(functions.length === 2, "GUARD_STATE_CONFLICT");
  for (const name of ["immutable", "append_fence"]) {
    const body = new RegExp(
      "CREATE FUNCTION cop_safety_v2\\." +
        name +
        "\\(\\) RETURNS trigger LANGUAGE plpgsql AS \\$\\$([\\s\\S]*?)\\$\\$;",
      "u"
    ).exec(migration)?.[1];
    const actual = functions.find((x) => x.proname === name);
    need(
      body &&
        actual &&
        actual.prosrc === body &&
        actual.prosecdef === false &&
        actual.pronargs === 0 &&
        actual.proconfig === null &&
        actual.lanname === "plpgsql",
      "GUARD_STATE_CONFLICT"
    );
  }
  const triggers = (
    await client.query(
      "SELECT c.relname,t.tgname,t.tgtype,t.tgenabled,t.tgnargs,t.tgattr::text attributes,t.tgqual::text condition,t.tgconstraint, p.proname,p.pronamespace FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid WHERE c.relnamespace=$1 AND NOT t.tgisinternal ORDER BY c.relname,t.tgname",
      [namespaceOid]
    )
  ).rows;
  need(
    same(
      triggers.map((x) => [x.relname, x.tgname, x.tgtype, x.proname]),
      [
        ["configuration", "immutable_rows", 27, "immutable"],
        ["configuration", "immutable_truncate", 34, "immutable"],
        ["fences", "append_fence", 7, "append_fence"],
        ["fences", "immutable_rows", 27, "immutable"],
        ["fences", "immutable_truncate", 34, "immutable"]
      ]
    ) &&
      triggers.every(
        (x) =>
          x.tgenabled === "O" &&
          x.tgnargs === 0 &&
          x.attributes === "" &&
          x.condition === null &&
          x.tgconstraint === 0 &&
          x.pronamespace === namespaceOid
      ),
    "GUARD_STATE_CONFLICT"
  );
}
async function guardState(client, manifest, config, migration) {
  const namespace = (
    await client.query("SELECT n.oid,pg_get_userbyid(n.nspowner) owner FROM pg_namespace n WHERE n.nspname=$1", [
      SCHEMA
    ])
  ).rows[0];
  if (!namespace) return "absent";
  need(namespace.owner === OWNER, "GUARD_STATE_CONFLICT");
  const relations = (
    await client.query(
      "SELECT c.relname,c.relkind,pg_get_userbyid(c.relowner) owner FROM pg_class c WHERE c.relnamespace=$1 AND c.relkind NOT IN('i','t') ORDER BY c.relname",
      [namespace.oid]
    )
  ).rows;
  need(
    same(
      relations.map((x) => [x.relname, x.relkind, x.owner]),
      [
        ["configuration", "r", OWNER],
        ["dataset_replays", "r", OWNER],
        ["fences", "r", OWNER]
      ]
    ),
    "GUARD_STATE_CONFLICT"
  );
  const functions = (
    await client.query(
      "SELECT p.proname,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.pronargs FROM pg_proc p WHERE p.pronamespace=$1 ORDER BY p.proname",
      [namespace.oid]
    )
  ).rows;
  need(
    same(
      functions.map((x) => [x.proname, x.owner, x.prosecdef, x.pronargs]),
      [
        ["append_fence", OWNER, false, 0],
        ["immutable", OWNER, false, 0]
      ]
    ),
    "GUARD_STATE_CONFLICT"
  );
  await schemaDefinition(client, namespace.oid, migration);
  const configuration = (
    await client.query(
      "SELECT contract_version,guard_store_id,application_store_id,configuration_fingerprint,initial_digest,identity_binding FROM cop_safety_v2.configuration"
    )
  ).rows;
  need(
    config &&
      configuration.length === 1 &&
      same(configuration[0], {
        contract_version: "cop-database-safety-v2",
        guard_store_id: manifest.guardStoreId,
        application_store_id: manifest.applicationStoreId,
        configuration_fingerprint: config.fingerprint,
        initial_digest: manifest.initialDigest,
        identity_binding: manifest.identityBinding
      }),
    "GUARD_STATE_CONFLICT"
  );
  const replays = (
    await client.query(
      "SELECT owner,store_id,incarnation_id,restore_generation::text,replay_sequence::text,replay_digest FROM cop_safety_v2.dataset_replays"
    )
  ).rows;
  need(
    same(replays, [
      {
        owner: "cop",
        store_id: manifest.applicationStoreId,
        incarnation_id: manifest.incarnationId,
        restore_generation: "1",
        replay_sequence: "0",
        replay_digest: manifest.initialDigest
      }
    ]) && (await client.query("SELECT count(*)::integer n FROM cop_safety_v2.fences")).rows[0].n === 0,
    "GUARD_STATE_CONFLICT"
  );
  return "same_enrollment";
}
async function verifyPrivileges(client) {
  const role = (await client.query("SELECT oid FROM pg_roles WHERE rolname=$1", [RUNTIME])).rows[0]?.oid;
  const owner = (await client.query("SELECT oid FROM pg_roles WHERE rolname=$1", [OWNER])).rows[0]?.oid;
  need(role && owner, "PRIVILEGE_CONFLICT");
  for (const table of ["configuration", "fences", "dataset_replays"]) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      const actual = (
        await client.query("SELECT has_table_privilege($1,$2,$3) allowed", [RUNTIME, SCHEMA + "." + table, privilege])
      ).rows[0].allowed;
      need(actual === (privilege === "SELECT" || (table === "fences" && privilege === "INSERT")), "PRIVILEGE_CONFLICT");
    }
  }
  for (const column of [
    "owner",
    "store_id",
    "incarnation_id",
    "restore_generation",
    "replay_sequence",
    "replay_digest",
    "accepted_at"
  ]) {
    need(
      (
        await client.query("SELECT has_column_privilege($1,'cop_safety_v2.dataset_replays',$2,'UPDATE') allowed", [
          RUNTIME,
          column
        ])
      ).rows[0].allowed === ["replay_sequence", "replay_digest"].includes(column),
      "PRIVILEGE_CONFLICT"
    );
  }
  need(
    (
      await client.query(
        "SELECT has_schema_privilege($1,'cop_safety_v2','USAGE') u,has_schema_privilege($1,'cop_safety_v2','CREATE') c,has_function_privilege($1,'cop_safety_v2.append_fence()','EXECUTE') a,has_function_privilege($1,'cop_safety_v2.immutable()','EXECUTE') i",
        [RUNTIME]
      )
    ).rows.every((x) => x.u && !x.c && x.a && !x.i),
    "PRIVILEGE_CONFLICT"
  );
  const extra = (
    await client.query(
      "SELECT count(*)::integer n FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE a.grantee=$1 AND c.relnamespace<>(SELECT oid FROM pg_namespace WHERE nspname=$2)",
      [role, SCHEMA]
    )
  ).rows[0].n;
  need(extra === 0, "PRIVILEGE_CONFLICT");
  for (const sql of [
    "SELECT count(*)::integer n FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE a.grantee=$1 AND n.nspname<>$2",
    "SELECT count(*)::integer n FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE a.grantee=$1 AND p.pronamespace<>(SELECT oid FROM pg_namespace WHERE nspname=$2)"
  ])
    need((await client.query(sql, [role, SCHEMA])).rows[0].n === 0, "PRIVILEGE_CONFLICT");
  // Membership checks alone do not cover PostgreSQL's implicit PUBLIC role.
  // Inspect effective access, including column-only grants, without revoking
  // existing PUBLIC privileges from these independently owned applications.
  need(
    (
      await client.query(
        "SELECT count(*)::integer n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname<>$2 AND n.nspname NOT IN('pg_catalog','information_schema') AND n.nspname !~ '^pg_(toast|temp)' AND ((c.relkind IN('r','p','v','m','f') AND (has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege($1,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) OR (c.relkind='S' AND has_sequence_privilege($1,c.oid,'USAGE,SELECT,UPDATE')))",
        [RUNTIME, SCHEMA]
      )
    ).rows[0].n === 0,
    "PRIVILEGE_CONFLICT"
  );
  need(
    (
      await client.query(
        "SELECT count(*)::integer n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname<>$2 AND n.nspname NOT IN('pg_catalog','information_schema') AND n.nspname !~ '^pg_(toast|temp)' AND p.prosecdef AND has_schema_privilege($1,n.oid,'USAGE') AND has_function_privilege($1,p.oid,'EXECUTE')",
        [RUNTIME, SCHEMA]
      )
    ).rows[0].n === 0,
    "PRIVILEGE_CONFLICT"
  );
  need(
    (await client.query("SELECT count(*)::integer n FROM pg_class WHERE relowner=$1", [role])).rows[0].n === 0 &&
      (await client.query("SELECT count(*)::integer n FROM pg_namespace WHERE nspowner=$1", [role])).rows[0].n === 0 &&
      (await client.query("SELECT count(*)::integer n FROM pg_proc WHERE proowner=$1", [role])).rows[0].n === 0,
    "ROLE_CONFLICT"
  );
  need(
    (await client.query("SELECT count(*)::integer n FROM pg_database WHERE datdba=ANY($1::oid[])", [[role, owner]]))
      .rows[0].n === 0,
    "ROLE_CONFLICT"
  );
  need(
    (
      await client.query("SELECT count(*)::integer n FROM pg_namespace WHERE nspowner=$1 AND nspname<>$2", [
        owner,
        SCHEMA
      ])
    ).rows[0].n === 0 &&
      (
        await client.query(
          "SELECT count(*)::integer n FROM pg_class WHERE relowner=$1 AND relkind NOT IN('i','t') AND relnamespace<>(SELECT oid FROM pg_namespace WHERE nspname=$2)",
          [owner, SCHEMA]
        )
      ).rows[0].n === 0 &&
      (
        await client.query(
          "SELECT count(*)::integer n FROM pg_proc WHERE proowner=$1 AND pronamespace<>(SELECT oid FROM pg_namespace WHERE nspname=$2)",
          [owner, SCHEMA]
        )
      ).rows[0].n === 0,
    "ROLE_CONFLICT"
  );
}
async function createGuard(client, migration, manifest, config, password) {
  // The raw password never occurs in any SQL text or output. The SCRAM verifier
  // is passed only in this protected administrator process and is never logged.
  const verifier = scram(password);
  need(/^[A-Za-z0-9+/$:=.-]+$/u.test(verifier), "DATABASE_STAGE_FAILED");
  await client.query(
    "CREATE ROLE cop_safety_v2_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"
  );
  await client.query(
    "CREATE ROLE cop_safety_v2_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 8 PASSWORD '" +
      verifier +
      "'"
  );
  await client.query(migration);
  await client.query(
    "ALTER SCHEMA cop_safety_v2 OWNER TO cop_safety_v2_owner; ALTER TABLE cop_safety_v2.configuration OWNER TO cop_safety_v2_owner; ALTER TABLE cop_safety_v2.fences OWNER TO cop_safety_v2_owner; ALTER TABLE cop_safety_v2.dataset_replays OWNER TO cop_safety_v2_owner; ALTER FUNCTION cop_safety_v2.immutable() OWNER TO cop_safety_v2_owner; ALTER FUNCTION cop_safety_v2.append_fence() OWNER TO cop_safety_v2_owner"
  );
  await client.query(
    "INSERT INTO cop_safety_v2.configuration(singleton,contract_version,guard_store_id,application_store_id,configuration_fingerprint,initial_digest,identity_binding) VALUES(true,'cop-database-safety-v2',$1,$2,$3,$4,$5)",
    [
      manifest.guardStoreId,
      manifest.applicationStoreId,
      config.fingerprint,
      manifest.initialDigest,
      manifest.identityBinding
    ]
  );
  await client.query(
    "INSERT INTO cop_safety_v2.dataset_replays(owner,store_id,incarnation_id,restore_generation,replay_sequence,replay_digest) VALUES('cop',$1,$2,1,0,$3)",
    [manifest.applicationStoreId, manifest.incarnationId, manifest.initialDigest]
  );
  await client.query(
    "GRANT CONNECT ON DATABASE cop_account_safety_guard TO cop_safety_v2_runtime; GRANT USAGE ON SCHEMA cop_safety_v2 TO cop_safety_v2_runtime; GRANT SELECT ON cop_safety_v2.configuration,cop_safety_v2.fences,cop_safety_v2.dataset_replays TO cop_safety_v2_runtime; GRANT INSERT ON cop_safety_v2.fences TO cop_safety_v2_runtime; GRANT UPDATE(replay_sequence,replay_digest) ON cop_safety_v2.dataset_replays TO cop_safety_v2_runtime; GRANT EXECUTE ON FUNCTION cop_safety_v2.append_fence() TO cop_safety_v2_runtime"
  );
}

/** Imported API for the owned local PG18 fixture; syntheticRoot is not a CLI flag.
 * This performs no restore re-enrollment, job deletion or production activation. */
async function provisionInternal(options) {
  const Pool = loadPg(); // Dependency presence is checked before reading secrets or mutation.
  const s = settings(options),
    file = privateFile(s.envPath),
    manifestFile = privateFile(s.manifestPath, !s.synthetic);
  let manifest;
  try {
    manifest = validateManifest(JSON.parse(manifestFile.bytes.toString("utf8")));
  } catch (e) {
    if (e instanceof ProvisionError) throw e;
    throw new ProvisionError("MANIFEST_INVALID");
  }
  const env = parseEnvironment(file.bytes.toString("utf8"));
  verifyIdentity(env, manifest);
  let migrationBytes;
  try {
    migrationBytes = readFileSync(SOURCE_SQL);
  } catch {
    throw new ProvisionError("SOURCE_MISMATCH");
  }
  need(hash(migrationBytes) === SQL_SHA, "SOURCE_MISMATCH");
  const migration = migrationBytes
    .toString("utf8")
    .replace(/^BEGIN;\s*$/mu, "")
    .replace(/^COMMIT;\s*$/mu, "");
  let ssl = false;
  if (!s.synthetic) {
    let cert;
    try {
      cert = readFileSync(CA);
    } catch {
      throw new ProvisionError("SOURCE_MISMATCH");
    }
    need(hash(cert) === CA_SHA && manifest.postgresCaSha256 === CA_SHA, "SOURCE_MISMATCH");
    ssl = { ca: cert.toString("utf8"), rejectUnauthorized: true, servername: "haproxy.home.cz" };
    let business;
    try {
      business = new URL(env.get("COP_DATABASE_URL") ?? "");
    } catch {
      throw new ProvisionError("ENV_INVALID");
    }
    need(business.pathname === "/cop" && ["postgres:", "postgresql:"].includes(business.protocol), "ENV_INVALID");
  }
  const connect = (database, user = s.admin.user, password = s.admin.password) => {
    const pool = new Pool({
      host: s.admin.host,
      port: s.admin.port,
      database,
      user,
      password,
      ssl,
      options: !s.synthetic && user === s.admin.user ? ADMIN_STARTUP_OPTIONS : "",
      max: 1,
      connectionTimeoutMillis: 4000,
      query_timeout: 35000,
      application_name: "cop-database-v2-provision"
    });
    pool.on("error", () => undefined);
    return pool;
  };
  const businessPool = connect(BUSINESS),
    guardPool = connect(GUARD);
  let business,
    guard,
    businessTx = false,
    guardTx = false,
    phase = "preflight";
  try {
    try {
      business = await businessPool.connect();
      guard = await guardPool.connect();
      await cluster(business, s, BUSINESS);
      await cluster(guard, s, GUARD);
    } catch (error) {
      if (error instanceof ProvisionError) throw error;
      throw new ProvisionError("POSTGRES_PREFLIGHT_FAILED");
    }
    const originalSecret = env.get("COP_ACCOUNT_ERASURE_SECRET"),
      configBefore = originalSecret ? expectedConfig(manifest, originalSecret) : undefined;
    const beforeBusiness = await businessState(business, manifest, configBefore),
      beforeGuard = await guardState(guard, manifest, configBefore, migration),
      roles = await roleState(guard);
    need(beforeGuard !== "absent" || roles.length === 0, "ROLE_CONFLICT");
    need(beforeGuard === "absent" || roles.length === 2, "ROLE_CONFLICT");
    need(beforeBusiness !== "same_enrollment" || beforeGuard === "same_enrollment", "GUARD_STATE_CONFLICT");
    if (beforeGuard === "same_enrollment") await verifyPrivileges(guard);
    const existingPassword = runtimePassword(s, env);
    need(beforeGuard === "absent" || existingPassword, "RUNTIME_CREDENTIALS_REJECTED");
    if (beforeGuard === "same_enrollment") {
      const runtime = connect(GUARD, RUNTIME, existingPassword);
      try {
        need(
          (await runtime.query("SELECT current_user u FROM cop_safety_v2.configuration WHERE singleton")).rows[0]?.u ===
            RUNTIME,
          "RUNTIME_CREDENTIALS_REJECTED"
        );
      } catch {
        throw new ProvisionError("RUNTIME_CREDENTIALS_REJECTED");
      } finally {
        await runtime.end();
      }
    }
    if (options.mode === "check")
      return {
        phase: "preflight_checked",
        sourceSqlSha256: SQL_SHA,
        dependency: "cop-api-pg",
        businessState: beforeBusiness,
        guardState: beforeGuard,
        firstEnrollment: true,
        secretPresent: !!originalSecret,
        needsSecretGeneration: !originalSecret,
        erasureEnabled: false,
        wholeAccountComplete: false
      };
    phase = "locked_enrollment";
    await business.query("BEGIN");
    businessTx = true;
    await business.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'");
    await business.query("SELECT pg_advisory_xact_lock(hashtextextended($1,731031))", ["mobility-v1"]);
    await business.query("LOCK TABLE public.cop_mobility_v1 IN SHARE ROW EXCLUSIVE MODE");
    need((await businessState(business, manifest, configBefore)) === beforeBusiness, "BUSINESS_STATE_CONFLICT");
    await guard.query("BEGIN");
    guardTx = true;
    await guard.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'");
    await guard.query("SELECT pg_advisory_xact_lock(1932540802,2)");
    need(
      (await guardState(guard, manifest, configBefore, migration)) === beforeGuard &&
        (await roleState(guard)).length === roles.length,
      "GUARD_STATE_CONFLICT"
    );
    const secret = originalSecret ?? randomBytes(48).toString("base64url"),
      password = existingPassword ?? randomBytes(48).toString("base64url"),
      config = expectedConfig(manifest, secret);
    const fields = {
      COP_ACCOUNT_ERASURE_SECRET: secret,
      COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL:
        env.get("COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL") ?? runtimeUrl(s, password),
      COP_ACCOUNT_SAFETY_GUARD_STORE_ID: manifest.guardStoreId,
      COP_ACCOUNT_SAFETY_INCARNATION_ID: manifest.incarnationId,
      COP_ACCOUNT_SAFETY_STORE_ID: manifest.applicationStoreId
    };
    const proposed = appendFields(file, fields);
    // Persist new credentials before the independent transaction can commit. A
    // later interrupted retry reuses these exact bytes; no password is rotated.
    if (!proposed.equals(file.bytes)) atomic(s.envPath, file, proposed);
    if (beforeGuard === "absent") await createGuard(guard, migration, manifest, config, password);
    need((await guardState(guard, manifest, config, migration)) === "same_enrollment", "GUARD_STATE_CONFLICT");
    await roleState(guard);
    await verifyPrivileges(guard);
    need(privateFile(s.envPath).bytes.equals(proposed), "ENV_CHANGED");
    await guard.query("COMMIT");
    guardTx = false;
    // Keep the real table/advisory locks held after the independent COMMIT and
    // through both business writes. A cross-database crash is exact-retry only.
    if (beforeBusiness === "empty") {
      await business.query("INSERT INTO public.cop_mobility_v1(key,value) VALUES($1,$2),($3,$4)", [
        STORE,
        { storeId: manifest.applicationStoreId, incarnationId: manifest.incarnationId },
        CONFIG,
        config
      ]);
    }
    need((await businessState(business, manifest, config)) === "same_enrollment", "BUSINESS_STATE_CONFLICT");
    await business.query("COMMIT");
    businessTx = false;
    phase = "runtime_verification";
    const runtime = connect(GUARD, RUNTIME, password);
    try {
      const check = await runtime.query(
        "SELECT current_user u,contract_version FROM cop_safety_v2.configuration WHERE singleton"
      );
      need(
        check.rows.length === 1 &&
          check.rows[0].u === RUNTIME &&
          check.rows[0].contract_version === "cop-database-safety-v2",
        "RUNTIME_CREDENTIALS_REJECTED"
      );
    } catch {
      throw new ProvisionError("RUNTIME_CREDENTIALS_REJECTED");
    } finally {
      await runtime.end();
    }
    return {
      phase: "complete_disabled",
      sourceSqlSha256: SQL_SHA,
      dependency: "cop-api-pg",
      businessStoreVerified: true,
      identityBindingVerified: true,
      runtimePermissionsVerified: true,
      runtimeCredentialsVerified: true,
      firstEnrollment: beforeGuard === "absent",
      credentialsReused: !!existingPassword,
      actorPreserved: true,
      routerUserIdSecretPreserved: true,
      erasureEnabled: false,
      guardRequiredChanged: false,
      runtimeAuthorityModeChanged: false,
      wholeAccountComplete: false
    };
  } catch (error) {
    if (guardTx) await guard?.query("ROLLBACK").catch(() => undefined);
    if (businessTx) await business?.query("ROLLBACK").catch(() => undefined);
    if (error instanceof ProvisionError) throw error;
    throw new ProvisionError(phase === "preflight" ? "POSTGRES_PREFLIGHT_FAILED" : "DATABASE_STAGE_FAILED");
  } finally {
    business?.release();
    guard?.release();
    await Promise.all([businessPool.end(), guardPool.end()]);
  }
}

export async function provision(options) {
  try {
    return await provisionInternal(options);
  } catch (error) {
    if (error instanceof ProvisionError) throw error;
    throw new ProvisionError("DATABASE_STAGE_FAILED");
  }
}

async function main() {
  let code = "INVALID_OPTIONS";
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--dependency-check") {
      loadPg();
      process.stdout.write(
        JSON.stringify({
          phase: "dependency_checked",
          dependency: "cop-api-pg",
          version: "8.23.1",
          databaseContacted: false,
          configurationRead: false,
          wholeAccountComplete: false
        }) + "\n"
      );
      return;
    }
    need(
      args.length === 3 &&
        ["--check", "--apply"].includes(args[0]) &&
        args[1] === "--manifest" &&
        args[2].startsWith("/"),
      "INVALID_OPTIONS"
    );
    const password = process.env.PGPASSWORD;
    delete process.env.PGPASSWORD;
    const result = await provision({
      mode: args[0].slice(2),
      manifestPath: args[2],
      admin: { password, user: "postgres" }
    });
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  } catch (error) {
    if (error instanceof ProvisionError) code = error.code;
  }
  process.stdout.write(
    JSON.stringify({ phase: "failed", code, erasureEnabled: false, wholeAccountComplete: false }) + "\n"
  );
  process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
