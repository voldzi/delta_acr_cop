import {describe,it,expect,afterEach,vi} from "vitest";
import {Pool} from "pg";
import {randomUUID,generateKeyPairSync} from "node:crypto";
import {PostgresMobilityStore} from "./mobility-store.js";
import {SharedMobilityService} from "./mobility-invitations.js";
const connectionString=process.env.COP_MOBILITY_TEST_DATABASE_URL;
if (connectionString) { const url=new URL(connectionString); if (!["127.0.0.1","localhost"].includes(url.hostname) || url.pathname !== "/cop_mobility_test") throw new Error("Requires isolated loopback cop_mobility_test database"); }
const stores:PostgresMobilityStore[]=[];
afterEach(async()=>{for(const s of stores.splice(0))await s.close()});
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
 it("reacquires a terminated real connection repeatedly, invalidates shares and excludes contenders",async()=>{
  const admin=new Pool({connectionString});
  const timing={heartbeatMs:50,retryMinMs:20,retryMaxMs:100,maxVerificationAgeMs:500};
  const store=new PostgresMobilityStore({connectionString,max:3},timing);stores.push(store);await store.init();
  const service=new SharedMobilityService(store);await service.initializeDispatch();
  let contenderService:SharedMobilityService|undefined;
  try{
   expect(store.dispatchIsAvailable()).toBe(true);
   const a=await service.account({authMode:"oidc",issuer:"https://synthetic.test",subjectId:"recovery-test",displayName:"Synthetic",username:"Synthetic",roles:[]});
   const group=await service.createGroup(a,{operationId:randomUUID(),name:"Synthetic recovery"});
   const key=()=>generateKeyPairSync("x25519").publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("base64");
   const device=await service.registerDevice(a,{operationId:randomUUID(),publicKeyX25519:key(),deviceName:"Synthetic"});
   for(let n=0;n<3;n++){
    const ready=await service.readiness(a,group.groupId);const input={operationId:randomUUID(),deviceId:device.deviceId,expectedMembershipRevision:ready.membershipRevision,audienceHash:ready.audienceHash,durationSeconds:900 as const,endPolicy:"duration" as const,consent:true as const};
    const started=await service.startShare(a,group.groupId,input);
    await service.publishPoint(a,started.share.shareId,{deviceId:device.deviceId,sequence:1,observedAt:new Date().toISOString(),source:"gps",membershipRevision:ready.membershipRevision,audienceHash:ready.audienceHash,boxes:[{recipientDeviceId:device.deviceId,ephemeralPublicKeyX25519:key(),combinedCiphertext:Buffer.alloc(64,7).toString("base64")}]});
    expect((await service.snapshot(a,group.groupId,device.deviceId)).points).toHaveLength(1);
    const generation=store.dispatchGeneration();
    const killed=await admin.query("SELECT pg_terminate_backend(pid) AS killed FROM pg_stat_activity WHERE datname='cop_mobility_test' AND application_name='cop-private-dispatch-lease'");expect(killed.rows).toHaveLength(1);
    await vi.waitFor(()=>{expect(store.dispatchGeneration()).toBeGreaterThan(generation);expect(store.dispatchIsAvailable()).toBe(true)},{timeout:5000,interval:20});
    expect((await service.ownedShares(a)).items).toHaveLength(0);
    const snapshot=await service.snapshot(a,group.groupId,device.deviceId);expect(snapshot.activeShares).toHaveLength(0);expect(snapshot.points).toHaveLength(0);
    expect((await service.startShare(a,group.groupId,input)).share.state).toBe("stopped");
    const durable=await store.transact([],tx=>tx.scan(""));expect(JSON.stringify(durable)).not.toContain("combinedCiphertext");
    const locks=await admin.query("SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND classid=731031 AND objid=1 AND granted");expect(locks.rows[0].n).toBe(1);
   }
   const contender=new PostgresMobilityStore({connectionString,max:3},timing);stores.push(contender);contenderService=new SharedMobilityService(contender);await contenderService.initializeDispatch();
   expect(contender.dispatchIsAvailable()).toBe(false);expect(store.dispatchIsAvailable()).toBe(true);
  }finally{contenderService?.closeDispatch();service.closeDispatch();await admin.end()}
 },20000);

});
