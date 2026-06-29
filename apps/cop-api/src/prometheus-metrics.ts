import type { CopStreamBusMetrics } from "./cop-stream-bus.js";
import type { CopStreamMetrics } from "./cop-stream.js";

export interface ProviderCacheStats {
  coalescedHits: number;
  entries: number;
  errors: number;
  evictions: number;
  hits: number;
  inflight: number;
  misses: number;
  refreshes: number;
  staleHits: number;
}

export interface CopPrometheusMetricsInput {
  currentObjectCount: number;
  eventCount: number;
  persistedCurrentTrackCount: number;
  safetyCache?: ProviderCacheStats;
  situationCache?: ProviderCacheStats;
  sourceCount: number;
  streamBusMetrics: CopStreamBusMetrics;
  streamMetrics: CopStreamMetrics;
  takGatewayCache?: ProviderCacheStats;
  trackHistoryPointCount: number;
}

export function buildCopPrometheusMetrics(input: CopPrometheusMetricsInput): string {
  const streamBusMode = escapePrometheusLabel(input.streamBusMetrics.mode);
  const lines = [
    "# HELP cop_sources_total Registered COP source systems.",
    "# TYPE cop_sources_total gauge",
    `cop_sources_total ${input.sourceCount}`,
    "# HELP cop_events_total Accepted ingest events.",
    "# TYPE cop_events_total counter",
    `cop_events_total ${input.eventCount}`,
    "# HELP cop_objects_total Current non-expired COP objects.",
    "# TYPE cop_objects_total gauge",
    `cop_objects_total ${input.currentObjectCount}`,
    "# HELP cop_current_tracks_persisted_total Persisted current COP track snapshots.",
    "# TYPE cop_current_tracks_persisted_total gauge",
    `cop_current_tracks_persisted_total ${input.persistedCurrentTrackCount}`,
    "# HELP cop_track_history_points_total Retained temporal track history points.",
    "# TYPE cop_track_history_points_total gauge",
    `cop_track_history_points_total ${input.trackHistoryPointCount}`,
    "# HELP cop_stream_clients_total Connected COP live stream clients.",
    "# TYPE cop_stream_clients_total gauge",
    `cop_stream_clients_total ${input.streamMetrics.clientCount}`,
    "# HELP cop_stream_messages_total COP live stream messages created by type.",
    "# TYPE cop_stream_messages_total counter",
    `cop_stream_messages_total{type="snapshot"} ${input.streamMetrics.snapshotMessagesTotal}`,
    `cop_stream_messages_total{type="delta"} ${input.streamMetrics.deltaMessagesTotal}`,
    `cop_stream_messages_total{type="heartbeat"} ${input.streamMetrics.heartbeatMessagesTotal}`,
    `cop_stream_messages_total{type="backpressure"} ${input.streamMetrics.backpressureMessagesTotal}`,
    `cop_stream_messages_total{type="reconnect_required"} ${input.streamMetrics.reconnectRequiredMessagesTotal}`,
    "# HELP cop_stream_write_errors_total COP live stream write errors.",
    "# TYPE cop_stream_write_errors_total counter",
    `cop_stream_write_errors_total ${input.streamMetrics.writeErrorsTotal}`,
    "# HELP cop_stream_bus_ready Whether COP stream fan-out bus is ready.",
    "# TYPE cop_stream_bus_ready gauge",
    `cop_stream_bus_ready{mode="${streamBusMode}"} ${input.streamBusMetrics.ready ? 1 : 0}`,
    "# HELP cop_stream_bus_messages_total COP stream fan-out bus messages.",
    "# TYPE cop_stream_bus_messages_total counter",
    `cop_stream_bus_messages_total{mode="${streamBusMode}",direction="published"} ${input.streamBusMetrics.publishedMessagesTotal}`,
    `cop_stream_bus_messages_total{mode="${streamBusMode}",direction="received"} ${input.streamBusMetrics.receivedMessagesTotal}`,
    `cop_stream_bus_messages_total{mode="${streamBusMode}",direction="local_delivery"} ${input.streamBusMetrics.localDeliveriesTotal}`,
    "# HELP cop_stream_backpressure_active Whether COP stream backpressure is currently active.",
    "# TYPE cop_stream_backpressure_active gauge",
    `cop_stream_backpressure_active ${input.streamMetrics.backpressureActive ? 1 : 0}`,
    "# HELP cop_stream_backpressure_client_threshold Client threshold for stream backpressure.",
    "# TYPE cop_stream_backpressure_client_threshold gauge",
    `cop_stream_backpressure_client_threshold ${input.streamMetrics.backpressureClientThreshold}`,
    "# HELP cop_stream_last_message_timestamp_seconds Last COP stream message timestamp by type.",
    "# TYPE cop_stream_last_message_timestamp_seconds gauge",
    `cop_stream_last_message_timestamp_seconds{type="snapshot"} ${timestampSeconds(input.streamMetrics.lastSnapshotAt)}`,
    `cop_stream_last_message_timestamp_seconds{type="delta"} ${timestampSeconds(input.streamMetrics.lastDeltaAt)}`,
    `cop_stream_last_message_timestamp_seconds{type="heartbeat"} ${timestampSeconds(input.streamMetrics.lastHeartbeatAt)}`,
    `cop_stream_last_message_timestamp_seconds{type="backpressure"} ${timestampSeconds(input.streamMetrics.lastBackpressureAt)}`,
    `cop_stream_last_message_timestamp_seconds{type="write_error"} ${timestampSeconds(input.streamMetrics.lastWriteErrorAt)}`,
    ...providerCacheMetricLines({
      cache: input.situationCache,
      entriesHelp: "Cached situation-data canonical viewport entries.",
      helpPrefix: "Situation-data",
      metricPrefix: "cop_situation_cache"
    }),
    ...providerCacheMetricLines({
      cache: input.safetyCache,
      entriesHelp: "Cached safety-data canonical viewport entries.",
      helpPrefix: "Safety-data",
      metricPrefix: "cop_safety_cache"
    }),
    ...providerCacheMetricLines({
      cache: input.takGatewayCache,
      entriesHelp: "Cached TAK Gateway viewport entries.",
      helpPrefix: "TAK Gateway",
      metricPrefix: "cop_tak_gateway_cache"
    })
  ];

  return `${lines.join("\n")}\n`;
}

function providerCacheMetricLines(input: {
  cache?: ProviderCacheStats;
  entriesHelp: string;
  helpPrefix: string;
  metricPrefix: string;
}): string[] {
  if (!input.cache) {
    return [];
  }
  return [
    `# HELP ${input.metricPrefix}_entries ${input.entriesHelp}`,
    `# TYPE ${input.metricPrefix}_entries gauge`,
    `${input.metricPrefix}_entries ${input.cache.entries}`,
    `# HELP ${input.metricPrefix}_inflight In-flight ${input.helpPrefix} cache refreshes.`,
    `# TYPE ${input.metricPrefix}_inflight gauge`,
    `${input.metricPrefix}_inflight ${input.cache.inflight}`,
    `# HELP ${input.metricPrefix}_requests_total ${input.helpPrefix} cache requests by result.`,
    `# TYPE ${input.metricPrefix}_requests_total counter`,
    `${input.metricPrefix}_requests_total{result="hit"} ${input.cache.hits}`,
    `${input.metricPrefix}_requests_total{result="miss"} ${input.cache.misses}`,
    `${input.metricPrefix}_requests_total{result="coalesced"} ${input.cache.coalescedHits}`,
    `${input.metricPrefix}_requests_total{result="stale"} ${input.cache.staleHits}`,
    `# HELP ${input.metricPrefix}_refreshes_total ${input.helpPrefix} upstream refreshes completed by COP.`,
    `# TYPE ${input.metricPrefix}_refreshes_total counter`,
    `${input.metricPrefix}_refreshes_total ${input.cache.refreshes}`,
    `# HELP ${input.metricPrefix}_errors_total ${input.helpPrefix} upstream refresh errors observed by COP.`,
    `# TYPE ${input.metricPrefix}_errors_total counter`,
    `${input.metricPrefix}_errors_total ${input.cache.errors}`,
    `# HELP ${input.metricPrefix}_evictions_total ${input.helpPrefix} cache evictions.`,
    `# TYPE ${input.metricPrefix}_evictions_total counter`,
    `${input.metricPrefix}_evictions_total ${input.cache.evictions}`
  ];
}

function timestampSeconds(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0;
}

function escapePrometheusLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("\n", "\\n");
}
