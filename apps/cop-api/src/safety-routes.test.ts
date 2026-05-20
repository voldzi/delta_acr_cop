import { describe, expect, it } from "vitest";
import { createPublicSafetyAggregateSourceSystem } from "@cop/canonical-model";
import { buildServer } from "./server.js";
import type {
  SafetyDataPublicConfig,
  SafetyDataSource,
  SafetyDataSourceConfig,
  SafetyFeatureCollection,
  SafetyFeatureQuery,
  SafetyLayerDescriptor,
  SafetySourceDescriptor
} from "./safety-data-source.js";

describe("safety data routes", () => {
  it("returns safety layers, sources, config and features without adding COP tracks", async () => {
    const app = buildServer({
      now: () => new Date("2026-05-20T10:00:05Z"),
      safetyDataSource: new FakeSafetyDataSource()
    });

    const layersResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/safety/layers"
    });
    expect(layersResponse.statusCode).toBe(200);
    expect(layersResponse.json()).toMatchObject({
      items: [
        {
          defaultVisible: true,
          label: "Official warnings",
          layerId: "warnings"
        }
      ],
      sourceStatus: "ONLINE"
    });

    const sourcesResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/safety/sources"
    });
    expect(sourcesResponse.statusCode).toBe(200);
    expect(sourcesResponse.json()).toMatchObject({
      items: [{ enabled: true, sourceId: "chmi_alerts" }]
    });

    const configResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/safety/config"
    });
    expect(configResponse.statusCode).toBe(200);
    expect(configResponse.json()).toMatchObject({
      config: { enabledSources: ["chmi_alerts", "chmi_hydro"] },
      sourceStatus: "ONLINE"
    });

    const featuresResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/safety/features?bbox=13.85,49.65,15.35,50.45&layers=warnings,flood&limit=20"
    });
    expect(featuresResponse.statusCode).toBe(200);
    expect(featuresResponse.json()).toMatchObject({
      contractVersion: "cop-safety-source-v1",
      features: [
        {
          properties: {
            featureId: "warning:wind:prague",
            headline: "Silný vítr",
            layer: "warnings",
            sourceId: "chmi_alerts"
          }
        }
      ],
      sourceHealth: {
        health: "DEGRADED"
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
        health: "DEGRADED",
        sourceSystemId: "safety-data-api",
        sourceType: "PUBLIC_SAFETY_AGGREGATE",
        totalTracks: 0
      })
    ]));
  });

  it("keeps the route degraded but available when upstream safety data fails", async () => {
    const app = buildServer({
      now: () => new Date("2026-05-20T10:00:05Z"),
      safetyDataSource: new FakeSafetyDataSource(true)
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/safety/features?bbox=13.85,49.65,15.35,50.45&layers=warnings&limit=20"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      features: [],
      sourceHealth: {
        health: "UNAVAILABLE",
        lastError: "upstream unavailable"
      },
      summary: {
        featureCount: 0
      }
    });
  });
});

class FakeSafetyDataSource implements SafetyDataSource {
  readonly config: SafetyDataSourceConfig = {
    baseUrl: "https://sim.zeleznalady.cz/safety-data/api/v1",
    cacheTtlMs: 120000,
    enabled: true,
    maxLimit: 250,
    timeoutMs: 7000
  };

  readonly sourceSystem = createPublicSafetyAggregateSourceSystem();

  constructor(private readonly fail = false) {}

  async fetchConfig(_requestNow: Date): Promise<SafetyDataPublicConfig> {
    if (this.fail) {
      throw new Error("upstream unavailable");
    }
    return {
      enabledSources: ["chmi_alerts", "chmi_hydro"],
      staleAfterSeconds: 900
    };
  }

  async fetchLayers(_requestNow: Date): Promise<SafetyLayerDescriptor[]> {
    if (this.fail) {
      throw new Error("upstream unavailable");
    }
    return [
      {
        defaultVisible: true,
        description: "Official warning context.",
        expectedCadenceSeconds: 300,
        geometryTypes: ["Point", "Polygon"],
        label: "Official warnings",
        layerId: "warnings"
      }
    ];
  }

  async fetchSources(_requestNow: Date): Promise<SafetySourceDescriptor[]> {
    if (this.fail) {
      throw new Error("upstream unavailable");
    }
    return [
      {
        enabled: true,
        label: "CHMI Alerts",
        layers: ["warnings"],
        sourceId: "chmi_alerts"
      }
    ];
  }

  async fetchFeatures(query: SafetyFeatureQuery, requestNow: Date): Promise<SafetyFeatureCollection> {
    if (this.fail) {
      throw new Error("upstream unavailable");
    }
    return {
      contractVersion: "cop-safety-source-v1",
      features: [
        {
          geometry: { coordinates: [14.42, 50.08], type: "Point" },
          properties: {
            affectedAreas: ["Praha"],
            category: "warning.wind",
            certainty: "Likely",
            confidence: 0.91,
            effectiveAt: requestNow.toISOString(),
            expiresAt: new Date(requestNow.getTime() + 3600000).toISOString(),
            featureId: "warning:wind:prague",
            headline: "Silný vítr",
            layer: "warnings",
            observedAt: requestNow.toISOString(),
            severity: "warning",
            sourceId: "chmi_alerts",
            stale: false,
            urgency: "Expected"
          },
          type: "Feature"
        }
      ],
      generatedAt: requestNow.toISOString(),
      query,
      source: {
        generatedAt: requestNow.toISOString(),
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
      warnings: ["sample warning"]
    };
  }
}
