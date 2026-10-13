type DatabaseEnvironment = Record<string, string | undefined>;
type SessionDatabaseKey = "COP_LEASE_DATABASE_URL" | "COP_STREAM_BUS_DATABASE_URL";
type DatabasePoolMode = "direct" | "session" | "transaction";

/** A declared routing mode, never inferred from a hostname or port. */
export function readCopDatabasePoolMode(env: DatabaseEnvironment): DatabasePoolMode {
  const mode = env.COP_DATABASE_POOL_MODE?.trim().toLowerCase() || "direct";
  if (mode === "direct" || mode === "session" || mode === "transaction") return mode;
  throw new Error("COP_DATABASE_POOL_MODE must be direct, session or transaction.");
}

/** Session state cannot fall back to a transaction-pooled database route. */
export function resolveCopSessionDatabaseUrl(env: DatabaseEnvironment, key: SessionDatabaseKey): string | undefined {
  const mode = readCopDatabasePoolMode(env);
  const sessionUrl = env[key]?.trim();
  const databaseUrl = env.COP_DATABASE_URL?.trim();
  if (mode !== "transaction") return sessionUrl || databaseUrl;
  if (!sessionUrl) throw new Error(`${key} is required when COP_DATABASE_POOL_MODE is transaction.`);
  if (!databaseUrl || sameEndpoint(databaseUrl, sessionUrl)) {
    throw new Error(`${key} must use a separate direct or session database endpoint.`);
  }
  return sessionUrl;
}

function sameEndpoint(databaseUrl: string, sessionUrl: string): boolean {
  const database = endpoint(databaseUrl);
  const session = endpoint(sessionUrl);
  return database.host === session.host && database.port === session.port && database.database === session.database;
}

function endpoint(value: string): { host: string; port: number; database: string } {
  try {
    const url = new URL(value);
    // Explicit fields avoid pg's environment-dependent host/port/database defaults.
    // Query endpoint overrides and socket/service DSNs need separate operational proof.
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.port || !url.pathname.slice(1) || url.hash) {
      throw new Error();
    }
    for (const key of url.searchParams.keys()) {
      if (["host", "hostaddr", "port", "database", "dbname", "service"].includes(key.toLowerCase())) throw new Error();
    }
    const host = decodeURIComponent(url.hostname).toLowerCase().replace(/\.$/u, "");
    // pg-connection-string uses decodeURI, preserving encoded reserved DB characters.
    const database = decodeURI(url.pathname.slice(1));
    if (!host || /[\s\u0000-\u001f/,]/u.test(host) || !database || /[\u0000-\u001f]/u.test(database) || Number(url.port) < 1) throw new Error();
    return { host, port: Number(url.port), database };
  } catch {
    // URL parser errors contain the input, including credentials. Never propagate them.
    throw new Error("Transaction database routing requires explicit PostgreSQL URI hosts, ports and databases without endpoint overrides.");
  }
}
