import { createSituationDataSourceConfigFromEnv } from "./situation-data-source.js";

export type RoutingProfileId =
  | "car"
  | "emergency_vehicle"
  | "evacuation_walking"
  | "large_emergency_vehicle"
  | "offroad_4x4"
  | "walking"
  | string;

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
  avoid?: string[];
  from: RoutingPoint;
  profileId?: RoutingProfileId;
  to: RoutingPoint;
}

export interface RoutingProfilesResponse {
  contractVersion?: string;
  generatedAt?: string;
  profiles: Array<Record<string, unknown>>;
  warnings: string[];
}

export interface RoutingRouteResponse {
  contractVersion?: string;
  features: Array<Record<string, unknown>>;
  generatedAt?: string;
  providerId?: string;
  quality?: Record<string, unknown>;
  routes: Array<Record<string, unknown>>;
  warnings: string[];
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
  enabled: false,
  timeoutMs: 12000
};

export function createRoutingSourceConfigFromEnv(env: Record<string, string | undefined> = process.env): RoutingSourceConfig {
  const situationConfig = createSituationDataSourceConfigFromEnv(env);
  return {
    baseUrl: trimTrailingSlash(env.COP_ROUTING_BASE_URL ?? situationConfig.baseUrl ?? defaultConfig.baseUrl),
    enabled: readBoolean(env.COP_ROUTING_ENABLED, readBoolean(env.COP_SITUATION_DATA_ENABLED, defaultConfig.enabled)),
    timeoutMs: readInteger(env.COP_ROUTING_TIMEOUT_MS, situationConfig.timeoutMs ?? defaultConfig.timeoutMs, 1000, 60000)
  };
}

export function createRoutingSourceFromEnv(env: Record<string, string | undefined> = process.env): RoutingSource | undefined {
  const config = createRoutingSourceConfigFromEnv(env);
  return config.enabled ? new RoutingSourceAdapter(config) : undefined;
}

export class RoutingSourceAdapter implements RoutingSource {
  constructor(readonly config: RoutingSourceConfig) {}

  async fetchProfiles(requestNow: Date): Promise<RoutingProfilesResponse> {
    return normalizeRoutingProfilesResponse(await fetchJson(routingUrl(this.config, "profiles"), this.config, requestNow));
  }

  async route(request: RoutingRouteRequest, requestNow: Date): Promise<RoutingRouteResponse> {
    return normalizeRoutingRouteResponse(await postRoutingJson(this.config, "route", normalizeRoutingRouteRequest(request), requestNow));
  }

  async alternatives(request: RoutingRouteRequest, requestNow: Date): Promise<RoutingRouteResponse> {
    return normalizeRoutingRouteResponse(await postRoutingJson(this.config, "alternatives", normalizeRoutingRouteRequest(request), requestNow));
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
  return {
    ...(Array.isArray(request.avoid) ? { avoid: request.avoid.flatMap((item) => optionalString(item) ?? []).slice(0, 20) } : {}),
    from,
    profileId: optionalString(request.profileId) ?? "emergency_vehicle",
    to
  };
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
  const rawProfiles = Array.isArray(value.profiles)
    ? value.profiles
    : Array.isArray(value.items)
      ? value.items
      : [];
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
  return {
    contractVersion: optionalString(value.contractVersion),
    features: Array.isArray(value.features) ? value.features.filter(isRecord) : [],
    generatedAt: optionalString(value.generatedAt),
    providerId: optionalString(value.providerId),
    quality: isRecord(value.quality) ? value.quality : undefined,
    routes: Array.isArray(value.routes) ? value.routes.filter(isRecord) : [],
    warnings: normalizeWarnings(value.warnings)
  };
}

function normalizeRoutingGenericResponse(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Routing response is not an object.");
  }
  return value;
}

async function postRoutingJson(config: RoutingSourceConfig, path: string, body: unknown, requestNow: Date): Promise<unknown> {
  return fetchJson(routingUrl(config, path), config, requestNow, {
    body: JSON.stringify(body),
    method: "POST"
  });
}

type FetchJsonInit = RequestInit & { timeoutMs?: number };

class RoutingHttpError extends Error {
  readonly status: number;

  constructor(status: number, statusText: string, url: URL) {
    super(`${status} ${statusText || "SIM routing request failed"} for ${url.pathname}`);
    this.name = "RoutingHttpError";
    this.status = status;
  }
}

async function fetchJson(url: URL, config: RoutingSourceConfig, requestNow: Date, init: FetchJsonInit = {}): Promise<unknown> {
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
      throw new RoutingHttpError(response.status, response.statusText, url);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function routingUrl(config: RoutingSourceConfig, path: string): URL {
  return new URL(`routing/${path.replace(/^\/+/u, "")}`, `${trimTrailingSlash(config.baseUrl)}/`);
}

function normalizeWarnings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => optionalString(item) ?? [])
    : [];
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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
