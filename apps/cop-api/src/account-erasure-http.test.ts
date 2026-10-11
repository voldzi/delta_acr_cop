import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { ACCOUNT_ERASURE_ADAPTER_IDS, AccountErasureService, type AccountErasureAdapter } from "./account-erasure.js";
import { clearJwksCacheForTests } from "./security.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import { CsmMessagingProvider } from "./messaging-provider.js";
import { InMemoryWebSessionStore } from "./web-session-store.js";

const issuer = "https://identity.erasure.test/realms/cop";
const operation = "ab1a9eb5-e0cd-46ce-8028-e6f2cd2b6386";
const installation = "2cc29a14-4b24-4b62-ae19-cf77a5f6b7ca";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "erasure-test", alg: "RS256", use: "sig" };
function token(subject: string, authTime = Math.floor(Date.now() / 1000), client = "cop-web") {
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const content = encoded({ alg: "RS256", kid: jwk.kid }) + "." + encoded({ iss: issuer, sub: subject,
    azp: client, exp: Math.floor(Date.now() / 1000) + 300, iat: Math.floor(Date.now() / 1000), auth_time: authTime });
  return content + "." + createSign("RSA-SHA256").update(content).end().sign(privateKey).toString("base64url");
}
function fixture(completed = false) {
  for (const [key, value] of Object.entries({ COP_AUTH_MODE: "oidc", COP_OIDC_ISSUER: issuer,
    COP_OIDC_ALLOWED_CLIENTS: "cop-web,jizda-mobile,csm-mobile", COP_OIDC_REQUIRED_ROLE: "",
    COP_ALLOW_LAB_TOKEN: "false", COP_WEB_BFF_SESSION_ENABLED: "false", COP_ACCOUNT_ERASURE_ENABLED: "false",
    COP_JIZDA_OIDC_CLIENT_ID: "jizda-mobile", COP_JIZDA_DISCONNECT_ENABLED: "false" })) vi.stubEnv(key, value);
  clearJwksCacheForTests();
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    if (String(input).endsWith("/protocol/openid-connect/certs")) return new Response(JSON.stringify({ keys: [jwk] }));
    throw new Error("No real provider access in synthetic tests");
  }));
  const erase = vi.fn(async () => completed ? { status: "completed" as const, proofId: "synthetic_proof_only" }
    : { status: "pending" as const, remaining: "cleanup_pending" as const });
  const adapters: AccountErasureAdapter[] = ACCOUNT_ERASURE_ADAPTER_IDS.map(id => ({ id, ready: async () => true, erase }));
  const store = new MemoryMobilityStore();
  const service = new AccountErasureService({ store, identitySecret: "synthetic-dedicated-erasure-secret-32-plus",
    issuer, requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS, adapters, accepted: true });
  return { service, store, erase };
}
const headers = (subject: string, authTime?: number) => ({ authorization: `Bearer ${token(subject, authTime)}`, "idempotency-key": operation });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); clearJwksCacheForTests(); });

describe("verified COP account erasure HTTP boundary", () => {
  it("fences old valid bearer tokens before profile creation and isolates receipts/accounts", async () => {
    const f = fixture(); const app = buildServer({ accountErasure: f.service, mobilityStore: f.store });
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/me/account-deletion",
        headers: headers("account-a"), payload: { confirmAccountDeletion: true } });
      expect(response.statusCode).toBe(202); expect(response.json()).toMatchObject({ accountDeleted: false, revocationEnforced: true });
      expect(response.json().remaining).toHaveLength(11);
      expect((await app.inject({ method: "GET", url: "/api/v1/me/preferences", headers: headers("account-a") })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: "/api/v1/me/preferences", headers: headers("account-b") })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: `/api/v1/me/account-deletion/${operation}`, headers: headers("account-b") })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: `/api/v1/me/account-deletion/${operation}`, headers: headers("account-a") })).statusCode).toBe(200);
      // Unauthenticated health must not decode an unverified JWT to probe private fences.
      const forged = token("account-a").replace(/\.[^.]+$/u, ".forged");
      expect((await app.inject({ method: "GET", url: "/health/live", headers: { authorization: "Bearer " + forged } })).statusCode).toBe(200);
      const jobs = await f.store.transact([], tx => tx.scan("account-erasure:job:"));
      expect(JSON.stringify(jobs)).not.toContain("account-a");
    } finally { await app.close(); }
  });
  it("requires fresh signed auth_time, explicit body and signature before any cleanup", async () => {
    const f = fixture(); const app = buildServer({ accountErasure: f.service });
    try {
      const request = (authorization: string, payload: unknown) => app.inject({ method: "POST", url: "/api/v1/me/account-deletion",
        headers: { authorization, "idempotency-key": operation }, payload: payload as object });
      expect((await request(`Bearer ${token("a", Math.floor(Date.now() / 1000) - 600)}`, { confirmAccountDeletion: true })).statusCode).toBe(401);
      expect((await request(`Bearer ${token("a")}`, { confirmAccountDeletion: true, userId: "b" })).statusCode).toBe(400);
      expect((await request(`Bearer ${token("a").replace(/\.[^.]+$/u, ".forged")}`, { confirmAccountDeletion: true })).statusCode).toBe(401);
      expect(f.erase).not.toHaveBeenCalled();
      expect(await f.store.transact([], tx => tx.scan("account-erasure:job:"))).toEqual([]);
    } finally { await app.close(); }
  });
  it("clears a fenced BFF session before reusing it", async () => {
    const f = fixture(); const sessions = new InMemoryWebSessionStore();
    const session = await sessions.create({ accessToken: token("a"), accessTokenExpiresAt: new Date(Date.now() + 240000),
      profile: { issuer, subjectId: "a", name: "Synthetic", username: "a" } }, new Date(Date.now() + 3600000));
    const app = buildServer({ accountErasure: f.service, webSessionStore: sessions });
    try {
      await f.service.request({ authMode: "oidc", issuer, subjectId: "a", username: "", displayName: "", authTime: Math.floor(Date.now() / 1000) }, operation, { confirmAccountDeletion: true });
      const response = await app.inject({ method: "GET", url: "/api/v1/auth/session", headers: { cookie: `cop_web_session_v1=${session.sessionId}` } });
      expect(response.statusCode).toBe(401); expect(await sessions.get(session.sessionId)).toBeNull();
    } finally { await app.close(); }
  });
  it("attests Matrix app identity server-side and rejects forged or incomplete bootstrap context", async () => {
    fixture(); const provider = new CsmMessagingProvider({ baseUrl: "https://messaging.erasure.test", token: "synthetic-service",
      timeoutMs: 100, cacheTtlMs: 0, enabled: true });
    const bootstrap = vi.spyOn(provider, "fetchMatrixBootstrap").mockResolvedValue({ status: "online", chatAvailable: true, tokenAvailable: true } as never);
    const app = buildServer({ messagingProvider: provider });
    try {
      const send = (payload: object, client = "jizda-mobile") => app.inject({ method: "POST", url: "/api/v1/messaging/bootstrap",
        headers: { authorization: `Bearer ${token("a", undefined, client)}`, "x-csm-app-client-id": "cop-web" }, payload });
      expect((await send({ deviceId: "JIZDA.test" })).statusCode).toBe(400);
      expect((await send({ deviceId: "JIZDA.test", installationId: installation, appClientId: "cop-web" })).statusCode).toBe(400);
      expect(bootstrap).not.toHaveBeenCalled();
      expect((await send({ deviceId: "JIZDA.test", installationId: installation })).statusCode).toBe(200);
      expect(bootstrap).toHaveBeenCalledWith(expect.objectContaining({ issuer, subjectId: "a", authorizedParty: "jizda-mobile" }), expect.any(Date), "JIZDA.test", installation);
      expect((await send({ deviceId: "COP.test" }, "csm-mobile")).statusCode).toBe(200);
    } finally { await app.close(); }
  });
  it("returns 503 for unavailable attested installation bootstrap without a legacy retry or credentials", async () => {
    fixture(); const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/protocol/openid-connect/certs")) return new Response(JSON.stringify({ keys: [jwk] }));
      if (url === "https://messaging.erasure.test/api/v1/matrix/token") {
        requests.push(url); return new Response(JSON.stringify({ error: { code: "APP_DEVICE_LEDGER_UNAVAILABLE" } }), { status: 503 });
      }
      throw new Error("Synthetic provider access only");
    }));
    const provider = new CsmMessagingProvider({ baseUrl: "https://messaging.erasure.test", token: "synthetic-service",
      timeoutMs: 100, cacheTtlMs: 0, enabled: true });
    const app = buildServer({ messagingProvider: provider });
    try {
      const send = (payload: object, client: string) => app.inject({ method: "POST", url: "/api/v1/messaging/bootstrap",
        headers: { authorization: `Bearer ${token("a", undefined, client)}` }, payload });
      const response = await send({ deviceId: "JIZDA.test", installationId: installation }, "jizda-mobile");
      expect(response.statusCode).toBe(503); expect(response.json().error.code).toBe("MESSAGING_INSTALLATION_UNAVAILABLE");
      expect(response.headers["cache-control"]).toBe("no-store"); expect(response.json()).not.toHaveProperty("accessToken");
      expect(requests).toHaveLength(1);
      const legacy = await send({ deviceId: "COP.test" }, "csm-mobile");
      expect(legacy.statusCode).toBe(200); expect(legacy.json()).toMatchObject({ status: "degraded", tokenAvailable: false });
      expect(requests).toHaveLength(2);
    } finally { await app.close(); }
  });
});
