import { describe, expect, it } from "vitest";
import { CopStreamBroadcaster, type CopStreamMessage } from "./cop-stream.js";
import { createCopStreamBusFromEnv, MemoryCopStreamBus } from "./cop-stream-bus.js";
import type { ObservedObject } from "@cop/canonical-model";

describe("COP stream bus", () => {
  it("delivers memory bus messages to local subscribers", async () => {
    const broadcaster = new CopStreamBroadcaster();
    const message = broadcaster.createObjectUpserts([object("AIR_SIM_UAV-0100")], new Date("2026-05-19T08:03:00Z"));
    const bus = new MemoryCopStreamBus();
    const delivered: CopStreamMessage[] = [];
    const unsubscribe = bus.subscribe((received) => delivered.push(received));

    await bus.init();
    await bus.publish(message!);
    unsubscribe();
    await bus.close();

    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      sequence: 1,
      type: "delta"
    });
    expect(bus.metrics).toMatchObject({
      localDeliveriesTotal: 1,
      mode: "memory",
      publishedMessagesTotal: 1,
      ready: true,
      receivedMessagesTotal: 0
    });
  });

  it("uses memory bus by default", () => {
    expect(createCopStreamBusFromEnv({}).name).toBe("memory");
  });

  it("rejects explicit postgres mode without a database URL", () => {
    expect(() => createCopStreamBusFromEnv({ COP_STREAM_BUS: "postgres" })).toThrow(/missing database URL/u);
  });
});

function object(objectId: string): ObservedObject {
  return {
    affiliation: "HOSTILE",
    confidence: 0.9,
    domain: "AIR",
    lastUpdatedAt: "2026-05-19T08:00:00Z",
    objectId,
    objectType: "UAV",
    position: {
      lat: 50.08,
      lon: 14.42
    },
    status: "ACTIVE",
    synthetic: true
  };
}
