import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoutingSourceAdapter, type RoutingRouteRequest, type RoutingRouteResponse } from "./routing-source.js";
import { routingHash, tripRequestHash, validateRoadTripRequest, verifyRoadTripResponse, validRoundabout } from "./routing-trip.js";

export const tripNow = new Date("2026-10-03T12:00:00Z");
export function tripRequest(): RoutingRouteRequest {
  return { from: { lat: 50, lon: 14 }, to: { lat: 51, lon: 15 }, profileId: "car", alternatives: 2,
    avoid: ["road_closure"], includeSteps: true, trip: {
      version: "sim-road-trip-v1", requestId: "2c78031f-0db9-430f-bfc8-e527df399aba", intent: "car",
      vehicle: { heightM: 1.8, widthM: 1.9, lengthM: 4.5, loadedWeightKg: 1900, trailer: { attached: false } },
      departure: { mode: "now" }, preferences: { avoidTolls: false, preferPaved: true },
      requirements: { roadClosures: "mandatory", legalAccess: "mandatory", vehicleLimits: "mandatory" },
      waypoints: [{ type: "stop", point: { lat: 50.5, lon: 14.5 } }], destination: { kind: "road_point" }
    } };
}
export function tripResponse(request = tripRequest()): RoutingRouteResponse {
  const geometry = { type: "LineString", coordinates: [[14, 50], [14.5, 50.5], [15, 51]] };
  const dataset = { version: "test-graph", builtAt: "2026-10-02T00:00:00Z" };
  return { features: [], warnings: [], coverage: { state: "covered", routingDataset: dataset }, routes: [1, 2].map((rank) => ({
    routeId: `variant-${rank}`, rank, geometry, status: "ok", distanceM: 150000, durationSeconds: 10000,
    steps: [{ index: 0, beginShapeIndex: 0, endShapeIndex: 2, distanceM: 150000, durationSeconds: 10000 },
      { index: 1, beginShapeIndex: 2, endShapeIndex: 2, distanceM: 0, durationSeconds: 0 }], quality: { engine: "valhalla", mode: "engine_route" },
    assessment: { version: "sim-road-trip-assessment-v1", requestId: request.trip!.requestId,
      requestHash: tripRequestHash(request), appliedHash: tripRequestHash(request), appliedTrip: structuredClone(request.trip!),
      engine: { provider: "valhalla", version: "test-only", costing: request.trip!.intent === "car" ? "auto" : "truck", fallbackUsed: false },
      geometryHash: routingHash(geometry), routingDataset: { ...dataset, sourceAgeSeconds: 129600, freshness: "current" },
      closures: { state: "applied", revision: "synthetic-review-1", observedAt: "2026-10-03T11:55:00Z", validUntil: "2026-10-03T12:15:00Z", appliedClosureCount: 0, coverage: "authoritative_reviewed_snapshot" },
      vehicleLimits: { state: "provider_costing_applied", appliedFields: ["heightM", "widthM", "lengthM", "loadedWeightKg"], coverage: "mapped_restrictions_incomplete" },
      waypoints: { state: "applied", orderedCount: 1 }, lastMile: "not_requested", validUntil: "2026-10-03T12:10:00Z", limitations: ["Synthetic fixture; no real closure or route proof."] }
  })) };
}
afterEach(() => vi.unstubAllGlobals());

describe("strict road trip boundary", () => {
  it("uses the same exact schemas in runtime and binding OpenAPI and validates the published example", () => {
    const runtime = JSON.parse(readFileSync(new URL("../../../docs/api/schemas/road-trip-v1.schemas.json", import.meta.url), "utf8"));
    const openapi = JSON.parse(readFileSync(new URL("../../../openapi/openapi.json", import.meta.url), "utf8"));
    for (const [key, schema] of Object.entries(runtime.components.schemas)) expect(openapi.components.schemas[key]).toEqual(schema);
    const request = JSON.parse(readFileSync(new URL("../../../docs/api/examples/road-trip-v1.request.json", import.meta.url), "utf8"));
    expect(() => validateRoadTripRequest(request)).not.toThrow();
  });

  it("forwards only schema-verified capabilities and never invents support for an old or invalid catalog", async () => {
    const capabilities = JSON.parse(readFileSync(new URL("../../../docs/api/examples/road-trip-v1.capabilities.json", import.meta.url), "utf8"));
    const fetchMock = vi.fn(async () => Response.json({ profiles: [{ profileId: "car" }], warnings: [], capabilities }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new RoutingSourceAdapter({ baseUrl: "https://sim.test/api/v1", enabled: true, timeoutMs: 1000 });
    expect((await adapter.fetchProfiles(tripNow)).capabilities).toEqual(capabilities);
    fetchMock.mockImplementation(async () => Response.json({ profiles: [], warnings: [] }));
    expect((await adapter.fetchProfiles(tripNow)).capabilities).toBeUndefined();
    capabilities.emergencyExemption = true;
    fetchMock.mockImplementation(async () => Response.json({ profiles: [], warnings: [], capabilities }));
    await expect(adapter.fetchProfiles(tripNow)).rejects.toThrow("could not be verified");
  });
  it("accepts both variants of the actual synthetic SIM HTTP response and preserves its complete outgoing request", async () => {
    const load = (name: string) => JSON.parse(readFileSync(new URL(`../../../docs/api/examples/road-trip-v1.sim-${name}.json`, import.meta.url), "utf8"));
    const request = load("request"), response = load("response"), manifest = load("manifest");
    expect(manifest.syntheticOnly).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      expect(JSON.parse(init.body)).toEqual(request);
      return Response.json(response);
    }));
    const adapter = new RoutingSourceAdapter({ baseUrl: "https://sim.test/api/v1", enabled: true, timeoutMs: 1000 });
    const accepted = await adapter.route(request, new Date(manifest.now));
    expect(accepted.routes).toHaveLength(2);
    expect(accepted.routes.map(route => route.assessment)).toEqual(response.routes.map((route: Record<string, unknown>) => route.assessment));
  });

  it("preserves every immutable trip field through the actual outgoing adapter body", async () => {
    const request = tripRequest();
    const fetchMock = vi.fn(async (_url, init) => {
      const outgoing = JSON.parse(init.body);
      expect(outgoing).toEqual(request);
      return Response.json(tripResponse(outgoing));
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new RoutingSourceAdapter({ baseUrl: "https://sim.test/api/v1", enabled: true, timeoutMs: 1000 });
    expect((await adapter.route(request, tripNow)).routes).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not drop legacy ordered stops or departure time", async () => {
    const request = { from: { lat: 50, lon: 14 }, to: { lat: 51, lon: 15 }, profileId: "car", alternatives: 1,
      via: [{ lat: 50.5, lon: 14.5, label: " Stop " }], departureTime: "2026-10-03T12:00:00Z" };
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      expect(JSON.parse(init.body)).toEqual(request);
      return Response.json({ routes: [], features: [], warnings: [] });
    }));
    await new RoutingSourceAdapter({ baseUrl: "https://sim.test/api/v1", enabled: true, timeoutMs: 1000 }).route(request, tripNow);
  });

  it("rejects conflicts, incomplete snapshots, invalid intent and missing closure requirement", () => {
    for (const mutate of [
      (r: RoutingRouteRequest) => { r.profileId = "emergency_vehicle"; },
      (r: RoutingRouteRequest) => { r.avoid = []; },
      (r: RoutingRouteRequest) => { r.vehicle = { heightM: 2 }; },
      (r: RoutingRouteRequest) => { r.via = []; },
      (r: RoutingRouteRequest) => { r.departureTime = "2026-10-03T12:00:00Z"; },
      (r: RoutingRouteRequest) => { r.alternatives = 4; },
      (r: RoutingRouteRequest) => { r.trip!.vehicle.loadedWeightKg = 0; },
      (r: RoutingRouteRequest) => { r.trip!.vehicle.axleLoadKg = 2000; },
      (r: RoutingRouteRequest) => { r.trip!.intent = "car_with_trailer"; },
      (r: RoutingRouteRequest) => { r.trip!.departure = { mode: "depart_at" }; },
      (r: RoutingRouteRequest) => { (r.trip as unknown as Record<string, unknown>).freeContext = "ignored?"; }
    ]) {
      const request = tripRequest(); mutate(request);
      expect(() => validateRoadTripRequest(request)).toThrow(/^Routing /u);
    }
  });

  it("checks every variant and fails on mismatched identity, geometry, expiry, fallback or partial restrictions", () => {
    for (const mutate of [
      (r: RoutingRouteResponse) => { r.routes[1]!.assessment!.requestId = "54fd506b-7c8b-4682-b982-b756749d6a2e"; },
      (r: RoutingRouteResponse) => { r.routes[1]!.assessment!.appliedHash = "0".repeat(64); },
      (r: RoutingRouteResponse) => { r.routes[1]!.assessment!.appliedTrip.vehicle.loadedWeightKg = 2500; },
      (r: RoutingRouteResponse) => { r.routes[1]!.geometry = { type: "LineString", coordinates: [[14, 50], [15, 50]] }; },
      (r: RoutingRouteResponse) => { r.routes[1]!.assessment!.validUntil = tripNow.toISOString(); },
      (r: RoutingRouteResponse) => { r.routes[1]!.assessment!.validUntil = "2026-10-03T12:20:00Z"; },
      (r: RoutingRouteResponse) => { r.routes[1]!.assessment!.closures.coverage = "incomplete"; },
      (r: RoutingRouteResponse) => { r.routes[1]!.assessment!.routingDataset.version = "other-graph"; },
      (r: RoutingRouteResponse) => { r.routes[1]!.assessment!.engine.fallbackUsed = true; },
      (r: RoutingRouteResponse) => { r.routes[1]!.quality = { mode: "osm_graph", engine: "osm-postgis-graph" }; },
      (r: RoutingRouteResponse) => { r.routes[1]!.assessment!.vehicleLimits.state = "partial"; },
      (r: RoutingRouteResponse) => { r.routes[1]!.assessment!.vehicleLimits.appliedFields = ["heightM"]; },
      (r: RoutingRouteResponse) => { r.routes[1]!.assessment!.waypoints.orderedCount = 0; },
      (r: RoutingRouteResponse) => { r.routes[1]!.assessment!.engine.costing = "truck"; },
      (r: RoutingRouteResponse) => { r.routes[1]!.steps![0]!.endShapeIndex = 99; },
      (r: RoutingRouteResponse) => { r.routes[1]!.steps![0]!.beginShapeIndex = 1; },
      (r: RoutingRouteResponse) => { r.routes[1]!.durationSeconds = 0; },
      (r: RoutingRouteResponse) => { r.routes = []; }
    ]) {
      const response = tripResponse(); mutate(response);
      expect(() => verifyRoadTripResponse(response, tripRequest(), tripNow)).toThrow("could not be verified");
    }
  });

  it("binds renderable features by SIM feature id as well as routeId and rejects swapped geometry", () => {
    const response = tripResponse();
    response.features = response.routes.map(route => ({ type: "Feature", id: route.routeId, geometry: route.geometry }));
    expect(verifyRoadTripResponse(response, tripRequest(), tripNow)).toBe(response);
    response.features[1]!.geometry = { type: "LineString", coordinates: [[14, 50], [15, 50]] };
    expect(() => verifyRoadTripResponse(response, tripRequest(), tripNow)).toThrow("feature geometry");
  });

  it("does not hide an unsafe variant by filtering it or start a fallback on an upstream outage", async () => {
    const adapter = new RoutingSourceAdapter({ baseUrl: "https://sim.test/api/v1", enabled: true, timeoutMs: 1000 });
    const unsafe = tripResponse(); unsafe.routes[1]!.quality = { mode: "direct_fallback" };
    const fetchMock = vi.fn(async () => Response.json(unsafe)); vi.stubGlobal("fetch", fetchMock);
    await expect(adapter.route(tripRequest(), tripNow)).rejects.toThrow("could not be verified");
    fetchMock.mockImplementation(async () => Response.json({ error: { code: "ROUTING_CLOSURES_UNAVAILABLE" } }, { status: 503 }));
    await expect(adapter.route(tripRequest(), tripNow)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("only accepts structured roundabout counts for the corresponding provider phase", () => {
    const enter = { phase: "enter", source: "valhalla_maneuver", countState: "provider_supplied", exitCount: 4 };
    expect(validRoundabout(enter, 26)).toBe(true);
    expect(validRoundabout(enter, 27)).toBe(false);
    expect(validRoundabout({ ...enter, exitCount: 0 }, 26)).toBe(false);
    expect(validRoundabout({ ...enter, countState: "unknown" }, 26)).toBe(false);
  });

  it("canonical identity ignores key order and duplicate avoid names but changes with trip parameters", () => {
    expect(routingHash({ b: 2, a: 1 })).toBe(routingHash({ a: 1, b: 2 }));
    const request = tripRequest(), original = tripRequestHash(request);
    request.avoid = ["road_closure", "road_closure"];
    expect(tripRequestHash(request)).toBe(original);
    request.trip!.waypoints.reverse(); request.trip!.preferences.avoidTolls = true;
    expect(tripRequestHash(request)).not.toBe(original);
  });
});
