import { createHmac, generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { MobilityAccountErasureAdapter, type MobilityProviderEffects, type MobilityProviderManifest } from "./mobility-account-erasure.js";
import { mobilityIdentityDigest } from "./mobility-erasure-guard.js";
import { SharedMobilityService } from "./mobility-invitations.js";
import { MobilityInvitationOutbox } from "./mobility-invitation-outbox.js";
import type { MessagingProvider } from "./messaging-provider.js";
import { MobilityFailure, type GroupState, type MobilityOperationReceipt, type PrincipalAccount } from "./mobility-service.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import type * as Wire from "./mobility-types.js";
import type { AuthenticatedActor } from "./security.js";
import { AccountErasureError, AccountErasureService, ACCOUNT_ERASURE_ADAPTER_IDS } from "./account-erasure.js";

const issuer = "https://synthetic-mobility-owner.test/issuer", now = new Date("2026-10-14T09:00:00.000Z");
const actor = (id: string): AuthenticatedActor => ({ authMode: "oidc", issuer, subjectId: id, displayName: `Synthetic ${id}`,
  username: id, email: `${id}@example.test`, emailVerified: true, roles: [] });
const ctx = (operationId = randomUUID()) => ({ operationId, requestedAt: now.toISOString(), accountKey: "synthetic-erasure-owner", signal: new AbortController().signal });
const key = () => (generateKeyPairSync("x25519").publicKey.export({ type: "spki", format: "der" }) as Buffer).subarray(-32).toString("base64");
const cache = (service: SharedMobilityService) => (service as unknown as { latestPoints: Map<string, Wire.DispatchPointPublish>; invalidatedShares: Map<string, number> });
async function fixture() {
  const store = new MemoryMobilityStore(), service = new SharedMobilityService(store, () => now);
  const aa = actor("a"), ba = actor("b"), ca = actor("c");
  const a = await service.account(aa), b = await service.account(ba), c = await service.account(ca);
  const eraseEffects = vi.fn(async (_actor: AuthenticatedActor, _manifest: MobilityProviderManifest) => ({ status: "completed" as const, proofId: "synthetic-provider-readback" }));
  const effects: MobilityProviderEffects = { ready: async () => true, preflight: async () => ({ ready: true, version: "synthetic-provider-v1" }), erase: eraseEffects };
  const adapter = new MobilityAccountErasureAdapter({ service, issuer, providerEffects: effects });
  return { store, service, aa, ba, ca, a, b, c, adapter, effects, eraseEffects };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function join(f: Fixture, type: "group" | "vehicle", owner = f.c, guest = f.a) {
  const entityId = type === "group" ? (await f.service.createGroup(owner, { operationId: randomUUID(), name: "Synthetic group" })).groupId
    : (await f.service.createVehicle(owner, { operationId: randomUUID(), details: { name: "Synthetic vehicle" } })).vehicleId;
  const invitation = await f.service.createInvitation(owner, type, entityId, { operationId: randomUUID(), expectedMembershipRevision: 1,
    email: guest.email!, ...(type === "vehicle" ? { capabilities: ["readVehicle", "recordExpense"] as Wire.SharedVehicleMember["capabilities"] } : {}) });
  await f.service.acceptInvitation(guest, type, { operationId: randomUUID(), invitationId: invitation.invitationId });
  return { entityId, invitationId: invitation.invitationId };
}
async function share(f: Fixture) {
  const { entityId: groupId } = await join(f, "group");
  const other = await f.service.createInvitation(f.c, "group", groupId, { operationId: randomUUID(), expectedMembershipRevision: 2, email: f.b.email! });
  await f.service.acceptInvitation(f.b, "group", { operationId: randomUUID(), invitationId: other.invitationId });
  const devices = await Promise.all([f.a, f.b, f.c].map(account => f.service.registerDevice(account, { operationId: randomUUID(), publicKeyX25519: key(), deviceName: "Synthetic" })));
  const readiness = await f.service.readiness(f.a, groupId);
  const start = await f.service.startShare(f.a, groupId, { operationId: randomUUID(), deviceId: devices[0]!.deviceId,
    expectedMembershipRevision: readiness.membershipRevision, audienceHash: readiness.audienceHash, durationSeconds: 900, endPolicy: "duration", consent: true });
  const point: Wire.DispatchPointPublish = { deviceId: devices[0]!.deviceId, sequence: 1, observedAt: now.toISOString(), source: "gps",
    membershipRevision: readiness.membershipRevision, audienceHash: readiness.audienceHash,
    boxes: readiness.devices.map(device => ({ recipientDeviceId: device.deviceId, ephemeralPublicKeyX25519: key(), combinedCiphertext: Buffer.alloc(64, 5).toString("base64") })) };
  await f.service.publishPoint(f.a, start.share.shareId, point);
  return { groupId, shareId: start.share.shareId, point, devices };
}

describe("Mobility complete local erasure owner", () => {
  it("removes verified identity/profile/email/device/cancellation/invitation bindings and preserves B", async () => {
    const f = await fixture(), x = await share(f), bBefore = await f.store.transact([], tx => tx.get(`account:${f.b.accountId}`));
    await f.service.cancelStart(f.a, { operationId: randomUUID(), startOperationId: randomUUID() });
    expect(await f.adapter.preflight(f.aa, { signal: ctx().signal })).toMatchObject({ ready: true });
    expect(await f.adapter.erase(f.aa, ctx())).toMatchObject({ status: "completed", proofId: expect.any(String) });
    const rows = await f.store.transact([], tx => tx.scan(""));
    expect(rows.some(row => row.key === `identity:${mobilityIdentityDigest(issuer, "a")}` || row.key === `account:${f.a.accountId}` ||
      row.key.startsWith(`device:${f.a.accountId}:`) || row.key.startsWith(`cancel-start:${f.a.accountId}:`) || row.key.startsWith(`account-email:${f.a.accountId}:`))).toBe(false);
    const group = await f.store.transact([], tx => tx.get<GroupState>(`group:${x.groupId}`));
    expect(group!.group.members.map(member => member.accountId)).toEqual([f.c.accountId, f.b.accountId]);
    expect(group!.shares[x.shareId]).toBeUndefined();
    expect(await f.store.transact([], tx => tx.get(`share:${x.shareId}`))).toBeUndefined();
    expect(cache(f.service).latestPoints.size).toBe(0);
    expect(cache(f.service).invalidatedShares.size).toBe(0);
    expect(await f.store.transact([], tx => tx.get(`account:${f.b.accountId}`))).toEqual(bBefore);
    await expect(f.service.account(f.aa)).rejects.toMatchObject({ code: "ACCOUNT_ERASURE_FENCED" });
    await expect(f.service.registerDevice(f.a, { operationId: randomUUID(), publicKeyX25519: key(), deviceName: "late" })).rejects.toMatchObject({ code: "ACCOUNT_ERASURE_FENCED" });
  });
  it("clears recipient ciphertext and invalidates every old audience without removing B share history", async () => {
    const f = await fixture(), x = await share(f);
    const before = await f.store.transact([], tx => tx.get<GroupState>(`group:${x.groupId}`));
    expect(await f.adapter.erase(f.ba, ctx())).toMatchObject({ status: "completed" });
    const after = await f.store.transact([], tx => tx.get<GroupState>(`group:${x.groupId}`));
    expect(after!.shares[x.shareId]!.accountId).toBe(f.a.accountId);
    expect(after!.shares[x.shareId]!.state).toBe("stopped");
    expect(after!.group.membershipRevision).toBe(before!.group.membershipRevision + 1);
    expect(cache(f.service).latestPoints.size).toBe(0);
    await expect(f.service.publishPoint(f.a, x.shareId, { ...x.point, sequence: 2 })).rejects.toMatchObject({ code: "SHARE_STOPPED" });
  });
  it("requires explicit group ownership resolution and writes no fence on normal preflight", async () => {
    const f = await fixture(); await f.service.createGroup(f.a, { operationId: randomUUID(), name: "Owned group" });
    expect(await f.adapter.preflight(f.aa, { signal: ctx().signal })).toEqual({ ready: false, reason: "ownership_unresolved" });
    expect(await f.adapter.erase(f.aa, ctx())).toEqual({ status: "pending", remaining: "cleanup_pending" });
    expect(await f.store.transact([], tx => tx.scan("mobility-erasure:"))).toHaveLength(0);
  });
  it("carries exact conversation IDs into provider cleanup before vehicle subset removes own receipts", async () => {
    const f = await fixture(), operation = randomUUID(), conversationId = "synthetic-conversation", roomId = "!synthetic-room:test";
    await f.store.transact([], tx => tx.set(`operation:${f.a.accountId}:${operation}`, {
      hash: "synthetic", createdAt: now.toISOString(), result: { operationId: operation, accountId: f.b.accountId, conversationId, roomId }
    } satisfies MobilityOperationReceipt));
    expect(await f.adapter.erase(f.aa, ctx())).toMatchObject({ status: "completed" });
    expect(f.eraseEffects.mock.calls[0]![1]).toMatchObject({ conversationIds: [conversationId], roomIds: [roomId] });
    expect(await f.store.transact([], tx => tx.scan(`operation:${f.a.accountId}:`))).toHaveLength(0);
  });
  it.each(["absent", "pending", "failure"] as const)("never completes with %s external cleanup proof", async outcome => {
    const f = await fixture(); await join(f, "vehicle");
    const options = { service: f.service, issuer, ...(outcome === "absent" ? {} : { providerEffects: { ...f.effects,
      erase: async () => { if (outcome === "failure") throw new Error("synthetic provider outage"); return { status: "pending" as const, remaining: "cleanup_pending" as const }; } } }) };
    const adapter = new MobilityAccountErasureAdapter(options);
    expect(await adapter.erase(f.aa, ctx())).toEqual({ status: "pending", remaining: "cleanup_pending" });
    await expect(f.service.account(f.aa)).rejects.toMatchObject({ code: "ACCOUNT_ERASURE_FENCED" });
    expect(await f.store.transact([], tx => tx.get(`account:${f.a.accountId}`))).toBeUndefined();
    if (outcome === "absent") expect(await adapter.ready()).toBe(false);
  });
  it("retries after process replacement using the same durable manifest and rejects another operation", async () => {
    const f = await fixture(); const x = await join(f, "vehicle");
    const context = ctx(); f.eraseEffects.mockResolvedValueOnce({ status: "pending", remaining: "cleanup_pending" } as never);
    expect(await f.adapter.erase(f.aa, context)).toEqual({ status: "pending", remaining: "cleanup_pending" });
    const restarted = new MobilityAccountErasureAdapter({ service: new SharedMobilityService(f.store, () => now), issuer, providerEffects: f.effects });
    expect(await restarted.erase(f.aa, ctx())).toEqual({ status: "pending", remaining: "cleanup_pending" });
    expect(await restarted.erase(f.aa, context)).toMatchObject({ status: "completed" });
    expect(f.eraseEffects.mock.calls[0]![1]).toEqual(f.eraseEffects.mock.calls[1]![1]);
    expect(f.eraseEffects.mock.calls[1]![1].invitationIds).toContain(x.invitationId);
  });
  it("tracks prior verified email aliases without guessing the browser actor's new email", async () => {
    const f = await fixture(), first = await join(f, "vehicle");
    await f.service.account({ ...f.aa, email: "new@example.test" });
    const unseenInvite = await f.service.createInvitation(f.c, "vehicle", first.entityId, { operationId: randomUUID(), expectedMembershipRevision: 2,
      email: "unverified-history@example.test", capabilities: ["readVehicle"] });
    expect(await f.adapter.erase({ ...f.aa, email: "unverified-history@example.test", emailVerified: false }, ctx())).toMatchObject({ status: "completed" });
    expect(f.eraseEffects.mock.calls[0]![1].invitationIds).toContain(first.invitationId);
    expect(f.eraseEffects.mock.calls[0]![1].invitationIds).not.toContain(unseenInvite.invitationId);
    expect(await f.store.transact([], tx => tx.get(`invite:${unseenInvite.invitationId}`))).toBeDefined();
  });
  it("does not delete C's newly bound invitation when C later owns A's old email address", async () => {
    const f = await fixture();
    await f.service.account({ ...f.aa, email: "new-a@example.test" });
    await f.service.account({ ...f.ca, email: f.a.email });
    const vehicle = await f.service.createVehicle(f.b, { operationId: randomUUID(), details: { name: "B vehicle" } });
    const invitation = await f.service.createInvitation(f.b, "vehicle", vehicle.vehicleId, { operationId: randomUUID(), expectedMembershipRevision: 1,
      email: f.a.email!, capabilities: ["readVehicle"] });
    expect(await f.adapter.erase(f.aa, ctx())).toMatchObject({ status: "completed" });
    expect(f.eraseEffects.mock.calls[0]![1].invitationIds).not.toContain(invitation.invitationId);
    expect(await f.store.transact([], tx => tx.get(`invite:${invitation.invitationId}`))).toMatchObject({ recipientAccountIds: [f.c.accountId] });
  });
  it("blocks ambiguous alternate issuer binding before fencing instead of guessing an owner", async () => {
    const f = await fixture(), canonical = await f.store.transact([], tx => tx.get<PrincipalAccount>(`account:${f.a.accountId}`));
    await f.store.transact([], tx => tx.set("identity:synthetic-ambiguous", { ...canonical, issuer: "https://other.test", subject: "other" }));
    expect(await f.adapter.preflight(f.aa, { signal: ctx().signal })).toEqual({ ready: false, reason: "adapter_unavailable" });
    expect(await f.store.transact([], tx => tx.scan("mobility-erasure:"))).toHaveLength(0);
  });
  it("does not adopt an older account's unknown email history from today's verified login", async () => {
    const f = await fixture();
    await f.store.transact([], tx => tx.remove(`account-provenance:${f.a.accountId}`));
    await f.service.account(f.aa);
    expect(await f.store.transact([], tx => tx.get(`account-provenance:${f.a.accountId}`))).toBeUndefined();
    expect(await f.adapter.preflight(f.aa, { signal: ctx().signal })).toEqual({ ready: false, reason: "adapter_unavailable" });
    expect(await f.adapter.erase(f.aa, ctx())).toEqual({ status: "pending", remaining: "cleanup_pending" });
    expect(await f.store.transact([], tx => tx.scan("mobility-erasure:"))).toHaveLength(0);
  });
  it("does not create a new account or provenance marker when the old identity mapping is missing", async () => {
    const f = await fixture();
    await f.store.transact([], tx => tx.remove(`identity:${mobilityIdentityDigest(issuer, "a")}`));
    await expect(f.service.account(f.aa)).rejects.toMatchObject({ status: 503, code: "MOBILITY_IDENTITY_UNAVAILABLE" });
    expect(await f.store.transact([], tx => tx.scan("account:"))).toHaveLength(3);
  });
  it("rejects an already admitted writer against the central fence before any local adapter has run", async () => {
    const f = await fixture();
    const identitySecret = "synthetic-atomic-guard-secret-at-least-32-characters";
    const central = new AccountErasureService({ store: f.store, identitySecret, issuer, requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS,
      adapters: [], accepted: false, allowUnboundSyntheticStore: true });
    await central.init();
    const guarded = new SharedMobilityService(f.store, () => now, async (tx, principal) => {
      try { await central.assertAllowedWithin(tx, principal); }
      catch (error) { if (error instanceof AccountErasureError) throw new MobilityFailure(error.status, error.code, "synthetic central guard"); throw error; }
    });
    const a = await guarded.account(f.aa); // Request authorization and account resolution happened first.
    const accountKey = createHmac("sha256", identitySecret).update("cop-account-erasure-identity-v1\0").update(JSON.stringify([issuer, "a"])).digest("hex");
    await f.store.transact([], tx => tx.set(`account-erasure:job:${accountKey}`, { operationId: randomUUID() }));
    expect(await f.store.transact([], tx => tx.scan("mobility-erasure:"))).toHaveLength(0);
    await expect(guarded.createVehicle(a, { operationId: randomUUID(), details: { name: "late owner" } })).rejects.toMatchObject({ code: "ACCOUNT_ERASURE_FENCED" });
    await expect(guarded.createGroup(a, { operationId: randomUUID(), name: "late owner" })).rejects.toMatchObject({ code: "ACCOUNT_ERASURE_FENCED" });
    await expect(guarded.account({ ...f.aa, displayName: "late rename" })).rejects.toMatchObject({ code: "ACCOUNT_ERASURE_FENCED" });
    expect(await f.store.transact([], tx => tx.scan("vehicle:"))).toHaveLength(0);
    expect(await f.store.transact([], tx => tx.scan("group:"))).toHaveLength(0);
    expect((await guarded.account(f.ba)).accountId).toBe(f.b.accountId);
  });
  it.each(["fenced", "outage"] as const)("never emits a queued invitation when the central writer guard is %s", async condition => {
    const f = await fixture(), vehicle = await f.service.createVehicle(f.a, { operationId: randomUUID(), details: { name: "Queued" } });
    await f.service.createInvitation(f.a, "vehicle", vehicle.vehicleId, { operationId: randomUUID(), expectedMembershipRevision: 1, email: f.b.email!, capabilities: ["readVehicle"] });
    const send = vi.fn();
    const guard = async (_tx: unknown, accountId: string) => {
      if (accountId === f.a.accountId) throw new MobilityFailure(condition === "fenced" ? 403 : 503,
        condition === "fenced" ? "ACCOUNT_ERASURE_FENCED" : "ERASURE_STORE_UNAVAILABLE", "synthetic guard");
    };
    const outbox = new MobilityInvitationOutbox(f.store, { sendNotification: send } as unknown as MessagingProvider, () => now, guard);
    await outbox.drain();
    expect(send).not.toHaveBeenCalled();
    expect((await f.store.transact([], tx => tx.scan<{ state: string }>("invite-notification:")))[0]!.value.state)
      .toBe(condition === "fenced" ? "cancelled" : "pending");
    expect(await f.store.transact([], tx => tx.scan("mobility-notification-handoff:"))).toHaveLength(0);
  });
  it("does not accept readback from a store that silently refuses profile deletion", async () => {
    const f = await fixture(), original = f.store.transact.bind(f.store);
    f.store.transact = (keys, work) => original(keys, tx => work({ ...tx, remove: async key => { if (key !== `account:${f.a.accountId}`) await tx.remove(key); } }));
    expect(await f.adapter.erase(f.aa, ctx())).toEqual({ status: "pending", remaining: "cleanup_pending" });
    expect(f.eraseEffects).not.toHaveBeenCalled();
    expect(await original([], tx => tx.get(`account:${f.a.accountId}`))).toBeDefined();
  });
  it("cannot lose conversation side effects when a store drops the manifest journal", async () => {
    const f = await fixture(), original = f.store.transact.bind(f.store);
    await f.store.transact([], tx => tx.set(`operation:${f.a.accountId}:${randomUUID()}`, {
      hash: "synthetic", createdAt: now.toISOString(), result: { conversationId: "synthetic-must-not-be-lost" }
    } satisfies MobilityOperationReceipt));
    f.store.transact = (keys, work) => original(keys, tx => work({ ...tx, set: async (key, value) => {
      if (!key.startsWith("mobility-erasure:provider-manifest:")) await tx.set(key, value);
    } }));
    expect(await f.adapter.erase(f.aa, ctx())).toEqual({ status: "pending", remaining: "cleanup_pending" });
    expect(f.eraseEffects).not.toHaveBeenCalled();
    expect(await original([], tx => tx.scan("mobility-erasure:"))).toHaveLength(0);
    expect(await original([], tx => tx.scan(`operation:${f.a.accountId}:`))).toHaveLength(1);
  });
  it("includes an unknown network outcome from a replaced outbox process until provider verifies source fencing", async () => {
    const f = await fixture(), invitationId = randomUUID();
    const idempotencyKey = `cop-mobility-invitation-v1:${invitationId}:${f.b.accountId}`;
    await f.store.transact([], tx => tx.set(`mobility-notification-handoff:${invitationId}:${f.b.accountId}`, {
      version: 1, invitationId, inviterAccountId: f.a.accountId, recipientAccountId: f.b.accountId,
      idempotencyKey, state: "unconfirmed"
    }));
    const context = ctx(); f.eraseEffects.mockResolvedValueOnce({ status: "pending", remaining: "cleanup_pending" } as never);
    expect(await f.adapter.erase(f.aa, context)).toEqual({ status: "pending", remaining: "cleanup_pending" });
    const restarted = new MobilityAccountErasureAdapter({ service: new SharedMobilityService(f.store, () => now), issuer, providerEffects: f.effects });
    expect(await restarted.erase(f.aa, context)).toMatchObject({ status: "completed" });
    for (const call of f.eraseEffects.mock.calls) expect(call[1]).toMatchObject({ invitationIds: [invitationId], notificationIdempotencyKeys: [idempotencyKey] });
  });
  it("waits for in-flight notification and supplies exact downstream source fence manifest", async () => {
    const f = await fixture(), vehicle = await f.service.createVehicle(f.a, { operationId: randomUUID(), details: { name: "Transfer vehicle" } });
    const invite = await f.service.createInvitation(f.a, "vehicle", vehicle.vehicleId, { operationId: randomUUID(), expectedMembershipRevision: 1, email: f.b.email!, capabilities: ["readVehicle"] });
    await f.service.acceptInvitation(f.b, "vehicle", { operationId: randomUUID(), invitationId: invite.invitationId });
    await f.service.membership(f.a, vehicle.vehicleId, { operationId: randomUUID(), expectedMembershipRevision: 2, accountId: f.b.accountId, action: "transfer_ownership" });
    const pendingInvite = await f.service.createInvitation(f.b, "vehicle", vehicle.vehicleId, { operationId: randomUUID(), expectedMembershipRevision: 3, email: f.a.email!, capabilities: ["readVehicle"] });
    let entered!: () => void, release!: () => void;
    const seen = new Promise<void>(resolve => { entered = resolve; }), hold = new Promise<void>(resolve => { release = resolve; });
    const provider = { sendNotification: async () => { entered(); await hold; return { enabled: true, status: "online", notificationId: "synthetic" }; } } as unknown as MessagingProvider;
    const outbox = new MobilityInvitationOutbox(f.store, provider, () => now);
    await outbox.drain(); // The already accepted first invitation is cancelled before emission.
    const flight = outbox.drain();
    await seen;
    const adapter = new MobilityAccountErasureAdapter({ service: f.service, issuer, outbox, providerEffects: f.effects });
    const deletion = adapter.erase(f.aa, ctx());
    // Allow the permanent fence transaction and waiting quiescence to run.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.eraseEffects).not.toHaveBeenCalled();
    release(); await flight;
    expect(await deletion).toMatchObject({ status: "completed" });
    expect(f.eraseEffects.mock.calls[0]![1].notificationIdempotencyKeys).toContain(`cop-mobility-invitation-v1:${pendingInvite.invitationId}:${f.a.accountId}`);
    expect(await f.store.transact([], tx => tx.scan("mobility-notification-handoff:"))).toHaveLength(0);
    expect(JSON.stringify(f.eraseEffects.mock.calls[0]![1])).not.toContain("@example.test");
  });
});
