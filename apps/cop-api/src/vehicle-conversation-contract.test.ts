import { describe, expect, it } from "vitest";
import { assertVehicleConversationEnforcement, type VehicleConversationEnforcement } from "./vehicle-conversation-contract.js";
import { acceptsMobilitySchema } from "./mobility-contract.js";

const current = { vehicleId: "vehicle-a", membershipRevision: 3, memberAccountIds: ["account-a", "account-b"] };
const valid = (): VehicleConversationEnforcement => ({
  ...current, memberAccountIds: [...current.memberAccountIds], conversationId: "conv_vehicle_a",
  roomGeneration: 1, retiredRoomIds: [], retirementVerified: true,
  roomId: "!vehicle-a:synthetic.example", encrypted: true, historyPolicy: "from_membership",
  membershipAuthority: "cop_vehicle", roomMembershipVerified: true,
  notificationAudienceVerified: true, clientMembershipChangesDenied: true, revocation: "server_enforced"
});
describe("vehicle conversation enforcement boundary", () => {
  it("accepts only operation and revision from a client, never identity or membership choices", () => {
    const request = { operationId: "00000000-0000-4000-8000-000000000001", expectedMembershipRevision: 3 };
    expect(acceptsMobilitySchema("SharedVehicleConversationRequest", request)).toBe(true);
    for (const extra of ["accountId", "members", "conversationId", "roomId", "scope", "revocation", "historyPolicy"]) {
      expect(acceptsMobilitySchema("SharedVehicleConversationRequest", { ...request, [extra]: "client-choice" })).toBe(false);
    }
    for (const revision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(acceptsMobilitySchema("SharedVehicleConversationRequest", { ...request, expectedMembershipRevision: revision })).toBe(false);
    }
  });
  it("accepts an exact confirmed roster independently of provider member ordering", () => {
    const proof = valid(); proof.memberAccountIds.reverse();
    expect(() => assertVehicleConversationEnforcement(proof, current)).not.toThrow();
  });
  it.each([
    { membershipRevision: 2 }, { vehicleId: "other-vehicle" },
    { memberAccountIds: ["account-a"] }, { memberAccountIds: ["account-a", "account-b", "removed"] },
    { memberAccountIds: ["account-a", "account-b", "account-b"] },
    { notificationAudienceVerified: false }, { roomMembershipVerified: false },
    { clientMembershipChangesDenied: false }, { membershipAuthority: "client" },
    { historyPolicy: "shared" }, { revocation: "best_effort" }, { encrypted: false },
    { roomId: "" }, { conversationId: "" }, { roomGeneration: 0 }, { retirementVerified: false }
  ])("rejects stale, incomplete or unverified evidence %j", change => {
    expect(() => assertVehicleConversationEnforcement({ ...valid(), ...change } as VehicleConversationEnforcement, current))
      .toThrowError(expect.objectContaining({ status: 503, code: "VEHICLE_COMMUNICATION_UNPROVEN" }));
  });
  it("does not silently replace an existing server owned conversation or room", () => {
    expect(() => assertVehicleConversationEnforcement(valid(), current, { conversationId: "other", roomId: valid().roomId, roomGeneration: 1, membershipRevision: 3 })).toThrow();
    expect(() => assertVehicleConversationEnforcement(valid(), current, { conversationId: valid().conversationId, roomId: "!other:synthetic.example", roomGeneration: 1, membershipRevision: 3 })).toThrow();
  });
  it("allows a new room only across a newer roster revision and a verified retired binding", () => {
    const previous = { conversationId: valid().conversationId, roomId: "!old:synthetic.example", roomGeneration: 1, membershipRevision: 2 };
    const proof = { ...valid(), roomGeneration: 2, retiredRoomIds: [previous.roomId] };
    expect(() => assertVehicleConversationEnforcement(proof, current, previous)).not.toThrow();
    expect(() => assertVehicleConversationEnforcement({ ...proof, retiredRoomIds: [] }, current, previous)).toThrow();
    expect(() => assertVehicleConversationEnforcement(proof, current, { ...previous, membershipRevision: 3 })).toThrow();
    expect(() => assertVehicleConversationEnforcement(proof, current, { ...previous, roomGeneration: 2 })).toThrow();
  });
  it("rejects a late response after removal, including one with the new revision but old roster", () => {
    const afterRemoval = { ...current, membershipRevision: 4, memberAccountIds: ["account-a"] };
    expect(() => assertVehicleConversationEnforcement(valid(), afterRemoval)).toThrow();
    expect(() => assertVehicleConversationEnforcement({ ...valid(), membershipRevision: 4 }, afterRemoval)).toThrow();
    expect(() => assertVehicleConversationEnforcement({ ...valid(), ...afterRemoval }, afterRemoval)).not.toThrow();
  });
});
