import type { CanonicalEventEnvelope, ObservedObject } from "@cop/canonical-model";
import type { CopState, TrackHistoryPoint } from "./types.js";

export interface TrackHistoryQuery {
  from?: string;
  limit?: number;
  objectIds?: string[];
  seconds?: number;
  to?: string;
}

const defaultHistoryLimit = 120;
const maxHistoryLimit = 1000;
const maxStoredPointsPerTrack = 5000;

export function appendTrackHistory(
  state: CopState,
  event: CanonicalEventEnvelope,
  object: ObservedObject
): TrackHistoryPoint | undefined {
  if (!hasPosition(object)) {
    return undefined;
  }

  const point: TrackHistoryPoint = {
    affiliation: object.affiliation,
    confidence: object.confidence,
    eventId: event.eventId,
    ingestTimestamp: event.ingestTimestamp,
    lat: object.position.lat,
    lon: object.position.lon,
    objectId: object.objectId,
    objectType: object.objectType,
    producerTimestamp: event.producerTimestamp,
    sourceSystemId: event.source.sourceSystemId,
    status: object.status,
    synthetic: object.synthetic ?? false,
    timestamp: object.lastUpdatedAt ?? event.ingestTimestamp ?? event.producerTimestamp
  };

  const current = state.trackHistory.get(object.objectId) ?? [];
  state.trackHistory.set(object.objectId, [...current, point].slice(-maxStoredPointsPerTrack));
  return point;
}

export function queryTrackHistory(
  state: CopState,
  query: TrackHistoryQuery,
  now: Date
): Array<{ objectId: string; points: TrackHistoryPoint[] }> {
  const requestedObjectIds = query.objectIds?.filter(Boolean);
  const objectIds = requestedObjectIds && requestedObjectIds.length > 0
    ? requestedObjectIds
    : Array.from(state.trackHistory.keys());

  return objectIds
    .map((objectId) => ({
      objectId,
      points: filterHistoryPoints(state.trackHistory.get(objectId) ?? [], query, now)
    }))
    .filter((item) => item.points.length > 0);
}

export function parseTrackHistoryQuery(query: Record<string, unknown>): TrackHistoryQuery {
  return {
    from: optionalString(query.from),
    limit: clampLimit(query.limit),
    objectIds: parseObjectIds(query.objectIds),
    seconds: optionalPositiveNumber(query.seconds),
    to: optionalString(query.to)
  };
}

function filterHistoryPoints(points: TrackHistoryPoint[], query: TrackHistoryQuery, now: Date): TrackHistoryPoint[] {
  const fromMs = parseDateMs(query.from);
  const toMs = parseDateMs(query.to);
  const seconds = query.seconds && query.seconds > 0 ? query.seconds : undefined;
  const cutoffMs = seconds ? now.getTime() - seconds * 1000 : undefined;
  const effectiveFromMs = [fromMs, cutoffMs].filter(isFiniteNumber).reduce(
    (max, value) => Math.max(max, value),
    Number.NEGATIVE_INFINITY
  );
  const effectiveToMs = isFiniteNumber(toMs) ? toMs : undefined;

  const filtered = points.filter((point) => {
    const timestampMs = Date.parse(point.timestamp);
    if (!Number.isFinite(timestampMs)) {
      return false;
    }
    if (Number.isFinite(effectiveFromMs) && timestampMs < effectiveFromMs) {
      return false;
    }
    if (effectiveToMs !== undefined && timestampMs > effectiveToMs) {
      return false;
    }
    return true;
  });

  return filtered.slice(-clampLimit(query.limit));
}

function parseObjectIds(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.flatMap((item) => parseObjectIds(item) ?? []);
  }
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function optionalPositiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function clampLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultHistoryLimit;
  }
  return Math.min(maxHistoryLimit, Math.max(1, Math.trunc(parsed)));
}

function parseDateMs(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function hasPosition(object: ObservedObject): object is ObservedObject & { position: NonNullable<ObservedObject["position"]> } {
  return Number.isFinite(object.position?.lat) && Number.isFinite(object.position?.lon);
}
