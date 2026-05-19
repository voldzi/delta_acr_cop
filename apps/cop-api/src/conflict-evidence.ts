import type { ObservedObject } from "@cop/canonical-model";
import { readObjectProvenance } from "./provenance.js";
import type { SourceHealthItem } from "./source-health.js";
import type { TrackHistoryPoint } from "./types.js";

export type ConflictEvidenceState = "CLEAR" | "CONFLICTED";
export type ConflictEvidenceSeverity = "info" | "warning";
export type ConflictSignalType =
  | "AFFILIATION_VARIANCE"
  | "LOW_CONFIDENCE"
  | "POSITION_VARIANCE"
  | "SOURCE_DEGRADED"
  | "STATE_CONFLICTED"
  | "STATUS_VARIANCE";

export interface ConflictSignal {
  detail: string;
  observedAt?: string;
  severity: ConflictEvidenceSeverity;
  sourceSystemIds: string[];
  title: string;
  type: ConflictSignalType;
}

export interface ObjectConflictEvidence {
  evaluatedAt: string;
  objectId: string;
  severity: ConflictEvidenceSeverity;
  signals: ConflictSignal[];
  sourceSystemIds: string[];
  state: ConflictEvidenceState;
}

const lowConfidenceThreshold = 0.5;
const sourceDistanceConflictKm = 2;
const recentHistoryLimit = 12;

export function buildConflictEvidenceIndex({
  evaluatedAt,
  historyItems,
  objects,
  sourceHealth
}: {
  evaluatedAt: string;
  historyItems: Array<{ objectId: string; points: TrackHistoryPoint[] }>;
  objects: ObservedObject[];
  sourceHealth: SourceHealthItem[];
}): Map<string, ObjectConflictEvidence> {
  const historyByObjectId = new Map(historyItems.map((item) => [item.objectId, item.points]));
  return new Map(
    objects.map((object) => [
      object.objectId,
      buildObjectConflictEvidence({
        evaluatedAt,
        historyPoints: historyByObjectId.get(object.objectId) ?? [],
        object,
        sourceHealth
      })
    ])
  );
}

export function buildObjectConflictEvidence({
  evaluatedAt,
  historyPoints,
  object,
  sourceHealth
}: {
  evaluatedAt: string;
  historyPoints: TrackHistoryPoint[];
  object: ObservedObject;
  sourceHealth: SourceHealthItem[];
}): ObjectConflictEvidence {
  const provenance = readObjectProvenance(object);
  const linkedSourceHealth = provenance?.sourceSystemId
    ? sourceHealth.find((item) => item.sourceSystemId === provenance.sourceSystemId)
    : undefined;
  const recentPoints = historyPoints.slice(-recentHistoryLimit);
  const signals = [
    ...stateSignals(object, provenance?.sourceSystemId),
    ...confidenceSignals(object, provenance?.sourceSystemId),
    ...historySignals(recentPoints),
    ...sourceHealthSignals(linkedSourceHealth)
  ];
  const sourceSystemIds = Array.from(
    new Set([
      provenance?.sourceSystemId,
      ...recentPoints.map((point) => point.sourceSystemId),
      ...signals.flatMap((signal) => signal.sourceSystemIds)
    ].filter((value): value is string => Boolean(value)))
  );

  return {
    evaluatedAt,
    objectId: object.objectId,
    severity: signals.some((signal) => signal.severity === "warning") ? "warning" : "info",
    signals,
    sourceSystemIds,
    state: signals.length > 0 ? "CONFLICTED" : "CLEAR"
  };
}

export function withConflictEvidence(object: ObservedObject, evidence: ObjectConflictEvidence | undefined): ObservedObject {
  if (!evidence) {
    return object;
  }

  return {
    ...object,
    attributes: {
      ...(object.attributes ?? {}),
      conflictEvidence: evidence
    }
  };
}

function stateSignals(object: ObservedObject, sourceSystemId: string | undefined): ConflictSignal[] {
  if (object.status !== "CONFLICTED") {
    return [];
  }

  return [
    {
      detail: "COP state marks this object as CONFLICTED.",
      observedAt: object.lastUpdatedAt,
      severity: "warning",
      sourceSystemIds: sourceSystemId ? [sourceSystemId] : [],
      title: "State conflict",
      type: "STATE_CONFLICTED"
    }
  ];
}

function confidenceSignals(object: ObservedObject, sourceSystemId: string | undefined): ConflictSignal[] {
  const confidence = object.confidence ?? 0;
  if (confidence >= lowConfidenceThreshold) {
    return [];
  }

  return [
    {
      detail: `Object confidence ${Math.round(confidence * 100)} % is below the ${Math.round(lowConfidenceThreshold * 100)} % data quality threshold.`,
      observedAt: object.lastUpdatedAt,
      severity: "warning",
      sourceSystemIds: sourceSystemId ? [sourceSystemId] : [],
      title: "Low confidence",
      type: "LOW_CONFIDENCE"
    }
  ];
}

function historySignals(points: TrackHistoryPoint[]): ConflictSignal[] {
  const signals: ConflictSignal[] = [];
  const affiliations = uniqueDefined(points.map((point) => point.affiliation));
  if (affiliations.length > 1) {
    signals.push({
      detail: `Recent history contains multiple affiliations: ${affiliations.join(", ")}.`,
      observedAt: latestTimestamp(points),
      severity: "warning",
      sourceSystemIds: uniqueDefined(points.map((point) => point.sourceSystemId)),
      title: "Affiliation variance",
      type: "AFFILIATION_VARIANCE"
    });
  }

  const statuses = uniqueDefined(points.map((point) => point.status));
  if (statuses.length > 2) {
    signals.push({
      detail: `Recent history contains changing lifecycle states: ${statuses.join(", ")}.`,
      observedAt: latestTimestamp(points),
      severity: "warning",
      sourceSystemIds: uniqueDefined(points.map((point) => point.sourceSystemId)),
      title: "Status variance",
      type: "STATUS_VARIANCE"
    });
  }

  const sourcePositions = latestPositionBySource(points);
  const maxDistanceKm = maxSourceDistanceKm(sourcePositions);
  if (maxDistanceKm > sourceDistanceConflictKm) {
    signals.push({
      detail: `Latest source positions differ by up to ${maxDistanceKm.toFixed(1)} km.`,
      observedAt: latestTimestamp(points),
      severity: "warning",
      sourceSystemIds: sourcePositions.map((point) => point.sourceSystemId),
      title: "Position variance",
      type: "POSITION_VARIANCE"
    });
  }

  return signals;
}

function sourceHealthSignals(sourceHealth: SourceHealthItem | undefined): ConflictSignal[] {
  if (!sourceHealth || sourceHealth.health === "ONLINE") {
    return [];
  }

  return [
    {
      detail: `Linked source health is ${sourceHealth.health.toLowerCase()}; current tracks ${sourceHealth.currentTracks}, stale ${sourceHealth.staleTracks}.`,
      observedAt: sourceHealth.lastObservationAt,
      severity: "warning",
      sourceSystemIds: [sourceHealth.sourceSystemId],
      title: "Source degraded",
      type: "SOURCE_DEGRADED"
    }
  ];
}

function latestPositionBySource(points: TrackHistoryPoint[]): Array<{ lat: number; lon: number; sourceSystemId: string; timestampMs: number }> {
  const bySource = new Map<string, { lat: number; lon: number; sourceSystemId: string; timestampMs: number }>();
  points.forEach((point) => {
    const timestampMs = Date.parse(point.timestamp);
    const current = bySource.get(point.sourceSystemId);
    if (!current || timestampMs > current.timestampMs) {
      bySource.set(point.sourceSystemId, {
        lat: point.lat,
        lon: point.lon,
        sourceSystemId: point.sourceSystemId,
        timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0
      });
    }
  });
  return Array.from(bySource.values());
}

function maxSourceDistanceKm(points: Array<{ lat: number; lon: number }>): number {
  let maxDistance = 0;
  for (let index = 0; index < points.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < points.length; compareIndex += 1) {
      maxDistance = Math.max(maxDistance, distanceKm(points[index]!, points[compareIndex]!));
    }
  }
  return maxDistance;
}

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = Math.PI / 180;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const deltaLat = (b.lat - a.lat) * toRad;
  const deltaLon = (b.lon - a.lon) * toRad;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function uniqueDefined(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function latestTimestamp(points: TrackHistoryPoint[]): string | undefined {
  return points.reduce<string | undefined>((latest, point) => {
    if (!latest) {
      return point.timestamp;
    }
    return Date.parse(point.timestamp) > Date.parse(latest) ? point.timestamp : latest;
  }, undefined);
}
