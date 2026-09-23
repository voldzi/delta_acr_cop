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
  profileId?: RoutingProfileId;
  to: RoutingPoint;
  vehicle?: { heightM?: number; widthM?: number; lengthM?: number; weightTonnes?: number };
}

export interface RoutingProfilesResponse {
  contractVersion?: string;
  generatedAt?: string;
  profiles: Array<Record<string, unknown>>;
  warnings: string[];
}

export interface RoutingRouteResponse {
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
}

export interface RoutingStep extends Record<string, unknown> {
  lanes?: Array<{ directions: number; active?: number; valid?: number }>;
  index?: number;
  maneuverType?: number;
  roundaboutExitCount?: number;
  beginShapeIndex?: number;
  endShapeIndex?: number;
  instructionLocalized?: Record<string, string>;
  distanceM?: number;
  durationSeconds?: number;
}

export interface RoutingRoute extends Record<string, unknown> {
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
    return normalizeRoutingRouteResponse(
      await postRoutingJson(
        this.config,
        "alternatives",
        normalizeRoutingRouteRequest({
          ...request,
          alternatives: request.alternatives ?? 1
        }),
        requestNow
      )
    );
  }

  async alternatives(request: RoutingRouteRequest, requestNow: Date): Promise<RoutingRouteResponse> {
    return normalizeRoutingRouteResponse(
      await postRoutingJson(this.config, "alternatives", normalizeRoutingRouteRequest(request), requestNow)
    );
  }

  async isochrone(request: Record<string, unknown>, requestNow: Date): Promise<Record<string, unknown>> {
    return normalizeRoutingGenericResponse(await postRoutingJson(this.config, "isochrone", request, requestNow));
  }

  async nearestAccess(request: Record<string, unknown>, requestNow: Date): Promise<Record<string, unknown>> {
    return normalizeRoutingGenericResponse(await postRoutingJson(this.config, "nearest-access", request, requestNow));
  }
}

function normalizeRoutingRouteRequest(request: RoutingRouteRequest): RoutingRouteRequest {
  const from = normalizeRoutingPoint(request.from, "from");
  const to = normalizeRoutingPoint(request.to, "to");
  const alternatives = normalizeAlternatives(request.alternatives);
  return {
    ...(alternatives !== undefined ? { alternatives } : {}),
    ...(Array.isArray(request.avoid)
      ? { avoid: request.avoid.flatMap((item) => optionalString(item) ?? []).slice(0, 20) }
      : {}),
    from,
    ...(typeof request.includeRoadAttributes === "boolean"
      ? { includeRoadAttributes: request.includeRoadAttributes }
      : {}),
    ...(typeof request.includeSteps === "boolean" ? { includeSteps: request.includeSteps } : {}),
    profileId: optionalString(request.profileId) ?? "emergency_vehicle",
    to,
    ...(request.vehicle ? { vehicle: normalizeRoutingVehicle(request.vehicle) } : {})
  };
}

function normalizeRoutingVehicle(value: RoutingRouteRequest["vehicle"]): NonNullable<RoutingRouteRequest["vehicle"]> {
  if (!isRecord(value)) throw new Error("Routing vehicle must be an object.");
  const limits = { heightM: 8, widthM: 5, lengthM: 30, weightTonnes: 100 } as const;
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
  const lat = finiteCoordinate(point.lat, -90, 90);
  const lon = finiteCoordinate(point.lon, -180, 180);
  if (lat === undefined || lon === undefined) {
    throw new Error(`Routing ${label} point requires finite lat/lon.`);
  }
  const pointLabel = optionalString(point.label);
  return {
    ...(pointLabel ? { label: pointLabel } : {}),
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
    warnings: normalizeWarnings(value.warnings)
  };
}

function normalizeRoutingRouteResponse(value: unknown): RoutingRouteResponse {
  if (!isRecord(value)) {
    throw new Error("Routing route response is not an object.");
  }
  const receivedRoutes = Array.isArray(value.routes) ? (value.routes.filter(isRecord) as RoutingRoute[]) : [];
  const routes = receivedRoutes.filter((route) => !isDirectFallbackRoute(route));
  const omittedIds = new Set(
    receivedRoutes.filter(isDirectFallbackRoute).flatMap((route) => optionalString(route.routeId) ?? [])
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
    routes,
    traffic: isRecord(value.traffic) ? (value.traffic as RoutingTraffic) : undefined,
    warnings: normalizeWarnings(value.warnings)
  };
}

function isDirectFallbackRoute(route: RoutingRoute): boolean {
  return isRecord(route.quality) && route.quality.mode === "direct_fallback";
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

class RoutingHttpError extends Error {
  readonly status: number;

  constructor(status: number, statusText: string, url: URL, detail?: string) {
    const suffix = detail ? `: ${detail}` : "";
    super(`SIM routing upstream returned ${status} ${statusText || "request failed"} for ${url.pathname}${suffix}`);
    this.name = "RoutingHttpError";
    this.status = status;
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
      throw new RoutingHttpError(response.status, response.statusText, url, await readRoutingErrorDetail(response));
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
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : undefined;
}

function normalizeAlternatives(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(5, Math.max(0, Math.round(parsed))) : undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
