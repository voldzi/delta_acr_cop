import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCopObjectFromEvent, type CanonicalEventEnvelope } from "@cop/canonical-model";
import { buildServer } from "./server.js";
import { createInitialState } from "./state.js";
import { withEventProvenance } from "./provenance.js";
import { appendTrackHistory } from "./temporal-history.js";
import type { TrackHistoryStore } from "./track-history-store.js";
import type { TrackHistoryPoint } from "./types.js";

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
    quality: { confidence: 1, sourceReliability: "UNKNOWN", informationCredibility: "UNKNOWN" }, simulation: { synthetic: true }
  };
}

describe("canonical ingest security boundary", () => {
  it("assigns server ingest time and ignores copied producer ingest time on both transports", async () => {
    for (const batch of [false, true]) {
      const state = createInitialState();
      const app = buildServer({ state, now: () => fixedNow });
      try {
        const input = event();
        input.producerTimestamp = "2026-10-07T11:50:00Z";
        input.ingestTimestamp = "2026-10-07T11:55:00Z";
        const response = await app.inject({ method: "POST", url: batch ? "/api/v1/ingest/batches" : "/api/v1/ingest/events", headers,
          payload: batch ? { batchId: randomUUID(), contractVersion: "cop-ingest-v1", sourceSystemId: sourceId, events: [input] } : input
        });
        expect(response.statusCode).toBe(202);
        expect(state.events.get(input.eventId)?.ingestTimestamp).toBe(fixedNow.toISOString());
        expect(state.events.get(input.eventId)?.producerTimestamp).toBe(input.producerTimestamp);
        expect(state.trackHistory.get(input.payload.objectId)?.[0]?.ingestTimestamp).toBe(fixedNow.toISOString());
      } finally { await app.close(); }
    }
  });

  it("rejects copied protected event IDs and client ingest times before single or batch mutation", async () => {
    for (const batch of [false, true]) {
      const state = createInitialState();
      const protectedEvent = event();
      protectedEvent.classification.level = "RESTRICTED";
      protectedEvent.ingestTimestamp = "2026-10-07T11:59:00Z";
      const protectedObject = withEventProvenance(createCopObjectFromEvent(protectedEvent), protectedEvent);
      state.events.set(protectedEvent.eventId, protectedEvent);
      state.objects.set(protectedObject.objectId, protectedObject);
      appendTrackHistory(state, protectedEvent, protectedObject);
      const copy = structuredClone(protectedEvent);
      copy.classification.level = "UNCLASSIFIED";
      const app = buildServer({ state, now: () => fixedNow });
      try {
        const response = await app.inject({ method: "POST", url: batch ? "/api/v1/ingest/batches" : "/api/v1/ingest/events", headers,
          payload: batch ? { batchId: randomUUID(), contractVersion: "cop-ingest-v1", sourceSystemId: sourceId, events: [event(), copy] } : copy
        });
        expect(response.statusCode).toBe(409);
        expect(response.json().error.code).toBe("EVENT_ID_CONFLICT");
        expect(state.events.size).toBe(1);
        expect(state.events.get(copy.eventId)?.classification.level).toBe("RESTRICTED");
        expect(state.objects.get(copy.payload.objectId)).toEqual(protectedObject);
        expect(state.trackHistory.get(copy.payload.objectId)).toHaveLength(1);
        const history = await app.inject({ url: "/api/v1/cop/track-history", headers });
        expect(history.json().items).toEqual([]);
      } finally { await app.close(); }
    }
  });

  it("rejects differing event-ID claims within a batch atomically", async () => {
    const state = createInitialState();
    const input = event();
    const conflicting = structuredClone(input);
    conflicting.geo.lat = 51;
    const app = buildServer({ state, now: () => fixedNow });
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/ingest/batches", headers,
        payload: { batchId: randomUUID(), contractVersion: "cop-ingest-v1", sourceSystemId: sourceId, events: [input, conflicting] }
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("EVENT_ID_CONFLICT");
      expect(state.events.size).toBe(0);
      expect(state.objects.size).toBe(0);
      expect(state.trackHistory.size).toBe(0);
    } finally { await app.close(); }
  });

  it("preserves an identical retry's original server clock without duplicate history or publication", async () => {
    const state = createInitialState();
    let serverNow = fixedNow;
    const app = buildServer({ state, now: () => serverNow });
    try {
      const input = event();
      input.ingestTimestamp = "2026-10-07T11:55:00Z";
      const first = await app.inject({ method: "POST", url: "/api/v1/ingest/events", headers, payload: input });
      expect(first.statusCode).toBe(202);
      serverNow = new Date("2026-10-07T12:00:05Z");
      const copy = { ...input, ingestTimestamp: "2026-10-07T11:56:00Z" };
      const retry = await app.inject({ method: "POST", url: "/api/v1/ingest/events",
        headers: { ...headers, "x-idempotency-key": "same-event-new-delivery" }, payload: copy });
      expect(retry.statusCode).toBe(202);
      expect(retry.json().receivedAt).toBe(fixedNow.toISOString());
      const sameKey = await app.inject({ method: "POST", url: "/api/v1/ingest/events", headers, payload: copy });
      expect(sameKey.json()).toEqual(first.json());
      const batch = await app.inject({ method: "POST", url: "/api/v1/ingest/batches", headers,
        payload: { batchId: randomUUID(), contractVersion: "cop-ingest-v1", sourceSystemId: sourceId, events: [copy, copy] } });
      expect(batch.statusCode).toBe(202);
      expect(batch.json().acceptedCount).toBe(2);
      expect(state.events.get(input.eventId)?.ingestTimestamp).toBe(fixedNow.toISOString());
      expect(state.trackHistory.get(input.payload.objectId)).toHaveLength(1);
    } finally { await app.close(); }
  });

  it("does not expose a retained PostgreSQL-style protected point after restart using a copied frame and client clock", async () => {
    const protectedEvent = event();
    protectedEvent.classification.level = "RESTRICTED";
    protectedEvent.ingestTimestamp = "2026-10-07T11:59:00Z";
    const protectedObject = createCopObjectFromEvent(protectedEvent);
    const stored = appendTrackHistory(createInitialState(), protectedEvent, protectedObject)!;
    const appended: TrackHistoryPoint[] = [];
    const store: TrackHistoryStore = {
      name: "postgres-event-id-conflict-fixture", init: async () => {}, close: async () => {},
      loadCurrent: async () => [], upsertCurrent: async () => {}, count: async () => 1, countCurrent: async () => 1,
      append: async (point) => { appended.push(point); /* PostgreSQL retains the old row on event-ID conflict. */ },
      query: async () => [{ objectId: stored.objectId, points: [stored] }]
    };
    const state = createInitialState();
    const app = buildServer({ state, now: () => fixedNow, trackHistoryStore: store });
    try {
      const copied = structuredClone(protectedEvent);
      copied.classification.level = "UNCLASSIFIED";
      expect((await app.inject({ method: "POST", url: "/api/v1/ingest/events", headers, payload: copied })).statusCode).toBe(202);
      const history = await app.inject({ url: "/api/v1/cop/track-history", headers });
      expect(history.statusCode).toBe(200);
      expect(history.json().items).toEqual([]);
      expect(appended).toHaveLength(1);
      expect(appended[0]?.ingestTimestamp).toBe(fixedNow.toISOString());
      expect(stored.ingestTimestamp).toBe("2026-10-07T11:59:00Z");
      const current = await app.inject({ url: "/api/v1/cop/tracks", headers });
      expect(current.json().items).toHaveLength(1);
    } finally { await app.close(); }
  });

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
