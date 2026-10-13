import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { resolveCopSessionDatabaseUrl } from "./cop-session-database.js";

// Parser-only fixture, not a trust anchor or a TLS handshake acceptance test.
const fixtureDirectory = mkdtempSync(join(tmpdir(), "cop-pg-parser-"));
const caPath = join(fixtureDirectory, "public-ca.crt");
const publicCaFixture = "synthetic public CA parser fixture\n";
writeFileSync(caPath, publicCaFixture, { mode: 0o600 });
afterAll(() => { vi.unstubAllEnvs(); rmSync(fixtureDirectory, { recursive: true, force: true }); });

type EffectiveParameters = {
  host: string; port: number; database: string; isDomainSocket: boolean;
  ssl: false | { ca?: string; rejectUnauthorized?: boolean; checkServerIdentity?: unknown };
};

function effective(config: pg.ClientConfig): EffectiveParameters {
  // Inspect the installed pg constructor's parameters; never connect or query.
  return (new pg.Client(config) as unknown as { connectionParameters: EffectiveParameters }).connectionParameters;
}

describe("installed pg Unix IPC and remote lease TLS parsing", () => {
  it("rejects a malformed allowed query value before pg can reinterpret the Unix host as TCP", () => {
    const main = "postgresql://fixture:fixture@%2Frun%2Fvcode-cop-pgbouncer:6432/cop_fixture?sslmode=disable&application_name=%ZZ";
    const session = `postgresql://fixture:fixture@database.example.test:5432/cop_fixture?sslmode=verify-full&sslrootcert=${encodeURIComponent(caPath)}`;
    // This installed parser's repair changes the transport. The guard must
    // reject before any affected factory can construct a client from it.
    expect(effective({ connectionString: main, ssl: false }).isDomainSocket).toBe(false);
    expect(() => resolveCopSessionDatabaseUrl({ COP_DATABASE_POOL_MODE: "transaction", COP_DATABASE_URL: main, COP_LEASE_DATABASE_URL: session }, "COP_LEASE_DATABASE_URL")).toThrow();
    expect(effective({ connectionString: main.replace("%ZZ", "fixture%20name"), ssl: false }).isDomainSocket).toBe(true);
  });

  it("uses an explicit Unix directory/port/database and disables only IPC TLS", () => {
    vi.stubEnv("PGHOST", "wrong.example.test");
    vi.stubEnv("PGPORT", "5555");
    vi.stubEnv("PGDATABASE", "wrong_database");
    vi.stubEnv("PGSSLMODE", "require");
    const connectionString = "postgresql://fixture:fixture@%2Frun%2Fvcode-cop-pgbouncer:6432/cop_fixture?sslmode=disable";
    const parameters = effective({ connectionString, ssl: { rejectUnauthorized: true } });
    expect(parameters).toMatchObject({ host: "/run/vcode-cop-pgbouncer", port: 6432, database: "cop_fixture", isDomainSocket: true, ssl: false });
  });

  it("loads the explicit public CA and keeps hostname verification for the remote lease despite inherited SSL=false", () => {
    const main = "postgresql://fixture:fixture@%2Frun%2Fvcode-cop-pgbouncer:6432/cop_fixture?sslmode=disable";
    const session = `postgresql://fixture:fixture@database.example.test:5432/cop_fixture?sslmode=verify-full&sslrootcert=${encodeURIComponent(caPath)}`;
    const connectionString = resolveCopSessionDatabaseUrl({ COP_DATABASE_POOL_MODE: "transaction", COP_DATABASE_URL: main, COP_LEASE_DATABASE_URL: session }, "COP_LEASE_DATABASE_URL");
    const parameters = effective({ connectionString, ssl: false });
    expect(parameters).toMatchObject({ host: "database.example.test", port: 5432, database: "cop_fixture", isDomainSocket: false, ssl: { ca: publicCaFixture } });
    expect(parameters.ssl).not.toBe(false);
    if (parameters.ssl === false) throw new Error("Expected TLS fixture configuration.");
    // Undefined retains Node TLS defaults: certificate and hostname verification.
    expect(parameters.ssl.rejectUnauthorized).toBeUndefined();
    expect(parameters.ssl.checkServerIdentity).toBeUndefined();
  });

  it("demonstrates URI SSL replacement rather than accidentally relying on PoolConfig options", () => {
    const parameters = effective({
      connectionString: `postgresql://fixture:fixture@database.example.test:5432/cop_fixture?sslmode=verify-full&sslrootcert=${encodeURIComponent(caPath)}`,
      ssl: { rejectUnauthorized: false, ca: "discarded inherited fixture" }
    });
    expect(parameters.ssl).toEqual({ ca: publicCaFixture });
  });
});
