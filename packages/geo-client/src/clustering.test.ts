import { describe, expect, it } from "vitest";
import { createClusterLayers } from "./clustering";

describe("generic cluster layers", () => {
  it("builds MapLibre-compatible circle and count layers", () => {
    const layers = createClusterLayers({
      circleColor: "#7dd3fc",
      circleColorStops: [
        { minimumCount: 36, value: "#facc15" },
        { minimumCount: 12, value: "#a3e635" }
      ],
      circleLayerId: "points-cluster",
      circleRadius: 17,
      circleRadiusStops: [
        { minimumCount: 12, value: 22 },
        { minimumCount: 36, value: 28 },
        { minimumCount: 80, value: 34 }
      ],
      countLayerId: "points-count",
      countSize: 11,
      countSizeStops: [
        { minimumCount: 12, value: 12 },
        { minimumCount: 36, value: 13 }
      ],
      sourceId: "points"
    });

    expect(layers.circle.filter).toEqual(["has", "point_count"]);
    expect(layers.circle.paint["circle-color"]).toEqual([
      "step",
      ["get", "point_count"],
      "#7dd3fc",
      12,
      "#a3e635",
      36,
      "#facc15"
    ]);
    expect(layers.count.layout["text-field"]).toEqual(["get", "point_count_abbreviated"]);
  });
});
