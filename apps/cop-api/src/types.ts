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
  auditEvents: Array<Record<string, unknown>>;
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
