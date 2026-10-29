import { readFileSync } from "node:fs";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { clearJwksCacheForTests } from "./security.js";
import { InMemoryWebSessionStore } from "./web-session-store.js";
import { PlanningOriginTransport } from "./routing-planning-transport.js";
import { PlanningOriginSource, planningBinding } from "./routing-planning-origin.js";
import { routingHash as hash } from "./routing-trip.js";

const raw = JSON.parse(readFileSync(new URL("../../../docs/api/examples/planning-origin-v1.sim-fixture.json", import.meta.url), "utf8"));
const issuer = "https://planning-identity.example.test/realms/cop", kid = "planning-http-synthetic";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const serviceToken = "synthetic-geographic-service-token";
let calls: Array<{ body: unknown; headers: Headers; url: string }>;
let upstreamStatus: number;
let upstreamCode: string | undefined;
function token(subject = "synthetic-a") {
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(JSON.stringify({ alg: "RS256", kid })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: issuer, sub: subject, azp: "csm-mobile", iat: now, exp: now + 300,
    realm_access: { roles: ["cop_operator"] } })).toString("base64url");
  const data = `${head}.${payload}`;
  return `${data}.${createSign("RSA-SHA256").update(data).end().sign(pair.privateKey).toString("base64url")}`;
}
beforeEach(() => {
  calls = []; upstreamStatus = 200; upstreamCode = undefined;
  for (const [key, value] of Object.entries({ COP_AUTH_MODE: "oidc", COP_ALLOW_LAB_TOKEN: "false", COP_ROUTING_PLANNING_ENABLED: "false",
    COP_OIDC_ISSUER: issuer, COP_OIDC_JWKS_URI: `${issuer}/jwks`, COP_OIDC_ALLOWED_CLIENTS: "csm-mobile", COP_OIDC_REQUIRED_ROLE: "cop_operator" })) vi.stubEnv(key, value);
  clearJwksCacheForTests();
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url) === `${issuer}/jwks`) return Response.json({ keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }] });
    const body = JSON.parse(String(init?.body)), headers = new Headers(init?.headers);
    calls.push({ body, headers, url: String(url) });
    if (upstreamStatus !== 200) return Response.json({ code: upstreamCode ?? (upstreamStatus === 429 ? "PLANNING_ORIGIN_LIMIT_EXCEEDED" : "PRIVATE_UNKNOWN_CODE"),
      message: "PRIVATE_PROVIDER_TEXT" }, { status: upstreamStatus, headers: { "Retry-After": "30" } });
    const actor = headers.get("x-cop-planning-actor")!;
    if (String(url).endsWith("/candidates")) {
      const response = structuredClone(raw.candidatesResponse);
      response.binding = planningBinding(body.context, response.binding.routingDataset, actor);
      return Response.json(response);
    }
    const response = structuredClone(raw.previewResponse);
    response.assessment.binding = planningBinding(body.context, body.expectedDataset, actor, body.selection);
    response.assessment.requestHash = response.assessment.binding.requestHash;
    response.route.previewPathId = `preview:${hash({ domain: "sim-planning-origin-v1/path", binding: response.assessment.binding, geometryHash: hash(response.route.geometry) })}`;
    return Response.json(response);
  }));
});
afterEach(() => { clearJwksCacheForTests(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function app(enabled = true, store?: InMemoryWebSessionStore) {
  return buildServer({ now: () => new Date(raw.nowUtc), webSessionStore: store,
    planningOriginSource: enabled ? new PlanningOriginSource(new PlanningOriginTransport("https://sim.example.test/api/v1", serviceToken)) : undefined });
}
const path = (operation: string) => `/api/v1/routing/planning-origin/${operation}`;
describe("authenticated COP planning HTTP facade", () => {
  it("derives the actor from OIDC, ignores forged actor headers and forwards only its service credential", async () => {
    const api = app();
    try {
      const response = await api.inject({ method: "POST", url: path("candidates"), payload: raw.candidatesRequest,
        headers: { authorization: `Bearer ${token()}`, "x-cop-planning-actor": "f".repeat(64), "x-correlation-id": raw.candidatesRequest.context.contextId } });
      expect(response.statusCode).toBe(200); expect(response.headers["cache-control"]).toBe("no-store");
      expect(calls).toHaveLength(1);
      expect(calls[0]!.headers.get("authorization")).toBe(`Bearer ${serviceToken}`);
      expect(calls[0]!.headers.get("cookie")).toBeNull(); expect(calls[0]!.headers.get("origin")).toBeNull();
      expect(calls[0]!.headers.get("x-cop-planning-actor")).toBe(createHash("sha256").update(`cop-planning-actor-v1\0${issuer}\0synthetic-a`).digest("hex"));
      expect(calls[0]!.body).toEqual(raw.candidatesRequest);
    } finally { await api.close(); }
  });
  it("isolates two users' discovery bindings and accepts only the current user's guarded preview", async () => {
    const api = app();
    try {
      const discover = async (subject: string) => api.inject({ method: "POST", url: path("candidates"), payload: raw.candidatesRequest,
        headers: { authorization: `Bearer ${token(subject)}` } });
      const a = await discover("synthetic-a"), b = await discover("synthetic-b");
      expect(a.statusCode).toBe(200); expect(b.statusCode).toBe(200);
      expect(a.json().binding.requestHash).not.toBe(b.json().binding.requestHash);
      const request = { ...raw.previewRequest, discoveryBinding: a.json().binding };
      const rejected = await api.inject({ method: "POST", url: path("preview"), payload: request, headers: { authorization: `Bearer ${token("synthetic-b")}` } });
      expect(rejected.statusCode).toBe(409); expect(calls).toHaveLength(2);
      const accepted = await api.inject({ method: "POST", url: path("preview"), payload: request, headers: { authorization: `Bearer ${token("synthetic-a")}` } });
      expect(accepted.statusCode).toBe(200); expect(accepted.json().navigationEligible).toBe(false);
      expect(calls).toHaveLength(3);
    } finally { await api.close(); }
  });
  it("rejects anonymous and unknown request fields before SIM is contacted", async () => {
    const api = app();
    try {
      const anonymous = await api.inject({ method: "POST", url: path("candidates"), payload: raw.candidatesRequest });
      expect(anonymous.statusCode).toBe(401);
      const forged = await api.inject({ method: "POST", url: path("candidates"), payload: { ...raw.candidatesRequest, userId: "forged" },
        headers: { authorization: `Bearer ${token()}` } });
      expect(forged.statusCode).toBe(400); expect(calls).toHaveLength(0);
      const query = await api.inject({ method: "POST", url: `${path("candidates")}?userId=forged`, payload: raw.candidatesRequest,
        headers: { authorization: `Bearer ${token()}` } });
      expect(query.statusCode).toBe(400); expect(calls).toHaveLength(0);
    } finally { await api.close(); }
  });
  it("preserves the diagnostic correlation and strict preview denial without exposing provider details or retrying", async () => {
    const api = app();
    const correlationId = "a04d6112-155b-4cd5-a0de-09e3cf732fe1";
    const userToken = token();
    try {
      const discovery = await api.inject({ method: "POST", url: path("candidates"), payload: raw.candidatesRequest,
        headers: { authorization: `Bearer ${userToken}` } });
      expect(discovery.statusCode).toBe(200);
      const request = { ...raw.previewRequest, discoveryBinding: discovery.json().binding };
      upstreamStatus = 422; upstreamCode = "ROUTING_RESTRICTIONS_RELAXATION_REQUIRED";
      const response = await api.inject({ method: "POST", url: path("preview"), payload: request,
        headers: { authorization: `Bearer ${userToken}`, "x-correlation-id": correlationId } });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("ROUTING_RESTRICTIONS_RELAXATION_REQUIRED");
      expect(response.json().error.correlationId).toBe(correlationId);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(calls).toHaveLength(2);
      const upstream = calls[1]!;
      expect(upstream.url).toBe("https://sim.example.test/api/v1/routing/planning-origin/preview");
      expect(upstream.headers.get("x-correlation-id")).toBe(correlationId);
      expect(upstream.headers.get("authorization")).toBe(`Bearer ${serviceToken}`);
      expect(upstream.body).toEqual(request);
      expect(JSON.stringify(upstream.body)).not.toContain(correlationId);
      for (const privateValue of ["PRIVATE_PROVIDER_TEXT", serviceToken, userToken]) expect(response.body).not.toContain(privateValue);
      expect(response.json()).not.toHaveProperty("route");
      expect(response.json()).not.toHaveProperty("diagnostics");
    } finally { await api.close(); }
  });
  it("keeps the new feature off unless explicitly configured", async () => {
    const api = app(false);
    try {
      const response = await api.inject({ method: "POST", url: path("candidates"), payload: raw.candidatesRequest, headers: { authorization: `Bearer ${token()}` } });
      expect(response.statusCode).toBe(503); expect(calls).toHaveLength(0);
    } finally { await api.close(); }
  });
  it.each([401, 429, 503])("handles SIM %s without direct provider access or another request", async status => {
    upstreamStatus = status; const api = app();
    try {
      const response = await api.inject({ method: "POST", url: path("candidates"), payload: raw.candidatesRequest, headers: { authorization: `Bearer ${token()}` } });
      expect(response.statusCode).toBe(status === 401 ? 503 : status); expect(calls).toHaveLength(1);
      expect(response.body).not.toContain("PRIVATE_"); expect(response.body).not.toContain(serviceToken);
      if (status === 429) { expect(response.headers["retry-after"]).toBe("30"); expect(response.json().error.code).toBe("PLANNING_ORIGIN_LIMIT_EXCEEDED"); }
    } finally { await api.close(); }
  });
  it("accepts the web session while refusing a cross-origin or revoked session", async () => {
    vi.stubEnv("COP_PUBLIC_URL", "https://cop.example.test");
    // The session store uses wall time independently of the routing fixture clock.
    const store = new InMemoryWebSessionStore(), expires = new Date(Date.now() + 300_000);
    const session = await store.create({ accessToken: token(), accessTokenExpiresAt: expires,
      profile: { subjectId: "synthetic-a", name: "Synthetic", username: "synthetic" } }, expires);
    const api = app(true, store);
    const headers = { cookie: `cop_web_session_v1=${session.sessionId}`, origin: "https://cop.example.test", authorization: "Bearer cop-bff-session" };
    try {
      const accepted = await api.inject({ method: "POST", url: path("candidates"), payload: raw.candidatesRequest, headers });
      expect(accepted.statusCode).toBe(200);
      const forbidden = await api.inject({ method: "POST", url: path("candidates"), payload: raw.candidatesRequest, headers: { ...headers, origin: "https://other.example.test" } });
      expect(forbidden.statusCode).toBe(403);
      await store.revoke(session.sessionId);
      const revoked = await api.inject({ method: "POST", url: path("candidates"), payload: raw.candidatesRequest, headers });
      expect(revoked.statusCode).toBe(401); expect(calls).toHaveLength(1);
    } finally { await api.close(); }
  });
});
