import type { CopObject } from "./cop-data";

export interface TrackHistoryPoint {
  objectId: string;
  affiliation: string;
  lat: number;
  lon: number;
  timestamp: string;
}

export type TrackHistory = Record<string, TrackHistoryPoint[]>;

const earthRadiusM = 6371000;
const samePointTolerance = 0.000001;

export function mergeTrackHistory(
  currentHistory: TrackHistory,
  objects: CopObject[],
  observedAt: string,
  maxPointsPerTrack = 36
): TrackHistory {
  const nextHistory: TrackHistory = { ...currentHistory };

  objects.forEach((object) => {
    if (!hasPosition(object)) {
      return;
    }

    const timestamp = object.lastUpdatedAt ?? observedAt;
    const currentPoints = nextHistory[object.objectId] ?? [];
    const lastPoint = currentPoints[currentPoints.length - 1];
    if (
      lastPoint &&
      Math.abs(lastPoint.lat - object.position.lat) < samePointTolerance &&
      Math.abs(lastPoint.lon - object.position.lon) < samePointTolerance
    ) {
      return;
    }

    nextHistory[object.objectId] = [
      ...currentPoints,
      {
        objectId: object.objectId,
        affiliation: object.affiliation,
        lat: object.position.lat,
        lon: object.position.lon,
        timestamp
      }
    ].slice(-maxPointsPerTrack);
  });

  return nextHistory;
}

export function countHistoryPoints(history: TrackHistory, objects: CopObject[]): number {
  return objects.reduce((sum, object) => sum + (history[object.objectId]?.length ?? 0), 0);
}

export function predictPosition(
  object: CopObject,
  historyPoints: TrackHistoryPoint[] = [],
  horizonMinutes: number
): { lat: number; lon: number; method: "movement" | "history" } | null {
  if (!hasPosition(object) || horizonMinutes <= 0) {
    return null;
  }

  const speedMps = object.movement?.speedMps ?? object.speedMps;
  const headingDeg = object.movement?.headingDeg ?? object.headingDeg;
  if (Number.isFinite(speedMps) && Number.isFinite(headingDeg) && Number(speedMps) > 0) {
    return {
      ...projectPosition(object.position.lat, object.position.lon, Number(speedMps) * horizonMinutes * 60, Number(headingDeg)),
      method: "movement"
    };
  }

  const lastTwoPoints = historyPoints.slice(-2);
  if (lastTwoPoints.length < 2) {
    return null;
  }

  const previousPoint = lastTwoPoints[0]!;
  const lastPoint = lastTwoPoints[1]!;
  const elapsedSeconds = (new Date(lastPoint.timestamp).getTime() - new Date(previousPoint.timestamp).getTime()) / 1000;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
    return null;
  }

  const horizonSeconds = horizonMinutes * 60;
  const latDelta = ((lastPoint.lat - previousPoint.lat) / elapsedSeconds) * horizonSeconds;
  const lonDelta = ((lastPoint.lon - previousPoint.lon) / elapsedSeconds) * horizonSeconds;
  return {
    lat: clampLatitude(lastPoint.lat + latDelta),
    lon: wrapLongitude(lastPoint.lon + lonDelta),
    method: "history"
  };
}

function projectPosition(lat: number, lon: number, distanceM: number, headingDeg: number): { lat: number; lon: number } {
  const bearing = toRadians(headingDeg);
  const lat1 = toRadians(lat);
  const lon1 = toRadians(lon);
  const angularDistance = distanceM / earthRadiusM;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );

  return {
    lat: clampLatitude(toDegrees(lat2)),
    lon: wrapLongitude(toDegrees(lon2))
  };
}

function hasPosition(object: CopObject): object is CopObject & { position: NonNullable<CopObject["position"]> } {
  return Number.isFinite(object.position?.lat) && Number.isFinite(object.position?.lon);
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

function clampLatitude(value: number): number {
  return Math.max(-90, Math.min(90, value));
}

function wrapLongitude(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}
