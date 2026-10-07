import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanonicalEventEnvelope } from "@cop/canonical-model";
import { buildServer } from "./server.js";
import { createInitialState } from "./state.js";
import { withEventProvenance } from "./provenance.js";

afterEach(() => vi.unstubAllEnvs());
const sourceId = "sim-air-situation-001";
const fixedNow = new Date("2026-10-07T12:00:00Z");
const headers = {
  authorization: "Bearer dev-lab-token",
  "x-source-system-id": sourceId,
  "x-idempotency-key": "synthetic-ingest-key"
};

function event(): CanonicalEventEnvelope {
  return {
    eventId: randomUUID(), eventType: "track.updated", contractVersion: "cop-ingest-v1", correlationId: randomUUID(),
    source: { sourceSystemId: sourceId, adapterId: "synthetic", adapterVersion: "1.0.0" },
    producerTimestamp: fixedNow.toISOString(),
    classification: { level: "UNCLASSIFIED", releasability: ["CZ"], handlingCaveats: [] },
    geo: { lat: 50, lon: 14 },
    payload: { objectId: randomUUID(), objectType: "AIRCRAFT", domain: "AIR", affiliation: "FRIEND", status: "ACTIVE" },
    quality: { confidence: 1 }, simulation: { synthetic: true }
  };
}

describe("canonical ingest security boundary", () => {
  it.each(["RESTRICTED", "CONFIDENTIAL", "SECRET"] as const)("rejects %s before accepting or publishing a single event", async (level) => {
    const state = createInitialState();
    const app = buildServer({ state, now: () => fixedNow });
    try {
      const input = event();
      input.classification.level = level;
      const response = await app.inject({ method: "POST", url: "/api/v1/ingest/events", headers, payload: input });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("CLASSIFICATION_NOT_ALLOWED");
      expect(state.events.size).toBe(0);
      expect(state.objects.size).toBe(0);
    } finally { await app.close(); }
  });

  it.each([
    { code: "CLASSIFICATION_NOT_ALLOWED", status: 422, change: (input: CanonicalEventEnvelope) => { input.classification.level = "RESTRICTED"; } },
    { code: "SOURCE_MISMATCH", status: 403, change: (input: CanonicalEventEnvelope) => { input.source.sourceSystemId = "unknown-source"; } },
    { code: "EVENT_TYPE_NOT_ALLOWED", status: 422, change: (input: CanonicalEventEnvelope) => { input.eventType = "track.lost"; } },
    { code: "OBJECT_TYPE_NOT_ALLOWED", status: 422, change: (input: CanonicalEventEnvelope) => { input.payload.objectType = "GROUND_UNIT"; } },
    { code: "SYNTHETIC_FLAG_REQUIRED", status: 422, change: (input: CanonicalEventEnvelope) => { input.simulation = { synthetic: false }; } }
  ])("validates the entire batch's $code boundary before accepting its valid first item", async ({ code, status, change }) => {
    const state = createInitialState();
    // Narrow the permitted source types to make each rejection explicit.
    const source = state.sources.get(sourceId)!;
    source.allowedEventTypes = ["track.updated"];
    source.allowedObjectTypes = ["AIRCRAFT"];
    const app = buildServer({ state, now: () => fixedNow });
    try {
      const forbidden = event();
      change(forbidden);
      const response = await app.inject({
        method: "POST", url: "/api/v1/ingest/batches", headers,
        payload: { batchId: randomUUID(), contractVersion: "cop-ingest-v1", sourceSystemId: sourceId, events: [event(), forbidden] }
      });
      expect(response.statusCode).toBe(status);
      expect(response.json().error.code).toBe(code);
      expect(state.events.size).toBe(0);
      expect(state.objects.size).toBe(0);
    } finally { await app.close(); }
  });

  it("requires the real batch source header", async () => {
    const app = buildServer({ now: () => fixedNow });
    try {
      const response = await app.inject({
        method: "POST", url: "/api/v1/ingest/batches", headers: { authorization: headers.authorization },
        payload: { batchId: randomUUID(), contractVersion: "cop-ingest-v1", sourceSystemId: sourceId, events: [event()] }
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("SOURCE_HEADER_REQUIRED");
    } finally { await app.close(); }
  });

  it.each([
    { visibility: "private", allowedScopes: ["operator"] },
    { visibility: "public", allowedScopes: ["authenticated"] },
    { visibility: "public", allowedScopes: ["public"], userIds: ["private-user"] },
    { visibility: "public", allowedScopes: ["public"], expiresAt: "2026-10-07T11:00:00Z" }
  ])("rejects an explicit protected release policy atomically for single and batch intake: %j", async (policy) => {
    const state = createInitialState();
    const app = buildServer({ state, now: () => fixedNow });
    try {
      const restricted = event();
      restricted.payload.releasePolicy = policy as NonNullable<CanonicalEventEnvelope["payload"]["releasePolicy"]>;
      for (const url of ["/api/v1/ingest/events", "/api/v1/ingest/batches"]) {
        const payload = url.endsWith("/events") ? restricted : {
          batchId: randomUUID(), contractVersion: "cop-ingest-v1", sourceSystemId: sourceId, events: [event(), restricted]
        };
        const response = await app.inject({ method: "POST", url, headers, payload });
        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe("RELEASE_POLICY_NOT_ALLOWED");
        expect(state.events.size).toBe(0);
        expect(state.objects.size).toBe(0);
      }
    } finally { await app.close(); }
  });

  it("retains trusted envelope classification and excludes protected stored current tracks from public output", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const state = createInitialState();
    const protectedEvent = event();
    protectedEvent.classification.level = "RESTRICTED";
    const object = withEventProvenance({ ...protectedEvent.payload, lastUpdatedAt: fixedNow.toISOString() }, protectedEvent);
    state.objects.set(object.objectId, object);
    const app = buildServer({ state, now: () => fixedNow });
    try {
      const accepted = await app.inject({ method: "POST", url: "/api/v1/ingest/events", headers, payload: event() });
      expect(accepted.statusCode).toBe(202);
      const response = await app.inject({ url: "/api/v1/cop/tracks" });
      expect(response.statusCode).toBe(200);
      expect(response.json().items).toHaveLength(1);
      expect(response.body).not.toContain(protectedEvent.payload.objectId);
      expect(state.objects.get(object.objectId)?.attributes?.provenance).toMatchObject({ classification: { level: "RESTRICTED" } });
    } finally { await app.close(); }
  });
});
