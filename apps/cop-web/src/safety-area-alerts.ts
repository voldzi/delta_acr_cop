import type { AoiRule, SituationFeature, SituationGeometry } from "./cop-data";

export type SafetyAreaAlertTone = "critical" | "warning" | "info";

export interface SafetyAreaAlertMatch {
  aoiRule: AoiRule;
  detail: string | null;
  distanceKm: number | null;
  feature: SituationFeature;
  key: string;
  severityRank: number;
  title: string;
  tone: SafetyAreaAlertTone;
  validUntil: string | null;
}

type LonLat = [number, number];

export function buildSafetyAreaAlertMatches(features: SituationFeature[], aoiRules: AoiRule[]): SafetyAreaAlertMatch[] {
  const enabledRules = aoiRules.filter((rule) => rule.enabled);
  if (enabledRules.length === 0 || features.length === 0) {
    return [];
  }

  const matches: SafetyAreaAlertMatch[] = [];
  const seen = new Set<string>();

  for (const feature of features) {
    for (const aoiRule of enabledRules) {
      const distanceKm = distanceToAoi(feature.geometry, aoiRule);
      if (distanceKm === null) {
        continue;
      }
      const key = buildAlertKey(feature, aoiRule);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const severityRank = featureSeverityRank(feature);
      matches.push({
        aoiRule,
        detail: featureDetail(feature),
        distanceKm,
        feature,
        key,
        severityRank,
        title: featureTitle(feature),
        tone: severityRank >= 3 ? "critical" : severityRank >= 2 ? "warning" : "info",
        validUntil: stringValue(feature.properties.validUntil) ?? stringValue(feature.properties.expiresAt) ?? null
      });
    }
  }

  return matches.sort((left, right) => {
    const severityDelta = right.severityRank - left.severityRank;
    if (severityDelta !== 0) {
      return severityDelta;
    }
    return (left.distanceKm ?? Number.POSITIVE_INFINITY) - (right.distanceKm ?? Number.POSITIVE_INFINITY);
  });
}

function distanceToAoi(geometry: SituationGeometry, aoiRule: AoiRule): number | null {
  const center = [aoiRule.lon, aoiRule.lat] as LonLat;
  const points = representativePoints(geometry);

  if (aoiRule.polygon?.coordinates?.[0]?.length) {
    const ring = aoiRule.polygon.coordinates[0];
    if (points.some((point) => pointInPolygon(point, ring))) {
      return 0;
    }
    if (geometryContainsPoint(geometry, center)) {
      return 0;
    }
    return null;
  }

  const radiusKm = Math.max(0, Number.isFinite(aoiRule.radiusKm) ? aoiRule.radiusKm : 0);
  if (geometryContainsPoint(geometry, center)) {
    return 0;
  }
  const minDistanceKm = points.reduce(
    (minimum, point) => Math.min(minimum, distanceBetweenKm(center, point)),
    Number.POSITIVE_INFINITY
  );
  return minDistanceKm <= radiusKm ? minDistanceKm : null;
}

function geometryContainsPoint(geometry: SituationGeometry, point: LonLat): boolean {
  if (geometry.type === "Polygon") {
    return geometry.coordinates.some((ring) => pointInPolygon(point, ring));
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) => polygon.some((ring) => pointInPolygon(point, ring)));
  }
  return false;
}

function representativePoints(geometry: SituationGeometry): LonLat[] {
  if (geometry.type === "Point") {
    return [geometry.coordinates];
  }
  if (geometry.type === "LineString") {
    return sampleLine(geometry.coordinates);
  }
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates.flatMap(sampleLine);
  }
  if (geometry.type === "Polygon") {
    return samplePolygon(geometry.coordinates);
  }
  return geometry.coordinates.flatMap(samplePolygon);
}

function sampleLine(points: LonLat[]): LonLat[] {
  if (points.length <= 3) {
    return points;
  }
  const first = points[0];
  const middle = points[Math.floor(points.length / 2)];
  const last = points[points.length - 1];
  return [first, middle, last].filter((point): point is LonLat => Boolean(point));
}

function samplePolygon(rings: LonLat[][]): LonLat[] {
  const outerRing = rings[0] ?? [];
  if (outerRing.length === 0) {
    return [];
  }
  const centroid = centroidOf(outerRing);
  return centroid ? [centroid, ...sampleLine(outerRing)] : sampleLine(outerRing);
}

function centroidOf(points: LonLat[]): LonLat | null {
  const finitePoints = points.filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
  if (finitePoints.length === 0) {
    return null;
  }
  const [lonTotal, latTotal] = finitePoints.reduce(
    ([lonSum, latSum], [lon, lat]) => [lonSum + lon, latSum + lat],
    [0, 0]
  );
  return [lonTotal / finitePoints.length, latTotal / finitePoints.length];
}

function pointInPolygon(point: LonLat, ring: LonLat[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const current = ring[i];
    const previous = ring[j];
    if (!current || !previous) {
      continue;
    }
    const [xi, yi] = current;
    const [xj, yj] = previous;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceBetweenKm(a: LonLat, b: LonLat): number {
  const earthRadiusKm = 6371;
  const lat1 = degreesToRadians(a[1]);
  const lat2 = degreesToRadians(b[1]);
  const deltaLat = degreesToRadians(b[1] - a[1]);
  const deltaLon = degreesToRadians(b[0] - a[0]);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function buildAlertKey(feature: SituationFeature, aoiRule: AoiRule): string {
  return [
    aoiRule.id,
    feature.properties.featureId,
    feature.properties.validUntil,
    feature.properties.expiresAt,
    feature.properties.updatedAt,
    feature.properties.observedAt
  ]
    .map((value) => stringValue(value) ?? "")
    .join(":");
}

function featureTitle(feature: SituationFeature): string {
  const properties = feature.properties;
  const localized = localizedRecord(properties);
  const providerProperties = recordValue(properties.providerProperties);
  const display = recordValue(providerProperties.display);
  const presentation = recordValue(providerProperties.presentation);
  return (
    stringValue(localized.headline) ??
    stringValue(localized.title) ??
    stringValue(display.label) ??
    stringValue(presentation.label) ??
    stringValue(properties.headline) ??
    stringValue(properties.areaName) ??
    stringValue(properties.label) ??
    "Výstraha v oblasti"
  );
}

function featureDetail(feature: SituationFeature): string | null {
  const properties = feature.properties;
  const localized = localizedRecord(properties);
  return (
    stringValue(localized.recommendedAction) ??
    stringValue(localized.description) ??
    stringValue(localized.summary) ??
    stringValue(properties.recommendedAction) ??
    stringValue(properties.description) ??
    stringValue(properties.summary) ??
    null
  );
}

function featureSeverityRank(feature: SituationFeature): number {
  const properties = feature.properties;
  const values = [
    properties.severity,
    properties.hazardSeverity,
    properties.urgency,
    recordValue(properties.providerProperties).severity,
    recordValue(properties.providerProperties).riskLevel,
    recordValue(properties.metrics).floodStage
  ];
  return values.reduce<number>((rank, value) => Math.max(rank, severityRank(value)), 0);
}

function severityRank(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 3) return 3;
    if (value >= 2) return 2;
    if (value >= 1) return 1;
    return 0;
  }
  const normalized = stringValue(value)?.toLowerCase();
  if (!normalized) {
    return 0;
  }
  if (["critical", "extreme", "severe", "emergency", "danger", "high", "3", "4"].includes(normalized)) {
    return 3;
  }
  if (["warning", "moderate", "elevated", "2"].includes(normalized)) {
    return 2;
  }
  if (["advisory", "info", "information", "low", "minor", "1"].includes(normalized)) {
    return 1;
  }
  return 0;
}

function localizedRecord(properties: SituationFeature["properties"]): Record<string, unknown> {
  const localized = recordValue(properties.localized);
  const cs = recordValue(localized.cs);
  return Object.keys(cs).length > 0 ? cs : localized;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
