import { describe, expect, it } from "vitest";
import { createTakGatewaySourceSystem } from "@cop/canonical-model";
import { buildServer } from "./server.js";
import type {
  TakGatewayFeatureCollection,
  TakGatewayFeatureQuery,
  TakGatewayLayerDescriptor,
  TakGatewaySource,
  TakGatewaySourceConfig,
  TakGatewaySourceDescriptor
} from "./tak-gateway-source.js";

describe("TAK Gateway routes", () => {
  it("keeps TAK Gateway behind authentication and does not create COP tracks", async () => {
    const app = buildServer({
      now: () => new Date("2026-05-21T06:00:05Z"),
      takGatewaySource: new FakeTakGatewaySource()
    });

    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/v1/tak/layers"
    });
    expect(unauthenticated.statusCode).toBe(401);

    const layersResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/tak/layers"
    });
    expect(layersResponse.statusCode).toBe(200);
    expect(layersResponse.json()).toMatchObject({
      items: [
        {
          defaultVisible: false,
          label: "Mobile units",
          layerId: "mobile"
        }
      ],
      sourceStatus: "ONLINE"
    });

    const sourcesResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/tak/sources"
    });
    expect(sourcesResponse.statusCode).toBe(200);
    expect(sourcesResponse.json()).toMatchObject({
      items: [
        {
          enabled: true,
          sourceId: "tak_gateway"
        }
      ]
    });

    const featuresResponse = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/tak/features?bbox=13.85,49.65,15.35,50.45&layers=mobile,traffic&limit=20"
    });
    expect(featuresResponse.statusCode).toBe(200);
    expect(featuresResponse.json()).toMatchObject({
      contractVersion: "cop-tak-source-v1",
      features: [
        {
          properties: {
            affiliation: "friend",
            featureId: "tak:cot:TAK-ARDOS-001",
            layer: "mobile",
            sourceId: "tak_gateway"
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
        sourceSystemId: "tak-gateway-api",
        sourceType: "TAK_COT_GATEWAY",
        totalTracks: 0
      })
    ]));
  });
});

class FakeTakGatewaySource implements TakGatewaySource {
  readonly config: TakGatewaySourceConfig = {
    baseUrl: "https://sim.zeleznalady.cz/tak-gateway/api/v1",
    cacheTtlMs: 5000,
    enabled: true,
    maxLimit: 250,
    readToken: "sim-read-token",
    staleIfErrorMs: 60000,
    timeoutMs: 7000
  };

  readonly sourceSystem = createTakGatewaySourceSystem();

  async fetchLayers(_requestNow: Date): Promise<TakGatewayLayerDescriptor[]> {
    return [
      {
        defaultVisible: false,
        description: "TAK mobile units.",
        expectedCadenceSeconds: 15,
        geometryTypes: ["Point"],
        label: "Mobile units",
        layerId: "mobile"
      }
    ];
  }

  async fetchSources(_requestNow: Date): Promise<TakGatewaySourceDescriptor[]> {
    return [
      {
        enabled: true,
        label: "TAK/CoT gateway",
        layers: ["mobile", "ground", "traffic"],
        sourceId: "tak_gateway",
        updateCadenceSeconds: 15
      }
    ];
  }

  async fetchFeatures(query: TakGatewayFeatureQuery, requestNow: Date): Promise<TakGatewayFeatureCollection> {
    return {
      contractVersion: "cop-tak-source-v1",
      features: [
        {
          geometry: { coordinates: [14.421, 50.087], type: "Point" },
          id: "tak:cot:TAK-ARDOS-001",
          properties: {
            affiliation: "friend",
            category: "tak_unit",
            confidence: 0.95,
            featureId: "tak:cot:TAK-ARDOS-001",
            label: "ARDOS Alpha",
            layer: "mobile",
            observedAt: requestNow.toISOString(),
            receivedAt: requestNow.toISOString(),
            sourceId: "tak_gateway",
            stale: false,
            validUntil: new Date(requestNow.getTime() + 600000).toISOString()
          },
          type: "Feature"
        }
      ],
      generatedAt: requestNow.toISOString(),
      query,
      source: {
        generatedAt: requestNow.toISOString(),
        sourceId: "tak-gateway-api",
        sourceType: "TAK_COT_GATEWAY"
      },
      sources: [
        {
          enabled: true,
          label: "TAK/CoT gateway",
          layers: ["mobile", "ground", "traffic"],
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
}
