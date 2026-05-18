import { createSimSourceSystem } from "@cop/canonical-model";
import type { CopState } from "./types.js";

export function createInitialState(): CopState {
  const sim = createSimSourceSystem();
  return {
    sources: new Map([[sim.sourceSystemId, sim]]),
    events: new Map(),
    objects: new Map(),
    idempotency: new Map(),
    auditEvents: []
  };
}

export function appendAudit(
  state: CopState,
  eventType: string,
  payload: Record<string, unknown>,
  correlationId: string = crypto.randomUUID()
): Record<string, unknown> {
  const record = {
    auditId: crypto.randomUUID(),
    eventType,
    timestamp: new Date().toISOString(),
    correlationId,
    ...payload
  };
  state.auditEvents.push(record);
  return record;
}
