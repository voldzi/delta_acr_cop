import { createCopObjectFromEvent, type CanonicalEventEnvelope, type ObservedObject } from "@cop/canonical-model";
import { evaluateReadPolicy, type PolicySubject } from "@cop/policy-engine";
import { isDeepStrictEqual } from "node:util";
import { readObjectProvenance } from "./provenance.js";
import type { TrackHistoryPoint } from "./types.js";

const sourceOwnedTerminalStatuses = new Set(["INACTIVE", "LOST", "CONFLICTED"]);

/** Only the explicitly public canonical feed is exposed by shared COP readers. */
export function isPublicCanonicalReleasePolicy(policy: unknown, now: Date): boolean {
  if (policy === undefined) return true;
  if (!record(policy) || policy.visibility !== "public" || !Array.isArray(policy.allowedScopes)
      || !policy.allowedScopes.includes("public")) return false;
  for (const field of ["userIds", "groupIds", "eventIds"]) {
    if (policy[field] !== undefined && (!Array.isArray(policy[field]) || policy[field].length > 0)) return false;
  }
  if (policy.mediaAccess !== undefined && policy.mediaAccess !== "public") return false;
  if (policy.expiresAt !== undefined && policy.expiresAt !== null) {
    if (typeof policy.expiresAt !== "string") return false;
    const expiresAt = Date.parse(policy.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return false;
  }
  return true;
}

export function canReadCanonicalObject(
  subject: PolicySubject,
  object: ObservedObject,
  events: ReadonlyMap<string, CanonicalEventEnvelope>,
  now: Date
): boolean {
  const provenance = readObjectProvenance(object);
  const eventId = provenance?.eventId ?? object.provenanceIds?.[0];
  const event = eventId ? events.get(eventId) : undefined;
  // An event-ID collision must not override a stored object's own protected label.
  if (provenance?.classification !== undefined && !readableClassification(subject, provenance.classification, object.synthetic)) return false;
  if (event) {
    if (!matchesCanonicalObjectFrame(object, event)
        || !readableClassification(subject, event.classification, object.synthetic)) return false;
    // Legacy fallback has no independent label: bind its entire source payload,
    // not just an event/object ID that a producer can reuse after a restart.
    if (!provenance?.classification && !sameLegacyCanonicalPayload(object, event)) return false;
  } else if (!provenance?.classification) return false;
  if (!isPublicCanonicalReleasePolicy(object.releasePolicy, now)
      || (event && !isPublicCanonicalReleasePolicy(event.payload.releasePolicy, now))) return false;
  return true;
}

export function canReadCanonicalHistoryPoint(
  subject: PolicySubject,
  point: TrackHistoryPoint,
  events: ReadonlyMap<string, CanonicalEventEnvelope>,
  now: Date
): boolean {
  const event = events.get(point.eventId);
  if (!event || !event.ingestTimestamp || !isPublicCanonicalReleasePolicy(event.payload.releasePolicy, now)) return false;
  const object = createCopObjectFromEvent(event);
  if (point.objectId !== object.objectId || point.sourceSystemId !== event.source.sourceSystemId
      || !sameInstant(point.producerTimestamp, event.producerTimestamp)
      || !sameOptionalInstant(point.ingestTimestamp, event.ingestTimestamp)
      || !sameInstant(point.timestamp, object.lastUpdatedAt)
      || point.lat !== object.position?.lat || point.lon !== object.position?.lon
      || point.objectType !== object.objectType || point.affiliation !== object.affiliation
      || point.status !== object.status || point.synthetic !== object.synthetic
      || point.confidence !== object.confidence) return false;
  return readableClassification(subject, event.classification, point.synthetic);
}

function readableClassification(subject: PolicySubject, classification: unknown, synthetic: boolean | undefined): boolean {
  return record(classification) && typeof classification.level === "string"
    && evaluateReadPolicy(subject, { classification: classification.level, synthetic }).allowed;
}

function matchesCanonicalObjectFrame(object: ObservedObject, event: CanonicalEventEnvelope): boolean {
  if (!event.ingestTimestamp) return false;
  const expected = createCopObjectFromEvent(event);
  const provenance = readObjectProvenance(object);
  const statusMatches = object.status === expected.status
    || (object.status === "STALE" && !sourceOwnedTerminalStatuses.has(expected.status));
  return object.objectId === expected.objectId && object.objectType === expected.objectType
    && object.affiliation === expected.affiliation && object.domain === expected.domain && statusMatches
    && provenance?.sourceSystemId === event.source.sourceSystemId
    && (provenance.producerTimestamp === undefined || sameInstant(provenance.producerTimestamp, event.producerTimestamp))
    && sameInstant(object.lastUpdatedAt, expected.lastUpdatedAt)
    && sameInstant(provenance.ingestTimestamp, event.ingestTimestamp)
    && isDeepStrictEqual(object.position, expected.position)
    && object.synthetic === expected.synthetic && object.confidence === expected.confidence;
}

function sameLegacyCanonicalPayload(object: ObservedObject, event: CanonicalEventEnvelope): boolean {
  const expected = createCopObjectFromEvent(event);
  return isDeepStrictEqual(sourcePayload(object, expected.status), sourcePayload(expected, expected.status));
}

function sourcePayload(object: ObservedObject, sourceStatus: ObservedObject["status"]): unknown {
  const { provenanceIds: _provenanceIds, attributes, ...fields } = object;
  const sourceAttributes = { ...attributes };
  delete sourceAttributes.provenance;
  // Persistence drops undefined JSON properties; normalize that representation.
  return JSON.parse(JSON.stringify({ ...fields, status: sourceStatus,
    ...(Object.keys(sourceAttributes).length > 0 ? { attributes: sourceAttributes } : {}) }));
}

function sameInstant(left: string | undefined, right: string | undefined): boolean {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftMs = Date.parse(left);
  return Number.isFinite(leftMs) && leftMs === Date.parse(right);
}

function sameOptionalInstant(left: string | undefined, right: string | undefined): boolean {
  return left === undefined && right === undefined || sameInstant(left, right);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
