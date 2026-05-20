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
      limit: 20
    }, new Date("2026-05-20T10:00:06Z"));

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://sim.zeleznalady.cz/situation-data/api/v1/layers");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://sim.zeleznalady.cz/situation-data/api/v1/cop/features?bbox=13.85%2C49.65%2C15.35%2C50.45&layers=weather%2Ctraffic&limit=20"
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
            sourceId: "open_meteo"
          }
        }
      ],
      summary: {
        featureCount: 1,
        staleFeatureCount: 0
      }
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
          sourceId: "open_meteo",
          stale: false
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
        sourceId: "open_meteo"
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
