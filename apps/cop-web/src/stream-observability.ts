import type { CopStreamMessage } from "./cop-data";

export interface StreamTelemetry {
  lastError: string | null;
  lastHeartbeatAt: string | null;
  lastMessageAt: string | null;
  latencyMs: number | null;
  reconnectCount: number;
  sequence: number | null;
}

export function createInitialStreamTelemetry(): StreamTelemetry {
  return {
    lastError: null,
    lastHeartbeatAt: null,
    lastMessageAt: null,
    latencyMs: null,
    reconnectCount: 0,
    sequence: null
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
    lastHeartbeatAt: message.type === "heartbeat" ? receivedAtIso : current.lastHeartbeatAt,
    lastMessageAt: receivedAtIso,
    latencyMs: calculateStreamLatencyMs(message.serverTimestamp, receivedAt.getTime()),
    sequence: message.sequence
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
