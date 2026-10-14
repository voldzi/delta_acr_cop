import { type Pool as PgPool, type PoolConfig, type QueryResultRow, type PoolClient } from "pg";
import { createCopPgPool } from "./cop-pg-pool.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { assertProjectionPayloadAllowed, fenceProjectionResources, loadProjectionFences, projectionPayloadMatch, projectionReferences, projectionSearchPatterns,
  projectionTransaction, resourceProjectionFenceTableSql, type ProjectionEraseContext, type ProjectionResources } from "./resource-projection-erasure.js";
import { requireRuntimeOwner, runtimeAssessment, runtimeSubjectHash, type RuntimeOwner, type RuntimeOwnerAssessment } from "./runtime-owner-erasure.js";
import { ContentErasureStoreError } from "./content-erasure.js";
import {
  buildDomainDeadLetterRecord,
  buildDomainEventRecord,
  createDefaultFederatedNodes,
  defaultReleaseScopes,
  defaultTrustDomainForRole,
  type DomainDeadLetterRecord,
  type DomainDeadLetterRedriveResult,
  type DomainEventChannel,
  type DomainEventPublishInput,
  type DomainEventPublishResult,
  type DomainEventRecord,
  type DomainEventReplayQuery,
  type DomainEventType,
  type EdgeReplayCursorRecord,
  type FederatedNodeHealth,
  type FederatedNodeRecord,
  type FederatedNodeRole,
  type PilotClassificationLevel
} from "./federation.js";

export interface DomainEventReplayResult {
  items: DomainEventRecord[];
  totalAvailable: number;
}

export interface DomainDeadLetterQueryResult {
  items: DomainDeadLetterRecord[];
  totalAvailable: number;
}
/** Internal witness from one actual PG row; never part of the REST cursor view. */
export interface EdgeReplayCursorProjection {
  cursor: EdgeReplayCursorRecord;
  owner?: RuntimeOwner;
  ownershipKnown: boolean;
}

export interface FederationRuntimeStore {
  readonly name: string;
  projectionErasureReady?(): Promise<boolean>;
  loadProjectionFences?(): ReturnType<typeof loadProjectionFences>;
  preflightActorProjections?(owner: RuntimeOwner): Promise<RuntimeOwnerAssessment>;
  eraseResourceProjections?(resources: ProjectionResources, context: ProjectionEraseContext): Promise<boolean>;
  appendDeadLetter(input: {
    body: unknown;
    owner?: RuntimeOwner;
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
  getDeadLetter(deadLetterId: string): Promise<DomainDeadLetterRecord | null>;
  getEdgeCursor(nodeId: string): Promise<EdgeReplayCursorRecord | null>;
  getEdgeCursorProjection?(nodeId: string): Promise<EdgeReplayCursorProjection | null>;
  getNode(nodeId: string): Promise<FederatedNodeRecord | null>;
  init(defaultNodes?: FederatedNodeRecord[]): Promise<void>;
  listDeadLetters(limit: number): Promise<DomainDeadLetterQueryResult>;
  listNodes(): Promise<FederatedNodeRecord[]>;
  publishEvent(input: DomainEventPublishInput, now?: Date, owner?: RuntimeOwner): Promise<DomainEventPublishResult>;
  queryEvents(query: DomainEventReplayQuery): Promise<DomainEventReplayResult>;
  redriveDeadLetter(deadLetterId: string, input: DomainEventPublishInput, options: { now?: Date; resolvedBy?: string; owner?: RuntimeOwner }): Promise<DomainDeadLetterRedriveResult>;
  resolveDeadLetter(deadLetterId: string, options: { now?: Date; resolvedBy?: string; owner?: RuntimeOwner }): Promise<DomainDeadLetterRecord | null>;
  updateEdgeCursor(input: { lastAckedOffset: number; nodeId: string; now?: Date; updatedBy?: string; owner?: RuntimeOwner }): Promise<EdgeReplayCursorRecord>;
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
  private readonly projectionClient = new AsyncLocalStorage<PoolClient>();

  constructor(config: PoolConfig) {
    this.pool = createCopPgPool("federation-runtime", config);
    this.pool.on("error", (error) => {
      this.lastIdleClientError = errorMessage(error);
    });
  }

  async init(defaultNodes: FederatedNodeRecord[] = Array.from(createDefaultFederatedNodes().values())): Promise<void> {
    await this.pool.query(resourceProjectionFenceTableSql + createFederationRuntimeTablesSql);
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
    return this.projectionTx(async client => {
      await assertProjectionPayloadAllowed(client, node, undefined);
      await client.query(
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
    });
  }

  async publishEvent(input: DomainEventPublishInput, now: Date = new Date(), owner?: RuntimeOwner): Promise<DomainEventPublishResult> {
    return this.projectionTx(async client => {
      await assertProjectionPayloadAllowed(client, input, owner);
      if (owner && input.subject && input.subject !== owner.subjectId) throw new Error("CONTENT_PROJECTION_OWNER_CONFLICT");
      const event = buildDomainEventRecord(input, 0, now);
      const inserted = await client.query<DomainEventRow>(
        `INSERT INTO cop_domain_events (
          event_id, owner_issuer, owner_subject_hash, event_type, channel, producer_node_id, entity_type, entity_id,
          event_time, received_at, source, subject, event_json
        )
        VALUES ($1, $12, $13, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9, $10, $11::jsonb)
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
          JSON.stringify(event),
          owner?.issuer ?? null,
          owner ? runtimeSubjectHash(owner.subjectId) : null
        ]
      );
      const insertedRow = inserted.rows[0];
      if (insertedRow) {
        return { duplicate: false, event: eventFromRow(insertedRow) };
      }

      const existing = await client.query<DomainEventRow & { owner_issuer: string | null; owner_subject_hash: string | null }>(
        `SELECT replay_offset, event_id, owner_issuer, owner_subject_hash, event_type, channel, producer_node_id, entity_type, entity_id,
          event_time, received_at, source, subject, event_json
        FROM cop_domain_events
        WHERE event_id = $1`,
        [event.id]
      );
      const existingRow = existing.rows[0];
      if (!existingRow) {
        throw new Error(`Domain event ${event.id} was neither inserted nor found after conflict handling.`);
      }
      // A duplicate is a read of the immutable original row. Today's caller
      // must never turn a cold legacy/foreign row into a newly attested record.
      if (owner && (existingRow.owner_issuer !== owner.issuer || existingRow.owner_subject_hash !== runtimeSubjectHash(owner.subjectId))) {
        throw new ContentErasureStoreError(503, "CONTENT_PROJECTION_UNAVAILABLE");
      }
      return { duplicate: true, event: eventFromRow(existingRow) };
    });
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
    owner?: RuntimeOwner;
    channel?: DomainEventChannel;
    correlationId: string;
    errorCode: string;
    message: string;
    now?: Date;
  }): Promise<DomainDeadLetterRecord> {
    return this.projectionTx(async client => {
      await assertProjectionPayloadAllowed(client, input, input.owner);
      const record = buildDomainDeadLetterRecord(input);
      await client.query(
        `INSERT INTO cop_domain_dead_letters (
          dead_letter_id, owner_issuer, owner_subject_hash, channel, correlation_id, error_code, message, body_json, received_at
        )
        VALUES ($1, $8, $9, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)`,
        [
          record.deadLetterId,
          record.channel,
          record.correlationId,
          record.errorCode,
          record.message,
          JSON.stringify(record.body ?? null),
          record.receivedAt,
          input.owner?.issuer ?? null,
          input.owner ? runtimeSubjectHash(input.owner.subjectId) : null
        ]
      );
      return record;
    });
  }

  async listDeadLetters(limit: number): Promise<DomainDeadLetterQueryResult> {
    const result = await this.pool.query<DomainDeadLetterRow>(
      `SELECT dead_letter_id, channel, correlation_id, error_code, message, body_json, received_at,
        status, retry_count, retry_last_at, retry_last_event_id, resolved_at, resolved_by
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

  async getDeadLetter(deadLetterId: string): Promise<DomainDeadLetterRecord | null> {
    const result = await this.pool.query<DomainDeadLetterRow>(
      `SELECT dead_letter_id, channel, correlation_id, error_code, message, body_json, received_at,
        status, retry_count, retry_last_at, retry_last_event_id, resolved_at, resolved_by
      FROM cop_domain_dead_letters
      WHERE dead_letter_id = $1`,
      [deadLetterId]
    );
    const row = result.rows[0];
    return row ? deadLetterFromRow(row) : null;
  }

  async redriveDeadLetter(
    deadLetterId: string,
    input: DomainEventPublishInput,
    options: { now?: Date; resolvedBy?: string; owner?: RuntimeOwner }
  ): Promise<DomainDeadLetterRedriveResult> {
    return this.projectionTx(async client => {
      await assertProjectionPayloadAllowed(client, { input, resolvedBy: options.resolvedBy }, options.owner);
      if (options.owner && options.resolvedBy !== options.owner.subjectId) throw new Error("CONTENT_PROJECTION_OWNER_CONFLICT");
      const result = await this.publishEvent(input, options.now);
      const timestamp = (options.now ?? new Date()).toISOString();
      const updated = await client.query<DomainDeadLetterRow>(
        `UPDATE cop_domain_dead_letters
        SET status = 'redriven',
          retry_count = retry_count + 1,
          retry_last_at = $2::timestamptz,
          retry_last_event_id = $3,
          resolved_at = COALESCE(resolved_at, $2::timestamptz),
          resolved_by_issuer = CASE WHEN resolved_by IS NULL THEN $5 ELSE resolved_by_issuer END,
          resolved_by = COALESCE(resolved_by, $4)
        WHERE dead_letter_id = $1
        RETURNING dead_letter_id, channel, correlation_id, error_code, message, body_json, received_at,
          status, retry_count, retry_last_at, retry_last_event_id, resolved_at, resolved_by`,
        [deadLetterId, timestamp, result.event.id, options.resolvedBy ?? null, options.owner?.issuer ?? null]
      );
      const row = updated.rows[0];
      if (!row) {
        throw new Error(`Dead-letter ${deadLetterId} was not found during re-drive.`);
      }
      return {
        deadLetter: deadLetterFromRow(row),
        event: result.event,
        status: result.duplicate ? "duplicate" : "redriven"
      };
    });
  }

  async resolveDeadLetter(deadLetterId: string, options: { now?: Date; resolvedBy?: string; owner?: RuntimeOwner }): Promise<DomainDeadLetterRecord | null> {
    return this.projectionTx(async client => {
      await assertProjectionPayloadAllowed(client, { resolvedBy: options.resolvedBy }, options.owner);
      if (options.owner && options.resolvedBy !== options.owner.subjectId) throw new Error("CONTENT_PROJECTION_OWNER_CONFLICT");
      const timestamp = (options.now ?? new Date()).toISOString();
      const result = await client.query<DomainDeadLetterRow>(
        `UPDATE cop_domain_dead_letters
        SET status = 'resolved',
          resolved_at = COALESCE(resolved_at, $2::timestamptz),
          resolved_by_issuer = CASE WHEN resolved_by IS NULL THEN $4 ELSE resolved_by_issuer END,
          resolved_by = COALESCE(resolved_by, $3)
        WHERE dead_letter_id = $1
        RETURNING dead_letter_id, channel, correlation_id, error_code, message, body_json, received_at,
          status, retry_count, retry_last_at, retry_last_event_id, resolved_at, resolved_by`,
        [deadLetterId, timestamp, options.resolvedBy ?? null, options.owner?.issuer ?? null]
      );
      const row = result.rows[0];
      return row ? deadLetterFromRow(row) : null;
    });
  }

  async getEdgeCursor(nodeId: string): Promise<EdgeReplayCursorRecord | null> {
    const result = await this.pool.query<EdgeReplayCursorRow>(
      `SELECT node_id, last_acked_offset, acked_at, last_replay_at, updated_by
      FROM cop_edge_replay_cursors
      WHERE node_id = $1`,
      [nodeId]
    );
    const row = result.rows[0];
    return row ? edgeCursorFromRow(row) : null;
  }
  async getEdgeCursorProjection(nodeId: string): Promise<EdgeReplayCursorProjection | null> {
    const result = await this.pool.query<EdgeReplayCursorRow & { owner_issuer: string | null }>(
      "SELECT node_id,last_acked_offset,acked_at,last_replay_at,updated_by,owner_issuer FROM cop_edge_replay_cursors WHERE node_id=$1", [nodeId]);
    const row = result.rows[0];
    if (!row) return null;
    const owner = row.updated_by && row.owner_issuer ? { issuer: row.owner_issuer, subjectId: row.updated_by } : undefined;
    if (owner) requireRuntimeOwner(owner);
    return { cursor: edgeCursorFromRow(row), ownershipKnown: !row.updated_by || !!owner, ...(owner ? { owner } : {}) };
  }

  async updateEdgeCursor(input: { lastAckedOffset: number; nodeId: string; now?: Date; updatedBy?: string; owner?: RuntimeOwner }): Promise<EdgeReplayCursorRecord> {
    return this.projectionTx(async client => {
      await assertProjectionPayloadAllowed(client, input, input.owner);
      if (input.owner && input.updatedBy !== input.owner.subjectId) throw new Error("CONTENT_PROJECTION_OWNER_CONFLICT");
      const timestamp = (input.now ?? new Date()).toISOString();
      const result = await client.query<EdgeReplayCursorRow>(
        `INSERT INTO cop_edge_replay_cursors (node_id, last_acked_offset, acked_at, last_replay_at, updated_by, owner_issuer)
        VALUES ($1, $2, $3::timestamptz, $3::timestamptz, $4, $5)
        ON CONFLICT (node_id) DO UPDATE SET
          last_acked_offset = GREATEST(cop_edge_replay_cursors.last_acked_offset, EXCLUDED.last_acked_offset),
          acked_at = CASE
            WHEN EXCLUDED.last_acked_offset >= cop_edge_replay_cursors.last_acked_offset THEN EXCLUDED.acked_at
            ELSE cop_edge_replay_cursors.acked_at
          END,
          last_replay_at = EXCLUDED.last_replay_at,
          updated_by = EXCLUDED.updated_by,
          owner_issuer = EXCLUDED.owner_issuer
        RETURNING node_id, last_acked_offset, acked_at, last_replay_at, updated_by`,
        [input.nodeId, input.lastAckedOffset, timestamp, input.updatedBy ?? null, input.owner?.issuer ?? null]
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error(`Edge replay cursor for ${input.nodeId} was not returned after acknowledgement.`);
      }
      return edgeCursorFromRow(row);
    });
  }

  async countEvents(): Promise<number> {
    const result = await this.pool.query<{ count: string }>("SELECT count(*)::text AS count FROM cop_domain_events");
    return Number(result.rows[0]?.count ?? 0);
  }

  async countDeadLetters(): Promise<number> {
    const result = await this.pool.query<{ count: string }>("SELECT count(*)::text AS count FROM cop_domain_dead_letters");
    return Number(result.rows[0]?.count ?? 0);
  }

  private projectionTx<T>(run: (client: PoolClient) => Promise<T>, exclusive = false): Promise<T> {
    const current = this.projectionClient.getStore();
    return current ? run(current) : projectionTransaction(this.pool, client => this.projectionClient.run(client, () => run(client)), exclusive);
  }
  async projectionErasureReady(): Promise<boolean> {
    await this.pool.query("SELECT 1 FROM cop_content_projection_fences LIMIT 0; SELECT owner_issuer,owner_subject_hash,event_json FROM cop_domain_events LIMIT 0; SELECT owner_issuer,owner_subject_hash,body_json FROM cop_domain_dead_letters LIMIT 0; SELECT owner_issuer FROM cop_edge_replay_cursors LIMIT 0; SELECT node_json FROM cop_federation_nodes LIMIT 0");
    return true;
  }
  loadProjectionFences(): ReturnType<typeof loadProjectionFences> { return loadProjectionFences(this.pool); }
  async preflightActorProjections(owner: RuntimeOwner): Promise<RuntimeOwnerAssessment> {
    requireRuntimeOwner(owner);
    const patterns = projectionSearchPatterns([], owner), hash = runtimeSubjectHash(owner.subjectId);
    const events = await this.pool.query<{ owner_issuer: string | null; owner_subject_hash: string | null; event_json: unknown }>("SELECT owner_issuer,owner_subject_hash,event_json FROM cop_domain_events WHERE lower(event_json::text) LIKE ANY($1::text[]) OR owner_subject_hash=$2 LIMIT 10001", [patterns, hash]);
    const dead = await this.pool.query<{ owner_issuer: string | null; owner_subject_hash: string | null; body_json: unknown }>("SELECT owner_issuer,owner_subject_hash,body_json FROM cop_domain_dead_letters WHERE lower(body_json::text) LIKE ANY($1::text[]) OR lower(message) LIKE ANY($1::text[]) OR lower(correlation_id) LIKE ANY($1::text[]) OR owner_subject_hash=$2 LIMIT 10001", [patterns, hash]);
    const resolutions = await this.pool.query<{ resolved_by_issuer: string | null }>("SELECT resolved_by_issuer FROM cop_domain_dead_letters WHERE resolved_by=$1", [owner.subjectId]);
    const cursors = await this.pool.query<{ owner_issuer: string | null }>("SELECT owner_issuer FROM cop_edge_replay_cursors WHERE updated_by=$1", [owner.subjectId]);
    const nodes = await this.pool.query("SELECT node_id FROM cop_federation_nodes WHERE lower(node_json::text) LIKE ANY($1::text[]) LIMIT 1", [patterns]);
    return { ...runtimeAssessment([events.rows, dead.rows, resolutions.rows, cursors.rows, nodes.rows]), ready: !nodes.rowCount && events.rows.length <= 10000 && dead.rows.length <= 10000 && resolutions.rows.every(row => row.resolved_by_issuer === owner.issuer) && cursors.rows.every(row => row.owner_issuer === owner.issuer) && [...events.rows, ...dead.rows].every(row => row.owner_issuer === owner.issuer && row.owner_subject_hash === hash) };
  }
  async eraseResourceProjections(resources: ProjectionResources, context: ProjectionEraseContext): Promise<boolean> {
    const refs = projectionReferences(resources), ids = refs.map(ref => ref.id), patterns = projectionSearchPatterns(refs, context.actor), hash = context.actor ? runtimeSubjectHash(context.actor.subjectId) : null;
    return this.projectionTx(async client => {
      await fenceProjectionResources(client, resources, context);
      const events = await client.query<{ event_id: string; event_json: unknown; owner_issuer: string | null; owner_subject_hash: string | null }>("SELECT event_id,event_json,owner_issuer,owner_subject_hash FROM cop_domain_events WHERE lower(entity_id)=ANY($1::text[]) OR lower(event_json::text) LIKE ANY($2::text[]) OR owner_subject_hash=$3 LIMIT 10001", [ids, patterns, hash]);
      const dead = await client.query<{ dead_letter_id: string; body_json: unknown; owner_issuer: string | null; owner_subject_hash: string | null }>("SELECT dead_letter_id,body_json,owner_issuer,owner_subject_hash FROM cop_domain_dead_letters WHERE lower(body_json::text) LIKE ANY($1::text[]) OR lower(message) LIKE ANY($1::text[]) OR lower(correlation_id) LIKE ANY($1::text[]) OR owner_subject_hash=$2 LIMIT 10001", [patterns, hash]);
      if (events.rows.length > 10000 || dead.rows.length > 10000) return false;
      let complete = true;
      for (const row of events.rows) {
        context.signal.throwIfAborted();
        const ownerCompatible = !row.owner_issuer || !!(context.actor && row.owner_issuer === context.actor.issuer && row.owner_subject_hash === hash);
        const owned = ownerCompatible && (projectionPayloadMatch(row.event_json, refs, context.actor) === "owned" || !!(context.actor && row.owner_issuer === context.actor.issuer && row.owner_subject_hash === hash));
        if (owned) await client.query("DELETE FROM cop_domain_events WHERE event_id=$1", [row.event_id]); else complete = false;
      }
      for (const row of dead.rows) {
        context.signal.throwIfAborted();
        // Raw validation failures can forge source/producer fields. Only the
        // separate actor witness written by the server establishes ownership.
        const owned = !!(context.actor && row.owner_issuer === context.actor.issuer && row.owner_subject_hash === hash);
        if (owned) await client.query("DELETE FROM cop_domain_dead_letters WHERE dead_letter_id=$1", [row.dead_letter_id]); else complete = false;
      }
      if (context.actor) await client.query("UPDATE cop_edge_replay_cursors SET updated_by=NULL,owner_issuer=NULL WHERE updated_by=$1 AND owner_issuer=$2", [context.actor.subjectId, context.actor.issuer]);
      if (context.actor) await client.query("UPDATE cop_domain_dead_letters SET resolved_by=NULL,resolved_by_issuer=NULL WHERE resolved_by=$1 AND resolved_by_issuer=$2", [context.actor.subjectId, context.actor.issuer]);
      const remaining = await client.query("SELECT 1 FROM cop_domain_events WHERE lower(entity_id)=ANY($1::text[]) OR lower(event_json::text) LIKE ANY($2::text[]) OR owner_subject_hash=$3 UNION ALL SELECT 1 FROM cop_domain_dead_letters WHERE lower(body_json::text) LIKE ANY($2::text[]) OR lower(message) LIKE ANY($2::text[]) OR lower(correlation_id) LIKE ANY($2::text[]) OR resolved_by=$4 OR owner_subject_hash=$3 UNION ALL SELECT 1 FROM cop_edge_replay_cursors WHERE updated_by=$4 UNION ALL SELECT 1 FROM cop_federation_nodes WHERE lower(node_json::text) LIKE ANY($2::text[]) LIMIT 1", [ids, patterns, hash, context.actor?.subjectId ?? null]);
      context.signal.throwIfAborted(); return complete && !remaining.rowCount;
    }, true);
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
  resolved_at: Date | string | null;
  resolved_by: string | null;
  retry_count: number | string;
  retry_last_at: Date | string | null;
  retry_last_event_id: string | null;
  status: "open" | "redriven" | "resolved";
}

interface EdgeReplayCursorRow extends QueryResultRow {
  acked_at: Date | string;
  last_acked_offset: number | string;
  last_replay_at: Date | string | null;
  node_id: string;
  updated_by: string | null;
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
  received_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open',
  retry_count integer NOT NULL DEFAULT 0,
  retry_last_at timestamptz,
  retry_last_event_id text,
  resolved_at timestamptz,
  resolved_by text
);

ALTER TABLE cop_domain_dead_letters
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open';

ALTER TABLE cop_domain_dead_letters
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;

ALTER TABLE cop_domain_dead_letters
  ADD COLUMN IF NOT EXISTS retry_last_at timestamptz;

ALTER TABLE cop_domain_dead_letters
  ADD COLUMN IF NOT EXISTS retry_last_event_id text;

ALTER TABLE cop_domain_dead_letters
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

ALTER TABLE cop_domain_dead_letters
  ADD COLUMN IF NOT EXISTS resolved_by text;

CREATE INDEX IF NOT EXISTS cop_domain_dead_letters_received_idx
  ON cop_domain_dead_letters (received_at DESC);

CREATE INDEX IF NOT EXISTS cop_domain_dead_letters_error_idx
  ON cop_domain_dead_letters (error_code, received_at DESC);

CREATE INDEX IF NOT EXISTS cop_domain_dead_letters_status_idx
  ON cop_domain_dead_letters (status, received_at DESC);

ALTER TABLE cop_domain_events ADD COLUMN IF NOT EXISTS owner_issuer text;
ALTER TABLE cop_domain_events ADD COLUMN IF NOT EXISTS owner_subject_hash text;
ALTER TABLE cop_domain_dead_letters ADD COLUMN IF NOT EXISTS owner_issuer text;
ALTER TABLE cop_domain_dead_letters ADD COLUMN IF NOT EXISTS owner_subject_hash text;
ALTER TABLE cop_domain_dead_letters ADD COLUMN IF NOT EXISTS resolved_by_issuer text;
CREATE INDEX IF NOT EXISTS cop_domain_events_owner_idx ON cop_domain_events(owner_subject_hash);
CREATE INDEX IF NOT EXISTS cop_domain_dead_letters_owner_idx ON cop_domain_dead_letters(owner_subject_hash);
CREATE TABLE IF NOT EXISTS cop_edge_replay_cursors (
  node_id text PRIMARY KEY,
  last_acked_offset bigint NOT NULL DEFAULT 0,
  acked_at timestamptz NOT NULL,
  last_replay_at timestamptz,
  updated_by text
);
ALTER TABLE cop_edge_replay_cursors ADD COLUMN IF NOT EXISTS owner_issuer text;
`;

function nodeFromRow(row: FederatedNodeRow): FederatedNodeRecord {
  const nodeJson = typeof row.node_json === "string" ? JSON.parse(row.node_json) as Partial<FederatedNodeRecord> : row.node_json;
  const detail = row.detail ?? nodeJson.detail;
  const dataEndpoints = stringArrayFromJson(nodeJson.dataEndpoints);
  const eventSubscriptions = stringArrayFromJson(nodeJson.eventSubscriptions);
  const releaseScopes = stringArrayFromJson(nodeJson.releaseScopes);
  return {
    capabilities: Array.isArray(row.capabilities) ? row.capabilities : parsePostgresArray(row.capabilities),
    classificationMax: row.classification_max,
    contractVersion: "cop-federation-node-v1",
    dataEndpoints,
    ...(detail ? { detail } : {}),
    eventSubscriptions,
    health: row.health,
    lastSeenAt: isoString(row.last_seen_at),
    ...(typeof nodeJson.mcpEndpoint === "string" && nodeJson.mcpEndpoint.trim() ? { mcpEndpoint: nodeJson.mcpEndpoint.trim() } : {}),
    nodeId: row.node_id,
    nodeName: row.node_name,
    nodeRole: row.node_role,
    nodeTrustDomain: typeof nodeJson.nodeTrustDomain === "string" && nodeJson.nodeTrustDomain.trim()
      ? nodeJson.nodeTrustDomain.trim()
      : defaultTrustDomainForRole(row.node_role),
    ...(typeof nodeJson.publicKeyRef === "string" && nodeJson.publicKeyRef.trim() ? { publicKeyRef: nodeJson.publicKeyRef.trim() } : {}),
    releaseScopes: releaseScopes.length > 0 ? releaseScopes : defaultReleaseScopes(row.node_id, row.node_role),
    softwareVersion: row.software_version
  };
}

function stringArrayFromJson(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
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
    receivedAt: isoString(row.received_at),
    ...(row.resolved_at ? { resolvedAt: isoString(row.resolved_at) } : {}),
    ...(row.resolved_by ? { resolvedBy: row.resolved_by } : {}),
    retryCount: Number(row.retry_count ?? 0),
    ...(row.retry_last_at ? { retryLastAt: isoString(row.retry_last_at) } : {}),
    ...(row.retry_last_event_id ? { retryLastEventId: row.retry_last_event_id } : {}),
    status: row.status ?? "open"
  };
}

function edgeCursorFromRow(row: EdgeReplayCursorRow): EdgeReplayCursorRecord {
  return {
    ackedAt: isoString(row.acked_at),
    lastAckedOffset: Number(row.last_acked_offset),
    ...(row.last_replay_at ? { lastReplayAt: isoString(row.last_replay_at) } : {}),
    nodeId: row.node_id,
    ...(row.updated_by ? { updatedBy: row.updated_by } : {})
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
