import type { AuthenticatedActor } from "./security.js";
import { managedMessagingActorHeaders, type MessagingProviderConfig } from "./messaging-provider.js";
import type { MessagingPeerBindings } from "./messaging-peer-bindings.js";
import { MobilityFailure, requireMobility } from "./mobility-service.js";
import type { VehicleConversationEnforcement } from "./vehicle-conversation-contract.js";

const contractVersion = "csm-managed-vehicle-conversation-v1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export interface ManagedVehicleSnapshot {
  vehicleId: string;
  conversationId: string;
  membershipRevision: number;
  recipientEpoch: number;
  roomGeneration: number;
  operationId: string;
  phase: "remove_only" | "reconcile";
  state: "pending" | "ready" | "revocation_enforced";
  roomId?: string;
}
export interface ManagedVehiclePlan {
  operationId: string;
  expectedMembershipRevision: number;
  membershipRevision: number;
  recipientEpoch: number;
  phase: "remove_only" | "reconcile";
}
export type ManagedVehicleResult = { state: "pending" } | {
  state: "ready" | "revocation_enforced";
  proof: VehicleConversationEnforcement & { operationId: string; joinedAccountIds: string[] };
};
export interface VehicleConversationProvider {
  ready(actor: AuthenticatedActor): Promise<boolean>;
  snapshot(actor: AuthenticatedActor, vehicleId: string): Promise<ManagedVehicleSnapshot | undefined>;
  synchronize(actor: AuthenticatedActor, vehicleId: string, plan: ManagedVehiclePlan,
    members: Array<{ accountId: string; userId: string }>, peers?: MessagingPeerBindings): Promise<ManagedVehicleResult>;
}

/** Separate, bounded, authenticated internal path. No generic group or external-model fallback. */
export class HttpVehicleConversationProvider implements VehicleConversationProvider {
  constructor(readonly config: MessagingProviderConfig, readonly now: () => Date) {}

  async ready(actor: AuthenticatedActor): Promise<boolean> {
    try {
      const { status, body } = await this.request(actor, "/api/v1/managed-vehicle-conversations/capability");
      return status === 200 && record(body) && body.contractVersion === contractVersion && body.enabled === true && body.ready === true;
    } catch { return false; }
  }

  async snapshot(actor: AuthenticatedActor, vehicleId: string): Promise<ManagedVehicleSnapshot | undefined> {
    requireMobility(uuid.test(vehicleId), 503, "VEHICLE_COMMUNICATION_UNPROVEN", "Neplatné ověření komunikace vozidla.");
    const { status, body } = await this.request(actor, `/api/v1/managed-vehicle-conversations/${vehicleId}`);
    if (status === 404) return undefined;
    requireMobility(status === 200 && record(body) && body.contractVersion === contractVersion && body.snapshotOnly === true &&
      body.vehicleId === vehicleId && typeof body.conversationId === "string" && body.conversationId === `conv_vehicle_${vehicleId}` &&
      integer(body.membershipRevision, 1) && integer(body.recipientEpoch, 1) && integer(body.roomGeneration, 0) && typeof body.operationId === "string" && uuid.test(body.operationId) &&
      (body.phase === "remove_only" || body.phase === "reconcile") &&
      (body.state === "pending" || body.state === "ready" || body.state === "revocation_enforced") &&
      (body.roomId === null || body.roomId === undefined || roomId(body.roomId)),
    503, "VEHICLE_COMMUNICATION_UNPROVEN", "Stav komunikace vozidla není potvrzen.");
    return { vehicleId, conversationId: body.conversationId, membershipRevision: body.membershipRevision as number,
      recipientEpoch: body.recipientEpoch as number, roomGeneration: body.roomGeneration as number, operationId: body.operationId, phase: body.phase, state: body.state,
      ...(typeof body.roomId === "string" ? { roomId: body.roomId } : {}) };
  }

  async synchronize(actor: AuthenticatedActor, vehicleId: string, plan: ManagedVehiclePlan,
    members: Array<{ accountId: string; userId: string }>, peers?: MessagingPeerBindings): Promise<ManagedVehicleResult> {
    requireMobility(uuid.test(vehicleId), 503, "VEHICLE_COMMUNICATION_UNPROVEN", "Neplatné ověření komunikace vozidla.");
    const { status, body } = await this.request(actor, `/api/v1/managed-vehicle-conversations/${vehicleId}/membership`, {
      contractVersion: "csm-managed-vehicle-membership-v1", operationId: plan.operationId,
      expectedMembershipRevision: plan.expectedMembershipRevision, membershipRevision: plan.membershipRevision, recipientEpoch: plan.recipientEpoch, phase: plan.phase,
      members: [...members].sort((a, b) => a.accountId.localeCompare(b.accountId, "en")).map(m => ({ accountId: m.accountId, userId: m.userId })),
      ...(peers ? { peerBindings: peers } : {})
    });
    if (status === 202 && record(body) && body.contractVersion === contractVersion && body.state === "pending" && body.confirmed === false) return { state: "pending" };
    requireMobility(status === 200 && record(body) && body.contractVersion === contractVersion &&
      (plan.phase === "reconcile" ? body.state === "ready" : body.state === "revocation_enforced") && body.vehicleId === vehicleId &&
      body.operationId === plan.operationId && body.membershipRevision === plan.membershipRevision &&
      body.recipientEpoch === plan.recipientEpoch && integer(body.recipientEpoch, 1) &&
      integer(body.roomGeneration, 0) && body.conversationId === `conv_vehicle_${vehicleId}` && roomId(body.roomId) &&
      ids(body.memberAccountIds, 5) && ids(body.joinedAccountIds, 5) &&
      Array.isArray(body.retiredRoomIds) && body.retiredRoomIds.length <= 1000 && body.retiredRoomIds.every(roomId) &&
      body.encrypted === true && body.historyPolicy === "from_membership" && body.membershipAuthority === "cop_vehicle" &&
      body.retirementVerified === true && body.roomMembershipVerified === true && body.notificationAudienceVerified === true &&
      body.clientMembershipChangesDenied === true && body.revocation === "server_enforced",
    503, "VEHICLE_COMMUNICATION_PENDING", "Komunikace vozidla čeká na ověření služby.");
    const expected = new Set(members.map(m => m.accountId));
    requireMobility(body.memberAccountIds.length === expected.size && body.memberAccountIds.every(id => expected.has(id)) &&
      body.joinedAccountIds.every(id => expected.has(id)), 503, "VEHICLE_COMMUNICATION_UNPROVEN", "Členství komunikace vozidla nebylo potvrzeno.");
    return { state: plan.phase === "reconcile" ? "ready" : "revocation_enforced", proof: {
      vehicleId, membershipRevision: plan.membershipRevision, recipientEpoch: plan.recipientEpoch, operationId: plan.operationId,
      roomGeneration: body.roomGeneration as number, conversationId: body.conversationId, roomId: body.roomId,
      memberAccountIds: body.memberAccountIds, joinedAccountIds: body.joinedAccountIds,
      retiredRoomIds: body.retiredRoomIds, retirementVerified: true, encrypted: true, historyPolicy: "from_membership",
      membershipAuthority: "cop_vehicle", roomMembershipVerified: true, notificationAudienceVerified: true,
      clientMembershipChangesDenied: true, revocation: "server_enforced"
    } };
  }

  private async request(actor: AuthenticatedActor, path: string, body?: object): Promise<{ status: number; body: unknown }> {
    requireMobility(this.config.enabled && this.config.authorityMode === "database_v2" && this.config.token &&
      actor.authMode === "oidc" && actor.issuer && uuid.test(actor.subjectId),
    503, "VEHICLE_COMMUNICATION_UNAVAILABLE", "Komunikace vozidla není dostupná.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(new URL(`${this.config.baseUrl.replace(/\/+$/u, "")}${path}`), {
        method: body ? "PUT" : "GET", redirect: "error", signal: controller.signal,
        headers: { ...managedMessagingActorHeaders(actor), Accept: "application/json",
          Authorization: `Bearer ${this.config.token}`, "X-COP-Request-At": this.now().toISOString(),
          ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const chunks: Uint8Array[] = []; let size = 0;
      const reader = response.body?.getReader();
      if (reader) for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 256 * 1024) { await reader.cancel(); throw new Error("Managed response exceeds limit"); }
        chunks.push(chunk.value);
      }
      const bytes = Buffer.concat(chunks);
      return { status: response.status, body: bytes.length ? JSON.parse(bytes.toString("utf8")) as unknown : {} };
    } catch {
      throw new MobilityFailure(503, "VEHICLE_COMMUNICATION_UNAVAILABLE", "Služba komunikace vozidla neodpovídá.");
    } finally { clearTimeout(timer); }
  }
}

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function integer(value: unknown, min: number): value is number { return Number.isSafeInteger(value) && (value as number) >= min; }
function roomId(value: unknown): value is string { return typeof value === "string" && value.length <= 255 && /^![^\s:]+:[^\s]+$/u.test(value); }
function ids(value: unknown, max: number): value is string[] { return Array.isArray(value) && value.length <= max && value.every(id => typeof id === "string" && uuid.test(id)) && new Set(value).size === value.length; }
