import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { PostgresDriverMeasurementConsentStore } from "./driver-measurement-consent-store.js";

const { Pool } = pg;
const databaseUrl = process.env.COP_DRIVER_MEASUREMENT_TEST_DATABASE_URL;

// This opt-in test creates and drops only its own schema in a disposable local
// database. It must never run against the COP production database.
describe.skipIf(!databaseUrl)("driver measurement PostgreSQL consent store", () => {
  it("persists consent and deletion state across instances, serializes revoke, and detects secret rotation", async () => {
    const url = new URL(databaseUrl!);
    const databaseName = decodeURIComponent(url.pathname.slice(1));
    if (!(["postgres:", "postgresql:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
      databaseName.endsWith("_test"))) {
      throw new Error("Driver measurement PostgreSQL test requires a disposable local *_test database.");
    }
    const schema = `cop_driver_it_${randomUUID().replaceAll("-", "")}`;
    const control = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
    const scoped = new URL(databaseUrl!);
    scoped.searchParams.set("options", `-csearch_path=${schema}`);
    const secret = "synthetic-driver-consent-test-secret-12345";
    const today = new Date("2026-10-02T12:00:00.000Z");
    const tomorrow = new Date("2026-10-03T12:00:00.000Z");
    const first = new PostgresDriverMeasurementConsentStore(scoped.toString());
    const second = new PostgresDriverMeasurementConsentStore(scoped.toString());
    let firstClosed = false;
    try {
      await control.query(`CREATE SCHEMA "${schema}"`);
      await first.init(secret);
      await second.init(secret);
      expect((await first.grant("synthetic-user-a", today))?.grantedAt).toBeTruthy();
      expect((await second.get("synthetic-user-b")).grantedAt).toBeNull();
      expect((await second.get("synthetic-user-a")).grantedAt).toBeTruthy();
      const revoked = await second.revoke("synthetic-user-a", today);
      expect(revoked.revokedAt).toBeTruthy();
      expect(revoked.pendingDays).toHaveLength(9);
      expect(await first.withActive("synthetic-user-a", async () => true)).toBeNull();
      expect(await first.grant("synthetic-user-a", today)).toBeNull();

      await first.close();
      firstClosed = true;
      const restarted = new PostgresDriverMeasurementConsentStore(scoped.toString());
      try {
        await restarted.init(secret);
        expect((await restarted.get("synthetic-user-a")).revokedAt).toBeTruthy();
        for (const day of revoked.pendingDays) await restarted.markDeleted("synthetic-user-a", day);
        expect(await restarted.grant("synthetic-user-a", today)).toBeNull();
        expect(await restarted.grant("synthetic-user-a", tomorrow)).toBeTruthy();

        await restarted.grant("synthetic-user-b", today);
        let entered!: () => void;
        let release!: () => void;
        const insideSend = new Promise<void>((resolve) => { entered = resolve; });
        const sendGate = new Promise<void>((resolve) => { release = resolve; });
        const send = restarted.withActive("synthetic-user-b", async () => {
          entered();
          await sendGate;
          return "accepted-before-revoke";
        });
        await insideSend;
        let revokeFinished = false;
        const revoke = second.revoke("synthetic-user-b", today).then((result) => {
          revokeFinished = true;
          return result;
        });
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(revokeFinished).toBe(false);
        release();
        expect(await send).toBe("accepted-before-revoke");
        expect((await revoke).revokedAt).toBeTruthy();
        expect(await restarted.withActive("synthetic-user-b", async () => true)).toBeNull();
      } finally { await restarted.close(); }

      const rotated = new PostgresDriverMeasurementConsentStore(scoped.toString());
      try { await expect(rotated.init("different-synthetic-secret-1234567890")).rejects.toThrow(); }
      finally { await rotated.close(); }
    } finally {
      await second.close();
      if (!firstClosed) await first.close();
      await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await control.end();
    }
  });
});
