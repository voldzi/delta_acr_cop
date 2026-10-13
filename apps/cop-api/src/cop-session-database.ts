type DatabaseEnvironment = Record<string, string | undefined>;
type SessionDatabaseKey = "COP_LEASE_DATABASE_URL" | "COP_STREAM_BUS_DATABASE_URL";
type DatabasePoolMode = "direct" | "session" | "transaction";
type DatabaseEndpoint = { transport: "tcp" | "unix"; host: string; port: number; database: string; url: URL };

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
  if (!databaseUrl) {
    throw new Error(`${key} must use a separate direct or session database endpoint.`);
  }
  const database = endpoint(databaseUrl);
  const session = endpoint(sessionUrl);
  if (sameEndpoint(database, session)) throw new Error(`${key} must use a separate direct or session database endpoint.`);
  // The new private IPC business route must not inherit plaintext TLS settings
  // on its remote lease route. URI SSL options replace PoolConfig.ssl in pg.
  if (database.transport === "unix") requireVerifiedRemoteSession(session);
  return sessionUrl;
}

function sameEndpoint(database: DatabaseEndpoint, session: DatabaseEndpoint): boolean {
  return database.transport === session.transport && database.host === session.host && database.port === session.port && database.database === session.database;
}

function endpoint(value: string): DatabaseEndpoint {
  try {
    // pg re-encodes the entire URI on a malformed escape, which can turn an
    // encoded Unix directory into a literal TCP host. Reject it before URL.
    if (/[\s\u0000-\u001f\u007f]/u.test(value) || /%(?![a-f0-9]{2})/iu.test(value)) throw new Error();
    const url = new URL(value);
    // Explicit fields avoid pg's environment-dependent host/port/database defaults.
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.port || !url.pathname.slice(1) || url.hash) {
      throw new Error();
    }
    const queryKeys = new Set<string>();
    for (const key of url.searchParams.keys()) {
      const normalized = key.toLowerCase();
      if (queryKeys.has(normalized) || ["host", "hostaddr", "port", "database", "dbname", "service"].includes(normalized)) throw new Error();
      queryKeys.add(normalized);
    }
    // Validate encoded credentials without retaining them in endpoint diagnostics.
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
    const decodedHost = decodeURIComponent(url.hostname);
    const transport = decodedHost.startsWith("/") ? "unix" : "tcp";
    const host = transport === "unix" ? socketDirectory(decodedHost) : decodedHost.toLowerCase().replace(/\.$/u, "");
    // pg-connection-string uses decodeURI, preserving encoded reserved DB characters.
    const database = decodeURI(url.pathname.slice(1));
    if (!host || (transport === "tcp" && /[\s\u0000-\u001f\u007f/,%\\]/u.test(host)) || !database || /[\u0000-\u001f\u007f]/u.test(database) || Number(url.port) < 1) throw new Error();
    if (transport === "unix" && (!allowedQuery(url, ["sslmode", "application_name"]) || url.searchParams.get("sslmode") !== "disable")) throw new Error();
    return { transport, host, port: Number(url.port), database, url };
  } catch {
    // URL parser errors contain the input, including credentials. Never propagate them.
    throw new Error("Transaction database routing requires explicit PostgreSQL URI hosts, ports and databases without endpoint overrides.");
  }
}

function socketDirectory(value: string): string {
  if (!/^\/[A-Za-z0-9_./-]+$/u.test(value)) throw new Error();
  const segments = value.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) throw new Error();
  // Repeated and trailing slashes identify the same directory on the Linux host.
  // Filesystem symlinks and bind aliases still require deployment verification.
  return `/${segments.join("/")}`;
}

function allowedQuery(url: URL, keys: string[]): boolean {
  return [...url.searchParams.keys()].every((key) => keys.includes(key));
}

function requireVerifiedRemoteSession(session: DatabaseEndpoint): void {
  const { url } = session;
  const rootCert = url.searchParams.get("sslrootcert");
  let canonicalRootCert = false;
  try { canonicalRootCert = !!rootCert && socketDirectory(rootCert) === rootCert; } catch { /* Fixed error below. */ }
  if (session.transport !== "tcp" || !allowedQuery(url, ["sslmode", "sslrootcert", "application_name"]) ||
      url.searchParams.get("sslmode") !== "verify-full" || !canonicalRootCert) {
    throw new Error("Unix transaction routing requires a separate TCP session URI with sslmode=verify-full and an absolute sslrootcert path.");
  }
}
