import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSafetyDataHealth, SafetyDataSourceAdapter } from "./safety-data-source.js";

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
      if (url.endsWith("/observability")) {
        return new Response(JSON.stringify(sampleObservabilityResponse()), { status: 200 });
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
    const observability = await adapter.fetchObservability(requestNow);
    const features = await adapter.fetchFeatures({
      bbox: { east: 15.35, north: 50.45, south: 49.65, west: 13.85 },
      layers: ["warnings", "flood"],
      limit: 20,
      sources: ["chmi_alerts", "chmi_hydro"]
    }, new Date("2026-05-20T10:00:06Z"));

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://sim.zeleznalady.cz/safety-data/api/v1/catalog");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("https://sim.zeleznalady.cz/safety-data/api/v1/config");
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
      "https://sim.zeleznalady.cz/safety-data/api/v1/observability"
    );
    expect(String(fetchMock.mock.calls[3]?.[0])).toBe(
      "https://sim.zeleznalady.cz/safety-data/api/v1/features?bbox=13.5%2C49.5%2C15.75%2C50.75&layers=warnings%2Cflood&limit=20&source=chmi_alerts%2Cchmi_hydro"
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
    expect(observability).toMatchObject({
      lastResult: {
        featureCount: 12,
        layerCounts: {
          flood: 3,
          weather_alerts: 4
        }
      },
      sourceCaches: [
        {
          cache: {
            errors: 0,
            hitRate: 0.75
          },
          sourceId: "chmi_alerts"
        }
      ],
      status: "ok"
    });
    expect(features).toMatchObject({
      contractVersion: "cop-safety-source-v1",
      features: [
        {
          geometry: { coordinates: [14.42, 50.08], type: "Point" },
          properties: {
            adminLevel: "mixed",
            category: "warning.wind",
            featureId: "warning:wind:prague",
            geometryMode: "admin_boundary",
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
    expect(features.query.sources).toEqual(["chmi_alerts", "chmi_hydro"]);
  });

  it("proxies CHMI hydro station detail through the SIM safety-data contract", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).not.toMatchObject({ Authorization: expect.any(String) });
      return new Response(JSON.stringify({
        chart: {
          currentTime: "2026-06-25T10:00:00Z",
          panels: [
            {
              id: "water_level",
              seriesIds: ["H", "H_F"],
              thresholdSet: "waterLevel",
              title: "Vodní stav",
              yAxis: { label: "vodní stav [cm]", unit: "cm" }
            }
          ],
          title: "Hlásný profil"
        },
        contractVersion: "chmi-hydro-station-detail-v1",
        generatedAt: "2026-06-25T10:00:00Z",
        providerId: "sim.safety-data",
        series: [],
        sourceId: "chmi_hydro",
        station: { stationId: "0-203-1-239000", stationName: "Hlásný profil" },
        thresholds: {},
        warnings: [],
        window: { from: "2026-06-25T00:00:00Z", to: "2026-06-25T10:00:00Z" }
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new SafetyDataSourceAdapter({
      baseUrl: "https://sim.zeleznalady.cz/safety-data/api/v1/",
      cacheTtlMs: 120000,
      enabled: true,
      maxLimit: 250,
      timeoutMs: 7000
    });

    const detail = await adapter.fetchHydroStationDetail("0-203-1-239000", {
      from: "2026-06-25T00:00:00Z",
      series: "H,Q,TH,H_F,Q_F",
      to: "2026-06-25T10:00:00Z"
    }, new Date("2026-06-25T10:00:00Z"));

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://sim.zeleznalady.cz/safety-data/api/v1/hydro/stations/0-203-1-239000/observations?from=2026-06-25T00%3A00%3A00Z&to=2026-06-25T10%3A00%3A00Z&series=H%2CQ%2CTH%2CH_F%2CQ_F"
    );
    expect(detail).toMatchObject({
      contractVersion: "chmi-hydro-station-detail-v1",
      sourceId: "chmi_hydro",
      station: { stationId: "0-203-1-239000" }
    });
  });

  it("accepts canonical SIM safety features without legacy headline text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      contractVersion: "cop-safety-source-v1",
      features: [
        {
          geometry: {
            coordinates: [14.42, 50.08],
            type: "Point"
          },
          properties: {
            category: "warning.weather",
            featureId: "warning:heat:prague",
            layer: "weather_alerts",
            localized: {
              cs: {
                headline: "Vysoké teploty",
                detail: "Výstraha pro území Prahy."
              }
            },
            providerProperties: {
              notification: {
                eligible: false
              },
              presentation: {
                iconKey: "weather.temperature.high",
                styleKey: "heat-warning"
              },
              taxonomy: {
                sourceCode: "I.2",
                sourceSystem: "CHMI_SIVS",
                typeCode: "weather.temperature.high"
              }
            },
            severity: "warning",
            sourceId: "chmi_alerts"
          },
          type: "Feature"
        }
      ],
      generatedAt: "2026-05-20T10:00:00Z",
      query: {
        bbox: { east: 15.35, north: 50.45, south: 49.65, west: 13.85 },
        layers: ["weather_alerts"],
        limit: 20
      },
      summary: {
        featureCount: 1,
        sourceCount: 1,
        staleFeatureCount: 0,
        warningCount: 1
      },
      source: {
        generatedAt: "2026-05-20T10:00:00Z",
        sourceId: "safety-data-api",
        sourceType: "PUBLIC_SAFETY_AGGREGATE"
      },
      type: "FeatureCollection",
      warnings: []
    }), { status: 200 })));

    const adapter = new SafetyDataSourceAdapter({
      baseUrl: "https://sim.zeleznalady.cz/safety-data/api/v1/",
      cacheTtlMs: 120000,
      enabled: true,
      maxLimit: 250,
      timeoutMs: 7000
    });

    const features = await adapter.fetchFeatures({
      bbox: { east: 15.35, north: 50.45, south: 49.65, west: 13.85 },
      layers: ["weather_alerts"],
      limit: 20
    }, new Date("2026-05-20T10:00:06Z"));

    expect(features.features).toHaveLength(1);
    expect(features.features[0]?.properties).toMatchObject({
      headline: "Vysoké teploty",
      sourceCode: "I.2",
      sourceSystem: "CHMI_SIVS",
      typeCode: "weather.temperature.high"
    });
    expect(features.features[0]?.properties.providerProperties).toMatchObject({
      notification: {
        eligible: false
      }
    });
  });

  it("preserves hydrology numeric values while clamping ratio fields", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).not.toMatchObject({ Authorization: expect.any(String) });
      return new Response(JSON.stringify(sampleHydroFeatureCollection()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new SafetyDataSourceAdapter({
      baseUrl: "https://sim.zeleznalady.cz/safety-data/api/v1/",
      cacheTtlMs: 120000,
      enabled: true,
      maxLimit: 250,
      timeoutMs: 7000
    });

    const features = await adapter.fetchFeatures({
      bbox: { east: 18.9, north: 51.2, south: 48.5, west: 12.0 },
      layers: ["flood"],
      limit: 250,
      sources: ["chmi_hydro"]
    }, new Date("2026-06-25T10:00:00Z"));

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://sim.zeleznalady.cz/safety-data/api/v1/features?bbox=10.5%2C48%2C20.5%2C52&layers=flood&limit=250&source=chmi_hydro"
    );
    expect(features.features).toHaveLength(1);
    expect(features.features[0]?.properties).toMatchObject({
      catchmentAreaKm2: 1234,
      confidence: 1,
      discharge: 38.7,
      floodStage: 2,
      stationId: "0-203-1-239000",
      waterLevelCm: 186,
      waterTemperatureC: 12.4
    });
  });

  it("uses safety-data observability as source health without treating degraded external data as an outage", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/observability")) {
        return new Response(JSON.stringify({
          ...sampleObservabilityResponse(),
          status: "degraded",
          sourceCaches: [
            {
              sourceId: "chmi_hydro",
              cache: {
                entries: 4,
                errors: 2,
                hitRate: 0.5,
                staleHits: 1
              }
            }
          ]
        }), { status: 200 });
      }
      return new Response(JSON.stringify(sampleFeatureCollection()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new SafetyDataSourceAdapter({
      baseUrl: "https://sim.zeleznalady.cz/safety-data/api/v1",
      cacheTtlMs: 120000,
      enabled: true,
      maxLimit: 250,
      timeoutMs: 7000
    });
    const requestNow = new Date("2026-05-20T10:00:06Z");
    const [features, observability] = await Promise.all([
      adapter.fetchFeatures({
        bbox: { east: 15.35, north: 50.45, south: 49.65, west: 13.85 },
        layers: ["warnings"],
        limit: 20
      }, requestNow),
      adapter.fetchObservability(requestNow)
    ]);
    const health = buildSafetyDataHealth(features, requestNow, observability);

    expect(health.health).toBe("DEGRADED");
    expect(health.lastError).toBeUndefined();
    expect(health.detail).toBe("features 1, critical 0, warnings 1, advisory 0, stale 0; provider last 12, stale 3, sources 3, cache 80%");
    expect(health.warnings).toEqual(expect.arrayContaining(["chmi_hydro: 2 cache errors"]));
    expect(health.summary).toMatchObject({
      observabilityStatus: "degraded",
      lastResult: {
        featureCount: 12,
        staleFeatureCount: 3
      }
    });
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
          metrics: {
            geometryMode: "admin_boundary"
          },
          observedAt: "2026-05-20T10:00:00Z",
          severity: "warning",
          sourceId: "chmi_alerts",
          adminLevel: "mixed",
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

function sampleHydroFeatureCollection() {
  return {
    contractVersion: "cop-safety-source-v1",
    features: [
      {
        geometry: {
          coordinates: [14.36, 49.98],
          type: "Point"
        },
        properties: {
          category: "flood.hydro_station",
          confidence: 1.5,
          featureId: "hydro:0-203-1-239000",
          floodStage: 2,
          headline: "Berounka - Praha Radotín",
          layer: "flood",
          metrics: {
            catchmentAreaKm2: 1234,
            floodActivityLevel: 2,
            flowM3s: 38.7,
            waterLevelCm: 186,
            waterTemperatureC: 12.4
          },
          observedAt: "2026-06-25T10:00:00Z",
          severity: "warning",
          sourceId: "chmi_hydro",
          stale: false,
          stationId: "0-203-1-239000",
          trend: "rising",
          waterLevelCm: 186,
          waterTemperatureC: 12.4
        },
        type: "Feature"
      }
    ],
    generatedAt: "2026-06-25T10:00:00Z",
    query: {
      bbox: { east: 18.9, north: 51.2, south: 48.5, west: 12.0 },
      layers: ["flood"],
      limit: 250,
      sources: ["chmi_hydro"]
    },
    source: {
      generatedAt: "2026-06-25T10:00:00Z",
      sourceId: "safety-data-api",
      sourceType: "PUBLIC_SAFETY_AGGREGATE"
    },
    sources: [
      {
        enabled: true,
        label: "CHMI Hydro",
        layers: ["flood"],
        sourceId: "chmi_hydro"
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

function sampleObservabilityResponse() {
  return {
    status: "ok",
    cache: {
      entries: 12,
      errors: 0,
      hitRate: 0.8,
      hits: 8,
      misses: 2,
      staleHits: 0
    },
    sourceCaches: [
      {
        sourceId: "chmi_alerts",
        cache: {
          entries: 4,
          errors: 0,
          hitRate: 0.75,
          hits: 3,
          misses: 1,
          staleHits: 0
        }
      }
    ],
    dataFreshness: {},
    lastResult: {
      generatedAt: "2026-05-20T10:00:00Z",
      generatedAgeSeconds: 23,
      featureCount: 12,
      sourceCount: 3,
      staleFeatureCount: 3,
      responseWarningCount: 0,
      layerCounts: {
        weather_alerts: 4,
        fire: 2,
        flood: 3,
        boundary_admin: 3
      }
    }
  };
}
