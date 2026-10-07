import type { CanonicalEventEnvelope, ObservedObject } from "@cop/canonical-model";
import { evaluateReadPolicy, type PolicySubject } from "@cop/policy-engine";
import { readObjectProvenance } from "./provenance.js";
import type { TrackHistoryPoint } from "./types.js";

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
  // A provenance reference to another object must never lend it a public label.
  if (event && event.payload.objectId !== object.objectId) return false;
  const classification = event?.classification ?? provenance?.classification;
  if (!record(classification) || typeof classification.level !== "string") return false;
  if (!isPublicCanonicalReleasePolicy(object.releasePolicy, now)
      || (event && !isPublicCanonicalReleasePolicy(event.payload.releasePolicy, now))) return false;
  return evaluateReadPolicy(subject, { classification: classification.level, synthetic: object.synthetic }).allowed;
}

export function canReadCanonicalHistoryPoint(
  subject: PolicySubject,
  point: TrackHistoryPoint,
  events: ReadonlyMap<string, CanonicalEventEnvelope>,
  now: Date
): boolean {
  const event = events.get(point.eventId);
  if (!event || event.payload.objectId !== point.objectId || !isPublicCanonicalReleasePolicy(event.payload.releasePolicy, now)) return false;
  return evaluateReadPolicy(subject, { classification: event.classification.level, synthetic: point.synthetic }).allowed;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
