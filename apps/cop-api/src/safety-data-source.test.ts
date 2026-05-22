import { afterEach, describe, expect, it, vi } from "vitest";
import { SafetyDataSourceAdapter } from "./safety-data-source.js";

describe("SafetyDataSourceAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("proxies SIM safety-data metadata and features without forwarding authorization", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(init?.headers).not.toMatchObject({ Authorization: expect.any(String) });
      if (url.endsWith("/catalog")) {
        return new Response(JSON.stringify(sampleCatalogResponse()), { status: 200 });
      }
      if (url.endsWith("/config")) {
        return new Response(JSON.stringify(sampleConfigResponse()), { status: 200 });
      }
      return new Response(JSON.stringify(sampleFeatureCollection()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new SafetyDataSourceAdapter({
      baseUrl: "https://sim.zeleznalady.cz/safety-data/api/v1/",
      cacheTtlMs: 120000,
      enabled: true,
      maxLimit: 250,
      timeoutMs: 7000
    });

    const requestNow = new Date("2026-05-20T10:00:05Z");
    const layers = await adapter.fetchLayers(requestNow);
    const sources = await adapter.fetchSources(requestNow);
    const config = await adapter.fetchConfig(requestNow);
    const features = await adapter.fetchFeatures({
      bbox: { east: 15.35, north: 50.45, south: 49.65, west: 13.85 },
      layers: ["warnings", "flood"],
      limit: 20
    }, new Date("2026-05-20T10:00:06Z"));

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://sim.zeleznalady.cz/safety-data/api/v1/catalog");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("https://sim.zeleznalady.cz/safety-data/api/v1/config");
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
      "https://sim.zeleznalady.cz/safety-data/api/v1/features?bbox=13.5%2C49.5%2C15.75%2C50.75&layers=warnings%2Cflood&limit=20"
    );
    expect(layers).toMatchObject([
      {
        defaultVisible: true,
        label: "Official warnings",
        layerId: "warnings"
      }
    ]);
    expect(sources).toMatchObject([{ enabled: true, sourceId: "chmi_alerts" }]);
    expect(config).toMatchObject({ enabledSources: ["chmi_alerts", "chmi_hydro"] });
    expect(features).toMatchObject({
      contractVersion: "cop-safety-source-v1",
      features: [
        {
          geometry: { coordinates: [14.42, 50.08], type: "Point" },
          properties: {
            category: "warning.wind",
            featureId: "warning:wind:prague",
            headline: "Silný vítr",
            layer: "warnings",
            sourceId: "chmi_alerts"
          }
        }
      ],
      summary: {
        featureCount: 1,
        staleFeatureCount: 0,
        warningCount: 1
      }
    });
    expect(features.cache).toMatchObject({
      status: "miss",
      upstreamBbox: { east: 15.75, north: 50.75, south: 49.5, west: 13.5 }
    });
    expect(features.query.bbox).toEqual({ east: 15.35, north: 50.45, south: 49.65, west: 13.85 });
  });

  it("reuses canonical viewport cache for small map pans", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(sampleFeatureCollection()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new SafetyDataSourceAdapter({
      baseUrl: "https://sim.zeleznalady.cz/safety-data/api/v1",
      cacheTtlMs: 120000,
      enabled: true,
      maxLimit: 250,
      timeoutMs: 7000
    });

    const first = await adapter.fetchFeatures({
      bbox: { east: 14.485, north: 50.019, south: 49.988, west: 14.423 },
      layers: ["warnings"],
      limit: 10
    }, new Date("2026-05-20T10:00:06Z"));
    const second = await adapter.fetchFeatures({
      bbox: { east: 14.486, north: 50.02, south: 49.989, west: 14.424 },
      layers: ["warnings"],
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

function sampleCatalogResponse() {
  return {
    contractVersion: "provider-map-catalog-v1",
    providerId: "sim.safety-data",
    status: "online",
    layers: [
      {
        audience: "public",
        cacheTtlSeconds: 300,
        defaultVisible: true,
        description: "Official warning context.",
        geometryTypes: ["Point", "Polygon"],
        kind: "vector_features",
        label: "Official warnings",
        providerLayerId: "safety.warnings",
        query: {
          mode: "bbox",
          providerId: "sim.safety-data",
          providerLayerIds: ["warnings"],
          providerSourceIds: ["chmi_alerts"],
          streamId: "features"
        },
        recommendedCatalogLayerId: "public.safety.warnings",
        refreshSeconds: 300,
        role: "overlay",
        selectable: true,
        sourceIds: ["chmi_alerts"],
        styleProfile: "safety-warning-v1"
      }
    ],
    sources: [
      {
        audience: "public",
        enabled: true,
        label: "CHMI Alerts",
        layers: ["warnings"],
        selectableInMap: false,
        sourceRole: "final",
        sourceId: "chmi_alerts"
      }
    ]
  };
}

function sampleConfigResponse() {
  return {
    enabledSources: ["chmi_alerts", "chmi_hydro"],
    staleAfterSeconds: 900
  };
}

function sampleFeatureCollection() {
  return {
    contractVersion: "cop-safety-source-v1",
    features: [
      {
        geometry: {
          coordinates: [14.42, 50.08],
          type: "Point"
        },
        properties: {
          affectedAreas: ["Praha"],
          category: "warning.wind",
          certainty: "Likely",
          confidence: 0.91,
          effectiveAt: "2026-05-20T10:00:00Z",
          expiresAt: "2026-05-20T15:00:00Z",
          featureId: "warning:wind:prague",
          headline: "Silný vítr",
          layer: "warnings",
          license: {
            attribution: "CHMI",
            name: "open data"
          },
          observedAt: "2026-05-20T10:00:00Z",
          severity: "warning",
          sourceId: "chmi_alerts",
          stale: false,
          urgency: "Expected"
        },
        type: "Feature"
      }
    ],
    generatedAt: "2026-05-20T10:00:00Z",
    query: {
      bbox: { east: 15.35, north: 50.45, south: 49.65, west: 13.85 },
      layers: ["warnings", "flood"],
      limit: 20
    },
    source: {
      generatedAt: "2026-05-20T10:00:00Z",
      sourceId: "safety-data-api",
      sourceType: "PUBLIC_SAFETY_AGGREGATE"
    },
    sources: [
      {
        enabled: true,
        label: "CHMI Alerts",
        layers: ["warnings"],
        sourceId: "chmi_alerts"
      }
    ],
    summary: {
      advisoryCount: 0,
      criticalCount: 0,
      featureCount: 1,
      sourceCount: 1,
      staleFeatureCount: 0,
      warningCount: 1
    },
    type: "FeatureCollection",
    warnings: []
  };
}
