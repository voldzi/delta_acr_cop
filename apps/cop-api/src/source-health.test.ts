import { createSimSourceSystem } from "@cop/canonical-model";
import { describe, expect, it } from "vitest";
import { buildSourceHealthItems } from "./source-health.js";
import { createInitialState } from "./state.js";

describe("source health aggregation", () => {
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
