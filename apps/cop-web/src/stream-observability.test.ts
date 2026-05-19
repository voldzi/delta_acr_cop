import { describe, expect, it } from "vitest";
import {
  calculateStreamLatencyMs,
  createInitialStreamTelemetry,
  formatStreamLatency,
  updateStreamTelemetryForError,
  updateStreamTelemetryForMessage
} from "./stream-observability";

describe("stream observability", () => {
  it("calculates latency from server timestamp to client receive time", () => {
    expect(calculateStreamLatencyMs("2026-05-19T08:00:00.000Z", Date.parse("2026-05-19T08:00:00.250Z"))).toBe(250);
    expect(calculateStreamLatencyMs("invalid", Date.parse("2026-05-19T08:00:00.250Z"))).toBeNull();
  });

  it("tracks heartbeat receive time, latency and sequence", () => {
    const telemetry = updateStreamTelemetryForMessage(
      createInitialStreamTelemetry(),
      {
        sequence: 42,
        serverTimestamp: "2026-05-19T08:00:00.000Z",
        type: "heartbeat"
      },
      new Date("2026-05-19T08:00:00.420Z")
    );

    expect(telemetry).toMatchObject({
      lastError: null,
      lastHeartbeatAt: "2026-05-19T08:00:00.420Z",
      lastMessageAt: "2026-05-19T08:00:00.420Z",
      latencyMs: 420,
      sequence: 42
    });
  });

  it("increments reconnect count when the stream errors", () => {
    expect(updateStreamTelemetryForError(createInitialStreamTelemetry(), new Error("closed"))).toMatchObject({
      lastError: "closed",
      reconnectCount: 1
    });
  });

  it("tracks server backpressure operational messages", () => {
    const telemetry = updateStreamTelemetryForMessage(
      createInitialStreamTelemetry(),
      {
        clientCount: 30,
        reason: "stream_client_count_above_threshold",
        recommendedRetryMs: 7500,
        sequence: 7,
        serverTimestamp: "2026-05-19T08:00:00.000Z",
        severity: "warning",
        threshold: 25,
        type: "backpressure",
        writeErrorsTotal: 2
      },
      new Date("2026-05-19T08:00:00.200Z")
    );

    expect(telemetry).toMatchObject({
      lastBackpressureAt: "2026-05-19T08:00:00.200Z",
      lastBackpressureReason: "stream_client_count_above_threshold",
      recommendedRetryMs: 7500,
      sequence: 7,
      serverClientCount: 30,
      serverWriteErrorsTotal: 2
    });
  });

  it("formats latency for readiness rows", () => {
    expect(formatStreamLatency(null)).toBe("n/a");
    expect(formatStreamLatency(125)).toBe("125 ms");
    expect(formatStreamLatency(1600)).toBe("1.6 s");
  });
});
