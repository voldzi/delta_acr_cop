import pg, { type Pool as PgPool, type PoolConfig, type QueryResultRow } from "pg";
import { randomBytes } from "node:crypto";

const { Pool } = pg;

export type MobilePlatform = "ios" | "ipados";
export type MobileDeviceStatus = "paired" | "revoked";
export type MobilePairingSessionStatus = "pending" | "claimed" | "confirmed" | "expired" | "revoked";

export interface MobileDeviceRegistrationInput {
  appVersion: string;
  buildNumber?: string;
  capabilities: string[];
  deviceId: string;
  deviceModel?: string;
  deviceSessionId: string;
  matrixDeviceId?: string;
  osVersion?: string;
  platform: MobilePlatform;
  pushTokenRegistered: boolean;
  registeredAt: string;
  subjectId: string;
}

export interface MobileDeviceRecord extends MobileDeviceRegistrationInput {
  lastSeenAt: string;
  pairedAt: string;
  pairingCode?: string;
  revokedAt?: string;
  status: MobileDeviceStatus;
}

export interface MobilePairingActorRecord {
  displayName: string;
  subjectId: string;
  username: string;
}

export interface MobilePairingSessionRecord {
  claimedAt?: string;
  claimedBy?: MobilePairingActorRecord;
  claimedDevice?: MobileDeviceRegistrationInput;
  code: string;
  confirmedAt?: string;
  createdAt: string;
  createdBy: MobilePairingActorRecord;
  expiresAt: string;
  status: MobilePairingSessionStatus;
}

export interface MobilePairingSessionCreateInput {
  actor: MobilePairingActorRecord;
  expiresAt: string;
  now: string;
}

export interface MobileDeviceStore {
  readonly name: string;
  claimPairingSession(code: string, actor: MobilePairingActorRecord, device: MobileDeviceRegistrationInput, now: string): Promise<MobilePairingSessionRecord | null>;
  close(): Promise<void>;
  confirmPairingSession(code: string, now: string): Promise<MobilePairingSessionRecord | null>;
  createPairingSession(input: MobilePairingSessionCreateInput): Promise<MobilePairingSessionRecord>;
  diagnostics?(): string | undefined;
  getPairingSession(code: string, now: string): Promise<MobilePairingSessionRecord | null>;
  init(): Promise<void>;
  listDevices(subjectId: string): Promise<MobileDeviceRecord[]>;
  revokeDevice(subjectId: string, deviceId: string, now: string): Promise<MobileDeviceRecord | null>;
  upsertDevice(device: MobileDeviceRegistrationInput, status: MobileDeviceStatus, now: string, pairingCode?: string): Promise<MobileDeviceRecord>;
}

export function createMobileDeviceStoreFromEnv(env: Record<string, string | undefined> = process.env): MobileDeviceStore {
  const mode = (env.COP_MOBILE_DEVICE_STORE ?? "auto").trim().toLowerCase();
  const connectionString = env.COP_DATABASE_URL?.trim();

  if (mode === "memory" || mode === "disabled") {
    return new InMemoryMobileDeviceStore(mode === "disabled" ? "memory-disabled" : "memory");
  }
  if (mode === "auto" && !connectionString) {
    return new InMemoryMobileDeviceStore("memory");
  }
  if ((mode === "auto" || mode === "postgres" || mode === "postgresql") && connectionString) {
    return new PostgresMobileDeviceStore({
      connectionString,
      connectionTimeoutMillis: readPositiveInteger(env.COP_DATABASE_CONNECT_TIMEOUT_MS, 5000),
      idleTimeoutMillis: readPositiveInteger(env.COP_DATABASE_IDLE_TIMEOUT_MS, 30000),
      max: readPositiveInteger(env.COP_DATABASE_POOL_MAX, 5),
      ssl: readSslConfig(env)
    });
  }

  throw new Error(`Unsupported COP_MOBILE_DEVICE_STORE value: ${mode}`);
}

export class InMemoryMobileDeviceStore implements MobileDeviceStore {
  readonly name: string;
  private readonly devices = new Map<string, MobileDeviceRecord>();
  private readonly pairingSessions = new Map<string, MobilePairingSessionRecord>();

  constructor(name = "memory") {
    this.name = name;
  }

  async init(): Promise<void> {}

  async createPairingSession(input: MobilePairingSessionCreateInput): Promise<MobilePairingSessionRecord> {
    const session: MobilePairingSessionRecord = {
      code: createPairingCode(),
      createdAt: input.now,
      createdBy: input.actor,
      expiresAt: input.expiresAt,
      status: "pending"
    };
    this.pairingSessions.set(session.code, session);
    return session;
  }

  async getPairingSession(code: string, now: string): Promise<MobilePairingSessionRecord | null> {
    return normalizePairingSessionExpiry(this.pairingSessions.get(code) ?? null, now);
  }

  async claimPairingSession(code: string, actor: MobilePairingActorRecord, device: MobileDeviceRegistrationInput, now: string): Promise<MobilePairingSessionRecord | null> {
    const current = await this.getPairingSession(code, now);
    if (!current || current.status !== "pending") {
      return current;
    }
    const next: MobilePairingSessionRecord = {
      ...current,
      claimedAt: now,
      claimedBy: actor,
      claimedDevice: device,
      status: "claimed"
    };
    this.pairingSessions.set(code, next);
    return next;
  }

  async confirmPairingSession(code: string, now: string): Promise<MobilePairingSessionRecord | null> {
    const current = await this.getPairingSession(code, now);
    if (!current || current.status !== "claimed") {
      return current;
    }
    const next: MobilePairingSessionRecord = {
      ...current,
      confirmedAt: now,
      status: "confirmed"
    };
    this.pairingSessions.set(code, next);
    return next;
  }

  async upsertDevice(device: MobileDeviceRegistrationInput, status: MobileDeviceStatus, now: string, pairingCode?: string): Promise<MobileDeviceRecord> {
    const key = deviceKey(device.subjectId, device.deviceId);
    const existing = this.devices.get(key);
    const record: MobileDeviceRecord = {
      ...device,
      lastSeenAt: now,
      pairedAt: existing?.pairedAt ?? now,
      ...(pairingCode ?? existing?.pairingCode ? { pairingCode: pairingCode ?? existing?.pairingCode } : {}),
      ...(status === "revoked" ? { revokedAt: now } : {}),
      status
    };
    this.devices.set(key, record);
    return record;
  }

  async listDevices(subjectId: string): Promise<MobileDeviceRecord[]> {
    return Array.from(this.devices.values())
      .filter((device) => device.subjectId === subjectId)
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
  }

  async revokeDevice(subjectId: string, deviceId: string, now: string): Promise<MobileDeviceRecord | null> {
    const current = this.devices.get(deviceKey(subjectId, deviceId));
    if (!current) {
      return null;
    }
    const next: MobileDeviceRecord = {
      ...current,
      lastSeenAt: now,
      revokedAt: now,
      status: "revoked"
    };
    this.devices.set(deviceKey(subjectId, deviceId), next);
    return next;
  }

  async close(): Promise<void> {}
}

export class PostgresMobileDeviceStore implements MobileDeviceStore {
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
    await this.pool.query(createMobileDeviceTablesSql);
  }

  async createPairingSession(input: MobilePairingSessionCreateInput): Promise<MobilePairingSessionRecord> {
    const code = createPairingCode();
    const result = await this.pool.query<MobilePairingSessionRow>(
      `INSERT INTO cop_mobile_pairing_sessions (
        code,
        created_by_subject_id,
        created_by_username,
        created_by_display_name,
        status,
        created_at,
        expires_at
      )
      VALUES ($1, $2, $3, $4, 'pending', $5, $6)
      RETURNING *`,
      [code, input.actor.subjectId, input.actor.username, input.actor.displayName, input.now, input.expiresAt]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Mobile pairing session insert did not return a row.");
    }
    return pairingSessionFromRow(row);
  }

  async getPairingSession(code: string, now: string): Promise<MobilePairingSessionRecord | null> {
    await expirePairingSessions(this.pool, now);
    const result = await this.pool.query<MobilePairingSessionRow>(
      `SELECT * FROM cop_mobile_pairing_sessions WHERE code = $1`,
      [code]
    );
    return result.rows[0] ? pairingSessionFromRow(result.rows[0]) : null;
  }

  async claimPairingSession(code: string, actor: MobilePairingActorRecord, device: MobileDeviceRegistrationInput, now: string): Promise<MobilePairingSessionRecord | null> {
    await expirePairingSessions(this.pool, now);
    const result = await this.pool.query<MobilePairingSessionRow>(
      `UPDATE cop_mobile_pairing_sessions
      SET status = 'claimed',
        claimed_at = $2,
        claimed_by_subject_id = $3,
        claimed_by_username = $4,
        claimed_by_display_name = $5,
        claimed_device_id = $6,
        device_payload = $7::jsonb
      WHERE code = $1 AND status = 'pending'
      RETURNING *`,
      [code, now, actor.subjectId, actor.username, actor.displayName, device.deviceId, JSON.stringify(device)]
    );
    if (result.rows[0]) {
      return pairingSessionFromRow(result.rows[0]);
    }
    return this.getPairingSession(code, now);
  }

  async confirmPairingSession(code: string, now: string): Promise<MobilePairingSessionRecord | null> {
    await expirePairingSessions(this.pool, now);
    const result = await this.pool.query<MobilePairingSessionRow>(
      `UPDATE cop_mobile_pairing_sessions
      SET status = 'confirmed',
        confirmed_at = $2
      WHERE code = $1 AND status = 'claimed'
      RETURNING *`,
      [code, now]
    );
    if (result.rows[0]) {
      return pairingSessionFromRow(result.rows[0]);
    }
    return this.getPairingSession(code, now);
  }

  async upsertDevice(device: MobileDeviceRegistrationInput, status: MobileDeviceStatus, now: string, pairingCode?: string): Promise<MobileDeviceRecord> {
    const result = await this.pool.query<MobileDeviceRow>(
      `INSERT INTO cop_mobile_devices (
        subject_id,
        device_id,
        matrix_device_id,
        platform,
        app_version,
        build_number,
        device_model,
        os_version,
        capabilities,
        push_token_registered,
        device_session_id,
        pairing_code,
        status,
        paired_at,
        last_seen_at,
        revoked_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $14, $15)
      ON CONFLICT (subject_id, device_id) DO UPDATE SET
        matrix_device_id = EXCLUDED.matrix_device_id,
        platform = EXCLUDED.platform,
        app_version = EXCLUDED.app_version,
        build_number = EXCLUDED.build_number,
        device_model = EXCLUDED.device_model,
        os_version = EXCLUDED.os_version,
        capabilities = EXCLUDED.capabilities,
        push_token_registered = EXCLUDED.push_token_registered,
        device_session_id = EXCLUDED.device_session_id,
        pairing_code = COALESCE(EXCLUDED.pairing_code, cop_mobile_devices.pairing_code),
        status = EXCLUDED.status,
        last_seen_at = EXCLUDED.last_seen_at,
        revoked_at = EXCLUDED.revoked_at
      RETURNING *`,
      [
        device.subjectId,
        device.deviceId,
        device.matrixDeviceId ?? null,
        device.platform,
        device.appVersion,
        device.buildNumber ?? null,
        device.deviceModel ?? null,
        device.osVersion ?? null,
        JSON.stringify(device.capabilities),
        device.pushTokenRegistered,
        device.deviceSessionId,
        pairingCode ?? null,
        status,
        now,
        status === "revoked" ? now : null
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Mobile device upsert did not return a row.");
    }
    return deviceFromRow(row);
  }

  async listDevices(subjectId: string): Promise<MobileDeviceRecord[]> {
    const result = await this.pool.query<MobileDeviceRow>(
      `SELECT * FROM cop_mobile_devices
      WHERE subject_id = $1
      ORDER BY last_seen_at DESC`,
      [subjectId]
    );
    return result.rows.map(deviceFromRow);
  }

  async revokeDevice(subjectId: string, deviceId: string, now: string): Promise<MobileDeviceRecord | null> {
    const result = await this.pool.query<MobileDeviceRow>(
      `UPDATE cop_mobile_devices
      SET status = 'revoked',
        revoked_at = $3,
        last_seen_at = $3
      WHERE subject_id = $1 AND device_id = $2
      RETURNING *`,
      [subjectId, deviceId, now]
    );
    return result.rows[0] ? deviceFromRow(result.rows[0]) : null;
  }

  diagnostics(): string | undefined {
    return this.lastIdleClientError ? `last idle client error: ${this.lastIdleClientError}` : undefined;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function createPairingCode(): string {
  return randomBytes(18).toString("base64url");
}

function deviceKey(subjectId: string, deviceId: string): string {
  return `${subjectId}:${deviceId}`;
}

function normalizePairingSessionExpiry(session: MobilePairingSessionRecord | null, now: string): MobilePairingSessionRecord | null {
  if (!session || session.status !== "pending" && session.status !== "claimed") {
    return session;
  }
  return Date.parse(session.expiresAt) <= Date.parse(now)
    ? { ...session, status: "expired" }
    : session;
}

async function expirePairingSessions(pool: PgPool, now: string): Promise<void> {
  await pool.query(
    `UPDATE cop_mobile_pairing_sessions
    SET status = 'expired'
    WHERE status IN ('pending', 'claimed') AND expires_at <= $1`,
    [now]
  );
}

interface MobileDeviceRow extends QueryResultRow {
  app_version: string;
  build_number: string | null;
  capabilities: unknown;
  device_id: string;
  device_model: string | null;
  device_session_id: string;
  last_seen_at: Date;
  matrix_device_id: string | null;
  os_version: string | null;
  paired_at: Date;
  pairing_code: string | null;
  platform: MobilePlatform;
  push_token_registered: boolean;
  revoked_at: Date | null;
  status: MobileDeviceStatus;
  subject_id: string;
}

interface MobilePairingSessionRow extends QueryResultRow {
  claimed_at: Date | null;
  claimed_by_display_name: string | null;
  claimed_by_subject_id: string | null;
  claimed_by_username: string | null;
  code: string;
  confirmed_at: Date | null;
  created_at: Date;
  created_by_display_name: string;
  created_by_subject_id: string;
  created_by_username: string;
  device_payload: unknown;
  expires_at: Date;
  status: MobilePairingSessionStatus;
}

function deviceFromRow(row: MobileDeviceRow): MobileDeviceRecord {
  return {
    appVersion: row.app_version,
    ...(row.build_number ? { buildNumber: row.build_number } : {}),
    capabilities: Array.isArray(row.capabilities) ? row.capabilities.filter((item): item is string => typeof item === "string") : [],
    deviceId: row.device_id,
    ...(row.device_model ? { deviceModel: row.device_model } : {}),
    deviceSessionId: row.device_session_id,
    lastSeenAt: row.last_seen_at.toISOString(),
    ...(row.matrix_device_id ? { matrixDeviceId: row.matrix_device_id } : {}),
    ...(row.os_version ? { osVersion: row.os_version } : {}),
    pairedAt: row.paired_at.toISOString(),
    ...(row.pairing_code ? { pairingCode: row.pairing_code } : {}),
    platform: row.platform,
    pushTokenRegistered: row.push_token_registered,
    ...(row.revoked_at ? { revokedAt: row.revoked_at.toISOString() } : {}),
    status: row.status,
    subjectId: row.subject_id,
    registeredAt: row.paired_at.toISOString()
  };
}

function pairingSessionFromRow(row: MobilePairingSessionRow): MobilePairingSessionRecord {
  const claimedDevice = normalizeDevicePayload(row.device_payload);
  return {
    ...(row.claimed_at ? { claimedAt: row.claimed_at.toISOString() } : {}),
    ...(row.claimed_by_subject_id && row.claimed_by_username && row.claimed_by_display_name ? {
      claimedBy: {
        displayName: row.claimed_by_display_name,
        subjectId: row.claimed_by_subject_id,
        username: row.claimed_by_username
      }
    } : {}),
    ...(claimedDevice ? { claimedDevice } : {}),
    code: row.code,
    ...(row.confirmed_at ? { confirmedAt: row.confirmed_at.toISOString() } : {}),
    createdAt: row.created_at.toISOString(),
    createdBy: {
      displayName: row.created_by_display_name,
      subjectId: row.created_by_subject_id,
      username: row.created_by_username
    },
    expiresAt: row.expires_at.toISOString(),
    status: row.status
  };
}

function normalizeDevicePayload(value: unknown): MobileDeviceRegistrationInput | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const deviceId = typeof value.deviceId === "string" ? value.deviceId : undefined;
  const subjectId = typeof value.subjectId === "string" ? value.subjectId : undefined;
  const appVersion = typeof value.appVersion === "string" ? value.appVersion : undefined;
  const deviceSessionId = typeof value.deviceSessionId === "string" ? value.deviceSessionId : undefined;
  const platform = value.platform === "ios" || value.platform === "ipados" ? value.platform : undefined;
  if (!deviceId || !subjectId || !appVersion || !deviceSessionId || !platform) {
    return undefined;
  }
  return {
    appVersion,
    ...(typeof value.buildNumber === "string" ? { buildNumber: value.buildNumber } : {}),
    capabilities: Array.isArray(value.capabilities) ? value.capabilities.filter((item): item is string => typeof item === "string") : [],
    deviceId,
    ...(typeof value.deviceModel === "string" ? { deviceModel: value.deviceModel } : {}),
    deviceSessionId,
    ...(typeof value.matrixDeviceId === "string" ? { matrixDeviceId: value.matrixDeviceId } : {}),
    ...(typeof value.osVersion === "string" ? { osVersion: value.osVersion } : {}),
    platform,
    pushTokenRegistered: value.pushTokenRegistered === true,
    registeredAt: typeof value.registeredAt === "string" ? value.registeredAt : new Date(0).toISOString(),
    subjectId
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const createMobileDeviceTablesSql = `
CREATE TABLE IF NOT EXISTS cop_mobile_pairing_sessions (
  code text PRIMARY KEY,
  created_by_subject_id text NOT NULL,
  created_by_username text NOT NULL,
  created_by_display_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'claimed', 'confirmed', 'expired', 'revoked')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  claimed_by_subject_id text,
  claimed_by_username text,
  claimed_by_display_name text,
  claimed_device_id text,
  confirmed_at timestamptz,
  device_payload jsonb
);

CREATE INDEX IF NOT EXISTS cop_mobile_pairing_sessions_created_by_idx
  ON cop_mobile_pairing_sessions (created_by_subject_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cop_mobile_devices (
  subject_id text NOT NULL,
  device_id text NOT NULL,
  matrix_device_id text,
  platform text NOT NULL CHECK (platform IN ('ios', 'ipados')),
  app_version text NOT NULL,
  build_number text,
  device_model text,
  os_version text,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  push_token_registered boolean NOT NULL DEFAULT false,
  device_session_id text NOT NULL,
  pairing_code text,
  status text NOT NULL CHECK (status IN ('paired', 'revoked')),
  paired_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (subject_id, device_id)
);

CREATE INDEX IF NOT EXISTS cop_mobile_devices_subject_status_idx
  ON cop_mobile_devices (subject_id, status, last_seen_at DESC);
`;

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readSslConfig(env: Record<string, string | undefined>): PoolConfig["ssl"] {
  const mode = env.COP_DATABASE_SSL?.trim().toLowerCase();
  if (!mode || mode === "false" || mode === "0" || mode === "disable") {
    return undefined;
  }
  if (mode === "true" || mode === "1" || mode === "require") {
    return { rejectUnauthorized: env.COP_DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" };
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
