import { describe, expect, it } from "vitest";
import type { ObservedObject } from "@cop/canonical-model";
import { CopStreamBroadcaster } from "./cop-stream.js";

describe("COP stream broadcaster", () => {
  it("publishes object upserts with monotonic sequences", () => {
    const broadcaster = new CopStreamBroadcaster();
    const messages: ReturnType<CopStreamBroadcaster["publishObjectUpserts"]>[] = [];
    const unsubscribe = broadcaster.subscribe((message) => messages.push(message));

    const first = broadcaster.publishObjectUpserts([object("AIR_SIM_UAV-0001")], new Date("2026-05-19T08:00:00Z"));
    const second = broadcaster.createHeartbeat(new Date("2026-05-19T08:00:15Z"));

    unsubscribe();

    expect(first?.type).toBe("delta");
    expect(first?.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      changes: [
        {
          changeType: "OBJECT_UPSERT",
          object: {
            objectId: "AIR_SIM_UAV-0001"
          }
        }
      ],
      sequence: 1,
      type: "delta"
    });
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
