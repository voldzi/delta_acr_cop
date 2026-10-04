import { describe, it, expect } from "vitest";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { MemoryMobilityStore } from "./mobility-store.js";
import { SharedMobilityService } from "./mobility-invitations.js";
import { acceptsMobilitySchema } from "./mobility-contract.js";
import type * as W from "./mobility-types.js";
import type { AuthenticatedActor } from "./security.js";

const actor = (sub: string, verified = true): AuthenticatedActor => ({authMode:"oidc",issuer:"https://synthetic.example/issuer",subjectId:sub,displayName:sub,username:sub,email:`${sub}@example.test`,emailVerified:verified,roles:[]});
async function fixture(){
 let time = Date.parse("2026-10-04T12:00:00.000Z"); const store=new MemoryMobilityStore();const service=new SharedMobilityService(store,()=>new Date(time));
 const a=await service.account(actor("a"));const b=await service.account(actor("b"));const c=await service.account(actor("c"));
 return {store,service,a,b,c,advance:(ms:number)=>{time+=ms},now:()=>new Date(time).toISOString()};
}
async function joined(f:Awaited<ReturnType<typeof fixture>>,type:"vehicle"|"group"){
 const entity=type==="vehicle" ? await f.service.createVehicle(f.a,{operationId:randomUUID(),details:{name:"Synthetic"}}) : await f.service.createGroup(f.a,{operationId:randomUUID(),name:"Synthetic private group"});
 const id="vehicleId" in entity ? entity.vehicleId : entity.groupId;
 const invitation=await f.service.createInvitation(f.a,type,id,{operationId:randomUUID(),expectedMembershipRevision:1,email:f.b.email!,...(type==="vehicle"?{capabilities:["readVehicle","recordRide"] as W.SharedVehicleMember["capabilities"]}:{})});
 await f.service.acceptInvitation(f.b,type,{operationId:randomUUID(),invitationId:invitation.invitationId});return id;
}
const publicKey=()=>{const pair=generateKeyPairSync("x25519"); return (pair.publicKey.export({format:"der",type:"spki"}) as Buffer).subarray(-32).toString("base64")};
async function sharing(f:Awaited<ReturnType<typeof fixture>>){
 const groupId=await joined(f,"group");const deviceA=await f.service.registerDevice(f.a,{operationId:randomUUID(),publicKeyX25519:publicKey(),deviceName:"A"});
 const deviceB=await f.service.registerDevice(f.b,{operationId:randomUUID(),publicKeyX25519:publicKey(),deviceName:"B"});
 const ready=await f.service.readiness(f.a,groupId);const input={operationId:randomUUID(),deviceId:deviceA.deviceId,expectedMembershipRevision:ready.membershipRevision,audienceHash:ready.audienceHash,durationSeconds:900 as const,endPolicy:"duration" as const,consent:true as const};
 const started=await f.service.startShare(f.a,groupId,input);
 const point:W.DispatchPointPublish={deviceId:deviceA.deviceId,sequence:1,observedAt:f.now(),source:"gps",membershipRevision:ready.membershipRevision,audienceHash:ready.audienceHash,boxes:ready.devices.map(d=>({recipientDeviceId:d.deviceId,ephemeralPublicKeyX25519:publicKey(),combinedCiphertext:Buffer.alloc(64,7).toString("base64")}))};
 return {groupId,deviceA,deviceB,ready,input,started,point};
}

describe("shared mobility durable boundaries",()=>{
 it("maps issuer+subject independently of emails and rejects lab identity",async()=>{const f=await fixture();expect((await f.service.account(actor("a"))).accountId).toBe(f.a.accountId);expect(f.a.accountId).not.toBe(f.b.accountId);expect((await f.service.account({...actor("a"),issuer:"https://different.example"})).accountId).not.toBe(f.a.accountId);await expect(f.service.account({...actor("lab"),authMode:"lab"})).rejects.toMatchObject({status:401});});
 it("persists operation IDs, isolates accounts and rejects changed content",async()=>{const f=await fixture();const input={operationId:randomUUID(),details:{name:"A"}};const first=await f.service.createVehicle(f.a,input);expect(await f.service.createVehicle(f.a,input)).toEqual(first);await expect(f.service.createVehicle(f.a,{...input,details:{name:"B"}})).rejects.toMatchObject({status:409});expect((await f.service.createVehicle(f.b,input)).vehicleId).not.toBe(first.vehicleId);await expect(f.service.getVehicle(f.c,first.vehicleId)).rejects.toMatchObject({status:404});});
 it("invitation inbox is verified and nonenumerating, acceptance is account-authoritative",async()=>{const f=await fixture();const id=await joined(f,"vehicle");expect((await f.service.pendingInvitations(f.c)).items).toHaveLength(0);await expect(f.service.updateVehicle(f.b,id,{operationId:randomUUID(),expectedDataRevision:1,expectedMembershipRevision:2,details:{name:"bad"}})).rejects.toMatchObject({status:404});const v=await f.service.getVehicle(f.b,id);expect(v.members).toHaveLength(2);const r=await f.service.createInvitation(f.a,"vehicle",id,{operationId:randomUUID(),expectedMembershipRevision:2,email:f.c.email!,capabilities:["readVehicle"]});await expect(f.service.acceptInvitation({...f.c,emailVerified:false},"vehicle",{operationId:randomUUID(),invitationId:r.invitationId})).rejects.toMatchObject({status:403});await expect(f.service.acceptInvitation(f.b,"vehicle",{operationId:randomUUID(),invitationId:r.invitationId})).rejects.toMatchObject({status:404});});
 it("serializes simultaneous revisions, filters costs and invalidates membership-bound cursors",async()=>{const f=await fixture();const id=await joined(f,"vehicle");const updates=await Promise.allSettled(["one","two"].map(name=>f.service.updateVehicle(f.a,id,{operationId:randomUUID(),expectedDataRevision:1,expectedMembershipRevision:2,details:{name}})));expect(updates.filter(x=>x.status==="fulfilled")).toHaveLength(1);const v=await f.service.getVehicle(f.a,id);await f.service.writeRecord(f.a,id,{operationId:randomUUID(),recordId:randomUUID(),expectedRecordRevision:0,expectedMembershipRevision:2,expectedDataRevision:v.dataRevision,occurredAt:f.now(),timeZone:"Europe/Prague",data:{kind:"expense",category:"other",amount:{currency:"CZK",minorUnits:"12345"}}});const sync=await f.service.syncVehicle(f.b,id,undefined);expect(JSON.stringify(sync)).not.toContain("12345");await f.service.membership(f.a,id,{operationId:randomUUID(),expectedMembershipRevision:2,accountId:f.b.accountId,action:"remove"});await expect(f.service.syncVehicle(f.b,id,sync.nextCursor)).rejects.toMatchObject({status:404});});
 it("rolls back partial transaction and preserves original operation result on restart",async()=>{const f=await fixture();await expect(f.store.transact([],async tx=>{await tx.set("test",true);throw Error("fault")})).rejects.toThrow();expect(await f.store.transact([],tx=>tx.get("test"))).toBeUndefined();const input={operationId:randomUUID(),details:{name:"restart"}};const first=await f.service.createVehicle(f.a,input);const restarted=new SharedMobilityService(f.store);expect(await restarted.createVehicle(f.a,input)).toEqual(first);});
});

describe("private Dispatch latest-only and revocation",()=>{
 it("only returns the receiver box, persists no ciphertext and has stable point receipts",async()=>{const f=await fixture();const x=await sharing(f);const one=await f.service.publishPoint(f.a,x.started.share.shareId,x.point);const retry=await f.service.publishPoint(f.a,x.started.share.shareId,x.point);expect(retry.operationId).toBe(one.operationId);const snap=await f.service.snapshot(f.b,x.groupId,x.deviceB.deviceId);expect(snap.points).toHaveLength(1);expect(snap.points[0]!.box.recipientDeviceId).toBe(x.deviceB.deviceId);const durable=await f.store.transact([],tx=>tx.scan(""));expect(JSON.stringify(durable)).not.toContain("combinedCiphertext");await expect(f.service.snapshot(f.c,x.groupId,x.deviceB.deviceId)).rejects.toMatchObject({status:404});});
 it("rejects missing recipients, future/stale points, wrong device and sequence conflicts",async()=>{const f=await fixture();const x=await sharing(f);const share=x.started.share.shareId;await expect(f.service.publishPoint(f.a,share,{...x.point,boxes:x.point.boxes.slice(1)})).rejects.toMatchObject({status:400});await expect(f.service.publishPoint(f.a,share,{...x.point,observedAt:"2026-10-04T12:00:06.000Z"})).rejects.toMatchObject({status:422});await expect(f.service.publishPoint(f.b,share,x.point)).rejects.toMatchObject({status:404});await f.service.publishPoint(f.a,share,x.point);await expect(f.service.publishPoint(f.a,share,{...x.point,boxes:x.point.boxes.map(b=>({...b,combinedCiphertext:Buffer.alloc(64,8).toString("base64")}))})).rejects.toMatchObject({status:409});f.advance(2000);await expect(f.service.publishPoint(f.a,share,{...x.point,sequence:2,observedAt:f.now()})).rejects.toMatchObject({status:429,retryAfter:5});});
 it("stop wins against simultaneous publish and duplicate start never reactivates",async()=>{const f=await fixture();const x=await sharing(f);const share=x.started.share.shareId;const results=await Promise.allSettled([f.service.publishPoint(f.a,share,x.point),f.service.stopShare(f.a,share,{operationId:randomUUID(),deviceId:x.deviceA.deviceId,reason:"user"})]);expect(results[1]!.status).toBe("fulfilled");const snap=await f.service.snapshot(f.b,x.groupId,x.deviceB.deviceId);expect(snap.activeShares).toHaveLength(0);expect(snap.points).toHaveLength(0);expect((await f.service.startShare(f.a,x.groupId,x.input)).share.state).toBe("stopped");await expect(f.service.publishPoint(f.a,share,x.point)).rejects.toMatchObject({status:410});});
 it("membership/key changes invalidate consent and own stop survives group deletion",async()=>{const f=await fixture();const x=await sharing(f);await f.service.publishPoint(f.a,x.started.share.shareId,x.point);await f.service.registerDevice(f.b,{operationId:randomUUID(),publicKeyX25519:publicKey(),deviceName:"B2"});expect((await f.service.snapshot(f.b,x.groupId,x.deviceB.deviceId)).points).toHaveLength(0);await expect(f.service.publishPoint(f.a,x.started.share.shareId,x.point)).rejects.toMatchObject({status:410});await f.service.deleteGroup(f.a,x.groupId,{operationId:randomUUID(),expectedMembershipRevision:2});expect((await f.service.stopShare(f.a,x.started.share.shareId,{operationId:randomUUID(),deviceId:x.deviceA.deviceId,reason:"user"})).confirmed).toBe(true);});
 it("hides expired point, has no history and invalidates all shares after restart",async()=>{const f=await fixture();const x=await sharing(f);await f.service.publishPoint(f.a,x.started.share.shareId,x.point);f.advance(181000);expect((await f.service.snapshot(f.b,x.groupId,x.deviceB.deviceId)).points).toHaveLength(0);const restarted=new SharedMobilityService(f.store);await restarted.initializeDispatch();try{expect((await restarted.ownedShares(f.a)).items).toHaveLength(0);expect((await restarted.snapshot(f.b,x.groupId,x.deviceB.deviceId)).activeShares).toHaveLength(0)}finally{restarted.closeDispatch()}});
});

describe("strict contract rejects plaintext and invented identities",()=>{
 it("rejects extra GPS/context/actor fields, invalid calendar values and duplicate grants",()=>{expect(acceptsMobilitySchema("SharedVehicleCreate",{operationId:randomUUID(),details:{name:"valid"},accountId:randomUUID()})).toBe(false);expect(acceptsMobilitySchema("DispatchPointPublish",{deviceId:randomUUID(),sequence:1,observedAt:"2026-02-31T00:00:00Z",source:"gps",membershipRevision:1,audienceHash:"a".repeat(64),boxes:[],lat:50})).toBe(false);expect(acceptsMobilitySchema("MobilityInvitationCreate",{operationId:randomUUID(),expectedMembershipRevision:1,email:"x@example.test",capabilities:["readVehicle","readVehicle"]})).toBe(false)});
});

describe("retention without resurrection",()=>{
 it("purges deleted domain data while old operation hash rejects replay",async()=>{const f=await fixture();const create={operationId:randomUUID(),details:{name:"Delete me"}};const v=await f.service.createVehicle(f.a,create);await f.service.deleteVehicle(f.a,v.vehicleId,{operationId:randomUUID(),expectedDataRevision:1,expectedMembershipRevision:1,reason:"Synthetic retention test"});f.advance(31*86400000);await f.service.pruneRetainedData();expect(await f.store.transact([],tx=>tx.get(`vehicle:${v.vehicleId}`))).toBeUndefined();await expect(f.service.createVehicle(f.a,create)).rejects.toMatchObject({status:410,code:"OPERATION_EXPIRED"});expect(JSON.stringify(await f.store.transact([],tx=>tx.scan("operation:")))).not.toContain("Delete me");});
});


describe("timeout start cancellation barrier",()=>{
 it("cancel-before-late-start persists a tombstone, cancel-after-commit stops and retry cannot revive",async()=>{
  const f=await fixture();const x=await sharing(f);
  await f.service.cancelStart(f.a,{operationId:randomUUID(),startOperationId:x.input.operationId});
  expect((await f.service.startShare(f.a,x.groupId,x.input)).share.state).toBe("stopped");
  const pending={...x.input,operationId:randomUUID()};
  await f.service.cancelStart(f.a,{operationId:randomUUID(),startOperationId:pending.operationId});
  await expect(f.service.startShare(f.a,x.groupId,pending)).rejects.toMatchObject({status:410,code:"START_CANCELLED"});
  const restarted=new SharedMobilityService(f.store);await expect(restarted.startShare(f.a,x.groupId,pending)).rejects.toMatchObject({status:410,code:"START_CANCELLED"});
  const another={...x.input,operationId:randomUUID()};
  await f.service.cancelStart(f.b,{operationId:randomUUID(),startOperationId:another.operationId});
  expect((await f.service.startShare(f.a,x.groupId,another)).share.state).toBe("active");
 });
});

describe("bounded private roster list",()=>{
 it("cannot create a 101st membership beyond the complete list bound",async()=>{
  const f=await fixture();const example=await f.service.createGroup(f.b,{operationId:randomUUID(),name:"Synthetic quota fixture"});
  await f.store.transact([],async tx=>{for(let i=0;i<100;i++){const groupId=randomUUID();await tx.set(`group:${groupId}`,{group:{...example,groupId,members:[...example.members,{accountId:f.a.accountId,displayName:"Synthetic A",role:"member"}]},shares:{}})}});
  expect((await f.service.listGroups(f.a)).items).toHaveLength(100);
  await expect(f.service.createGroup(f.a,{operationId:randomUUID(),name:"Beyond list bound"})).rejects.toMatchObject({status:429,code:"MEMBERSHIP_LIMIT"});
 });
});
