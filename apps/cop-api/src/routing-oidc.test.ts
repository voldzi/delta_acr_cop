import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSign, generateKeyPairSync } from "node:crypto";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { buildServer } from "./server.js";
import { clearJwksCacheForTests } from "./security.js";
import { InMemoryWebSessionStore } from "./web-session-store.js";
import { RoutingSourceAdapter } from "./routing-source.js";

const originalEnv = { ...process.env };
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const wrongPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = "synthetic-routing-oidc-key";
const load = (name: string) => JSON.parse(readFileSync(new URL(`../../../docs/api/examples/road-trip-v1.sim-${name}.json`, import.meta.url), "utf8"));
const request = load("request");
const fixtureResponse = load("response");
const fixtureNow = new Date(load("manifest").now);
let server: Server;
let base: string;
let responseBody: unknown;
let status: number;
let jwksStatus: number;
let requests: Array<{ body: unknown; authorization?: string; path: string }>;

beforeEach(async () => {
  responseBody = structuredClone(fixtureResponse);
  status = 200;
  jwksStatus = 200;
  requests = [];
  server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/jwks") {
      res.statusCode = jwksStatus;
      res.end(JSON.stringify({ keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }] }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({ path: req.url ?? "", body: JSON.parse(Buffer.concat(chunks).toString() || "null"), authorization: req.headers.authorization });
    res.statusCode = status;
    if (status === 429) res.setHeader("retry-after", "30");
    res.end(JSON.stringify(responseBody));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test listener unavailable");
  base = `http://127.0.0.1:${address.port}`;
  process.env = { ...originalEnv, COP_AUTH_MODE: "oidc", COP_ALLOW_LAB_TOKEN: "false", COP_PUBLIC_READ_ENABLED: "true",
    COP_OIDC_ISSUER: `${base}/issuer`, COP_OIDC_JWKS_URI: `${base}/jwks`, COP_OIDC_ALLOWED_CLIENTS: "csm-mobile",
    COP_OIDC_CLIENT_ID: "csm-mobile", COP_OIDC_REQUIRED_ROLE: "cop_operator" };
  clearJwksCacheForTests();
});

afterEach(async () => {
  process.env = { ...originalEnv };
  clearJwksCacheForTests();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
});

function signedToken(changes: Record<string, unknown> = {}, wrongSignature = false): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: `${base}/issuer`, sub: "synthetic-operator", azp: "csm-mobile",
    exp: now + 300, iat: now, realm_access: { roles: ["cop_operator"] }, ...changes })).toString("base64url");
  const data = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256"); sign.update(data); sign.end();
  return `${data}.${sign.sign(wrongSignature ? wrongPair.privateKey : pair.privateKey).toString("base64url")}`;
}
function app() {
  return buildServer({ now: () => fixtureNow,
    routingSource: new RoutingSourceAdapter({ baseUrl: `${base}/api/v1`, enabled: true, timeoutMs: 1500 }) });
}

describe("OIDC road-trip HTTP boundary", () => {
  it("accepts signed mobile identity through actual JWKS HTTP and preserves every variant and immutable field without forwarding credentials", async () => {
    const api = app();
    try {
      const response = await api.inject({ method: "POST", url: "/api/v1/routing/route", payload: request,
        headers: { authorization: `Bearer ${signedToken()}` } });
      expect(response.statusCode).toBe(200);
      expect(response.json().routes).toHaveLength(2);
      expect(response.json().routes.map((r: { assessment: unknown }) => r.assessment)).toEqual(fixtureResponse.routes.map((r: { assessment: unknown }) => r.assessment));
      expect(requests).toEqual([{ path: "/api/v1/routing/alternatives", body: request, authorization: undefined }]);
    } finally { await api.close(); }
  });

  it("accepts a server-side OIDC session cookie and rejects cross-origin or revoked sessions before forwarding", async () => {
    process.env.COP_PUBLIC_URL = "https://cop.example.test";
    const store = new InMemoryWebSessionStore();
    const session = await store.create({ accessToken: signedToken(), accessTokenExpiresAt: new Date(Date.now() + 300_000),
      profile: { subjectId: "synthetic-operator", name: "Synthetic operator", username: "synthetic" } }, new Date(Date.now() + 300_000));
    const api = buildServer({ now: () => fixtureNow, webSessionStore: store,
      routingSource: new RoutingSourceAdapter({ baseUrl: `${base}/api/v1`, enabled: true, timeoutMs: 1500 }) });
    const headers = { cookie: `cop_web_session_v1=${session.sessionId}`, origin: "https://cop.example.test", authorization: "Bearer cop-bff-session" };
    try {
      const accepted = await api.inject({ method: "POST", url: "/api/v1/routing/route", payload: request, headers });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json().routes).toHaveLength(2);
      const crossOrigin = await api.inject({ method: "POST", url: "/api/v1/routing/route", payload: request,
        headers: { ...headers, origin: "https://untrusted.example.test" } });
      expect(crossOrigin.statusCode).toBe(403);
      expect(crossOrigin.json().error.code).toBe("BFF_ORIGIN_FORBIDDEN");
      await store.revoke(session.sessionId);
      const revoked = await api.inject({ method: "POST", url: "/api/v1/routing/route", payload: request, headers });
      expect(revoked.statusCode).toBe(401);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.authorization).toBeUndefined();
    } finally { await api.close(); }
  });

  it("rejects anonymous, lab, wrong-signature, wrong-issuer/client/role, expired and malformed identities before SIM is contacted", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const api = app();
    try {
      const invalid = [undefined, "dev-lab-token", signedToken({}, true), signedToken({ iss: "https://untrusted.invalid" }),
        signedToken({ azp: "other-client" }), signedToken({ realm_access: { roles: [] } }),
        signedToken({ exp: Math.floor(Date.now() / 1000) - 120 }), signedToken({ sub: undefined }),
        signedToken({ sub: "   " }), signedToken({ sub: 42 }), signedToken({ exp: "Infinity" }),
        signedToken({ realm_access: { roles: 42 } }), signedToken({ name: 42 }), `${signedToken()}.extra`, "not-a-jwt-private-prefix"];
      for (const token of invalid) {
        const response = await api.inject({ method: "POST", url: "/api/v1/routing/route", payload: request,
          headers: token ? { authorization: `Bearer ${token}` } : {} });
        expect(response.statusCode, "invalid identity rejected").toBe(401);
        expect(response.json().error.code).toBe("UNAUTHORIZED");
      }
      expect(requests).toHaveLength(0);
      expect(warn).not.toHaveBeenCalled();
    } finally { await api.close(); }
  });

  it("never makes the routing catalog public or accepts signed identity without subject", async () => {
    const api = app();
    try {
      for (const token of [undefined, signedToken({ sub: undefined })]) {
        const response = await api.inject({ method: "GET", url: "/api/v1/routing/profiles",
          headers: token ? { authorization: `Bearer ${token}` } : {} });
        expect(response.statusCode).toBe(401);
      }
      expect(requests).toHaveLength(0);
    } finally { await api.close(); }
  });

  it("rejects missing JWKS instead of accepting lab credentials or forwarding the request", async () => {
    jwksStatus = 503;
    const api = app();
    try {
      const response = await api.inject({ method: "POST", url: "/api/v1/routing/route", payload: request,
        headers: { authorization: `Bearer ${signedToken()}` } });
      expect(response.statusCode).toBe(401);
      expect(requests).toHaveLength(0);
    } finally { await api.close(); }
  });

  it("rejects browser-selected identity and emergency substitution without contacting SIM", async () => {
    const api = app();
    try {
      for (const payload of [{ ...request, userId: "other-operator" }, { ...request, profileId: "emergency_vehicle" }]) {
        const response = await api.inject({ method: "POST", url: "/api/v1/routing/route", payload,
          headers: { authorization: `Bearer ${signedToken()}` } });
        expect(response.statusCode).toBe(400);
      }
      expect(requests).toHaveLength(0);
    } finally { await api.close(); }
  });

  it("rejects mismatched surplus alternatives, trip identity and expired assessments through the authenticated facade", async () => {
    const api = app();
    try {
      const mutations = [
        (r: typeof fixtureResponse) => { r.routes.push({ ...structuredClone(r.routes[1]), routeId: "extra", assessment: undefined }); },
        (r: typeof fixtureResponse) => { r.routes[1].assessment.appliedHash = "0".repeat(64); },
        (r: typeof fixtureResponse) => { r.routes[1].assessment.appliedTrip.vehicle.loadedWeightKg += 1; },
        (r: typeof fixtureResponse) => { r.routes[1].assessment.geometryHash = "0".repeat(64); },
        (r: typeof fixtureResponse) => { r.routes[1].assessment.validUntil = fixtureNow.toISOString(); }
      ];
      for (const mutate of mutations) {
        const changed = structuredClone(fixtureResponse); mutate(changed); responseBody = changed;
        const response = await api.inject({ method: "POST", url: "/api/v1/routing/route", payload: request,
          headers: { authorization: `Bearer ${signedToken()}` } });
        expect(response.statusCode).toBe(502);
        expect(response.json()).not.toHaveProperty("routes");
      }
      expect(requests).toHaveLength(mutations.length); // one call per request, no fallback/retry
    } finally { await api.close(); }
  });

  it("preserves upstream rejection, quota and unavailable status and does not leak upstream diagnostics or start fallback", async () => {
    const api = app();
    try {
      for (const upstream of [422, 429, 503]) {
        status = upstream;
        responseBody = { error: { code: "ROUTING_CLOSURES_UNAVAILABLE", message: "private upstream detail" } };
        const response = await api.inject({ method: "POST", url: "/api/v1/routing/route", payload: request,
          headers: { authorization: `Bearer ${signedToken()}`, "x-correlation-id": "routing-oidc-acceptance" } });
        expect(response.statusCode).toBe(upstream);
        expect(response.json().error.correlationId).toBe("routing-oidc-acceptance");
        expect(response.json().error.code).toBe("ROUTING_CLOSURES_UNAVAILABLE");
        expect(response.body).not.toContain("private upstream detail");
        expect(response.body).not.toContain(base);
        if (upstream === 429) expect(response.headers["retry-after"]).toBe("30");
      }
      expect(requests).toHaveLength(3);
    } finally { await api.close(); }
  });
});
