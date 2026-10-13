import { describe, expect, it } from "vitest";
import { readCopDatabasePoolMode, resolveCopSessionDatabaseUrl } from "./cop-session-database.js";

const transactionUrl = "postgresql://synthetic:business-password@broker.example.test:6432/cop";
const sessionUrl = "postgresql://synthetic:lease-password@database.example.test:5432/cop";
const keys = ["COP_LEASE_DATABASE_URL", "COP_STREAM_BUS_DATABASE_URL"] as const;

describe("explicit PostgreSQL session routing", () => {
  it("keeps legacy direct/session DSNs and the existing optional override", () => {
    expect(readCopDatabasePoolMode({})).toBe("direct");
    for (const mode of [undefined, "direct", "session", " SESSION "]) {
      for (const key of keys) {
        expect(resolveCopSessionDatabaseUrl({ COP_DATABASE_POOL_MODE: mode, COP_DATABASE_URL: "/synthetic/socket cop" }, key)).toBe("/synthetic/socket cop");
        expect(resolveCopSessionDatabaseUrl({ COP_DATABASE_POOL_MODE: mode, COP_DATABASE_URL: transactionUrl, [key]: ` ${sessionUrl} ` }, key)).toBe(sessionUrl);
      }
    }
  });

  it("rejects an unknown declared mode without quoting its value", () => {
    expect(() => readCopDatabasePoolMode({ COP_DATABASE_POOL_MODE: "private-value" })).toThrow("COP_DATABASE_POOL_MODE must be direct, session or transaction.");
  });

  it.each(keys)("requires explicit %s in transaction mode without fallback", (key) => {
    for (const value of [undefined, "", "   "]) {
      expect(() => resolveCopSessionDatabaseUrl({ COP_DATABASE_POOL_MODE: "transaction", COP_DATABASE_URL: transactionUrl, [key]: value }, key)).toThrow(`${key} is required`);
    }
    expect(resolveCopSessionDatabaseUrl({ COP_DATABASE_POOL_MODE: "transaction", COP_DATABASE_URL: transactionUrl, [key]: sessionUrl }, key)).toBe(sessionUrl);
  });

  it.each(keys)("rejects the same endpoint for %s despite password, user, TLS and scheme differences", (key) => {
    for (const value of [
      transactionUrl,
      "postgres://other:other-password@BROKER.example.test:6432/cop?sslmode=require",
      "postgresql://other:other-password@broker.example.test.:6432/%63op?ssl=false&application_name=another"
    ]) {
      expect(() => resolveCopSessionDatabaseUrl({ COP_DATABASE_POOL_MODE: "transaction", COP_DATABASE_URL: transactionUrl, [key]: value }, key)).toThrow(`${key} must use a separate direct or session database endpoint.`);
    }
  });

  it.each([
    "host=database.example.test port=5432 dbname=cop password=private-value",
    "socket:/synthetic/socket?db=cop",
    "postgresql:///cop",
    "postgresql://database.example.test/cop",
    "postgresql://database.example.test:5432/",
    "postgresql://database.example.test:5432/%ZZ",
    "postgresql://database.example.test:0/cop",
    "postgresql://database.example.test:5432/%00cop",
    `${sessionUrl}?host=broker.example.test`,
    `${sessionUrl}?%70ort=6432`,
    `${sessionUrl}?database=other`,
    `${sessionUrl}#private-fragment`,
    "https://database.example.test:5432/cop"
  ])("fails closed for an unassessable transaction URI", (value) => {
    for (const [main, session] of [[transactionUrl, value], [value, sessionUrl]]) {
      expect(() => resolveCopSessionDatabaseUrl({ COP_DATABASE_POOL_MODE: "transaction", COP_DATABASE_URL: main, COP_LEASE_DATABASE_URL: session }, "COP_LEASE_DATABASE_URL"))
        .toThrow("Transaction database routing requires explicit PostgreSQL URI hosts, ports and databases without endpoint overrides.");
    }
  });

  it("never exposes malformed credentials or parser input in a routing error", () => {
    const privateUrl = "postgresql://synthetic:never-print-this@[invalid:5432/cop";
    let failure: unknown;
    try {
      resolveCopSessionDatabaseUrl({ COP_DATABASE_POOL_MODE: "transaction", COP_DATABASE_URL: transactionUrl, COP_LEASE_DATABASE_URL: privateUrl }, "COP_LEASE_DATABASE_URL");
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toMatch(/never-print-this|synthetic|invalid|postgresql:\/\//u);
    expect((failure as Error).cause).toBeUndefined();
  });
});
