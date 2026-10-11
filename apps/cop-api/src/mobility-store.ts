import { Pool, type PoolConfig } from "pg";
import { DispatchLease, type DispatchLeaseHooks, type DispatchLeaseState } from "./dispatch-lease.js";

export interface MobilityStore {
  init(): Promise<void>;
  close(): Promise<void>;
  claimDispatchInstance(): Promise<void>;
  dispatchIsAvailable(): boolean;
  dispatchGeneration(): number;
  dispatchState(): DispatchLeaseState;
  startDispatchRecovery(hooks: DispatchLeaseHooks): Promise<void>;
  transact<T>(keys: string[], run: (transaction: MobilityTransaction) => Promise<T>): Promise<T>;
}
export interface MobilityTransaction {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  scan<T>(prefix: string): Promise<Array<{ key: string; value: T }>>;
}

/** Test-only store. Production must fail closed without PostgreSQL. */
export class MemoryMobilityStore implements MobilityStore {
  private values = new Map<string, unknown>();
  private queue: Promise<unknown> = Promise.resolve();
  async init(): Promise<void> {}
  async close(): Promise<void> {}
  async claimDispatchInstance(): Promise<void> {}
  dispatchIsAvailable(): boolean { return true; }
  dispatchGeneration(): number { return 0; }
  dispatchState(): DispatchLeaseState { return this.dispatchIsAvailable() ? "ready" : "unavailable"; }
  async startDispatchRecovery(hooks: DispatchLeaseHooks): Promise<void> { await hooks.acquired(); }
  async transact<T>(_keys: string[], run: (transaction: MobilityTransaction) => Promise<T>): Promise<T> {
    const task = this.queue.then(async () => {
      const draft = new Map([...this.values].map(([key, value]) => [key, structuredClone(value)]));
      const result = await run({
        get: async <V>(key: string) => structuredClone(draft.get(key)) as V | undefined,
        set: async (key, value) => {
          draft.set(key, structuredClone(value));
        },
        remove: async (key) => {
          draft.delete(key);
        },
        scan: async <V>(prefix: string) =>
          [...draft]
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, value]) => ({ key, value: structuredClone(value) as V }))
      });
      this.values = draft;
      return result;
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
}

/** Advisory transaction locks serialize entity changes and account operation receipts.
 * Values contain domain metadata/records; never Dispatch point ciphertext or GPS.
 */
export class PostgresMobilityStore implements MobilityStore {
  private readonly pool: Pool;
  private readonly lease: DispatchLease;
  constructor(config: PoolConfig, timing: ConstructorParameters<typeof DispatchLease>[1] = {}) {
    this.pool = new Pool(config);
    // Pool errors are availability failures, never raw credential-bearing logs.
    this.pool.on("error", () => undefined);
    const leasePool = new Pool({ ...config, max: 1, application_name: "cop-private-dispatch-lease",
      keepAlive: true, keepAliveInitialDelayMillis: 10000, query_timeout: 3000, connectionTimeoutMillis: 5000 });
    leasePool.on("error", () => undefined);
    this.lease = new DispatchLease(leasePool, timing);
  }
  async init(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS cop_mobility_v1 (
      key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  }
  async claimDispatchInstance(): Promise<void> { await this.lease.claim(); }
  dispatchIsAvailable(): boolean { return this.lease.available(); }
  dispatchGeneration(): number { return this.lease.generation(); }
  dispatchState(): DispatchLeaseState { return this.lease.state(); }
  async startDispatchRecovery(hooks: DispatchLeaseHooks): Promise<void> { await this.lease.start(hooks); }
  async close(): Promise<void> { await this.lease.close(); await this.pool.end(); }
  async transact<T>(keys: string[], run: (transaction: MobilityTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 731031))", ["mobility-v1"]);
      for (const key of [...new Set(keys.filter(key => key !== "mobility-v1"))].sort()) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 731031))", [key]);
      }
      const result = await run({
        get: async <V>(key: string) =>
          (await client.query<{ value: V }>("SELECT value FROM cop_mobility_v1 WHERE key=$1", [key])).rows[0]?.value,
        set: async (key, value) => {
          await client.query(
            "INSERT INTO cop_mobility_v1(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()",
            [key, JSON.stringify(value)]
          );
        },
        remove: async (key) => {
          await client.query("DELETE FROM cop_mobility_v1 WHERE key=$1", [key]);
        },
        scan: async <V>(prefix: string) =>
          (
            await client.query<{ key: string; value: V }>(
              "SELECT key,value FROM cop_mobility_v1 WHERE left(key,length($1))=$1 ORDER BY key",
              [prefix]
            )
          ).rows
      });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export function mobilityStoreFromEnv(env = process.env): MobilityStore | undefined {
  if (env.COP_SHARED_MOBILITY_ENABLED !== "true") return undefined;
  const connectionString = env.COP_DATABASE_URL;
  if (!connectionString) throw new Error("Shared mobility requires the existing PostgreSQL connection.");
  const sslMode = env.COP_DATABASE_SSL?.trim().toLowerCase();
  if (sslMode && !["false", "0", "true", "1", "require"].includes(sslMode)) throw new Error("Unsupported PostgreSQL TLS configuration.");
  return new PostgresMobilityStore({
    connectionString,
    max: 3,
    connectionTimeoutMillis: 5000,
    ssl: ["true", "1", "require"].includes(sslMode ?? "") ? { rejectUnauthorized: true } : false
  });
}
