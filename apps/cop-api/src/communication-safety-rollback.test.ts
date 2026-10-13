import { createDecipheriv, createHash, createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { CsmMessagingProvider } from "./messaging-provider.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import { clearJwksCacheForTests } from "./security.js";
import { COMMUNICATION_RETENTION_POLICY_ID, COMMUNICATION_SAFETY_CONFIG_KEY } from "./communication-safety.js";

const issuer = "https://identity.rollback.test/realms/cop", messagingUrl = "https://messaging.rollback.test";
const secret = "synthetic-communication-rollback-secret-32-characters", day = 86_400_000;
const epoch = Date.parse("2026-01-01T00:00:00Z"), operation = "be09ced5-d021-4c80-ab25-c230e68ef86b";
const reportInput = { target: { kind: "user", peerSubjectId: "peer", conversationId: "owned-conversation" }, reason: "harassment",
  evidence: { selectedText: "SYNTHETIC_SELECTED_EXCERPT", explicitlyConfirmed: true } };
const originalEnv = { ...process.env };
beforeEach(() => { process.env = { ...originalEnv }; clearJwksCacheForTests(); });
afterEach(() => { process.env = { ...originalEnv }; clearJwksCacheForTests(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function fixture() {
  Object.assign(process.env, { COP_AUTH_MODE: "oidc", COP_OIDC_ISSUER: issuer, COP_OIDC_ALLOWED_CLIENTS: "synthetic-mobile",
    COP_OIDC_REQUIRED_ROLE: "", COP_WEB_BFF_SESSION_ENABLED: "false", COP_SHARED_MOBILITY_ENABLED: "false",
    COP_ACCOUNT_ERASURE_ENABLED: "false", COP_ACCOUNT_ERASURE_SECRET: "", COP_JIZDA_OIDC_CLIENT_ID: "",
    COP_COMMUNICATION_SAFETY_ENABLED: "true", COP_COMMUNICATION_EVIDENCE_SECRET: secret,
    COP_COMMUNICATION_MODERATOR_ROLE: "synthetic-moderator", COP_COMMUNICATION_CONTACT_EMAIL: "moderation@example.test",
    COP_COMMUNICATION_RETENTION_POLICY_ID: COMMUNICATION_RETENTION_POLICY_ID });
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "synthetic-rollback-key", use: "sig", alg: "RS256" };
  const headers = (subject = "owner") => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: jwk.kid })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: issuer, sub: subject, azp: "synthetic-mobile",
      exp: Math.floor(Date.now() / 1000) + 300, realm_access: { roles: subject === "moderator" ? ["synthetic-moderator"] : [] } })).toString("base64url");
    const unsigned = `${header}.${payload}`;
    return { authorization: `Bearer ${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(privateKey).toString("base64url")}` };
  };
  const blocks = new Set<string>(), store = new MemoryMobilityStore();
  let currentTime = epoch;
  const fetchMock = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    const url = String(input);
    if (url === issuer + "/protocol/openid-connect/certs") return new Response(JSON.stringify({ keys: [jwk] }));
    const owner = (options?.headers as Record<string, string> | undefined)?.["x-csm-user-id"];
    const pair = `${owner}:peer`;
    if (url === messagingUrl + "/api/v1/communication/blocks/peer") {
      if (options?.method === "PUT") {
        const value = JSON.parse(options.body as string) as { blocked: boolean };
        if (value.blocked) blocks.add(pair); else blocks.delete(pair);
        return new Response(JSON.stringify({ contractVersion: "csm-communication-safety-v1", result: { blocked: value.blocked } }));
      }
      return new Response(JSON.stringify({ contractVersion: "csm-communication-safety-v1", result: blocks.has(pair) }));
    }
    if (url === messagingUrl + "/api/v1/communication/direct-allowed") {
      return new Response(JSON.stringify({ contractVersion: "csm-communication-safety-v1", result: !blocks.has(pair) }));
    }
    throw new Error("Unexpected synthetic provider request");
  });
  vi.stubGlobal("fetch", fetchMock);
  const provider = new CsmMessagingProvider({ baseUrl: messagingUrl, enabled: true, token: "synthetic-provider-token", cacheTtlMs: 0, timeoutMs: 100 });
  const conversation = { conversationId: "owned-conversation", conversationKind: "direct" as const, type: "direct" as const,
    title: "Synthetic", members: [{ userId: "owner" }, { userId: "peer" }], directPeer: { userId: "peer" }, matrix: { roomId: "!synthetic:test" } };
  vi.spyOn(provider, "fetchConversation").mockResolvedValue({ contractVersion: "cop-messaging-conversations-v1", enabled: true,
    providerId: "csm.messaging", status: "online", warnings: [], conversation });
  vi.spyOn(provider, "fetchConversationByRoomId").mockResolvedValue({ contractVersion: "cop-messaging-conversations-v1", enabled: true,
    providerId: "csm.messaging", status: "online", warnings: [], conversation });
  const notify = vi.spyOn(provider, "sendNotification");
  const issue = vi.fn(async () => ({ e2eeKey: "synthetic-only", expiresAt: new Date(currentTime + 60_000).toISOString(),
    serverUrl: "wss://media.test", token: "synthetic-only" }));
  return { store, blocks, headers, notify, issue, fetchMock, at(days: number) { currentTime = epoch + days * day; },
    app(guardOnly = false) { return buildServer({ ...(guardOnly ? { accountSafetyStore: store } : { mobilityStore: store }), messagingProvider: provider, voiceCallMediaIssuer: { enabled: true, issue }, now: () => new Date(currentTime) }); } };
}
async function storedReport(store: MemoryMobilityStore, reportId: string) {
  const row = await store.transact([], tx => tx.get<{ sealed: string }>("communication-safety:report:" + reportId));
  const bytes = Buffer.from(row!.sealed, "base64"), key = createHash("sha256").update("cop-communication-reports-v1\0").update(secret).digest();
  const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8")) as Record<string, unknown>;
}

describe("communication guard survives intake rollback", () => {
  it("keeps retention, receipt retries, moderation and canonical blocks after an intake-off restart", async () => {
    const f = fixture(), first = f.app(); let reportId = "";
    try {
      const report = await first.inject({ method: "POST", url: "/api/v1/me/communication/reports",
        headers: { ...f.headers(), "idempotency-key": operation }, payload: reportInput });
      expect(report.statusCode).toBe(200); reportId = report.json().reportId;
      expect((await first.inject({ method: "PUT", url: "/api/v1/me/communication/blocks", headers: f.headers(), payload: { peerSubjectId: "peer", blocked: true } })).statusCode).toBe(200);
      f.at(10);
      expect((await first.inject({ method: "PATCH", url: "/api/v1/moderation/communication/reports/" + reportId,
        headers: f.headers("moderator"), payload: { expectedRevision: 1, status: "resolved", resolution: "no_action" } })).statusCode).toBe(200);
    } finally { await first.close(); }
    process.env.COP_COMMUNICATION_SAFETY_ENABLED = "false"; f.at(40);
    const claim = vi.spyOn(f.store, "claimDispatchInstance"), recovery = vi.spyOn(f.store, "startDispatchRecovery");
    const restarted = f.app(true);
    try {
      await restarted.ready(); // The actual production onReady path purges before serving requests.
      expect(claim).not.toHaveBeenCalled(); expect(recovery).not.toHaveBeenCalled();
      expect(await storedReport(f.store, reportId)).not.toHaveProperty("evidence");
      expect(await f.store.transact([], tx => tx.get(COMMUNICATION_SAFETY_CONFIG_KEY))).toBeDefined();
      expect((await restarted.inject({ url: "/api/v1/me/account-safety/capabilities", headers: f.headers() })).json()).toMatchObject({ reporting: false, blocking: false, accountDeletion: false });
      const retry = await restarted.inject({ method: "POST", url: "/api/v1/me/communication/reports", headers: { ...f.headers(), "idempotency-key": operation }, payload: reportInput });
      expect(retry.statusCode).toBe(200); expect(retry.json()).toMatchObject({ reportId, status: "resolved" });
      const newReport = await restarted.inject({ method: "POST", url: "/api/v1/me/communication/reports", headers: { ...f.headers(), "idempotency-key": "synthetic-new-operation-0001" }, payload: reportInput });
      expect(newReport.statusCode).toBe(503); expect(newReport.json().error.code).toBe("COMMUNICATION_SAFETY_INTAKE_DISABLED");
      expect((await restarted.inject({ method: "PUT", url: "/api/v1/me/communication/blocks", headers: f.headers(), payload: { peerSubjectId: "peer", blocked: true } })).statusCode).toBe(503);
      expect((await restarted.inject({ url: "/api/v1/moderation/communication/reports/" + reportId, headers: f.headers("moderator") })).json()).not.toHaveProperty("evidence");
      expect((await restarted.inject({ url: "/api/v1/me/communication/reports/" + reportId, headers: f.headers("other-account") })).statusCode).toBe(404);
      const blockedCall = await restarted.inject({ method: "POST", url: "/api/v1/messaging/calls", headers: f.headers(), payload: { roomId: "!synthetic:test" } });
      expect(blockedCall.statusCode).toBe(403); expect(blockedCall.json().error.code).toBe("COMMUNICATION_BLOCKED"); expect(f.notify).not.toHaveBeenCalled(); expect(f.issue).not.toHaveBeenCalled();
      expect((await restarted.inject({ method: "POST", url: "/api/v1/me/communication/blocks/query", headers: f.headers(), payload: { peerSubjectId: "peer" } })).json().blocked).toBe(true);
      const unauthCalls = f.fetchMock.mock.calls.length;
      expect((await restarted.inject({ url: "/api/v1/me/account-safety/capabilities" })).statusCode).toBe(401);
      expect((await restarted.inject({ url: "/health/live" })).statusCode).toBe(200); expect(f.fetchMock.mock.calls).toHaveLength(unauthCalls);
      expect((await restarted.inject({ method: "PUT", url: "/api/v1/me/communication/blocks", headers: f.headers(), payload: { peerSubjectId: "peer", blocked: false } })).statusCode).toBe(200);
      expect(f.blocks.has("owner:peer")).toBe(false);
      expect(await storedReport(f.store, reportId)).not.toHaveProperty("evidence");
    } finally { await restarted.close(); }
  });

  it.each(["secret", "policy", "moderator", "contact"])("rejects missing %s configuration after accepted state", async field => {
    const f = fixture(), first = f.app();
    try { await first.ready(); } finally { await first.close(); }
    process.env.COP_COMMUNICATION_SAFETY_ENABLED = "false";
    delete process.env[{ secret: "COP_COMMUNICATION_EVIDENCE_SECRET", policy: "COP_COMMUNICATION_RETENTION_POLICY_ID",
      moderator: "COP_COMMUNICATION_MODERATOR_ROLE", contact: "COP_COMMUNICATION_CONTACT_EMAIL" }[field] as string];
    const restarted = f.app(true);
    await expect(restarted.ready()).rejects.toThrow("Accepted communication state requires its retention and policy guard");
    await restarted.close();
    expect(await f.store.transact([], tx => tx.get(COMMUNICATION_SAFETY_CONFIG_KEY))).toBeDefined();
  });

  it("rejects silent evidence-key rotation, preserves the marker and accepts the original key", async () => {
    const f = fixture(), first = f.app();
    try { await first.ready(); } finally { await first.close(); }
    const marker = await f.store.transact([], tx => tx.get(COMMUNICATION_SAFETY_CONFIG_KEY));
    process.env.COP_COMMUNICATION_SAFETY_ENABLED = "false";
    process.env.COP_COMMUNICATION_EVIDENCE_SECRET = "synthetic-replacement-evidence-key-32-characters";
    const rotated = f.app();
    await expect(rotated.ready()).rejects.toMatchObject({ status: 503, code: "COMMUNICATION_CONFIGURATION_CHANGED" });
    await rotated.close();
    expect(await f.store.transact([], tx => tx.get(COMMUNICATION_SAFETY_CONFIG_KEY))).toEqual(marker);
    process.env.COP_COMMUNICATION_EVIDENCE_SECRET = secret;
    const restored = f.app(); try { await expect(restored.ready()).resolves.toBeDefined(); } finally { await restored.close(); }
  });

  it("guards legacy reports without a marker and cannot adopt a wrong evidence key", async () => {
    const f = fixture(), first = f.app(); let reportId = "";
    try {
      const accepted = await first.inject({ method: "POST", url: "/api/v1/me/communication/reports",
        headers: { ...f.headers(), "idempotency-key": operation }, payload: reportInput });
      expect(accepted.statusCode).toBe(200); reportId = accepted.json().reportId;
    } finally { await first.close(); }
    // Synthetic simulation of a report created before configuration markers existed.
    await f.store.transact([], tx => tx.remove(COMMUNICATION_SAFETY_CONFIG_KEY));
    process.env.COP_COMMUNICATION_SAFETY_ENABLED = "false";
    delete process.env.COP_COMMUNICATION_EVIDENCE_SECRET;
    const missing = f.app();
    await expect(missing.ready()).rejects.toThrow("Accepted communication state requires its retention and policy guard");
    await missing.close();
    process.env.COP_COMMUNICATION_EVIDENCE_SECRET = "synthetic-wrong-evidence-key-32-characters";
    const wrong = f.app();
    await expect(wrong.ready()).rejects.toMatchObject({ status: 503, code: "COMMUNICATION_CONFIGURATION_UNAVAILABLE" });
    await wrong.close();
    expect(await f.store.transact([], tx => tx.get(COMMUNICATION_SAFETY_CONFIG_KEY))).toBeUndefined();
    expect((await storedReport(f.store, reportId)).evidence).toEqual(reportInput.evidence);
    process.env.COP_COMMUNICATION_EVIDENCE_SECRET = secret; f.at(90);
    const restored = f.app();
    try {
      await restored.ready(); expect(await storedReport(f.store, reportId)).not.toHaveProperty("evidence");
      expect(await f.store.transact([], tx => tx.get(COMMUNICATION_SAFETY_CONFIG_KEY))).toBeDefined();
    } finally { await restored.close(); }
  });
});
