import {describe,it,expect,afterAll} from "vitest";
import {Pool} from "pg";
import {randomUUID} from "node:crypto";
import {PostgresMobilityStore} from "./mobility-store.js";
import {SharedMobilityService} from "./mobility-invitations.js";
const connectionString=process.env.COP_MOBILITY_TEST_DATABASE_URL;
if (connectionString) { const url=new URL(connectionString); if (!["127.0.0.1","localhost"].includes(url.hostname) || url.pathname !== "/cop_mobility_test") throw new Error("Requires isolated loopback cop_mobility_test database"); }
const stores:PostgresMobilityStore[]=[];
afterAll(async()=>{for(const s of stores)await s.close()});
describe.skipIf(!connectionString)("isolated actual PostgreSQL mobility",()=>{
 it("rolls back, serializes writers across connections and preserves receipts after restart",async()=>{
  const pool=new Pool({connectionString});await pool.query("DROP TABLE IF EXISTS cop_mobility_v1");await pool.end();
  const store=new PostgresMobilityStore({connectionString,max:4});stores.push(store);await store.init();
  await expect(store.transact([],async tx=>{await tx.set("rollback",true);throw Error("injected")})).rejects.toThrow("injected");expect(await store.transact([],tx=>tx.get("rollback"))).toBeUndefined();
  const service=new SharedMobilityService(store);const a=await service.account({authMode:"oidc",issuer:"https://test.example",subjectId:"synthetic",displayName:"test",username:"test",roles:[]});const input={operationId:randomUUID(),details:{name:"Synthetic DB"}};
  const concurrent=await Promise.all(Array.from({length:6},()=>service.createVehicle(a,input)));expect(new Set(concurrent.map(x=>x.vehicleId)).size).toBe(1);
  const id=concurrent[0]!.vehicleId;
  const changed=await Promise.allSettled(["A","B"].map(name=>service.updateVehicle(a,id,{operationId:randomUUID(),expectedDataRevision:1,expectedMembershipRevision:1,details:{name}})));expect(changed.filter(x=>x.status==="fulfilled")).toHaveLength(1);
  const second=new PostgresMobilityStore({connectionString,max:3});stores.push(second);await second.init();expect(await new SharedMobilityService(second).createVehicle(a,input)).toEqual(concurrent[0]);
  await store.claimDispatchInstance();await expect(second.claimDispatchInstance()).rejects.toThrow("one active");expect(store.dispatchIsAvailable()).toBe(true);expect(second.dispatchIsAvailable()).toBe(false);
 });
});
