import { randomUUID } from "node:crypto";
import { mobilityDigest, requireMobility, type VehicleState } from "./mobility-service.js";

/** Internal source state only. No copies of subjects, names, keys or messages. */
export interface VehicleConversationProjection {
  version: 1;
  status: "pending" | "ready" | "closed";
  sourceMembershipRevision: number;
  recipientEpoch: number;
  rosterDigest: string;
  intent: {
    operationId: string;
    expectedMembershipRevision: number;
    membershipRevision: number;
    recipientEpoch: number;
    phase: "reconcile" | "remove_only";
  };
  binding?: { conversationId: string; roomId: string; roomGeneration: number; membershipRevision: number; recipientEpoch: number };
  lease?: { nonce: string; expiresAt: string };
}

/** Called within the source membership transaction; never performs network IO.
 * A single durable intent cannot be replaced by a regrant or changed request.
 * Record/detail writes at the same membership revision remain available.
 */
export function queueVehicleConversationProjection(state: VehicleState, enroll = false): void {
  const old = state.conversationProjection;
  if (!old && !enroll) return;
  const ids = state.vehicle.deleted ? [] : state.vehicle.members.map(member => member.accountId).sort();
  const digest = mobilityDigest({ members: ids, deleted: state.vehicle.deleted });
  if (old?.sourceMembershipRevision === state.vehicle.membershipRevision) {
    requireMobility(old.rosterDigest === digest, 503, "VEHICLE_COMMUNICATION_SOURCE_UNPROVEN", "Členství komunikace vozidla není potvrzené.");
    return;
  }
  requireMobility(old?.status !== "pending" && !old?.lease, 409, "VEHICLE_COMMUNICATION_CUTOVER_PENDING", "Předchozí změna přístupu ke komunikaci ještě není dokončena.");
  requireMobility(!old || state.vehicle.membershipRevision > old.sourceMembershipRevision,
    503, "VEHICLE_COMMUNICATION_SOURCE_UNPROVEN", "Revize komunikace vozidla není potvrzená.");
  const epoch = old ? old.recipientEpoch + (old.rosterDigest === digest ? 0 : 1) : 1;
  requireMobility(Number.isSafeInteger(epoch) && epoch > 0, 503, "VEHICLE_COMMUNICATION_SOURCE_UNPROVEN", "Revize příjemců není potvrzená.");
  state.conversationProjection = {
    version: 1, status: "pending", sourceMembershipRevision: state.vehicle.membershipRevision,
    recipientEpoch: epoch, rosterDigest: digest,
    intent: { operationId: randomUUID(), expectedMembershipRevision: old?.binding?.membershipRevision ?? 0,
      membershipRevision: state.vehicle.membershipRevision, recipientEpoch: epoch,
      phase: state.vehicle.deleted ? "remove_only" : "reconcile" },
    ...(old?.binding ? { binding: old.binding } : {})
  };
}
