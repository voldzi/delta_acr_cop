import { describe, expect, it } from "vitest";
import {
  createClusteredGeoJsonSource,
  createPointFeatureCollection,
  emptyPointFeatureCollection,
  normalizePointFeatureCollection
} from "./geojson";

describe("safe GeoJSON point sources", () => {
  it("creates a point collection without mutating domain properties", () => {
    const collection = createPointFeatureCollection([
      { coordinate: [14.42, 50.08], id: "prague", properties: { label: "Praha" } },
      { coordinate: [181, 50], id: "invalid", properties: { label: "Mimo rozsah" } }
    ]);

    expect(collection).toEqual({
      features: [
        {
          geometry: { coordinates: [14.42, 50.08], type: "Point" },
          id: "prague",
          properties: { label: "Praha" },
          type: "Feature"
        }
      ],
      type: "FeatureCollection"
    });
  });

  it("returns an empty collection for malformed GeoJSON", () => {
    expect(normalizePointFeatureCollection(null)).toEqual(emptyPointFeatureCollection());
    expect(normalizePointFeatureCollection({ features: "broken", type: "FeatureCollection" })).toEqual(
      emptyPointFeatureCollection()
    );
  });

  it("filters invalid and non-point features and enforces a limit", () => {
    const normalized = normalizePointFeatureCollection(
      {
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: { type: "Point", coordinates: [14, 50] }, properties: { ok: true } },
          { type: "Feature", geometry: { type: "Point", coordinates: [14, 95] }, properties: { ok: false } },
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [
                [14, 50],
                [15, 51]
              ]
            },
            properties: {}
          }
        ]
      },
      { maxFeatures: 2 }
    );

    expect(normalized.features).toHaveLength(1);
    expect(normalized.features[0]?.properties).toEqual({ ok: true });
  });

  it("creates bounded MapLibre clustering configuration", () => {
    const source = createClusteredGeoJsonSource(emptyPointFeatureCollection(), {
      clusterMaxZoom: 13,
      clusterRadius: 44
    });

    expect(source).toEqual({
      cluster: true,
      clusterMaxZoom: 13,
      clusterRadius: 44,
      data: emptyPointFeatureCollection(),
      type: "geojson"
    });
  });
});
