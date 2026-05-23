import type { CopObject, SituationFeature } from "./cop-data";

export type MapSearchResultKind = "track" | "feature";

export type MapSearchResultType =
  | "airport"
  | "airspace"
  | "bts"
  | "community"
  | "flight"
  | "mobile-network"
  | "safety"
  | "situation"
  | "weather";

export interface MapSearchResult {
  center: [number, number];
  id: string;
  kind: MapSearchResultKind;
  objectId?: string;
  featureId?: string;
  label: string;
  subtitle: string;
  type: MapSearchResultType;
  typeLabel: string;
}

const MAX_SEARCH_RESULTS = 12;

export function buildMapSearchResults(
  objects: CopObject[],
  features: SituationFeature[],
  query: string,
  options: { limit?: number } = {}
): MapSearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const limit = Math.max(1, options.limit ?? MAX_SEARCH_RESULTS);
  const results: Array<MapSearchResult & { score: number }> = [];

  for (const object of objects) {
    const center = object.position ? ([object.position.lon, object.position.lat] as [number, number]) : null;
    if (!center) {
      continue;
    }
    const result = buildTrackSearchResult(object, center);
    const score = scoreResult(result, normalizedQuery, [
      object.objectId,
      object.objectType,
      object.affiliation,
      object.domain,
      object.status,
      stringValue(object.attributes?.flightData?.icao24),
      stringValue(object.attributes?.flightData?.registration),
      stringValue(object.attributes?.flightData?.callsign)
    ]);
    if (score > 0) {
      results.push({ ...result, score });
    }
  }

  for (const feature of features) {
    const center = featureCenter(feature);
    if (!center) {
      continue;
    }
    const result = buildFeatureSearchResult(feature, center);
    const properties = feature.properties;
    const score = scoreResult(result, normalizedQuery, [
      properties.featureId,
      properties.label,
      properties.headline,
      properties.summary,
      properties.description,
      properties.category,
      properties.layer,
      properties.layerId,
      properties.providerLayerId,
      properties.providerId,
      properties.sourceId,
      properties.operator,
      properties.technology,
      properties.quality,
      properties.severity
    ]);
    if (score > 0) {
      results.push({ ...result, score });
    }
  }

  return results
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label, "cs"))
    .slice(0, limit)
    .map(({ score: _score, ...result }) => result);
}

export function buildTrackSearchResult(object: CopObject, center: [number, number]): MapSearchResult {
  const flightData = object.attributes?.flightData;
  const label = cleanSearchText(flightData?.callsign)
    ?? cleanSearchText(flightData?.registration)
    ?? cleanSearchText(flightData?.icao24)
    ?? object.objectId;
  const typeLabel = isPublicFlight(object) ? "Let" : object.synthetic ? "Simulace" : "Track";
  return {
    center,
    id: `track:${object.objectId}`,
    kind: "track",
    label,
    objectId: object.objectId,
    subtitle: [object.objectType, object.affiliation, object.status].filter(Boolean).join(" · "),
    type: "flight",
    typeLabel
  };
}

export function buildFeatureSearchResult(feature: SituationFeature, center: [number, number]): MapSearchResult {
  const type = classifyFeatureType(feature);
  const typeLabel = mapResultTypeLabel(type);
  const label = cleanSearchText(feature.properties.headline)
    ?? cleanSearchText(feature.properties.label)
    ?? cleanSearchText(feature.properties.summary)
    ?? feature.properties.featureId;
  return {
    center,
    featureId: feature.properties.featureId,
    id: `feature:${feature.properties.featureId}`,
    kind: "feature",
    label,
    subtitle: buildFeatureSubtitle(feature),
    type,
    typeLabel
  };
}

export function featureCenter(feature: SituationFeature): [number, number] | null {
  const geometry = feature.geometry;
  if (geometry.type === "Point") {
    return normalizeCoordinate(geometry.coordinates);
  }
  if (geometry.type === "LineString") {
    return centerOfCoordinates(geometry.coordinates);
  }
  return centerOfCoordinates(geometry.coordinates[0] ?? []);
}

function centerOfCoordinates(coordinates: Array<[number, number]>): [number, number] | null {
  if (coordinates.length === 0) {
    return null;
  }
  let lonSum = 0;
  let latSum = 0;
  let count = 0;
  for (const coordinate of coordinates) {
    const normalized = normalizeCoordinate(coordinate);
    if (!normalized) {
      continue;
    }
    lonSum += normalized[0];
    latSum += normalized[1];
    count += 1;
  }
  if (count === 0) {
    return null;
  }
  return [lonSum / count, latSum / count];
}

function normalizeCoordinate(coordinate: [number, number]): [number, number] | null {
  const [lon, lat] = coordinate;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return null;
  }
  return [lon, lat];
}

function scoreResult(result: MapSearchResult, normalizedQuery: string, values: Array<string | undefined>): number {
  const corpus = [result.label, result.subtitle, result.typeLabel, ...values]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  let score = 0;
  for (const value of corpus) {
    if (value === normalizedQuery) {
      score = Math.max(score, 100);
    } else if (value.startsWith(normalizedQuery)) {
      score = Math.max(score, 75);
    } else if (value.includes(normalizedQuery)) {
      score = Math.max(score, 45);
    }
  }
  if (result.label.toLowerCase().includes(normalizedQuery)) {
    score += 20;
  }
  return score;
}

function classifyFeatureType(feature: SituationFeature): MapSearchResultType {
  const properties = feature.properties;
  const category = properties.category.toLowerCase();
  const layer = properties.layer.toLowerCase();
  const providerLayerId = (properties.providerLayerId ?? properties.layerId ?? "").toLowerCase();
  const sourceId = properties.sourceId.toLowerCase();

  if (providerLayerId.includes("airport") || layer === "flight_airports" || category.includes("airport")) {
    return "airport";
  }
  if (providerLayerId.includes("airspace") || layer === "flight_airspaces" || category.includes("airspace")) {
    return "airspace";
  }
  if (category.includes("communication") || category.includes("tower") || sourceId.includes("osm_postgis")) {
    return "bts";
  }
  if (layer === "mobile_network") {
    return "mobile-network";
  }
  if (layer === "weather" || category.includes("weather")) {
    return "weather";
  }
  if (layer === "warnings" || layer === "flood" || category.includes("warning") || category.includes("flood")) {
    return "safety";
  }
  if (layer === "community" || providerLayerId.includes("community")) {
    return "community";
  }
  return "situation";
}

function mapResultTypeLabel(type: MapSearchResultType): string {
  switch (type) {
    case "airport":
      return "Letiště";
    case "airspace":
      return "Prostor";
    case "bts":
      return "BTS";
    case "community":
      return "Hlášení";
    case "flight":
      return "Let";
    case "mobile-network":
      return "Mobilní síť";
    case "safety":
      return "Výstraha";
    case "weather":
      return "Počasí";
    case "situation":
    default:
      return "Vrstva";
  }
}

function buildFeatureSubtitle(feature: SituationFeature): string {
  const properties = feature.properties;
  return [
    properties.layer,
    properties.category,
    properties.technology,
    properties.quality,
    properties.severity
  ].filter(Boolean).join(" · ");
}

function isPublicFlight(object: CopObject): boolean {
  return Boolean(object.attributes?.flightData);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function cleanSearchText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
