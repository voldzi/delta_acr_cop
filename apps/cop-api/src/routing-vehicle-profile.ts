import { readFileSync } from "node:fs";
import { createAjv } from "@cop/ingest-contracts";
import { canonicalJson, routingHash } from "./routing-trip.js";
import type { RoutingRouteRequest } from "./routing-source.js";

/** Request validated against the exact shared SIM schema below. */
export interface MappedVehicleProfile {
  version: "sim-mapped-road-profile-v1";
  intent: "car" | "commercial_truck" | "car_with_trailer" | "road_legal_4x4";
  driverDeclaredAuthorization?: boolean;
  coverageAcknowledged: "mapped_restrictions_incomplete";
  vehicle?: {
    heightM: number;
    widthM: number;
    lengthM: number;
    loadedWeightKg: number;
    axleLoadKg?: number;
    axleCount?: number;
    trailer?: { attached: true; heightM: number; widthM: number; lengthM: number; loadedWeightKg: number };
  };
}

export class VehicleProfileVerificationError extends Error {
  readonly code = "ROUTING_VEHICLE_PROFILE_INVALID";
  constructor() {
    super("SIM vehicle-profile evidence could not be verified for every variant.");
    this.name = "VehicleProfileVerificationError";
  }
}

/** Never let the new ordinary intent weaken a separately requested strict trip. */
export function validateVehicleProfileConflicts(request: RoutingRouteRequest): void {
  if (request.vehicleProfile === undefined) return;
  if (request.profileId !== "car" || request.trip !== undefined || request.vehicle !== undefined) {
    throw new Error("Routing vehicleProfile conflicts with legacy vehicle, profileId or strict trip.");
  }
}

export interface MappedProfileAssessment {
  version: "sim-mapped-road-profile-assessment-v1";
  state: "applied";
  coverage: "mapped_restrictions_incomplete";
  appliedProfile: MappedVehicleProfile;
  profileHash: string;
  requestHash: string;
  geometryHash: string;
  engine: { provider: "valhalla"; version: "3.8.3"; costing: "auto" | "truck"; fallbackUsed: false };
  routingDataset: { version: string; builtAt: string };
  appliedFields: string[];
  validUntil: string;
  lastMile: { state: "mapped_target" | "target_guidance_only"; target: { lon: number; lat: number }; mappedEndpoint: { lon: number; lat: number }; distanceM: number };
  limitations: string[];
}
export interface MappedProfileCapabilities {
  version: "sim-mapped-road-profile-capabilities-v1";
  availability: "requires_runtime_validation" | "disabled";
  intents: Array<{ intent: MappedVehicleProfile["intent"]; costing: "auto" | "truck"; supportedFields: string[]; limitations: string[] }>;
  maxSnapDistanceM: 25;
  driverDeclaredAuthorization: "unsupported";
  unmappedLastMile: "unsupported";
  strictGuarantees: false;
}
const schemas = JSON.parse(readFileSync(new URL("../../../docs/api/schemas/mapped-road-profile-v1.schemas.json", import.meta.url), "utf8"));
const ajv = createAjv();
const validator = (name: string) => ajv.compile({ components: { schemas }, $ref: `#/components/schemas/${name}` });
const validProfile = validator("Profile"), validAssessment = validator("Assessment"), validCapabilities = validator("Capabilities");
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
function reject(): never { throw new VehicleProfileVerificationError(); }
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const dimensions = ["heightM", "widthM", "lengthM", "loadedWeightKg"] as const;

export function validateVehicleProfileRequest(request: RoutingRouteRequest): void {
  validateVehicleProfileConflicts(request);
  const p = request.vehicleProfile;
  if (p === undefined) return;
  if ((request.alternatives !== undefined && (request.alternatives < 1 || request.alternatives > 3)) ||
    request.avoid?.some(a => !["flood", "fire", "road_closure", "unpaved", "tunnel", "bridge"].includes(a))) {
    throw new Error("Routing vehicleProfile alternatives or avoid options are unsupported by the contract.");
  }
  if (!validProfile(p)) throw new Error("Routing vehicleProfile violates sim-mapped-road-profile-v1.");
  const v = p.vehicle;
  if ((v?.trailer && dimensions.some(k => v[k] < v.trailer![k])) || (v?.axleLoadKg !== undefined && v.axleLoadKg > v.loadedWeightKg)) {
    throw new Error("Routing vehicleProfile dimensions and loaded weight must describe the whole combination.");
  }
}

export function verifiedMappedCapabilities(value: unknown): MappedProfileCapabilities {
  if (!validCapabilities(value)) reject();
  const c = value as MappedProfileCapabilities;
  const intents: MappedVehicleProfile["intent"][] = ["car", "commercial_truck", "car_with_trailer", "road_legal_4x4"];
  if (new Set(c.intents.map(i => i.intent)).size !== 4 || !intents.every(i => c.intents.some(v => v.intent === i))) reject();
  for (const i of c.intents) {
    const fields = [...dimensions, ...(i.intent === "commercial_truck" ? ["axleLoadKg", "axleCount"] : []),
      ...(i.intent === "car_with_trailer" ? ["whole_combination", "trailer_facts"] : []),
      ...(i.intent === "road_legal_4x4" ? ["road_first_preference", "mapped_endpoint_guidance"] : [])];
    if (i.costing !== (i.intent === "commercial_truck" ? "truck" : "auto") ||
      !same([...i.supportedFields].sort(), fields.sort()) || i.limitations.some(v => !v.trim())) reject();
  }
  return c;
}

/** Validate raw variants and map features before filtering or optional enrichment. */
export function verifyMappedProfileResponse(response: Record<string, unknown>, request: RoutingRouteRequest | undefined, now: Date, hasKnownClosures: boolean): boolean {
  const p = request?.vehicleProfile;
  if (!p) {
    if ((Array.isArray(response.routes) && response.routes.some(r => record(r) && "mappedProfileAssessment" in r)) ||
      (Array.isArray(response.features) && response.features.some(f => record(f) && record(f.properties) && "mappedProfileAssessment" in f.properties))) reject();
    return false;
  }
  if (!hasKnownClosures || !record(response.query) || !Array.isArray(response.routes) || !response.routes.length || !Array.isArray(response.features)) reject();
  const expectedFields = [...(p.vehicle ? dimensions : []), ...(p.vehicle?.axleLoadKg !== undefined ? ["axleLoadKg"] : []),
    ...(p.vehicle?.axleCount !== undefined ? ["axleCount"] : []), ...(p.intent === "road_legal_4x4" ? ["road_first_preference"] : [])].sort();
  if (p.driverDeclaredAuthorization === true || (p.intent !== "commercial_truck" && (p.vehicle?.axleCount !== undefined || p.vehicle?.axleLoadKg !== undefined))) reject();
  for (const r of response.routes) {
    if (!record(r) || !validAssessment(r.mappedProfileAssessment) || !record(r.geometry) || !record(r.knownClosures)) reject();
    const a = r.mappedProfileAssessment as MappedProfileAssessment;
    const points = r.geometry.coordinates as number[][];
    const end = points.at(-1)!;
    const target = { lon: request!.to.lon, lat: request!.to.lat }, mappedEndpoint = { lon: end[0], lat: end[1] };
    const rad = Math.PI / 180;
    const h = Math.sin((end[1]! - target.lat) * rad / 2) ** 2 + Math.cos(end[1]! * rad) * Math.cos(target.lat * rad) * Math.sin((end[0]! - target.lon) * rad / 2) ** 2;
    const distanceM = 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    const until = Date.parse(a.validUntil);
    if (!same(a.appliedProfile, p) || a.profileHash !== routingHash(p) || a.requestHash !== routingHash(response.query) ||
      a.geometryHash !== routingHash(r.geometry) || !same(a.routingDataset, r.knownClosures.routingDataset) ||
      (!record(r.knownClosures.engine) || a.engine.version !== r.knownClosures.engine.version) ||
      a.engine.costing !== (p.intent === "commercial_truck" ? "truck" : "auto") ||
      !same([...a.appliedFields].sort(), expectedFields) || a.limitations.some(v => !v.trim()) ||
      until <= now.getTime() || until > Date.parse(String(r.knownClosures.validUntil)) ||
      !same(a.lastMile.target, target) || !same(a.lastMile.mappedEndpoint, mappedEndpoint) ||
      !Number.isFinite(distanceM) || distanceM > 25 || Math.abs(a.lastMile.distanceM - distanceM) > 0.01 ||
      a.lastMile.state !== (end[0] === target.lon && end[1] === target.lat ? "mapped_target" : "target_guidance_only")) reject();
    const features = response.features.filter(f => record(f) && record(f.properties) && (f.properties.routeId ?? f.id) === r.routeId);
    if (features.length !== 1 || !record(features[0]) || !record(features[0].properties) || !same(features[0].properties.mappedProfileAssessment, a)) reject();
  }
  return true;
}
