import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryCommunityReportStore } from "./community-report-store.js";
import { updateFederatedNodeHeartbeat, publishDomainEvent } from "./federation.js";
import { clearJwksCacheForTests } from "./security.js";
import { parseServiceAuthBindings } from "./service-auth-policy.js";
import { buildServer } from "./server.js";
import { createInitialState } from "./state.js";
import { InMemoryWebSessionStore } from "./web-session-store.js";

const issuer = "https://identity.example.test/realms/cop";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = "synthetic-service-policy-key";
const nodeId = "node_edge_pilot_01";
const tools = ["cop.area.summary", "cop.community.reports.search", "cop.fusion.explain", "cop.sources.health"];
const edgeBinding = { issuer, clientId: "cop-edge-pilot-sync", subjectId: "synthetic-edge-subject",
  audience: "cop-api", tenantId: "cop", kind: "edge", nodeId, maxClassification: "INTERNAL" };
const mcpBinding = { issuer, clientId: "cop-mcp-readonly", subjectId: "synthetic-mcp-subject",
  audience: "cop-api", tenantId: "cop", kind: "mcp", allowedTools: tools };
const now = new Date("2026-10-12T12:00:00Z");
const heartbeat = { capabilities: ["domain-events", "offline-outbox"], classificationMax: "INTERNAL",
  health: "ok", nodeName: "Synthetic edge", nodeRole: "edge-node", softwareVersion: "0.1.0" };

beforeEach(() => {
  vi.stubEnv("COP_AUTH_MODE", "oidc");
  vi.stubEnv("COP_ALLOW_LAB_TOKEN", "false");
  vi.stubEnv("COP_OIDC_ISSUER", issuer);
  vi.stubEnv("COP_OIDC_JWKS_URI", `${issuer}/jwks`);
  vi.stubEnv("COP_OIDC_ALLOWED_CLIENTS", "cop-web,csm-mobile,cop-edge-pilot-sync,cop-mcp-readonly");
  vi.stubEnv("COP_OIDC_CLIENT_ID", "cop-web");
  vi.stubEnv("COP_OIDC_REQUIRED_ROLE", "");
  vi.stubEnv("COP_SERVICE_AUTH_BINDINGS", JSON.stringify([edgeBinding, mcpBinding]));
  vi.stubEnv("COP_FEDERATION_STORE", "memory");
  for (const flag of ["COP_CSM_MESSAGING_ENABLED", "COP_FLIGHT_DATA_ENABLED", "COP_MISSION_ARENA_ENABLED",
    "COP_SAFETY_DATA_ENABLED", "COP_SITUATION_DATA_ENABLED", "COP_TAK_GATEWAY_ENABLED"]) vi.stubEnv(flag, "false");
  clearJwksCacheForTests();
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (String(url) !== `${issuer}/jwks`) throw new Error("Unexpected synthetic upstream request.");
    return Response.json({ keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }] });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); clearJwksCacheForTests(); });

function token(kind: "edge" | "mcp" = "edge", changes: Record<string, unknown> = {}) {
  const binding = kind === "edge" ? edgeBinding : mcpBinding;
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ iss: issuer, azp: binding.clientId, sub: binding.subjectId,
    aud: "cop-api", cop_tenant_id: "cop", exp: Math.floor(Date.now() / 1000) + 300,
    realm_access: { roles: [] }, ...changes })).toString("base64url");
  const signed = `${header}.${body}`;
  return `${signed}.${createSign("RSA-SHA256").update(signed).sign(pair.privateKey).toString("base64url")}`;
}
function headers(kind: "edge" | "mcp" = "edge", changes: Record<string, unknown> = {}) {
  return { authorization: `Bearer ${token(kind, changes)}`, "x-correlation-id": "synthetic-service-policy" };
}
function outboxEvent(changes: Record<string, unknown> = {}) {
  return { clientEventId: randomUUID(), entityId: randomUUID(), entityType: "incident", type: "incident.created",
    classification: { level: "INTERNAL", releasability: ["CIVIL"], handlingCaveats: [] },
    releasePolicy: { visibility: "internal", allowedScopes: ["edge-node"] }, payload: { title: "Synthetic incident" }, ...changes };
}
function rpc(method: string, params: unknown = {}) {
  return { jsonrpc: "2.0", id: 1, method, params };
}

describe("service binding configuration", () => {
  it.each([undefined, "", " ", "[]"])("keeps unconfigured bindings legacy-compatible (%s)", (raw) => {
    expect(parseServiceAuthBindings(raw)).toEqual([]);
  });
  it("parses the exact Edge and MCP identities without privileged roles", () => {
    expect(parseServiceAuthBindings(JSON.stringify([edgeBinding, mcpBinding]))).toEqual([edgeBinding, mcpBinding]);
  });
  it.each([
    "not-json", "null", "{}", JSON.stringify([{ ...edgeBinding, issuer: `${issuer}/` }]),
    JSON.stringify([{ ...edgeBinding, issuer: "http://identity.example.test" }]),
    JSON.stringify([{ ...edgeBinding, issuer: "https://user:secret@identity.example.test" }]),
    JSON.stringify([{ ...edgeBinding, issuer: `${issuer}?x=y` }]),
    JSON.stringify([{ ...edgeBinding, clientId: "cop-web" }]),
    JSON.stringify([{ ...edgeBinding, subjectId: " synthetic-edge-subject " }]),
    JSON.stringify([{ ...edgeBinding, maxClassification: "SECRET" }]),
    JSON.stringify([{ ...edgeBinding, audience: undefined }]),
    JSON.stringify([{ ...edgeBinding, tenantId: undefined }]),
    JSON.stringify([{ ...edgeBinding, nodeId: "other/node" }]),
    JSON.stringify([{ ...edgeBinding, unknownAuthority: true }]),
    JSON.stringify([edgeBinding, edgeBinding]),
    JSON.stringify([edgeBinding, { ...mcpBinding, subjectId: edgeBinding.subjectId }]),
    JSON.stringify([{ ...mcpBinding, allowedTools: ["cop.audit.events.list"] }]),
    JSON.stringify([{ ...mcpBinding, allowedTools: ["cop.events.replay"] }]),
    JSON.stringify([{ ...mcpBinding, allowedTools: ["cop.federation.nodes.list"] }]),
    JSON.stringify([{ ...mcpBinding, allowedTools: [tools[0], tools[0]] }])
  ])("rejects invalid configured bindings before constructing a server (%s)", (raw) => {
    vi.stubEnv("COP_SERVICE_AUTH_BINDINGS", raw);
    expect(() => buildServer()).toThrow("Invalid service authentication bindings.");
  });
});

describe("verified service authority", () => {
  it.each([
    { azp: "cop-web" },
    { azp: "cop-web", aud: "cop-web", sub: ` ${edgeBinding.subjectId} ` },
    { azp: "unapproved-client", aud: ["cop-api", "cop-web"] },
    { azp: undefined, aud: ["cop-api", edgeBinding.clientId] },
    { azp: undefined, sub: "synthetic-human", aud: ["cop-api", edgeBinding.clientId] },
    { azp: "unapproved-client", sub: "synthetic-human", aud: ["cop-api", edgeBinding.clientId] }
  ])("reserves service principals and rejects the audience-only client fallback (%j)", async (change) => {
    const app = buildServer();
    try {
      const response = await app.inject({ url: "/api/v1/me/preferences",
        headers: headers("edge", { ...change, realm_access: { roles: ["SYSTEM_CLIENT", "SECURITY_ADMIN"] } }) });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("SERVICE_AUTH_FORBIDDEN");
    } finally { await app.close(); }
  });
  it.each([
    { sub: "other-subject" }, { sub: ` ${edgeBinding.subjectId} ` },
    { aud: "other-api" }, { aud: ["unrelated", "other-api"] }, { aud: undefined },
    { cop_tenant_id: "other" }, { cop_tenant_id: undefined }, { cop_tenant_id: { tenant: "cop" } }
  ])("denies a reserved client with a different exact subject/audience/tenant (%j)", async (change) => {
    const app = buildServer();
    try {
      const response = await app.inject({ method: "GET", url: `/api/v1/edge/replay/${nodeId}`,
        headers: headers("edge", { ...change, realm_access: { roles: ["SYSTEM_CLIENT", "SECURITY_ADMIN"] } }) });
      expect(response.statusCode).toBe(403);
      expect(response.json().error).toMatchObject({ code: "SERVICE_AUTH_FORBIDDEN", correlationId: "synthetic-service-policy" });
    } finally { await app.close(); }
  });
  it("does not admit a different issuer or a forged signature through binding claims", async () => {
    const app = buildServer();
    try {
      const different = await app.inject({ url: `/api/v1/edge/replay/${nodeId}`,
        headers: headers("edge", { iss: "https://different.example.test/realms/cop" }) });
      expect(different.statusCode).toBe(401);
      const parts = token().split(".");
      const forged = await app.inject({ url: `/api/v1/edge/replay/${nodeId}`,
        headers: { authorization: `Bearer ${parts[0]}.${parts[1]}.Zm9yZ2Vk` } });
      expect(forged.statusCode).toBe(401);
    } finally { await app.close(); }
  });
  it("accepts the exact audience in an audience array", async () => {
    const app = buildServer();
    try {
      const response = await app.inject({ url: "/api/v1/mcp/tools", headers: headers("mcp", { aud: ["unused", "cop-api"] }) });
      expect(response.statusCode).toBe(200);
      expect(response.json().summary.count).toBe(tools.length);
    } finally { await app.close(); }
  });
  it.each(["cop-web", "csm-mobile"])("preserves ordinary %s profile access without service authority", async (client) => {
    const app = buildServer();
    try {
      const response = await app.inject({ url: "/api/v1/me/preferences",
        headers: headers("edge", { azp: client, sub: "synthetic-human", cop_tenant_id: undefined, aud: client }) });
      expect(response.statusCode).toBe(200);
      expect(response.json().actor.subjectId).toBe("synthetic-human");
      expect(response.json().actor).not.toHaveProperty("clientId");
      expect(response.json().actor).not.toHaveProperty("audiences");
      expect(response.json().actor).not.toHaveProperty("tenantId");
    } finally { await app.close(); }
  });
  it("preserves existing trimming for an ordinary nonreserved user", async () => {
    const app = buildServer();
    try {
      const response = await app.inject({ url: "/api/v1/me/preferences", headers: headers("edge", {
        azp: "cop-web", aud: "cop-web", sub: " synthetic-human "
      }) });
      expect(response.statusCode).toBe(200);
      expect(response.json().actor.subjectId).toBe("synthetic-human");
    } finally { await app.close(); }
  });
  it("preserves ordinary BFF cookie resolution and its origin guard", async () => {
    vi.stubEnv("COP_WEB_BFF_SESSION_ENABLED", "true");
    vi.stubEnv("COP_PUBLIC_URL", "https://cop.example.test");
    const sessions = new InMemoryWebSessionStore();
    const session = await sessions.create({
      accessToken: token("edge", { azp: "cop-web", sub: "synthetic-human", aud: "cop-web" }),
      accessTokenExpiresAt: new Date(Date.now() + 300_000),
      profile: { subjectId: "synthetic-human", name: "Synthetic human", username: "synthetic-human" }
    }, new Date(Date.now() + 86_400_000));
    const app = buildServer({ webSessionStore: sessions });
    try {
      const cookie = `cop_web_session_v1=${session.sessionId}`;
      const profile = await app.inject({ url: "/api/v1/me/preferences", headers: { cookie } });
      expect(profile.statusCode).toBe(200);
      expect(profile.json().actor.subjectId).toBe("synthetic-human");
      const denied = await app.inject({ method: "POST", url: "/api/v1/community/reports",
        headers: { cookie, origin: "https://untrusted.example.test", "content-type": "application/json" }, payload: "{" });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe("BFF_ORIGIN_FORBIDDEN");
    } finally { await app.close(); }
  });
  it("does not treat a service bearer as a BFF cookie session", async () => {
    vi.stubEnv("COP_WEB_BFF_SESSION_ENABLED", "true");
    vi.stubEnv("COP_PUBLIC_URL", "https://cop.example.test");
    const app = buildServer({ webSessionStore: new InMemoryWebSessionStore() });
    try {
      const response = await app.inject({ url: "/api/v1/auth/session", headers: headers("edge") });
      expect(response.statusCode).toBe(401);
      expect(response.json().authenticated).toBe(false);
    } finally { await app.close(); }
  });
});

describe("scoped Edge routes", () => {
  it("permits only own-node sync operations without privileged realm roles", async () => {
    const state = createInitialState();
    const app = buildServer({ state, now: () => now });
    try {
      const registered = await app.inject({ method: "POST", url: `/api/v1/federation/nodes/${nodeId}/heartbeat`,
        headers: headers(), payload: heartbeat });
      expect(registered.statusCode).toBe(201);
      const event = outboxEvent({ producerNodeId: "spoofed-other-node" });
      const flushed = await app.inject({ method: "POST", url: "/api/v1/edge/outbox/flush",
        headers: headers(), payload: { nodeId, events: [event] } });
      expect(flushed.statusCode).toBe(202);
      expect(state.domainEvents.find((item) => item.data.entityId === event.entityId)?.data.producerNodeId).toBe(nodeId);
      const replayed = await app.inject({ url: `/api/v1/edge/replay/${nodeId}`, headers: headers() });
      expect(replayed.statusCode).toBe(200);
      expect(replayed.json().items).toHaveLength(1);
      const acknowledged = await app.inject({ method: "POST", url: `/api/v1/edge/replay-cursors/${nodeId}/ack`,
        headers: headers(), payload: { lastAckedOffset: replayed.json().nextOffset } });
      expect(acknowledged.statusCode).toBe(200);
    } finally { await app.close(); }
  });
  it("denies other nodes and extra methods before parsing even with administrator claims", async () => {
    const app = buildServer();
    try {
      for (const route of [
        { method: "POST" as const, url: "/api/v1/federation/nodes/other/heartbeat" },
        { method: "POST" as const, url: "/api/v1/edge/replay-cursors/other/ack" },
        { method: "GET" as const, url: "/api/v1/edge/replay/other" },
        { method: "GET" as const, url: `/api/v1/edge/replay/${nodeId}%2Fother` },
        { method: "GET" as const, url: "/api/v1/sources" },
        { method: "PATCH" as const, url: "/api/v1/sources/sim-air-situation-001" },
        { method: "POST" as const, url: "/api/v1/ingest/events" },
        { method: "GET" as const, url: "/api/v1/events/dead-letter" },
        { method: "GET" as const, url: "/api/v1/federation/nodes" },
        { method: "GET" as const, url: "/api/v1/me/preferences" },
        { method: "GET" as const, url: "/api/v1/mcp/tools" }
      ]) {
        const denied = await app.inject({ ...route, payload: route.method === "GET" ? undefined : "{",
          headers: { ...headers("edge", { realm_access: { roles: ["SYSTEM_CLIENT", "INTEGRATION_ADMIN", "SECURITY_ADMIN"] } }),
            "content-type": "application/json", "x-node-id": nodeId, "x-source-system-id": "sim-air-situation-001" } });
        expect(denied.statusCode, route.url).toBe(403);
        expect(denied.json().error.code).toBe("SERVICE_AUTH_FORBIDDEN");
      }
    } finally { await app.close(); }
  });
  it.each([
    { nodeRole: "central-orchestrator" }, { classificationMax: "SENSITIVE" }, { classificationMax: "unknown" },
    { releaseScopes: ["all"] }, { nodeTrustDomain: "cop-central" }, { publicKeyRef: "spoofed" },
    { dataEndpoints: ["/api/v1/users"] }, { eventSubscriptions: ["cop.audit.events"] }, { roles: ["SYSTEM_CLIENT"] }
  ])("rejects heartbeat authority escalation (%j)", async (change) => {
    const state = createInitialState();
    updateFederatedNodeHeartbeat(state, nodeId, heartbeat, now);
    const original = structuredClone(state.federatedNodes.get(nodeId));
    const app = buildServer({ state, now: () => now });
    try {
      const denied = await app.inject({ method: "POST", url: `/api/v1/federation/nodes/${nodeId}/heartbeat`,
        headers: headers(), payload: { ...heartbeat, ...change } });
      expect(denied.statusCode).toBe(403);
      expect(state.federatedNodes.get(nodeId)).toEqual(original);
    } finally { await app.close(); }
  });
  it("allows a lower heartbeat classification and cannot repurpose a non-Edge graph node", async () => {
    const state = createInitialState();
    updateFederatedNodeHeartbeat(state, nodeId, heartbeat, now);
    const app = buildServer({ state, now: () => now });
    try {
      const lower = await app.inject({ method: "POST", url: `/api/v1/federation/nodes/${nodeId}/heartbeat`,
        headers: headers(), payload: { ...heartbeat, classificationMax: "PUBLIC" } });
      expect(lower.statusCode).toBe(200);
      expect(lower.json().classificationMax).toBe("PUBLIC");
      state.federatedNodes.get(nodeId)!.nodeRole = "provider-node";
      const denied = await app.inject({ method: "POST", url: `/api/v1/federation/nodes/${nodeId}/heartbeat`,
        headers: headers(), payload: heartbeat });
      expect(denied.statusCode).toBe(403);
      expect(state.federatedNodes.get(nodeId)!.nodeRole).toBe("provider-node");
    } finally { await app.close(); }
  });
  it("checks the entire outbox before mutation and rejects a mismatched body node", async () => {
    const state = createInitialState();
    updateFederatedNodeHeartbeat(state, nodeId, heartbeat, now);
    const app = buildServer({ state, now: () => now });
    try {
      for (const body of [
        { nodeId: "other", events: [outboxEvent()] },
        { nodeId, events: [outboxEvent(), outboxEvent({ classification: { level: "SENSITIVE" } })] },
        { nodeId, events: [outboxEvent(), outboxEvent({ channel: "cop.audit.events" })] },
        { nodeId, events: [outboxEvent(), outboxEvent({ classification: undefined, data: { classification: { level: "SENSITIVE" } } })] }
      ]) {
        const denied = await app.inject({ method: "POST", url: "/api/v1/edge/outbox/flush", headers: headers(), payload: body });
        expect(denied.statusCode).toBe(403);
        expect(state.domainEvents).toHaveLength(0);
        expect(state.domainDeadLetters).toHaveLength(0);
      }
    } finally { await app.close(); }
  });
  it("applies the existing INTERNAL default when a PUBLIC-only service omits classification", async () => {
    vi.stubEnv("COP_SERVICE_AUTH_BINDINGS", JSON.stringify([{ ...edgeBinding, maxClassification: "PUBLIC" }]));
    const state = createInitialState();
    updateFederatedNodeHeartbeat(state, nodeId, { ...heartbeat, classificationMax: "PUBLIC" }, now);
    const app = buildServer({ state, now: () => now });
    try {
      const accepted = await app.inject({ method: "POST", url: "/api/v1/edge/outbox/flush", headers: headers(),
        payload: { nodeId, events: [outboxEvent({ classification: { level: "PUBLIC" } })] } });
      expect(accepted.statusCode).toBe(202);
      const denied = await app.inject({ method: "POST", url: "/api/v1/edge/outbox/flush", headers: headers(),
        payload: { nodeId, events: [outboxEvent({ classification: undefined })] } });
      expect(denied.statusCode).toBe(403);
      expect(state.domainEvents).toHaveLength(1);
      expect(state.domainDeadLetters).toHaveLength(0);
    } finally { await app.close(); }
  });
  it.each(["ai.tool.invoked", "ai.summary.generated", "notification.requested", "source.status.changed"])(
    "denies reserved event type %s even when an allowed channel is explicitly supplied", async (type) => {
      const state = createInitialState();
      updateFederatedNodeHeartbeat(state, nodeId, heartbeat, now);
      const app = buildServer({ state, now: () => now });
      try {
        for (const channel of [undefined, "cop.domain.events", "cop.node.sync"]) {
          const response = await app.inject({ method: "POST", url: "/api/v1/edge/outbox/flush", headers: headers(),
            payload: { nodeId, events: [outboxEvent(), outboxEvent({ type, channel })] } });
          expect(response.statusCode).toBe(403);
          expect(state.domainEvents).toHaveLength(0);
          expect(state.domainDeadLetters).toHaveLength(0);
        }
      } finally { await app.close(); }
    }
  );
  it("caps old graph classification on replay without changing the graph or release policy", async () => {
    const state = createInitialState();
    updateFederatedNodeHeartbeat(state, nodeId, { ...heartbeat, classificationMax: "SENSITIVE" }, now);
    for (const [level, scopes] of [["INTERNAL", ["edge-node"]], ["SENSITIVE", ["edge-node"]], ["INTERNAL", ["private-other-group"]]] as const) {
      publishDomainEvent(state, { producerNodeId: "node_central_cop", type: "incident.created", entityType: "incident",
        entityId: randomUUID(), payload: { title: "Synthetic incident" }, correlationId: randomUUID(),
        classification: { level }, releasePolicy: { visibility: "group", allowedScopes: [...scopes] } }, now);
    }
    const app = buildServer({ state, now: () => now });
    try {
      const replay = await app.inject({ url: `/api/v1/edge/replay/${nodeId}`, headers: headers() });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().items).toHaveLength(1);
      expect(replay.json().policy).toMatchObject({ classificationMax: "INTERNAL", filteredOut: { classification: 1, releasePolicy: 1 } });
      expect(state.federatedNodes.get(nodeId)?.classificationMax).toBe("SENSITIVE");
    } finally { await app.close(); }
  });
  it("fails closed when the stored graph has an unknown classification", async () => {
    const state = createInitialState();
    updateFederatedNodeHeartbeat(state, nodeId, heartbeat, now);
    Object.assign(state.federatedNodes.get(nodeId)!, { classificationMax: "UNKNOWN" });
    const app = buildServer({ state, now: () => now });
    try {
      const response = await app.inject({ url: `/api/v1/edge/replay/${nodeId}`, headers: headers() });
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe("SERVICE_AUTH_POLICY_UNAVAILABLE");
      expect(response.json()).not.toHaveProperty("items");
      expect(state.federatedNodes.get(nodeId)?.classificationMax).toBe("UNKNOWN");
    } finally { await app.close(); }
  });
  it("filters reserved replay channels before graph policy and keeps the highest scanned cursor", async () => {
    const state = createInitialState();
    updateFederatedNodeHeartbeat(state, nodeId, { ...heartbeat, classificationMax: "SENSITIVE" }, now);
    for (const [type, channel] of [
      ["incident.created", "cop.domain.events"], ["sync.conflict.detected", "cop.node.sync"],
      ["ai.tool.invoked", "cop.ai.audit"], ["notification.requested", "cop.notifications.requested"],
      ["source.status.changed", "cop.provider.health"]
    ] as const) {
      publishDomainEvent(state, { producerNodeId: "node_central_cop", type, channel, entityType: "incident",
        entityId: randomUUID(), payload: { title: "Synthetic event" }, correlationId: randomUUID(),
        classification: { level: "INTERNAL" }, releasePolicy: { visibility: "internal", allowedScopes: ["internal"] } }, now);
    }
    const app = buildServer({ state, now: () => now });
    try {
      const response = await app.inject({ url: `/api/v1/edge/replay/${nodeId}`, headers: headers() });
      expect(response.statusCode).toBe(200);
      expect(response.json().items.map((event: { channel: string }) => event.channel)).toEqual(["cop.domain.events", "cop.node.sync"]);
      expect(response.json().nextOffset).toBe(5);
      expect(response.json().policy.filteredOut).toEqual({ classification: 0, releasePolicy: 0, serviceScope: 3 });
      const ordinary = await app.inject({ url: `/api/v1/edge/replay/${nodeId}`, headers: headers("edge", {
        azp: "cop-web", sub: "synthetic-admin", realm_access: { roles: ["SECURITY_ADMIN"] }
      }) });
      expect(ordinary.statusCode).toBe(200);
      expect(ordinary.json().items).toHaveLength(5);
      expect(ordinary.json().policy.filteredOut).not.toHaveProperty("serviceScope");
    } finally { await app.close(); }
  });
});

describe("scoped MCP requests", () => {
  it("filters metadata and both advertised registries to the configured public tools", async () => {
    vi.stubEnv("COP_SERVICE_AUTH_BINDINGS", JSON.stringify([{ ...mcpBinding, allowedTools: ["cop.sources.health"] }]));
    const app = buildServer();
    try {
      const meta = await app.inject({ url: "/api/v1/mcp", headers: headers("mcp") });
      expect(meta.statusCode).toBe(200);
      expect(meta.json().summary.toolCount).toBe(1);
      const registry = await app.inject({ url: "/api/v1/mcp/tools", headers: headers("mcp") });
      expect(registry.json().items.map((item: { toolId: string }) => item.toolId)).toEqual(["cop.sources.health"]);
      const listed = await app.inject({ method: "POST", url: "/api/v1/mcp", headers: headers("mcp"), payload: rpc("tools/list") });
      expect(listed.json().result.tools.map((item: { name: string }) => item.name)).toEqual(["cop.sources.health"]);
    } finally { await app.close(); }
  });
  it.each(tools)("permits the public %s tool through both transports without privileged roles", async (tool) => {
    const app = buildServer({ now: () => now });
    try {
      const input = { bbox: [13, 49, 16, 51] };
      const direct = await app.inject({ method: "POST", url: `/api/v1/mcp/tools/${tool}/invoke`, headers: headers("mcp"), payload: { input } });
      expect(direct.statusCode).toBe(200);
      expect(direct.json().status).toBe("ok");
      const jsonRpc = await app.inject({ method: "POST", url: "/api/v1/mcp", headers: headers("mcp"),
        payload: rpc("tools/call", { name: tool, arguments: input }) });
      expect(jsonRpc.statusCode).toBe(200);
      expect(jsonRpc.json().result.isError).toBe(false);
    } finally { await app.close(); }
  });
  it.each(["initialize", "ping", "notifications/initialized"])("keeps approved protocol method %s", async (method) => {
    const app = buildServer();
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/mcp", headers: headers("mcp"), payload: rpc(method) });
      expect(response.statusCode).toBe(method === "notifications/initialized" ? 204 : 200);
    } finally { await app.close(); }
  });
  it("denies unapproved REST tools before parsing even with spoofed administrator roles", async () => {
    const app = buildServer();
    try {
      for (const tool of ["cop.events.replay", "cop.events.dead_letters.list", "cop.audit.events.list", "cop.federation.nodes.list"]) {
        const response = await app.inject({ method: "POST", url: `/api/v1/mcp/tools/${tool}/invoke`,
          headers: { ...headers("mcp", { realm_access: { roles: ["SYSTEM_CLIENT", "SECURITY_ADMIN"] } }), "content-type": "application/json" }, payload: "{" });
        expect(response.statusCode).toBe(403);
        expect(response.json().error.code).toBe("SERVICE_AUTH_FORBIDDEN");
      }
    } finally { await app.close(); }
  });
  it("rejects an entire mixed batch before any tool or notification executes", async () => {
    const state = createInitialState();
    const app = buildServer({ state });
    try {
      for (const forbidden of [rpc("tools/call", { name: "cop.audit.events.list" }), rpc("unsupported/method")]) {
        const response = await app.inject({ method: "POST", url: "/api/v1/mcp", headers: headers("mcp"),
          payload: [rpc("tools/call", { name: "cop.sources.health" }), forbidden] });
        expect(response.statusCode).toBe(403);
        expect(state.auditEvents.filter((event) => event.eventType === "MCP_TOOL_INVOKED")).toHaveLength(0);
        expect(state.domainEvents).toHaveLength(0);
      }
    } finally { await app.close(); }
  });
  it("cannot read its own private reports through a public MCP binding", async () => {
    const reports = new InMemoryCommunityReportStore();
    for (const visibility of ["private", "public"] as const) {
      const report = await reports.createReport({ category: "hazard", createdBy: { subjectId: mcpBinding.subjectId,
        displayName: "Synthetic service", username: "synthetic-service" }, location: { lat: 50, lon: 14, source: "manual" },
        observedAt: now.toISOString(), title: `${visibility} synthetic report`, visibility }, now);
      await reports.submitReport(report.reportId, mcpBinding.subjectId, now);
    }
    const app = buildServer({ communityReportStore: reports, now: () => now });
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/mcp/tools/cop.community.reports.search/invoke",
        headers: headers("mcp", { realm_access: { roles: ["SYSTEM_CLIENT", "SECURITY_ADMIN"] } }),
        payload: { input: { bbox: [13, 49, 16, 51], includePartner: true, roles: ["SECURITY_ADMIN"] } } });
      expect(response.statusCode).toBe(200);
      expect(response.json().result.items.map((report: { title: string }) => report.title)).toEqual(["public synthetic report"]);
    } finally { await app.close(); }
  });
  it("cannot access unrelated private routes and preserves unbound administrator behavior", async () => {
    const app = buildServer();
    try {
      const denied = await app.inject({ url: "/api/v1/me/preferences", headers: headers("mcp") });
      expect(denied.statusCode).toBe(403);
      const ordinary = await app.inject({ url: "/api/v1/mcp/tools", headers: headers("mcp", {
        azp: "cop-web", sub: "synthetic-admin", realm_access: { roles: ["SECURITY_ADMIN"] }
      }) });
      expect(ordinary.statusCode).toBe(200);
      expect(ordinary.json().items.map((tool: { toolId: string }) => tool.toolId)).toContain("cop.audit.events.list");
    } finally { await app.close(); }
  });
});
