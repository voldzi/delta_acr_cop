import { describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import type { RoutingRouteRequest, RoutingRouteResponse, RoutingSource } from "./routing-source.js";

describe("routing routes", () => {
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
      routes: [
        {
          distanceM: 2400,
          durationSeconds: 420,
          quality: { confidence: 0.86, engine: "valhalla", mode: "engine_route" },
          rank: 1,
          routeId: "primary",
          traffic: {
            delayPenaltySeconds: 120,
            incidentCount: 1,
            incidentsOnRoute: [{ id: "closure-1", location: { lat: 50.13, lon: 17.37 } }],
            sourceStatus: "ok"
          },
          warnings: ["Most/úzký průjezd neověřen."]
        }
      ],
      traffic: { incidentCount: 1, sourceStatus: "ok" },
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
        profileId: "emergency_vehicle",
        to: { label: "Mnichov - Černá Opava", lat: 50.15077, lon: 17.37303 }
      },
      method: "POST",
      url: "/api/v1/routing/route"
    });

    expect(response.statusCode).toBe(200);
    expect(routeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        alternatives: 2,
        avoid: ["road_closure"],
        includeSteps: true,
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
      traffic: { incidentCount: 1 }
    });
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
