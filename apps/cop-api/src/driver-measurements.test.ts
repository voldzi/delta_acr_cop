import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { buildServer } from "./server.js";
import { InMemoryDriverMeasurementConsentStore } from "./driver-measurement-consent-store.js";
import { DriverMeasurementSourceError, HttpDriverMeasurementSource, type DriverMeasurementSource } from "./driver-measurement-source.js";
import { clearJwksCacheForTests } from "./security.js";

const originalEnv = { ...process.env };
const fixedNow = new Date("2026-10-02T12:00:00.000Z");
const batchId = "00000000-0000-4000-8000-000000000001";

beforeEach(() => { process.env = { ...originalEnv }; clearJwksCacheForTests(); });
afterEach(() => { process.env = { ...originalEnv }; clearJwksCacheForTests(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function signJwt(privateKey: KeyObject, keyId: string, payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: keyId, typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const input = `${header}.${body}`;
  const signature = createSign("RSA-SHA256").update(input).sign(privateKey).toString("base64url");
  return `${input}.${signature}`;
}

function setupOidc(): (subjectId: string, clientId?: string) => string {
  const issuer = "https://login.example.test/realms/cop";
  const keyId = "driver-test-key";
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = { ...publicKey.export({ format: "jwk" }), alg: "RS256", kid: keyId, use: "sig" };
  process.env.COP_AUTH_MODE = "oidc";
  process.env.COP_OIDC_ISSUER = issuer;
  process.env.COP_OIDC_ALLOWED_CLIENTS = "jizda,cop-web";
  process.env.COP_OIDC_REQUIRED_ROLE = "cop_operator";
  process.env.COP_DRIVER_MEASUREMENTS_CLEANUP_OIDC_CLIENT_IDS = "jizda";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ keys: [publicJwk] }), {
    headers: { "content-type": "application/json" }, status: 200
  })));
  return (subjectId, clientId = "jizda") => signJwt(privateKey, keyId, {
    azp: clientId, exp: Math.floor(Date.now() / 1000) + 300, iat: Math.floor(Date.now() / 1000),
    iss: issuer, sub: subjectId, realm_access: { roles: ["cop_operator"] }
  });
}

function draft(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractVersion: "cop-driver-measurements-v1", batchId, contributorDay: "2026-10-02",
    vehicleClass: "passenger_car",
    points: [0, 1, 2].map((index) => ({
      sampleId: `00000000-0000-4000-8000-00000000001${index}`,
      observedAt: new Date(fixedNow.getTime() - 100_000 + index * 5_000).toISOString(),
      lat: 50, lon: 14 + index * 0.0007, horizontalAccuracyM: 3,
      speedMps: 10, speedAccuracyMps: 0.5, headingDeg: 90, headingAccuracyDeg: 5,
      positionSource: "gps", motion: "driving", reducedAccuracy: false
    })), ...extra
  };
}

function source(): DriverMeasurementSource & { batches: Record<string, unknown>[]; deletions: string[]; failDelete: boolean } {
  return {
    batches: [], deletions: [], failDelete: false,
    async send(batch) {
      this.batches.push(batch);
      return { contractVersion: "sim-driver-measurements-v1", batchId: batch.batchId as string,
        receivedAt: fixedNow.toISOString(), acceptedIntervalCount: 2, deduplicatedIntervalCount: 0,
        rejectionCounts: {}, etaAccepted: false, applicationMode: "shadow_only", rawPositionsStored: false };
    },
    async delete(pseudonym) {
      if (this.failDelete) throw new DriverMeasurementSourceError(503);
      this.deletions.push(pseudonym);
    }
  };
}

describe("Jizda driver measurement boundary", () => {
  it("keeps the pilot disabled and requires bearer authentication", async () => {
    const app = buildServer();
    const unauthenticated = await app.inject({ method: "POST", url: "/api/v1/driver-measurements/v1/batches", payload: draft() });
    expect(unauthenticated.statusCode).toBe(401);
    const disabled = await app.inject({ method: "POST", url: "/api/v1/driver-measurements/v1/batches",
      headers: { authorization: "Bearer dev-lab-token" }, payload: draft() });
    expect(disabled.statusCode).toBe(503);
    await app.close();
  });

  it("isolates two users, rejects private context, and blocks regrant after revoke", async () => {
    const token = setupOidc();
  process.env.COP_DRIVER_MEASUREMENTS_ENABLED = "true";
    process.env.COP_DRIVER_MEASUREMENTS_OIDC_CLIENT_ID = "jizda";
    process.env.COP_DRIVER_MEASUREMENTS_HASH_SECRET = "test-only-driver-secret-at-least-32-chars";
    const sim = source();
    let currentNow = new Date(fixedNow.getTime() - 200_000);
    const app = buildServer({ driverMeasurementConsentStore: new InMemoryDriverMeasurementConsentStore(),
      driverMeasurementSource: sim, now: () => currentNow });
    const url = "/api/v1/driver-measurements/v1";
    const auth = (subject: string) => ({ authorization: `Bearer ${token(subject)}` });
    const grant = (subject: string) => app.inject({ method: "POST", url: `${url}/consent`, headers: auth(subject),
      payload: { contractVersion: "cop-driver-measurements-v1", version: "traffic-quality-v1", granted: true } });
    expect((await grant("a")).statusCode).toBe(200);
    expect((await grant("b")).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `${url}/consent`,
      headers: { authorization: `Bearer ${token("a", "cop-web")}` } })).statusCode).toBe(403);
    currentNow = fixedNow;
    const a = await app.inject({ method: "POST", url: `${url}/batches`, headers: auth("a"), payload: draft() });
    const b = await app.inject({ method: "POST", url: `${url}/batches`, headers: auth("b"), payload: draft() });
    expect(a.statusCode).toBe(200);
    expect(a.json().batchId).toBe(batchId);
    expect(a.json().contractVersion).toBe("cop-driver-measurements-v1");
    expect(b.statusCode).toBe(200);
    expect(sim.batches[0]?.contributorIdDay).not.toBe(sim.batches[1]?.contributorIdDay);
    expect(sim.batches[0]?.batchId).not.toBe(sim.batches[1]?.batchId);
    expect(sim.batches[0]).not.toHaveProperty("subjectId");
    expect(sim.batches[0]).not.toHaveProperty("username");
    expect(sim.batches[0]?.consent).toMatchObject({ attestation: "cop-driver-consent-v1" });
    const forbidden = await app.inject({ method: "POST", url: `${url}/batches`, headers: auth("a"),
      payload: draft({ context: { homeAddress: "private" } }) });
    expect(forbidden.statusCode).toBe(400);
    expect(sim.batches).toHaveLength(2);
    const estimated = await app.inject({ method: "POST", url: `${url}/batches`, headers: auth("a"),
      payload: draft({ points: [{ ...(draft().points as Array<Record<string, unknown>>)[0], positionSource: "estimated" },
        ...(draft().points as Array<Record<string, unknown>>).slice(1)] }) });
    expect(estimated.statusCode).toBe(400);
    const oversized = await app.inject({ method: "POST", url: `${url}/batches`, headers: auth("a"),
      payload: draft({ context: "x".repeat(1_050_000) }) });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json().error.code).toBe("DRIVER_MEASUREMENTS_BODY_TOO_LARGE");
    sim.failDelete = true;
    const revoked = await app.inject({ method: "DELETE", url: `${url}/consent`, headers: auth("a") });
    expect(revoked.statusCode).toBe(202);
    expect(revoked.json().pendingDeletion).toBe(true);
    expect((await grant("a")).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `${url}/batches`, headers: auth("a"), payload: draft() })).statusCode).toBe(403);
    sim.failDelete = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await app.inject({ method: "DELETE", url: `${url}/consent`, headers: auth("a") });
      await vi.waitFor(() => expect(sim.deletions.length).toBeGreaterThanOrEqual(Math.min((attempt + 1) * 4, 9)));
    }
    expect(sim.deletions.length).toBe(9);
    await vi.waitFor(async () => {
      expect((await app.inject({ method: "GET", url: `${url}/consent`, headers: auth("a") })).json().pendingDeletion).toBe(false);
    });
    const completed = await app.inject({ method: "DELETE", url: `${url}/consent`, headers: auth("a") });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().pendingDeletion).toBe(false);
    expect((await grant("a")).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `${url}/batches`, headers: auth("b"), payload: draft() })).statusCode).toBe(200);
    await app.close();
  });

  it("lets an in-flight upload finish before revocation and passes through bounded rate limits", async () => {
    const token = setupOidc();
    process.env.COP_DRIVER_MEASUREMENTS_ENABLED = "true";
    process.env.COP_DRIVER_MEASUREMENTS_OIDC_CLIENT_ID = "jizda";
    process.env.COP_DRIVER_MEASUREMENTS_HASH_SECRET = "test-only-driver-secret-at-least-32-chars";
    const sim = source();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered = false;
    const originalSend = sim.send.bind(sim);
    sim.send = async (batch) => { entered = true; await gate; return originalSend(batch); };
    sim.failDelete = true;
    const headers = { authorization: `Bearer ${token("a")}` };
    const root = "/api/v1/driver-measurements/v1";
    // The consent timestamp precedes every synthetic GPS point.
    const consentStore = new InMemoryDriverMeasurementConsentStore();
    await consentStore.grant("a", new Date(fixedNow.getTime() - 200_000));
    const activeApp = buildServer({ driverMeasurementConsentStore: consentStore,
      driverMeasurementSource: sim, now: () => fixedNow });
    const upload = activeApp.inject({ method: "POST", url: `${root}/batches`, headers, payload: draft() });
    await vi.waitFor(() => expect(entered).toBe(true));
    let revokeFinished = false;
    const revoke = activeApp.inject({ method: "DELETE", url: `${root}/consent`, headers })
      .then((response) => { revokeFinished = true; return response; });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(revokeFinished).toBe(false);
    release();
    expect((await upload).statusCode).toBe(200);
    expect((await revoke).statusCode).toBe(202);
    sim.send = async () => { throw new DriverMeasurementSourceError(429, "7"); };
    await activeApp.close();

    const nextStore = new InMemoryDriverMeasurementConsentStore();
    await nextStore.grant("a", new Date(fixedNow.getTime() - 200_000));
    const rateApp = buildServer({ driverMeasurementConsentStore: nextStore,
      driverMeasurementSource: sim, now: () => fixedNow });
    const rate = await rateApp.inject({ method: "POST", url: `${root}/batches`, headers, payload: draft() });
    expect(rate.statusCode).toBe(429);
    expect(rate.headers["retry-after"]).toBe("7");
    sim.send = async () => { throw new DriverMeasurementSourceError(403, undefined, "DRIVER_CONSENT_REVOKED"); };
    const revokedBatch = await rateApp.inject({ method: "POST", url: `${root}/batches`, headers, payload: draft() });
    expect(revokedBatch.statusCode).toBe(403);
    expect(revokedBatch.json().error.code).toBe("DRIVER_CONSENT_REVOKED");
    await rateApp.close();
  });

  it("keeps revocation available when upload routing is rolled back", async () => {
    const token = setupOidc();
    process.env.COP_DRIVER_MEASUREMENTS_ENABLED = "false";
    process.env.COP_DRIVER_MEASUREMENTS_CLEANUP_ENABLED = "true";
    process.env.COP_DRIVER_MEASUREMENTS_PILOT_ENABLED = "true";
    process.env.COP_DRIVER_MEASUREMENTS_PILOT_SUBJECT_IDS = "other-pilot";
    process.env.COP_DRIVER_MEASUREMENTS_OIDC_CLIENT_ID = "jizda";
    process.env.COP_DRIVER_MEASUREMENTS_HASH_SECRET = "test-only-driver-secret-at-least-32-chars";
    const store = new InMemoryDriverMeasurementConsentStore();
    await store.grant("a", new Date(fixedNow.getTime() - 200_000));
    const sim = source();
    sim.failDelete = true;
    const app = buildServer({ driverMeasurementConsentStore: store, driverMeasurementSource: sim, now: () => fixedNow });
    const headers = { authorization: `Bearer ${token("a")}` };
    const root = "/api/v1/driver-measurements/v1";
    expect((await app.inject({ method: "POST", url: `${root}/batches`, headers, payload: draft() })).statusCode).toBe(503);
    expect((await app.inject({ method: "DELETE", url: `${root}/consent`, headers })).statusCode).toBe(202);
    expect((await app.inject({ method: "GET", url: `${root}/consent`, headers })).json().pendingDeletion).toBe(true);
    expect((await app.inject({ method: "GET", url: `${root}/consent`, headers })).json().canGrant).toBe(false);
    expect((await app.inject({ method: "POST", url: `${root}/consent`, headers,
      payload: { contractVersion: "cop-driver-measurements-v1", version: "traffic-quality-v1", granted: true } })).statusCode).toBe(503);
    await app.close();
  });

  it("restricts pilot intake to the verified actor while retaining cleanup for other users", async () => {
    const token = setupOidc();
    process.env.COP_DRIVER_MEASUREMENTS_ENABLED = "true";
    process.env.COP_DRIVER_MEASUREMENTS_PILOT_ENABLED = "true";
    process.env.COP_DRIVER_MEASUREMENTS_PILOT_SUBJECT_IDS = " pilot-a, pilot-a ";
    process.env.COP_DRIVER_MEASUREMENTS_OIDC_CLIENT_ID = "jizda";
    process.env.COP_DRIVER_MEASUREMENTS_HASH_SECRET = "test-only-driver-secret-at-least-32-chars";
    const store = new InMemoryDriverMeasurementConsentStore();
    // A previous participant still owns contributions after leaving the cohort.
    await store.grant("outside-b", new Date(fixedNow.getTime() - 200_000));
    const sim = source();
    let currentNow = new Date(fixedNow.getTime() - 200_000);
    const app = buildServer({ driverMeasurementConsentStore: store, driverMeasurementSource: sim,
      now: () => currentNow });
    const root = "/api/v1/driver-measurements/v1";
    const auth = (subject: string) => ({ authorization: `Bearer ${token(subject)}` });
    const consent = { contractVersion: "cop-driver-measurements-v1", version: "traffic-quality-v1", granted: true };
    expect((await app.inject({ method: "GET", url: `${root}/consent`, headers: auth("pilot-a") })).json().canGrant).toBe(true);
    expect((await app.inject({ method: "GET", url: `${root}/consent`, headers: auth("outside-b") })).json()).toMatchObject({
      granted: true, canGrant: false
    });
    expect((await app.inject({ method: "POST", url: `${root}/batches`, headers: auth("pilot-a"), payload: draft() })).json().error.code)
      .toBe("DRIVER_MEASUREMENTS_CONSENT_REQUIRED");
    expect((await app.inject({ method: "POST", url: `${root}/consent`, headers: auth("pilot-a"),
      payload: { ...consent, subjectId: "outside-b" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `${root}/consent`, headers: auth("pilot-a"), payload: consent })).statusCode).toBe(200);
    currentNow = fixedNow;
    expect((await app.inject({ method: "POST", url: `${root}/batches`, headers: auth("pilot-a"), payload: draft() })).statusCode).toBe(200);
    for (const endpoint of ["consent", "batches"]) {
      const denied = await app.inject({ method: "POST", url: `${root}/${endpoint}`, headers: auth("outside-b"),
        payload: endpoint === "consent" ? consent : draft({ subjectId: "pilot-a" }) });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe("DRIVER_MEASUREMENTS_PILOT_NOT_ELIGIBLE");
    }
    expect((await app.inject({ method: "POST", url: `${root}/consent`,
      headers: { authorization: `Bearer ${token("pilot-a", "cop-web")}` }, payload: consent })).statusCode).toBe(403);
    const revoke = await app.inject({ method: "DELETE", url: `${root}/consent`, headers: auth("outside-b") });
    expect(revoke.statusCode).toBe(202);
    await vi.waitFor(() => expect(sim.deletions.length).toBeGreaterThan(0));
    expect(sim.batches).toHaveLength(1);
    await app.close();
  });

  it.each(["", "pilot-a,,outside-b", "pilot-a,invalid subject", "x".repeat(8193)])(
    "fails closed for unconfigured or malformed pilot cohort without blocking revocation (%#)", async (cohort) => {
      const token = setupOidc();
      process.env.COP_DRIVER_MEASUREMENTS_ENABLED = "true";
      process.env.COP_DRIVER_MEASUREMENTS_PILOT_ENABLED = "true";
      process.env.COP_DRIVER_MEASUREMENTS_PILOT_SUBJECT_IDS = cohort;
      process.env.COP_DRIVER_MEASUREMENTS_OIDC_CLIENT_ID = "jizda";
      process.env.COP_DRIVER_MEASUREMENTS_HASH_SECRET = "test-only-driver-secret-at-least-32-chars";
      const app = buildServer({ driverMeasurementConsentStore: new InMemoryDriverMeasurementConsentStore(),
        driverMeasurementSource: source(), now: () => fixedNow });
      const headers = { authorization: `Bearer ${token("pilot-a")}` };
      const root = "/api/v1/driver-measurements/v1";
      const state = await app.inject({ method: "GET", url: `${root}/consent`, headers });
      expect(state.statusCode).toBe(200);
      expect(state.json().canGrant).toBe(false);
      for (const endpoint of ["consent", "batches"]) {
        const response = await app.inject({ method: "POST", url: `${root}/${endpoint}`, headers,
          payload: endpoint === "consent" ? { contractVersion: "cop-driver-measurements-v1", version: "traffic-quality-v1", granted: true } : draft() });
        expect(response.statusCode).toBe(503);
        expect(response.json().error.code).toBe("DRIVER_MEASUREMENTS_PILOT_NOT_CONFIGURED");
      }
      expect((await app.inject({ method: "DELETE", url: `${root}/consent`, headers })).statusCode).toBe(200);
      await app.close();
    }
  );

  it("does not bypass the pilot filter for an invalid pilot flag", async () => {
    const token = setupOidc();
    process.env.COP_DRIVER_MEASUREMENTS_ENABLED = "true";
    process.env.COP_DRIVER_MEASUREMENTS_PILOT_ENABLED = "tru";
    process.env.COP_DRIVER_MEASUREMENTS_PILOT_SUBJECT_IDS = "pilot-a";
    process.env.COP_DRIVER_MEASUREMENTS_OIDC_CLIENT_ID = "jizda";
    process.env.COP_DRIVER_MEASUREMENTS_HASH_SECRET = "test-only-driver-secret-at-least-32-chars";
    const app = buildServer({ driverMeasurementConsentStore: new InMemoryDriverMeasurementConsentStore(),
      driverMeasurementSource: source(), now: () => fixedNow });
    const headers = { authorization: `Bearer ${token("outside-b")}` };
    const root = "/api/v1/driver-measurements/v1";
    const grant = await app.inject({ method: "POST", url: `${root}/consent`, headers,
      payload: { contractVersion: "cop-driver-measurements-v1", version: "traffic-quality-v1", granted: true } });
    expect(grant.statusCode).toBe(403);
    expect(grant.json().error.code).toBe("DRIVER_MEASUREMENTS_PILOT_NOT_ELIGIBLE");
    expect((await app.inject({ method: "GET", url: `${root}/consent`, headers })).json().canGrant).toBe(false);
    expect((await app.inject({ method: "DELETE", url: `${root}/consent`, headers })).statusCode).toBe(200);
    await app.close();
  });

  it("rejects SIM redirects and oversized or invalid receipts; preserves 429", async () => {
    const source = new HttpDriverMeasurementSource("https://sim.example.test/internal", "test-token");
    const input = { batchId };
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.redirect).toBe("error");
      return new Response("", { status: 429, headers: { "retry-after": "12" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(source.send(input)).rejects.toMatchObject({ statusCode: 429, retryAfter: "12" });
    fetchMock.mockImplementationOnce(async () => { throw new TypeError("redirect blocked"); });
    await expect(source.send(input)).rejects.toMatchObject({ statusCode: 503 });
    fetchMock.mockImplementationOnce(async () => new Response("x".repeat(65_537), { status: 200 }));
    await expect(source.send(input)).rejects.toMatchObject({ statusCode: 503 });
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({
      contractVersion: "sim-driver-measurements-v1", batchId, receivedAt: fixedNow.toISOString(),
      acceptedIntervalCount: 1, deduplicatedIntervalCount: 0, rejectionCounts: {}, etaAccepted: false,
      applicationMode: "shadow_only", rawPositionsStored: false, rawGps: [50, 14]
    }), { status: 200 }));
    await expect(source.send(input)).rejects.toMatchObject({ statusCode: 503 });
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({
      error: { code: "DRIVER_CONSENT_REVOKED", message: "not forwarded", correlationId: "synthetic" }
    }), { status: 403 }));
    await expect(source.send(input)).rejects.toMatchObject({ statusCode: 403, code: "DRIVER_CONSENT_REVOKED" });
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({
      error: { code: "SERVICE_TOKEN_DENIED", message: "not forwarded", correlationId: "synthetic" }
    }), { status: 403 }));
    await expect(source.send(input)).rejects.toMatchObject({ statusCode: 503 });
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({
      error: { code: "DRIVER_CONSENT_REVOKED", message: "x".repeat(5000), correlationId: "synthetic" }
    }), { status: 403 }));
    await expect(source.send(input)).rejects.toMatchObject({ statusCode: 503 });
  });

  it("requires an explicit completed SIM deletion receipt and never completes on 202", async () => {
    const upstream = new HttpDriverMeasurementSource("https://sim.example.test/internal", "test-token");
    const receipt = { contractVersion: "sim-driver-measurements-v1", deletedBatchCount: 1 };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(receipt), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    for (const [status, body] of [[202, receipt], [200, {}], [200, { ...receipt, contractVersion: "unknown" }],
      [200, { ...receipt, deletedBatchCount: -1 }], [200, "<html>not a deletion</html>"], [200, "x".repeat(4097)]] as const) {
      fetchMock.mockImplementationOnce(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
      await expect(upstream.delete("synthetic-contributor")).rejects.toMatchObject({ statusCode: 503 });
    }
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 204 }));
    await expect(upstream.delete("synthetic-contributor")).rejects.toMatchObject({ statusCode: 503 });
    await expect(upstream.delete("synthetic-contributor")).resolves.toBeUndefined();
  });
});
