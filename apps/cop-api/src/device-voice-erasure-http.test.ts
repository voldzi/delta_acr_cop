import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { InMemoryMobileDeviceStore } from "./mobile-device-store.js";
import { InMemoryVoiceCallStore } from "./voice-call-store.js";
import { CsmMessagingProvider } from "./messaging-provider.js";
import { AccountErasureError, AccountErasureService, ACCOUNT_ERASURE_ADAPTER_IDS } from "./account-erasure.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import { clearJwksCacheForTests } from "./security.js";

const issuer = "https://identity.synthetic.test/realms/cop", now = new Date("2026-10-14T00:00:00.000Z");
const owner = { issuer, subjectId: "synthetic-a" };
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "synthetic-device-voice", alg: "RS256", use: "sig" };
function bearer(subject = owner.subjectId) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const content = encode({ alg: "RS256", kid: jwk.kid }) + "." + encode({ iss: issuer, sub: subject, azp: "csm-mobile", exp: Math.floor(Date.now() / 1000) + 300 });
  return "Bearer " + content + "." + createSign("RSA-SHA256").update(content).end().sign(privateKey).toString("base64url");
}
async function fixture(withGuard = false) {
  for (const [key, value] of Object.entries({ COP_AUTH_MODE: "oidc", COP_OIDC_ISSUER: issuer, COP_OIDC_ALLOWED_CLIENTS: "csm-mobile,cop-web",
    COP_OIDC_REQUIRED_ROLE: "", COP_ALLOW_LAB_TOKEN: "false", COP_DATABASE_URL: "", COP_ACCOUNT_ERASURE_ENABLED: "false",
    COP_ACCOUNT_ERASURE_SECRET: "", COP_ACCOUNT_SAFETY_GUARD_REQUIRED: "false", COP_ACCOUNT_SAFETY_STORE_ID: "",
    COP_WEB_BFF_SESSION_ENABLED: "false", COP_VOICE_CALLS_ENABLED: "false" })) vi.stubEnv(key, value);
  clearJwksCacheForTests();
  vi.stubGlobal("fetch", vi.fn(async (resource: string | URL | Request) => {
    if (String(resource).endsWith("/protocol/openid-connect/certs")) return Response.json({ keys: [jwk] });
    throw new Error("Unexpected external request in synthetic HTTP fixture");
  }));
  const devices = new InMemoryMobileDeviceStore(), calls = new InMemoryVoiceCallStore();
  const provider = new CsmMessagingProvider({ baseUrl: "https://messaging.synthetic.test", enabled: false, cacheTtlMs: 0, timeoutMs: 100 });
  vi.spyOn(provider, "fetchConversationByRoomId").mockResolvedValue({ contractVersion: "cop-messaging-conversations-v1", providerId: "csm.messaging", enabled: true, status: "online", warnings: [],
    conversation: { conversationId: "synthetic", conversationKind: "direct", type: "direct", title: "Synthetic", directPeer: { userId: "synthetic-b" }, members: [{ userId: owner.subjectId }, { userId: "synthetic-b" }] } });
  const notify = vi.spyOn(provider, "sendNotification").mockResolvedValue({ contractVersion: "cop-messaging-notification-v1", providerId: "csm.messaging", enabled: true, status: "online", warnings: [] });
  const issue = vi.fn(async () => ({ e2eeKey: "synthetic-e2ee", expiresAt: new Date(now.getTime() + 120_000).toISOString(), serverUrl: "wss://synthetic-media.test", token: "synthetic-media-token" }));
  const mobility = new MemoryMobilityStore();
  const guard = withGuard ? new AccountErasureService({ store: mobility, allowUnboundSyntheticStore: true, identitySecret: "synthetic-erasure-secret-at-least-32-characters",
    issuer, accepted: false, requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS, adapters: [], now: () => now }) : undefined;
  const app = buildServer({ mobileDeviceStore: devices, voiceCallStore: calls, messagingProvider: provider, voiceCallMediaIssuer: { enabled: true, issue },
    ...(guard ? { accountErasure: guard, mobilityStore: mobility } : {}), now: () => now });
  await app.ready();
  const headers = { authorization: bearer(), "x-correlation-id": "synthetic-owner-http" };
  return { app, devices, calls, issue, headers, guard, notify };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); clearJwksCacheForTests(); });
const registration = { deviceId: "synthetic-device", appVersion: "1", platform: "ios", pushToken: "synthetic-only-token", ownerIssuer: "https://forged.example.test", subjectId: "forged-owner" };
const incoming = { ownerIssuer: issuer, initiatorSubjectId: "synthetic-b", participantSubjectIds: [owner.subjectId], roomId: "!synthetic:example.test", title: "Synthetic", kind: "direct" as const,
  now: now.toISOString(), expiresAt: new Date(now.getTime() + 90_000).toISOString() };

describe("actual COP device / voice erasure HTTP wiring", () => {
  it("derives device/mesh/pairing provenance from signed identity and hides every internal issuer field", async () => {
    const f = await fixture();
    try {
      const registered = await f.app.inject({ method: "POST", url: "/api/v1/mobile/devices", headers: f.headers, payload: registration });
      expect(registered.statusCode).toBe(202);
      expect((await f.devices.listDevices(owner.subjectId))[0]?.ownerIssuer).toBe(issuer);
      expect((await f.devices.listDevices("forged-owner"))).toEqual([]);
      expect(JSON.stringify(registered.json())).not.toContain("ownerIssuer");
      const listed = await f.app.inject({ url: "/api/v1/mobile/devices", headers: f.headers });
      expect(JSON.stringify(listed.json())).not.toContain("ownerIssuer");
      const created = await f.app.inject({ method: "POST", url: "/api/v1/mobile/pairing/sessions", headers: f.headers, payload: {} });
      const code = created.json().pairing.code as string;
      expect(created.statusCode).toBe(201);
      expect((await f.devices.getPairingSession(code, now.toISOString()))?.createdBy.ownerIssuer).toBe(issuer);
      expect(JSON.stringify(created.json())).not.toContain("ownerIssuer");
      const claimed = await f.app.inject({ method: "POST", url: `/api/v1/mobile/pairing/sessions/${code}/claim`, headers: f.headers, payload: registration });
      expect(claimed.statusCode).toBe(200); expect(JSON.stringify(claimed.json())).not.toContain("ownerIssuer");
      const confirmed = await f.app.inject({ method: "POST", url: `/api/v1/mobile/pairing/sessions/${code}/confirm`, headers: f.headers, payload: {} });
      expect(confirmed.statusCode).toBe(200); expect(JSON.stringify(confirmed.json())).not.toContain("ownerIssuer");
      const mesh = await f.app.inject({ method: "POST", url: "/api/v1/mobile/mesh/ingest", headers: f.headers,
        payload: { contractVersion: "csm-mesh-v1", envelopeId: "synthetic-envelope", encrypted: true, signature: "synthetic-signature", ownerIssuer: "forged", subjectId: "forged-owner" } });
      expect(mesh.statusCode).toBe(202);
      expect((await f.devices.listMeshAcks(owner.subjectId, undefined, 100))[0]?.ownerIssuer).toBe(issuer);
      const acks = await f.app.inject({ url: "/api/v1/mobile/mesh/acks", headers: f.headers });
      expect(JSON.stringify(acks.json())).not.toContain("ownerIssuer");
    } finally { await f.app.close(); }
  });
  it("records media grants before responses on start, detail and accepted-action routes", async () => {
    const f = await fixture(), grants = vi.spyOn(f.calls, "recordMediaGrant");
    try {
      const start = await f.app.inject({ method: "POST", url: "/api/v1/messaging/calls", headers: f.headers, payload: { roomId: incoming.roomId } });
      expect(start.statusCode).toBe(201); const firstId = start.json().call.callId as string;
      expect(grants).toHaveBeenNthCalledWith(1, owner, firstId, new Date(now.getTime() + 120_000).toISOString(), now.toISOString());
      expect((await f.calls.get(firstId))?.ownerIssuer).toBe(issuer);
      expect(JSON.stringify(start.json())).not.toContain("ownerIssuer");
      expect((await f.app.inject({ url: `/api/v1/messaging/calls/${firstId}`, headers: f.headers })).statusCode).toBe(200);
      const second = await f.calls.create(incoming);
      expect((await f.app.inject({ method: "POST", url: `/api/v1/messaging/calls/${second.callId}/actions`, headers: f.headers, payload: { action: "accept", endpointId: "synthetic-endpoint" } })).statusCode).toBe(200);
      expect(grants).toHaveBeenCalledTimes(3); expect(f.issue).toHaveBeenCalledTimes(3);
    } finally { await f.app.close(); }
  });
  it("drops a generated token if erasure fences the actor while the issuer is awaiting", async () => {
    const f = await fixture(); let entered!: () => void, release!: () => void;
    const entering = new Promise<void>(resolve => { entered = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
    f.issue.mockImplementationOnce(async () => { entered(); await released; return { e2eeKey: "synthetic-e2ee", expiresAt: new Date(now.getTime() + 120_000).toISOString(), serverUrl: "wss://synthetic-media.test", token: "must-not-be-returned" }; });
    try {
      const request = f.app.inject({ method: "POST", url: "/api/v1/messaging/calls", headers: f.headers, payload: { roomId: incoming.roomId } });
      const pending = Promise.resolve(request); await entering;
      await f.calls.fenceActor(owner, randomUUID(), now.toISOString()); release();
      const response = await pending;
      expect(response.statusCode).toBe(403); expect(response.json()).toMatchObject({ error: { code: "ACCOUNT_REVOKED", correlationId: "synthetic-owner-http" } });
      expect(response.body).not.toContain("must-not-be-returned");
    } finally { release(); await f.app.close(); }
  });
  it("rechecks after a persisted media grant and before emitting credentials", async () => {
    const f = await fixture(); let entered!: () => void, release!: () => void;
    const entering = new Promise<void>(resolve => { entered = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
    const realRecord = f.calls.recordMediaGrant.bind(f.calls);
    vi.spyOn(f.calls, "recordMediaGrant").mockImplementationOnce(async (...args) => { await realRecord(...args); entered(); await released; });
    try {
      const pending = Promise.resolve(f.app.inject({ method: "POST", url: "/api/v1/messaging/calls", headers: f.headers, payload: { roomId: incoming.roomId } }));
      await entering; await f.calls.fenceActor(owner, randomUUID(), now.toISOString()); release();
      const response = await pending;
      expect(response.statusCode).toBe(403); expect(response.body).not.toContain("synthetic-media-token");
    } finally { release(); await f.app.close(); }
  });
  it("returns COP 503 on missing grant persistence and never emits the minted token", async () => {
    const f = await fixture(); vi.spyOn(f.calls, "recordMediaGrant").mockRejectedValueOnce(new Error("Synthetic database outage"));
    try {
      const response = await f.app.inject({ method: "POST", url: "/api/v1/messaging/calls", headers: f.headers, payload: { roomId: incoming.roomId } });
      expect(response.statusCode).toBe(503); expect(response.json().error.code).toBe("ACCOUNT_OWNERSHIP_UNRESOLVED");
      expect(response.body).not.toContain("synthetic-media-token");
    } finally { await f.app.close(); }
  });
  it("keeps legacy call refresh working while recording new grant provenance without adopting old history", async () => {
    const f = await fixture(), grants = vi.spyOn(f.calls, "recordMediaGrant");
    try {
      const { ownerIssuer: _issuer, ...legacyInput } = incoming;
      const call = await f.calls.create({ ...legacyInput, initiatorSubjectId: owner.subjectId, participantSubjectIds: ["synthetic-b"] });
      const response = await f.app.inject({ url: `/api/v1/messaging/calls/${call.callId}`, headers: f.headers });
      expect(response.statusCode).toBe(200); expect(grants).toHaveBeenCalledTimes(1);
      expect((await f.calls.get(call.callId))?.ownerIssuer).toBeUndefined();
      expect((await f.calls.preflightActorErasure(owner)).ready).toBe(false);
    } finally { await f.app.close(); }
  });
  it("rechecks a completed device write before returning metadata or appending a late registration", async () => {
    const f = await fixture(); let entered!: () => void, release!: () => void;
    const entering = new Promise<void>(resolve => { entered = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
    const realUpsert = f.devices.upsertDevice.bind(f.devices);
    vi.spyOn(f.devices, "upsertDevice").mockImplementationOnce(async (...args) => { const result = await realUpsert(...args); entered(); await released; return result; });
    try {
      const pending = Promise.resolve(f.app.inject({ method: "POST", url: "/api/v1/mobile/devices", headers: f.headers, payload: registration }));
      await entering; await f.devices.purgeActor(owner, randomUUID(), now.toISOString()); release();
      const response = await pending;
      expect(response.statusCode).toBe(403); expect(response.body).not.toContain("synthetic-device");
      expect(await f.devices.listDevices(owner.subjectId)).toEqual([]);
    } finally { release(); await f.app.close(); }
  });
  it("fails closed without creating a fallback device after a configured account guard and device-store outage", async () => {
    const f = await fixture(true), upsert = vi.spyOn(f.devices, "upsertDevice").mockRejectedValueOnce(new Error("Synthetic database outage"));
    try {
      const first = await f.app.inject({ method: "POST", url: "/api/v1/mobile/devices", headers: f.headers, payload: registration });
      const second = await f.app.inject({ method: "POST", url: "/api/v1/mobile/devices", headers: f.headers, payload: registration });
      expect(first.statusCode).toBe(503); expect(second.statusCode).toBe(503);
      expect(first.json()).toMatchObject({ error: { code: "MOBILE_DEVICE_STORE_UNAVAILABLE", correlationId: "synthetic-owner-http" } });
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(await f.devices.listDevices(owner.subjectId)).toEqual([]);
    } finally { await f.app.close(); }
  });
  it("checks the persistent recipient fence before creating history or sending a wake after an empty RAM restart", async () => {
    const f = await fixture(true);
    const realAllowed = f.guard!.assertAllowed.bind(f.guard);
    vi.spyOn(f.guard!, "assertAllowed").mockImplementation(async actor => {
      if (actor.subjectId === "synthetic-b") throw new AccountErasureError(403, "ACCOUNT_ERASURE_FENCED");
      await realAllowed(actor);
    });
    try {
      const response = await f.app.inject({ method: "POST", url: "/api/v1/messaging/calls", headers: f.headers, payload: { roomId: incoming.roomId } });
      expect(response.statusCode).toBe(403);
      expect(await f.calls.listForSubject(owner.subjectId)).toEqual([]);
      expect(f.notify).not.toHaveBeenCalled(); expect(f.issue).not.toHaveBeenCalled();
    } finally { await f.app.close(); }
  });
});
