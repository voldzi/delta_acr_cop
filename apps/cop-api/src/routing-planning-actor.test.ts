import Fastify from "fastify";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearJwksCacheForTests, requireBearerToken } from "./security.js";
import { planningActorFromRequest } from "./routing-planning-actor.js";

const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const wrongPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const issuer = "https://identity.example.test/realms/cop";
function token(subject: string, wrongSignature = false, extra: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(JSON.stringify({ alg: "RS256", kid: "planning-test" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ iss: issuer, sub: subject, azp: "csm-mobile", iat: now,
    exp: now + 300, realm_access: { roles: ["cop_operator"] }, ...extra })).toString("base64url");
  const data = `${head}.${body}`;
  return `${data}.${createSign("RSA-SHA256").update(data).end().sign(wrongSignature ? wrongPair.privateKey : pair.privateKey).toString("base64url")}`;
}
beforeEach(() => {
  vi.stubEnv("COP_AUTH_MODE", "oidc"); vi.stubEnv("COP_ALLOW_LAB_TOKEN", "false");
  vi.stubEnv("COP_OIDC_ISSUER", issuer); vi.stubEnv("COP_OIDC_JWKS_URI", `${issuer}/jwks`);
  vi.stubEnv("COP_OIDC_ALLOWED_CLIENTS", "csm-mobile"); vi.stubEnv("COP_OIDC_REQUIRED_ROLE", "cop_operator");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ keys: [{ ...pair.publicKey.export({ format: "jwk" }),
    kid: "planning-test", alg: "RS256", use: "sig" }] })));
  clearJwksCacheForTests();
});
afterEach(() => { clearJwksCacheForTests(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function scope(bearer: string, forgedHeader?: string, replaceAfterAuthentication = false) {
  const app = Fastify();
  app.addHook("preHandler", requireBearerToken);
  app.post("/test-planning", async request => {
    if (replaceAfterAuthentication) request.headers.authorization = `Bearer ${token("other")}`;
    return { actor: planningActorFromRequest(request) ?? null };
  });
  try {
    return await app.inject({ method: "POST", url: "/test-planning", headers: { authorization: `Bearer ${bearer}`,
      "x-cop-planning-actor": forgedHeader ?? "a".repeat(64) }, payload: { userId: "forged", actor: "forged" } });
  } finally { await app.close(); }
}
describe("planning service assertion from verified COP identity", () => {
  it("uses the exact domain-separated identity and ignores client-selected actor/body", async () => {
    const response = await scope(token("synthetic-a"));
    expect(response.statusCode).toBe(200);
    expect(response.json().actor).toBe(createHash("sha256").update(`cop-planning-actor-v1\0${issuer}\0synthetic-a`).digest("hex"));
    expect(response.body).not.toContain("synthetic-a"); expect(response.body).not.toContain(issuer);
  });
  it("isolates accounts while remaining stable across refresh and display-name changes", async () => {
    const a = (await scope(token("a"))).json().actor;
    expect((await scope(token("a", false, { name: "changed", jti: "refresh" }), "b".repeat(64))).json().actor).toBe(a);
    expect((await scope(token("b"))).json().actor).not.toBe(a);
  });
  it("refuses a decoded but invalidly signed identity", async () => {
    expect((await scope(token("synthetic-a", true))).statusCode).toBe(401);
  });
  it("refuses a token for a different issuer", async () => {
    expect((await scope(token("synthetic-a", false, { iss: "https://other.example.test" }))).statusCode).toBe(401);
  });
  it("does not retain identity authority if the authenticated bearer changes", async () => {
    expect((await scope(token("a"), undefined, true)).json().actor).toBeNull();
  });
  it("rejects delimiter ambiguity even in an otherwise signed subject", async () => {
    expect((await scope(token("a\0b"))).json().actor).toBeNull();
  });
  it("does not turn an explicitly allowed local lab identity into a delegated OIDC actor", async () => {
    vi.stubEnv("COP_AUTH_MODE", "hybrid"); vi.stubEnv("COP_ALLOW_LAB_TOKEN", "true");
    const response = await scope("dev-lab-token");
    expect(response.statusCode).toBe(200); expect(response.json().actor).toBeNull();
  });
});
