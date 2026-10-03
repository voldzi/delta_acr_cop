import { readFileSync } from "node:fs";
import { createAjv } from "@cop/ingest-contracts";
import { canonicalJson, routingHash } from "./routing-trip.js";
import type { RoutingRouteRequest } from "./routing-source.js";

export interface KnownClosures {
  version: "sim-known-road-closures-v1";
  state: "applied";
  coverage: "incomplete";
  revision: string;
  observedAt: string;
  validUntil: string;
  appliedClosureCount: number;
  geometryHash: string;
  requestHash: string;
  exclusions: Array<{ closureId: string; sourceDirection: "both" | "unknown"; enforcedDirection: "both";
    enforcementReason: "source_both_direction" | "conservative_whole_structure_avoidance"; reviewedGeometryHash: string }>;
  routingDataset: { version: string; builtAt: string };
  engine: { provider: "valhalla"; version: string; fallbackUsed: false };
  limitations: string[];
}
const schema = JSON.parse(readFileSync(new URL("../../../docs/api/schemas/known-road-closures-v1.schema.json", import.meta.url), "utf8"));
const validate = createAjv().compile(schema);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export class KnownClosureVerificationError extends Error {
  readonly code = "ROUTING_KNOWN_CLOSURES_INVALID";
  constructor() { super("SIM known-closure evidence could not be verified for every variant."); this.name = "KnownClosureVerificationError"; }
}
function reject(): never { throw new KnownClosureVerificationError(); }

/** Validate the entire raw response before dropping unavailable routes. Absence makes no claim. */
export function verifyKnownClosuresResponse(response: Record<string, unknown>, request: RoutingRouteRequest | undefined, now: Date): boolean {
  if (!Array.isArray(response.routes) || !response.routes.some((route) => record(route) && "knownClosures" in route)) return false;
  if (!request || request.trip || !response.routes.length || !record(response.query) || !record(response.coverage)) reject();
  const alternatives = Math.max(1, Math.min(3, request.alternatives ?? 2));
  if (response.routes.length > alternatives) reject();
  // SIM alternatives defaults: preserve options exactly, add only the documented defaults.
  const expected = { ...request, via: request.via ?? [], avoid: request.avoid ?? [], alternatives };
  if (canonicalJson(response.query) !== canonicalJson(expected)) reject();
  const dataset = response.coverage.routingDataset;
  if (!record(dataset) || typeof dataset.version !== "string" || typeof dataset.builtAt !== "string") reject();
  const graphTime = Date.parse(dataset.builtAt), current = now.getTime();
  if (!Number.isFinite(graphTime) || graphTime > current || current - graphTime >= 10 * 24 * 3600_000) reject();
  const ids = new Set<string>();
  let shared: string | undefined;
  for (const route of response.routes) {
    if (!record(route) || typeof route.routeId !== "string" || !route.routeId.trim() || ids.has(route.routeId) ||
      route.status !== "ok" || typeof route.distanceM !== "number" || !Number.isFinite(route.distanceM) || route.distanceM <= 0 ||
      typeof route.durationSeconds !== "number" || !Number.isFinite(route.durationSeconds) || route.durationSeconds <= 0 || !record(route.quality) || route.quality.engine !== "valhalla" || route.quality.mode !== "engine_route" ||
      !record(route.geometry) || route.geometry.type !== "LineString" || !Array.isArray(route.geometry.coordinates) || route.geometry.coordinates.length < 2 ||
      !route.geometry.coordinates.every((point) => Array.isArray(point) && point.length === 2 &&
        typeof point[0] === "number" && Number.isFinite(point[0]) && Math.abs(point[0]) <= 180 &&
        typeof point[1] === "number" && Number.isFinite(point[1]) && Math.abs(point[1]) <= 90) || !validate(route.knownClosures)) reject();
    if (request.includeSteps === true) {
      if (!Array.isArray(route.steps) || !route.steps.length || route.steps.length > 10_000) reject();
      let previousEnd = 0;
      for (const [index, step] of route.steps.entries()) {
        if (!record(step) || step.index !== index || step.beginShapeIndex !== previousEnd ||
          !Number.isInteger(step.endShapeIndex) || typeof step.endShapeIndex !== "number" ||
          step.endShapeIndex < previousEnd || step.endShapeIndex >= route.geometry.coordinates.length ||
          typeof step.distanceM !== "number" || !Number.isFinite(step.distanceM) || step.distanceM < 0 ||
          typeof step.durationSeconds !== "number" || !Number.isFinite(step.durationSeconds) || step.durationSeconds < 0 ||
          !record(step.geometry) || step.geometry.type !== "LineString" || !Array.isArray(step.geometry.coordinates)) reject();
        const points = step.geometry.coordinates.filter((point, i, all) => i === 0 || canonicalJson(point) !== canonicalJson(all[i - 1]));
        if (canonicalJson(points) !== canonicalJson(route.geometry.coordinates.slice(previousEnd, step.endShapeIndex + 1))) reject();
        previousEnd = step.endShapeIndex;
      }
      if (previousEnd !== route.geometry.coordinates.length - 1) reject();
    }
    ids.add(route.routeId);
    const evidence = route.knownClosures as KnownClosures;
    const observed = Date.parse(evidence.observedAt), until = Date.parse(evidence.validUntil);
    if (observed > current || until <= current || until <= observed || until - observed > 600_000 ||
      until > graphTime + 10 * 24 * 3600_000 || evidence.geometryHash !== routingHash(route.geometry) ||
      evidence.requestHash !== routingHash(response.query) || canonicalJson(evidence.routingDataset) !== canonicalJson(dataset) ||
      evidence.exclusions.length !== evidence.appliedClosureCount ||
      new Set(evidence.exclusions.map((item) => item.closureId)).size !== evidence.exclusions.length ||
      evidence.exclusions.some((item) => !item.closureId.trim()) || !evidence.engine.version.trim() ||
      evidence.limitations.some((item) => !item.trim())) reject();
    const { geometryHash: _geometryHash, ...common } = evidence;
    const identity = canonicalJson(common);
    if (shared !== undefined && shared !== identity) reject();
    shared = identity;
  }
  if (!Array.isArray(response.features)) reject();
  const rendered = new Set<string>();
  for (const feature of response.features) {
    if (!record(feature) || !record(feature.geometry)) reject();
    if (feature.geometry.type !== "LineString") {
      if (record(feature.properties) && "knownClosures" in feature.properties) reject();
      continue;
    }
    const routeId = record(feature.properties) ? feature.properties.routeId ?? feature.id : feature.id;
    const route = response.routes.find((candidate) => record(candidate) && candidate.routeId === routeId);
    if (!record(route) || typeof routeId !== "string" || rendered.has(routeId) || canonicalJson(feature.geometry) !== canonicalJson(route.geometry)) reject();
    if ((feature.id !== undefined && feature.id !== routeId) ||
      (record(feature.properties) && "knownClosures" in feature.properties &&
        canonicalJson(feature.properties.knownClosures) !== canonicalJson(route.knownClosures))) reject();
    rendered.add(routeId);
  }
  if (rendered.size !== ids.size) reject();
  return true;
}
