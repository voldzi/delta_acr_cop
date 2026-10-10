import { createHash } from "node:crypto";
import type { AoiRule } from "./alerts.js";
import type { SafetyFeatureQuery, SafetyGeometry, SafetySeverity } from "./safety-data-source.js";

export interface SafetyNotificationCandidateQuery extends SafetyFeatureQuery {
  minSeverity?: SafetySeverity;
}

/** SIM is responsible for provenance; COP still validates shape, time and location. */
export interface SafetyNotificationCandidate {
  candidateId: string;
  idempotencyKey: string;
  notificationType: "safety.alert";
  audienceDecisionOwner: "cop";
  deliveryOwner: "csm-messaging";
  feature: {
    featureId: string;
    providerId: "sim.safety-data";
    layerId: string;
    providerLayerId: string;
    layer: "fire" | "flood" | "warnings" | "weather_alerts";
    category: string;
    hazardType: string;
    sourceId: string;
    sourceName: string;
    sourceIncident?: string;
    /** Only an explicit canonical incident identifier; sourceIncident is often a source label. */
    incidentId?: string;
    stationId?: string;
    floodStage?: number | string;
    sourceSystem?: string;
    sourceCode?: string;
    typeCode?: string;
    severity: SafetySeverity;
    urgency?: string;
    certainty?: string;
    confidence: number;
    status: string;
    stale: boolean;
    observedAt: string;
    validFrom: string;
    validUntil?: string;
    updatedAt: string;
    geometry: SafetyGeometry;
    geometrySummary?: Record<string, unknown>;
    informationalOnly?: boolean;
    notificationEligible?: boolean;
    locationPrecision?: string;
    geometryMode?: string;
  };
  message: {
    title: { cs: string; en: string };
    body: { cs: string; en: string };
    recommendedAction: { cs: string; en: string };
    localeFallback: "cs";
    suggestedDeepLink: string;
  };
  audit: {
    basis: string[];
    source: string;
    sourceName: string;
  };
  eligibility?: {
    eligible: boolean;
    informationalOnly?: boolean;
    locationPrecision?: string;
    validityBasis?: string;
  };
}

export interface SafetyNotificationCandidateCollection {
  contractVersion: "sim-safety-notification-candidates-v1";
  generatedAt: string;
  providerId: "sim.safety-data";
  query: SafetyNotificationCandidateQuery & { includeStale: false; minSeverity: SafetySeverity };
  candidates: SafetyNotificationCandidate[];
  inputReadiness: {
    status: "ready" | "unavailable" | "incomplete";
    snapshotGeneratedAt: string | null;
    snapshotAgeSeconds: number | null;
    reasons: string[];
  };
  /** SIM v1 has no cursor. Saturated feature queries must not be treated as a complete population. */
  completeness: "complete" | "possibly_truncated";
  warnings: string[];
}

const severityRanks: Record<SafetySeverity, number> = { info: 0, advisory: 1, warning: 2, critical: 3 };
const knownNotificationSources = new Set([
  "chmi_alerts", "chmi_hydro", "fire_hotspots", "fire_incidents", "gdacs_alerts", "hzs_incidents", "municipal_alerts", "nasa_firms", "road_srti_lod"
]);
const approximatePrecisions = new Set([
  "authority_fallback_point", "region_centroid", "municipality_centroid", "admin_boundary_centroid",
  "representative_point", "unresolved", "unknown"
]);
const futureToleranceMs = 60_000;
const maximumCollectionAgeMs = 5 * 60_000;

/** Recheck absolute source times after cache reuse or asynchronous eligibility checks. */
export function safetyNotificationCollectionFreshUntil(collection: SafetyNotificationCandidateCollection, now: Date): number | undefined {
  const generatedAt = timestamp(collection.generatedAt);
  const snapshotAt = timestamp(collection.inputReadiness.snapshotGeneratedAt);
  if (collection.inputReadiness.status !== "ready" || collection.completeness !== "complete"
    || collection.inputReadiness.reasons.length > 0 || !generatedAt || !snapshotAt || !Number.isFinite(now.getTime())
    || collection.inputReadiness.snapshotAgeSeconds === null || !Number.isFinite(collection.inputReadiness.snapshotAgeSeconds)
    || collection.inputReadiness.snapshotAgeSeconds < 0 || collection.inputReadiness.snapshotAgeSeconds > maximumCollectionAgeMs / 1000
    || Date.parse(generatedAt) > now.getTime() + futureToleranceMs || Date.parse(snapshotAt) > now.getTime() + futureToleranceMs) return undefined;
  const freshUntil = Math.min(Date.parse(generatedAt), Date.parse(snapshotAt)) + maximumCollectionAgeMs;
  return freshUntil > now.getTime() ? freshUntil : undefined;
}

export function normalizeSafetyNotificationCandidateCollection(
  value: unknown,
  query: SafetyNotificationCandidateQuery,
  now: Date
): SafetyNotificationCandidateCollection {
  if (!isRecord(value) || value.contractVersion !== "sim-safety-notification-candidates-v1" || value.providerId !== "sim.safety-data"
    || !isRecord(value.policy) || value.policy.audienceDecisionOwner !== "cop" || value.policy.deliveryOwner !== "csm-messaging"
    || value.policy.notificationType !== "safety.alert" || value.policy.technicalWarningsPolicy !== "never_push_to_public_users"
    || value.policy.eligibilityPolicy !== "verified_alert_and_non_fallback_location_required"
    || !isRecord(value.query) || value.query.includeStale !== false || !isRecord(value.summary)
    || !Array.isArray(value.candidates) || value.candidates.length > query.limit
    || !isRecord(value.inputReadiness)
    || !["ready", "unavailable", "incomplete"].includes(String(value.inputReadiness.status))
    || !Array.isArray(value.inputReadiness.reasons) || !value.inputReadiness.reasons.every(nonempty)) {
    throw new Error("SIM notification candidate contract is invalid.");
  }
  const generatedAt = timestamp(value.generatedAt);
  if (!generatedAt || Date.parse(generatedAt) > now.getTime() + futureToleranceMs
    || now.getTime() - Date.parse(generatedAt) > maximumCollectionAgeMs) {
    throw new Error("SIM notification candidate collection is not fresh.");
  }
  if (!Number.isInteger(value.summary.featureCount) || Number(value.summary.featureCount) < 0
    || Number(value.summary.featureCount) < value.candidates.length || value.summary.candidateCount !== value.candidates.length) {
    throw new Error("SIM notification candidate summary is invalid.");
  }
  const minSeverity = query.minSeverity ?? "warning";
  const responseQuery = value.query;
  const responseBbox = responseQuery.bbox;
  const responseLayers = responseQuery.layers;
  if (responseQuery.minSeverity !== minSeverity || responseQuery.limit !== query.limit || !isRecord(responseBbox)
    || (Object.keys(query.bbox) as Array<keyof SafetyFeatureQuery["bbox"]>).some((key) => responseBbox[key] !== query.bbox[key])
    || !Array.isArray(responseLayers) || responseLayers.length !== query.layers.length
    || query.layers.some((layer) => !responseLayers.includes(layer))) {
    throw new Error("SIM notification candidate query does not match the request.");
  }
  const readiness = value.inputReadiness;
  const readinessReasons = readiness.reasons as string[];
  const snapshotGeneratedAt = timestamp(readiness.snapshotGeneratedAt);
  const snapshotAgeSeconds = typeof readiness.snapshotAgeSeconds === "number" && Number.isFinite(readiness.snapshotAgeSeconds)
    && readiness.snapshotAgeSeconds >= 0 ? readiness.snapshotAgeSeconds : null;
  if (readiness.status === "ready" && (!snapshotGeneratedAt || snapshotAgeSeconds === null
    || snapshotAgeSeconds > maximumCollectionAgeMs / 1000 || Date.parse(snapshotGeneratedAt) > now.getTime() + futureToleranceMs
    || now.getTime() - Date.parse(snapshotGeneratedAt) > maximumCollectionAgeMs || readinessReasons.length > 0
    || Math.abs(Math.max(0, (now.getTime() - Date.parse(snapshotGeneratedAt)) / 1000) - snapshotAgeSeconds) > 60)) {
    throw new Error("SIM notification input snapshot is not fresh and ready.");
  }
  if (readiness.status !== "ready" && value.candidates.length > 0) {
    throw new Error("SIM non-ready notification input cannot contain dispatch candidates.");
  }
  const candidates: SafetyNotificationCandidate[] = [];
  for (const raw of value.candidates) {
    if (!isSafetyNotificationCandidate(raw)) {
      throw new Error("SIM notification candidate has malformed fields.");
    }
    // Keep expiry/policy failures visible to the decision layer; do not silently promote them.
    // Preserve all geometry variants until recipient relevance has been evaluated.
    // The durable send key deduplicates a relevant incident across rendering layers.
    candidates.push(raw);
  }
  return {
    contractVersion: "sim-safety-notification-candidates-v1",
    generatedAt,
    providerId: "sim.safety-data",
    query: { ...query, includeStale: false, minSeverity },
    candidates,
    inputReadiness: {
      status: readiness.status as SafetyNotificationCandidateCollection["inputReadiness"]["status"],
      snapshotGeneratedAt: snapshotGeneratedAt ?? null, snapshotAgeSeconds, reasons: readinessReasons
    },
    completeness: readiness.status === "incomplete" || Number(value.summary.featureCount) >= query.limit ? "possibly_truncated" : "complete",
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((warning): warning is string => typeof warning === "string").slice(0, 100) : []
  };
}

export function evaluateSafetyNotificationCandidate(
  candidate: SafetyNotificationCandidate,
  now: Date,
  minimumSeverity: SafetySeverity = "warning"
): { ok: boolean; reason: string } {
  if (!isSafetyNotificationCandidate(candidate) || !Number.isFinite(now.getTime())) {
    return { ok: false, reason: "SIM notification candidate is malformed." };
  }
  const feature = candidate.feature;
  const rawFeature = feature as unknown as Record<string, unknown>;
  const providerProperties = isRecord(rawFeature.providerProperties) ? rawFeature.providerProperties : {};
  const notification = isRecord(providerProperties.notification) ? providerProperties.notification : {};
  const tags = isRecord(rawFeature.tags) ? rawFeature.tags : {};
  if (!knownNotificationSources.has(feature.sourceId) || feature.sourceId.toLowerCase().includes("media")
    || feature.category.toLowerCase().includes("news") || candidate.eligibility?.informationalOnly === true
    || feature.informationalOnly === true || providerProperties.informationalOnly === true
    || notification.informationalOnly === true || tags.informationalOnly === "true") {
    return { ok: false, reason: "Informational or unverified source is not eligible for crisis notification." };
  }
  if (candidate.eligibility?.eligible === false || feature.notificationEligible === false || notification.eligible === false) {
    return { ok: false, reason: "Provider explicitly forbids notification." };
  }
  if (feature.stale || !["active", "warning", "critical", "ongoing", "alert", "measured", "monitoring", "risk", "on_scene", "dispatched"].includes(feature.status.toLowerCase())) {
    return { ok: false, reason: "SIM notification candidate is stale or inactive." };
  }
  const validFrom = timestamp(feature.validFrom);
  const validUntil = feature.validUntil === undefined ? undefined : timestamp(feature.validUntil);
  const observedAt = timestamp(feature.observedAt);
  const updatedAt = timestamp(feature.updatedAt);
  if (!validFrom || !observedAt || !updatedAt || (feature.validUntil !== undefined && !validUntil)
    || Date.parse(validFrom) > now.getTime() || Date.parse(observedAt) > now.getTime() + futureToleranceMs
    || Date.parse(updatedAt) > now.getTime() + futureToleranceMs
    || (validUntil && (Date.parse(validUntil) <= now.getTime() || Date.parse(validUntil) <= Date.parse(validFrom)))) {
    return { ok: false, reason: "SIM notification candidate validity is missing, malformed, future or expired." };
  }
  if (feature.sourceId === "municipal_alerts" && !validUntil) {
    return { ok: false, reason: "Municipal notification requires explicit event expiry." };
  }
  if (!isSafetySeverity(minimumSeverity) || severityRanks[feature.severity] < Math.max(severityRanks.warning, severityRanks[minimumSeverity])) {
    return { ok: false, reason: "SIM notification candidate severity is below recipient threshold." };
  }
  const precision = candidate.eligibility?.locationPrecision ?? feature.locationPrecision
    ?? (typeof tags.locationPrecision === "string" ? tags.locationPrecision : undefined);
  if (feature.geometry.type === "Point" && (approximatePrecisions.has(precision ?? "")
    || feature.geometryMode === "representative_point" || tags.geometryMode === "representative_point"
    || candidate.audit.basis.some((basis) => /(?:fallback|centroid|representative_point)/iu.test(basis)))) {
    return { ok: false, reason: "Approximate location cannot establish a local crisis alert." };
  }
  return { ok: true, reason: "SIM verified candidate is eligible for recipient relevance evaluation." };
}

/** Layers and provider rendering identifiers are excluded: one source incident is one alert. */
export function safetyCandidateIncidentIdentity(candidate: SafetyNotificationCandidate): string {
  return createHash("sha256").update(JSON.stringify([
    "sim.safety-data", candidate.feature.sourceId, candidate.feature.incidentId ?? candidate.feature.featureId,
    candidate.feature.validFrom, candidate.feature.validUntil ?? "open"
  ])).digest("hex");
}

export function safetyCandidateRecipientIdempotency(candidate: SafetyNotificationCandidate, subjectId: string): string {
  return `cop.safety:${createHash("sha256").update(JSON.stringify([subjectId, safetyCandidateIncidentIdentity(candidate)])).digest("hex")}`;
}

export function isSafetyNotificationCandidate(value: unknown): value is SafetyNotificationCandidate {
  if (!isRecord(value) || !nonempty(value.candidateId) || !nonempty(value.idempotencyKey)
    || value.notificationType !== "safety.alert" || value.audienceDecisionOwner !== "cop" || value.deliveryOwner !== "csm-messaging"
    || !isRecord(value.feature) || !isRecord(value.message) || !isRecord(value.audit)) {
    return false;
  }
  const feature = value.feature;
  const message = value.message;
  return feature.providerId === "sim.safety-data" && ["warnings", "weather_alerts", "fire", "flood"].includes(String(feature.layer))
    && ["featureId", "layerId", "providerLayerId", "category", "hazardType", "sourceId", "sourceName", "status", "observedAt", "validFrom", "updatedAt"]
      .every((key) => nonempty(feature[key]))
    && (feature.validUntil === undefined || nonempty(feature.validUntil))
    && ["sourceIncident", "incidentId", "stationId"].every((key) => feature[key] === undefined || nonempty(feature[key]))
    && isSafetySeverity(feature.severity) && typeof feature.stale === "boolean"
    && typeof feature.confidence === "number" && Number.isFinite(feature.confidence) && feature.confidence >= 0 && feature.confidence <= 1
    && isValidNotificationGeometry(feature.geometry)
    && ["title", "body", "recommendedAction"].every((key) => isLocalizedText(message[key]))
    && message.localeFallback === "cs" && nonempty(message.suggestedDeepLink)
    && Array.isArray(value.audit.basis) && value.audit.basis.every((basis) => nonempty(basis))
    && nonempty(value.audit.source) && nonempty(value.audit.sourceName)
    && (value.eligibility === undefined || (isRecord(value.eligibility) && typeof value.eligibility.eligible === "boolean"));
}

export function isValidNotificationGeometry(value: unknown): value is SafetyGeometry {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type === "Point") {
    return isCoordinate(value.coordinates);
  }
  if (value.type !== "Polygon" && value.type !== "MultiPolygon") {
    return false;
  }
  const polygons = value.type === "Polygon" ? [value.coordinates] : value.coordinates;
  if (!Array.isArray(polygons) || polygons.length === 0 || polygons.length > 100) {
    return false;
  }
  let coordinateCount = 0;
  return polygons.every((polygon) => {
    if (!Array.isArray(polygon) || polygon.length === 0 || polygon.length > 100) {
      return false;
    }
    const validRings = polygon.every((ring) => {
      if (!Array.isArray(ring) || ring.length < 4 || ring.length > 2048 || !ring.every(isCoordinate)) {
        return false;
      }
      coordinateCount += ring.length;
      const first = ring[0] as [number, number];
      const last = ring[ring.length - 1] as [number, number];
      if (coordinateCount > 12_000 || first[0] !== last[0] || first[1] !== last[1]) {
        return false;
      }
      // Antimeridian geometries need dedicated splitting; fail closed until represented unambiguously.
      if (ring.some((point, index) => index > 0 && Math.abs(point[0] - ring[index - 1]![0]) > 180)) {
        return false;
      }
      return Math.abs(ringSignedArea(ring)) > 1e-12 && !ringSelfIntersects(ring);
    });
    if (!validRings) {
      return false;
    }
    const outer = polygon[0] as Array<[number, number]>;
    const holes = polygon.slice(1) as Array<Array<[number, number]>>;
    return holes.every((hole, index) => pointInRing(hole[0]!, outer) === "inside" && !ringsIntersect(hole, outer)
      && holes.slice(index + 1).every((other) => !ringsIntersect(hole, other)
        && pointInRing(hole[0]!, other) === "outside" && pointInRing(other[0]!, hole) === "outside"));
  });
}

/** Match actual material area, including holes; a bounding box or centroid is never a decision. */
export function safetyGeometryIntersectsAoi(geometry: SafetyGeometry, rule: AoiRule): boolean {
  if (!rule.enabled || !isValidNotificationGeometry(geometry)) {
    return false;
  }
  if (rule.polygon !== undefined) {
    if (!isValidNotificationGeometry(rule.polygon)) {
      return false;
    }
    return geometryIntersectsPolygon(geometry, rule.polygon.coordinates);
  }
  if (!isCoordinate([rule.lon, rule.lat]) || !Number.isFinite(rule.radiusKm) || rule.radiusKm <= 0 || rule.radiusKm > 500) {
    return false;
  }
  return geometryIntersectsCircle(geometry, [rule.lon, rule.lat], rule.radiusKm);
}

export function safetyGeometryIntersectsCircle(geometry: SafetyGeometry, location: { lat: number; lon: number; radiusKm?: number }): boolean {
  return safetyGeometryIntersectsAoi(geometry, {
    id: "current-location", name: "Current location", enabled: true,
    lat: location.lat, lon: location.lon, radiusKm: location.radiusKm ?? 10
  });
}

function geometryIntersectsCircle(geometry: SafetyGeometry, center: [number, number], radiusKm: number): boolean {
  if (geometry.type === "Point") {
    return distanceKm(center, geometry.coordinates) <= radiusKm;
  }
  return polygons(geometry).some((polygon) => pointInPolygon(center, polygon)
    || polygon.some((ring) => ring.slice(1).some((point, index) => segmentDistanceKm(center, ring[index]!, point) <= radiusKm)));
}

function geometryIntersectsPolygon(geometry: SafetyGeometry, polygon: Array<Array<[number, number]>>): boolean {
  if (geometry.type === "Point") {
    return pointInPolygon(geometry.coordinates, polygon);
  }
  return polygons(geometry).some((other) => {
    if (other[0]!.some((point) => pointInPolygon(point, polygon)) || polygon[0]!.some((point) => pointInPolygon(point, other))) {
      return true;
    }
    return other.some((ring) => ring.slice(1).some((point, index) => polygon.some((otherRing) => otherRing.slice(1)
      .some((otherPoint, otherIndex) => segmentsIntersect(ring[index]!, point, otherRing[otherIndex]!, otherPoint)))));
  });
}

function polygons(geometry: Exclude<SafetyGeometry, { type: "Point" }>): Array<Array<Array<[number, number]>>> {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function pointInPolygon(point: [number, number], polygon: Array<Array<[number, number]>>): boolean {
  const outer = pointInRing(point, polygon[0]!);
  if (outer === "outside") {
    return false;
  }
  return !polygon.slice(1).some((hole) => pointInRing(point, hole) === "inside");
}

function pointInRing(point: [number, number], ring: Array<[number, number]>): "boundary" | "inside" | "outside" {
  let inside = false;
  for (let i = 1; i < ring.length; i += 1) {
    const a = ring[i - 1]!;
    const b = ring[i]!;
    if (pointOnSegment(point, a, b)) {
      return "boundary";
    }
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside ? "inside" : "outside";
}

function cross(a: [number, number], b: [number, number], c: [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointOnSegment(point: [number, number], a: [number, number], b: [number, number]): boolean {
  return Math.abs(cross(a, b, point)) <= 1e-10 && point[0] >= Math.min(a[0], b[0]) - 1e-10
    && point[0] <= Math.max(a[0], b[0]) + 1e-10 && point[1] >= Math.min(a[1], b[1]) - 1e-10 && point[1] <= Math.max(a[1], b[1]) + 1e-10;
}

function segmentsIntersect(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  return (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0)
    || pointOnSegment(a, c, d) || pointOnSegment(b, c, d) || pointOnSegment(c, a, b) || pointOnSegment(d, a, b);
}

function ringSignedArea(ring: Array<[number, number]>): number {
  return ring.slice(1).reduce((area, point, index) => area + ring[index]![0] * point[1] - point[0] * ring[index]![1], 0) / 2;
}

function ringSelfIntersects(ring: Array<[number, number]>): boolean {
  for (let i = 1; i < ring.length; i += 1) {
    for (let j = i + 2; j < ring.length; j += 1) {
      if (i === 1 && j === ring.length - 1) { continue; }
      if (segmentsIntersect(ring[i - 1]!, ring[i]!, ring[j - 1]!, ring[j]!)) { return true; }
    }
  }
  return false;
}

function ringsIntersect(a: Array<[number, number]>, b: Array<[number, number]>): boolean {
  return a.slice(1).some((point, index) => b.slice(1).some((other, otherIndex) => segmentsIntersect(a[index]!, point, b[otherIndex]!, other)));
}

function distanceKm(a: [number, number], b: [number, number]): number {
  const deltaLat = radians(b[1] - a[1]);
  const deltaLon = radians(b[0] - a[0]);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(deltaLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function segmentDistanceKm(point: [number, number], a: [number, number], b: [number, number]): number {
  const earthRadiusKm = 6371.0088;
  const length = distanceKm(a, b) / earthRadiusKm;
  if (length < 1e-12) {
    return distanceKm(point, a);
  }
  const angular = distanceKm(a, point) / earthRadiusKm;
  const bearingDelta = bearing(a, point) - bearing(a, b);
  const along = Math.atan2(Math.sin(angular) * Math.cos(bearingDelta), Math.cos(angular));
  if (along < 0 || along > length) {
    return Math.min(distanceKm(point, a), distanceKm(point, b));
  }
  return Math.abs(Math.asin(Math.max(-1, Math.min(1, Math.sin(angular) * Math.sin(bearingDelta))))) * earthRadiusKm;
}

function bearing(a: [number, number], b: [number, number]): number {
  const deltaLon = radians(b[0] - a[0]);
  return Math.atan2(Math.sin(deltaLon) * Math.cos(radians(b[1])), Math.cos(radians(a[1])) * Math.sin(radians(b[1]))
    - Math.sin(radians(a[1])) * Math.cos(radians(b[1])) * Math.cos(deltaLon));
}

function radians(value: number): number { return value * Math.PI / 180; }
function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) { return undefined; }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || Number(value.slice(11, 13)) > 23
    || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) { return undefined; }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}
function nonempty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 8192; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function isCoordinate(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number"
    && Number.isFinite(value[0]) && Number.isFinite(value[1]) && value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;
}
function isLocalizedText(value: unknown): boolean { return isRecord(value) && nonempty(value.cs) && nonempty(value.en); }
function isSafetySeverity(value: unknown): value is SafetySeverity { return typeof value === "string" && Object.hasOwn(severityRanks, value); }
