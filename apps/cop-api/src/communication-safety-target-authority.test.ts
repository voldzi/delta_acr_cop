import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { clearJwksCacheForTests } from "./security.js";
import { CsmMessagingProvider, type MessagingConversationDetailResponse } from "./messaging-provider.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import { InMemoryVoiceCallStore } from "./voice-call-store.js";

const issuer = "https://identity.fixture.test/realms/cop";
const jwksUrl = `${issuer}/protocol/openid-connect/certs`;
const messagingUrl = "https://messaging.fixture.test";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "fixture-key", alg: "RS256", use: "sig" };
const operation = "c91bb4ba-38ec-447b-914a-16a45ca3a2e6";
const userTarget = { kind: "user", peerSubjectId: "peer", conversationId: "owned-conversation" };
const messageTarget = { ...userTarget, kind: "message", eventId: "$peer-event" };

function token(subject: string) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "fixture-key" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: issuer, sub: subject, azp: "fixture-mobile", exp: Math.floor(Date.now() / 1000) + 300 })).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(unsigned).end().sign(privateKey).toString("base64url");
  return `${unsigned}.${signature}`;
}

function fixture(accepted: Partial<{ peerSubjectId: string; conversationId: string; eventId: string }> = {}) {
  const authority = { peerSubjectId: "peer", conversationId: "owned-conversation", eventId: "$peer-event", ...accepted };
  clearJwksCacheForTests();
  for (const [key, value] of Object.entries({
    COP_AUTH_MODE: "oidc", COP_OIDC_ISSUER: issuer, COP_OIDC_JWKS_URI: jwksUrl,
    COP_OIDC_ALLOWED_CLIENTS: "fixture-mobile", COP_OIDC_REQUIRED_ROLE: "", COP_ALLOW_LAB_TOKEN: "false",
    COP_WEB_BFF_SESSION_ENABLED: "false", COP_COMMUNICATION_SAFETY_ENABLED: "true",
    COP_COMMUNICATION_EVIDENCE_SECRET: "fixture-evidence-secret-at-least-32-characters",
    COP_COMMUNICATION_MODERATOR_ROLE: "fixture-moderator", COP_COMMUNICATION_CONTACT_EMAIL: "moderation@example.test",
    COP_COMMUNICATION_RETENTION_POLICY_ID: "cop-communication-retention-90d-30d-180d-v1", COP_JIZDA_DISCONNECT_ENABLED: "false"
  })) vi.stubEnv(key, value);

  const store = new MemoryMobilityStore();
  const calls = new InMemoryVoiceCallStore();
  const provider = new CsmMessagingProvider({ baseUrl: messagingUrl, enabled: true, token: "fixture-service-token", timeoutMs: 100, cacheTtlMs: 0 });
  const conversation = vi.spyOn(provider, "fetchConversation").mockImplementation(async (actor, _at, id): Promise<MessagingConversationDetailResponse> => ({
    contractVersion: "cop-messaging-conversations-v1", enabled: true, providerId: "csm.messaging", status: "online", warnings: [],
    ...(actor.subjectId === "owner" && id === authority.conversationId ? { conversation: {
      conversationId: id, conversationKind: "group", type: "group", title: "Synthetic fixture",
      members: [{ userId: "owner" }, { userId: authority.peerSubjectId }, { userId: "other-member" }], matrix: { roomId: "!owned:fixture.test" }
    } } : {})
  }));
  const verifyEvent = vi.fn(async (input: { peerId: string; roomId: string; eventId: string }) => new Response(JSON.stringify({
    contractVersion: "csm-communication-safety-v1",
    result: input.peerId === authority.peerSubjectId && input.roomId === "!owned:fixture.test" && input.eventId === authority.eventId
  })));
  const fetchMock = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    const url = String(input);
    if (url === jwksUrl) return new Response(JSON.stringify({ keys: [jwk] }));
    if (url === `${messagingUrl}/api/v1/communication/event-verified`) return verifyEvent(JSON.parse(options?.body as string));
    if (url === `${messagingUrl}/api/v1/communication/blocks/${encodeURIComponent(authority.peerSubjectId)}`) {
      return new Response(JSON.stringify({ contractVersion: "csm-communication-safety-v1", result: options?.method === "PUT" ? { blocked: true } : true }));
    }
    throw new Error("Unexpected synthetic upstream request");
  });
  vi.stubGlobal("fetch", fetchMock);
  // Use the production buildServer factory and its actual validateTarget closure.
  // No injected CommunicationSafetyService or replacement validator is supplied.
  const app = buildServer({ mobilityStore: store, messagingProvider: provider, voiceCallStore: calls });
  const submit = (subject: string, target: Record<string, string>, extra: Record<string, unknown> = {}) => app.inject({
    method: "POST", url: "/api/v1/me/communication/reports",
    headers: { authorization: `Bearer ${token(subject)}`, "idempotency-key": operation },
    payload: { target, reason: "harassment", ...extra }
  });
  const reports = () => store.transact([], tx => tx.scan("communication-safety:report:"));
  return { app, store, calls, conversation, verifyEvent, fetchMock, submit, reports };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearJwksCacheForTests();
});

describe("report target authority through authenticated COP server routes", () => {
  it("rejects an invalid signed identity before reading conversation authority or storing a report", async () => {
    const f = fixture();
    try {
      const forged = token("owner").replace(/\.[^.]+$/u, ".invalid-signature");
      const response = await f.app.inject({ method: "POST", url: "/api/v1/me/communication/reports",
        headers: { authorization: `Bearer ${forged}`, "idempotency-key": operation }, payload: { target: userTarget, reason: "harassment" } });
      expect(response.statusCode).toBe(401);
      expect(f.conversation).not.toHaveBeenCalled();
      expect(await f.reports()).toEqual([]);
    } finally { await f.app.close(); }
  });

  it("requires the authenticated actor's visible conversation and a canonical peer member", async () => {
    const f = fixture();
    try {
      expect((await f.submit("other-account", userTarget)).statusCode).toBe(404);
      expect((await f.submit("owner", { ...userTarget, peerSubjectId: "outsider" })).statusCode).toBe(404);
      expect((await f.submit("owner", { ...userTarget, conversationId: "other-conversation" })).statusCode).toBe(404);
      expect((await f.submit("owner", { ...userTarget, peerSubjectId: "owner" })).statusCode).toBe(400);
      expect(await f.reports()).toEqual([]);
      const accepted = await f.submit("owner", userTarget);
      expect(accepted.statusCode).toBe(200);
      expect(f.conversation).toHaveBeenLastCalledWith(expect.objectContaining({ subjectId: "owner", issuer }), expect.any(Date), "owned-conversation");
      expect(f.verifyEvent).not.toHaveBeenCalled();
      expect(await f.reports()).toHaveLength(1);
    } finally { await f.app.close(); }
  });

  it("uses the server-selected room and verifies the event's sender rather than trusting a member or caller context", async () => {
    const f = fixture();
    try {
      expect((await f.submit("owner", { ...messageTarget, peerSubjectId: "other-member" })).statusCode).toBe(404);
      expect((await f.submit("owner", { ...messageTarget, eventId: "$foreign-event" })).statusCode).toBe(404);
      expect((await f.submit("owner", { ...messageTarget, roomId: "!forged:fixture.test" })).statusCode).toBe(400);
      expect((await f.submit("owner", messageTarget, { reporter: "other-account" })).statusCode).toBe(400);
      expect(await f.reports()).toEqual([]);
      const accepted = await f.submit("owner", messageTarget);
      expect(accepted.statusCode).toBe(200);
      const eventRequests = f.fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/event-verified"));
      const [, options] = eventRequests.at(-1)!;
      expect(options?.headers).toMatchObject({ "x-csm-user-id": "owner", authorization: "Bearer fixture-service-token" });
      expect(JSON.parse(options?.body as string)).toEqual({ peerId: "peer", roomId: "!owned:fixture.test", eventId: "$peer-event" });
      expect(options?.redirect).toBe("error");
      expect(await f.reports()).toHaveLength(1);
    } finally { await f.app.close(); }
  });

  it("requires both actor and reported peer to belong to the actual stored call", async () => {
    const f = fixture();
    try {
      const call = await f.calls.create({ roomId: "!owned:fixture.test", initiatorSubjectId: "peer", participantSubjectIds: ["owner"], kind: "direct",
        title: "Synthetic call", now: new Date().toISOString(), expiresAt: new Date(Date.now() + 90_000).toISOString() });
      const target = { kind: "call", peerSubjectId: "peer", callId: call.callId };
      expect((await f.submit("other-account", target)).statusCode).toBe(404);
      expect((await f.submit("owner", { ...target, peerSubjectId: "outsider" })).statusCode).toBe(404);
      expect((await f.submit("owner", { ...target, callId: "cf749ef2-3ac8-4fc8-adb9-83af696704fe" })).statusCode).toBe(404);
      expect(await f.reports()).toEqual([]);
      expect((await f.submit("owner", target)).statusCode).toBe(200);
      expect(f.conversation).not.toHaveBeenCalled();
      expect(f.verifyEvent).not.toHaveBeenCalled();
      expect(await f.reports()).toHaveLength(1);
    } finally { await f.app.close(); }
  });

  it("returns 503 without a receipt when conversation or canonical event authority is unavailable", async () => {
    const f = fixture();
    try {
      f.conversation.mockResolvedValueOnce({ contractVersion: "cop-messaging-conversations-v1", enabled: true, providerId: "csm.messaging", status: "degraded", warnings: [] });
      expect((await f.submit("owner", userTarget)).statusCode).toBe(503);
      f.conversation.mockRejectedValueOnce(new Error("private upstream failure"));
      const outage = await f.submit("owner", userTarget);
      expect(outage.statusCode).toBe(503);
      expect(outage.body).not.toContain("private upstream failure");
      f.conversation.mockResolvedValueOnce({ contractVersion: "cop-messaging-conversations-v1", enabled: true, providerId: "csm.messaging", status: "online", warnings: [],
        conversation: { conversationId: "owned-conversation", conversationKind: "direct", type: "direct", title: "Missing Matrix authority",
          members: [{ userId: "owner" }, { userId: "peer" }] } });
      expect((await f.submit("owner", messageTarget)).statusCode).toBe(503);
      f.verifyEvent.mockResolvedValueOnce(new Response("", { status: 503 }));
      expect((await f.submit("owner", messageTarget)).statusCode).toBe(503);
      f.verifyEvent.mockResolvedValueOnce(new Response(JSON.stringify({ contractVersion: "wrong-contract", result: true })));
      expect((await f.submit("owner", messageTarget)).statusCode).toBe(503);
      expect(await f.reports()).toEqual([]);
    } finally { await f.app.close(); }
  });

  it.each([
    { field: "peerSubjectId", encoding: "ASCII", limit: 256, at: "p".repeat(256), over: "p".repeat(257) },
    { field: "peerSubjectId", encoding: "multibyte", limit: 256, at: "😀".repeat(64), over: "😀".repeat(64) + "a" },
    { field: "conversationId", encoding: "ASCII", limit: 255, at: "c".repeat(255), over: "c".repeat(256) },
    { field: "conversationId", encoding: "multibyte", limit: 255, at: "é".repeat(127) + "a", over: "é".repeat(128) },
    { field: "eventId", encoding: "ASCII", limit: 255, at: "$" + "e".repeat(254), over: "$" + "e".repeat(255) },
    { field: "eventId", encoding: "multibyte", limit: 255, at: "$" + "é".repeat(127), over: "$" + "é".repeat(127) + "a" }
  ])("enforces $field $encoding report references at the documented UTF-8 byte boundary", async ({ field, limit, at, over }) => {
    const f = fixture({ [field]: at });
    try {
      expect(Buffer.byteLength(at, "utf8")).toBe(limit);
      expect(Buffer.byteLength(over, "utf8")).toBe(limit + 1);
      const rejected = await f.submit("owner", { ...messageTarget, [field]: over });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json().error.code).toBe("VALIDATION_ERROR");
      expect(f.conversation).not.toHaveBeenCalled();
      expect(f.verifyEvent).not.toHaveBeenCalled();
      expect(await f.reports()).toEqual([]);

      const target = { ...messageTarget, [field]: at };
      expect((await f.submit("owner", target)).statusCode).toBe(200);
      expect(f.verifyEvent).toHaveBeenCalledExactlyOnceWith({ peerId: target.peerSubjectId, roomId: "!owned:fixture.test", eventId: target.eventId });
      expect(f.conversation).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ subjectId: "owner" }), expect.any(Date), target.conversationId);
      expect(await f.reports()).toHaveLength(1);
    } finally { await f.app.close(); }
  });

  it.each([
    { encoding: "ASCII", at: "p".repeat(256), over: "p".repeat(257) },
    { encoding: "multibyte", at: "😀".repeat(64), over: "😀".repeat(64) + "a" }
  ])("enforces the same 256-byte $encoding peer boundary for block queries and mutations", async ({ at, over }) => {
    const f = fixture({ peerSubjectId: at });
    const request = (method: "POST" | "PUT", peerSubjectId: string) => f.app.inject({ method,
      url: `/api/v1/me/communication/blocks${method === "POST" ? "/query" : ""}`,
      headers: { authorization: `Bearer ${token("owner")}` }, payload: { peerSubjectId, ...(method === "PUT" ? { blocked: true } : {}) } });
    try {
      for (const method of ["POST", "PUT"] as const) {
        const rejected = await request(method, over);
        expect(rejected.statusCode).toBe(400);
        expect(rejected.json().error.code).toBe("VALIDATION_ERROR");
      }
      expect(f.fetchMock.mock.calls.filter(([url]) => String(url).includes("/communication/blocks/"))).toEqual([]);
      for (const method of ["POST", "PUT"] as const) {
        const accepted = await request(method, at);
        expect(accepted.statusCode).toBe(200);
        expect(accepted.json()).toEqual({ peerSubjectId: at, blocked: true });
      }
      const upstream = f.fetchMock.mock.calls.filter(([url]) => String(url).includes("/communication/blocks/"));
      expect(upstream).toHaveLength(2);
      for (const [url, options] of upstream) {
        expect(url).toBe(`${messagingUrl}/api/v1/communication/blocks/${encodeURIComponent(at)}`);
        expect(options?.headers).toMatchObject({ "x-csm-user-id": "owner" });
      }
    } finally { await f.app.close(); }
  });
});
