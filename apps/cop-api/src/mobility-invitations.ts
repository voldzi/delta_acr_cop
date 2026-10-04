import { randomUUID } from "node:crypto";
import { DispatchService } from "./dispatch-service.js";
import { requireMobility, normalizeEmail, type Invite, type VehicleState, type GroupState } from "./mobility-service.js";
import type * as Wire from "./mobility-types.js";

export class SharedMobilityService extends DispatchService {
  async createInvitation(account: Wire.MobilityAccount, type: "vehicle" | "group", id: string,
    input: Wire.MobilityInvitationCreate | Wire.DispatchInvitationCreate): Promise<Wire.MobilityInvitationReceipt> {
    return this.operation(account, input.operationId, `${type}:${id}:invite`, input, ["dispatch-directory", `${type}:${id}`], async tx => {
      let revision: number; let capabilities: Wire.SharedVehicleMember["capabilities"] = [];
      if (type === "vehicle") {
        const state = await this.vehicle(tx, id, account, "manageMembers"); revision = state.vehicle.membershipRevision;
        capabilities = "capabilities" in input ? input.capabilities ?? ["readVehicle"] : ["readVehicle"];
        const self = state.vehicle.members.find(m => m.accountId === account.accountId)!;
        requireMobility(capabilities.includes("readVehicle") && (self.role === "owner" || capabilities.every(c => self.capabilities.includes(c))), 403, "CAPABILITY_ESCALATION", "Nelze udělit vyšší oprávnění.");
      } else revision = (await this.group(tx, id, account, true)).group.membershipRevision;
      requireMobility(revision === input.expectedMembershipRevision, 409, "REVISION_CONFLICT", "Členství se změnilo.");
      const pending = (await tx.scan<Invite>("invite:")).filter(x => x.value.entityId === id && x.value.state === "pending" && Date.parse(x.value.expiresAt) > this.now().getTime());
      requireMobility(pending.length < 100, 429, "INVITATION_LIMIT", "Byl dosažen limit pozvánek.");
      const invitationId = randomUUID(); const expiresAt = new Date(this.now().getTime() + 7 * 86400000).toISOString();
      const invite: Invite = { invitationId, entityType: type, entityId: id, inviterAccountId: account.accountId,
        email: normalizeEmail(input.email), capabilities: [...new Set(capabilities)], expiresAt, state: "pending" };
      await tx.set(`invite:${invitationId}`, invite);
      // Same shape/status for registered and unknown addresses; no directory lookup.
      return { contractVersion: "cop-mobility-invitation-v1", invitationId, operationId: input.operationId, status: "queued", expiresAt };
    });
  }
  async pendingInvitations(account: Wire.MobilityAccount): Promise<Wire.MobilityPendingInvitations> {
    requireMobility(account.emailVerified && account.email, 403, "EMAIL_VERIFICATION_REQUIRED", "Nejprve ověřte e-mail účtu COP.");
    return this.store.transact(["dispatch-directory"], async tx => {
      const items: Wire.MobilityPendingInvitation[] = [];
      for (const entry of await tx.scan<Invite>("invite:")) {
        const invite = entry.value;
        if (invite.state !== "pending" || invite.email !== normalizeEmail(account.email!) || Date.parse(invite.expiresAt) <= this.now().getTime()) continue;
        let name: string | undefined;
        if (invite.entityType === "vehicle") { const state = await tx.get<VehicleState>(`vehicle:${invite.entityId}`); if (state && !state.vehicle.deleted && state.vehicle.members.some(m => m.accountId === invite.inviterAccountId && m.capabilities.includes("manageMembers"))) name = state.vehicle.details.name; }
        else { const state = await tx.get<GroupState>(`group:${invite.entityId}`); if (state && !state.deletedAt && state.group.members.some(m => m.accountId === invite.inviterAccountId && ["owner", "admin"].includes(m.role))) name = state.group.name; }
        if (!name) continue;
        const inviter = await tx.get<Wire.MobilityAccount>(`account:${invite.inviterAccountId}`);
        items.push({ invitationId: invite.invitationId, entityType: invite.entityType, entityId: invite.entityId, entityName: name, inviterName: inviter?.displayName ?? "Člen COP", expiresAt: invite.expiresAt, capabilities: invite.capabilities });
        if (items.length >= 100) break;
      }
      return { contractVersion: "cop-mobility-invitation-v1", items, serverTimestamp: this.now().toISOString() };
    });
  }
  async acceptInvitation(account: Wire.MobilityAccount, type: "vehicle" | "group", input: Wire.MobilityInvitationAccept): Promise<Wire.SharedVehicle | Wire.DispatchGroup> {
    requireMobility(account.emailVerified && account.email, 403, "EMAIL_VERIFICATION_REQUIRED", "Nejprve ověřte e-mail účtu COP.");
    const known = await this.store.transact([], tx => tx.get<Invite>(`invite:${input.invitationId}`));
    requireMobility(known && known.entityType === type && known.email === normalizeEmail(account.email), 404, "NOT_FOUND", "Pozvánka není dostupná.");
    return this.operation(account, input.operationId, `${type}:accept`, input, ["dispatch-directory", `invite:${input.invitationId}`, `${type}:${known.entityId}`], async tx => {
      const invite = await tx.get<Invite>(`invite:${input.invitationId}`);
      requireMobility(invite && invite.email === normalizeEmail(account.email!), 404, "NOT_FOUND", "Pozvánka není dostupná.");
      requireMobility(Date.parse(invite.expiresAt) > this.now().getTime() && invite.state !== "revoked", 410, "INVITATION_EXPIRED", "Pozvánka již neplatí.");
      requireMobility(invite.state !== "accepted" || invite.acceptedBy === account.accountId, 410, "INVITATION_USED", "Pozvánka již byla použita.");
      let result: Wire.SharedVehicle | Wire.DispatchGroup;
      if (type === "vehicle") {
        const state = await tx.get<VehicleState>(`vehicle:${invite.entityId}`);
        const manager = state?.vehicle.members.find(m => m.accountId === invite.inviterAccountId);
        requireMobility(state && !state.vehicle.deleted && manager?.capabilities.includes("manageMembers") && invite.capabilities.every(c => manager.capabilities.includes(c)), 410, "INVITATION_REVOKED", "Oprávnění pozvánky již neplatí.");
        if (!state.vehicle.members.some(m => m.accountId === account.accountId)) {
          requireMobility(state.vehicle.members.length < 5, 409, "VEHICLE_MEMBER_LIMIT", "Vozidlo má již pět členů.");
          const memberships = (await tx.scan<VehicleState>("vehicle:")).filter(x => !x.value.vehicle.deleted && x.value.vehicle.members.some(m => m.accountId === account.accountId));
          requireMobility(memberships.length < 100, 429, "MEMBERSHIP_LIMIT", "Byl dosažen limit členství.");
          state.vehicle.members.push({ accountId: account.accountId, displayName: account.displayName, role: "driver", capabilities: invite.capabilities, joinedAt: this.now().toISOString() });
          state.vehicle.membershipRevision++; await this.vehicleEvent(tx, state, account, "membership");
        }
        result = state.vehicle;
      } else {
        const state = await tx.get<GroupState>(`group:${invite.entityId}`);
        requireMobility(state && !state.deletedAt && state.group.members.some(m => m.accountId === invite.inviterAccountId && ["owner", "admin"].includes(m.role)), 410, "INVITATION_REVOKED", "Oprávnění pozvánky již neplatí.");
        if (!state.group.members.some(m => m.accountId === account.accountId)) {
          requireMobility(state.group.members.length < 200, 409, "GROUP_MEMBER_LIMIT", "Skupina dosáhla limitu členů.");
          const memberships = (await tx.scan<GroupState>("group:")).filter(x => !x.value.deletedAt && x.value.group.members.some(m => m.accountId === account.accountId));
          requireMobility(memberships.length < 100, 429, "MEMBERSHIP_LIMIT", "Byl dosažen limit členství.");
          state.group.members.push({ accountId: account.accountId, displayName: account.displayName, role: "member" }); state.group.membershipRevision++;
          this.invalidateShares(state); await tx.set(`group:${invite.entityId}`, state);
        }
        result = state.group;
      }
      invite.state = "accepted"; invite.acceptedBy = account.accountId; await tx.set(`invite:${invite.invitationId}`, invite); return result;
    });
  }
  async revokeInvitation(account: Wire.MobilityAccount, type: "vehicle" | "group", id: string, input: Wire.MobilityInvitationRevoke): Promise<Wire.SharedVehicleReceipt | Wire.DispatchGroup> {
    return this.operation(account, input.operationId, `${type}:${id}:invite-revoke`, input, ["dispatch-directory", `${type}:${id}`, `invite:${input.invitationId}`], async tx => {
      const state = type === "vehicle" ? await this.vehicle(tx, id, account, "manageMembers") : await this.group(tx, id, account, true);
      const invite = await tx.get<Invite>(`invite:${input.invitationId}`);
      requireMobility(invite && invite.entityType === type && invite.entityId === id, 404, "NOT_FOUND", "Pozvánka není dostupná.");
      requireMobility(invite.state !== "accepted", 409, "INVITATION_ALREADY_ACCEPTED", "Přijatého člena odeberte změnou členství.");
      invite.state = "revoked"; await tx.set(`invite:${input.invitationId}`, invite);
      return "vehicle" in state ? this.vehicleReceipt(state, input.operationId) : state.group;
    });
  }
}
