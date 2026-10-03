import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoutingSourceAdapter, type RoutingRouteRequest } from "./routing-source.js";
import { verifyKnownClosuresResponse } from "./routing-known-closures.js";
import { canonicalJson, routingHash } from "./routing-trip.js";
const now = new Date("2026-10-03T12:00:00Z");
const request: RoutingRouteRequest = { profileId: "car", from: { lat: 50, lon: 14 }, to: { lat: 50.1, lon: 14.1 }, alternatives: 2, includeSteps: false };
function fixture() {
  const query = { ...structuredClone(request), via: [], avoid: [] };
  const dataset = { version: "synthetic-graph", builtAt: "2026-10-02T12:00:00Z" };
  const routes = [0, 1].map((index) => {
    const geometry = { type: "LineString", coordinates: [[14, 50], [14.05, 50.05 + index * 0.01], [14.1, 50.1]] };
    return { routeId: `synthetic-${index}`, status: "ok", distanceM: 15000, durationSeconds: 1000, geometry, quality: { engine: "valhalla", mode: "engine_route" }, knownClosures: {
      version: "sim-known-road-closures-v1", state: "applied", coverage: "incomplete", revision: routingHash("synthetic-snapshot"),
      observedAt: "2026-10-03T11:59:00Z", validUntil: "2026-10-03T12:09:00Z", appliedClosureCount: 1,
      geometryHash: routingHash(geometry), requestHash: routingHash(query), routingDataset: dataset,
      engine: { provider: "valhalla", version: "synthetic-engine", fallbackUsed: false }, limitations: ["Synthetic fixture, incomplete closure coverage."],
      exclusions: [{ closureId: "synthetic-closure", sourceDirection: "unknown", enforcedDirection: "both", enforcementReason: "conservative_whole_structure_avoidance", reviewedGeometryHash: routingHash("synthetic-polygon") }]
    } };
  });
  return { query, coverage: { state: "covered", routingDataset: dataset }, routes, features: routes.map((r) => ({ id: r.routeId, type: "Feature", geometry: r.geometry, properties: { routeId: r.routeId } })), warnings: [] };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("ordinary known-closure boundary", () => {
  it("uses the exact binding schema and preserves every independently verified variant and normalized query", async () => {
    const schema = JSON.parse(readFileSync(new URL("../../../docs/api/schemas/known-road-closures-v1.schema.json", import.meta.url), "utf8"));
    const openapi = JSON.parse(readFileSync(new URL("../../../openapi/openapi.json", import.meta.url), "utf8"));
    expect(openapi.components.schemas.RoutingKnownClosures).toEqual(schema);
    const vectors = JSON.parse(readFileSync(new URL("../../../docs/api/examples/known-closures-v1.canonical-vectors.json", import.meta.url), "utf8"));
    for (const vector of vectors.vectors) {
      expect(canonicalJson(vector.input)).toBe(vector.canonical);
      expect(routingHash(vector.input)).toBe(vector.sha256);
    }
    const response = fixture();
    expect(verifyKnownClosuresResponse(response, request, now)).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(response))));
    const adapter = new RoutingSourceAdapter({ baseUrl: "https://fixture.invalid/api/v1", enabled: true, timeoutMs: 1000 });
    const result = await adapter.route(request, now);
    expect(result.query).toEqual(response.query);
    expect(result.routes.map((r) => r.knownClosures)).toEqual(response.routes.map((r) => r.knownClosures));
  });
  it("accepts the exact serialized SIM fixture with its normalized query and canonical hashes", async () => {
    const sample = JSON.parse(readFileSync(new URL("../../../docs/api/examples/known-closures-v1.sim-fixture.json", import.meta.url), "utf8"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(sample.response))));
    const adapter = new RoutingSourceAdapter({ baseUrl: "https://fixture.invalid/api/v1", enabled: true, timeoutMs: 1000 });
    const result = await adapter.route(sample.request, new Date(sample.validationNow));
    expect(result.query).toEqual(sample.response.query);
    expect(result.routes).toHaveLength(2);
    expect(result.routes.map(r => r.knownClosures)).toEqual(sample.response.routes.map((r: { knownClosures: unknown }) => r.knownClosures));
    await expect(adapter.route(sample.request, new Date("2026-10-03T12:10:00Z"))).rejects.toThrow("known-closure evidence");
  });
  it("allows a truthful absent field on legacy responses without inventing enforcement", () => {
    expect(verifyKnownClosuresResponse({ routes: [{ status: "ok" }] }, request, now)).toBe(false);
  });
  const cases: Array<[string, (r: ReturnType<typeof fixture>) => void]> = [
    ["changed query with matching hash", r => { r.query.to.lat = 49; for (const v of r.routes) v.knownClosures.requestHash = routingHash(r.query); }],
    ["dropped options", r => { delete (r.query as Record<string, unknown>).includeSteps; for (const v of r.routes) v.knownClosures.requestHash = routingHash(r.query); }],
    ["wrong request hash", r => { r.routes[1]!.knownClosures.requestHash = routingHash("other"); }],
    ["geometry swapped", r => { r.routes[1]!.geometry = r.routes[0]!.geometry; }],
    ["invalid coordinate with matching hash", r => { r.routes[1]!.geometry.coordinates[0]![1] = 100; r.routes[1]!.knownClosures.geometryHash = routingHash(r.routes[1]!.geometry); }],
    ["feature mismatch", r => { r.features[1]!.geometry = r.features[0]!.geometry; }],
    ["feature belongs to another route", r => { r.features[1]!.properties.routeId = "other"; }],
    ["missing rendered variant", r => { r.features.pop(); }],
    ["duplicate rendered variant", r => { r.features.push(r.features[0]!); }],
    ["invalid route distance", r => { r.routes[1]!.distanceM = 0; }],
    ["feature evidence differs", r => { (r.features[1]!.properties as Record<string, unknown>).knownClosures = { ...r.routes[1]!.knownClosures, coverage: "complete" }; }],
    ["feature ID differs", r => { r.features[1]!.id = "other"; }],
    ["duplicate route ID", r => { r.routes[1]!.routeId = r.routes[0]!.routeId; }],
    ["unavailable extra variant before filtering", r => { r.routes[1]!.status = "unavailable"; }],
    ["unassessed extra variant", r => { delete (r.routes[1] as Record<string, unknown>).knownClosures; }],
    ["malformed raw variant", r => { (r.routes as unknown[]).push(null); }],
    ["expired", r => { r.routes[1]!.knownClosures.validUntil = now.toISOString(); }],
    ["future observation", r => { r.routes[1]!.knownClosures.observedAt = "2026-10-03T12:01:00Z"; }],
    ["overlong validity", r => { r.routes[1]!.knownClosures.validUntil = "2026-10-03T12:10:00Z"; }],
    ["different revision", r => { r.routes[1]!.knownClosures.revision = routingHash("changed"); }],
    ["different graph", r => { r.routes[1]!.knownClosures.routingDataset = { ...r.routes[1]!.knownClosures.routingDataset, version: "other" }; }],
    ["future graph", r => { r.coverage.routingDataset.builtAt = "2026-10-04T12:00:00Z"; }],
    ["stale graph", r => { r.coverage.routingDataset.builtAt = "2026-09-01T12:00:00Z"; }],
    ["engine fallback", r => { (r.routes[1]!.knownClosures.engine as Record<string, unknown>).fallbackUsed = true; }],
    ["direct-fallback geometry", r => { r.routes[1]!.quality.mode = "direct_fallback"; }],
    ["falsified source direction", r => { r.routes[1]!.knownClosures.exclusions[0]!.sourceDirection = "both"; }],
    ["unilateral override", r => { r.routes[1]!.knownClosures.exclusions[0]!.enforcedDirection = "forward"; }],
    ["count mismatch", r => { r.routes[1]!.knownClosures.appliedClosureCount = 2; }],
    ["duplicate closure IDs", r => { r.routes[1]!.knownClosures.exclusions.push(r.routes[1]!.knownClosures.exclusions[0]!); r.routes[1]!.knownClosures.appliedClosureCount = 2; }],
    ["unknown schema field", r => { (r.routes[1]!.knownClosures as Record<string, unknown>).complete = true; }]
  ];
  it.each(cases)("rejects %s without a retry or route fallback", async (_label, mutate) => {
    const response = fixture(); mutate(response);
    const fetch = vi.fn(async () => new Response(JSON.stringify(response))); vi.stubGlobal("fetch", fetch);
    const adapter = new RoutingSourceAdapter({ baseUrl: "https://fixture.invalid/api/v1", enabled: true, timeoutMs: 1000 });
    await expect(adapter.route(request, now)).rejects.toThrow("known-closure evidence");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects evidence that expires while waiting for the upstream response", async () => {
    const response = fixture();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(response))));
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(600_000);
    const adapter = new RoutingSourceAdapter({ baseUrl: "https://fixture.invalid/api/v1", enabled: true, timeoutMs: 1000 });
    await expect(adapter.route(request, now)).rejects.toThrow("known-closure evidence");
  });
  it("does not allow ordinary evidence to satisfy a strict trip", () => {
    expect(() => verifyKnownClosuresResponse(fixture(), { ...request, trip: {} as never }, now)).toThrow("known-closure evidence");
  });
});
