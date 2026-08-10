import { describe, expect, it } from "vitest";
import { calculateGeoBounds, calculateGeoJsonBounds, createMapFitPlan } from "./bounds";

describe("geo bounds and fit plans", () => {
  it("calculates bounds while ignoring invalid coordinates", () => {
    expect(calculateGeoBounds([[14, 50], [15, 49], [999, 50], null])).toEqual([
      [14, 49],
      [15, 50]
    ]);
    expect(calculateGeoBounds([])).toBeNull();
  });

  it("uses the shortest longitude arc across the antimeridian", () => {
    expect(
      calculateGeoBounds([
        [179, 10],
        [-179, 11]
      ])
    ).toEqual([
      [179, 10],
      [181, 11]
    ]);
  });

  it("extracts coordinates from nested GeoJSON safely", () => {
    expect(
      calculateGeoJsonBounds({
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: { type: "Point", coordinates: [14, 50] }, properties: {} },
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [
                [15, 49],
                [16, 51],
                ["bad", 1]
              ]
            },
            properties: {}
          }
        ]
      })
    ).toEqual([
      [14, 49],
      [16, 51]
    ]);
  });

  it("creates deterministic center and bounds plans", () => {
    expect(createMapFitPlan([[14, 50]], { currentZoom: 8, duration: 650, singlePointZoom: 10 })).toEqual({
      center: [14, 50],
      duration: 650,
      kind: "center",
      zoom: 10
    });
    expect(
      createMapFitPlan(
        [
          [14, 50],
          [15, 51]
        ],
        {
          duration: 750,
          maxZoom: 12,
          padding: { top: 86 }
        }
      )
    ).toEqual({
      bounds: [
        [14, 50],
        [15, 51]
      ],
      duration: 750,
      kind: "bounds",
      maxZoom: 12,
      padding: { bottom: 72, left: 72, right: 72, top: 86 }
    });
  });
});
