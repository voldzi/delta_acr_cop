import type { CopStreamMessage } from "./cop-data";

export interface StreamTelemetry {
  lastBackpressureAt: string | null;
  lastBackpressureReason: string | null;
  lastError: string | null;
  lastHeartbeatAt: string | null;
  lastMessageAt: string | null;
  lastReconnectRequiredAt: string | null;
  latencyMs: number | null;
  recommendedRetryMs: number | null;
  reconnectCount: number;
  sequence: number | null;
  serverClientCount: number | null;
  serverWriteErrorsTotal: number | null;
}

export function createInitialStreamTelemetry(): StreamTelemetry {
  return {
    lastBackpressureAt: null,
    lastBackpressureReason: null,
    lastError: null,
    lastHeartbeatAt: null,
    lastMessageAt: null,
    lastReconnectRequiredAt: null,
    latencyMs: null,
    recommendedRetryMs: null,
    reconnectCount: 0,
    sequence: null,
    serverClientCount: null,
    serverWriteErrorsTotal: null
  };
}

export function calculateStreamLatencyMs(serverTimestamp: string | undefined, receivedAtMs = Date.now()): number | null {
  const serverMs = serverTimestamp ? Date.parse(serverTimestamp) : Number.NaN;
  if (!Number.isFinite(serverMs)) {
    return null;
  }
  return Math.max(0, Math.round(receivedAtMs - serverMs));
}

export function updateStreamTelemetryForMessage(
  current: StreamTelemetry,
  message: CopStreamMessage,
  receivedAt = new Date()
): StreamTelemetry {
  const receivedAtIso = receivedAt.toISOString();
  return {
    ...current,
    lastError: null,
    lastBackpressureAt: message.type === "backpressure" ? receivedAtIso : current.lastBackpressureAt,
    lastBackpressureReason: message.type === "backpressure" ? message.reason : current.lastBackpressureReason,
    lastHeartbeatAt: message.type === "heartbeat" ? receivedAtIso : current.lastHeartbeatAt,
    lastMessageAt: receivedAtIso,
    lastReconnectRequiredAt: message.type === "reconnect_required" ? receivedAtIso : current.lastReconnectRequiredAt,
    latencyMs: calculateStreamLatencyMs(message.serverTimestamp, receivedAt.getTime()),
    recommendedRetryMs: message.type === "backpressure" ? message.recommendedRetryMs : message.type === "reconnect_required" ? message.retryAfterMs : current.recommendedRetryMs,
    sequence: message.sequence,
    serverClientCount: message.type === "backpressure" ? message.clientCount : current.serverClientCount,
    serverWriteErrorsTotal: message.type === "backpressure" ? message.writeErrorsTotal : current.serverWriteErrorsTotal
  };
}

export function updateStreamTelemetryForError(current: StreamTelemetry, error: Error): StreamTelemetry {
  return {
    ...current,
    lastError: error.message,
    reconnectCount: current.reconnectCount + 1
  };
}

export function formatStreamLatency(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  if (value < 1000) {
    return `${value} ms`;
  }
  return `${(value / 1000).toFixed(1)} s`;
}

export function formatStreamObservation(value: string | null): string {
  if (!value) {
    return "n/a";
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "n/a";
  }
  return timestamp.toLocaleTimeString("cs-CZ");
}
