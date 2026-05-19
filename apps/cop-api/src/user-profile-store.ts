import pg, { type Pool as PgPool, type PoolConfig, type QueryResultRow } from "pg";
import type { CopAlertSeverity, CopAlertType } from "./alerts.js";
import type { AlertAcknowledgement } from "./types.js";

const { Pool } = pg;

export interface UserAlertPreferences {
  enabledTypes?: CopAlertType[];
  minimumSeverity?: CopAlertSeverity;
}

export interface UserProfileRecord {
  alertPreferences: UserAlertPreferences;
  createdAt?: string;
  displayName: string;
  email?: string;
  preferences: Record<string, unknown>;
  subjectId: string;
  updatedAt: string;
  username: string;
}

export interface UserProfileStore {
  readonly name: string;
  acknowledgeAlert(subjectId: string, acknowledgement: AlertAcknowledgement): Promise<void>;
  close(): Promise<void>;
  diagnostics?(): string | undefined;
  getAlertAcknowledgements(subjectId: string): Promise<Map<string, AlertAcknowledgement>>;
  getProfile(subjectId: string): Promise<UserProfileRecord | null>;
  init(): Promise<void>;
  upsertProfile(profile: Omit<UserProfileRecord, "createdAt" | "updatedAt">): Promise<UserProfileRecord>;
}

export function createUserProfileStoreFromEnv(env: Record<string, string | undefined> = process.env): UserProfileStore {
  const mode = (env.COP_USER_PROFILE_STORE ?? "auto").trim().toLowerCase();
  const connectionString = env.COP_DATABASE_URL?.trim();

  if (mode === "memory" || mode === "disabled") {
    return new InMemoryUserProfileStore(mode === "disabled" ? "memory-disabled" : "memory");
  }
  if (mode === "auto" && !connectionString) {
    return new InMemoryUserProfileStore("memory");
  }
  if ((mode === "auto" || mode === "postgres" || mode === "postgresql") && connectionString) {
    return new PostgresUserProfileStore({
      connectionString,
      connectionTimeoutMillis: readPositiveInteger(env.COP_DATABASE_CONNECT_TIMEOUT_MS, 5000),
      idleTimeoutMillis: readPositiveInteger(env.COP_DATABASE_IDLE_TIMEOUT_MS, 30000),
      max: readPositiveInteger(env.COP_DATABASE_POOL_MAX, 5),
      ssl: readSslConfig(env)
    });
  }

  throw new Error(`Unsupported COP_USER_PROFILE_STORE value: ${mode}`);
}

export class InMemoryUserProfileStore implements UserProfileStore {
  readonly name: string;
  private readonly acknowledgements = new Map<string, Map<string, AlertAcknowledgement>>();
  private readonly profiles = new Map<string, UserProfileRecord>();

  constructor(name = "memory") {
    this.name = name;
  }

  async init(): Promise<void> {}

  async getProfile(subjectId: string): Promise<UserProfileRecord | null> {
    return this.profiles.get(subjectId) ?? null;
  }

  async upsertProfile(profile: Omit<UserProfileRecord, "createdAt" | "updatedAt">): Promise<UserProfileRecord> {
    const existing = this.profiles.get(profile.subjectId);
    const timestamp = new Date().toISOString();
    const next: UserProfileRecord = {
      ...profile,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    this.profiles.set(profile.subjectId, next);
    return next;
  }

  async getAlertAcknowledgements(subjectId: string): Promise<Map<string, AlertAcknowledgement>> {
    return new Map(this.acknowledgements.get(subjectId) ?? []);
  }

  async acknowledgeAlert(subjectId: string, acknowledgement: AlertAcknowledgement): Promise<void> {
    const acknowledgements = this.acknowledgements.get(subjectId) ?? new Map<string, AlertAcknowledgement>();
    acknowledgements.set(acknowledgement.alertId, acknowledgement);
    this.acknowledgements.set(subjectId, acknowledgements);
  }

  async close(): Promise<void> {}
}

export class PostgresUserProfileStore implements UserProfileStore {
  readonly name = "postgres";
  private lastIdleClientError: string | undefined;
  private readonly pool: PgPool;

  constructor(config: PoolConfig) {
    this.pool = new Pool(config);
    this.pool.on("error", (error) => {
      this.lastIdleClientError = errorMessage(error);
    });
  }

  async init(): Promise<void> {
    await this.pool.query(createUserProfileTablesSql);
  }

  async getProfile(subjectId: string): Promise<UserProfileRecord | null> {
    const result = await this.pool.query<UserProfileRow>(
      `SELECT subject_id, username, display_name, email, preferences, alert_preferences, created_at, updated_at
      FROM cop_user_profiles
      WHERE subject_id = $1`,
      [subjectId]
    );
    const row = result.rows[0];
    return row ? profileFromRow(row) : null;
  }

  async upsertProfile(profile: Omit<UserProfileRecord, "createdAt" | "updatedAt">): Promise<UserProfileRecord> {
    const result = await this.pool.query<UserProfileRow>(
      `INSERT INTO cop_user_profiles (
        subject_id,
        username,
        display_name,
        email,
        preferences,
        alert_preferences
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
      ON CONFLICT (subject_id) DO UPDATE SET
        username = EXCLUDED.username,
        display_name = EXCLUDED.display_name,
        email = EXCLUDED.email,
        preferences = EXCLUDED.preferences,
        alert_preferences = EXCLUDED.alert_preferences,
        updated_at = now()
      RETURNING subject_id, username, display_name, email, preferences, alert_preferences, created_at, updated_at`,
      [
        profile.subjectId,
        profile.username,
        profile.displayName,
        profile.email ?? null,
        JSON.stringify(profile.preferences),
        JSON.stringify(profile.alertPreferences)
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("User profile upsert returned no row.");
    }
    return profileFromRow(row);
  }

  async getAlertAcknowledgements(subjectId: string): Promise<Map<string, AlertAcknowledgement>> {
    const result = await this.pool.query<AlertAcknowledgementRow>(
      `SELECT alert_id, acknowledged_at, acknowledged_by, note
      FROM cop_user_alert_acknowledgements
      WHERE subject_id = $1
      ORDER BY acknowledged_at DESC`,
      [subjectId]
    );
    return new Map(result.rows.map((row) => [row.alert_id, acknowledgementFromRow(row)]));
  }

  async acknowledgeAlert(subjectId: string, acknowledgement: AlertAcknowledgement): Promise<void> {
    await this.pool.query(
      `INSERT INTO cop_user_alert_acknowledgements (
        subject_id,
        alert_id,
        acknowledged_at,
        acknowledged_by,
        note
      )
      VALUES ($1, $2, $3::timestamptz, $4, $5)
      ON CONFLICT (subject_id, alert_id) DO UPDATE SET
        acknowledged_at = EXCLUDED.acknowledged_at,
        acknowledged_by = EXCLUDED.acknowledged_by,
        note = EXCLUDED.note`,
      [
        subjectId,
        acknowledgement.alertId,
        acknowledgement.acknowledgedAt,
        acknowledgement.acknowledgedBy ?? null,
        acknowledgement.note ?? null
      ]
    );
  }

  diagnostics(): string | undefined {
    return this.lastIdleClientError ? `last idle client error: ${this.lastIdleClientError}` : undefined;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

interface UserProfileRow extends QueryResultRow {
  alert_preferences: Record<string, unknown> | string | null;
  created_at: Date | string;
  display_name: string;
  email: string | null;
  preferences: Record<string, unknown> | string | null;
  subject_id: string;
  updated_at: Date | string;
  username: string;
}

interface AlertAcknowledgementRow extends QueryResultRow {
  acknowledged_at: Date | string;
  acknowledged_by: string | null;
  alert_id: string;
  note: string | null;
}

const createUserProfileTablesSql = `
CREATE TABLE IF NOT EXISTS cop_user_profiles (
  subject_id text PRIMARY KEY,
  username text NOT NULL,
  display_name text NOT NULL,
  email text,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  alert_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cop_user_alert_acknowledgements (
  subject_id text NOT NULL,
  alert_id text NOT NULL,
  acknowledged_at timestamptz NOT NULL,
  acknowledged_by text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_id, alert_id)
);

CREATE INDEX IF NOT EXISTS cop_user_alert_ack_subject_idx
  ON cop_user_alert_acknowledgements (subject_id, acknowledged_at DESC);
`;

function profileFromRow(row: UserProfileRow): UserProfileRecord {
  return {
    alertPreferences: normalizeAlertPreferences(jsonRecord(row.alert_preferences)),
    createdAt: isoString(row.created_at),
    displayName: row.display_name,
    ...(row.email ? { email: row.email } : {}),
    preferences: jsonRecord(row.preferences),
    subjectId: row.subject_id,
    updatedAt: isoString(row.updated_at),
    username: row.username
  };
}

function acknowledgementFromRow(row: AlertAcknowledgementRow): AlertAcknowledgement {
  return {
    acknowledgedAt: isoString(row.acknowledged_at),
    alertId: row.alert_id,
    ...(row.acknowledged_by ? { acknowledgedBy: row.acknowledged_by } : {}),
    ...(row.note ? { note: row.note } : {})
  };
}

function normalizeAlertPreferences(value: Record<string, unknown>): UserAlertPreferences {
  const enabledTypes = Array.isArray(value.enabledTypes)
    ? value.enabledTypes.filter(isCopAlertType)
    : undefined;
  const minimumSeverity = isCopAlertSeverity(value.minimumSeverity) ? value.minimumSeverity : undefined;
  return {
    ...(enabledTypes && enabledTypes.length > 0 ? { enabledTypes } : {}),
    ...(minimumSeverity ? { minimumSeverity } : {})
  };
}

function jsonRecord(value: Record<string, unknown> | string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRecord(value) ? value : {};
}

function isCopAlertType(value: unknown): value is CopAlertType {
  return value === "LOW_CONFIDENCE"
    || value === "SOURCE_DEGRADED"
    || value === "TRACK_CONFLICT"
    || value === "TRACK_LOST"
    || value === "TRACK_STALE";
}

function isCopAlertSeverity(value: unknown): value is CopAlertSeverity {
  return value === "info" || value === "warning" || value === "critical";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function readSslConfig(env: Record<string, string | undefined>): PoolConfig["ssl"] {
  const value = env.COP_DATABASE_SSL?.trim().toLowerCase();
  if (value !== "true" && value !== "1" && value !== "require") {
    return false;
  }
  return {
    rejectUnauthorized: env.COP_DATABASE_SSL_REJECT_UNAUTHORIZED !== "false"
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
