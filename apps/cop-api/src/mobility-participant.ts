import type { SharedMobilityService } from "./mobility-invitations.js";
import { requireMobility } from "./mobility-service.js";
import type { MessagingProvider } from "./messaging-provider.js";
import type { AuthenticatedActor } from "./security.js";
import type * as Wire from "./mobility-types.js";

/** Resolve only a current authorized private roster. Never expose provider identities or credentials. */
export async function openDispatchParticipant(service: SharedMobilityService, provider: MessagingProvider | undefined, account: Wire.MobilityAccount, actor: AuthenticatedActor, groupId: string, targetId: string, input: Wire.DispatchParticipantOpen): Promise<Wire.DispatchParticipantReceipt> {
  const current = await service.getGroup(account, groupId);
  requireMobility(current.members.some(m => m.accountId === targetId) && targetId !== account.accountId, 404, "NOT_FOUND", "Účastník není dostupný.");
  requireMobility(provider?.config.enabled, 503, "MESSAGING_UNAVAILABLE", "Šifrovaná komunikace není dostupná.");
  return service.operation(account,input.operationId,`group:${groupId}:participant:${targetId}`,input,["dispatch-directory",`group:${groupId}`],async tx=>{
    const group=await service.group(tx,groupId,account);
    const member=group.group.members.find(m=>m.accountId===targetId);
    const target=await tx.get<{issuer:string;subject:string;displayName:string}>(`account:${targetId}`);
    requireMobility(member && target && targetId!==account.accountId && target.issuer===actor.issuer,404,"NOT_FOUND","Účastník není dostupný.");
    const created=await provider.createConversation(actor,service.now(),{conversationKind:"direct",type:"direct",title:target.displayName,members:[{userId:actor.subjectId,displayName:actor.displayName},{userId:target.subject,displayName:target.displayName}]});
    let conversation=created.conversation;
    requireMobility(created.enabled && conversation?.conversationId,503,"MESSAGING_UNAVAILABLE","Šifrovaná komunikace není dostupná.");
    if(!conversation.matrix?.roomId) conversation=(await provider.bindMatrixRoom(actor,service.now(),conversation.conversationId,{})).conversation;
    const ids=conversation?.members?.map(m=>m.userId);
    requireMobility(conversation?.conversationKind==="direct" && conversation.type==="direct" && conversation.encrypted===true && conversation.e2eeRequired===true && conversation.matrix?.roomId && ids?.length===2 && new Set(ids).size===2 && ids.includes(actor.subjectId) && ids.includes(target.subject),503,"MESSAGING_SCOPE_INVALID","Šifrované přímé spojení nebylo potvrzeno.");
    return {operationId:input.operationId,confirmed:true,groupId,accountId:targetId,conversationId:conversation.conversationId,roomId:conversation.matrix.roomId};
  });
}
