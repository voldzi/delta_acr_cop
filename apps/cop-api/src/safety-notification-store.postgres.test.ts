import { randomUUID, createHash } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { PostgresSafetyNotificationStore } from "./safety-notification-store.js";
import { PostgresUserProfileStore } from "./user-profile-store.js";

const connectionString = process.env.COP_SAFETY_NOTIFICATION_TEST_DATABASE_URL;

// Dedicated DB only; each run creates and drops its own synthetic schema.
describe.skipIf(!connectionString)("PostgreSQL safety notification concurrency and restart", () => {
  it("persists consent, device eligibility, claims/cooldown and serializes concurrent workers", async () => {
    const admin = new pg.Pool({ connectionString });
    const schema = `cop_safety_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const poolConfig = { connectionString, options: `-c search_path=${schema}`, max: 3 };
    const first = new PostgresSafetyNotificationStore(poolConfig);
    const second = new PostgresSafetyNotificationStore(poolConfig);
    const profiles = new PostgresUserProfileStore(poolConfig);
    const now = new Date("2026-10-10T12:00:00Z");
    const expiry = new Date(now.getTime() + 3600000);
    const key = `cop.safety:${createHash("sha256").update("synthetic:first").digest("hex")}`;
    const nextKey = `cop.safety:${createHash("sha256").update("synthetic:next").digest("hex")}`;
    const cooldown = { key: `cop.safety.cooldown:${createHash("sha256").update("synthetic:station").digest("hex")}`, durationMs: 60000 };
    try {
      await first.init(); await second.init(); await profiles.init();
      const initial = await profiles.upsertProfile({ subjectId: "synthetic-tester", username: "synthetic", displayName: "Synthetic", preferences: {}, alertPreferences: { safetyNotificationsEnabled: true } });
      expect(initial.alertPreferences.safetyNotificationsEnabled).toBeUndefined();
      await profiles.setSafetyNotificationsEnabled("synthetic-tester", true);
      await profiles.upsertProfile({ ...initial, alertPreferences: { safetyNotificationsEnabled: false } });
      expect((await profiles.listSafetyNotificationProfiles(undefined, 1))[0]?.subjectId).toBe("synthetic-tester");
      await first.setWebDeviceEligibility("synthetic-tester", "synthetic-device", true);
      expect(await second.hasEligibleWebDevice("synthetic-tester")).toBe(true);
      expect(await first.withWorkerLease(async (leaseValid) => {
        expect(leaseValid()).toBe(true);
        expect(await second.withWorkerLease(async () => "unexpected")).toBeUndefined();
        return "one-worker";
      })).toBe("one-worker");
      const [one, two] = await Promise.all([first.claim(key, expiry, now, 1000, cooldown), second.claim(key, expiry, now, 1000, cooldown)]);
      expect([one, two].filter(Boolean)).toHaveLength(1);
      const claim = one ?? two;
      await first.markAccepted(claim!, "synthetic-notification", now);
      expect(await second.claim(key, expiry, new Date(now.getTime() + 1000), 1000)).toBeNull();
      expect(await second.claim(nextKey, expiry, new Date(now.getTime() + 1000), 1000, cooldown)).toBeNull();
      expect(await second.claim(nextKey, expiry, new Date(now.getTime() + 60000), 1000, cooldown)).not.toBeNull();
      let entered!: () => void; const inDispatch = new Promise<void>((resolve) => { entered = resolve; });
      let release!: () => void; const completion = new Promise<void>((resolve) => { release = resolve; });
      const guarded = profiles.withSafetyNotificationProfile("synthetic-tester", async (current) => {
        expect(current!.alertPreferences.safetyNotificationsEnabled).toBe(true); entered(); await completion;
      });
      await inDispatch;
      let revoked = false;
      const revoke = profiles.setSafetyNotificationsEnabled("synthetic-tester", false).then(() => { revoked = true; });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(revoked).toBe(false);
      release(); await guarded; await revoke;
      expect((await profiles.getProfile("synthetic-tester"))!.alertPreferences.safetyNotificationsEnabled).toBe(false);
      await first.setWebDeviceEligibility("synthetic-tester", "synthetic-device", false);
      expect(await second.hasEligibleWebDevice("synthetic-tester")).toBe(false);
    } finally {
      await Promise.all([first.close(), second.close(), profiles.close()]);
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });
});
