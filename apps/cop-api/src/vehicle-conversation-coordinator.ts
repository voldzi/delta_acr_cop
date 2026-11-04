import { randomUUID } from "node:crypto";
import type { AuthenticatedActor } from "./security.js";
import type { MessagingPeerBindings } from "./messaging-peer-bindings.js";
import type { SharedMobilityService } from "./mobility-invitations.js";
import type { MobilityAccount } from "./mobility-types.js";
import { mobilityDigest, requireMobility, type PrincipalAccount, type VehicleState } from "./mobility-service.js";
import type { MobilityTransaction } from "./mobility-store.js";
import { queueVehicleConversationProjection } from "./vehicle-conversation-projection.js";
import { assertVehicleConversationEnforcement, type SharedVehicleConversationReceipt,
  type SharedVehicleConversationRequest, type VehicleConversationEnforcement } from "./vehicle-conversation-contract.js";
import type { VehicleConversationProvider } from "./vehicle-conversation-provider.js";

export type SharedVehicleConversationPending = Omit<SharedVehicleConversationReceipt, "confirmed"> & { confirmed: false; state: "join_required" };
type Enforcement = VehicleConversationEnforcement & { operationId: string; joinedAccountIds: string[] };

/** Commit-first source intent, bounded native work outside the source SQL transaction.
 * No private conversations, GPS, keys or user message content enter this owner.
 */
export class VehicleConversationCoordinator {
  private timer?: NodeJS.Timeout;
  private readonly active = new Map<string, Promise<Enforcement | undefined>>();
  private stopped = false;
  constructor(readonly options: {
    service: SharedMobilityService; provider: VehicleConversationProvider; issuer: string; enabled: boolean; now: () => Date;
    asActor?: <T>(actor: AuthenticatedActor, run: () => Promise<T>) => Promise<T>;
    peerBindings: (actor: AuthenticatedActor, targets: string[]) => Promise<MessagingPeerBindings | undefined>;
  }) {}

  async open(actor: AuthenticatedActor, account: MobilityAccount, vehicleId: string, input: SharedVehicleConversationRequest): Promise<SharedVehicleConversationReceipt | SharedVehicleConversationPending> {
    const { service, provider } = this.options;
    requireMobility(this.options.enabled && actor.authMode === "oidc" && actor.issuer === this.options.issuer,
      503, "VEHICLE_COMMUNICATION_UNAVAILABLE", "Komunikace vozidla není zapnutá.");
    await service.store.transact([`vehicle:${vehicleId}`], async tx => {
      const state = await service.vehicle(tx, vehicleId, account);
      const principal = await tx.get<PrincipalAccount>(`account:${account.accountId}`);
      requireMobility(principal && principal.issuer === actor.issuer && principal.subject === actor.subjectId,
        401, "UNAUTHORIZED", "Ověřený účet neodpovídá relaci.");
      service.revisions(state, input);
    });
    requireMobility(await provider.ready(actor), 503, "VEHICLE_COMMUNICATION_UNAVAILABLE", "Komunikace vozidla není dostupná.");
    // Cache only the client intent, never a ready receipt that could outlive membership.
    await service.operation(account, input.operationId, `vehicle:${vehicleId}:conversation`, input, [`vehicle:${vehicleId}`], async tx => {
      const state = await service.vehicle(tx, vehicleId, account); service.revisions(state, input);
      queueVehicleConversationProjection(state, true);
      await tx.set(`vehicle:${vehicleId}`, state);
      return { vehicleId, expectedMembershipRevision: input.expectedMembershipRevision };
    });
    const proof = await this.drain(vehicleId);
    return service.store.transact([`vehicle:${vehicleId}`], async tx => {
      const state = await service.vehicle(tx, vehicleId, account); service.revisions(state, input);
      const projection = state.conversationProjection;
      requireMobility(projection?.status === "ready" && proof, 503, "VEHICLE_COMMUNICATION_PENDING", "Změna přístupu ke komunikaci ještě není dokončena.");
      assertVehicleConversationEnforcement(proof, { vehicleId, membershipRevision: state.vehicle.membershipRevision,
        recipientEpoch: projection.recipientEpoch, memberAccountIds: state.vehicle.members.map(member => member.accountId) }, projection.binding);
      const value = { contractVersion: "cop-shared-vehicle-communication-v1" as const,
        operationId: input.operationId, accountId: account.accountId, vehicleId,
        membershipRevision: state.vehicle.membershipRevision, recipientEpoch: projection.recipientEpoch,
        conversationId: proof.conversationId, roomId: proof.roomId, roomGeneration: proof.roomGeneration,
        scope: "shared_vehicle" as const, historyPolicy: "from_membership" as const,
        revocation: "server_enforced" as const, serverTimestamp: this.options.now().toISOString() };
      return proof.joinedAccountIds.includes(account.accountId) ? { ...value, confirmed: true } :
        { ...value, confirmed: false, state: "join_required" };
    });
  }

  /** Membership/deletion mutations may return success only after their native cutover. */
  async settle(vehicleId: string): Promise<boolean> {
    const required = await this.options.service.store.transact([`vehicle:${vehicleId}`], async tx =>
      !!(await tx.get<VehicleState>(`vehicle:${vehicleId}`))?.conversationProjection);
    if (!required) return true;
    await this.drain(vehicleId);
    return this.options.service.store.transact([`vehicle:${vehicleId}`], async tx => {
      const state = await tx.get<VehicleState>(`vehicle:${vehicleId}`);
      return !!state?.conversationProjection && state.conversationProjection.status !== "pending" &&
        state.conversationProjection.sourceMembershipRevision === state.vehicle.membershipRevision;
    });
  }

  drain(vehicleId: string): Promise<Enforcement | undefined> {
    const running = this.active.get(vehicleId); if (running) return running;
    if (this.stopped) return Promise.resolve(undefined);
    const task = this.run(vehicleId).catch(() => undefined).finally(() => this.active.delete(vehicleId));
    this.active.set(vehicleId, task); return task;
  }
  start(): void {
    if (this.timer) return;
    this.stopped = false;
    const resume = () => { void this.resume().catch(() => undefined); };
    this.timer = setInterval(resume, 1000); this.timer.unref(); resume();
  }
  async close(): Promise<void> {
    this.stopped = true; if (this.timer) clearInterval(this.timer); this.timer = undefined;
    await Promise.allSettled(this.active.values());
  }
  private async resume(): Promise<void> {
    if (this.stopped || this.active.size >= 4) return;
    const pending = await this.options.service.store.transact([], async tx =>
      (await tx.scan<VehicleState>("vehicle:")).filter(entry => entry.value.conversationProjection?.status === "pending")
        .slice(0, 4).map(entry => entry.value.vehicle.vehicleId));
    await Promise.allSettled(pending.map(id => this.drain(id)));
  }

  private async run(vehicleId: string): Promise<Enforcement | undefined> {
    const { service, provider, now } = this.options;
    const nonce = randomUUID();
    const work = await service.store.transact([`vehicle:${vehicleId}`], async tx => {
      const state = await tx.get<VehicleState>(`vehicle:${vehicleId}`), projection = state?.conversationProjection;
      if (!state || !projection || projection.status === "closed" || (projection.lease && Date.parse(projection.lease.expiresAt) > now().getTime())) return undefined;
      requireMobility(projection.sourceMembershipRevision === state.vehicle.membershipRevision, 503, "VEHICLE_COMMUNICATION_SOURCE_UNPROVEN", "Členství komunikace není potvrzené.");
      const members = state.vehicle.deleted ? [] : await this.members(tx, state);
      const owner = state.vehicle.members.find(member => member.role === "owner");
      const principal = members.find(member => member.accountId === owner?.accountId);
      requireMobility(state.vehicle.deleted || principal, 503, "VEHICLE_COMMUNICATION_SOURCE_UNPROVEN", "Vlastník komunikace není potvrzený.");
      projection.lease = { nonce, expiresAt: new Date(now().getTime() + 60_000).toISOString() };
      await tx.set(`vehicle:${vehicleId}`, state);
      return { projection: structuredClone(projection), closed: state.vehicle.deleted, members,
        actor: principal ? { authMode: "oidc" as const, issuer: principal.issuer, subjectId: principal.subject,
          username: "", displayName: "", roles: [] } : undefined };
    });
    if (!work) return undefined;
    let proof: Enforcement | undefined;
    try {
      if (work.closed) {
        const closed = await provider.close(vehicleId, work.projection.intent);
        if (!closed) return undefined;
        await service.store.transact([`vehicle:${vehicleId}`], async tx => {
          const state = await this.claimed(tx, vehicleId, nonce, work.projection.intent.operationId);
          requireMobility(state.vehicle.deleted && state.conversationProjection?.binding?.roomId === closed.roomId &&
            state.conversationProjection.binding.conversationId === closed.conversationId,
            503, "VEHICLE_COMMUNICATION_UNPROVEN", "Uzavření komunikace není potvrzené.");
          state.conversationProjection!.status = "closed"; delete state.conversationProjection!.lease;
          await tx.set(`vehicle:${vehicleId}`, state);
        });
        return undefined;
      }
      const synchronize = async () => {
        const peers = await this.options.peerBindings(work.actor!, work.members.map(member => member.subject));
        return provider.synchronize(work.actor!, vehicleId, work.projection.intent,
          work.members.map(member => ({ accountId: member.accountId, userId: member.subject })), peers);
      };
      const result = await (this.options.asActor ? this.options.asActor(work.actor!, synchronize) : synchronize());
      if (result.state === "pending") return undefined;
      requireMobility(result.state === "ready", 503, "VEHICLE_COMMUNICATION_UNPROVEN", "Přístup ke komunikaci není potvrzený.");
      proof = result.proof;
      await service.store.transact([`vehicle:${vehicleId}`], async tx => {
        const state = await this.claimed(tx, vehicleId, nonce, work.projection.intent.operationId);
        await this.members(tx, state); // Recheck fences after every external await.
        assertVehicleConversationEnforcement(proof!, { vehicleId, membershipRevision: state.vehicle.membershipRevision,
          recipientEpoch: state.conversationProjection!.recipientEpoch, memberAccountIds: state.vehicle.members.map(member => member.accountId) }, state.conversationProjection!.binding);
        const current = state.conversationProjection!;
        current.status = "ready"; delete current.lease;
        current.binding = { conversationId: proof!.conversationId, roomId: proof!.roomId, roomGeneration: proof!.roomGeneration,
          membershipRevision: proof!.membershipRevision, recipientEpoch: proof!.recipientEpoch };
        await tx.set(`vehicle:${vehicleId}`, state);
      });
      return proof;
    } finally {
      await service.store.transact([`vehicle:${vehicleId}`], async tx => {
        const state = await tx.get<VehicleState>(`vehicle:${vehicleId}`), current = state?.conversationProjection;
        if (!state || current?.lease?.nonce !== nonce) return;
        current.status = "pending"; delete current.lease;
        await tx.set(`vehicle:${vehicleId}`, state);
      }).catch(() => undefined);
    }
  }
  private async claimed(tx: MobilityTransaction, vehicleId: string, nonce: string, operationId: string): Promise<VehicleState> {
    const state = await tx.get<VehicleState>(`vehicle:${vehicleId}`), projection = state?.conversationProjection;
    requireMobility(state && projection?.lease?.nonce === nonce && projection.intent.operationId === operationId &&
      projection.sourceMembershipRevision === state.vehicle.membershipRevision, 503, "VEHICLE_COMMUNICATION_SOURCE_UNPROVEN", "Čekající operace komunikace se změnila.");
    return state;
  }
  private async members(tx: MobilityTransaction, state: VehicleState): Promise<PrincipalAccount[]> {
    const values: PrincipalAccount[] = [];
    for (const member of state.vehicle.members) {
      await this.options.service.assertAccountAllowed(tx, member.accountId);
      const principal = await tx.get<PrincipalAccount>(`account:${member.accountId}`);
      requireMobility(principal?.accountId === member.accountId && principal.issuer === this.options.issuer,
        503, "VEHICLE_COMMUNICATION_SOURCE_UNPROVEN", "Identita člena není potvrzená.");
      const identity = await tx.get<PrincipalAccount>(`identity:${mobilityDigest({ issuer: principal.issuer, subject: principal.subject })}`);
      requireMobility(identity?.accountId === principal.accountId && identity.subject === principal.subject && identity.issuer === principal.issuer,
        503, "VEHICLE_COMMUNICATION_SOURCE_UNPROVEN", "Identita člena není potvrzená.");
      values.push(principal);
    }
    return values;
  }
}
