import type { CanonicalEventEnvelope, ObservedObject, SourceSystem } from "@cop/canonical-model";

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
  idempotency: Map<string, { hash: string; response: unknown }>;
  auditEvents: Array<Record<string, unknown>>;
}
