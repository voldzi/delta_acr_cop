import type { SourceSystem } from "@cop/canonical-model";
import type { SourceHealthOverride } from "./types.js";

export type MissionArenaLayerId = "presentation.mission_arena";
export type MissionArenaFeatureRole = "mission_state" | "team_state";

export interface MissionArenaSourceConfig {
  baseUrl: string;
  cacheTtlMs: number;
  enabled: boolean;
  timeoutMs: number;
}

export interface MissionArenaBbox {
  east: number;
  north: number;
  south: number;
  west: number;
}

export interface MissionArenaFeatureQuery {
  bbox: MissionArenaBbox;
  layers: MissionArenaLayerId[];
  limit: number;
}

export interface MissionArenaTeamScore {
  aggregate?: number;
  aggregateDelta?: number;
  color?: string;
  label: string;
  rank?: number;
  score?: Record<string, number>;
  scoreDelta?: Record<string, number>;
  teamId: string;
  totalVotes?: number;
}

export type MissionArenaGeometry =
  | { coordinates: [number, number]; type: "Point" }
  | { coordinates: Array<[number, number]>; type: "LineString" }
  | { coordinates: Array<Array<[number, number]>>; type: "Polygon" };

export interface MissionArenaFeatureProperties {
  aggregate?: number;
  aggregateDelta?: number;
  category: "mission_arena";
  confidence?: number;
  featureId: string;
  featureRole: MissionArenaFeatureRole;
  generatedAt?: string;
  integrationMode?: string;
  label: string;
  layer: "mission_arena";
  layerId: MissionArenaLayerId;
  missionId?: string;
  missionPackId?: string;
  participantCount?: number;
  phase?: string;
  providerId: "csm.mission-arena";
  runtimeMode?: string;
  score?: Record<string, number>;
  scoreDelta?: Record<string, number>;
  sourceId: "mission_arena_runtime";
  stale?: boolean;
  status?: string;
  story?: Record<string, unknown>;
  summary?: string;
  synthetic?: boolean;
  teamColor?: string;
  teamId?: string;
  teamLabel?: string;
  teamScores?: MissionArenaTeamScore[];
  totalVotes?: number;
  voteCount?: number;
}

export interface MissionArenaFeature {
  geometry: MissionArenaGeometry;
  id?: string | number;
  properties: MissionArenaFeatureProperties;
  type: "Feature";
}

export interface MissionArenaFeatureCollection {
  contractVersion: "cop-mission-arena-source-v1";
  features: MissionArenaFeature[];
  generatedAt: string;
  query: {
    bbox: MissionArenaBbox;
    layers: MissionArenaLayerId[];
    limit: number;
  };
  source: {
    generatedAt?: string;
    sourceId: "mission-arena-api";
    sourceType: "MISSION_ARENA_PRESENTATION";
  };
  sources: MissionArenaSourceDescriptor[];
  summary: {
    featureCount: number;
    missionStateCount: number;
    sourceCount: number;
    staleFeatureCount: number;
    teamStateCount: number;
    warningCount: number;
  };
  type: "FeatureCollection";
  warnings: string[];
}

export interface MissionArenaLayerDescriptor {
  defaultVisible: boolean;
  description?: string;
  expectedCadenceSeconds?: number;
  geometryTypes?: string[];
  label: string;
  layerId: MissionArenaLayerId;
}

export interface MissionArenaSourceDescriptor {
  baseUrl?: string;
  enabled?: boolean;
  label?: string;
  layers?: MissionArenaLayerId[];
  mode?: string;
  sourceId: "mission_arena_runtime";
  updateCadenceSeconds?: number;
}

export interface MissionArenaSource {
  readonly config: MissionArenaSourceConfig;
  readonly sourceSystem: SourceSystem;
  fetchFeatures(query: MissionArenaFeatureQuery, requestNow: Date): Promise<MissionArenaFeatureCollection>;
  fetchLayers(requestNow: Date): Promise<MissionArenaLayerDescriptor[]>;
  fetchSources(requestNow: Date): Promise<MissionArenaSourceDescriptor[]>;
}

interface MissionArenaProviderExport {
  contractVersion?: string;
  features?: unknown[];
  generatedAt?: string;
  providerId?: string;
  warnings?: unknown[];
}

const defaultConfig: MissionArenaSourceConfig = {
  baseUrl: "https://missionarena.zeleznalady.cz",
  cacheTtlMs: 5000,
  enabled: false,
  timeoutMs: 5000
};

const layerId: MissionArenaLayerId = "presentation.mission_arena";

export function createMissionArenaSourceConfigFromEnv(env: Record<string, string | undefined> = process.env): MissionArenaSourceConfig {
  return {
    baseUrl: trimTrailingSlash(env.COP_MISSION_ARENA_BASE_URL ?? defaultConfig.baseUrl),
    cacheTtlMs: readInteger(env.COP_MISSION_ARENA_CACHE_TTL_MS, defaultConfig.cacheTtlMs, 1000, 60000),
    enabled: readBoolean(env.COP_MISSION_ARENA_ENABLED, defaultConfig.enabled),
    timeoutMs: readInteger(env.COP_MISSION_ARENA_TIMEOUT_MS, defaultConfig.timeoutMs, 1000, 60000)
  };
}

export function createMissionArenaSourceFromEnv(env: Record<string, string | undefined> = process.env): MissionArenaSource | undefined {
  const config = createMissionArenaSourceConfigFromEnv(env);
  return config.enabled ? new MissionArenaSourceAdapter(config) : undefined;
}

export class MissionArenaSourceAdapter implements MissionArenaSource {
  readonly sourceSystem: SourceSystem;
  private exportCache: { expiresAtMs: number; value: MissionArenaProviderExport } | null = null;
  private exportInflight: Promise<MissionArenaProviderExport> | null = null;

  constructor(readonly config: MissionArenaSourceConfig) {
    this.sourceSystem = createMissionArenaSourceSystem();
  }

  async fetchLayers(_requestNow: Date): Promise<MissionArenaLayerDescriptor[]> {
    return [
      {
        defaultVisible: false,
        description: "Prezentační stav Mission Arena eventu. COP skóre pouze zobrazuje.",
        expectedCadenceSeconds: Math.max(1, Math.round(this.config.cacheTtlMs / 1000)),
        geometryTypes: ["Point", "Polygon"],
        label: "Mission Arena",
        layerId
      }
    ];
  }

  async fetchSources(_requestNow: Date): Promise<MissionArenaSourceDescriptor[]> {
    return [
      {
        baseUrl: this.config.baseUrl,
        enabled: true,
        label: "Mission Arena runtime",
        layers: [layerId],
        mode: "live",
        sourceId: "mission_arena_runtime",
        updateCadenceSeconds: Math.max(1, Math.round(this.config.cacheTtlMs / 1000))
      }
    ];
  }

  async fetchFeatures(query: MissionArenaFeatureQuery, requestNow: Date): Promise<MissionArenaFeatureCollection> {
    const normalizedQuery = normalizeMissionArenaQuery(query);
    const upstream = await this.fetchExport(requestNow);
    const warnings = normalizeWarnings(upstream.warnings);
    if (upstream.contractVersion && upstream.contractVersion !== "cop-provider-featurecollection-v1") {
      warnings.push(`Unsupported Mission Arena contract: ${upstream.contractVersion}.`);
    }
    if (upstream.providerId && upstream.providerId !== "csm.mission-arena") {
      warnings.push(`Unexpected Mission Arena provider: ${upstream.providerId}.`);
    }
    const allFeatures = (Array.isArray(upstream.features) ? upstream.features : [])
      .flatMap(normalizeMissionArenaFeature)
      .filter((feature) => normalizedQuery.layers.includes(feature.properties.layerId));
    const features = allFeatures
      .filter((feature) => isFeatureInBbox(feature, normalizedQuery.bbox))
      .slice(0, normalizedQuery.limit);
    const generatedAt = upstream.generatedAt ?? requestNow.toISOString();
    return {
      contractVersion: "cop-mission-arena-source-v1",
      features,
      generatedAt,
      query: normalizedQuery,
      source: {
        generatedAt,
        sourceId: "mission-arena-api",
        sourceType: "MISSION_ARENA_PRESENTATION"
      },
      sources: await this.fetchSources(requestNow),
      summary: {
        featureCount: features.length,
        missionStateCount: features.filter((feature) => feature.properties.featureRole === "mission_state").length,
        sourceCount: 1,
        staleFeatureCount: features.filter((feature) => feature.properties.stale).length,
        teamStateCount: features.filter((feature) => feature.properties.featureRole === "team_state").length,
        warningCount: warnings.length
      },
      type: "FeatureCollection",
      warnings
    };
  }

  private async fetchExport(requestNow: Date): Promise<MissionArenaProviderExport> {
    if (this.exportCache && this.exportCache.expiresAtMs > requestNow.getTime()) {
      return this.exportCache.value;
    }
    if (this.exportInflight) {
      return this.exportInflight;
    }
    this.exportInflight = fetchMissionArenaExport(this.config);
    try {
      const value = await this.exportInflight;
      this.exportCache = {
        expiresAtMs: requestNow.getTime() + this.config.cacheTtlMs,
        value
      };
      return value;
    } finally {
      this.exportInflight = null;
    }
  }
}

export function buildMissionArenaHealth(response: MissionArenaFeatureCollection | MissionArenaLayerDescriptor[], requestNow: Date): SourceHealthOverride {
  if (Array.isArray(response)) {
    return {
      detail: `layers ${response.length}`,
      evaluatedAt: requestNow.toISOString(),
      health: response.length > 0 ? "ONLINE" : "WAITING",
      lastPollAt: requestNow.toISOString(),
      lastSuccessAt: requestNow.toISOString(),
      summary: {
        layerCount: response.length
      }
    };
  }

  const warningCount = response.warnings.length || response.summary.warningCount;
  return {
    detail: `mission states ${response.summary.missionStateCount}, team states ${response.summary.teamStateCount}, warnings ${warningCount}`,
    evaluatedAt: requestNow.toISOString(),
    generatedAt: response.generatedAt,
    health: warningCount > 0 ? "DEGRADED" : response.summary.staleFeatureCount > 0 ? "STALE" : "ONLINE",
    lastPollAt: requestNow.toISOString(),
    lastSuccessAt: requestNow.toISOString(),
    summary: {
      featureCount: response.summary.featureCount,
      missionStateCount: response.summary.missionStateCount,
      sourceCount: response.summary.sourceCount,
      staleFeatureCount: response.summary.staleFeatureCount,
      teamStateCount: response.summary.teamStateCount,
      warningCount
    },
    warnings: response.warnings
  };
}

export function unavailableMissionArenaHealth(error: unknown, requestNow: Date): SourceHealthOverride {
  return {
    detail: "Mission Arena source is unavailable.",
    evaluatedAt: requestNow.toISOString(),
    health: "UNAVAILABLE",
    lastError: error instanceof Error ? error.message : "unknown error",
    lastPollAt: requestNow.toISOString(),
    warnings: ["Mission Arena request failed."]
  };
}

export function emptyMissionArenaFeatureCollection(query: MissionArenaFeatureQuery, requestNow: Date, warnings: string[] = []): MissionArenaFeatureCollection {
  return {
    contractVersion: "cop-mission-arena-source-v1",
    features: [],
    generatedAt: requestNow.toISOString(),
    query: normalizeMissionArenaQuery(query),
    source: {
      generatedAt: requestNow.toISOString(),
      sourceId: "mission-arena-api",
      sourceType: "MISSION_ARENA_PRESENTATION"
    },
    sources: [],
    summary: {
      featureCount: 0,
      missionStateCount: 0,
      sourceCount: 0,
      staleFeatureCount: 0,
      teamStateCount: 0,
      warningCount: warnings.length
    },
    type: "FeatureCollection",
    warnings
  };
}

function createMissionArenaSourceSystem(): SourceSystem {
  const now = new Date().toISOString();
  return {
    attributes: {
      contextOnly: true,
      contractVersion: "cop-provider-featurecollection-v1",
      integrationMode: "presentation",
      presentationOnly: true,
      providerId: "csm.mission-arena"
    },
    allowedEventTypes: [],
    allowedObjectTypes: ["REPORT", "UNKNOWN"],
    classificationLimit: "UNCLASSIFIED",
    createdAt: now,
    displayName: "Mission Arena",
    owner: "Mission Arena",
    sourceSystemId: "csm.mission-arena",
    sourceType: "PUBLIC_SITUATION_AGGREGATE",
    status: "ACTIVE",
    synthetic: false,
    trustProfile: "UNKNOWN",
    updatedAt: now
  };
}

async function fetchMissionArenaExport(config: MissionArenaSourceConfig): Promise<MissionArenaProviderExport> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const url = new URL("/api/cop/export", config.baseUrl);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Mission Arena request failed with HTTP ${response.status}`);
    }
    const value = await response.json();
    if (!isRecord(value)) {
      throw new Error("Mission Arena response is not an object.");
    }
    return value;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeMissionArenaQuery(query: MissionArenaFeatureQuery): MissionArenaFeatureQuery {
  return {
    bbox: {
      east: clampNumber(query.bbox.east, -180, 180),
      north: clampNumber(query.bbox.north, -90, 90),
      south: clampNumber(query.bbox.south, -90, 90),
      west: clampNumber(query.bbox.west, -180, 180)
    },
    layers: query.layers.includes(layerId) ? [layerId] : [layerId],
    limit: Math.round(clampNumber(query.limit, 1, 250))
  };
}

function normalizeMissionArenaFeature(value: unknown): MissionArenaFeature[] {
  if (!isRecord(value) || value.type !== "Feature" || !isRecord(value.properties)) {
    return [];
  }
  const geometry = normalizeGeometry(value.geometry);
  if (!geometry) {
    return [];
  }
  const rawProperties = value.properties;
  const rawLayerId = stringProperty(rawProperties.layerId);
  if (rawLayerId !== layerId) {
    return [];
  }
  const featureRole = normalizeFeatureRole(rawProperties.featureRole);
  const missionId = stringProperty(rawProperties.missionId);
  const teamId = stringProperty(rawProperties.teamId);
  const featureId = stringProperty(rawProperties.featureId)
    ?? stringProperty(value.id)
    ?? ["mission-arena", missionId, featureRole, teamId ?? "state"].filter(Boolean).join(":");
  const label = stringProperty(rawProperties.label)
    ?? stringProperty(rawProperties.teamLabel)
    ?? missionId
    ?? "Mission Arena";
  const properties: MissionArenaFeatureProperties = {
    category: "mission_arena",
    featureId,
    featureRole,
    label,
    layer: "mission_arena",
    layerId,
    providerId: "csm.mission-arena",
    sourceId: "mission_arena_runtime",
    ...(numberProperty(rawProperties.aggregate) !== undefined ? { aggregate: numberProperty(rawProperties.aggregate) } : {}),
    ...(numberProperty(rawProperties.aggregateDelta) !== undefined ? { aggregateDelta: numberProperty(rawProperties.aggregateDelta) } : {}),
    ...(numberProperty(rawProperties.confidence) !== undefined ? { confidence: numberProperty(rawProperties.confidence) } : {}),
    ...(stringProperty(rawProperties.generatedAt) ? { generatedAt: stringProperty(rawProperties.generatedAt) } : {}),
    ...(stringProperty(rawProperties.integrationMode) ? { integrationMode: stringProperty(rawProperties.integrationMode) } : {}),
    ...(missionId ? { missionId } : {}),
    ...(stringProperty(rawProperties.missionPackId) ? { missionPackId: stringProperty(rawProperties.missionPackId) } : {}),
    ...(numberProperty(rawProperties.participantCount) !== undefined ? { participantCount: numberProperty(rawProperties.participantCount) } : {}),
    ...(stringProperty(rawProperties.phase) ? { phase: stringProperty(rawProperties.phase) } : {}),
    ...(normalizeNumberRecord(rawProperties.score) ? { score: normalizeNumberRecord(rawProperties.score) } : {}),
    ...(normalizeNumberRecord(rawProperties.scoreDelta) ? { scoreDelta: normalizeNumberRecord(rawProperties.scoreDelta) } : {}),
    ...(stringProperty(rawProperties.runtimeMode) ? { runtimeMode: stringProperty(rawProperties.runtimeMode) } : {}),
    ...(typeof rawProperties.stale === "boolean" ? { stale: rawProperties.stale } : {}),
    ...(stringProperty(rawProperties.status) ? { status: stringProperty(rawProperties.status) } : {}),
    ...(isRecord(rawProperties.story) ? { story: rawProperties.story } : {}),
    ...(stringProperty(rawProperties.summary) ? { summary: stringProperty(rawProperties.summary) } : {}),
    ...(typeof rawProperties.synthetic === "boolean" ? { synthetic: rawProperties.synthetic } : {}),
    ...(stringProperty(rawProperties.teamColor) ? { teamColor: stringProperty(rawProperties.teamColor) } : {}),
    ...(teamId ? { teamId } : {}),
    ...(stringProperty(rawProperties.teamLabel) ? { teamLabel: stringProperty(rawProperties.teamLabel) } : {}),
    ...(normalizeTeamScores(rawProperties.teamScores) ? { teamScores: normalizeTeamScores(rawProperties.teamScores) } : {}),
    ...(numberProperty(rawProperties.totalVotes) !== undefined ? { totalVotes: numberProperty(rawProperties.totalVotes) } : {}),
    ...(numberProperty(rawProperties.voteCount) !== undefined ? { voteCount: numberProperty(rawProperties.voteCount) } : {})
  };
  return [{
    geometry,
    id: typeof value.id === "string" || typeof value.id === "number" ? value.id : featureId,
    properties,
    type: "Feature"
  }];
}

function normalizeFeatureRole(value: unknown): MissionArenaFeatureRole {
  return value === "team_state" ? "team_state" : "mission_state";
}

function normalizeTeamScores(value: unknown): MissionArenaTeamScore[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const scores = value.flatMap((entry): MissionArenaTeamScore[] => {
    if (!isRecord(entry)) {
      return [];
    }
    const teamId = stringProperty(entry.teamId);
    const label = stringProperty(entry.label) ?? teamId;
    if (!teamId || !label) {
      return [];
    }
    return [{
      label,
      teamId,
      ...(numberProperty(entry.aggregate) !== undefined ? { aggregate: numberProperty(entry.aggregate) } : {}),
      ...(numberProperty(entry.aggregateDelta) !== undefined ? { aggregateDelta: numberProperty(entry.aggregateDelta) } : {}),
      ...(stringProperty(entry.color) ? { color: stringProperty(entry.color) } : {}),
      ...(numberProperty(entry.rank) !== undefined ? { rank: numberProperty(entry.rank) } : {}),
      ...(normalizeNumberRecord(entry.score) ? { score: normalizeNumberRecord(entry.score) } : {}),
      ...(normalizeNumberRecord(entry.scoreDelta) ? { scoreDelta: normalizeNumberRecord(entry.scoreDelta) } : {}),
      ...(numberProperty(entry.totalVotes) !== undefined ? { totalVotes: numberProperty(entry.totalVotes) } : {})
    }];
  });
  return scores.length > 0 ? scores : undefined;
}

function normalizeNumberRecord(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const entries = Object.entries(value).flatMap(([key, entry]): Array<[string, number]> => {
    const numberValue = numberProperty(entry);
    return key && numberValue !== undefined ? [[key, numberValue]] : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeWarnings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function normalizeGeometry(value: unknown): MissionArenaGeometry | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }
  if (value.type === "Point" && isPosition(value.coordinates)) {
    return { coordinates: value.coordinates, type: "Point" };
  }
  if (value.type === "LineString" && Array.isArray(value.coordinates) && value.coordinates.every(isPosition)) {
    return { coordinates: value.coordinates, type: "LineString" };
  }
  if (
    value.type === "Polygon"
    && Array.isArray(value.coordinates)
    && value.coordinates.every((ring) => Array.isArray(ring) && ring.every(isPosition))
  ) {
    return { coordinates: value.coordinates, type: "Polygon" };
  }
  return null;
}

function isFeatureInBbox(feature: MissionArenaFeature, bbox: MissionArenaBbox): boolean {
  const geometryBboxValue = geometryBbox(feature.geometry);
  return geometryBboxValue ? bboxIntersects(geometryBboxValue, bbox) : false;
}

function geometryBbox(geometry: MissionArenaGeometry): MissionArenaBbox | null {
  const coordinates = geometryCoordinates(geometry);
  if (coordinates.length === 0) {
    return null;
  }
  const lons = coordinates.map(([lon]) => lon);
  const lats = coordinates.map(([, lat]) => lat);
  return {
    east: Math.max(...lons),
    north: Math.max(...lats),
    south: Math.min(...lats),
    west: Math.min(...lons)
  };
}

function geometryCoordinates(geometry: MissionArenaGeometry): Array<[number, number]> {
  if (geometry.type === "Point") {
    return [geometry.coordinates];
  }
  if (geometry.type === "LineString") {
    return geometry.coordinates;
  }
  return geometry.coordinates.flat();
}

function bboxIntersects(a: MissionArenaBbox, b: MissionArenaBbox): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

function isPosition(value: unknown): value is [number, number] {
  return Array.isArray(value)
    && value.length >= 2
    && typeof value[0] === "number"
    && Number.isFinite(value[0])
    && typeof value[1] === "number"
    && Number.isFinite(value[1]);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.round(clampNumber(parsed, min, max));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function numberProperty(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringProperty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
