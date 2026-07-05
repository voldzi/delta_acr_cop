import { describe, expect, it } from "vitest";
import type { SketchDrawingFeature } from "./cop-data";
import {
  defaultSketchSymbol,
  formatMeasurementLabel,
  measureSketchLine,
  sketchDraftToFeatureCollection,
  sketchDrawingsToFeatureCollection,
  sketchEditablePoints,
  sketchGeometryFromPoints,
  sketchPresetToSymbolInput
} from "./map-sketch-features";

function sketchDrawing(input: Partial<SketchDrawingFeature> = {}): SketchDrawingFeature {
  return {
    geometry: { type: "LineString", coordinates: [[14, 50], [14.1, 50.05]] },
    id: "drawing-1",
    properties: {
      createdAt: "2026-07-05T09:00:00Z",
      drawingId: "drawing-1",
      kind: "arrow",
      label: "Směr pohybu",
      locked: false,
      ownerDisplayName: "Operator",
      ownerSubjectId: "operator",
      ownerUsername: "operator",
      properties: { fillPattern: "hatch" },
      revision: 1,
      style: {
        fill: "#22c55e",
        lineWidth: 3,
        opacity: 0.3,
        stroke: "#16a34a"
      },
      symbol: sketchPresetToSymbolInput(defaultSketchSymbol) as SketchDrawingFeature["properties"]["symbol"],
      updatedAt: "2026-07-05T09:00:00Z",
      visibility: "private"
    },
    type: "Feature",
    ...input
  };
}

describe("map sketch feature helpers", () => {
  it("creates closed polygon geometry from draft points", () => {
    const points = [
      { lat: 50.0, lon: 14.0 },
      { lat: 50.0, lon: 14.2 },
      { lat: 50.2, lon: 14.2 }
    ];

    expect(sketchGeometryFromPoints("polygon", points)).toEqual({
      type: "Polygon",
      coordinates: [[[14.0, 50.0], [14.2, 50.0], [14.2, 50.2], [14.0, 50.0]]]
    });
    expect(sketchDraftToFeatureCollection(points, "polygon").features).toHaveLength(4);
  });

  it("adds an arrowhead feature for arrow drawings", () => {
    const collection = sketchDrawingsToFeatureCollection([sketchDrawing()], "drawing-1");

    expect(collection.features).toHaveLength(2);
    expect(collection.features[0]?.properties).toMatchObject({
      drawingId: "drawing-1",
      fillPattern: "hatch",
      kind: "arrow",
      selected: true
    });
    expect(collection.features[1]?.properties).toMatchObject({
      kind: "arrowhead",
      selected: true
    });
    expect(collection.features[1]?.properties.bearing).toEqual(expect.any(Number));
  });

  it("returns editable vertices without duplicated closing polygon point", () => {
    const points = sketchEditablePoints(sketchDrawing({
      geometry: {
        type: "Polygon",
        coordinates: [[[14, 50], [14.2, 50], [14.2, 50.2], [14, 50]]]
      },
      properties: {
        ...sketchDrawing().properties,
        kind: "polygon"
      }
    }));

    expect(points).toEqual([
      { lat: 50, lon: 14 },
      { lat: 50, lon: 14.2 },
      { lat: 50.2, lon: 14.2 }
    ]);
  });

  it("formats short and long measurements for drawing labels", () => {
    expect(formatMeasurementLabel(0.42)).toBe("420 m");
    expect(formatMeasurementLabel(12.34)).toBe("12.3 km");
    expect(measureSketchLine([[14, 50], [14.01, 50]])).toBeGreaterThan(0.7);
  });
});
