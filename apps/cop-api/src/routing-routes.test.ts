import { describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import type { RoutingRouteRequest, RoutingRouteResponse, RoutingSource } from "./routing-source.js";

describe("routing routes", () => {
  it("proxies emergency routes through the server-side SIM routing source", async () => {
    const routeMock = vi.fn(async (request: RoutingRouteRequest): Promise<RoutingRouteResponse> => ({
      contractVersion: "sim-emergency-routing-v1",
      features: [
        {
          geometry: { coordinates: [[17.36, 50.12], [17.38, 50.13]], type: "LineString" },
          properties: { routeId: "primary", role: "primary" },
          type: "Feature"
        }
      ],
      generatedAt: "2026-07-05T17:00:00.000Z",
      providerId: "sim.situation-data.routing",
      quality: { confidence: 0.86, mode: "osm_graph" },
      routes: [
        {
          distanceM: 2400,
          durationSeconds: 420,
          quality: { confidence: 0.86, mode: "osm_graph" },
          routeId: "primary",
          warnings: ["Most/úzký průjezd neověřen."]
        }
      ],
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
        avoid: ["flood", "road_closure"],
        from: { label: "moje poloha", lat: 50.12, lon: 17.36 },
        profileId: "emergency_vehicle",
        to: { label: "Mnichov - Černá Opava", lat: 50.15077, lon: 17.37303 }
      },
      method: "POST",
      url: "/api/v1/routing/route"
    });

    expect(response.statusCode).toBe(200);
    expect(routeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: "emergency_vehicle",
        from: expect.objectContaining({ lat: 50.12, lon: 17.36 }),
        to: expect.objectContaining({ lat: 50.15077, lon: 17.37303 })
      }),
      new Date("2026-07-05T17:00:00.000Z")
    );
    expect(response.json()).toMatchObject({
      providerId: "sim.situation-data.routing",
      quality: { mode: "osm_graph" },
      routes: [expect.objectContaining({ distanceM: 2400, durationSeconds: 420 })]
    });
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
