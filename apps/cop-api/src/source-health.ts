import type { CanonicalEventEnvelope, EventType, ObservedObject, SourceSystem } from "@cop/canonical-model";
import { readObjectProvenance } from "./provenance.js";
import { resolveTrackLifecycle, selectCurrentTracks, type TrackLifecycleConfig } from "./track-lifecycle.js";
import type { CopState, SourceHealthOverride } from "./types.js";

export type SourceHealthStatus = "DEGRADED" | "DISABLED" | "ONLINE" | "QUIET" | "STALE" | "UNAVAILABLE" | "WAITING";

export interface SourceHealthItem {
  acceptedEvents: number;
  avgConfidence?: number;
  avgLatencyMs?: number;
  currentTracks: number;
  displayName: string;
  eventTypeCounts: Partial<Record<EventType, number>>;
  expiredTracks: number;
  health: SourceHealthStatus;
  detail?: string;
  lastEventAt?: string;
  lastError?: string;
  lastLatencyMs?: number;
  lastObservationAgeSeconds?: number;
  lastObservationAt?: string;
  warnings?: string[];
  lowConfidenceTracks: number;
  sourceSystemId: string;
  sourceType: SourceSystem["sourceType"];
  staleTracks: number;
  status: SourceSystem["status"];
  synthetic: boolean;
  totalTracks: number;
}

export function buildSourceHealthItems(state: CopState, now: Date, lifecycle: TrackLifecycleConfig): SourceHealthItem[] {
  return Array.from(state.sources.values()).map((source) => buildSourceHealthItem(source, state, now, lifecycle));
}

function buildSourceHealthItem(source: SourceSystem, state: CopState, now: Date, lifecycle: TrackLifecycleConfig): SourceHealthItem {
  const events = Array.from(state.events.values()).filter((event) => event.source.sourceSystemId === source.sourceSystemId);
  const sourceObjects = Array.from(state.objects.values()).filter((object) => objectSourceId(object, state) === source.sourceSystemId);
  const lifecycleStates = sourceObjects.map((object) => resolveTrackLifecycle(object, now, lifecycle));
  const currentTracks = selectCurrentTracks(sourceObjects, now, lifecycle).length;
  const latencies = events.map(eventLatencyMs).filter((value): value is number => value !== undefined);
  const lastEvent = latestEvent(events);
  const lastEventAt = lastEvent ? eventTimestamp(lastEvent) : undefined;
  const override = readSourceHealthOverride(source);
  const lastObservationAt = latestIso([override?.lastSuccessAt, override?.generatedAt, lastEventAt, ...sourceObjects.map((object) => object.lastUpdatedAt)]);
  const lastObservationAgeSeconds = lastObservationAt
    ? Math.max(0, Math.round((now.getTime() - Date.parse(lastObservationAt)) / 1000))
    : undefined;
  const confidences = sourceObjects.map((object) => object.confidence).filter((value): value is number => typeof value === "number");

  return {
    acceptedEvents: events.length,
    ...(confidences.length > 0 ? { avgConfidence: average(confidences) } : {}),
    ...(override?.detail ? { detail: override.detail } : {}),
    ...(latencies.length > 0 ? { avgLatencyMs: Math.round(average(latencies)) } : {}),
    currentTracks,
    displayName: source.displayName,
    eventTypeCounts: eventCounts(events),
    expiredTracks: lifecycleStates.filter((track) => track.expired).length,
    health: override?.health ?? resolveSourceHealth(source, lastObservationAgeSeconds, lifecycle),
    ...(lastEventAt ? { lastEventAt } : {}),
    ...(override?.lastError ? { lastError: override.lastError } : {}),
    ...(lastEvent ? latencyField(lastEvent) : {}),
    ...(lastObservationAgeSeconds === undefined ? {} : { lastObservationAgeSeconds }),
    ...(lastObservationAt ? { lastObservationAt } : {}),
    lowConfidenceTracks: sourceObjects.filter((object) => (object.confidence ?? 0) < 0.5).length,
    sourceSystemId: source.sourceSystemId,
    sourceType: source.sourceType,
    staleTracks: lifecycleStates.filter((track) => track.stale && !track.expired).length,
    status: source.status,
    synthetic: source.synthetic,
    totalTracks: sourceObjects.length,
    ...(override?.warnings && override.warnings.length > 0 ? { warnings: override.warnings } : {})
  };
}

function objectSourceId(object: ObservedObject, state: CopState): string | undefined {
  const provenance = readObjectProvenance(object);
  if (provenance?.sourceSystemId) {
    return provenance.sourceSystemId;
  }
  const eventId = object.provenanceIds?.[0];
  return eventId ? state.events.get(eventId)?.source.sourceSystemId : undefined;
}

function resolveSourceHealth(
  source: SourceSystem,
  lastObservationAgeSeconds: number | undefined,
  lifecycle: TrackLifecycleConfig
): SourceHealthStatus {
  if (source.status !== "ACTIVE") {
    return "DISABLED";
  }
  if (lastObservationAgeSeconds === undefined) {
    return "WAITING";
  }
  const lastObservationAgeMs = lastObservationAgeSeconds * 1000;
  if (lastObservationAgeMs < lifecycle.staleAfterMs) {
    return "ONLINE";
  }
  if (lastObservationAgeMs < lifecycle.expireAfterMs) {
    return "QUIET";
  }
  return "STALE";
}

function readSourceHealthOverride(source: SourceSystem): SourceHealthOverride | undefined {
  const value = source.attributes?.sourceHealth
    ?? source.attributes?.flightDataHealth
    ?? source.attributes?.situationDataHealth
    ?? source.attributes?.safetyDataHealth;
  if (!isRecord(value)) {
    return undefined;
  }
  const health = value.health;
  if (!isSourceHealthOverrideStatus(health)) {
    return undefined;
  }
  return {
    detail: optionalString(value.detail),
    evaluatedAt: optionalString(value.evaluatedAt) ?? new Date().toISOString(),
    generatedAt: optionalString(value.generatedAt),
    health,
    lastError: optionalString(value.lastError),
    lastPollAt: optionalString(value.lastPollAt),
    lastSuccessAt: optionalString(value.lastSuccessAt),
    summary: isRecord(value.summary) ? value.summary : undefined,
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((item): item is string => typeof item === "string") : undefined
  };
}

function isSourceHealthOverrideStatus(value: unknown): value is SourceHealthOverride["health"] {
  return value === "DEGRADED" || value === "ONLINE" || value === "STALE" || value === "UNAVAILABLE" || value === "WAITING";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function latestEvent(events: CanonicalEventEnvelope[]): CanonicalEventEnvelope | undefined {
  return events.reduce<CanonicalEventEnvelope | undefined>((latest, event) => {
    if (!latest) {
      return event;
    }
    return Date.parse(eventTimestamp(event)) > Date.parse(eventTimestamp(latest)) ? event : latest;
  }, undefined);
}

function eventTimestamp(event: CanonicalEventEnvelope): string {
  return event.ingestTimestamp ?? event.producerTimestamp;
}

function latestIso(values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => Boolean(value))
    .reduce<string | undefined>((latest, value) => {
      if (!latest) {
        return value;
      }
      return Date.parse(value) > Date.parse(latest) ? value : latest;
    }, undefined);
}

function eventCounts(events: CanonicalEventEnvelope[]): Partial<Record<EventType, number>> {
  return events.reduce<Partial<Record<EventType, number>>>((counts, event) => ({
    ...counts,
    [event.eventType]: (counts[event.eventType] ?? 0) + 1
  }), {});
}

function eventLatencyMs(event: CanonicalEventEnvelope): number | undefined {
  const ingestTimestamp = event.ingestTimestamp;
  if (!ingestTimestamp) {
    return undefined;
  }
  const producerMs = Date.parse(event.producerTimestamp);
  const ingestMs = Date.parse(ingestTimestamp);
  return Number.isFinite(producerMs) && Number.isFinite(ingestMs) ? Math.max(0, ingestMs - producerMs) : undefined;
}

function latencyField(event: CanonicalEventEnvelope): { lastLatencyMs?: number } {
  const latencyMs = eventLatencyMs(event);
  return latencyMs === undefined ? {} : { lastLatencyMs: latencyMs };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
