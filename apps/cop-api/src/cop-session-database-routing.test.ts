import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mobilityStoreFromEnv } from "./mobility-store.js";
import { createSafetyNotificationStoreFromEnv } from "./safety-notification-store.js";
import { createCopStreamBusFromEnv } from "./cop-stream-bus.js";
import { createDriverMeasurementConsentStoreFromEnv } from "./driver-measurement-consent-store.js";

const pgState = vi.hoisted(() => ({ pools: [] as FakePool[], listeners: [] as FakeClient[] }));

class FakeClient extends EventEmitter {
  query = vi.fn(async (sql: string) => ({ rows: sql.includes("AS acquired") ? [{ acquired: true }] : sql.includes("pg_backend_pid()") ? [{ owned: true }] : [] }));
  connect = vi.fn(async () => undefined);
  release = vi.fn();
  end = vi.fn(async () => undefined);
  constructor(readonly config: Record<string, unknown> = {}) { super(); }
}

class FakePool extends EventEmitter {
  readonly client = new FakeClient();
  readonly options: Record<string, unknown>;
  ended = false;
  ending = false;
  connect = vi.fn(async () => this.client);
  query = vi.fn(async () => ({ rows: [] }));
  end = vi.fn(async () => { this.ending = true; this.ended = true; });
  constructor(readonly config: Record<string, unknown>) { super(); this.options = config; }
}

vi.mock("pg", () => ({ default: {
  Pool: class {
    constructor(config: Record<string, unknown>) { const pool = new FakePool(config); pgState.pools.push(pool); return pool; }
  },
  Client: class {
    constructor(config: Record<string, unknown>) { const client = new FakeClient(config); pgState.listeners.push(client); return client; }
  }
} }));

const transactionUrl = "postgresql://synthetic:business-password@broker.example.test:6432/cop";
const sessionUrl = "postgresql://synthetic:lease-password@database.example.test:5432/cop";
const unixUrl = "postgresql://synthetic:business-password@%2Frun%2Fvcode-cop-pgbouncer:6432/cop?sslmode=disable";
const verifiedSessionUrl = `${sessionUrl}?sslmode=verify-full&sslrootcert=%2Fetc%2Fvcode-cop-pgbouncer%2Fpostgres-ca.crt`;
const env = { COP_DATABASE_POOL_MODE: "transaction", COP_DATABASE_URL: transactionUrl, COP_LEASE_DATABASE_URL: sessionUrl, COP_SHARED_MOBILITY_ENABLED: "true", COP_DATABASE_SSL: "true" };

beforeEach(() => { pgState.pools.length = 0; pgState.listeners.length = 0; });
afterEach(async () => { await Promise.all(pgState.pools.filter((pool) => !pool.ended).map((pool) => pool.end())); });

describe("driver consent startup connection routing", () => {
  it.each([
    { ...env },
    { ...env, COP_DATABASE_URL: unixUrl, COP_LEASE_DATABASE_URL: verifiedSessionUrl, COP_DATABASE_SSL: "false" }
  ])("keeps the complete consent pool and all timeouts on the declared session route (%#)", async (settings) => {
    const store = createDriverMeasurementConsentStoreFromEnv(settings);
    expect(pgState.pools).toHaveLength(1);
    const pool = pgState.pools[0]!;
    expect(pool.config).toEqual({
      connectionString: settings.COP_LEASE_DATABASE_URL,
      max: 5, connectionTimeoutMillis: 5000, statement_timeout: 15000, query_timeout: 20000,
      application_name: "cop-api:driver-consent", fallback_application_name: "cop-api:driver-consent"
    });
    expect((await store.get("synthetic-subject")).grantedAt).toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pgState.pools.some((entry) => entry.config.connectionString === settings.COP_DATABASE_URL)).toBe(false);
    await store.close();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "direct", "session", " SESSION "])("preserves the exact original main DSN in mode %s even with a lease override", async (mode) => {
    const originalMain = " /synthetic/socket cop ";
    const store = createDriverMeasurementConsentStoreFromEnv({
      COP_DATABASE_POOL_MODE: mode, COP_DATABASE_URL: originalMain, COP_LEASE_DATABASE_URL: verifiedSessionUrl
    });
    expect(pgState.pools).toHaveLength(1);
    expect(pgState.pools[0]!.config.connectionString).toBe(originalMain);
    await store.close();
    expect(pgState.pools[0]!.end).toHaveBeenCalledTimes(1);
  });

  it.each([
    { COP_DATABASE_URL: undefined },
    { COP_DATABASE_URL: "" },
    { COP_DATABASE_URL: "   " },
    { ...env, COP_LEASE_DATABASE_URL: undefined },
    { ...env, COP_LEASE_DATABASE_URL: " " },
    { ...env, COP_LEASE_DATABASE_URL: "postgres://other:other-password@BROKER.example.test:6432/cop?sslmode=require" },
    { ...env, COP_LEASE_DATABASE_URL: "postgres://database.example.test/cop" },
    { ...env, COP_DATABASE_URL: unixUrl, COP_LEASE_DATABASE_URL: sessionUrl },
    { ...env, COP_DATABASE_URL: unixUrl, COP_LEASE_DATABASE_URL: verifiedSessionUrl.replace("verify-full", "verify-ca") },
    { ...env, COP_DATABASE_URL: unixUrl, COP_LEASE_DATABASE_URL: `${verifiedSessionUrl}&ssl=0` },
    { ...env, COP_DATABASE_URL: unixUrl, COP_LEASE_DATABASE_URL: `${verifiedSessionUrl}&sslrootcert=%2Fother-ca` },
    { ...env, COP_DATABASE_URL: `${unixUrl}&application_name=%ZZ`, COP_LEASE_DATABASE_URL: verifiedSessionUrl },
    { ...env, COP_DATABASE_POOL_MODE: "private-unknown-mode" }
  ])("rejects missing or invalid routes before constructing any pool (%#)", (settings) => {
    expect(() => createDriverMeasurementConsentStoreFromEnv(settings)).toThrow();
    expect(pgState.pools).toHaveLength(0);
    expect(pgState.listeners).toHaveLength(0);
  });

  it("propagates consent startup failure without creating an alternate main pool", async () => {
    const store = createDriverMeasurementConsentStoreFromEnv({
      ...env, COP_DATABASE_URL: unixUrl, COP_LEASE_DATABASE_URL: verifiedSessionUrl
    });
    const pool = pgState.pools[0]!;
    pool.query.mockRejectedValueOnce(new Error("synthetic direct consent outage"));
    await expect(store.init("synthetic-test-secret")).rejects.toThrow("synthetic direct consent outage");
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pgState.pools).toHaveLength(1);
    expect(pool.config.connectionString).toBe(verifiedSessionUrl);
    await store.close();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it("withholds malformed private DSN values from its fixed routing error", () => {
    let failure: unknown;
    try {
      createDriverMeasurementConsentStoreFromEnv({
        ...env, COP_LEASE_DATABASE_URL: "postgresql://synthetic:never-print-this@[invalid:5432/cop"
      });
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toMatch(/never-print-this|synthetic|invalid|postgresql:\/\//u);
    expect((failure as Error).cause).toBeUndefined();
    expect(pgState.pools).toHaveLength(0);
  });
});

describe("store and stream session connection ownership", () => {
  it("keeps Unix business pools and remote lease pools separate without changing the global SSL flag", async () => {
    const main = "postgresql://synthetic:business-password@%2Frun%2Fvcode-cop-pgbouncer:6432/cop?sslmode=disable";
    const session = `${sessionUrl}?sslmode=verify-full&sslrootcert=%2Fetc%2Fvcode-cop-pgbouncer%2Fpostgres-ca.crt`;
    const settings = { ...env, COP_DATABASE_URL: main, COP_LEASE_DATABASE_URL: session, COP_DATABASE_SSL: "false" };
    const mobility = mobilityStoreFromEnv(settings)!;
    const safety = createSafetyNotificationStoreFromEnv(settings);
    expect(pgState.pools.map((pool) => [pool.config.connectionString, pool.config.max, pool.config.ssl])).toEqual([
      [main, 3, false], [session, 1, false], [main, 3, false], [session, 1, false]
    ]);
    // Real pg URI parsing is checked separately; these inherited false values
    // must be overridden by verify-full/rootcert on the remote routes only.
    expect(createCopStreamBusFromEnv(settings).name).toBe("memory");
    expect(pgState.listeners).toHaveLength(0);
    await Promise.all([mobility.close(), safety.close()]);
    expect(pgState.pools.every((pool) => pool.end.mock.calls.length === 1)).toBe(true);
  });

  it("routes Dispatch ownership/PID verification to the explicit session pool and leaves business transactions on the main route", async () => {
    const store = mobilityStoreFromEnv(env)!;
    const [business, lease] = pgState.pools;
    expect(business!.config).toMatchObject({ connectionString: transactionUrl, max: 3, ssl: { rejectUnauthorized: true } });
    expect(lease!.config).toMatchObject({ connectionString: sessionUrl, max: 1, ssl: { rejectUnauthorized: true }, application_name: "cop-private-dispatch-lease", query_timeout: 3000, connectionTimeoutMillis: 5000 });
    await store.init();
    await store.claimDispatchInstance();
    expect(store.dispatchIsAvailable()).toBe(true);
    expect(lease!.client.query).toHaveBeenNthCalledWith(1, "SELECT CASE WHEN pg_is_in_recovery() THEN false ELSE pg_try_advisory_lock(731031,1) END AS acquired");
    expect(lease!.client.query).toHaveBeenNthCalledWith(2, "SELECT NOT pg_is_in_recovery() AND EXISTS (SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=731031 AND objid=1 AND pid=pg_backend_pid() AND granted) AS owned");
    await store.transact([], async () => "business-result");
    expect(business!.client.query).toHaveBeenCalledWith("BEGIN");
    expect(business!.client.query).toHaveBeenCalledWith("COMMIT");
    expect(business!.client.query.mock.calls.some(([sql]) => sql.includes("pg_try_advisory_lock"))).toBe(false);
    await store.close();
    expect(lease!.client.release).toHaveBeenCalledWith(true);
    expect(lease!.end).toHaveBeenCalledTimes(1);
    expect(business!.end).toHaveBeenCalledTimes(1);
  });

  it("holds and unlocks Safety's session lease on its own pool while ledger reads use the main route", async () => {
    const store = createSafetyNotificationStoreFromEnv(env);
    const [business, lease] = pgState.pools;
    expect(business!.config).toMatchObject({ connectionString: transactionUrl, max: 3, ssl: { rejectUnauthorized: true } });
    expect(lease!.config).toMatchObject({ connectionString: sessionUrl, max: 1, ssl: { rejectUnauthorized: true }, application_name: "cop-api:safety-notification-lease" });
    expect(await store.withWorkerLease(async (valid) => {
      expect(valid()).toBe(true);
      expect(await store.hasEligibleWebDevice("synthetic-user")).toBe(false);
      return "leased-operation";
    })).toBe("leased-operation");
    expect(lease!.client.query).toHaveBeenNthCalledWith(1, "SELECT pg_try_advisory_lock(18101202, 1) AS acquired");
    expect(lease!.client.query).toHaveBeenNthCalledWith(2, "SELECT pg_advisory_unlock(18101202, 1)");
    expect(business!.connect).not.toHaveBeenCalled();
    expect(business!.query).toHaveBeenCalledTimes(1);
    await store.close();
    expect(lease!.end).toHaveBeenCalledTimes(1);
    expect(business!.end).toHaveBeenCalledTimes(1);
  });

  it("does not borrow the transaction business pool when a lease connection fails", async () => {
    const store = createSafetyNotificationStoreFromEnv(env);
    pgState.pools[1]!.connect.mockRejectedValueOnce(new Error("synthetic lease outage"));
    const operation = vi.fn();
    await expect(store.withWorkerLease(operation)).rejects.toThrow("synthetic lease outage");
    expect(operation).not.toHaveBeenCalled();
    expect(pgState.pools[0]!.connect).not.toHaveBeenCalled();
    expect(pgState.pools[0]!.query).not.toHaveBeenCalled();
    await store.close();
  });

  it("preserves Safety lease invalidation and destroys a lost session without replaying its operation", async () => {
    const store = createSafetyNotificationStoreFromEnv(env);
    const lease = pgState.pools[1]!;
    const operation = vi.fn(async (valid: () => boolean) => {
      expect(valid()).toBe(true);
      lease.client.emit("error", new Error("synthetic lost lease"));
      expect(valid()).toBe(false);
    });
    await expect(store.withWorkerLease(operation)).rejects.toThrow("Safety worker lease connection was lost.");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(lease.client.query).toHaveBeenCalledTimes(1);
    expect(lease.client.release).toHaveBeenCalledWith(true);
    await store.close();
  });

  it("keeps the legacy pool paths and sharing when no new routing settings are supplied", async () => {
    const legacy = { COP_DATABASE_URL: "/synthetic/socket cop", COP_SHARED_MOBILITY_ENABLED: "true" };
    const mobility = mobilityStoreFromEnv(legacy)!;
    const safety = createSafetyNotificationStoreFromEnv(legacy);
    expect(pgState.pools).toHaveLength(3);
    expect(pgState.pools.every((pool) => pool.config.connectionString === legacy.COP_DATABASE_URL)).toBe(true);
    await safety.withWorkerLease(async () => "legacy");
    expect(pgState.pools[2]!.connect).toHaveBeenCalledTimes(1);
    await Promise.all([mobility.close(), safety.close()]);
    expect(pgState.pools.every((pool) => pool.end.mock.calls.length === 1)).toBe(true);
  });

  it("fails before creating pools when transaction leases are missing or alias the main endpoint", () => {
    for (const settings of [
      { ...env, COP_LEASE_DATABASE_URL: undefined },
      { ...env, COP_LEASE_DATABASE_URL: "postgres://other:other-password@BROKER.example.test:6432/cop?sslmode=require" },
      { ...env, COP_LEASE_DATABASE_URL: "postgres://database.example.test/cop" }
    ]) {
      expect(() => mobilityStoreFromEnv(settings)).toThrow();
      expect(() => createSafetyNotificationStoreFromEnv(settings)).toThrow();
    }
    expect(pgState.pools).toHaveLength(0);
  });

  it("requires a separately declared stream session route and gives LISTEN that route", async () => {
    expect(() => createCopStreamBusFromEnv({ ...env, COP_STREAM_BUS: "postgres" })).toThrow("COP_STREAM_BUS_DATABASE_URL is required");
    expect(() => createCopStreamBusFromEnv({ ...env, COP_STREAM_BUS: "postgres", COP_STREAM_BUS_DATABASE_URL: "postgres://other:password@broker.example.test:6432/cop?sslmode=require" })).toThrow("separate direct or session");
    expect(pgState.pools).toHaveLength(0);
    const bus = createCopStreamBusFromEnv({ ...env, COP_STREAM_BUS: "postgres", COP_STREAM_BUS_DATABASE_URL: sessionUrl });
    await bus.init();
    expect(pgState.pools[0]!.config).toMatchObject({ connectionString: sessionUrl, max: 2, ssl: { rejectUnauthorized: true } });
    expect(pgState.listeners[0]!.config).toMatchObject({ connectionString: sessionUrl, ssl: { rejectUnauthorized: true } });
    expect(pgState.listeners[0]!.query).toHaveBeenCalledWith('LISTEN "cop_stream_events"');
    await bus.close();
  });

  it("preserves memory stream operation and direct PostgreSQL fallback", async () => {
    expect(createCopStreamBusFromEnv(env).name).toBe("memory");
    expect(pgState.pools).toHaveLength(0);
    const bus = createCopStreamBusFromEnv({ COP_DATABASE_URL: sessionUrl, COP_STREAM_BUS: "postgres" });
    expect(pgState.pools[0]!.config.connectionString).toBe(sessionUrl);
    await bus.close();
  });
});
