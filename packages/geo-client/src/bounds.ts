import { normalizeGeoCoordinate } from "./geojson";
import type { GeoBounds, GeoCoordinate } from "./types";

export type MapFitPlan =
  | { center: GeoCoordinate; duration: number; kind: "center"; zoom: number }
  | { bounds: GeoBounds; duration: number; kind: "bounds"; maxZoom: number; padding: MapPadding };

export interface MapPadding {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

export interface MapFitPlanOptions {
  currentZoom?: number;
  duration?: number;
  maxZoom?: number;
  padding?: Partial<MapPadding>;
  singlePointZoom?: number;
}

const defaultPadding: MapPadding = { bottom: 72, left: 72, right: 72, top: 72 };

export function calculateGeoBounds(points: readonly unknown[]): GeoBounds | null {
  const coordinates = points.flatMap((point) => {
    const coordinate = normalizeGeoCoordinate(point);
    return coordinate ? [coordinate] : [];
  });
  if (coordinates.length === 0) {
    return null;
  }
  const latitudes = coordinates.map((coordinate) => coordinate[1]);
  const longitudes = coordinates.map((coordinate) => normalizeLongitude(coordinate[0])).sort((a, b) => a - b);
  const [west, east] = minimumLongitudeArc(longitudes);
  return [
    [west, Math.min(...latitudes)],
    [east, Math.max(...latitudes)]
  ];
}

export function calculateGeoJsonBounds(value: unknown, maxCoordinates = 100_000): GeoBounds | null {
  const points: GeoCoordinate[] = [];
  collectGeoJsonCoordinates(value, points, Math.max(0, Math.floor(maxCoordinates)));
  return calculateGeoBounds(points);
}

export function createMapFitPlan(points: readonly unknown[], options: MapFitPlanOptions = {}): MapFitPlan | null {
  const validPoints = points.flatMap((point) => {
    const coordinate = normalizeGeoCoordinate(point);
    return coordinate ? [coordinate] : [];
  });
  if (validPoints.length === 0) {
    return null;
  }
  const duration = finiteOr(options.duration, 750);
  if (validPoints.length === 1) {
    const requestedZoom = finiteOr(options.singlePointZoom, 12);
    const currentZoom = finiteOr(options.currentZoom, requestedZoom);
    return {
      center: validPoints[0]!,
      duration,
      kind: "center",
      zoom: Math.max(currentZoom, requestedZoom)
    };
  }
  const bounds = calculateGeoBounds(validPoints);
  if (!bounds) {
    return null;
  }
  return {
    bounds,
    duration,
    kind: "bounds",
    maxZoom: finiteOr(options.maxZoom, 15),
    padding: { ...defaultPadding, ...options.padding }
  };
}

function collectGeoJsonCoordinates(value: unknown, points: GeoCoordinate[], limit: number): void {
  if (points.length >= limit || !isRecord(value)) {
    return;
  }
  if (value.type === "FeatureCollection" && Array.isArray(value.features)) {
    for (const feature of value.features) {
      collectGeoJsonCoordinates(feature, points, limit);
      if (points.length >= limit) return;
    }
    return;
  }
  if (value.type === "Feature") {
    collectGeoJsonCoordinates(value.geometry, points, limit);
    return;
  }
  if (value.type === "GeometryCollection" && Array.isArray(value.geometries)) {
    for (const geometry of value.geometries) {
      collectGeoJsonCoordinates(geometry, points, limit);
      if (points.length >= limit) return;
    }
    return;
  }
  collectNestedCoordinates(value.coordinates, points, limit);
}

function collectNestedCoordinates(value: unknown, points: GeoCoordinate[], limit: number): void {
  if (points.length >= limit || !Array.isArray(value)) {
    return;
  }
  const coordinate = normalizeGeoCoordinate(value);
  if (coordinate) {
    points.push(coordinate);
    return;
  }
  for (const child of value) {
    collectNestedCoordinates(child, points, limit);
    if (points.length >= limit) return;
  }
}

function minimumLongitudeArc(sortedLongitudes: number[]): [number, number] {
  if (sortedLongitudes.length === 1) {
    return [sortedLongitudes[0]!, sortedLongitudes[0]!];
  }
  let largestGap = -1;
  let gapStartIndex = 0;
  for (let index = 0; index < sortedLongitudes.length; index += 1) {
    const current = sortedLongitudes[index]!;
    const next = index === sortedLongitudes.length - 1 ? sortedLongitudes[0]! + 360 : sortedLongitudes[index + 1]!;
    const gap = next - current;
    if (gap > largestGap) {
      largestGap = gap;
      gapStartIndex = index;
    }
  }
  const westIndex = (gapStartIndex + 1) % sortedLongitudes.length;
  const west = sortedLongitudes[westIndex]!;
  let east = sortedLongitudes[gapStartIndex]!;
  if (east < west) {
    east += 360;
  }
  return [west, east];
}

function normalizeLongitude(value: number): number {
  const normalized = ((((value + 180) % 360) + 360) % 360) - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
