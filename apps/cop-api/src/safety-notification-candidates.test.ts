import { afterEach, describe, expect, it, vi } from "vitest";
import type { AoiRule } from "./alerts.js";
import { buildSafetyCandidateNotificationDecision } from "./notification-decision.js";
import { SafetyDataSourceAdapter, type SafetyGeometry } from "./safety-data-source.js";
import {
  evaluateSafetyNotificationCandidate,
  normalizeSafetyNotificationCandidateCollection,
  safetyCandidateIncidentIdentity,
  safetyCandidateRecipientIdempotency,
  safetyGeometryIntersectsAoi,
  type SafetyNotificationCandidate,
  type SafetyNotificationCandidateQuery
} from "./safety-notification-candidates.js";

const now = new Date("2026-10-10T12:00:00Z");
const query: SafetyNotificationCandidateQuery = {
  bbox: { west: 13, east: 15, south: 49, north: 51 }, layers: ["warnings", "weather_alerts"], limit: 100
};
const circle: AoiRule = { id: "home", name: "Home", enabled: true, lat: 50, lon: 14, radiusKm: 1 };

describe("typed SIM safety notification boundary", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("uses the dedicated candidate endpoint with redirects disabled, no user authorization or stale fallback", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(collection()), { status: 200 }))
      .mockResolvedValueOnce(new Response("offline", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = source();
    expect((await adapter.fetchNotificationCandidates(query, now)).completeness).toBe("complete");
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "https://sim.example/safety-data/api/v1/notifications/candidates?bbox=13%2C49%2C15%2C51&layers=warnings%2Cweather_alerts&limit=100&minSeverity=warning&includeStale=false"
    );
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: "error", headers: { Accept: "application/json" } });
    expect(fetchMock.mock.calls[0]![1].headers).not.toHaveProperty("Authorization");
    await expect(adapter.fetchNotificationCandidates(query, now)).rejects.toThrow("unavailable (503)");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed on body limits, malformed contract, stale collection and missing eligibility attestation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { headers: { "content-length": String(9 * 1024 * 1024) } })));
    await expect(source().fetchNotificationCandidates(query, now)).rejects.toThrow("body limit");
    expect(() => normalizeSafetyNotificationCandidateCollection({ ...collection(), contractVersion: "cop-safety-source-v1" }, query, now)).toThrow("contract");
    expect(() => normalizeSafetyNotificationCandidateCollection({ ...collection(), generatedAt: "2026-10-10T11:50:00Z" }, query, now)).toThrow("fresh");
    expect(() => normalizeSafetyNotificationCandidateCollection({ ...collection(), policy: { ...collection().policy, eligibilityPolicy: undefined } }, query, now)).toThrow("contract");
  });

  it("enforces the streamed body bound even without content-length", async () => {
    const cancelled = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); },
      cancel: cancelled
    }))));
    await expect(source().fetchNotificationCandidates(query, now)).rejects.toThrow("body limit");
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("keeps the timeout active while reading the response body", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(new ReadableStream({
      start(controller) { init?.signal?.addEventListener("abort", () => controller.error(new Error("body aborted")), { once: true }); }
    }))));
    const adapter = new SafetyDataSourceAdapter({ ...source().config, timeoutMs: 25 });
    await expect(adapter.fetchNotificationCandidates(query, now)).rejects.toThrow("body aborted");
  });

  it("detects saturation without inventing a paging cursor or claiming complete results", () => {
    expect(normalizeSafetyNotificationCandidateCollection({ ...collection(), summary: { featureCount: 100, candidateCount: 1 } }, query, now)
      .completeness).toBe("possibly_truncated");
    expect(normalizeSafetyNotificationCandidateCollection(collection(), query, now).completeness).toBe("complete");
  });

  it("does not confuse unavailable or incomplete input with a known healthy empty result", () => {
    const unavailable = normalizeSafetyNotificationCandidateCollection({
      ...collection(), candidates: [], summary: { featureCount: 0, candidateCount: 0 },
      inputReadiness: { status: "unavailable", snapshotGeneratedAt: null, snapshotAgeSeconds: null, reasons: ["upstream_unavailable"] }
    }, query, now);
    expect(unavailable.inputReadiness.status).toBe("unavailable");
    const incomplete = normalizeSafetyNotificationCandidateCollection({
      ...collection(), candidates: [], summary: { featureCount: 0, candidateCount: 0 },
      inputReadiness: { status: "incomplete", snapshotGeneratedAt: now.toISOString(), snapshotAgeSeconds: 0, reasons: ["query_limit"] }
    }, query, now);
    expect(incomplete.completeness).toBe("possibly_truncated");
    expect(() => normalizeSafetyNotificationCandidateCollection({ ...collection(), inputReadiness: { ...collection().inputReadiness, status: "unavailable", reasons: ["offline"] } }, query, now))
      .toThrow("non-ready");
    expect(() => normalizeSafetyNotificationCandidateCollection({ ...collection(), inputReadiness: { ...collection().inputReadiness, snapshotGeneratedAt: "2026-10-10T10:00:00Z", snapshotAgeSeconds: 7200 } }, query, now))
      .toThrow("not fresh and ready");
  });

  it("rejects mismatched upstream query and missing candidate geometry", () => {
    expect(() => normalizeSafetyNotificationCandidateCollection({ ...collection(), query: { ...collection().query, bbox: { ...query.bbox, west: 12 } } }, query, now)).toThrow("does not match");
    expect(() => normalizeSafetyNotificationCandidateCollection({ ...collection(), candidates: [{ ...candidate(), feature: { ...candidate().feature, geometry: null } }] }, query, now)).toThrow("malformed");
  });

  it("preserves layer geometry variants until relevance is resolved, then deduplicates per incident and recipient", () => {
    const one = candidate();
    const another = candidate({ layer: "weather_alerts", layerId: "public.safety.weather_alerts", providerLayerId: "safety.weather_alerts" });
    const parsed = normalizeSafetyNotificationCandidateCollection({ ...collection(), candidates: [one, another], summary: { featureCount: 2, candidateCount: 2 } }, query, now);
    expect(parsed.candidates).toHaveLength(2);
    expect(safetyCandidateIncidentIdentity(one)).toBe(safetyCandidateIncidentIdentity(another));
    expect(safetyCandidateRecipientIdempotency(one, "alice")).toBe(safetyCandidateRecipientIdempotency(another, "alice"));
    expect(safetyCandidateRecipientIdempotency(one, "alice")).not.toBe(safetyCandidateRecipientIdempotency(one, "bob"));
    const changed = candidate({ validUntil: "2026-10-11T00:00:00Z" });
    expect(safetyCandidateIncidentIdentity(one)).not.toBe(safetyCandidateIncidentIdentity(changed));
    const sharedSourceLabelA = candidate({ sourceIncident: "CHMI_CAP_FIRE_DANGER" });
    const sharedSourceLabelB = candidate({ sourceIncident: "CHMI_CAP_FIRE_DANGER", featureId: "independent-incident" });
    expect(safetyCandidateIncidentIdentity(sharedSourceLabelA)).not.toBe(safetyCandidateIncidentIdentity(sharedSourceLabelB));
  });

  it.each([
    ["stale", { stale: true }], ["ended", { status: "ended" }], ["expired", { validUntil: "2026-10-10T11:59:00Z" }],
    ["invalid timestamp", { validFrom: "not-a-time" }], ["calendar overflow", { observedAt: "2026-02-30T00:00:00Z" }],
    ["future", { validFrom: "2026-10-10T12:01:00Z" }], ["media", { sourceId: "ct24_news" }],
    ["informational", { informationalOnly: true }], ["provider denied", { notificationEligible: false }],
    ["municipal no expiry", { sourceId: "municipal_alerts", validUntil: undefined }],
    ["centroid", { locationPrecision: "municipality_centroid" }], ["unknown location", { locationPrecision: "unknown" }]
  ])("rejects %s before dispatch", (_label, patch) => {
    expect(evaluateSafetyNotificationCandidate(candidate(patch), now).ok).toBe(false);
  });

  it("blocks explicit provider policy and approximate-source metadata even when top-level eligible is absent", () => {
    expect(evaluateSafetyNotificationCandidate(candidate({ providerProperties: { notification: { eligible: false } } } as Partial<SafetyNotificationCandidate["feature"]>), now).ok).toBe(false);
    expect(evaluateSafetyNotificationCandidate(candidate({ tags: { locationPrecision: "region_centroid" } } as Partial<SafetyNotificationCandidate["feature"]>), now).ok).toBe(false);
    expect(evaluateSafetyNotificationCandidate({ ...candidate(), audit: { ...candidate().audit, basis: ["chmi_cap_representative_point"] } }, now).ok).toBe(false);
  });

  it("applies actor identity, area intersection and recipient severity without broadening delivery", () => {
    const alice = buildSafetyCandidateNotificationDecision(candidate(), { actor: { subjectId: "alice" }, watchedAreas: [circle], now });
    expect(alice.shouldSend).toBe(true);
    expect(alice.notification.audience).toEqual({ userIds: ["alice"] });
    expect(alice.relevance.matchedAoiRuleIds).toEqual(["home"]);
    const bob = buildSafetyCandidateNotificationDecision(candidate(), { actor: { subjectId: "bob" }, watchedAreas: [{ ...circle, lon: 15 }], now });
    expect(bob.shouldSend).toBe(false);
    expect(bob.idempotencyKey).not.toBe(alice.idempotencyKey);
    expect(buildSafetyCandidateNotificationDecision(candidate(), { actor: { subjectId: "alice" }, watchedAreas: [circle], minimumSeverity: "critical", now }).shouldSend).toBe(false);
    expect(buildSafetyCandidateNotificationDecision(candidate(), { actor: { subjectId: "alice" }, watchedAreas: [{ ...circle, severity: "critical" }], now }).shouldSend).toBe(false);
    expect(buildSafetyCandidateNotificationDecision(candidate(), { watchedAreas: [circle], now }).shouldSend).toBe(false);
    expect(buildSafetyCandidateNotificationDecision(candidate(), { actor: { subjectId: "alice" }, audience: { userIds: ["bob"] }, watchedAreas: [circle], now }).shouldSend).toBe(false);
  });
});

describe("actual safety geometry intersection", () => {
  it("finds polygon boundary near the user even when its centroid is far away", () => {
    const large = polygon([[13.995, 49.9], [16, 49.9], [16, 50.1], [13.995, 50.1], [13.995, 49.9]]);
    expect(safetyGeometryIntersectsAoi(large, circle)).toBe(true);
  });

  it("does not turn a polygon hole into a local alert", () => {
    const donut: SafetyGeometry = { type: "Polygon", coordinates: [
      [[13.9, 49.9], [14.1, 49.9], [14.1, 50.1], [13.9, 50.1], [13.9, 49.9]],
      [[13.98, 49.98], [14.02, 49.98], [14.02, 50.02], [13.98, 50.02], [13.98, 49.98]]
    ] };
    expect(safetyGeometryIntersectsAoi(donut, circle)).toBe(false);
    expect(safetyGeometryIntersectsAoi(donut, { ...circle, radiusKm: 3 })).toBe(true);
    expect(safetyGeometryIntersectsAoi(donut, { ...circle, polygon: polygonCoordinates(13.995, 49.995, 14.005, 50.005) })).toBe(false);
  });

  it("rejects disjoint polygons with overlapping bounding boxes and honors holes in watched polygons", () => {
    const triangle = polygon([[13, 49], [15, 49], [13, 51], [13, 49]]);
    expect(safetyGeometryIntersectsAoi(triangle, { ...circle, polygon: polygonCoordinates(14.7, 50.7, 14.9, 50.9) })).toBe(false);
    const watched = { type: "Polygon" as const, coordinates: [
      polygonCoordinates(13.9, 49.9, 14.1, 50.1).coordinates[0]!,
      polygonCoordinates(13.98, 49.98, 14.02, 50.02).coordinates[0]!
    ] };
    expect(safetyGeometryIntersectsAoi({ type: "Point", coordinates: [14, 50] }, { ...circle, polygon: watched })).toBe(false);
    expect(safetyGeometryIntersectsAoi({ type: "Point", coordinates: [14.05, 50] }, { ...circle, polygon: watched })).toBe(true);
  });

  it("evaluates separate MultiPolygon islands without an imaginary central area", () => {
    const multi: SafetyGeometry = { type: "MultiPolygon", coordinates: [
      polygonCoordinates(13, 49.9, 13.1, 50.1).coordinates,
      polygonCoordinates(14.9, 49.9, 15, 50.1).coordinates
    ] };
    expect(safetyGeometryIntersectsAoi(multi, circle)).toBe(false);
    expect(safetyGeometryIntersectsAoi(multi, { ...circle, lon: 13.05 })).toBe(true);
  });

  it("fails closed for malformed or self-intersecting polygons and an invalid AOI polygon", () => {
    expect(safetyGeometryIntersectsAoi(polygon([[14, 50], [14.1, 50.1], [14, 50.1], [14.1, 50], [14, 50]]), circle)).toBe(false);
    expect(safetyGeometryIntersectsAoi({ type: "Point", coordinates: [14, 50] }, { ...circle, polygon: { type: "Polygon", coordinates: [] } })).toBe(false);
    expect(safetyGeometryIntersectsAoi({ type: "Point", coordinates: [Number.NaN, 50] }, circle)).toBe(false);
  });
});

function candidate(patch: Partial<SafetyNotificationCandidate["feature"]> = {}): SafetyNotificationCandidate {
  return {
    candidateId: "sim-warning-test", idempotencyKey: "sim-warning-test", notificationType: "safety.alert", audienceDecisionOwner: "cop", deliveryOwner: "csm-messaging",
    feature: {
      featureId: "official-1", providerId: "sim.safety-data", layerId: "public.safety.warnings", providerLayerId: "safety.warnings", layer: "warnings",
      category: "weather", hazardType: "wind", sourceId: "chmi_alerts", sourceName: "CHMI", severity: "warning", confidence: 1,
      status: "active", stale: false, observedAt: "2026-10-10T11:00:00Z", updatedAt: "2026-10-10T11:00:00Z", validFrom: "2026-10-10T11:00:00Z", validUntil: "2026-10-10T18:00:00Z",
      geometry: { type: "Point", coordinates: [14, 50] }, ...patch
    },
    message: {
      title: { cs: "Silný vítr", en: "Strong wind" }, body: { cs: "Výstraha", en: "Warning" },
      recommendedAction: { cs: "Sledujte oficiální pokyny.", en: "Follow official instructions." }, localeFallback: "cs", suggestedDeepLink: "csm://map/alert/official-1"
    },
    audit: { basis: ["official_warning"], source: "chmi", sourceName: "CHMI" }
  };
}

function collection() {
  return {
    contractVersion: "sim-safety-notification-candidates-v1", generatedAt: now.toISOString(), providerId: "sim.safety-data",
    policy: { audienceDecisionOwner: "cop", deliveryOwner: "csm-messaging", notificationType: "safety.alert", technicalWarningsPolicy: "never_push_to_public_users", eligibilityPolicy: "verified_alert_and_non_fallback_location_required" },
    query: { ...query, minSeverity: "warning", includeStale: false }, candidates: [candidate()], summary: { featureCount: 1, candidateCount: 1 }, warnings: [],
    inputReadiness: { status: "ready", snapshotGeneratedAt: now.toISOString(), snapshotAgeSeconds: 0, reasons: [] }
  };
}

function source() {
  return new SafetyDataSourceAdapter({ baseUrl: "https://sim.example/safety-data/api/v1", cacheTtlMs: 120_000, enabled: true, maxLimit: 600, timeoutMs: 1000 });
}
function polygon(coordinates: Array<[number, number]>): SafetyGeometry { return { type: "Polygon", coordinates: [coordinates] }; }
function polygonCoordinates(west: number, south: number, east: number, north: number) {
  return { type: "Polygon" as const, coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] as Array<Array<[number, number]>> };
}
