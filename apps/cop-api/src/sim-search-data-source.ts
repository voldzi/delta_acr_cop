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
  generatedAt: string;
  providerId: string;
  query?: Record<string, unknown>;
  results: SimSearchEntity[];
  summary: {
    resultCount: number;
    staleResultCount: number;
    warningCount: number;
  };
  warnings: string[];
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
  sourceCaches?: Array<Record<string, unknown>>;
  status: "degraded" | "ok" | string;
  summary?: Record<string, unknown>;
  warnings?: string[];
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

  constructor(readonly config: SimSearchDataSourceConfig) {
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
    }), body);
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
    });
  }

  async fetchEntity(providerEntityId: string, requestNow: Date): Promise<SimSearchEntity | undefined> {
    const value = await fetchJson(new URL(`${trimTrailingSlash(this.config.baseUrl)}/entities/${encodeURIComponent(providerEntityId)}`), this.config, requestNow);
    return normalizeSimSearchEntityResponse(value);
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
  const resultCount = "summary" in response && isRecord(response.summary) && typeof response.summary.resultCount === "number"
    ? response.summary.resultCount
    : undefined;
  const staleResultCount = "summary" in response && isRecord(response.summary) && typeof response.summary.staleResultCount === "number"
    ? response.summary.staleResultCount
    : undefined;
  const status = "status" in response ? response.status : undefined;
  const health: SourceHealthOverride["health"] = status === "degraded" || warnings.length > 0 || (staleResultCount ?? 0) > 0
    ? "DEGRADED"
    : status === "ok" || "results" in response
      ? "ONLINE"
      : "WAITING";
  return {
    detail: `SIM search-data ${health.toLowerCase()}${resultCount !== undefined ? `; ${resultCount} results` : ""}`,
    evaluatedAt: requestNow.toISOString(),
    generatedAt: optionalString(response.generatedAt) ?? requestNow.toISOString(),
    health,
    lastPollAt: requestNow.toISOString(),
    ...(health === "ONLINE" ? { lastSuccessAt: requestNow.toISOString() } : {}),
    summary: {
      ...(resultCount !== undefined ? { resultCount } : {}),
      ...(staleResultCount !== undefined ? { staleResultCount } : {})
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

  constructor(status: number, statusText: string, url: URL) {
    super(`${status} ${statusText || "SIM search-data request failed"} for ${url.pathname}`);
    this.name = "SimSearchDataHttpError";
    this.status = status;
  }
}

async function fetchJson(url: URL, config: SimSearchDataSourceConfig, requestNow: Date, init: FetchJsonInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const { timeoutMs, ...requestInit } = init;
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? config.timeoutMs);
  try {
    const response = await fetch(url, {
      ...requestInit,
      headers: {
        Accept: "application/json",
        ...(requestInit.body ? { "Content-Type": "application/json" } : {}),
        "X-COP-Request-At": requestNow.toISOString(),
        ...(requestInit.headers ?? {})
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new SimSearchDataHttpError(response.status, response.statusText, url);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSimSearchQueryResponse(value: unknown, query: Record<string, unknown>): SimSearchQueryResponse {
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
  const results = rawResults.flatMap(normalizeSimSearchEntity);
  return {
    contractVersion: optionalString(value.contractVersion) ?? "sim-search-source-v1",
    generatedAt: optionalString(value.generatedAt) ?? new Date().toISOString(),
    providerId: optionalString(value.providerId) ?? "sim.search-data",
    query: isRecord(value.query) ? value.query : query,
    results,
    summary: {
      resultCount: optionalNumber(isRecord(value.summary) ? value.summary.resultCount : undefined) ?? results.length,
      staleResultCount: optionalNumber(isRecord(value.summary) ? value.summary.staleResultCount : undefined)
        ?? results.filter((item) => item.stale === true).length,
      warningCount: warningStrings(value.warnings).length
    },
    warnings: warningStrings(value.warnings)
  };
}

function normalizeSimSearchEntitiesResponse(value: unknown, query: Record<string, unknown>): SimSearchEntitiesResponse {
  if (!isRecord(value)) {
    throw new Error("SIM search-data entities response is not an object.");
  }
  const response = normalizeSimSearchQueryResponse(value, query);
  const nextCursor = optionalString(value.nextCursor);
  return {
    ...response,
    ...(nextCursor ? { nextCursor } : {})
  };
}

function normalizeSimSearchEntityResponse(value: unknown): SimSearchEntity | undefined {
  const raw = isRecord(value) && isRecord(value.entity)
    ? value.entity
    : isRecord(value) && isRecord(value.result)
      ? value.result
      : value;
  return normalizeSimSearchEntity(raw)[0];
}

function normalizeSimSearchEntity(value: unknown): SimSearchEntity[] {
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
    stale: typeof value.stale === "boolean" ? value.stale : undefined,
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

function normalizeSimSearchObservability(value: unknown): SimSearchObservability {
  if (!isRecord(value)) {
    throw new Error("SIM search-data observability response is not an object.");
  }
  return {
    generatedAt: optionalString(value.generatedAt),
    sourceCaches: Array.isArray(value.sourceCaches) ? value.sourceCaches.filter(isRecord) : undefined,
    status: optionalString(value.status) ?? "degraded",
    summary: isRecord(value.summary) ? value.summary : undefined,
    warnings: warningStrings(value.warnings)
  };
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
