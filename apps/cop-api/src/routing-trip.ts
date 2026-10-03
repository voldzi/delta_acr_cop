import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createAjv } from "@cop/ingest-contracts";
import type { RoutingRoute, RoutingRouteRequest, RoutingRouteResponse } from "./routing-source.js";

export interface RoadTripCapabilities {
  version: "sim-road-trip-capabilities-v1";
  strictRoutesEnabled: boolean;
  availability: "disabled" | "requires_runtime_validation";
  intents: Array<{ intent: RoadTrip["intent"]; costing: "auto" | "truck" | "unsupported"; state: "requires_runtime_validation" | "unsupported" }>;
  vehicleFields: string[];
  unsupportedFields: string[];
  closures: { mode: "reviewed_both_direction_polygons"; state: "unavailable" | "requires_runtime_validation"; oneDirection: "unsupported" };
  graphMaxAgeSeconds: number;
  maxWaypoints: 12;
  maxAlternatives: 3;
  cachePolicy: "no_cache";
  emergencyExemption: false;
}

export interface RoadTripVehicle {
  heightM: number;
  widthM: number;
  lengthM: number;
  loadedWeightKg: number;
  axleLoadKg?: number;
  axleCount?: number;
  trailer: { attached: boolean; heightM?: number; widthM?: number; lengthM?: number; loadedWeightKg?: number; axleCount?: number };
}
export interface RoadTrip {
  version: "sim-road-trip-v1";
  requestId: string;
  intent: "car" | "commercial_truck" | "car_with_trailer";
  vehicle: RoadTripVehicle;
  departure: { mode: "now" | "depart_at"; at?: string };
  preferences: { avoidTolls: boolean; preferPaved: boolean };
  requirements: { roadClosures: "mandatory"; legalAccess: "mandatory"; vehicleLimits: "mandatory" };
  waypoints: Array<{ type: "via" | "stop"; point: { lat: number; lon: number; label?: string } }>;
  destination: { kind: "road_point" | "approved_entrance"; entranceId?: string };
}
export interface RoadTripAssessment {
  version: "sim-road-trip-assessment-v1";
  requestId: string;
  requestHash: string;
  appliedHash: string;
  appliedTrip: RoadTrip;
  engine: { provider: string; version: string; costing: string; fallbackUsed: boolean };
  geometryHash: string;
  routingDataset: { version: string; builtAt: string; sourceAgeSeconds: number; freshness: string };
  closures: { state: string; revision: string; observedAt: string; validUntil: string; appliedClosureCount: number; coverage: string };
  vehicleLimits: { state: string; appliedFields: string[]; coverage: string };
  waypoints: { state: string; orderedCount: number };
  lastMile: "not_requested" | "not_routed";
  validUntil: string;
  limitations: string[];
}
export interface RoadTripRoundabout {
  phase: "enter" | "exit";
  source: "valhalla_maneuver";
  countState: "provider_supplied" | "unknown";
  exitCount?: number;
  exitRoadNames?: string[];
  signNames?: string[];
}

const schemas = JSON.parse(readFileSync(new URL("../../../docs/api/schemas/road-trip-v1.schemas.json", import.meta.url), "utf8"));
const ajv = createAjv();
const validateCapabilitiesSchema = ajv.compile({ ...schemas, $ref: "#/components/schemas/RoadTripCapabilities" });
const validateTripSchema = ajv.compile({ ...schemas, $ref: "#/components/schemas/RoadTripTrip" });
const validateCoordinate = ajv.compile({ ...schemas, $ref: "#/components/schemas/RoadTripCoordinate" });
const validateAssessment = ajv.compile({ ...schemas, $ref: "#/components/schemas/RoadTripAssessment" });
const validateRoundabout = ajv.compile({ ...schemas, $ref: "#/components/schemas/RoadTripRoundabout" });

/** JSON keys sorted recursively; arrays retain order. Input must already be JSON/schema-valid. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export function routingHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
export function tripRequestHash(request: RoutingRouteRequest): string {
  return routingHash({ from: request.from, to: request.to, avoid: [...new Set(request.avoid)].sort(), trip: request.trip });
}
export function validateRoadTripRequest(request: RoutingRouteRequest): void {
  if (request.trip === undefined) return;
  if (!validateTripSchema(request.trip) || !validateCoordinate(request.from) || !validateCoordinate(request.to) || request.profileId !== "car" ||
    request.vehicle !== undefined || request.via !== undefined || request.departureTime !== undefined ||
    !request.avoid?.includes("road_closure") || request.avoid.some((item) => !["flood", "fire", "road_closure", "unpaved", "tunnel", "bridge"].includes(item)) || (request.alternatives !== undefined && (request.alternatives < 1 || request.alternatives > 3))) {
    throw new Error("Routing trip violates sim-road-trip-v1 or conflicts with legacy parameters.");
  }
  const { intent, vehicle } = request.trip;
  if ((intent === "car_with_trailer") !== vehicle.trailer.attached ||
    (vehicle.axleLoadKg !== undefined && vehicle.axleLoadKg > vehicle.loadedWeightKg) ||
    (vehicle.trailer.loadedWeightKg !== undefined && vehicle.trailer.loadedWeightKg > vehicle.loadedWeightKg) ||
    (vehicle.trailer.lengthM !== undefined && vehicle.trailer.lengthM > vehicle.lengthM) ||
    (vehicle.trailer.heightM !== undefined && vehicle.trailer.heightM > vehicle.heightM) ||
    (vehicle.trailer.widthM !== undefined && vehicle.trailer.widthM > vehicle.widthM)) {
    throw new Error("Routing trip vehicle and trailer values are inconsistent.");
  }
}

/** Reject the complete strict result; never turn a safety failure into outside_coverage/MapKit fallback. */
export function verifyRoadTripResponse(response: RoutingRouteResponse, request: RoutingRouteRequest, now: Date): RoutingRouteResponse {
  if (!request.trip) return response;
  const hash = tripRequestHash(request);
  if (!response.routes.length || !response.routes.every((route) => verifiedVariant(route, request, hash, now, response))) {
    throw new Error("SIM routing safety assessment could not be verified for every variant.");
  }
  if (response.features.some((feature) => {
    const geometry = feature.geometry as { type?: string } | undefined;
    if (geometry?.type !== "LineString") return false;
    const props = feature.properties as { routeId?: string } | undefined;
    const route = response.routes.find((candidate) => candidate.routeId === (props?.routeId ?? feature.id));
    return !route || canonicalJson(feature.geometry) !== canonicalJson(route.geometry);
  })) throw new Error("SIM routing feature geometry does not match its assessed variant.");
  return response;
}
function verifiedVariant(route: RoutingRoute, request: RoutingRouteRequest, hash: string, now: Date, response: RoutingRouteResponse): boolean {
  const a = route.assessment;
  if (!a || !validateAssessment(a) || !request.trip || !route.routeId ||
    a.requestId !== request.trip.requestId || a.requestHash !== hash || a.appliedHash !== hash ||
    canonicalJson(a.appliedTrip) !== canonicalJson(request.trip) || a.geometryHash !== routingHash(route.geometry) ||
    route.quality?.mode !== "engine_route" || route.quality.engine !== "valhalla" ||
    a.engine.provider !== "valhalla" || a.engine.fallbackUsed || a.engine.costing !== (request.trip.intent === "car" ? "auto" : "truck") ||
    a.routingDataset.freshness !== "current" || !a.routingDataset.version ||
    a.closures.state !== "applied" || a.closures.coverage !== "authoritative_reviewed_snapshot" || !a.closures.revision ||
    a.vehicleLimits.state !== "provider_costing_applied" ||
    a.waypoints.state !== "applied" || a.waypoints.orderedCount !== request.trip.waypoints.length ||
    request.trip.destination.kind !== "road_point" || a.lastMile !== "not_requested") return false;
  const geometry = route.geometry as { type?: unknown; coordinates?: unknown } | undefined;
  if (geometry?.type !== "LineString" || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2 ||
    !geometry.coordinates.every((p) => Array.isArray(p) && p.length === 2 &&
      typeof p[0] === "number" && Number.isFinite(p[0]) && Math.abs(p[0]) <= 180 &&
      typeof p[1] === "number" && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90)) return false;
  if (route.status !== "ok" || typeof route.distanceM !== "number" || !Number.isFinite(route.distanceM) || route.distanceM <= 0 ||
    typeof route.durationSeconds !== "number" || !Number.isFinite(route.durationSeconds) || route.durationSeconds <= 0 ||
    !Array.isArray(route.steps) || route.steps.length === 0 || route.steps.length > 10_000) return false;
  let previousEnd = 0;
  for (const [index, step] of route.steps.entries()) {
    if (step.index !== index || !Number.isInteger(step.beginShapeIndex) || !Number.isInteger(step.endShapeIndex) ||
      step.beginShapeIndex !== previousEnd || typeof step.endShapeIndex !== "number" ||
      step.endShapeIndex < previousEnd || step.endShapeIndex >= geometry.coordinates.length ||
      typeof step.distanceM !== "number" || !Number.isFinite(step.distanceM) || step.distanceM < 0 ||
      typeof step.durationSeconds !== "number" || !Number.isFinite(step.durationSeconds) || step.durationSeconds < 0) return false;
    previousEnd = step.endShapeIndex;
  }
  if (previousEnd !== geometry.coordinates.length - 1) return false;
  const until = Date.parse(a.validUntil), closureUntil = Date.parse(a.closures.validUntil);
  if (!Number.isFinite(until) || !Number.isFinite(closureUntil) || until <= now.getTime() || until > closureUntil ||
    Date.parse(a.closures.observedAt) > now.getTime() || Date.parse(a.routingDataset.builtAt) > now.getTime()) return false;
  const dataset = response.coverage?.routingDataset;
  if (!dataset || dataset.version !== a.routingDataset.version || dataset.builtAt !== a.routingDataset.builtAt) return false;
  const requiredFields = ["heightM", "widthM", "lengthM", "loadedWeightKg",
    ...(request.trip.vehicle.axleLoadKg !== undefined ? ["axleLoadKg"] : []),
    ...(request.trip.vehicle.axleCount !== undefined ? ["axleCount"] : [])];
  return requiredFields.every((field) => a.vehicleLimits.appliedFields.includes(field));
}
export function validRoundabout(value: unknown, maneuverType: number | undefined): value is RoadTripRoundabout {
  return Boolean(validateRoundabout(value)) &&
    ((value as RoadTripRoundabout).phase === "enter" ? maneuverType === 26 : maneuverType === 27) && ((value as RoadTripRoundabout).countState === "provider_supplied"
    ? (value as RoadTripRoundabout).exitCount !== undefined : (value as RoadTripRoundabout).exitCount === undefined);
}

export function verifiedCapabilities(value: unknown): RoadTripCapabilities {
  if (!validateCapabilitiesSchema(value)) throw new Error("SIM routing capability contract could not be verified.");
  return value as RoadTripCapabilities;
}
