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
import type { ProviderMapCatalog } from "./provider-map-catalog.js";

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

  it("translates provider catalogs into selectable public layers without exposing technical inputs", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const app = buildServer({
      now: () => new Date("2026-05-22T08:00:00Z"),
      situationDataSource: new FakeProviderCatalogSituationDataSource()
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/map/catalog"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      layers: Array<{ groupId: string; label: string; layerId: string; query?: { categoryIds?: string[]; providerLayerIds?: string[]; providerSourceIds?: string[] }; selectable?: boolean }>;
      sources: Array<{ feedsCatalogLayerIds?: string[]; selectableInMap: boolean; sourceId: string; sourceRole: string; usedByCatalogLayerIds?: string[] }>;
    };
    expect(body.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        groupId: "communications",
        label: "BTS / komunikační stožáry",
        layerId: "reference.infrastructure.communications",
        query: expect.objectContaining({
          categoryIds: ["communications_tower"],
          providerLayerIds: ["mobile"],
          providerSourceIds: ["osm_postgis"]
        }),
        selectable: true
      })
    ]));
    expect(body.layers.map((layer) => layer.layerId)).not.toContain("diagnostic.mobile.coverage");
    expect(body.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        feedsCatalogLayerIds: ["reference.infrastructure.communications"],
        selectableInMap: false,
        sourceId: "osm_postgis",
        sourceRole: "reference"
      })
    ]));
    expect(body.sources.map((source) => source.sourceId)).not.toContain("mobile_coverage_model");
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

  it("queries public map features through the source-neutral contract", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const app = buildServer({
      now: () => new Date("2026-05-22T08:00:00Z"),
      safetyDataSource: new FakeSafetyDataSource(),
      situationDataSource: new FakeSituationDataSource(),
      takGatewaySource: new FakeTakGatewaySource()
    });

    const response = await app.inject({
      body: {
        bbox: [13.85, 49.65, 15.35, 50.45],
        filters: {
          "public.mobile.network": {
            technology: ["4G"]
          }
        },
        includePartner: true,
        layerIds: ["public.mobile.network", "public.safety.warnings", "partner.tak.mobile"],
        limit: 20
      },
      method: "POST",
      url: "/api/v1/map/query"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      query: { layerIds: string[] };
      safety?: SafetyFeatureCollection;
      situation?: SituationFeatureCollection;
      tak?: TakGatewayFeatureCollection;
      warnings: string[];
    };
    expect(body.query.layerIds).toEqual(expect.arrayContaining(["public.mobile.network", "public.safety.warnings"]));
    expect(body.query.layerIds).toHaveLength(2);
    expect(body.situation?.query).toMatchObject({
      layers: ["mobile_network"],
      sources: ["mobile_network_model"],
      technology: "4G"
    });
    expect(body.safety?.query.layers).toEqual(["warnings"]);
    expect(body.tak).toBeUndefined();
    expect(body.warnings.join(" ")).toContain("partner.tak.mobile");
  });

  it("uses catalog defaults for mobile-network technology filters", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const app = buildServer({
      now: () => new Date("2026-05-22T08:00:00Z"),
      situationDataSource: new FakeProviderCatalogSituationDataSource()
    });

    const response = await app.inject({
      body: {
        bbox: [13.85, 49.65, 15.35, 50.45],
        layerIds: ["public.mobile.network"],
        limit: 20
      },
      method: "POST",
      url: "/api/v1/map/query"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { situation?: SituationFeatureCollection };
    expect(body.situation?.query).toMatchObject({
      layers: ["mobile_network"],
      sources: ["mobile_network_model"],
      technology: "4G"
    });
  });

  it("post-filters provider features by catalog category ids", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const app = buildServer({
      now: () => new Date("2026-05-22T08:00:00Z"),
      situationDataSource: new FakeProviderCatalogSituationDataSource()
    });

    const response = await app.inject({
      body: {
        bbox: [13.85, 49.65, 15.35, 50.45],
        layerIds: ["reference.infrastructure.communications"],
        limit: 20
      },
      method: "POST",
      url: "/api/v1/map/query"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { situation?: SituationFeatureCollection };
    expect(body.situation?.features.map((feature) => feature.properties.category)).toEqual(["communications_tower"]);
    expect(body.situation?.summary.featureCount).toBe(1);
  });

  it("allows authenticated map feature queries to include partner layers", async () => {
    const app = buildServer({
      now: () => new Date("2026-05-22T08:00:00Z"),
      safetyDataSource: new FakeSafetyDataSource(),
      situationDataSource: new FakeSituationDataSource(),
      takGatewaySource: new FakeTakGatewaySource()
    });

    const response = await app.inject({
      body: {
        bbox: [13.85, 49.65, 15.35, 50.45],
        includePartner: true,
        layerIds: ["partner.tak.mobile"],
        limit: 20
      },
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      url: "/api/v1/map/query"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { query: { layerIds: string[] }; tak?: TakGatewayFeatureCollection };
    expect(body.query.layerIds).toEqual(["partner.tak.mobile"]);
    expect(body.tak?.query.layers).toEqual(["mobile"]);
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

class FakeProviderCatalogSituationDataSource extends FakeSituationDataSource {
  async fetchCatalog(_requestNow: Date): Promise<ProviderMapCatalog> {
    return {
      contractVersion: "provider-map-catalog-v1",
      layers: [
        {
          audience: "public",
          cacheTtlSeconds: 3600,
          defaultVisible: false,
          filters: [
            {
              defaultValue: ["4G"],
              filterId: "technology",
              label: "Technologie",
              type: "multi_select",
              values: ["2G", "4G", "5G"]
            }
          ],
          geometryTypes: ["Polygon"],
          kind: "vector_features",
          label: "Mobilní síť",
          providerLayerId: "mobile_network",
          query: {
            maxFeatures: 250,
            mode: "bbox",
            providerId: "sim.situation-data",
            providerLayerIds: ["mobile_network"],
            providerSourceIds: ["mobile_network_model"],
            streamId: "features"
          },
          recommendedCatalogLayerId: "public.mobile.network",
          refreshSeconds: 300,
          role: "overlay",
          selectable: true,
          sourceIds: ["mobile_network_model"],
          styleProfile: "mobile-network-quality-v1",
          technicalInputs: ["mobile_coverage_model", "ctu_nettest", "osm_postgis"]
        },
        {
          audience: "diagnostic",
          cacheTtlSeconds: 21600,
          defaultVisible: false,
          geometryTypes: ["Polygon"],
          kind: "vector_features",
          label: "Technický odhad pokrytí",
          providerLayerId: "mobile_coverage",
          query: {
            maxFeatures: 250,
            mode: "bbox",
            providerId: "sim.situation-data",
            providerLayerIds: ["mobile_coverage"],
            providerSourceIds: ["mobile_coverage_model"],
            streamId: "features"
          },
          recommendedCatalogLayerId: "diagnostic.mobile.coverage",
          refreshSeconds: 21600,
          role: "diagnostic",
          selectable: false,
          sourceIds: ["mobile_coverage_model"],
          styleProfile: "mobile-coverage-diagnostic-v1"
        },
        {
          audience: "public",
          cacheTtlSeconds: 21600,
          categoryPath: ["reference", "infrastructure", "communications"],
          defaultVisible: false,
          geometryTypes: ["Point"],
          kind: "vector_features",
          label: "Komunikační infrastruktura",
          providerLayerId: "mobile.osm_postgis.communications",
          query: {
            categoryFilter: ["communications_tower"],
            maxFeatures: 250,
            mode: "bbox",
            providerId: "sim.situation-data",
            providerLayerIds: ["mobile"],
            providerSourceIds: ["osm_postgis"],
            streamId: "features"
          },
          recommendedCatalogLayerId: "reference.infrastructure.communications",
          refreshSeconds: 21600,
          role: "reference",
          selectable: false,
          sourceIds: ["osm_postgis"],
          styleProfile: "communications-infrastructure-v1"
        }
      ],
      providerId: "sim.situation-data",
      sources: [
        {
          audience: "public",
          enabled: true,
          feedsCatalogLayerIds: ["public.mobile.network"],
          label: "Unified mobile network assessment",
          selectableInMap: true,
          sourceId: "mobile_network_model",
          sourceRole: "aggregate",
          updateCadenceSeconds: 3600,
          usedByCatalogLayerIds: ["public.mobile.network"],
          visibleInDiagnostics: true
        },
        {
          audience: "diagnostic",
          enabled: true,
          feedsCatalogLayerIds: ["diagnostic.mobile.coverage"],
          label: "Mobile coverage estimate model",
          selectableInMap: false,
          sourceId: "mobile_coverage_model",
          sourceRole: "input",
          updateCadenceSeconds: 21600,
          usedByCatalogLayerIds: ["public.mobile.network"],
          visibleInDiagnostics: true
        },
        {
          audience: "public",
          enabled: true,
          feedsCatalogLayerIds: ["reference.infrastructure.communications"],
          label: "Local OpenStreetMap PostGIS context",
          selectableInMap: false,
          sourceId: "osm_postgis",
          sourceRole: "reference",
          updateCadenceSeconds: 21600,
          usedByCatalogLayerIds: ["public.mobile.network"],
          visibleInDiagnostics: true
        }
      ],
      status: "online",
      warnings: []
    };
  }

  override async fetchFeatures(query: SituationFeatureQuery, requestNow: Date): Promise<SituationFeatureCollection> {
    if (!query.layers.includes("mobile")) {
      return {
        ...(await super.fetchFeatures(query, requestNow)),
        query
      };
    }
    return {
      contractVersion: "cop-situation-source-v1",
      features: [
        {
          geometry: { coordinates: [14.4, 50.1], type: "Point" },
          properties: {
            category: "communications_tower",
            confidence: 0.72,
            featureId: "mobile:osm_postgis:node:1:communications_tower",
            label: "GSM-R",
            layer: "mobile",
            observedAt: requestNow.toISOString(),
            severity: "info",
            sourceId: "osm_postgis",
            stale: false
          },
          type: "Feature"
        },
        {
          geometry: { coordinates: [14.41, 50.11], type: "Point" },
          properties: {
            category: "network_measurement",
            confidence: 0.72,
            featureId: "mobile:osm_postgis:node:2:network_measurement",
            label: "Raw mobile input",
            layer: "mobile",
            observedAt: requestNow.toISOString(),
            severity: "info",
            sourceId: "osm_postgis",
            stale: false
          },
          type: "Feature"
        }
      ],
      generatedAt: requestNow.toISOString(),
      query,
      source: { sourceId: "situation-data-api", sourceType: "PUBLIC_SITUATION_AGGREGATE" },
      sources: await this.fetchSources(requestNow),
      summary: { featureCount: 2, sourceCount: 1, staleFeatureCount: 0, warningCount: 0 },
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
