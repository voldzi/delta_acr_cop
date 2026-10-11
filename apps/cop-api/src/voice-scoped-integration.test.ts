import { TokenVerifier } from "livekit-server-sdk";
import { createHash, createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CsmMessagingProvider } from "./messaging-provider.js";
import { MemoryMobilityStore, type MobilityStore } from "./mobility-store.js";
import { clearJwksCacheForTests, type AuthenticatedActor } from "./security.js";
import { buildServer } from "./server.js";
import { InMemoryUserProfileStore } from "./user-profile-store.js";
import { LiveKitVoiceCallMediaIssuer } from "./voice-call-media.js";
import { InMemoryVoiceCallStore, type VoiceCallRecord } from "./voice-call-store.js";
import { VoiceGrantError, VoiceGrantLedger, VOICE_GRANT_IDENTITY_PREFIX, type VoiceScopedGrant } from "./voice-grant-ledger.js";
import { RemoteVoiceGrantRevoker, UnacceptedVoiceGrantRevoker, VOICE_REVOCATION_CONTROL_ROOM } from "./voice-grant-revocation.js";
import { createVoiceGrantLedgerFromEnv } from "./voice-grant-runtime.js";

const issuer = "https://identity.voice-scoped.test/realms/cop", clientId = "jizda-mobile";
const apiKey = "synthetic-livekit-api-key", apiSecret = "synthetic-livekit-server-secret-at-least-32-characters";
const installationA = "e573c0a9-b181-4ff9-a2b8-1d0ed5de05ad", installationB = "8bd3e01b-fc04-4687-87cc-3cf130f7a158";
const operation = "4855f9b8-e336-46ae-b1f7-171a45341be5", anotherOperation = "bc7a984c-d658-44e9-9b16-71adcf69b3b6";
const fixedNow = new Date("2026-10-11T12:00:00Z"), callId = "34d7c97d-97f5-41a2-933c-e020972a194f";
const matrixRoom = "!synthetic-direct:example.test";
const actor = (subjectId = "synthetic-account-a", authorizedParty = clientId): AuthenticatedActor => ({
  authMode: "oidc", issuer, subjectId, authorizedParty, username: "SYNTHETIC_USERNAME", displayName: "SYNTHETIC_DISPLAY_NAME"
});
function call(): VoiceCallRecord {
  return { callId, createdAt: fixedNow.toISOString(), updatedAt: fixedNow.toISOString(), expiresAt: "2026-10-11T12:10:00Z",
    initiatorSubjectId: actor().subjectId, participantSubjectIds: [actor("synthetic-account-b").subjectId],
    kind: "direct", phase: "connected", revision: 3, roomId: matrixRoom, title: "Synthetic direct call" };
}
function ledger(store: MobilityStore = new MemoryMobilityStore(), intakeEnabled = true) {
  return new VoiceGrantLedger({ store, issuer, clientId, identitySecret: apiSecret, intakeEnabled });
}
function mediaIssuer(grants?: VoiceGrantLedger, dedicatedClientId?: string) {
  return new LiveKitVoiceCallMediaIssuer({ apiKey, apiSecret, e2eeSecret: "synthetic-independent-e2ee-secret-at-least-32",
    publicUrl: "wss://voice.example.test", ...(grants ? { ledger: grants } : {}), ...(dedicatedClientId ? { dedicatedClientId } : {}) });
}
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "voice-scoped-test", alg: "RS256", use: "sig" };
function token(subjectId: string, authorizedParty = clientId) {
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const content = encoded({ alg: "RS256", kid: jwk.kid }) + "." + encoded({ iss: issuer, sub: subjectId, azp: authorizedParty,
    preferred_username: "SYNTHETIC_USERNAME", name: "SYNTHETIC_DISPLAY_NAME", exp: Math.floor(Date.now() / 1000) + 300 });
  return content + "." + createSign("RSA-SHA256").update(content).end().sign(privateKey).toString("base64url");
}
const headers = (subjectId = actor().subjectId, installationId?: string, authorizedParty = clientId) => ({
  authorization: `Bearer ${token(subjectId, authorizedParty)}`, ...(installationId ? { "x-cop-installation-id": installationId } : {})
});
function authFixture() {
  for (const [key, value] of Object.entries({ COP_AUTH_MODE: "oidc", COP_OIDC_ISSUER: issuer,
    COP_OIDC_ALLOWED_CLIENTS: "cop-web,jizda-mobile,csm-mobile", COP_OIDC_REQUIRED_ROLE: "", COP_ALLOW_LAB_TOKEN: "false",
    COP_DATABASE_URL: "", COP_WEB_BFF_SESSION_ENABLED: "false", COP_ACCOUNT_ERASURE_ENABLED: "false", COP_ACCOUNT_ERASURE_SECRET: "",
    COP_JIZDA_OIDC_CLIENT_ID: clientId, COP_JIZDA_DISCONNECT_ENABLED: "false", COP_COMMUNICATION_SAFETY_ENABLED: "false",
    COP_COMMUNICATION_EVIDENCE_SECRET: "", COP_VOICE_SCOPED_GRANTS_ENABLED: "false", COP_VOICE_SIGNAL_GATEWAY_ENABLED: "false",
    COP_VOICE_SIGNAL_GATEWAY_ACCEPTED: "false", COP_VOICE_SIGNAL_GATEWAY_CONTROL_URL: "" })) vi.stubEnv(key, value);
  clearJwksCacheForTests();
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    if (String(input).endsWith("/protocol/openid-connect/certs")) return new Response(JSON.stringify({ keys: [jwk] }));
    throw new Error("External network forbidden in synthetic tests");
  }));
  const provider = new CsmMessagingProvider({ baseUrl: "https://messaging.voice-scoped.test", token: "synthetic-service",
    timeoutMs: 100, cacheTtlMs: 0, enabled: true });
  const bootstrap = vi.spyOn(provider, "fetchMatrixBootstrap").mockResolvedValue({ status: "online", chatAvailable: true, tokenAvailable: true } as never);
  const conversation = vi.spyOn(provider, "fetchConversationByRoomId").mockImplementation(async (verifiedActor) => ({
    contractVersion: "cop-messaging-conversations-v1", enabled: true, providerId: "csm.messaging", status: "online", warnings: [],
    conversation: { conversationId: "synthetic-direct", conversationKind: "direct", type: "direct", title: "Synthetic direct",
      members: [{ userId: verifiedActor!.subjectId }, { userId: "synthetic-peer" }], directPeer: { userId: "synthetic-peer" }, matrix: { roomId: matrixRoom } }
  }) as never);
  const notification = vi.spyOn(provider, "sendNotification").mockResolvedValue({ contractVersion: "cop-messaging-notification-v1",
    enabled: true, providerId: "csm.messaging", status: "online", warnings: [] } as never);
  const store = new MemoryMobilityStore(), grants = ledger(store), calls = new InMemoryVoiceCallStore();
  return { store, grants, calls, provider, bootstrap, conversation, notification };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); clearJwksCacheForTests(); });

describe("scoped LiveKit media issuance", () => {
  it("gates new environment-configured issuance on accepted single-path admission while preserving maintenance when disabled", () => {
    const store = new MemoryMobilityStore(), configured = { COP_OIDC_ISSUER: issuer, COP_JIZDA_OIDC_CLIENT_ID: clientId,
      COP_LIVEKIT_API_KEY: apiKey, COP_LIVEKIT_API_SECRET: apiSecret, COP_VOICE_SIGNAL_GATEWAY_CONTROL_URL: "https://admission.example.test",
      COP_VOICE_SCOPED_GRANTS_ENABLED: "true", COP_VOICE_SIGNAL_GATEWAY_ACCEPTED: "true", COP_VOICE_SIGNAL_SINGLE_ATTEMPT_VERIFIED: "true" };
    expect(createVoiceGrantLedgerFromEnv(store, configured)?.options.intakeEnabled).toBe(true);
    expect(createVoiceGrantLedgerFromEnv(store, configured)?.options.requireAdmissionEpoch).toBe(true);
    for (const disabled of [{ COP_VOICE_SIGNAL_GATEWAY_ACCEPTED: "false" }, { COP_VOICE_SIGNAL_SINGLE_ATTEMPT_VERIFIED: "false" },
      { COP_VOICE_SIGNAL_GATEWAY_ACCEPTED: undefined }, { COP_VOICE_SIGNAL_SINGLE_ATTEMPT_VERIFIED: undefined }]) {
      expect(() => createVoiceGrantLedgerFromEnv(store, { ...configured, ...disabled })).toThrow(/accepted sole-ingress/iu);
    }
    expect(createVoiceGrantLedgerFromEnv(store, { ...configured, COP_VOICE_SCOPED_GRANTS_ENABLED: "false",
      COP_VOICE_SIGNAL_GATEWAY_ACCEPTED: "false", COP_VOICE_SIGNAL_SINGLE_ATTEMPT_VERIFIED: "false" })?.options.intakeEnabled).toBe(false);
    expect(createVoiceGrantLedgerFromEnv(store, {})).toBeUndefined();
  });

  it("issues distinct opaque identities for two accounts/two installations, preserving refreshed identity without profile names", async () => {
    const grants = ledger(), owner = actor(), other = actor("synthetic-account-b");
    await grants.attestInstallation(owner, installationA, fixedNow); await grants.attestInstallation(owner, installationB, fixedNow);
    await grants.attestInstallation(other, installationA, fixedNow);
    const issuerService = mediaIssuer(grants), verifier = new TokenVerifier(apiKey, apiSecret);
    const credentials = await Promise.all([issuerService.issue(call(), owner, fixedNow, installationA),
      issuerService.issue(call(), owner, fixedNow, installationB), issuerService.issue(call(), other, fixedNow, installationA)]);
    expect(new Set(credentials.map(value => value.participantIdentity)).size).toBe(3);
    for (const value of credentials) {
      const claims = await verifier.verify(value.token);
      expect(value.participantIdentity).toMatch(new RegExp("^" + VOICE_GRANT_IDENTITY_PREFIX + "[0-9a-f-]{36}$", "u"));
      expect(claims.sub).toBe(value.participantIdentity); expect(claims.name).toBeUndefined();
      expect(claims.video).toMatchObject({ roomJoin: true, room: "cop-call-" + callId });
      for (const raw of [owner.subjectId, other.subjectId, owner.username, owner.displayName, installationA, installationB])
        expect(JSON.stringify(claims)).not.toContain(raw);
    }
    const refreshed = await mediaIssuer(ledger(grants.options.store)).issue(call(), owner, new Date(fixedNow.getTime() + 60_000), installationA);
    expect(refreshed.participantIdentity).toBe(credentials[0]!.participantIdentity);
    expect((await verifier.verify(refreshed.token)).sub).toBe(credentials[0]!.participantIdentity);
    expect(credentials[0]!.e2eeKey).toBe(refreshed.e2eeKey);
    expect(credentials[0]!.e2eeKey).toBe(credentials[2]!.e2eeKey);
  });

  it("preserves legacy subject/name credentials and never falls back for missing scoped configuration or unproven scope", async () => {
    const grants = ledger(), issuerService = mediaIssuer(grants), owner = actor(), verifier = new TokenVerifier(apiKey, apiSecret);
    const legacy = await issuerService.issue(call(), actor("synthetic-legacy-subject", "csm-mobile"), fixedNow);
    expect((await verifier.verify(legacy.token)).sub).toBe("synthetic-legacy-subject");
    expect((await verifier.verify(legacy.token)).name).toBe(owner.displayName); expect(legacy).not.toHaveProperty("participantIdentity");
    await expect(issuerService.issue(call(), owner, fixedNow)).rejects.toMatchObject({ status: 503, code: "VOICE_GRANTS_UNAVAILABLE" });
    await expect(issuerService.issue(call(), owner, fixedNow, installationA)).rejects.toMatchObject({ status: 403, code: "VOICE_INSTALLATION_NOT_ATTESTED" });
    await expect(issuerService.issue(call(), { ...owner, issuer: issuer + "/forged" }, fixedNow, installationA))
      .rejects.toMatchObject({ status: 403, code: "VOICE_SCOPE_NOT_PROVEN" });
    await expect(mediaIssuer(undefined, clientId).issue(call(), owner, fixedNow, installationA))
      .rejects.toMatchObject({ status: 503, code: "VOICE_GRANTS_UNAVAILABLE" });
  });
});

describe("authenticated scoped voice API integration", () => {
  it.each(["mint", "peer"] as const)("does not return scoped media when the call ends during the %s await", async (stage) => {
    const f = authFixture(); await f.grants.attestInstallation(actor(), installationA, fixedNow);
    const issuerService = mediaIssuer(f.grants), issueMedia = issuerService.issue.bind(issuerService);
    const profiles = new InMemoryUserProfileStore();
    let issuedCall: VoiceCallRecord | undefined;
    const end = async () => {
      expect(issuedCall).toBeDefined();
      await f.calls.transition(issuedCall!.callId, { action: "cancel", actorSubjectId: actor().subjectId, now: fixedNow.toISOString() });
    };
    vi.spyOn(issuerService, "issue").mockImplementation(async (...args) => {
      const result = await issueMedia(...args); issuedCall = args[0];
      if (stage === "mint") await end();
      return result;
    });
    if (stage === "peer") vi.spyOn(profiles, "getProfile").mockImplementation(async () => {
      if (issuedCall) await end();
      return null;
    });
    const app = buildServer({ messagingProvider: f.provider, mobilityStore: f.store, voiceGrantLedger: f.grants,
      voiceCallMediaIssuer: issuerService, voiceCallStore: f.calls, userProfileStore: profiles, now: () => fixedNow });
    try {
      const result = await app.inject({ method: "POST", url: "/api/v1/messaging/calls",
        headers: headers(actor().subjectId, installationA), payload: { roomId: matrixRoom } });
      expect(result.statusCode).toBe(403); expect(result.json().error.code).toBe("VOICE_CALL_ADMISSION_DENIED");
      expect(result.json()).not.toHaveProperty("media");
      expect(await f.calls.get(issuedCall!.callId)).toMatchObject({ phase: "cancelled" });
      expect(await f.store.transact([], tx => tx.scan("voice-grant-ledger:v1:identity:"))).toHaveLength(1);
    } finally { await app.close(); }
  });

  it("rechecks accepted call state after answered-elsewhere notification before returning media", async () => {
    const f = authFixture(); await f.grants.attestInstallation(actor(), installationA, fixedNow);
    const incoming = await f.calls.create({ now: fixedNow.toISOString(), expiresAt: "2026-10-11T12:10:00Z",
      initiatorSubjectId: "synthetic-caller", participantSubjectIds: [actor().subjectId], roomId: matrixRoom,
      kind: "direct", title: "Synthetic incoming" });
    f.notification.mockImplementation(async (...args) => {
      if (args[3].type === "chat.voice_call.answered_elsewhere") await f.calls.transition(incoming.callId,
        { action: "end", actorSubjectId: actor().subjectId, now: fixedNow.toISOString() });
      return { status: "online", enabled: true, providerId: "csm.messaging", warnings: [] } as never;
    });
    const app = buildServer({ messagingProvider: f.provider, mobilityStore: f.store, voiceGrantLedger: f.grants,
      voiceCallMediaIssuer: mediaIssuer(f.grants), voiceCallStore: f.calls, now: () => fixedNow });
    try {
      const result = await app.inject({ method: "POST", url: `/api/v1/messaging/calls/${incoming.callId}/actions`,
        headers: headers(actor().subjectId, installationA), payload: { action: "accept" } });
      expect(result.statusCode).toBe(403); expect(result.json().error.code).toBe("VOICE_CALL_ADMISSION_DENIED");
      expect(result.json()).not.toHaveProperty("media"); expect(await f.calls.get(incoming.callId)).toMatchObject({ phase: "ended" });
    } finally { await app.close(); }
  });

  it("returns sanitized 503 when the authoritative call state becomes unavailable after mint", async () => {
    const f = authFixture(); await f.grants.attestInstallation(actor(), installationA, fixedNow);
    const issuerService = mediaIssuer(f.grants), issueMedia = issuerService.issue.bind(issuerService);
    vi.spyOn(issuerService, "issue").mockImplementation(async (...args) => {
      const result = await issueMedia(...args);
      vi.spyOn(f.calls, "get").mockRejectedValue(new Error("private-call-store-detail"));
      vi.spyOn(f.calls, "transition").mockRejectedValue(new Error("private-compensation-detail"));
      return result;
    });
    const app = buildServer({ messagingProvider: f.provider, mobilityStore: f.store, voiceGrantLedger: f.grants,
      voiceCallMediaIssuer: issuerService, voiceCallStore: f.calls, now: () => fixedNow });
    try {
      const result = await app.inject({ method: "POST", url: "/api/v1/messaging/calls",
        headers: headers(actor().subjectId, installationA), payload: { roomId: matrixRoom } });
      expect(result.statusCode).toBe(503); expect(result.json().error.code).toBe("VOICE_CALL_STATE_UNAVAILABLE");
      expect(result.json()).not.toHaveProperty("media"); expect(result.body).not.toContain("private-");
    } finally { await app.close(); }
  });

  it("bounds both a stalled post-mint read and stalled denial compensation without returning media", async () => {
    const f = authFixture(); await f.grants.attestInstallation(actor(), installationA, fixedNow);
    const issuerService = mediaIssuer(f.grants), issueMedia = issuerService.issue.bind(issuerService);
    let entered!: () => void; const minted = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(issuerService, "issue").mockImplementation(async (...args) => {
      const result = await issueMedia(...args);
      vi.spyOn(f.calls, "get").mockImplementation(() => new Promise(() => undefined));
      vi.spyOn(f.calls, "transition").mockImplementation(() => new Promise(() => undefined));
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); entered();
      return result;
    });
    const app = buildServer({ messagingProvider: f.provider, mobilityStore: f.store, voiceGrantLedger: f.grants,
      voiceCallMediaIssuer: issuerService, voiceCallStore: f.calls, now: () => fixedNow });
    try {
      const response = app.inject({ method: "POST", url: "/api/v1/messaging/calls",
        headers: headers(actor().subjectId, installationA), payload: { roomId: matrixRoom } });
      await minted; await vi.advanceTimersByTimeAsync(10_001);
      const result = await response;
      expect(result.statusCode).toBe(503); expect(result.json().error.code).toBe("VOICE_CALL_STATE_UNAVAILABLE");
      expect(result.json()).not.toHaveProperty("media"); expect(f.calls.transition).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); await app.close(); }
  });

  it("requires online server bootstrap ownership before creating or notifying a call, then persists an opaque refreshed identity", async () => {
    const f = authFixture(), create = vi.spyOn(f.calls, "create"), preflight = vi.spyOn(f.grants, "assertInstallation");
    const app = buildServer({ messagingProvider: f.provider, mobilityStore: f.store, voiceGrantLedger: f.grants,
      voiceCallMediaIssuer: mediaIssuer(f.grants), voiceCallStore: f.calls, now: () => fixedNow });
    try {
      const start = (requestHeaders: Record<string, string>) => app.inject({ method: "POST", url: "/api/v1/messaging/calls",
        headers: requestHeaders, payload: { roomId: matrixRoom } });
      const missing = await start({ ...headers(), "x-csm-app-client-id": "cop-web" });
      expect(missing.statusCode).toBe(400); expect(missing.json().error.code).toBe("VOICE_INSTALLATION_REQUIRED");
      const unknown = await start(headers(actor().subjectId, installationA));
      expect(unknown.statusCode).toBe(403); expect(unknown.json().error.code).toBe("VOICE_INSTALLATION_NOT_ATTESTED");
      expect(create).not.toHaveBeenCalled(); expect(f.conversation).not.toHaveBeenCalled(); expect(f.notification).not.toHaveBeenCalled();
      const bootstrap = await app.inject({ method: "POST", url: "/api/v1/messaging/bootstrap", headers: headers(),
        payload: { deviceId: "JIZDA.synthetic", installationId: installationA } });
      expect(bootstrap.statusCode).toBe(200);
      expect(f.bootstrap).toHaveBeenCalledWith(expect.objectContaining({ issuer, subjectId: actor().subjectId, authorizedParty: clientId }),
        fixedNow, "JIZDA.synthetic", installationA);
      expect((await start(headers("synthetic-account-b", installationA))).statusCode).toBe(403);
      expect(create).not.toHaveBeenCalled(); expect(f.notification).not.toHaveBeenCalled();
      preflight.mockClear();
      const result = await start(headers(actor().subjectId, installationA.toUpperCase()));
      expect(result.statusCode).toBe(201); expect(create).toHaveBeenCalledTimes(1); expect(f.notification).toHaveBeenCalledTimes(1);
      expect(preflight.mock.invocationCallOrder[0]).toBeLessThan(f.conversation.mock.invocationCallOrder[0]!);
      expect(preflight.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]!);
      expect(preflight.mock.invocationCallOrder[0]).toBeLessThan(f.notification.mock.invocationCallOrder[0]!);
      const identity = result.json().media.participantIdentity;
      expect(identity).toMatch(new RegExp("^" + VOICE_GRANT_IDENTITY_PREFIX, "u"));
      const mediaClaims = await new TokenVerifier(apiKey, apiSecret).verify(result.json().media.token);
      expect(mediaClaims.sub).toBe(identity); expect(mediaClaims.name).toBeUndefined();
      const detail = await app.inject({ method: "GET", url: `/api/v1/messaging/calls/${result.json().call.callId}`,
        headers: headers(actor().subjectId, installationA) });
      expect(detail.statusCode).toBe(200); expect(detail.json().media.participantIdentity).toBe(identity);
      expect((await app.inject({ method: "GET", url: `/api/v1/messaging/calls/${result.json().call.callId}`, headers: headers() })).statusCode).toBe(400);
    } finally { await app.close(); }
  });

  it("preflights accept/heartbeat/media_connected before mutations, while terminal decline remains possible without the header", async () => {
    const f = authFixture(), transition = vi.spyOn(f.calls, "transition");
    const existing = await f.calls.create({ now: fixedNow.toISOString(), expiresAt: "2026-10-11T12:10:00Z", initiatorSubjectId: "synthetic-caller",
      participantSubjectIds: [actor().subjectId], roomId: matrixRoom, kind: "direct", title: "Synthetic incoming" });
    const app = buildServer({ messagingProvider: f.provider, mobilityStore: f.store, voiceGrantLedger: f.grants,
      voiceCallMediaIssuer: mediaIssuer(f.grants), voiceCallStore: f.calls, now: () => fixedNow });
    try {
      for (const action of ["accept", "heartbeat", "media_connected"]) {
        const missing = await app.inject({ method: "POST", url: `/api/v1/messaging/calls/${existing.callId}/actions`, headers: headers(), payload: { action } });
        expect(missing.statusCode).toBe(400); expect(missing.json().error.code).toBe("VOICE_INSTALLATION_REQUIRED");
        const unknown = await app.inject({ method: "POST", url: `/api/v1/messaging/calls/${existing.callId}/actions`,
          headers: headers(actor().subjectId, installationA), payload: { action } });
        expect(unknown.statusCode).toBe(403);
      }
      expect(transition).not.toHaveBeenCalled(); expect(f.notification).not.toHaveBeenCalled();
      expect((await f.calls.get(existing.callId))!.phase).toBe("ringing");
      const declined = await app.inject({ method: "POST", url: `/api/v1/messaging/calls/${existing.callId}/actions`, headers: headers(), payload: { action: "decline" } });
      expect(declined.statusCode).toBe(200); expect(declined.json().call.phase).toBe("declined"); expect(declined.json()).not.toHaveProperty("media");
      expect(transition).toHaveBeenCalledTimes(1); expect(f.notification).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });

  it("terminates a newly created call if its attested installation is revoked during notification handoff", async () => {
    const f = authFixture(); await f.grants.attestInstallation(actor(), installationA, fixedNow);
    f.notification.mockImplementationOnce(async () => {
      await f.grants.revokeInstallation(actor(), installationA, operation, fixedNow);
      return { status: "online", enabled: true, providerId: "csm.messaging", warnings: [] } as never;
    });
    const app = buildServer({ messagingProvider: f.provider, mobilityStore: f.store, voiceGrantLedger: f.grants,
      voiceCallMediaIssuer: mediaIssuer(f.grants), voiceCallStore: f.calls, now: () => fixedNow });
    try {
      const result = await app.inject({ method: "POST", url: "/api/v1/messaging/calls", headers: headers(actor().subjectId, installationA),
        payload: { roomId: matrixRoom } });
      expect(result.statusCode).toBe(403); expect(result.json()).not.toHaveProperty("media");
      const created = await f.calls.listForSubject(actor().subjectId);
      expect(created).toHaveLength(1); expect(created[0]!.phase).toBe("failed");
      expect(await f.store.transact([], tx => tx.scan("voice-grant-ledger:v1:identity:"))).toEqual([]);
    } finally { await app.close(); }
  });

  it("compensates an accepted call when media issuance fails, notifying ended without announcing answered elsewhere", async () => {
    const f = authFixture(); await f.grants.attestInstallation(actor(), installationA, fixedNow);
    const incoming = await f.calls.create({ now: fixedNow.toISOString(), expiresAt: "2026-10-11T12:10:00Z", initiatorSubjectId: "synthetic-caller",
      participantSubjectIds: [actor().subjectId], roomId: matrixRoom, kind: "direct", title: "Synthetic incoming" });
    const issue = vi.fn(async () => { throw new VoiceGrantError(503, "VOICE_GRANT_CAPACITY_UNAVAILABLE"); });
    const app = buildServer({ messagingProvider: f.provider, mobilityStore: f.store, voiceGrantLedger: f.grants,
      voiceCallMediaIssuer: { enabled: true, issue }, voiceCallStore: f.calls, now: () => fixedNow });
    try {
      const result = await app.inject({ method: "POST", url: `/api/v1/messaging/calls/${incoming.callId}/actions`,
        headers: headers(actor().subjectId, installationA), payload: { action: "accept" } });
      expect(result.statusCode).toBe(503); expect(result.json().error.code).toBe("VOICE_GRANT_CAPACITY_UNAVAILABLE");
      expect(result.json()).not.toHaveProperty("media"); expect(issue).toHaveBeenCalledTimes(1);
      expect(await f.calls.get(incoming.callId)).toMatchObject({ phase: "failed", endReason: "voice_admission_failed" });
      expect(f.notification).toHaveBeenCalledTimes(1);
      expect(f.notification.mock.calls[0]![3]).toMatchObject({ type: "chat.voice_call.ended", audience: { userIds: ["synthetic-caller"] } });
    } finally { await app.close(); }
  });

  it("preserves Matrix bootstrap with intake disabled and forbids scoped call side effects without a legacy fallback", async () => {
    const f = authFixture(), paused = ledger(f.store, false), create = vi.spyOn(f.calls, "create"), attest = vi.spyOn(paused, "attestInstallation");
    const app = buildServer({ messagingProvider: f.provider, mobilityStore: f.store, voiceGrantLedger: paused,
      voiceCallMediaIssuer: mediaIssuer(paused), voiceCallStore: f.calls, now: () => fixedNow });
    try {
      expect((await app.inject({ method: "POST", url: "/api/v1/messaging/bootstrap", headers: headers(),
        payload: { deviceId: "JIZDA.synthetic", installationId: installationA } })).statusCode).toBe(200);
      expect(attest).not.toHaveBeenCalled();
      const result = await app.inject({ method: "POST", url: "/api/v1/messaging/calls", headers: headers(actor().subjectId, installationA), payload: { roomId: matrixRoom } });
      expect(result.statusCode).toBe(503); expect(result.json().error.code).toBe("VOICE_GRANTS_UNAVAILABLE");
      expect(create).not.toHaveBeenCalled(); expect(f.conversation).not.toHaveBeenCalled(); expect(f.notification).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("does not create dedicated calls without a ledger but preserves legacy calls and identities", async () => {
    const f = authFixture(), create = vi.spyOn(f.calls, "create");
    const app = buildServer({ messagingProvider: f.provider, mobilityStore: f.store, voiceCallMediaIssuer: mediaIssuer(undefined, clientId),
      voiceCallStore: f.calls, now: () => fixedNow });
    try {
      const send = (authorizedParty: string) => app.inject({ method: "POST", url: "/api/v1/messaging/calls",
        headers: headers(actor().subjectId, undefined, authorizedParty), payload: { roomId: matrixRoom } });
      expect((await send(clientId)).statusCode).toBe(503); expect(create).not.toHaveBeenCalled(); expect(f.notification).not.toHaveBeenCalled();
      const legacy = await send("csm-mobile"); expect(legacy.statusCode).toBe(201); expect(legacy.json().media).not.toHaveProperty("participantIdentity");
      expect((await new TokenVerifier(apiKey, apiSecret).verify(legacy.json().media.token)).sub).toBe(actor().subjectId);
    } finally { await app.close(); }
  });

  it("keeps per-installation revocation isolated and durable, distinguishing pending, unavailable and provider-completed retries", async () => {
    const f = authFixture(), owner = actor(), other = actor("synthetic-account-b");
    await f.grants.attestInstallation(owner, installationA, fixedNow); await f.grants.attestInstallation(owner, installationB, fixedNow);
    await f.grants.attestInstallation(other, installationA, fixedNow);
    const first = await f.grants.issueGrant(owner, installationA, callId, "cop-call-" + callId, fixedNow),
      second = await f.grants.issueGrant(owner, installationB, callId, "cop-call-" + callId, fixedNow),
      others = await f.grants.issueGrant(other, installationA, callId, "cop-call-" + callId, fixedNow);
    const revoke = vi.fn(async () => false);
    const app = buildServer({ messagingProvider: f.provider, mobilityStore: f.store, voiceGrantLedger: f.grants,
      voiceGrantRevoker: { revoke }, voiceCallMediaIssuer: mediaIssuer(f.grants), now: () => fixedNow });
    try {
      const send = (id = operation, subject = owner.subjectId, authorizedParty = clientId) => app.inject({ method: "POST",
        url: "/api/v1/me/voice-installations/revoke", headers: { ...headers(subject, undefined, authorizedParty), "idempotency-key": id },
        payload: { installationId: installationA } });
      expect((await send(operation, owner.subjectId, "csm-mobile")).statusCode).toBe(403); expect(revoke).not.toHaveBeenCalled();
      const pending = await send();
      expect(pending.statusCode).toBe(202); expect(pending.json()).toEqual({ contractVersion: "cop-voice-installation-revocation-v1",
        operationId: operation, scope: "installation", status: "revoking", joinDenied: true, providerVerified: false, accountDeleted: false });
      expect(pending.headers["cache-control"]).toBe("no-store");
      expect(revoke).toHaveBeenLastCalledWith([expect.objectContaining({ identity: first.identity, room: first.room })], operation);
      await expect(f.grants.assertAdmission(first.identity, first.room, fixedNow)).rejects.toMatchObject({ status: 403 });
      expect((await f.grants.assertAdmission(second.identity, second.room, fixedNow)).identity).toBe(second.identity);
      expect((await f.grants.assertAdmission(others.identity, others.room, fixedNow)).identity).toBe(others.identity);
      expect((await send(anotherOperation)).statusCode).toBe(409); expect(revoke).toHaveBeenCalledTimes(1);
      revoke.mockRejectedValueOnce(new VoiceGrantError(503, "VOICE_GRANT_PROVIDER_UNAVAILABLE"));
      const unavailable = await send(); expect(unavailable.statusCode).toBe(503); expect(unavailable.json().error.code).toBe("VOICE_GRANT_PROVIDER_UNAVAILABLE");
      expect(await ledger(f.store, false).confirmsRevoked(first.identity, first.room)).toBe(true);
      revoke.mockResolvedValueOnce(true);
      const completed = await send();
      expect(completed.statusCode).toBe(200); expect(completed.json()).toMatchObject({ status: "revoked", providerVerified: true,
        joinDenied: true, accountDeleted: false, operationId: operation });
      const forged = token(owner.subjectId).replace(/\.[^.]+$/u, ".forged");
      expect((await app.inject({ method: "POST", url: "/api/v1/me/voice-installations/revoke",
        headers: { authorization: "Bearer " + forged, "idempotency-key": operation }, payload: { installationId: installationB } })).statusCode).toBe(401);
      expect(revoke).toHaveBeenCalledTimes(3);
    } finally { await app.close(); }
  });
});

function receipt(providerVerified = true, receiptOperation = operation) {
  return { contractVersion: "cop-voice-grant-revocation-v1", operationId: receiptOperation, providerVerified };
}
function remoteGrant(index = 0): VoiceScopedGrant {
  return { identity: VOICE_GRANT_IDENTITY_PREFIX + randomUUID(), room: "cop-call-" + randomUUID(), grantId: randomUUID(), callId,
    appKey: "synthetic-opaque-app", installationKey: "synthetic-opaque-install-" + index, createdAt: fixedNow.toISOString(), validUntil: "2026-10-12T12:00:00Z" };
}
function remote(fetcher: typeof fetch, accepted = true) {
  return new RemoteVoiceGrantRevoker({ baseUrl: "https://admission.example.test", apiKey, apiSecret, accepted, fetch: fetcher });
}
describe("server-only voice revocation control boundary", () => {
  it("binds the exact bounded scope body to a signed room-admin JWT and accepts only a matching provider receipt", async () => {
    const grants = Array.from({ length: 129 }, (_, index) => remoteGrant(index));
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST"); expect(init?.redirect).toBe("error"); expect(init?.signal).toBeInstanceOf(AbortSignal);
      const body = String(init?.body), parsed = JSON.parse(body), auth = new Headers(init?.headers).get("authorization")!;
      const claims = await new TokenVerifier(apiKey, apiSecret).verify(auth.slice("Bearer ".length));
      expect(claims.video).toEqual({ roomAdmin: true, room: VOICE_REVOCATION_CONTROL_ROOM });
      expect(claims.metadata).toBe(createHash("sha256").update(body).digest("hex"));
      expect((claims.exp as number) - (claims.nbf as number)).toBeLessThanOrEqual(30);
      expect(parsed.operationId).toBe(operation); expect(parsed.grants.length).toBeLessThanOrEqual(128);
      for (const item of parsed.grants) expect(Object.keys(item).sort()).toEqual(["identity", "room"]);
      expect(body).not.toContain("synthetic-opaque-app"); expect(body).not.toContain("synthetic-opaque-install");
      return new Response(JSON.stringify(receipt()));
    });
    expect(await remote(fetcher as typeof fetch).revoke(grants, operation)).toBe(true); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledWith("https://admission.example.test/internal/voice-grants/revoke", expect.any(Object));
    const batches = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init!.body)).grants);
    expect(batches.map(items => items.length)).toEqual([128, 1]);
    expect(batches.flat()).toEqual(grants.map(({ identity, room }) => ({ identity, room })));
  });

  it("requires a receipt even for an empty scope and treats explicit provider pending as pending", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(receipt(false))));
    expect(await remote(fetcher as typeof fetch).revoke([], operation)).toBe(false); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((fetcher.mock.calls[0] as unknown as [unknown, RequestInit])[1].body))).toEqual({ operationId: operation, grants: [] });
  });

  it("does not contact any provider while acceptance is disabled", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(receipt())));
    expect(await remote(fetcher as typeof fetch, false).revoke([remoteGrant()], operation)).toBe(false);
    expect(await new UnacceptedVoiceGrantRevoker().revoke()).toBe(false); expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["429", () => new Response("private-provider-body", { status: 429 })],
    ["503", () => new Response("private-provider-body", { status: 503 })],
    ["wrong operation", () => new Response(JSON.stringify(receipt(true, anotherOperation)))],
    ["extra properties", () => new Response(JSON.stringify({ ...receipt(), token: "private-provider-body" }))],
    ["untyped proof", () => new Response(JSON.stringify({ ...receipt(), providerVerified: "true" }))],
    ["invalid JSON", () => new Response("private-provider-body")],
    ["oversized body", () => new Response(JSON.stringify({ ...receipt(), padding: "x".repeat(4_096) }))],
    ["network outage", () => { throw new Error("private-provider-body"); }]
  ] as const)("returns sanitized service 503 for %s rather than completion or a user authorization error", async (_name, response) => {
    const fetcher = vi.fn(async () => response());
    await expect(remote(fetcher as typeof fetch).revoke([remoteGrant()], operation)).rejects.toMatchObject({
      status: 503, code: "VOICE_GRANT_PROVIDER_UNAVAILABLE", message: "VOICE_GRANT_PROVIDER_UNAVAILABLE"
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
