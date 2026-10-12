import type { SourceSystem } from "@cop/canonical-model";
import type { SourceHealthOverride } from "./types.js";

export type SimSearchEntityType =
  | "police_station"
  | "fire_station"
  | "hospital"
  | "medical_emergency"
  | "hydro_station"
  | "hydro_measurement"
  | "weather_forecast"
  | "weather_nowcast"
  | "weather_radar"
  | "thunderstorm_risk"
  | "weather_warning"
  | "safety_alert"
  | "fire_incident"
  | "flood_risk_area"
  | "road_closure"
  | "shelter"
  | "evacuation_point"
  | "municipality"
  | "district"
  | "region"
  | "critical_infrastructure"
  | "public_resource";

export interface SimSearchDataSourceConfig {
  baseUrl: string;
  enabled: boolean;
  indexLimit: number;
  maxLimit: number;
  timeoutMs: number;
}

export interface SimSearchCoordinate {
  lat: number;
  lon: number;
}

export interface SimSearchBbox {
  east: number;
  north: number;
  south: number;
  west: number;
}

export interface SimSearchQueryRequest {
  bbox?: SimSearchBbox | null;
  center?: SimSearchCoordinate;
  entityTypes?: SimSearchEntityType[];
  includeStale?: boolean;
  limit?: number;
  radiusM?: number;
  sourceSystems?: string[];
  text?: string;
  validAt?: string;
}

export interface SimSearchEntity {
  address?: Record<string, unknown>;
  aliases?: string[];
  allowedUse?: string[];
  centroid?: SimSearchCoordinate;
  classification?: Record<string, unknown> | string;
  confidence?: number;
  contractVersion?: string;
  dataQuality?: string;
  deleted?: boolean;
  distanceM?: number;
  entitySubtype?: string;
  entityType: SimSearchEntityType | string;
  expiresAt?: string;
  geometry?: Record<string, unknown>;
  handling?: Record<string, unknown> | string[];
  layerIds?: string[];
  localized?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  observedAt?: string;
  positionQuality?: Record<string, unknown> | string;
  providerEntityId: string;
  providerId?: string;
  providerProperties?: Record<string, unknown>;
  score?: number;
  searchableText?: string;
  severity?: string | null;
  sourceAuthority?: string;
  sourceEntityId?: string;
  sourceRevision?: string;
  sourceSystem?: string;
  stale?: boolean;
  status?: string;
  summary?: string;
  tags?: unknown;
  title: string;
  updatedAt?: string;
  validFrom?: string;
  validUntil?: string;
  visibility?: string;
}

export interface SimSearchQueryResponse {
  contractVersion: "sim-search-source-v1" | string;
  generatedAt?: string;
  providerId: string;
  query?: Record<string, unknown>;
  results: SimSearchEntity[];
  summary: {
    resultCount: number;
    staleResultCount: number;
    warningCount: number;
  };
  warnings: string[];
  warningsKnown?: boolean;
  freshness?: SimSearchFreshness;
  consumptionExpiry?: SimSearchConsumptionExpiry;
}

export interface SimSearchConsumptionExpiry {
  scope: "returned_entities";
  derivation: "COP_DERIVED";
  evaluatedAt: string;
  expiredCount: number;
  missingExpiryCount: number;
  invalidExpiryCount: number;
}

export interface SimSearchFreshness {
  scope: "returned_entities";
  evaluatedAt: string;
  feedTimestampState: "valid" | "future" | "invalid";
  feedAgeSeconds: number | null;
  returnedStaleCount: number;
  returnedExpiredCount: number;
  missingExpiryCount: number;
  invalidExpiryCount: number;
}

export interface SimSearchEntitiesRequest {
  cursor?: string;
  limit?: number;
}

export interface SimSearchEntitiesResponse extends SimSearchQueryResponse {
  nextCursor?: string;
}

export interface SimSearchObservability {
  generatedAt?: string;
  dataQualityStatus?: "degraded" | "ok";
  degradedSourceCount?: number;
  sources?: SimSearchSourceObservability[];
  sourcesKnown?: boolean;
  cache?: SimSearchCacheObservability;
  sourceCaches?: Array<Record<string, unknown>>;
  status: "degraded" | "ok" | string;
  summary?: Record<string, unknown>;
  warnings?: string[];
  warningsKnown?: boolean;
}

export interface SimSearchSourceObservability {
  sourceSystem: string;
  status: "degraded" | "ok" | "unknown";
  dataQualityStatus?: "degraded" | "ok";
  entityCount?: number;
  staleCount?: number;
  lastSuccessAt?: string;
  warningCount?: number;
}

export interface SimSearchCacheObservability {
  entries?: number;
  inflight?: number;
  maxEntries?: number;
  hits?: number;
  misses?: number;
  hitRate?: number;
  staleHits?: number;
  refreshes?: number;
  errors?: number;
  evictions?: number;
}

export interface SimSearchDataSource {
  readonly config: SimSearchDataSourceConfig;
  readonly sourceSystem: SourceSystem;
  fetchEntities?(request: SimSearchEntitiesRequest, requestNow: Date): Promise<SimSearchEntitiesResponse>;
  fetchEntity?(providerEntityId: string, requestNow: Date): Promise<SimSearchEntity | undefined>;
  fetchObservability?(requestNow: Date): Promise<SimSearchObservability>;
  fetchTaxonomy?(requestNow: Date): Promise<Record<string, unknown>>;
  query(request: SimSearchQueryRequest, requestNow: Date): Promise<SimSearchQueryResponse>;
}

const defaultConfig: SimSearchDataSourceConfig = {
  baseUrl: "http://docker.home.cz:5020/search-data/api/v1",
  enabled: false,
  indexLimit: 1000,
  maxLimit: 100,
  timeoutMs: 6000
};

export function createSimSearchDataSourceConfigFromEnv(env: Record<string, string | undefined> = process.env): SimSearchDataSourceConfig {
  return {
    baseUrl: trimTrailingSlash(env.COP_SIM_SEARCH_DATA_BASE_URL ?? defaultConfig.baseUrl),
    enabled: readBoolean(env.COP_SIM_SEARCH_DATA_ENABLED, defaultConfig.enabled),
    indexLimit: readInteger(env.COP_SIM_SEARCH_DATA_INDEX_LIMIT, defaultConfig.indexLimit, 0, 5000),
    maxLimit: readInteger(env.COP_SIM_SEARCH_DATA_MAX_LIMIT, defaultConfig.maxLimit, 1, 5000),
    timeoutMs: readInteger(env.COP_SIM_SEARCH_DATA_TIMEOUT_MS, defaultConfig.timeoutMs, 500, 30000)
  };
}

export function createSimSearchDataSourceFromEnv(env: Record<string, string | undefined> = process.env): SimSearchDataSource | undefined {
  const config = createSimSearchDataSourceConfigFromEnv(env);
  return config.enabled ? new SimSearchDataSourceAdapter(config) : undefined;
}

export class SimSearchDataSourceAdapter implements SimSearchDataSource {
  readonly sourceSystem: SourceSystem;

  constructor(readonly config: SimSearchDataSourceConfig, private readonly clock: () => Date = () => new Date()) {
    this.sourceSystem = createSimSearchDataSourceSystem();
  }

  async query(request: SimSearchQueryRequest, requestNow: Date): Promise<SimSearchQueryResponse> {
    const body = {
      ...request,
      limit: Math.min(Math.max(1, request.limit ?? this.config.maxLimit), this.config.maxLimit)
    };
    return normalizeSimSearchQueryResponse(await fetchJson(new URL(`${trimTrailingSlash(this.config.baseUrl)}/query`), this.config, requestNow, {
      body: JSON.stringify(body),
      method: "POST"
    }), body, this.clock());
  }

  async fetchEntities(request: SimSearchEntitiesRequest, requestNow: Date): Promise<SimSearchEntitiesResponse> {
    const url = new URL(`${trimTrailingSlash(this.config.baseUrl)}/entities`);
    const limit = Math.min(Math.max(1, request.limit ?? this.config.indexLimit), Math.max(1, this.config.indexLimit));
    url.searchParams.set("limit", String(limit));
    if (request.cursor) {
      url.searchParams.set("cursor", request.cursor);
    }
    return normalizeSimSearchEntitiesResponse(await fetchJson(url, this.config, requestNow), {
      ...(request.cursor ? { cursor: request.cursor } : {}),
      limit
    }, this.clock());
  }

  async fetchEntity(providerEntityId: string, requestNow: Date): Promise<SimSearchEntity | undefined> {
    const value = await fetchJson(new URL(`${trimTrailingSlash(this.config.baseUrl)}/entities/${encodeURIComponent(providerEntityId)}`), this.config, requestNow);
    return normalizeSimSearchEntityResponse(value, this.clock());
  }

  async fetchObservability(requestNow: Date): Promise<SimSearchObservability> {
    return normalizeSimSearchObservability(await fetchJson(new URL(`${trimTrailingSlash(this.config.baseUrl)}/observability`), this.config, requestNow));
  }

  async fetchTaxonomy(requestNow: Date): Promise<Record<string, unknown>> {
    const value = await fetchJson(new URL(`${trimTrailingSlash(this.config.baseUrl)}/taxonomy`), this.config, requestNow);
    return isRecord(value) ? value : {};
  }
}

export function buildSimSearchDataHealth(response: SimSearchQueryResponse | SimSearchObservability, requestNow: Date): SourceHealthOverride {
  const warnings = warningStrings("warnings" in response ? response.warnings : undefined);
  const reportedResultCount = "summary" in response && isRecord(response.summary) ? optionalCounter(response.summary.resultCount) : undefined;
  const reportedStaleResultCount = "summary" in response && isRecord(response.summary) ? optionalCounter(response.summary.staleResultCount) : undefined;
  const resultCount = "results" in response ? Math.max(reportedResultCount ?? 0, response.results.length) : reportedResultCount;
  const staleResultCount = "results" in response
    ? Math.max(reportedStaleResultCount ?? 0, response.results.filter((item) => item.stale === true).length)
    : reportedStaleResultCount;
  const consumptionExpiry = "results" in response ? normalizeConsumptionExpiry(response.consumptionExpiry, response.results.length) : undefined;
  const providerFreshness = "results" in response ? normalizeSearchFreshness(response.freshness, response.results.length) : undefined;
  const status = "status" in response ? response.status : undefined;
  const health: SourceHealthOverride["health"] = status === "degraded" || warnings.length > 0 || (staleResultCount ?? 0) > 0
    ? "DEGRADED"
    : status === "ok" || "results" in response
      ? "ONLINE"
      : "WAITING";
  return {
    detail: `SIM search-data ${health.toLowerCase()}${resultCount !== undefined ? `; ${resultCount} results` : ""}`,
    evaluatedAt: requestNow.toISOString(),
    generatedAt: optionalTimestamp(response.generatedAt),
    health,
    lastPollAt: requestNow.toISOString(),
    ...(health === "ONLINE" ? { lastSuccessAt: requestNow.toISOString() } : {}),
    summary: {
      ...(resultCount !== undefined ? { resultCount } : {}),
      ...(staleResultCount !== undefined ? { staleResultCount } : {}),
      ...(consumptionExpiry ? { consumptionExpiry } : {}),
      ...(providerFreshness ? { providerFreshness } : {}),
      warningsKnown: response.warningsKnown ?? false,
      ...("status" in response ? {
        serviceStatus: response.status,
        dataQualityStatus: response.dataQualityStatus ?? "unknown",
        sourcesKnown: response.sourcesKnown ?? false,
        ...(response.degradedSourceCount !== undefined ? { degradedSourceCount: response.degradedSourceCount } : {})
      } : {})
    },
    warnings
  };
}

export function unavailableSimSearchDataHealth(error: unknown, requestNow: Date): SourceHealthOverride {
  return {
    detail: "SIM search-data unavailable",
    evaluatedAt: requestNow.toISOString(),
    health: "UNAVAILABLE",
    lastError: error instanceof Error ? error.message : String(error),
    lastPollAt: requestNow.toISOString(),
    warnings: [error instanceof Error ? error.message : String(error)]
  };
}

function createSimSearchDataSourceSystem(): SourceSystem {
  const now = new Date().toISOString();
  return {
    allowedEventTypes: [],
    allowedObjectTypes: ["MAP_FEATURE", "INCIDENT", "REPORT", "UNKNOWN"],
    attributes: {
      contextOnly: true,
      contractVersion: "sim-search-source-v1"
    },
    classificationLimit: "UNCLASSIFIED",
    createdAt: now,
    displayName: "SIM Search Data",
    owner: "SIM search-data-api",
    sourceSystemId: "sim-search-data-api",
    sourceType: "PUBLIC_SITUATION_AGGREGATE",
    status: "ACTIVE",
    synthetic: false,
    trustProfile: "UNKNOWN",
    updatedAt: now
  };
}

type FetchJsonInit = RequestInit & { timeoutMs?: number };

class SimSearchDataHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`SIM search-data request returned HTTP ${status}.`);
    this.name = "SimSearchDataHttpError";
    this.status = status;
  }
}

async function fetchJson(url: URL, config: SimSearchDataSourceConfig, requestNow: Date, init: FetchJsonInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const { timeoutMs, ...requestInit } = init;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new SimSearchDataTimeoutError());
      controller.abort();
    }, timeoutMs ?? config.timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, {
          ...requestInit,
          headers: {
            Accept: "application/json",
            ...(requestInit.body ? { "Content-Type": "application/json" } : {}),
            "X-COP-Request-At": requestNow.toISOString(),
            ...(requestInit.headers ?? {})
          },
          redirect: "error",
          signal: controller.signal
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          throw new SimSearchDataHttpError(response.status);
        }
        return await readBoundedJson(response, controller.signal);
      })(),
      deadline
    ]);
  } catch (error) {
    controller.abort();
    if (error instanceof SimSearchDataHttpError || error instanceof SimSearchDataResponseError || error instanceof SimSearchDataTimeoutError) {
      throw error;
    }
    throw new Error("SIM search-data transport failed.");
  } finally {
    clearTimeout(timeout);
  }
}

class SimSearchDataResponseError extends Error {}

class SimSearchDataTimeoutError extends Error {
  constructor() {
    super("SIM search-data request timed out.");
    this.name = "TimeoutError";
  }
}

async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) {
    void response.body?.cancel().catch(() => {});
    throw new SimSearchDataTimeoutError();
  }
  const maxBytes = 16 * 1024 * 1024;
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw new SimSearchDataResponseError("SIM search-data response exceeded the size limit.");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new SimSearchDataResponseError("SIM search-data response body is missing.");
  }
  const decoder = new TextDecoder();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new SimSearchDataResponseError("SIM search-data response exceeded the size limit.");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SimSearchDataResponseError("SIM search-data response is not valid JSON.");
  }
}

function normalizeSimSearchQueryResponse(value: unknown, query: Record<string, unknown>, requestNow: Date): SimSearchQueryResponse {
  if (!isRecord(value)) {
    throw new Error("SIM search-data query response is not an object.");
  }
  const rawResults = Array.isArray(value.results)
    ? value.results
    : Array.isArray(value.entities)
      ? value.entities
      : Array.isArray(value.items)
        ? value.items
        : [];
  const entries = rawResults.flatMap((raw) => normalizeSimSearchEntity(raw, requestNow).map((entity) => ({ entity, raw })));
  const results = entries.map((entry) => entry.entity);
  return {
    contractVersion: optionalString(value.contractVersion) ?? "sim-search-source-v1",
    generatedAt: optionalTimestamp(value.generatedAt),
    providerId: optionalString(value.providerId) ?? "sim.search-data",
    query: isRecord(value.query) ? value.query : query,
    results,
    summary: {
      resultCount: Math.max(optionalCounter(isRecord(value.summary) ? value.summary.resultCount : undefined) ?? 0, results.length),
      staleResultCount: Math.max(optionalCounter(isRecord(value.summary) ? value.summary.staleResultCount : undefined) ?? 0, results.filter((item) => item.stale === true).length),
      warningCount: warningStrings(value.warnings).length
    },
    warnings: warningStrings(value.warnings),
    warningsKnown: knownWarningArray(value.warnings),
    freshness: normalizeSearchFreshness(value.freshness, results.length),
    consumptionExpiry: buildConsumptionExpiry(entries.map((entry) => entry.raw), requestNow)
  };
}

function normalizeSimSearchEntitiesResponse(value: unknown, query: Record<string, unknown>, requestNow: Date): SimSearchEntitiesResponse {
  if (!isRecord(value)) {
    throw new Error("SIM search-data entities response is not an object.");
  }
  const response = normalizeSimSearchQueryResponse(value, query, requestNow);
  const nextCursor = optionalString(value.nextCursor);
  return {
    ...response,
    ...(nextCursor ? { nextCursor } : {})
  };
}

function normalizeSimSearchEntityResponse(value: unknown, requestNow: Date): SimSearchEntity | undefined {
  const raw = isRecord(value) && isRecord(value.entity)
    ? value.entity
    : isRecord(value) && isRecord(value.result)
      ? value.result
      : value;
  return normalizeSimSearchEntity(raw, requestNow)[0];
}

function normalizeSimSearchEntity(value: unknown, requestNow: Date): SimSearchEntity[] {
  if (!isRecord(value)) {
    return [];
  }
  const providerEntityId = optionalString(value.providerEntityId) ?? optionalString(value.id);
  const entityType = optionalString(value.entityType) ?? optionalString(value.type);
  const title = optionalString(value.title)
    ?? localizedString(value.localized, "cs", "title")
    ?? optionalString(value.name)
    ?? providerEntityId;
  if (!providerEntityId || !entityType || !title) {
    return [];
  }
  const entity: SimSearchEntity = {
    address: isRecord(value.address) ? value.address : undefined,
    aliases: stringArray(value.aliases),
    allowedUse: stringArray(value.allowedUse),
    centroid: normalizeCoordinate(value.centroid),
    classification: recordOrString(value.classification),
    confidence: optionalRatio(value.confidence),
    contractVersion: optionalString(value.contractVersion),
    dataQuality: optionalString(value.dataQuality),
    deleted: typeof value.deleted === "boolean" ? value.deleted : undefined,
    distanceM: optionalNumber(value.distanceM),
    entitySubtype: optionalString(value.entitySubtype) ?? optionalString(value.subtype),
    entityType,
    expiresAt: optionalString(value.expiresAt),
    geometry: isRecord(value.geometry) ? value.geometry : undefined,
    handling: recordOrStringArray(value.handling),
    layerIds: stringArray(value.layerIds),
    localized: isRecord(value.localized) ? value.localized : undefined,
    metrics: isRecord(value.metrics) ? value.metrics : undefined,
    observedAt: optionalString(value.observedAt),
    positionQuality: recordOrString(value.positionQuality),
    providerEntityId,
    providerId: optionalString(value.providerId),
    providerProperties: isRecord(value.providerProperties) ? value.providerProperties : undefined,
    score: optionalRatio(value.score),
    searchableText: optionalString(value.searchableText),
    severity: optionalString(value.severity) ?? null,
    sourceAuthority: optionalString(value.sourceAuthority),
    sourceEntityId: optionalString(value.sourceEntityId),
    sourceRevision: optionalString(value.sourceRevision),
    sourceSystem: optionalString(value.sourceSystem),
    stale: classifyConsumptionExpiry(value, requestNow).expired ? true : typeof value.stale === "boolean" ? value.stale : undefined,
    status: optionalString(value.status),
    summary: optionalString(value.summary) ?? localizedString(value.localized, "cs", "summary"),
    tags: value.tags,
    title,
    updatedAt: optionalString(value.updatedAt),
    validFrom: optionalString(value.validFrom),
    validUntil: optionalString(value.validUntil),
    visibility: optionalString(value.visibility)
  };
  return [entity];
}

export function projectSimSearchEntitiesForConsumption(entities: SimSearchEntity[], consumedAt: Date): { results: SimSearchEntity[]; expiredCount: number } {
  const expired = entities.map((entity) => classifyConsumptionExpiry(entity, consumedAt).expired);
  return {
    results: entities.map((entity, index) => expired[index] && entity.stale !== true ? { ...entity, stale: true } : entity),
    expiredCount: expired.filter(Boolean).length
  };
}

function classifyConsumptionExpiry(value: unknown, requestNow: Date): { expired: boolean; invalid: boolean; missing: boolean } {
  if (!isRecord(value)) return { expired: false, invalid: false, missing: true };
  const deadlines = [value.expiresAt, value.validUntil].filter((deadline) => deadline !== undefined && deadline !== null);
  const timestamps = deadlines.map(optionalTimestamp);
  return {
    expired: value.status === "expired" || timestamps.some((timestamp) => timestamp !== undefined && Date.parse(timestamp) <= requestNow.getTime()),
    invalid: timestamps.some((timestamp) => timestamp === undefined),
    missing: deadlines.length === 0
  };
}

function buildConsumptionExpiry(values: unknown[], requestNow: Date): SimSearchConsumptionExpiry {
  const states = values.map((value) => classifyConsumptionExpiry(value, requestNow));
  return {
    scope: "returned_entities",
    derivation: "COP_DERIVED",
    evaluatedAt: requestNow.toISOString(),
    expiredCount: states.filter((state) => state.expired).length,
    missingExpiryCount: states.filter((state) => state.missing).length,
    invalidExpiryCount: states.filter((state) => state.invalid).length
  };
}

function normalizeConsumptionExpiry(value: unknown, returnedCount: number): SimSearchConsumptionExpiry | undefined {
  if (!isRecord(value) || value.scope !== "returned_entities" || value.derivation !== "COP_DERIVED") return undefined;
  const evaluatedAt = optionalTimestamp(value.evaluatedAt);
  const expiredCount = optionalCounter(value.expiredCount);
  const missingExpiryCount = optionalCounter(value.missingExpiryCount);
  const invalidExpiryCount = optionalCounter(value.invalidExpiryCount);
  if (!evaluatedAt || expiredCount === undefined || missingExpiryCount === undefined || invalidExpiryCount === undefined
    || [expiredCount, missingExpiryCount, invalidExpiryCount].some((count) => count > returnedCount)) return undefined;
  return { scope: "returned_entities", derivation: "COP_DERIVED", evaluatedAt, expiredCount, missingExpiryCount, invalidExpiryCount };
}

function normalizeSimSearchObservability(value: unknown): SimSearchObservability {
  if (!isRecord(value)) {
    throw new Error("SIM search-data observability response is not an object.");
  }
  return {
    generatedAt: optionalTimestamp(value.generatedAt),
    dataQualityStatus: qualityStatus(value.dataQualityStatus),
    degradedSourceCount: optionalCounter(value.degradedSourceCount),
    sources: Array.isArray(value.sources) ? value.sources.flatMap(normalizeSearchSourceObservability) : undefined,
    sourcesKnown: Array.isArray(value.sources) && value.sources.every(knownSearchSourceObservability),
    cache: isRecord(value.cache) ? normalizeSearchCacheObservability(value.cache) : undefined,
    sourceCaches: Array.isArray(value.sourceCaches) ? value.sourceCaches.filter(isRecord) : undefined,
    status: qualityStatus(value.status) ?? "degraded",
    summary: isRecord(value.summary) ? value.summary : undefined,
    warnings: warningStrings(value.warnings),
    warningsKnown: knownWarningArray(value.warnings)
  };
}

function normalizeSearchSourceObservability(value: unknown): SimSearchSourceObservability[] {
  if (!isRecord(value)) return [];
  const sourceSystem = optionalString(value.sourceSystem);
  if (!sourceSystem) return [];
  return [{
    sourceSystem,
    status: qualityStatus(value.status) ?? "unknown",
    dataQualityStatus: qualityStatus(value.dataQualityStatus),
    entityCount: optionalCounter(value.entityCount),
    staleCount: optionalCounter(value.staleCount),
    lastSuccessAt: optionalTimestamp(value.lastSuccessAt),
    warningCount: knownWarningArray(value.warnings) ? value.warnings.length : undefined
  }];
}

function knownSearchSourceObservability(value: unknown): boolean {
  return isRecord(value) && optionalString(value.sourceSystem) !== undefined && qualityStatus(value.status) !== undefined
    && optionalCounter(value.entityCount) !== undefined && optionalCounter(value.staleCount) !== undefined && knownWarningArray(value.warnings)
    && (value.dataQualityStatus === undefined || qualityStatus(value.dataQualityStatus) !== undefined)
    && (value.lastSuccessAt === undefined || optionalTimestamp(value.lastSuccessAt) !== undefined);
}

function normalizeSearchCacheObservability(value: Record<string, unknown>): SimSearchCacheObservability {
  const cache: SimSearchCacheObservability = {};
  const keys = ["entries", "inflight", "maxEntries", "hits", "misses", "staleHits", "refreshes", "errors", "evictions"] as const;
  for (const key of keys) {
    const count = optionalCounter(value[key]);
    if (count !== undefined) cache[key] = count;
  }
  if (typeof value.hitRate === "number" && Number.isFinite(value.hitRate) && value.hitRate >= 0 && value.hitRate <= 1) {
    cache.hitRate = value.hitRate;
  }
  return cache;
}

function optionalCounter(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function normalizeSearchFreshness(value: unknown, returnedCount: number): SimSearchFreshness | undefined {
  if (!isRecord(value) || value.scope !== "returned_entities") return undefined;
  const evaluatedAt = optionalTimestamp(value.evaluatedAt);
  const feedTimestampState = value.feedTimestampState;
  if (!evaluatedAt || (feedTimestampState !== "valid" && feedTimestampState !== "future" && feedTimestampState !== "invalid")) return undefined;
  const feedAgeSeconds = value.feedAgeSeconds;
  if (feedTimestampState === "valid"
    ? typeof feedAgeSeconds !== "number" || !Number.isFinite(feedAgeSeconds) || feedAgeSeconds < 0
    : feedAgeSeconds !== null) return undefined;
  const returnedStaleCount = optionalCounter(value.returnedStaleCount);
  const returnedExpiredCount = optionalCounter(value.returnedExpiredCount);
  const missingExpiryCount = optionalCounter(value.missingExpiryCount);
  const invalidExpiryCount = optionalCounter(value.invalidExpiryCount);
  if (returnedStaleCount === undefined || returnedExpiredCount === undefined || missingExpiryCount === undefined || invalidExpiryCount === undefined
    || [returnedStaleCount, returnedExpiredCount, missingExpiryCount, invalidExpiryCount].some((count) => count > returnedCount)) return undefined;
  return {
    scope: "returned_entities",
    evaluatedAt,
    feedTimestampState,
    feedAgeSeconds: feedAgeSeconds as number | null,
    returnedStaleCount,
    returnedExpiredCount,
    missingExpiryCount,
    invalidExpiryCount
  };
}

function qualityStatus(value: unknown): "degraded" | "ok" | undefined {
  return value === "ok" || value === "degraded" ? value : undefined;
}

function optionalTimestamp(value: unknown): string | undefined {
  const timestamp = optionalString(value);
  if (!timestamp || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)
    || !Number.isFinite(Date.parse(timestamp))) return undefined;
  const calendarDay = new Date(`${timestamp.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(calendarDay.getTime()) && calendarDay.toISOString().slice(0, 10) === timestamp.slice(0, 10) ? timestamp : undefined;
}

function knownWarningArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() !== "");
}

function normalizeCoordinate(value: unknown): SimSearchCoordinate | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const lat = Number(value.lat ?? value.latitude);
  const lon = Number(value.lon ?? value.lng ?? value.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return undefined;
  }
  return { lat, lon };
}

function localizedString(value: unknown, locale: string, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const entry = value[locale];
  const record = isRecord(entry) ? entry : value;
  return optionalString(record[key]);
}

function warningStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
  return items.length > 0 ? items : undefined;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLocaleLowerCase("en-US"));
}

function readInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function optionalRatio(value: unknown): number | undefined {
  const parsed = optionalNumber(value);
  return parsed === undefined ? undefined : Math.min(1, Math.max(0, parsed));
}

function optionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function recordOrString(value: unknown): Record<string, unknown> | string | undefined {
  return isRecord(value) ? value : optionalString(value);
}

function recordOrStringArray(value: unknown): Record<string, unknown> | string[] | undefined {
  if (isRecord(value)) {
    return value;
  }
  return stringArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}
