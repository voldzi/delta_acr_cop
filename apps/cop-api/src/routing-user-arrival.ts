import { readFileSync } from "node:fs";
import { createAjv } from "@cop/ingest-contracts";
import { canonicalJson, routingHash } from "./routing-trip.js";
import type { RoutingRouteRequest } from "./routing-source.js";

export const userArrivalVersion = "sim-user-selected-arrival-v1" as const;
type Point = { lat: number; lon: number };
export interface UserArrivalRequest { version: typeof userArrivalVersion; selection: "user_selected"; target: Point }
export interface UserArrivalCapabilities {
  version: typeof userArrivalVersion; availability: "requires_runtime_validation" | "disabled";
  selection: "user_selected_only"; profileIds: ["car"]; maxRemainingDistanceM: 250;
  maxSnapDistanceM: 25; remainingAccess: "unverified"; cachePolicy: "no_cache";
}
export interface UserArrival {
  version: typeof userArrivalVersion; selection: "user_selected"; target: Point; requestedAccess: Point;
  mappedEndpoint: Point; distanceM: number; snapDistanceM: number; remainingAccess: "unverified";
  requestHash: string; geometryHash: string; routeId: string;
  routingDataset: { version: string; builtAt: string }; profileId: "car";
  engine: { provider: "valhalla"; version: string; costing: "auto"; fallbackUsed: false };
  closureRevision: string; validUntil: string;
}
export class UserArrivalRequestError extends Error {
  constructor(readonly code: "ROUTING_ARRIVAL_UNSUPPORTED" | "ROUTING_ARRIVAL_TOO_DISTANT") {
    super("User-selected arrival is unsupported or outside its explicit distance bound.");
  }
}
export class UserArrivalVerificationError extends Error {
  readonly code = "ROUTING_ARRIVAL_INVALID";
  constructor() { super("SIM user-selected arrival evidence could not be verified for every variant."); }
}
const schemas = JSON.parse(readFileSync(new URL("../../../docs/api/schemas/user-selected-arrival-v1.schemas.json", import.meta.url), "utf8"));
const ajv = createAjv();
const validator = (name: string) => ajv.compile({ ...schemas, $ref: `#/components/schemas/${name}` });
const validRequest = validator("RoutingUserArrivalRequest"), validProof = validator("RoutingUserArrival"), validCaps = validator("RoutingUserArrivalCapabilities");
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const reject = (): never => { throw new UserArrivalVerificationError(); };
export function arrivalDistance(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const h = Math.sin((a.lat - b.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((a.lon - b.lon) * rad / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}
export function validateUserArrivalRequest(request: RoutingRouteRequest): void {
  if (request.arrival === undefined) return;
  if (!validRequest(request.arrival)) throw new Error("Routing arrival violates sim-user-selected-arrival-v1.");
  if (request.profileId !== "car" || request.includeSteps !== true ||
      request.vehicle !== undefined || request.vehicleProfile !== undefined || request.trip !== undefined ||
      request.via !== undefined || request.departureTime !== undefined ||
      (request.alternatives !== undefined && (!Number.isInteger(request.alternatives) || request.alternatives < 1 || request.alternatives > 3))) {
    throw new UserArrivalRequestError("ROUTING_ARRIVAL_UNSUPPORTED");
  }
  if (!record(request.to) || typeof request.to.lat !== "number" || typeof request.to.lon !== "number") return;
  const d = arrivalDistance(request.to, request.arrival.target);
  if (Number.isFinite(d) && d > 250) throw new UserArrivalRequestError("ROUTING_ARRIVAL_TOO_DISTANT");
}
export function verifiedUserArrivalCapabilities(value: unknown): UserArrivalCapabilities {
  if (!validCaps(value)) reject();
  return value as UserArrivalCapabilities;
}
/** Run on raw variants before optional enrichment/filtering; never invent a final leg. */
export function verifyUserArrivalResponse(value: Record<string, unknown>, request: RoutingRouteRequest | undefined, now: Date, knownClosuresVerified: boolean): void {
  const routes = Array.isArray(value.routes) ? value.routes : [];
  const features = Array.isArray(value.features) ? value.features : [];
  if (!request?.arrival) {
    if (routes.some(r => record(r) && "arrival" in r) || features.some(f => record(f) && record(f.properties) && "arrival" in f.properties)) reject();
    return;
  }
  if (!knownClosuresVerified || !routes.length || !record(value.query) || !Array.isArray(value.features)) reject();
  const target = request.arrival.target, access = { lat: request.to.lat, lon: request.to.lon };
  for (const r of routes) {
    if (!record(r) || !validProof(r.arrival) || !record(r.geometry) || !record(r.knownClosures)) reject();
    const a = r.arrival as UserArrival, c = r.knownClosures;
    const points = r.geometry.coordinates as number[][], last = points.at(-1)!;
    const end = { lat: last[1]!, lon: last[0]! };
    const distance = arrivalDistance(end, target), snap = arrivalDistance(end, access);
    if (!same(a.target, target) || !same(a.requestedAccess, access) || !same(a.mappedEndpoint, end) ||
        !Number.isFinite(distance) || distance > 250 || !Number.isFinite(snap) || snap > 25 ||
        Math.abs(a.distanceM - distance) > 0.01 || Math.abs(a.snapDistanceM - snap) > 0.01 ||
        a.routeId !== r.routeId || a.requestHash !== routingHash(value.query) || a.geometryHash !== routingHash(r.geometry) ||
        !same(a.routingDataset, c.routingDataset) || a.closureRevision !== c.revision ||
        !record(c.engine) || a.engine.version !== c.engine.version ||
        !record(r.vehicleAssessment) || r.vehicleAssessment.providerCosting !== "auto" ||
        Date.parse(a.validUntil) <= now.getTime() || Date.parse(a.validUntil) > Date.parse(String(c.validUntil))) reject();
    const paired = features.filter(f => record(f) && record(f.properties) && (f.properties.routeId ?? f.id) === r.routeId);
    if (paired.length !== 1 || !record(paired[0]) || !record(paired[0].properties) || !same(paired[0].properties.arrival, a)) reject();
  }
  if (features.some(f => record(f) && record(f.properties) && "arrival" in f.properties &&
      (!record(f.geometry) || f.geometry.type !== "LineString"))) reject();
}
