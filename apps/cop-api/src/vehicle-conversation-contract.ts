import { requireMobility } from "./mobility-service.js";

/** Public receipt. It never carries Matrix credentials, recipient keys or a caller supplied roster. */
export interface SharedVehicleConversationReceipt {
  contractVersion: "cop-shared-vehicle-communication-v1";
  operationId: string;
  confirmed: true;
  accountId: string;
  vehicleId: string;
  membershipRevision: number;
  conversationId: string;
  roomId: string;
  scope: "shared_vehicle";
  historyPolicy: "from_membership";
  revocation: "server_enforced";
  serverTimestamp: string;
}

export interface SharedVehicleConversationRequest {
  operationId: string;
  expectedMembershipRevision: number;
}

/** Server-only evidence; assertions about the provider are never accepted from the mobile request. */
export interface VehicleConversationEnforcement {
  vehicleId: string;
  membershipRevision: number;
  conversationId: string;
  roomId: string;
  memberAccountIds: string[];
  encrypted: true;
  historyPolicy: "from_membership";
  membershipAuthority: "cop_vehicle";
  roomMembershipVerified: true;
  notificationAudienceVerified: true;
  clientMembershipChangesDenied: true;
  revocation: "server_enforced";
}

/** Deliberately requires the complete current roster, including absence of removed members. */
export function assertVehicleConversationEnforcement(
  proof: VehicleConversationEnforcement,
  current: { vehicleId: string; membershipRevision: number; memberAccountIds: string[] },
  binding?: { conversationId: string; roomId: string }
): void {
  const actual = new Set(proof.memberAccountIds);
  const expected = new Set(current.memberAccountIds);
  requireMobility(
    proof.vehicleId === current.vehicleId && proof.membershipRevision === current.membershipRevision &&
      Number.isSafeInteger(proof.membershipRevision) && proof.membershipRevision > 0 &&
      expected.size > 0 && expected.size === current.memberAccountIds.length &&
      actual.size === proof.memberAccountIds.length && actual.size === expected.size &&
      [...expected].every(id => actual.has(id)) &&
      typeof proof.conversationId === "string" && proof.conversationId.length > 0 &&
      typeof proof.roomId === "string" && /^![^\s:]+:[^\s]+$/u.test(proof.roomId) &&
      (!binding || (binding.conversationId === proof.conversationId && binding.roomId === proof.roomId)) &&
      proof.encrypted === true && proof.historyPolicy === "from_membership" &&
      proof.membershipAuthority === "cop_vehicle" && proof.roomMembershipVerified === true &&
      proof.notificationAudienceVerified === true && proof.clientMembershipChangesDenied === true &&
      proof.revocation === "server_enforced",
    503, "VEHICLE_COMMUNICATION_UNPROVEN", "Přístup ke komunikaci vozidla zatím není potvrzen."
  );
}
