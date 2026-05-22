import { afterEach, describe, expect, it, vi } from "vitest";
import { TakGatewaySourceAdapter } from "./tak-gateway-source.js";

describe("TakGatewaySourceAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("proxies TAK Gateway features with server-side bearer token", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer sim-read-token" });
      return new Response(JSON.stringify(sampleTakFeatureCollection()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new TakGatewaySourceAdapter({
      baseUrl: "https://sim.zeleznalady.cz/tak-gateway/api/v1/",
      cacheTtlMs: 5000,
      enabled: true,
      maxLimit: 250,
      readToken: "sim-read-token",
      staleIfErrorMs: 60000,
      timeoutMs: 7000
    });

    const features = await adapter.fetchFeatures({
      bbox: { east: 15.35, north: 50.45, south: 49.65, west: 13.85 },
      layers: ["mobile"],
      limit: 20
    }, new Date("2026-05-21T06:00:05Z"));

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://sim.zeleznalady.cz/tak-gateway/api/v1/features?bbox=13.5%2C49.5%2C15.75%2C50.75&layers=mobile&limit=20"
    );
    expect(features).toMatchObject({
      contractVersion: "cop-tak-source-v1",
      features: [
        {
          properties: {
            affiliation: "friend",
            featureId: "tak:cot:TAK-ARDOS-001",
            label: "ARDOS Alpha",
            layer: "mobile",
            sourceId: "tak_gateway"
          }
        }
      ],
      summary: {
        affiliationCounts: { friend: 1, hostile: 0, neutral: 0, unknown: 0 },
        featureCount: 1,
        staleFeatureCount: 0
      }
    });
    expect(features.cache).toMatchObject({
      status: "miss",
      upstreamBbox: { east: 15.75, north: 50.75, south: 49.5, west: 13.5 }
    });
    expect(features.query.bbox).toEqual({ east: 15.35, north: 50.45, south: 49.65, west: 13.85 });
  });

  it("serves stale cached TAK Gateway data briefly when upstream refresh fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-21T06:00:00Z"));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(sampleTakFeatureCollection()), { status: 200 }))
      .mockRejectedValueOnce(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new TakGatewaySourceAdapter({
      baseUrl: "https://sim.zeleznalady.cz/tak-gateway/api/v1",
      cacheTtlMs: 1000,
      enabled: true,
      maxLimit: 250,
      readToken: "sim-read-token",
      staleIfErrorMs: 60000,
      timeoutMs: 7000
    });
    const query = {
      bbox: { east: 14.5, north: 50.2, south: 50, west: 14.3 },
      layers: ["mobile" as const],
      limit: 20
    };

    const fresh = await adapter.fetchFeatures(query, new Date("2026-05-21T06:00:00Z"));
    vi.setSystemTime(new Date("2026-05-21T06:00:02Z"));
    const stale = await adapter.fetchFeatures(query, new Date("2026-05-21T06:00:02Z"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fresh.cache?.status).toBe("miss");
    expect(stale.cache?.status).toBe("stale");
    expect(stale.warnings).toContain("COP served stale TAK Gateway cache because SIM refresh failed.");
  });

  it("reports token rejection as a configuration problem", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new TakGatewaySourceAdapter({
      baseUrl: "https://sim.zeleznalady.cz/tak-gateway/api/v1",
      cacheTtlMs: 5000,
      enabled: true,
      maxLimit: 250,
      readToken: "wrong",
      staleIfErrorMs: 60000,
      timeoutMs: 7000
    });

    await expect(adapter.fetchFeatures({
      bbox: { east: 14.5, north: 50.2, south: 50, west: 14.3 },
      layers: ["mobile"],
      limit: 20
    }, new Date("2026-05-21T06:00:00Z"))).rejects.toThrow("COP_TAK_GATEWAY_READ_TOKEN");
  });
});

function sampleTakFeatureCollection() {
  return {
    contractVersion: "cop-tak-source-v1",
    features: [
      {
        geometry: {
          coordinates: [14.421, 50.087],
          type: "Point"
        },
        id: "tak:cot:TAK-ARDOS-001",
        properties: {
          affiliation: "friend",
          category: "tak_unit",
          confidence: 0.95,
          featureId: "tak:cot:TAK-ARDOS-001",
          label: "ARDOS Alpha",
          layer: "mobile",
          metrics: {
            speedMps: 4.2
          },
          observedAt: "2026-05-21T06:00:00.000Z",
          receivedAt: "2026-05-21T06:00:02.000Z",
          sourceId: "tak_gateway",
          stale: false,
          tags: {
            cotType: "a-f-G-U-C"
          },
          validUntil: "2026-05-21T06:10:00.000Z"
        },
        type: "Feature"
      }
    ],
    generatedAt: "2026-05-21T06:00:00.000Z",
    query: {
      bbox: { east: 15.35, north: 50.45, south: 49.65, west: 13.85 },
      layers: ["mobile"],
      limit: 20
    },
    source: {
      generatedAt: "2026-05-21T06:00:00.000Z",
      sourceId: "tak-gateway-api",
      sourceType: "TAK_COT_GATEWAY"
    },
    sources: [
      {
        enabled: true,
        label: "TAK/CoT gateway",
        layers: ["mobile", "ground", "traffic"],
        mode: "live",
        priority: 20,
        sourceId: "tak_gateway",
        updateCadenceSeconds: 15
      }
    ],
    summary: {
      affiliationCounts: { friend: 1, hostile: 0, neutral: 0, unknown: 0 },
      eventCount: 1,
      featureCount: 1,
      sourceCount: 1,
      staleFeatureCount: 0,
      warningCount: 0
    },
    type: "FeatureCollection",
    warnings: []
  };
}
