import { normalizeGeoCoordinate } from "./geojson";
import type { GeoLineStringFeatureCollection, GeoLineStringGeometry, MapLineLayerSpecification } from "./types";

export interface RouteLineLayerOptions {
  blur?: number;
  color?: unknown;
  dashArray?: unknown;
  layerId: string;
  opacity?: unknown;
  sourceId: string;
  width?: unknown;
}

export function normalizeLineStringGeometry(value: unknown): GeoLineStringGeometry | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.type === "Feature" && "geometry" in value) {
    return normalizeLineStringGeometry(value.geometry);
  }
  if (value.type === "FeatureCollection" && Array.isArray(value.features)) {
    for (const feature of value.features) {
      const geometry = normalizeLineStringGeometry(feature);
      if (geometry) {
        return geometry;
      }
    }
    return null;
  }
  if (value.type === "LineString" && Array.isArray(value.coordinates)) {
    const coordinates = normalizeCoordinates(value.coordinates);
    return coordinates.length >= 2 ? { coordinates, type: "LineString" } : null;
  }
  if (value.type === "MultiLineString" && Array.isArray(value.coordinates)) {
    const coordinates = value.coordinates.flatMap((line) => (Array.isArray(line) ? normalizeCoordinates(line) : []));
    return coordinates.length >= 2 ? { coordinates, type: "LineString" } : null;
  }
  return null;
}

export function createRouteFeatureCollection<Properties extends Record<string, unknown>>(
  value: unknown,
  properties: Properties
): GeoLineStringFeatureCollection<Properties> {
  const geometry = normalizeLineStringGeometry(value);
  return {
    features: geometry ? [{ geometry, properties, type: "Feature" }] : [],
    type: "FeatureCollection"
  };
}

export function createRouteLineLayer(options: RouteLineLayerOptions): MapLineLayerSpecification {
  return {
    id: options.layerId,
    type: "line",
    source: options.sourceId,
    filter: ["==", ["geometry-type"], "LineString"],
    layout: {
      "line-cap": "round",
      "line-join": "round"
    },
    paint: {
      "line-color": options.color ?? "#0f7fa7",
      "line-opacity": options.opacity ?? 0.88,
      "line-width": options.width ?? 5,
      ...(options.blur === undefined ? {} : { "line-blur": options.blur }),
      ...(options.dashArray === undefined ? {} : { "line-dasharray": options.dashArray })
    }
  };
}

function normalizeCoordinates(value: unknown[]): GeoLineStringGeometry["coordinates"] {
  return value.flatMap((coordinate) => {
    const normalized = normalizeGeoCoordinate(coordinate);
    return normalized ? [normalized] : [];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
