import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoutingSourceAdapter, type RoutingRouteRequest } from "./routing-source.js";
import { routingHash } from "./routing-trip.js";
import { VehicleProfileVerificationError, validateVehicleProfileRequest, verifiedMappedCapabilities, type MappedVehicleProfile } from "./routing-vehicle-profile.js";
const sample = JSON.parse(readFileSync(new URL("../../../docs/api/examples/known-closures-v1.sim-fixture.json", import.meta.url), "utf8"));
const now = new Date(sample.validationNow);
const dimensions = ["heightM", "widthM", "lengthM", "loadedWeightKg"];
function profile(intent: MappedVehicleProfile["intent"]): MappedVehicleProfile {
  return { version: "sim-mapped-road-profile-v1", intent, coverageAcknowledged: "mapped_restrictions_incomplete", driverDeclaredAuthorization: false,
    ...(intent === "commercial_truck" ? { vehicle: { heightM: 3.2, widthM: 2.5, lengthM: 8, loadedWeightKg: 16000, axleLoadKg: 8000, axleCount: 2 } } : {}),
    ...(intent === "car_with_trailer" ? { vehicle: { heightM: 2, widthM: 2, lengthM: 9, loadedWeightKg: 3000, trailer: { attached: true, heightM: 2, widthM: 2, lengthM: 4, loadedWeightKg: 1000 } } } : {}) };
}
function fixture(intent: MappedVehicleProfile["intent"] = "car") {
  const request: RoutingRouteRequest = { ...structuredClone(sample.request), vehicleProfile: profile(intent) };
  const response = structuredClone(sample.response);
  response.query.vehicleProfile = structuredClone(request.vehicleProfile);
  for (const r of response.routes) {
    r.knownClosures.requestHash = routingHash(response.query);
    r.knownClosures.engine.version = "3.8.3";
    r.mappedProfileAssessment = { version: "sim-mapped-road-profile-assessment-v1", state: "applied", coverage: "mapped_restrictions_incomplete",
      appliedProfile: structuredClone(request.vehicleProfile), profileHash: routingHash(request.vehicleProfile), requestHash: routingHash(response.query),
      geometryHash: routingHash(r.geometry), engine: { provider: "valhalla", version: "3.8.3", costing: intent === "commercial_truck" ? "truck" : "auto", fallbackUsed: false },
      routingDataset: structuredClone(r.knownClosures.routingDataset), appliedFields: [...(request.vehicleProfile?.vehicle ? dimensions : []),
        ...(intent === "commercial_truck" ? ["axleLoadKg", "axleCount"] : []), ...(intent === "road_legal_4x4" ? ["road_first_preference"] : [])],
      validUntil: r.knownClosures.validUntil, lastMile: { state: "mapped_target", target: { lon: request.to.lon, lat: request.to.lat }, mappedEndpoint: { lon: request.to.lon, lat: request.to.lat }, distanceM: 0 },
      limitations: ["Synthetic mapped restrictions are incomplete."] };
  }
  for (const f of response.features) { f.properties.routeId ??= f.id; const r = response.routes.find((r: any) => r.routeId === f.properties.routeId); f.properties.knownClosures = structuredClone(r.knownClosures); f.properties.mappedProfileAssessment = structuredClone(r.mappedProfileAssessment); }
  return { request, response };
}
const adapter = () => new RoutingSourceAdapter({ baseUrl: "https://fixture.invalid/api/v1", enabled: true, timeoutMs: 1000 });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("ordinary immutable mapped vehicle profiles", () => {
  it("accepts the exact serialized SIM fixture for all four intents and both genuine synthetic variants", async () => {
    const serialized = JSON.parse(readFileSync(new URL("../../../docs/api/examples/mapped-road-profiles-v1.sim-fixture.json", import.meta.url), "utf8"));
    expect(serialized.synthetic).toBe(true); expect(serialized.cases).toHaveLength(4);
    for (const c of serialized.cases) {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json(c.response)));
      const result = await adapter().route(c.request, new Date(c.response.generatedAt));
      expect(result.routes).toHaveLength(2); expect(result.query).toEqual(c.response.query);
      expect(result.routes.map(r => r.mappedProfileAssessment)).toEqual(c.response.routes.map((r: any) => r.mappedProfileAssessment));
    }
  });
  it("keeps the shared fragment exact in binding COP OpenAPI", () => {
    const fragments = JSON.parse(readFileSync(new URL("../../../docs/api/schemas/mapped-road-profile-v1.schemas.json", import.meta.url), "utf8"));
    const openapi = JSON.parse(readFileSync(new URL("../../../openapi/openapi.json", import.meta.url), "utf8"));
    const rename = (value: any): any => Array.isArray(value) ? value.map(rename) : value && typeof value === "object" ?
      Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === "$ref" && typeof v === "string" ? v.replace("#/components/schemas/", "#/components/schemas/RoutingMapped") : rename(v)])) : value;
    for (const [name, schema] of Object.entries(fragments)) expect(openapi.components.schemas[`RoutingMapped${name}`]).toEqual(rename(schema));
  });
  it.each(["car", "commercial_truck", "car_with_trailer", "road_legal_4x4"] as const)("preserves %s and every route-bound assessment", async intent => {
    const f = fixture(intent), fetch = vi.fn(async (_u: unknown, _i?: RequestInit) => Response.json(f.response)); vi.stubGlobal("fetch", fetch);
    const result = await adapter().route(f.request, now);
    expect(result.routes.map(r => r.mappedProfileAssessment)).toEqual(f.response.routes.map((r: any) => r.mappedProfileAssessment));
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).vehicleProfile).toEqual(f.request.vehicleProfile);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["missing acknowledgement", (p: any) => { delete p.coverageAcknowledged; }],
    ["unknown field", (p: any) => { p.ignore_access = true; }],
    ["height outside engine range", (p: any) => { p.vehicle.heightM = 5.1; }],
    ["whole weight below axle", (p: any) => { p.vehicle.axleLoadKg = 17000; }],
    ["missing truck dimensions", (p: any) => { delete p.vehicle; }]
  ])("rejects %s before contacting SIM", async (_name, edit) => {
    const f = fixture("commercial_truck"); (edit as (p: unknown) => void)(f.request.vehicleProfile); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(adapter().route(f.request, now)).rejects.toThrow(/^Routing /); expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects conflicting strict/legacy fields and inconsistent trailer combination", () => {
    const f = fixture("car_with_trailer"); f.request.vehicleProfile!.vehicle!.lengthM = 3;
    expect(() => validateVehicleProfileRequest(f.request)).toThrow("whole combination");
    for (const extra of [{ vehicle: {} }, { trip: {} }, { profileId: "offroad_4x4" }]) {
      expect(() => validateVehicleProfileRequest({ ...fixture().request, ...extra } as RoutingRouteRequest)).toThrow("conflicts");
    }
  });
  const mutations: Array<[string, (f: ReturnType<typeof fixture>) => void]> = [
    ["missing assessment", f => { delete f.response.routes[1].mappedProfileAssessment; }],
    ["profile echo", f => { f.response.routes[0].mappedProfileAssessment.appliedProfile.intent = "car"; }],
    ["profile hash", f => { f.response.routes[0].mappedProfileAssessment.profileHash = routingHash("other"); }],
    ["request hash", f => { f.response.routes[0].mappedProfileAssessment.requestHash = routingHash("other"); }],
    ["geometry hash", f => { f.response.routes[0].mappedProfileAssessment.geometryHash = routingHash("other"); }],
    ["wrong costing", f => { f.response.routes[0].mappedProfileAssessment.engine.costing = "auto"; }],
    ["direct fallback", f => { f.response.routes[0].mappedProfileAssessment.engine.fallbackUsed = true; }],
    ["closure engine disagreement", f => { for (const r of f.response.routes) r.knownClosures.engine.version = "other"; for (const ft of f.response.features) ft.properties.knownClosures.engine.version = "other"; }],
    ["unapproved engine", f => { f.response.routes[0].mappedProfileAssessment.engine.version = "future"; }],
    ["different graph", f => { f.response.routes[0].mappedProfileAssessment.routingDataset.version = "other"; }],
    ["expired", f => { f.response.routes[0].mappedProfileAssessment.validUntil = "2026-10-03T11:59:00Z"; }],
    ["past source expiry", f => { f.response.routes[0].mappedProfileAssessment.validUntil = "2026-10-03T12:11:00Z"; }],
    ["lost axle", f => { f.response.routes[0].mappedProfileAssessment.appliedFields.pop(); }],
    ["forged target", f => { f.response.routes[0].mappedProfileAssessment.lastMile.target.lon += 0.001; }],
    ["forged endpoint", f => { f.response.routes[0].mappedProfileAssessment.lastMile.mappedEndpoint.lon += 0.001; }],
    ["forged distance", f => { f.response.routes[0].mappedProfileAssessment.lastMile.distanceM = 1; }],
    ["false endpoint state", f => { f.response.routes[0].mappedProfileAssessment.lastMile.state = "target_guidance_only"; }],
    ["feature assessment", f => { f.response.features[0].properties.mappedProfileAssessment.profileHash = routingHash("other"); }],
    ["no closures", f => { for (const r of f.response.routes) delete r.knownClosures; for (const ft of f.response.features) delete ft.properties.knownClosures; }]
  ];
  it.each(mutations)("rejects %s without a substitute route", async (_name, edit) => {
    const f = fixture("commercial_truck"); edit(f); const fetch = vi.fn(async () => Response.json(f.response)); vi.stubGlobal("fetch", fetch);
    await expect(adapter().route(f.request, now)).rejects.toBeInstanceOf(VehicleProfileVerificationError); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("preserves displaced target guidance without appending it to the road geometry", async () => {
    const f = fixture("road_legal_4x4");
    for (const r of f.response.routes) {
      const end = r.geometry.coordinates.at(-1); end[0] -= 0.00005;
      const a = r.mappedProfileAssessment;
      r.knownClosures.geometryHash = routingHash(r.geometry); a.geometryHash = routingHash(r.geometry);
      a.lastMile.mappedEndpoint = { lon: end[0], lat: end[1] }; a.lastMile.state = "target_guidance_only";
      const h = Math.cos(end[1] * Math.PI / 180) ** 2 * Math.sin((end[0] - f.request.to.lon) * Math.PI / 360) ** 2;
      a.lastMile.distanceM = 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }
    for (const ft of f.response.features) { const r = f.response.routes.find((r: any) => r.routeId === ft.properties.routeId); ft.geometry = structuredClone(r.geometry); ft.properties.knownClosures = structuredClone(r.knownClosures); ft.properties.mappedProfileAssessment = structuredClone(r.mappedProfileAssessment); }
    const fetch = vi.fn(async () => Response.json(f.response)); vi.stubGlobal("fetch", fetch);
    const result = await adapter().route(f.request, now);
    expect(result.routes[0]!.mappedProfileAssessment!.lastMile.state).toBe("target_guidance_only");
    expect(result.routes[0]!.mappedProfileAssessment!.lastMile.distanceM).toBeGreaterThan(3);
    expect(result.routes[0]!.geometry).toEqual(f.response.routes[0].geometry);
    for (const r of f.response.routes) r.mappedProfileAssessment.lastMile.state = "mapped_target";
    await expect(adapter().route(f.request, now)).rejects.toBeInstanceOf(VehicleProfileVerificationError);
  });
  it("rejects an unsolicited assessment", async () => {
    const f = fixture(); delete f.request.vehicleProfile; delete f.response.query.vehicleProfile;
    for (const r of f.response.routes) r.knownClosures.requestHash = routingHash(f.response.query);
    for (const ft of f.response.features) ft.properties.knownClosures.requestHash = routingHash(f.response.query);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(f.response)));
    await expect(adapter().route(f.request, now)).rejects.toBeInstanceOf(VehicleProfileVerificationError);
  });
  it("rejects an unsolicited assessment placed only in map features", async () => {
    const f = fixture(); delete f.request.vehicleProfile; delete f.response.query.vehicleProfile;
    for (const r of f.response.routes) { delete r.mappedProfileAssessment; r.knownClosures.requestHash = routingHash(f.response.query); }
    for (const ft of f.response.features) ft.properties.knownClosures.requestHash = routingHash(f.response.query);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(f.response)));
    await expect(adapter().route(f.request, now)).rejects.toBeInstanceOf(VehicleProfileVerificationError);
  });
  it("rejects duplicate catalog intents and fictitious costing/fields", () => {
    const intents = ["car", "commercial_truck", "car_with_trailer", "road_legal_4x4"] as const;
    const caps = { version: "sim-mapped-road-profile-capabilities-v1", availability: "requires_runtime_validation", maxSnapDistanceM: 25,
      driverDeclaredAuthorization: "unsupported", unmappedLastMile: "unsupported", strictGuarantees: false,
      intents: intents.map(intent => ({ intent, costing: intent === "commercial_truck" ? "truck" : "auto", limitations: ["Incomplete"],
        supportedFields: [...dimensions, ...(intent === "commercial_truck" ? ["axleLoadKg", "axleCount"] : []), ...(intent === "car_with_trailer" ? ["whole_combination", "trailer_facts"] : []), ...(intent === "road_legal_4x4" ? ["road_first_preference", "mapped_endpoint_guidance"] : [])] })) };
    expect(verifiedMappedCapabilities(caps)).toEqual(caps);
    const duplicate = structuredClone(caps); duplicate.intents[3] = duplicate.intents[0]!;
    expect(() => verifiedMappedCapabilities(duplicate)).toThrow(VehicleProfileVerificationError);
    const wrong = structuredClone(caps); wrong.intents[0]!.supportedFields.push("ignore_access");
    expect(() => verifiedMappedCapabilities(wrong)).toThrow(VehicleProfileVerificationError);
  });
});
