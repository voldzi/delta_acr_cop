import { describe, expect, it } from "vitest";
import type { CopObject, PlaceGeocodeResult, SituationFeature } from "./cop-data";
import { buildMapSearchResults, buildPlaceSearchResults, featureCenter } from "./map-search";

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
      },
      {
        affiliation: "NEUTRAL",
        attributes: {
          flightData: {
            trackId: "flight:remote_id:rid-42",
            trackKey: "CZ-RID-42",
            trackKeyKind: "remote_id"
          }
        },
        confidence: 0.88,
        domain: "AIR",
        objectId: "flight:remote_id:rid-42",
        objectType: "UAV",
        position: {
          lat: 50.2,
          lon: 14.5
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
    expect(buildMapSearchResults(objects, features, "RID-42")[0]).toMatchObject({
      kind: "track",
      label: "CZ-RID-42",
      typeLabel: "Let"
    });
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

  it("builds place results for geocoded cities", () => {
    const places: PlaceGeocodeResult[] = [{
      center: [30.5234, 50.4501],
      displayName: "Kyjev, Ukrajina",
      id: "nominatim:123",
      importance: 0.8,
      kind: "city",
      providerId: "nominatim",
      subtitle: "město",
      zoomHint: 10
    }];

    expect(buildPlaceSearchResults(places, "Kyjev")).toEqual([
      expect.objectContaining({
        center: [30.5234, 50.4501],
        kind: "place",
        label: "Kyjev",
        typeLabel: "Místo",
        zoom: 10
      })
    ]);
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
