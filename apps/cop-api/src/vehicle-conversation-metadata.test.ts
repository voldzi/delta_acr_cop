import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { currentVehicleConversationMetadata } from "./vehicle-conversation-metadata.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import { SharedMobilityService } from "./mobility-invitations.js";
import { queueVehicleConversationProjection } from "./vehicle-conversation-projection.js";
import { mobilityAccountFenceKey } from "./mobility-erasure-guard.js";
import type { VehicleState } from "./mobility-service.js";
import type { AuthenticatedActor } from "./security.js";
import type { MessagingConversationSummary } from "./messaging-provider.js";
const issuer = "https://synthetic.test/realms/cop";
const actor = (): AuthenticatedActor => ({ authMode: "oidc", issuer, subjectId: randomUUID(), roles: [], username: "synthetic", displayName: "Synthetic", email: `${randomUUID()}@example.test`, emailVerified: true });
const ordinary: MessagingConversationSummary = { conversationId: "conv_synthetic_direct", conversationKind: "direct", type: "direct", title: "Personal" };
async function fixture() {
  const store = new MemoryMobilityStore(), service = new SharedMobilityService(store), aActor = actor(), bActor = actor();
  const a = await service.account(aActor), b = await service.account(bActor);
  const vehicle = await service.createVehicle(a, { operationId: randomUUID(), details: { name: "Synthetic shared car" } });
  const invite = await service.createInvitation(a, "vehicle", vehicle.vehicleId, { operationId: randomUUID(), expectedMembershipRevision: 1, email: b.email!, capabilities: ["readVehicle"] });
  await service.acceptInvitation(b, "vehicle", { operationId: randomUUID(), invitationId: invite.invitationId });
  await store.transact([], async tx => {
    const state = (await tx.get<VehicleState>(`vehicle:${vehicle.vehicleId}`))!;
    queueVehicleConversationProjection(state, true); await tx.set(`vehicle:${vehicle.vehicleId}`, state);
  });
  const row: MessagingConversationSummary = { conversationId: `conv_vehicle_${vehicle.vehicleId}`, canonicalKey: `managed.vehicle/${vehicle.vehicleId}`,
    conversationKind: "group", type: "group", title: "Komunikace vozidla", metadata: { source: "cop.shared_vehicle", externalId: vehicle.vehicleId },
    status: "membership_pending", matrix: { state: "pending" } };
  return { store, service, a, b, aActor, bActor, vehicle, row };
}
describe("current authorized vehicle conversation discovery", () => {
  it("uses the current shared name for accepted members before join, without claiming joined", async () => {
    const f = await fixture();
    for (const owner of [f.aActor, f.bActor]) {
      const result = await currentVehicleConversationMetadata(f.service, owner, [ordinary, f.row]);
      expect(result.unavailable).toBe(false);
      expect(result.conversations).toEqual([ordinary, { ...f.row, title: f.vehicle.details.name }]);
      expect(result.conversations[1]).not.toHaveProperty("joined");
      expect(result.conversations[1]!.matrix?.state).toBe("pending");
    }
    expect(f.row.title).toBe("Komunikace vozidla");
  });
  it("does not expose an unaccepted or foreign-issuer account and preserves personal rows", async () => {
    const f = await fixture(), outside = actor(); await f.service.account(outside);
    expect((await currentVehicleConversationMetadata(f.service, outside, [ordinary, f.row])).conversations).toEqual([ordinary]);
    expect((await currentVehicleConversationMetadata(f.service, { ...f.aActor, issuer: "https://foreign.test" }, [ordinary, f.row])).conversations).toEqual([ordinary]);
  });
  it("does not trust conflicting source IDs, room bindings or stale source revisions", async () => {
    const f = await fixture();
    expect((await currentVehicleConversationMetadata(f.service, f.aActor, [{ ...f.row, canonicalKey: "managed.vehicle/foreign" }])).conversations).toEqual([]);
    await f.store.transact([], async tx => {
      const state = (await tx.get<VehicleState>(`vehicle:${f.vehicle.vehicleId}`))!;
      state.conversationProjection!.sourceMembershipRevision--;
      await tx.set(`vehicle:${f.vehicle.vehicleId}`, state);
    });
    expect((await currentVehicleConversationMetadata(f.service, f.aActor, [f.row])).conversations).toEqual([]);
    await f.store.transact([], async tx => {
      const state = (await tx.get<VehicleState>(`vehicle:${f.vehicle.vehicleId}`))!;
      state.conversationProjection!.sourceMembershipRevision = state.vehicle.membershipRevision;
      state.conversationProjection!.binding = { conversationId: f.row.conversationId, roomId: "!current:synthetic.test", roomGeneration: 1, membershipRevision: 2, recipientEpoch: 1 };
      await tx.set(`vehicle:${f.vehicle.vehicleId}`, state);
    });
    expect((await currentVehicleConversationMetadata(f.service, f.aActor,
      [{ ...f.row, matrix: { roomId: "!stale:synthetic.test" } }])).conversations).toEqual([]);
  });
  it("fails closed on account fences and authority outage without removing ordinary chats", async () => {
    const f = await fixture(); await f.store.transact([], tx => tx.set(mobilityAccountFenceKey(f.a.accountId), { operationId: randomUUID() }));
    expect(await currentVehicleConversationMetadata(f.service, f.aActor, [ordinary, f.row])).toEqual({ conversations: [ordinary], unavailable: true });
    f.store.transact = async () => { throw new Error("synthetic outage"); };
    expect(await currentVehicleConversationMetadata(f.service, f.bActor, [ordinary, f.row])).toEqual({ conversations: [ordinary], unavailable: true });
    expect(await currentVehicleConversationMetadata(undefined, f.bActor, [ordinary])).toEqual({ conversations: [ordinary], unavailable: false });
  });
  it("drops a deleted source and removed member even if provider metadata is stale", async () => {
    const f = await fixture();
    await f.store.transact([], async tx => {
      const state = (await tx.get<VehicleState>(`vehicle:${f.vehicle.vehicleId}`))!;
      state.vehicle.members = state.vehicle.members.filter(m => m.accountId !== f.b.accountId);
      await tx.set(`vehicle:${f.vehicle.vehicleId}`, state);
    });
    expect((await currentVehicleConversationMetadata(f.service, f.bActor, [ordinary, f.row])).conversations).toEqual([ordinary]);
    await f.store.transact([], async tx => {
      const state = (await tx.get<VehicleState>(`vehicle:${f.vehicle.vehicleId}`))!; state.vehicle.deleted = true;
      await tx.set(`vehicle:${f.vehicle.vehicleId}`, state);
    });
    expect((await currentVehicleConversationMetadata(f.service, f.aActor, [f.row])).conversations).toEqual([]);
  });
});
