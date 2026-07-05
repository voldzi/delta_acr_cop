import type { AoiRule, CopAlert } from "./cop-data";
import type { UserLocation } from "./proximity-alerts";

const earthRadiusKm = 6371.0088;

export interface AlertAreaFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Polygon"; coordinates: Array<Array<[number, number]>> };
    properties: { alertId: string; severity: CopAlert["severity"]; type: CopAlert["type"] };
  }>;
}

export interface AoiRuleFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Polygon"; coordinates: Array<Array<[number, number]>> };
    properties: { color: string; enabled: boolean; fillOpacity: number; id: string; name: string; severity: NonNullable<AoiRule["severity"]> };
  }>;
}

export interface AoiDraftFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry:
      | { type: "LineString"; coordinates: Array<[number, number]> }
      | { type: "Point"; coordinates: [number, number] }
      | { type: "Polygon"; coordinates: Array<Array<[number, number]>> };
    properties: { index?: number; kind: "area" | "line" | "point" };
  }>;
}

export interface AoiEditFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: {
      index?: number;
      insertIndex?: number;
      kind: "midpoint" | "vertex";
      selected?: boolean;
      zoneId: string;
    };
  }>;
}

export interface UserLocationFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: { accuracyM: number };
  }>;
}

export interface UserAlertRadiusFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Polygon"; coordinates: Array<Array<[number, number]>> };
    properties: { radiusKm: number; active: boolean };
  }>;
}

export interface EmptyFeatureCollection {
  type: "FeatureCollection";
  features: [];
}

export function alertAreasToFeatureCollection(alerts: CopAlert[]): AlertAreaFeatureCollection {
  return {
    type: "FeatureCollection",
    features: alerts.flatMap((alert) => {
      if (!alert.map || !Number.isFinite(alert.map.lat) || !Number.isFinite(alert.map.lon) || !Number.isFinite(alert.map.radiusKm)) {
        return [];
      }
      return [
        {
          type: "Feature" as const,
          geometry: {
            type: "Polygon" as const,
            coordinates: [buildGeodesicCircle(alert.map, Math.max(0.2, alert.map.radiusKm))]
          },
          properties: {
            alertId: alert.alertId,
            severity: alert.severity,
            type: alert.type
          }
        }
      ];
    })
  };
}

export function aoiRulesToFeatureCollection(aoiRules: AoiRule[]): AoiRuleFeatureCollection {
  return {
    type: "FeatureCollection",
    features: aoiRules.flatMap((rule) => {
      if (!rule.enabled || !Number.isFinite(rule.lat) || !Number.isFinite(rule.lon) || !Number.isFinite(rule.radiusKm)) {
        return [];
      }
      const polygonCoordinates = isValidAoiPolygon(rule.polygon)
        ? rule.polygon.coordinates
        : rule.radiusKm > 0
          ? [buildGeodesicCircle(rule, Math.max(0.2, rule.radiusKm))]
          : null;
      if (!polygonCoordinates) {
        return [];
      }
      return [
        {
          type: "Feature" as const,
          geometry: {
            type: "Polygon" as const,
            coordinates: polygonCoordinates
          },
          properties: {
            enabled: true,
            id: rule.id,
            color: normalizeZoneColor(rule.color),
            fillOpacity: normalizeZoneOpacity(rule.fillOpacity),
            name: rule.name,
            severity: rule.severity ?? "warning"
          }
        }
      ];
    })
  };
}

export function zoneDraftToFeatureCollection(points: Array<{ lat: number; lon: number }>): AoiDraftFeatureCollection {
  const coordinates = points.map((point): [number, number] => [point.lon, point.lat]);
  const features: AoiDraftFeatureCollection["features"] = [];
  if (coordinates.length >= 2) {
    const first = coordinates[0];
    if (!first) {
      return { type: "FeatureCollection", features };
    }
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: coordinates.length >= 3 ? [...coordinates, first] : coordinates },
      properties: { kind: "line" }
    });
  }
  if (coordinates.length >= 3) {
    const first = coordinates[0];
    if (!first) {
      return { type: "FeatureCollection", features };
    }
    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[...coordinates, first]] },
      properties: { kind: "area" }
    });
  }
  coordinates.forEach((coordinate, index) => {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: coordinate },
      properties: { index: index + 1, kind: "point" }
    });
  });
  return { type: "FeatureCollection", features };
}

export function emptyAoiDraftFeatureCollection(): AoiDraftFeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

export function emptyAoiEditFeatureCollection(): AoiEditFeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

export function emptyPolygonFeatureCollection(): EmptyFeatureCollection {
  return {
    type: "FeatureCollection",
    features: []
  };
}

export function findEditableAoiRule(aoiRules: AoiRule[], zoneId: string | null | undefined): AoiRule | null {
  if (!zoneId) {
    return null;
  }
  const rule = aoiRules.find((candidate) => candidate.id === zoneId);
  return rule && isValidAoiPolygon(rule.polygon) ? rule : null;
}

export function aoiRuleEditablePoints(rule: AoiRule | null): Array<{ lat: number; lon: number }> {
  if (!rule || !isValidAoiPolygon(rule.polygon)) {
    return [];
  }
  const ring = rule.polygon.coordinates[0] ?? [];
  return ring.slice(0, -1).map(([lon, lat]) => ({ lat, lon }));
}

export function aoiRuleToEditFeatureCollection(rule: AoiRule | null, selectedVertexIndex: number | null = null): AoiEditFeatureCollection {
  const points = aoiRuleEditablePoints(rule);
  if (!rule || points.length < 3) {
    return emptyAoiEditFeatureCollection();
  }
  const features: AoiEditFeatureCollection["features"] = [];
  points.forEach((point, index) => {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [point.lon, point.lat] },
      properties: {
        index,
        kind: "vertex",
        selected: selectedVertexIndex === index,
        zoneId: rule.id
      }
    });
  });
  points.forEach((point, index) => {
    const nextPoint = points[(index + 1) % points.length];
    if (!nextPoint) {
      return;
    }
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [(point.lon + nextPoint.lon) / 2, (point.lat + nextPoint.lat) / 2]
      },
      properties: {
        insertIndex: index + 1,
        kind: "midpoint",
        zoneId: rule.id
      }
    });
  });
  return { type: "FeatureCollection", features };
}

export function userLocationToFeatureCollection(userLocation: UserLocation | null): UserLocationFeatureCollection {
  return {
    type: "FeatureCollection",
    features: userLocation
      ? [
          {
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [userLocation.lon, userLocation.lat]
            },
            properties: {
              accuracyM: userLocation.accuracyM ?? 0
            }
          }
        ]
      : []
  };
}

export function userAlertRadiusToFeatureCollection(
  userLocation: UserLocation | null,
  radiusKm: number,
  visible: boolean,
  active = false
): UserAlertRadiusFeatureCollection | EmptyFeatureCollection {
  if (!visible || !userLocation || !Number.isFinite(radiusKm) || radiusKm <= 0) {
    return emptyPolygonFeatureCollection();
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [buildGeodesicCircle(userLocation, radiusKm)]
        },
        properties: {
          radiusKm,
          active
        }
      }
    ]
  };
}

function isValidAoiPolygon(polygon: AoiRule["polygon"]): polygon is NonNullable<AoiRule["polygon"]> {
  const ring = polygon?.coordinates?.[0];
  if (!ring || ring.length < 4) {
    return false;
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) {
    return false;
  }
  return ring.every(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))
    && first[0] === last[0]
    && first[1] === last[1];
}

function normalizeZoneColor(value: string | undefined): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#8cb6d8";
}

function normalizeZoneOpacity(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(0.35, Math.max(0.02, value)) : 0.1;
}

function buildGeodesicCircle(center: { lat: number; lon: number }, radiusKm: number, segments = 96): Array<[number, number]> {
  const lat = degreesToRadians(center.lat);
  const lon = degreesToRadians(center.lon);
  const angularDistance = radiusKm / earthRadiusKm;
  const coordinates: Array<[number, number]> = [];

  for (let index = 0; index < segments; index += 1) {
    const bearing = (index / segments) * Math.PI * 2;
    const pointLat = Math.asin(
      Math.sin(lat) * Math.cos(angularDistance) + Math.cos(lat) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const pointLon =
      lon +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat),
        Math.cos(angularDistance) - Math.sin(lat) * Math.sin(pointLat)
      );

    coordinates.push([normalizeLongitude(radiansToDegrees(pointLon)), radiansToDegrees(pointLat)]);
  }

  coordinates.push(coordinates[0]!);
  return coordinates;
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

function normalizeLongitude(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}
