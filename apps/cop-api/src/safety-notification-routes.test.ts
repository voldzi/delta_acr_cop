import { afterEach, describe, expect, it, vi } from "vitest";
import { createPublicSafetyAggregateSourceSystem } from "@cop/canonical-model";
import { buildServer, type BuildServerOptions } from "./server.js";
import { InMemoryUserProfileStore } from "./user-profile-store.js";
import { InMemoryMobileDeviceStore } from "./mobile-device-store.js";
import { InMemoryVoiceCallStore } from "./voice-call-store.js";
import { InMemorySafetyNotificationStore } from "./safety-notification-store.js";
import { SafetyNotificationWorker, safetyNotificationWorkerConfigFromEnv } from "./safety-notification-worker.js";
import type { SafetyDataSource } from "./safety-data-source.js";
import type { MediaNewsContext } from "./media-news-source.js";
import { CsmMessagingProvider } from "./messaging-provider.js";

const at = new Date("2026-10-10T12:00:00Z");
const auth = { authorization: "Bearer dev-lab-token" };
const area = { enabled: true, id: "home", name: "Sledovaná oblast", lat: 50, lon: 14, radiusKm: 2 };
function source() {
  return {
    config: { enabled: true, baseUrl: "https://sim.invalid/safety-data/api/v1", cacheTtlMs: 30000, maxLimit: 600, timeoutMs: 1000 },
    sourceSystem: createPublicSafetyAggregateSourceSystem(),
    fetchConfig: vi.fn(async () => ({})), fetchLayers: vi.fn(async () => []), fetchSources: vi.fn(async () => []),
    fetchFeatures: vi.fn(async () => { throw new Error("Map features must never be used for push."); }),
    fetchNotificationCandidates: vi.fn(async () => ({
      contractVersion: "sim-safety-notification-candidates-v1" as const, providerId: "sim.safety-data" as const,
      generatedAt: at.toISOString(), query: { bbox: { west: 13, south: 49, east: 15, north: 51 }, layers: ["weather_alerts" as const], limit: 100, includeStale: false as const, minSeverity: "warning" as const },
      candidates: [], completeness: "complete" as const, warnings: [],
      inputReadiness: { status: "ready" as const, snapshotGeneratedAt: at.toISOString(), snapshotAgeSeconds: 0, reasons: [] }
    }))
  } satisfies SafetyDataSource;
}
async function setup(extra: BuildServerOptions = {}) {
  const profiles = new InMemoryUserProfileStore();
  const devices = new InMemoryMobileDeviceStore();
  const ledger = new InMemorySafetyNotificationStore();
  await profiles.upsertProfile({ subjectId: "lab", username: "lab", displayName: "Lab", preferences: {}, alertPreferences: { aoiRules: [area] } });
  await ledger.setWebDeviceEligibility("lab", "web-test", true);
  const safety = source();
  const app = buildServer({ now: () => at, userProfileStore: profiles, mobileDeviceStore: devices, safetyNotificationStore: ledger,
    safetyDataSource: safety, safetyNotificationWorkerConfig: { ...safetyNotificationWorkerConfigFromEnv({}), enabled: true }, ...extra });
  await app.ready();
  return { app, profiles, ledger, safety };
}
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("safety notification routes", () => {
  it("refuses volatile consent or delivery stores for the production worker", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => buildServer({ userProfileStore: new InMemoryUserProfileStore(),
      safetyNotificationStore: new InMemorySafetyNotificationStore(), safetyDataSource: source(),
      safetyNotificationWorkerConfig: { ...safetyNotificationWorkerConfigFromEnv({}), enabled: true } }))
      .toThrow("persistent PostgreSQL consent and delivery stores");
  });
  it("does not start automatic dispatch before successful application initialization", async () => {
    const voiceStore = new InMemoryVoiceCallStore();
    vi.spyOn(voiceStore, "init").mockRejectedValue(new Error("Voice store unavailable"));
    const start = vi.spyOn(SafetyNotificationWorker.prototype, "start");
    const app = buildServer({ voiceCallStore: voiceStore, safetyDataSource: source(),
      safetyNotificationStore: new InMemorySafetyNotificationStore(),
      safetyNotificationWorkerConfig: { ...safetyNotificationWorkerConfigFromEnv({}), enabled: true } });
    try {
      await expect(app.ready()).rejects.toThrow("Voice store unavailable");
      expect(start).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it("requires authentication and a strict boolean consent body", async () => {
    const { app } = await setup();
    try {
      expect((await app.inject({ method: "PUT", url: "/api/v1/me/notifications/safety", payload: { enabled: true } })).statusCode).toBe(401);
      expect((await app.inject({ method: "PUT", url: "/api/v1/me/notifications/safety", headers: auth, payload: { enabled: "true" } })).statusCode).toBe(400);
      expect((await app.inject({ method: "PUT", url: "/api/v1/me/notifications/safety", headers: auth, payload: { enabled: true, subjectId: "other" } })).statusCode).toBe(400);
    } finally { await app.close(); }
  });
  it("persists explicit consent and cannot restore it through stale generic profile saves", async () => {
    const { app, profiles } = await setup();
    try {
      const grant = await app.inject({ method: "PUT", url: "/api/v1/me/notifications/safety", headers: auth, payload: { enabled: true } });
      expect(grant.statusCode).toBe(200); expect(grant.json()).toMatchObject({ contractVersion: "cop-safety-notification-consent-v1", enabled: true });
      const revoke = await app.inject({ method: "PUT", url: "/api/v1/me/notifications/safety", headers: auth, payload: { enabled: false } });
      expect(revoke.statusCode).toBe(200);
      const stale = await app.inject({ method: "PUT", url: "/api/v1/me/preferences", headers: auth,
        payload: { preferences: { uiTheme: "dark" }, alertPreferences: { aoiRules: [area], safetyNotificationsEnabled: true } } });
      expect(stale.statusCode).toBe(200);
      expect((await profiles.getProfile("lab"))?.alertPreferences.safetyNotificationsEnabled).toBe(false);
    } finally { await app.close(); }
  });
  it("fails with 503 when a consent write fails instead of acknowledging memory fallback", async () => {
    const { app, profiles } = await setup();
    try {
      vi.spyOn(profiles, "setSafetyNotificationsEnabled").mockRejectedValue(new Error("Database unavailable"));
      const response = await app.inject({ method: "PUT", url: "/api/v1/me/notifications/safety", headers: auth, payload: { enabled: false } });
      expect(response.statusCode).toBe(503); expect(response.json().error.code).toBe("NOTIFICATION_STORE_UNAVAILABLE");
    } finally { await app.close(); }
  });
  it("requires a watched area and active registered device for opt-in", async () => {
    const { app, ledger } = await setup();
    try {
      await ledger.setWebDeviceEligibility("lab", "web-test", false);
      expect((await app.inject({ method: "PUT", url: "/api/v1/me/notifications/safety", headers: auth, payload: { enabled: true } })).statusCode).toBe(409);
      expect((await app.inject({ method: "PUT", url: "/api/v1/me/notifications/safety", headers: auth, payload: { enabled: false } })).statusCode).toBe(200);
    } finally { await app.close(); }
  });
  it("mirrors only notification-capable devices that permit safety alerts", async () => {
    vi.spyOn(CsmMessagingProvider.prototype, "registerWebPushDevice").mockResolvedValue({
      contractVersion: "cop-web-push-device-v1", deviceId: "canonical-device", enabled: true,
      providerId: "csm.messaging", registered: true, status: "online", warnings: []
    });
    const { app, ledger } = await setup();
    try {
      await ledger.setWebDeviceEligibility("lab", "web-test", false);
      const registration = { deviceId: "browser-device", endpoint: "https://push.invalid/test", keys: { auth: "synthetic-auth", p256dh: "synthetic-key" } };
      for (const options of [
        { capabilities: ["e2ee"], notificationPreferences: { safetyAlerts: true } },
        { capabilities: ["notifications"], notificationPreferences: { chatMessages: true } }
      ]) {
        const response = await app.inject({ method: "POST", url: "/api/v1/push/web/devices", headers: auth, payload: { ...registration, ...options } });
        expect(response.statusCode).toBe(202);
        expect(await ledger.hasEligibleWebDevice("lab")).toBe(false);
      }
      expect((await app.inject({ method: "POST", url: "/api/v1/push/web/devices", headers: auth,
        payload: { ...registration, capabilities: ["notifications"], notificationPreferences: { safetyAlerts: true } } })).statusCode).toBe(202);
      expect(await ledger.hasEligibleWebDevice("lab")).toBe(true);
      await ledger.setWebDeviceEligibility("lab", "canonical-device", false);
      expect(await ledger.hasEligibleWebDevice("lab")).toBe(false);
    } finally { await app.close(); }
  });
  it("uses only candidate endpoint and rejects caller-selected foreign audience", async () => {
    const { app, safety } = await setup();
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/notifications/safety/evaluate", headers: auth,
        payload: { bbox: [13, 49, 15, 51] } });
      expect(response.statusCode).toBe(200); expect(response.json().dryRun).toBe(true);
      expect(safety.fetchNotificationCandidates).toHaveBeenCalled(); expect(safety.fetchFeatures).not.toHaveBeenCalled();
      for (const audience of [{ userIds: ["other"] }, { groupIds: ["all"] }, { areaIds: ["foreign-area"] }]) {
        expect((await app.inject({ method: "POST", url: "/api/v1/notifications/safety/evaluate", headers: auth,
          payload: { bbox: [13, 49, 15, 51], audience } })).statusCode).toBe(403);
      }
      expect((await app.inject({ method: "POST", url: "/api/v1/notifications/safety/evaluate", headers: auth,
        payload: { bbox: [13, 49, 15, 51], dryRun: false } })).statusCode).toBe(403);
    } finally { await app.close(); }
  });
  it("returns 503 for unready source rather than a misleading empty healthy evaluation", async () => {
    const { app, safety } = await setup();
    try {
      safety.fetchNotificationCandidates.mockRejectedValue(new Error("SIM unavailable"));
      const response = await app.inject({ method: "POST", url: "/api/v1/notifications/safety/evaluate", headers: auth, payload: { bbox: [13, 49, 15, 51] } });
      expect(response.statusCode).toBe(503); expect(response.json().error.code).toBe("SAFETY_EVALUATION_UNAVAILABLE");
      expect(safety.fetchFeatures).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it("reports dispatch failure as a service outage rather than a successful evaluation", async () => {
    const { app, profiles } = await setup();
    try {
      await profiles.setSafetyNotificationsEnabled("lab", true);
      vi.spyOn(SafetyNotificationWorker.prototype, "runForRecipient").mockResolvedValue({ acceptedCount: 0, skippedCount: 0, failedCount: 1 });
      const response = await app.inject({ method: "POST", url: "/api/v1/notifications/safety/evaluate", headers: auth,
        payload: { bbox: [13, 49, 15, 51], dryRun: false } });
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe("NOTIFICATION_DISPATCH_UNAVAILABLE");
    } finally { await app.close(); }
  });
  it("exposes only separate informational news and reports upstream failure as 503", async () => {
    vi.stubEnv("COP_PUBLIC_READ_ENABLED", "true");
    const news: MediaNewsContext = { contractVersion: "sim-crisis-media-context-v1", status: "disabled", generatedAt: at.toISOString(),
      informationalOnly: true, notificationEligible: false, items: [], sources: [] };
    const fetchContext = vi.fn(async () => news);
    const { app } = await setup({ mediaNewsSource: { fetchContext } });
    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/safety/context/news" });
      expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ informationalOnly: true, notificationEligible: false });
      fetchContext.mockRejectedValue(new Error("SIM down"));
      expect((await app.inject({ method: "GET", url: "/api/v1/safety/context/news" })).statusCode).toBe(503);
    } finally { await app.close(); }
  });
});
