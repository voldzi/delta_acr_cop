import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import type { AccountErasureContinuity } from "./account-erasure-continuity.js";
import { PostgresAccountErasureContinuity } from "./account-erasure-continuity-postgres.js";
import { readCopDatabasePoolMode, resolveCopSessionDatabaseUrl } from "./cop-session-database.js";

/** Host Root must independently bind this read-only tree and the public socket
 * bootstrap to the accepted immutable image. Container UID0 alone is insufficient.
 * No caller-selected module, key, socket or positive authority callback. */
export async function loadAccountErasureContinuity(): Promise<AccountErasureContinuity> {
  const mode = process.env.COP_ACCOUNT_SAFETY_AUTHORITY_MODE ?? "native_v1";
  if (mode === "database_v2") return databaseContinuity();
  if (mode !== "native_v1") throw new Error("ERASURE_CONTINUITY_MODE_UNSUPPORTED");
  const root = "/opt/cop-account-safety";
  let count = 0;
  const inspect = (path: string): void => {
    const s = lstatSync(path);
    if (s.uid !== 0 || (s.mode & 0o022) || !(s.isDirectory() || s.isFile() && s.nlink === 1)) throw new Error("ERASURE_CONTINUITY_INSTALLATION_UNAVAILABLE");
    if (s.isDirectory()) for (const name of readdirSync(path)) {
      if (++count > 20_000) throw new Error("ERASURE_CONTINUITY_INSTALLATION_UNAVAILABLE");
      inspect(path + "/" + name);
    }
  };
  for (const parent of ["/", "/opt"]) {
    const s = lstatSync(parent);
    if (!s.isDirectory() || s.uid !== 0 || (s.mode & 0o022)) throw new Error("ERASURE_CONTINUITY_INSTALLATION_UNAVAILABLE");
  }
  inspect(root);
  const moduleUrl = "file:///opt/cop-account-safety/cop-root-continuity.mjs";
  const module = await import(moduleUrl) as {
    createProductionAccountErasureContinuity?: () => AccountErasureContinuity;
  };
  if (typeof module.createProductionAccountErasureContinuity !== "function") throw new Error("ERASURE_CONTINUITY_INSTALLATION_UNAVAILABLE");
  return module.createProductionAccountErasureContinuity();
}

const caPath = "/etc/vcode-cop-pgbouncer/postgres-ca.crt";
/** Select the existing verified session route for readback when the business
 * route uses the protected Unix transaction pool. Never enable TLS on that
 * socket, change its transport, or downgrade either remote connection. */
export function databaseContinuityEndpoints(env: Record<string, string | undefined>): { guardUrl: string; targetUrl: string } {
  try {
    const business = new URL(env.COP_DATABASE_URL ?? "");
    const socket = decodeURIComponent(business.hostname).startsWith("/");
    if (socket && (readCopDatabasePoolMode(env) !== "transaction" ||
      decodeURIComponent(business.hostname) !== "/run/vcode-cop-pgbouncer" || business.port !== "6432")) throw new Error();
    const target = new URL(socket ? resolveCopSessionDatabaseUrl(env, "COP_STREAM_BUS_DATABASE_URL") ?? "" : business.href);
    const guard = new URL(env.COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL ?? "");
    if (target.pathname !== business.pathname || target.pathname === guard.pathname || guard.pathname !== "/cop_account_safety_guard") throw new Error();
    for (const url of [guard, target]) {
      if (/%(?![a-f0-9]{2})/iu.test(url.href)) throw new Error();
      decodeURIComponent(url.username); decodeURIComponent(url.password); decodeURI(url.pathname);
      if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "haproxy.home.cz" || url.port !== "5000" ||
        url.hash || url.searchParams.get("sslmode") !== "verify-full" || url.searchParams.get("sslrootcert") !== caPath ||
        [...url.searchParams.keys()].some(key => !["sslmode", "sslrootcert", "application_name"].includes(key)) ||
        new Set(url.searchParams.keys()).size !== [...url.searchParams.keys()].length) throw new Error();
      // pg's URI SSL fields can replace PoolConfig.ssl. Remove them only after
      // validating their exact verified meaning; supply the actual CA below.
      url.searchParams.delete("sslmode"); url.searchParams.delete("sslrootcert");
    }
    return { guardUrl: guard.href, targetUrl: target.href };
  } catch { throw new Error("ERASURE_CONTINUITY_DATABASE_CONFIGURATION"); }
}

function databaseContinuity(): AccountErasureContinuity {
  const { guardUrl, targetUrl } = databaseContinuityEndpoints(process.env);
  const secret = process.env.COP_ACCOUNT_ERASURE_SECRET;
  if (!secret || secret.length < 32) throw new Error("ERASURE_CONTINUITY_DATABASE_CONFIGURATION");
  let ca: string;
  try { ca = readFileSync(caPath, "utf8"); if (!ca.includes("-----BEGIN CERTIFICATE-----")) throw new Error(); }
  catch { throw new Error("ERASURE_CONTINUITY_DATABASE_CA_UNAVAILABLE"); }
  const config = { max: 2, connectionTimeoutMillis: 3000, query_timeout: 5000,
    ssl: { rejectUnauthorized: true, ca }, application_name: "cop-account-safety-v2" };
  const guard = new Pool({ ...config, connectionString: guardUrl });
  const target = new Pool({ ...config, connectionString: targetUrl });
  // No raw pg error event (which can carry connection details) reaches logging.
  guard.on("error", () => undefined); target.on("error", () => undefined);
  try {
    return new PostgresAccountErasureContinuity(guard, target, {
      guardStoreId: process.env.COP_ACCOUNT_SAFETY_GUARD_STORE_ID ?? "",
      applicationStoreId: process.env.COP_ACCOUNT_SAFETY_STORE_ID ?? "",
      incarnationId: process.env.COP_ACCOUNT_SAFETY_INCARNATION_ID ?? "",
      configurationFingerprint: createHash("sha256").update("cop-account-erasure-config-v1\0").update(secret!).digest("hex")
    });
  } catch { void guard.end(); void target.end(); throw new Error("ERASURE_CONTINUITY_DATABASE_CONFIGURATION"); }
}
