import pg, { type Pool as PgPool, type PoolConfig } from "pg";

export type CopPgComponent =
  | "incident"
  | "community-report"
  | "stream"
  | "mobility"
  | "dispatch-lease"
  | "mobile-device"
  | "user-profile"
  | "track-history"
  | "safety-notification"
  | "safety-notification-lease"
  | "federation-runtime"
  | "web-session"
  | "sketch"
  | "openai-mcp"
  | "voice-call"
  | "driver-consent"
  | "account-safety-guard"
  | "account-safety-target"
  | "media-settlement-guard"
  | "media-settlement-target";

interface PoolRecord {
  component: CopPgComponent;
  pool: WeakRef<PgPool>;
  errorCount: number;
  lastErrorAt?: string;
  lastErrorCode?: string;
}

const records = new Set<PoolRecord>();
const maximumRecords = 64;
let untrackedPools = 0;
let errorSink: ((metadata: Record<string, unknown>) => void) | undefined;

/** Only fixed technical codes; never retain error messages, SQL, DSNs or rows. */
export function copPgErrorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  const allowed = new Set([
    "53300",
    "57P01",
    "57P02",
    "57P03",
    "08000",
    "08001",
    "08003",
    "08004",
    "08006",
    "08P01",
    "28P01",
    "42501",
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN"
  ]);
  return typeof code === "string" && allowed.has(code) ? code : "PG_DATABASE_ERROR";
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function currentRecords(): Array<{ record: PoolRecord; pool: PgPool }> {
  const current: Array<{ record: PoolRecord; pool: PgPool }> = [];
  for (const record of records) {
    const pool = record.pool.deref();
    if (!pool || pool.ended || pool.ending) records.delete(record);
    else current.push({ record, pool });
  }
  return current;
}

export function setCopPgPoolErrorSink(sink?: (metadata: Record<string, unknown>) => void): void {
  errorSink = sink;
}

/** Preserve each store's limits, query behavior, SSL and operator-supplied name. */
export function createCopPgPool(component: CopPgComponent, config: PoolConfig): PgPool {
  const pool = new pg.Pool({
    ...config,
    application_name: config.application_name ?? `cop-api:${component}`,
    fallback_application_name: config.fallback_application_name ?? `cop-api:${component}`
  });
  const record: PoolRecord = { component, pool: new WeakRef(pool), errorCount: 0 };
  currentRecords();
  if (records.size < maximumRecords) records.add(record);
  else untrackedPools += 1;
  const reportError = (source: "client" | "pool", error: unknown) => {
    record.errorCount += 1;
    record.lastErrorAt = new Date().toISOString();
    record.lastErrorCode = copPgErrorCode(error);
    try {
      errorSink?.({
        component,
        source,
        reasonCode: record.lastErrorCode,
        errorCount: record.errorCount,
        occurredAt: record.lastErrorAt,
        total: count(pool.totalCount),
        idle: count(pool.idleCount),
        waiting: count(pool.waitingCount)
      });
    } catch {
      // Diagnostic failure must not turn an already removed idle client into an API crash.
    }
  };
  pool.on("error", (error: unknown) => reportError("pool", error));
  // pg-pool removes its idle error listener while a client is checked out.
  // A disconnect between queries must not become an unhandled EventEmitter error.
  // Keep one listener for the physical connection, including after release. pg
  // still rejects the failed/pending query and discards its non-queryable client.
  // Never retry a transaction here: the outcome of COMMIT may be unknown.
  pool.on("connect", (client) => {
    client.on("error", (error: unknown) => reportError("client", error));
  });
  return pool;
}

/** Reading these counters never creates a database connection or runs a query. */
export function readCopPgPoolDiagnostics(): Record<string, unknown> {
  const pools = currentRecords().map(({ record, pool }) => ({
    component: record.component,
    total: count(pool.totalCount),
    idle: count(pool.idleCount),
    waiting: count(pool.waitingCount),
    configuredMax: count(pool.options.max),
    errorCount: record.errorCount,
    ...(record.lastErrorAt ? { lastErrorAt: record.lastErrorAt } : {}),
    ...(record.lastErrorCode ? { lastErrorCode: record.lastErrorCode } : {})
  }));
  return { poolCount: pools.length, pools, untrackedPools };
}
