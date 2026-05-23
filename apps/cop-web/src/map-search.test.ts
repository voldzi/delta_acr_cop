import { describe, expect, it } from "vitest";
import type { CopObject, SituationFeature } from "./cop-data";
import { buildMapSearchResults, featureCenter } from "./map-search";

describe("map search", () => {
  it("finds tracks and map features with typed result cards", () => {
    const objects: CopObject[] = [
      {
        affiliation: "NEUTRAL",
        attributes: {
          flightData: {
            callsign: "CSA123",
            icao24: "49f001"
          }
        },
        confidence: 0.9,
        domain: "AIR",
        objectId: "flight:icao24:49f001",
        objectType: "AIRCRAFT",
        position: {
          lat: 50.1,
          lon: 14.4
        },
        status: "ACTIVE"
      }
    ];
    const features: SituationFeature[] = [
      testFeature({
        category: "communications_tower",
        featureId: "bts-1",
        label: "BTS Praha",
        layer: "mobile",
        sourceId: "osm_postgis"
      }),
      testFeature({
        category: "airport",
        featureId: "airport-1",
        label: "Letiste Praha",
        layer: "flight_airports",
        sourceId: "flight-data-api"
      })
    ];

    expect(buildMapSearchResults(objects, features, "CSA")[0]).toMatchObject({
      kind: "track",
      label: "CSA123",
      typeLabel: "Let"
    });
    expect(buildMapSearchResults(objects, features, "BTS")[0]).toMatchObject({
      featureId: "bts-1",
      typeLabel: "BTS"
    });
    expect(buildMapSearchResults(objects, features, "Praha").map((result) => result.typeLabel)).toContain("Letiště");
  });

  it("computes a stable center for polygon features", () => {
    const feature = testFeature({
      category: "warning",
      featureId: "warning-1",
      label: "Povoden",
      layer: "warnings",
      sourceId: "chmi_alerts"
    });
    feature.geometry = {
      coordinates: [[
        [14, 50],
        [16, 50],
        [16, 52],
        [14, 52],
        [14, 50]
      ]],
      type: "Polygon"
    };

    expect(featureCenter(feature)).toEqual([14.8, 50.8]);
  });
});

function testFeature(properties: Pick<SituationFeature["properties"], "category" | "featureId" | "label" | "layer" | "sourceId">): SituationFeature {
  return {
    geometry: {
      coordinates: [14.4, 50.1],
      type: "Point"
    },
    properties,
    type: "Feature"
  };
}
