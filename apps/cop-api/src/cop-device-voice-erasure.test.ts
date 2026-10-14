import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "./security.js";
import { InMemoryMobileDeviceStore, type MobileDeviceRegistrationInput } from "./mobile-device-store.js";
import { InMemoryVoiceCallStore, type VoiceCallCreateInput } from "./voice-call-store.js";
import { createCOPDevicesErasureAdapter } from "./cop-devices-erasure.js";
import { createVoiceLiveKitErasureAdapter, type VoiceErasureProvider } from "./voice-livekit-erasure.js";

const issuer = "https://oidc.example.test/realms/cop";
const now = "2026-10-14T00:00:00.000Z";
const owner = { issuer, subjectId: "actor-a" };
const actor: AuthenticatedActor = { authMode: "oidc", issuer, subjectId: owner.subjectId, username: "a", displayName: "A", roles: [] };
const context = { operationId: "92d47b15-a1f4-43e4-878c-74ff5460bd75", accountKey: "opaque-account", requestedAt: now, signal: new AbortController().signal };
const registration = (subjectId = owner.subjectId, ownerIssuer: string | undefined = issuer): MobileDeviceRegistrationInput => ({
  appVersion: "1", capabilities: ["voice"], deviceId: "device-1", deviceSessionId: "session-1", platform: "ios", pushTokenRegistered: true,
  registeredAt: now, subjectId, ...(ownerIssuer ? { ownerIssuer } : {})
});
const pairingActor = (subjectId = owner.subjectId, ownerIssuer: string | undefined = issuer) => ({ subjectId, username: "a", displayName: "A", ...(ownerIssuer ? { ownerIssuer } : {}) });
const callInput = (initiatorSubjectId = owner.subjectId, participantSubjectIds = ["actor-b"], ownerIssuer: string | undefined = issuer): VoiceCallCreateInput => ({
  initiatorSubjectId, participantSubjectIds, roomId: "!synthetic:example.test", title: "A personal label", kind: "direct", now,
  expiresAt: "2026-10-14T00:01:30.000Z", ...(ownerIssuer ? { ownerIssuer } : {})
});

describe("COP device erasure boundary", () => {
  it("purges own primary/fallback device, pairing and mesh records, retains another account and fences every writer", async () => {
    const primary = new InMemoryMobileDeviceStore(), fallback = new InMemoryMobileDeviceStore("memory-fallback");
    const stores = [primary, fallback];
    for (const store of stores) {
      await store.upsertDevice(registration(), "paired", now);
      await store.upsertDevice(registration("actor-b"), "paired", now);
      await store.ingestMeshBundle({ subjectId: owner.subjectId, ownerIssuer: issuer, envelopeId: "mesh-a", receivedAt: now });
      await store.ingestMeshBundle({ subjectId: "actor-b", ownerIssuer: issuer, envelopeId: "mesh-b", receivedAt: now });
      const pairing = await store.createPairingSession({ actor: pairingActor(), now, expiresAt: "2026-10-14T00:02:00.000Z" });
      await store.claimPairingSession(pairing.code, pairingActor(), registration(), now);
      await store.confirmPairingSession(pairing.code, now);
    }
    const adapter = createCOPDevicesErasureAdapter({ issuer, stores });
    expect(await adapter.ready()).toBe(true);
    expect((await adapter.preflight!(actor, context)).ready).toBe(true);
    expect((await adapter.erase(actor, context)).status).toBe("completed");
    expect((await adapter.erase(actor, context)).status).toBe("completed");
    for (const store of stores) {
      expect(await store.listDevices(owner.subjectId)).toEqual([]);
      expect(await store.listMeshAcks(owner.subjectId, undefined, 100)).toEqual([]);
      expect(await store.listDevices("actor-b")).toHaveLength(1);
      expect(await store.listMeshAcks("actor-b", undefined, 100)).toHaveLength(1);
      await expect(store.upsertDevice(registration(), "paired", now)).rejects.toMatchObject({ code: "ACCOUNT_REVOKED" });
      await expect(store.ingestMeshBundle({ subjectId: owner.subjectId, ownerIssuer: issuer, envelopeId: "mesh-new", receivedAt: now })).rejects.toMatchObject({ code: "ACCOUNT_REVOKED" });
      await expect(store.createPairingSession({ actor: pairingActor(), now, expiresAt: "2026-10-14T00:02:00.000Z" })).rejects.toMatchObject({ code: "ACCOUNT_REVOKED" });
      await expect(store.revokeDevice(owner.subjectId, "device-1", now)).rejects.toMatchObject({ code: "ACCOUNT_REVOKED" });
    }
  });
  it("does not adopt legacy or another issuer's rows on renewed registration", async () => {
    for (const previousIssuer of [undefined, "https://other.example.test"]) {
      const store = new InMemoryMobileDeviceStore();
      const legacy = registration(); delete legacy.ownerIssuer;
      if (previousIssuer) legacy.ownerIssuer = previousIssuer;
      await store.upsertDevice(legacy, "paired", now);
      if (previousIssuer) await expect(store.upsertDevice(registration(), "paired", now)).rejects.toMatchObject({ code: "ACCOUNT_OWNERSHIP_UNRESOLVED" });
      else expect((await store.upsertDevice(registration(), "paired", now)).ownerIssuer).toBeUndefined();
      expect((await store.preflightActorErasure(owner)).ready).toBe(false);
      expect((await store.purgeActor(owner, context.operationId, now)).complete).toBe(false);
      expect(await store.listDevices(owner.subjectId)).toHaveLength(1);
    }
  });
  it("blocks legacy mesh and pairing ownership, even with no registered devices", async () => {
    const store = new InMemoryMobileDeviceStore();
    await store.ingestMeshBundle({ subjectId: owner.subjectId, envelopeId: "legacy-mesh", receivedAt: now });
    const unknown = pairingActor(); delete unknown.ownerIssuer;
    await store.createPairingSession({ actor: unknown, now, expiresAt: "2026-10-14T00:02:00.000Z" });
    expect((await store.preflightActorErasure(owner)).ready).toBe(false);
    const adapter = createCOPDevicesErasureAdapter({ issuer, stores: [store] });
    expect(await adapter.preflight!(actor, context)).toEqual({ ready: false, reason: "ownership_unresolved" });
  });
  it("handles erase queued between pairing confirmation and device registration without resurrection", async () => {
    const store = new InMemoryMobileDeviceStore();
    const pairing = await store.createPairingSession({ actor: pairingActor(), now, expiresAt: "2026-10-14T00:02:00.000Z" });
    await store.claimPairingSession(pairing.code, pairingActor(), registration(), now);
    const confirming = store.confirmPairingSession(pairing.code, now);
    const deleting = store.purgeActor(owner, context.operationId, now);
    const confirmed = await confirming;
    expect(confirmed?.status).toBe("confirmed");
    expect((await deleting).complete).toBe(true);
    await expect(store.upsertDevice(confirmed!.claimedDevice!, "paired", now, pairing.code)).rejects.toMatchObject({ code: "ACCOUNT_REVOKED" });
    expect(await store.getPairingSession(pairing.code, now)).toBeNull();
  });
  it("does not let foreign actors claim pairing or mutate stored provenance through returned/input objects", async () => {
    const store = new InMemoryMobileDeviceStore(), input = registration();
    await store.upsertDevice(input, "paired", now);
    input.ownerIssuer = "https://foreign.example.test"; input.capabilities.push("mutation");
    const read = (await store.listDevices(owner.subjectId))[0]!;
    expect(read.ownerIssuer).toBe(issuer); expect(read.capabilities).toEqual(["voice"]);
    read.ownerIssuer = "https://foreign.example.test";
    expect((await store.preflightActorErasure(owner)).ready).toBe(true);
    const pairing = await store.createPairingSession({ actor: pairingActor(), now, expiresAt: "2026-10-14T00:02:00.000Z" });
    await expect(store.claimPairingSession(pairing.code, pairingActor("actor-b"), registration("actor-b"), now)).rejects.toThrow("Pairing owner mismatch");
    await expect(store.claimPairingSession(pairing.code, pairingActor(owner.subjectId, "https://other.example.test"), registration(), now)).rejects.toMatchObject({ code: "ACCOUNT_OWNERSHIP_UNRESOLVED" });
  });
  it("rejects unsupported stores, wrong identity and cancelled work without fabricating completion", async () => {
    const store = new InMemoryMobileDeviceStore();
    const adapter = createCOPDevicesErasureAdapter({ issuer, stores: [store] });
    await expect(adapter.erase({ ...actor, issuer: "https://foreign.example.test" }, context)).rejects.toThrow("Verified OIDC");
    const controller = new AbortController(); controller.abort();
    await expect(adapter.erase(actor, { ...context, signal: controller.signal })).rejects.toThrow();
    await store.upsertDevice(registration(), "paired", now);
    const unsupported = Object.assign(Object.create(store), { erasureReady: undefined }) as InMemoryMobileDeviceStore;
    expect(await createCOPDevicesErasureAdapter({ issuer, stores: [unsupported] }).ready()).toBe(false);
  });
});

describe("COP voice / LiveKit erasure boundary", () => {
  it("disconnects immediately but does not claim unused media JWTs revoked before expiry", async () => {
    const store = new InMemoryVoiceCallStore();
    const call = await store.create(callInput());
    await store.recordMediaGrant(owner, call.callId, "2026-10-14T00:10:00.000Z", now);
    let clock = new Date(now);
    const provider: VoiceErasureProvider = { ready: async () => true, removeAndVerify: vi.fn(async () => true) };
    const adapter = createVoiceLiveKitErasureAdapter({ issuer, stores: [store], provider, now: () => clock });
    expect(await adapter.ready()).toBe(true);
    expect((await adapter.preflight!(actor, context)).ready).toBe(true);
    expect(await adapter.erase(actor, context)).toEqual({ status: "pending", remaining: "cleanup_pending" });
    expect(provider.removeAndVerify).toHaveBeenCalledWith(owner.subjectId, [`cop-call-${call.callId}`], context.signal);
    expect(await store.get(call.callId)).not.toBeNull();
    await expect(store.recordMediaGrant(owner, call.callId, "2026-10-14T00:10:00.000Z", now)).rejects.toMatchObject({ code: "ACCOUNT_REVOKED" });
    await expect(store.create(callInput("actor-b", [owner.subjectId]))).rejects.toMatchObject({ code: "ACCOUNT_REVOKED" });
    await expect(store.transition(call.callId, { actorSubjectId: owner.subjectId, action: "heartbeat", now })).rejects.toMatchObject({ code: "ACCOUNT_REVOKED" });
    clock = new Date("2026-10-14T01:00:29.000Z");
    expect((await adapter.erase(actor, context)).status).toBe("pending");
    clock = new Date("2026-10-14T01:00:30.000Z");
    expect((await adapter.erase(actor, context)).status).toBe("completed");
    const retained = await store.get(call.callId);
    expect(retained?.initiatorSubjectId).toBe("erased-account");
    expect(retained?.participantSubjectIds).toEqual(["actor-b"]);
    expect(retained?.phase).toBe("ended");
    expect(retained?.title).toBe("COP hovor");
    expect(await store.listForSubject(owner.subjectId)).toEqual([]);
    expect((await adapter.erase(actor, context)).status).toBe("completed");
  });
  it("removes only the deleted actor's call links/endpoint and retains unrelated calls", async () => {
    const store = new InMemoryVoiceCallStore();
    const incoming = await store.create(callInput("actor-b", [owner.subjectId]));
    await store.transition(incoming.callId, { actorSubjectId: owner.subjectId, action: "accept", endpointId: "own-endpoint", now });
    const other = await store.create(callInput("actor-b", ["actor-c"]));
    const adapter = createVoiceLiveKitErasureAdapter({ issuer, stores: [store], provider: undefined, mediaNeverEnabled: true });
    expect((await adapter.erase(actor, context)).status).toBe("completed");
    const retained = await store.get(incoming.callId);
    expect(retained?.initiatorSubjectId).toBe("actor-b");
    expect(retained?.participantSubjectIds).toEqual([]);
    expect(retained?.acceptedBySubjectId).toBeUndefined(); expect(retained?.acceptedByEndpointId).toBeUndefined();
    expect(await store.get(other.callId)).toEqual(other);
  });
  it("blocks unresolved legacy/foreign voice history and enforces true actor media ownership", async () => {
    for (const previousIssuer of [undefined, "https://other.example.test"]) {
      const store = new InMemoryVoiceCallStore(), input = callInput(); delete input.ownerIssuer;
      if (previousIssuer) input.ownerIssuer = previousIssuer;
      const call = await store.create(input);
      expect((await store.preflightActorErasure(owner)).ready).toBe(false);
      if (previousIssuer) await expect(store.recordMediaGrant(owner, call.callId, "2026-10-14T00:10:00.000Z", now)).rejects.toThrow("Unproven media grant owner");
      else {
        await store.recordMediaGrant(owner, call.callId, "2026-10-14T00:10:00.000Z", now);
        expect((await store.get(call.callId))?.ownerIssuer).toBeUndefined();
        expect((await store.preflightActorErasure(owner)).ready).toBe(false);
      }
    }
    const store = new InMemoryVoiceCallStore(), other = await store.create(callInput("actor-b", ["actor-c"]));
    await expect(store.recordMediaGrant(owner, other.callId, "2026-10-14T00:10:00.000Z", now)).rejects.toThrow("Unproven media grant owner");
    await expect(store.recordMediaGrant(owner, other.callId, "2026-10-14T02:00:00.000Z", now)).rejects.toThrow("Unsupported media grant expiry");
  });
  it("does not claim provider failure, absent provider or cancellation completed", async () => {
    const store = new InMemoryVoiceCallStore();
    await store.create(callInput());
    const absent = createVoiceLiveKitErasureAdapter({ issuer, stores: [store], provider: undefined });
    expect(await absent.ready()).toBe(false);
    expect((await absent.erase(actor, context)).status).toBe("pending");
    const provider: VoiceErasureProvider = { ready: async () => true, removeAndVerify: async () => false };
    const adapter = createVoiceLiveKitErasureAdapter({ issuer, stores: [store], provider, now: () => new Date("2026-10-14T02:00:00.000Z") });
    expect((await adapter.erase(actor, context)).status).toBe("pending");
    expect(await store.listForSubject(owner.subjectId)).toHaveLength(1);
    const controller = new AbortController(); controller.abort();
    await expect(adapter.erase(actor, { ...context, signal: controller.signal })).rejects.toThrow();
  });
  it("handles erase-versus-grant race without saving a late token grant", async () => {
    const store = new InMemoryVoiceCallStore(), call = await store.create(callInput());
    const fencing = store.fenceActor(owner, context.operationId, now);
    const issuing = store.recordMediaGrant(owner, call.callId, "2026-10-14T00:10:00.000Z", now);
    await fencing;
    await expect(issuing).rejects.toMatchObject({ code: "ACCOUNT_REVOKED" });
    const result = await store.fenceActor(owner, context.operationId, now);
    expect(result.notBefore).toBe("2026-10-14T01:00:30.000Z");
  });
  it("does not hand out media grants to an unaccepted recipient or to a stale terminal call", async () => {
    const store = new InMemoryVoiceCallStore(), call = await store.create(callInput());
    await expect(store.recordMediaGrant({ issuer, subjectId: "actor-b" }, call.callId, "2026-10-14T00:10:00.000Z", now)).rejects.toThrow("not accepted");
    await store.transition(call.callId, { actorSubjectId: owner.subjectId, action: "cancel", now });
    await expect(store.recordMediaGrant(owner, call.callId, "2026-10-14T00:10:00.000Z", now)).rejects.toThrow("inactive");
  });
});
