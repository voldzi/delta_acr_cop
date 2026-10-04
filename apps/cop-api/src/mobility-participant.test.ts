import {it,expect} from "vitest";
import {randomUUID} from "node:crypto";
import {MemoryMobilityStore} from "./mobility-store.js";
import {SharedMobilityService} from "./mobility-invitations.js";
import {openDispatchParticipant} from "./mobility-participant.js";
import type {MessagingProvider,MessagingConversationCreateRequest} from "./messaging-provider.js";
const actor={authMode:"oidc" as const,issuer:"https://synthetic.example",subjectId:"a",displayName:"A",username:"A",email:"a@example.test",emailVerified:true,roles:[]};
it("resolves actual active participant, validates encrypted direct roster and denies removal replay",async()=>{
 const service=new SharedMobilityService(new MemoryMobilityStore());const a=await service.account(actor);const b=await service.account({...actor,subjectId:"b",email:"b@example.test"});const c=await service.account({...actor,subjectId:"c",email:"c@example.test"});const group=await service.createGroup(a,{operationId:randomUUID(),name:"Synthetic"});const invite=await service.createInvitation(a,"group",group.groupId,{operationId:randomUUID(),expectedMembershipRevision:1,email:b.email!});await service.acceptInvitation(b,"group",{operationId:randomUUID(),invitationId:invite.invitationId});
 let received:MessagingConversationCreateRequest|undefined;let wrong=false;
 const provider={config:{enabled:true},createConversation:async(_actor:unknown,_now:unknown,input:MessagingConversationCreateRequest)=>{received=input;return {enabled:true,conversation:{conversationId:"synthetic-direct",conversationKind:"direct",type:"direct",title:"Synthetic",members:wrong?[{userId:"a"},{userId:"c"}]:input.members,encrypted:true,e2eeRequired:true,matrix:{roomId:"!synthetic:example.test"}}}}} as unknown as MessagingProvider;
 const request={operationId:randomUUID()};const result=await openDispatchParticipant(service,provider,a,actor,group.groupId,b.accountId,request);expect(result).toMatchObject({operationId:request.operationId,accountId:b.accountId,confirmed:true});expect(received?.members?.map(m=>m.userId)).toEqual(["a","b"]);expect(JSON.stringify(result)).not.toContain('"userId"');
 await expect(openDispatchParticipant(service,provider,a,actor,group.groupId,c.accountId,{operationId:randomUUID()})).rejects.toMatchObject({status:404});wrong=true;await expect(openDispatchParticipant(service,provider,a,actor,group.groupId,b.accountId,{operationId:randomUUID()})).rejects.toMatchObject({status:503,code:"MESSAGING_SCOPE_INVALID"});
 await service.membershipGroup(a,group.groupId,{operationId:randomUUID(),expectedMembershipRevision:2,accountId:b.accountId,action:"remove"});await expect(openDispatchParticipant(service,provider,a,actor,group.groupId,b.accountId,request)).rejects.toMatchObject({status:404});
});
