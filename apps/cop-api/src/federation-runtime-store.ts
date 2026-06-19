import pg, { type Pool as PgPool, type PoolConfig, type QueryResultRow } from "pg";
import {
  buildDomainDeadLetterRecord,
  buildDomainEventRecord,
  createDefaultFederatedNodes,
  type DomainDeadLetterRecord,
  type DomainEventChannel,
  type DomainEventPublishInput,
  type DomainEventPublishResult,
  type DomainEventRecord,
  type DomainEventReplayQuery,
  type DomainEventType,
  type FederatedNodeHealth,
  type FederatedNodeRecord,
  type FederatedNodeRole,
  type PilotClassificationLevel
} from "./federation.js";

const { Pool } = pg;

export interface DomainEventReplayResult {
  items: DomainEventRecord[];
  totalAvailable: number;
}

export interface DomainDeadLetterQueryResult {
  items: DomainDeadLetterRecord[];
  totalAvailable: number;
}

export interface FederationRuntimeStore {
  readonly name: string;
  appendDeadLetter(input: {
    body: unknown;
    channel?: DomainEventChannel;
    correlationId: string;
    errorCode: string;
    message: string;
    now?: Date;
  }): Promise<DomainDeadLetterRecord>;
  close(): Promise<void>;
  countDeadLetters(): Promise<number>;
  countEvents(): Promise<number>;
  diagnostics?(): string | undefined;
  getNode(nodeId: string): Promise<FederatedNodeRecord | null>;
  init(defaultNodes?: FederatedNodeRecord[]): Promise<void>;
  listDeadLetters(limit: number): Promise<DomainDeadLetterQueryResult>;
  listNodes(): Promise<FederatedNodeRecord[]>;
  publishEvent(input: DomainEventPublishInput, now?: Date): Promise<DomainEventPublishResult>;
  queryEvents(query: DomainEventReplayQuery): Promise<DomainEventReplayResult>;
  upsertNode(node: FederatedNodeRecord): Promise<void>;
}

export function createFederationRuntimeStoreFromEnv(env: Record<string, string | undefined> = process.env): FederationRuntimeStore | undefined {
  const mode = (env.COP_FEDERATION_STORE ?? "auto").trim().toLowerCase();
  const connectionString = env.COP_DATABASE_URL?.trim();

  if (mode === "disabled" || mode === "memory" || mode === "off") {
    return undefined;
  }
  if (mode === "auto" && !connectionString) {
    return undefined;
  }
  if ((mode === "auto" || mode === "postgres" || mode === "postgresql") && connectionString) {
    return new PostgresFederationRuntimeStore({
      connectionString,
      connectionTimeoutMillis: readPositiveInteger(env.COP_DATABASE_CONNECT_TIMEOUT_MS, 5000),
      idleTimeoutMillis: readPositiveInteger(env.COP_DATABASE_IDLE_TIMEOUT_MS, 30000),
      max: readPositiveInteger(env.COP_DATABASE_POOL_MAX, 5),
      ssl: readSslConfig(env)
    });
  }

  throw new Error(`Unsupported COP_FEDERATION_STORE value: ${mode}`);
}

export class PostgresFederationRuntimeStore implements FederationRuntimeStore {
  readonly name = "postgres";
  private lastIdleClientError: string | undefined;
  private readonly pool: PgPool;

  constructor(config: PoolConfig) {
    this.pool = new Pool(config);
    this.pool.on("error", (error) => {
      this.lastIdleClientError = errorMessage(error);
    });
  }

  async init(defaultNodes: FederatedNodeRecord[] = Array.from(createDefaultFederatedNodes().values())): Promise<void> {
    await this.pool.query(createFederationRuntimeTablesSql);
    for (const node of defaultNodes) {
      await this.upsertNode(node);
    }
  }

  async listNodes(): Promise<FederatedNodeRecord[]> {
    const result = await this.pool.query<FederatedNodeRow>(
      `SELECT node_id, node_role, node_name, health, classification_max, capabilities, software_version, detail, last_seen_at, node_json
      FROM cop_federation_nodes
      ORDER BY node_id ASC`
    );
    return result.rows.map(nodeFromRow);
  }

  async getNode(nodeId: string): Promise<FederatedNodeRecord | null> {
    const result = await this.pool.query<FederatedNodeRow>(
      `SELECT node_id, node_role, node_name, health, classification_max, capabilities, software_version, detail, last_seen_at, node_json
      FROM cop_federation_nodes
      WHERE node_id = $1`,
      [nodeId]
    );
    const row = result.rows[0];
    return row ? nodeFromRow(row) : null;
  }

  async upsertNode(node: FederatedNodeRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO cop_federation_nodes (
        node_id, node_role, node_name, health, classification_max, capabilities,
        software_version, detail, last_seen_at, node_json
      )
      VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9::timestamptz, $10::jsonb)
      ON CONFLICT (node_id) DO UPDATE SET
        node_role = EXCLUDED.node_role,
        node_name = EXCLUDED.node_name,
        health = EXCLUDED.health,
        classification_max = EXCLUDED.classification_max,
        capabilities = EXCLUDED.capabilities,
        software_version = EXCLUDED.software_version,
        detail = EXCLUDED.detail,
        last_seen_at = EXCLUDED.last_seen_at,
        node_json = EXCLUDED.node_json,
        updated_at = now()`,
      [
        node.nodeId,
        node.nodeRole,
        node.nodeName,
        node.health,
        node.classificationMax,
        node.capabilities,
        node.softwareVersion,
        node.detail ?? null,
        node.lastSeenAt,
        JSON.stringify(node)
      ]
    );
  }

  async publishEvent(input: DomainEventPublishInput, now: Date = new Date()): Promise<DomainEventPublishResult> {
    const event = buildDomainEventRecord(input, 0, now);
    const inserted = await this.pool.query<DomainEventRow>(
      `INSERT INTO cop_domain_events (
        event_id, event_type, channel, producer_node_id, entity_type, entity_id,
        event_time, received_at, source, subject, event_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9, $10, $11::jsonb)
      ON CONFLICT (event_id) DO NOTHING
      RETURNING replay_offset, event_id, event_type, channel, producer_node_id, entity_type, entity_id,
        event_time, received_at, source, subject, event_json`,
      [
        event.id,
        event.type,
        event.channel,
        event.data.producerNodeId,
        event.data.entityType,
        event.data.entityId,
        event.time,
        event.receivedAt,
        event.source,
        event.subject ?? null,
        JSON.stringify(event)
      ]
    );
    const insertedRow = inserted.rows[0];
    if (insertedRow) {
      return { duplicate: false, event: eventFromRow(insertedRow) };
    }

    const existing = await this.pool.query<DomainEventRow>(
      `SELECT replay_offset, event_id, event_type, channel, producer_node_id, entity_type, entity_id,
        event_time, received_at, source, subject, event_json
      FROM cop_domain_events
      WHERE event_id = $1`,
      [event.id]
    );
    const existingRow = existing.rows[0];
    if (!existingRow) {
      throw new Error(`Domain event ${event.id} was neither inserted nor found after conflict handling.`);
    }
    return { duplicate: true, event: eventFromRow(existingRow) };
  }

  async queryEvents(query: DomainEventReplayQuery): Promise<DomainEventReplayResult> {
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (query.fromOffset !== undefined) {
      clauses.push(`replay_offset > ${addParam(params, query.fromOffset)}`);
    }
    if (query.type) {
      clauses.push(`event_type = ${addParam(params, query.type)}`);
    }
    if (query.entityId) {
      clauses.push(`entity_id = ${addParam(params, query.entityId)}`);
    }
    if (query.producerNodeId) {
      clauses.push(`producer_node_id = ${addParam(params, query.producerNodeId)}`);
    }
    if (query.fromTime) {
      clauses.push(`event_time >= ${addParam(params, query.fromTime)}::timestamptz`);
    }
    if (query.toTime) {
      clauses.push(`event_time <= ${addParam(params, query.toTime)}::timestamptz`);
    }
    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limitParam = addParam(params, query.limit);
    const result = await this.pool.query<DomainEventRow>(
      `SELECT replay_offset, event_id, event_type, channel, producer_node_id, entity_type, entity_id,
        event_time, received_at, source, subject, event_json
      FROM cop_domain_events
      ${whereClause}
      ORDER BY replay_offset ASC
      LIMIT ${limitParam}`,
      params
    );
    return {
      items: result.rows.map(eventFromRow),
      totalAvailable: await this.countEvents()
    };
  }

  async appendDeadLetter(input: {
    body: unknown;
    channel?: DomainEventChannel;
    correlationId: string;
    errorCode: string;
    message: string;
    now?: Date;
  }): Promise<DomainDeadLetterRecord> {
    const record = buildDomainDeadLetterRecord(input);
    await this.pool.query(
      `INSERT INTO cop_domain_dead_letters (
        dead_letter_id, channel, correlation_id, error_code, message, body_json, received_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)`,
      [
        record.deadLetterId,
        record.channel,
        record.correlationId,
        record.errorCode,
        record.message,
        JSON.stringify(record.body ?? null),
        record.receivedAt
      ]
    );
    return record;
  }

  async listDeadLetters(limit: number): Promise<DomainDeadLetterQueryResult> {
    const result = await this.pool.query<DomainDeadLetterRow>(
      `SELECT dead_letter_id, channel, correlation_id, error_code, message, body_json, received_at
      FROM cop_domain_dead_letters
      ORDER BY received_at DESC
      LIMIT $1`,
      [limit]
    );
    return {
      items: result.rows.map(deadLetterFromRow).reverse(),
      totalAvailable: await this.countDeadLetters()
    };
  }

  async countEvents(): Promise<number> {
    const result = await this.pool.query<{ count: string }>("SELECT count(*)::text AS count FROM cop_domain_events");
    return Number(result.rows[0]?.count ?? 0);
  }

  async countDeadLetters(): Promise<number> {
    const result = await this.pool.query<{ count: string }>("SELECT count(*)::text AS count FROM cop_domain_dead_letters");
    return Number(result.rows[0]?.count ?? 0);
  }

  diagnostics(): string | undefined {
    return this.lastIdleClientError ? `last idle client error: ${this.lastIdleClientError}` : undefined;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

interface FederatedNodeRow extends QueryResultRow {
  capabilities: string[] | string;
  classification_max: PilotClassificationLevel;
  detail: string | null;
  health: FederatedNodeHealth;
  last_seen_at: Date | string;
  node_id: string;
  node_json: FederatedNodeRecord | string;
  node_name: string;
  node_role: FederatedNodeRole;
  software_version: string;
}

interface DomainEventRow extends QueryResultRow {
  channel: DomainEventChannel;
  entity_id: string;
  entity_type: string;
  event_id: string;
  event_json: DomainEventRecord | string;
  event_time: Date | string;
  event_type: DomainEventType;
  producer_node_id: string;
  received_at: Date | string;
  replay_offset: number | string;
  source: string;
  subject: string | null;
}

interface DomainDeadLetterRow extends QueryResultRow {
  body_json: unknown;
  channel: DomainEventChannel;
  correlation_id: string;
  dead_letter_id: string;
  error_code: string;
  message: string;
  received_at: Date | string;
}

const createFederationRuntimeTablesSql = `
CREATE TABLE IF NOT EXISTS cop_federation_nodes (
  node_id text PRIMARY KEY,
  node_role text NOT NULL,
  node_name text NOT NULL,
  health text NOT NULL,
  classification_max text NOT NULL,
  capabilities text[] NOT NULL DEFAULT '{}',
  software_version text NOT NULL,
  detail text,
  last_seen_at timestamptz NOT NULL,
  node_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cop_federation_nodes_role_idx
  ON cop_federation_nodes (node_role);

CREATE INDEX IF NOT EXISTS cop_federation_nodes_health_idx
  ON cop_federation_nodes (health);

CREATE TABLE IF NOT EXISTS cop_domain_events (
  replay_offset bigserial PRIMARY KEY,
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  channel text NOT NULL,
  producer_node_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  event_time timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  source text NOT NULL,
  subject text,
  event_json jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS cop_domain_events_type_offset_idx
  ON cop_domain_events (event_type, replay_offset);

CREATE INDEX IF NOT EXISTS cop_domain_events_entity_offset_idx
  ON cop_domain_events (entity_id, replay_offset);

CREATE INDEX IF NOT EXISTS cop_domain_events_producer_offset_idx
  ON cop_domain_events (producer_node_id, replay_offset);

CREATE INDEX IF NOT EXISTS cop_domain_events_time_idx
  ON cop_domain_events (event_time DESC);

CREATE TABLE IF NOT EXISTS cop_domain_dead_letters (
  dead_letter_id uuid PRIMARY KEY,
  channel text NOT NULL,
  correlation_id text NOT NULL,
  error_code text NOT NULL,
  message text NOT NULL,
  body_json jsonb NOT NULL,
  received_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS cop_domain_dead_letters_received_idx
  ON cop_domain_dead_letters (received_at DESC);

CREATE INDEX IF NOT EXISTS cop_domain_dead_letters_error_idx
  ON cop_domain_dead_letters (error_code, received_at DESC);
`;

function nodeFromRow(row: FederatedNodeRow): FederatedNodeRecord {
  const nodeJson = typeof row.node_json === "string" ? JSON.parse(row.node_json) as Partial<FederatedNodeRecord> : row.node_json;
  const detail = row.detail ?? nodeJson.detail;
  return {
    capabilities: Array.isArray(row.capabilities) ? row.capabilities : parsePostgresArray(row.capabilities),
    classificationMax: row.classification_max,
    contractVersion: "cop-federation-node-v1",
    ...(detail ? { detail } : {}),
    health: row.health,
    lastSeenAt: isoString(row.last_seen_at),
    nodeId: row.node_id,
    nodeName: row.node_name,
    nodeRole: row.node_role,
    softwareVersion: row.software_version
  };
}

function eventFromRow(row: DomainEventRow): DomainEventRecord {
  const parsed = typeof row.event_json === "string" ? JSON.parse(row.event_json) as DomainEventRecord : row.event_json;
  const base: DomainEventRecord = {
    ...parsed,
    channel: row.channel,
    id: row.event_id,
    receivedAt: isoString(row.received_at),
    replayOffset: Number(row.replay_offset),
    source: row.source,
    time: isoString(row.event_time),
    type: row.event_type
  };
  const { subject: _subject, ...withoutSubject } = base;
  return row.subject ? { ...withoutSubject, subject: row.subject } : withoutSubject;
}

function deadLetterFromRow(row: DomainDeadLetterRow): DomainDeadLetterRecord {
  return {
    body: row.body_json,
    channel: row.channel,
    correlationId: row.correlation_id,
    deadLetterId: row.dead_letter_id,
    errorCode: row.error_code,
    message: row.message,
    receivedAt: isoString(row.received_at)
  };
}

function addParam(params: unknown[], value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parsePostgresArray(value: string): string[] {
  return value
    .replace(/^\{|\}$/gu, "")
    .split(",")
    .map((item) => item.trim().replace(/^"|"$/gu, ""))
    .filter(Boolean);
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
