import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SharedMobilityService } from "./mobility-invitations.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import { validSharedRoutingProfile, activeCareReminders } from "./mobility-vehicle-audit.js";
import type { VehicleState } from "./mobility-service.js";
import type * as W from "./mobility-types.js";
const now = new Date("2026-10-05T12:00:00Z");
const actor = (subjectId: string) => ({authMode:"oidc" as const,issuer:"https://synthetic.test",subjectId,username:subjectId,displayName:subjectId,email:subjectId+"@example.test",emailVerified:true});
const profile = (intent: W.SharedVehicleMappedProfile["intent"] = "car"): W.SharedVehicleRoutingProfile => ({version:1,powertrain:"combustion",mappedProfile:{version:"sim-mapped-road-profile-v1",coverageAcknowledged:"mapped_restrictions_incomplete",intent,...(intent === "commercial_truck" ? {vehicle:{heightM:4,widthM:2.5,lengthM:12,loadedWeightKg:20000,axleCount:3,axleLoadKg:9000}} : {})}});
async function setup(withProfile = false) {
 const store=new MemoryMobilityStore(),service=new SharedMobilityService(store,()=>now),a=await service.account(actor("owner")),b=await service.account(actor("driver")),c=await service.account(actor("outsider"));
 const localVehicleId=randomUUID();const request={operationId:randomUUID(),details:{name:"Synthetic",...(withProfile?{routingProfile:profile("commercial_truck")}: {})},ownerBinding:{version:1 as const,localVehicleId}};
 const v=await service.createVehicle(a,request);const invite=await service.createInvitation(a,"vehicle",v.vehicleId,{operationId:randomUUID(),expectedMembershipRevision:1,email:b.email!,capabilities:["readVehicle","recordRide","recordExpense","recordService","editVehicle","manageReminders"]});await service.acceptInvitation(b,"vehicle",{operationId:randomUUID(),invitationId:invite.invitationId});return{service,store,a,b,c,id:v.vehicleId,localVehicleId,request};
}
async function write(f:Awaited<ReturnType<typeof setup>>,a:W.MobilityAccount,data:W.SharedVehicleRecordData,extra:Partial<W.SharedVehicleRecordWrite>={}) {
 const v=await f.service.getVehicle(a,f.id);const q:W.SharedVehicleRecordWrite={operationId:randomUUID(),recordId:randomUUID(),expectedRecordRevision:0,expectedDataRevision:v.dataRevision,expectedMembershipRevision:v.membershipRevision,occurredAt:"2026-10-05T01:00:00Z",timeZone:"UTC",data,...extra};return{q,result:await f.service.writeRecord(a,f.id,q)};
}
describe("shared vehicle audit/profile/recovery",()=>{
 it("validates all mapped intents and dimensions using the authoritative SIM schema",()=>{
  for(const intent of["car","commercial_truck","road_legal_4x4"] as const)expect(validSharedRoutingProfile(profile(intent))).toBe(true);
  const trailer=profile("car_with_trailer");trailer.mappedProfile.vehicle={heightM:3,widthM:2.5,lengthM:10,loadedWeightKg:5000,trailer:{attached:true,heightM:2,widthM:2,lengthM:6,loadedWeightKg:2000}};expect(validSharedRoutingProfile(trailer)).toBe(true);
  const bad=structuredClone(trailer);bad.mappedProfile.vehicle!.trailer!.loadedWeightKg=6000;expect(validSharedRoutingProfile(bad)).toBe(false);
  const missing=profile("commercial_truck");delete missing.mappedProfile.vehicle;expect(validSharedRoutingProfile(missing)).toBe(false);
  const zero=profile("commercial_truck");zero.mappedProfile.vehicle!.heightM=0;expect(validSharedRoutingProfile(zero)).toBe(false);
  expect(validSharedRoutingProfile({...profile(),mappedProfile:{...profile().mappedProfile,driverDeclaredAuthorization:true}} as unknown as W.SharedVehicleRoutingProfile)).toBe(false);
 });
 it("shares owner-declared profile exactly, rejects omission and driver changes, keeps normal CAS",async()=>{
  const f=await setup(true),v=await f.service.getVehicle(f.a,f.id);expect((await f.service.getVehicle(f.b,f.id)).details.routingProfile).toEqual(v.details.routingProfile);
  const request={operationId:randomUUID(),expectedDataRevision:v.dataRevision,expectedMembershipRevision:v.membershipRevision,details:{name:"Changed"}};
  await expect(f.service.updateVehicle(f.a,f.id,request)).rejects.toMatchObject({code:"SHARED_ROUTING_PROFILE_REQUIRED"});
  await expect(f.service.updateVehicle(f.b,f.id,{...request,details:{name:"Changed",routingProfile:profile()}})).rejects.toMatchObject({status:403});
  const valid={...request,details:{name:"Changed",routingProfile:profile()}};const result=await f.service.updateVehicle(f.a,f.id,valid);expect(await f.service.updateVehicle(f.a,f.id,valid)).toEqual(result);
  await expect(f.service.updateVehicle(f.a,f.id,{...valid,operationId:randomUUID()})).rejects.toMatchObject({status:409});expect((await f.service.getVehicle(f.b,f.id)).details.routingProfile).toEqual(profile());
 });
 it("recovers exact owner binding only within current authenticated owner, prevents duplicates and rebinding",async()=>{
  const f=await setup();expect((await f.service.listVehicles(f.a)).items[0]!.ownerBinding).toEqual({version:1,localVehicleId:f.localVehicleId,ownerAccountId:f.a.accountId});
  expect((await f.service.getVehicle(f.b,f.id)).ownerBinding).toBeUndefined();expect(JSON.stringify(await f.service.syncVehicle(f.b,f.id,undefined))).not.toContain(f.localVehicleId);await expect(f.service.getVehicle(f.c,f.id)).rejects.toMatchObject({status:404});
  await expect(f.service.createVehicle(f.a,{...f.request,operationId:randomUUID()})).rejects.toMatchObject({code:"OWNER_BINDING_EXISTS"});
  const v=await f.service.getVehicle(f.a,f.id);await expect(f.service.updateVehicle(f.a,f.id,{operationId:randomUUID(),expectedDataRevision:v.dataRevision,expectedMembershipRevision:v.membershipRevision,details:v.details,ownerBinding:{version:1,localVehicleId:randomUUID()}})).rejects.toMatchObject({code:"OWNER_BINDING_CONFLICT"});
  await expect(f.service.updateVehicle(f.b,f.id,{operationId:randomUUID(),expectedDataRevision:v.dataRevision,expectedMembershipRevision:v.membershipRevision,details:v.details,ownerBinding:{version:1,localVehicleId:f.localVehicleId}})).rejects.toMatchObject({status:403});
  const identical={...f.request,operationId:randomUUID(),ownerBinding:{version:1 as const,localVehicleId:randomUUID()}};const concurrent=await Promise.allSettled([identical,{...identical,operationId:randomUUID()}].map(q=>f.service.createVehicle(f.a,q)));expect(concurrent.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  await f.service.membership(f.a,f.id,{operationId:randomUUID(),expectedMembershipRevision:v.membershipRevision,action:"transfer_ownership",accountId:f.b.accountId});expect((await f.service.getVehicle(f.a,f.id)).ownerBinding).toBeUndefined();expect((await f.service.getVehicle(f.b,f.id)).ownerBinding).toBeUndefined();
 });
 it("audits owner corrections and voids without losing original author, receipt, or historical payload",async()=>{
  const f=await setup(),first=await write(f,f.b,{kind:"service",title:"Original",amount:{currency:"CZK",minorUnits:"1000"},odometerKm:"100"});const v=await f.service.getVehicle(f.a,f.id);
  const q:W.SharedVehicleRecordWrite={...first.q,operationId:randomUUID(),expectedDataRevision:v.dataRevision,expectedRecordRevision:1,data:{kind:"service",title:"Corrected",amount:{currency:"CZK",minorUnits:"2000"},odometerKm:"101"},correction:{version:1,recordId:first.q.recordId,recordRevision:1,reason:"Synthetic receipt correction"}};
  const result=await f.service.writeRecord(f.a,f.id,q);expect(result.recordRevision).toBe(2);expect(await f.service.writeRecord(f.a,f.id,q)).toEqual(result);
  const sync=await f.service.syncVehicle(f.a,f.id,undefined);const events=sync.items.filter(e=>e.recordId===q.recordId);expect(events[0]!.record!.data).toEqual(first.q.data);expect(events.at(-1)!.record!.authorAccountId).toBe(f.b.accountId);expect(events.at(-1)!.audit).toMatchObject({action:"correct",previousRecordRevision:1,reason:q.correction!.reason});
  const latest=await f.service.getVehicle(f.a,f.id);await expect(f.service.writeRecord(f.a,f.id,{...q,operationId:randomUUID(),expectedRecordRevision:2,expectedDataRevision:latest.dataRevision})).rejects.toMatchObject({code:"CORRECTION_BASE_CHANGED"});
  const deleted=await f.service.deleteRecord(f.a,f.id,{operationId:randomUUID(),recordId:q.recordId,expectedRecordRevision:2,expectedDataRevision:latest.dataRevision,expectedMembershipRevision:latest.membershipRevision,reason:"Synthetic void"});expect(deleted.recordRevision).toBe(3);
  const after=await f.service.syncVehicle(f.a,f.id,undefined);expect(after.items.at(-1)!.audit).toMatchObject({action:"void",previousRecordRevision:2,reason:"Synthetic void"});expect(after.items.at(-1)!.record!.data).toEqual(q.data);expect((await f.service.getVehicle(f.a,f.id)).odometerSnapshotV2!.status).toBe("unknown");expect((await f.service.syncVehicle(f.b,f.id,undefined)).items.some(e=>e.recordId===q.recordId)).toBe(false);
 });
 it("binds instrument corrections to original revision and recalculates without erasing original observation",async()=>{
  const f=await setup(),first=await write(f,f.a,{kind:"odometer",odometerKm:"100"});const second=await write(f,f.a,{kind:"odometer",odometerKm:"99",correctionOfRecordId:first.q.recordId,correctionReason:"Synthetic meter correction"},{correction:{version:1,recordId:first.q.recordId,recordRevision:1,reason:"Synthetic meter correction"}});
  expect(second.result.odometerSnapshotV2).toMatchObject({status:"known",valueKm:"99"});const sync=await f.service.syncVehicle(f.a,f.id,undefined);expect(sync.items.find(e=>e.recordId===first.q.recordId)!.record!.data).toEqual(first.q.data);
 });
 it("returns a whole-state care snapshot without prices, and recalculates after completion or void",async()=>{
  const f=await setup(),reminder=await write(f,f.a,{kind:"reminder",title:"Synthetic care",dueAt:"2026-10-06T01:00:00.123Z",dueOdometerKm:"200",completed:false});await write(f,f.a,{kind:"expense",category:"parking",amount:{currency:"CZK",minorUnits:"999999"}});
  const v=await f.service.getVehicle(f.b,f.id);expect(v.activeCareReminders).toMatchObject({version:1,state:"complete",dataRevision:v.dataRevision,items:[{recordId:reminder.q.recordId,recordRevision:1}]});expect(JSON.stringify(v)).not.toContain("999999");
  const updated=await write(f,f.a,{kind:"reminder",title:"Synthetic care",completed:true},{recordId:reminder.q.recordId,expectedRecordRevision:1,correction:{version:1,recordId:reminder.q.recordId,recordRevision:1,reason:"Completed"}});expect(updated.result.recordRevision).toBe(2);expect((await f.service.getVehicle(f.b,f.id)).activeCareReminders!.items).toEqual([]);
  const state=await f.store.transact([],tx=>tx.get<VehicleState>('vehicle:'+f.id));for(let i=0;i<501;i++){const id=randomUUID();state!.records[id]={recordId:id,vehicleId:f.id,authorAccountId:f.a.accountId,revision:1,deleted:false,createdAt:now.toISOString(),occurredAt:now.toISOString(),timeZone:"UTC",data:{kind:"reminder",title:"Synthetic",completed:false}}}expect(activeCareReminders(state!)).toMatchObject({state:"unavailable",items:[]});
 });
});
