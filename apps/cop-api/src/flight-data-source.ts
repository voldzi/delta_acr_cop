import { createHash } from "node:crypto";
import {
  createPublicFlightAggregateSourceSystem,
  type CanonicalEventEnvelope,
  type Domain,
  type ObjectType,
  type SourceSystem
} from "@cop/canonical-model";
import type { SourceHealthOverride } from "./types.js";

export interface FlightDataSourceConfig {
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
  poll(pollNow: Date): Promise<FlightDataPollResult>;
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
  baseUrl: "https://sim.zeleznalady.cz/flight-data",
  enabled: false,
  includeStale: true,
  limit: 500,
  pollMs: 15000,
  timeoutMs: 6000
};

export function createFlightDataSourceConfigFromEnv(env: Record<string, string | undefined> = process.env): FlightDataSourceConfig {
  return {
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

  constructor(readonly config: FlightDataSourceConfig) {
    this.sourceSystem = createPublicFlightAggregateSourceSystem();
  }

  async poll(pollNow: Date): Promise<FlightDataPollResult> {
    const response = await fetchFlightData(this.config, pollNow);
    return {
      events: response.tracks.flatMap((track, index) => mapFlightTrackToEvent(track, response, pollNow, index)),
      health: buildFlightDataHealth(response, pollNow),
      response
    };
  }
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
