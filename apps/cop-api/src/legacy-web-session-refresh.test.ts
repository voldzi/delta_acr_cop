import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryWebSessionStore, type WebSessionTokens } from "./web-session-store.js";
import { buildServer } from "./server.js";
import { clearJwksCacheForTests } from "./security.js";

const issuer = "https://identity.legacy-bff.test/realms/cop", owner = { issuer, subjectId: "synthetic-a" };
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "legacy-bff-test", alg: "RS256", use: "sig" };
function token(subject = owner.subjectId) {
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const content = encoded({ alg: "RS256", kid: jwk.kid }) + "." + encoded({ iss: issuer, sub: subject, azp: "cop-web",
    exp: Math.floor(Date.now() / 1000) + 300, auth_time: Math.floor(Date.now() / 1000), preferred_username: "Synthetic refreshed", name: "Synthetic" });
  return content + "." + createSign("RSA-SHA256").update(content).end().sign(privateKey).toString("base64url");
}
const tokens = (known = false): WebSessionTokens => ({ accessToken: token(), refreshToken: "synthetic-old-refresh", accessTokenExpiresAt: new Date(Date.now() - 60000),
  profile: { subjectId: owner.subjectId, username: "Synthetic legacy", name: "Synthetic", ...(known ? { issuer } : {}) } });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); clearJwksCacheForTests(); });
describe("legacy BFF refresh preserves unknown historical ownership", () => {
  it("rotates current credentials without adopting issuer or changing cookie/session lifetime", async () => {
    const store = new InMemoryWebSessionStore(), record = await store.create(tokens(), new Date(Date.now() + 3600000));
    const input = { ...tokens(true), accessTokenExpiresAt: new Date(Date.now() + 300000), refreshToken: "synthetic-rotated-refresh" };
    const updated = await store.update(record.sessionId, input);
    expect(updated).toMatchObject({ sessionId: record.sessionId, createdAt: record.createdAt, expiresAt: record.expiresAt, refreshToken: input.refreshToken });
    expect(updated?.profile.issuer).toBeUndefined(); expect((await store.get(record.sessionId))?.profile.issuer).toBeUndefined();
    expect((await store.preflightActorErasure(owner)).ready).toBe(false);
    await store.revoke(record.sessionId); expect(await store.update(record.sessionId, input)).toBeNull();
  });
  it("denies unknown refresh after any fence and rejects known owner/subject changes", async () => {
    const store = new InMemoryWebSessionStore(), legacy = await store.create(tokens(), new Date(Date.now() + 3600000));
    const known = await store.create(tokens(true), new Date(Date.now() + 3600000));
    expect(await store.update(known.sessionId, { ...tokens(true), profile: { ...tokens(true).profile, issuer: "https://foreign.test" } })).toBeNull();
    expect(await store.update(legacy.sessionId, { ...tokens(true), profile: { ...tokens(true).profile, subjectId: "synthetic-b" } })).toBeNull();
    await store.revokeActor({ issuer, subjectId: "synthetic-other" });
    await expect(store.update(legacy.sessionId, tokens(true))).rejects.toThrow("ACCOUNT_ERASURE_FENCED");
    expect((await store.get(legacy.sessionId))?.refreshToken).toBe("synthetic-old-refresh");
  });
  it("actual dormant BFF refresh keeps the existing authenticated web cookie usable and preflight unknown", async () => {
    for (const [name, value] of Object.entries({ COP_AUTH_MODE: "oidc", COP_OIDC_ISSUER: issuer, COP_OIDC_CLIENT_ID: "cop-web", COP_OIDC_ALLOWED_CLIENTS: "cop-web", COP_OIDC_REQUIRED_ROLE: "",
      COP_ALLOW_LAB_TOKEN: "false", COP_WEB_BFF_SESSION_ENABLED: "true", COP_ACCOUNT_ERASURE_ENABLED: "false", COP_ACCOUNT_ERASURE_SECRET: "" })) vi.stubEnv(name, value);
    clearJwksCacheForTests(); const grants: URLSearchParams[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).endsWith("/protocol/openid-connect/certs")) return new Response(JSON.stringify({ keys: [jwk] }));
      if (String(input).endsWith("/protocol/openid-connect/token")) {
        grants.push(new URLSearchParams(String(init?.body)));
        return new Response(JSON.stringify({ access_token: token(), refresh_token: "synthetic-rotated-refresh", expires_in: 300, token_type: "Bearer" }));
      }
      throw new Error("No real provider access");
    }));
    const sessions = new InMemoryWebSessionStore(), record = await sessions.create(tokens(), new Date(Date.now() + 3600000));
    const app = buildServer({ webSessionStore: sessions });
    try {
      const headers = { cookie: "cop_web_session_v1=" + record.sessionId };
      const refreshed = await app.inject({ url: "/api/v1/auth/session", headers });
      expect(refreshed.statusCode).toBe(200); expect(refreshed.json().authenticated).toBe(true); expect(refreshed.headers["set-cookie"]).toBeUndefined();
      expect(grants[0]?.get("refresh_token")).toBe("synthetic-old-refresh");
      expect(await sessions.get(record.sessionId)).toMatchObject({ sessionId: record.sessionId, createdAt: record.createdAt, expiresAt: record.expiresAt, refreshToken: "synthetic-rotated-refresh" });
      expect((await sessions.get(record.sessionId))?.profile.issuer).toBeUndefined();
      expect((await sessions.preflightActorErasure(owner)).ready).toBe(false);
      expect((await app.inject({ url: "/api/v1/me/preferences", headers })).statusCode).toBe(200);
      expect(grants).toHaveLength(1);
    } finally { await app.close(); }
  });
});
