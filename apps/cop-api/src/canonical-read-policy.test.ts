import { describe, expect, it } from "vitest";
import type { CanonicalEventEnvelope, ObservedObject } from "@cop/canonical-model";
import { defaultSystemSubject } from "@cop/policy-engine";
import { canReadCanonicalHistoryPoint, canReadCanonicalObject, isPublicCanonicalReleasePolicy } from "./canonical-read-policy.js";
import { readObjectProvenance, withEventProvenance, withStoredCurrentProvenance } from "./provenance.js";
import type { TrackHistoryPoint } from "./types.js";

const now = new Date("2026-10-07T12:00:00Z");
const subject = defaultSystemSubject();

function event(): CanonicalEventEnvelope {
  return {
    eventId: "00000000-0000-4000-8000-000000000001", correlationId: "00000000-0000-4000-8000-000000000002",
    eventType: "track.updated", contractVersion: "cop-ingest-v1", producerTimestamp: now.toISOString(),
    source: { sourceSystemId: "synthetic-public-source", adapterId: "synthetic", adapterVersion: "1.0.0" },
    classification: { level: "UNCLASSIFIED", handlingCaveats: [], releasability: ["CZ"] },
    geo: { lat: 50, lon: 14 }, quality: { confidence: 1 },
    payload: { objectId: "synthetic-object", objectType: "AIRCRAFT", affiliation: "FRIEND", domain: "AIR", status: "ACTIVE" }
  };
}

function legacyObject(input = event()): ObservedObject {
  return withStoredCurrentProvenance(input.payload, {
    eventId: input.eventId, lastUpdatedAt: now.toISOString(), sourceSystemId: input.source.sourceSystemId, synthetic: true
  });
}

function historyPoint(input = event()): TrackHistoryPoint {
  return {
    affiliation: "FRIEND", eventId: input.eventId, lat: 50, lon: 14, objectId: input.payload.objectId,
    objectType: "AIRCRAFT", producerTimestamp: now.toISOString(), sourceSystemId: input.source.sourceSystemId,
    status: "ACTIVE", synthetic: true, timestamp: now.toISOString()
  };
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
    const fresh = withEventProvenance(input.payload, input);
    expect(readObjectProvenance(fresh)?.classificationStatus).toBe("verified");
    expect(canReadCanonicalObject(subject, fresh, new Map(), now)).toBe(true);
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
    const object = withEventProvenance(input.payload, input);
    const events = new Map([[input.eventId, input]]);
    expect(isPublicCanonicalReleasePolicy(policy, now)).toBe(false);
    expect(canReadCanonicalObject(subject, object, events, now)).toBe(false);
    expect(canReadCanonicalHistoryPoint(subject, historyPoint(input), events, now)).toBe(false);
  });
});
