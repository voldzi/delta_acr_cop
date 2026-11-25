import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { defaultSystemSubject } from "@cop/policy-engine";
import { createCopObjectFromEvent, type CanonicalEventEnvelope } from "@cop/canonical-model";
import { createInitialState } from "./state.js";
import { createTrackHistoryPoint } from "./temporal-history.js";
import { withEventProvenance } from "./provenance.js";
import { canReadCanonicalHistoryPoint } from "./canonical-read-policy.js";
import { isArchivableFlightEvent, releaseArchivedFlightEvents, sameArchivedFlightEvent, selectFlightArchiveBatch } from "./flight-event-archive.js";
import { buildSourceHealthItems } from "./source-health.js";

import { Pool } from "pg";
import { PostgresTrackHistoryStore } from "./track-history-store.js";
import { buildServer } from "./server.js";
import { FlightDataSourceAdapter, type FlightDataSource, type FlightDataPollResult } from "./flight-data-source.js";

export function flightEvent(objectId = "flight:synthetic-test-aircraft", at = "2026-11-25T12:00:00.000Z"): CanonicalEventEnvelope {
  return {
    eventId: randomUUID(), eventType: "track.updated", contractVersion: "cop-ingest-v1",
    correlationId: randomUUID(), producerTimestamp: "2026-11-25T11:59:59.000Z", ingestTimestamp: at,
    classification: { level: "UNCLASSIFIED", handlingCaveats: ["PUBLIC_FLIGHT_AGGREGATE"], releasability: ["CZ"] },
    source: { adapterId: "flight-data-source-adapter", adapterVersion: "0.1.0", sourceSystemId: "flight-data-api" },
    geo: { lat: 0, lon: 0 },
    payload: { objectId, objectType: "AIRCRAFT", domain: "AIR", affiliation: "NEUTRAL", status: "ACTIVE",
      synthetic: false, attributes: { dataOrigin: "PUBLIC_FLIGHT_AGGREGATE", flightData: { trackId: objectId } } },
    quality: { confidence: 1, sourceReliability: "C", informationCredibility: "3" }
  };
}

describe("public flight archive", () => {
  it("archives only a proven producer record and never the current object's event", () => {
    const state = createInitialState();
    const old = flightEvent(), current = flightEvent(old.payload.objectId, "2026-11-25T12:01:00.000Z"), unproven = flightEvent();
    for (const event of [old, current, unproven]) state.events.set(event.eventId, event);
    state.objects.set(current.payload.objectId, withEventProvenance(createCopObjectFromEvent(current), current));
    const eligible = new WeakSet([old, current]);
    expect(selectFlightArchiveBatch(state, eligible, 0)).toEqual([old]);
    expect(state.events.size).toBe(3);
    expect(releaseArchivedFlightEvents(state, [old, current])).toBe(1);
    expect(state.events.has(old.eventId)).toBe(false);
    expect(state.events.has(current.eventId)).toBe(true);
    expect(state.events.has(unproven.eventId)).toBe(true);
  });

  it("does not evict a concurrently replaced event", () => {
    const state = createInitialState(), old = flightEvent();
    state.events.set(old.eventId, old);
    const replacement = structuredClone(old);
    state.events.set(old.eventId, replacement);
    expect(releaseArchivedFlightEvents(state, [old])).toBe(0);
    expect(state.events.get(old.eventId)).toBe(replacement);
  });

  it("rejects private, restricted, expiring and simulated flight records", () => {
    const event = flightEvent();
    expect(isArchivableFlightEvent(event)).toBe(true);
    expect(isArchivableFlightEvent({ ...event, classification: { ...event.classification, level: "RESTRICTED" } })).toBe(false);
    expect(isArchivableFlightEvent({ ...event, payload: { ...event.payload, synthetic: true } })).toBe(false);
    expect(isArchivableFlightEvent({ ...event, payload: { ...event.payload, releasePolicy: { visibility: "private", allowedScopes: ["authenticated"] } } })).toBe(false);
    expect(isArchivableFlightEvent({ ...event, payload: { ...event.payload, releasePolicy: { visibility: "public", allowedScopes: ["public"], expiresAt: "2026-12-31T00:00:00Z" } } })).toBe(false);
  });

  it("preserves the exact event including dedup identity after JSON storage", () => {
    const event = flightEvent(), loaded = JSON.parse(JSON.stringify(event)) as CanonicalEventEnvelope;
    expect(sameArchivedFlightEvent(event, loaded)).toBe(true);
    expect(sameArchivedFlightEvent(event, { ...loaded, geo: { lat: 1, lon: 0 } })).toBe(false);
    const point = createTrackHistoryPoint(event, createCopObjectFromEvent(event))!;
    // The same read policy is exercised for hot and loaded event evidence.
    const subject = defaultSystemSubject();
    const now = new Date(event.ingestTimestamp!);
    const expected = canReadCanonicalHistoryPoint(subject, point, new Map([[event.eventId, event]]), now);
    expect(expected).toBe(true);
    expect(canReadCanonicalHistoryPoint(subject, point, new Map([[event.eventId, loaded]]), now)).toBe(expected);
    expect(canReadCanonicalHistoryPoint(subject, { ...point, lat: 9 }, new Map([[event.eventId, loaded]]), now)).toBe(false);
  });

  it("keeps source counts and latency after moving an event to the archive", () => {
    const state = createInitialState(), event = flightEvent(), sourceId = event.source.sourceSystemId;
    const source = [...state.sources.values()][0]!;
    state.sources.set(sourceId, { ...source, sourceSystemId: sourceId });
    state.events.set(event.eventId, event);
    const now = new Date(event.ingestTimestamp!);
    const lifecycle = { staleAfterMs: 30000, expireAfterMs: 120000 };
    const before = buildSourceHealthItems(state, now, lifecycle);
    state.events.delete(event.eventId);
    const summary = [{ sourceSystemId: sourceId, count: 1, latencySumMs: 1000, latestEventAt: event.ingestTimestamp!, latestLatencyMs: 1000 }];
    expect(buildSourceHealthItems(state, now, lifecycle, summary)).toEqual(before);
    state.events.set(event.eventId, event);
    expect(buildSourceHealthItems(state, now, lifecycle, summary, new Set([event.eventId]))).toEqual(before);
  });
});


const connectionString = process.env.COP_ERASURE_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/cop_erasure_test")
    throw new Error("Requires isolated loopback cop_erasure_test database");
}

describe.skipIf(!connectionString)("real PostgreSQL flight archive", () => {
  it("commits full evidence and point, deduplicates a retry, and restores history after restart", async () => {
    const admin = new Pool({ connectionString });
    const schema = "flight_archive_" + randomUUID().replaceAll("-", "");
    await admin.query(`CREATE SCHEMA ${schema}`);
    const options = { connectionString, options: `-c search_path=${schema}`, max: 3 };
    const store = new PostgresTrackHistoryStore(options);
    const event = flightEvent();
    try {
      await store.init();
      await store.flightArchive.append([event]);
      await store.flightArchive.append([event]);
      expect(await store.flightArchive.summaries()).toEqual([{
        sourceSystemId: "flight-data-api", count: 1, latencySumMs: 1000,
        latestEventAt: event.ingestTimestamp, latestLatencyMs: 1000
      }]);
      expect(await store.count()).toBe(1);
      const conflict = { ...event, geo: { lat: 1, lon: 0 } };
      await expect(store.flightArchive.append([flightEvent(), conflict])).rejects.toThrow("FLIGHT_ARCHIVE_EVENT_CONFLICT");
      expect(await store.count()).toBe(1);
      const newer = flightEvent(event.payload.objectId, "2026-11-25T12:00:01.000Z");
      await store.flightArchive.append([newer]);
      const reopened = new PostgresTrackHistoryStore(options);
      const state = createInitialState();
      vi.stubEnv("COP_PUBLIC_FLIGHT_ARCHIVE_WRITES_ENABLED", "false");
      const app = buildServer({ state, trackHistoryStore: reopened, now: () => new Date(event.ingestTimestamp!) });
      try {
        const loaded = await reopened.flightArchive.read([event.eventId]);
        expect(loaded.get(event.eventId)).toEqual(event);
        expect((await reopened.flightArchive.read([event.eventId.toUpperCase()])).get(event.eventId.toUpperCase())).toEqual(event);
        expect(state.events.has(event.eventId)).toBe(false);
        const response = await app.inject({ url: "/api/v1/cop/track-history?objectIds="+encodeURIComponent(event.payload.objectId),
          headers: { authorization: "Bearer dev-lab-token" } });
        expect(response.statusCode).toBe(200);
        expect(response.json().items).toEqual([expect.objectContaining({ points: [
          expect.objectContaining({ eventId: event.eventId }), expect.objectContaining({ eventId: newer.eventId })
        ] })]);
        expect(state.events.has(event.eventId)).toBe(false);
        expect(state.events.has(newer.eventId)).toBe(true);
        const collision = { ...event, source: { sourceSystemId: "sim-air-situation-001", adapterId: "synthetic", adapterVersion: "1" },
          payload: { ...event.payload, synthetic: true }, simulation: { synthetic: true } };
        const conflictResponse = await app.inject({ method: "POST", url: "/api/v1/ingest/events",
          headers: { authorization: "Bearer dev-lab-token", "x-source-system-id": "sim-air-situation-001", "x-idempotency-key": "archive-conflict" },
          payload: collision });
        expect(conflictResponse.statusCode).toBe(409);
        expect(conflictResponse.json().error.code).toBe("EVENT_ID_CONFLICT");
      } finally { await app.close(); vi.unstubAllEnvs(); }
    } finally {
      await store.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });

  it("persists a real producer poll, bounds the hot cache, and reads cold points through the HTTP API", async () => {
    const admin = new Pool({ connectionString });
    const schema = "flight_archive_" + randomUUID().replaceAll("-", "");
    await admin.query(`CREATE SCHEMA ${schema}`);
    const store = new PostgresTrackHistoryStore({ connectionString, options: `-c search_path=${schema}` });
    const events = [flightEvent(), flightEvent(undefined, "2026-11-25T12:00:01.000Z"),
      flightEvent(undefined, "2026-11-25T12:00:02.000Z")];
    const config = { enabled: true, baseUrl: "https://synthetic.invalid", timeoutMs: 1000,
      airportCacheTtlMs: 1000, includeStale: false, limit: 10, pollMs: 0 };
    const at = events[2]!.ingestTimestamp!;
    const response: FlightDataPollResult = {
      events, health: { health: "ONLINE", evaluatedAt: at },
      response: { contractVersion: "cop-flight-source-v1", source: { generatedAt: at,
        sourceId: "flight-data-api", sourceType: "PUBLIC_FLIGHT_AGGREGATE" },
        sources: [], summary: {}, tracks: [], warnings: [] }
    };
    const flight: FlightDataSource = { config, sourceSystem: new FlightDataSourceAdapter(config).sourceSystem,
      poll: vi.fn(async () => response) };
    const state = createInitialState();
    const app = buildServer({ state, flightDataSource: flight, trackHistoryStore: store,
      flightArchiveHotLimit: 1, now: () => new Date(at) });
    try {
      await app.ready();
      await vi.waitFor(() => {
        expect(state.events.size).toBe(1);
        expect(state.events.has(events[2]!.eventId)).toBe(true);
      }, { timeout: 5000 });
      expect(await store.count()).toBe(3);
      expect((await store.flightArchive.summaries())[0]?.count).toBe(3);
      const history = await app.inject({ url: "/api/v1/cop/track-history?objectIds="+encodeURIComponent(events[0]!.payload.objectId),
        headers: { authorization: "Bearer dev-lab-token" } });
      expect(history.statusCode).toBe(200);
      expect(history.json().items[0].points.map((point: {eventId: string}) => point.eventId)).toEqual(events.map(event => event.eventId));
      expect(state.events.size).toBe(1);
    } finally {
      await app.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });

  it("retains pending producer records when archive persistence fails and retries before the next poll", async () => {
    const admin = new Pool({ connectionString });
    const schema = "flight_archive_" + randomUUID().replaceAll("-", "");
    await admin.query(`CREATE SCHEMA ${schema}`);
    const store = new PostgresTrackHistoryStore({ connectionString, options: `-c search_path=${schema}` });
    const originalAppend = store.flightArchive.append.bind(store.flightArchive);
    let releaseRetry!: () => void;
    const retryAllowed = new Promise<void>(resolve => { releaseRetry = resolve; });
    let attempts = 0;
    vi.spyOn(store.flightArchive, "append").mockImplementation(async events => {
      attempts++;
      if (attempts === 1) throw new Error("synthetic archive disconnect");
      await retryAllowed;
      await originalAppend(events);
    });
    const events = [flightEvent(), flightEvent(undefined, "2026-11-25T12:00:01.000Z")];
    const at = events[1]!.ingestTimestamp!;
    const config = { enabled: true, baseUrl: "https://synthetic.invalid", timeoutMs: 1000,
      airportCacheTtlMs: 1000, includeStale: false, limit: 10, pollMs: 50 };
    const response: FlightDataPollResult = {
      events, health: { health: "ONLINE", evaluatedAt: at },
      response: { contractVersion: "cop-flight-source-v1", source: { generatedAt: at,
        sourceId: "flight-data-api", sourceType: "PUBLIC_FLIGHT_AGGREGATE" },
        sources: [], summary: {}, tracks: [], warnings: [] }
    };
    const poll = vi.fn(async () => response);
    const flight: FlightDataSource = { config, sourceSystem: new FlightDataSourceAdapter(config).sourceSystem, poll };
    const state = createInitialState();
    const app = buildServer({ state, flightDataSource: flight, trackHistoryStore: store,
      flightArchiveHotLimit: 1, now: () => new Date(at) });
    try {
      await app.ready();
      await vi.waitFor(() => expect(attempts).toBe(2), { timeout: 4000 });
      expect(state.events.size).toBe(2);
      expect(poll).toHaveBeenCalledTimes(1);
      expect(await store.count()).toBe(0);
      releaseRetry();
      await vi.waitFor(() => expect(state.events.size).toBe(1), { timeout: 4000 });
      expect(await store.count()).toBe(2);
      expect((await store.flightArchive.summaries())[0]?.count).toBe(2);
    } finally {
      releaseRetry();
      await app.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });

  it("uses the actual projection fence and keeps ambiguous archived references pending", async () => {
    const admin = new Pool({ connectionString });
    const schema = "flight_archive_" + randomUUID().replaceAll("-", "");
    await admin.query(`CREATE SCHEMA ${schema}`);
    const store = new PostgresTrackHistoryStore({ connectionString, options: `-c search_path=${schema}` });
    const actor = { issuer: "https://synthetic.invalid/realms/cop", subjectId: randomUUID() };
    const event = flightEvent();
    event.payload.attributes = { ...event.payload.attributes, syntheticTestReference: actor.subjectId };
    try {
      await store.init();
      await store.flightArchive.append([event]);
      expect((await store.preflightActorProjections(actor)).ready).toBe(false);
      expect(await store.eraseResourceProjections({ reportIds: [], groupIds: [] }, {
        actor, operationId: randomUUID(), signal: new AbortController().signal
      })).toBe(false);
      expect((await store.flightArchive.read([event.eventId])).get(event.eventId)).toEqual(event);
      await expect(store.flightArchive.append([{ ...event, eventId: randomUUID() }])).rejects.toThrow("CONTENT_PROJECTION_FENCED");
      expect((await store.flightArchive.summaries())[0]?.count).toBe(1);
    } finally {
      await store.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });
});
