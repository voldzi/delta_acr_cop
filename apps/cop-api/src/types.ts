import type { Affiliation, CanonicalEventEnvelope, ObjectStatus, ObjectType, ObservedObject, SourceSystem } from "@cop/canonical-model";

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Array<{ path: string; issue: string }>;
    correlationId: string;
  };
}

export interface CopState {
  sources: Map<string, SourceSystem>;
  events: Map<string, CanonicalEventEnvelope>;
  objects: Map<string, ObservedObject>;
  trackHistory: Map<string, TrackHistoryPoint[]>;
  idempotency: Map<string, { hash: string; response: unknown }>;
  alertAcknowledgements: Map<string, AlertAcknowledgement>;
  auditEvents: Array<Record<string, unknown>>;
}

export type SourceHealthOverrideStatus = "DEGRADED" | "ONLINE" | "STALE" | "UNAVAILABLE" | "WAITING";

export interface SourceHealthOverride {
  detail?: string;
  evaluatedAt: string;
  generatedAt?: string;
  health: SourceHealthOverrideStatus;
  lastError?: string;
  lastPollAt?: string;
  lastSuccessAt?: string;
  summary?: Record<string, unknown>;
  warnings?: string[];
}

export interface AlertAcknowledgement {
  acknowledgedAt: string;
  alertId: string;
  acknowledgedBy?: string;
  note?: string;
}

export interface TrackHistoryPoint {
  affiliation: Affiliation;
  confidence?: number;
  eventId: string;
  ingestTimestamp?: string;
  lat: number;
  lon: number;
  objectId: string;
  objectType: ObjectType;
  producerTimestamp: string;
  sourceSystemId: string;
  status: ObjectStatus;
  synthetic: boolean;
  timestamp: string;
}
