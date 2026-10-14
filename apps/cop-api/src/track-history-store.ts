import { type Pool as PgPool, type PoolConfig, type QueryResultRow } from "pg";
import { createCopPgPool } from "./cop-pg-pool.js";
import { assertProjectionPayloadAllowed, canonicalProjectionReference, fenceProjectionResources, loadProjectionFences, projectionPayloadMatch, projectionReferences,
  projectionSearchPatterns, projectionTransaction, resourceProjectionFenceTableSql, type ProjectionEraseContext, type ProjectionResources } from "./resource-projection-erasure.js";
import { requireRuntimeOwner, runtimeAssessment, runtimeSubjectHash, type RuntimeOwner, type RuntimeOwnerAssessment } from "./runtime-owner-erasure.js";
import type { CanonicalEventEnvelope, ObservedObject } from "@cop/canonical-model";
import { withStoredCurrentProvenance } from "./provenance.js";
import type { TrackHistoryQuery } from "./temporal-history.js";
import type { TrackHistoryPoint } from "./types.js";

export interface TrackHistoryStore {
  readonly name: string;
  projectionErasureReady?(): Promise<boolean>;
  loadProjectionFences?(): ReturnType<typeof loadProjectionFences>;
  preflightActorProjections?(owner: RuntimeOwner): Promise<RuntimeOwnerAssessment>;
  eraseResourceProjections?(resources: ProjectionResources, context: ProjectionEraseContext): Promise<boolean>;
  append(point: TrackHistoryPoint, owner?: RuntimeOwner): Promise<void>;
  close(): Promise<void>;
  countCurrent(): Promise<number>;
  count(): Promise<number>;
  diagnostics?(): string | undefined;
  init(): Promise<void>;
  loadCurrent(): Promise<ObservedObject[]>;
  query(query: TrackHistoryQuery, now: Date): Promise<Array<{ objectId: string; points: TrackHistoryPoint[] }>>;
  upsertCurrent(object: ObservedObject, event: CanonicalEventEnvelope, owner?: RuntimeOwner): Promise<void>;
}

export function createTrackHistoryStoreFromEnv(env: Record<string, string | undefined> = process.env): TrackHistoryStore | undefined {
  const mode = (env.COP_TRACK_HISTORY_STORE ?? "auto").trim().toLowerCase();
  const connectionString = env.COP_DATABASE_URL?.trim();

  if (mode === "memory" || mode === "disabled") {
    return undefined;
  }
  if (mode === "auto" && !connectionString) {
    return undefined;
  }
  if ((mode === "auto" || mode === "postgres" || mode === "postgresql") && connectionString) {
    return new PostgresTrackHistoryStore({
      connectionString,
      connectionTimeoutMillis: readPositiveInteger(env.COP_DATABASE_CONNECT_TIMEOUT_MS, 5000),
      idleTimeoutMillis: readPositiveInteger(env.COP_DATABASE_IDLE_TIMEOUT_MS, 30000),
      max: readPositiveInteger(env.COP_DATABASE_POOL_MAX, 5),
      ssl: readSslConfig(env)
    });
  }

  throw new Error(`Unsupported COP_TRACK_HISTORY_STORE value: ${mode}`);
}

export class PostgresTrackHistoryStore implements TrackHistoryStore {
  readonly name = "postgres";
  private lastIdleClientError: string | undefined;
  private readonly pool: PgPool;

  constructor(config: PoolConfig) {
    this.pool = createCopPgPool("track-history", config);
    this.pool.on("error", (error) => {
      this.lastIdleClientError = errorMessage(error);
    });
  }

  async init(): Promise<void> {
    await this.pool.query(resourceProjectionFenceTableSql + createPersistenceTablesSql);
  }

  async append(point: TrackHistoryPoint, owner?: RuntimeOwner): Promise<void> {
    await projectionTransaction(this.pool, async client => {
      await assertProjectionPayloadAllowed(client, point, owner);
      await client.query(
        `INSERT INTO cop_track_history (
          event_id,
          owner_issuer,
          owner_subject_hash,
          object_id,
          object_type,
          affiliation,
          status,
          lat,
          lon,
          observed_at,
          producer_timestamp,
          ingest_timestamp,
          source_system_id,
          synthetic,
          confidence
        )
        VALUES ($1, $14, $15, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10::timestamptz, $11, $12, $13)
        ON CONFLICT (event_id) DO NOTHING`,
        [
          point.eventId,
          point.objectId,
          point.objectType,
          point.affiliation,
          point.status,
          point.lat,
          point.lon,
          point.timestamp,
          point.producerTimestamp,
          point.ingestTimestamp ?? null,
          point.sourceSystemId,
          point.synthetic,
          point.confidence ?? null,
          owner?.issuer ?? null,
          owner ? runtimeSubjectHash(owner.subjectId) : null
        ]
      );
    });
  }

  async query(query: TrackHistoryQuery, now: Date): Promise<Array<{ objectId: string; points: TrackHistoryPoint[] }>> {
    const params: unknown[] = [];
    const clauses: string[] = [];
    const requestedObjectIds = query.objectIds?.filter(Boolean);
    if (requestedObjectIds && requestedObjectIds.length > 0) {
      clauses.push(`object_id = ANY(${addParam(params, requestedObjectIds)}::text[])`);
    }

    const effectiveFrom = effectiveFromIso(query, now);
    if (effectiveFrom) {
      clauses.push(`observed_at >= ${addParam(params, effectiveFrom)}::timestamptz`);
    }

    if (query.to) {
      clauses.push(`observed_at <= ${addParam(params, query.to)}::timestamptz`);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limitParam = addParam(params, resolveLimit(query));
    const result = await this.pool.query<TrackHistoryRow>(
      `WITH ranked AS (
        SELECT
          event_id,
          object_id,
          object_type,
          affiliation,
          status,
          lat,
          lon,
          observed_at,
          producer_timestamp,
          ingest_timestamp,
          source_system_id,
          synthetic,
          confidence,
          row_number() OVER (PARTITION BY object_id ORDER BY observed_at DESC, created_at DESC) AS rn
        FROM cop_track_history
        ${whereClause}
      )
      SELECT *
      FROM ranked
      WHERE rn <= ${limitParam}
      ORDER BY object_id ASC, observed_at ASC`,
      params
    );

    const grouped = new Map<string, TrackHistoryPoint[]>();
    for (const row of result.rows) {
      const points = grouped.get(row.object_id) ?? [];
      points.push(trackHistoryPointFromRow(row));
      grouped.set(row.object_id, points);
    }
    return Array.from(grouped.entries()).map(([objectId, points]) => ({ objectId, points }));
  }

  async count(): Promise<number> {
    const result = await this.pool.query<{ count: string }>("SELECT count(*)::text AS count FROM cop_track_history");
    return Number(result.rows[0]?.count ?? 0);
  }

  async upsertCurrent(object: ObservedObject, event: CanonicalEventEnvelope, owner?: RuntimeOwner): Promise<void> {
    await projectionTransaction(this.pool, async client => {
      await assertProjectionPayloadAllowed(client, { object, event }, owner);
      const existing = await client.query<{ owner_issuer: string | null; owner_subject_hash: string | null }>("SELECT owner_issuer,owner_subject_hash FROM cop_current_tracks WHERE object_id=$1", [object.objectId]);
      if (existing.rows[0]?.owner_issuer && (existing.rows[0].owner_issuer !== owner?.issuer || existing.rows[0].owner_subject_hash !== (owner ? runtimeSubjectHash(owner.subjectId) : null))) throw new Error("CONTENT_PROJECTION_OWNER_CONFLICT");
      await client.query(
        `INSERT INTO cop_current_tracks (
          object_id,
          owner_issuer,
          owner_subject_hash,
          object_type,
          affiliation,
          domain,
          status,
          object_json,
          event_id,
          source_system_id,
          last_updated_at,
          synthetic,
          confidence
        )
        VALUES ($1, $12, $13, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::timestamptz, $10, $11)
        ON CONFLICT (object_id) DO UPDATE SET
          object_type = EXCLUDED.object_type,
          affiliation = EXCLUDED.affiliation,
          domain = EXCLUDED.domain,
          status = EXCLUDED.status,
          object_json = EXCLUDED.object_json,
          event_id = EXCLUDED.event_id,
          source_system_id = EXCLUDED.source_system_id,
          last_updated_at = EXCLUDED.last_updated_at,
          synthetic = EXCLUDED.synthetic,
          confidence = EXCLUDED.confidence,
          updated_at = now()
        WHERE cop_current_tracks.last_updated_at <= EXCLUDED.last_updated_at`,
        [
          object.objectId,
          object.objectType,
          object.affiliation,
          object.domain,
          object.status,
          JSON.stringify(object),
          event.eventId,
          event.source.sourceSystemId,
          object.lastUpdatedAt ?? event.ingestTimestamp ?? event.producerTimestamp,
          object.synthetic ?? false,
          object.confidence ?? null,
          owner?.issuer ?? null,
          owner ? runtimeSubjectHash(owner.subjectId) : null
        ]
      );
    });
  }

  async loadCurrent(): Promise<ObservedObject[]> {
    const result = await this.pool.query<CurrentTrackRow>(
      `SELECT event_id, last_updated_at, object_json, source_system_id, synthetic
      FROM cop_current_tracks
      ORDER BY last_updated_at DESC`
    );
    return result.rows.map(observedObjectFromCurrentRow);
  }

  async countCurrent(): Promise<number> {
    const result = await this.pool.query<{ count: string }>("SELECT count(*)::text AS count FROM cop_current_tracks");
    return Number(result.rows[0]?.count ?? 0);
  }

  async projectionErasureReady(): Promise<boolean> {
    await this.pool.query("SELECT 1 FROM cop_content_projection_fences LIMIT 0; SELECT owner_issuer,owner_subject_hash,object_json FROM cop_current_tracks LIMIT 0; SELECT owner_issuer,owner_subject_hash FROM cop_track_history LIMIT 0"); return true;
  }
  loadProjectionFences(): ReturnType<typeof loadProjectionFences> { return loadProjectionFences(this.pool); }
  async preflightActorProjections(owner: RuntimeOwner): Promise<RuntimeOwnerAssessment> {
    requireRuntimeOwner(owner);
    const rows = await this.pool.query<{ object_json: unknown; owner_issuer: string | null; owner_subject_hash: string | null }>(
      "SELECT object_json,owner_issuer,owner_subject_hash FROM cop_current_tracks WHERE lower(object_json::text) LIKE ANY($1::text[]) OR lower(source_system_id) LIKE ANY($1::text[]) OR owner_subject_hash=$2 LIMIT 10001", [projectionSearchPatterns([], owner), runtimeSubjectHash(owner.subjectId)]);
    const history = await this.pool.query<{ event_id: string; owner_issuer: string | null; owner_subject_hash: string | null }>("SELECT event_id,owner_issuer,owner_subject_hash FROM cop_track_history WHERE owner_subject_hash=$1 OR lower(object_id) LIKE ANY($2::text[]) OR lower(source_system_id) LIKE ANY($2::text[]) LIMIT 10001", [runtimeSubjectHash(owner.subjectId), projectionSearchPatterns([], owner)]);
    return { ...runtimeAssessment([rows.rows, history.rows]), ready: rows.rows.length <= 10000 && history.rows.length <= 10000 && [...rows.rows, ...history.rows].every(row =>
      row.owner_issuer === owner.issuer && row.owner_subject_hash === runtimeSubjectHash(owner.subjectId)) };
  }
  async eraseResourceProjections(resources: ProjectionResources, context: ProjectionEraseContext): Promise<boolean> {
    const refs = projectionReferences(resources), aliases = refs.flatMap(ref => ref.kind === "communityReport" ? [ref.id, `community:${ref.id}`] : [ref.id]);
    return projectionTransaction(this.pool, async client => {
      await fenceProjectionResources(client, resources, context);
      const patterns = projectionSearchPatterns(refs, context.actor);
      const current = await client.query<{ object_id: string; source_system_id: string; object_json: unknown; owner_issuer: string | null; owner_subject_hash: string | null }>(
        "SELECT object_id,source_system_id,object_json,owner_issuer,owner_subject_hash FROM cop_current_tracks WHERE lower(object_id)=ANY($1::text[]) OR lower(object_json::text) LIKE ANY($2::text[]) OR lower(source_system_id) LIKE ANY($2::text[]) OR owner_subject_hash=$3 LIMIT 10001",
        [aliases, patterns, context.actor ? runtimeSubjectHash(context.actor.subjectId) : null]);
      const history = await client.query<{ event_id: string; object_id: string; source_system_id: string; owner_issuer: string | null; owner_subject_hash: string | null }>(
        "SELECT event_id,object_id,source_system_id,owner_issuer,owner_subject_hash FROM cop_track_history WHERE lower(object_id)=ANY($1::text[]) OR owner_subject_hash=$2 OR lower(object_id) LIKE ANY($3::text[]) OR lower(source_system_id) LIKE ANY($3::text[]) LIMIT 10001", [aliases, context.actor ? runtimeSubjectHash(context.actor.subjectId) : null, patterns]);
      if (current.rows.length > 10000 || history.rows.length > 10000) return false;
      let complete = true;
      const owned = (row: { object_id: string; source_system_id: string; owner_issuer: string | null; owner_subject_hash: string | null }) => {
        if (row.owner_issuer && (!context.actor || row.owner_issuer !== context.actor.issuer || row.owner_subject_hash !== runtimeSubjectHash(context.actor.subjectId))) return false;
        const ref = canonicalProjectionReference(row.object_id, row.source_system_id);
        return !!(ref && refs.some(item => item.kind === ref.kind && item.id === ref.id)) || !!(context.actor && row.owner_issuer === context.actor.issuer && row.owner_subject_hash === runtimeSubjectHash(context.actor.subjectId));
      };
      for (const row of current.rows) {
        context.signal.throwIfAborted();
        if (!owned(row)) { complete = false; continue; }
        await client.query("DELETE FROM cop_current_tracks WHERE object_id=$1", [row.object_id]);
      }
      for (const row of history.rows) {
        context.signal.throwIfAborted();
        if (!owned(row)) { complete = false; continue; }
        await client.query("DELETE FROM cop_track_history WHERE event_id=$1", [row.event_id]);
      }
      const remaining = await client.query("SELECT 1 FROM cop_current_tracks WHERE lower(object_id)=ANY($1::text[]) OR lower(object_json::text) LIKE ANY($2::text[]) OR lower(source_system_id) LIKE ANY($2::text[]) OR owner_subject_hash=$3 UNION ALL SELECT 1 FROM cop_track_history WHERE lower(object_id)=ANY($1::text[]) OR lower(object_id) LIKE ANY($2::text[]) OR lower(source_system_id) LIKE ANY($2::text[]) OR owner_subject_hash=$3 LIMIT 1", [aliases, patterns, context.actor ? runtimeSubjectHash(context.actor.subjectId) : null]);
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

interface TrackHistoryRow extends QueryResultRow {
  affiliation: TrackHistoryPoint["affiliation"];
  confidence: number | null;
  event_id: string;
  ingest_timestamp: Date | string | null;
  lat: number | string;
  lon: number | string;
  object_id: string;
  object_type: TrackHistoryPoint["objectType"];
  observed_at: Date | string;
  producer_timestamp: Date | string;
  source_system_id: string;
  status: TrackHistoryPoint["status"];
  synthetic: boolean;
}

interface CurrentTrackRow extends QueryResultRow {
  event_id: string;
  last_updated_at: Date | string;
  object_json: ObservedObject | string;
  source_system_id: string;
  synthetic: boolean;
}

const createPersistenceTablesSql = `
CREATE TABLE IF NOT EXISTS cop_track_history (
  event_id uuid PRIMARY KEY,
  object_id text NOT NULL,
  object_type text NOT NULL,
  affiliation text NOT NULL,
  status text NOT NULL,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  observed_at timestamptz NOT NULL,
  producer_timestamp timestamptz NOT NULL,
  ingest_timestamp timestamptz,
  source_system_id text NOT NULL,
  synthetic boolean NOT NULL,
  confidence double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cop_track_history_object_observed_idx
  ON cop_track_history (object_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS cop_track_history_observed_idx
  ON cop_track_history (observed_at DESC);

CREATE TABLE IF NOT EXISTS cop_current_tracks (
  object_id text PRIMARY KEY,
  object_type text NOT NULL,
  affiliation text NOT NULL,
  domain text NOT NULL,
  status text NOT NULL,
  object_json jsonb NOT NULL,
  event_id uuid NOT NULL,
  source_system_id text NOT NULL,
  last_updated_at timestamptz NOT NULL,
  synthetic boolean NOT NULL,
  confidence double precision,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cop_track_history ADD COLUMN IF NOT EXISTS owner_issuer text;
ALTER TABLE cop_track_history ADD COLUMN IF NOT EXISTS owner_subject_hash text;
ALTER TABLE cop_current_tracks ADD COLUMN IF NOT EXISTS owner_issuer text;
ALTER TABLE cop_current_tracks ADD COLUMN IF NOT EXISTS owner_subject_hash text;
CREATE INDEX IF NOT EXISTS cop_track_history_owner_idx ON cop_track_history(owner_subject_hash);
CREATE INDEX IF NOT EXISTS cop_current_tracks_owner_idx ON cop_current_tracks(owner_subject_hash);
CREATE INDEX IF NOT EXISTS cop_current_tracks_last_updated_idx
  ON cop_current_tracks (last_updated_at DESC);

CREATE INDEX IF NOT EXISTS cop_current_tracks_source_idx
  ON cop_current_tracks (source_system_id);
`;

function addParam(params: unknown[], value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}

function effectiveFromIso(query: TrackHistoryQuery, now: Date): string | undefined {
  const fromMs = query.from ? Date.parse(query.from) : undefined;
  const secondsMs = query.seconds && query.seconds > 0 ? now.getTime() - query.seconds * 1000 : undefined;
  const candidates = [fromMs, secondsMs].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (candidates.length === 0) {
    return undefined;
  }
  return new Date(Math.max(...candidates)).toISOString();
}

function resolveLimit(query: TrackHistoryQuery): number {
  const parsed = Number(query.limit);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 120;
  }
  return Math.min(1000, Math.max(1, Math.trunc(parsed)));
}

function trackHistoryPointFromRow(row: TrackHistoryRow): TrackHistoryPoint {
  const ingestTimestamp = row.ingest_timestamp ? isoString(row.ingest_timestamp) : undefined;
  return {
    affiliation: row.affiliation,
    ...(row.confidence === null ? {} : { confidence: Number(row.confidence) }),
    eventId: row.event_id,
    ...(ingestTimestamp ? { ingestTimestamp } : {}),
    lat: Number(row.lat),
    lon: Number(row.lon),
    objectId: row.object_id,
    objectType: row.object_type,
    producerTimestamp: isoString(row.producer_timestamp),
    sourceSystemId: row.source_system_id,
    status: row.status,
    synthetic: row.synthetic,
    timestamp: isoString(row.observed_at)
  };
}

function observedObjectFromJson(value: ObservedObject | string): ObservedObject {
  return typeof value === "string" ? JSON.parse(value) as ObservedObject : value;
}

function observedObjectFromCurrentRow(row: CurrentTrackRow): ObservedObject {
  return withStoredCurrentProvenance(observedObjectFromJson(row.object_json), {
    eventId: row.event_id,
    lastUpdatedAt: isoString(row.last_updated_at),
    sourceSystemId: row.source_system_id,
    synthetic: row.synthetic
  });
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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
