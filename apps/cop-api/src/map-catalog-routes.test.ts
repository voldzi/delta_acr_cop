import { afterEach, describe, expect, it, vi } from "vitest";
import { createPublicFlightAggregateSourceSystem, createPublicSafetyAggregateSourceSystem, createPublicSituationAggregateSourceSystem, createTakGatewaySourceSystem } from "@cop/canonical-model";
import { buildServer } from "./server.js";
import type {
  SafetyDataPublicConfig,
  SafetyDataSource,
  SafetyDataSourceConfig,
  SafetyFeatureCollection,
  SafetyFeatureQuery,
  SafetyHydroStationDetailQuery,
  SafetyLayerDescriptor,
  SafetySourceDescriptor
} from "./safety-data-source.js";
import type {
  MobileTowerViewshedQuery,
  MobileTowerViewshedResponse,
  RadioCoverageRequest,
  RadioFeatureCollectionResponse,
  RadioLinkCheckRequest,
  RadioLinkCheckResponse,
  RadioProfile,
  RadioProfilesResponse,
  SituationDataSource,
  SituationDataSourceConfig,
  SituationFeatureCollection,
  SituationFeatureQuery,
  SituationLayerDescriptor,
  SituationSourceDescriptor
} from "./situation-data-source.js";
import type {
  FlightDataSource,
  FlightDataSourceConfig,
  FlightReferenceFeature,
  FlightReferenceFeatureCollection,
  FlightReferenceFeatureQuery
} from "./flight-data-source.js";
import type { MessagingProvider, MessagingProviderConfig } from "./messaging-provider.js";
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
      layers: Array<{ defaultVisible?: boolean; groupId?: string; label?: string; layerId: string; minZoom?: number; query?: { maxFeatures?: number; providerLayerIds?: string[]; providerSourceIds?: string[] }; role?: string; selectable?: boolean }>;
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
      "public.weather.observations",
      "public.weather.forecast_area",
      "public.weather.webcams",
      "public.safety.air_quality",
      "public.boundary.admin",
      "public.safety.fire",
      "public.safety.weather_alerts",
      "public.safety.warnings",
      "reference.infrastructure.healthcare"
    ]));
    expect(body.layers.map((layer) => layer.layerId)).not.toContain("diagnostic.mobile.coverage");
    expect(body.layers.map((layer) => layer.layerId)).not.toContain("partner.tak.mobile");

    const mobileNetworkLayer = body.layers.find((layer) => layer.layerId === "public.mobile.network");
    expect(mobileNetworkLayer).toMatchObject({
      minZoom: 4,
      query: {
        providerLayerIds: ["mobile_network"],
        providerSourceIds: ["mobile_network_model"]
      },
      selectable: true
    });
    expect(body.layers.find((layer) => layer.layerId === "public.weather.current")).toMatchObject({
      defaultVisible: false,
      label: "Počasí ve středu mapy",
      role: "reference",
      selectable: false
    });
    expect(body.layers.find((layer) => layer.layerId === "public.weather.observations")).toMatchObject({
      defaultVisible: true,
      label: "Počasí",
      minZoom: 4,
      query: {
        providerLayerIds: ["weather"],
        providerSourceIds: ["chmi_weather_stations"]
      },
      role: "primary",
      selectable: true
    });
    expect(body.layers.find((layer) => layer.layerId === "public.weather.forecast_area")).toMatchObject({
      groupId: "risks.weather",
      label: "Předpověď počasí",
      minZoom: 4,
      query: {
        maxFeatures: 24,
        providerLayerIds: ["weather_forecast_area"],
        providerSourceIds: ["weather_forecast"]
      },
      selectable: true
    });
    expect(body.layers.find((layer) => layer.layerId === "public.traffic.transit.pid")).toMatchObject({
      groupId: "transport",
      label: "Veřejná doprava Praha/PID",
      minZoom: 7,
      query: {
        maxFeatures: 5000,
        providerLayerIds: ["traffic"],
        providerSourceIds: ["pid_gtfs_rt"]
      },
      selectable: true
    });
    expect(body.layers.find((layer) => layer.layerId === "public.weather.webcams")).toMatchObject({
      groupId: "risks.weather",
      label: "Kamery",
      query: {
        providerLayerIds: ["weather_webcams"],
        providerSourceIds: ["chmi_weather_webcams"]
      },
      minZoom: 4,
      selectable: true
    });
    expect(body.layers.find((layer) => layer.layerId === "public.safety.flood")).toMatchObject({
      label: "Vodní stavy a průtoky",
      minZoom: 4,
      query: {
        maxFeatures: 600
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
        usedByCatalogLayerIds: expect.arrayContaining(["public.mobile.network"])
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
      layers: Array<{ availability?: string; defaultVisible?: boolean; disabledReason?: string; enabled?: boolean; groupId: string; kind?: string; label: string; layerId: string; minZoom?: number; query?: { categoryIds?: string[]; maxFeatures?: number; mode?: string; providerLayerIds?: string[]; providerSourceIds?: string[] }; selectable?: boolean }>;
      sources: Array<{ availability?: string; disabledReason?: string; enabled?: boolean; feedsCatalogLayerIds?: string[]; selectableInMap: boolean; sourceId: string; sourceRole: string; usedByCatalogLayerIds?: string[] }>;
    };
    expect(body.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        groupId: "communications",
        label: "BTS / komunikační stožáry",
        layerId: "reference.infrastructure.communications",
        minZoom: 4,
        query: expect.objectContaining({
          categoryIds: ["communications_tower"],
          providerLayerIds: ["mobile"],
          providerSourceIds: ["osm_postgis"]
        }),
        selectable: true
      }),
      expect.objectContaining({
        groupId: "communications",
        label: "Mobilní síť",
        layerId: "public.mobile.network",
        minZoom: 4,
        query: expect.objectContaining({
          providerLayerIds: ["mobile_network"],
          providerSourceIds: ["mobile_network_model"]
        }),
        selectable: true
      }),
      expect.objectContaining({
        groupId: "risks.weather",
        kind: "grid_field",
        layerId: "public.weather.temperature_grid",
        query: expect.objectContaining({
          mode: "grid",
          providerLayerIds: ["weather.temperature_grid"],
          providerSourceIds: ["chmi_weather_stations"]
        }),
        selectable: true
      }),
      expect.objectContaining({
        groupId: "risks.weather",
        label: "Kamery",
        layerId: "public.weather.webcams",
        minZoom: 4,
        query: expect.objectContaining({
          providerLayerIds: ["weather_webcams"],
          providerSourceIds: ["chmi_weather_webcams"]
        }),
        selectable: true
      }),
      expect.objectContaining({
        groupId: "transport",
        label: "Veřejná doprava Praha/PID",
        layerId: "public.traffic.transit.pid",
        minZoom: 6,
        query: expect.objectContaining({
          maxFeatures: 5000,
          providerLayerIds: ["traffic"],
          providerSourceIds: ["pid_gtfs_rt"]
        }),
        selectable: true
      }),
      expect.objectContaining({
        groupId: "transport",
        label: "Veřejná doprava Brno/IDS JMK",
        layerId: "public.traffic.transit.idsjmk",
        minZoom: 6,
        query: expect.objectContaining({
          maxFeatures: 5000,
          providerLayerIds: ["traffic"],
          providerSourceIds: ["idsjmk_vehicle_positions"]
        }),
        refreshSeconds: 20,
        selectable: true
      }),
      expect.objectContaining({
        groupId: "transport",
        label: "Vlaky",
        layerId: "public.traffic.transit.trains",
        minZoom: 6,
        query: expect.objectContaining({
          maxFeatures: 5000,
          providerLayerIds: ["traffic"],
          providerSourceIds: ["spravazeleznic_trains"]
        }),
        refreshSeconds: 900,
        selectable: true
      }),
      expect.objectContaining({
        groupId: "transport",
        label: "Zastávky veřejné dopravy",
        layerId: "public.traffic.transit_stops",
        minZoom: 11,
        query: expect.objectContaining({
          maxFeatures: 5000,
          providerLayerIds: ["traffic"],
          providerSourceIds: ["public_transit_static"]
        }),
        refreshSeconds: 21600,
        selectable: true
      })
    ]));
    expect(body.layers.find((layer) => layer.layerId === "public.weather.wind_field")).toMatchObject({
      availability: "disabled",
      defaultVisible: false,
      disabledReason: "SIM dočasně nevystavuje větrné pole pro veřejnou mapu.",
      enabled: false,
      label: "Vítr",
      selectable: false
    });
    expect(body.sources.find((source) => source.sourceId === "chmi_weather_wind_field")).toMatchObject({
      availability: "disabled",
      disabledReason: "SIM dočasně nevystavuje větrné pole pro veřejnou mapu.",
      enabled: false,
      selectableInMap: false
    });
    expect(body.layers.map((layer) => layer.layerId)).not.toContain("diagnostic.mobile.coverage");
    expect(body.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        feedsCatalogLayerIds: expect.arrayContaining(["reference.infrastructure.communications"]),
        selectableInMap: false,
        sourceId: "osm_postgis",
        sourceRole: "reference"
      }),
      expect.objectContaining({
        feedsCatalogLayerIds: ["public.weather.webcams"],
        selectableInMap: true,
        sourceId: "chmi_weather_webcams",
        sourceRole: "final"
      })
    ]));
    expect(body.sources.map((source) => source.sourceId)).not.toContain("mobile_coverage_model");
  });

  it("prefers authoritative safety-data layers over situation-data compatibility projections", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const app = buildServer({
      now: () => new Date("2026-05-22T08:00:00Z"),
      safetyDataSource: new FakeProviderCatalogSafetyDataSource(),
      situationDataSource: new FakeProviderCatalogSituationDataSource()
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/map/catalog"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      layers: Array<{ compatibilityOnly?: boolean; layerId: string; preferredProviderId?: string; query: { maxFeatures?: number; providerId: string; providerLayerIds?: string[]; providerSourceIds?: string[] } }>;
      sources: Array<{ compatibilityOnly?: boolean; feedsCatalogLayerIds?: string[]; providerId: string; sourceId: string }>;
    };
    const fireLayer = body.layers.find((layer) => layer.layerId === "public.safety.fire");
    expect(fireLayer).toMatchObject({
      query: {
        providerId: "sim.safety-data",
        providerLayerIds: ["fire"],
        providerSourceIds: ["chmi_alerts", "gdacs_alerts", "nasa_firms", "hzs_incidents", "municipal_alerts"]
      }
    });
    expect(fireLayer?.compatibilityOnly).toBeUndefined();
    expect(fireLayer?.preferredProviderId).toBeUndefined();
    expect(body.layers.filter((layer) => layer.layerId === "public.safety.fire")).toHaveLength(1);
    const floodLayer = body.layers.find((layer) => layer.layerId === "public.safety.flood");
    expect(floodLayer).toMatchObject({
      query: {
        maxFeatures: 600,
        providerId: "sim.safety-data",
        providerLayerIds: ["flood"],
        providerSourceIds: ["chmi_hydro", "gdacs_alerts"]
      }
    });
    const warningLayer = body.layers.find((layer) => layer.layerId === "public.safety.warnings");
    expect(warningLayer).toMatchObject({
      query: {
        providerId: "sim.safety-data",
        providerLayerIds: ["warnings"],
        providerSourceIds: ["hzs_incidents", "municipal_alerts"]
      }
    });
    const chmiSource = body.sources.find((source) => source.providerId === "sim.safety-data" && source.sourceId === "chmi_alerts");
    expect(chmiSource?.feedsCatalogLayerIds).toEqual(["public.safety.weather_alerts", "public.safety.fire"]);
    expect(body.sources).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        compatibilityOnly: true,
        providerId: "sim.situation-data",
        sourceId: "safety_data"
      })
    ]));
  });

  it("returns a degraded catalog when a provider catalog does not answer", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    vi.stubEnv("COP_MAP_CATALOG_PROVIDER_TIMEOUT_MS", "20");
    const app = buildServer({
      now: () => new Date("2026-05-22T08:00:00Z"),
      safetyDataSource: new FakeSafetyDataSource(),
      situationDataSource: new HangingSituationDataSource()
    });

    const startedAt = Date.now();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/map/catalog"
    });
    const durationMs = Date.now() - startedAt;

    expect(response.statusCode).toBe(200);
    expect(durationMs).toBeLessThan(1000);
    const body = response.json() as {
      layers: Array<{ layerId: string }>;
      providers: Array<{ providerId: string; status: string }>;
      warnings: string[];
    };
    expect(body.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: "sim.situation-data", status: "unavailable" }),
      expect.objectContaining({ providerId: "sim.safety-data", status: "online" })
    ]));
    expect(body.layers.map((layer) => layer.layerId)).toContain("public.safety.warnings");
    expect(body.warnings.join(" ")).toContain("Situation data catalog provider timed out");
  });

  it("does not let a slow messaging provider block dependency health", async () => {
    vi.stubEnv("COP_HEALTH_DEPENDENCY_TIMEOUT_MS", "20");
    const app = buildServer({
      messagingProvider: new HangingMessagingProvider(),
      now: () => new Date("2026-05-22T08:00:00Z")
    });

    const startedAt = Date.now();
    const response = await app.inject({
      method: "GET",
      url: "/health/dependencies"
    });
    const durationMs = Date.now() - startedAt;

    expect(response.statusCode).toBe(200);
    expect(durationMs).toBeLessThan(1000);
    const body = response.json() as {
      dependencies: Array<{ detail?: string; name: string; status: string }>;
    };
    expect(body.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "csm-messaging-provider",
        status: "degraded"
      })
    ]));
    expect(body.dependencies.find((dependency) => dependency.name === "csm-messaging-provider")?.detail).toContain("timed out");
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
        layerIds: ["public.mobile.network", "public.safety.warnings", "public.safety.flood", "partner.tak.mobile"],
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
    expect(body.query.layerIds).toEqual(expect.arrayContaining(["public.mobile.network", "public.safety.warnings", "public.safety.flood"]));
    expect(body.query.layerIds).toHaveLength(3);
    expect(body.situation?.query).toMatchObject({
      layers: ["mobile_network"],
      sources: ["mobile_network_model"],
      technology: "4G"
    });
    expect(body.safety?.query.layers).toEqual(["warnings", "flood"]);
    expect(body.safety?.query.sources).toEqual(["hzs_incidents", "municipal_alerts", "chmi_hydro", "gdacs_alerts"]);
    expect(body.tak).toBeUndefined();
    expect(body.warnings.join(" ")).toContain("partner.tak.mobile");
  });

  it("proxies CHMI hydro station detail through COP API", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const app = buildServer({
      now: () => new Date("2026-06-25T10:00:00Z"),
      safetyDataSource: new FakeSafetyDataSource()
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/safety/hydro/stations/0-203-1-239000/observations?series=H,Q"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      contractVersion: "chmi-hydro-station-detail-v1",
      sourceId: "chmi_hydro",
      station: { stationId: "0-203-1-239000" }
    });
  });

  it("proxies per-BTS mobile viewshed through COP API", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const situationDataSource = new FakeSituationDataSource();
    const app = buildServer({
      now: () => new Date("2026-06-27T10:00:00Z"),
      situationDataSource
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/mobile-coverage/towers/node%3A123/viewshed?technology=4G&radiusM=12000&azimuthStepDeg=10&distanceStepM=500"
    });

    expect(response.statusCode).toBe(200);
    expect(situationDataSource.lastTowerViewshed).toEqual({
      query: {
        azimuthStepDeg: 10,
        distanceStepM: 500,
        radiusM: 12000,
        technology: "4G"
      },
      towerId: "node:123"
    });
    expect(response.json()).toMatchObject({
      contractVersion: "sim-mobile-coverage-tower-viewshed-v1",
      features: [
        {
          properties: {
            confidence: 0.82,
            quality: "good"
          },
          type: "Feature"
        }
      ],
      summary: {
        disclaimer: expect.stringContaining("modelový odhad")
      },
      tower: {
        btsStatus: "operator_feed_unavailable",
        operatorStatusAvailable: false
      },
      type: "FeatureCollection"
    });
  });

  it("normalizes legacy mobile feature ids before calling SIM viewshed", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const situationDataSource = new FakeSituationDataSource();
    const app = buildServer({
      now: () => new Date("2026-06-27T10:00:00Z"),
      situationDataSource
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/mobile-coverage/towers/mobile%3Aosm_postgis%3Anode%3A123%3Acommunications_tower/viewshed?technology=4G"
    });

    expect(response.statusCode).toBe(200);
    expect(situationDataSource.lastTowerViewshed?.towerId).toBe("node:123");
  });

  it("maps unsupported mobile viewshed objects to a user-facing unavailable state", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const situationDataSource = new FakeSituationDataSource();
    situationDataSource.towerViewshedError = Object.assign(new Error("404 Not Found for /mobile-coverage/towers/node:missing/viewshed"), { status: 404 });
    const app = buildServer({
      now: () => new Date("2026-06-27T10:00:00Z"),
      situationDataSource
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/mobile-coverage/towers/node%3Amissing/viewshed?technology=4G"
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: {
        code: "MOBILE_TOWER_VIEWSHED_UNAVAILABLE",
        message: "Pro tento typ objektu není výpočet dostupný."
      }
    });
  });

  it("proxies radio profile catalog through COP API", async () => {
    const app = buildServer({
      now: () => new Date("2026-06-27T10:00:00Z"),
      situationDataSource: new FakeSituationDataSource()
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "GET",
      url: "/api/v1/radio/profiles"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      profiles: [
        {
          frequencyMhz: 446,
          profileId: "pmr446_handheld"
        }
      ],
      warnings: []
    });
  });

  it("proxies radio coverage request through COP API", async () => {
    const situationDataSource = new FakeSituationDataSource();
    const app = buildServer({
      now: () => new Date("2026-06-27T10:00:00Z"),
      situationDataSource
    });

    const response = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        profileId: "pmr446_handheld",
        radiusM: 5000,
        station: { antennaHeightM: 1.5, lat: 50.08, lon: 14.42 }
      },
      url: "/api/v1/radio/coverage"
    });

    expect(response.statusCode).toBe(200);
    expect(situationDataSource.lastRadioCoverage).toMatchObject({
      profileId: "pmr446_handheld",
      radiusM: 5000,
      station: { lat: 50.08, lon: 14.42 }
    });
    expect(response.json()).toMatchObject({
      features: [
        {
          properties: {
            quality: "fair"
          }
        }
      ],
      type: "FeatureCollection"
    });
  });

  it("proxies radio link-check and rejects sensitive fields", async () => {
    const situationDataSource = new FakeSituationDataSource();
    const app = buildServer({
      now: () => new Date("2026-06-27T10:00:00Z"),
      situationDataSource
    });

    const rejected = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        callsign: "secret",
        from: { lat: 50.08, lon: 14.42 },
        profileId: "pmr446_handheld",
        to: { lat: 50.11, lon: 14.51 }
      },
      url: "/api/v1/radio/link-check"
    });

    expect(rejected.statusCode).toBe(400);

    const accepted = await app.inject({
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      payload: {
        from: { antennaHeightM: 1.5, lat: 50.08, lon: 14.42 },
        profileId: "pmr446_handheld",
        radioName: "PMR tým A",
        to: { lat: 50.11, lon: 14.51, receiverHeightM: 1.5 }
      },
      url: "/api/v1/radio/link-check"
    });

    expect(accepted.statusCode).toBe(200);
    expect(situationDataSource.lastRadioLinkCheck).toMatchObject({
      profileId: "pmr446_handheld",
      radioName: "PMR tým A"
    });
    expect(accepted.json()).toMatchObject({
      distanceM: 4200,
      linkStatus: "clear"
    });
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
      headers: { authorization: "Bearer dev-lab-token" },
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

  it("queries provider grid layers through situation-data layer aliases", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const app = buildServer({
      now: () => new Date("2026-05-22T08:00:00Z"),
      situationDataSource: new FakeProviderCatalogSituationDataSource()
    });

    const response = await app.inject({
      body: {
        bbox: [13.85, 49.65, 15.35, 50.45],
        layerIds: ["public.weather.temperature_grid"],
        limit: 20
      },
      method: "POST",
      url: "/api/v1/map/query"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { query: { layerIds: string[] }; situation?: SituationFeatureCollection };
    expect(body.query.layerIds).toEqual(["public.weather.temperature_grid"]);
    expect(body.situation?.query).toMatchObject({
      layers: ["weather_temperature_grid"],
      sources: ["chmi_weather_stations"]
    });
  });

  it("does not query provider catalog layers marked disabled", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const app = buildServer({
      now: () => new Date("2026-05-22T08:00:00Z"),
      situationDataSource: new FakeProviderCatalogSituationDataSource()
    });

    const response = await app.inject({
      body: {
        bbox: [13.85, 49.65, 15.35, 50.45],
        layerIds: ["public.weather.wind_field"],
        limit: 20
      },
      method: "POST",
      url: "/api/v1/map/query"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { query: { layerIds: string[] }; situation?: SituationFeatureCollection; warnings: string[] };
    expect(body.query.layerIds).toEqual([]);
    expect(body.situation).toBeUndefined();
    expect(body.warnings.join(" ")).toContain("Disabled map layers ignored: public.weather.wind_field.");
  });

  it("queries CHMI weather observations without mixing in webcam sources", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const situationDataSource = new FakeSituationDataSource();
    const app = buildServer({
      now: () => new Date("2026-05-22T08:00:00Z"),
      situationDataSource
    });

    const response = await app.inject({
      body: {
        bbox: [12.0, 48.5, 18.9, 51.2],
        layerIds: ["public.weather.observations"],
        limit: 250
      },
      method: "POST",
      url: "/api/v1/map/query"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { situation?: SituationFeatureCollection };
    expect(situationDataSource.lastFeatureQuery).toMatchObject({
      layers: ["weather"],
      sources: ["chmi_weather_stations"]
    });
    expect(situationDataSource.lastFeatureQuery?.sources).not.toContain("chmi_weather_webcams");
    expect(body.situation?.query).toMatchObject({
      layers: ["weather"],
      sources: ["chmi_weather_stations"]
    });
  });

  it("queries CHMI weather webcams with the dedicated SIM weather_webcams layer", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const situationDataSource = new FakeSituationDataSource();
    const app = buildServer({
      now: () => new Date("2026-05-22T08:00:00Z"),
      situationDataSource
    });

    const response = await app.inject({
      body: {
        bbox: [12.0, 48.5, 18.9, 51.2],
        layerIds: ["public.weather.webcams"],
        limit: 250
      },
      method: "POST",
      url: "/api/v1/map/query"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { situation?: SituationFeatureCollection };
    expect(situationDataSource.lastFeatureQuery).toMatchObject({
      layers: ["weather_webcams"],
      sources: ["chmi_weather_webcams"]
    });
    expect(body.situation?.query).toMatchObject({
      layers: ["weather_webcams"],
      sources: ["chmi_weather_webcams"]
    });
  });

  it("queries weather forecast areas with the dedicated SIM forecast layer", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const situationDataSource = new FakeSituationDataSource();
    const app = buildServer({
      now: () => new Date("2026-05-22T08:00:00Z"),
      situationDataSource
    });

    const response = await app.inject({
      body: {
        bbox: [12.0, 48.5, 18.9, 51.2],
        layerIds: ["public.weather.forecast_area"],
        limit: 250
      },
      method: "POST",
      url: "/api/v1/map/query"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { situation?: SituationFeatureCollection };
    expect(situationDataSource.lastFeatureQuery).toMatchObject({
      layers: ["weather_forecast_area"],
      sources: ["weather_forecast"]
    });
    expect(body.situation?.query).toMatchObject({
      layers: ["weather_forecast_area"],
      sources: ["weather_forecast"]
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

  it("keeps BTS reference context out of the public mobile-network layer", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const situationDataSource = new FakeProviderCatalogSituationDataSource();
    const app = buildServer({
      now: () => new Date("2026-05-22T08:00:00Z"),
      situationDataSource
    });

    const response = await app.inject({
      body: {
        bbox: [13.85, 49.65, 15.35, 50.45],
        layerIds: ["public.mobile.network"],
        limit: 20
      },
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      url: "/api/v1/map/query"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { situation?: SituationFeatureCollection };
    expect(situationDataSource.lastFeatureQuery).toMatchObject({
      layers: ["mobile_network"],
      sources: ["mobile_network_model"]
    });
    expect(body.situation?.features).toEqual([]);
    expect(body.situation?.summary.featureCount).toBe(0);
    expect(body.situation?.warnings.join(" ")).not.toContain("BTS / komunikační stožáry");
  });

  it("allows model coverage fallback through the public mobile-network catalog layer", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const app = buildServer({
      now: () => new Date("2026-05-22T08:00:00Z"),
      situationDataSource: new FakeMobileNetworkCoverageFallbackSource()
    });

    const response = await app.inject({
      body: {
        bbox: [13.85, 49.65, 15.35, 50.45],
        layerIds: ["public.mobile.network"],
        limit: 20
      },
      headers: { authorization: "Bearer dev-lab-token" },
      method: "POST",
      url: "/api/v1/map/query"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { situation?: SituationFeatureCollection };
    expect(body.situation?.features).toHaveLength(1);
    expect(body.situation?.features[0]?.properties).toMatchObject({
      layer: "mobile_coverage",
      sourceId: "mobile_coverage_model"
    });
  });

  it("queries flight reference layers from the provider catalog", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const app = buildServer({
      flightDataSource: new FakeFlightDataSource(),
      now: () => new Date("2026-05-22T08:00:00Z")
    });

    const response = await app.inject({
      body: {
        bbox: [13.85, 49.65, 15.35, 50.45],
        layerIds: ["flight.reference.airports", "flight.reference.airspaces"],
        limit: 20
      },
      method: "POST",
      url: "/api/v1/map/query"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { flight?: FlightReferenceFeatureCollection; query: { layerIds: string[] }; summary: { featureCount: number } };
    expect(body.query.layerIds).toEqual(["flight.reference.airports", "flight.reference.airspaces"]);
    expect(body.flight?.query.layers).toEqual(["flight.airports", "flight.airspaces"]);
    expect(body.flight?.features.map((feature) => feature.properties.layer)).toEqual(["flight_airports", "flight_airspaces"]);
    expect(body.summary.featureCount).toBe(2);
  });

  it("proxies allowed raster overlay images through COP instead of exposing provider URLs to clients", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), {
      headers: { "content-type": "image/png" },
      status: 200
    }));
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer({
      situationDataSource: new FakeSituationDataSource(),
      now: () => new Date("2026-06-06T08:00:00Z")
    });
    const rasterUrl = "/api/v1/weather-radar/clean/merge1h/sample.png";

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/map/raster-overlay?url=${encodeURIComponent(rasterUrl)}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.headers["cache-control"]).toContain("public");
    expect(fetchMock).toHaveBeenCalledWith("https://sim.zeleznalady.cz/situation-data/api/v1/weather-radar/clean/merge1h/sample.png", expect.objectContaining({
      headers: expect.objectContaining({
        accept: expect.stringContaining("image/png")
      })
    }));
  });

  it("fetches the weather radar frame catalog through the server-side SIM provider", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const fetchMock = vi.fn(async () => Response.json({
      products: [
        {
          frames: [
            {
              cleanUrl: "/api/v1/weather-radar/clean/merge1h/frame.png",
              observedAt: "2026-06-06T08:45:00Z"
            }
          ],
          product: "merge1h"
        }
      ]
    }));
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer({
      situationDataSource: new FakeSituationDataSource(),
      now: () => new Date("2026-06-06T08:00:00Z")
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/weather-radar/frames?product=merge1h&hours=6&limit=2"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      products: [
        {
          frames: [
            {
              cleanUrl: "/api/v1/weather-radar/clean/merge1h/frame.png",
              observedAt: "2026-06-06T08:45:00Z"
            }
          ]
        }
      ]
    });
    expect(fetchMock).toHaveBeenCalledWith("https://sim.zeleznalady.cz/situation-data/api/v1/weather-radar/frames?product=merge1h&hours=6&limit=2", expect.objectContaining({
      headers: expect.objectContaining({
        accept: "application/json"
      })
    }));
  });

  it("proxies CHMI weather station detail through the server-side SIM provider", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const fetchMock = vi.fn(async () => Response.json({
      charts: [
        {
          id: "temperature",
          series: [
            {
              label: "měření",
              points: [{ time: "2026-06-28T08:00:00Z", value: 23.4 }]
            }
          ],
          title: "Teplota"
        }
      ],
      current: {
        display: {
          badgeLabel: "měření",
          conditionMode: "unclassified",
          iconKey: "measurement",
          label: "Milešovka 23.4 °C"
        }
      }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer({
      situationDataSource: new FakeSituationDataSource(),
      now: () => new Date("2026-06-28T08:00:00Z")
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/weather-stations/0-20000-0-11406/detail?historyHours=48&forecastHours=24"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      current: {
        display: {
          iconKey: "measurement"
        }
      }
    });
    expect(fetchMock).toHaveBeenCalledWith("https://sim.zeleznalady.cz/situation-data/api/v1/weather-stations/0-20000-0-11406/detail?historyHours=48&forecastHours=24", expect.objectContaining({
      headers: expect.objectContaining({
        accept: "application/json"
      })
    }));
  });

  it("proxies weather forecast area detail through the server-side SIM provider", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const fetchMock = vi.fn(async () => Response.json({
      areaId: "cz-praha",
      charts: [],
      contractVersion: "sim-weather-forecast-area-detail-v1",
      current: {
        display: {
          badgeLabel: "déšť",
          iconKey: "rain",
          primaryValue: "19 °C",
          title: "Praha"
        }
      },
      summary: "Plošná předpověď pro Prahu"
    }));
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer({
      situationDataSource: new FakeSituationDataSource(),
      now: () => new Date("2026-06-28T08:00:00Z")
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/weather-forecast/areas/cz-praha/detail?nowcastHours=6&forecastHours=48&dailyDays=5"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      current: {
        display: {
          iconKey: "rain"
        }
      },
      summary: "Plošná předpověď pro Prahu"
    });
    expect(fetchMock).toHaveBeenCalledWith("https://sim.zeleznalady.cz/situation-data/api/v1/weather-forecast/areas/cz-praha?nowcastHours=6&forecastHours=48&dailyDays=5", expect.objectContaining({
      headers: expect.objectContaining({
        accept: "application/json"
      })
    }));
  });

  it("proxies public transit vehicle detail through the server-side SIM provider", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const fetchMock = vi.fn(async () => Response.json({
      contractVersion: "sim-public-transit-vehicle-detail-v1",
      current: {
        delaySeconds: 0,
        display: {
          badgeLabel: "včas",
          label: "103 → Březiněves",
          subtitle: "poslední zpráva před 33 s"
        },
        headingDeg: 12,
        observedAt: "2026-06-30T15:17:49Z"
      },
      featureId: "traffic:pid_gtfs_rt:vehicle-8096",
      route: {
        destination: "Březiněves",
        routeShortName: "103",
        transportMode: "bus"
      },
      stops: [
        {
          delaySeconds: 0,
          plannedDeparture: "2026-06-30T15:19:49Z",
          sequence: 1,
          stopId: "U123",
          stopName: "Štěpničná"
        }
      ],
      vehicle: {
        id: "8096",
        operator: "ČSAD Střední Čechy"
      }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer({
      situationDataSource: new FakeSituationDataSource(),
      now: () => new Date("2026-06-30T15:18:00Z")
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/transit/vehicles/traffic%3Apid_gtfs_rt%3Avehicle-8096/detail?source=pid_gtfs_rt"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      current: {
        display: {
          badgeLabel: "včas"
        }
      },
      route: {
        routeShortName: "103"
      },
      stops: [
        {
          stopName: "Štěpničná"
        }
      ]
    });
    expect(fetchMock).toHaveBeenCalledWith("https://sim.zeleznalady.cz/situation-data/api/v1/transit/vehicles/traffic%3Apid_gtfs_rt%3Avehicle-8096?source=pid_gtfs_rt", expect.objectContaining({
      headers: expect.objectContaining({
        accept: "application/json"
      })
    }));
  });

  it("proxies public transit stop detail through the server-side SIM provider", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const fetchMock = vi.fn(async () => Response.json({
      contractVersion: "sim-public-transit-stop-detail-v1",
      departures: [
        {
          delaySeconds: 0,
          destination: "Březiněves",
          plannedDeparture: "2026-07-01T08:15:00Z",
          routeShortName: "103",
          status: "on_time",
          transportMode: "bus"
        }
      ],
      routes: [
        {
          destination: "Březiněves",
          routeId: "pid-route-103",
          routeShortName: "103",
          transportMode: "bus"
        }
      ],
      stop: {
        stopId: "U123",
        stopName: "Na Fabiance",
        systemId: "pid",
        zoneId: "P"
      },
      systemId: "pid",
      warnings: []
    }));
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer({
      situationDataSource: new FakeSituationDataSource(),
      now: () => new Date("2026-07-01T08:00:00Z")
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/transit/stops/pid/U123/detail?source=public_transit_static&departuresLimit=8"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      departures: [
        {
          routeShortName: "103"
        }
      ],
      stop: {
        stopName: "Na Fabiance"
      }
    });
    expect(fetchMock).toHaveBeenCalledWith("https://sim.zeleznalady.cz/situation-data/api/v1/transit/stops/pid/U123?source=public_transit_static&departuresLimit=8", expect.objectContaining({
      headers: expect.objectContaining({
        accept: "application/json"
      })
    }));
  });

  it("proxies CHMI webcam detail through an allowlisted SIM URL", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const fetchMock = vi.fn(async () => Response.json({
      cameras: [
        {
          label: "Praha-Libuš",
          snapshotUrl: "/situation-data/api/v1/weather/webcams/praha/snapshot.jpg"
        }
      ]
    }));
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer({
      situationDataSource: new FakeSituationDataSource(),
      now: () => new Date("2026-06-25T08:00:00Z")
    });
    const detailUrl = "/situation-data/api/v1/weather/webcams/praha";

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/weather/webcam-proxy?url=${encodeURIComponent(detailUrl)}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      cameras: [
        {
          label: "Praha-Libuš"
        }
      ]
    });
    expect(fetchMock).toHaveBeenCalledWith("https://sim.zeleznalady.cz/situation-data/api/v1/weather/webcams/praha", expect.objectContaining({
      headers: expect.objectContaining({
        accept: expect.stringContaining("application/json")
      })
    }));
  });

  it("rejects webcam proxy requests for direct CHMI upstream hosts", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer({
      now: () => new Date("2026-06-25T08:00:00Z")
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/weather/webcam-proxy?url=${encodeURIComponent("https://www.chmi.cz/files/webcam/praha.jpg")}`
    });

    expect(response.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects raster overlay proxy requests for untrusted hosts", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const app = buildServer({
      now: () => new Date("2026-06-06T08:00:00Z")
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/map/raster-overlay?url=${encodeURIComponent("https://example.invalid/radar.png")}`
    });

    expect(response.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
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
  lastFeatureQuery: SituationFeatureQuery | null = null;
  lastRadioCoverage: RadioCoverageRequest | null = null;
  lastRadioLinkCheck: RadioLinkCheckRequest | null = null;
  lastRadioProfile: RadioProfile | null = null;
  lastTowerViewshed: { query: MobileTowerViewshedQuery; towerId: string } | null = null;
  towerViewshedError: unknown = undefined;

  async fetchLayers(_requestNow: Date): Promise<SituationLayerDescriptor[]> {
    return [
      { defaultVisible: true, expectedCadenceSeconds: 600, geometryTypes: ["Point"], label: "Weather", layerId: "weather" },
      { defaultVisible: false, expectedCadenceSeconds: 600, geometryTypes: ["Polygon", "MultiPolygon"], label: "Předpověď počasí", layerId: "weather_forecast_area" },
      { defaultVisible: false, expectedCadenceSeconds: 600, geometryTypes: ["Point"], label: "ČHMÚ webkamery", layerId: "weather_webcams" },
      { defaultVisible: false, expectedCadenceSeconds: 900, geometryTypes: ["Point"], label: "Air quality", layerId: "air_quality" },
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
      { enabled: true, label: "ČHMÚ měřené počasí", layers: ["weather"], sourceId: "chmi_weather_stations", updateCadenceSeconds: 600 },
      { enabled: true, label: "Plošná předpověď počasí", layers: ["weather_forecast_area"], sourceId: "weather_forecast", updateCadenceSeconds: 600 },
      { enabled: true, label: "ČHMÚ webkamery", layers: ["weather_webcams"], sourceId: "chmi_weather_webcams", updateCadenceSeconds: 600 },
      { enabled: true, label: "ČHMÚ kvalita ovzduší", layers: ["air_quality"], sourceId: "chmi_air_quality", updateCadenceSeconds: 900 },
      { enabled: true, label: "Unified mobile network assessment", layers: ["mobile_network"], sourceId: "mobile_network_model", updateCadenceSeconds: 3600 },
      { enabled: true, label: "Mobile coverage estimate model", layers: ["mobile_coverage"], sourceId: "mobile_coverage_model", updateCadenceSeconds: 21600 },
      { enabled: true, label: "CTU NetTest mobile measurements", layers: ["mobile"], sourceId: "ctu_nettest", updateCadenceSeconds: 3600 },
      { enabled: true, label: "Local OpenStreetMap PostGIS context", layers: ["ground", "mobile"], sourceId: "osm_postgis", updateCadenceSeconds: 21600 },
      { enabled: true, label: "PID GTFS-RT", layers: ["traffic"], sourceId: "pid_gtfs_rt", updateCadenceSeconds: 20 }
    ];
  }

  async fetchFeatures(query: SituationFeatureQuery, requestNow: Date): Promise<SituationFeatureCollection> {
    this.lastFeatureQuery = query;
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

  async fetchMobileTowerViewshed(towerId: string, query: MobileTowerViewshedQuery, requestNow: Date): Promise<MobileTowerViewshedResponse> {
    this.lastTowerViewshed = { query, towerId };
    if (this.towerViewshedError) {
      throw this.towerViewshedError;
    }
    return {
      contractVersion: "sim-mobile-coverage-tower-viewshed-v1",
      features: [
        {
          geometry: {
            coordinates: [[
              [14.0, 50.0],
              [14.1, 50.0],
              [14.1, 50.1],
              [14.0, 50.1],
              [14.0, 50.0]
            ]],
            type: "Polygon"
          },
          properties: {
            assumptions: {
              operatorRfPlanAvailable: false,
              sectorAware: false
            },
            confidence: 0.82,
            estimatedSignalDbm: -79,
            metrics: {
              terrainMaxObstructionM: 12,
              terrainPenaltyDb: 6
            },
            quality: "good"
          },
          type: "Feature"
        }
      ],
      generatedAt: requestNow.toISOString(),
      providerId: "sim.situation-data",
      summary: {
        disclaimer: "Mobilní pokrytí je modelový odhad SIM, ne potvrzený stav operátora."
      },
      tower: {
        btsStatus: "operator_feed_unavailable",
        operatorStatusAvailable: false
      },
      type: "FeatureCollection",
      warnings: []
    };
  }

  async fetchRadioProfiles(requestNow: Date): Promise<RadioProfilesResponse> {
    return {
      contractVersion: "sim-radio-profiles-v1",
      generatedAt: requestNow.toISOString(),
      profiles: [
        {
          antennaHeightM: 1.5,
          frequencyMhz: 446,
          maxRadiusM: 5000,
          name: "PMR446 ruční stanice",
          profileId: "pmr446_handheld",
          receiverHeightM: 1.5,
          txPowerW: 0.5
        }
      ],
      warnings: []
    };
  }

  async createRadioProfile(profile: RadioProfile, requestNow: Date): Promise<RadioProfilesResponse> {
    this.lastRadioProfile = profile;
    return {
      contractVersion: "sim-radio-profiles-v1",
      generatedAt: requestNow.toISOString(),
      profiles: [profile],
      warnings: []
    };
  }

  async runRadioCoverage(request: RadioCoverageRequest, requestNow: Date): Promise<RadioFeatureCollectionResponse> {
    this.lastRadioCoverage = request;
    return {
      contractVersion: "sim-radio-coverage-v1",
      features: [
        {
          geometry: {
            coordinates: [[
              [14.0, 50.0],
              [14.05, 50.0],
              [14.05, 50.05],
              [14.0, 50.05],
              [14.0, 50.0]
            ]],
            type: "Polygon"
          },
          properties: {
            confidence: 0.72,
            estimatedSignalDbm: -84,
            quality: "fair"
          },
          type: "Feature"
        }
      ],
      generatedAt: requestNow.toISOString(),
      type: "FeatureCollection",
      warnings: []
    };
  }

  async runRadioLinkCheck(request: RadioLinkCheckRequest, _requestNow: Date): Promise<RadioLinkCheckResponse> {
    this.lastRadioLinkCheck = request;
    return {
      azimuthDeg: 47,
      distanceM: 4200,
      fresnelClearancePct: 64,
      linkStatus: "clear",
      maxObstructionM: 0,
      requiredExtraAntennaHeightM: 0,
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
          minZoom: 9,
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
          audience: "public",
          cacheTtlSeconds: 600,
          categoryPath: ["weather"],
          defaultVisible: false,
          geometryTypes: ["Polygon"],
          kind: "grid_field",
          label: "Teplotní pole",
          providerLayerId: "weather.temperature_grid",
          query: {
            maxFeatures: 1,
            mode: "grid",
            providerId: "sim.situation-data",
            providerLayerIds: ["weather.temperature_grid"],
            providerSourceIds: ["chmi_weather_stations"],
            streamId: "grid"
          },
          recommendedCatalogLayerId: "public.weather.temperature_grid",
          refreshSeconds: 600,
          role: "overlay",
          selectable: true,
          sourceIds: ["chmi_weather_stations"],
          styleProfile: "weather-temperature-grid-v1"
        },
        {
          audience: "public",
          availability: "disabled",
          cacheTtlSeconds: 600,
          defaultVisible: true,
          disabledReason: "SIM dočasně nevystavuje větrné pole pro veřejnou mapu.",
          enabled: false,
          geometryTypes: ["Point"],
          kind: "vector_field",
          label: "Vítr",
          providerLayerId: "weather.wind_field",
          query: {
            maxFeatures: 250,
            mode: "bbox",
            providerId: "sim.situation-data",
            providerLayerIds: ["weather.wind_field"],
            providerSourceIds: ["chmi_weather_wind_field"],
            streamId: "features"
          },
          recommendedCatalogLayerId: "public.weather.wind_field",
          refreshSeconds: 600,
          role: "overlay",
          selectable: true,
          sourceIds: ["chmi_weather_wind_field"],
          styleProfile: "weather-wind-field-v1"
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
          cacheTtlSeconds: 20,
          defaultVisible: false,
          geometryTypes: ["Point", "LineString"],
          kind: "vector_features",
          label: "Doprava",
          minZoom: 6,
          providerLayerId: "traffic.pid_gtfs_rt",
          query: {
            maxFeatures: 250,
            mode: "bbox",
            providerId: "sim.situation-data",
            providerLayerIds: ["traffic"],
            providerSourceIds: ["pid_gtfs_rt", "idsjmk_vehicle_positions", "spravazeleznic_trains", "public_transit_static"],
            streamId: "features"
          },
          recommendedCatalogLayerId: "public.traffic.transit",
          refreshSeconds: 20,
          role: "reference",
          selectable: true,
          sourceIds: ["pid_gtfs_rt", "idsjmk_vehicle_positions", "spravazeleznic_trains", "public_transit_static"],
          styleProfile: "transit-vehicle-position-v1"
        },
        {
          audience: "public",
          cacheTtlSeconds: 21600,
          categoryPath: ["reference", "infrastructure", "communications"],
          defaultVisible: false,
          geometryTypes: ["Point"],
          kind: "vector_features",
          label: "Komunikační infrastruktura",
          minZoom: 10,
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
        },
        {
          audience: "public",
          cacheTtlSeconds: 300,
          compatibilityOnly: true,
          defaultVisible: false,
          geometryTypes: ["Point", "Polygon", "MultiPolygon"],
          kind: "vector_features",
          label: "Požáry a požární riziko (kompatibilní projekce)",
          preferredProviderId: "sim.safety-data",
          providerLayerId: "fire.safety_data_projection",
          query: {
            maxFeatures: 250,
            mode: "bbox",
            providerId: "sim.situation-data",
            providerLayerIds: ["fire"],
            providerSourceIds: ["safety_data"],
            streamId: "features"
          },
          recommendedCatalogLayerId: "public.safety.fire",
          refreshSeconds: 300,
          role: "reference",
          selectable: false,
          sourceIds: ["safety_data"],
          styleProfile: "safety-fire-v1"
        }
      ],
      providerId: "sim.situation-data",
      sources: [
        {
          audience: "public",
          enabled: true,
          feedsCatalogLayerIds: ["public.traffic.transit.pid"],
          label: "PID GTFS-RT",
          selectableInMap: true,
          sourceId: "pid_gtfs_rt",
          sourceRole: "final",
          updateCadenceSeconds: 20,
          usedByCatalogLayerIds: ["public.traffic.transit.pid"]
        },
        {
          audience: "public",
          enabled: true,
          feedsCatalogLayerIds: ["public.traffic.transit.idsjmk"],
          label: "IDS JMK vehicle positions",
          selectableInMap: true,
          sourceId: "idsjmk_vehicle_positions",
          sourceRole: "final",
          updateCadenceSeconds: 20,
          usedByCatalogLayerIds: ["public.traffic.transit.idsjmk"]
        },
        {
          audience: "public",
          enabled: true,
          feedsCatalogLayerIds: ["public.traffic.transit.trains"],
          label: "Správa železnic live trains",
          selectableInMap: true,
          sourceId: "spravazeleznic_trains",
          sourceRole: "final",
          updateCadenceSeconds: 900,
          usedByCatalogLayerIds: ["public.traffic.transit.trains"]
        },
        {
          audience: "public",
          enabled: true,
          feedsCatalogLayerIds: ["public.traffic.transit_stops"],
          label: "Public transit static stops",
          selectableInMap: true,
          sourceId: "public_transit_static",
          sourceRole: "final",
          updateCadenceSeconds: 21600,
          usedByCatalogLayerIds: ["public.traffic.transit_stops"]
        },
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
          feedsCatalogLayerIds: ["public.weather.temperature_grid"],
          label: "CHMI weather station read model",
          selectableInMap: false,
          sourceId: "chmi_weather_stations",
          sourceRole: "final",
          updateCadenceSeconds: 600,
          visibleInDiagnostics: true
        },
        {
          audience: "public",
          availability: "disabled",
          disabledReason: "SIM dočasně nevystavuje větrné pole pro veřejnou mapu.",
          enabled: false,
          feedsCatalogLayerIds: ["public.weather.wind_field"],
          label: "CHMI wind field",
          selectableInMap: true,
          sourceId: "chmi_weather_wind_field",
          sourceRole: "final",
          updateCadenceSeconds: 600,
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
        },
        {
          audience: "public",
          enabled: true,
          feedsCatalogLayerIds: ["public.safety.fire"],
          label: "Safety Data API projection",
          preferredProviderId: "sim.safety-data",
          selectableInMap: false,
          sourceId: "safety_data",
          sourceRole: "projection",
          updateCadenceSeconds: 300,
          visibleInDiagnostics: true
        }
      ],
      status: "online",
      warnings: []
    };
  }

  override async fetchFeatures(query: SituationFeatureQuery, requestNow: Date): Promise<SituationFeatureCollection> {
    this.lastFeatureQuery = query;
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

class FakeMobileNetworkCoverageFallbackSource extends FakeProviderCatalogSituationDataSource {
  override async fetchFeatures(query: SituationFeatureQuery, requestNow: Date): Promise<SituationFeatureCollection> {
    this.lastFeatureQuery = query;
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
          properties: {
            category: "mobile_coverage",
            confidence: 0.63,
            featureId: "coverage:mobile:4g:6-4",
            label: "4G coverage estimate",
            layer: "mobile_coverage",
            observedAt: requestNow.toISOString(),
            quality: "weak",
            severity: "warning",
            sourceId: "mobile_coverage_model",
            stale: false,
            technology: "4G"
          },
          type: "Feature"
        }
      ],
      generatedAt: requestNow.toISOString(),
      query,
      source: { sourceId: "situation-data-api", sourceType: "PUBLIC_SITUATION_AGGREGATE" },
      sources: await this.fetchSources(requestNow),
      summary: { featureCount: 1, sourceCount: 1, staleFeatureCount: 0, warningCount: 0 },
      type: "FeatureCollection",
      warnings: []
    };
  }
}

class HangingSituationDataSource extends FakeSituationDataSource {
  async fetchCatalog(_requestNow: Date): Promise<ProviderMapCatalog> {
    return new Promise<ProviderMapCatalog>(() => {});
  }
}

class HangingMessagingProvider implements MessagingProvider {
  readonly config: MessagingProviderConfig = {
    baseUrl: "http://127.0.0.1:4050",
    cacheTtlMs: 1000,
    enabled: true,
    timeoutMs: 1000
  };

  async fetchStatus(): Promise<never> {
    return new Promise<never>(() => {});
  }

  async fetchWebPushConfig(): Promise<never> {
    throw new Error("not implemented");
  }

  async registerWebPushDevice(): Promise<never> {
    throw new Error("not implemented");
  }

  async deleteWebPushDevice(): Promise<never> {
    throw new Error("not implemented");
  }

  async fetchMatrixBootstrap(): Promise<never> {
    throw new Error("not implemented");
  }

  async fetchConversations(): Promise<never> {
    throw new Error("not implemented");
  }

  async fetchConversation(): Promise<never> {
    throw new Error("not implemented");
  }

  async fetchConversationByRoomId(): Promise<never> {
    throw new Error("not implemented");
  }

  async createConversation(): Promise<never> {
    throw new Error("not implemented");
  }

  async addConversationMembers(): Promise<never> {
    throw new Error("not implemented");
  }

  async bindMatrixRoom(): Promise<never> {
    throw new Error("not implemented");
  }

  async resolveMatrixIdentities(): Promise<never> {
    throw new Error("not implemented");
  }

  async sendNotification(): Promise<never> {
    throw new Error("not implemented");
  }
}

class FakeFlightDataSource implements FlightDataSource {
  readonly config: FlightDataSourceConfig = {
    airportCacheTtlMs: 3600000,
    baseUrl: "https://sim.zeleznalady.cz/flight-data",
    enabled: true,
    includeStale: true,
    limit: 500,
    pollMs: 15000,
    timeoutMs: 6000
  };

  readonly sourceSystem = createPublicFlightAggregateSourceSystem();

  async fetchCatalog(_requestNow: Date): Promise<ProviderMapCatalog> {
    return {
      contractVersion: "provider-map-catalog-v1",
      layers: [
        {
          audience: "public",
          cacheTtlSeconds: 3600,
          defaultVisible: false,
          geometryTypes: ["Point"],
          kind: "static_reference",
          label: "Letiště",
          providerLayerId: "flight.airports",
          query: {
            maxFeatures: 200,
            mode: "bbox",
            providerId: "sim.flight-data",
            providerLayerIds: ["flight.airports"],
            providerSourceIds: ["ourairports"],
            streamId: "airports"
          },
          recommendedCatalogLayerId: "flight.reference.airports",
          refreshSeconds: 3600,
          role: "reference",
          selectable: true,
          sourceIds: ["ourairports"],
          styleProfile: "airport-reference-v1"
        },
        {
          audience: "public",
          cacheTtlSeconds: 3600,
          defaultVisible: false,
          geometryTypes: ["Polygon"],
          kind: "static_reference",
          label: "Letecké prostory",
          providerLayerId: "flight.airspaces",
          query: {
            maxFeatures: 250,
            mode: "bbox",
            providerId: "sim.flight-data",
            providerLayerIds: ["flight.airspaces"],
            providerSourceIds: ["czech_aip_airspaces"],
            streamId: "airspaces"
          },
          recommendedCatalogLayerId: "flight.reference.airspaces",
          refreshSeconds: 3600,
          role: "reference",
          selectable: true,
          sourceIds: ["czech_aip_airspaces"],
          styleProfile: "airspace-reference-v1"
        }
      ],
      providerId: "sim.flight-data",
      sources: [
        {
          audience: "public",
          enabled: true,
          feedsCatalogLayerIds: ["flight.reference.airports"],
          label: "OurAirports",
          selectableInMap: false,
          sourceId: "ourairports",
          sourceRole: "reference",
          updateCadenceSeconds: 3600,
          visibleInDiagnostics: true
        },
        {
          audience: "public",
          enabled: true,
          feedsCatalogLayerIds: ["flight.reference.airspaces"],
          label: "Czech AIP/eAIP airspaces",
          selectableInMap: false,
          sourceId: "czech_aip_airspaces",
          sourceRole: "reference",
          updateCadenceSeconds: 3600,
          visibleInDiagnostics: true
        }
      ],
      status: "online",
      warnings: []
    };
  }

  async fetchReferenceFeatures(query: FlightReferenceFeatureQuery, requestNow: Date): Promise<FlightReferenceFeatureCollection> {
    const features: FlightReferenceFeature[] = [
      {
        geometry: { coordinates: [14.259911, 50.100874], type: "Point" },
        id: "airport:LKPR",
        properties: {
          category: "large_airport",
          confidence: 0.95,
          featureId: "flight:airport:LKPR",
          label: "PRG",
          layer: "flight_airports",
          observedAt: requestNow.toISOString(),
          providerId: "sim.flight-data",
          providerLayerId: "flight.airports",
          sourceId: "ourairports",
          stale: false,
          status: "reference"
        },
        type: "Feature"
      },
      {
        geometry: { coordinates: [[[14.4, 50.1], [14.5, 50.1], [14.5, 50.2], [14.4, 50.1]]], type: "Polygon" },
        id: "airspace:LKD1",
        properties: {
          category: "airspace_danger",
          confidence: 0.9,
          featureId: "airspace:LKD1",
          label: "LKD1",
          layer: "flight_airspaces",
          observedAt: requestNow.toISOString(),
          providerId: "sim.flight-data",
          providerLayerId: "flight.airspaces",
          severity: "warning",
          sourceId: "czech_aip_airspaces",
          stale: false,
          status: "danger"
        },
        type: "Feature"
      }
    ];
    const selectedFeatures = features.filter((feature) => query.layers.includes(feature.properties.providerLayerId));
    return {
      contractVersion: "cop-flight-reference-v1",
      features: selectedFeatures,
      generatedAt: requestNow.toISOString(),
      query,
      source: { generatedAt: requestNow.toISOString(), sourceId: "flight-data-api", sourceType: "PUBLIC_FLIGHT_REFERENCE" },
      sources: [
        { enabled: true, label: "OurAirports", layers: ["flight.airports"], sourceId: "ourairports", updateCadenceSeconds: 3600 },
        { enabled: true, label: "Czech AIP/eAIP airspaces", layers: ["flight.airspaces"], sourceId: "czech_aip_airspaces", updateCadenceSeconds: 3600 }
      ],
      summary: {
        featureCount: selectedFeatures.length,
        sourceCount: 2,
        staleFeatureCount: 0,
        warningCount: 0
      },
      type: "FeatureCollection",
      warnings: []
    };
  }

  async poll(): Promise<never> {
    throw new Error("not implemented");
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
      enabledSources: ["chmi_alerts", "chmi_hydro", "gdacs_alerts", "hzs_incidents", "municipal_alerts"]
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
      { enabled: true, label: "CHMI Alerts", layers: ["weather_alerts", "fire"], sourceId: "chmi_alerts", updateCadenceSeconds: 300 },
      { enabled: true, label: "CHMI Hydro", layers: ["flood"], sourceId: "chmi_hydro", updateCadenceSeconds: 600 },
      { enabled: true, label: "GDACS Alerts", layers: ["fire", "flood"], sourceId: "gdacs_alerts", updateCadenceSeconds: 300 },
      { enabled: true, label: "HZS incidents", layers: ["warnings", "fire"], sourceId: "hzs_incidents", updateCadenceSeconds: 300 },
      { enabled: true, label: "Municipal alerts", layers: ["warnings", "fire"], sourceId: "municipal_alerts", updateCadenceSeconds: 300 }
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

  async fetchHydroStationDetail(stationId: string, query: SafetyHydroStationDetailQuery, requestNow: Date): Promise<unknown> {
    return {
      chart: {
        currentTime: requestNow.toISOString(),
        panels: [
          {
            id: "water_level",
            seriesIds: ["H"],
            thresholdSet: "waterLevel",
            title: "Vodní stav",
            yAxis: { label: "vodní stav [cm]", unit: "cm" }
          }
        ],
        title: "Test station - Test river"
      },
      contractVersion: "chmi-hydro-station-detail-v1",
      generatedAt: requestNow.toISOString(),
      providerId: "sim.safety-data",
      series: [
        {
          id: "H",
          label: "Vodní stav",
          points: [
            {
              at: requestNow.toISOString(),
              ingestedAt: requestNow.toISOString(),
              source: "live_now",
              value: 145
            }
          ],
          role: "observation",
          unit: "cm"
        }
      ],
      sourceId: "chmi_hydro",
      station: {
        lat: 50.1,
        lon: 14.4,
        stationId,
        stationName: "Test station",
        streamName: "Test river"
      },
      thresholds: {
        discharge: { dry: 3, spa1: 50, spa2: 80, spa3: 110, unit: "m3/s" },
        waterLevel: { dry: 80, spa1: 140, spa2: 170, spa3: 190, unit: "cm" }
      },
      warnings: [],
      window: {
        from: query.from ?? "2026-06-25T00:00:00Z",
        to: query.to ?? requestNow.toISOString()
      }
    };
  }
}

class FakeProviderCatalogSafetyDataSource extends FakeSafetyDataSource {
  async fetchCatalog(_requestNow: Date): Promise<ProviderMapCatalog> {
    return {
      contractVersion: "provider-map-catalog-v1",
      layers: [
        {
          audience: "public",
          cacheTtlSeconds: 600,
          defaultVisible: false,
          geometryTypes: ["Point"],
          kind: "vector_features",
          label: "Vodní stavy a průtoky",
          providerLayerId: "flood",
          query: {
            maxFeatures: 250,
            mode: "bbox",
            providerId: "sim.safety-data",
            providerLayerIds: ["flood"],
            providerSourceIds: ["chmi_hydro", "gdacs_alerts"],
            streamId: "features"
          },
          recommendedCatalogLayerId: "public.safety.flood",
          refreshSeconds: 600,
          role: "overlay",
          selectable: true,
          sourceIds: ["chmi_hydro", "gdacs_alerts"],
          styleProfile: "water-level-v1"
        },
        {
          audience: "public",
          cacheTtlSeconds: 600,
          defaultVisible: false,
          geometryTypes: ["Point", "Polygon", "MultiPolygon"],
          kind: "vector_features",
          label: "Požáry",
          providerLayerId: "fire",
          query: {
            maxFeatures: 250,
            mode: "bbox",
            providerId: "sim.safety-data",
            providerLayerIds: ["fire"],
            providerSourceIds: ["chmi_alerts", "gdacs_alerts", "nasa_firms", "hzs_incidents", "municipal_alerts"],
            streamId: "features"
          },
          recommendedCatalogLayerId: "public.safety.fire",
          refreshSeconds: 600,
          role: "primary",
          selectable: true,
          sourceIds: ["chmi_alerts", "gdacs_alerts", "nasa_firms", "hzs_incidents", "municipal_alerts"],
          styleProfile: "fire-risk-v1"
        },
        {
          audience: "public",
          cacheTtlSeconds: 300,
          defaultVisible: true,
          geometryTypes: ["Point", "Polygon", "MultiPolygon"],
          kind: "vector_features",
          label: "Krizové výstrahy",
          providerLayerId: "warnings",
          query: {
            maxFeatures: 250,
            mode: "bbox",
            providerId: "sim.safety-data",
            providerLayerIds: ["warnings"],
            providerSourceIds: ["chmi_alerts", "gdacs_alerts", "hzs_incidents", "municipal_alerts", "road_srti_lod"],
            streamId: "features"
          },
          recommendedCatalogLayerId: "public.safety.warnings",
          refreshSeconds: 300,
          role: "primary",
          selectable: true,
          sourceIds: ["chmi_alerts", "gdacs_alerts", "hzs_incidents", "municipal_alerts", "road_srti_lod"],
          styleProfile: "public-warning-v1"
        }
      ],
      providerId: "sim.safety-data",
      sources: [
        {
          audience: "public",
          enabled: true,
          feedsCatalogLayerIds: ["public.safety.weather_alerts", "public.safety.fire"],
          label: "CHMI CAP alerts",
          selectableInMap: false,
          sourceId: "chmi_alerts",
          sourceRole: "final",
          updateCadenceSeconds: 300,
          visibleInDiagnostics: true
        },
        {
          audience: "public",
          enabled: true,
          feedsCatalogLayerIds: ["public.safety.fire", "public.safety.flood"],
          label: "GDACS Alerts",
          selectableInMap: false,
          sourceId: "gdacs_alerts",
          sourceRole: "final",
          updateCadenceSeconds: 300,
          visibleInDiagnostics: true
        },
        {
          audience: "public",
          enabled: true,
          feedsCatalogLayerIds: ["public.safety.flood"],
          label: "CHMI Hydro",
          selectableInMap: true,
          sourceId: "chmi_hydro",
          sourceRole: "final",
          updateCadenceSeconds: 600,
          visibleInDiagnostics: true
        },
        {
          audience: "public",
          enabled: true,
          feedsCatalogLayerIds: ["public.safety.fire"],
          label: "NASA FIRMS",
          selectableInMap: false,
          sourceId: "nasa_firms",
          sourceRole: "final",
          updateCadenceSeconds: 600,
          visibleInDiagnostics: true
        },
        {
          audience: "public",
          enabled: true,
          feedsCatalogLayerIds: ["public.safety.warnings", "public.safety.fire"],
          label: "HZS incidents",
          selectableInMap: false,
          sourceId: "hzs_incidents",
          sourceRole: "final",
          updateCadenceSeconds: 300,
          visibleInDiagnostics: true
        },
        {
          audience: "public",
          enabled: true,
          feedsCatalogLayerIds: ["public.safety.warnings", "public.safety.fire"],
          label: "Municipal alerts",
          selectableInMap: false,
          sourceId: "municipal_alerts",
          sourceRole: "final",
          updateCadenceSeconds: 300,
          visibleInDiagnostics: true
        }
      ],
      status: "online",
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
