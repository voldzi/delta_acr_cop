import { randomUUID } from "node:crypto";
import { Pool, type PoolConfig } from "pg";

export type SketchDrawingKind = "arrow" | "circle" | "line" | "marker" | "measurement" | "point" | "polygon" | "text";
export type SketchDrawingVisibility = "event" | "group" | "private" | "public";
export type SketchPaletteMode = "civil" | "professional";

export type SketchGeometry =
  | { coordinates: [number, number]; type: "Point" }
  | { coordinates: Array<[number, number]>; type: "LineString" }
  | { coordinates: Array<Array<[number, number]>>; type: "Polygon" };

export interface SketchDrawingStyle {
  fill: string;
  lineWidth: number;
  opacity: number;
  stroke: string;
}

export interface SketchDrawingSymbol {
  iconId?: string;
  palette: SketchPaletteMode;
  sidc?: string;
}

export interface SketchDrawingActor {
  displayName: string;
  subjectId: string;
  username: string;
}

export interface SketchDrawingFeatureProperties {
  createdAt: string;
  drawingId: string;
  eventId?: string;
  groupId?: string;
  kind: SketchDrawingKind;
  label: string;
  locked: boolean;
  ownerDisplayName: string;
  ownerSubjectId: string;
  ownerUsername: string;
  properties: Record<string, unknown>;
  revision: number;
  style: SketchDrawingStyle;
  symbol: SketchDrawingSymbol;
  updatedAt: string;
  visibility: SketchDrawingVisibility;
}

export interface SketchDrawingFeature {
  geometry: SketchGeometry;
  id: string;
  properties: SketchDrawingFeatureProperties;
  type: "Feature";
}

export interface SketchDrawingFeatureCollection {
  contractVersion: "cop-sketch-drawings-v1";
  features: SketchDrawingFeature[];
  generatedAt: string;
  query: {
    bbox?: SketchDrawingQuery["bbox"];
    eventId?: string;
    groupId?: string;
    limit: number;
  };
  summary: {
    featureCount: number;
  };
  type: "FeatureCollection";
}

export interface SketchDrawingQuery {
  allowedGroupIds?: string[];
  bbox?: {
    east: number;
    north: number;
    south: number;
    west: number;
  };
  eventId?: string;
  groupId?: string;
  limit?: number;
  subjectId?: string;
}

export interface CreateSketchDrawingInput {
  actor: SketchDrawingActor;
  eventId?: string;
  geometry: SketchGeometry;
  groupId?: string;
  kind: SketchDrawingKind;
  label?: string;
  locked?: boolean;
  properties?: Record<string, unknown>;
  style?: Partial<SketchDrawingStyle>;
  symbol?: Partial<SketchDrawingSymbol>;
  visibility: SketchDrawingVisibility;
}

export interface UpdateSketchDrawingInput {
  eventId?: string | null;
  geometry?: SketchGeometry;
  groupId?: string | null;
  kind?: SketchDrawingKind;
  label?: string;
  locked?: boolean;
  properties?: Record<string, unknown>;
  style?: Partial<SketchDrawingStyle>;
  symbol?: Partial<SketchDrawingSymbol>;
  visibility?: SketchDrawingVisibility;
}

export interface SketchDrawingAuditEntry {
  action: "created" | "deleted" | "updated";
  actorSubjectId: string;
  at: string;
  drawingId: string;
  revision: number;
}

export interface SketchDrawingStore {
  readonly name: string;
  close(): Promise<void>;
  create(input: CreateSketchDrawingInput, now: Date): Promise<SketchDrawingFeature>;
  delete(drawingId: string, actor: SketchDrawingActor, now: Date): Promise<boolean>;
  deleteForDemoScenario(drawingId: string, demoScenarioId: string, actor: SketchDrawingActor, now: Date): Promise<boolean>;
  diagnostics?(): string | undefined;
  get(drawingId: string): Promise<SketchDrawingFeature | null>;
  init(): Promise<void>;
  list(query: SketchDrawingQuery): Promise<SketchDrawingFeature[]>;
  update(drawingId: string, actor: SketchDrawingActor, input: UpdateSketchDrawingInput, now: Date): Promise<SketchDrawingFeature | null>;
}

export function createSketchDrawingStoreFromEnv(env: Record<string, string | undefined> = process.env): SketchDrawingStore | undefined {
  const mode = (env.COP_SKETCH_DRAWING_STORE ?? "auto").trim().toLowerCase();
  const connectionString = env.COP_DATABASE_URL?.trim();

  if (mode === "disabled" || mode === "off") {
    return undefined;
  }
  if (mode === "memory" || (mode === "auto" && !connectionString)) {
    return new InMemorySketchDrawingStore(mode === "memory" ? "memory" : "memory-auto");
  }
  if ((mode === "auto" || mode === "postgres" || mode === "postgresql") && connectionString) {
    return new PostgresSketchDrawingStore({
      connectionString,
      connectionTimeoutMillis: readPositiveInteger(env.COP_DATABASE_CONNECT_TIMEOUT_MS, 5000),
      idleTimeoutMillis: readPositiveInteger(env.COP_DATABASE_IDLE_TIMEOUT_MS, 30000),
      max: readPositiveInteger(env.COP_DATABASE_POOL_MAX, 5),
      ssl: readSslConfig(env)
    });
  }
  return undefined;
}

export class InMemorySketchDrawingStore implements SketchDrawingStore {
  readonly name: string;
  private readonly drawings = new Map<string, SketchDrawingFeature>();
  private readonly audit: SketchDrawingAuditEntry[] = [];

  constructor(name = "memory") {
    this.name = name;
  }

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async create(input: CreateSketchDrawingInput, now: Date): Promise<SketchDrawingFeature> {
    const drawing = buildSketchDrawingFeature({
      actor: input.actor,
      drawingId: randomUUID(),
      geometry: input.geometry,
      input,
      now,
      revision: 1
    });
    this.drawings.set(drawing.id, drawing);
    this.audit.push({ action: "created", actorSubjectId: input.actor.subjectId, at: now.toISOString(), drawingId: drawing.id, revision: 1 });
    return drawing;
  }

  async get(drawingId: string): Promise<SketchDrawingFeature | null> {
    return this.drawings.get(drawingId) ?? null;
  }

  async list(query: SketchDrawingQuery): Promise<SketchDrawingFeature[]> {
    const allowedGroups = new Set(query.allowedGroupIds ?? []);
    return Array.from(this.drawings.values())
      .filter((drawing) => canReadSketchDrawing(drawing, query.subjectId, allowedGroups))
      .filter((drawing) => !query.groupId || drawing.properties.groupId === query.groupId)
      .filter((drawing) => !query.eventId || drawing.properties.eventId === query.eventId)
      .filter((drawing) => !query.bbox || geometryIntersectsBbox(drawing.geometry, query.bbox))
      .sort((left, right) => right.properties.updatedAt.localeCompare(left.properties.updatedAt))
      .slice(0, resolveLimit(query.limit));
  }

  async update(drawingId: string, actor: SketchDrawingActor, input: UpdateSketchDrawingInput, now: Date): Promise<SketchDrawingFeature | null> {
    const current = this.drawings.get(drawingId);
    if (!current || current.properties.ownerSubjectId !== actor.subjectId) {
      return null;
    }
    const revision = current.properties.revision + 1;
    const next = mergeSketchDrawingFeature(current, actor, input, now, revision);
    this.drawings.set(drawingId, next);
    this.audit.push({ action: "updated", actorSubjectId: actor.subjectId, at: now.toISOString(), drawingId, revision });
    return next;
  }

  async delete(drawingId: string, actor: SketchDrawingActor, now: Date): Promise<boolean> {
    const current = this.drawings.get(drawingId);
    if (!current || current.properties.ownerSubjectId !== actor.subjectId) {
      return false;
    }
    this.drawings.delete(drawingId);
    this.audit.push({ action: "deleted", actorSubjectId: actor.subjectId, at: now.toISOString(), drawingId, revision: current.properties.revision + 1 });
    return true;
  }

  async deleteForDemoScenario(drawingId: string, demoScenarioId: string, actor: SketchDrawingActor, now: Date): Promise<boolean> {
    const current = this.drawings.get(drawingId);
    if (!current || current.properties.properties.demoScenarioId !== demoScenarioId) {
      return false;
    }
    this.drawings.delete(drawingId);
    this.audit.push({ action: "deleted", actorSubjectId: actor.subjectId, at: now.toISOString(), drawingId, revision: current.properties.revision + 1 });
    return true;
  }
}

export class PostgresSketchDrawingStore implements SketchDrawingStore {
  readonly name = "postgres";
  private lastIdleClientError: string | undefined;
  private readonly pool: Pool;

  constructor(config: PoolConfig) {
    this.pool = new Pool(config);
    this.pool.on("error", (error) => {
      this.lastIdleClientError = errorMessage(error);
    });
  }

  async init(): Promise<void> {
    await this.pool.query(createSketchDrawingTablesSql);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  diagnostics(): string | undefined {
    return this.lastIdleClientError ? `last idle client error: ${this.lastIdleClientError}` : undefined;
  }

  async create(input: CreateSketchDrawingInput, now: Date): Promise<SketchDrawingFeature> {
    const drawingId = randomUUID();
    const normalized = buildSketchDrawingFeature({ actor: input.actor, drawingId, geometry: input.geometry, input, now, revision: 1 });
    const row = await this.pool.query<SketchDrawingRow>(
      `INSERT INTO cop_user_drawings (
        drawing_id, owner_subject_id, owner_username, owner_display_name, visibility, group_id, event_id,
        kind, label, geometry, style, symbol, properties, locked, revision, created_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        ST_SetSRID(ST_GeomFromGeoJSON($10), 4326),
        $11::jsonb, $12::jsonb, $13::jsonb, $14, 1, $15::timestamptz, $15::timestamptz
      )
      RETURNING *, ST_AsGeoJSON(geometry)::json AS geometry_json`,
      [
        drawingId,
        normalized.properties.ownerSubjectId,
        normalized.properties.ownerUsername,
        normalized.properties.ownerDisplayName,
        normalized.properties.visibility,
        normalized.properties.groupId ?? null,
        normalized.properties.eventId ?? null,
        normalized.properties.kind,
        normalized.properties.label,
        JSON.stringify(normalized.geometry),
        JSON.stringify(normalized.properties.style),
        JSON.stringify(normalized.properties.symbol),
        JSON.stringify(normalized.properties.properties),
        normalized.properties.locked,
        now.toISOString()
      ]
    );
    await this.audit(drawingId, input.actor.subjectId, "created", 1, now);
    return sketchDrawingFromRow(requireRow(row.rows[0]));
  }

  async get(drawingId: string): Promise<SketchDrawingFeature | null> {
    const result = await this.pool.query<SketchDrawingRow>(
      `SELECT *, ST_AsGeoJSON(geometry)::json AS geometry_json
      FROM cop_user_drawings
      WHERE drawing_id = $1 AND deleted_at IS NULL`,
      [drawingId]
    );
    return result.rows[0] ? sketchDrawingFromRow(result.rows[0]) : null;
  }

  async list(query: SketchDrawingQuery): Promise<SketchDrawingFeature[]> {
    const params: unknown[] = [];
    const clauses = ["deleted_at IS NULL"];
    const accessClauses = ["visibility = 'public'"];
    if (query.subjectId) {
      accessClauses.push(`owner_subject_id = ${addParam(params, query.subjectId)}`);
    }
    if (query.allowedGroupIds && query.allowedGroupIds.length > 0) {
      accessClauses.push(`group_id = ANY(${addParam(params, query.allowedGroupIds)}::uuid[])`);
    }
    clauses.push(`(${accessClauses.join(" OR ")})`);
    if (query.groupId) {
      clauses.push(`group_id = ${addParam(params, query.groupId)}::uuid`);
    }
    if (query.eventId) {
      clauses.push(`event_id = ${addParam(params, query.eventId)}`);
    }
    if (query.bbox) {
      clauses.push(`geometry && ST_MakeEnvelope(${addParam(params, query.bbox.west)}, ${addParam(params, query.bbox.south)}, ${addParam(params, query.bbox.east)}, ${addParam(params, query.bbox.north)}, 4326)`);
    }
    const limitParam = addParam(params, resolveLimit(query.limit));
    const result = await this.pool.query<SketchDrawingRow>(
      `SELECT *, ST_AsGeoJSON(geometry)::json AS geometry_json
      FROM cop_user_drawings
      WHERE ${clauses.join(" AND ")}
      ORDER BY updated_at DESC
      LIMIT ${limitParam}`,
      params
    );
    return result.rows.map(sketchDrawingFromRow);
  }

  async update(drawingId: string, actor: SketchDrawingActor, input: UpdateSketchDrawingInput, now: Date): Promise<SketchDrawingFeature | null> {
    const current = await this.get(drawingId);
    if (!current || current.properties.ownerSubjectId !== actor.subjectId) {
      return null;
    }
    const next = mergeSketchDrawingFeature(current, actor, input, now, current.properties.revision + 1);
    const result = await this.pool.query<SketchDrawingRow>(
      `UPDATE cop_user_drawings
      SET
        visibility = $3,
        group_id = $4,
        event_id = $5,
        kind = $6,
        label = $7,
        geometry = ST_SetSRID(ST_GeomFromGeoJSON($8), 4326),
        style = $9::jsonb,
        symbol = $10::jsonb,
        properties = $11::jsonb,
        locked = $12,
        revision = revision + 1,
        updated_at = $13::timestamptz
      WHERE drawing_id = $1 AND owner_subject_id = $2 AND deleted_at IS NULL
      RETURNING *, ST_AsGeoJSON(geometry)::json AS geometry_json`,
      [
        drawingId,
        actor.subjectId,
        next.properties.visibility,
        next.properties.groupId ?? null,
        next.properties.eventId ?? null,
        next.properties.kind,
        next.properties.label,
        JSON.stringify(next.geometry),
        JSON.stringify(next.properties.style),
        JSON.stringify(next.properties.symbol),
        JSON.stringify(next.properties.properties),
        next.properties.locked,
        now.toISOString()
      ]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    await this.audit(drawingId, actor.subjectId, "updated", row.revision, now);
    return sketchDrawingFromRow(row);
  }

  async delete(drawingId: string, actor: SketchDrawingActor, now: Date): Promise<boolean> {
    const result = await this.pool.query<{ revision: number }>(
      `UPDATE cop_user_drawings
      SET deleted_at = $3::timestamptz, updated_at = $3::timestamptz, revision = revision + 1
      WHERE drawing_id = $1 AND owner_subject_id = $2 AND deleted_at IS NULL
      RETURNING revision`,
      [drawingId, actor.subjectId, now.toISOString()]
    );
    const row = result.rows[0];
    if (!row) {
      return false;
    }
    await this.audit(drawingId, actor.subjectId, "deleted", row.revision, now);
    return true;
  }

  async deleteForDemoScenario(drawingId: string, demoScenarioId: string, actor: SketchDrawingActor, now: Date): Promise<boolean> {
    const result = await this.pool.query<{ revision: number }>(
      `UPDATE cop_user_drawings
      SET deleted_at = $3::timestamptz, updated_at = $3::timestamptz, revision = revision + 1
      WHERE drawing_id = $1
        AND properties->>'demoScenarioId' = $2
        AND deleted_at IS NULL
      RETURNING revision`,
      [drawingId, demoScenarioId, now.toISOString()]
    );
    const row = result.rows[0];
    if (!row) {
      return false;
    }
    await this.audit(drawingId, actor.subjectId, "deleted", row.revision, now);
    return true;
  }

  private async audit(drawingId: string, actorSubjectId: string, action: SketchDrawingAuditEntry["action"], revision: number, now: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO cop_user_drawing_audit (drawing_id, actor_subject_id, action, revision, created_at)
      VALUES ($1, $2, $3, $4, $5::timestamptz)`,
      [drawingId, actorSubjectId, action, revision, now.toISOString()]
    );
  }
}

export function buildSketchDrawingCollection(
  drawings: SketchDrawingFeature[],
  query: SketchDrawingQuery,
  requestNow: Date
): SketchDrawingFeatureCollection {
  return {
    contractVersion: "cop-sketch-drawings-v1",
    features: drawings,
    generatedAt: requestNow.toISOString(),
    query: {
      ...(query.bbox ? { bbox: query.bbox } : {}),
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.groupId ? { groupId: query.groupId } : {}),
      limit: resolveLimit(query.limit)
    },
    summary: {
      featureCount: drawings.length
    },
    type: "FeatureCollection"
  };
}

export function sketchPalettes(mode: SketchPaletteMode | "all" = "all", generatedAt = new Date()) {
  const civil = [
    { iconId: "warning", label: "Upozornění", tone: "warning" },
    { iconId: "closure", label: "Uzávěra", tone: "critical" },
    { iconId: "help", label: "Pomoc", tone: "ok" },
    { iconId: "meeting-point", label: "Místo setkání", tone: "ok" },
    { iconId: "water-source", label: "Zdroj vody", tone: "info" },
    { iconId: "evacuation", label: "Evakuační bod", tone: "info" },
    { iconId: "risk", label: "Riziko", tone: "critical" },
    { iconId: "note", label: "Poznámka", tone: "neutral" },
    { iconId: "shape-star", label: "Hvězda", shape: "star", tone: "info" },
    { iconId: "shape-circle", label: "Kruh", shape: "circle", tone: "info" },
    { iconId: "shape-square", label: "Čtverec", shape: "square", tone: "info" },
    { iconId: "shape-rectangle", label: "Obdélník", shape: "rectangle", tone: "info" },
    { iconId: "shape-diamond", label: "Kosočtverec", shape: "diamond", tone: "critical" },
    { iconId: "shape-triangle", label: "Trojúhelník", shape: "triangle", tone: "warning" },
    { iconId: "shape-wave", label: "Vlnka", shape: "wave", tone: "info" },
    { iconId: "shape-cross", label: "Kříž", shape: "cross", tone: "ok" }
  ];
  const professional = [
    { iconId: "app6-friendly", label: "APP-6 vlastní", sidc: "10031000001211000000" },
    { iconId: "app6-neutral", label: "APP-6 neutrální", sidc: "10031000001211000000" },
    { iconId: "app6-unknown", label: "APP-6 neznámé", sidc: "10011000001211000000" }
  ];
  return {
    contractVersion: "cop-sketch-palettes-v1",
    generatedAt: generatedAt.toISOString(),
    modes: {
      ...(mode === "all" || mode === "civil" ? { civil: { label: "Civilní značky", symbols: civil } } : {}),
      ...(mode === "all" || mode === "professional" ? { professional: { label: "Profesionální symboly", symbols: professional } } : {})
    }
  };
}

function buildSketchDrawingFeature(input: {
  actor: SketchDrawingActor;
  drawingId: string;
  geometry: SketchGeometry;
  input: CreateSketchDrawingInput;
  now: Date;
  revision: number;
}): SketchDrawingFeature {
  const style = normalizeStyle(input.input.style);
  const symbol = normalizeSymbol(input.input.symbol);
  return {
    geometry: normalizeGeometry(input.geometry),
    id: input.drawingId,
    properties: {
      createdAt: input.now.toISOString(),
      drawingId: input.drawingId,
      ...(input.input.eventId ? { eventId: input.input.eventId } : {}),
      ...(input.input.groupId ? { groupId: input.input.groupId } : {}),
      kind: input.input.kind,
      label: normalizeLabel(input.input.label, input.input.kind),
      locked: Boolean(input.input.locked),
      ownerDisplayName: input.actor.displayName,
      ownerSubjectId: input.actor.subjectId,
      ownerUsername: input.actor.username,
      properties: input.input.properties ?? {},
      revision: input.revision,
      style,
      symbol,
      updatedAt: input.now.toISOString(),
      visibility: input.input.visibility
    },
    type: "Feature"
  };
}

function mergeSketchDrawingFeature(
  current: SketchDrawingFeature,
  actor: SketchDrawingActor,
  input: UpdateSketchDrawingInput,
  now: Date,
  revision: number
): SketchDrawingFeature {
  return {
    ...current,
    geometry: input.geometry ? normalizeGeometry(input.geometry) : current.geometry,
    properties: {
      ...current.properties,
      ...(input.eventId !== undefined ? (input.eventId ? { eventId: input.eventId } : { eventId: undefined }) : {}),
      ...(input.groupId !== undefined ? (input.groupId ? { groupId: input.groupId } : { groupId: undefined }) : {}),
      kind: input.kind ?? current.properties.kind,
      label: input.label !== undefined ? normalizeLabel(input.label, input.kind ?? current.properties.kind) : current.properties.label,
      locked: input.locked ?? current.properties.locked,
      ownerDisplayName: actor.displayName,
      ownerSubjectId: actor.subjectId,
      ownerUsername: actor.username,
      properties: input.properties ?? current.properties.properties,
      revision,
      style: input.style ? normalizeStyle({ ...current.properties.style, ...input.style }) : current.properties.style,
      symbol: input.symbol ? normalizeSymbol({ ...current.properties.symbol, ...input.symbol }) : current.properties.symbol,
      updatedAt: now.toISOString(),
      visibility: input.visibility ?? current.properties.visibility
    }
  };
}

function sketchDrawingFromRow(row: SketchDrawingRow): SketchDrawingFeature {
  return {
    geometry: normalizeGeometry(row.geometry_json),
    id: row.drawing_id,
    properties: {
      createdAt: row.created_at.toISOString(),
      drawingId: row.drawing_id,
      ...(row.event_id ? { eventId: row.event_id } : {}),
      ...(row.group_id ? { groupId: row.group_id } : {}),
      kind: normalizeKind(row.kind),
      label: row.label ?? normalizeLabel(undefined, normalizeKind(row.kind)),
      locked: row.locked,
      ownerDisplayName: row.owner_display_name,
      ownerSubjectId: row.owner_subject_id,
      ownerUsername: row.owner_username,
      properties: normalizeRecord(row.properties),
      revision: row.revision,
      style: normalizeStyle(normalizeRecord(row.style)),
      symbol: normalizeSymbol(normalizeRecord(row.symbol)),
      updatedAt: row.updated_at.toISOString(),
      visibility: normalizeVisibility(row.visibility)
    },
    type: "Feature"
  };
}

interface SketchDrawingRow {
  created_at: Date;
  deleted_at: Date | null;
  drawing_id: string;
  event_id: string | null;
  geometry_json: unknown;
  group_id: string | null;
  kind: string;
  label: string | null;
  locked: boolean;
  owner_display_name: string;
  owner_subject_id: string;
  owner_username: string;
  properties: unknown;
  revision: number;
  style: unknown;
  symbol: unknown;
  updated_at: Date;
  visibility: string;
}

function canReadSketchDrawing(drawing: SketchDrawingFeature, subjectId: string | undefined, allowedGroupIds: Set<string>): boolean {
  if (drawing.properties.visibility === "public") {
    return true;
  }
  if (subjectId && drawing.properties.ownerSubjectId === subjectId) {
    return true;
  }
  if (drawing.properties.visibility === "group" && drawing.properties.groupId && allowedGroupIds.has(drawing.properties.groupId)) {
    return true;
  }
  return false;
}

function geometryIntersectsBbox(geometry: SketchGeometry, bbox: NonNullable<SketchDrawingQuery["bbox"]>): boolean {
  const coordinates = geometryCoordinates(geometry);
  return coordinates.some(([lon, lat]) => lon >= bbox.west && lon <= bbox.east && lat >= bbox.south && lat <= bbox.north);
}

function geometryCoordinates(geometry: SketchGeometry): Array<[number, number]> {
  if (geometry.type === "Point") {
    return [geometry.coordinates];
  }
  if (geometry.type === "LineString") {
    return geometry.coordinates;
  }
  return geometry.coordinates.flat();
}

function normalizeGeometry(value: unknown): SketchGeometry {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Invalid sketch geometry.");
  }
  if (value.type === "Point" && isCoordinate(value.coordinates)) {
    return { coordinates: value.coordinates, type: "Point" };
  }
  if (value.type === "LineString" && Array.isArray(value.coordinates)) {
    const coordinates = value.coordinates.filter(isCoordinate);
    if (coordinates.length >= 2) {
      return { coordinates, type: "LineString" };
    }
  }
  if (value.type === "Polygon" && Array.isArray(value.coordinates)) {
    const ring = value.coordinates[0];
    if (Array.isArray(ring)) {
      const coordinates = ring.filter(isCoordinate);
      if (coordinates.length >= 3) {
        const first = coordinates[0] as [number, number];
        const last = coordinates[coordinates.length - 1];
        if (!last || first[0] !== last[0] || first[1] !== last[1]) {
          coordinates.push(first);
        }
        return { coordinates: [coordinates], type: "Polygon" };
      }
    }
  }
  throw new Error("Invalid sketch geometry.");
}

function isCoordinate(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

function normalizeStyle(value: unknown): SketchDrawingStyle {
  const record = normalizeRecord(value);
  return {
    fill: normalizeColor(record.fill, "#2f80ed"),
    lineWidth: normalizeNumber(record.lineWidth, 1, 12, 2),
    opacity: normalizeNumber(record.opacity, 0, 1, 0.25),
    stroke: normalizeColor(record.stroke, "#2f80ed")
  };
}

function normalizeSymbol(value: unknown): SketchDrawingSymbol {
  const record = normalizeRecord(value);
  const palette = record.palette === "professional" ? "professional" : "civil";
  return {
    iconId: typeof record.iconId === "string" ? record.iconId.slice(0, 64) : "note",
    palette,
    ...(typeof record.sidc === "string" ? { sidc: record.sidc.slice(0, 32) } : {})
  };
}

function normalizeKind(value: unknown): SketchDrawingKind {
  return value === "arrow" || value === "circle" || value === "line" || value === "marker" || value === "measurement" || value === "point" || value === "polygon" || value === "text"
    ? value
    : "marker";
}

function normalizeVisibility(value: unknown): SketchDrawingVisibility {
  return value === "event" || value === "group" || value === "public" ? value : "private";
}

function normalizeLabel(value: unknown, kind: SketchDrawingKind): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text) {
    return text.slice(0, 140);
  }
  switch (kind) {
    case "line":
      return "Linie";
    case "measurement":
      return "Měření";
    case "polygon":
      return "Oblast";
    case "text":
      return "Popisek";
    case "arrow":
      return "Šipka";
    default:
      return "Zákres";
  }
}

function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/iu.test(value) ? value.toLowerCase() : fallback;
}

function normalizeNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addParam(params: unknown[], value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}

function resolveLimit(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.min(1000, Math.max(1, Math.trunc(value))) : 500;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readSslConfig(env: Record<string, string | undefined>): PoolConfig["ssl"] {
  if (env.COP_DATABASE_SSL === "true" || env.COP_DATABASE_SSL === "1") {
    return {
      rejectUnauthorized: env.COP_DATABASE_SSL_REJECT_UNAUTHORIZED !== "false"
    };
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireRow<T>(row: T | undefined): T {
  if (!row) {
    throw new Error("Sketch drawing query returned no row.");
  }
  return row;
}

const createSketchDrawingTablesSql = `
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS cop_user_drawings (
  drawing_id uuid PRIMARY KEY,
  owner_subject_id text NOT NULL,
  owner_username text NOT NULL,
  owner_display_name text NOT NULL,
  visibility text NOT NULL,
  group_id uuid,
  event_id text,
  kind text NOT NULL,
  label text,
  geometry geometry(Geometry, 4326) NOT NULL,
  style jsonb NOT NULL DEFAULT '{}'::jsonb,
  symbol jsonb NOT NULL DEFAULT '{}'::jsonb,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  locked boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS cop_user_drawings_geometry_gix
  ON cop_user_drawings USING gist (geometry)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS cop_user_drawings_owner_idx
  ON cop_user_drawings (owner_subject_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS cop_user_drawings_group_idx
  ON cop_user_drawings (group_id, updated_at DESC)
  WHERE group_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS cop_user_drawings_event_idx
  ON cop_user_drawings (event_id, updated_at DESC)
  WHERE event_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS cop_user_drawing_audit (
  audit_id bigserial PRIMARY KEY,
  drawing_id uuid NOT NULL,
  actor_subject_id text NOT NULL,
  action text NOT NULL,
  revision integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cop_user_drawing_audit_drawing_idx
  ON cop_user_drawing_audit (drawing_id, created_at DESC);
`;
