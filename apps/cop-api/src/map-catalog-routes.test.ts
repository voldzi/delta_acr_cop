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
      layers: Array<{ groupId?: string; layerId: string; minZoom?: number; query?: { providerLayerIds?: string[]; providerSourceIds?: string[] }; selectable?: boolean }>;
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
    expect(body.layers.find((layer) => layer.layerId === "public.traffic.transit")).toMatchObject({
      groupId: "transport"
    });
    expect(body.layers.find((layer) => layer.layerId === "public.weather.webcams")).toMatchObject({
      groupId: "risks.weather",
      query: {
        providerLayerIds: ["weather_webcams"],
        providerSourceIds: ["chmi_weather_webcams"]
      },
      minZoom: 4,
      selectable: true
    });
    expect(body.layers.find((layer) => layer.layerId === "public.safety.flood")).toMatchObject({
      minZoom: 4,
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
      layers: Array<{ groupId: string; kind?: string; label: string; layerId: string; minZoom?: number; query?: { categoryIds?: string[]; mode?: string; providerLayerIds?: string[]; providerSourceIds?: string[] }; selectable?: boolean }>;
      sources: Array<{ feedsCatalogLayerIds?: string[]; selectableInMap: boolean; sourceId: string; sourceRole: string; usedByCatalogLayerIds?: string[] }>;
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
        selectable: false
      }),
      expect.objectContaining({
        groupId: "risks.weather",
        label: "Webkamery ČHMÚ",
        layerId: "public.weather.webcams",
        minZoom: 4,
        query: expect.objectContaining({
          providerLayerIds: ["weather_webcams"],
          providerSourceIds: ["chmi_weather_webcams"]
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
      layers: Array<{ compatibilityOnly?: boolean; layerId: string; preferredProviderId?: string; query: { providerId: string; providerLayerIds?: string[]; providerSourceIds?: string[] } }>;
      sources: Array<{ compatibilityOnly?: boolean; providerId: string; sourceId: string }>;
    };
    const fireLayer = body.layers.find((layer) => layer.layerId === "public.safety.fire");
    expect(fireLayer).toMatchObject({
      query: {
        providerId: "sim.safety-data",
        providerLayerIds: ["fire"],
        providerSourceIds: ["chmi_alerts", "nasa_firms"]
      }
    });
    expect(fireLayer?.compatibilityOnly).toBeUndefined();
    expect(fireLayer?.preferredProviderId).toBeUndefined();
    expect(body.layers.filter((layer) => layer.layerId === "public.safety.fire")).toHaveLength(1);
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
      layers: ["mobile_network", "mobile"],
      sources: ["mobile_network_model", "osm_postgis"],
      technology: "4G"
    });
    expect(body.safety?.query.layers).toEqual(["warnings", "flood"]);
    expect(body.safety?.query.sources).toEqual(["chmi_alerts", "chmi_hydro"]);
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
      layers: ["mobile_network", "mobile"],
      sources: ["mobile_network_model", "osm_postgis"],
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

  it("shows BTS reference context when the mobile network read-model is empty", async () => {
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
      layers: ["mobile_network", "mobile"],
      sources: ["mobile_network_model", "osm_postgis"]
    });
    expect(body.situation?.features.map((feature) => feature.properties.category)).toEqual(["communications_tower"]);
    expect(body.situation?.summary.featureCount).toBe(1);
    expect(body.situation?.warnings.join(" ")).toContain("BTS / komunikační stožáry");
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

  async fetchLayers(_requestNow: Date): Promise<SituationLayerDescriptor[]> {
    return [
      { defaultVisible: true, expectedCadenceSeconds: 600, geometryTypes: ["Point"], label: "Weather", layerId: "weather" },
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
          geometryTypes: ["Point", "Polygon", "MultiPolygon"],
          kind: "vector_features",
          label: "Požáry",
          providerLayerId: "fire",
          query: {
            maxFeatures: 250,
            mode: "bbox",
            providerId: "sim.safety-data",
            providerLayerIds: ["fire"],
            providerSourceIds: ["chmi_alerts", "nasa_firms"],
            streamId: "features"
          },
          recommendedCatalogLayerId: "public.safety.fire",
          refreshSeconds: 600,
          role: "primary",
          selectable: true,
          sourceIds: ["chmi_alerts", "nasa_firms"],
          styleProfile: "fire-risk-v1"
        }
      ],
      providerId: "sim.safety-data",
      sources: [
        {
          audience: "public",
          enabled: true,
          feedsCatalogLayerIds: ["public.safety.fire"],
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
          feedsCatalogLayerIds: ["public.safety.fire"],
          label: "NASA FIRMS",
          selectableInMap: false,
          sourceId: "nasa_firms",
          sourceRole: "final",
          updateCadenceSeconds: 600,
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
