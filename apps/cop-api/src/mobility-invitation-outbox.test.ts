import {describe,it,expect,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {MemoryMobilityStore} from "./mobility-store.js";
import {SharedMobilityService} from "./mobility-invitations.js";
import {MobilityInvitationOutbox,type InvitationNotificationJob} from "./mobility-invitation-outbox.js";
import {CsmMessagingProvider,type MessagingProvider} from "./messaging-provider.js";
import type {AuthenticatedActor} from "./security.js";
const actor=(id:string,verified=true):AuthenticatedActor=>({authMode:"oidc",issuer:"https://synthetic.example",subjectId:id,displayName:"Private name "+id,username:id,email:id+"@example.test",emailVerified:verified,roles:[]});
async function setup(type:"vehicle"|"group"="vehicle"){
 let clock=Date.parse("2026-10-05T12:00:00Z");const now=()=>new Date(clock);const store=new MemoryMobilityStore();const service=new SharedMobilityService(store,now);
 const a=await service.account(actor("a"));const b=await service.account(actor("b"));
 const entity=type==="vehicle"?(await service.createVehicle(a,{operationId:randomUUID(),details:{name:"Private vehicle name"}})).vehicleId:(await service.createGroup(a,{operationId:randomUUID(),name:"Private group name"})).groupId;
 const input={operationId:randomUUID(),expectedMembershipRevision:1,email:b.email!,...(type==="vehicle"?{capabilities:["readVehicle" as const]}:{})};
 const send=vi.fn().mockResolvedValue({contractVersion:"cop-messaging-notification-v1",enabled:true,status:"online",notificationId:"synthetic-notification",providerId:"csm.messaging",warnings:[]});
 const provider={sendNotification:send} as unknown as MessagingProvider;
 return {store,service,a,b,entity,input,send,provider,now,type,advance:(ms:number)=>clock+=ms,
  jobs:()=>store.transact([],tx=>tx.scan<InvitationNotificationJob>("invite-notification:"))};
}
describe("durable metadata-only mobility invitation outbox",()=>{
 for(const type of ["vehicle","group"] as const)it(`${type}: atomic receipt, idempotency and neutral recipient-bound APNs metadata`,async()=>{
  const f=await setup(type);const invite=await f.service.createInvitation(f.a,type,f.entity,f.input);
  expect(await f.service.createInvitation(f.a,type,f.entity,f.input)).toEqual(invite);expect(await f.jobs()).toHaveLength(1);
  const worker=new MobilityInvitationOutbox(f.store,f.provider,f.now);await Promise.all([worker.drain(),worker.drain()]);
  expect(f.send).toHaveBeenCalledTimes(1);const [sender,_now,key,payload]=f.send.mock.calls[0]!;expect(sender).toBeUndefined();expect(key).toContain(invite.invitationId);
  expect(payload.audience).toEqual({userIds:["b"]});expect(payload.type).toBe("system.account");
  expect(payload.deepLink).toBe(`csm://mobility/invitations/v1/${f.b.accountId}/${type}/${invite.invitationId}`);
  for(const forbidden of ["@example.test","Private name","Private vehicle","Private group",'"lat"','"lon"','"token"'])expect(JSON.stringify(payload)).not.toContain(forbidden);
  expect((await f.jobs())[0]!.value.state).toBe("accepted");await new MobilityInvitationOutbox(f.store,f.provider,f.now).drain();expect(f.send).toHaveBeenCalledTimes(1);
 });
 it("does not enumerate unknown/unverified addresses or retroactively bind a new account",async()=>{
  const f=await setup();await f.service.account(actor("unverified",false));
  for(const email of ["unverified@example.test","unknown@example.test"]){const receipt=await f.service.createInvitation(f.a,"vehicle",f.entity,{...f.input,operationId:randomUUID(),email});expect(receipt.status).toBe("queued");expect(Object.keys(receipt).sort()).toEqual(["contractVersion","expiresAt","invitationId","operationId","status"]);}
  await f.service.account(actor("unknown"));expect(await f.jobs()).toHaveLength(0);
 });
 it("retries provider outage after process replacement with the same downstream idempotency key",async()=>{
  const f=await setup();await f.service.createInvitation(f.a,"vehicle",f.entity,f.input);f.send.mockRejectedValueOnce(Error("secret provider payload must never persist"));
  await new MobilityInvitationOutbox(f.store,f.provider,f.now).drain();expect((await f.jobs())[0]!.value.state).toBe("pending");expect(JSON.stringify(await f.jobs())).not.toContain("secret");
  f.advance(10000);await new MobilityInvitationOutbox(f.store,f.provider,f.now).drain();expect(f.send).toHaveBeenCalledTimes(2);expect(f.send.mock.calls[0]![2]).toBe(f.send.mock.calls[1]![2]);
 });
 it("only one of concurrent independent workers claims a due job",async()=>{
  const f=await setup();await f.service.createInvitation(f.a,"vehicle",f.entity,f.input);await Promise.all([new MobilityInvitationOutbox(f.store,f.provider,f.now).drain(),new MobilityInvitationOutbox(f.store,f.provider,f.now).drain()]);expect(f.send).toHaveBeenCalledTimes(1);
 });
 for(const reason of ["revoked","expired","emailChanged","unverified","accepted"] as const)it(`rechecks ${reason} before emission`,async()=>{
  const f=await setup();const invite=await f.service.createInvitation(f.a,"vehicle",f.entity,f.input);
  if(reason==="revoked")await f.service.revokeInvitation(f.a,"vehicle",f.entity,{operationId:randomUUID(),invitationId:invite.invitationId});
  if(reason==="expired")f.advance(8*86400000);
  if(reason==="emailChanged")await f.service.account({...actor("b"),email:"other@example.test"});
  if(reason==="unverified")await f.service.account(actor("b",false));
  if(reason==="accepted")await f.service.acceptInvitation(f.b,"vehicle",{operationId:randomUUID(),invitationId:invite.invitationId});
  await new MobilityInvitationOutbox(f.store,f.provider,f.now).drain();expect(f.send).not.toHaveBeenCalled();expect((await f.jobs())[0]!.value.state).toBe("cancelled");
 });
 it("serializes exactly the metadata contract into authenticated server-only Messaging HTTP",async()=>{
  const f=await setup();await f.service.createInvitation(f.a,"vehicle",f.entity,f.input);
  const fetchMock=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
   expect(String(url)).toBe("http://synthetic-messaging.test/api/v1/notifications");expect(init?.method).toBe("POST");
   const headers=new Headers(init?.headers);expect(headers.get("authorization")).toBe("Bearer synthetic-service-token");expect(headers.get("idempotency-key")).toContain("cop-mobility-invitation-v1:");
   const body=JSON.parse(String(init?.body));expect(body.audience).toEqual({userIds:["b"]});expect(body.deepLink).toContain(f.b.accountId);expect(body.type).toBe("system.account");expect(body.body.cs).toBe("Otevřete aplikaci a zkontrolujte pozvánku.");expect(JSON.stringify(body)).not.toContain("@example.test");
   return new Response(JSON.stringify({contractVersion:"csm-notification-v1",providerId:"csm.messaging",notificationId:"synthetic-id",status:"online"}),{status:201});
  });vi.stubGlobal("fetch",fetchMock);
  try{await new MobilityInvitationOutbox(f.store,new CsmMessagingProvider({baseUrl:"http://synthetic-messaging.test",enabled:true,token:"synthetic-service-token",timeoutMs:1000,cacheTtlMs:0}),f.now).drain();expect(fetchMock).toHaveBeenCalledTimes(1);expect((await f.jobs())[0]!.value.state).toBe("accepted");}finally{vi.unstubAllGlobals();}
 });
 it("rolls back invite and notification together if durable enqueue fails",async()=>{
  const f=await setup();const original=f.store.transact.bind(f.store);f.store.transact=(keys,run)=>original(keys,tx=>run({...tx,set:async(key,value)=>{if(key.startsWith("invite-notification:"))throw Error("synthetic storage unavailable");await tx.set(key,value);}}));
  await expect(f.service.createInvitation(f.a,"vehicle",f.entity,f.input)).rejects.toThrow();f.store.transact=original;
  expect(await f.jobs()).toHaveLength(0);expect(await f.store.transact([],tx=>tx.scan("invite:"))).toHaveLength(0);
 });
});
