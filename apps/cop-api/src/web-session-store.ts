import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import pg, { type Pool as PgPool, type PoolConfig, type QueryResultRow } from "pg";

const { Pool } = pg;

export interface WebSessionProfile {
  email?: string;
  /** Only copied from a signature-verified OIDC token, never decoded legacy ownership. */
  issuer?: string;
  name: string;
  picture?: string;
  subjectId: string;
  username: string;
}

export interface WebSessionTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  idToken?: string;
  profile: WebSessionProfile;
  refreshToken?: string;
}

export interface WebSessionRecord extends WebSessionTokens {
  createdAt: Date;
  expiresAt: Date;
  sessionId: string;
}

export interface WebSessionStore {
  readonly name: string;
  erasureReady?(): Promise<boolean>;
  revokeActor?(actor: { issuer: string; subjectId: string }): Promise<{ complete: boolean }>;
  close(): Promise<void>;
  create(input: WebSessionTokens, expiresAt: Date): Promise<WebSessionRecord>;
  get(sessionId: string): Promise<WebSessionRecord | null>;
  init(): Promise<void>;
  revoke(sessionId: string): Promise<void>;
  update(sessionId: string, input: WebSessionTokens): Promise<WebSessionRecord | null>;
}

export function createWebSessionStoreFromEnv(
  env: Record<string, string | undefined> = process.env
): WebSessionStore | undefined {
  if (!readBoolean(env.COP_WEB_BFF_SESSION_ENABLED)) return undefined;
  const connectionString = env.COP_DATABASE_URL?.trim();
  const secret = env.COP_WEB_SESSION_SECRET?.trim();
  if (!connectionString) throw new Error("COP_WEB_BFF_SESSION_ENABLED requires COP_DATABASE_URL.");
  if (!secret || secret.length < 32)
    throw new Error("COP_WEB_BFF_SESSION_ENABLED requires a COP_WEB_SESSION_SECRET of at least 32 characters.");
  return new PostgresWebSessionStore({
    connectionString,
    connectionTimeoutMillis: readPositiveInteger(env.COP_DATABASE_CONNECT_TIMEOUT_MS, 5000),
    idleTimeoutMillis: readPositiveInteger(env.COP_DATABASE_IDLE_TIMEOUT_MS, 30000),
    max: readPositiveInteger(env.COP_DATABASE_POOL_MAX, 5),
    ssl: readSslConfig(env),
    encryptionSecret: secret
  });
}

export class InMemoryWebSessionStore implements WebSessionStore {
  readonly name = "memory";
  private readonly values = new Map<string, WebSessionRecord>();
  private readonly fences = new Set<string>();
  private readonly key = randomBytes(32);
  async init(): Promise<void> {}
  async close(): Promise<void> {}
  private owner(profile: WebSessionProfile): string | undefined {
    return profile.issuer ? ownerHash(this.key, profile.issuer, profile.subjectId) : undefined;
  }
  private assertWritable(profile: WebSessionProfile): void {
    const owner = this.owner(profile);
    if (owner ? this.fences.has(owner) : this.fences.size > 0) throw new Error("WEB_SESSION_ACCOUNT_ERASURE_FENCED");
  }
  async erasureReady(): Promise<boolean> {
    return true;
  }
  async revokeActor(actor: { issuer: string; subjectId: string }): Promise<{ complete: boolean }> {
    requireOwner(actor);
    const owner = ownerHash(this.key, actor.issuer, actor.subjectId);
    this.fences.add(owner);
    for (const [id, record] of this.values) if (this.owner(record.profile) === owner || record.expiresAt <= new Date()) this.values.delete(id);
    return { complete: ![...this.values.values()].some(record => !record.profile.issuer) };
  }
  async create(input: WebSessionTokens, expiresAt: Date): Promise<WebSessionRecord> {
    this.assertWritable(input.profile);
    const record: WebSessionRecord = { ...input, createdAt: new Date(), expiresAt, sessionId: randomUUID() };
    this.values.set(record.sessionId, record);
    return record;
  }
  async get(sessionId: string): Promise<WebSessionRecord | null> {
    const record = this.values.get(sessionId);
    if (!record || record.expiresAt <= new Date()) { this.values.delete(sessionId); return null; }
    if (this.owner(record.profile) && this.fences.has(this.owner(record.profile)!)) return null;
    return record;
  }
  async revoke(sessionId: string): Promise<void> { this.values.delete(sessionId); }
  async update(sessionId: string, input: WebSessionTokens): Promise<WebSessionRecord | null> {
    // No await between fence/owner check and mutation: late refresh cannot resurrect a removed session.
    this.assertWritable(input.profile);
    const previous = this.values.get(sessionId);
    if (!previous || previous.expiresAt <= new Date()) return null;
    if (this.owner(previous.profile) !== this.owner(input.profile) || previous.profile.subjectId !== input.profile.subjectId) return null;
    const record = { ...previous, ...input };
    this.values.set(sessionId, record);
    return record;
  }
}

interface PostgresWebSessionStoreConfig extends PoolConfig {
  encryptionSecret: string;
}

export class PostgresWebSessionStore implements WebSessionStore {
  readonly name = "postgres";
  private readonly key: Buffer;
  private readonly pool: PgPool;
  constructor(config: PostgresWebSessionStoreConfig) {
    const { encryptionSecret, ...poolConfig } = config;
    this.key = createHash("sha256").update(encryptionSecret).digest();
    this.pool = new Pool(poolConfig);
  }
  async init(): Promise<void> {
    await this.pool.query(createWebSessionTableSql);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(18101203, hashtext('owner-key-configuration'))");
      const fingerprint = createHash("sha256").update("cop-web-session-owner-key-v1\0").update(this.key).digest("hex");
      const stored = await client.query<{ key_fingerprint: string } & QueryResultRow>("SELECT key_fingerprint FROM cop_web_session_erasure_metadata WHERE id=1");
      if (stored.rows[0] && stored.rows[0].key_fingerprint !== fingerprint) throw new Error("WEB_SESSION_OWNER_KEY_CHANGED");
      if (!stored.rows[0]) await client.query("INSERT INTO cop_web_session_erasure_metadata(id,key_fingerprint) VALUES(1,$1)", [fingerprint]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
  private owner(profile: WebSessionProfile): string | undefined {
    return profile.issuer ? ownerHash(this.key, profile.issuer, profile.subjectId) : undefined;
  }
  private async transaction<T>(owner: string | undefined, operation: (client: pg.PoolClient) => Promise<T>, fenceCheck = true): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Legacy writes and cleanup share this lock; an unknown owner is never adopted by decoding stored JWTs.
      await client.query("SELECT pg_advisory_xact_lock(18101203, hashtext($1))", [owner ?? "legacy-owner"]);
      if (fenceCheck) {
        const result = await client.query("SELECT 1 FROM cop_web_session_erasure_fences WHERE $1::text IS NULL OR owner_hash=$1 LIMIT 1", [owner ?? null]);
        if (result.rows.length) throw new Error("WEB_SESSION_ACCOUNT_ERASURE_FENCED");
      }
      const value = await operation(client);
      await client.query("COMMIT");
      return value;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async erasureReady(): Promise<boolean> {
    await this.pool.query("SELECT 1 FROM cop_web_session_erasure_fences LIMIT 1");
    return true;
  }
  async revokeActor(actor: { issuer: string; subjectId: string }): Promise<{ complete: boolean }> {
    requireOwner(actor);
    const owner = ownerHash(this.key, actor.issuer, actor.subjectId);
    return this.transaction(owner, async client => {
      await client.query("SELECT pg_advisory_xact_lock(18101203, hashtext($1))", ["legacy-owner"]);
      await client.query("INSERT INTO cop_web_session_erasure_fences(owner_hash) VALUES($1) ON CONFLICT DO NOTHING", [owner]);
      // Expired credentials are removed, not merely ignored when proving no legacy sessions remain.
      await client.query("DELETE FROM cop_web_sessions WHERE owner_hash=$1 OR session_expires_at<=now()", [owner]);
      const remaining = await client.query("SELECT 1 FROM cop_web_sessions WHERE owner_hash IS NULL AND session_expires_at > now() LIMIT 1");
      return { complete: remaining.rows.length === 0 };
    }, false);
  }
  async create(input: WebSessionTokens, expiresAt: Date): Promise<WebSessionRecord> {
    const sessionId = randomUUID(), createdAt = new Date(), owner = this.owner(input.profile);
    return this.transaction(owner, async client => {
      await client.query(
        `INSERT INTO cop_web_sessions (session_id, owner_hash, token_payload, access_expires_at, session_expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [sessionId, owner ?? null, this.encrypt(input), input.accessTokenExpiresAt, expiresAt, createdAt]
      );
      return { ...input, createdAt, expiresAt, sessionId };
    });
  }
  async get(sessionId: string): Promise<WebSessionRecord | null> {
    const result = await this.pool.query<WebSessionRow>(
      `SELECT session_id, token_payload, access_expires_at, session_expires_at, created_at
       FROM cop_web_sessions s WHERE session_id=$1 AND session_expires_at > now()
         AND NOT EXISTS(SELECT 1 FROM cop_web_session_erasure_fences f WHERE f.owner_hash=s.owner_hash)`, [sessionId]
    );
    const row = result.rows[0];
    if (!row) return null;
    try {
      return { ...this.decrypt(row.token_payload), accessTokenExpiresAt: requiredDate(row.access_expires_at, "access_expires_at"),
        createdAt: requiredDate(row.created_at, "created_at"), expiresAt: requiredDate(row.session_expires_at, "session_expires_at"), sessionId: row.session_id };
    } catch { await this.revoke(sessionId); return null; }
  }
  async revoke(sessionId: string): Promise<void> {
    await this.pool.query("DELETE FROM cop_web_sessions WHERE session_id=$1", [sessionId]);
  }
  async update(sessionId: string, input: WebSessionTokens): Promise<WebSessionRecord | null> {
    const owner = this.owner(input.profile);
    return this.transaction(owner, async client => {
      const result = await client.query<WebSessionRow & { owner_hash: string | null }>(
        `SELECT session_id, owner_hash, token_payload, access_expires_at, session_expires_at, created_at
         FROM cop_web_sessions WHERE session_id=$1 AND session_expires_at > now() FOR UPDATE`, [sessionId]);
      const row = result.rows[0];
      if (!row || row.owner_hash !== (owner ?? null)) return null;
      const previous = this.decrypt(row.token_payload);
      if (previous.profile.subjectId !== input.profile.subjectId || previous.profile.issuer !== input.profile.issuer) return null;
      await client.query("UPDATE cop_web_sessions SET token_payload=$2, access_expires_at=$3, updated_at=now() WHERE session_id=$1",
        [sessionId, this.encrypt(input), input.accessTokenExpiresAt]);
      return { ...input, createdAt: requiredDate(row.created_at, "created_at"), expiresAt: requiredDate(row.session_expires_at, "session_expires_at"), sessionId };
    });
  }
  private encrypt(value: WebSessionTokens): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
  }
  private decrypt(value: string): WebSessionTokens {
    const [encodedIv, encodedTag, encodedCiphertext] = value.split(".");
    if (!encodedIv || !encodedTag || !encodedCiphertext) throw new Error("Invalid encrypted web session.");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(encodedIv, "base64url"));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return restoreWebSessionTokens(
      JSON.parse(
        Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, "base64url")), decipher.final()]).toString("utf8")
      )
    );
  }
}

interface WebSessionRow extends QueryResultRow {
  access_expires_at: Date | string;
  created_at: Date | string;
  session_expires_at: Date | string;
  session_id: string;
  token_payload: string;
}

const createWebSessionTableSql = `
CREATE TABLE IF NOT EXISTS cop_web_sessions (
  session_id uuid PRIMARY KEY,
  token_payload text NOT NULL,
  owner_hash text,
  access_expires_at timestamptz NOT NULL,
  session_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cop_web_sessions ADD COLUMN IF NOT EXISTS owner_hash text;
CREATE INDEX IF NOT EXISTS cop_web_sessions_owner_idx ON cop_web_sessions(owner_hash) WHERE owner_hash IS NOT NULL;
CREATE TABLE IF NOT EXISTS cop_web_session_erasure_fences (
  owner_hash text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cop_web_session_erasure_metadata (
  id integer PRIMARY KEY CHECK(id=1),
  key_fingerprint text NOT NULL
);
CREATE INDEX IF NOT EXISTS cop_web_sessions_expiry_idx ON cop_web_sessions (session_expires_at);
`;

function readBoolean(value: string | undefined): boolean {
  return value === "true" || value === "1" || value === "yes" || value === "on";
}
function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function readSslConfig(env: Record<string, string | undefined>): PoolConfig["ssl"] {
  return readBoolean(env.COP_DATABASE_SSL)
    ? { rejectUnauthorized: !["false", "0", "no", "off"].includes(env.COP_DATABASE_SSL_REJECT_UNAUTHORIZED ?? "true") }
    : undefined;
}

export function restoreWebSessionTokens(value: unknown): WebSessionTokens {
  if (!isRecord(value) || typeof value.accessToken !== "string" || !isRecord(value.profile)) {
    throw new Error("Invalid stored web session token payload.");
  }
  const accessTokenExpiresAt = requiredDate(value.accessTokenExpiresAt, "accessTokenExpiresAt");
  const profile = value.profile;
  if (
    typeof profile.name !== "string" ||
    typeof profile.subjectId !== "string" ||
    typeof profile.username !== "string"
  ) {
    throw new Error("Invalid stored web session profile.");
  }
  return {
    accessToken: value.accessToken,
    accessTokenExpiresAt,
    ...(typeof value.idToken === "string" ? { idToken: value.idToken } : {}),
    profile: {
      ...(typeof profile.email === "string" ? { email: profile.email } : {}),
      ...(typeof profile.issuer === "string" && profile.issuer.length > 0 ? { issuer: profile.issuer } : {}),
      name: profile.name,
      ...(typeof profile.picture === "string" ? { picture: profile.picture } : {}),
      subjectId: profile.subjectId,
      username: profile.username
    },
    ...(typeof value.refreshToken === "string" ? { refreshToken: value.refreshToken } : {})
  };
}

function requiredDate(value: unknown, field: string): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid stored web session ${field}.`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireOwner(actor: { issuer: string; subjectId: string }): void {
  if (!actor.issuer || !actor.subjectId) throw new Error("Verified OIDC session ownership is required.");
}
function ownerHash(key: Buffer, issuer: string, subjectId: string): string {
  return createHmac("sha256", key).update("cop-web-session-owner-v1\0").update(JSON.stringify([issuer, subjectId])).digest("hex");
}
