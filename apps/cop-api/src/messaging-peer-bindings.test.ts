import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveMessagingPeerBindings, type MessagingPeerBindings } from "./messaging-peer-bindings.js";
import { CsmMessagingProvider } from "./messaging-provider.js";
import { buildServer } from "./server.js";
import { clearJwksCacheForTests, type AuthenticatedActor } from "./security.js";
import { InMemoryUserProfileStore, type UserProfileRecord } from "./user-profile-store.js";

const issuer = "https://identity.peer-binding.test/realms/cop";
const actorId = "37a83127-e4f8-46c0-9ee9-e4f6f142cc8f";
const peerId = "aa5f0b15-541c-4da0-afcf-bcc424515cbc";
const otherId = "b187f915-457f-4c89-93d3-888f3e6507f8";
const clock = new Date("2026-10-16T19:00:00.000Z");
const actor: AuthenticatedActor = { authMode: "oidc", issuer, subjectId: actorId, displayName: "Actor", username: "actor" };
const profile = (subjectId = peerId, profileIssuer: string | undefined = issuer): UserProfileRecord => ({ subjectId, issuer: profileIssuer,
  displayName: "Private profile name", username: "private-profile", email: "private@example.invalid", preferences: { privateValue: "private" },
  alertPreferences: {}, updatedAt: clock.toISOString() });
const packet = (): MessagingPeerBindings => ({ contractVersion: "cop-verified-peer-bindings-v1", actorUserId: actorId, issuer,
  source: "canonical_cop_profile", observedAt: clock.toISOString(), validUntil: "2026-10-16T19:00:30.000Z", peers: [{ userId: peerId, issuer }] });
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "peer-binding-test", alg: "RS256", use: "sig" };
function token(subject = actorId) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const value = encode({ alg: "RS256", kid: jwk.kid }) + "." + encode({ iss: issuer, sub: subject, azp: "cop-web", exp: Math.floor(Date.now() / 1000) + 300 });
  return value + "." + createSign("RSA-SHA256").update(value).end().sign(privateKey).toString("base64url");
}
function configure(mode: "database_v2" | "native_v1" = "database_v2") {
  for (const [key, value] of Object.entries({ COP_AUTH_MODE: "oidc", COP_OIDC_ISSUER: issuer, COP_OIDC_ALLOWED_CLIENTS: "cop-web",
    COP_OIDC_REQUIRED_ROLE: "", COP_ALLOW_LAB_TOKEN: "false", COP_WEB_BFF_SESSION_ENABLED: "false", COP_ACCOUNT_ERASURE_ENABLED: "false",
    COP_ACCOUNT_SAFETY_AUTHORITY_MODE: mode, COP_ACCOUNT_ERASURE_SECRET: "", COP_ACCOUNT_SAFETY_GUARD_REQUIRED: "false" })) vi.stubEnv(key, value);
  clearJwksCacheForTests();
}
function provider(mode: "database_v2" | "native_v1" = "database_v2") {
  return new CsmMessagingProvider({ authorityMode: mode, baseUrl: "https://messaging.peer-binding.test", enabled: true,
    timeoutMs: 1000, cacheTtlMs: 0, token: "synthetic-service-only" });
}
function transport() {
  const sent: Array<{ path: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/protocol/openid-connect/certs")) return new Response(JSON.stringify({ keys: [jwk] }));
    if (url.hostname !== "messaging.peer-binding.test") throw new Error("Synthetic provider only");
    sent.push({ path: url.pathname, body: JSON.parse(options?.body as string), headers: options?.headers as Record<string, string> });
    return new Response(JSON.stringify({ contractVersion: "csm-messaging-provider-v1", providerId: "csm.messaging",
      identities: [{ userId: peerId, matrixUserId: "@peer:matrix.test" }], conversation: { conversationId: "room-1", title: "Peer",
        type: "direct", conversationKind: "direct", matrix: { roomId: "!room:matrix.test" } } }));
  }));
  return sent;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); clearJwksCacheForTests(); });

describe("private canonical COP peer attestation", () => {
  function setup() {
    const getProfile = vi.fn(async (_id: string): Promise<UserProfileRecord | null> => profile());
    const ready = vi.fn(async () => true), unavailable = vi.fn();
    const options = { actor, authorityMode: "database_v2", configuredIssuer: issuer, targets: [peerId],
      store: { name: "postgres", getProfile }, ready, now: () => clock, unavailable };
    return { options, getProfile, ready, unavailable };
  }
  it("attests exact canonical issuer/subject only, deduplicates peers and excludes profile content", async () => {
    const f = setup(); f.options.targets = [actorId, peerId, peerId, "unverified-not-a-uuid"];
    const result = await deriveMessagingPeerBindings(f.options);
    expect(result).toEqual(packet()); expect(f.getProfile).toHaveBeenCalledExactlyOnceWith(peerId);
    expect(JSON.stringify(result)).not.toMatch(/Private profile name|private-profile|private@example|privateValue/u);
  });
  it.each(["native_v1", "memory", "lab", "wrong_actor_issuer", "missing_issuer"])("omits authority for %s", async kind => {
    const f = setup();
    const options = { ...f.options, ...(kind === "native_v1" ? { authorityMode: "native_v1" } : {}),
      ...(kind === "memory" ? { store: { ...f.options.store, name: "memory" } } : {}),
      ...(kind === "lab" ? { actor: { ...actor, authMode: "lab" as const } } : {}),
      ...(kind === "wrong_actor_issuer" ? { actor: { ...actor, issuer: "https://other.invalid" } } : {}),
      ...(kind === "missing_issuer" ? { configuredIssuer: undefined } : {}) };
    expect(await deriveMessagingPeerBindings(options)).toBeUndefined(); expect(f.getProfile).not.toHaveBeenCalled();
  });
  it.each(["absent", "wrong_issuer", "unknown_issuer", "wrong_subject"])("does not infer %s peer provenance from actor", async kind => {
    const f = setup();
    f.getProfile.mockResolvedValue(kind === "absent" ? null : kind === "wrong_subject" ? profile(otherId)
      : kind === "wrong_issuer" ? profile(peerId, "https://other.invalid") : { ...profile(), issuer: undefined });
    expect(await deriveMessagingPeerBindings(f.options)).toBeUndefined();
  });
  it("omits unavailable canonical proof, reports failure and never substitutes a fallback", async () => {
    const f = setup(); f.ready.mockResolvedValue(false);
    expect(await deriveMessagingPeerBindings(f.options)).toBeUndefined(); expect(f.getProfile).not.toHaveBeenCalled();
    f.ready.mockResolvedValue(true); const failure = new Error("Canonical store unavailable"); f.getProfile.mockRejectedValue(failure);
    expect(await deriveMessagingPeerBindings(f.options)).toBeUndefined(); expect(f.unavailable).toHaveBeenCalledWith(failure);
  });
});

describe("COP HTTP to Messaging private binding boundary", () => {
  const requests = [
    { name: "create", url: "/api/v1/messaging/conversations", payload: { title: "Peer", type: "direct", members: [{ userId: peerId }] }, status: 201,
      outbound: { title: "Peer", type: "direct", conversationKind: "direct", members: [{ userId: peerId }] } },
    { name: "invite", url: "/api/v1/messaging/conversations/room-1/members", payload: { members: [{ userId: peerId }] }, status: 200,
      outbound: { members: [{ userId: peerId }] } },
    { name: "resolve", url: "/api/v1/messaging/matrix/identities/resolve", payload: { userIds: [peerId] }, status: 200,
      outbound: { userIds: [peerId] } }
  ];
  it.each(requests)("recomputes $name proof from verified session and canonical profile despite body/header spoofing", async request => {
    configure(); const sent = transport();
    // A contract double for canonical-store reads; this is an HTTP boundary test, not a PostgreSQL/provider acceptance claim.
    const store = new InMemoryUserProfileStore("postgres"); await store.upsertProfile(profile());
    const app = buildServer({ messagingProvider: provider(), userProfileStore: store, now: () => clock });
    try {
      expect((await app.inject({ method: "POST", url: request.url, payload: request.payload })).statusCode).toBe(401);
      expect(sent).toEqual([]);
      const response = await app.inject({ method: "POST", url: request.url, payload: { ...request.payload,
        peerBindings: { ...packet(), actorUserId: otherId, issuer: "https://forged.invalid", peers: [{ userId: otherId, issuer }] } },
        headers: { authorization: `Bearer ${token()}`, "x-csm-user-id": otherId, "x-csm-oidc-issuer": "https://forged.invalid", "x-cop-peer-bindings": "forged" } });
      expect(response.statusCode).toBe(request.status); expect(sent).toHaveLength(1);
      expect(sent[0]?.body).toEqual({ ...request.outbound, peerBindings: packet() });
      expect(sent[0]?.headers["x-csm-user-id"]).toBe(actorId); expect(sent[0]?.headers["x-csm-oidc-issuer"]).toBe(issuer);
      expect(sent[0]?.headers).not.toHaveProperty("x-cop-peer-bindings");
    } finally { await app.close(); }
  });
  it("omits proof when canonical storage is unavailable even if a verified peer profile exists in the directory RAM fallback", async () => {
    configure(); const sent = transport(); const store = new InMemoryUserProfileStore("postgres");
    vi.spyOn(store, "init").mockRejectedValue(new Error("Synthetic canonical outage"));
    const canonicalRead = vi.spyOn(store, "getProfile");
    const app = buildServer({ messagingProvider: provider(), userProfileStore: store, now: () => clock });
    try {
      // This existing profile API really populates the separate RAM fallback when canonical init fails.
      expect((await app.inject({ method: "GET", url: "/api/v1/me/preferences", headers: { authorization: `Bearer ${token(peerId)}` } })).statusCode).toBe(200);
      const response = await app.inject({ method: "POST", url: requests[2]!.url, payload: requests[2]!.payload, headers: { authorization: `Bearer ${token()}` } });
      expect(response.statusCode).toBe(200); expect(sent[0]?.body).toEqual({ userIds: [peerId] }); expect(canonicalRead).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it.each(["absent", "wrong_issuer"])("omits unproven %s canonical peer without disabling existing known-peer resolution", async kind => {
    configure(); const sent = transport(); const store = new InMemoryUserProfileStore("postgres");
    if (kind === "wrong_issuer") await store.upsertProfile(profile(peerId, "https://other.invalid"));
    const app = buildServer({ messagingProvider: provider(), userProfileStore: store, now: () => clock });
    try {
      const response = await app.inject({ method: "POST", url: requests[2]!.url, payload: { ...requests[2]!.payload, peerBindings: packet() }, headers: { authorization: `Bearer ${token()}` } });
      expect(response.statusCode).toBe(200); expect(sent[0]?.body).toEqual({ userIds: [peerId] });
    } finally { await app.close(); }
  });
  it("keeps native_v1 provider payloads unchanged and strips runtime body spoofing on every affected method", async () => {
    const sent = transport(), native = provider("native_v1");
    const input = { title: "Peer", type: "direct" as const, conversationKind: "direct" as const, members: [{ userId: peerId }], peerBindings: packet() };
    await native.createConversation(actor, clock, input, packet());
    await native.addConversationMembers(actor, clock, "room-1", input.members, packet());
    await native.resolveMatrixIdentities(actor, clock, [peerId], packet());
    expect(sent.map(request => request.body)).toEqual([{ title: "Peer", type: "direct", conversationKind: "direct", members: input.members }, { members: input.members }, { userIds: [peerId] }]);
    const db = provider(); await db.createConversation(actor, clock, input);
    expect(sent[3]?.body).not.toHaveProperty("peerBindings");
  });
});
