import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
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
  pending = false; joined = true; unavailable = false; closePending = false;
  calls: Array<{ vehicleId: string; plan: ManagedVehiclePlan; members: Array<{ accountId: string; userId: string }> }> = [];
  duringSync?: () => Promise<void>;
  async ready(): Promise<boolean> { return !this.unavailable; }
  async snapshot(): Promise<undefined> { return undefined; }
  async close(vehicleId: string, plan: ManagedVehiclePlan): Promise<ClosedVehicleConversationProof | undefined> {
    if (this.closePending) return undefined;
    return { vehicleId, ...plan, conversationId: `conv_vehicle_${vehicleId}`, roomId: "!vehicle:synthetic.test" };
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
    f.provider.closePending = false; expect(await f.coordinator.settle(f.id)).toBe(true);
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

});
