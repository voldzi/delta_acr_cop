import type { AccountErasureAdapter, AccountErasureAssessment, AccountErasureProof } from "./account-erasure.js";
import { mobilityAccountFenceKey, mobilityIdentityDigest, mobilityIdentityFenceKey } from "./mobility-erasure-guard.js";
import type { SharedMobilityService } from "./mobility-invitations.js";
import type { InvitationNotificationHandoff, InvitationNotificationJob, MobilityInvitationOutbox } from "./mobility-invitation-outbox.js";
import { mobilityDigest, normalizeEmail, type GroupState, type Invite, type MobilityOperationReceipt, type PrincipalAccount } from "./mobility-service.js";
import type { MobilityTransaction } from "./mobility-store.js";
import type { AuthenticatedActor } from "./security.js";
import type { DispatchDevice } from "./mobility-types.js";
import { SharedVehicleErasureService } from "./shared-vehicle-erasure.js";

/** Exact source-side effects. Provider identities, emails, tokens and message text are absent. */
export interface MobilityProviderManifest {
  version: 1;
  invitationIds: string[];
  notificationIdempotencyKeys: string[];
  conversationIds: string[];
  roomIds: string[];
}
export interface MobilityProviderEffects {
  ready(): Promise<boolean>;
  preflight(actor: AuthenticatedActor, signal: AbortSignal): Promise<AccountErasureAssessment>;
  /** A completed proof must fence these source IDs against late delivery and verify removal
   * of their notification/conversation metadata. HTTP202, timeout or a sender fence alone is insufficient. */
  erase(actor: AuthenticatedActor, manifest: MobilityProviderManifest,
    context: { operationId: string; requestedAt: string; signal: AbortSignal }): Promise<AccountErasureProof>;
}
interface Checkpoint {
  version: 1; operationId: string; requestedAt: string; accountId?: string;
  localErased: true; manifest: MobilityProviderManifest; providerProofId?: string;
}
const checkpointKey = (identity: string) => `mobility-erasure:account-checkpoint:${identity}`;
const pending = (): AccountErasureProof => ({ status: "pending", remaining: "cleanup_pending" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Real local owner, with actual Dispatch/outbox instances. External effects need an independent
 * verifiable provider cleanup. A subset vehicle proof is never promoted to a whole-domain proof. */
export class MobilityAccountErasureAdapter implements AccountErasureAdapter {
  readonly id = "mobility_dispatch" as const;
  private readonly vehicles: SharedVehicleErasureService;
  constructor(readonly options: { service: SharedMobilityService; issuer: string;
    outbox?: MobilityInvitationOutbox; providerEffects?: MobilityProviderEffects }) {
    this.vehicles = new SharedVehicleErasureService(options.service.store, options.issuer, async (tx, principal, operationId) => {
      const identity = mobilityIdentityDigest(principal.issuer, principal.subject), key = `mobility-erasure:provider-manifest:${identity}`;
      await assertProvenance(tx, principal, identity);
      const previous = await tx.get<{ operationId: string; manifest: MobilityProviderManifest }>(key);
      if (previous && previous.operationId !== operationId) throw new Error("Manifest operation conflict");
      const journal = previous ?? { operationId, manifest: await this.manifest(tx, principal) };
      if (!previous) await tx.set(key, journal);
      if (mobilityDigest(await tx.get(key)) !== mobilityDigest(journal)) throw new Error("Manifest readback incomplete");
    });
  }
  private identity(actor: AuthenticatedActor): string {
    if (actor.authMode !== "oidc" || actor.issuer !== this.options.issuer || !actor.subjectId) throw new Error("Verified Mobility owner required");
    return mobilityIdentityDigest(actor.issuer, actor.subjectId);
  }
  async ready(): Promise<boolean> {
    try {
      await this.options.service.store.transact([], async () => true);
      return !!this.options.providerEffects && await this.options.providerEffects.ready();
    } catch { return false; }
  }
  /** No provider waits or nested transaction: safe for the orchestrator's final impact CAS. */
  async preflightWithin(actor: AuthenticatedActor, context: { transaction: MobilityTransaction; signal: AbortSignal }): Promise<AccountErasureAssessment> {
    const identity = this.identity(actor);
    try {
      const tx = context.transaction;
      const vehicles = await this.vehicles.preflightWithin(actor, tx, context.signal);
      if (!vehicles.ready) return vehicles;
      context.signal.throwIfAborted();
      const principal = await tx.get<PrincipalAccount>(`identity:${identity}`);
      if (principal && (principal.issuer !== actor.issuer || principal.subject !== actor.subjectId)) throw new Error("Owner mismatch");
      if (principal) {
        await assertProvenance(tx, principal, identity);
        const aliases = (await tx.scan<PrincipalAccount>("identity:")).filter(entry => entry.value.accountId === principal.accountId);
        if (aliases.length !== 1 || aliases[0]!.key !== `identity:${identity}`) throw new Error("Ambiguous identity provenance");
      }
      const groups = await tx.scan<GroupState>("group:");
      if (principal && groups.some(({ value }) => value.group.members.some(member => member.accountId === principal.accountId && member.role === "owner") &&
        (!value.deletedAt || value.group.members.some(member => member.accountId !== principal.accountId) ||
          Object.values(value.shares).some(share => share.accountId !== principal.accountId)))) return { ready: false, reason: "ownership_unresolved" };
      const manifest = principal ? await this.manifest(tx, principal) : emptyManifest();
      context.signal.throwIfAborted();
      return { ready: true, version: mobilityDigest({ vehicles: vehicles.version, principal, groups, manifest }) };
    } catch { return { ready: false, reason: "adapter_unavailable" }; }
  }
  async preflight(actor: AuthenticatedActor, context: { signal: AbortSignal }): Promise<AccountErasureAssessment & { transactionVersion?: string }> {
    try {
      const local = await this.options.service.store.transact([], transaction => this.preflightWithin(actor, { transaction, signal: context.signal }));
      if (!local.ready) return local;
      if (!this.options.providerEffects) return { ready: false, reason: "adapter_unavailable" };
      const external = await this.options.providerEffects.preflight(actor, context.signal);
      if (!external.ready) return external;
      return { ready: true, version: mobilityDigest({ local: local.version, provider: external.version }), transactionVersion: local.version };
    } catch { return { ready: false, reason: "adapter_unavailable" }; }
  }
  async erase(actor: AuthenticatedActor, context: { operationId: string; requestedAt: string; accountKey: string; signal: AbortSignal }): Promise<AccountErasureProof> {
    const identity = this.identity(actor), { service, outbox, providerEffects } = this.options;
    if (!UUID.test(context.operationId) || !Number.isFinite(Date.parse(context.requestedAt))) throw new Error("Invalid Mobility erasure operation");
    const operationId = context.operationId.toLowerCase();
    try {
      // Resolve before the subset fence. Mapping is deleted only by the transaction below.
      const before = await service.store.transact([], async tx => ({
        principal: await tx.get<PrincipalAccount>(`identity:${identity}`),
        checkpoint: await tx.get<Checkpoint>(checkpointKey(identity))
      }));
      if (before.checkpoint && (before.checkpoint.version !== 1 || before.checkpoint.operationId !== operationId)) throw new Error("Checkpoint conflict");
      if (!before.checkpoint) {
        const subset = await this.vehicles.erase(actor, context);
        if (subset.status !== "completed") return pending();
      }
      // Wait for the actual local worker after fencing. Durable unconfirmed handoffs survive
      // process replacement and must still be removed/fenced by providerEffects below.
      await outbox?.quiesce(context.signal);
      const saved = await service.store.transact([mobilityIdentityFenceKey(identity), "dispatch-directory"], async tx => {
        context.signal.throwIfAborted();
        const fence = await tx.get<{ operationId: string }>(mobilityIdentityFenceKey(identity));
        if (fence?.operationId !== operationId) throw new Error("Identity fence missing");
        const checkpoint = await tx.get<Checkpoint>(checkpointKey(identity));
        if (checkpoint) {
          if (checkpoint.version !== 1 || checkpoint.operationId !== operationId) throw new Error("Checkpoint conflict");
          await this.readback(tx, identity, checkpoint.accountId, checkpoint.manifest);
          return checkpoint;
        }
        const principal = await tx.get<PrincipalAccount>(`identity:${identity}`);
        if (principal && (!before.principal || mobilityDigest(principal) !== mobilityDigest(before.principal))) throw new Error("Owner changed");
        const journal = await tx.get<{ operationId: string; manifest: MobilityProviderManifest }>(`mobility-erasure:provider-manifest:${identity}`);
        if (journal && journal.operationId !== operationId) throw new Error("Manifest operation conflict");
        const manifest = mergeManifest(journal?.manifest ?? emptyManifest(), principal ? await this.manifest(tx, principal) : emptyManifest());
        if (principal) await this.purge(tx, principal, manifest, context.signal);
        await tx.remove(`identity:${identity}`);
        const value: Checkpoint = { version: 1, operationId, requestedAt: context.requestedAt,
          ...(principal ? { accountId: principal.accountId } : {}), localErased: true, manifest };
        await tx.set(checkpointKey(identity), value);
        await tx.remove(`mobility-erasure:provider-manifest:${identity}`);
        await this.readback(tx, identity, value.accountId, manifest);
        return value;
      });
      if (!providerEffects) return pending();
      const external = await providerEffects.erase(actor, saved.manifest, { ...context, operationId });
      if (external.status !== "completed" || !external.proofId) return pending();
      context.signal.throwIfAborted();
      await service.store.transact([checkpointKey(identity)], async tx => {
        const current = await tx.get<Checkpoint>(checkpointKey(identity));
        if (!current || current.operationId !== operationId || mobilityDigest(current.manifest) !== mobilityDigest(saved.manifest)) throw new Error("Checkpoint changed");
        await this.readback(tx, identity, current.accountId, current.manifest);
        current.providerProofId = external.proofId;
        await tx.set(checkpointKey(identity), current);
        if ((await tx.get<Checkpoint>(checkpointKey(identity)))?.providerProofId !== external.proofId) throw new Error("Provider proof readback incomplete");
      });
      return { status: "completed", proofId: mobilityDigest({ scope: "cop-mobility-dispatch-erasure-v1", identity, operationId, provider: external.proofId }) };
    } catch { return pending(); }
  }
  private async manifest(tx: MobilityTransaction, principal: PrincipalAccount): Promise<MobilityProviderManifest> {
    const emails = new Set((await tx.scan<{ version: number; accountId: string }>(`account-email:${principal.accountId}:`)).map(entry => {
      if (entry.value.version !== 1 || entry.value.accountId !== principal.accountId) throw new Error("Unsupported email provenance");
      const digest = entry.key.slice(`account-email:${principal.accountId}:`.length);
      if (!/^[0-9a-f]{64}$/u.test(digest)) throw new Error("Unsupported email provenance");
      return digest;
    }));
    if (principal.emailVerified && principal.email) emails.add(mobilityDigest(normalizeEmail(principal.email)));
    const accounts = await tx.scan<PrincipalAccount>("account:");
    const invites = (await tx.scan<Invite>("invite:")).filter(({ value }) => {
      if (value.inviterAccountId === principal.accountId || value.acceptedBy === principal.accountId) return true;
      if (value.recipientAccountIds?.length) {
        if (!value.recipientAccountIds.includes(principal.accountId)) return false;
        if (value.recipientAccountIds.some(id => id !== principal.accountId)) throw new Error("Shared invitation identity unresolved");
        return true;
      }
      const emailDigest = mobilityDigest(normalizeEmail(value.email));
      if (!emails.has(emailDigest)) return false;
      if (accounts.some(entry => entry.value.accountId !== principal.accountId && entry.value.emailVerified && entry.value.email &&
        mobilityDigest(normalizeEmail(entry.value.email)) === emailDigest)) throw new Error("Historical email ownership unresolved");
      return true;
    });
    const invitationIds = new Set(invites.map(entry => entry.value.invitationId));
    const notificationKeys = new Set<string>();
    for (const { value } of await tx.scan<InvitationNotificationJob>("invite-notification:")) if (value.recipientAccountId === principal.accountId || invitationIds.has(value.invitationId)) {
      invitationIds.add(value.invitationId);
      notificationKeys.add(`cop-mobility-invitation-v1:${value.invitationId}:${value.recipientAccountId}`);
    }
    for (const { value } of await tx.scan<InvitationNotificationHandoff>("mobility-notification-handoff:")) {
      if (value.version !== 1 || !UUID.test(value.invitationId) || !UUID.test(value.inviterAccountId) || !UUID.test(value.recipientAccountId) ||
        !["unconfirmed", "settled"].includes(value.state) ||
        value.idempotencyKey !== `cop-mobility-invitation-v1:${value.invitationId}:${value.recipientAccountId}`) throw new Error("Unsupported handoff provenance");
      if (value.inviterAccountId === principal.accountId || value.recipientAccountId === principal.accountId || invitationIds.has(value.invitationId)) {
        invitationIds.add(value.invitationId); notificationKeys.add(value.idempotencyKey);
      }
    }
    const conversations = new Set<string>(), rooms = new Set<string>();
    for (const entry of await tx.scan<MobilityOperationReceipt>("operation:")) {
      if (!entry.key.startsWith(`operation:${principal.accountId}:`) && !links(entry.value.result, new Set([principal.accountId]))) continue;
      collectNamedStrings(entry.value.result, "conversationId", conversations);
      collectNamedStrings(entry.value.result, "roomId", rooms);
    }
    return { version: 1, invitationIds: [...invitationIds].sort(), notificationIdempotencyKeys: [...notificationKeys].sort(),
      conversationIds: [...conversations].sort(), roomIds: [...rooms].sort() };
  }
  private async purge(tx: MobilityTransaction, principal: PrincipalAccount, manifest: MobilityProviderManifest, signal: AbortSignal): Promise<void> {
    const accountId = principal.accountId, affected = new Set<string>([accountId, ...manifest.invitationIds]);
    if (!(await tx.get(mobilityAccountFenceKey(accountId)))) throw new Error("Account fence missing");
    const deviceIds = (await tx.scan<DispatchDevice>(`device:${accountId}:`)).map(entry => {
      if (entry.value.accountId !== accountId || !UUID.test(entry.value.deviceId)) throw new Error("Unsupported device provenance");
      return entry.value.deviceId;
    });
    const forgotten = new Set<string>();
    for (const entry of await tx.scan<GroupState>("group:")) {
      signal.throwIfAborted();
      const state = entry.value;
      const ownMember = state.group.members.find(member => member.accountId === accountId);
      const ownShares = Object.values(state.shares).filter(share => share.accountId === accountId);
      if (!ownMember && !ownShares.length) continue;
      if (ownMember?.role === "owner" && (!state.deletedAt || state.group.members.some(member => member.accountId !== accountId) ||
        Object.values(state.shares).some(share => share.accountId !== accountId))) throw new Error("Group ownership unresolved");
      affected.add(state.group.groupId);
      for (const share of Object.values(state.shares)) forgotten.add(share.shareId);
      if (ownMember) { this.options.service.invalidateShares(state); state.group.membershipRevision++; }
      state.group.members = state.group.members.filter(member => member.accountId !== accountId);
      for (const share of ownShares) { delete state.shares[share.shareId]; affected.add(share.shareId); await tx.remove(`share:${share.shareId}`); }
      if (ownMember?.role === "owner" && state.deletedAt && state.group.members.length === 0 && Object.keys(state.shares).length === 0) await tx.remove(entry.key);
      else { state.group.sequence++; await tx.set(entry.key, state); }
    }
    this.options.service.forgetErasedDispatchShares([...forgotten], deviceIds);
    for (const prefix of [`device:${accountId}:`, `cancel-start:${accountId}:`, `account-email:${accountId}:`])
      for (const entry of await tx.scan(prefix)) { signal.throwIfAborted(); await tx.remove(entry.key); }
    for (const entry of await tx.scan<Invite>("invite:")) if (manifest.invitationIds.includes(entry.value.invitationId)) await tx.remove(entry.key);
    for (const entry of await tx.scan<InvitationNotificationJob>("invite-notification:")) if (entry.value.recipientAccountId === accountId || manifest.invitationIds.includes(entry.value.invitationId)) await tx.remove(entry.key);
    // Exact handoffs are retained in the durable checkpoint until downstream proof. The
    // outbox jobs are removed, so only the cleanup owner may use the manifest.
    for (const entry of await tx.scan<InvitationNotificationHandoff>("mobility-notification-handoff:"))
      if (entry.value.inviterAccountId === accountId || entry.value.recipientAccountId === accountId || manifest.invitationIds.includes(entry.value.invitationId)) await tx.remove(entry.key);
    for (const entry of await tx.scan<MobilityOperationReceipt>("operation:")) {
      if (entry.key.startsWith(`operation:${accountId}:`)) await tx.remove(entry.key);
      else if (links(entry.value.result, affected)) await tx.set(entry.key, { hash: entry.value.hash, createdAt: entry.value.createdAt, expired: true } satisfies MobilityOperationReceipt);
    }
    await tx.remove(`account:${accountId}`);
    await tx.remove(`account-provenance:${accountId}`);
  }
  private async readback(tx: MobilityTransaction, identity: string, accountId: string | undefined, manifest: MobilityProviderManifest): Promise<void> {
    if (await tx.get(`identity:${identity}`) || !(await tx.get(mobilityIdentityFenceKey(identity)))) throw new Error("Identity erasure readback incomplete");
    if (!accountId) return;
    if (await tx.get(`account:${accountId}`) || await tx.get(`account-provenance:${accountId}`) || !(await tx.get(mobilityAccountFenceKey(accountId)))) throw new Error("Account erasure readback incomplete");
    if ((await tx.scan<PrincipalAccount>("identity:")).some(entry => entry.value.accountId === accountId)) throw new Error("Identity alias remains");
    for (const prefix of [`device:${accountId}:`, `cancel-start:${accountId}:`, `account-email:${accountId}:`, `operation:${accountId}:`]) if ((await tx.scan(prefix)).length) throw new Error("Owner rows remain");
    for (const prefix of ["group:", "vehicle:", "invite:", "invite-notification:", "mobility-notification-handoff:", "operation:"])
      for (const { value } of await tx.scan(prefix)) if (links(value, new Set([accountId, ...manifest.invitationIds]))) throw new Error("Personal association remains");
  }
}
function emptyManifest(): MobilityProviderManifest { return { version: 1, invitationIds: [], notificationIdempotencyKeys: [], conversationIds: [], roomIds: [] }; }
async function assertProvenance(tx: MobilityTransaction, principal: PrincipalAccount, identity: string): Promise<void> {
  const provenance = await tx.get<{ version: number; identity: string; verifiedEmailHistoryComplete: boolean }>(`account-provenance:${principal.accountId}`);
  if (provenance?.version !== 1 || provenance.identity !== identity || provenance.verifiedEmailHistoryComplete !== true) throw new Error("Historical email provenance unresolved");
}
function mergeManifest(a: MobilityProviderManifest, b: MobilityProviderManifest): MobilityProviderManifest {
  return { version: 1, invitationIds: [...new Set([...a.invitationIds, ...b.invitationIds])].sort(),
    notificationIdempotencyKeys: [...new Set([...a.notificationIdempotencyKeys, ...b.notificationIdempotencyKeys])].sort(),
    conversationIds: [...new Set([...a.conversationIds, ...b.conversationIds])].sort(), roomIds: [...new Set([...a.roomIds, ...b.roomIds])].sort() };
}
function links(value: unknown, ids: Set<string>, depth = 0): boolean {
  if (depth > 30) throw new Error("Unsupported stored depth");
  if (typeof value === "string") return ids.has(value);
  if (Array.isArray(value)) return value.some(child => links(child, ids, depth + 1));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => ids.has(key) || links(child, ids, depth + 1));
}
function collectNamedStrings(value: unknown, key: string, found: Set<string>, depth = 0): void {
  if (depth > 30) throw new Error("Unsupported stored depth");
  if (Array.isArray(value)) { for (const item of value) collectNamedStrings(item, key, found, depth + 1); return; }
  if (!value || typeof value !== "object") return;
  for (const [name, child] of Object.entries(value)) {
    if (name === key && typeof child === "string") found.add(child);
    collectNamedStrings(child, key, found, depth + 1);
  }
}
