import { createHash } from "node:crypto";
import {
  createPublicFlightAggregateSourceSystem,
  type CanonicalEventEnvelope,
  type Domain,
  type ObjectType,
  type SourceSystem
} from "@cop/canonical-model";
import { normalizeProviderMapCatalog, type ProviderMapCatalog } from "./provider-map-catalog.js";
import type { SourceHealthOverride } from "./types.js";

export interface FlightDataSourceConfig {
  airportCacheTtlMs: number;
  baseUrl: string;
  bbox?: string;
  enabled: boolean;
  includeStale: boolean;
  limit: number;
  pollMs: number;
  source?: string;
  timeoutMs: number;
}

export interface FlightDataPollResult {
  events: CanonicalEventEnvelope[];
  health: SourceHealthOverride;
  response: FlightDataResponse;
}

export interface FlightDataSource {
  readonly config: FlightDataSourceConfig;
  readonly sourceSystem: SourceSystem;
  fetchCatalog?(requestNow: Date): Promise<ProviderMapCatalog>;
  fetchAirports?(query: FlightAirportQuery, requestNow: Date): Promise<FlightAirportCollection>;
  fetchReferenceFeatures?(query: FlightReferenceFeatureQuery, requestNow: Date): Promise<FlightReferenceFeatureCollection>;
  poll(pollNow: Date): Promise<FlightDataPollResult>;
}

export interface FlightAirportQuery {
  bbox?: string;
  limit: number;
  query?: string;
}

export interface FlightAirportCollection {
  items: FlightAirportReference[];
  source: {
    label?: string;
    license?: string;
    loadedAt?: string;
    warnings: string[];
  };
  summary: {
    totalReferenceAirports?: number;
  };
}

export interface FlightAirportReference {
  countryCode?: string;
  dataSource?: string;
  elevationFt?: number;
  iata?: string;
  ident: string;
  lat: number;
  lon: number;
  municipality?: string;
  name: string;
  type: string;
}

export type FlightReferenceLayerId = "flight.airports" | "flight.airspaces";

export interface FlightReferenceFeatureQuery {
  bbox: {
    east: number;
    north: number;
    south: number;
    west: number;
  };
  layers: FlightReferenceLayerId[];
  limit: number;
}

export interface FlightReferenceFeatureCollection {
  contractVersion: "cop-flight-reference-v1";
  features: FlightReferenceFeature[];
  generatedAt: string;
  query: FlightReferenceFeatureQuery;
  source: {
    generatedAt?: string;
    sourceId: "flight-data-api";
    sourceType: "PUBLIC_FLIGHT_REFERENCE";
  };
  sources: FlightReferenceSourceDescriptor[];
  summary: {
    featureCount: number;
    sourceCount: number;
    staleFeatureCount: number;
    warningCount: number;
  };
  type: "FeatureCollection";
  warnings: string[];
}

export interface FlightReferenceSourceDescriptor {
  enabled?: boolean;
  label?: string;
  layers?: FlightReferenceLayerId[];
  license?: Record<string, unknown>;
  mode?: string;
  sourceId: string;
  updateCadenceSeconds?: number;
}

export interface FlightReferenceFeature {
  geometry: FlightReferenceGeometry;
  id?: string | number;
  properties: FlightReferenceFeatureProperties;
  type: "Feature";
}

export type FlightReferenceGeometry =
  | { coordinates: [number, number]; type: "Point" }
  | { coordinates: Array<[number, number]>; type: "LineString" }
  | { coordinates: Array<Array<[number, number]>>; type: "Polygon" };

export interface FlightReferenceFeatureProperties {
  category: string;
  confidence?: number;
  description?: string;
  featureId: string;
  label: string;
  layer: "flight_airports" | "flight_airspaces";
  observedAt?: string;
  providerId: "sim.flight-data";
  providerLayerId: FlightReferenceLayerId;
  severity?: string;
  sourceId: string;
  stale?: boolean;
  status?: string;
  summary?: string;
  tags?: Record<string, unknown>;
}

interface FlightDataResponse {
  contractVersion: "cop-flight-source-v1";
  source: {
    generatedAt: string;
    sourceId: string;
    sourceType: "PUBLIC_FLIGHT_AGGREGATE";
  };
  sources: FlightDataSourceDescriptor[];
  summary: FlightTrackSummary;
  tracks: FlightTrack[];
  warnings: string[];
}

interface FlightDataSourceDescriptor {
  enabled: boolean;
  label?: string;
  license?: {
    attribution?: string;
    commercialUse?: string;
    name?: string;
    notes?: string[];
    operationalUse?: string;
  };
  mode?: string;
  priority?: number;
  sourceId: string;
}

interface FlightTrackSummary {
  deduplicatedTrackCount?: number;
  droppedWithoutPositionCount?: number;
  rawObservationCount?: number;
  staleTrackCount?: number;
}

interface FlightTrack {
  aircraft?: Record<string, unknown>;
  altitudeM?: number | null;
  callsign?: string | null;
  deduplication?: {
    key?: string;
    mergedRecordCount?: number;
    primarySourceId?: string;
  };
  domain: string;
  headingDeg?: number | null;
  icao24?: string | null;
  lastSeenAt: string;
  lat: number;
  lon: number;
  metadata?: Record<string, unknown>;
  objectType: string;
  originCountry?: string | null;
  quality?: {
    confidence?: number;
    positionAgeSeconds?: number;
    stale?: boolean;
  };
  registration?: string | null;
  sources: Array<{
    fetchedAt?: string;
    seenAt?: string;
    sourceId?: string;
    sourceRecordId?: string;
  }>;
  speedMps?: number | null;
  trackId: string;
  verticalRateMps?: number | null;
}

const defaultConfig: FlightDataSourceConfig = {
  airportCacheTtlMs: 60 * 60 * 1000,
  baseUrl: "https://sim.zeleznalady.cz/flight-data",
  enabled: false,
  includeStale: true,
  limit: 500,
  pollMs: 15000,
  timeoutMs: 6000
};

export function createFlightDataSourceConfigFromEnv(env: Record<string, string | undefined> = process.env): FlightDataSourceConfig {
  return {
    airportCacheTtlMs: readInteger(env.COP_FLIGHT_DATA_AIRPORT_CACHE_TTL_MS, defaultConfig.airportCacheTtlMs, 60_000, 24 * 60 * 60 * 1000),
    baseUrl: trimTrailingSlash(env.COP_FLIGHT_DATA_BASE_URL ?? defaultConfig.baseUrl),
    ...(optionalTrimmedString(env.COP_FLIGHT_DATA_BBOX) ? { bbox: optionalTrimmedString(env.COP_FLIGHT_DATA_BBOX) } : {}),
    enabled: readBoolean(env.COP_FLIGHT_DATA_ENABLED, defaultConfig.enabled),
    includeStale: readBoolean(env.COP_FLIGHT_DATA_INCLUDE_STALE, defaultConfig.includeStale),
    limit: readInteger(env.COP_FLIGHT_DATA_LIMIT, defaultConfig.limit, 1, 1000),
    pollMs: readInteger(env.COP_FLIGHT_DATA_POLL_MS, defaultConfig.pollMs, 5000, 300000),
    ...(optionalTrimmedString(env.COP_FLIGHT_DATA_SOURCE) ? { source: optionalTrimmedString(env.COP_FLIGHT_DATA_SOURCE) } : {}),
    timeoutMs: readInteger(env.COP_FLIGHT_DATA_TIMEOUT_MS, defaultConfig.timeoutMs, 1000, 60000)
  };
}

export function createFlightDataSourceFromEnv(env: Record<string, string | undefined> = process.env): FlightDataSource | undefined {
  const config = createFlightDataSourceConfigFromEnv(env);
  return config.enabled ? new FlightDataSourceAdapter(config) : undefined;
}

export class FlightDataSourceAdapter implements FlightDataSource {
  readonly sourceSystem: SourceSystem;
  private readonly airportCache = new Map<string, { expiresAtMs: number; value: FlightAirportCollection }>();
  private readonly airspaceCache = new Map<string, { expiresAtMs: number; value: FlightReferenceFeatureCollection }>();
  private catalogCache: { expiresAtMs: number; value: ProviderMapCatalog } | null = null;
  private catalogInflight: Promise<ProviderMapCatalog> | null = null;

  constructor(readonly config: FlightDataSourceConfig) {
    this.sourceSystem = createPublicFlightAggregateSourceSystem();
  }

  async fetchCatalog(requestNow: Date): Promise<ProviderMapCatalog> {
    if (this.catalogCache && this.catalogCache.expiresAtMs > requestNow.getTime()) {
      return this.catalogCache.value;
    }
    if (this.catalogInflight) {
      return this.catalogInflight;
    }
    this.catalogInflight = fetchFlightCatalog(this.config, requestNow);
    try {
      const value = await this.catalogInflight;
      this.catalogCache = {
        expiresAtMs: requestNow.getTime() + this.config.airportCacheTtlMs,
        value
      };
      return value;
    } finally {
      this.catalogInflight = null;
    }
  }

  async fetchAirports(query: FlightAirportQuery, requestNow: Date): Promise<FlightAirportCollection> {
    const normalizedQuery = normalizeAirportQuery(query);
    const cacheKey = airportCacheKey(normalizedQuery);
    const cached = this.airportCache.get(cacheKey);
    if (cached && cached.expiresAtMs > requestNow.getTime()) {
      return cached.value;
    }
    const value = await fetchFlightAirports(this.config, normalizedQuery, requestNow);
    this.airportCache.set(cacheKey, {
      expiresAtMs: requestNow.getTime() + this.config.airportCacheTtlMs,
      value
    });
    return value;
  }

  async fetchReferenceFeatures(query: FlightReferenceFeatureQuery, requestNow: Date): Promise<FlightReferenceFeatureCollection> {
    const normalizedQuery = normalizeFlightReferenceFeatureQuery(query);
    const collections = await Promise.all(normalizedQuery.layers.map(async (layer) => {
      if (layer === "flight.airports") {
        return flightAirportsToReferenceFeatureCollection(
          await this.fetchAirports({
            bbox: flightBboxToString(normalizedQuery.bbox),
            limit: normalizedQuery.limit
          }, requestNow),
          normalizedQuery,
          requestNow
        );
      }
      return this.fetchAirspaceFeatures(normalizedQuery, requestNow);
    }));
    return mergeFlightReferenceCollections(collections, normalizedQuery, requestNow);
  }

  async poll(pollNow: Date): Promise<FlightDataPollResult> {
    const response = await fetchFlightData(this.config, pollNow);
    return {
      events: response.tracks.flatMap((track, index) => mapFlightTrackToEvent(track, response, pollNow, index)),
      health: buildFlightDataHealth(response, pollNow),
      response
    };
  }

  private async fetchAirspaceFeatures(query: FlightReferenceFeatureQuery, requestNow: Date): Promise<FlightReferenceFeatureCollection> {
    const cacheKey = flightReferenceCacheKey({ ...query, layers: ["flight.airspaces"] });
    const cached = this.airspaceCache.get(cacheKey);
    if (cached && cached.expiresAtMs > requestNow.getTime()) {
      return cached.value;
    }
    const value = await fetchFlightAirspaces(this.config, query, requestNow);
    this.airspaceCache.set(cacheKey, {
      expiresAtMs: requestNow.getTime() + this.config.airportCacheTtlMs,
      value
    });
    return value;
  }
}

async function fetchFlightAirports(config: FlightDataSourceConfig, query: FlightAirportQuery, requestNow: Date): Promise<FlightAirportCollection> {
  const url = new URL(`${trimTrailingSlash(config.baseUrl)}/api/v1/airports`);
  url.searchParams.set("limit", String(query.limit));
  if (query.bbox) {
    url.searchParams.set("bbox", query.bbox);
  }
  if (query.query) {
    url.searchParams.set("query", query.query);
  }

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
      throw new Error(`${response.status} ${response.statusText || "Airport reference request failed"}`);
    }
    return normalizeFlightAirportCollection(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFlightAirspaces(config: FlightDataSourceConfig, query: FlightReferenceFeatureQuery, requestNow: Date): Promise<FlightReferenceFeatureCollection> {
  const url = new URL(`${trimTrailingSlash(config.baseUrl)}/api/v1/airspaces`);
  url.searchParams.set("bbox", flightBboxToString(query.bbox));
  url.searchParams.set("limit", String(query.limit));

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
      throw new Error(`${response.status} ${response.statusText || "Airspace reference request failed"}`);
    }
    return normalizeFlightAirspaceCollection(await response.json(), query, requestNow);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFlightCatalog(config: FlightDataSourceConfig, requestNow: Date): Promise<ProviderMapCatalog> {
  const url = new URL(`${trimTrailingSlash(config.baseUrl)}/api/v1/catalog`);
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
      throw new Error(`${response.status} ${response.statusText || "Flight catalog request failed"}`);
    }
    return normalizeProviderMapCatalog(await response.json(), "sim.flight-data");
  } finally {
    clearTimeout(timeout);
  }
}

export function emptyFlightReferenceFeatureCollection(
  query: FlightReferenceFeatureQuery,
  requestNow: Date,
  warnings: string[] = []
): FlightReferenceFeatureCollection {
  return {
    contractVersion: "cop-flight-reference-v1",
    features: [],
    generatedAt: requestNow.toISOString(),
    query,
    source: {
      generatedAt: requestNow.toISOString(),
      sourceId: "flight-data-api",
      sourceType: "PUBLIC_FLIGHT_REFERENCE"
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

export function unavailableFlightDataHealth(error: unknown, pollNow: Date): SourceHealthOverride {
  return {
    detail: "Flight data source is unavailable.",
    evaluatedAt: pollNow.toISOString(),
    health: "UNAVAILABLE",
    lastError: error instanceof Error ? error.message : "unknown error",
    lastPollAt: pollNow.toISOString(),
    warnings: ["Flight data poll failed."]
  };
}

function buildFlightDataHealth(response: FlightDataResponse, pollNow: Date): SourceHealthOverride {
  const warningCount = response.warnings.length;
  const staleTrackCount = response.summary.staleTrackCount ?? response.tracks.filter((track) => track.quality?.stale === true).length;
  const health: SourceHealthOverride["health"] = warningCount > 0
    ? "DEGRADED"
    : staleTrackCount > 0
      ? "STALE"
      : "ONLINE";
  const deduplicatedTrackCount = response.summary.deduplicatedTrackCount ?? response.tracks.length;
  return {
    detail: `tracks ${deduplicatedTrackCount}, stale ${staleTrackCount}`,
    evaluatedAt: pollNow.toISOString(),
    generatedAt: response.source.generatedAt,
    health,
    lastPollAt: pollNow.toISOString(),
    lastSuccessAt: pollNow.toISOString(),
    summary: compactRecord({
      deduplicatedTrackCount,
      droppedWithoutPositionCount: response.summary.droppedWithoutPositionCount,
      rawObservationCount: response.summary.rawObservationCount,
      staleTrackCount
    }),
    warnings: response.warnings
  };
}

function mapFlightTrackToEvent(
  track: FlightTrack,
  response: FlightDataResponse,
  pollNow: Date,
  sequenceNumber: number
): CanonicalEventEnvelope[] {
  if (!Number.isFinite(track.lat) || !Number.isFinite(track.lon) || !track.trackId || !isValidDate(track.lastSeenAt)) {
    return [];
  }

  const confidence = clampNumber(track.quality?.confidence ?? 0.5, 0, 1);
  const objectType = normalizeObjectType(track.objectType);
  const domain = normalizeDomain(track.domain);
  const eventId = deterministicUuid([
    response.source.sourceId,
    track.trackId,
    track.lastSeenAt,
    track.lat.toFixed(6),
    track.lon.toFixed(6),
    String(track.quality?.stale === true)
  ].join("|"));
  const correlationId = deterministicUuid(`${response.source.sourceId}|${response.source.generatedAt}|${sequenceNumber}`);
  const primarySource = track.deduplication?.primarySourceId ?? track.sources[0]?.sourceId ?? response.source.sourceId;
  const providerDescriptors = response.sources.filter((source) => track.sources.some((trackSource) => trackSource.sourceId === source.sourceId));

  return [
    {
      classification: {
        handlingCaveats: ["PUBLIC_FLIGHT_AGGREGATE"],
        level: "UNCLASSIFIED",
        releasability: ["CZ"]
      },
      contractVersion: "cop-ingest-v1",
      correlationId,
      eventId,
      eventType: "track.updated",
      geo: {
        altitudeM: finiteNumberOrNull(track.altitudeM),
        lat: track.lat,
        lon: track.lon
      },
      ingestTimestamp: pollNow.toISOString(),
      payload: {
        affiliation: "NEUTRAL",
        attributes: {
          dataOrigin: "PUBLIC_FLIGHT_AGGREGATE",
          flightData: {
            aircraft: track.aircraft ?? {},
            callsign: cleanString(track.callsign),
            deduplication: track.deduplication ?? {},
            icao24: cleanString(track.icao24),
            metadata: track.metadata ?? {},
            originCountry: cleanString(track.originCountry),
            providerLicenses: providerDescriptors.map((source) => source.license).filter(Boolean),
            providers: providerDescriptors.map((source) => ({
              enabled: source.enabled,
              label: source.label,
              licenseName: source.license?.name,
              mode: source.mode,
              sourceId: source.sourceId
            })),
            quality: track.quality ?? {},
            registration: cleanString(track.registration),
            sources: track.sources
          }
        },
        confidence,
        domain,
        headingDeg: finiteNumberOrNull(track.headingDeg),
        lastUpdatedAt: track.lastSeenAt,
        movement: {
          headingDeg: finiteNumberOrNull(track.headingDeg),
          speedMps: finiteNumberOrNull(track.speedMps),
          verticalRateMps: finiteNumberOrNull(track.verticalRateMps)
        },
        objectId: track.trackId,
        objectType,
        position: {
          altitudeM: finiteNumberOrNull(track.altitudeM),
          lat: track.lat,
          lon: track.lon
        },
        speedMps: finiteNumberOrNull(track.speedMps),
        status: track.quality?.stale === true ? "STALE" : "ACTIVE",
        synthetic: false,
        verticalRateMps: finiteNumberOrNull(track.verticalRateMps)
      },
      producerTimestamp: track.lastSeenAt,
      quality: {
        confidence,
        informationCredibility: track.quality?.stale === true ? "4" : "3",
        sourceReliability: "C"
      },
      source: {
        adapterId: "flight-data-source-adapter",
        adapterVersion: "0.1.0",
        sourceDeviceId: primarySource,
        sourceSystemId: response.source.sourceId
      }
    }
  ];
}

async function fetchFlightData(config: FlightDataSourceConfig, pollNow: Date): Promise<FlightDataResponse> {
  const url = new URL(`${trimTrailingSlash(config.baseUrl)}/api/v1/cop/tracks`);
  url.searchParams.set("limit", String(config.limit));
  url.searchParams.set("includeStale", String(config.includeStale));
  if (config.source) {
    url.searchParams.set("source", config.source);
  }
  if (config.bbox) {
    url.searchParams.set("bbox", config.bbox);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-COP-Request-At": pollNow.toISOString()
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText || "Flight data request failed"}`);
    }
    return normalizeFlightDataResponse(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeFlightDataResponse(value: unknown): FlightDataResponse {
  if (!isRecord(value) || value.contractVersion !== "cop-flight-source-v1") {
    throw new Error("Flight data response does not match cop-flight-source-v1.");
  }
  if (!isRecord(value.source) || value.source.sourceId !== "flight-data-api" || value.source.sourceType !== "PUBLIC_FLIGHT_AGGREGATE") {
    throw new Error("Flight data source descriptor is not valid.");
  }
  if (typeof value.source.generatedAt !== "string" || !isValidDate(value.source.generatedAt)) {
    throw new Error("Flight data source generatedAt is not valid.");
  }
  if (!isRecord(value.summary) || !Array.isArray(value.tracks) || !Array.isArray(value.sources) || !Array.isArray(value.warnings)) {
    throw new Error("Flight data response is incomplete.");
  }
  return {
    contractVersion: "cop-flight-source-v1",
    source: {
      generatedAt: value.source.generatedAt,
      sourceId: "flight-data-api",
      sourceType: "PUBLIC_FLIGHT_AGGREGATE"
    },
    sources: value.sources.flatMap(normalizeSourceDescriptor),
    summary: normalizeSummary(value.summary),
    tracks: value.tracks.flatMap(normalizeTrack),
    warnings: value.warnings.filter((warning): warning is string => typeof warning === "string")
  };
}

function normalizeFlightAirportCollection(value: unknown): FlightAirportCollection {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("Flight airport response is incomplete.");
  }
  const source = isRecord(value.source) ? value.source : {};
  const summary = isRecord(value.summary) ? value.summary : {};
  return {
    items: value.items.flatMap(normalizeFlightAirport),
    source: {
      label: optionalString(source.label),
      license: optionalString(source.license),
      loadedAt: optionalString(source.loadedAt),
      warnings: Array.isArray(source.warnings) ? source.warnings.filter((warning): warning is string => typeof warning === "string") : []
    },
    summary: {
      totalReferenceAirports: optionalNumber(summary.totalReferenceAirports)
    }
  };
}

function normalizeFlightAirport(value: unknown): FlightAirportReference[] {
  if (!isRecord(value) || typeof value.ident !== "string" || typeof value.name !== "string" || typeof value.type !== "string") {
    return [];
  }
  const lat = optionalFinite(value.lat);
  const lon = optionalFinite(value.lon);
  if (lat === undefined || lon === undefined) {
    return [];
  }
  return [
    {
      countryCode: optionalString(value.countryCode),
      dataSource: optionalString(value.dataSource),
      elevationFt: optionalNumber(value.elevationFt),
      iata: optionalString(value.iata),
      ident: value.ident,
      lat,
      lon,
      municipality: optionalString(value.municipality),
      name: value.name,
      type: value.type
    }
  ];
}

function flightAirportsToReferenceFeatureCollection(
  collection: FlightAirportCollection,
  query: FlightReferenceFeatureQuery,
  requestNow: Date
): FlightReferenceFeatureCollection {
  const generatedAt = isValidDate(collection.source.loadedAt ?? "") ? collection.source.loadedAt! : requestNow.toISOString();
  const source: FlightReferenceSourceDescriptor = {
    enabled: true,
    label: collection.source.label ?? "OurAirports airport reference",
    layers: ["flight.airports"],
    license: collection.source.license ? { name: collection.source.license } : undefined,
    mode: "reference",
    sourceId: "ourairports",
    updateCadenceSeconds: Math.round(defaultConfig.airportCacheTtlMs / 1000)
  };
  const features: FlightReferenceFeature[] = collection.items.map((airport) => ({
    geometry: {
      coordinates: [airport.lon, airport.lat],
      type: "Point" as const
    },
    id: `airport:${airport.ident}`,
    properties: {
      category: airport.type,
      confidence: 0.95,
      featureId: `flight:airport:${airport.ident}`,
      label: airport.iata ?? airport.ident,
      layer: "flight_airports",
      observedAt: generatedAt,
      providerId: "sim.flight-data",
      providerLayerId: "flight.airports",
      sourceId: "ourairports",
      stale: false,
      status: "reference",
      summary: airport.name,
      tags: compactRecord({
        countryCode: airport.countryCode,
        dataSource: airport.dataSource,
        elevationFt: airport.elevationFt,
        iata: airport.iata,
        ident: airport.ident,
        municipality: airport.municipality,
        name: airport.name,
        type: airport.type
      })
    },
    type: "Feature" as const
  }));
  const warnings = [...collection.source.warnings];
  return {
    contractVersion: "cop-flight-reference-v1",
    features,
    generatedAt,
    query: {
      ...query,
      layers: ["flight.airports"]
    },
    source: {
      generatedAt,
      sourceId: "flight-data-api",
      sourceType: "PUBLIC_FLIGHT_REFERENCE"
    },
    sources: [source],
    summary: {
      featureCount: features.length,
      sourceCount: 1,
      staleFeatureCount: 0,
      warningCount: warnings.length
    },
    type: "FeatureCollection",
    warnings
  };
}

function normalizeFlightAirspaceCollection(value: unknown, query: FlightReferenceFeatureQuery, requestNow: Date): FlightReferenceFeatureCollection {
  if (!isRecord(value) || !Array.isArray(value.features)) {
    throw new Error("Flight airspace response is incomplete.");
  }
  const source = isRecord(value.source) ? value.source : {};
  const summary = isRecord(value.summary) ? value.summary : {};
  const generatedAt = optionalString(value.generatedAt) ?? requestNow.toISOString();
  const features = value.features.flatMap(normalizeFlightAirspaceFeature);
  const warnings = [
    ...(Array.isArray(value.warnings) ? value.warnings.filter((warning): warning is string => typeof warning === "string") : []),
    ...(Array.isArray(source.warnings) ? source.warnings.filter((warning): warning is string => typeof warning === "string") : [])
  ];
  return {
    contractVersion: "cop-flight-reference-v1",
    features,
    generatedAt,
    query: {
      ...query,
      layers: ["flight.airspaces"]
    },
    source: {
      generatedAt,
      sourceId: "flight-data-api",
      sourceType: "PUBLIC_FLIGHT_REFERENCE"
    },
    sources: [
      {
        enabled: true,
        label: optionalString(source.label) ?? "Czech AIP/eAIP airspace reference",
        layers: ["flight.airspaces"],
        license: isRecord(source.license) ? source.license : undefined,
        mode: "reference",
        sourceId: optionalString(source.sourceId) ?? "czech_aip_airspaces",
        updateCadenceSeconds: Math.round(defaultConfig.airportCacheTtlMs / 1000)
      }
    ],
    summary: {
      featureCount: features.length,
      sourceCount: 1,
      staleFeatureCount: features.filter((feature) => feature.properties.stale).length,
      warningCount: warnings.length + (summary.notForNavigation === true ? 1 : 0)
    },
    type: "FeatureCollection",
    warnings
  };
}

function normalizeFlightAirspaceFeature(value: unknown): FlightReferenceFeature[] {
  if (!isRecord(value) || value.type !== "Feature") {
    return [];
  }
  const geometry = normalizeFlightReferenceGeometry(value.geometry);
  if (!geometry) {
    return [];
  }
  const properties = isRecord(value.properties) ? value.properties : {};
  const featureId = optionalString(properties.airspaceId)
    ?? optionalString(properties.featureId)
    ?? (typeof value.id === "string" ? value.id : undefined);
  const label = optionalString(properties.label)
    ?? optionalString(properties.designator)
    ?? optionalString(properties.name)
    ?? featureId;
  if (!featureId || !label) {
    return [];
  }
  return [
    {
      geometry,
      ...(typeof value.id === "string" || typeof value.id === "number" ? { id: value.id } : {}),
      properties: {
        category: optionalString(properties.category) ?? "airspace",
        confidence: optionalFinite(properties.confidence),
        description: optionalString(properties.description) ?? optionalString(properties.time),
        featureId,
        label,
        layer: "flight_airspaces",
        observedAt: optionalString(properties.observedAt),
        providerId: "sim.flight-data",
        providerLayerId: "flight.airspaces",
        severity: optionalString(properties.severity),
        sourceId: optionalString(properties.sourceId) ?? "czech_aip_airspaces",
        stale: typeof properties.stale === "boolean" ? properties.stale : false,
        status: optionalString(properties.airspaceType) ?? "reference",
        summary: optionalString(properties.verticalLimitText) ?? optionalString(properties.summary),
        tags: compactRecord({
          airspaceId: optionalString(properties.airspaceId),
          airspaceType: optionalString(properties.airspaceType),
          designator: optionalString(properties.designator),
          lowerLimit: optionalString(properties.lowerLimit),
          name: optionalString(properties.name),
          notForNavigation: typeof properties.notForNavigation === "boolean" ? properties.notForNavigation : undefined,
          providerProperties: isRecord(properties.providerProperties) ? properties.providerProperties : undefined,
          time: optionalString(properties.time),
          upperLimit: optionalString(properties.upperLimit),
          verticalLimitText: optionalString(properties.verticalLimitText)
        })
      },
      type: "Feature"
    }
  ];
}

function normalizeFlightReferenceGeometry(value: unknown): FlightReferenceGeometry | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }
  if (value.type === "Point") {
    const coordinates = normalizePosition(value.coordinates);
    return coordinates ? { coordinates, type: "Point" } : null;
  }
  if (value.type === "LineString") {
    const coordinates = normalizeLineString(value.coordinates);
    return coordinates.length >= 2 ? { coordinates, type: "LineString" } : null;
  }
  if (value.type === "Polygon") {
    const coordinates = normalizePolygon(value.coordinates);
    return coordinates.length > 0 ? { coordinates, type: "Polygon" } : null;
  }
  return null;
}

function normalizePosition(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }
  const lon = optionalFinite(value[0]);
  const lat = optionalFinite(value[1]);
  if (lon === undefined || lat === undefined || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    return null;
  }
  return [lon, lat];
}

function normalizeLineString(value: unknown): Array<[number, number]> {
  return Array.isArray(value)
    ? value.flatMap((position): Array<[number, number]> => {
        const normalized = normalizePosition(position);
        return normalized ? [normalized] : [];
      })
    : [];
}

function normalizePolygon(value: unknown): Array<Array<[number, number]>> {
  return Array.isArray(value)
    ? value
        .map(normalizeLineString)
        .filter((ring) => ring.length >= 4)
    : [];
}

function normalizeFlightReferenceFeatureQuery(query: FlightReferenceFeatureQuery): FlightReferenceFeatureQuery {
  return {
    bbox: {
      east: clampNumber(query.bbox.east, -180, 180),
      north: clampNumber(query.bbox.north, -90, 90),
      south: clampNumber(query.bbox.south, -90, 90),
      west: clampNumber(query.bbox.west, -180, 180)
    },
    layers: uniqueFlightReferenceLayers(query.layers),
    limit: Math.round(clampNumber(query.limit, 1, 500))
  };
}

function uniqueFlightReferenceLayers(layers: FlightReferenceLayerId[]): FlightReferenceLayerId[] {
  return Array.from(new Set(layers.filter(isFlightReferenceLayerId)));
}

function isFlightReferenceLayerId(value: unknown): value is FlightReferenceLayerId {
  return value === "flight.airports" || value === "flight.airspaces";
}

function flightBboxToString(bbox: FlightReferenceFeatureQuery["bbox"]): string {
  return [bbox.west, bbox.south, bbox.east, bbox.north].map((value) => value.toFixed(6)).join(",");
}

function flightReferenceCacheKey(query: FlightReferenceFeatureQuery): string {
  return [flightBboxToString(query.bbox), query.layers.join(","), query.limit].join("|");
}

function mergeFlightReferenceCollections(
  collections: FlightReferenceFeatureCollection[],
  query: FlightReferenceFeatureQuery,
  requestNow: Date
): FlightReferenceFeatureCollection {
  if (collections.length === 0) {
    return emptyFlightReferenceFeatureCollection(query, requestNow);
  }
  const features = collections.flatMap((collection) => collection.features);
  const warnings = collections.flatMap((collection) => collection.warnings);
  const generatedAt = latestIsoTimestamp(collections.map((collection) => collection.generatedAt)) ?? requestNow.toISOString();
  const sourcesById = new Map<string, FlightReferenceSourceDescriptor>();
  collections.flatMap((collection) => collection.sources).forEach((source) => {
    if (!sourcesById.has(source.sourceId)) {
      sourcesById.set(source.sourceId, source);
    }
  });
  return {
    contractVersion: "cop-flight-reference-v1",
    features,
    generatedAt,
    query,
    source: {
      generatedAt,
      sourceId: "flight-data-api",
      sourceType: "PUBLIC_FLIGHT_REFERENCE"
    },
    sources: Array.from(sourcesById.values()),
    summary: {
      featureCount: features.length,
      sourceCount: sourcesById.size,
      staleFeatureCount: features.filter((feature) => feature.properties.stale).length,
      warningCount: warnings.length
    },
    type: "FeatureCollection",
    warnings
  };
}

function latestIsoTimestamp(values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => typeof value === "string" && isValidDate(value))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

function normalizeAirportQuery(query: FlightAirportQuery): FlightAirportQuery {
  return {
    ...(optionalString(query.bbox) ? { bbox: optionalString(query.bbox) } : {}),
    limit: Math.round(clampNumber(query.limit, 1, 500)),
    ...(optionalString(query.query) ? { query: optionalString(query.query) } : {})
  };
}

function airportCacheKey(query: FlightAirportQuery): string {
  return [query.bbox ?? "", query.query ?? "", query.limit].join("|");
}

function normalizeSummary(value: Record<string, unknown>): FlightTrackSummary {
  return compactRecord({
    deduplicatedTrackCount: optionalNumber(value.deduplicatedTrackCount),
    droppedWithoutPositionCount: optionalNumber(value.droppedWithoutPositionCount),
    rawObservationCount: optionalNumber(value.rawObservationCount),
    staleTrackCount: optionalNumber(value.staleTrackCount)
  });
}

function normalizeTrack(value: unknown): FlightTrack[] {
  if (!isRecord(value) || typeof value.trackId !== "string" || typeof value.lastSeenAt !== "string") {
    return [];
  }
  const lat = Number(value.lat);
  const lon = Number(value.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return [];
  }
  return [
    {
      aircraft: isRecord(value.aircraft) ? value.aircraft : undefined,
      altitudeM: optionalNullableNumber(value.altitudeM),
      callsign: optionalString(value.callsign),
      deduplication: isRecord(value.deduplication)
        ? {
            key: optionalString(value.deduplication.key),
            mergedRecordCount: optionalNumber(value.deduplication.mergedRecordCount),
            primarySourceId: optionalString(value.deduplication.primarySourceId)
          }
        : undefined,
      domain: typeof value.domain === "string" ? value.domain : "AIR",
      headingDeg: optionalNullableNumber(value.headingDeg),
      icao24: optionalString(value.icao24),
      lastSeenAt: value.lastSeenAt,
      lat,
      lon,
      metadata: isRecord(value.metadata) ? value.metadata : undefined,
      objectType: typeof value.objectType === "string" ? value.objectType : "UNKNOWN",
      originCountry: optionalString(value.originCountry),
      quality: isRecord(value.quality)
        ? {
            confidence: optionalFinite(value.quality.confidence),
            positionAgeSeconds: optionalNumber(value.quality.positionAgeSeconds),
            stale: typeof value.quality.stale === "boolean" ? value.quality.stale : undefined
          }
        : undefined,
      registration: optionalString(value.registration),
      sources: Array.isArray(value.sources) ? value.sources.flatMap(normalizeTrackSource) : [],
      speedMps: optionalNullableNumber(value.speedMps),
      trackId: value.trackId,
      verticalRateMps: optionalNullableNumber(value.verticalRateMps)
    }
  ];
}

function normalizeTrackSource(value: unknown): FlightTrack["sources"] {
  if (!isRecord(value)) {
    return [];
  }
  return [
    compactRecord({
      fetchedAt: optionalString(value.fetchedAt),
      seenAt: optionalString(value.seenAt),
      sourceId: optionalString(value.sourceId),
      sourceRecordId: optionalString(value.sourceRecordId)
    })
  ];
}

function normalizeSourceDescriptor(value: unknown): FlightDataSourceDescriptor[] {
  if (!isRecord(value) || typeof value.sourceId !== "string") {
    return [];
  }
  return [
    {
      enabled: value.enabled === true,
      label: optionalString(value.label),
      license: isRecord(value.license)
        ? {
            attribution: optionalString(value.license.attribution),
            commercialUse: optionalString(value.license.commercialUse),
            name: optionalString(value.license.name),
            notes: Array.isArray(value.license.notes) ? value.license.notes.filter((note): note is string => typeof note === "string") : undefined,
            operationalUse: optionalString(value.license.operationalUse)
          }
        : undefined,
      mode: optionalString(value.mode),
      priority: optionalNumber(value.priority),
      sourceId: value.sourceId
    }
  ];
}

function normalizeObjectType(value: string): ObjectType {
  return value === "AIRCRAFT" || value === "UAV" || value === "UNKNOWN" ? value : "UNKNOWN";
}

function normalizeDomain(value: string): Domain {
  return value === "AIR" ? "AIR" : "OTHER";
}

function deterministicUuid(seed: string): string {
  const chars = createHash("sha256").update(seed).digest("hex").split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16] ?? "8", 16) & 0x3) | 0x8).toString(16);
  return [
    chars.slice(0, 8).join(""),
    chars.slice(8, 12).join(""),
    chars.slice(12, 16).join(""),
    chars.slice(16, 20).join(""),
    chars.slice(20, 32).join("")
  ].join("-");
}

function compactRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function cleanString(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function optionalTrimmedString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function optionalFinite(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalNullableNumber(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  return optionalFinite(value);
}

function finiteNumberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value === "true" || value === "1" || value.toLowerCase() === "yes";
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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
