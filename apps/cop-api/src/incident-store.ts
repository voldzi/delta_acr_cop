import pg, { type Pool as PgPool, type PoolConfig, type QueryResultRow } from "pg";
import { randomUUID } from "node:crypto";

const { Pool } = pg;

export type IncidentCategory =
  | "community"
  | "fire"
  | "flood"
  | "infrastructure"
  | "medical"
  | "other"
  | "security"
  | "traffic"
  | "weather";

export type IncidentSeverity = "advisory" | "critical" | "info" | "warning";
export type IncidentStatus = "active" | "candidate" | "closed" | "monitoring" | "rejected" | "resolved";
export type IncidentLocationSource = "community_report" | "fusion" | "manual" | "provider";
export type IncidentSourceRefKind = "alert" | "community_report" | "manual" | "provider_feature" | "sketch";
export type IncidentTaskPriority = "high" | "low" | "normal" | "urgent";
export type IncidentTaskStatus = "blocked" | "cancelled" | "done" | "in_progress" | "open";

export interface IncidentActor {
  displayName: string;
  subjectId: string;
  username: string;
}

export interface IncidentLocation {
  accuracyM?: number;
  label?: string;
  lat: number;
  lon: number;
  source: IncidentLocationSource;
}

export interface IncidentSourceRef {
  id: string;
  kind: IncidentSourceRefKind;
  observedAt?: string;
  sourceId?: string;
  title?: string;
}

export interface IncidentRecord {
  category: IncidentCategory;
  confidence: number;
  createdAt: string;
  createdBy: IncidentActor;
  description?: string;
  incidentId: string;
  location: IncidentLocation;
  properties: Record<string, unknown>;
  provenance: Array<Record<string, unknown>>;
  severity: IncidentSeverity;
  sourceRefs: IncidentSourceRef[];
  status: IncidentStatus;
  title: string;
  updatedAt: string;
  updatedBy?: IncidentActor;
}

export interface IncidentTaskRecord {
  assigneeSubjectId?: string;
  createdAt: string;
  createdBy: IncidentActor;
  description?: string;
  dueAt?: string;
  incidentId: string;
  priority: IncidentTaskPriority;
  properties: Record<string, unknown>;
  sourceRef?: IncidentSourceRef;
  status: IncidentTaskStatus;
  taskId: string;
  title: string;
  updatedAt: string;
  updatedBy?: IncidentActor;
}

export interface CreateIncidentInput {
  category: IncidentCategory;
  confidence?: number;
  createdBy: IncidentActor;
  description?: string;
  location: IncidentLocation;
  properties?: Record<string, unknown>;
  provenance?: Array<Record<string, unknown>>;
  severity: IncidentSeverity;
  sourceRefs?: IncidentSourceRef[];
  status?: IncidentStatus;
  title: string;
}

export interface IncidentUpdateInput {
  category?: IncidentCategory;
  confidence?: number;
  description?: string | null;
  location?: IncidentLocation;
  properties?: Record<string, unknown>;
  provenance?: Array<Record<string, unknown>>;
  severity?: IncidentSeverity;
  sourceRefs?: IncidentSourceRef[];
  status?: IncidentStatus;
  title?: string;
}

export interface CreateIncidentTaskInput {
  assigneeSubjectId?: string;
  createdBy: IncidentActor;
  description?: string;
  dueAt?: string;
  incidentId: string;
  priority?: IncidentTaskPriority;
  properties?: Record<string, unknown>;
  sourceRef?: IncidentSourceRef;
  status?: IncidentTaskStatus;
  title: string;
}

export interface IncidentTaskUpdateInput {
  assigneeSubjectId?: string | null;
  description?: string | null;
  dueAt?: string | null;
  priority?: IncidentTaskPriority;
  properties?: Record<string, unknown>;
  sourceRef?: IncidentSourceRef | null;
  status?: IncidentTaskStatus;
  title?: string;
}

export interface IncidentQuery {
  bbox?: {
    east: number;
    north: number;
    south: number;
    west: number;
  };
  categories?: IncidentCategory[];
  includeClosed?: boolean;
  limit?: number;
  statuses?: IncidentStatus[];
}

export interface IncidentTaskQuery {
  incidentId?: string;
  limit?: number;
  statuses?: IncidentTaskStatus[];
}

export interface IncidentStore {
  readonly name: string;
  close(): Promise<void>;
  createIncident(input: CreateIncidentInput, now: Date): Promise<IncidentRecord>;
  createTask(input: CreateIncidentTaskInput, now: Date): Promise<IncidentTaskRecord>;
  diagnostics?(): string | undefined;
  getIncident(incidentId: string): Promise<IncidentRecord | null>;
  getTask(taskId: string): Promise<IncidentTaskRecord | null>;
  init(): Promise<void>;
  listIncidents(query: IncidentQuery): Promise<IncidentRecord[]>;
  listTasks(query: IncidentTaskQuery): Promise<IncidentTaskRecord[]>;
  updateIncident(incidentId: string, actor: IncidentActor, input: IncidentUpdateInput, now: Date): Promise<IncidentRecord | null>;
  updateTask(taskId: string, actor: IncidentActor, input: IncidentTaskUpdateInput, now: Date): Promise<IncidentTaskRecord | null>;
}

export function createIncidentStoreFromEnv(env: Record<string, string | undefined> = process.env): IncidentStore | undefined {
  const mode = (env.COP_INCIDENT_STORE ?? "auto").trim().toLowerCase();
  const connectionString = env.COP_DATABASE_URL?.trim();

  if (mode === "disabled" || mode === "off") {
    return undefined;
  }
  if (mode === "memory" || (mode === "auto" && !connectionString)) {
    return new InMemoryIncidentStore(mode === "memory" ? "memory" : "memory-auto");
  }
  if ((mode === "auto" || mode === "postgres" || mode === "postgresql") && connectionString) {
    return new PostgresIncidentStore({
      connectionString,
      connectionTimeoutMillis: readPositiveInteger(env.COP_DATABASE_CONNECT_TIMEOUT_MS, 5000),
      idleTimeoutMillis: readPositiveInteger(env.COP_DATABASE_IDLE_TIMEOUT_MS, 30000),
      max: readPositiveInteger(env.COP_DATABASE_POOL_MAX, 5),
      ssl: readSslConfig(env)
    });
  }

  throw new Error(`Unsupported COP_INCIDENT_STORE value: ${mode}`);
}

export class InMemoryIncidentStore implements IncidentStore {
  readonly name: string;
  private readonly incidents = new Map<string, IncidentRecord>();
  private readonly tasks = new Map<string, IncidentTaskRecord>();

  constructor(name = "memory") {
    this.name = name;
  }

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async createIncident(input: CreateIncidentInput, now: Date): Promise<IncidentRecord> {
    const timestamp = now.toISOString();
    const incident: IncidentRecord = {
      category: input.category,
      confidence: clampConfidence(input.confidence),
      createdAt: timestamp,
      createdBy: cloneIncidentActor(input.createdBy),
      ...(input.description ? { description: input.description } : {}),
      incidentId: randomUUID(),
      location: cloneIncidentLocation(input.location),
      properties: cloneRecord(input.properties ?? {}),
      provenance: cloneRecordArray(input.provenance ?? []),
      severity: input.severity,
      sourceRefs: cloneSourceRefs(input.sourceRefs ?? []),
      status: input.status ?? "candidate",
      title: input.title,
      updatedAt: timestamp
    };
    this.incidents.set(incident.incidentId, incident);
    return cloneIncident(incident);
  }

  async getIncident(incidentId: string): Promise<IncidentRecord | null> {
    const incident = this.incidents.get(incidentId);
    return incident ? cloneIncident(incident) : null;
  }

  async listIncidents(query: IncidentQuery): Promise<IncidentRecord[]> {
    return Array.from(this.incidents.values())
      .filter((incident) => matchesIncidentQuery(incident, query))
      .sort(compareIncidents)
      .slice(0, resolveIncidentLimit(query.limit))
      .map(cloneIncident);
  }

  async updateIncident(incidentId: string, actor: IncidentActor, input: IncidentUpdateInput, now: Date): Promise<IncidentRecord | null> {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      return null;
    }
    const updated = mergeIncident(incident, actor, input, now);
    this.incidents.set(incidentId, updated);
    return cloneIncident(updated);
  }

  async createTask(input: CreateIncidentTaskInput, now: Date): Promise<IncidentTaskRecord> {
    const timestamp = now.toISOString();
    const task: IncidentTaskRecord = {
      ...(input.assigneeSubjectId ? { assigneeSubjectId: input.assigneeSubjectId } : {}),
      createdAt: timestamp,
      createdBy: cloneIncidentActor(input.createdBy),
      ...(input.description ? { description: input.description } : {}),
      ...(input.dueAt ? { dueAt: input.dueAt } : {}),
      incidentId: input.incidentId,
      priority: input.priority ?? "normal",
      properties: cloneRecord(input.properties ?? {}),
      ...(input.sourceRef ? { sourceRef: cloneSourceRef(input.sourceRef) } : {}),
      status: input.status ?? "open",
      taskId: randomUUID(),
      title: input.title,
      updatedAt: timestamp
    };
    this.tasks.set(task.taskId, task);
    return cloneTask(task);
  }

  async getTask(taskId: string): Promise<IncidentTaskRecord | null> {
    const task = this.tasks.get(taskId);
    return task ? cloneTask(task) : null;
  }

  async listTasks(query: IncidentTaskQuery): Promise<IncidentTaskRecord[]> {
    return Array.from(this.tasks.values())
      .filter((task) => matchesTaskQuery(task, query))
      .sort(compareTasks)
      .slice(0, resolveIncidentLimit(query.limit))
      .map(cloneTask);
  }

  async updateTask(taskId: string, actor: IncidentActor, input: IncidentTaskUpdateInput, now: Date): Promise<IncidentTaskRecord | null> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }
    const updated = mergeTask(task, actor, input, now);
    this.tasks.set(taskId, updated);
    return cloneTask(updated);
  }
}

export class PostgresIncidentStore implements IncidentStore {
  readonly name = "postgres";
  private lastIdleClientError: string | undefined;
  private readonly pool: PgPool;

  constructor(config: PoolConfig) {
    this.pool = new Pool(config);
    this.pool.on("error", (error) => {
      this.lastIdleClientError = error instanceof Error ? error.message : String(error);
    });
  }

  diagnostics(): string | undefined {
    return this.lastIdleClientError ? `last idle client error: ${this.lastIdleClientError}` : undefined;
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS cop_incidents (
        incident_id text PRIMARY KEY,
        record jsonb NOT NULL,
        lon double precision NOT NULL,
        lat double precision NOT NULL,
        status text NOT NULL,
        category text NOT NULL,
        severity text NOT NULL,
        updated_at timestamptz NOT NULL
      )
    `);
    await this.pool.query("CREATE INDEX IF NOT EXISTS cop_incidents_bbox_idx ON cop_incidents (lon, lat)");
    await this.pool.query("CREATE INDEX IF NOT EXISTS cop_incidents_status_idx ON cop_incidents (status)");
    await this.pool.query("CREATE INDEX IF NOT EXISTS cop_incidents_category_idx ON cop_incidents (category)");
    await this.pool.query("CREATE INDEX IF NOT EXISTS cop_incidents_updated_at_idx ON cop_incidents (updated_at DESC)");
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS cop_incident_tasks (
        task_id text PRIMARY KEY,
        incident_id text NOT NULL REFERENCES cop_incidents(incident_id) ON DELETE CASCADE,
        record jsonb NOT NULL,
        status text NOT NULL,
        priority text NOT NULL,
        updated_at timestamptz NOT NULL
      )
    `);
    await this.pool.query("CREATE INDEX IF NOT EXISTS cop_incident_tasks_incident_idx ON cop_incident_tasks (incident_id)");
    await this.pool.query("CREATE INDEX IF NOT EXISTS cop_incident_tasks_status_idx ON cop_incident_tasks (status)");
  }

  async createIncident(input: CreateIncidentInput, now: Date): Promise<IncidentRecord> {
    const timestamp = now.toISOString();
    const incident: IncidentRecord = {
      category: input.category,
      confidence: clampConfidence(input.confidence),
      createdAt: timestamp,
      createdBy: cloneIncidentActor(input.createdBy),
      ...(input.description ? { description: input.description } : {}),
      incidentId: randomUUID(),
      location: cloneIncidentLocation(input.location),
      properties: cloneRecord(input.properties ?? {}),
      provenance: cloneRecordArray(input.provenance ?? []),
      severity: input.severity,
      sourceRefs: cloneSourceRefs(input.sourceRefs ?? []),
      status: input.status ?? "candidate",
      title: input.title,
      updatedAt: timestamp
    };
    await this.upsertIncidentRecord(incident);
    return cloneIncident(incident);
  }

  async getIncident(incidentId: string): Promise<IncidentRecord | null> {
    const result = await this.pool.query<StoredIncidentRow>("SELECT record FROM cop_incidents WHERE incident_id = $1", [incidentId]);
    return result.rows[0] ? rowIncident(result.rows[0]) : null;
  }

  async listIncidents(query: IncidentQuery): Promise<IncidentRecord[]> {
    const values: unknown[] = [];
    const where: string[] = [];
    if (query.bbox) {
      values.push(query.bbox.west, query.bbox.east, query.bbox.south, query.bbox.north);
      where.push(`lon BETWEEN $${values.length - 3} AND $${values.length - 2}`);
      where.push(`lat BETWEEN $${values.length - 1} AND $${values.length}`);
    }
    if (query.statuses?.length) {
      values.push(query.statuses);
      where.push(`status = ANY($${values.length})`);
    } else if (!query.includeClosed) {
      values.push(["closed", "rejected", "resolved"]);
      where.push(`NOT (status = ANY($${values.length}))`);
    }
    if (query.categories?.length) {
      values.push(query.categories);
      where.push(`category = ANY($${values.length})`);
    }
    values.push(resolveIncidentLimit(query.limit));
    const sql = `
      SELECT record FROM cop_incidents
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY updated_at DESC
      LIMIT $${values.length}
    `;
    const result = await this.pool.query<StoredIncidentRow>(sql, values);
    return result.rows.map(rowIncident);
  }

  async updateIncident(incidentId: string, actor: IncidentActor, input: IncidentUpdateInput, now: Date): Promise<IncidentRecord | null> {
    const current = await this.getIncident(incidentId);
    if (!current) {
      return null;
    }
    const updated = mergeIncident(current, actor, input, now);
    await this.upsertIncidentRecord(updated);
    return cloneIncident(updated);
  }

  async createTask(input: CreateIncidentTaskInput, now: Date): Promise<IncidentTaskRecord> {
    const timestamp = now.toISOString();
    const task: IncidentTaskRecord = {
      ...(input.assigneeSubjectId ? { assigneeSubjectId: input.assigneeSubjectId } : {}),
      createdAt: timestamp,
      createdBy: cloneIncidentActor(input.createdBy),
      ...(input.description ? { description: input.description } : {}),
      ...(input.dueAt ? { dueAt: input.dueAt } : {}),
      incidentId: input.incidentId,
      priority: input.priority ?? "normal",
      properties: cloneRecord(input.properties ?? {}),
      ...(input.sourceRef ? { sourceRef: cloneSourceRef(input.sourceRef) } : {}),
      status: input.status ?? "open",
      taskId: randomUUID(),
      title: input.title,
      updatedAt: timestamp
    };
    await this.upsertTaskRecord(task);
    return cloneTask(task);
  }

  async getTask(taskId: string): Promise<IncidentTaskRecord | null> {
    const result = await this.pool.query<StoredTaskRow>("SELECT record FROM cop_incident_tasks WHERE task_id = $1", [taskId]);
    return result.rows[0] ? rowTask(result.rows[0]) : null;
  }

  async listTasks(query: IncidentTaskQuery): Promise<IncidentTaskRecord[]> {
    const values: unknown[] = [];
    const where: string[] = [];
    if (query.incidentId) {
      values.push(query.incidentId);
      where.push(`incident_id = $${values.length}`);
    }
    if (query.statuses?.length) {
      values.push(query.statuses);
      where.push(`status = ANY($${values.length})`);
    }
    values.push(resolveIncidentLimit(query.limit));
    const sql = `
      SELECT record FROM cop_incident_tasks
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY updated_at DESC
      LIMIT $${values.length}
    `;
    const result = await this.pool.query<StoredTaskRow>(sql, values);
    return result.rows.map(rowTask);
  }

  async updateTask(taskId: string, actor: IncidentActor, input: IncidentTaskUpdateInput, now: Date): Promise<IncidentTaskRecord | null> {
    const current = await this.getTask(taskId);
    if (!current) {
      return null;
    }
    const updated = mergeTask(current, actor, input, now);
    await this.upsertTaskRecord(updated);
    return cloneTask(updated);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async upsertIncidentRecord(incident: IncidentRecord): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO cop_incidents (incident_id, record, lon, lat, status, category, severity, updated_at)
        VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (incident_id) DO UPDATE SET
          record = EXCLUDED.record,
          lon = EXCLUDED.lon,
          lat = EXCLUDED.lat,
          status = EXCLUDED.status,
          category = EXCLUDED.category,
          severity = EXCLUDED.severity,
          updated_at = EXCLUDED.updated_at
      `,
      [
        incident.incidentId,
        JSON.stringify(incident),
        incident.location.lon,
        incident.location.lat,
        incident.status,
        incident.category,
        incident.severity,
        incident.updatedAt
      ]
    );
  }

  private async upsertTaskRecord(task: IncidentTaskRecord): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO cop_incident_tasks (task_id, incident_id, record, status, priority, updated_at)
        VALUES ($1, $2, $3::jsonb, $4, $5, $6)
        ON CONFLICT (task_id) DO UPDATE SET
          incident_id = EXCLUDED.incident_id,
          record = EXCLUDED.record,
          status = EXCLUDED.status,
          priority = EXCLUDED.priority,
          updated_at = EXCLUDED.updated_at
      `,
      [task.taskId, task.incidentId, JSON.stringify(task), task.status, task.priority, task.updatedAt]
    );
  }
}

export function buildIncidentFeatureCollection(incidents: IncidentRecord[], query: IncidentQuery, now: Date): Record<string, unknown> {
  return {
    contractVersion: "cop-incidents-v1",
    features: incidents.map((incident) => ({
      geometry: {
        coordinates: [incident.location.lon, incident.location.lat],
        type: "Point"
      },
      id: incident.incidentId,
      properties: {
        category: incident.category,
        confidence: incident.confidence,
        incidentId: incident.incidentId,
        kind: "incident",
        layerId: "cop.incidents",
        severity: incident.severity,
        sourceId: "cop.incident-store",
        sourceRefs: incident.sourceRefs,
        status: incident.status,
        title: incident.title,
        updatedAt: incident.updatedAt
      },
      type: "Feature"
    })),
    generatedAt: now.toISOString(),
    query,
    type: "FeatureCollection"
  };
}

interface StoredIncidentRow extends QueryResultRow {
  record: IncidentRecord;
}

interface StoredTaskRow extends QueryResultRow {
  record: IncidentTaskRecord;
}

function rowIncident(row: StoredIncidentRow): IncidentRecord {
  return cloneIncident(row.record);
}

function rowTask(row: StoredTaskRow): IncidentTaskRecord {
  return cloneTask(row.record);
}

function mergeIncident(current: IncidentRecord, actor: IncidentActor, input: IncidentUpdateInput, now: Date): IncidentRecord {
  const updated: IncidentRecord = {
    ...current,
    ...(input.category ? { category: input.category } : {}),
    ...(input.confidence !== undefined ? { confidence: clampConfidence(input.confidence) } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.location ? { location: cloneIncidentLocation(input.location) } : {}),
    ...(input.properties ? { properties: { ...current.properties, ...cloneRecord(input.properties) } } : {}),
    ...(input.provenance ? { provenance: cloneRecordArray(input.provenance) } : {}),
    ...(input.severity ? { severity: input.severity } : {}),
    ...(input.sourceRefs ? { sourceRefs: cloneSourceRefs(input.sourceRefs) } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.title ? { title: input.title } : {}),
    updatedAt: now.toISOString(),
    updatedBy: cloneIncidentActor(actor)
  };
  if (input.description === null) {
    delete updated.description;
  }
  return updated;
}

function mergeTask(current: IncidentTaskRecord, actor: IncidentActor, input: IncidentTaskUpdateInput, now: Date): IncidentTaskRecord {
  const updated: IncidentTaskRecord = {
    ...current,
    ...(input.assigneeSubjectId ? { assigneeSubjectId: input.assigneeSubjectId } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.dueAt ? { dueAt: input.dueAt } : {}),
    ...(input.priority ? { priority: input.priority } : {}),
    ...(input.properties ? { properties: { ...current.properties, ...cloneRecord(input.properties) } } : {}),
    ...(input.sourceRef ? { sourceRef: cloneSourceRef(input.sourceRef) } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.title ? { title: input.title } : {}),
    updatedAt: now.toISOString(),
    updatedBy: cloneIncidentActor(actor)
  };
  if (input.assigneeSubjectId === null) {
    delete updated.assigneeSubjectId;
  }
  if (input.description === null) {
    delete updated.description;
  }
  if (input.dueAt === null) {
    delete updated.dueAt;
  }
  if (input.sourceRef === null) {
    delete updated.sourceRef;
  }
  return updated;
}

function matchesIncidentQuery(incident: IncidentRecord, query: IncidentQuery): boolean {
  if (!query.includeClosed && !query.statuses?.length && ["closed", "rejected", "resolved"].includes(incident.status)) {
    return false;
  }
  if (query.statuses?.length && !query.statuses.includes(incident.status)) {
    return false;
  }
  if (query.categories?.length && !query.categories.includes(incident.category)) {
    return false;
  }
  if (query.bbox) {
    const { lat, lon } = incident.location;
    if (lon < query.bbox.west || lon > query.bbox.east || lat < query.bbox.south || lat > query.bbox.north) {
      return false;
    }
  }
  return true;
}

function matchesTaskQuery(task: IncidentTaskRecord, query: IncidentTaskQuery): boolean {
  if (query.incidentId && task.incidentId !== query.incidentId) {
    return false;
  }
  if (query.statuses?.length && !query.statuses.includes(task.status)) {
    return false;
  }
  return true;
}

function compareIncidents(left: IncidentRecord, right: IncidentRecord): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title);
}

function compareTasks(left: IncidentTaskRecord, right: IncidentTaskRecord): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title);
}

function resolveIncidentLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? NaN)) {
    return 200;
  }
  return Math.max(1, Math.min(500, Math.trunc(limit ?? 200)));
}

function clampConfidence(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, Number(value)));
}

function cloneIncident(incident: IncidentRecord): IncidentRecord {
  return {
    ...incident,
    createdBy: cloneIncidentActor(incident.createdBy),
    location: cloneIncidentLocation(incident.location),
    properties: cloneRecord(incident.properties),
    provenance: cloneRecordArray(incident.provenance),
    sourceRefs: cloneSourceRefs(incident.sourceRefs),
    ...(incident.updatedBy ? { updatedBy: cloneIncidentActor(incident.updatedBy) } : {})
  };
}

function cloneTask(task: IncidentTaskRecord): IncidentTaskRecord {
  return {
    ...task,
    createdBy: cloneIncidentActor(task.createdBy),
    properties: cloneRecord(task.properties),
    ...(task.sourceRef ? { sourceRef: cloneSourceRef(task.sourceRef) } : {}),
    ...(task.updatedBy ? { updatedBy: cloneIncidentActor(task.updatedBy) } : {})
  };
}

function cloneIncidentActor(actor: IncidentActor): IncidentActor {
  return { displayName: actor.displayName, subjectId: actor.subjectId, username: actor.username };
}

function cloneIncidentLocation(location: IncidentLocation): IncidentLocation {
  return {
    ...(location.accuracyM !== undefined ? { accuracyM: location.accuracyM } : {}),
    ...(location.label ? { label: location.label } : {}),
    lat: location.lat,
    lon: location.lon,
    source: location.source
  };
}

function cloneSourceRef(sourceRef: IncidentSourceRef): IncidentSourceRef {
  return {
    id: sourceRef.id,
    kind: sourceRef.kind,
    ...(sourceRef.observedAt ? { observedAt: sourceRef.observedAt } : {}),
    ...(sourceRef.sourceId ? { sourceId: sourceRef.sourceId } : {}),
    ...(sourceRef.title ? { title: sourceRef.title } : {})
  };
}

function cloneSourceRefs(sourceRefs: IncidentSourceRef[]): IncidentSourceRef[] {
  return sourceRefs.map(cloneSourceRef);
}

function cloneRecordArray(records: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return records.map(cloneRecord);
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readSslConfig(env: Record<string, string | undefined>): PoolConfig["ssl"] {
  const enabled = (env.COP_DATABASE_SSL ?? "false").trim().toLowerCase();
  if (!["1", "true", "yes", "on"].includes(enabled)) {
    return undefined;
  }
  const rejectUnauthorized = (env.COP_DATABASE_SSL_REJECT_UNAUTHORIZED ?? "true").trim().toLowerCase();
  return { rejectUnauthorized: !["0", "false", "no", "off"].includes(rejectUnauthorized) };
}
