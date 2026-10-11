import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { PostgresMobilityStore } from "./mobility-store.js";
import { SharedMobilityService } from "./mobility-invitations.js";
const connectionString=process.env.COP_RECORD_DETAILS_TEST_DATABASE_URL;
if(connectionString){const url=new URL(connectionString);if(!["localhost","127.0.0.1"].includes(url.hostname)||url.pathname!=="/cop_record_details_test")throw Error("Requires isolated loopback cop_record_details_test database")}
describe.skipIf(!connectionString)("real PostgreSQL shared receipt details",()=>{
 it("persists complete details, receipts and omission protection across connections/restart",async()=>{
 const first=new PostgresMobilityStore({connectionString,max:3});const second=new PostgresMobilityStore({connectionString,max:3});const pool=new Pool({connectionString});
 try{
 await first.init();await second.init();const service=new SharedMobilityService(first);const account=await service.account({authMode:"oidc",issuer:"https://synthetic.test",subjectId:"synthetic-"+randomUUID(),displayName:"Synthetic",username:"Synthetic"});const vehicle=await service.createVehicle(account,{operationId:randomUUID(),details:{name:"Synthetic vehicle"}});
 const input={operationId:randomUUID(),recordId:randomUUID(),expectedRecordRevision:0,expectedDataRevision:1,expectedMembershipRevision:1,occurredAt:"2026-10-05T12:00:00Z",timeZone:"Europe/Prague",data:{kind:"service" as const,title:"Synthetic service",odometerKm:"120",amount:{currency:"CZK" as const,minorUnits:"300000"},details:{version:1 as const,note:"Synthetic preserved note",categoryId:"synthetic-category",items:[{itemId:randomUUID(),title:"Synthetic item",amount:{currency:"CZK" as const,minorUnits:"300000"}}]}}};
 const receipt=await service.writeRecord(account,vehicle.vehicleId,input);const restarted=new SharedMobilityService(second);expect(await restarted.writeRecord(account,vehicle.vehicleId,input)).toEqual(receipt);expect(receipt.odometerSnapshot?.valueKm).toBe("120");expect((await restarted.getVehicle(account,vehicle.vehicleId)).odometerSnapshot).toEqual(receipt.odometerSnapshot);const sync=await restarted.syncVehicle(account,vehicle.vehicleId,undefined);expect(sync.items.find(x=>x.record?.recordId===input.recordId)?.record?.data).toEqual(input.data);
 const update={...input,operationId:randomUUID(),expectedDataRevision:2,expectedRecordRevision:1,data:{kind:"service" as const,title:"Incomplete"}};await expect(restarted.writeRecord(account,vehicle.vehicleId,update)).rejects.toMatchObject({status:409,code:"DETAILS_VERSION_REQUIRED"});expect((await service.getVehicle(account,vehicle.vehicleId)).dataRevision).toBe(2);
 const full={...input,expectedDataRevision:2,expectedRecordRevision:1};const results=await Promise.allSettled([service,restarted].map(s=>s.writeRecord(account,vehicle.vehicleId,{...full,operationId:randomUUID()})));expect(results.filter(x=>x.status==="fulfilled")).toHaveLength(1);expect(results.filter(x=>x.status==="rejected")).toHaveLength(1);expect((await restarted.getVehicle(account,vehicle.vehicleId)).dataRevision).toBe(3);
 }finally{await pool.end();await first.close();await second.close()}
 });
});
