import { createSimSourceSystem, type CanonicalEventEnvelope } from "@cop/canonical-model";
import { describe, expect, it } from "vitest";
import { buildSourceHealthItems } from "./source-health.js";
import { createInitialState } from "./state.js";

describe("source health aggregation", () => {
  it("keeps exact counts, latest event and latency statistics across sources", () => {
    const state = createInitialState();
    const source = createSimSourceSystem();
    const other = { ...source, sourceSystemId: "source-2", displayName: "Source 2" };
    state.sources.set(other.sourceSystemId, other);
    const start = "2026-07-11T00:00:00.000Z";
    const events: CanonicalEventEnvelope[] = [
      event("1", source.sourceSystemId, start, "2026-07-11T00:00:03.000Z"),
      event("2", source.sourceSystemId, start, "2026-07-11T00:00:01.000Z"),
      { ...event("3", source.sourceSystemId, start), eventType: "track.created" },
      event("4", other.sourceSystemId, start, "2026-07-11T00:00:02.000Z")
    ];
    for (const value of events) state.events.set(value.eventId, value);

    const [first, second] = buildSourceHealthItems(state, new Date(start), {
      expireAfterMs: 120_000, staleAfterMs: 30_000
    });
    expect(first).toMatchObject({ acceptedEvents: 3, eventTypeCounts: { "track.created": 1, "track.updated": 2 },
      avgLatencyMs: 2000, lastLatencyMs: 3000, lastEventAt: events[0]!.ingestTimestamp });
    expect(second).toMatchObject({ acceptedEvents: 1, avgLatencyMs: 2000, lastLatencyMs: 2000 });
  });

  it("indexes events and objects once instead of rescanning them for every source", () => {
    const state = createInitialState();
    const source = createSimSourceSystem();
    state.sources.set("source-2", { ...source, displayName: "Source 2", sourceSystemId: "source-2" });
    state.sources.set("source-3", { ...source, displayName: "Source 3", sourceSystemId: "source-3" });
    const events = new CountingMap(state.events);
    const objects = new CountingMap(state.objects);
    state.events = events;
    state.objects = objects;

    const items = buildSourceHealthItems(state, new Date("2026-07-11T00:00:00Z"), {
      expireAfterMs: 120_000,
      staleAfterMs: 30_000
    });

    expect(items).toHaveLength(3);
    expect(events.valuesCalls).toBe(1);
    expect(objects.valuesCalls).toBe(1);
  });
});

class CountingMap<K, V> extends Map<K, V> {
  valuesCalls = 0;

  override values(): MapIterator<V> {
    this.valuesCalls += 1;
    return super.values();
  }
}

function event(id: string, sourceSystemId: string, producerTimestamp: string, ingestTimestamp?: string): CanonicalEventEnvelope {
  return {
    eventId: id, eventType: "track.updated", contractVersion: "cop-ingest-v1", correlationId: id,
    source: { sourceSystemId, adapterId: "test", adapterVersion: "1" },
    producerTimestamp, ingestTimestamp,
    classification: { level: "UNCLASSIFIED", releasability: [], handlingCaveats: [] },
    geo: { lat: 0, lon: 0 },
    payload: { objectId: id, objectType: "AIRCRAFT", domain: "AIR", affiliation: "FRIEND", status: "ACTIVE" },
    quality: { confidence: 1, sourceReliability: "UNKNOWN", informationCredibility: "UNKNOWN" },
    simulation: { synthetic: true }
  };
}
