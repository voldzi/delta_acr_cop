import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import pg, { type Pool as PgPool, type PoolConfig, type QueryResultRow } from "pg";

const { Pool } = pg;

export interface WebSessionProfile {
  email?: string;
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
  close(): Promise<void>;
  create(input: WebSessionTokens, expiresAt: Date): Promise<WebSessionRecord>;
  get(sessionId: string): Promise<WebSessionRecord | null>;
  init(): Promise<void>;
  revoke(sessionId: string): Promise<void>;
  update(sessionId: string, input: WebSessionTokens): Promise<WebSessionRecord | null>;
}

export function createWebSessionStoreFromEnv(env: Record<string, string | undefined> = process.env): WebSessionStore | undefined {
  if (!readBoolean(env.COP_WEB_BFF_SESSION_ENABLED)) return undefined;
  const connectionString = env.COP_DATABASE_URL?.trim();
  const secret = env.COP_WEB_SESSION_SECRET?.trim();
  if (!connectionString) throw new Error("COP_WEB_BFF_SESSION_ENABLED requires COP_DATABASE_URL.");
  if (!secret || secret.length < 32) throw new Error("COP_WEB_BFF_SESSION_ENABLED requires a COP_WEB_SESSION_SECRET of at least 32 characters.");
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
  async init(): Promise<void> {}
  async close(): Promise<void> {}
  async create(input: WebSessionTokens, expiresAt: Date): Promise<WebSessionRecord> {
    const record: WebSessionRecord = { ...input, createdAt: new Date(), expiresAt, sessionId: randomUUID() };
    this.values.set(record.sessionId, record);
    return record;
  }
  async get(sessionId: string): Promise<WebSessionRecord | null> {
    const record = this.values.get(sessionId);
    if (!record || record.expiresAt <= new Date()) {
      this.values.delete(sessionId);
      return null;
    }
    return record;
  }
  async revoke(sessionId: string): Promise<void> { this.values.delete(sessionId); }
  async update(sessionId: string, input: WebSessionTokens): Promise<WebSessionRecord | null> {
    const previous = await this.get(sessionId);
    if (!previous) return null;
    const record = { ...previous, ...input };
    this.values.set(sessionId, record);
    return record;
  }
}

interface PostgresWebSessionStoreConfig extends PoolConfig { encryptionSecret: string; }

export class PostgresWebSessionStore implements WebSessionStore {
  readonly name = "postgres";
  private readonly key: Buffer;
  private readonly pool: PgPool;
  constructor(config: PostgresWebSessionStoreConfig) {
    const { encryptionSecret, ...poolConfig } = config;
    this.key = createHash("sha256").update(encryptionSecret).digest();
    this.pool = new Pool(poolConfig);
  }
  async init(): Promise<void> { await this.pool.query(createWebSessionTableSql); }
  async close(): Promise<void> { await this.pool.end(); }
  async create(input: WebSessionTokens, expiresAt: Date): Promise<WebSessionRecord> {
    const sessionId = randomUUID();
    const createdAt = new Date();
    await this.pool.query(
      `INSERT INTO cop_web_sessions (session_id, token_payload, access_expires_at, session_expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [sessionId, this.encrypt(input), input.accessTokenExpiresAt, expiresAt, createdAt]
    );
    return { ...input, createdAt, expiresAt, sessionId };
  }
  async get(sessionId: string): Promise<WebSessionRecord | null> {
    const result = await this.pool.query<WebSessionRow>(
      `SELECT session_id, token_payload, session_expires_at, created_at
       FROM cop_web_sessions WHERE session_id = $1 AND session_expires_at > now()`, [sessionId]
    );
    const row = result.rows[0];
    if (!row) return null;
    try {
      return { ...this.decrypt(row.token_payload), createdAt: new Date(row.created_at), expiresAt: new Date(row.session_expires_at), sessionId: row.session_id };
    } catch {
      await this.revoke(sessionId);
      return null;
    }
  }
  async revoke(sessionId: string): Promise<void> { await this.pool.query("DELETE FROM cop_web_sessions WHERE session_id = $1", [sessionId]); }
  async update(sessionId: string, input: WebSessionTokens): Promise<WebSessionRecord | null> {
    const existing = await this.get(sessionId);
    if (!existing) return null;
    await this.pool.query(
      `UPDATE cop_web_sessions SET token_payload = $2, access_expires_at = $3, updated_at = now() WHERE session_id = $1`,
      [sessionId, this.encrypt(input), input.accessTokenExpiresAt]
    );
    return { ...existing, ...input };
  }
  private encrypt(value: WebSessionTokens): string {
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
  }
  private decrypt(value: string): WebSessionTokens {
    const [encodedIv, encodedTag, encodedCiphertext] = value.split(".");
    if (!encodedIv || !encodedTag || !encodedCiphertext) throw new Error("Invalid encrypted web session.");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(encodedIv, "base64url"));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, "base64url")), decipher.final()]).toString("utf8")) as WebSessionTokens;
  }
}

interface WebSessionRow extends QueryResultRow { session_id: string; token_payload: string; session_expires_at: Date | string; created_at: Date | string; }

const createWebSessionTableSql = `
CREATE TABLE IF NOT EXISTS cop_web_sessions (
  session_id uuid PRIMARY KEY,
  token_payload text NOT NULL,
  access_expires_at timestamptz NOT NULL,
  session_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cop_web_sessions_expiry_idx ON cop_web_sessions (session_expires_at);
`;

function readBoolean(value: string | undefined): boolean { return value === "true" || value === "1" || value === "yes" || value === "on"; }
function readPositiveInteger(value: string | undefined, fallback: number): number { const parsed = Number.parseInt(value ?? "", 10); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; }
function readSslConfig(env: Record<string, string | undefined>): PoolConfig["ssl"] { return readBoolean(env.COP_DATABASE_SSL) ? { rejectUnauthorized: !["false", "0", "no", "off"].includes(env.COP_DATABASE_SSL_REJECT_UNAUTHORIZED ?? "true") } : undefined; }
