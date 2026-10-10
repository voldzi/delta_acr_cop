import { describe, expect, it, vi } from "vitest";
import type { AoiRule } from "./alerts.js";
import type { CopNotificationDecision } from "./notification-decision.js";
import type { MessagingNotificationIntakeResponse } from "./messaging-provider.js";
import { InMemorySafetyNotificationStore } from "./safety-notification-store.js";
import { SafetyNotificationWorker, safetyNotificationWorkerConfigFromEnv } from "./safety-notification-worker.js";
import { InMemoryUserProfileStore, type UserAlertPreferences } from "./user-profile-store.js";
import type { SafetyNotificationCandidate, SafetyNotificationCandidateCollection, SafetyNotificationCandidateQuery } from "./safety-notification-candidates.js";

const initialNow = new Date("2026-10-10T12:00:00Z");
const home: AoiRule = { id: "home", name: "Test area", enabled: true, lat: 50, lon: 14, radiusKm: 5 };
const far: AoiRule = { id: "elsewhere", name: "Different test area", enabled: true, lat: 49, lon: 16, radiusKm: 5 };
const config = { ...safetyNotificationWorkerConfigFromEnv({ COP_SAFETY_NOTIFICATION_WORKER_ENABLED: "true" }), cacheTtlMs: 0 };

function candidate(overrides: Partial<SafetyNotificationCandidate["feature"]> = {}): SafetyNotificationCandidate {
  return {
    candidateId: "test-alert", idempotencyKey: "upstream-key", notificationType: "safety.alert", audienceDecisionOwner: "cop", deliveryOwner: "csm-messaging",
    feature: {
      featureId: "official:1", providerId: "sim.safety-data", layerId: "public.safety.warnings", providerLayerId: "safety.warnings",
      layer: "warnings", category: "warning", hazardType: "flood", sourceId: "municipal_alerts", sourceName: "Synthetic authority",
      severity: "warning", confidence: 1, status: "active", stale: false,
      observedAt: "2026-10-10T11:50:00Z", validFrom: "2026-10-10T11:50:00Z", updatedAt: "2026-10-10T11:50:00Z",
      validUntil: "2026-10-10T18:00:00Z", geometry: { type: "Point", coordinates: [14, 50] }, ...overrides
    },
    message: { title: { cs: "Syntetická výstraha", en: "Synthetic warning" }, body: { cs: "Test", en: "Test" },
      recommendedAction: { cs: "Pouze test", en: "Test only" }, localeFallback: "cs", suggestedDeepLink: "csm://map/alert/test" },
    audit: { basis: ["verified_authority", "explicit_location"], source: "municipal_alerts", sourceName: "Synthetic authority" },
    eligibility: { eligible: true, locationPrecision: "explicit_coordinates" }
  };
}

function collection(query: SafetyNotificationCandidateQuery, candidates: SafetyNotificationCandidate[]): SafetyNotificationCandidateCollection {
  return {
    contractVersion: "sim-safety-notification-candidates-v1", generatedAt: initialNow.toISOString(), providerId: "sim.safety-data",
    query: { ...query, includeStale: false, minSeverity: query.minSeverity ?? "warning" }, candidates, completeness: "complete", warnings: [],
    inputReadiness: { status: "ready", snapshotGeneratedAt: initialNow.toISOString(), snapshotAgeSeconds: 0, reasons: [] }
  };
}

function accepted(): MessagingNotificationIntakeResponse {
  return {
    contractVersion: "cop-messaging-notification-v1", enabled: true, providerId: "csm.messaging", status: "online", notificationId: "notification-test", warnings: [],
    deliverySummary: { targetDeviceCount: 1, sentCount: 1, failedCount: 0, dryRunCount: 0, voipFailedCount: 0, voipSentCount: 0 }
  };
}

async function profile(store: InMemoryUserProfileStore, subjectId: string, areas = [home], prefs: Partial<UserAlertPreferences> = {}, enabled = true): Promise<void> {
  await store.upsertProfile({ subjectId, username: subjectId, displayName: "Synthetic tester", preferences: {}, alertPreferences: { aoiRules: areas, ...prefs } });
  await store.setSafetyNotificationsEnabled(subjectId, enabled);
}

function fixture(candidates = [candidate()]) {
  const profileStore = new InMemoryUserProfileStore();
  const notificationStore = new InMemorySafetyNotificationStore();
  let now = initialNow;
  const fetchCandidates = vi.fn(async (query: SafetyNotificationCandidateQuery) => collection(query, candidates));
  const hasEligibleDevice = vi.fn(async () => true);
  const dispatch = vi.fn(async (_decision: CopNotificationDecision, _now: Date) => accepted());
  const deps = { profileStore, notificationStore, fetchCandidates, hasEligibleDevice, dispatch, now: () => now };
  return { ...deps, deps, setNow: (value: Date) => { now = value; }, worker: new SafetyNotificationWorker(deps, config) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("automatic opt-in safety notifications", () => {
  it("isolates two persisted users and matching areas, without group/area broadcasts", async () => {
    const f = fixture();
    await profile(f.profileStore, "alice"); await profile(f.profileStore, "bob", [far]);
    const result = await f.worker.runOnce();
    expect(result.acceptedCount).toBe(1);
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    expect(f.dispatch.mock.calls[0]![0].notification.audience).toEqual({ userIds: ["alice"] });
  });

  it("does not let the first recipient suppress another recipient, including overlapping layers", async () => {
    const f = fixture([candidate(), candidate({ layer: "weather_alerts", layerId: "public.safety.weather_alerts" })]);
    await profile(f.profileStore, "alice"); await profile(f.profileStore, "bob");
    await f.worker.runOnce();
    expect(f.dispatch).toHaveBeenCalledTimes(2);
    const keys = f.dispatch.mock.calls.map(([decision]) => decision.idempotencyKey);
    expect(new Set(keys).size).toBe(2);
    const restarted = new SafetyNotificationWorker(f.deps, config);
    expect((await restarted.runOnce()).acceptedCount).toBe(0);
    expect(f.dispatch).toHaveBeenCalledTimes(2);
  });

  it("defaults to no consent and refuses disabled areas or missing eligible devices", async () => {
    const f = fixture();
    await profile(f.profileStore, "alice", [home], {}, false);
    await profile(f.profileStore, "bob", [{ ...home, enabled: false }]);
    await profile(f.profileStore, "charlie");
    f.hasEligibleDevice.mockResolvedValue(false);
    expect((await f.worker.runOnce()).acceptedCount).toBe(0);
    expect(f.dispatch).not.toHaveBeenCalled();
  });

  it("rechecks revocation and changed areas after source fetch before any dispatch", async () => {
    const f = fixture(); await profile(f.profileStore, "alice");
    f.fetchCandidates.mockImplementationOnce(async (query) => {
      await f.profileStore.setSafetyNotificationsEnabled("alice", false);
      return collection(query, [candidate()]);
    });
    await f.worker.runOnce();
    expect(f.dispatch).not.toHaveBeenCalled();
    await f.profileStore.setSafetyNotificationsEnabled("alice", true);
    f.fetchCandidates.mockImplementationOnce(async (query) => {
      await profile(f.profileStore, "alice", [far]);
      return collection(query, [candidate()]);
    });
    await f.worker.runOnce();
    expect(f.dispatch).not.toHaveBeenCalled();
  });

  it("serializes an in-flight accepted request with revocation and sends no later alert", async () => {
    const f = fixture(); await profile(f.profileStore, "alice");
    const started = deferred<void>(); const release = deferred<MessagingNotificationIntakeResponse>();
    f.dispatch.mockImplementationOnce(async () => { started.resolve(); return release.promise; });
    const tick = f.worker.runOnce(); await started.promise;
    let revokeCompleted = false;
    const revoke = f.profileStore.setSafetyNotificationsEnabled("alice", false).then(() => { revokeCompleted = true; });
    await Promise.resolve(); expect(revokeCompleted).toBe(false);
    release.resolve(accepted()); await tick; await revoke;
    await f.worker.runForRecipient("alice", [candidate({ featureId: "official:2" })]);
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch after losing the profile lease during eligibility or claim checks", async () => {
    const f = fixture(); await profile(f.profileStore, "alice");
    let valid = true;
    vi.spyOn(f.profileStore, "withSafetyNotificationProfile").mockImplementation(async (subjectId, operation) =>
      operation(await f.profileStore.getProfile(subjectId), () => valid)
    );
    f.hasEligibleDevice.mockImplementationOnce(async () => { valid = false; return true; });
    await f.worker.runForRecipient("alice", [candidate()]);
    expect(f.dispatch).not.toHaveBeenCalled();
    valid = true;
    const claim = f.notificationStore.claim.bind(f.notificationStore);
    vi.spyOn(f.notificationStore, "claim").mockImplementationOnce(async (...args) => {
      const result = await claim(...args); valid = false; return result;
    });
    await f.worker.runForRecipient("alice", [candidate()]);
    expect(f.dispatch).not.toHaveBeenCalled();
  });

  it("shares durable deduplication between authenticated manual evaluation and worker", async () => {
    const f = fixture(); await profile(f.profileStore, "alice");
    expect((await f.worker.runForRecipient("alice", [candidate()])).acceptedCount).toBe(1);
    await f.worker.runOnce(); expect(f.dispatch).toHaveBeenCalledTimes(1);
  });

  it("fails closed when SIM input is unavailable, incomplete, or returns stale/expired candidates", async () => {
    const f = fixture([candidate({ stale: true }), candidate({ validUntil: "2026-10-10T11:00:00Z" })]);
    await profile(f.profileStore, "alice"); await f.worker.runOnce();
    expect(f.dispatch).not.toHaveBeenCalled();
    f.fetchCandidates.mockRejectedValueOnce(new Error("SIM offline"));
    expect((await f.worker.runOnce()).lastFailure).toBe("candidate_source_unavailable");
    f.fetchCandidates.mockImplementationOnce(async (query) => ({ ...collection(query, []), inputReadiness: { status: "unavailable", reasons: ["offline"], snapshotGeneratedAt: null, snapshotAgeSeconds: null } }));
    expect((await f.worker.runOnce()).status).toBe("degraded");
    f.fetchCandidates.mockImplementationOnce(async (query) => ({ ...collection(query, [candidate()]), completeness: "possibly_truncated" }));
    expect((await f.worker.runOnce()).status).toBe("degraded");
    expect(f.dispatch).not.toHaveBeenCalled();
  });

  it("retries Messaging failures using the same key and does not claim zero-device delivery", async () => {
    const f = fixture(); await profile(f.profileStore, "alice");
    f.dispatch.mockRejectedValueOnce(new Error("offline"));
    expect((await f.worker.runOnce()).status).toBe("degraded");
    const key = f.dispatch.mock.calls[0]![0].idempotencyKey;
    await f.worker.runOnce(); expect(f.dispatch).toHaveBeenCalledTimes(1);
    f.setNow(new Date(initialNow.getTime() + config.retryMs));
    f.dispatch.mockResolvedValueOnce({ ...accepted(), deliverySummary: { ...accepted().deliverySummary!, targetDeviceCount: 0, sentCount: 0 } });
    expect((await f.worker.runOnce()).acceptedCount).toBe(0);
    f.setNow(new Date(initialNow.getTime() + 2 * config.retryMs));
    expect((await f.worker.runOnce()).acceptedCount).toBe(1);
    expect(f.dispatch.mock.calls.every(([decision]) => decision.idempotencyKey === key)).toBe(true);
  });

  it("stops after five durable attempts without changing recipient key", async () => {
    const f = fixture(); await profile(f.profileStore, "alice"); f.dispatch.mockRejectedValue(new Error("offline"));
    for (let attempt = 0; attempt < 7; attempt += 1) {
      f.setNow(new Date(initialNow.getTime() + attempt * config.retryMs)); await f.worker.runOnce();
    }
    expect(f.dispatch).toHaveBeenCalledTimes(5);
  });

  it("honors minimum severity and skips candidates without confirmed expiry", async () => {
    const f = fixture([candidate(), candidate({ featureId: "official:critical", severity: "critical" }), candidate({ featureId: "no-expiry", validUntil: undefined, sourceId: "chmi_alerts" })]);
    await profile(f.profileStore, "alice", [home], { minimumSeverity: "critical" });
    await f.worker.runOnce(); expect(f.dispatch).toHaveBeenCalledTimes(1);
    expect(f.dispatch.mock.calls[0]![0].notification.severity).toBe("critical");
  });

  it("retains a per-user hydro station severity cooldown across restart and allows escalation", async () => {
    const f = fixture(); await profile(f.profileStore, "alice"); await profile(f.profileStore, "bob");
    const warning = candidate({ sourceId: "chmi_hydro", featureId: "station:1" });
    expect((await f.worker.runForRecipient("alice", [warning])).acceptedCount).toBe(1);
    const newer = candidate({ ...warning.feature, observedAt: "2026-10-10T11:55:00Z", validFrom: "2026-10-10T11:55:00Z" });
    const restarted = new SafetyNotificationWorker(f.deps, config);
    expect((await restarted.runForRecipient("alice", [newer])).acceptedCount).toBe(0);
    expect((await restarted.runForRecipient("bob", [newer])).acceptedCount).toBe(1);
    expect((await restarted.runForRecipient("alice", [{ ...newer, feature: { ...newer.feature, severity: "critical" } }])).acceptedCount).toBe(1);
    f.setNow(new Date(initialNow.getTime() + config.hydroCooldownMs));
    expect((await restarted.runForRecipient("alice", [newer])).acceptedCount).toBe(1);
  });

  it("guards concurrent worker instances with a lease and stops before pending source result dispatch", async () => {
    const f = fixture(); await profile(f.profileStore, "alice");
    const pending = deferred<SafetyNotificationCandidateCollection>();
    f.fetchCandidates.mockImplementationOnce(() => pending.promise);
    const one = f.worker.runOnce();
    await vi.waitFor(() => expect(f.fetchCandidates).toHaveBeenCalledTimes(1));
    const two = new SafetyNotificationWorker(f.deps, config);
    await two.runOnce(); expect(f.fetchCandidates).toHaveBeenCalledTimes(1);
    const stopped = f.worker.stop();
    pending.resolve(collection({ bbox: { west: 13, east: 15, south: 49, north: 51 }, layers: ["warnings"], limit: 500 }, [candidate()]));
    await one; await stopped; expect(f.dispatch).not.toHaveBeenCalled();
  });

  it("pages recipients and does not spend a dispatch budget on restart duplicates", async () => {
    const f = fixture(); await profile(f.profileStore, "alice"); await profile(f.profileStore, "bob"); await profile(f.profileStore, "charlie");
    const worker = new SafetyNotificationWorker(f.deps, { ...config, pageSize: 1, maxProfilesPerTick: 1, maxDispatchesPerTick: 1 });
    await worker.runOnce(); await worker.runOnce(); await worker.runOnce(); await worker.runOnce();
    expect(new Set(f.dispatch.mock.calls.map(([decision]) => decision.notification.audience.userIds![0]))).toEqual(new Set(["alice", "bob", "charlie"]));
    expect(f.dispatch).toHaveBeenCalledTimes(3);
  });
});
