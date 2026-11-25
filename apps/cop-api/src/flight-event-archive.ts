import { isDeepStrictEqual } from "node:util";
import type { CanonicalEventEnvelope } from "@cop/canonical-model";
import type { CopState } from "./types.js";
import { readObjectProvenance } from "./provenance.js";
import { isPublicCanonicalReleasePolicy } from "./canonical-read-policy.js";

export interface FlightArchiveSummary {
  sourceSystemId: string;
  count: number;
  latencySumMs: number;
  latestEventAt: string;
  latestLatencyMs: number;
}

export interface FlightEventArchive {
  append(events: readonly CanonicalEventEnvelope[]): Promise<void>;
  read(eventIds: readonly string[]): Promise<Map<string, CanonicalEventEnvelope>>;
  summaries(): Promise<FlightArchiveSummary[]>;
}

export const flightArchiveBatchSize = 128;
const maximumHotFlightEvents = 16_384;

/** Storage eligibility only. Existing read policy and projection fences apply separately.
 * Callers must also establish that the record came directly from the server adapter. */
export function isArchivableFlightEvent(event: CanonicalEventEnvelope): boolean {
  return event.source.adapterId === "flight-data-source-adapter" &&
    event.eventType === "track.updated" &&
    event.classification.level === "UNCLASSIFIED" &&
    event.classification.handlingCaveats.includes("PUBLIC_FLIGHT_AGGREGATE") &&
    event.payload.attributes?.dataOrigin === "PUBLIC_FLIGHT_AGGREGATE" &&
    event.simulation?.synthetic !== true && event.payload.synthetic === false &&
    typeof event.ingestTimestamp === "string" &&
    Number.isFinite(Date.parse(event.ingestTimestamp)) &&
    Number.isFinite(Date.parse(event.producerTimestamp)) &&
    isPublicCanonicalReleasePolicy(event.payload.releasePolicy, new Date(0)) &&
    !event.payload.releasePolicy?.expiresAt;
}

/** Select only older, admitted producer events. The latest event of every
 * available current object stays resident for the existing canonical read checks. */
export function selectFlightArchiveBatch(
  state: CopState,
  eligible: WeakSet<CanonicalEventEnvelope>,
  maxHot = maximumHotFlightEvents,
  limit = flightArchiveBatchSize
): CanonicalEventEnvelope[] {
  if (state.events.size <= maxHot) return [];
  const currentIds = new Set<string>();
  for (const object of state.objects.values()) {
    const id = readObjectProvenance(object)?.eventId ?? object.provenanceIds?.[0];
    if (id) currentIds.add(id);
  }
  const events: CanonicalEventEnvelope[] = [];
  for (const event of state.events.values()) {
    if (!eligible.has(event) || currentIds.has(event.eventId)) continue;
    events.push(event);
    if (events.length >= limit || state.events.size - events.length <= maxHot) break;
  }
  return events;
}

/** Never discard a record before an exact durable write is acknowledged.
 * A replaced record or a record now used as the latest object remains resident. */
export function releaseArchivedFlightEvents(state: CopState, written: readonly CanonicalEventEnvelope[]): number {
  const currentIds = new Set<string>();
  for (const object of state.objects.values()) {
    const id = readObjectProvenance(object)?.eventId ?? object.provenanceIds?.[0];
    if (id) currentIds.add(id);
  }
  let removed = 0;
  for (const event of written) {
    const stored = state.events.get(event.eventId);
    if (stored === event && !currentIds.has(event.eventId)) {
      state.events.delete(event.eventId);
      removed++;
    }
  }
  return removed;
}

export function sameArchivedFlightEvent(a: CanonicalEventEnvelope, b: CanonicalEventEnvelope): boolean {
  // PostgreSQL jsonb normalizes insertion order and JSON has no undefined.
  return isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
}
