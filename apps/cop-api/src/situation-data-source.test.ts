import { afterEach, describe, expect, it, vi } from "vitest";
import { SituationDataSourceAdapter } from "./situation-data-source.js";

describe("SituationDataSourceAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("proxies SIM situation-data layers and context features without forwarding authorization", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(init?.headers).not.toMatchObject({ Authorization: expect.any(String) });
      if (url.endsWith("/layers")) {
        return new Response(JSON.stringify(sampleLayersResponse()), { status: 200 });
      }
      return new Response(JSON.stringify(sampleFeatureCollection()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new SituationDataSourceAdapter({
      baseUrl: "https://sim.zeleznalady.cz/situation-data/api/v1/",
      cacheTtlMs: 20000,
      enabled: true,
      maxLimit: 250,
      timeoutMs: 7000
    });

    const layers = await adapter.fetchLayers(new Date("2026-05-20T10:00:05Z"));
    const features = await adapter.fetchFeatures({
      bbox: { east: 15.35, north: 50.45, south: 49.65, west: 13.85 },
      layers: ["weather", "traffic"],
      limit: 20,
      sources: ["aviation_weather"]
    }, new Date("2026-05-20T10:00:06Z"));

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://sim.zeleznalady.cz/situation-data/api/v1/layers");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://sim.zeleznalady.cz/situation-data/api/v1/cop/features?bbox=13.5%2C49.5%2C15.75%2C50.75&layers=weather%2Ctraffic&limit=20&source=aviation_weather"
    );
    expect(layers).toMatchObject([
      {
        defaultVisible: true,
        label: "Weather",
        layerId: "weather"
      }
    ]);
    expect(features).toMatchObject({
      contractVersion: "cop-situation-source-v1",
      features: [
        {
          geometry: { coordinates: [14.42, 50.08], type: "Point" },
          properties: {
            category: "weather.current",
            featureId: "weather:prague",
            label: "Praha weather",
            layer: "weather",
            sourceId: "aviation_weather",
            validUntil: "2026-05-20T11:00:00Z"
          }
        }
      ],
      summary: {
        featureCount: 1,
        staleFeatureCount: 0
      }
    });
    expect(features.cache).toMatchObject({
      status: "miss",
      upstreamBbox: { east: 15.75, north: 50.75, south: 49.5, west: 13.5 }
    });
    expect(features.query.bbox).toEqual({ east: 15.35, north: 50.45, south: 49.65, west: 13.85 });
    expect(features.query.sources).toEqual(["aviation_weather"]);
  });

  it("proxies SIM situation-data source descriptors", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(sampleSourcesResponse()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new SituationDataSourceAdapter({
      baseUrl: "https://sim.zeleznalady.cz/situation-data/api/v1",
      cacheTtlMs: 20000,
      enabled: true,
      maxLimit: 250,
      timeoutMs: 7000
    });

    const sources = await adapter.fetchSources(new Date("2026-05-20T10:00:05Z"));

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://sim.zeleznalady.cz/situation-data/api/v1/sources");
    expect(sources).toMatchObject([
      {
        enabled: true,
        label: "NOAA AWC METAR/TAF aviation weather",
        layers: ["weather"],
        sourceId: "aviation_weather"
      },
      {
        enabled: false,
        label: "ARDOS partner field operations",
        layers: ["ground", "mobile", "traffic"],
        sourceId: "ardos_partner"
      }
    ]);
  });

  it("reuses canonical viewport cache for small map pans", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(sampleFeatureCollection()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new SituationDataSourceAdapter({
      baseUrl: "https://sim.zeleznalady.cz/situation-data/api/v1",
      cacheTtlMs: 20000,
      enabled: true,
      maxLimit: 250,
      timeoutMs: 7000
    });

    const first = await adapter.fetchFeatures({
      bbox: { east: 14.485, north: 50.019, south: 49.988, west: 14.423 },
      layers: ["mobile"],
      limit: 10
    }, new Date("2026-05-20T10:00:06Z"));
    const second = await adapter.fetchFeatures({
      bbox: { east: 14.486, north: 50.02, south: 49.989, west: 14.424 },
      layers: ["mobile"],
      limit: 10
    }, new Date("2026-05-20T10:00:07Z"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.cache?.status).toBe("miss");
    expect(second.cache?.status).toBe("hit");
    expect(adapter.cacheStats()).toMatchObject({
      entries: 1,
      hits: 1,
      misses: 1,
      refreshes: 1
    });
  });
});

function sampleLayersResponse() {
  return {
    items: [
      {
        defaultVisible: true,
        description: "Weather context.",
        expectedCadenceSeconds: 600,
        geometryTypes: ["Point"],
        label: "Weather",
        layerId: "weather"
      }
    ]
  };
}

function sampleFeatureCollection() {
  return {
    contractVersion: "cop-situation-source-v1",
    features: [
      {
        geometry: {
          coordinates: [14.42, 50.08],
          type: "Point"
        },
        properties: {
          category: "weather.current",
          confidence: 0.94,
          featureId: "weather:prague",
          label: "Praha weather",
          layer: "weather",
          license: {
            attribution: "Open-Meteo",
            name: "CC BY 4.0"
          },
          metrics: {
            temperatureC: 19.2,
            windMps: 4.1
          },
          observedAt: "2026-05-20T10:00:00Z",
            sourceId: "aviation_weather",
            stale: false,
            validUntil: "2026-05-20T11:00:00Z"
        },
        type: "Feature"
      }
    ],
    generatedAt: "2026-05-20T10:00:00Z",
    query: {
      bbox: { east: 15.35, north: 50.45, south: 49.65, west: 13.85 },
      layers: ["weather", "traffic"],
      limit: 20
    },
    source: {
      generatedAt: "2026-05-20T10:00:00Z",
      sourceId: "situation-data-api",
      sourceType: "PUBLIC_SITUATION_AGGREGATE"
    },
    sources: [
      {
        enabled: true,
        label: "Open-Meteo",
        layers: ["weather"],
        sourceId: "aviation_weather"
      }
    ],
    summary: {
      featureCount: 1,
      sourceCount: 1,
      staleFeatureCount: 0,
      warningCount: 0
    },
    type: "FeatureCollection",
    warnings: []
  };
}

function sampleSourcesResponse() {
  return {
    items: [
      {
        enabled: true,
        label: "NOAA AWC METAR/TAF aviation weather",
        layers: ["weather"],
        mode: "live",
        sourceId: "aviation_weather",
        updateCadenceSeconds: 600
      },
      {
        enabled: false,
        label: "ARDOS partner field operations",
        layers: ["ground", "mobile", "traffic"],
        mode: "live",
        sourceId: "ardos_partner",
        updateCadenceSeconds: 15
      }
    ]
  };
}
