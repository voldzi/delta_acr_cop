import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSafetyNotificationStoreFromEnv, InMemorySafetyNotificationStore } from "./safety-notification-store.js";
import { InMemoryUserProfileStore } from "./user-profile-store.js";

const now = new Date("2026-10-10T12:00:00Z");
const key = `cop.safety:${createHash("sha256").update("synthetic-test").digest("hex")}`;
const expiry = new Date(now.getTime() + 3600000);

describe("safety notification persistence boundary", () => {
  it("requires durable configuration in production and never silently falls back to RAM", () => {
    expect(() => createSafetyNotificationStoreFromEnv({ NODE_ENV: "production", COP_SAFETY_NOTIFICATION_STORE: "memory" })).toThrow("durable");
    expect(() => createSafetyNotificationStoreFromEnv({ NODE_ENV: "production" })).toThrow("PostgreSQL");
    expect(createSafetyNotificationStoreFromEnv({ COP_SAFETY_NOTIFICATION_STORE: "memory" }).name).toBe("memory");
  });

  it("keeps per-key ownership, retries, crash leases and accepted deduplication", async () => {
    const store = new InMemorySafetyNotificationStore();
    const one = await store.claim(key, expiry, now, 1000); expect(one).not.toBeNull();
    expect(await store.claim(key, expiry, now, 1000)).toBeNull();
    const recovered = await store.claim(key, expiry, new Date(now.getTime() + 1000), 1000); expect(recovered).not.toBeNull();
    await expect(store.markAccepted(one!, "old-owner", now)).rejects.toThrow("owned");
    await store.markAccepted(recovered!, "accepted", now);
    expect(await store.claim(key, expiry, new Date(now.getTime() + 5000), 1000)).toBeNull();
  });

  it("requires verified web registration and supports per-device revocation", async () => {
    const store = new InMemorySafetyNotificationStore();
    expect(await store.hasEligibleWebDevice("alice")).toBe(false);
    await store.setWebDeviceEligibility("alice", "test-a", true);
    await store.setWebDeviceEligibility("alice", "test-b", true);
    expect(await store.hasEligibleWebDevice("alice")).toBe(true);
    expect(await store.hasEligibleWebDevice("bob")).toBe(false);
    await store.setWebDeviceEligibility("alice", "test-a", false);
    expect(await store.hasEligibleWebDevice("alice")).toBe(true);
    await store.setWebDeviceEligibility("alice", "test-b", false);
    expect(await store.hasEligibleWebDevice("alice")).toBe(false);
  });

  it("does not permit generic profile writes to create or overwrite explicit consent", async () => {
    const store = new InMemoryUserProfileStore();
    const input = { subjectId: "alice", username: "tester", displayName: "Test", preferences: {}, alertPreferences: { safetyNotificationsEnabled: true } };
    expect((await store.upsertProfile(input)).alertPreferences.safetyNotificationsEnabled).toBeUndefined();
    await store.setSafetyNotificationsEnabled("alice", true);
    await store.upsertProfile({ ...input, alertPreferences: { safetyNotificationsEnabled: false } });
    expect((await store.getProfile("alice"))!.alertPreferences.safetyNotificationsEnabled).toBe(true);
    await store.setSafetyNotificationsEnabled("alice", false);
    await store.upsertProfile(input);
    expect((await store.getProfile("alice"))!.alertPreferences.safetyNotificationsEnabled).toBe(false);
    expect(await store.listSafetyNotificationProfiles(undefined, 10)).toEqual([]);
  });

  it("enumerates only persisted explicit opt-ins by stable cursor and returns detached profiles", async () => {
    const store = new InMemoryUserProfileStore();
    for (const subjectId of ["charlie", "alice", "bob"]) {
      await store.upsertProfile({ subjectId, username: subjectId, displayName: "Test", preferences: {}, alertPreferences: {} });
      await store.setSafetyNotificationsEnabled(subjectId, true);
    }
    await store.setSafetyNotificationsEnabled("bob", false);
    expect((await store.listSafetyNotificationProfiles(undefined, 1)).map((profile) => profile.subjectId)).toEqual(["alice"]);
    expect((await store.listSafetyNotificationProfiles("alice", 1)).map((profile) => profile.subjectId)).toEqual(["charlie"]);
    const detached = (await store.getProfile("alice"))!;
    detached.alertPreferences.safetyNotificationsEnabled = false;
    expect((await store.getProfile("alice"))!.alertPreferences.safetyNotificationsEnabled).toBe(true);
  });
});
