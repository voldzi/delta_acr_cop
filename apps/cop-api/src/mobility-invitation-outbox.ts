import { randomUUID } from "node:crypto";
import type { MessagingProvider, MessagingNotificationIntakeRequest } from "./messaging-provider.js";
import { normalizeEmail, type Invite, type GroupState, type VehicleState } from "./mobility-service.js";
import type { MobilityStore, MobilityTransaction } from "./mobility-store.js";
import type { MobilityAccount } from "./mobility-types.js";

type Principal = MobilityAccount & { issuer: string; subject: string };
export type InvitationNotificationJob = {
  invitationId: string; recipientAccountId: string; expiresAt: string;
  state: "pending" | "processing" | "accepted" | "cancelled";
  attempts: number; nextAttemptAt: string; claim?: string;
};
/** Called inside the same transaction as invite/operation receipt. No email directory API. */
export async function enqueueInvitationNotifications(tx: MobilityTransaction, invite: Invite, now: Date): Promise<void> {
  const recipients = (await tx.scan<Principal>("account:")).filter(x => x.value.emailVerified && x.value.email &&
    normalizeEmail(x.value.email) === invite.email && x.value.accountId !== invite.inviterAccountId && x.value.subject && x.value.issuer).slice(0,20);
  for (const { value } of recipients) await tx.set(`invite-notification:${invite.invitationId}:${value.accountId}`, {
    invitationId: invite.invitationId, recipientAccountId: value.accountId, expiresAt: invite.expiresAt,
    state: "pending", attempts: 0, nextAttemptAt: now.toISOString()
  } satisfies InvitationNotificationJob);
}
export async function invitationNotificationTarget(tx: MobilityTransaction, job: InvitationNotificationJob, now: Date): Promise<{subject: string; payload: MessagingNotificationIntakeRequest} | undefined> {
  const invite = await tx.get<Invite>(`invite:${job.invitationId}`);
  const recipient = await tx.get<Principal>(`account:${job.recipientAccountId}`);
  if (!invite || invite.state !== "pending" || Date.parse(invite.expiresAt) <= now.getTime() ||
    !recipient?.emailVerified || !recipient.email || normalizeEmail(recipient.email) !== invite.email || !recipient.subject || !recipient.issuer) return;
  if (invite.entityType === "vehicle") {
    const state = await tx.get<VehicleState>(`vehicle:${invite.entityId}`);
    const manager = state?.vehicle.members.find(m => m.accountId === invite.inviterAccountId);
    if (!state || state.vehicle.deleted || !manager?.capabilities.includes("manageMembers") || !invite.capabilities.every(c=>manager.capabilities.includes(c))) return;
  } else {
    const state = await tx.get<GroupState>(`group:${invite.entityId}`);
    if (!state || state.deletedAt || !state.group.members.some(m=>m.accountId===invite.inviterAccountId && ["owner","admin"].includes(m.role))) return;
  }
  return { subject: recipient.subject, payload: {
    type: "system.account", severity: "info", priority: "normal",
    audience: { userIds: [recipient.subject] },
    title: { cs: "Pozvánka v aplikaci", en: "Invitation in the app" },
    body: { cs: "Otevřete aplikaci a zkontrolujte pozvánku.", en: "Open the app to review your invitation." },
    expiresAt: invite.expiresAt,
    deepLink: `csm://mobility/invitations/v1/${recipient.accountId}/${invite.entityType}/${invite.invitationId}`,
    source: { featureId: invite.invitationId, layerId: "mobility-invitations", providerId: "cop.mobility" },
    metadata: { contractVersion: "cop-mobility-invitation-notification-v1" }
  } };
}
/** Serialized durable claim, network outside SQL, downstream idempotency. APNs acceptance is best effort. */
export class MobilityInvitationOutbox {
  private flight?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private stopped = false;
  constructor(private readonly store: MobilityStore, private readonly provider: MessagingProvider,
    private readonly now: () => Date = () => new Date()) {}
  start(): void { this.timer=setInterval(()=>{void this.drain();},1000);this.timer.unref(); }
  async close(): Promise<void> {this.stopped=true;if(this.timer)clearInterval(this.timer);await this.flight;}
  async drain(): Promise<void> {
    if(this.stopped)return;if(this.flight)return this.flight;
    const work=this.deliverOne().catch(()=>undefined);this.flight=work;
    try{await work;}finally{if(this.flight===work)this.flight=undefined;}
  }
  private async deliverOne(): Promise<void> {
    const now=this.now();const claimed=await this.store.transact(["invitation-notification-outbox"],async tx=>{
      const next=(await tx.scan<InvitationNotificationJob>("invite-notification:")).find(x=>
        ["pending","processing"].includes(x.value.state) && Date.parse(x.value.nextAttemptAt)<=now.getTime());
      if(!next)return;
      const target=await invitationNotificationTarget(tx,next.value,now);
      if(!target){next.value.state="cancelled";await tx.set(next.key,next.value);return;}
      const claim=randomUUID();next.value.claim=claim;next.value.attempts++;next.value.state="processing";
      next.value.nextAttemptAt=new Date(now.getTime()+60000).toISOString();await tx.set(next.key,next.value);
      return {key:next.key,job:next.value,target};
    });
    if(!claimed || this.stopped)return;
    let accepted=false;
    try {
      const r=await this.provider.sendNotification(undefined,now,
        `cop-mobility-invitation-v1:${claimed.job.invitationId}:${claimed.job.recipientAccountId}`,claimed.target.payload);
      accepted=r.enabled && r.status==="online" && !!r.notificationId;
    }catch{ /* Never retain provider errors, tokens or personal payloads in logs. */ }
    await this.store.transact(["invitation-notification-outbox"],async tx=>{
      const current=await tx.get<InvitationNotificationJob>(claimed.key);if(!current || current.claim!==claimed.job.claim)return;
      current.state=accepted?"accepted":"pending";delete current.claim;
      current.nextAttemptAt=new Date(this.now().getTime()+Math.min(300000,1000*2**Math.min(current.attempts,9))).toISOString();
      await tx.set(claimed.key,current);
    });
  }
}
