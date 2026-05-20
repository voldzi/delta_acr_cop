import { createPublicSituationAggregateSourceSystem, type SourceSystem } from "@cop/canonical-model";
import type { SourceHealthOverride } from "./types.js";

export type SituationLayerId = "air_quality" | "flood" | "ground" | "mobile" | "traffic" | "warnings" | "weather";

type SituationCacheStatus = "coalesced" | "hit" | "miss" | "stale";

export interface SituationDataCacheStats {
  entries: number;
  inflight: number;
  hits: number;
  misses: number;
  coalescedHits: number;
  staleHits: number;
  refreshes: number;
  errors: number;
  evictions: number;
}

export interface SituationDataSourceConfig {
  baseUrl: string;
  cacheMaxEntries?: number;
  cacheTtlMs: number;
  enabled: boolean;
  layerCacheTtlMs?: Partial<Record<SituationLayerId, number>>;
  maxLimit: number;
  sourceCacheTtlMs?: Record<string, number>;
  staleIfErrorMs?: number;
  timeoutMs: number;
}

export interface SituationFeatureQuery {
  bbox: SituationBbox;
  layers: SituationLayerId[];
  limit: number;
  sources?: string[];
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
  cache?: {
    key: string;
    status: SituationCacheStatus;
    ttlMs: number;
    upstreamBbox: SituationBbox;
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
  validUntil?: string;
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
  cacheStats?(): SituationDataCacheStats;
  fetchFeatures(query: SituationFeatureQuery, requestNow: Date): Promise<SituationFeatureCollection>;
  fetchLayers(requestNow: Date): Promise<SituationLayerDescriptor[]>;
  fetchSources(requestNow: Date): Promise<SituationSourceDescriptor[]>;
}

const defaultConfig: SituationDataSourceConfig = {
  baseUrl: "https://sim.zeleznalady.cz/situation-data/api/v1",
  cacheMaxEntries: 5000,
  cacheTtlMs: 20000,
  enabled: false,
  layerCacheTtlMs: {
    air_quality: 5 * 60 * 1000,
    flood: 5 * 60 * 1000,
    ground: 6 * 60 * 60 * 1000,
    mobile: 15 * 60 * 1000,
    traffic: 20 * 1000,
    warnings: 5 * 60 * 1000,
    weather: 5 * 60 * 1000
  },
  maxLimit: 250,
  sourceCacheTtlMs: {
    ardos_partner: 10 * 1000,
    aviation_weather: 120 * 1000
  },
  staleIfErrorMs: 10 * 60 * 1000,
  timeoutMs: 7000
};

const allowedLayerIds: SituationLayerId[] = ["weather", "ground", "mobile", "traffic", "warnings", "flood", "air_quality"];

export function createSituationDataSourceConfigFromEnv(env: Record<string, string | undefined> = process.env): SituationDataSourceConfig {
  const cacheTtlMs = readInteger(env.COP_SITUATION_DATA_CACHE_TTL_MS, defaultConfig.cacheTtlMs, 1000, 300000);
  return {
    baseUrl: trimTrailingSlash(env.COP_SITUATION_DATA_BASE_URL ?? defaultConfig.baseUrl),
    cacheMaxEntries: readInteger(env.COP_SITUATION_DATA_CACHE_MAX_ENTRIES, defaultConfig.cacheMaxEntries ?? 5000, 1, 100000),
    cacheTtlMs,
    enabled: readBoolean(env.COP_SITUATION_DATA_ENABLED, defaultConfig.enabled),
    layerCacheTtlMs: {
      air_quality: readInteger(env.COP_SITUATION_DATA_AIR_QUALITY_CACHE_TTL_MS, 5 * 60 * 1000, 1000, 24 * 60 * 60 * 1000),
      flood: readInteger(env.COP_SITUATION_DATA_FLOOD_CACHE_TTL_MS, 5 * 60 * 1000, 1000, 24 * 60 * 60 * 1000),
      ground: readInteger(env.COP_SITUATION_DATA_GROUND_CACHE_TTL_MS, 6 * 60 * 60 * 1000, 1000, 24 * 60 * 60 * 1000),
      mobile: readInteger(env.COP_SITUATION_DATA_MOBILE_CACHE_TTL_MS, 15 * 60 * 1000, 1000, 24 * 60 * 60 * 1000),
      traffic: readInteger(env.COP_SITUATION_DATA_TRAFFIC_CACHE_TTL_MS, cacheTtlMs, 1000, 5 * 60 * 1000),
      warnings: readInteger(env.COP_SITUATION_DATA_WARNINGS_CACHE_TTL_MS, 5 * 60 * 1000, 1000, 24 * 60 * 60 * 1000),
      weather: readInteger(env.COP_SITUATION_DATA_WEATHER_CACHE_TTL_MS, 5 * 60 * 1000, 1000, 24 * 60 * 60 * 1000)
    },
    maxLimit: readInteger(env.COP_SITUATION_DATA_MAX_LIMIT, defaultConfig.maxLimit, 1, 1000),
    sourceCacheTtlMs: {
      ardos_partner: readInteger(env.COP_SITUATION_DATA_ARDOS_CACHE_TTL_MS, 10 * 1000, 1000, 5 * 60 * 1000),
      aviation_weather: readInteger(env.COP_SITUATION_DATA_AVIATION_WEATHER_CACHE_TTL_MS, 120 * 1000, 1000, 24 * 60 * 60 * 1000)
    },
    staleIfErrorMs: readInteger(env.COP_SITUATION_DATA_STALE_IF_ERROR_MS, defaultConfig.staleIfErrorMs ?? 600000, 0, 24 * 60 * 60 * 1000),
    timeoutMs: readInteger(env.COP_SITUATION_DATA_TIMEOUT_MS, defaultConfig.timeoutMs, 1000, 60000)
  };
}

export function createSituationDataSourceFromEnv(env: Record<string, string | undefined> = process.env): SituationDataSource | undefined {
  const config = createSituationDataSourceConfigFromEnv(env);
  return config.enabled ? new SituationDataSourceAdapter(config) : undefined;
}

export class SituationDataSourceAdapter implements SituationDataSource {
  readonly sourceSystem: SourceSystem;
  private readonly featureCache: ManagedSituationCache<SituationFeatureCollection>;
  private layerCache: { expiresAtMs: number; value: SituationLayerDescriptor[] } | null = null;
  private sourceCache: { expiresAtMs: number; value: SituationSourceDescriptor[] } | null = null;

  constructor(readonly config: SituationDataSourceConfig) {
    this.sourceSystem = createPublicSituationAggregateSourceSystem();
    this.featureCache = new ManagedSituationCache<SituationFeatureCollection>({
      maxEntries: cacheMaxEntries(config),
      staleIfErrorMs: staleIfErrorMs(config)
    });
  }

  cacheStats(): SituationDataCacheStats {
    return this.featureCache.stats();
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

  async fetchSources(requestNow: Date): Promise<SituationSourceDescriptor[]> {
    if (this.sourceCache && this.sourceCache.expiresAtMs > requestNow.getTime()) {
      return this.sourceCache.value;
    }
    const sources = await fetchSituationSources(this.config, requestNow);
    this.sourceCache = {
      expiresAtMs: requestNow.getTime() + this.config.cacheTtlMs,
      value: sources
    };
    return sources;
  }

  async fetchFeatures(query: SituationFeatureQuery, requestNow: Date): Promise<SituationFeatureCollection> {
    const normalizedQuery = normalizeSituationFeatureQuery(query, this.config);
    const upstreamQuery = canonicalizeSituationFeatureQuery(normalizedQuery);
    const cacheKey = situationFeatureCacheKey(upstreamQuery);
    const ttlMs = Math.min(
      cacheTtlMsForLayers(normalizedQuery.layers, this.config),
      cacheTtlMsForSources(normalizedQuery.sources, this.config) ?? Number.POSITIVE_INFINITY
    );
    const cached = await this.featureCache.getOrLoad(cacheKey, ttlMs, () => fetchSituationFeatures(this.config, upstreamQuery, requestNow));
    return projectSituationFeatureCollection(cached.value, normalizedQuery, {
      cacheKey,
      cacheStatus: cached.status,
      ttlMs,
      upstreamBbox: upstreamQuery.bbox
    });
  }
}

interface ManagedSituationCacheOptions {
  maxEntries: number;
  staleIfErrorMs: number;
}

interface SituationCacheEntry<T> {
  expiresAtMs: number;
  lastAccessedAtMs: number;
  staleUntilMs: number;
  value: T;
}

interface SituationCacheLoadResult<T> {
  status: SituationCacheStatus;
  value: T;
}

class ManagedSituationCache<T> {
  private readonly entries = new Map<string, SituationCacheEntry<T>>();
  private readonly inflight = new Map<string, Promise<T>>();
  private readonly counters = {
    coalescedHits: 0,
    errors: 0,
    evictions: 0,
    hits: 0,
    misses: 0,
    refreshes: 0,
    staleHits: 0
  };

  constructor(private readonly options: ManagedSituationCacheOptions) {}

  async getOrLoad(key: string, ttlMs: number, loader: () => Promise<T>): Promise<SituationCacheLoadResult<T>> {
    const now = Date.now();
    const entry = this.entries.get(key);
    if (entry && entry.expiresAtMs > now) {
      this.counters.hits += 1;
      entry.lastAccessedAtMs = now;
      return { status: "hit", value: entry.value };
    }

    const existingInflight = this.inflight.get(key);
    if (existingInflight) {
      this.counters.coalescedHits += 1;
      return { status: "coalesced", value: await existingInflight };
    }

    this.counters.misses += 1;
    const refresh = loader()
      .then((value) => {
        this.counters.refreshes += 1;
        this.store(key, value, ttlMs);
        return value;
      })
      .catch((error) => {
        this.counters.errors += 1;
        const staleEntry = this.entries.get(key);
        if (staleEntry && staleEntry.staleUntilMs > Date.now()) {
          this.counters.staleHits += 1;
          staleEntry.lastAccessedAtMs = Date.now();
          return staleEntry.value;
        }
        throw error;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, refresh);
    const value = await refresh;
    const refreshedEntry = this.entries.get(key);
    return { status: refreshedEntry && refreshedEntry.expiresAtMs > Date.now() ? "miss" : "stale", value };
  }

  stats(): SituationDataCacheStats {
    return {
      entries: this.entries.size,
      inflight: this.inflight.size,
      ...this.counters
    };
  }

  private store(key: string, value: T, ttlMs: number): void {
    const now = Date.now();
    this.entries.set(key, {
      expiresAtMs: now + Math.max(0, ttlMs),
      lastAccessedAtMs: now,
      staleUntilMs: now + Math.max(0, ttlMs) + Math.max(0, this.options.staleIfErrorMs),
      value
    });
    this.evictIfNeeded();
  }

  private evictIfNeeded(): void {
    const maxEntries = Math.max(1, this.options.maxEntries);
    while (this.entries.size > maxEntries) {
      const oldest = Array.from(this.entries.entries()).sort((a, b) => a[1].lastAccessedAtMs - b[1].lastAccessedAtMs)[0];
      if (!oldest) {
        return;
      }
      this.entries.delete(oldest[0]);
      this.counters.evictions += 1;
    }
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
    limit: optionalNumber(rawQuery.limit) ?? config.maxLimit,
    sources: parseSituationSources(rawQuery)
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
    limit: Math.round(clampNumber(query.limit, 1, config.maxLimit)),
    ...(query.sources && query.sources.length > 0 ? { sources: uniqueStrings(query.sources) } : {})
  };
}

interface ProjectSituationFeatureCollectionOptions {
  cacheKey: string;
  cacheStatus: SituationCacheStatus;
  ttlMs: number;
  upstreamBbox: SituationBbox;
}

function canonicalizeSituationFeatureQuery(query: SituationFeatureQuery): SituationFeatureQuery {
  const gridSizeDegrees = gridSizeDegreesForBbox(query.bbox);
  const paddedBbox = padBbox(query.bbox, 0.18);
  return {
    bbox: snapBboxToGrid(paddedBbox, gridSizeDegrees),
    layers: query.layers,
    limit: query.limit,
    ...(query.sources && query.sources.length > 0 ? { sources: query.sources } : {})
  };
}

function projectSituationFeatureCollection(
  collection: SituationFeatureCollection,
  requestQuery: SituationFeatureQuery,
  options: ProjectSituationFeatureCollectionOptions
): SituationFeatureCollection {
  const features = collection.features.filter((feature) =>
    requestQuery.layers.includes(feature.properties.layer)
    && (!requestQuery.sources || requestQuery.sources.includes(feature.properties.sourceId))
    && isFeatureInBbox(feature, requestQuery.bbox)
  );
  const sources = collection.sources.filter((source) => !requestQuery.sources || requestQuery.sources.includes(source.sourceId));
  const warnings = options.cacheStatus === "stale"
    ? [...collection.warnings, "COP served stale situation-data cache because SIM refresh failed."]
    : collection.warnings;
  return {
    ...collection,
    cache: {
      key: options.cacheKey,
      status: options.cacheStatus,
      ttlMs: options.ttlMs,
      upstreamBbox: options.upstreamBbox
    },
    features,
    generatedAt: collection.generatedAt,
    query: {
      bbox: requestQuery.bbox,
      layers: requestQuery.layers,
      limit: requestQuery.limit,
      sources: requestQuery.sources ?? collection.query.sources
    },
    sources,
    summary: {
      featureCount: features.length,
      sourceCount: requestQuery.sources ? sources.length : collection.summary.sourceCount,
      staleFeatureCount: features.filter((feature) => feature.properties.stale).length,
      warningCount: warnings.length
    },
    warnings
  };
}

async function fetchSituationLayers(config: SituationDataSourceConfig, requestNow: Date): Promise<SituationLayerDescriptor[]> {
  const response = await fetchJson(new URL(`${trimTrailingSlash(config.baseUrl)}/layers`), config, requestNow);
  if (!isRecord(response) || !Array.isArray(response.items)) {
    throw new Error("Situation layers response is incomplete.");
  }
  return response.items.flatMap(normalizeSituationLayer);
}

async function fetchSituationSources(config: SituationDataSourceConfig, requestNow: Date): Promise<SituationSourceDescriptor[]> {
  const response = await fetchJson(new URL(`${trimTrailingSlash(config.baseUrl)}/sources`), config, requestNow);
  if (!isRecord(response) || !Array.isArray(response.items)) {
    throw new Error("Situation sources response is incomplete.");
  }
  return response.items.flatMap(normalizeSituationSourceDescriptor);
}

async function fetchSituationFeatures(config: SituationDataSourceConfig, query: SituationFeatureQuery, requestNow: Date): Promise<SituationFeatureCollection> {
  const url = new URL(`${trimTrailingSlash(config.baseUrl)}/cop/features`);
  url.searchParams.set("bbox", `${query.bbox.west},${query.bbox.south},${query.bbox.east},${query.bbox.north}`);
  url.searchParams.set("layers", query.layers.join(","));
  url.searchParams.set("limit", String(query.limit));
  if (query.sources && query.sources.length > 0) {
    url.searchParams.set("source", query.sources.join(","));
  }
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
    tags: isRecord(value.tags) ? value.tags : undefined,
    validUntil: optionalString(value.validUntil)
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
    sources: Array.isArray(value.sources) ? value.sources.filter((source): source is string => typeof source === "string") : fallback.sources
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

function parseSituationSources(rawQuery: Record<string, unknown>): string[] | undefined {
  const raw = typeof rawQuery.source === "string"
    ? rawQuery.source
    : typeof rawQuery.sources === "string"
      ? rawQuery.sources
      : undefined;
  const sources = raw?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  return sources.length > 0 ? uniqueStrings(sources) : undefined;
}

function situationFeatureCacheKey(query: SituationFeatureQuery): string {
  return [
    query.bbox.west.toFixed(4),
    query.bbox.south.toFixed(4),
    query.bbox.east.toFixed(4),
    query.bbox.north.toFixed(4),
    query.layers.join(","),
    query.limit,
    query.sources?.join(",") ?? "*"
  ].join("|");
}

function cacheTtlMsForLayers(layers: SituationLayerId[], config: SituationDataSourceConfig): number {
  return Math.min(...layers.map((layer) => layerCacheTtlMs(layer, config)));
}

function cacheTtlMsForSources(sources: string[] | undefined, config: SituationDataSourceConfig): number | undefined {
  if (!sources || sources.length === 0) {
    return undefined;
  }
  const ttlValues = sources
    .map((source) => config.sourceCacheTtlMs?.[source] ?? defaultConfig.sourceCacheTtlMs?.[source])
    .filter((ttl): ttl is number => typeof ttl === "number" && Number.isFinite(ttl));
  return ttlValues.length > 0 ? Math.min(...ttlValues.map((ttl) => Math.max(1000, Math.trunc(ttl)))) : undefined;
}

function layerCacheTtlMs(layer: SituationLayerId, config: SituationDataSourceConfig): number {
  const configured = config.layerCacheTtlMs?.[layer];
  if (configured !== undefined && Number.isFinite(configured)) {
    return Math.max(1000, Math.trunc(configured));
  }
  return Math.max(1000, defaultConfig.layerCacheTtlMs?.[layer] ?? config.cacheTtlMs);
}

function cacheMaxEntries(config: SituationDataSourceConfig): number {
  return Math.max(1, Math.trunc(config.cacheMaxEntries ?? defaultConfig.cacheMaxEntries ?? 5000));
}

function staleIfErrorMs(config: SituationDataSourceConfig): number {
  return Math.max(0, Math.trunc(config.staleIfErrorMs ?? defaultConfig.staleIfErrorMs ?? 600000));
}

function gridSizeDegreesForBbox(bbox: SituationBbox): number {
  const width = Math.abs(bbox.east - bbox.west);
  const height = Math.abs(bbox.north - bbox.south);
  const maxDimension = Math.max(width, height);
  if (maxDimension >= 4) {
    return 0.5;
  }
  if (maxDimension >= 1.5) {
    return 0.25;
  }
  if (maxDimension >= 0.6) {
    return 0.1;
  }
  if (maxDimension >= 0.2) {
    return 0.05;
  }
  if (maxDimension >= 0.08) {
    return 0.02;
  }
  return 0.01;
}

function padBbox(bbox: SituationBbox, ratio: number): SituationBbox {
  const width = Math.max(0.001, Math.abs(bbox.east - bbox.west));
  const height = Math.max(0.001, Math.abs(bbox.north - bbox.south));
  return {
    east: clampNumber(bbox.east + width * ratio, -180, 180),
    north: clampNumber(bbox.north + height * ratio, -90, 90),
    south: clampNumber(bbox.south - height * ratio, -90, 90),
    west: clampNumber(bbox.west - width * ratio, -180, 180)
  };
}

function snapBboxToGrid(bbox: SituationBbox, gridSizeDegrees: number): SituationBbox {
  return {
    east: clampNumber(round(Math.ceil(bbox.east / gridSizeDegrees) * gridSizeDegrees, 4), -180, 180),
    north: clampNumber(round(Math.ceil(bbox.north / gridSizeDegrees) * gridSizeDegrees, 4), -90, 90),
    south: clampNumber(round(Math.floor(bbox.south / gridSizeDegrees) * gridSizeDegrees, 4), -90, 90),
    west: clampNumber(round(Math.floor(bbox.west / gridSizeDegrees) * gridSizeDegrees, 4), -180, 180)
  };
}

function isFeatureInBbox(feature: SituationFeature, bbox: SituationBbox): boolean {
  const featureBbox = geometryBbox(feature.geometry);
  return featureBbox ? bboxIntersects(featureBbox, bbox) : false;
}

function geometryBbox(geometry: SituationGeometry): SituationBbox | null {
  const coordinates = geometryCoordinates(geometry);
  if (coordinates.length === 0) {
    return null;
  }
  const lons = coordinates.map((coordinate) => coordinate[0]);
  const lats = coordinates.map((coordinate) => coordinate[1]);
  return {
    east: Math.max(...lons),
    north: Math.max(...lats),
    south: Math.min(...lats),
    west: Math.min(...lons)
  };
}

function geometryCoordinates(geometry: SituationGeometry): Array<[number, number]> {
  if (geometry.type === "Point") {
    return [geometry.coordinates];
  }
  if (geometry.type === "LineString") {
    return geometry.coordinates;
  }
  return geometry.coordinates.flatMap((ring) => ring);
}

function bboxIntersects(a: SituationBbox, b: SituationBbox): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

function uniqueLayers(layers: SituationLayerId[]): SituationLayerId[] {
  return allowedLayerIds.filter((layer) => layers.includes(layer));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
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

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
