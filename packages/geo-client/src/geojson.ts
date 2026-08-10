import type {
  GeoCoordinate,
  GeoJsonSourceSpecification,
  GeoMapPoint,
  GeoPointFeature,
  GeoPointFeatureCollection
} from "./types";

const defaultMaxFeatures = 50_000;

export interface ClusteredGeoJsonSourceOptions {
  clusterMaxZoom?: number;
  clusterRadius?: number;
  maxFeatures?: number;
}

export function emptyPointFeatureCollection(): GeoPointFeatureCollection {
  return { features: [], type: "FeatureCollection" };
}

export function isGeoCoordinate(value: unknown): value is GeoCoordinate {
  if (!Array.isArray(value) || value.length < 2) {
    return false;
  }
  const longitude = Number(value[0]);
  const latitude = Number(value[1]);
  return (
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90
  );
}

export function normalizeGeoCoordinate(value: unknown): GeoCoordinate | null {
  return isGeoCoordinate(value) ? [Number(value[0]), Number(value[1])] : null;
}

export function createPointFeatureCollection<Properties extends Record<string, unknown>>(
  points: readonly GeoMapPoint<Properties>[]
): GeoPointFeatureCollection<Properties> {
  const features = points.flatMap((point): GeoPointFeature<Properties>[] => {
    const coordinate = normalizeGeoCoordinate(point.coordinate);
    if (!coordinate) {
      return [];
    }
    return [
      {
        geometry: { coordinates: coordinate, type: "Point" },
        ...(point.id === undefined ? {} : { id: point.id }),
        properties: point.properties,
        type: "Feature"
      }
    ];
  });
  return { features, type: "FeatureCollection" };
}

export function normalizePointFeatureCollection(
  value: unknown,
  options: { maxFeatures?: number } = {}
): GeoPointFeatureCollection {
  if (!isRecord(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features)) {
    return emptyPointFeatureCollection();
  }
  const maxFeatures = Math.max(0, Math.floor(options.maxFeatures ?? defaultMaxFeatures));
  const features = value.features.slice(0, maxFeatures).flatMap((candidate): GeoPointFeature[] => {
    if (!isRecord(candidate) || candidate.type !== "Feature" || !isRecord(candidate.geometry)) {
      return [];
    }
    if (candidate.geometry.type !== "Point") {
      return [];
    }
    const coordinate = normalizeGeoCoordinate(candidate.geometry.coordinates);
    if (!coordinate) {
      return [];
    }
    const id = typeof candidate.id === "string" || typeof candidate.id === "number" ? candidate.id : undefined;
    return [
      {
        geometry: { coordinates: coordinate, type: "Point" },
        ...(id === undefined ? {} : { id }),
        properties: isRecord(candidate.properties) ? { ...candidate.properties } : {},
        type: "Feature"
      }
    ];
  });
  return { features, type: "FeatureCollection" };
}

export function createClusteredGeoJsonSource(
  data: unknown,
  options: ClusteredGeoJsonSourceOptions = {}
): GeoJsonSourceSpecification {
  return {
    type: "geojson",
    data: normalizePointFeatureCollection(data, { maxFeatures: options.maxFeatures }),
    cluster: true,
    clusterMaxZoom: clampInteger(options.clusterMaxZoom ?? 14, 0, 24),
    clusterRadius: clampInteger(options.clusterRadius ?? 50, 1, 512)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  const normalized = Number.isFinite(value) ? Math.round(value) : minimum;
  return Math.min(maximum, Math.max(minimum, normalized));
}
