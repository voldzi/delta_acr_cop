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
    expect(broadcaster.metrics).toMatchObject({
      clientCount: 0,
      deltaMessagesTotal: 1,
      heartbeatMessagesTotal: 1,
      sequence: 2,
      snapshotMessagesTotal: 0,
      writeErrorsTotal: 0
    });
  });

  it("creates backpressure messages when client count reaches the threshold", () => {
    const broadcaster = new CopStreamBroadcaster({ backpressureClientThreshold: 1, recommendedRetryMs: 7500 });
    const unsubscribe = broadcaster.subscribe(() => undefined);

    const message = broadcaster.createBackpressure(new Date("2026-05-19T08:01:00Z"));

    unsubscribe();
    expect(message).toMatchObject({
      clientCount: 1,
      reason: "stream_client_count_above_threshold",
      recommendedRetryMs: 7500,
      sequence: 1,
      severity: "warning",
      threshold: 1,
      type: "backpressure"
    });
    expect(broadcaster.metrics).toMatchObject({
      backpressureActive: false,
      backpressureMessagesTotal: 1,
      clientCount: 0,
      lastBackpressureAt: "2026-05-19T08:01:00.000Z",
      recommendedRetryMs: 7500
    });
  });

  it("records stream write errors for health reporting", () => {
    const broadcaster = new CopStreamBroadcaster();

    broadcaster.recordWriteError(new Date("2026-05-19T08:02:00Z"));
    const reconnect = broadcaster.createReconnectRequired("stream_write_failed", new Date("2026-05-19T08:02:01Z"));

    expect(reconnect).toMatchObject({
      reason: "stream_write_failed",
      retryAfterMs: 5000,
      sequence: 1,
      type: "reconnect_required"
    });
    expect(broadcaster.metrics).toMatchObject({
      lastReconnectRequiredAt: "2026-05-19T08:02:01.000Z",
      lastWriteErrorAt: "2026-05-19T08:02:00.000Z",
      reconnectRequiredMessagesTotal: 1,
      writeErrorsTotal: 1
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
