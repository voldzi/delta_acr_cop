import { createPublicSafetyAggregateSourceSystem, type SourceSystem } from "@cop/canonical-model";
import { normalizeProviderMapCatalog, type ProviderMapCatalog } from "./provider-map-catalog.js";
import type { SourceHealthOverride } from "./types.js";

export type SafetyLayerId = "boundary_admin" | "fire" | "flood" | "warnings" | "weather_alerts";
export type SafetyDataSourceId = "admin_boundaries" | "chmi_alerts" | "chmi_hydro" | "fire_hotspots" | "fire_incidents" | "mock" | "nasa_firms" | "weather_alerts";
export type SafetySeverity = "advisory" | "critical" | "info" | "warning";
type SafetyCacheStatus = "coalesced" | "hit" | "miss" | "stale";

export interface SafetyDataCacheStats {
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

export interface SafetyDataSourceConfig {
  baseUrl: string;
  cacheMaxEntries?: number;
  cacheTtlMs: number;
  enabled: boolean;
  layerCacheTtlMs?: Partial<Record<SafetyLayerId, number>>;
  maxLimit: number;
  staleIfErrorMs?: number;
  timeoutMs: number;
}

export interface SafetyFeatureQuery {
  bbox: SafetyBbox;
  layers: SafetyLayerId[];
  limit: number;
}

export interface SafetyBbox {
  east: number;
  north: number;
  south: number;
  west: number;
}

export interface SafetyLayerDescriptor {
  defaultVisible: boolean;
  description?: string;
  expectedCadenceSeconds?: number;
  geometryTypes?: string[];
  label: string;
  layerId: SafetyLayerId;
}

export interface SafetyDataPublicConfig {
  cacheMaxEntries?: number;
  cacheTtlSeconds?: number;
  defaultBbox?: SafetyBbox;
  enabledSources?: SafetyDataSourceId[];
  hydroMaxStations?: number;
  providers?: Array<{ authConfigured?: boolean; baseUrl?: string; sourceId: SafetyDataSourceId }>;
  requestTimeoutMs?: number;
  staleAfterSeconds?: number;
  staleIfErrorSeconds?: number;
}

export interface SafetySourceDescriptor {
  baseUrl?: string;
  enabled?: boolean;
  label?: string;
  layers?: SafetyLayerId[];
  license?: Record<string, unknown>;
  mode?: string;
  priority?: number;
  sourceId: SafetyDataSourceId;
  updateCadenceSeconds?: number;
}

export type SafetyGeometry =
  | { coordinates: [number, number]; type: "Point" }
  | { coordinates: Array<Array<[number, number]>>; type: "Polygon" };

export interface SafetyFeatureProperties {
  adminLevel?: number;
  affectedAreas?: string[];
  areaName?: string;
  basis?: string[];
  category: string;
  certainty?: string;
  confidence?: number;
  description?: string;
  effectiveAt?: string;
  expiresAt?: string;
  featureId: string;
  geocodes?: Array<{ scheme: string; value: string }>;
  hazardType?: string;
  headline: string;
  iconHint?: string;
  layer: SafetyLayerId;
  layerId?: string;
  license?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  observedAt?: string;
  providerId?: string;
  providerLayerId?: string;
  providerProperties?: Record<string, unknown>;
  recommendedAction?: string;
  severity?: SafetySeverity | string;
  source?: string;
  sourceId: string;
  sourceName?: string;
  stale?: boolean;
  status?: string;
  styleHint?: string;
  tags?: Record<string, unknown>;
  updatedAt?: string;
  urgency?: string;
  validFrom?: string;
  validUntil?: string;
}

export interface SafetyFeature {
  geometry: SafetyGeometry;
  id?: string | number;
  properties: SafetyFeatureProperties;
  type: "Feature";
}

export interface SafetyFeatureCollection {
  contractVersion: "cop-safety-source-v1";
  cache?: {
    key: string;
    status: SafetyCacheStatus;
    ttlMs: number;
    upstreamBbox: SafetyBbox;
  };
  features: SafetyFeature[];
  generatedAt: string;
  query: {
    bbox: SafetyBbox;
    layers: SafetyLayerId[];
    limit: number;
    sources?: SafetyDataSourceId[];
  };
  source: {
    generatedAt?: string;
    sourceId: "safety-data-api";
    sourceType: "PUBLIC_SAFETY_AGGREGATE";
  };
  sources: SafetySourceDescriptor[];
  summary: {
    advisoryCount: number;
    criticalCount: number;
    featureCount: number;
    sourceCount: number;
    staleFeatureCount: number;
    warningCount: number;
  };
  type: "FeatureCollection";
  warnings: string[];
}

export interface SafetyDataSource {
  readonly config: SafetyDataSourceConfig;
  readonly sourceSystem: SourceSystem;
  cacheStats?(): SafetyDataCacheStats;
  fetchCatalog?(requestNow: Date): Promise<ProviderMapCatalog>;
  fetchConfig(requestNow: Date): Promise<SafetyDataPublicConfig>;
  fetchFeatures(query: SafetyFeatureQuery, requestNow: Date): Promise<SafetyFeatureCollection>;
  fetchLayers(requestNow: Date): Promise<SafetyLayerDescriptor[]>;
  fetchSources(requestNow: Date): Promise<SafetySourceDescriptor[]>;
}

const defaultConfig: SafetyDataSourceConfig = {
  baseUrl: "https://sim.zeleznalady.cz/safety-data/api/v1",
  cacheMaxEntries: 5000,
  cacheTtlMs: 120000,
  enabled: false,
  layerCacheTtlMs: {
    boundary_admin: 24 * 60 * 60 * 1000,
    fire: 10 * 60 * 1000,
    flood: 5 * 60 * 1000,
    warnings: 2 * 60 * 1000,
    weather_alerts: 5 * 60 * 1000
  },
  maxLimit: 250,
  staleIfErrorMs: 20 * 60 * 1000,
  timeoutMs: 15000
};

const allowedLayerIds: SafetyLayerId[] = ["warnings", "weather_alerts", "flood", "fire", "boundary_admin"];

export function createSafetyDataSourceConfigFromEnv(env: Record<string, string | undefined> = process.env): SafetyDataSourceConfig {
  const cacheTtlMs = readInteger(env.COP_SAFETY_DATA_CACHE_TTL_MS, defaultConfig.cacheTtlMs, 1000, 10 * 60 * 1000);
  return {
    baseUrl: trimTrailingSlash(env.COP_SAFETY_DATA_BASE_URL ?? defaultConfig.baseUrl),
    cacheMaxEntries: readInteger(env.COP_SAFETY_DATA_CACHE_MAX_ENTRIES, defaultConfig.cacheMaxEntries ?? 5000, 1, 100000),
    cacheTtlMs,
    enabled: readBoolean(env.COP_SAFETY_DATA_ENABLED, defaultConfig.enabled),
    layerCacheTtlMs: {
      boundary_admin: readInteger(env.COP_SAFETY_DATA_BOUNDARY_ADMIN_CACHE_TTL_MS, 24 * 60 * 60 * 1000, 1000, 24 * 60 * 60 * 1000),
      fire: readInteger(env.COP_SAFETY_DATA_FIRE_CACHE_TTL_MS, 10 * 60 * 1000, 1000, 24 * 60 * 60 * 1000),
      flood: readInteger(env.COP_SAFETY_DATA_FLOOD_CACHE_TTL_MS, 5 * 60 * 1000, 1000, 24 * 60 * 60 * 1000),
      warnings: readInteger(env.COP_SAFETY_DATA_WARNINGS_CACHE_TTL_MS, cacheTtlMs, 1000, 24 * 60 * 60 * 1000),
      weather_alerts: readInteger(env.COP_SAFETY_DATA_WEATHER_ALERTS_CACHE_TTL_MS, 5 * 60 * 1000, 1000, 24 * 60 * 60 * 1000)
    },
    maxLimit: readInteger(env.COP_SAFETY_DATA_MAX_LIMIT, defaultConfig.maxLimit, 1, 1000),
    staleIfErrorMs: readInteger(env.COP_SAFETY_DATA_STALE_IF_ERROR_MS, defaultConfig.staleIfErrorMs ?? 1200000, 0, 24 * 60 * 60 * 1000),
    timeoutMs: readInteger(env.COP_SAFETY_DATA_TIMEOUT_MS, defaultConfig.timeoutMs, 1000, 60000)
  };
}

export function createSafetyDataSourceFromEnv(env: Record<string, string | undefined> = process.env): SafetyDataSource | undefined {
  const config = createSafetyDataSourceConfigFromEnv(env);
  return config.enabled ? new SafetyDataSourceAdapter(config) : undefined;
}

export class SafetyDataSourceAdapter implements SafetyDataSource {
  readonly sourceSystem: SourceSystem;
  private readonly featureCache: ManagedSafetyCache<SafetyFeatureCollection>;
  private catalogCache: { expiresAtMs: number; value: ProviderMapCatalog } | null = null;
  private catalogInflight: Promise<ProviderMapCatalog> | null = null;
  private configCache: { expiresAtMs: number; value: SafetyDataPublicConfig } | null = null;
  private layerCache: { expiresAtMs: number; value: SafetyLayerDescriptor[] } | null = null;
  private sourceCache: { expiresAtMs: number; value: SafetySourceDescriptor[] } | null = null;

  constructor(readonly config: SafetyDataSourceConfig) {
    this.sourceSystem = createPublicSafetyAggregateSourceSystem();
    this.featureCache = new ManagedSafetyCache<SafetyFeatureCollection>({
      maxEntries: cacheMaxEntries(config),
      staleIfErrorMs: staleIfErrorMs(config)
    });
  }

  cacheStats(): SafetyDataCacheStats {
    return this.featureCache.stats();
  }

  async fetchCatalog(requestNow: Date): Promise<ProviderMapCatalog> {
    if (this.catalogCache && this.catalogCache.expiresAtMs > requestNow.getTime()) {
      return this.catalogCache.value;
    }
    if (this.catalogInflight) {
      return this.catalogInflight;
    }
    this.catalogInflight = fetchSafetyCatalog(this.config, requestNow);
    try {
      const value = await this.catalogInflight;
      this.catalogCache = {
        expiresAtMs: requestNow.getTime() + this.config.cacheTtlMs,
        value
      };
      return value;
    } finally {
      this.catalogInflight = null;
    }
  }

  async fetchConfig(requestNow: Date): Promise<SafetyDataPublicConfig> {
    if (this.configCache && this.configCache.expiresAtMs > requestNow.getTime()) {
      return this.configCache.value;
    }
    const value = normalizeSafetyConfig(await fetchJson(new URL(`${trimTrailingSlash(this.config.baseUrl)}/config`), this.config, requestNow));
    this.configCache = {
      expiresAtMs: requestNow.getTime() + this.config.cacheTtlMs,
      value
    };
    return value;
  }

  async fetchLayers(requestNow: Date): Promise<SafetyLayerDescriptor[]> {
    if (this.layerCache && this.layerCache.expiresAtMs > requestNow.getTime()) {
      return this.layerCache.value;
    }
    const value = safetyLayersFromProviderCatalog(await this.fetchCatalog(requestNow));
    this.layerCache = {
      expiresAtMs: requestNow.getTime() + this.config.cacheTtlMs,
      value
    };
    return value;
  }

  async fetchSources(requestNow: Date): Promise<SafetySourceDescriptor[]> {
    if (this.sourceCache && this.sourceCache.expiresAtMs > requestNow.getTime()) {
      return this.sourceCache.value;
    }
    const value = safetySourcesFromProviderCatalog(await this.fetchCatalog(requestNow));
    this.sourceCache = {
      expiresAtMs: requestNow.getTime() + this.config.cacheTtlMs,
      value
    };
    return value;
  }

  async fetchFeatures(query: SafetyFeatureQuery, requestNow: Date): Promise<SafetyFeatureCollection> {
    const normalizedQuery = normalizeSafetyFeatureQuery(query, this.config);
    const upstreamQuery = canonicalizeSafetyFeatureQuery(normalizedQuery);
    const cacheKey = safetyFeatureCacheKey(upstreamQuery);
    const ttlMs = cacheTtlMsForLayers(normalizedQuery.layers, this.config);
    const cached = await this.featureCache.getOrLoad(cacheKey, ttlMs, () => fetchSafetyFeatures(this.config, upstreamQuery, requestNow));
    return projectSafetyFeatureCollection(cached.value, normalizedQuery, {
      cacheKey,
      cacheStatus: cached.status,
      ttlMs,
      upstreamBbox: upstreamQuery.bbox
    });
  }
}

interface ManagedSafetyCacheOptions {
  maxEntries: number;
  staleIfErrorMs: number;
}

interface SafetyCacheEntry<T> {
  expiresAtMs: number;
  lastAccessedAtMs: number;
  staleUntilMs: number;
  value: T;
}

interface SafetyCacheLoadResult<T> {
  status: SafetyCacheStatus;
  value: T;
}

class ManagedSafetyCache<T> {
  private readonly entries = new Map<string, SafetyCacheEntry<T>>();
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

  constructor(private readonly options: ManagedSafetyCacheOptions) {}

  async getOrLoad(key: string, ttlMs: number, loader: () => Promise<T>): Promise<SafetyCacheLoadResult<T>> {
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

  stats(): SafetyDataCacheStats {
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

export function buildSafetyDataHealth(response: SafetyFeatureCollection | SafetyLayerDescriptor[] | SafetySourceDescriptor[], requestNow: Date): SourceHealthOverride {
  if (Array.isArray(response)) {
    return {
      detail: `metadata ${response.length}`,
      evaluatedAt: requestNow.toISOString(),
      health: response.length > 0 ? "ONLINE" : "WAITING",
      lastPollAt: requestNow.toISOString(),
      lastSuccessAt: requestNow.toISOString(),
      summary: {
        itemCount: response.length
      }
    };
  }

  const warningCount = response.warnings.length;
  const health: SourceHealthOverride["health"] = warningCount > 0
    ? "DEGRADED"
    : response.summary.staleFeatureCount > 0
      ? "STALE"
      : "ONLINE";
  return {
    detail: `features ${response.summary.featureCount}, critical ${response.summary.criticalCount}, warnings ${response.summary.warningCount}, advisory ${response.summary.advisoryCount}, stale ${response.summary.staleFeatureCount}`,
    evaluatedAt: requestNow.toISOString(),
    generatedAt: response.generatedAt,
    health,
    lastPollAt: requestNow.toISOString(),
    lastSuccessAt: requestNow.toISOString(),
    summary: {
      advisoryCount: response.summary.advisoryCount,
      criticalCount: response.summary.criticalCount,
      featureCount: response.summary.featureCount,
      sourceCount: response.summary.sourceCount,
      staleFeatureCount: response.summary.staleFeatureCount,
      warningCount: response.summary.warningCount
    },
    warnings: response.warnings
  };
}

export function unavailableSafetyDataHealth(error: unknown, requestNow: Date): SourceHealthOverride {
  return {
    detail: "Safety data source is unavailable.",
    evaluatedAt: requestNow.toISOString(),
    health: "UNAVAILABLE",
    lastError: error instanceof Error ? error.message : "unknown error",
    lastPollAt: requestNow.toISOString(),
    warnings: ["Safety data request failed."]
  };
}

export function emptySafetyFeatureCollection(query: SafetyFeatureQuery, requestNow: Date, warnings: string[] = []): SafetyFeatureCollection {
  return {
    contractVersion: "cop-safety-source-v1",
    features: [],
    generatedAt: requestNow.toISOString(),
    query,
    source: {
      generatedAt: requestNow.toISOString(),
      sourceId: "safety-data-api",
      sourceType: "PUBLIC_SAFETY_AGGREGATE"
    },
    sources: [],
    summary: {
      advisoryCount: 0,
      criticalCount: 0,
      featureCount: 0,
      sourceCount: 0,
      staleFeatureCount: 0,
      warningCount: 0
    },
    type: "FeatureCollection",
    warnings
  };
}

export function parseSafetyFeatureQuery(rawQuery: Record<string, unknown>, config: SafetyDataSourceConfig): SafetyFeatureQuery | null {
  const bbox = typeof rawQuery.bbox === "string" ? parseSafetyBbox(rawQuery.bbox) : null;
  if (!bbox) {
    return null;
  }
  return normalizeSafetyFeatureQuery({
    bbox,
    layers: parseSafetyLayers(typeof rawQuery.layers === "string" ? rawQuery.layers : undefined),
    limit: optionalNumber(rawQuery.limit) ?? config.maxLimit
  }, config);
}

export function normalizeSafetyFeatureQuery(query: SafetyFeatureQuery, config: SafetyDataSourceConfig): SafetyFeatureQuery {
  return {
    bbox: {
      east: clampNumber(query.bbox.east, -180, 180),
      north: clampNumber(query.bbox.north, -90, 90),
      south: clampNumber(query.bbox.south, -90, 90),
      west: clampNumber(query.bbox.west, -180, 180)
    },
    layers: query.layers.filter(isSafetyLayerId).length > 0 ? uniqueLayers(query.layers.filter(isSafetyLayerId)) : ["warnings", "flood"],
    limit: Math.round(clampNumber(query.limit, 1, config.maxLimit))
  };
}

interface ProjectSafetyFeatureCollectionOptions {
  cacheKey: string;
  cacheStatus: SafetyCacheStatus;
  ttlMs: number;
  upstreamBbox: SafetyBbox;
}

function canonicalizeSafetyFeatureQuery(query: SafetyFeatureQuery): SafetyFeatureQuery {
  const gridSizeDegrees = gridSizeDegreesForBbox(query.bbox);
  const paddedBbox = padBbox(query.bbox, 0.18);
  return {
    bbox: snapBboxToGrid(paddedBbox, gridSizeDegrees),
    layers: query.layers,
    limit: query.limit
  };
}

function projectSafetyFeatureCollection(
  collection: SafetyFeatureCollection,
  requestQuery: SafetyFeatureQuery,
  options: ProjectSafetyFeatureCollectionOptions
): SafetyFeatureCollection {
  const features = collection.features.filter((feature) =>
    requestQuery.layers.includes(feature.properties.layer)
    && (feature.properties.layer === "warnings" || isFeatureInBbox(feature, requestQuery.bbox))
  );
  const warnings = options.cacheStatus === "stale"
    ? [...collection.warnings, "COP served stale safety-data cache because SIM refresh failed."]
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
    query: {
      bbox: requestQuery.bbox,
      layers: requestQuery.layers,
      limit: requestQuery.limit,
      sources: collection.query.sources
    },
    summary: {
      advisoryCount: features.filter((feature) => feature.properties.severity === "advisory").length,
      criticalCount: features.filter((feature) => feature.properties.severity === "critical").length,
      featureCount: features.length,
      sourceCount: collection.summary.sourceCount,
      staleFeatureCount: features.filter((feature) => feature.properties.stale).length,
      warningCount: features.filter((feature) => feature.properties.severity === "warning").length
    },
    warnings
  };
}

async function fetchSafetyFeatures(config: SafetyDataSourceConfig, query: SafetyFeatureQuery, requestNow: Date): Promise<SafetyFeatureCollection> {
  const url = new URL(`${trimTrailingSlash(config.baseUrl)}/features`);
  url.searchParams.set("bbox", `${query.bbox.west},${query.bbox.south},${query.bbox.east},${query.bbox.north}`);
  url.searchParams.set("layers", query.layers.join(","));
  url.searchParams.set("limit", String(query.limit));
  return normalizeSafetyFeatureCollection(await fetchJson(url, config, requestNow), query);
}

async function fetchSafetyCatalog(config: SafetyDataSourceConfig, requestNow: Date): Promise<ProviderMapCatalog> {
  return normalizeProviderMapCatalog(await fetchJson(new URL(`${trimTrailingSlash(config.baseUrl)}/catalog`), config, requestNow), "sim.safety-data");
}

function safetyLayersFromProviderCatalog(catalog: ProviderMapCatalog): SafetyLayerDescriptor[] {
  const layers = new Map<SafetyLayerId, SafetyLayerDescriptor>();
  for (const catalogLayer of catalog.layers) {
    for (const providerLayerId of catalogLayer.query?.providerLayerIds ?? []) {
      if (!isSafetyLayerId(providerLayerId)) {
        continue;
      }
      const current = layers.get(providerLayerId);
      layers.set(providerLayerId, {
        defaultVisible: (current?.defaultVisible ?? false) || catalogLayer.defaultVisible === true,
        description: current?.description ?? catalogLayer.description,
        expectedCadenceSeconds: minOptionalNumber(current?.expectedCadenceSeconds, catalogLayer.refreshSeconds),
        geometryTypes: mergeStringLists(current?.geometryTypes, catalogLayer.geometryTypes),
        label: current?.label ?? catalogLayer.label,
        layerId: providerLayerId
      });
    }
  }
  return Array.from(layers.values());
}

function safetySourcesFromProviderCatalog(catalog: ProviderMapCatalog): SafetySourceDescriptor[] {
  return catalog.sources.flatMap((source): SafetySourceDescriptor[] => {
    if (!isSafetyDataSourceId(source.sourceId)) {
      return [];
    }
    return [
      {
        enabled: source.enabled,
        label: source.label,
        layers: source.layers?.filter(isSafetyLayerId) ?? catalog.layers
          .filter((layer) => layer.query?.providerSourceIds?.includes(source.sourceId))
          .flatMap((layer) => layer.query?.providerLayerIds ?? [])
          .filter(isSafetyLayerId),
        mode: source.sourceRole,
        sourceId: source.sourceId,
        updateCadenceSeconds: source.updateCadenceSeconds
      }
    ];
  });
}

async function fetchJson(url: URL, config: SafetyDataSourceConfig, requestNow: Date): Promise<unknown> {
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
      throw new Error(`${response.status} ${response.statusText || "Safety data request failed"}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSafetyFeatureCollection(value: unknown, fallbackQuery: SafetyFeatureQuery): SafetyFeatureCollection {
  if (!isRecord(value) || value.contractVersion !== "cop-safety-source-v1" || value.type !== "FeatureCollection") {
    throw new Error("Safety data response does not match cop-safety-source-v1.");
  }
  if (!isRecord(value.source) || value.source.sourceId !== "safety-data-api" || value.source.sourceType !== "PUBLIC_SAFETY_AGGREGATE") {
    throw new Error("Safety data source descriptor is not valid.");
  }
  return {
    contractVersion: "cop-safety-source-v1",
    features: Array.isArray(value.features) ? value.features.flatMap(normalizeSafetyFeature) : [],
    generatedAt: optionalString(value.generatedAt) ?? new Date().toISOString(),
    query: normalizeResponseQuery(value.query, fallbackQuery),
    source: {
      generatedAt: optionalString(value.source.generatedAt),
      sourceId: "safety-data-api",
      sourceType: "PUBLIC_SAFETY_AGGREGATE"
    },
    sources: Array.isArray(value.sources) ? value.sources.flatMap(normalizeSafetySourceDescriptor) : [],
    summary: normalizeSafetySummary(value.summary, Array.isArray(value.features) ? value.features.length : 0),
    type: "FeatureCollection",
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((warning): warning is string => typeof warning === "string") : []
  };
}

function normalizeSafetyFeature(value: unknown): SafetyFeature[] {
  if (!isRecord(value) || value.type !== "Feature" || !isRecord(value.properties)) {
    return [];
  }
  const geometry = normalizeGeometry(value.geometry);
  const properties = normalizeSafetyProperties(value.properties);
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

function normalizeSafetyProperties(value: Record<string, unknown>): SafetyFeatureProperties | null {
  if (!isSafetyLayerId(value.layer)) {
    return null;
  }
  const featureId = optionalString(value.featureId);
  const category = optionalString(value.category);
  const headline = optionalString(value.headline);
  const sourceId = optionalString(value.sourceId);
  if (!featureId || !category || !headline || !sourceId) {
    return null;
  }
  return {
    adminLevel: optionalFinite(value.adminLevel),
    affectedAreas: optionalStringArray(value.affectedAreas),
    areaName: optionalString(value.areaName),
    basis: optionalStringArray(value.basis),
    category,
    certainty: optionalString(value.certainty),
    confidence: optionalFinite(value.confidence),
    description: optionalString(value.description),
    effectiveAt: optionalString(value.effectiveAt),
    expiresAt: optionalString(value.expiresAt),
    featureId,
    geocodes: normalizeGeocodes(value.geocodes),
    hazardType: optionalString(value.hazardType),
    headline,
    iconHint: optionalString(value.iconHint),
    layer: value.layer,
    layerId: optionalString(value.layerId),
    license: isRecord(value.license) ? value.license : undefined,
    metrics: isRecord(value.metrics) ? value.metrics : undefined,
    observedAt: optionalString(value.observedAt),
    providerId: optionalString(value.providerId),
    providerLayerId: optionalString(value.providerLayerId),
    providerProperties: isRecord(value.providerProperties) ? value.providerProperties : undefined,
    recommendedAction: optionalString(value.recommendedAction),
    severity: optionalString(value.severity),
    source: optionalString(value.source),
    sourceId,
    sourceName: optionalString(value.sourceName),
    stale: typeof value.stale === "boolean" ? value.stale : undefined,
    status: optionalString(value.status),
    styleHint: optionalString(value.styleHint),
    tags: isRecord(value.tags) ? value.tags : undefined,
    updatedAt: optionalString(value.updatedAt),
    urgency: optionalString(value.urgency),
    validFrom: optionalString(value.validFrom),
    validUntil: optionalString(value.validUntil)
  };
}

function normalizeSafetyLayer(value: unknown): SafetyLayerDescriptor[] {
  if (!isRecord(value) || !isSafetyLayerId(value.layerId) || typeof value.label !== "string") {
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

function normalizeSafetySourceDescriptor(value: unknown): SafetySourceDescriptor[] {
  if (!isRecord(value) || !isSafetyDataSourceId(value.sourceId)) {
    return [];
  }
  return [
    {
      baseUrl: optionalString(value.baseUrl),
      enabled: typeof value.enabled === "boolean" ? value.enabled : undefined,
      label: optionalString(value.label),
      layers: Array.isArray(value.layers) ? value.layers.filter(isSafetyLayerId) : undefined,
      license: isRecord(value.license) ? value.license : undefined,
      mode: optionalString(value.mode),
      priority: optionalNumber(value.priority),
      sourceId: value.sourceId,
      updateCadenceSeconds: optionalNumber(value.updateCadenceSeconds)
    }
  ];
}

function normalizeSafetyConfig(value: unknown): SafetyDataPublicConfig {
  if (!isRecord(value)) {
    return {};
  }
  return {
    cacheMaxEntries: optionalNumber(value.cacheMaxEntries),
    cacheTtlSeconds: optionalNumber(value.cacheTtlSeconds),
    defaultBbox: isRecord(value.defaultBbox) ? normalizeBboxRecord(value.defaultBbox) : undefined,
    enabledSources: Array.isArray(value.enabledSources) ? value.enabledSources.filter(isSafetyDataSourceId) : undefined,
    hydroMaxStations: optionalNumber(value.hydroMaxStations),
    providers: Array.isArray(value.providers) ? value.providers.flatMap(normalizeSafetyProvider) : undefined,
    requestTimeoutMs: optionalNumber(value.requestTimeoutMs),
    staleAfterSeconds: optionalNumber(value.staleAfterSeconds),
    staleIfErrorSeconds: optionalNumber(value.staleIfErrorSeconds)
  };
}

function normalizeSafetyProvider(value: unknown): Array<{ authConfigured?: boolean; baseUrl?: string; sourceId: SafetyDataSourceId }> {
  if (!isRecord(value) || !isSafetyDataSourceId(value.sourceId)) {
    return [];
  }
  return [
    {
      authConfigured: typeof value.authConfigured === "boolean" ? value.authConfigured : undefined,
      baseUrl: optionalString(value.baseUrl),
      sourceId: value.sourceId
    }
  ];
}

function normalizeSafetySummary(value: unknown, fallbackFeatureCount: number): SafetyFeatureCollection["summary"] {
  const summary = isRecord(value) ? value : {};
  return {
    advisoryCount: optionalNumber(summary.advisoryCount) ?? 0,
    criticalCount: optionalNumber(summary.criticalCount) ?? 0,
    featureCount: optionalNumber(summary.featureCount) ?? fallbackFeatureCount,
    sourceCount: optionalNumber(summary.sourceCount) ?? 0,
    staleFeatureCount: optionalNumber(summary.staleFeatureCount) ?? 0,
    warningCount: optionalNumber(summary.warningCount) ?? 0
  };
}

function normalizeResponseQuery(value: unknown, fallback: SafetyFeatureQuery): SafetyFeatureCollection["query"] {
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
    layers: Array.isArray(value.layers) ? value.layers.filter(isSafetyLayerId) : fallback.layers,
    limit: optionalNumber(value.limit) ?? fallback.limit,
    sources: Array.isArray(value.sources) ? value.sources.filter(isSafetyDataSourceId) : undefined
  };
}

function normalizeGeometry(value: unknown): SafetyGeometry | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.type === "Point" && Array.isArray(value.coordinates)) {
    const point = tupleCoordinate(value.coordinates);
    return point ? { coordinates: point, type: "Point" } : null;
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

function parseSafetyBbox(value: string): SafetyBbox | null {
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

function parseSafetyLayers(value: string | undefined): SafetyLayerId[] {
  if (!value) {
    return ["warnings", "flood"];
  }
  const layers = value.split(",").map((item) => item.trim()).filter(isSafetyLayerId);
  return layers.length > 0 ? uniqueLayers(layers) : ["warnings", "flood"];
}

function safetyFeatureCacheKey(query: SafetyFeatureQuery): string {
  return [
    query.bbox.west.toFixed(4),
    query.bbox.south.toFixed(4),
    query.bbox.east.toFixed(4),
    query.bbox.north.toFixed(4),
    query.layers.join(","),
    query.limit
  ].join("|");
}

function cacheTtlMsForLayers(layers: SafetyLayerId[], config: SafetyDataSourceConfig): number {
  return Math.min(...layers.map((layer) => layerCacheTtlMs(layer, config)));
}

function layerCacheTtlMs(layer: SafetyLayerId, config: SafetyDataSourceConfig): number {
  const configured = config.layerCacheTtlMs?.[layer];
  if (configured !== undefined && Number.isFinite(configured)) {
    return Math.max(1000, Math.trunc(configured));
  }
  return Math.max(1000, defaultConfig.layerCacheTtlMs?.[layer] ?? config.cacheTtlMs);
}

function cacheMaxEntries(config: SafetyDataSourceConfig): number {
  return Math.max(1, Math.trunc(config.cacheMaxEntries ?? defaultConfig.cacheMaxEntries ?? 5000));
}

function staleIfErrorMs(config: SafetyDataSourceConfig): number {
  return Math.max(0, Math.trunc(config.staleIfErrorMs ?? defaultConfig.staleIfErrorMs ?? 1200000));
}

function gridSizeDegreesForBbox(bbox: SafetyBbox): number {
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

function padBbox(bbox: SafetyBbox, ratio: number): SafetyBbox {
  const width = Math.max(0.001, Math.abs(bbox.east - bbox.west));
  const height = Math.max(0.001, Math.abs(bbox.north - bbox.south));
  return {
    east: clampNumber(bbox.east + width * ratio, -180, 180),
    north: clampNumber(bbox.north + height * ratio, -90, 90),
    south: clampNumber(bbox.south - height * ratio, -90, 90),
    west: clampNumber(bbox.west - width * ratio, -180, 180)
  };
}

function snapBboxToGrid(bbox: SafetyBbox, gridSizeDegrees: number): SafetyBbox {
  return {
    east: clampNumber(round(Math.ceil(bbox.east / gridSizeDegrees) * gridSizeDegrees, 4), -180, 180),
    north: clampNumber(round(Math.ceil(bbox.north / gridSizeDegrees) * gridSizeDegrees, 4), -90, 90),
    south: clampNumber(round(Math.floor(bbox.south / gridSizeDegrees) * gridSizeDegrees, 4), -90, 90),
    west: clampNumber(round(Math.floor(bbox.west / gridSizeDegrees) * gridSizeDegrees, 4), -180, 180)
  };
}

function isFeatureInBbox(feature: SafetyFeature, bbox: SafetyBbox): boolean {
  const featureBbox = geometryBbox(feature.geometry);
  return featureBbox ? bboxIntersects(featureBbox, bbox) : false;
}

function geometryBbox(geometry: SafetyGeometry): SafetyBbox | null {
  const coordinates = geometry.type === "Point" ? [geometry.coordinates] : geometry.coordinates.flatMap((ring) => ring);
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

function bboxIntersects(a: SafetyBbox, b: SafetyBbox): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

function normalizeBboxRecord(value: Record<string, unknown>): SafetyBbox | undefined {
  const west = optionalNumber(value.west);
  const south = optionalNumber(value.south);
  const east = optionalNumber(value.east);
  const north = optionalNumber(value.north);
  return west !== undefined && south !== undefined && east !== undefined && north !== undefined ? { east, north, south, west } : undefined;
}

function normalizeGeocodes(value: unknown): Array<{ scheme: string; value: string }> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const geocodes = value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const scheme = optionalString(item.scheme);
    const code = optionalString(item.value);
    return scheme && code ? [{ scheme, value: code }] : [];
  });
  return geocodes.length > 0 ? geocodes : undefined;
}

function uniqueLayers(layers: SafetyLayerId[]): SafetyLayerId[] {
  return allowedLayerIds.filter((layer) => layers.includes(layer));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function mergeStringLists(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  const merged = uniqueStrings([...(a ?? []), ...(b ?? [])]);
  return merged.length > 0 ? merged : undefined;
}

function minOptionalNumber(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) {
    return b;
  }
  if (b === undefined) {
    return a;
  }
  return Math.min(a, b);
}

function isSafetyLayerId(value: unknown): value is SafetyLayerId {
  return typeof value === "string" && allowedLayerIds.includes(value as SafetyLayerId);
}

function isSafetyDataSourceId(value: unknown): value is SafetyDataSourceId {
  return value === "mock"
    || value === "admin_boundaries"
    || value === "chmi_alerts"
    || value === "chmi_hydro"
    || value === "fire_hotspots"
    || value === "fire_incidents"
    || value === "nasa_firms"
    || value === "weather_alerts";
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

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
  return items.length > 0 ? items : undefined;
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
