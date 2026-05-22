import { afterEach, describe, expect, it, vi } from "vitest";
import { createPublicSafetyAggregateSourceSystem, createPublicSituationAggregateSourceSystem, createTakGatewaySourceSystem } from "@cop/canonical-model";
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
import type {
  SituationDataSource,
  SituationDataSourceConfig,
  SituationFeatureCollection,
  SituationFeatureQuery,
  SituationLayerDescriptor,
  SituationSourceDescriptor
} from "./situation-data-source.js";
import type {
  TakGatewayFeatureCollection,
  TakGatewayFeatureQuery,
  TakGatewayLayerDescriptor,
  TakGatewaySource,
  TakGatewaySourceConfig,
  TakGatewaySourceDescriptor
} from "./tak-gateway-source.js";

describe("map catalog route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a public source-neutral catalog without exposing diagnostic layers as map choices", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const app = buildServer({
      now: () => new Date("2026-05-22T08:00:00Z"),
      safetyDataSource: new FakeSafetyDataSource(),
      situationDataSource: new FakeSituationDataSource(),
      takGatewaySource: new FakeTakGatewaySource()
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/map/catalog"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      catalogVersion: string;
      layers: Array<{ layerId: string; query?: { providerLayerIds?: string[]; providerSourceIds?: string[] }; selectable?: boolean }>;
      providers: Array<{ providerId: string; status: string }>;
      sources: Array<{ feedsCatalogLayerIds?: string[]; selectableInMap: boolean; sourceId: string; sourceRole: string; usedByCatalogLayerIds?: string[] }>;
    };
    expect(body.catalogVersion).toBe("map-catalog-v1");
    expect(body.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: "sim.situation-data", status: "online" }),
      expect.objectContaining({ providerId: "sim.safety-data", status: "online" })
    ]));
    expect(body.providers.map((provider) => provider.providerId)).not.toContain("sim.tak-gateway");
    expect(body.layers.map((layer) => layer.layerId)).toEqual(expect.arrayContaining([
      "public.mobile.network",
      "public.weather.current",
      "public.safety.warnings",
      "reference.infrastructure.healthcare"
    ]));
    expect(body.layers.map((layer) => layer.layerId)).not.toContain("diagnostic.mobile.coverage");
    expect(body.layers.map((layer) => layer.layerId)).not.toContain("partner.tak.mobile");

    const mobileNetworkLayer = body.layers.find((layer) => layer.layerId === "public.mobile.network");
    expect(mobileNetworkLayer).toMatchObject({
      query: {
        providerLayerIds: ["mobile_network"],
        providerSourceIds: ["mobile_network_model"]
      },
      selectable: true
    });

    expect(body.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        feedsCatalogLayerIds: ["public.mobile.network"],
        selectableInMap: true,
        sourceId: "mobile_network_model",
        sourceRole: "aggregate"
      }),
      expect.objectContaining({
        selectableInMap: false,
        sourceId: "mobile_coverage_model",
        sourceRole: "input",
        usedByCatalogLayerIds: ["public.mobile.network"]
      }),
      expect.objectContaining({
        selectableInMap: false,
        sourceId: "ctu_nettest",
        sourceRole: "input",
        usedByCatalogLayerIds: ["public.mobile.network"]
      }),
      expect.objectContaining({
        selectableInMap: false,
        sourceId: "osm_postgis",
        sourceRole: "reference",
        usedByCatalogLayerIds: ["public.mobile.network"]
      })
    ]));
  });

  it("adds diagnostic and partner groups only for authenticated catalog requests", async () => {
    const app = buildServer({
      now: () => new Date("2026-05-22T08:00:00Z"),
      safetyDataSource: new FakeSafetyDataSource(),
      situationDataSource: new FakeSituationDataSource(),
      takGatewaySource: new FakeTakGatewaySource()
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/map/catalog?includeDiagnostics=true&includePartner=true"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { groups: Array<{ groupId: string }>; layers: Array<{ layerId: string }>; providers: Array<{ providerId: string }> };
    expect(body.groups.map((group) => group.groupId)).toEqual(expect.arrayContaining(["diagnostic", "partner"]));
    expect(body.layers.map((layer) => layer.layerId)).toEqual(expect.arrayContaining([
      "diagnostic.mobile.coverage",
      "diagnostic.mobile.ctu_measurements",
      "partner.tak.mobile"
    ]));
    expect(body.providers.map((provider) => provider.providerId)).toContain("sim.tak-gateway");
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

  async fetchLayers(_requestNow: Date): Promise<SituationLayerDescriptor[]> {
    return [
      { defaultVisible: true, expectedCadenceSeconds: 600, geometryTypes: ["Point"], label: "Weather", layerId: "weather" },
      { defaultVisible: false, expectedCadenceSeconds: 3600, geometryTypes: ["Polygon"], label: "Unified mobile network", layerId: "mobile_network" },
      { defaultVisible: false, expectedCadenceSeconds: 21600, geometryTypes: ["Polygon"], label: "Mobile coverage", layerId: "mobile_coverage" },
      { defaultVisible: false, expectedCadenceSeconds: 3600, geometryTypes: ["Point"], label: "Mobile measurements", layerId: "mobile" },
      { defaultVisible: false, expectedCadenceSeconds: 21600, geometryTypes: ["Point", "LineString", "Polygon"], label: "Ground", layerId: "ground" },
      { defaultVisible: false, expectedCadenceSeconds: 20, geometryTypes: ["Point"], label: "Traffic", layerId: "traffic" }
    ];
  }

  async fetchSources(_requestNow: Date): Promise<SituationSourceDescriptor[]> {
    return [
      { enabled: true, label: "Open-Meteo", layers: ["weather"], sourceId: "open_meteo", updateCadenceSeconds: 600 },
      { enabled: true, label: "Unified mobile network assessment", layers: ["mobile_network"], sourceId: "mobile_network_model", updateCadenceSeconds: 3600 },
      { enabled: true, label: "Mobile coverage estimate model", layers: ["mobile_coverage"], sourceId: "mobile_coverage_model", updateCadenceSeconds: 21600 },
      { enabled: true, label: "CTU NetTest mobile measurements", layers: ["mobile"], sourceId: "ctu_nettest", updateCadenceSeconds: 3600 },
      { enabled: true, label: "Local OpenStreetMap PostGIS context", layers: ["ground", "mobile"], sourceId: "osm_postgis", updateCadenceSeconds: 21600 },
      { enabled: true, label: "PID GTFS-RT", layers: ["traffic"], sourceId: "pid_gtfs_rt", updateCadenceSeconds: 20 }
    ];
  }

  async fetchFeatures(query: SituationFeatureQuery, requestNow: Date): Promise<SituationFeatureCollection> {
    return {
      contractVersion: "cop-situation-source-v1",
      features: [],
      generatedAt: requestNow.toISOString(),
      query,
      source: { sourceId: "situation-data-api", sourceType: "PUBLIC_SITUATION_AGGREGATE" },
      sources: await this.fetchSources(requestNow),
      summary: { featureCount: 0, sourceCount: 0, staleFeatureCount: 0, warningCount: 0 },
      type: "FeatureCollection",
      warnings: []
    };
  }
}

class FakeSafetyDataSource implements SafetyDataSource {
  readonly config: SafetyDataSourceConfig = {
    baseUrl: "https://sim.zeleznalady.cz/safety-data/api/v1",
    cacheTtlMs: 120000,
    enabled: true,
    maxLimit: 250,
    timeoutMs: 7000
  };

  readonly sourceSystem = createPublicSafetyAggregateSourceSystem();

  async fetchConfig(_requestNow: Date): Promise<SafetyDataPublicConfig> {
    return {
      enabledSources: ["chmi_alerts", "chmi_hydro"]
    };
  }

  async fetchLayers(_requestNow: Date): Promise<SafetyLayerDescriptor[]> {
    return [
      { defaultVisible: true, expectedCadenceSeconds: 300, geometryTypes: ["Point", "Polygon"], label: "Warnings", layerId: "warnings" },
      { defaultVisible: true, expectedCadenceSeconds: 600, geometryTypes: ["Point"], label: "Flood", layerId: "flood" }
    ];
  }

  async fetchSources(_requestNow: Date): Promise<SafetySourceDescriptor[]> {
    return [
      { enabled: true, label: "CHMI Alerts", layers: ["warnings"], sourceId: "chmi_alerts", updateCadenceSeconds: 300 },
      { enabled: true, label: "CHMI Hydro", layers: ["flood"], sourceId: "chmi_hydro", updateCadenceSeconds: 600 }
    ];
  }

  async fetchFeatures(query: SafetyFeatureQuery, requestNow: Date): Promise<SafetyFeatureCollection> {
    return {
      contractVersion: "cop-safety-source-v1",
      features: [],
      generatedAt: requestNow.toISOString(),
      query,
      source: { sourceId: "safety-data-api", sourceType: "PUBLIC_SAFETY_AGGREGATE" },
      sources: await this.fetchSources(requestNow),
      summary: {
        advisoryCount: 0,
        criticalCount: 0,
        featureCount: 0,
        sourceCount: 0,
        staleFeatureCount: 0,
        warningCount: 0
      },
      type: "FeatureCollection",
      warnings: []
    };
  }
}

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
      { defaultVisible: false, expectedCadenceSeconds: 15, geometryTypes: ["Point"], label: "Mobile units", layerId: "mobile" }
    ];
  }

  async fetchSources(_requestNow: Date): Promise<TakGatewaySourceDescriptor[]> {
    return [
      { enabled: true, label: "TAK/CoT gateway", layers: ["mobile", "ground", "traffic"], sourceId: "tak_gateway", updateCadenceSeconds: 15 }
    ];
  }

  async fetchFeatures(query: TakGatewayFeatureQuery, requestNow: Date): Promise<TakGatewayFeatureCollection> {
    return {
      contractVersion: "cop-tak-source-v1",
      features: [],
      generatedAt: requestNow.toISOString(),
      query,
      source: { sourceId: "tak-gateway-api", sourceType: "TAK_COT_GATEWAY" },
      sources: await this.fetchSources(requestNow),
      summary: {
        affiliationCounts: { friend: 0, hostile: 0, neutral: 0, unknown: 0 },
        eventCount: 0,
        featureCount: 0,
        sourceCount: 0,
        staleFeatureCount: 0,
        warningCount: 0
      },
      type: "FeatureCollection",
      warnings: []
    };
  }
}
