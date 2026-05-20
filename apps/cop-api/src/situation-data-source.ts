import { createPublicSituationAggregateSourceSystem, type SourceSystem } from "@cop/canonical-model";
import type { SourceHealthOverride } from "./types.js";

export type SituationLayerId = "ground" | "mobile" | "traffic" | "weather";

export interface SituationDataSourceConfig {
  baseUrl: string;
  cacheTtlMs: number;
  enabled: boolean;
  maxLimit: number;
  timeoutMs: number;
}

export interface SituationFeatureQuery {
  bbox: SituationBbox;
  layers: SituationLayerId[];
  limit: number;
}

export interface SituationBbox {
  east: number;
  north: number;
  south: number;
  west: number;
}

export interface SituationLayerDescriptor {
  defaultVisible: boolean;
  description?: string;
  expectedCadenceSeconds?: number;
  geometryTypes?: string[];
  label: string;
  layerId: SituationLayerId;
}

export interface SituationFeatureCollection {
  contractVersion: "cop-situation-source-v1";
  features: SituationFeature[];
  generatedAt: string;
  query: {
    bbox: SituationBbox;
    layers: SituationLayerId[];
    limit: number;
    sources?: string[];
  };
  source: {
    generatedAt?: string;
    sourceId: "situation-data-api";
    sourceType: "PUBLIC_SITUATION_AGGREGATE";
  };
  sources: SituationSourceDescriptor[];
  summary: {
    featureCount: number;
    sourceCount: number;
    staleFeatureCount: number;
    warningCount: number;
  };
  type: "FeatureCollection";
  warnings: string[];
}

export interface SituationFeature {
  geometry: SituationGeometry;
  id?: string | number;
  properties: SituationFeatureProperties;
  type: "Feature";
}

export type SituationGeometry =
  | { coordinates: [number, number]; type: "Point" }
  | { coordinates: Array<[number, number]>; type: "LineString" }
  | { coordinates: Array<Array<[number, number]>>; type: "Polygon" };

export interface SituationFeatureProperties {
  category: string;
  confidence?: number;
  featureId: string;
  label: string;
  layer: SituationLayerId;
  license?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  observedAt?: string;
  severity?: "advisory" | "critical" | "info" | "warning" | string;
  sourceId: string;
  stale?: boolean;
  tags?: Record<string, unknown>;
}

export interface SituationSourceDescriptor {
  baseUrl?: string;
  enabled?: boolean;
  label?: string;
  layers?: SituationLayerId[];
  license?: Record<string, unknown>;
  mode?: string;
  priority?: number;
  sourceId: string;
  updateCadenceSeconds?: number;
}

export interface SituationDataSource {
  readonly config: SituationDataSourceConfig;
  readonly sourceSystem: SourceSystem;
  fetchFeatures(query: SituationFeatureQuery, requestNow: Date): Promise<SituationFeatureCollection>;
  fetchLayers(requestNow: Date): Promise<SituationLayerDescriptor[]>;
}

const defaultConfig: SituationDataSourceConfig = {
  baseUrl: "https://sim.zeleznalady.cz/situation-data/api/v1",
  cacheTtlMs: 20000,
  enabled: false,
  maxLimit: 250,
  timeoutMs: 7000
};

const allowedLayerIds: SituationLayerId[] = ["weather", "ground", "mobile", "traffic"];

export function createSituationDataSourceConfigFromEnv(env: Record<string, string | undefined> = process.env): SituationDataSourceConfig {
  return {
    baseUrl: trimTrailingSlash(env.COP_SITUATION_DATA_BASE_URL ?? defaultConfig.baseUrl),
    cacheTtlMs: readInteger(env.COP_SITUATION_DATA_CACHE_TTL_MS, defaultConfig.cacheTtlMs, 1000, 300000),
    enabled: readBoolean(env.COP_SITUATION_DATA_ENABLED, defaultConfig.enabled),
    maxLimit: readInteger(env.COP_SITUATION_DATA_MAX_LIMIT, defaultConfig.maxLimit, 1, 1000),
    timeoutMs: readInteger(env.COP_SITUATION_DATA_TIMEOUT_MS, defaultConfig.timeoutMs, 1000, 60000)
  };
}

export function createSituationDataSourceFromEnv(env: Record<string, string | undefined> = process.env): SituationDataSource | undefined {
  const config = createSituationDataSourceConfigFromEnv(env);
  return config.enabled ? new SituationDataSourceAdapter(config) : undefined;
}

export class SituationDataSourceAdapter implements SituationDataSource {
  readonly sourceSystem: SourceSystem;
  private readonly featureCache = new Map<string, { expiresAtMs: number; value: SituationFeatureCollection }>();
  private layerCache: { expiresAtMs: number; value: SituationLayerDescriptor[] } | null = null;

  constructor(readonly config: SituationDataSourceConfig) {
    this.sourceSystem = createPublicSituationAggregateSourceSystem();
  }

  async fetchLayers(requestNow: Date): Promise<SituationLayerDescriptor[]> {
    if (this.layerCache && this.layerCache.expiresAtMs > requestNow.getTime()) {
      return this.layerCache.value;
    }
    const layers = await fetchSituationLayers(this.config, requestNow);
    this.layerCache = {
      expiresAtMs: requestNow.getTime() + this.config.cacheTtlMs,
      value: layers
    };
    return layers;
  }

  async fetchFeatures(query: SituationFeatureQuery, requestNow: Date): Promise<SituationFeatureCollection> {
    const normalizedQuery = normalizeSituationFeatureQuery(query, this.config);
    const cacheKey = situationFeatureCacheKey(normalizedQuery);
    const cached = this.featureCache.get(cacheKey);
    if (cached && cached.expiresAtMs > requestNow.getTime()) {
      return cached.value;
    }
    const value = await fetchSituationFeatures(this.config, normalizedQuery, requestNow);
    this.featureCache.set(cacheKey, {
      expiresAtMs: requestNow.getTime() + this.config.cacheTtlMs,
      value
    });
    if (this.featureCache.size > 24) {
      const oldestKey = this.featureCache.keys().next().value;
      if (oldestKey) {
        this.featureCache.delete(oldestKey);
      }
    }
    return value;
  }
}

export function buildSituationDataHealth(response: SituationFeatureCollection | SituationLayerDescriptor[], requestNow: Date): SourceHealthOverride {
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
  const health: SourceHealthOverride["health"] = warningCount > 0
    ? "DEGRADED"
    : response.summary.staleFeatureCount > 0
      ? "STALE"
      : "ONLINE";
  return {
    detail: `features ${response.summary.featureCount}, stale ${response.summary.staleFeatureCount}, warnings ${warningCount}`,
    evaluatedAt: requestNow.toISOString(),
    generatedAt: response.generatedAt,
    health,
    lastPollAt: requestNow.toISOString(),
    lastSuccessAt: requestNow.toISOString(),
    summary: {
      featureCount: response.summary.featureCount,
      sourceCount: response.summary.sourceCount,
      staleFeatureCount: response.summary.staleFeatureCount,
      warningCount
    },
    warnings: response.warnings
  };
}

export function unavailableSituationDataHealth(error: unknown, requestNow: Date): SourceHealthOverride {
  return {
    detail: "Situation data source is unavailable.",
    evaluatedAt: requestNow.toISOString(),
    health: "UNAVAILABLE",
    lastError: error instanceof Error ? error.message : "unknown error",
    lastPollAt: requestNow.toISOString(),
    warnings: ["Situation data request failed."]
  };
}

export function emptySituationFeatureCollection(query: SituationFeatureQuery, requestNow: Date, warnings: string[] = []): SituationFeatureCollection {
  return {
    contractVersion: "cop-situation-source-v1",
    features: [],
    generatedAt: requestNow.toISOString(),
    query,
    source: {
      generatedAt: requestNow.toISOString(),
      sourceId: "situation-data-api",
      sourceType: "PUBLIC_SITUATION_AGGREGATE"
    },
    sources: [],
    summary: {
      featureCount: 0,
      sourceCount: 0,
      staleFeatureCount: 0,
      warningCount: warnings.length
    },
    type: "FeatureCollection",
    warnings
  };
}

export function parseSituationFeatureQuery(rawQuery: Record<string, unknown>, config: SituationDataSourceConfig): SituationFeatureQuery | null {
  const bbox = typeof rawQuery.bbox === "string" ? parseSituationBbox(rawQuery.bbox) : null;
  if (!bbox) {
    return null;
  }
  return normalizeSituationFeatureQuery({
    bbox,
    layers: parseSituationLayers(typeof rawQuery.layers === "string" ? rawQuery.layers : undefined),
    limit: optionalNumber(rawQuery.limit) ?? config.maxLimit
  }, config);
}

export function normalizeSituationFeatureQuery(query: SituationFeatureQuery, config: SituationDataSourceConfig): SituationFeatureQuery {
  return {
    bbox: {
      east: clampNumber(query.bbox.east, -180, 180),
      north: clampNumber(query.bbox.north, -90, 90),
      south: clampNumber(query.bbox.south, -90, 90),
      west: clampNumber(query.bbox.west, -180, 180)
    },
    layers: query.layers.filter(isSituationLayerId).length > 0
      ? uniqueLayers(query.layers.filter(isSituationLayerId))
      : ["weather"],
    limit: Math.round(clampNumber(query.limit, 1, config.maxLimit))
  };
}

async function fetchSituationLayers(config: SituationDataSourceConfig, requestNow: Date): Promise<SituationLayerDescriptor[]> {
  const response = await fetchJson(new URL(`${trimTrailingSlash(config.baseUrl)}/layers`), config, requestNow);
  if (!isRecord(response) || !Array.isArray(response.items)) {
    throw new Error("Situation layers response is incomplete.");
  }
  return response.items.flatMap(normalizeSituationLayer);
}

async function fetchSituationFeatures(config: SituationDataSourceConfig, query: SituationFeatureQuery, requestNow: Date): Promise<SituationFeatureCollection> {
  const url = new URL(`${trimTrailingSlash(config.baseUrl)}/cop/features`);
  url.searchParams.set("bbox", `${query.bbox.west},${query.bbox.south},${query.bbox.east},${query.bbox.north}`);
  url.searchParams.set("layers", query.layers.join(","));
  url.searchParams.set("limit", String(query.limit));
  return normalizeSituationFeatureCollection(await fetchJson(url, config, requestNow), query);
}

async function fetchJson(url: URL, config: SituationDataSourceConfig, requestNow: Date): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-COP-Request-At": requestNow.toISOString()
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText || "Situation data request failed"}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSituationFeatureCollection(value: unknown, fallbackQuery: SituationFeatureQuery): SituationFeatureCollection {
  if (!isRecord(value) || value.contractVersion !== "cop-situation-source-v1" || value.type !== "FeatureCollection") {
    throw new Error("Situation data response does not match cop-situation-source-v1.");
  }
  if (!isRecord(value.source) || value.source.sourceId !== "situation-data-api" || value.source.sourceType !== "PUBLIC_SITUATION_AGGREGATE") {
    throw new Error("Situation data source descriptor is not valid.");
  }
  return {
    contractVersion: "cop-situation-source-v1",
    features: Array.isArray(value.features) ? value.features.flatMap(normalizeSituationFeature) : [],
    generatedAt: optionalString(value.generatedAt) ?? new Date().toISOString(),
    query: normalizeResponseQuery(value.query, fallbackQuery),
    source: {
      generatedAt: optionalString(value.source.generatedAt),
      sourceId: "situation-data-api",
      sourceType: "PUBLIC_SITUATION_AGGREGATE"
    },
    sources: Array.isArray(value.sources) ? value.sources.flatMap(normalizeSituationSourceDescriptor) : [],
    summary: normalizeSituationSummary(value.summary, Array.isArray(value.features) ? value.features.length : 0),
    type: "FeatureCollection",
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((warning): warning is string => typeof warning === "string") : []
  };
}

function normalizeSituationLayer(value: unknown): SituationLayerDescriptor[] {
  if (!isRecord(value) || !isSituationLayerId(value.layerId) || typeof value.label !== "string") {
    return [];
  }
  return [
    {
      defaultVisible: value.defaultVisible === true,
      description: optionalString(value.description),
      expectedCadenceSeconds: optionalNumber(value.expectedCadenceSeconds),
      geometryTypes: Array.isArray(value.geometryTypes) ? value.geometryTypes.filter((item): item is string => typeof item === "string") : undefined,
      label: value.label,
      layerId: value.layerId
    }
  ];
}

function normalizeSituationFeature(value: unknown): SituationFeature[] {
  if (!isRecord(value) || value.type !== "Feature" || !isRecord(value.properties)) {
    return [];
  }
  const geometry = normalizeGeometry(value.geometry);
  const properties = normalizeSituationProperties(value.properties);
  if (!geometry || !properties) {
    return [];
  }
  return [
    {
      geometry,
      id: typeof value.id === "string" || typeof value.id === "number" ? value.id : properties.featureId,
      properties,
      type: "Feature"
    }
  ];
}

function normalizeSituationProperties(value: Record<string, unknown>): SituationFeatureProperties | null {
  if (!isSituationLayerId(value.layer)) {
    return null;
  }
  const featureId = optionalString(value.featureId);
  const category = optionalString(value.category);
  const label = optionalString(value.label);
  const sourceId = optionalString(value.sourceId);
  if (!featureId || !category || !label || !sourceId) {
    return null;
  }
  return {
    category,
    confidence: optionalFinite(value.confidence),
    featureId,
    label,
    layer: value.layer,
    license: isRecord(value.license) ? value.license : undefined,
    metrics: isRecord(value.metrics) ? value.metrics : undefined,
    observedAt: optionalString(value.observedAt),
    severity: optionalString(value.severity),
    sourceId,
    stale: typeof value.stale === "boolean" ? value.stale : undefined,
    tags: isRecord(value.tags) ? value.tags : undefined
  };
}

function normalizeSituationSourceDescriptor(value: unknown): SituationSourceDescriptor[] {
  if (!isRecord(value) || typeof value.sourceId !== "string") {
    return [];
  }
  return [
    {
      baseUrl: optionalString(value.baseUrl),
      enabled: typeof value.enabled === "boolean" ? value.enabled : undefined,
      label: optionalString(value.label),
      layers: Array.isArray(value.layers) ? value.layers.filter(isSituationLayerId) : undefined,
      license: isRecord(value.license) ? value.license : undefined,
      mode: optionalString(value.mode),
      priority: optionalNumber(value.priority),
      sourceId: value.sourceId,
      updateCadenceSeconds: optionalNumber(value.updateCadenceSeconds)
    }
  ];
}

function normalizeSituationSummary(value: unknown, fallbackFeatureCount: number): SituationFeatureCollection["summary"] {
  const summary = isRecord(value) ? value : {};
  return {
    featureCount: optionalNumber(summary.featureCount) ?? fallbackFeatureCount,
    sourceCount: optionalNumber(summary.sourceCount) ?? 0,
    staleFeatureCount: optionalNumber(summary.staleFeatureCount) ?? 0,
    warningCount: optionalNumber(summary.warningCount) ?? 0
  };
}

function normalizeResponseQuery(value: unknown, fallback: SituationFeatureQuery): SituationFeatureCollection["query"] {
  if (!isRecord(value) || !isRecord(value.bbox)) {
    return fallback;
  }
  return {
    bbox: {
      east: optionalNumber(value.bbox.east) ?? fallback.bbox.east,
      north: optionalNumber(value.bbox.north) ?? fallback.bbox.north,
      south: optionalNumber(value.bbox.south) ?? fallback.bbox.south,
      west: optionalNumber(value.bbox.west) ?? fallback.bbox.west
    },
    layers: Array.isArray(value.layers) ? value.layers.filter(isSituationLayerId) : fallback.layers,
    limit: optionalNumber(value.limit) ?? fallback.limit,
    sources: Array.isArray(value.sources) ? value.sources.filter((source): source is string => typeof source === "string") : undefined
  };
}

function normalizeGeometry(value: unknown): SituationGeometry | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.type === "Point" && Array.isArray(value.coordinates)) {
    const point = tupleCoordinate(value.coordinates);
    return point ? { coordinates: point, type: "Point" } : null;
  }
  if (value.type === "LineString" && Array.isArray(value.coordinates)) {
    const coordinates = value.coordinates.flatMap((item) => {
      const point = tupleCoordinate(item);
      return point ? [point] : [];
    });
    return coordinates.length >= 2 ? { coordinates, type: "LineString" } : null;
  }
  if (value.type === "Polygon" && Array.isArray(value.coordinates)) {
    const rings = value.coordinates.flatMap((ring) => {
      if (!Array.isArray(ring)) {
        return [];
      }
      const coordinates = ring.flatMap((item) => {
        const point = tupleCoordinate(item);
        return point ? [point] : [];
      });
      return coordinates.length >= 4 ? [coordinates] : [];
    });
    return rings.length > 0 ? { coordinates: rings, type: "Polygon" } : null;
  }
  return null;
}

function tupleCoordinate(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }
  const lon = Number(value[0]);
  const lat = Number(value[1]);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [clampNumber(lon, -180, 180), clampNumber(lat, -90, 90)] : null;
}

function parseSituationBbox(value: string): SituationBbox | null {
  const [westRaw, southRaw, eastRaw, northRaw] = value.split(",");
  const west = Number(westRaw);
  const south = Number(southRaw);
  const east = Number(eastRaw);
  const north = Number(northRaw);
  if (![west, south, east, north].every(Number.isFinite) || west >= east || south >= north) {
    return null;
  }
  return { east, north, south, west };
}

function parseSituationLayers(value: string | undefined): SituationLayerId[] {
  if (!value) {
    return ["weather"];
  }
  const layers = value.split(",").map((item) => item.trim()).filter(isSituationLayerId);
  return layers.length > 0 ? uniqueLayers(layers) : ["weather"];
}

function situationFeatureCacheKey(query: SituationFeatureQuery): string {
  return [
    query.bbox.west.toFixed(4),
    query.bbox.south.toFixed(4),
    query.bbox.east.toFixed(4),
    query.bbox.north.toFixed(4),
    query.layers.join(","),
    query.limit
  ].join("|");
}

function uniqueLayers(layers: SituationLayerId[]): SituationLayerId[] {
  return allowedLayerIds.filter((layer) => layers.includes(layer));
}

function isSituationLayerId(value: unknown): value is SituationLayerId {
  return typeof value === "string" && allowedLayerIds.includes(value as SituationLayerId);
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

function optionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalFinite(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampNumber(parsed, 0, 1) : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
