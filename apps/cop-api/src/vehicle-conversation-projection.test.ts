import { describe, expect, it } from "vitest";
import { queueVehicleConversationProjection } from "./vehicle-conversation-projection.js";
import type { VehicleState } from "./mobility-service.js";
const a = "00000000-0000-4000-8000-000000000001", b = "00000000-0000-4000-8000-000000000002";
function member(accountId: string): VehicleState["vehicle"]["members"][number] { return { accountId, displayName: "Synthetic", role: "driver", capabilities: ["readVehicle"], joinedAt: "2026-11-04T10:00:00Z" }; }
function vehicle(): VehicleState {
  return { vehicle: { contractVersion: "cop-shared-vehicles-v1", vehicleId: a, details: { name: "Synthetic vehicle" }, dataRevision: 1, membershipRevision: 1, deleted: false,
    createdAt: "2026-11-04T10:00:00Z", updatedAt: "2026-11-04T10:00:00Z", members: [member(a), member(b)] }, records: {}, events: [], sequence: 0 };
}
function completed(state: VehicleState) {
  const current = state.conversationProjection!;
  current.status = "ready";
  current.binding = { conversationId: `conv_vehicle_${a}`, roomId: "!vehicle:synthetic.test", roomGeneration: 1,
    membershipRevision: current.sourceMembershipRevision, recipientEpoch: current.recipientEpoch };
}
describe("durable single vehicle audience intent", () => {
  it("does not enroll ordinary vehicles or duplicate an exact pending intent", () => {
    const state = vehicle(); queueVehicleConversationProjection(state); expect(state.conversationProjection).toBeUndefined();
    queueVehicleConversationProjection(state, true); const saved = structuredClone(state.conversationProjection);
    queueVehicleConversationProjection(state); expect(state.conversationProjection).toEqual(saved);
    expect(JSON.stringify(saved)).not.toContain(a); expect(JSON.stringify(saved)).not.toContain(b);
  });
  it("cannot replace a pending revocation with a newer regrant", () => {
    const state = vehicle(); queueVehicleConversationProjection(state, true); completed(state);
    state.vehicle.members.pop(); state.vehicle.membershipRevision++;
    queueVehicleConversationProjection(state); const pending = structuredClone(state.conversationProjection);
    state.vehicle.members.push(member(b)); state.vehicle.membershipRevision++;
    expect(() => queueVehicleConversationProjection(state)).toThrowError(expect.objectContaining({ status: 409, code: "VEHICLE_COMMUNICATION_CUTOVER_PENDING" }));
    expect(state.conversationProjection).toEqual(pending);
  });
  it("advances audience across leave and rejoin while preserving room and capability-only epoch", () => {
    const state = vehicle(); queueVehicleConversationProjection(state, true); completed(state);
    state.vehicle.membershipRevision++; queueVehicleConversationProjection(state);
    expect(state.conversationProjection?.recipientEpoch).toBe(1); completed(state);
    state.vehicle.members.pop(); state.vehicle.membershipRevision++; queueVehicleConversationProjection(state);
    expect(state.conversationProjection?.recipientEpoch).toBe(2); completed(state);
    state.vehicle.members.push(member(b)); state.vehicle.membershipRevision++; queueVehicleConversationProjection(state);
    expect(state.conversationProjection?.recipientEpoch).toBe(3);
    expect(state.conversationProjection?.binding?.roomId).toBe("!vehicle:synthetic.test");
  });
  it("rejects roster changes without a corresponding source revision", () => {
    const state = vehicle(); queueVehicleConversationProjection(state, true); completed(state);
    state.vehicle.members.pop();
    expect(() => queueVehicleConversationProjection(state)).toThrowError(expect.objectContaining({ status: 503 }));
  });
  it("retains a reference to the last verified binding for closed cleanup, without old member copies", () => {
    const state = vehicle(); queueVehicleConversationProjection(state, true); completed(state);
    state.vehicle.deleted = true; state.vehicle.membershipRevision++; queueVehicleConversationProjection(state);
    expect(state.conversationProjection?.intent.phase).toBe("remove_only");
    expect(state.conversationProjection?.status).toBe("pending");
    expect(JSON.stringify(state.conversationProjection)).not.toContain(b);
  });
});
