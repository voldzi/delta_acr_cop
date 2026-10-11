import { describe, expect, it } from "vitest";
import { createCopObjectFromEvent, type CanonicalEventEnvelope, type ObservedObject } from "@cop/canonical-model";
import { defaultSystemSubject } from "@cop/policy-engine";
import { canReadCanonicalHistoryPoint, canReadCanonicalObject, isPublicCanonicalReleasePolicy } from "./canonical-read-policy.js";
import { readObjectProvenance, withEventProvenance, withStoredCurrentProvenance } from "./provenance.js";
import { createInitialState } from "./state.js";
import { appendTrackHistory } from "./temporal-history.js";
import type { TrackHistoryPoint } from "./types.js";

const now = new Date("2026-10-07T12:00:00Z");
const subject = defaultSystemSubject();

function event(): CanonicalEventEnvelope {
  return {
    eventId: "00000000-0000-4000-8000-000000000001", correlationId: "00000000-0000-4000-8000-000000000002",
    eventType: "track.updated", contractVersion: "cop-ingest-v1", producerTimestamp: now.toISOString(), ingestTimestamp: now.toISOString(),
    source: { sourceSystemId: "synthetic-public-source", adapterId: "synthetic", adapterVersion: "1.0.0" },
    classification: { level: "UNCLASSIFIED", handlingCaveats: [], releasability: ["CZ"] },
    geo: { lat: 50, lon: 14 }, quality: { confidence: 1, sourceReliability: "UNKNOWN", informationCredibility: "UNKNOWN" }, simulation: { synthetic: true },
    payload: { objectId: "synthetic-object", objectType: "AIRCRAFT", affiliation: "FRIEND", domain: "AIR", status: "ACTIVE" }
  };
}

function legacyObject(input = event()): ObservedObject {
  return withStoredCurrentProvenance(createCopObjectFromEvent(input), {
    eventId: input.eventId, lastUpdatedAt: now.toISOString(), sourceSystemId: input.source.sourceSystemId, synthetic: true
  });
}

function historyPoint(input = event()): TrackHistoryPoint {
  return appendTrackHistory(createInitialState(), input, createCopObjectFromEvent(input))!;
}

function verifiedObject(input = event()): ObservedObject {
  return withEventProvenance(createCopObjectFromEvent(input), input);
}

describe("canonical public read classification", () => {
  it("marks a legacy persisted object unknown and excludes it without modifying or deleting it", () => {
    const object = legacyObject();
    expect(readObjectProvenance(object)?.classificationStatus).toBe("unknown");
    expect(canReadCanonicalObject(subject, object, new Map(), now)).toBe(false);
    expect(object.objectId).toBe("synthetic-object");
  });

  it("does not lend an unclassified fallback to an old protected RAM event", () => {
    const input = event();
    input.classification.level = "RESTRICTED";
    expect(canReadCanonicalObject(subject, legacyObject(input), new Map([[input.eventId, input]]), now)).toBe(false);
  });

  it("only permits an exact object/event identity match with verified unclassified provenance", () => {
    const input = event();
    expect(canReadCanonicalObject(subject, legacyObject(input), new Map([[input.eventId, input]]), now)).toBe(true);
    const other = { ...input, payload: { ...input.payload, objectId: "another-object" } };
    expect(canReadCanonicalObject(subject, legacyObject(input), new Map([[input.eventId, other]]), now)).toBe(false);
  });

  it("restores public readability after a fresh verified unclassified update", () => {
    const input = event();
    const fresh = verifiedObject(input);
    expect(readObjectProvenance(fresh)?.classificationStatus).toBe("verified");
    expect(canReadCanonicalObject(subject, fresh, new Map(), now)).toBe(true);
  });

  it("does not let a colliding public event override a stored current/stream object's protected provenance", () => {
    const protectedEvent = event();
    protectedEvent.classification.level = "RESTRICTED";
    const object = verifiedObject(protectedEvent);
    const colliding = { ...protectedEvent, classification: { ...protectedEvent.classification, level: "UNCLASSIFIED" as const } };
    expect(canReadCanonicalObject(subject, object, new Map([[colliding.eventId, colliding]]), now)).toBe(false);
    expect(readObjectProvenance(object)?.classification?.level).toBe("RESTRICTED");
  });

  it("denies legacy current/stream fallback if a reused ID names a different source payload or position", () => {
    const original = event();
    const object = legacyObject(original);
    const moved = { ...original, geo: { lat: 51, lon: 15 } };
    expect(canReadCanonicalObject(subject, object, new Map([[moved.eventId, moved]]), now)).toBe(false);
    const edited = { ...original, payload: { ...original.payload, attributes: { detail: "Different source payload" } } };
    expect(canReadCanonicalObject(subject, object, new Map([[edited.eventId, edited]]), now)).toBe(false);
    expect(canReadCanonicalObject(subject, object, new Map([[original.eventId, original]]), now)).toBe(true);
  });

  it("preserves fresh public current objects and their server-derived stale status", () => {
    const input = event();
    const object = verifiedObject(input);
    const events = new Map([[input.eventId, input]]);
    expect(canReadCanonicalObject(subject, object, events, now)).toBe(true);
    expect(canReadCanonicalObject(subject, { ...object, status: "STALE" }, events, now)).toBe(true);
  });

  it("allows an actual new public update without relabelling its protected predecessor", () => {
    const protectedEvent = event();
    protectedEvent.classification.level = "RESTRICTED";
    const publicEvent = event();
    publicEvent.eventId = "00000000-0000-4000-8000-000000000003";
    publicEvent.geo = { lat: 51, lon: 15 };
    const events = new Map([[protectedEvent.eventId, protectedEvent], [publicEvent.eventId, publicEvent]]);
    expect(canReadCanonicalObject(subject, verifiedObject(protectedEvent), events, now)).toBe(false);
    expect(canReadCanonicalObject(subject, verifiedObject(publicEvent), events, now)).toBe(true);
    expect(canReadCanonicalHistoryPoint(subject, historyPoint(protectedEvent), events, now)).toBe(false);
    expect(canReadCanonicalHistoryPoint(subject, historyPoint(publicEvent), events, now)).toBe(true);
  });

  it("withholds a durable protected point after restart when a public event reuses its event/object IDs", () => {
    const protectedEvent = event();
    protectedEvent.classification.level = "RESTRICTED";
    const storedPoint = JSON.parse(JSON.stringify(historyPoint(protectedEvent))) as TrackHistoryPoint;
    const fresh = event();
    fresh.geo = { lat: 51, lon: 15 };
    fresh.producerTimestamp = "2026-10-07T12:00:01Z";
    fresh.ingestTimestamp = "2026-10-07T12:00:02Z";
    const restartedEvents = new Map([[fresh.eventId, fresh]]);
    expect(canReadCanonicalHistoryPoint(subject, storedPoint, restartedEvents, now)).toBe(false);
    expect(canReadCanonicalHistoryPoint(subject, historyPoint(fresh), restartedEvents, now)).toBe(true);
    expect(storedPoint.lat).toBe(50);
  });

  it.each([
    { field: "source", change: (point: TrackHistoryPoint) => { point.sourceSystemId = "another-source"; } },
    { field: "producer time", change: (point: TrackHistoryPoint) => { point.producerTimestamp = "2026-10-07T11:59:59Z"; } },
    { field: "ingest time", change: (point: TrackHistoryPoint) => { point.ingestTimestamp = "2026-10-07T11:59:59Z"; } },
    { field: "observed time", change: (point: TrackHistoryPoint) => { point.timestamp = "2026-10-07T11:59:59Z"; } },
    { field: "latitude", change: (point: TrackHistoryPoint) => { point.lat = 51; } },
    { field: "longitude", change: (point: TrackHistoryPoint) => { point.lon = 15; } },
    { field: "object type", change: (point: TrackHistoryPoint) => { point.objectType = "UAV"; } },
    { field: "affiliation", change: (point: TrackHistoryPoint) => { point.affiliation = "HOSTILE"; } },
    { field: "status", change: (point: TrackHistoryPoint) => { point.status = "LOST"; } },
    { field: "synthetic flag", change: (point: TrackHistoryPoint) => { point.synthetic = false; } },
    { field: "confidence", change: (point: TrackHistoryPoint) => { point.confidence = 0.5; } }
  ])("denies a history point whose $field differs from the trusted event despite matching IDs", ({ change }) => {
    const input = event();
    const point = historyPoint(input);
    change(point);
    expect(canReadCanonicalHistoryPoint(subject, point, new Map([[input.eventId, input]]), now)).toBe(false);
  });

  it("matches PostgreSQL-normalized timestamp strings by instant and rejects missing trusted ingest time", () => {
    const input = event();
    input.producerTimestamp = "2026-10-07T14:00:00+02:00";
    const point = historyPoint(input);
    point.producerTimestamp = now.toISOString();
    expect(canReadCanonicalHistoryPoint(subject, point, new Map([[input.eventId, input]]), now)).toBe(true);
    delete input.ingestTimestamp;
    expect(canReadCanonicalHistoryPoint(subject, point, new Map([[input.eventId, input]]), now)).toBe(false);
  });

  it("filters unknown, protected and mismatched history independently of the current object's label", () => {
    const input = event();
    const point = historyPoint(input);
    expect(canReadCanonicalHistoryPoint(subject, point, new Map(), now)).toBe(false);
    expect(canReadCanonicalHistoryPoint(subject, point, new Map([[input.eventId, input]]), now)).toBe(true);
    input.classification.level = "SECRET";
    expect(canReadCanonicalHistoryPoint(subject, point, new Map([[input.eventId, input]]), now)).toBe(false);
    input.classification.level = "UNCLASSIFIED";
    input.payload.objectId = "another-object";
    expect(canReadCanonicalHistoryPoint(subject, point, new Map([[input.eventId, input]]), now)).toBe(false);
  });
});

describe("explicit canonical release policy", () => {
  it("keeps an omitted policy compatible and accepts the contract's explicit public scope", () => {
    expect(isPublicCanonicalReleasePolicy(undefined, now)).toBe(true);
    expect(isPublicCanonicalReleasePolicy({ visibility: "public", allowedScopes: ["public"] }, now)).toBe(true);
  });

  it.each([
    { visibility: "private", allowedScopes: ["public"] },
    { visibility: "group", allowedScopes: ["group"] },
    { visibility: "public", allowedScopes: ["authenticated"] },
    { visibility: "public", allowedScopes: ["public"], userIds: ["private-user"] },
    { visibility: "public", allowedScopes: ["public"], groupIds: ["private-group"] },
    { visibility: "public", allowedScopes: ["public"], eventIds: ["private-event"] },
    { visibility: "public", allowedScopes: ["public"], mediaAccess: "private" },
    { visibility: "public", allowedScopes: ["public"], expiresAt: "2026-10-07T11:59:59Z" },
    { visibility: "public", allowedScopes: ["public"], expiresAt: "invalid-date" }
  ])("excludes a restricted or expired policy from both current and historical readers: %j", (policy) => {
    const input = event();
    input.payload.releasePolicy = policy as NonNullable<ObservedObject["releasePolicy"]>;
    const object = verifiedObject(input);
    const events = new Map([[input.eventId, input]]);
    expect(isPublicCanonicalReleasePolicy(policy, now)).toBe(false);
    expect(canReadCanonicalObject(subject, object, events, now)).toBe(false);
    expect(canReadCanonicalHistoryPoint(subject, historyPoint(input), events, now)).toBe(false);
  });
});
