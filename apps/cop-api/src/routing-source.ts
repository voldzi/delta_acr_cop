import { verifyKnownClosuresResponse, type KnownClosures } from "./routing-known-closures.js";
import { validateRoadTripRequest, verifyRoadTripResponse, verifiedCapabilities, type RoadTripCapabilities, validRoundabout, type RoadTrip, type RoadTripAssessment, type RoadTripRoundabout } from "./routing-trip.js";
import { createSituationDataSourceConfigFromEnv } from "./situation-data-source.js";

export type RoutingProfileId =
  "car" | "emergency_vehicle" | "evacuation_walking" | "large_emergency_vehicle" | "offroad_4x4" | "walking" | string;

export interface RoutingSourceConfig {
  baseUrl: string;
  enabled: boolean;
  timeoutMs: number;
}

export interface RoutingPoint {
  label?: string;
  lat: number;
  lon: number;
}

export interface RoutingRouteRequest {
  alternatives?: number;
  avoid?: string[];
  from: RoutingPoint;
  includeRoadAttributes?: boolean;
  includeSteps?: boolean;
  includeElevationProfile?: boolean;
  includeWeatherOnRoute?: boolean;
  includeHazardsOnRoute?: boolean;
  includeTraffic?: boolean;
  profileId?: RoutingProfileId;
  to: RoutingPoint;
  via?: RoutingPoint[];
  departureTime?: string;
  trip?: RoadTrip;
  vehicle?: { heightM?: number; widthM?: number; lengthM?: number; weightTonnes?: number };
}

export interface RoutingProfilesResponse {
  capabilities?: RoadTripCapabilities;
  contractVersion?: string;
  generatedAt?: string;
  profiles: Array<Record<string, unknown>>;
  warnings: string[];
}

export interface RoutingRouteResponse {
  query?: Record<string, unknown>;
  contractVersion?: string;
  coverage?: RoutingCoverage;
  features: Array<Record<string, unknown>>;
  generatedAt?: string;
  providerId?: string;
  quality?: Record<string, unknown>;
  routes: RoutingRoute[];
  traffic?: RoutingTraffic;
  warnings: string[];
}

export interface RoutingCoverage {
  state: "covered" | "partial" | "outside_coverage" | "unknown";
  reason?: string;
  routingDataset?: { version: string; builtAt: string };
  sourceAgeSeconds?: number;
}

export interface RoutingRoadAttributes {
  state: "ok" | "partial" | "unavailable" | "unsupported";
  reason?: string;
  source: "valhalla_trace_attributes";
  routingDataset?: { version: string; builtAt: string };
  sourceAgeSeconds?: number;
  observedAt: string;
  matchedEdgeCount: number;
  geometryMismatchCount: number;
  knownSpeedLimitCoveragePercent: number;
  vehicleRestrictionsState: "not_evaluated";
  speedLimits: Array<{
    beginShapeIndex: number;
    endShapeIndex: number;
    direction: "along_route";
    valueKph?: number;
    status: "explicit" | "derived" | "unknown";
    source: "valhalla_graph_osm_maxspeed" | "unknown";
  }>;
  restrictions: Array<{
    kind: "closure";
    beginShapeIndex: number;
    endShapeIndex: number;
    assessment: "advisory";
    source: "valhalla_trace_attributes";
  }>;
  tunnels?: RoutingTunnelAttributes;
}

export interface RoutingTunnelAttributes {
  state: "known" | "unknown";
  reason?: string;
  routeId: string;
  source: "valhalla_trace_attributes.edge.tunnel";
  routingDataset?: { version: string; builtAt: string };
  observedAt: string;
  intervals: Array<{
    beginShapeIndex: number;
    endShapeIndex: number;
    direction: "along_route";
  }>;
}

export interface RoutingStep extends Record<string, unknown> {
  lanes?: Array<{ directions: number; active?: number; valid?: number }>;
  index?: number;
  maneuverType?: number;
  roundaboutExitCount?: number;
  roundabout?: RoadTripRoundabout;
  beginShapeIndex?: number;
  endShapeIndex?: number;
  instructionLocalized?: Record<string, string>;
  distanceM?: number;
  durationSeconds?: number;
}

export interface RoutingRoute extends Record<string, unknown> {
  assessment?: RoadTripAssessment;
  knownClosures?: KnownClosures;
  steps?: RoutingStep[];
  distanceM?: number;
  durationSeconds?: number;
  elevation?: Record<string, unknown>;
  elevationGainM?: number;
  elevationProfile?: Array<Record<string, unknown>>;
  hazardsOnRoute?: Array<Record<string, unknown>> | Record<string, unknown>;
  quality?: Record<string, unknown>;
  roadAttributes?: RoutingRoadAttributes;
  vehicleAssessment?: {
    state: "not_evaluated" | "partially_evaluated" | "provider_costing_applied";
    providerCosting: "auto" | "truck";
    appliedFields: Array<"heightM" | "widthM" | "lengthM" | "weightTonnes">;
    limitations: string[];
  };
  rank?: number;
  routeId?: string;
  sourceStatus?: string;
  traffic?: RoutingTraffic;
  warnings?: string[];
  weatherOnRoute?: Record<string, unknown>;
}

export interface RoutingLiveSpeeds extends Record<string, unknown> {
  ageSeconds?: number;
  appliedEdgeCount?: number;
  appliedFlowCount?: number;
  detail?: string;
  enabled?: boolean;
  mappingCoveragePercent?: number;
  routingDataset?: string;
  sourceObservedAt?: string;
  state?: "ok" | "degraded" | "idle" | "stale" | "failed" | string;
  updatedAt?: string;
}

export interface RoutingTraffic extends Record<string, unknown> {
  liveSpeeds?: RoutingLiveSpeeds;
}

export interface RoutingSource {
  readonly config: RoutingSourceConfig;
  fetchProfiles(requestNow: Date): Promise<RoutingProfilesResponse>;
  route(request: RoutingRouteRequest, requestNow: Date): Promise<RoutingRouteResponse>;
  alternatives(request: RoutingRouteRequest, requestNow: Date): Promise<RoutingRouteResponse>;
  isochrone(request: Record<string, unknown>, requestNow: Date): Promise<Record<string, unknown>>;
  nearestAccess(request: Record<string, unknown>, requestNow: Date): Promise<Record<string, unknown>>;
}

const defaultConfig: RoutingSourceConfig = {
  baseUrl: "http://docker.home.cz:5020/situation-data/api/v1",
  enabled: true,
  timeoutMs: 12000
};

export function createRoutingSourceConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): RoutingSourceConfig {
  const situationConfig = createSituationDataSourceConfigFromEnv(env);
  return {
    baseUrl: trimTrailingSlash(env.COP_ROUTING_BASE_URL ?? situationConfig.baseUrl ?? defaultConfig.baseUrl),
    enabled: readBoolean(env.COP_ROUTING_ENABLED, readBoolean(env.COP_SITUATION_DATA_ENABLED, defaultConfig.enabled)),
    timeoutMs: readInteger(
      env.COP_ROUTING_TIMEOUT_MS,
      env.COP_SITUATION_DATA_TIMEOUT_MS !== undefined ? situationConfig.timeoutMs : defaultConfig.timeoutMs,
      1000,
      60000
    )
  };
}

export function createRoutingSourceFromEnv(
  env: Record<string, string | undefined> = process.env
): RoutingSource | undefined {
  const config = createRoutingSourceConfigFromEnv(env);
  return config.enabled ? new RoutingSourceAdapter(config) : undefined;
}

export class RoutingSourceAdapter implements RoutingSource {
  constructor(readonly config: RoutingSourceConfig) {}

  async fetchProfiles(requestNow: Date): Promise<RoutingProfilesResponse> {
    return normalizeRoutingProfilesResponse(
      await fetchJson(routingUrl(this.config, "profiles"), this.config, requestNow)
    );
  }

  async route(request: RoutingRouteRequest, requestNow: Date): Promise<RoutingRouteResponse> {
    const normalized = normalizeRoutingRouteRequest({ ...request, alternatives: request.alternatives ?? 1 });
    const started = performance.now();
    const response = await postRoutingJson(this.config, "alternatives", normalized, requestNow);
    const receivedAt = new Date(requestNow.getTime() + Math.max(0, performance.now() - started));
    return normalizeRoutingRouteResponse(response, normalized, receivedAt);
  }

  async alternatives(request: RoutingRouteRequest, requestNow: Date): Promise<RoutingRouteResponse> {
    const normalized = normalizeRoutingRouteRequest(request);
    const started = performance.now();
    const response = await postRoutingJson(this.config, "alternatives", normalized, requestNow);
    const receivedAt = new Date(requestNow.getTime() + Math.max(0, performance.now() - started));
    return normalizeRoutingRouteResponse(response, normalized, receivedAt);
  }

  async isochrone(request: Record<string, unknown>, requestNow: Date): Promise<Record<string, unknown>> {
    return normalizeRoutingGenericResponse(await postRoutingJson(this.config, "isochrone", request, requestNow));
  }

  async nearestAccess(request: Record<string, unknown>, requestNow: Date): Promise<Record<string, unknown>> {
    return normalizeRoutingGenericResponse(await postRoutingJson(this.config, "nearest-access", request, requestNow));
  }
}

function normalizeRoutingRouteRequest(request: RoutingRouteRequest): RoutingRouteRequest {
  if (!isRecord(request)) throw new Error("Routing request must be an object.");
  rejectUnknownFields(request, ["alternatives", "avoid", "from", "to", "includeRoadAttributes", "includeSteps", "profileId", "vehicle", "trip", "via", "departureTime", "includeElevationProfile", "includeWeatherOnRoute", "includeHazardsOnRoute", "includeTraffic"], "request");
  for (const field of ["includeRoadAttributes", "includeSteps", "includeElevationProfile", "includeWeatherOnRoute", "includeHazardsOnRoute", "includeTraffic"] as const) {
    if (request[field] !== undefined && typeof request[field] !== "boolean") {
      throw new Error(`Routing ${field} must be a boolean.`);
    }
  }
  if (request.profileId !== undefined && (typeof request.profileId !== "string" ||
    request.profileId.length > 80 || !/^[A-Za-z0-9:_./-]+$/u.test(request.profileId))) {
    throw new Error("Routing profileId is invalid.");
  }
  if (request.avoid !== undefined && (!Array.isArray(request.avoid) || request.avoid.length > 20 ||
    !request.avoid.every((item) => typeof item === "string" && item.length > 0 && item.length <= 80))) {
    throw new Error("Routing avoid must contain at most 20 nonempty restriction names.");
  }
  validateRoadTripRequest(request);
  if (request.via !== undefined && (!Array.isArray(request.via) || request.via.length > 12)) {
    throw new Error("Routing via must be an ordered array of at most 12 points.");
  }
  if (request.departureTime !== undefined && (typeof request.departureTime !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(request.departureTime) || !Number.isFinite(Date.parse(request.departureTime)))) {
    throw new Error("Routing departureTime must be an ISO timestamp with timezone.");
  }
  const from = normalizeRoutingPoint(request.from, "from");
  const to = normalizeRoutingPoint(request.to, "to");
  const alternatives = normalizeAlternatives(request.alternatives);
  return {
    ...(alternatives !== undefined ? { alternatives } : {}),
    ...(Array.isArray(request.avoid)
      ? { avoid: request.avoid.flatMap((item) => optionalString(item) ?? []).slice(0, 20) }
      : {}),
    from,
    ...(request.includeElevationProfile !== undefined ? { includeElevationProfile: request.includeElevationProfile } : {}),
    ...(request.includeWeatherOnRoute !== undefined ? { includeWeatherOnRoute: request.includeWeatherOnRoute } : {}),
    ...(request.includeHazardsOnRoute !== undefined ? { includeHazardsOnRoute: request.includeHazardsOnRoute } : {}),
    ...(request.includeTraffic !== undefined ? { includeTraffic: request.includeTraffic } : {}),
    ...(typeof request.includeRoadAttributes === "boolean"
      ? { includeRoadAttributes: request.includeRoadAttributes }
      : {}),
    ...(typeof request.includeSteps === "boolean" ? { includeSteps: request.includeSteps } : {}),
    profileId: optionalString(request.profileId) ?? "emergency_vehicle",
    to,
    ...(request.via !== undefined ? { via: request.via.map((point, i) => normalizeRoutingPoint(point, `via[${i}]`)) } : {}),
    ...(request.departureTime !== undefined ? { departureTime: request.departureTime } : {}),
    ...(request.trip !== undefined ? { trip: request.trip } : {}),
    ...(request.vehicle ? { vehicle: normalizeRoutingVehicle(request.vehicle) } : {})
  };
}

function normalizeRoutingVehicle(value: RoutingRouteRequest["vehicle"]): NonNullable<RoutingRouteRequest["vehicle"]> {
  if (!isRecord(value)) throw new Error("Routing vehicle must be an object.");
  const limits = { heightM: 8, widthM: 5, lengthM: 30, weightTonnes: 100 } as const;
  rejectUnknownFields(value, Object.keys(limits), "vehicle");
  const result: NonNullable<RoutingRouteRequest["vehicle"]> = {};
  for (const field of Object.keys(limits) as Array<keyof typeof limits>) {
    const raw = value[field];
    if (raw === undefined) continue;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0 || raw > limits[field]) {
      throw new Error(`Routing vehicle ${field} must be a positive number within supported bounds.`);
    }
    result[field] = raw;
  }
  return result;
}

function normalizeRoutingPoint(point: RoutingPoint | undefined, label: string): RoutingPoint {
  if (!isRecord(point)) {
    throw new Error(`Routing ${label} point is missing.`);
  }
  rejectUnknownFields(point, ["lat", "lon", "label"], label);
  if (point.label !== undefined && (typeof point.label !== "string" || point.label.length > 180)) {
    throw new Error(`Routing ${label} label is invalid.`);
  }
  const lat = finiteCoordinate(point.lat, -90, 90);
  const lon = finiteCoordinate(point.lon, -180, 180);
  if (lat === undefined || lon === undefined) {
    throw new Error(`Routing ${label} point requires finite lat/lon.`);
  }
  const pointLabel = point.label;
  return {
    ...(pointLabel !== undefined ? { label: pointLabel } : {}),
    lat,
    lon
  };
}

function normalizeRoutingProfilesResponse(value: unknown): RoutingProfilesResponse {
  if (!isRecord(value)) {
    throw new Error("Routing profiles response is not an object.");
  }
  const rawProfiles = Array.isArray(value.profiles) ? value.profiles : Array.isArray(value.items) ? value.items : [];
  return {
    contractVersion: optionalString(value.contractVersion),
    generatedAt: optionalString(value.generatedAt),
    profiles: rawProfiles.filter(isRecord),
    ...(value.capabilities !== undefined ? { capabilities: verifiedCapabilities(value.capabilities) } : {}),
    warnings: normalizeWarnings(value.warnings)
  };
}

function normalizeRoutingRouteResponse(value: unknown, request?: RoutingRouteRequest, now = new Date()): RoutingRouteResponse {
  if (!isRecord(value)) {
    throw new Error("Routing route response is not an object.");
  }
  const hasKnownClosures = verifyKnownClosuresResponse(value, request, now);
  const receivedRoutes = Array.isArray(value.routes) ? (value.routes.filter(isRecord) as RoutingRoute[]) : [];
  if (request?.trip) verifyRoadTripResponse({ ...value, routes: receivedRoutes } as unknown as RoutingRouteResponse, request, now);
  const routes = receivedRoutes.filter((route) => !isNonNavigableRoute(route));
  const omittedIds = new Set(
    receivedRoutes.filter(isNonNavigableRoute).flatMap((route) => optionalString(route.routeId) ?? [])
  );
  const features = (Array.isArray(value.features) ? value.features.filter(isRecord) : []).filter((feature) => {
    if (routes.length === 0 && receivedRoutes.length > 0) return false;
    const properties = isRecord(feature.properties) ? feature.properties : undefined;
    return !omittedIds.has(optionalString(properties?.routeId) ?? optionalString(feature.id) ?? "");
  });
  const rawCoverage = isRecord(value.coverage) ? value.coverage : undefined;
  const coverage: RoutingCoverage =
    routes.length === 0 && receivedRoutes.length > 0
      ? { state: "outside_coverage", reason: "SIM did not return a navigable graph route." }
      : {
          state:
            routes.length < receivedRoutes.length
              ? "partial"
              : rawCoverage?.state === "covered" ||
                  rawCoverage?.state === "partial" ||
                  rawCoverage?.state === "outside_coverage"
                ? rawCoverage.state
                : routes.length > 0
                  ? "covered"
                  : "unknown",
          ...(optionalString(rawCoverage?.reason) ? { reason: optionalString(rawCoverage?.reason) } : {}),
          ...(isRecord(rawCoverage?.routingDataset) &&
          optionalString(rawCoverage.routingDataset.version) &&
          optionalString(rawCoverage.routingDataset.builtAt)
            ? {
                routingDataset: {
                  version: String(rawCoverage.routingDataset.version),
                  builtAt: String(rawCoverage.routingDataset.builtAt)
                }
              }
            : {}),
          ...(typeof rawCoverage?.sourceAgeSeconds === "number" &&
          Number.isFinite(rawCoverage.sourceAgeSeconds) &&
          rawCoverage.sourceAgeSeconds >= 0
            ? { sourceAgeSeconds: rawCoverage.sourceAgeSeconds }
            : {})
        };
  return {
    contractVersion: optionalString(value.contractVersion),
    ...(hasKnownClosures ? { query: value.query as Record<string, unknown> } : {}),
    coverage,
    features,
    generatedAt: optionalString(value.generatedAt),
    providerId: optionalString(value.providerId),
    quality:
      receivedRoutes.length !== routes.length && isRecord(routes[0]?.quality)
        ? routes[0].quality
        : isRecord(value.quality)
          ? value.quality
          : undefined,
    routes: routes.map((route) => verifyRouteTunnelAttributes({ ...route,
      ...(route.steps ? { steps: route.steps.map((step) => {
        if (!step.roundabout || validRoundabout(step.roundabout, step.maneuverType)) return step;
        const copy = { ...step }; delete copy.roundabout; return copy;
      }) } : {})
    }, coverage.routingDataset)),
    traffic: isRecord(value.traffic) ? (value.traffic as RoutingTraffic) : undefined,
    warnings: normalizeWarnings(value.warnings)
  };
}

function verifyRouteTunnelAttributes(route: RoutingRoute, coverageDataset?: RoutingCoverage["routingDataset"]): RoutingRoute {
  const attributes = route.roadAttributes;
  if (!attributes || !isRecord(attributes)) return route;
  const tunnels = isRecord(attributes.tunnels) ? attributes.tunnels : undefined;
  if (!tunnels) return route;
  const routeId = optionalString(route.routeId);
  const geometry = isRecord(route.geometry) ? route.geometry : undefined;
  const coordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : undefined;
  const validGeometry = geometry?.type === "LineString" && coordinates && coordinates.length >= 2 && coordinates.every(
    (point) => Array.isArray(point) && point.length === 2 &&
      typeof point[0] === "number" && Number.isFinite(point[0]) && Math.abs(point[0]) <= 180 &&
      typeof point[1] === "number" && Number.isFinite(point[1]) && Math.abs(point[1]) <= 90
  );
  const attributeDataset = isRecord(attributes?.routingDataset) ? attributes.routingDataset : undefined;
  const tunnelDataset = isRecord(tunnels.routingDataset) ? tunnels.routingDataset : undefined;
  const intervals = Array.isArray(tunnels.intervals) ? tunnels.intervals : undefined;
  let previousEnd = 0;
  const validIntervals = intervals?.every((interval) => {
    if (!isRecord(interval)) return false;
    const begin = interval.beginShapeIndex;
    const end = interval.endShapeIndex;
    const valid = Number.isInteger(begin) && Number.isInteger(end) &&
      typeof begin === "number" && typeof end === "number" &&
      begin >= previousEnd && end > begin && end < (coordinates?.length ?? 0) &&
      interval.direction === "along_route";
    if (valid) previousEnd = end as number;
    return valid;
  }) ?? false;
  const validKnown = tunnels.state === "known" && routeId && tunnels.routeId === routeId &&
    tunnels.source === "valhalla_trace_attributes.edge.tunnel" &&
    attributes.state === "ok" && attributes.geometryMismatchCount === 0 && attributes.matchedEdgeCount > 0 &&
    coverageDataset && attributeDataset && tunnelDataset &&
    attributeDataset.version === coverageDataset.version && attributeDataset.builtAt === coverageDataset.builtAt &&
    tunnelDataset.version === coverageDataset.version && tunnelDataset.builtAt === coverageDataset.builtAt &&
    validGeometry && validIntervals;
  if (validKnown) return route;
  const observedAt = optionalString(tunnels.observedAt) ?? optionalString(attributes?.observedAt);
  if (!routeId || !observedAt) return { ...route, roadAttributes: { ...attributes, tunnels: undefined } };
  return {
    ...route,
    roadAttributes: {
      ...attributes,
      tunnels: {
        state: "unknown",
        reason: "COP could not verify tunnel intervals against this route and routing dataset.",
        routeId,
        source: "valhalla_trace_attributes.edge.tunnel",
        ...(coverageDataset ? { routingDataset: coverageDataset } : {}),
        observedAt,
        intervals: []
      }
    }
  };
}

function isNonNavigableRoute(route: RoutingRoute): boolean {
  return route.status === "unavailable" || (isRecord(route.quality) && route.quality.mode === "direct_fallback");
}

function normalizeRoutingGenericResponse(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Routing response is not an object.");
  }
  return value;
}

async function postRoutingJson(
  config: RoutingSourceConfig,
  path: string,
  body: unknown,
  requestNow: Date
): Promise<unknown> {
  return fetchJson(routingUrl(config, path), config, requestNow, {
    body: JSON.stringify(body),
    method: "POST"
  });
}

type FetchJsonInit = RequestInit & { timeoutMs?: number };

export class RoutingHttpError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryAfter?: string;

  constructor(status: number, statusText: string, url: URL, detail?: string, code?: string, retryAfter?: string) {
    const suffix = detail ? `: ${detail}` : "";
    super(`SIM routing upstream returned ${status} ${statusText || "request failed"} for ${url.pathname}${suffix}`);
    this.name = "RoutingHttpError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

async function fetchJson(
  url: URL,
  config: RoutingSourceConfig,
  requestNow: Date,
  init: FetchJsonInit = {}
): Promise<unknown> {
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
      const body = await response.clone().json().catch(() => undefined) as unknown;
      const error = isRecord(body) && isRecord(body.error) ? body.error : body;
      const rawCode = isRecord(error) ? optionalString(error.code) : undefined;
      const code = rawCode && /^ROUTING_[A-Z_]{1,80}$/u.test(rawCode) ? rawCode : undefined;
      const retryAfter = response.headers.get("retry-after") ?? undefined;
      throw new RoutingHttpError(response.status, response.statusText, url, await readRoutingErrorDetail(response), code,
        retryAfter && /^\d{1,6}$/u.test(retryAfter) ? retryAfter : undefined);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function readRoutingErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.clone().text();
    if (!text.trim()) {
      return undefined;
    }
    if (contentType.toLowerCase().includes("application/json")) {
      const body = JSON.parse(text) as unknown;
      if (isRecord(body)) {
        const message =
          optionalString(body.message) ??
          (isRecord(body.error)
            ? (optionalString(body.error.message) ?? optionalString(body.error.code))
            : undefined) ??
          optionalString(body.detail);
        if (message) {
          return message.slice(0, 500);
        }
      }
    }
    return text.replace(/\s+/gu, " ").trim().slice(0, 500);
  } catch {
    return undefined;
  }
}

function routingUrl(config: RoutingSourceConfig, path: string): URL {
  return new URL(`routing/${path.replace(/^\/+/u, "")}`, `${trimTrailingSlash(config.baseUrl)}/`);
}

function normalizeWarnings(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item) => optionalString(item) ?? []) : [];
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
  return Math.round(Math.min(max, Math.max(min, parsed)));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function finiteCoordinate(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
}

function normalizeAlternatives(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 5) {
    throw new Error("Routing alternatives must be an integer from 0 to 5.");
  }
  return value;
}

function rejectUnknownFields(value: Record<string, unknown>, fields: readonly string[], name: string): void {
  if (Object.keys(value).some((field) => !fields.includes(field))) {
    throw new Error(`Routing ${name} contains unsupported fields.`);
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
