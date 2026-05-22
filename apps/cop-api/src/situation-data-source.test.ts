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
      if (url.endsWith("/catalog")) {
        return new Response(JSON.stringify(sampleCatalogResponse()), { status: 200 });
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

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://sim.zeleznalady.cz/situation-data/api/v1/catalog");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://sim.zeleznalady.cz/situation-data/api/v1/features?bbox=13.5%2C49.5%2C15.75%2C50.75&layers=weather%2Ctraffic&limit=20&source=aviation_weather"
    );
    expect(layers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        defaultVisible: true,
        label: "Weather",
        layerId: "weather"
      })
    ]));
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
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(sampleCatalogResponse()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new SituationDataSourceAdapter({
      baseUrl: "https://sim.zeleznalady.cz/situation-data/api/v1",
      cacheTtlMs: 20000,
      enabled: true,
      maxLimit: 250,
      timeoutMs: 7000
    });

    const sources = await adapter.fetchSources(new Date("2026-05-20T10:00:05Z"));

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://sim.zeleznalady.cz/situation-data/api/v1/catalog");
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

  it("uses source-specific cache ttl for explicit OSM PostGIS queries", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(sampleFeatureCollection()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new SituationDataSourceAdapter({
      baseUrl: "https://sim.zeleznalady.cz/situation-data/api/v1",
      cacheTtlMs: 20000,
      enabled: true,
      maxLimit: 250,
      timeoutMs: 7000
    });

    const features = await adapter.fetchFeatures({
      bbox: { east: 14.6, north: 50.2, south: 49.95, west: 14.2 },
      layers: ["mobile"],
      limit: 20,
      sources: ["osm_postgis"]
    }, new Date("2026-05-20T10:00:06Z"));

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://sim.zeleznalady.cz/situation-data/api/v1/features?bbox=14.1%2C49.9%2C14.7%2C50.25&layers=mobile&limit=20&source=osm_postgis"
    );
    expect(features.cache?.ttlMs).toBe(6 * 60 * 60 * 1000);
  });

  it("proxies mobile coverage technology and preserves coverage model properties", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(sampleCoverageFeatureCollection()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new SituationDataSourceAdapter({
      baseUrl: "https://sim.zeleznalady.cz/situation-data/api/v1",
      cacheTtlMs: 20000,
      enabled: true,
      maxLimit: 250,
      timeoutMs: 7000
    });

    const features = await adapter.fetchFeatures({
      bbox: { east: 14.6, north: 50.2, south: 49.95, west: 14.2 },
      layers: ["weather", "mobile_coverage"],
      limit: 20,
      sources: ["mobile_coverage_model"],
      technology: "4g"
    }, new Date("2026-05-21T14:10:00Z"));

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://sim.zeleznalady.cz/situation-data/api/v1/features?bbox=14.1%2C49.9%2C14.7%2C50.25&layers=weather%2Cmobile_coverage&limit=20&source=mobile_coverage_model&technology=4G"
    );
    expect(features.cache?.ttlMs).toBe(10 * 60 * 1000);
    expect(features.query.technology).toBe("4G");
    expect(features.features).toMatchObject([
      {
        properties: {
          demSource: "not-used-phase-1",
          estimatedSignalDbm: -111,
          featureId: "coverage:mobile:4g:6-4",
          layer: "mobile_coverage",
          modelVersion: "coverage-v1",
          quality: "weak",
          resolutionM: 4554,
          sourceId: "mobile_coverage_model",
          technology: "4G"
        }
      }
    ]);
  });

  it("proxies unified mobile network layer and preserves assessment metadata", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(sampleMobileNetworkFeatureCollection()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new SituationDataSourceAdapter({
      baseUrl: "https://sim.zeleznalady.cz/situation-data/api/v1",
      cacheTtlMs: 20000,
      enabled: true,
      maxLimit: 250,
      timeoutMs: 7000
    });

    const features = await adapter.fetchFeatures({
      bbox: { east: 14.6, north: 50.2, south: 49.95, west: 14.2 },
      layers: ["mobile_network"],
      limit: 20,
      sources: ["mobile_network_model"],
      technology: "4g"
    }, new Date("2026-05-21T16:20:00Z"));

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://sim.zeleznalady.cz/situation-data/api/v1/features?bbox=14.1%2C49.9%2C14.7%2C50.25&layers=mobile_network&limit=20&source=mobile_network_model&technology=4G"
    );
    expect(features.cache?.ttlMs).toBe(10 * 60 * 1000);
    expect(features.features).toMatchObject([
      {
        properties: {
          basis: ["CTU_NETTEST_MEASUREMENT", "INFERRED_COVERAGE"],
          disclaimer: "Inferred assessment, not guaranteed service availability.",
          featureId: "mobile_network:aggregate:4g:6-4",
          layer: "mobile_network",
          notices: ["No operator BTS status feed."],
          operator: "aggregate",
          quality: "fair",
          sourceId: "mobile_network_model",
          status: "degraded_possible",
          summary: "Mobilní síť je použitelná s omezením.",
          technology: "4G"
        }
      }
    ]);
  });

  it("falls back to layer ttl when an explicit source has no source-specific ttl", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(sampleFeatureCollection()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new SituationDataSourceAdapter({
      baseUrl: "https://sim.zeleznalady.cz/situation-data/api/v1",
      cacheTtlMs: 20000,
      enabled: true,
      maxLimit: 250,
      timeoutMs: 7000
    });

    const features = await adapter.fetchFeatures({
      bbox: { east: 14.6, north: 50.2, south: 49.95, west: 14.2 },
      layers: ["mobile"],
      limit: 20,
      sources: ["osm_postgis", "ctu_nettest"]
    }, new Date("2026-05-20T10:00:06Z"));

    expect(features.cache?.ttlMs).toBe(15 * 60 * 1000);
  });
});

function sampleCatalogResponse() {
  return {
    contractVersion: "provider-map-catalog-v1",
    providerId: "sim.situation-data",
    status: "online",
    layers: [
      {
        audience: "public",
        cacheTtlSeconds: 600,
        defaultVisible: true,
        description: "Weather context.",
        geometryTypes: ["Point"],
        kind: "vector_features",
        label: "Weather",
        providerLayerId: "weather.open_meteo",
        query: {
          mode: "bbox",
          providerId: "sim.situation-data",
          providerLayerIds: ["weather"],
          providerSourceIds: ["open_meteo"],
          streamId: "features"
        },
        recommendedCatalogLayerId: "public.weather.current",
        refreshSeconds: 600,
        role: "primary",
        selectable: true,
        sourceIds: ["open_meteo"],
        styleProfile: "current-weather-v1"
      },
      {
        audience: "public",
        cacheTtlSeconds: 600,
        defaultVisible: false,
        geometryTypes: ["Point"],
        kind: "vector_features",
        label: "Letištní počasí",
        providerLayerId: "weather.aviation_weather",
        query: {
          mode: "bbox",
          providerId: "sim.situation-data",
          providerLayerIds: ["weather"],
          providerSourceIds: ["aviation_weather"],
          streamId: "features"
        },
        recommendedCatalogLayerId: "public.weather.aviation",
        refreshSeconds: 600,
        role: "reference",
        selectable: true,
        sourceIds: ["aviation_weather"],
        styleProfile: "aviation-weather-v1"
      },
      {
        audience: "diagnostic",
        defaultVisible: false,
        label: "ARDOS partner field operations",
        providerLayerId: "ground.ardos_partner",
        query: {
          mode: "bbox",
          providerId: "sim.situation-data",
          providerLayerIds: ["ground", "mobile", "traffic"],
          providerSourceIds: ["ardos_partner"],
          streamId: "features"
        },
        recommendedCatalogLayerId: "diagnostic.ardos_partner",
        role: "diagnostic",
        selectable: false,
        sourceIds: ["ardos_partner"],
        styleProfile: "diagnostic-source-v1"
      }
    ],
    sources: [
      {
        audience: "public",
        enabled: true,
        label: "NOAA AWC METAR/TAF aviation weather",
        layers: ["weather"],
        selectableInMap: true,
        sourceId: "aviation_weather",
        sourceRole: "final",
        updateCadenceSeconds: 600
      },
      {
        audience: "diagnostic",
        enabled: false,
        label: "ARDOS partner field operations",
        layers: ["ground", "mobile", "traffic"],
        selectableInMap: false,
        sourceId: "ardos_partner",
        sourceRole: "input",
        updateCadenceSeconds: 15
      }
    ]
  };
}

function sampleCoverageFeatureCollection() {
  return {
    contractVersion: "cop-situation-source-v1",
    features: [
      {
        geometry: {
          coordinates: [[
            [14.2, 49.95],
            [14.3, 49.95],
            [14.3, 50.05],
            [14.2, 50.05],
            [14.2, 49.95]
          ]],
          type: "Polygon"
        },
        id: "coverage:mobile:4g:6-4",
        properties: {
          assumptions: {
            antennaHeightM: 30,
            terrainAware: false
          },
          category: "mobile_coverage",
          confidence: 0.63,
          demSource: "not-used-phase-1",
          disclaimer: "Coverage is an estimate, not guaranteed service availability.",
          estimatedSignalDbm: -111,
          featureId: "coverage:mobile:4g:6-4",
          generatedAt: "2026-05-21T13:44:09.575Z",
          label: "4G coverage estimate",
          layer: "mobile_coverage",
          license: {
            attribution: "OpenStreetMap contributors",
            name: "Estimated mobile coverage model"
          },
          metrics: {
            distanceToNearestTowerM: 2686
          },
          modelVersion: "coverage-v1",
          observedAt: "2026-05-21T13:44:09.575Z",
          operator: "unknown",
          quality: "weak",
          resolutionM: 4554,
          severity: "warning",
          sourceId: "mobile_coverage_model",
          stale: true,
          tags: {
            nearestTowerId: "node:13736867519"
          },
          technology: "4G"
        },
        type: "Feature"
      },
      {
        geometry: {
          coordinates: [[
            [14.35, 49.95],
            [14.45, 49.95],
            [14.45, 50.05],
            [14.35, 50.05],
            [14.35, 49.95]
          ]],
          type: "Polygon"
        },
        id: "coverage:mobile:5g:6-5",
        properties: {
          category: "mobile_coverage",
          confidence: 0.7,
          featureId: "coverage:mobile:5g:6-5",
          label: "5G coverage estimate",
          layer: "mobile_coverage",
          observedAt: "2026-05-21T13:44:09.575Z",
          quality: "good",
          sourceId: "mobile_coverage_model",
          technology: "5G"
        },
        type: "Feature"
      }
    ],
    generatedAt: "2026-05-21T14:08:41.075Z",
    query: {
      bbox: { east: 14.6, north: 50.2, south: 49.95, west: 14.2 },
      layers: ["mobile_coverage"],
      limit: 20,
      sources: ["mobile_coverage_model"],
      technology: "4G"
    },
    source: {
      generatedAt: "2026-05-21T14:08:41.075Z",
      sourceId: "situation-data-api",
      sourceType: "PUBLIC_SITUATION_AGGREGATE"
    },
    sources: [
      {
        enabled: true,
        label: "Mobile coverage estimate model",
        layers: ["mobile_coverage"],
        sourceId: "mobile_coverage_model"
      }
    ],
    summary: {
      featureCount: 2,
      sourceCount: 1,
      staleFeatureCount: 1,
      warningCount: 0
    },
    type: "FeatureCollection",
    warnings: []
  };
}

function sampleMobileNetworkFeatureCollection() {
  return {
    contractVersion: "cop-situation-source-v1",
    features: [
      {
        geometry: {
          coordinates: [[
            [14.2, 49.95],
            [14.3, 49.95],
            [14.3, 50.05],
            [14.2, 50.05],
            [14.2, 49.95]
          ]],
          type: "Polygon"
        },
        id: "mobile_network:aggregate:4g:6-4",
        properties: {
          basis: ["CTU_NETTEST_MEASUREMENT", "INFERRED_COVERAGE"],
          category: "mobile_network",
          confidence: 0.62,
          demSource: "not-used-phase-1",
          disclaimer: "Inferred assessment, not guaranteed service availability.",
          estimatedSignalDbm: -98,
          featureId: "mobile_network:aggregate:4g:6-4",
          generatedAt: "2026-05-21T16:08:56.211Z",
          label: "4G mobile network assessment",
          layer: "mobile_network",
          modelVersion: "mobile-network-v1",
          notices: ["No operator BTS status feed."],
          observedAt: "2026-05-21T16:08:56.211Z",
          operator: "aggregate",
          quality: "fair",
          resolutionM: 1000,
          severity: "warning",
          sourceId: "mobile_network_model",
          stale: false,
          status: "degraded_possible",
          summary: "Mobilní síť je použitelná s omezením.",
          technology: "4G"
        },
        type: "Feature"
      }
    ],
    generatedAt: "2026-05-21T16:08:56.211Z",
    query: {
      bbox: { east: 14.6, north: 50.2, south: 49.95, west: 14.2 },
      layers: ["mobile_network"],
      limit: 20,
      sources: ["mobile_network_model"],
      technology: "4G"
    },
    source: {
      generatedAt: "2026-05-21T16:08:56.211Z",
      sourceId: "situation-data-api",
      sourceType: "PUBLIC_SITUATION_AGGREGATE"
    },
    sources: [
      {
        enabled: true,
        label: "Unified mobile network assessment",
        layers: ["mobile_network"],
        sourceId: "mobile_network_model"
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
