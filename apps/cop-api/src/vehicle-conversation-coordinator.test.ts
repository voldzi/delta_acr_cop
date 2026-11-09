import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mobilityAccountFenceKey } from "./mobility-erasure-guard.js";
import { VehicleConversationCoordinator } from "./vehicle-conversation-coordinator.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import { SharedMobilityService } from "./mobility-invitations.js";
import { SharedVehicleErasureService } from "./shared-vehicle-erasure.js";
import type { VehicleState } from "./mobility-service.js";
import type { AuthenticatedActor } from "./security.js";
import type { ClosedVehicleConversationProof, ManagedVehiclePlan, ManagedVehicleResult, VehicleConversationProvider } from "./vehicle-conversation-provider.js";
const issuer = "https://synthetic.example/realms/cop";
const actor = (subjectId: string): AuthenticatedActor => ({ authMode: "oidc", issuer, subjectId, username: "synthetic", displayName: "Synthetic", email: `${subjectId}@example.test`, emailVerified: true, roles: [] });
class Provider implements VehicleConversationProvider {
  pending = false; joined = true; unavailable = false; closePending = false; closeWrongBinding = false;
  calls: Array<{ vehicleId: string; plan: ManagedVehiclePlan; members: Array<{ accountId: string; userId: string }> }> = [];
  duringSync?: () => Promise<void>;
  async ready(): Promise<boolean> { return !this.unavailable; }
  async snapshot(): Promise<undefined> { return undefined; }
  async close(vehicleId: string, plan: ManagedVehiclePlan): Promise<ClosedVehicleConversationProof | undefined> {
    if (this.closePending) return undefined;
    return { vehicleId, ...plan, conversationId: this.closeWrongBinding ? "conv_foreign" : `conv_vehicle_${vehicleId}`, roomId: "!vehicle:synthetic.test" };
  }
  async synchronize(_actor: AuthenticatedActor, vehicleId: string, plan: ManagedVehiclePlan, members: Array<{ accountId: string; userId: string }>): Promise<ManagedVehicleResult> {
    this.calls.push(structuredClone({ vehicleId, plan, members })); await this.duringSync?.();
    if (this.unavailable) throw new Error("Synthetic provider outage");
    if (this.pending) return { state: "pending" };
    return { state: "ready", proof: { vehicleId, membershipRevision: plan.membershipRevision,
      recipientEpoch: plan.recipientEpoch, operationId: plan.operationId, roomGeneration: 1,
      conversationId: `conv_vehicle_${vehicleId}`, roomId: "!vehicle:synthetic.test",
      memberAccountIds: members.map(member => member.accountId), joinedAccountIds: this.joined ? members.map(member => member.accountId) : [],
      encrypted: true, historyPolicy: "from_membership", membershipAuthority: "cop_vehicle",
      roomMembershipVerified: true, notificationAudienceVerified: true, clientMembershipChangesDenied: true,
      revocation: "server_enforced", retiredRoomIds: [], retirementVerified: true } };
  }
}
async function fixture() {
  const now = () => new Date("2026-11-04T10:00:00Z"); const store = new MemoryMobilityStore();
  const service = new SharedMobilityService(store, now), provider = new Provider();
  const aActor = actor(randomUUID()), bActor = actor(randomUUID()), cActor = actor(randomUUID());
  const a = await service.account(aActor), b = await service.account(bActor), c = await service.account(cActor);
  const vehicle = await service.createVehicle(a, { operationId: randomUUID(), details: { name: "Synthetic" } });
  const invite = await service.createInvitation(a, "vehicle", vehicle.vehicleId, { operationId: randomUUID(), expectedMembershipRevision: 1, email: b.email!, capabilities: ["readVehicle"] });
  await service.acceptInvitation(b, "vehicle", { operationId: randomUUID(), invitationId: invite.invitationId });
  const coordinator = new VehicleConversationCoordinator({ service, provider, issuer, enabled: true, now, peerBindings: async () => undefined });
  const request = { operationId: randomUUID(), expectedMembershipRevision: 2 };
  return { now, store, service, provider, coordinator, aActor, bActor, cActor, a, b, c, id: vehicle.vehicleId, request,
    state: () => store.transact([], tx => tx.get<VehicleState>(`vehicle:${vehicle.vehicleId}`)) };
}
async function automaticFixture() {
  const now = () => new Date("2026-11-09T10:00:00Z"), store = new MemoryMobilityStore();
  const service = new SharedMobilityService(store, now, undefined, true), provider = new Provider();
  provider.joined = false;
  const aActor = actor(randomUUID()), bActor = actor(randomUUID());
  const a = await service.account(aActor), b = await service.account(bActor);
  const input = { operationId: randomUUID(), details: { name: "Synthetic automatic" } };
  const vehicle = await service.createVehicle(a, input);
  const coordinator = new VehicleConversationCoordinator({ service, provider, issuer, enabled: true, now, peerBindings: async () => undefined });
  const state = () => store.transact([], tx => tx.get<VehicleState>(`vehicle:${vehicle.vehicleId}`));
  return { now, store, service, provider, aActor, bActor, a, b, input, vehicle, coordinator, state };
}

describe("source/native vehicle conversation coordinator", () => {
  it("commits pending before native work and never holds source SQL transaction during the network call", async () => {
    const f = await fixture();
    f.provider.duringSync = async () => { expect((await f.state())?.conversationProjection?.status).toBe("pending"); };
    const receipt = await f.coordinator.open(f.aActor, f.a, f.id, f.request);
    expect(receipt.confirmed).toBe(true); expect(receipt.accountId).toBe(f.a.accountId);
    expect(f.provider.calls[0]?.members.map(member => member.userId)).toEqual([f.aActor.subjectId, f.bActor.subjectId]);
    expect((await f.state())?.conversationProjection?.lease).toBeUndefined();
  });
  it("cannot use a cached receipt after removal or select a foreign vehicle", async () => {
    const f = await fixture(); await f.coordinator.open(f.bActor, f.b, f.id, f.request);
    await f.service.membership(f.a, f.id, { operationId: randomUUID(), expectedMembershipRevision: 2, accountId: f.b.accountId, action: "remove" });
    await expect(f.coordinator.open(f.bActor, f.b, f.id, f.request)).rejects.toMatchObject({ status: 404 });
    await expect(f.coordinator.open(f.cActor, f.c, f.id, f.request)).rejects.toMatchObject({ status: 404 });
    await expect(f.coordinator.open(f.aActor, f.a, randomUUID(), f.request)).rejects.toMatchObject({ status: 404 });
  });
  it("pending and outage keep the exact intent durable, without a fallback or later regrant", async () => {
    const f = await fixture(); f.provider.pending = true;
    await expect(f.coordinator.open(f.aActor, f.a, f.id, f.request)).rejects.toMatchObject({ status: 503, code: "VEHICLE_COMMUNICATION_PENDING" });
    const saved = structuredClone((await f.state())?.conversationProjection?.intent);
    await expect(f.service.membership(f.a, f.id, { operationId: randomUUID(), expectedMembershipRevision: 2, accountId: f.b.accountId, action: "remove" })).rejects.toMatchObject({ status: 409 });
    expect((await f.state())?.vehicle.membershipRevision).toBe(2);
    f.provider.pending = false; f.provider.unavailable = true;
    await f.coordinator.drain(f.id);
    expect((await f.state())?.conversationProjection?.intent).toEqual(saved);
    f.provider.unavailable = false;
    expect((await f.coordinator.open(f.aActor, f.a, f.id, f.request)).confirmed).toBe(true);
    expect(f.provider.calls.every(call => JSON.stringify(call.plan) === JSON.stringify(saved))).toBe(true);
  });
  it("returns typed invitation preparation until actual joined proof changes", async () => {
    const f = await fixture(); f.provider.joined = false;
    const pending = await f.coordinator.open(f.aActor, f.a, f.id, f.request);
    expect(pending).toMatchObject({ confirmed: false, state: "join_required", recipientEpoch: 1 });
    f.provider.joined = true;
    expect((await f.coordinator.open(f.aActor, f.a, f.id, f.request)).confirmed).toBe(true);
  });
  it("keeps removal unconfirmed until native enforcement and then advances its epoch", async () => {
    const f = await fixture(); await f.coordinator.open(f.aActor, f.a, f.id, f.request);
    await f.service.membership(f.a, f.id, { operationId: randomUUID(), expectedMembershipRevision: 2, accountId: f.b.accountId, action: "remove" });
    f.provider.pending = true; expect(await f.coordinator.settle(f.id)).toBe(false);
    f.provider.pending = false; expect(await f.coordinator.settle(f.id)).toBe(true);
    const receipt = await f.coordinator.open(f.aActor, f.a, f.id, { operationId: randomUUID(), expectedMembershipRevision: 3 });
    expect(receipt.recipientEpoch).toBe(2); expect(receipt.roomId).toBe("!vehicle:synthetic.test");
  });
  it("cannot start account erasure across a pending cutover, including a just-removed member", async () => {
    const f = await fixture(); await f.coordinator.open(f.aActor, f.a, f.id, f.request);
    await f.service.membership(f.a, f.id, { operationId: randomUUID(), expectedMembershipRevision: 2, accountId: f.b.accountId, action: "remove" });
    const erasure = new SharedVehicleErasureService(f.store, issuer);
    expect((await erasure.preflight(f.bActor, new AbortController().signal)).ready).toBe(false);
    await f.coordinator.settle(f.id);
    expect((await erasure.preflight(f.bActor, new AbortController().signal)).ready).toBe(true);
    const result = await erasure.erase(f.bActor, { operationId: randomUUID(), requestedAt: f.now().toISOString(), signal: new AbortController().signal });
    expect(result.status).toBe("completed");
    expect((await f.state())?.conversationProjection?.status).toBe("pending");
    expect(await f.coordinator.settle(f.id)).toBe(true);
    expect(JSON.stringify((await f.state())?.conversationProjection)).not.toContain(f.b.accountId);
  });
  it("closes an enrolled deleted vehicle without impersonating a removed human", async () => {
    const f = await fixture(); await f.coordinator.open(f.aActor, f.a, f.id, f.request);
    const vehicle = await f.service.getVehicle(f.a, f.id);
    await f.service.deleteVehicle(f.a, f.id, { operationId: randomUUID(), expectedMembershipRevision: 2, expectedDataRevision: vehicle.dataRevision, reason: "Synthetic vehicle closure" });
    f.provider.closePending = true; expect(await f.coordinator.settle(f.id)).toBe(false);
    f.provider.closePending = false; f.provider.closeWrongBinding = true;
    expect(await f.coordinator.settle(f.id)).toBe(false);
    expect((await f.state())?.conversationProjection?.status).toBe("pending");
    f.provider.closeWrongBinding = false; expect(await f.coordinator.settle(f.id)).toBe(true);
    expect((await f.state())?.conversationProjection?.status).toBe("closed");
  });
  it("resumes the persisted operation in a new owner after an expired lease, rejecting late completion", async () => {
    const f = await fixture(); f.provider.pending = true;
    await expect(f.coordinator.open(f.aActor, f.a, f.id, f.request)).rejects.toMatchObject({ status: 503 });
    const intent = structuredClone((await f.state())!.conversationProjection!.intent);
    f.provider.pending = false;
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const waiting = new Promise<void>(resolve => { release = resolve; });
    f.provider.duringSync = async () => { entered(); await waiting; };
    const old = f.coordinator.drain(f.id); await started;
    f.provider.duringSync = undefined;
    const replacement = new VehicleConversationCoordinator({ ...f.coordinator.options,
      now: () => new Date(f.now().getTime() + 70_000) });
    const proof = await replacement.drain(f.id);
    expect(proof?.operationId).toBe(intent.operationId);
    release(); expect(await old).toBeUndefined();
    expect((await f.state())!.conversationProjection).toMatchObject({ status: "ready", intent });
    expect((await f.state())!.conversationProjection!.lease).toBeUndefined();
    expect(f.provider.calls.every(call => call.plan.operationId === intent.operationId)).toBe(true);
    await replacement.close();
  });

  it("atomically queues one automatic create intent without joining or duplicating the vehicle", async () => {
    const f = await automaticFixture(), before = (await f.state())!.conversationProjection!;
    expect(before.status).toBe("pending"); expect(f.provider.calls).toHaveLength(0);
    expect((await f.service.createVehicle(f.a, f.input)).vehicleId).toBe(f.vehicle.vehicleId);
    expect((await f.state())!.conversationProjection).toEqual(before);
    await Promise.all([f.coordinator.drain(f.vehicle.vehicleId), f.coordinator.drain(f.vehicle.vehicleId)]);
    expect(f.provider.calls).toHaveLength(1);
    expect((await f.state())!.conversationProjection!.binding?.conversationId).toBe(`conv_vehicle_${f.vehicle.vehicleId}`);
    expect(await f.coordinator.open(f.aActor, f.a, f.vehicle.vehicleId,
      { operationId: randomUUID(), expectedMembershipRevision: 1 })).toMatchObject({ confirmed: false, state: "join_required" });
    expect((await f.service.listVehicles(f.a)).items).toHaveLength(1);
  });
  it("queues accepted membership at a new epoch in the same logical room and retains outage intent", async () => {
    const f = await automaticFixture(); await f.coordinator.drain(f.vehicle.vehicleId);
    const invitation = await f.service.createInvitation(f.a, "vehicle", f.vehicle.vehicleId,
      { operationId: randomUUID(), expectedMembershipRevision: 1, email: f.b.email!, capabilities: ["readVehicle"] });
    const input = { operationId: randomUUID(), invitationId: invitation.invitationId };
    await f.service.acceptInvitation(f.b, "vehicle", input);
    const pending = (await f.state())!.conversationProjection!;
    expect(pending).toMatchObject({ status: "pending", sourceMembershipRevision: 2, recipientEpoch: 2 });
    f.provider.unavailable = true; await f.coordinator.drain(f.vehicle.vehicleId);
    expect((await f.state())!.conversationProjection!.intent).toEqual(pending.intent);
    await f.service.acceptInvitation(f.b, "vehicle", input);
    expect((await f.state())!.conversationProjection!.intent).toEqual(pending.intent);
    f.provider.unavailable = false; await f.coordinator.drain(f.vehicle.vehicleId);
    expect((await f.state())!.conversationProjection!.binding?.roomId).toBe(pending.binding?.roomId);
    expect(f.provider.calls.at(-1)!.members).toHaveLength(2);
  });
  it("backfills at most four eligible existing cars and preserves exact prior intents", async () => {
    const f = await fixture();
    for (let i = 0; i < 5; i++) await f.service.createVehicle(f.a, { operationId: randomUUID(), details: { name: "Synthetic legacy" } });
    expect(await f.coordinator.prepareExisting()).toBe(4);
    const before = await f.state();
    expect(await f.coordinator.prepareExisting()).toBe(2);
    expect((await f.state())!.conversationProjection).toEqual(before!.conversationProjection);
    expect(await f.coordinator.prepareExisting()).toBe(0);
    expect(f.provider.calls).toHaveLength(0);
  });
  it("does not backfill deleted, foreign-issuer or unproven existing sources", async () => {
    const f = await fixture();
    const deleted = await f.service.createVehicle(f.a, { operationId: randomUUID(), details: { name: "Synthetic deleted" } });
    await f.service.deleteVehicle(f.a, deleted.vehicleId, { operationId: randomUUID(), expectedDataRevision: 1, expectedMembershipRevision: 1, reason: "Synthetic deletion" });
    await f.store.transact([], async tx => {
      const principal = await tx.get<Record<string, unknown>>(`account:${f.b.accountId}`);
      await tx.set(`account:${f.b.accountId}`, { ...principal, issuer: "https://foreign.synthetic.test" });
    });
    expect(await f.coordinator.prepareExisting()).toBe(0);
    expect((await f.state())!.conversationProjection).toBeUndefined();
    expect(f.provider.calls).toHaveLength(0);
  });
  it("disabled admission does not enroll new cars but preserves already committed cutover work", async () => {
    const f = await automaticFixture();
    const disabled = new VehicleConversationCoordinator({ ...f.coordinator.options, enabled: false });
    const legacy = await fixture();
    const legacyDisabled = new VehicleConversationCoordinator({ ...legacy.coordinator.options, enabled: false });
    expect(await legacyDisabled.prepareExisting()).toBe(0);
    expect((await legacy.state())!.conversationProjection).toBeUndefined();
    expect(legacy.provider.calls).toHaveLength(0);
    expect(await disabled.prepareExisting()).toBe(0);
    await disabled.drain(f.vehicle.vehicleId);
    expect(f.provider.calls).toHaveLength(1);
    expect((await f.state())!.conversationProjection!.status).toBe("ready");
    await disabled.close();
  });

  it("does not backfill an account under erasure and never replaces an enrolled binding", async () => {
    const f = await fixture();
    await f.store.transact([], tx => tx.set(mobilityAccountFenceKey(f.b.accountId), { operationId: randomUUID() }));
    expect(await f.coordinator.prepareExisting()).toBe(0);
    expect((await f.state())!.conversationProjection).toBeUndefined();
    const g = await automaticFixture(); await g.coordinator.drain(g.vehicle.vehicleId);
    const before = await g.state();
    expect(await g.coordinator.prepareExisting()).toBe(0);
    expect(await g.state()).toEqual(before);
  });
  it("concurrent backfill and a replacement worker retain the original single intent", async () => {
    const f = await fixture();
    expect((await Promise.all([f.coordinator.prepareExisting(), f.coordinator.prepareExisting()])).sort()).toEqual([0, 1]);
    const intent = structuredClone((await f.state())!.conversationProjection!.intent);
    const replacement = new VehicleConversationCoordinator(f.coordinator.options);
    f.provider.unavailable = true; await replacement.drain(f.id);
    expect((await f.state())!.conversationProjection!.intent).toEqual(intent);
    f.provider.unavailable = false; await replacement.drain(f.id);
    expect((await f.state())!.conversationProjection!.intent).toEqual(intent);
    expect((await f.state())!.conversationProjection!.status).toBe("ready");
  });

});
