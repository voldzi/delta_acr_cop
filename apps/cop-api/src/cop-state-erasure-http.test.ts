import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { Pool, type PoolConfig } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { ACCOUNT_ERASURE_ADAPTER_IDS, AccountErasureService } from "./account-erasure.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import { PostgresTrackHistoryStore } from "./track-history-store.js";
import { PostgresFederationRuntimeStore } from "./federation-runtime-store.js";
import { getCopStateProjectionOwner } from "./cop-state-erasure.js";
import { clearJwksCacheForTests } from "./security.js";
import { runtimeSubjectHash } from "./runtime-owner-erasure.js";
import type { DomainEventPublishInput } from "./federation.js";
import type { CopState } from "./types.js";
import type { CanonicalEventEnvelope } from "@cop/canonical-model";

const connectionString = process.env.COP_ERASURE_TEST_DATABASE_URL;
if (connectionString) { const url = new URL(connectionString); if (url.hostname !== "127.0.0.1" || url.pathname !== "/cop_erasure_test") throw new Error("Requires isolated loopback cop_erasure_test database"); }
const issuer = "https://identity.state-http.synthetic.test/realms/cop", subjectId = "6f0df9e2-3bcd-4e46-8914-1642b1f0c6ce";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "synthetic-state-http", alg: "RS256", use: "sig" };
function bearer(sub = subjectId) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url"), timestamp = Math.floor(Date.now() / 1000);
  const content = encode({ alg: "RS256", kid: jwk.kid }) + "." + encode({ iss: issuer, sub, azp: "csm-mobile", exp: timestamp + 300, auth_time: timestamp,
    preferred_username: "synthetic-operator", realm_access: { roles: ["COP_OPERATOR", "SYSTEM_CLIENT"] } });
  return "Bearer " + content + "." + createSign("RSA-SHA256").update(content).end().sign(privateKey).toString("base64url");
}
function event(): CanonicalEventEnvelope {
  return { eventId: randomUUID(), eventType: "track.updated", contractVersion: "cop-ingest-v1", correlationId: randomUUID(),
    source: { sourceSystemId: "sim-air-situation-001", adapterId: "synthetic", adapterVersion: "1" }, producerTimestamp: new Date().toISOString(),
    classification: { level: "UNCLASSIFIED", releasability: ["CZ"], handlingCaveats: [] }, geo: { lat: 50, lon: 14 },
    quality: { confidence: 1, sourceReliability: "UNKNOWN", informationCredibility: "UNKNOWN" }, simulation: { synthetic: true },
    payload: { objectId: randomUUID(), objectType: "AIRCRAFT", domain: "AIR", affiliation: "FRIEND", status: "ACTIVE", ownerSubjectId: subjectId } };
}
function domainEvent(producerNodeId = "node_central_cop"): DomainEventPublishInput {
  return { entityType: "communityReport", entityId: randomUUID(), eventId: randomUUID(), producerNodeId,
    correlationId: "synthetic-local-origin", type: "report.created", payload: { title: "Synthetic report" } };
}
async function fixture() {
  for (const [key, value] of Object.entries({ NODE_ENV: "test", COP_AUTH_MODE: "oidc", COP_OIDC_ISSUER: issuer, COP_OIDC_ALLOWED_CLIENTS: "csm-mobile,cop-web", COP_OIDC_REQUIRED_ROLE: "",
    COP_ALLOW_LAB_TOKEN: "false", COP_DATABASE_URL: "", COP_ACCOUNT_ERASURE_ENABLED: "false", COP_ACCOUNT_SAFETY_GUARD_REQUIRED: "false", COP_ACCOUNT_SAFETY_STORE_ID: "",
    COP_WEB_BFF_SESSION_ENABLED: "false", COP_FLIGHT_DATA_ENABLED: "false", COP_SITUATION_DATA_ENABLED: "false", COP_SAFETY_DATA_ENABLED: "false", COP_TAK_GATEWAY_ENABLED: "false",
    COP_SIM_SEARCH_DATA_ENABLED: "false", COP_CSM_MESSAGING_ENABLED: "false", COP_AI_CONTEXT_INDEX_ENABLED: "false", COP_AI_SEMANTIC_RETRIEVAL_ENABLED: "false", COP_SAFETY_NOTIFICATIONS_ENABLED: "false" })) vi.stubEnv(key, value);
  clearJwksCacheForTests();
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    if (String(input).endsWith("/protocol/openid-connect/certs")) return Response.json({ keys: [jwk] });
    throw new Error("Unexpected external access in synthetic state HTTP fixture");
  }));
  const admin = new Pool({ connectionString, max: 2 }), schema = "cop_state_http_" + randomUUID().replaceAll("-", "");
  await admin.query(`CREATE SCHEMA ${schema}`);
  const config: PoolConfig = { connectionString, max: 3, options: `-c search_path=${schema}` };
  const history = new PostgresTrackHistoryStore(config), federation = new PostgresFederationRuntimeStore(config), store = new MemoryMobilityStore();
  // Provider fixtures intentionally remain pending. Only real server state,
  // signed authentication, admitted job fences and SQL stores are under test.
  const service = new AccountErasureService({ store, allowUnboundSyntheticStore: true, issuer, identitySecret: "synthetic-state-http-erasure-secret-32-plus", requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS,
    accepted: true, adapters: ACCOUNT_ERASURE_ADAPTER_IDS.map(id => ({ id, ready: async () => true, preflight: async () => ({ ready: true, version: "synthetic-provider-fixture" }),
      erase: async () => ({ status: "pending" as const, remaining: "cleanup_pending" as const }) })) });
  const app = buildServer({ accountErasure: service, mobilityStore: store, trackHistoryStore: history, federationRuntimeStore: federation });
  try { await app.ready(); }
  catch (error) {
    try { await app.close(); }
    finally { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
    throw error;
  }
  const state = app.getDecorator<CopState>("copState");
  return { app, state, service, history, federation, admin, schema, async close() { await app.close(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); clearJwksCacheForTests(); });

describe.skipIf(!connectionString)("actual account-guarded COP RAM projection HTTP integration", () => {
  it("uses the installed state instance for authenticated ingest and blocks late background writes after the accepted job commits", async () => {
    const f = await fixture();
    try {
      const port = getCopStateProjectionOwner(f.state);
      expect(port, "Root must install the actual state producer binding; no test-side installation").toBeDefined();
      expect(port!.producerBindingInstalled()).toBe(true);
      const value = event(), headers = { authorization: bearer(), "x-idempotency-key": randomUUID(), "x-source-system-id": value.source.sourceSystemId };
      const accepted = await f.app.inject({ method: "POST", url: "/api/v1/ingest/events", headers, payload: value });
      expect(accepted.statusCode, accepted.body).toBe(202);
      expect(f.state.objects.get(value.payload.objectId)?.ownerSubjectId).toBe(subjectId);
      const deadline = Date.now() + 3000;
      while ((await f.history.countCurrent()) !== 1 || (await f.history.count()) !== 1) {
        if (Date.now() >= deadline) throw new Error("Actual track persistence did not settle");
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      expect((await port!.preflight({ issuer, subjectId })).ready).toBe(true);
      const heartbeat = await f.app.inject({ method: "POST", url: "/api/v1/federation/nodes/node_central_cop/heartbeat", headers,
        payload: { nodeRole: "central-orchestrator", health: "ok", nodeName: "Synthetic COP" } });
      expect(heartbeat.statusCode, heartbeat.body).toBe(200);
      const actor = { authMode: "oidc" as const, issuer, subjectId, username: "synthetic-operator", displayName: "Synthetic", authTime: Math.floor(Date.now() / 1000) }, operation = randomUUID();
      const prepared = await f.service.preflight(actor, operation);
      await f.service.request(actor, operation, { confirmAccountDeletion: true }, { planId: prepared.response.planId!, capability: prepared.capability! });
      expect(() => f.state.objects.set(randomUUID(), { ...value.payload, objectId: randomUUID() })).toThrow();
      expect(() => port!.assertWriteAllowed({ subjectId })).toThrow();
      expect((await f.app.inject({ url: "/api/v1/me/preferences", headers })).statusCode).toBe(403);
      expect((await f.app.inject({ url: "/api/v1/me/preferences", headers: { authorization: bearer("synthetic-unrelated-user") } })).statusCode).toBe(200);
      expect(f.state.objects.size).toBe(1);
    } finally { await f.close(); }
  });

  it("resolves a cold third-party dead letter without adopting its body and clears only the verified resolver link", async () => {
    const f = await fixture();
    try {
      const other = { issuer, subjectId: "synthetic-third-party" };
      const original = await f.federation.appendDeadLetter({ body: { subjectId: other.subjectId, text: "Synthetic third-party content" }, owner: other,
        correlationId: "synthetic", errorCode: "SYNTHETIC", message: "synthetic" });
      expect(f.state.domainDeadLetters).toEqual([]);
      const resolved = await f.app.inject({ method: "POST", url: `/api/v1/events/dead-letter/${original.deadLetterId}/resolve`, headers: { authorization: bearer() }, payload: {} });
      expect(resolved.statusCode, resolved.body).toBe(200);
      const port = getCopStateProjectionOwner(f.state)!;
      expect((await port.preflight({ issuer, subjectId })).ready).toBe(true);
      const context = { operationId: randomUUID(), actor: { issuer, subjectId }, signal: new AbortController().signal };
      expect(await port.erase({ reportIds: [], groupIds: [] }, context)).toBe(true);
      expect(f.state.domainDeadLetters).toHaveLength(1);
      expect(f.state.domainDeadLetters[0]?.body).toEqual(original.body);
      expect(f.state.domainDeadLetters[0]?.resolvedBy).toBeUndefined();
      expect(await f.federation.eraseResourceProjections({ reportIds: [], groupIds: [] }, context)).toBe(true);
      expect((await f.federation.getDeadLetter(original.deadLetterId))?.body).toEqual(original.body);
      expect((await f.federation.getDeadLetter(original.deadLetterId))?.resolvedBy).toBeUndefined();
      expect(JSON.stringify(resolved.json())).not.toContain("resolved_by_issuer");
    } finally { await f.close(); }
  });

  it("does not acquire a trusted witness by resolving an already resolved legacy record", async () => {
    const f = await fixture();
    try {
      const original = await f.federation.appendDeadLetter({ body: { text: "Legacy synthetic content" }, correlationId: "synthetic", errorCode: "SYNTHETIC", message: "synthetic" });
      await f.federation.resolveDeadLetter(original.deadLetterId, { resolvedBy: subjectId });
      const resolved = await f.app.inject({ method: "POST", url: `/api/v1/events/dead-letter/${original.deadLetterId}/resolve`, headers: { authorization: bearer() }, payload: {} });
      expect(resolved.statusCode, resolved.body).toBe(200);
      expect((await getCopStateProjectionOwner(f.state)!.preflight({ issuer, subjectId })).ready).toBe(false);
      expect((await f.federation.preflightActorProjections({ issuer, subjectId })).ready).toBe(false);
    } finally { await f.close(); }
  });

  it("keeps cursor offsets and other operators while erasing only the verified actor association from SQL and RAM", async () => {
    const f = await fixture();
    try {
      const other = "synthetic-other-operator";
      for (const [nodeId, owner] of [["synthetic-edge-a", subjectId], ["synthetic-edge-b", other]]) {
        expect((await f.app.inject({ method: "POST", url: `/api/v1/federation/nodes/${nodeId}/heartbeat`, headers: { authorization: bearer(owner) },
          payload: { nodeRole: "edge-node", nodeName: nodeId, health: "ok", capabilities: ["domain-events"] } })).statusCode).toBe(201);
        const ack = await f.app.inject({ method: "POST", url: `/api/v1/edge/replay-cursors/${nodeId}/ack`, headers: { authorization: bearer(owner) }, payload: { lastAckedOffset: 50 } });
        expect(ack.statusCode, ack.body).toBe(200); expect(JSON.stringify(ack.json())).not.toContain(issuer);
      }
      const port = getCopStateProjectionOwner(f.state)!, actor = { issuer, subjectId }, context = { operationId: randomUUID(), actor, signal: new AbortController().signal };
      expect((await port.preflight(actor)).ready).toBe(true);
      expect(await port.erase({ reportIds: [], groupIds: [] }, context)).toBe(true);
      expect(await f.federation.eraseResourceProjections({ reportIds: [], groupIds: [] }, context)).toBe(true);
      const erased = await f.app.inject({ url: "/api/v1/edge/replay-cursors/synthetic-edge-a", headers: { authorization: bearer(other) } });
      const retained = await f.app.inject({ url: "/api/v1/edge/replay-cursors/synthetic-edge-b", headers: { authorization: bearer(other) } });
      expect(erased.statusCode, erased.body).toBe(200); expect(erased.json().cursor.lastAckedOffset).toBe(50); expect(erased.json().cursor.updatedBy).toBeUndefined();
      expect(retained.statusCode, retained.body).toBe(200); expect(retained.json().cursor).toMatchObject({ lastAckedOffset: 50, updatedBy: other });
    } finally { await f.close(); }
  });

  it("keeps a read-only legacy cursor unknown until a separately verified new acknowledgement replaces that association", async () => {
    const f = await fixture();
    try {
      const nodeId = "synthetic-edge-legacy";
      await f.app.inject({ method: "POST", url: `/api/v1/federation/nodes/${nodeId}/heartbeat`, headers: { authorization: bearer("synthetic-admin") }, payload: { nodeRole: "edge-node", nodeName: nodeId, health: "ok" } });
      await f.federation.updateEdgeCursor({ nodeId, lastAckedOffset: 40, updatedBy: subjectId });
      const read = await f.app.inject({ url: `/api/v1/edge/replay-cursors/${nodeId}`, headers: { authorization: bearer() } });
      expect(read.statusCode, read.body).toBe(200);
      const port = getCopStateProjectionOwner(f.state)!;
      expect((await port.preflight({ issuer, subjectId })).ready).toBe(false);
      const updated = await f.app.inject({ method: "POST", url: `/api/v1/edge/replay-cursors/${nodeId}/ack`, headers: { authorization: bearer() }, payload: { lastAckedOffset: 41 } });
      expect(updated.statusCode, updated.body).toBe(200);
      expect((await port.preflight({ issuer, subjectId })).ready).toBe(true);
      expect((await f.federation.getEdgeCursorProjection(nodeId))?.owner).toEqual({ issuer, subjectId });
    } finally { await f.close(); }
  });

  it("records the verified session origin for local domain events without a body subject and preserves another actor's event", async () => {
    const f = await fixture();
    try {
      const other = "synthetic-other-domain-author", own = domainEvent(), foreign = domainEvent();
      for (const [input, sub] of [[own, subjectId], [foreign, other]] as const) {
        const response = await f.app.inject({ method: "POST", url: "/api/v1/events/domain", headers: { authorization: bearer(sub) }, payload: input });
        expect(response.statusCode, response.body).toBe(202);
        expect(response.json().event.subject).toBe(input.entityId);
        expect(response.json().event).not.toHaveProperty("ownerIssuer");
        expect(response.body).not.toContain("owner_subject_hash");
        const persisted = await f.admin.query(`SELECT owner_issuer,owner_subject_hash FROM ${f.schema}.cop_domain_events WHERE event_id=$1`, [input.eventId]);
        expect(persisted.rows).toEqual([{ owner_issuer: issuer, owner_subject_hash: runtimeSubjectHash(sub) }]);
      }
      const actor = { issuer, subjectId }, port = getCopStateProjectionOwner(f.state)!;
      expect((await port.preflight(actor)).ready).toBe(true);
      expect((await f.federation.preflightActorProjections(actor)).ready).toBe(true);
      const context = { operationId: randomUUID(), actor, signal: new AbortController().signal };
      expect(await port.erase({ reportIds: [], groupIds: [] }, context)).toBe(true);
      expect(f.state.domainEvents.map(value => value.id)).toEqual([foreign.eventId]);
      expect(await f.federation.eraseResourceProjections({ reportIds: [], groupIds: [] }, context)).toBe(true);
      const retained = await f.admin.query(`SELECT event_id,owner_subject_hash FROM ${f.schema}.cop_domain_events`);
      expect(retained.rows).toEqual([{ event_id: foreign.eventId, owner_subject_hash: runtimeSubjectHash(other) }]);
    } finally { await f.close(); }
  });

  it("does not let body owner claims choose a local event owner and rejects a mismatched explicit subject before publication", async () => {
    const f = await fixture();
    try {
      const other = "synthetic-forged-domain-author", input = domainEvent();
      input.payload = { title: "Synthetic report", ownerSubjectId: other, ownerIssuer: "https://forged.synthetic.test", userId: other };
      const accepted = await f.app.inject({ method: "POST", url: "/api/v1/events/domain", headers: { authorization: bearer() }, payload: input });
      expect(accepted.statusCode, accepted.body).toBe(202);
      const persisted = await f.admin.query(`SELECT owner_issuer,owner_subject_hash FROM ${f.schema}.cop_domain_events WHERE event_id=$1`, [input.eventId]);
      expect(persisted.rows).toEqual([{ owner_issuer: issuer, owner_subject_hash: runtimeSubjectHash(subjectId) }]);
      const rejectedInput = { ...domainEvent(), subject: other };
      const rejected = await f.app.inject({ method: "POST", url: "/api/v1/events/domain", headers: { authorization: bearer() }, payload: rejectedInput });
      expect(rejected.statusCode, rejected.body).toBe(401);
      expect(rejected.json().error.code).toBe("PROJECTION_OWNER_MISMATCH");
      expect((await f.admin.query(`SELECT 1 FROM ${f.schema}.cop_domain_events WHERE event_id=$1`, [rejectedInput.eventId])).rowCount).toBe(0);
      expect(f.state.domainEvents.map(value => value.id)).toEqual([input.eventId]);
    } finally { await f.close(); }
  });

  it("keeps foreign and persisted legacy event origins unknown when replayed by the current signed actor", async () => {
    const f = await fixture();
    try {
      const foreign = domainEvent("node_sim_provider"), legacy = { ...domainEvent(), subject: subjectId };
      foreign.payload = { title: "Synthetic imported report", subjectId, ownerIssuer: issuer };
      const imported = await f.app.inject({ method: "POST", url: "/api/v1/events/domain", headers: { authorization: bearer() }, payload: foreign });
      expect(imported.statusCode, imported.body).toBe(202);
      await f.federation.publishEvent(legacy);
      const replay = await f.app.inject({ url: "/api/v1/events/domain?limit=10", headers: { authorization: bearer() } });
      expect(replay.statusCode, replay.body).toBe(200);
      expect(replay.json().items.map((value: { id: string }) => value.id)).toEqual([foreign.eventId, legacy.eventId]);
      const persisted = await f.admin.query(`SELECT event_id,owner_issuer,owner_subject_hash FROM ${f.schema}.cop_domain_events ORDER BY replay_offset`);
      expect(persisted.rows).toEqual([foreign, legacy].map(input => ({ event_id: input.eventId, owner_issuer: null, owner_subject_hash: null })));
      const actor = { issuer, subjectId }, port = getCopStateProjectionOwner(f.state)!;
      expect((await port.preflight(actor)).ready).toBe(false);
      expect((await f.federation.preflightActorProjections(actor)).ready).toBe(false);
      const context = { operationId: randomUUID(), actor, signal: new AbortController().signal };
      expect(await port.erase({ reportIds: [], groupIds: [] }, context)).toBe(false);
      expect(f.state.domainEvents.map(value => value.id)).toEqual([foreign.eventId]);
      expect(await f.federation.eraseResourceProjections({ reportIds: [], groupIds: [] }, context)).toBe(false);
      expect(await f.federation.countEvents()).toBe(2);
    } finally { await f.close(); }
  });

  it("cannot attest a cold duplicate from another actor or legacy storage, while allowing the original actor's idempotent retry", async () => {
    const f = await fixture();
    try {
      const own = domainEvent(), foreign = domainEvent(), legacy = domainEvent();
      await f.federation.publishEvent(own, new Date(), { issuer, subjectId });
      await f.federation.publishEvent(foreign, new Date(), { issuer, subjectId: "synthetic-existing-other-author" });
      await f.federation.publishEvent(legacy);
      const before = (await f.admin.query(`SELECT event_id,event_json,owner_issuer,owner_subject_hash FROM ${f.schema}.cop_domain_events ORDER BY replay_offset`)).rows;
      expect(f.state.domainEvents).toEqual([]);
      for (const input of [foreign, legacy]) {
        const rejected = await f.app.inject({ method: "POST", url: "/api/v1/events/domain", headers: { authorization: bearer() }, payload: input });
        expect(rejected.statusCode, rejected.body).toBe(503);
        expect(rejected.json().error.code).toBe("CONTENT_PROJECTION_UNAVAILABLE");
        expect(f.state.domainEvents).toEqual([]);
      }
      const repeated = await f.app.inject({ method: "POST", url: "/api/v1/events/domain", headers: { authorization: bearer() }, payload: own });
      expect(repeated.statusCode, repeated.body).toBe(202);
      expect(f.state.domainEvents.map(value => value.id)).toEqual([own.eventId]);
      expect((await getCopStateProjectionOwner(f.state)!.preflight({ issuer, subjectId })).ready).toBe(true);
      expect((await f.admin.query(`SELECT event_id,event_json,owner_issuer,owner_subject_hash FROM ${f.schema}.cop_domain_events ORDER BY replay_offset`)).rows).toEqual(before);
    } finally { await f.close(); }
  });
});
