import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSimSourceSystem } from "@cop/canonical-model";
import { buildServer } from "./server.js";
import { clearJwksCacheForTests } from "./security.js";
import { createInitialState } from "./state.js";

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
  for (const name of ["COP_CSM_MESSAGING_ENABLED", "COP_FLIGHT_DATA_ENABLED", "COP_MISSION_ARENA_ENABLED", "COP_SAFETY_DATA_ENABLED", "COP_SITUATION_DATA_ENABLED", "COP_TAK_GATEWAY_ENABLED"]) {
    vi.stubEnv(name, "false");
  }
  vi.stubEnv("COP_FEDERATION_STORE", "memory");
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
    geo: { lat: 50, lon: 14 }, quality: { confidence: 1, sourceReliability: "UNKNOWN", informationCredibility: "UNKNOWN" }, simulation: { synthetic: true },
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

describe("source registry administrator authorization", () => {
  it.each(["citizen", "cop_operator", "SYSTEM_CLIENT"])("rejects source mutations by %s before parsing and leaves policy intact", async (role) => {
    setup();
    const state = createInitialState();
    const original = structuredClone(state.sources.get("sim-air-situation-001"));
    const app = buildServer({ state });
    try {
      for (const route of [
        { method: "POST" as const, url: "/api/v1/sources" },
        { method: "PATCH" as const, url: "/api/v1/sources/sim-air-situation-001" },
        { method: "POST" as const, url: "/api/v1/sources/sim-air-situation-001/revoke" }
      ]) {
        const response = await app.inject({ ...route,
          headers: { authorization: `Bearer ${token([role])}`, "content-type": "application/json" }, payload: '{"invalid":'
        });
        expect(response.statusCode).toBe(403);
        expect(response.json().error.code).toBe("SOURCE_MANAGEMENT_FORBIDDEN");
        expect(state.sources.get("sim-air-situation-001")).toEqual(original);
      }
    } finally { await app.close(); }
  });

  it.each(["integration_admin", "SECURITY_ADMIN", "lab"])("preserves source management for the trusted %s actor", async (role) => {
    setup();
    if (role === "lab") {
      vi.stubEnv("COP_AUTH_MODE", "hybrid");
      vi.stubEnv("COP_ALLOW_LAB_TOKEN", "true");
      vi.stubEnv("COP_LAB_TOKEN", "synthetic-registry-service");
    }
    const headers = { authorization: `Bearer ${role === "lab" ? "synthetic-registry-service" : token([role])}` };
    const state = createInitialState();
    const source = { ...createSimSourceSystem(), sourceSystemId: "synthetic-admin-source" };
    const app = buildServer({ state });
    try {
      const created = await app.inject({ method: "POST", url: "/api/v1/sources", headers, payload: source });
      expect(created.statusCode).toBe(201);
      const updated = await app.inject({ method: "PATCH", url: `/api/v1/sources/${source.sourceSystemId}`, headers, payload: { displayName: "Updated synthetic source" } });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().displayName).toBe("Updated synthetic source");
      const revoked = await app.inject({ method: "POST", url: `/api/v1/sources/${source.sourceSystemId}/revoke`, headers });
      expect(revoked.statusCode).toBe(202);
      expect(state.sources.get(source.sourceSystemId)?.status).toBe("REVOKED");
    } finally { await app.close(); }
  });

  it.each([
    { allowedEventTypes: "track.updated" }, { classificationLimit: null }, { synthetic: "false" },
    { unknownPolicyField: true }, { updatedAt: "not-a-date" }, { sourceSystemId: "changed-identity" }, ["invalid"], null
  ])("rejects malformed merged administrator PATCH without modifying the source: %j", async (patch) => {
    setup();
    const state = createInitialState();
    const original = structuredClone(state.sources.get("sim-air-situation-001"));
    const app = buildServer({ state });
    try {
      const response = await app.inject({ method: "PATCH", url: "/api/v1/sources/sim-air-situation-001",
        headers: { authorization: `Bearer ${token(["INTEGRATION_ADMIN"])}`, "content-type": "application/json" }, payload: JSON.stringify(patch)
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
      expect(state.sources.get("sim-air-situation-001")).toEqual(original);
    } finally { await app.close(); }
  });
});

const integrationRoutes = [
  { method: "POST" as const, url: "/api/v1/federation/nodes/node_edge_synthetic/heartbeat" },
  { method: "POST" as const, url: "/api/v1/events/domain" },
  { method: "POST" as const, url: "/api/v1/edge/outbox/flush" },
  { method: "POST" as const, url: "/api/v1/edge/replay-cursors/node_edge_synthetic/ack" },
  { method: "GET" as const, url: "/api/v1/edge/replay/node_edge_synthetic" },
  { method: "GET" as const, url: "/api/v1/events/domain" },
  { method: "GET" as const, url: "/api/v1/events/dead-letter" },
  { method: "GET" as const, url: "/api/v1/events/dead-letter/synthetic-dlq" },
  { method: "POST" as const, url: "/api/v1/events/dead-letter/synthetic-dlq/redrive" },
  { method: "POST" as const, url: "/api/v1/events/dead-letter/synthetic-dlq/resolve" }
];

describe("privileged integration and internal event boundary", () => {
  it.each(["citizen", "cop_operator"])("denies %s every internal event route before reading or mutating state", async (role) => {
    setup();
    const state = createInitialState();
    const originalNodes = structuredClone(state.federatedNodes);
    const app = buildServer({ state });
    try {
      for (const route of integrationRoutes) {
        const response = await app.inject({ ...route,
          headers: { authorization: `Bearer ${token([role])}`, "content-type": "application/json" },
          ...(route.method === "POST" ? { payload: '{"invalid":' } : {})
        });
        expect(response.statusCode).toBe(403);
        expect(response.json().error.code).toBe("INTEGRATION_FORBIDDEN");
      }
      expect(state.domainEvents).toEqual([]);
      expect(state.domainDeadLetters).toEqual([]);
      expect(state.federatedNodes).toEqual(originalNodes);
    } finally { await app.close(); }
  });

  it.each(["cop.events.replay", "cop.events.dead_letters.list"])("prevents REST and JSON-RPC bypass through %s with forged actor parameters", async (toolId) => {
    setup();
    const app = buildServer();
    const headers = { authorization: `Bearer ${token(["citizen"])}` };
    const forgedInput = { actor: { authMode: "lab", roles: ["SYSTEM_CLIENT"] }, roles: ["INTEGRATION_ADMIN"] };
    try {
      const rest = await app.inject({ method: "POST", url: `/api/v1/mcp/tools/${toolId}/invoke`, headers, payload: { input: forgedInput } });
      expect(rest.statusCode).toBe(403);
      expect(rest.json().error.code).toBe("INTEGRATION_FORBIDDEN");
      const rpc = await app.inject({ method: "POST", url: "/api/v1/mcp", headers,
        payload: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: toolId, arguments: forgedInput } }
      });
      expect(rpc.statusCode).toBe(200);
      expect(rpc.json().error).toMatchObject({ code: -32003, message: "Forbidden" });
      expect(rpc.json().result).toBeUndefined();
    } finally { await app.close(); }
  });

  it.each(["INTEGRATION_ADMIN", "SECURITY_ADMIN", "system_client"])("preserves the complete internal event workflow for signed %s", async (role) => {
    setup();
    const app = buildServer();
    const headers = { authorization: `Bearer ${token([role])}` };
    const command = { entityId: "synthetic-internal-incident", entityType: "incident", type: "incident.created",
      payload: { title: "Synthetic internal test data" }, producerNodeId: "node_central_cop",
      classification: { level: "INTERNAL", releasability: ["CIVIL"] }, releasePolicy: { visibility: "internal", allowedScopes: ["internal"] }
    };
    try {
      const heartbeat = await app.inject({ method: "POST", url: "/api/v1/federation/nodes/node_edge_synthetic/heartbeat", headers,
        payload: { capabilities: ["offline-outbox", "domain-events"], classificationMax: "INTERNAL", dataEndpoints: ["https://edge.example.test/api"],
          eventSubscriptions: ["cop.domain.events"], health: "ok", mcpEndpoint: "https://edge.example.test/mcp", nodeName: "Synthetic edge",
          nodeRole: "edge-node", nodeTrustDomain: "synthetic", publicKeyRef: "jwks:synthetic", releaseScopes: ["public", "internal"], softwareVersion: "0.1.0" }
      });
      expect(heartbeat.statusCode).toBe(201);
      expect((await app.inject({ method: "POST", url: "/api/v1/events/domain", headers, payload: command })).statusCode).toBe(202);
      expect((await app.inject({ method: "POST", url: "/api/v1/edge/outbox/flush", headers,
        payload: { nodeId: "node_edge_synthetic", events: [{ ...command, clientEventId: randomUUID() }] } })).statusCode).toBe(202);
      expect((await app.inject({ method: "POST", url: "/api/v1/edge/replay-cursors/node_edge_synthetic/ack", headers, payload: { lastAckedOffset: 1 } })).statusCode).toBe(200);
      expect((await app.inject({ url: "/api/v1/edge/replay/node_edge_synthetic", headers })).statusCode).toBe(200);
      const replay = await app.inject({ url: "/api/v1/events/domain", headers });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().items.length).toBeGreaterThanOrEqual(1);
      for (let index = 0; index < 2; index++) {
        expect((await app.inject({ method: "POST", url: "/api/v1/events/domain", headers, payload: { ...command, producerNodeId: "missing-node" } })).statusCode).toBe(422);
      }
      const dlq = await app.inject({ url: "/api/v1/events/dead-letter", headers });
      expect(dlq.statusCode).toBe(200);
      const [first, second] = dlq.json().items;
      expect((await app.inject({ url: `/api/v1/events/dead-letter/${first.deadLetterId}`, headers })).statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: `/api/v1/events/dead-letter/${first.deadLetterId}/redrive`, headers, payload: { event: command } })).statusCode).toBe(202);
      expect((await app.inject({ method: "POST", url: `/api/v1/events/dead-letter/${second.deadLetterId}/resolve`, headers })).statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: "/api/v1/mcp/tools/cop.events.replay/invoke", headers, payload: {} })).statusCode).toBe(200);
      const rpc = await app.inject({ method: "POST", url: "/api/v1/mcp", headers,
        payload: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "cop.events.dead_letters.list", arguments: {} } } });
      expect(rpc.statusCode).toBe(200);
      expect(rpc.json().result.isError).toBe(false);
    } finally { await app.close(); }
  });
});
