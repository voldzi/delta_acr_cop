import { lstatSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import type { AccountErasureContinuity } from "./account-erasure-continuity.js";
import { PostgresAccountErasureContinuity } from "./account-erasure-continuity-postgres.js";

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

function databaseContinuity(): AccountErasureContinuity {
  const guardUrl = process.env.COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL;
  const targetUrl = process.env.COP_DATABASE_URL;
  const secret = process.env.COP_ACCOUNT_ERASURE_SECRET;
  try {
    const guard = new URL(guardUrl ?? ""), target = new URL(targetUrl ?? "");
    if (![guard.protocol, target.protocol].every(v => v === "postgres:" || v === "postgresql:") ||
      guard.pathname !== "/cop_account_safety_guard" || target.pathname === guard.pathname ||
      [...guard.searchParams.keys(), ...target.searchParams.keys()].some(key => key.toLowerCase().startsWith("ssl")) ||
      !secret || secret.length < 32) throw new Error();
  } catch { throw new Error("ERASURE_CONTINUITY_DATABASE_CONFIGURATION"); }
  const config = { max: 2, connectionTimeoutMillis: 3000, query_timeout: 5000,
    ssl: { rejectUnauthorized: true }, application_name: "cop-account-safety-v2" };
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
