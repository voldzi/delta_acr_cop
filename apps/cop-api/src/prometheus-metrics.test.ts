import { describe, expect, it } from "vitest";
import { buildCopPrometheusMetrics, type CopPrometheusMetricsInput } from "./prometheus-metrics.js";

const baseMetrics: CopPrometheusMetricsInput = {
  currentObjectCount: 7,
  eventCount: 11,
  persistedCurrentTrackCount: 5,
  sourceCount: 3,
  streamBusMetrics: {
    localDeliveriesTotal: 4,
    mode: "postgres",
    publishedMessagesTotal: 8,
    ready: true,
    receivedMessagesTotal: 6
  },
  streamMetrics: {
    backpressureActive: false,
    backpressureClientThreshold: 25,
    backpressureMessagesTotal: 1,
    clientCount: 2,
    deltaMessagesTotal: 3,
    heartbeatMessagesTotal: 4,
    lastBackpressureAt: "2026-06-29T10:00:04Z",
    lastDeltaAt: "2026-06-29T10:00:02Z",
    lastHeartbeatAt: "2026-06-29T10:00:03Z",
    lastSnapshotAt: "2026-06-29T10:00:01Z",
    lastWriteErrorAt: "not-a-date",
    reconnectRequiredMessagesTotal: 0,
    recommendedRetryMs: 5000,
    sequence: 42,
    snapshotMessagesTotal: 2,
    writeErrorsTotal: 0
  },
  trackHistoryPointCount: 13
};

describe("buildCopPrometheusMetrics", () => {
  it("formats core COP and stream metrics", () => {
    const output = buildCopPrometheusMetrics(baseMetrics);

    expect(output).toContain("cop_sources_total 3\n");
    expect(output).toContain("cop_events_total 11\n");
    expect(output).toContain("cop_objects_total 7\n");
    expect(output).toContain("cop_stream_messages_total{type=\"snapshot\"} 2\n");
    expect(output).toContain("cop_stream_bus_ready{mode=\"postgres\"} 1\n");
    expect(output).toContain("cop_stream_last_message_timestamp_seconds{type=\"snapshot\"} 1782727201\n");
    expect(output).toContain("cop_stream_last_message_timestamp_seconds{type=\"write_error\"} 0\n");
    expect(output.endsWith("\n")).toBe(true);
  });

  it("escapes stream bus mode labels for Prometheus", () => {
    const output = buildCopPrometheusMetrics({
      ...baseMetrics,
      streamBusMetrics: {
        ...baseMetrics.streamBusMetrics,
        mode: "pg\"east\\node\n1"
      }
    });

    expect(output).toContain("cop_stream_bus_ready{mode=\"pg\\\"east\\\\node\\n1\"} 1");
  });

  it("includes provider cache metrics only when supplied", () => {
    const output = buildCopPrometheusMetrics({
      ...baseMetrics,
      safetyCache: {
        coalescedHits: 3,
        entries: 10,
        errors: 1,
        evictions: 2,
        hits: 8,
        inflight: 1,
        misses: 5,
        refreshes: 7,
        staleHits: 4
      }
    });

    expect(output).toContain("# HELP cop_safety_cache_entries Cached safety-data canonical viewport entries.");
    expect(output).toContain("cop_safety_cache_requests_total{result=\"hit\"} 8");
    expect(output).toContain("cop_safety_cache_errors_total 1");
    expect(output).not.toContain("cop_situation_cache_entries");
    expect(output).not.toContain("cop_tak_gateway_cache_entries");
  });
});
