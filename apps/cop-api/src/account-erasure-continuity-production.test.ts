import { describe, expect, it } from "vitest";
import pg from "pg";
import { databaseContinuityEndpoints } from "./account-erasure-continuity-production.js";

const verified = "?sslmode=verify-full&sslrootcert=%2Fetc%2Fvcode-cop-pgbouncer%2Fpostgres-ca.crt";
const tcp = "postgresql://synthetic:synthetic-password@haproxy.home.cz:5000/cop" + verified;
const guard = tcp.replace("/cop?", "/cop_account_safety_guard?");
const unix = "postgresql://synthetic:synthetic-password@%2Frun%2Fvcode-cop-pgbouncer:6432/cop?sslmode=disable";
const env = { COP_DATABASE_URL: unix, COP_DATABASE_POOL_MODE: "transaction", COP_STREAM_BUS_DATABASE_URL: tcp,
  COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL: guard };

describe("production database continuity transport", () => {
  it("reads the same actual COP database through the existing verified session route, preserving Unix business routing", () => {
    const before = structuredClone(env), endpoints = databaseContinuityEndpoints(env);
    expect(env).toEqual(before);
    expect(new URL(endpoints.targetUrl).hostname).toBe("haproxy.home.cz");
    expect(new URL(endpoints.targetUrl).pathname).toBe("/cop");
    expect(new URL(endpoints.guardUrl).pathname).toBe("/cop_account_safety_guard");
    const ca = "synthetic-ca-loaded-from-fixed-file";
    for (const connectionString of Object.values(endpoints)) {
      const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: true, ca } });
      expect((client as unknown as { connectionParameters: { ssl: unknown } }).connectionParameters.ssl)
        .toEqual({ rejectUnauthorized: true, ca });
    }
  });
  it("also requires verified transport for a direct TCP business route", () => {
    expect(databaseContinuityEndpoints({ ...env, COP_DATABASE_URL: tcp, COP_DATABASE_POOL_MODE: "direct" }).targetUrl)
      .toBe("postgresql://synthetic:synthetic-password@haproxy.home.cz:5000/cop");
  });
  it.each([
    { COP_STREAM_BUS_DATABASE_URL: "" }, { COP_STREAM_BUS_DATABASE_URL: unix },
    { COP_DATABASE_POOL_MODE: "direct" }, { COP_DATABASE_URL: unix.replace("pgbouncer", "foreign") },
    { COP_STREAM_BUS_DATABASE_URL: tcp.replace("/cop?", "/foreign?") },
    { COP_STREAM_BUS_DATABASE_URL: tcp.replace("verify-full", "require") },
    { COP_STREAM_BUS_DATABASE_URL: tcp.replace("verify-full", "disable") },
    { COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL: guard.replace("verify-full", "no-verify") },
    { COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL: guard + "&sslmode=disable" },
    { COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL: guard + "&host=foreign" },
    { COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL: guard.replace("postgres-ca.crt", "foreign.crt") },
    { COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL: guard.replace("haproxy.home.cz", "foreign.test") },
    { COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL: guard.replace("synthetic-password", "%ZZ") }
  ])("rejects missing, foreign or downgraded routes without leaking credentials: %j", change => {
    let error: unknown;
    try { databaseContinuityEndpoints({ ...env, ...change }); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("ERASURE_CONTINUITY_DATABASE_CONFIGURATION");
    expect((error as Error).message).not.toContain("synthetic-password");
  });
});
