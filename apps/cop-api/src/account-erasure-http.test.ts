import { createSign, generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { ACCOUNT_ERASURE_ADAPTER_IDS, AccountErasureError, AccountErasureService, type AccountErasureAdapter } from "./account-erasure.js";
import { clearJwksCacheForTests } from "./security.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import { CsmMessagingProvider } from "./messaging-provider.js";
import { InMemoryWebSessionStore } from "./web-session-store.js";

const issuer = "https://identity.erasure.test/realms/cop";
const operation = "ab1a9eb5-e0cd-46ce-8028-e6f2cd2b6386";
const installation = "2cc29a14-4b24-4b62-ae19-cf77a5f6b7ca";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "erasure-test", alg: "RS256", use: "sig" };
function token(subject: string, authTime = Math.floor(Date.now() / 1000), client = "cop-web", tokenIssuer = issuer, expiresIn = 300) {
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const content = encoded({ alg: "RS256", kid: jwk.kid }) + "." + encoded({ iss: tokenIssuer, sub: subject,
    azp: client, exp: Math.floor(Date.now() / 1000) + expiresIn, iat: Math.floor(Date.now() / 1000), auth_time: authTime });
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
  const adapters: AccountErasureAdapter[] = ACCOUNT_ERASURE_ADAPTER_IDS.map(id => ({ id, ready: async () => true, preflight: async () => ({ ready: true as const, version: "fixture_preflight_v1" }), erase }));
  const store = new MemoryMobilityStore();
  const service = new AccountErasureService({ store, allowUnboundSyntheticStore: true, identitySecret: "synthetic-dedicated-erasure-secret-32-plus",
    issuer, requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS, adapters, accepted: true });
  return { service, store, erase };
}
const headers = (subject: string, authTime?: number) => ({ authorization: `Bearer ${token(subject, authTime)}`, "idempotency-key": operation });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); clearJwksCacheForTests(); });

describe("verified COP account erasure HTTP boundary", () => {
  it("fences old valid bearer tokens before profile creation and isolates receipts/accounts", async () => {
    const f = fixture(); const app = buildServer({ accountErasure: f.service, mobilityStore: f.store });
    try {
      const prepared = await app.inject({ method: "POST", url: "/api/v1/me/account-deletion/preflight", headers: headers("account-a"), payload: {} });
      const response = await app.inject({ method: "POST", url: "/api/v1/me/account-deletion",
        headers: { ...headers("account-a"), "x-cop-erasure-plan": prepared.json().planId, "x-cop-erasure-receipt-capability": prepared.headers["x-cop-erasure-receipt-capability"] as string }, payload: { confirmAccountDeletion: true } });
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
      const principal = { authMode: "oidc" as const, issuer, subjectId: "a", username: "", displayName: "", authTime: Math.floor(Date.now() / 1000) };
      const prepared = await f.service.preflight(principal, operation);
      await f.service.request(principal, operation, { confirmAccountDeletion: true }, { planId: prepared.response.planId!, capability: prepared.capability! });
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

describe("preflight-issued independent erasure tracking", () => {
  it("issues HttpOnly capability before fencing and reads after BFF removal and stale auth", async () => {
    const f = fixture(); const app = buildServer({ accountErasure: f.service, mobilityStore: f.store });
    try {
      const prepared = await app.inject({ method: "POST", url: "/api/v1/me/account-deletion/preflight", headers: headers("account-a"), payload: {} });
      expect(prepared.statusCode).toBe(200); expect(prepared.json()).toMatchObject({ canConfirm: true });
      const capability = prepared.headers["x-cop-erasure-receipt-capability"] as string;
      expect(capability).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(prepared.body).not.toContain(capability);
      expect(prepared.headers["set-cookie"]).toEqual(expect.arrayContaining([expect.stringContaining("Secure; HttpOnly; SameSite=Strict")]));
      expect(await f.store.transact([], tx => tx.scan("account-erasure:job:"))).toEqual([]);
      const confirmed = await app.inject({ method: "POST", url: "/api/v1/me/account-deletion", payload: { confirmAccountDeletion: true },
        headers: { ...headers("account-a"), "x-cop-erasure-plan": prepared.json().planId, "x-cop-erasure-receipt-capability": capability } });
      expect(confirmed.statusCode).toBe(202);
      f.service.options.now = () => new Date(Date.now() + 301000);
      expect((await app.inject({ url: `/api/v1/me/account-deletion/${operation}`, headers: headers("account-a") })).statusCode).toBe(401);
      const recovered = await app.inject({ url: `/api/v1/me/account-deletion/receipts/${operation}`, headers: { cookie: `cop_web_session_v1=removed; __Secure-cop_erasure_receipt_v1=${capability}` } });
      expect(recovered.statusCode).toBe(200); expect(recovered.json()).toEqual(confirmed.json());
      expect(recovered.headers["cache-control"]).toBe("no-store");
      expect((await app.inject({ url: "/api/v1/me/preferences", headers: { "x-cop-erasure-receipt-capability": capability } })).statusCode).toBe(401);
      expect((await app.inject({ url: `/api/v1/me/account-deletion/receipts/${operation}`, headers: { "x-cop-erasure-receipt-capability": "x".repeat(43) } })).statusCode).toBe(401);
      expect((await app.inject({ url: `/api/v1/me/account-deletion/receipts/${operation}?token=${capability}` })).statusCode).toBe(401);
    } finally { await app.close(); }
  });
  it("requires both preflight plan/capability and fresh signed confirmation", async () => {
    const f = fixture(); const app = buildServer({ accountErasure: f.service, mobilityStore: f.store });
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/me/account-deletion", headers: headers("a"), payload: { confirmAccountDeletion: true } });
      expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe("ERASURE_PREFLIGHT_REQUIRED");
      const prepared = await app.inject({ method: "POST", url: "/api/v1/me/account-deletion/preflight", headers: headers("a"), payload: {} });
      const foreign = await app.inject({ method: "POST", url: "/api/v1/me/account-deletion", headers: { ...headers("b"), "x-cop-erasure-plan": prepared.json().planId, "x-cop-erasure-receipt-capability": prepared.headers["x-cop-erasure-receipt-capability"] as string }, payload: { confirmAccountDeletion: true } });
      expect(foreign.statusCode).toBe(409); expect(f.erase).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});

it("returns guard outage 503 without revoking BFF session or replacing it with 401", async () => {
  const f = fixture(); vi.stubEnv("COP_WEB_BFF_SESSION_ENABLED", "true");
  const sessions = new InMemoryWebSessionStore();
  const record = await sessions.create({ accessToken: token("a"), accessTokenExpiresAt: new Date(Date.now() + 240000), profile: { issuer, subjectId: "a", name: "Synthetic", username: "a" } }, new Date(Date.now() + 3600000));
  const guard = vi.spyOn(f.service, "assertAllowed").mockRejectedValue(new AccountErasureError(503, "ERASURE_STORE_UNAVAILABLE"));
  const app = buildServer({ accountErasure: f.service, mobilityStore: f.store, webSessionStore: sessions });
  try {
    for (const url of ["/api/v1/auth/session", "/api/v1/me/preferences"]) {
      const response = await app.inject({ url, headers: { cookie: `cop_web_session_v1=${record.sessionId}`, "x-correlation-id": "synthetic-bff-outage" } });
      expect(response.statusCode).toBe(503); expect(response.json()).toMatchObject({ error: { code: "ERASURE_GUARD_UNAVAILABLE", correlationId: "synthetic-bff-outage" } });
      expect(response.headers["set-cookie"]).toBeUndefined(); expect(await sessions.get(record.sessionId)).not.toBeNull();
      expect(response.body).not.toContain(record.accessToken);
    }
    guard.mockRestore();
    expect((await app.inject({ url: "/api/v1/auth/session", headers: { cookie: `cop_web_session_v1=${record.sessionId}` } })).statusCode).toBe(200);
  } finally { await app.close(); }
});

async function loopbackBffFixture() {
  const f = fixture();
  vi.unstubAllGlobals(); // Real HTTP is confined to this local OIDC fixture.
  let localIssuer = "", responseSubject = "a", responseIssuer: string | undefined;
  let expectedRefresh = "synthetic-initial-refresh";
  let beforeResponse: (() => Promise<void>) | undefined;
  const grants: URLSearchParams[] = [];
  const provider = createServer(async (request, response) => {
    if (request.url?.endsWith("/protocol/openid-connect/certs")) {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ keys: [jwk] })); return;
    }
    if (request.method !== "POST" || !request.url?.endsWith("/protocol/openid-connect/token")) {
      response.writeHead(404).end(); return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const grant = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
    grants.push(grant);
    if (grant.get("grant_type") === "refresh_token" && grant.get("refresh_token") !== expectedRefresh) {
      response.writeHead(400).end(); return;
    }
    expectedRefresh = `synthetic-rotated-refresh-${grants.length}`;
    await beforeResponse?.();
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ access_token: token(responseSubject, undefined, "cop-web", responseIssuer ?? localIssuer),
      expires_in: 300, refresh_token: expectedRefresh }));
  });
  await new Promise<void>((resolve, reject) => { provider.once("error", reject); provider.listen(0, "127.0.0.1", resolve); });
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("Loopback fixture did not bind.");
  localIssuer = `http://127.0.0.1:${address.port}/realms/cop`;
  for (const [key, value] of Object.entries({ COP_OIDC_ISSUER: localIssuer, COP_OIDC_CLIENT_ID: "cop-web",
    COP_WEB_BFF_SESSION_ENABLED: "true", COP_WEB_SESSION_SECRET: "synthetic-local-cookie-secret-at-least-32", COP_PUBLIC_URL: "https://cop.erasure.test" })) vi.stubEnv(key, value);
  f.service.options.issuer = localIssuer;
  const sessions = new InMemoryWebSessionStore();
  const app = buildServer({ accountErasure: f.service, mobilityStore: f.store, webSessionStore: sessions });
  const expiredSession = () => sessions.create({ accessToken: token("a", undefined, "cop-web", localIssuer, -60),
    accessTokenExpiresAt: new Date(Date.now() - 60000), refreshToken: "synthetic-initial-refresh",
    profile: { issuer: localIssuer, subjectId: "a", name: "Synthetic", username: "a" } }, new Date(Date.now() + 3600000));
  return { ...f, app, sessions, grants, localIssuer, expiredSession,
    setResponseActor(subject: string, tokenIssuer?: string) { responseSubject = subject; responseIssuer = tokenIssuer; },
    beforeResponse(hook: () => Promise<void>) { beforeResponse = hook; },
    async close() { await app.close(); provider.closeAllConnections(); await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve())); }
  };
}

describe("real loopback BFF refresh and callback guard boundary", () => {
  it("retains verified rotated credentials on guard 503 and recovers without reusing the spent refresh token", async () => {
    const f = await loopbackBffFixture(); const record = await f.expiredSession();
    const guard = vi.spyOn(f.service, "assertAllowed").mockRejectedValue(new AccountErasureError(503, "ERASURE_STORE_UNAVAILABLE"));
    try {
      const headers = { cookie: `cop_web_session_v1=${record.sessionId}`, "x-correlation-id": "synthetic-rotated-outage" };
      for (const url of ["/api/v1/auth/session", "/api/v1/me/preferences"]) {
        const response = await f.app.inject({ url, headers });
        expect(response.statusCode).toBe(503);
        expect(response.json()).toMatchObject({ error: { code: "ERASURE_GUARD_UNAVAILABLE", correlationId: "synthetic-rotated-outage" } });
        expect(response.headers["set-cookie"]).toBeUndefined();
        expect(response.body).not.toContain("synthetic-rotated-refresh");
      }
      const saved = await f.sessions.get(record.sessionId);
      expect(saved).toMatchObject({ refreshToken: "synthetic-rotated-refresh-1", profile: { issuer: f.localIssuer, subjectId: "a" } });
      expect(f.grants).toHaveLength(1); expect(saved?.accessToken).not.toBe(record.accessToken);
      guard.mockRestore();
      expect((await f.app.inject({ url: "/api/v1/auth/session", headers })).statusCode).toBe(200);
      await f.sessions.update(record.sessionId, { ...saved!, accessTokenExpiresAt: new Date(Date.now() - 60000) });
      expect((await f.app.inject({ url: "/api/v1/auth/session", headers })).statusCode).toBe(200);
      expect(f.grants[1]?.get("refresh_token")).toBe("synthetic-rotated-refresh-1");
      expect((await f.sessions.get(record.sessionId))?.refreshToken).toBe("synthetic-rotated-refresh-2");
    } finally { await f.close(); }
  });
  it.each(["subject", "issuer"])("rejects a refresh that changes the verified %s before storage or guard access", async changed => {
    const f = await loopbackBffFixture(); const record = await f.expiredSession();
    f.setResponseActor(changed === "subject" ? "b" : "a", changed === "issuer" ? "https://untrusted.erasure.test" : undefined);
    const update = vi.spyOn(f.sessions, "update"), guard = vi.spyOn(f.service, "assertAllowed");
    try {
      const response = await f.app.inject({ url: "/api/v1/auth/session", headers: { cookie: `cop_web_session_v1=${record.sessionId}` } });
      expect(response.statusCode).toBe(401); expect(await f.sessions.get(record.sessionId)).toBeNull();
      expect(update).not.toHaveBeenCalled(); expect(guard).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });
  it("cannot recreate a session purged while the provider refresh is in flight", async () => {
    const f = await loopbackBffFixture(); const record = await f.expiredSession();
    f.beforeResponse(() => f.sessions.revoke(record.sessionId));
    const create = vi.spyOn(f.sessions, "create"), guard = vi.spyOn(f.service, "assertAllowed");
    try {
      const response = await f.app.inject({ url: "/api/v1/auth/session", headers: { cookie: `cop_web_session_v1=${record.sessionId}` } });
      expect(response.statusCode).toBe(401); expect(await f.sessions.get(record.sessionId)).toBeNull();
      expect(create).not.toHaveBeenCalled(); expect(guard).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });
  it("revokes a refreshed session on a confirmed account fence", async () => {
    const f = await loopbackBffFixture(); const record = await f.expiredSession();
    vi.spyOn(f.service, "assertAllowed").mockRejectedValue(new AccountErasureError(403, "ACCOUNT_ERASURE_FENCED"));
    try {
      const response = await f.app.inject({ url: "/api/v1/auth/session", headers: { cookie: `cop_web_session_v1=${record.sessionId}` } });
      expect(response.statusCode).toBe(401); expect(await f.sessions.get(record.sessionId)).toBeNull();
      expect(JSON.stringify(response.headers["set-cookie"])).toContain("cop_web_session_v1=;");
    } finally { await f.close(); }
  });
  it("returns callback guard 503 without clearing an existing session or creating an unguarded one", async () => {
    const f = await loopbackBffFixture(); const record = await f.expiredSession();
    vi.spyOn(f.service, "assertAllowed").mockRejectedValue(new AccountErasureError(503, "ERASURE_STORE_UNAVAILABLE"));
    const create = vi.spyOn(f.sessions, "create");
    try {
      const login = await f.app.inject({ url: "/api/v1/auth/login?returnTo=%2F", headers: { cookie: `cop_web_session_v1=${record.sessionId}` } });
      expect(login.statusCode).toBe(302);
      const state = new URL(login.headers.location!).searchParams.get("state");
      const cookies = login.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
      const response = await f.app.inject({ url: `/api/v1/auth/callback?code=synthetic-code&state=${state}`,
        headers: { cookie: `${cookies}; cop_web_session_v1=${record.sessionId}`, "x-correlation-id": "synthetic-callback-outage" } });
      expect(response.statusCode).toBe(503); expect(response.headers.location).toBeUndefined();
      expect(response.json()).toMatchObject({ error: { code: "ERASURE_GUARD_UNAVAILABLE", correlationId: "synthetic-callback-outage" } });
      expect(JSON.stringify(response.headers["set-cookie"])).toContain("cop_oidc_txn_v1=;");
      expect(JSON.stringify(response.headers["set-cookie"])).not.toContain("cop_web_session_v1");
      expect(create).not.toHaveBeenCalled(); expect(await f.sessions.get(record.sessionId)).toEqual(record);
      expect(response.body).not.toContain("synthetic-rotated-refresh");
    } finally { await f.close(); }
  });
});
