import { describe, expect, it } from "vitest";
import {
  objectsToHistoryFeatureCollection,
  objectsToPredictionFeatureCollection,
  objectsToTrackFeatureCollection,
  parseMapCenter
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
        synthetic: true,
        selected: true
      }
    });
  });

  it("parses map center from longitude and latitude env value", () => {
    expect(parseMapCenter("15.1,50.2")).toEqual([15.1, 50.2]);
    expect(parseMapCenter("invalid")).toEqual([14.42, 50.08]);
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
    expect(predictionCollection.features[0]?.geometry.coordinates[1]?.[0]).toBeGreaterThan(14);
    expect(predictionCollection.features[0]?.properties.method).toBe("movement");
  });
});
