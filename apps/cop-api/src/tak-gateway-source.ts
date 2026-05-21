import { createTakGatewaySourceSystem, type SourceSystem } from "@cop/canonical-model";
import type { SourceHealthOverride } from "./types.js";

export type TakGatewayLayerId = "ground" | "mobile" | "traffic";
export type TakGatewayAffiliation = "friend" | "hostile" | "neutral" | "unknown";
type TakGatewayCacheStatus = "coalesced" | "hit" | "miss" | "stale";

export interface TakGatewayCacheStats {
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

export interface TakGatewaySourceConfig {
  baseUrl: string;
  cacheMaxEntries?: number;
  cacheTtlMs: number;
  enabled: boolean;
  maxLimit: number;
  readToken?: string;
  staleIfErrorMs?: number;
  timeoutMs: number;
}

export interface TakGatewayFeatureQuery {
  bbox: TakGatewayBbox;
  layers: TakGatewayLayerId[];
  limit: number;
}

export interface TakGatewayBbox {
  east: number;
  north: number;
  south: number;
  west: number;
}

export interface TakGatewayLayerDescriptor {
  defaultVisible: boolean;
  description?: string;
  expectedCadenceSeconds?: number;
  geometryTypes?: string[];
  label: string;
  layerId: TakGatewayLayerId;
}

export interface TakGatewaySourceDescriptor {
  baseUrl?: string;
  enabled?: boolean;
  label?: string;
  layers?: TakGatewayLayerId[];
  license?: Record<string, unknown>;
  mode?: string;
  priority?: number;
  sourceId: "tak_gateway" | string;
  updateCadenceSeconds?: number;
}

export type TakGatewayGeometry =
  | { coordinates: [number, number]; type: "Point" }
  | { coordinates: Array<[number, number]>; type: "LineString" }
  | { coordinates: Array<Array<[number, number]>>; type: "Polygon" };

export interface TakGatewayFeatureProperties {
  affiliation?: TakGatewayAffiliation | string;
  category: string;
  confidence?: number;
  featureId: string;
  label: string;
  layer: TakGatewayLayerId;
  license?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  observedAt?: string;
  receivedAt?: string;
  sourceId: string;
  stale?: boolean;
  tags?: Record<string, unknown>;
  validUntil?: string;
}

export interface TakGatewayFeature {
  geometry: TakGatewayGeometry;
  id?: string | number;
  properties: TakGatewayFeatureProperties;
  type: "Feature";
}

export interface TakGatewayFeatureCollection {
  contractVersion: "cop-tak-source-v1";
  cache?: {
    key: string;
    status: TakGatewayCacheStatus;
    ttlMs: number;
    upstreamBbox: TakGatewayBbox;
  };
  features: TakGatewayFeature[];
  generatedAt: string;
  query: {
    bbox: TakGatewayBbox;
    layers: TakGatewayLayerId[];
    limit: number;
  };
  source: {
    generatedAt?: string;
    sourceId: "tak-gateway-api";
    sourceType: "TAK_COT_GATEWAY";
  };
  sources: TakGatewaySourceDescriptor[];
  summary: {
    affiliationCounts: Record<TakGatewayAffiliation, number>;
    eventCount: number;
    featureCount: number;
    sourceCount: number;
    staleFeatureCount: number;
    warningCount: number;
  };
  type: "FeatureCollection";
  warnings: string[];
}

export interface TakGatewaySource {
  readonly config: TakGatewaySourceConfig;
  readonly sourceSystem: SourceSystem;
  cacheStats?(): TakGatewayCacheStats;
  fetchFeatures(query: TakGatewayFeatureQuery, requestNow: Date): Promise<TakGatewayFeatureCollection>;
  fetchLayers(requestNow: Date): Promise<TakGatewayLayerDescriptor[]>;
  fetchSources(requestNow: Date): Promise<TakGatewaySourceDescriptor[]>;
}

const defaultConfig: TakGatewaySourceConfig = {
  baseUrl: "https://sim.zeleznalady.cz/tak-gateway/api/v1",
  cacheMaxEntries: 5000,
  cacheTtlMs: 5000,
  enabled: false,
  maxLimit: 250,
  staleIfErrorMs: 60000,
  timeoutMs: 7000
};

const allowedLayerIds: TakGatewayLayerId[] = ["mobile", "ground", "traffic"];
const defaultLayers: TakGatewayLayerId[] = ["mobile", "ground", "traffic"];

export function createTakGatewaySourceConfigFromEnv(env: Record<string, string | undefined> = process.env): TakGatewaySourceConfig {
  return {
    baseUrl: trimTrailingSlash(env.COP_TAK_GATEWAY_BASE_URL ?? defaultConfig.baseUrl),
    cacheMaxEntries: readInteger(env.COP_TAK_GATEWAY_CACHE_MAX_ENTRIES, defaultConfig.cacheMaxEntries ?? 5000, 1, 100000),
    cacheTtlMs: readInteger(env.COP_TAK_GATEWAY_CACHE_TTL_MS, defaultConfig.cacheTtlMs, 1000, 60000),
    enabled: readBoolean(env.COP_TAK_GATEWAY_ENABLED, defaultConfig.enabled),
    maxLimit: readInteger(env.COP_TAK_GATEWAY_MAX_LIMIT, defaultConfig.maxLimit, 1, 1000),
    readToken: optionalString(env.COP_TAK_GATEWAY_READ_TOKEN),
    staleIfErrorMs: readInteger(env.COP_TAK_GATEWAY_STALE_IF_ERROR_MS, defaultConfig.staleIfErrorMs ?? 60000, 0, 10 * 60 * 1000),
    timeoutMs: readInteger(env.COP_TAK_GATEWAY_TIMEOUT_MS, defaultConfig.timeoutMs, 1000, 60000)
  };
}

export function createTakGatewaySourceFromEnv(env: Record<string, string | undefined> = process.env): TakGatewaySource | undefined {
  const config = createTakGatewaySourceConfigFromEnv(env);
  return config.enabled ? new TakGatewaySourceAdapter(config) : undefined;
}

export class TakGatewaySourceAdapter implements TakGatewaySource {
  readonly sourceSystem: SourceSystem;
  private readonly featureCache: ManagedTakGatewayCache<TakGatewayFeatureCollection>;
  private layerCache: { expiresAtMs: number; value: TakGatewayLayerDescriptor[] } | null = null;
  private sourceCache: { expiresAtMs: number; value: TakGatewaySourceDescriptor[] } | null = null;

  constructor(readonly config: TakGatewaySourceConfig) {
    this.sourceSystem = createTakGatewaySourceSystem();
    this.featureCache = new ManagedTakGatewayCache<TakGatewayFeatureCollection>({
      maxEntries: cacheMaxEntries(config),
      staleIfErrorMs: staleIfErrorMs(config)
    });
  }

  cacheStats(): TakGatewayCacheStats {
    return this.featureCache.stats();
  }

  async fetchLayers(requestNow: Date): Promise<TakGatewayLayerDescriptor[]> {
    if (this.layerCache && this.layerCache.expiresAtMs > requestNow.getTime()) {
      return this.layerCache.value;
    }
    const response = await fetchJson(new URL(`${trimTrailingSlash(this.config.baseUrl)}/layers`), this.config, requestNow);
    const rawItems = responseItems(response);
    const value = rawItems.length > 0 ? rawItems.flatMap(normalizeTakGatewayLayer) : fallbackTakGatewayLayers();
    this.layerCache = {
      expiresAtMs: requestNow.getTime() + this.config.cacheTtlMs,
      value
    };
    return value;
  }

  async fetchSources(requestNow: Date): Promise<TakGatewaySourceDescriptor[]> {
    if (this.sourceCache && this.sourceCache.expiresAtMs > requestNow.getTime()) {
      return this.sourceCache.value;
    }
    const response = await fetchJson(new URL(`${trimTrailingSlash(this.config.baseUrl)}/sources`), this.config, requestNow);
    const rawItems = responseItems(response);
    const value = rawItems.length > 0 ? rawItems.flatMap(normalizeTakGatewaySourceDescriptor) : fallbackTakGatewaySources();
    this.sourceCache = {
      expiresAtMs: requestNow.getTime() + this.config.cacheTtlMs,
      value
    };
    return value;
  }

  async fetchFeatures(query: TakGatewayFeatureQuery, requestNow: Date): Promise<TakGatewayFeatureCollection> {
    const normalizedQuery = normalizeTakGatewayFeatureQuery(query, this.config);
    const upstreamQuery = canonicalizeTakGatewayFeatureQuery(normalizedQuery);
    const cacheKey = takGatewayFeatureCacheKey(upstreamQuery);
    const cached = await this.featureCache.getOrLoad(cacheKey, this.config.cacheTtlMs, () => fetchTakGatewayFeatures(this.config, upstreamQuery, requestNow));
    return projectTakGatewayFeatureCollection(cached.value, normalizedQuery, {
      cacheKey,
      cacheStatus: cached.status,
      ttlMs: this.config.cacheTtlMs,
      upstreamBbox: upstreamQuery.bbox
    });
  }
}

interface ManagedTakGatewayCacheOptions {
  maxEntries: number;
  staleIfErrorMs: number;
}

interface TakGatewayCacheEntry<T> {
  expiresAtMs: number;
  lastAccessedAtMs: number;
  staleUntilMs: number;
  value: T;
}

interface TakGatewayCacheLoadResult<T> {
  status: TakGatewayCacheStatus;
  value: T;
}

class ManagedTakGatewayCache<T> {
  private readonly entries = new Map<string, TakGatewayCacheEntry<T>>();
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

  constructor(private readonly options: ManagedTakGatewayCacheOptions) {}

  async getOrLoad(key: string, ttlMs: number, loader: () => Promise<T>): Promise<TakGatewayCacheLoadResult<T>> {
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

  stats(): TakGatewayCacheStats {
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

export function buildTakGatewayHealth(response: TakGatewayFeatureCollection | TakGatewayLayerDescriptor[] | TakGatewaySourceDescriptor[], requestNow: Date): SourceHealthOverride {
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
      affiliationCounts: response.summary.affiliationCounts,
      eventCount: response.summary.eventCount,
      featureCount: response.summary.featureCount,
      sourceCount: response.summary.sourceCount,
      staleFeatureCount: response.summary.staleFeatureCount,
      warningCount
    },
    warnings: response.warnings
  };
}

export function unavailableTakGatewayHealth(error: unknown, requestNow: Date): SourceHealthOverride {
  const message = error instanceof Error ? error.message : "unknown error";
  const tokenProblem = /401|unauthorized|token/iu.test(message);
  return {
    detail: tokenProblem ? "TAK Gateway read token is missing or rejected." : "TAK Gateway is unavailable.",
    evaluatedAt: requestNow.toISOString(),
    health: "UNAVAILABLE",
    lastError: message,
    lastPollAt: requestNow.toISOString(),
    warnings: [tokenProblem ? "TAK Gateway token configuration failed." : "TAK Gateway request failed."]
  };
}

export function emptyTakGatewayFeatureCollection(query: TakGatewayFeatureQuery, requestNow: Date, warnings: string[] = []): TakGatewayFeatureCollection {
  return {
    contractVersion: "cop-tak-source-v1",
    features: [],
    generatedAt: requestNow.toISOString(),
    query,
    source: {
      generatedAt: requestNow.toISOString(),
      sourceId: "tak-gateway-api",
      sourceType: "TAK_COT_GATEWAY"
    },
    sources: [],
    summary: {
      affiliationCounts: emptyAffiliationCounts(),
      eventCount: 0,
      featureCount: 0,
      sourceCount: 0,
      staleFeatureCount: 0,
      warningCount: warnings.length
    },
    type: "FeatureCollection",
    warnings
  };
}

export function parseTakGatewayFeatureQuery(rawQuery: Record<string, unknown>, config: TakGatewaySourceConfig): TakGatewayFeatureQuery | null {
  const bbox = typeof rawQuery.bbox === "string" ? parseTakGatewayBbox(rawQuery.bbox) : null;
  if (!bbox) {
    return null;
  }
  const layers = parseTakGatewayLayers(typeof rawQuery.layers === "string" ? rawQuery.layers : undefined);
  if (!layers) {
    return null;
  }
  return normalizeTakGatewayFeatureQuery({
    bbox,
    layers,
    limit: optionalNumber(rawQuery.limit) ?? config.maxLimit
  }, config);
}

function normalizeTakGatewayFeatureQuery(query: TakGatewayFeatureQuery, config: TakGatewaySourceConfig): TakGatewayFeatureQuery {
  return {
    bbox: {
      east: clampNumber(query.bbox.east, -180, 180),
      north: clampNumber(query.bbox.north, -90, 90),
      south: clampNumber(query.bbox.south, -90, 90),
      west: clampNumber(query.bbox.west, -180, 180)
    },
    layers: query.layers.filter(isTakGatewayLayerId).length > 0
      ? uniqueLayers(query.layers.filter(isTakGatewayLayerId))
      : [...defaultLayers],
    limit: Math.round(clampNumber(query.limit, 1, config.maxLimit))
  };
}

interface ProjectTakGatewayFeatureCollectionOptions {
  cacheKey: string;
  cacheStatus: TakGatewayCacheStatus;
  ttlMs: number;
  upstreamBbox: TakGatewayBbox;
}

function canonicalizeTakGatewayFeatureQuery(query: TakGatewayFeatureQuery): TakGatewayFeatureQuery {
  const gridSizeDegrees = gridSizeDegreesForBbox(query.bbox);
  const paddedBbox = padBbox(query.bbox, 0.12);
  return {
    bbox: snapBboxToGrid(paddedBbox, gridSizeDegrees),
    layers: query.layers,
    limit: query.limit
  };
}

function projectTakGatewayFeatureCollection(
  collection: TakGatewayFeatureCollection,
  requestQuery: TakGatewayFeatureQuery,
  options: ProjectTakGatewayFeatureCollectionOptions
): TakGatewayFeatureCollection {
  const features = collection.features.filter((feature) =>
    requestQuery.layers.includes(feature.properties.layer)
    && isFeatureInBbox(feature, requestQuery.bbox)
  );
  const sourceIds = new Set(features.map((feature) => feature.properties.sourceId));
  const sources = collection.sources.filter((source) => sourceIds.size === 0 || sourceIds.has(source.sourceId));
  const warnings = options.cacheStatus === "stale"
    ? [...collection.warnings, "COP served stale TAK Gateway cache because SIM refresh failed."]
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
      limit: requestQuery.limit
    },
    sources,
    summary: {
      affiliationCounts: countAffiliations(features),
      eventCount: collection.summary.eventCount,
      featureCount: features.length,
      sourceCount: sources.length,
      staleFeatureCount: features.filter((feature) => feature.properties.stale).length,
      warningCount: warnings.length
    },
    warnings
  };
}

async function fetchTakGatewayFeatures(config: TakGatewaySourceConfig, query: TakGatewayFeatureQuery, requestNow: Date): Promise<TakGatewayFeatureCollection> {
  const url = new URL(`${trimTrailingSlash(config.baseUrl)}/cop/features`);
  url.searchParams.set("bbox", `${query.bbox.west},${query.bbox.south},${query.bbox.east},${query.bbox.north}`);
  url.searchParams.set("layers", query.layers.join(","));
  url.searchParams.set("limit", String(query.limit));
  return normalizeTakGatewayFeatureCollection(await fetchJson(url, config, requestNow), query);
}

async function fetchJson(url: URL, config: TakGatewaySourceConfig, requestNow: Date): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-COP-Request-At": requestNow.toISOString()
  };
  if (config.readToken) {
    headers.Authorization = `Bearer ${config.readToken}`;
  }
  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal
    });
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("TAK Gateway read token was rejected (401). Check COP_TAK_GATEWAY_READ_TOKEN.");
      }
      throw new Error(`${response.status} ${response.statusText || "TAK Gateway request failed"}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeTakGatewayFeatureCollection(value: unknown, fallbackQuery: TakGatewayFeatureQuery): TakGatewayFeatureCollection {
  if (!isRecord(value) || value.contractVersion !== "cop-tak-source-v1" || value.type !== "FeatureCollection") {
    throw new Error("TAK Gateway response does not match cop-tak-source-v1.");
  }
  if (!isRecord(value.source) || value.source.sourceId !== "tak-gateway-api" || value.source.sourceType !== "TAK_COT_GATEWAY") {
    throw new Error("TAK Gateway source descriptor is not valid.");
  }
  const features = Array.isArray(value.features) ? value.features.flatMap(normalizeTakGatewayFeature) : [];
  return {
    contractVersion: "cop-tak-source-v1",
    features,
    generatedAt: optionalString(value.generatedAt) ?? new Date().toISOString(),
    query: normalizeResponseQuery(value.query, fallbackQuery),
    source: {
      generatedAt: optionalString(value.source.generatedAt),
      sourceId: "tak-gateway-api",
      sourceType: "TAK_COT_GATEWAY"
    },
    sources: Array.isArray(value.sources) ? value.sources.flatMap(normalizeTakGatewaySourceDescriptor) : [],
    summary: normalizeTakGatewaySummary(value.summary, features),
    type: "FeatureCollection",
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((warning): warning is string => typeof warning === "string") : []
  };
}

function normalizeTakGatewayLayer(value: unknown): TakGatewayLayerDescriptor[] {
  if (!isRecord(value) || !isTakGatewayLayerId(value.layerId)) {
    return [];
  }
  return [
    {
      defaultVisible: value.defaultVisible === true,
      description: optionalString(value.description),
      expectedCadenceSeconds: optionalNumber(value.expectedCadenceSeconds),
      geometryTypes: Array.isArray(value.geometryTypes) ? value.geometryTypes.filter((item): item is string => typeof item === "string") : undefined,
      label: optionalString(value.label) ?? takGatewayLayerLabel(value.layerId),
      layerId: value.layerId
    }
  ];
}

function normalizeTakGatewayFeature(value: unknown): TakGatewayFeature[] {
  if (!isRecord(value) || value.type !== "Feature" || !isRecord(value.properties)) {
    return [];
  }
  const geometry = normalizeGeometry(value.geometry);
  const properties = normalizeTakGatewayProperties(value.properties);
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

function normalizeTakGatewayProperties(value: Record<string, unknown>): TakGatewayFeatureProperties | null {
  if (!isTakGatewayLayerId(value.layer)) {
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
    affiliation: normalizeAffiliation(value.affiliation),
    category,
    confidence: optionalFinite(value.confidence),
    featureId,
    label,
    layer: value.layer,
    license: isRecord(value.license) ? value.license : undefined,
    metrics: isRecord(value.metrics) ? value.metrics : undefined,
    observedAt: optionalString(value.observedAt),
    receivedAt: optionalString(value.receivedAt),
    sourceId,
    stale: typeof value.stale === "boolean" ? value.stale : undefined,
    tags: isRecord(value.tags) ? value.tags : undefined,
    validUntil: optionalString(value.validUntil)
  };
}

function normalizeTakGatewaySourceDescriptor(value: unknown): TakGatewaySourceDescriptor[] {
  if (!isRecord(value) || typeof value.sourceId !== "string") {
    return [];
  }
  return [
    {
      baseUrl: optionalString(value.baseUrl),
      enabled: typeof value.enabled === "boolean" ? value.enabled : undefined,
      label: optionalString(value.label),
      layers: Array.isArray(value.layers) ? value.layers.filter(isTakGatewayLayerId) : undefined,
      license: isRecord(value.license) ? value.license : undefined,
      mode: optionalString(value.mode),
      priority: optionalNumber(value.priority),
      sourceId: value.sourceId,
      updateCadenceSeconds: optionalNumber(value.updateCadenceSeconds)
    }
  ];
}

function normalizeTakGatewaySummary(value: unknown, features: TakGatewayFeature[]): TakGatewayFeatureCollection["summary"] {
  const summary = isRecord(value) ? value : {};
  const affiliationCounts = isRecord(summary.affiliationCounts)
    ? {
        friend: optionalNumber(summary.affiliationCounts.friend) ?? 0,
        hostile: optionalNumber(summary.affiliationCounts.hostile) ?? 0,
        neutral: optionalNumber(summary.affiliationCounts.neutral) ?? 0,
        unknown: optionalNumber(summary.affiliationCounts.unknown) ?? 0
      }
    : countAffiliations(features);
  return {
    affiliationCounts,
    eventCount: optionalNumber(summary.eventCount) ?? features.length,
    featureCount: optionalNumber(summary.featureCount) ?? features.length,
    sourceCount: optionalNumber(summary.sourceCount) ?? 0,
    staleFeatureCount: optionalNumber(summary.staleFeatureCount) ?? features.filter((feature) => feature.properties.stale).length,
    warningCount: optionalNumber(summary.warningCount) ?? 0
  };
}

function normalizeResponseQuery(value: unknown, fallback: TakGatewayFeatureQuery): TakGatewayFeatureCollection["query"] {
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
    layers: Array.isArray(value.layers) ? value.layers.filter(isTakGatewayLayerId) : fallback.layers,
    limit: optionalNumber(value.limit) ?? fallback.limit
  };
}

function normalizeGeometry(value: unknown): TakGatewayGeometry | null {
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

function parseTakGatewayBbox(value: string): TakGatewayBbox | null {
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

function parseTakGatewayLayers(value: string | undefined): TakGatewayLayerId[] | null {
  if (value === undefined || value.trim() === "") {
    return [...defaultLayers];
  }
  const rawLayers = value.split(",").map((item) => item.trim()).filter(Boolean);
  const layers = rawLayers.filter(isTakGatewayLayerId);
  return rawLayers.length > 0 && layers.length === rawLayers.length ? uniqueLayers(layers) : null;
}

function takGatewayFeatureCacheKey(query: TakGatewayFeatureQuery): string {
  return [
    query.bbox.west.toFixed(4),
    query.bbox.south.toFixed(4),
    query.bbox.east.toFixed(4),
    query.bbox.north.toFixed(4),
    query.layers.join(","),
    query.limit
  ].join("|");
}

function cacheMaxEntries(config: TakGatewaySourceConfig): number {
  return Math.max(1, Math.trunc(config.cacheMaxEntries ?? defaultConfig.cacheMaxEntries ?? 5000));
}

function staleIfErrorMs(config: TakGatewaySourceConfig): number {
  return Math.max(0, Math.trunc(config.staleIfErrorMs ?? defaultConfig.staleIfErrorMs ?? 60000));
}

function gridSizeDegreesForBbox(bbox: TakGatewayBbox): number {
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

function padBbox(bbox: TakGatewayBbox, ratio: number): TakGatewayBbox {
  const width = Math.max(0.001, Math.abs(bbox.east - bbox.west));
  const height = Math.max(0.001, Math.abs(bbox.north - bbox.south));
  return {
    east: clampNumber(bbox.east + width * ratio, -180, 180),
    north: clampNumber(bbox.north + height * ratio, -90, 90),
    south: clampNumber(bbox.south - height * ratio, -90, 90),
    west: clampNumber(bbox.west - width * ratio, -180, 180)
  };
}

function snapBboxToGrid(bbox: TakGatewayBbox, gridSizeDegrees: number): TakGatewayBbox {
  return {
    east: clampNumber(round(Math.ceil(bbox.east / gridSizeDegrees) * gridSizeDegrees, 4), -180, 180),
    north: clampNumber(round(Math.ceil(bbox.north / gridSizeDegrees) * gridSizeDegrees, 4), -90, 90),
    south: clampNumber(round(Math.floor(bbox.south / gridSizeDegrees) * gridSizeDegrees, 4), -90, 90),
    west: clampNumber(round(Math.floor(bbox.west / gridSizeDegrees) * gridSizeDegrees, 4), -180, 180)
  };
}

function isFeatureInBbox(feature: TakGatewayFeature, bbox: TakGatewayBbox): boolean {
  const featureBbox = geometryBbox(feature.geometry);
  return featureBbox ? bboxIntersects(featureBbox, bbox) : false;
}

function geometryBbox(geometry: TakGatewayGeometry): TakGatewayBbox | null {
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

function geometryCoordinates(geometry: TakGatewayGeometry): Array<[number, number]> {
  if (geometry.type === "Point") {
    return [geometry.coordinates];
  }
  if (geometry.type === "LineString") {
    return geometry.coordinates;
  }
  return geometry.coordinates.flatMap((ring) => ring);
}

function bboxIntersects(a: TakGatewayBbox, b: TakGatewayBbox): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

function responseItems(response: unknown): unknown[] {
  if (Array.isArray(response)) {
    return response;
  }
  if (isRecord(response) && Array.isArray(response.items)) {
    return response.items;
  }
  return [];
}

function fallbackTakGatewayLayers(): TakGatewayLayerDescriptor[] {
  return [
    {
      defaultVisible: false,
      description: "TAK/CoT mobile unit positions.",
      expectedCadenceSeconds: 15,
      geometryTypes: ["Point"],
      label: "Mobile units",
      layerId: "mobile"
    },
    {
      defaultVisible: false,
      description: "TAK/CoT ground markers.",
      expectedCadenceSeconds: 15,
      geometryTypes: ["Point"],
      label: "Ground markers",
      layerId: "ground"
    },
    {
      defaultVisible: false,
      description: "TAK/CoT traffic tracks.",
      expectedCadenceSeconds: 15,
      geometryTypes: ["Point", "LineString"],
      label: "Traffic tracks",
      layerId: "traffic"
    }
  ];
}

function fallbackTakGatewaySources(): TakGatewaySourceDescriptor[] {
  return [
    {
      enabled: true,
      label: "TAK/CoT gateway",
      layers: [...defaultLayers],
      mode: "live",
      priority: 20,
      sourceId: "tak_gateway",
      updateCadenceSeconds: 15
    }
  ];
}

function countAffiliations(features: TakGatewayFeature[]): Record<TakGatewayAffiliation, number> {
  const counts = emptyAffiliationCounts();
  for (const feature of features) {
    const affiliation = normalizeAffiliation(feature.properties.affiliation);
    counts[affiliation] += 1;
  }
  return counts;
}

function emptyAffiliationCounts(): Record<TakGatewayAffiliation, number> {
  return {
    friend: 0,
    hostile: 0,
    neutral: 0,
    unknown: 0
  };
}

function normalizeAffiliation(value: unknown): TakGatewayAffiliation {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized === "friend" || normalized === "hostile" || normalized === "neutral" ? normalized : "unknown";
}

function takGatewayLayerLabel(layerId: TakGatewayLayerId): string {
  const labels: Record<TakGatewayLayerId, string> = {
    ground: "Ground markers",
    mobile: "Mobile units",
    traffic: "Traffic tracks"
  };
  return labels[layerId];
}

function isTakGatewayLayerId(value: unknown): value is TakGatewayLayerId {
  return allowedLayerIds.includes(value as TakGatewayLayerId);
}

function uniqueLayers<T extends string>(layers: T[]): T[] {
  return Array.from(new Set(layers));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function optionalFinite(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value === "true" || value === "1" || value === "yes" || value === "on";
}

function readInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
