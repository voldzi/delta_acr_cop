import { describe, expect, it } from "vitest";
import type { SituationFeature } from "./cop-data";
import { featureNavigationTarget } from "./feature-navigation";

const poi: SituationFeature = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [15.7, 50.03] },
  properties: { category: "viewpoint", featureId: "poi-1", sourceId: "osm", layer: "trail_poi", label: "Rozhledna" }
};

describe("navigation destination policy", () => {
  it("keeps an explicitly supported point of interest navigable", () => {
    expect(featureNavigationTarget(poi)).toEqual({ lat: 50.03, lon: 15.7, label: "Rozhledna" });
  });
  it.each(["fire", "flood", "weather_alerts", "warnings", "community"])(
    "does not send a reader to a %s hazard point",
    (layer) => {
      expect(
        featureNavigationTarget({
          ...poi,
          properties: { ...poi.properties, layer: layer as SituationFeature["properties"]["layer"] }
        })
      ).toBeNull();
    }
  );
  it("never turns a polygon boundary into a destination", () => {
    expect(
      featureNavigationTarget({
        ...poi,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [15, 50],
              [16, 50],
              [15, 51],
              [15, 50]
            ]
          ]
        }
      })
    ).toBeNull();
  });
  it("rejects invalid points and danger metadata even on an allowed layer", () => {
    expect(featureNavigationTarget({ ...poi, geometry: { type: "Point", coordinates: [200, 50] } })).toBeNull();
    expect(featureNavigationTarget({ ...poi, properties: { ...poi.properties, severity: "critical" } })).toBeNull();
  });
});
