import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { InMemoryDriverMeasurementConsentStore } from "./driver-measurement-consent-store.js";
import { contributorIdDay } from "./driver-measurement-contract.js";
import { DriverMeasurementSourceError, type DriverMeasurementSource } from "./driver-measurement-source.js";
import { clearJwksCacheForTests } from "./security.js";

const originalEnv = { ...process.env }, issuer = "https://identity.test/realms/cop";
const fixedNow = new Date("2026-10-11T12:00:00.000Z"), secret = "synthetic-driver-measurement-secret-32-characters";
const prefix = "/api/v1/driver-measurements/v1";
const consent = { contractVersion: "cop-driver-measurements-v1", version: "traffic-quality-v1", granted: true };
beforeEach(() => { process.env = { ...originalEnv }; clearJwksCacheForTests(); });
afterEach(() => { process.env = { ...originalEnv }; clearJwksCacheForTests(); vi.unstubAllGlobals(); });
function fixture(cleanupClients: string | null = "csm-mobile,jizda-mobile") {
  const keyId = "synthetic-measurement-key", { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  Object.assign(process.env, { COP_AUTH_MODE: "oidc", COP_OIDC_ISSUER: issuer,
    COP_OIDC_ALLOWED_CLIENTS: "csm-mobile,jizda-mobile,cop-web", COP_OIDC_REQUIRED_ROLE: "cop_operator",
    COP_DRIVER_MEASUREMENTS_ENABLED: "true", COP_DRIVER_MEASUREMENTS_CLEANUP_ENABLED: "true",
    COP_DRIVER_MEASUREMENTS_OIDC_CLIENT_ID: "jizda-mobile", COP_DRIVER_MEASUREMENTS_HASH_SECRET: secret,
    COP_DRIVER_MEASUREMENTS_PILOT_ENABLED: "true", COP_DRIVER_MEASUREMENTS_PILOT_SUBJECT_IDS: "pilot-a" });
  if (cleanupClients === null) delete process.env.COP_DRIVER_MEASUREMENTS_CLEANUP_OIDC_CLIENT_IDS;
  else process.env.COP_DRIVER_MEASUREMENTS_CLEANUP_OIDC_CLIENT_IDS = cleanupClients;
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: keyId, alg: "RS256", use: "sig" };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "content-type": "application/json" } })));
  const token = (subject = "pilot-a", client: unknown = "jizda-mobile", extra: Record<string, unknown> = {}) => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: keyId })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: issuer, sub: subject, azp: client, exp: Math.floor(Date.now() / 1000) + 300,
      realm_access: { roles: ["cop_operator"] }, ...extra })).toString("base64url");
    const body = `${header}.${payload}`;
    return `${body}.${createSign("RSA-SHA256").update(body).sign(privateKey).toString("base64url")}`;
  };
  const store = new InMemoryDriverMeasurementConsentStore(), batches: Record<string, unknown>[] = [], deletions: string[] = [];
  const source: DriverMeasurementSource = {
    async send(batch) { batches.push(batch); return { contractVersion: "sim-driver-measurements-v1", batchId: batch.batchId as string,
      receivedAt: fixedNow.toISOString(), acceptedIntervalCount: 2, deduplicatedIntervalCount: 0, rejectionCounts: {}, etaAccepted: false,
      applicationMode: "shadow_only", rawPositionsStored: false }; },
    async delete(id) { deletions.push(id); throw new DriverMeasurementSourceError(503); }
  };
  let now = new Date(fixedNow.getTime() - 200_000);
  return { token, store, source, batches, deletions, headers(subject = "pilot-a", client: unknown = "jizda-mobile", extra: Record<string, unknown> = {}) {
    return { authorization: "Bearer " + token(subject, client, extra) };
  }, createApp() { return buildServer({ driverMeasurementConsentStore: store, driverMeasurementSource: source, now: () => now }); },
  advance() { now = fixedNow; } };
}
function batch() {
  return { contractVersion: "cop-driver-measurements-v1", batchId: "00000000-0000-4000-8000-000000000001",
    contributorDay: "2026-10-11", vehicleClass: "passenger_car",
    points: [0, 1, 2].map(index => ({ sampleId: `00000000-0000-4000-8000-00000000001${index}`,
      observedAt: new Date(fixedNow.getTime() - 100_000 + index * 5000).toISOString(), lat: 50, lon: 14 + index * 0.0007,
      horizontalAccuracyM: 3, speedMps: 10, speedAccuracyMps: 0.5, headingDeg: 90, headingAccuracyDeg: 5,
      positionSource: "gps", motion: "driving", reducedAccuracy: false })) };
}

describe("explicit driver cleanup clients", () => {
  it("keeps legacy read/revoke after dedicated intake migration, with two-user isolation and unchanged pilot/shadow limits", async () => {
    const f = fixture(); await f.store.grant("former-b", new Date(fixedNow.getTime() - 300_000)); const app = f.createApp();
    try {
      expect((await app.inject({ method: "POST", url: prefix + "/consent", headers: f.headers(), payload: consent })).statusCode).toBe(200);
      const oldPilot = await app.inject({ url: prefix + "/consent", headers: f.headers("pilot-a", "csm-mobile") });
      expect(oldPilot.json()).toMatchObject({ granted: true, canGrant: false });
      expect((await app.inject({ url: prefix + "/consent", headers: f.headers("former-b", "csm-mobile") })).json()).toMatchObject({ granted: true, canGrant: false });
      expect((await app.inject({ method: "POST", url: prefix + "/consent", headers: f.headers("pilot-a", "csm-mobile"), payload: consent })).statusCode).toBe(403);
      f.advance();
      expect((await app.inject({ method: "POST", url: prefix + "/batches", headers: f.headers("pilot-a", "csm-mobile"), payload: batch() })).statusCode).toBe(403);
      const accepted = await app.inject({ method: "POST", url: prefix + "/batches", headers: f.headers(), payload: batch() });
      expect(accepted.statusCode).toBe(200); expect(accepted.json()).toMatchObject({ applicationMode: "shadow_only", rawPositionsStored: false });
      expect((await app.inject({ method: "POST", url: prefix + "/consent", headers: f.headers("former-b"), payload: consent })).json().error.code).toBe("DRIVER_MEASUREMENTS_PILOT_NOT_ELIGIBLE");
      expect((await app.inject({ method: "POST", url: prefix + "/batches", headers: f.headers("former-b"), payload: batch() })).json().error.code).toBe("DRIVER_MEASUREMENTS_PILOT_NOT_ELIGIBLE");
      const revoked = await app.inject({ method: "DELETE", url: prefix + "/consent", headers: f.headers("pilot-a", "csm-mobile") });
      expect(revoked.statusCode).toBe(202); expect(revoked.json()).toMatchObject({ granted: false, pendingDeletion: true });
      expect((await app.inject({ url: prefix + "/consent", headers: f.headers("pilot-a") })).json().granted).toBe(false);
      expect((await app.inject({ url: prefix + "/consent", headers: f.headers("former-b", "csm-mobile") })).json().granted).toBe(true);
      expect((await f.store.get("former-b")).revokedAt).toBeNull();
      await vi.waitFor(() => expect(f.deletions.length).toBeGreaterThan(0));
      const pendingDays = (await f.store.get("pilot-a")).pendingDays;
      expect(f.deletions.every(id => pendingDays.some(day => id === contributorIdDay(secret, "pilot-a", day)))).toBe(true);
      expect(f.batches).toHaveLength(1);
    } finally { await app.close(); }
  });

  it("defaults cleanup to csm-mobile and never expands it implicitly to the intake client", async () => {
    const f = fixture(null), app = f.createApp();
    try {
      expect((await app.inject({ url: prefix + "/consent", headers: f.headers("pilot-a", "csm-mobile") })).statusCode).toBe(200);
      expect((await app.inject({ url: prefix + "/consent", headers: f.headers() })).statusCode).toBe(403);
      expect((await app.inject({ method: "DELETE", url: prefix + "/consent", headers: f.headers("pilot-a", "csm-mobile") })).statusCode).toBe(200);
      expect((await app.inject({ method: "DELETE", url: prefix + "/consent", headers: f.headers() })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url: prefix + "/consent", headers: f.headers(), payload: consent })).statusCode).toBe(200);
    } finally { await app.close(); }
  });

  it("requires signed exact azp and issuer rather than aud, header identity, or malformed claims", async () => {
    const f = fixture(), app = f.createApp();
    try {
      for (const malformed of [null, 1, {}, ["csm-mobile"]]) {
        for (const method of ["GET", "DELETE"] as const) expect((await app.inject({ method, url: prefix + "/consent", headers: f.headers("pilot-a", malformed, { aud: "csm-mobile" }) })).statusCode).toBe(401);
      }
      for (const client of ["", "unlisted-client", "cop-web"]) {
        const headers = f.headers("pilot-a", client, { aud: ["csm-mobile", "jizda-mobile"] });
        for (const method of ["GET", "DELETE"] as const) expect((await app.inject({ method, url: prefix + "/consent", headers })).statusCode).toBe(403);
      }
      const missing = f.headers("pilot-a", "csm-mobile", { azp: undefined, aud: "csm-mobile" });
      expect((await app.inject({ url: prefix + "/consent", headers: missing })).statusCode).toBe(403);
      expect((await app.inject({ url: prefix + "/consent", headers: f.headers("pilot-a", "csm-mobile", { iss: "https://other.test/cop" }) })).statusCode).toBe(401);
      const spoof = await app.inject({ method: "DELETE", url: prefix + "/consent", headers: { ...f.headers("pilot-a", "csm-mobile"), "x-csm-user-id": "former-b" }, payload: { subjectId: "former-b" } });
      expect(spoof.statusCode).toBe(400); expect((await f.store.get("former-b")).revokedAt).toBeNull();
      expect(f.batches).toEqual([]); expect(f.deletions).toEqual([]);
    } finally { await app.close(); }
  });

  it.each(["", "csm-mobile,,jizda-mobile", "csm-mobile,invalid client", "x".repeat(8193)])("fails cleanup configuration closed (%#)", async value => {
    const f = fixture(value), app = f.createApp();
    try {
      for (const method of ["GET", "DELETE"] as const) {
        const result = await app.inject({ method, url: prefix + "/consent", headers: f.headers("pilot-a", "csm-mobile") });
        expect(result.statusCode).toBe(503); expect(result.json().error.code).toBe("DRIVER_MEASUREMENTS_CLEANUP_CLIENTS_NOT_CONFIGURED");
      }
      expect(f.deletions).toEqual([]);
    } finally { await app.close(); }
  });
});
