import { describe, expect, it, vi } from "vitest";
import {
  alertAreasToFeatureCollection,
  aoiRulesToFeatureCollection,
  fitMapToObjects,
  formatTrackLabel,
  objectsToHistoryFeatureCollection,
  objectsToPredictionFeatureCollection,
  objectsToTrackFeatureCollection,
  parseMapCenter,
  situationFeaturesToFeatureCollection,
  userAlertRadiusToFeatureCollection,
  userLocationToFeatureCollection
} from "./CopMap";
import type { CopObject } from "./cop-data";

describe("COP map data helpers", () => {
  it("builds GeoJSON track features from positioned COP objects", () => {
    const collection = objectsToTrackFeatureCollection(
      [
        {
          objectId: "AIR_SIM_AIRCRAFT-0001",
          objectType: "AIRCRAFT",
          affiliation: "UNKNOWN",
          domain: "AIR",
          status: "ACTIVE",
          confidence: 0.96,
          synthetic: true,
          position: { lat: 49.844, lon: 14.654 }
        },
        {
          objectId: "NO_POSITION",
          objectType: "UAV",
          affiliation: "UNKNOWN",
          domain: "AIR",
          status: "ACTIVE",
          synthetic: true
        }
      ] satisfies CopObject[],
      "AIR_SIM_AIRCRAFT-0001"
    );

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]).toMatchObject({
      geometry: { coordinates: [14.654, 49.844] },
      properties: {
        objectId: "AIR_SIM_AIRCRAFT-0001",
        objectType: "AIRCRAFT",
        confidence: 0.96,
        label: "AIR_SIM_AIRCRAFT-0001",
        synthetic: true,
        selected: true
      }
    });
  });

  it("uses flight-data callsigns for map labels before falling back to ICAO24", () => {
    const publicFlight = {
      objectId: "flight:icao24:49f007",
      objectType: "AIRCRAFT",
      affiliation: "NEUTRAL",
      domain: "AIR",
      status: "ACTIVE",
      confidence: 0.82,
      position: { lat: 50.1, lon: 14.4 },
      attributes: {
        dataOrigin: "PUBLIC_FLIGHT_AGGREGATE",
        flightData: {
          callsign: "  CSA42  ",
          icao24: "49f007",
          registration: "OK-ABC"
        }
      }
    } satisfies CopObject;

    const fallbackFlight = {
      ...publicFlight,
      objectId: "flight:icao24:49f008",
      attributes: {
        dataOrigin: "PUBLIC_FLIGHT_AGGREGATE",
        flightData: {
          callsign: " ",
          icao24: "49f008"
        }
      }
    } satisfies CopObject;

    expect(formatTrackLabel(publicFlight)).toBe("CSA42");
    expect(formatTrackLabel(fallbackFlight)).toBe("49F008");
    expect(objectsToTrackFeatureCollection([publicFlight]).features[0]?.properties.label).toBe("CSA42");
  });

  it("builds context-only situation features without converting them to COP tracks", () => {
    const collection = situationFeaturesToFeatureCollection({
      contractVersion: "cop-situation-source-v1",
      features: [
        {
          geometry: { coordinates: [14.42, 50.08], type: "Point" },
          properties: {
            category: "weather.current",
            confidence: 0.9,
            featureId: "weather:prague",
            label: "Praha weather",
            layer: "weather",
            metrics: {
              cloudCoverPercent: 82,
              precipitationMm: 0,
              temperatureC: 19.4,
              windDirectionDeg: 230,
              windSpeedMps: 3.2
            },
            observedAt: "2026-05-20T10:00:00Z",
            sourceId: "open_meteo",
            stale: false
          },
          type: "Feature"
        }
      ],
      generatedAt: "2026-05-20T10:00:00Z",
      query: {
        bbox: { east: 15, north: 51, south: 49, west: 13 },
        layers: ["weather"],
        limit: 250
      },
      source: {
        sourceId: "situation-data-api",
        sourceType: "PUBLIC_SITUATION_AGGREGATE"
      },
      sources: [],
      summary: {
        featureCount: 1,
        sourceCount: 1,
        staleFeatureCount: 0,
        warningCount: 0
      },
      type: "FeatureCollection",
      warnings: []
    }, "weather:prague");

    expect(collection).toMatchObject({
      features: [
        {
          geometry: { coordinates: [14.42, 50.08] },
          properties: {
            featureId: "weather:prague",
            layer: "weather",
            selected: true,
            weatherCloudCoverPercent: 82,
            weatherLabel: "19°C\n3 m/s",
            weatherTemperatureC: 19.4,
            weatherWindDirectionDeg: 230,
            weatherWindSpeedMps: 3.2
          }
        }
      ]
    });
  });

  it("adds mobile network tower render metadata from status and radio technology", () => {
    const collection = situationFeaturesToFeatureCollection({
      contractVersion: "cop-situation-source-v1",
      features: [
        {
          geometry: { coordinates: [14.48, 50.09], type: "Point" },
          properties: {
            category: "mobile.network",
            confidence: 0.86,
            featureId: "mobile:cell-001",
            label: "Mobile network node",
            layer: "mobile",
            metrics: {
              latencyMs: 95,
              networkStatus: "degraded"
            },
            observedAt: "2026-05-20T10:00:00Z",
            sourceId: "mobile_monitor",
            stale: false,
            tags: {
              technology: "NR 5G"
            }
          },
          type: "Feature"
        }
      ],
      generatedAt: "2026-05-20T10:00:00Z",
      query: {
        bbox: { east: 15, north: 51, south: 49, west: 13 },
        layers: ["mobile"],
        limit: 250
      },
      source: {
        sourceId: "situation-data-api",
        sourceType: "PUBLIC_SITUATION_AGGREGATE"
      },
      sources: [],
      summary: {
        featureCount: 1,
        sourceCount: 1,
        staleFeatureCount: 0,
        warningCount: 1
      },
      type: "FeatureCollection",
      warnings: []
    });

    expect(collection.features[0]?.properties).toMatchObject({
      featureId: "mobile:cell-001",
      layer: "mobile",
      mobileNetworkLabel: "5G",
      mobileSymbolKey: "cop-mobile-network-warning",
      situationStatusColor: "#facc15",
      situationStatusLabel: "ZHORŠENÝ",
      situationStatusTone: "warning"
    });
  });

  it("adds mobile coverage polygon render metadata from SIM quality", () => {
    const collection = situationFeaturesToFeatureCollection({
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
            estimatedSignalDbm: -111,
            featureId: "coverage:mobile:4g:6-4",
            label: "4G coverage estimate",
            layer: "mobile_coverage",
            modelVersion: "coverage-v1",
            observedAt: "2026-05-21T13:44:09.575Z",
            quality: "weak",
            resolutionM: 4554,
            sourceId: "mobile_coverage_model",
            stale: false,
            technology: "4G"
          },
          type: "Feature"
        }
      ],
      generatedAt: "2026-05-21T14:08:41Z",
      query: {
        bbox: { east: 15, north: 51, south: 49, west: 13 },
        layers: ["mobile_coverage"],
        limit: 250,
        sources: ["mobile_coverage_model"],
        technology: "4G"
      },
      source: {
        sourceId: "situation-data-api",
        sourceType: "PUBLIC_SITUATION_AGGREGATE"
      },
      sources: [],
      summary: {
        featureCount: 1,
        sourceCount: 1,
        staleFeatureCount: 0,
        warningCount: 0
      },
      type: "FeatureCollection",
      warnings: []
    }, "coverage:mobile:4g:6-4");

    expect(collection.features[0]?.properties).toMatchObject({
      coverageColor: "#fb923c",
      coverageLabel: "4G SLABÉ",
      coverageQuality: "weak",
      coverageTechnology: "4G",
      featureId: "coverage:mobile:4g:6-4",
      layer: "mobile_coverage",
      selected: true,
      situationStatusLabel: "SLABÉ",
      situationStatusTone: "advisory"
    });
  });

  it("adds unified mobile network polygon render metadata from SIM quality", () => {
    const collection = situationFeaturesToFeatureCollection({
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
            basis: ["CTU_NETTEST_MEASUREMENT", "INFERRED_COVERAGE"],
            category: "mobile_network",
            confidence: 0.62,
            featureId: "mobile_network:aggregate:4g:6-4",
            label: "4G mobile network assessment",
            layer: "mobile_network",
            observedAt: "2026-05-21T16:08:56.211Z",
            quality: "fair",
            sourceId: "mobile_network_model",
            status: "degraded_possible",
            stale: false,
            summary: "Mobilní síť je použitelná s omezením.",
            technology: "4G"
          },
          type: "Feature"
        }
      ],
      generatedAt: "2026-05-21T16:08:56.211Z",
      query: {
        bbox: { east: 15, north: 51, south: 49, west: 13 },
        layers: ["mobile_network"],
        limit: 250,
        sources: ["mobile_network_model"],
        technology: "4G"
      },
      source: {
        sourceId: "situation-data-api",
        sourceType: "PUBLIC_SITUATION_AGGREGATE"
      },
      sources: [],
      summary: {
        featureCount: 1,
        sourceCount: 1,
        staleFeatureCount: 0,
        warningCount: 0
      },
      type: "FeatureCollection",
      warnings: []
    });

    expect(collection.features[0]?.properties).toMatchObject({
      coverageColor: "#facc15",
      coverageLabel: "4G SLUŠNÉ",
      coverageQuality: "fair",
      coverageTechnology: "4G",
      featureId: "mobile_network:aggregate:4g:6-4",
      layer: "mobile_network",
      situationStatusLabel: "SLUŠNÉ",
      situationStatusTone: "warning"
    });
  });

  it("suppresses synthetic warning points from map marker rendering", () => {
    const collection = situationFeaturesToFeatureCollection({
      contractVersion: "cop-situation-source-v1",
      features: [
        {
          geometry: { coordinates: [15.3, 50.725], type: "Point" },
          properties: {
            category: "weather_warning",
            confidence: 0.45,
            featureId: "warnings:chmi_alerts:6bmq06",
            headline: "Dotok",
            label: "Dotok",
            layer: "warnings",
            observedAt: "2026-05-21T08:11:11Z",
            severity: "advisory",
            sourceId: "chmi_alerts",
            stale: false
          },
          type: "Feature"
        },
        {
          geometry: {
            coordinates: [[
              [15.2, 50.7],
              [15.4, 50.7],
              [15.4, 50.8],
              [15.2, 50.8],
              [15.2, 50.7]
            ]],
            type: "Polygon"
          },
          properties: {
            category: "weather_warning",
            confidence: 0.7,
            featureId: "warnings:chmi_alerts:polygon",
            headline: "Výstražná oblast",
            label: "Výstražná oblast",
            layer: "warnings",
            observedAt: "2026-05-21T08:11:11Z",
            severity: "warning",
            sourceId: "chmi_alerts",
            stale: false
          },
          type: "Feature"
        }
      ],
      generatedAt: "2026-05-21T10:00:00Z",
      query: {
        bbox: { east: 15.6, north: 50.9, south: 50.5, west: 15.0 },
        layers: ["warnings"],
        limit: 250
      },
      source: {
        sourceId: "situation-data-api",
        sourceType: "PUBLIC_SITUATION_AGGREGATE"
      },
      sources: [],
      summary: {
        featureCount: 2,
        sourceCount: 1,
        staleFeatureCount: 0,
        warningCount: 2
      },
      type: "FeatureCollection",
      warnings: []
    });

    expect(collection.features[0]?.properties).toMatchObject({
      featureId: "warnings:chmi_alerts:6bmq06",
      mapPointSuppressed: true,
      situationStatusLabel: "OMEZENÝ"
    });
    expect(collection.features[1]?.properties.mapPointSuppressed).toBeUndefined();
  });

  it("parses map center from longitude and latitude env value", () => {
    expect(parseMapCenter("15.1,50.2")).toEqual([15.1, 50.2]);
    expect(parseMapCenter("invalid")).toEqual([14.42, 50.08]);
  });

  it("fits the map to one or more positioned tracks", () => {
    const singleMap = {
      easeTo: vi.fn(),
      fitBounds: vi.fn(),
      getZoom: vi.fn(() => 8)
    };
    const multiMap = {
      easeTo: vi.fn(),
      fitBounds: vi.fn(),
      getZoom: vi.fn(() => 8)
    };
    const objects = [
      {
        objectId: "AIR_SIM_UAV-0001",
        objectType: "UAV",
        affiliation: "HOSTILE",
        domain: "AIR",
        status: "ACTIVE",
        confidence: 0.94,
        synthetic: true,
        position: { lat: 50, lon: 14 }
      },
      {
        objectId: "AIR_SIM_UAV-0002",
        objectType: "UAV",
        affiliation: "FRIEND",
        domain: "AIR",
        status: "ACTIVE",
        confidence: 0.92,
        synthetic: true,
        position: { lat: 50.2, lon: 14.4 }
      }
    ] satisfies CopObject[];

    expect(fitMapToObjects(singleMap as never, [objects[0]!])).toBe(true);
    expect(singleMap.easeTo).toHaveBeenCalledWith({
      center: [14, 50],
      duration: 650,
      zoom: 10
    });

    expect(fitMapToObjects(multiMap as never, objects)).toBe(true);
    expect(multiMap.fitBounds).toHaveBeenCalledWith(expect.anything(), {
      duration: 750,
      maxZoom: 12,
      padding: { top: 86, right: 72, bottom: 72, left: 72 }
    });
    expect(fitMapToObjects(null, objects)).toBe(false);
    expect(fitMapToObjects(multiMap as never, [{ ...objects[0]!, position: undefined }])).toBe(false);
  });

  it("builds route history and prediction line features", () => {
    const objects = [
      {
        objectId: "AIR_SIM_UAV-0001",
        objectType: "UAV",
        affiliation: "HOSTILE",
        domain: "AIR",
        status: "ACTIVE",
        confidence: 0.94,
        synthetic: true,
        position: { lat: 50, lon: 14 },
        movement: { speedMps: 60, headingDeg: 90, verticalRateMps: 0 }
      }
    ] satisfies CopObject[];
    const history = {
      "AIR_SIM_UAV-0001": [
        { objectId: "AIR_SIM_UAV-0001", affiliation: "HOSTILE", lat: 49.99, lon: 13.99, timestamp: "2026-05-19T08:00:00Z" },
        { objectId: "AIR_SIM_UAV-0001", affiliation: "HOSTILE", lat: 50, lon: 14, timestamp: "2026-05-19T08:05:00Z" }
      ]
    };

    const historyCollection = objectsToHistoryFeatureCollection(objects, history, "AIR_SIM_UAV-0001");
    const predictionCollection = objectsToPredictionFeatureCollection(objects, history, "AIR_SIM_UAV-0001", 10);

    expect(historyCollection.features).toHaveLength(1);
    expect(historyCollection.features[0]).toMatchObject({
      geometry: {
        type: "LineString",
        coordinates: [
          [13.99, 49.99],
          [14, 50]
        ]
      },
      properties: {
        color: "#ef4444",
        selected: true
      }
    });
    expect(predictionCollection.features).toHaveLength(1);
    expect(predictionCollection.features[0]?.geometry.coordinates[0]).toEqual([14, 50]);
    expect(predictionCollection.features[0]?.geometry.coordinates).toHaveLength(7);
    expect(predictionCollection.features[0]?.geometry.coordinates[1]?.[0]).toBeGreaterThan(14);
    expect(predictionCollection.features[0]?.properties.method).toBe("telemetry");
  });

  it("builds a user location feature without adding it to COP tracks", () => {
    expect(
      userLocationToFeatureCollection({
        lat: 50.1,
        lon: 14.4,
        accuracyM: 12,
        updatedAt: "2026-05-19T08:00:00Z"
      })
    ).toMatchObject({
      features: [
        {
          geometry: { coordinates: [14.4, 50.1] },
          properties: { accuracyM: 12 }
        }
      ]
    });
    expect(userLocationToFeatureCollection(null).features).toEqual([]);
  });

  it("builds a geodesic user alert radius polygon", () => {
    const collection = userAlertRadiusToFeatureCollection(
      {
        lat: 50.1,
        lon: 14.4,
        accuracyM: 12,
        updatedAt: "2026-05-19T08:00:00Z"
      },
      10,
      true,
      true
    );

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]?.properties).toEqual({ radiusKm: 10, active: true });
    const ring = collection.features[0]!.geometry.coordinates[0]!;
    expect(ring).toHaveLength(97);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring[0]![1]).toBeGreaterThan(50.1);
    expect(userAlertRadiusToFeatureCollection(null, 10, true).features).toEqual([]);
    expect(userAlertRadiusToFeatureCollection({ lat: 50, lon: 14, updatedAt: "2026-05-19T08:00:00Z" }, 10, false).features).toEqual([]);
  });

  it("builds translucent alert area polygons for active server alerts", () => {
    const collection = alertAreasToFeatureCollection([
      {
        alertId: "alert-1",
        detail: "Track conflict",
        map: { lat: 50.1, lon: 14.4, radiusKm: 1.2 },
        objectId: "AIR_SIM_UAV-0001",
        observedAt: "2026-05-19T08:00:00Z",
        severity: "critical",
        status: "ACTIVE",
        title: "Konflikt dat objektu",
        type: "TRACK_CONFLICT",
        updatedAt: "2026-05-19T08:00:00Z"
      },
      {
        alertId: "alert-source",
        detail: "Source degraded",
        observedAt: "2026-05-19T08:00:00Z",
        severity: "warning",
        sourceSystemId: "sim-air",
        status: "ACTIVE",
        title: "Degradovaný zdroj dat",
        type: "SOURCE_DEGRADED",
        updatedAt: "2026-05-19T08:00:00Z"
      }
    ]);

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]?.properties).toMatchObject({
      alertId: "alert-1",
      severity: "critical",
      type: "TRACK_CONFLICT"
    });
    expect(collection.features[0]?.geometry.coordinates[0]).toHaveLength(97);
  });

  it("builds AOI rule polygons only for enabled rules", () => {
    const collection = aoiRulesToFeatureCollection([
      {
        affiliationScope: "hostile",
        enabled: true,
        id: "primary-aoi",
        lat: 50.1,
        lon: 14.4,
        name: "Primary AOI",
        radiusKm: 12,
        color: "#c8f08d",
        fillOpacity: 0.14,
        severity: "warning"
      },
      {
        enabled: false,
        id: "disabled-aoi",
        lat: 50.2,
        lon: 14.5,
        name: "Disabled AOI",
        radiusKm: 8
      }
    ]);

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]?.properties).toEqual({
      color: "#c8f08d",
      enabled: true,
      fillOpacity: 0.14,
      id: "primary-aoi",
      name: "Primary AOI",
      severity: "warning"
    });
    expect(collection.features[0]?.geometry.coordinates[0]).toHaveLength(97);
  });
});
