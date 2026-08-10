import { describe, expect, it } from "vitest";
import { createRouteFeatureCollection, createRouteLineLayer, normalizeLineStringGeometry } from "./route";

describe("generic route rendering", () => {
  it("normalizes LineString and MultiLineString GeoJSON without COP types", () => {
    expect(
      normalizeLineStringGeometry({
        type: "LineString",
        coordinates: [
          [14, 50],
          [15, 51],
          [999, 0]
        ]
      })
    ).toEqual({
      coordinates: [
        [14, 50],
        [15, 51]
      ],
      type: "LineString"
    });
    expect(
      normalizeLineStringGeometry({
        type: "MultiLineString",
        coordinates: [
          [
            [14, 50],
            [15, 51]
          ],
          [
            [15, 51],
            [16, 52]
          ]
        ]
      })
    ).toEqual({
      coordinates: [
        [14, 50],
        [15, 51],
        [15, 51],
        [16, 52]
      ],
      type: "LineString"
    });
  });

  it("returns an empty route collection for malformed geometry", () => {
    expect(createRouteFeatureCollection({ type: "LineString", coordinates: [[14, 50]] }, { routeId: "x" })).toEqual({
      features: [],
      type: "FeatureCollection"
    });
  });

  it("builds a reusable MapLibre route line layer", () => {
    const layer = createRouteLineLayer({
      blur: 0.2,
      color: "#0f7fa7",
      layerId: "route-line",
      opacity: 0.88,
      sourceId: "route",
      width: ["interpolate", ["linear"], ["zoom"], 9, 4.5, 17, 10.5]
    });
    expect(layer).toMatchObject({
      filter: ["==", ["geometry-type"], "LineString"],
      id: "route-line",
      source: "route",
      type: "line"
    });
    expect(layer.paint["line-width"]).toEqual(["interpolate", ["linear"], ["zoom"], 9, 4.5, 17, 10.5]);
  });
});
