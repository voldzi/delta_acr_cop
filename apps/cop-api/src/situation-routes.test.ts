import { afterEach, describe, expect, it, vi } from "vitest";
import { createPublicSituationAggregateSourceSystem } from "@cop/canonical-model";
import { buildServer } from "./server.js";
import type {
  SituationDataSource,
  SituationDataSourceConfig,
  SituationFeatureCollection,
  SituationFeatureQuery,
  SituationLayerDescriptor
} from "./situation-data-source.js";

describe("situation context routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns context layers and features without adding COP tracks", async () => {
    const app = buildServer({
      now: () => new Date("2026-05-20T10:00:05Z"),
      situationDataSource: new FakeSituationDataSource()
    });

    const layersResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/situation/layers"
    });
    expect(layersResponse.statusCode).toBe(200);
    expect(layersResponse.json()).toMatchObject({
      items: [
        {
          defaultVisible: true,
          label: "Weather",
          layerId: "weather"
        }
      ],
      sourceStatus: "ONLINE"
    });

    const sourcesResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/situation/sources"
    });
    expect(sourcesResponse.statusCode).toBe(200);
    expect(sourcesResponse.json()).toMatchObject({
      items: [
        {
          enabled: true,
          label: "Open-Meteo",
          sourceId: "open_meteo"
        },
        {
          enabled: true,
          label: "Aviation Weather",
          sourceId: "aviation_weather"
        }
      ]
    });

    const featuresResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/situation/features?bbox=13.85,49.65,15.35,50.45&layers=weather,traffic&limit=20"
    });
    expect(featuresResponse.statusCode).toBe(200);
    expect(featuresResponse.json()).toMatchObject({
      contractVersion: "cop-situation-source-v1",
      features: [
        {
          properties: {
            featureId: "weather:prague",
            layer: "weather",
            sourceId: "open_meteo"
          }
        }
      ],
      sourceHealth: {
        health: "ONLINE"
      }
    });

    const tracksResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/cop/tracks"
    });
    expect(tracksResponse.statusCode).toBe(200);
    expect(tracksResponse.json()).toMatchObject({ items: [] });

    const healthResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/sources/health"
    });
    expect(healthResponse.statusCode).toBe(200);
    expect((healthResponse.json() as { items: unknown[] }).items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        currentTracks: 0,
        health: "ONLINE",
        sourceSystemId: "situation-data-api",
        sourceType: "PUBLIC_SITUATION_AGGREGATE",
        totalTracks: 0
      })
    ]));
  });

  it("keeps the route degraded but available when upstream situation data fails", async () => {
    const app = buildServer({
      now: () => new Date("2026-05-20T10:00:05Z"),
      situationDataSource: new FakeSituationDataSource(true)
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/situation/features?bbox=13.85,49.65,15.35,50.45&layers=weather&limit=20"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      features: [],
      sourceHealth: {
        health: "UNAVAILABLE",
        lastError: "upstream unavailable"
      },
      summary: {
        featureCount: 0,
        warningCount: 1
      }
    });
  });

  it("hides restricted ARDOS features unless explicitly enabled", async () => {
    vi.stubEnv("COP_ARDOS_PARTNER_ENABLED", "false");
    const app = buildServer({
      now: () => new Date("2026-05-20T10:00:05Z"),
      situationDataSource: new FakeSituationDataSource(false, true)
    });

    const sourcesResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/situation/sources"
    });
    expect(sourcesResponse.statusCode).toBe(200);
    expect((sourcesResponse.json() as { items: Array<{ sourceId: string }> }).items.map((source) => source.sourceId)).not.toContain("ardos_partner");

    const featuresResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/situation/features?bbox=13.85,49.65,15.35,50.45&layers=ground,mobile,traffic&source=ardos_partner&limit=20"
    });
    expect(featuresResponse.statusCode).toBe(200);
    expect(featuresResponse.json()).toMatchObject({
      features: [],
      summary: {
        featureCount: 0,
        warningCount: 1
      }
    });
  });
});

class FakeSituationDataSource implements SituationDataSource {
  readonly config: SituationDataSourceConfig = {
    baseUrl: "https://sim.zeleznalady.cz/situation-data/api/v1",
    cacheTtlMs: 20000,
    enabled: true,
    maxLimit: 250,
    timeoutMs: 7000
  };

  readonly sourceSystem = createPublicSituationAggregateSourceSystem();

  constructor(private readonly fail = false, private readonly includeArdos = false) {}

  async fetchLayers(_requestNow: Date): Promise<SituationLayerDescriptor[]> {
    if (this.fail) {
      throw new Error("upstream unavailable");
    }
    return [
      {
        defaultVisible: true,
        description: "Weather context.",
        expectedCadenceSeconds: 600,
        geometryTypes: ["Point"],
        label: "Weather",
        layerId: "weather"
      }
    ];
  }

  async fetchSources(_requestNow: Date) {
    if (this.fail) {
      throw new Error("upstream unavailable");
    }
    return [
      {
        enabled: true,
        label: "Open-Meteo",
        layers: ["weather" as const],
        sourceId: "open_meteo"
      },
      {
        enabled: true,
        label: "Aviation Weather",
        layers: ["weather" as const],
        sourceId: "aviation_weather"
      },
      ...(this.includeArdos
        ? [
            {
              enabled: true,
              label: "ARDOS partner field operations",
              layers: ["ground" as const, "mobile" as const, "traffic" as const],
              sourceId: "ardos_partner"
            }
          ]
        : [])
    ];
  }

  async fetchFeatures(query: SituationFeatureQuery, requestNow: Date): Promise<SituationFeatureCollection> {
    if (this.fail) {
      throw new Error("upstream unavailable");
    }
    return {
      contractVersion: "cop-situation-source-v1",
      features: [
        {
          geometry: { coordinates: [14.42, 50.08], type: "Point" },
          properties: {
            category: "weather.current",
            confidence: 0.94,
            featureId: "weather:prague",
            label: "Praha weather",
            layer: "weather",
            observedAt: requestNow.toISOString(),
            sourceId: "open_meteo",
            stale: false
          },
          type: "Feature"
        }
        ,
        ...(this.includeArdos
          ? [
              {
                geometry: { coordinates: [14.5, 50.1] as [number, number], type: "Point" as const },
                properties: {
                  category: "field_report",
                  confidence: 0.7,
                  featureId: "ardos:field-report-1",
                  label: "Partner report",
                  layer: "ground" as const,
                  observedAt: requestNow.toISOString(),
                  sourceId: "ardos_partner",
                  stale: false
                },
                type: "Feature" as const
              }
            ]
          : [])
      ],
      generatedAt: requestNow.toISOString(),
      query,
      source: {
        generatedAt: requestNow.toISOString(),
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
}
