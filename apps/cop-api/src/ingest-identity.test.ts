import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { clearJwksCacheForTests } from "./security.js";

const issuer = "https://identity.example.test/realms/cop";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = "synthetic-ingest-key";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); clearJwksCacheForTests(); });

function setup() {
  vi.stubEnv("COP_AUTH_MODE", "oidc");
  vi.stubEnv("COP_ALLOW_LAB_TOKEN", "false");
  vi.stubEnv("COP_OIDC_ISSUER", issuer);
  vi.stubEnv("COP_OIDC_JWKS_URI", `${issuer}/jwks`);
  vi.stubEnv("COP_OIDC_ALLOWED_CLIENTS", "cop-web");
  vi.stubEnv("COP_OIDC_CLIENT_ID", "cop-web");
  vi.stubEnv("COP_OIDC_REQUIRED_ROLE", "");
  clearJwksCacheForTests();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }] })));
}

function token(roles: string[], sub: unknown = "synthetic-user", includeSub = true) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: issuer, azp: "cop-web", exp: Math.floor(Date.now() / 1000) + 300,
    ...(includeSub ? { sub } : {}), realm_access: { roles } })).toString("base64url");
  const input = `${header}.${payload}`;
  return `${input}.${createSign("RSA-SHA256").update(input).sign(pair.privateKey).toString("base64url")}`;
}

function event() {
  return {
    eventId: randomUUID(), eventType: "track.updated", contractVersion: "cop-ingest-v1", correlationId: randomUUID(),
    source: { sourceSystemId: "sim-air-situation-001", adapterId: "synthetic", adapterVersion: "1.0.0" },
    producerTimestamp: new Date().toISOString(), classification: { level: "UNCLASSIFIED", releasability: ["CZ"], handlingCaveats: [] },
    geo: { lat: 50, lon: 14 }, quality: { confidence: 1 }, simulation: { synthetic: true },
    payload: { objectId: randomUUID(), objectType: "AIRCRAFT", domain: "AIR", affiliation: "FRIEND", status: "ACTIVE" }
  };
}

describe("canonical ingest actor authorization", () => {
  it("rejects a signed citizen identity even when it presents a registered source", async () => {
    setup();
    const app = buildServer();
    try {
      for (const url of ["/api/v1/ingest/events", "/api/v1/ingest/batches"]) {
        const response = await app.inject({
          method: "POST", url, headers: { authorization: `Bearer ${token(["citizen"])}`, "content-type": "application/json", "x-source-system-id": "sim-air-situation-001" },
          payload: '{"not-valid-json":'
        });
        expect(response.statusCode).toBe(403);
        expect(response.json().error.code).toBe("INGEST_FORBIDDEN");
      }
    } finally { await app.close(); }
  });

  it.each(["cop_operator", "COP_OPERATOR", "INTEGRATION_ADMIN", "SYSTEM_CLIENT"])("accepts a correctly signed %s actor", async (role) => {
    setup();
    const app = buildServer();
    try {
      const input = event();
      const response = await app.inject({
        method: "POST", url: "/api/v1/ingest/events",
        headers: { authorization: `Bearer ${token([role])}`, "x-source-system-id": input.source.sourceSystemId, "x-idempotency-key": randomUUID() },
        payload: input
      });
      expect(response.statusCode).toBe(202);
    } finally { await app.close(); }
  });

  it.each([undefined, "", "   ", 42])("rejects a signed token without a usable subject: %s", async (sub) => {
    setup();
    const app = buildServer();
    try {
      const response = await app.inject({
        url: "/api/v1/sources", headers: { authorization: `Bearer ${token(["cop_operator"], sub, sub !== undefined)}` }
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("UNAUTHORIZED");
    } finally { await app.close(); }
  });
});
