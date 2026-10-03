import { describe, expect, it, vi } from "vitest";
import { KnownClosureVerificationError } from "./routing-known-closures.js";
import { buildServer } from "./server.js";
import {
  RoutingSourceAdapter,
  RoutingHttpError,
  type RoutingRouteRequest,
  type RoutingRouteResponse,
  type RoutingSource
} from "./routing-source.js";

describe("routing routes", () => {
  it("preserves SIM safety status, machine code and Retry-After without disclosing its endpoint or using fallback", async () => {
    const source: RoutingSource = {
      config: { baseUrl: "https://private-sim.test/api/v1", enabled: true, timeoutMs: 5000 },
      route: vi.fn(), alternatives: vi.fn(), fetchProfiles: vi.fn(), isochrone: vi.fn(), nearestAccess: vi.fn()
    };
    const app = buildServer({ routingSource: source });
    try {
      for (const status of [422, 429, 503, 502]) {
        const mock = vi.mocked(source.route);
        mock.mockRejectedValueOnce(new RoutingHttpError(status, "Failed", new URL("https://private-sim.test/api/v1/routing/alternatives"),
          "upstream sensitive diagnostic", "ROUTING_CLOSURES_UNAVAILABLE", "30"));
        const response = await app.inject({ method: "POST", url: "/api/v1/routing/route", headers: { authorization: "Bearer dev-lab-token" },
          payload: { from: { lat: 50, lon: 14 }, to: { lat: 51, lon: 15 }, profileId: "car" } });
        expect(response.statusCode).toBe(status);
        expect(response.json().error.code).toBe("ROUTING_CLOSURES_UNAVAILABLE");
        expect(response.body).not.toContain("private-sim.test");
        expect(response.body).not.toContain("sensitive diagnostic");
        expect(response.json()).not.toHaveProperty("routes");
        if (status === 429) expect(response.headers["retry-after"]).toBe("30");
      }
      expect(source.route).toHaveBeenCalledTimes(4);
      expect(source.alternatives).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it("returns a structured known-closure verification failure for both endpoints without substitute routes", async () => {
    const source: RoutingSource = {
      config: { baseUrl: "https://fixture.invalid/api/v1", enabled: true, timeoutMs: 1000 },
      route: vi.fn().mockRejectedValue(new KnownClosureVerificationError()),
      alternatives: vi.fn().mockRejectedValue(new KnownClosureVerificationError()),
      fetchProfiles: vi.fn(), isochrone: vi.fn(), nearestAccess: vi.fn()
    };
    const app = buildServer({ routingSource: source });
    try {
      for (const endpoint of ["route", "alternatives"]) {
        const response = await app.inject({ method: "POST", url: `/api/v1/routing/${endpoint}`,
          headers: { authorization: "Bearer dev-lab-token", "x-correlation-id": "known-closure-test" },
          payload: { from: { lat: 50, lon: 14 }, to: { lat: 50.1, lon: 14.1 }, profileId: "car" } });
        expect(response.statusCode).toBe(502);
        expect(response.json().error.code).toBe("ROUTING_KNOWN_CLOSURES_INVALID");
        expect(response.json().error.correlationId).toBe("known-closure-test");
        expect(response.json()).not.toHaveProperty("routes");
      }
      expect(source.route).toHaveBeenCalledTimes(1);
      expect(source.alternatives).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });
  it("requires authentication before forwarding a routing request", async () => {
    const source: RoutingSource = {
      config: { baseUrl: "https://sim.test/api/v1", enabled: true, timeoutMs: 5000 },
      route: vi.fn(), alternatives: vi.fn(), fetchProfiles: vi.fn(), isochrone: vi.fn(), nearestAccess: vi.fn()
    };
    const app = buildServer({ routingSource: source });
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/routing/route",
        payload: { from: { lat: 50, lon: 14 }, to: { lat: 51, lon: 15 }, profileId: "car" } });
      expect(response.statusCode).toBe(401);
      expect(source.route).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it("passes only tunnel intervals verified for the corresponding variant and dataset", async () => {
    const dataset = { version: "sim-routing-test", builtAt: "2026-09-23T00:00:00Z" };
    const shape = [[14.42, 50.08], [14.4205, 50.08], [14.421, 50.08]];
    const route = (routeId: string, tunnelRouteId: string, endShapeIndex: number) => ({
      routeId,
      quality: { mode: "engine_route" },
      geometry: { type: "LineString", coordinates: shape },
      roadAttributes: {
        state: "ok", source: "valhalla_trace_attributes", observedAt: "2026-09-23T12:00:00Z",
        routingDataset: dataset, matchedEdgeCount: 2, geometryMismatchCount: 0,
        knownSpeedLimitCoveragePercent: 0, vehicleRestrictionsState: "not_evaluated",
        speedLimits: [], restrictions: [],
        tunnels: {
          state: "known", routeId: tunnelRouteId,
          source: "valhalla_trace_attributes.edge.tunnel", routingDataset: dataset,
          observedAt: "2026-09-23T12:00:00Z",
          intervals: [{ beginShapeIndex: 1, endShapeIndex, direction: "along_route" }]
        }
      }
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      coverage: { state: "covered", routingDataset: dataset },
      routes: [route("primary", "primary", 2), route("alternative", "primary", 2), route("bad-index", "bad-index", 9)],
      features: [], warnings: []
    }), { status: 200, headers: { "content-type": "application/json" } })));
    try {
      const source = new RoutingSourceAdapter({ baseUrl: "https://sim.example/internal", enabled: true, timeoutMs: 5000 });
      const response = await source.route({ from: { lat: 50.08, lon: 14.42 }, to: { lat: 50.08, lon: 14.421 } }, new Date());
      expect(response.routes[0]?.roadAttributes?.tunnels).toMatchObject({ state: "known", routeId: "primary", intervals: [{ beginShapeIndex: 1, endShapeIndex: 2 }] });
      expect(response.routes[1]?.roadAttributes?.tunnels).toMatchObject({ state: "unknown", routeId: "alternative", intervals: [] });
      expect(response.routes[2]?.roadAttributes?.tunnels).toMatchObject({ state: "unknown", routeId: "bad-index", intervals: [] });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not disclose the internal SIM endpoint in public dependency health", async () => {
    const routingSource: RoutingSource = {
      config: { baseUrl: "https://private-sim.example/internal-routing", enabled: true, timeoutMs: 5000 },
      alternatives: vi.fn(),
      fetchProfiles: vi.fn(),
      isochrone: vi.fn(),
      nearestAccess: vi.fn(),
      route: vi.fn()
    };
    const app = buildServer({ routingSource });
    try {
      const response = await app.inject({ method: "GET", url: "/health/dependencies" });
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain("private-sim.example");
      expect(response.body).not.toContain("internal-routing");
      expect(response.json().dependencies).toContainEqual({
        detail: "enabled; server-side routing configured",
        name: "sim-routing-source",
        status: "ok"
      });
    } finally {
      await app.close();
    }
  });

  it("proxies emergency routes through the server-side SIM routing source", async () => {
    const routeMock = vi.fn(async (request: RoutingRouteRequest): Promise<RoutingRouteResponse> => ({
      contractVersion: "sim-emergency-routing-v1",
      features: [
        {
          geometry: {
            coordinates: [
              [17.36, 50.12],
              [17.38, 50.13]
            ],
            type: "LineString"
          },
          properties: { routeId: "primary", role: "primary" },
          type: "Feature"
        }
      ],
      generatedAt: "2026-07-05T17:00:00.000Z",
      providerId: "sim.situation-data.routing",
      quality: { confidence: 0.86, engine: "valhalla", mode: "engine_route" },
      coverage: {
        state: "covered",
        routingDataset: { version: "sim-routing-2026-09-13-1789268424", builtAt: "2026-09-13T00:00:00Z" }
      },
      routes: [
        {
          distanceM: 2400,
          durationSeconds: 420,
          quality: { confidence: 0.86, engine: "valhalla", mode: "engine_route" },
          rank: 1,
          routeId: "primary",
          roadAttributes: {
            state: "ok",
            source: "valhalla_trace_attributes",
            observedAt: "2026-09-14T18:28:34Z",
            matchedEdgeCount: 1,
            geometryMismatchCount: 0,
            knownSpeedLimitCoveragePercent: 100,
            vehicleRestrictionsState: "not_evaluated",
            restrictions: [],
            speedLimits: [
              {
                beginShapeIndex: 0,
                endShapeIndex: 1,
                direction: "along_route",
                valueKph: 50,
                status: "explicit",
                source: "valhalla_graph_osm_maxspeed"
              }
            ]
          },
          steps: [{ index: 0, maneuverType: 26, roundaboutExitCount: 3, beginShapeIndex: 0, endShapeIndex: 12 }],
          traffic: {
            delayPenaltySeconds: 120,
            incidentCount: 1,
            incidentsOnRoute: [{ id: "closure-1", location: { lat: 50.13, lon: 17.37 } }],
            sourceStatus: "ok"
          },
          warnings: ["Most/úzký průjezd neověřen."]
        }
      ],
      traffic: {
        incidentCount: 1,
        liveSpeeds: {
          ageSeconds: 22,
          appliedEdgeCount: 74361,
          appliedFlowCount: 5374,
          detail: "Limited mapping coverage.",
          enabled: true,
          mappingCoveragePercent: 40.88,
          routingDataset: "sim-routing-2026-09-13-1789268424",
          sourceObservedAt: "2026-09-14T18:23:02Z",
          state: "degraded",
          updatedAt: "2026-09-14T18:28:34Z"
        },
        sourceStatus: "ok"
      },
      warnings: []
    }));
    const routingSource: RoutingSource = {
      config: { baseUrl: "https://sim.example/situation-data/api/v1", enabled: true, timeoutMs: 5000 },
      alternatives: routeMock,
      fetchProfiles: vi.fn(async () => ({ profiles: [], warnings: [] })),
      isochrone: vi.fn(async () => ({ features: [] })),
      nearestAccess: vi.fn(async () => ({ features: [] })),
      route: routeMock
    };
    const app = buildServer({
      now: () => new Date("2026-07-05T17:00:00.000Z"),
      routingSource
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      payload: {
        alternatives: 2,
        avoid: ["road_closure"],
        from: { label: "moje poloha", lat: 50.12, lon: 17.36 },
        includeSteps: true,
        includeRoadAttributes: true,
        profileId: "emergency_vehicle",
        to: { label: "Mnichov - Černá Opava", lat: 50.15077, lon: 17.37303 }
      },
      method: "POST",
      url: "/api/v1/routing/route"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().routes[0].steps).toEqual([
      { index: 0, maneuverType: 26, roundaboutExitCount: 3, beginShapeIndex: 0, endShapeIndex: 12 }
    ]);
    expect(routeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        alternatives: 2,
        avoid: ["road_closure"],
        includeSteps: true,
        includeRoadAttributes: true,
        profileId: "emergency_vehicle",
        from: expect.objectContaining({ lat: 50.12, lon: 17.36 }),
        to: expect.objectContaining({ lat: 50.15077, lon: 17.37303 })
      }),
      new Date("2026-07-05T17:00:00.000Z")
    );
    expect(response.json()).toMatchObject({
      providerId: "sim.situation-data.routing",
      quality: { mode: "engine_route" },
      routes: [expect.objectContaining({ distanceM: 2400, durationSeconds: 420 })],
      coverage: {
        state: "covered",
        routingDataset: { version: "sim-routing-2026-09-13-1789268424", builtAt: "2026-09-13T00:00:00Z" }
      },
      traffic: {
        incidentCount: 1,
        liveSpeeds: {
          appliedEdgeCount: 74361,
          mappingCoveragePercent: 40.88,
          state: "degraded"
        }
      }
    });
    expect(response.json().routes[0].roadAttributes.speedLimits[0]).toMatchObject({ valueKph: 50, status: "explicit" });
  });

  it("never passes SIM direct fallback geometry as a navigable route", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            features: [
              {
                type: "Feature",
                properties: { routeId: "direct-1" },
                geometry: {
                  type: "LineString",
                  coordinates: [
                    [14.42, 50.08],
                    [14.45, 50.09]
                  ]
                }
              },
              {
                type: "Feature",
                properties: { routeId: "invalid-steps" },
                geometry: { type: "LineString", coordinates: [[14.42, 50.08], [14.45, 50.09]] }
              }
            ],
            routes: [
              { routeId: "direct-1", durationSeconds: 100, quality: { mode: "direct_fallback" } },
              { routeId: "invalid-steps", status: "unavailable", quality: { mode: "engine_route" } }
            ],
            warnings: []
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    const routingSource = new RoutingSourceAdapter({
      baseUrl: "https://private-sim.example/internal",
      enabled: true,
      timeoutMs: 5000
    });
    const app = buildServer({ routingSource });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/routing/route",
        headers: { authorization: "Bearer dev-lab-token" },
        payload: { from: { lat: 50.08, lon: 14.42 }, to: { lat: 50.09, lon: 14.45 } }
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ coverage: { state: "outside_coverage" }, routes: [], features: [] });
      expect(response.body).not.toContain("private-sim.example");
    } finally {
      vi.unstubAllGlobals();
      await app.close();
    }
  });

  it("proxies SIM routing profiles, alternatives, isochrone and nearest-access endpoints", async () => {
    const routingSource: RoutingSource = {
      config: { baseUrl: "https://sim.example/situation-data/api/v1", enabled: true, timeoutMs: 5000 },
      alternatives: vi.fn(async () => ({
        features: [],
        quality: { engine: "valhalla", mode: "engine_route" },
        routes: [
          { rank: 1, routeId: "primary" },
          { rank: 2, routeId: "alt-1" }
        ],
        warnings: []
      })),
      fetchProfiles: vi.fn(async () => ({
        profiles: [{ profileId: "car" }, { profileId: "emergency_vehicle" }, { profileId: "walking" }],
        warnings: []
      })),
      isochrone: vi.fn(async (request) => ({
        features: [
          {
            geometry: {
              coordinates: [
                [
                  [17.36, 50.12],
                  [17.37, 50.12],
                  [17.36, 50.13],
                  [17.36, 50.12]
                ]
              ],
              type: "Polygon"
            },
            properties: { role: "isochrone" },
            type: "Feature"
          }
        ],
        request
      })),
      nearestAccess: vi.fn(async (request) => ({
        features: [
          { geometry: { coordinates: [17.36, 50.12], type: "Point" }, properties: { role: "access" }, type: "Feature" }
        ],
        request
      })),
      route: vi.fn(async () => ({ features: [], routes: [], warnings: [] }))
    };
    const app = buildServer({
      now: () => new Date("2026-07-05T17:00:00.000Z"),
      routingSource
    });

    const profiles = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/routing/profiles"
    });
    expect(profiles.statusCode).toBe(200);
    expect(profiles.json().profiles).toContainEqual({ profileId: "car" });

    const alternatives = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      payload: {
        alternatives: 3,
        avoid: ["road_closure"],
        from: { lat: 50.12, lon: 17.36 },
        includeSteps: true,
        profileId: "walking",
        to: { lat: 50.15, lon: 17.37 }
      },
      method: "POST",
      url: "/api/v1/routing/alternatives"
    });
    expect(alternatives.statusCode).toBe(200);
    expect(routingSource.alternatives).toHaveBeenCalledWith(
      expect.objectContaining({ alternatives: 3, includeSteps: true, profileId: "walking" }),
      new Date("2026-07-05T17:00:00.000Z")
    );
    expect(alternatives.json()).toMatchObject({ routes: [{ rank: 1 }, { rank: 2 }] });

    const isochrone = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      payload: { center: { lat: 50.12, lon: 17.36 }, profileId: "walking", rangeSeconds: 900 },
      method: "POST",
      url: "/api/v1/routing/isochrone"
    });
    expect(isochrone.statusCode).toBe(200);
    expect(routingSource.isochrone).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: "walking", rangeSeconds: 900 }),
      new Date("2026-07-05T17:00:00.000Z")
    );

    const nearestAccess = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      payload: { point: { lat: 50.12, lon: 17.36 }, profileId: "offroad_4x4" },
      method: "POST",
      url: "/api/v1/routing/nearest-access"
    });
    expect(nearestAccess.statusCode).toBe(200);
    expect(routingSource.nearestAccess).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: "offroad_4x4" }),
      new Date("2026-07-05T17:00:00.000Z")
    );
  });

  it("returns a clear validation error when route coordinates are missing", async () => {
    const routingSource: RoutingSource = {
      config: { baseUrl: "https://sim.example/situation-data/api/v1", enabled: true, timeoutMs: 5000 },
      alternatives: vi.fn(),
      fetchProfiles: vi.fn(async () => ({ profiles: [], warnings: [] })),
      isochrone: vi.fn(async () => ({ features: [] })),
      nearestAccess: vi.fn(async () => ({ features: [] })),
      route: vi.fn(async () => {
        throw new Error("Routing from point requires finite lat/lon.");
      })
    };
    const app = buildServer({ routingSource });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      payload: { from: {}, to: { lat: 50.1, lon: 17.1 } },
      method: "POST",
      url: "/api/v1/routing/route"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: expect.objectContaining({
        code: "VALIDATION_ERROR"
      })
    });
  });
});
