import type { ObservedObject } from "@cop/canonical-model";

export type CopStreamChangeType = "OBJECT_SNAPSHOT" | "OBJECT_UPSERT";
export type CopStreamOperationalSeverity = "info" | "warning";

export interface CopStreamChange {
  changeType: CopStreamChangeType;
  object: ObservedObject;
}

export interface CopStreamMetrics {
  backpressureActive: boolean;
  backpressureClientThreshold: number;
  backpressureMessagesTotal: number;
  clientCount: number;
  deltaMessagesTotal: number;
  heartbeatMessagesTotal: number;
  lastBackpressureAt?: string;
  lastClientConnectedAt?: string;
  lastClientDisconnectedAt?: string;
  lastDeltaAt?: string;
  lastHeartbeatAt?: string;
  lastMessageAt?: string;
  lastReconnectRequiredAt?: string;
  lastSnapshotAt?: string;
  lastWriteErrorAt?: string;
  reconnectRequiredMessagesTotal: number;
  recommendedRetryMs: number;
  sequence: number;
  snapshotMessagesTotal: number;
  writeErrorsTotal: number;
}

export interface CopStreamBroadcasterOptions {
  backpressureClientThreshold?: number;
  recommendedRetryMs?: number;
}

export type CopStreamMessage =
  | {
      changes: CopStreamChange[];
      sequence: number;
      serverTimestamp: string;
      subscriptionId: string;
      type: "snapshot";
    }
  | {
      changes: CopStreamChange[];
      sequence: number;
      serverTimestamp: string;
      type: "delta";
    }
  | {
      sequence: number;
      serverTimestamp: string;
      type: "heartbeat";
    }
  | {
      clientCount: number;
      reason: string;
      recommendedRetryMs: number;
      sequence: number;
      serverTimestamp: string;
      severity: CopStreamOperationalSeverity;
      threshold: number;
      type: "backpressure";
      writeErrorsTotal: number;
    }
  | {
      reason: string;
      retryAfterMs: number;
      sequence: number;
      serverTimestamp: string;
      severity: CopStreamOperationalSeverity;
      type: "reconnect_required";
    };

type CopStreamSubscriber = (message: CopStreamMessage) => void;

export class CopStreamBroadcaster {
  private readonly subscribers = new Set<CopStreamSubscriber>();
  private readonly backpressureClientThreshold: number;
  private readonly recommendedRetryMs: number;
  private backpressureMessagesTotal = 0;
  private deltaMessagesTotal = 0;
  private heartbeatMessagesTotal = 0;
  private lastBackpressureAt: string | undefined;
  private lastClientConnectedAt: string | undefined;
  private lastClientDisconnectedAt: string | undefined;
  private lastDeltaAt: string | undefined;
  private lastHeartbeatAt: string | undefined;
  private lastMessageAt: string | undefined;
  private lastReconnectRequiredAt: string | undefined;
  private lastSnapshotAt: string | undefined;
  private lastWriteErrorAt: string | undefined;
  private reconnectRequiredMessagesTotal = 0;
  private sequence = 0;
  private snapshotMessagesTotal = 0;
  private writeErrorsTotal = 0;

  constructor(options: CopStreamBroadcasterOptions = {}) {
    this.backpressureClientThreshold = positiveInteger(options.backpressureClientThreshold, 25);
    this.recommendedRetryMs = positiveInteger(options.recommendedRetryMs, 5000);
  }

  get clientCount(): number {
    return this.subscribers.size;
  }

  get metrics(): CopStreamMetrics {
    return {
      backpressureActive: this.isBackpressureActive(),
      backpressureClientThreshold: this.backpressureClientThreshold,
      backpressureMessagesTotal: this.backpressureMessagesTotal,
      clientCount: this.clientCount,
      deltaMessagesTotal: this.deltaMessagesTotal,
      heartbeatMessagesTotal: this.heartbeatMessagesTotal,
      ...(this.lastBackpressureAt ? { lastBackpressureAt: this.lastBackpressureAt } : {}),
      ...(this.lastClientConnectedAt ? { lastClientConnectedAt: this.lastClientConnectedAt } : {}),
      ...(this.lastClientDisconnectedAt ? { lastClientDisconnectedAt: this.lastClientDisconnectedAt } : {}),
      ...(this.lastDeltaAt ? { lastDeltaAt: this.lastDeltaAt } : {}),
      ...(this.lastHeartbeatAt ? { lastHeartbeatAt: this.lastHeartbeatAt } : {}),
      ...(this.lastMessageAt ? { lastMessageAt: this.lastMessageAt } : {}),
      ...(this.lastReconnectRequiredAt ? { lastReconnectRequiredAt: this.lastReconnectRequiredAt } : {}),
      ...(this.lastSnapshotAt ? { lastSnapshotAt: this.lastSnapshotAt } : {}),
      ...(this.lastWriteErrorAt ? { lastWriteErrorAt: this.lastWriteErrorAt } : {}),
      reconnectRequiredMessagesTotal: this.reconnectRequiredMessagesTotal,
      recommendedRetryMs: this.recommendedRetryMs,
      sequence: this.sequence,
      snapshotMessagesTotal: this.snapshotMessagesTotal,
      writeErrorsTotal: this.writeErrorsTotal
    };
  }

  createHeartbeat(now: Date): CopStreamMessage {
    const message: CopStreamMessage = {
      sequence: this.nextSequence(),
      serverTimestamp: now.toISOString(),
      type: "heartbeat"
    };
    this.recordCreatedMessage(message);
    return message;
  }

  createSnapshot(subscriptionId: string, objects: ObservedObject[], now: Date): CopStreamMessage {
    const message: CopStreamMessage = {
      changes: objects.map((object) => ({
        changeType: "OBJECT_SNAPSHOT",
        object
      })),
      sequence: this.nextSequence(),
      serverTimestamp: now.toISOString(),
      subscriptionId,
      type: "snapshot"
    };
    this.recordCreatedMessage(message);
    return message;
  }

  createBackpressure(now: Date): CopStreamMessage | undefined {
    if (!this.isBackpressureActive()) {
      return undefined;
    }

    const message: CopStreamMessage = {
      clientCount: this.clientCount,
      reason: "stream_client_count_above_threshold",
      recommendedRetryMs: this.recommendedRetryMs,
      sequence: this.nextSequence(),
      serverTimestamp: now.toISOString(),
      severity: "warning",
      threshold: this.backpressureClientThreshold,
      type: "backpressure",
      writeErrorsTotal: this.writeErrorsTotal
    };
    this.recordCreatedMessage(message);
    return message;
  }

  createReconnectRequired(reason: string, now: Date): CopStreamMessage {
    const message: CopStreamMessage = {
      reason,
      retryAfterMs: this.recommendedRetryMs,
      sequence: this.nextSequence(),
      serverTimestamp: now.toISOString(),
      severity: "warning",
      type: "reconnect_required"
    };
    this.recordCreatedMessage(message);
    return message;
  }

  publishObjectUpserts(objects: ObservedObject[], now: Date): CopStreamMessage | undefined {
    if (objects.length === 0) {
      return undefined;
    }

    const message: CopStreamMessage = {
      changes: objects.map((object) => ({
        changeType: "OBJECT_UPSERT",
        object
      })),
      sequence: this.nextSequence(),
      serverTimestamp: now.toISOString(),
      type: "delta"
    };
    this.recordCreatedMessage(message);
    this.publish(message);
    return message;
  }

  recordWriteError(now = new Date()): void {
    this.writeErrorsTotal += 1;
    this.lastWriteErrorAt = now.toISOString();
  }

  subscribe(subscriber: CopStreamSubscriber): () => void {
    this.subscribers.add(subscriber);
    this.lastClientConnectedAt = new Date().toISOString();
    return () => {
      this.subscribers.delete(subscriber);
      this.lastClientDisconnectedAt = new Date().toISOString();
    };
  }

  private isBackpressureActive(): boolean {
    return this.clientCount >= this.backpressureClientThreshold;
  }

  private nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  private publish(message: CopStreamMessage): void {
    for (const subscriber of Array.from(this.subscribers)) {
      try {
        subscriber(message);
      } catch {
        this.recordWriteError();
      }
    }
  }

  private recordCreatedMessage(message: CopStreamMessage): void {
    this.lastMessageAt = message.serverTimestamp;
    if (message.type === "snapshot") {
      this.snapshotMessagesTotal += 1;
      this.lastSnapshotAt = message.serverTimestamp;
    }
    if (message.type === "delta") {
      this.deltaMessagesTotal += 1;
      this.lastDeltaAt = message.serverTimestamp;
    }
    if (message.type === "heartbeat") {
      this.heartbeatMessagesTotal += 1;
      this.lastHeartbeatAt = message.serverTimestamp;
    }
    if (message.type === "backpressure") {
      this.backpressureMessagesTotal += 1;
      this.lastBackpressureAt = message.serverTimestamp;
    }
    if (message.type === "reconnect_required") {
      this.reconnectRequiredMessagesTotal += 1;
      this.lastReconnectRequiredAt = message.serverTimestamp;
    }
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? Math.trunc(value) : fallback;
}
