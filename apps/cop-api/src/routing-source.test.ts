import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRoutingSourceConfigFromEnv,
  createRoutingSourceFromEnv,
  RoutingSourceAdapter
} from "./routing-source.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("routing source configuration", () => {
  it("enables SIM routing by default for the built-in COP/SIM deployment URL", () => {
    const config = createRoutingSourceConfigFromEnv({});

    expect(config).toMatchObject({
      baseUrl: "http://docker.home.cz:5020/situation-data/api/v1",
      enabled: true,
      timeoutMs: 12000
    });
    expect(createRoutingSourceFromEnv({})).toBeTruthy();
  });

  it("allows operators to explicitly disable SIM routing", () => {
    const config = createRoutingSourceConfigFromEnv({ COP_ROUTING_ENABLED: "false" });

    expect(config.enabled).toBe(false);
    expect(createRoutingSourceFromEnv({ COP_ROUTING_ENABLED: "false" })).toBeUndefined();
  });

  it("lets explicit COP routing settings override situation-data defaults", () => {
    expect(
      createRoutingSourceConfigFromEnv({
        COP_ROUTING_ENABLED: "true",
        COP_SITUATION_DATA_ENABLED: "false"
      }).enabled
    ).toBe(true);

    expect(
      createRoutingSourceConfigFromEnv({
        COP_SITUATION_DATA_ENABLED: "false"
      }).enabled
    ).toBe(false);
  });

  it("uses the SIM alternatives endpoint for primary route requests", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        alternatives: 1,
        profileId: "emergency_vehicle"
      });
      return new Response(
        JSON.stringify({
          features: [],
          routes: [{ rank: 1, routeId: "primary" }],
          warnings: []
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new RoutingSourceAdapter({
      baseUrl: "https://sim.example/situation-data/api/v1",
      enabled: true,
      timeoutMs: 5000
    });

    const response = await adapter.route(
      {
        from: { lat: 50.12, lon: 17.36 },
        profileId: "emergency_vehicle",
        to: { lat: 50.15, lon: 17.37 }
      },
      new Date("2026-07-09T08:00:00.000Z")
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://sim.example/situation-data/api/v1/routing/alternatives");
    expect(response.routes).toEqual([{ rank: 1, routeId: "primary" }]);
  });

  it("passes every typed live-speed field through from SIM without loss", async () => {
    const liveSpeeds = {
      ageSeconds: 22,
      appliedEdgeCount: 74361,
      appliedFlowCount: 5374,
      detail: "No sufficiently covered set of fresh mapped TPEG2 speeds was available.",
      dynamicRevision: "revision-kept-for-forward-compatibility",
      enabled: true,
      mappingCoveragePercent: 40.88,
      routingDataset: "sim-routing-2026-09-13-1789268424",
      sourceObservedAt: "2026-09-14T18:23:02Z",
      state: "degraded",
      updatedAt: "2026-09-14T18:28:34Z"
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              features: [],
              routes: [{ durationSeconds: 859, profileId: "car", routeId: "primary" }],
              traffic: { incidentCount: 0, liveSpeeds },
              warnings: []
            }),
            { headers: { "content-type": "application/json" }, status: 200 }
          )
      )
    );
    const adapter = new RoutingSourceAdapter({
      baseUrl: "https://sim.example/situation-data/api/v1",
      enabled: true,
      timeoutMs: 5000
    });

    const response = await adapter.route(
      {
        from: { lat: 50.0755, lon: 14.4378 },
        profileId: "car",
        to: { lat: 50.087, lon: 14.4208 }
      },
      new Date("2026-09-14T18:28:53.425Z")
    );

    expect(response.traffic?.liveSpeeds).toStrictEqual(liveSpeeds);
    expect(response.routes[0]?.durationSeconds).toBe(859);
  });

  it("includes SIM error details in upstream routing failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: "Unsupported profileId test_profile" } }), {
            headers: { "content-type": "application/json" },
            status: 400,
            statusText: "Bad Request"
          })
      )
    );
    const adapter = new RoutingSourceAdapter({
      baseUrl: "https://sim.example/situation-data/api/v1",
      enabled: true,
      timeoutMs: 5000
    });

    await expect(
      adapter.alternatives(
        {
          from: { lat: 50.12, lon: 17.36 },
          profileId: "test_profile",
          to: { lat: 50.15, lon: 17.37 }
        },
        new Date("2026-07-09T08:00:00.000Z")
      )
    ).rejects.toThrow("Unsupported profileId test_profile");
  });
});
