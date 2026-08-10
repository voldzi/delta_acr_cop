import type { MapCircleLayerSpecification, MapSymbolLayerSpecification } from "./types";

export interface ClusterStep<Value> {
  minimumCount: number;
  value: Value;
}

export interface ClusterLayerOptions {
  circleColor: string;
  circleColorStops?: Array<ClusterStep<string>>;
  circleLayerId: string;
  circleOpacity?: number;
  circleRadius: number;
  circleRadiusStops?: Array<ClusterStep<number>>;
  circleStrokeColor?: string;
  circleStrokeOpacity?: number;
  circleStrokeWidth?: number;
  countColor?: string;
  countFont?: string[];
  countHaloColor?: string;
  countHaloWidth?: number;
  countLayerId: string;
  countSize?: number;
  countSizeStops?: Array<ClusterStep<number>>;
  sourceId: string;
}

export interface ClusterLayerSpecifications {
  circle: MapCircleLayerSpecification;
  count: MapSymbolLayerSpecification;
}

export function createClusterLayers(options: ClusterLayerOptions): ClusterLayerSpecifications {
  return {
    circle: {
      id: options.circleLayerId,
      type: "circle",
      source: options.sourceId,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": stepExpression(options.circleColor, options.circleColorStops ?? []),
        "circle-opacity": options.circleOpacity ?? 0.9,
        "circle-radius": stepExpression(options.circleRadius, options.circleRadiusStops ?? []),
        "circle-stroke-color": options.circleStrokeColor ?? "#061019",
        "circle-stroke-opacity": options.circleStrokeOpacity ?? 0.9,
        "circle-stroke-width": options.circleStrokeWidth ?? 2
      }
    },
    count: {
      id: options.countLayerId,
      type: "symbol",
      source: options.sourceId,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": options.countFont ?? ["Noto Sans Bold"],
        "text-size": stepExpression(options.countSize ?? 12, options.countSizeStops ?? []),
        "text-allow-overlap": true,
        "text-ignore-placement": true
      },
      paint: {
        "text-color": options.countColor ?? "#061019",
        "text-halo-color": options.countHaloColor ?? "#eef5fb",
        "text-halo-width": options.countHaloWidth ?? 0.7
      }
    }
  };
}

function stepExpression<Value>(initialValue: Value, steps: Array<ClusterStep<Value>>): unknown[] {
  const sorted = [...steps].sort((left, right) => left.minimumCount - right.minimumCount);
  return [
    "step",
    ["get", "point_count"],
    initialValue,
    ...sorted.flatMap((step) => [Math.max(0, Math.round(step.minimumCount)), step.value])
  ];
}
