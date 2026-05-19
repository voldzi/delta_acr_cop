import type { CopObject } from "./cop-data";

export interface TrackHistoryPoint {
  objectId: string;
  affiliation: string;
  lat: number;
  lon: number;
  timestamp: string;
}

export type TrackHistory = Record<string, TrackHistoryPoint[]>;
export type PredictionMode = "adaptive" | "telemetry" | "history" | "maneuver";
export type PredictionMethod = "telemetry" | "history" | "maneuver";

export interface PredictedPosition {
  lat: number;
  lon: number;
  method: PredictionMethod;
  path: Array<{ lat: number; lon: number }>;
}

const earthRadiusM = 6371000;
const samePointTolerance = 0.000001;
const defaultPredictionSteps = 6;

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

export function trimTrackHistory(history: TrackHistory, maxPointsPerTrack: number): TrackHistory {
  const pointLimit = Math.max(1, Math.trunc(maxPointsPerTrack));
  return Object.fromEntries(Object.entries(history).map(([objectId, points]) => [objectId, points.slice(-pointLimit)]));
}

export function countHistoryPoints(history: TrackHistory, objects: CopObject[]): number {
  return objects.reduce((sum, object) => sum + (history[object.objectId]?.length ?? 0), 0);
}

export function predictPosition(
  object: CopObject,
  historyPoints: TrackHistoryPoint[] = [],
  horizonMinutes: number,
  mode: PredictionMode = "adaptive"
): PredictedPosition | null {
  if (!hasPosition(object) || horizonMinutes <= 0) {
    return null;
  }

  if (mode === "telemetry") {
    return predictFromTelemetry(object, horizonMinutes);
  }
  if (mode === "history") {
    return predictFromHistory(object, historyPoints, horizonMinutes);
  }
  if (mode === "maneuver") {
    return predictFromManeuver(object, historyPoints, horizonMinutes) ?? predictFromHistory(object, historyPoints, horizonMinutes);
  }

  return predictFromTelemetry(object, horizonMinutes) ?? predictFromHistory(object, historyPoints, horizonMinutes);
}

function predictFromTelemetry(object: CopObject, horizonMinutes: number): PredictedPosition | null {
  if (!hasPosition(object)) {
    return null;
  }

  const speedMps = object.movement?.speedMps ?? object.speedMps;
  const headingDeg = object.movement?.headingDeg ?? object.headingDeg;
  if (!Number.isFinite(speedMps) || !Number.isFinite(headingDeg) || Number(speedMps) <= 0) {
    return null;
  }

  const path = buildTelemetryPath(object.position, Number(speedMps), Number(headingDeg), horizonMinutes);
  return {
    ...path[path.length - 1]!,
    method: "telemetry",
    path
  };
}

function predictFromHistory(object: CopObject, historyPoints: TrackHistoryPoint[], horizonMinutes: number): PredictedPosition | null {
  if (!hasPosition(object)) {
    return null;
  }

  const vector = estimateHistoryVector(historyPoints.slice(-4));
  if (!vector) {
    return null;
  }

  const horizonSeconds = horizonMinutes * 60;
  const path = [{ lat: object.position.lat, lon: object.position.lon }];
  for (let step = 1; step <= defaultPredictionSteps; step += 1) {
    const seconds = (horizonSeconds / defaultPredictionSteps) * step;
    path.push({
      lat: clampLatitude(object.position.lat + vector.latPerSecond * seconds),
      lon: wrapLongitude(object.position.lon + vector.lonPerSecond * seconds)
    });
  }

  return {
    ...path[path.length - 1]!,
    method: "history",
    path
  };
}

function predictFromManeuver(object: CopObject, historyPoints: TrackHistoryPoint[], horizonMinutes: number): PredictedPosition | null {
  if (!hasPosition(object)) {
    return null;
  }

  const segments = buildRecentSegments(historyPoints.slice(-5));
  if (segments.length < 2) {
    return null;
  }

  const lastSegment = segments[segments.length - 1]!;
  const previousSegment = segments[segments.length - 2]!;
  const turnRateDegPerSecond = angularDeltaDeg(lastSegment.headingDeg, previousSegment.headingDeg) / Math.max(1, lastSegment.elapsedSeconds);
  const speedMps = average(segments.slice(-3).map((segment) => segment.speedMps));
  if (!Number.isFinite(speedMps) || speedMps <= 0) {
    return null;
  }

  const stepSeconds = (horizonMinutes * 60) / defaultPredictionSteps;
  const path = [{ lat: object.position.lat, lon: object.position.lon }];
  let current = object.position;
  let headingDeg = lastSegment.headingDeg;

  for (let step = 1; step <= defaultPredictionSteps; step += 1) {
    headingDeg = normalizeHeading(headingDeg + turnRateDegPerSecond * stepSeconds);
    current = projectPosition(current.lat, current.lon, speedMps * stepSeconds, headingDeg);
    path.push(current);
  }

  return {
    ...path[path.length - 1]!,
    method: "maneuver",
    path
  };
}

function buildTelemetryPath(
  position: { lat: number; lon: number },
  speedMps: number,
  headingDeg: number,
  horizonMinutes: number
): Array<{ lat: number; lon: number }> {
  const path = [{ lat: position.lat, lon: position.lon }];
  for (let step = 1; step <= defaultPredictionSteps; step += 1) {
    const distanceM = speedMps * horizonMinutes * 60 * (step / defaultPredictionSteps);
    path.push(projectPosition(position.lat, position.lon, distanceM, headingDeg));
  }
  return path;
}

function estimateHistoryVector(historyPoints: TrackHistoryPoint[]): { latPerSecond: number; lonPerSecond: number } | null {
  const segments = buildRecentSegments(historyPoints);
  if (segments.length === 0) {
    return null;
  }

  return {
    latPerSecond: average(segments.map((segment) => segment.latPerSecond)),
    lonPerSecond: average(segments.map((segment) => segment.lonPerSecond))
  };
}

function buildRecentSegments(historyPoints: TrackHistoryPoint[]): Array<{
  elapsedSeconds: number;
  headingDeg: number;
  latPerSecond: number;
  lonPerSecond: number;
  speedMps: number;
}> {
  const segments: Array<{
    elapsedSeconds: number;
    headingDeg: number;
    latPerSecond: number;
    lonPerSecond: number;
    speedMps: number;
  }> = [];

  for (let index = 1; index < historyPoints.length; index += 1) {
    const previousPoint = historyPoints[index - 1]!;
    const lastPoint = historyPoints[index]!;
    const elapsedSeconds = (new Date(lastPoint.timestamp).getTime() - new Date(previousPoint.timestamp).getTime()) / 1000;
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
      continue;
    }

    segments.push({
      elapsedSeconds,
      headingDeg: headingBetweenPoints(previousPoint, lastPoint),
      latPerSecond: (lastPoint.lat - previousPoint.lat) / elapsedSeconds,
      lonPerSecond: (lastPoint.lon - previousPoint.lon) / elapsedSeconds,
      speedMps: distanceMeters(previousPoint, lastPoint) / elapsedSeconds
    });
  }

  return segments;
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

function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function headingBetweenPoints(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLon = toRadians(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return normalizeHeading(toDegrees(Math.atan2(y, x)));
}

function hasPosition(object: CopObject): object is CopObject & { position: NonNullable<CopObject["position"]> } {
  return Number.isFinite(object.position?.lat) && Number.isFinite(object.position?.lon);
}

function angularDeltaDeg(current: number, previous: number): number {
  return ((((current - previous + 540) % 360) + 360) % 360) - 180;
}

function average(values: number[]): number {
  const finiteValues = values.filter(Number.isFinite);
  return finiteValues.length ? finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length : 0;
}

function normalizeHeading(value: number): number {
  return ((value % 360) + 360) % 360;
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
