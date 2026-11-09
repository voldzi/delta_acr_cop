import type { VehicleConversationProvider } from "./vehicle-conversation-provider.js";
import { acceptsMobilitySchema } from "./mobility-contract.js";
import {describe,it,expect,afterEach,beforeEach,vi} from "vitest";
import {createSign,generateKeyPairSync,randomUUID} from "node:crypto";
import {createServer,type Server} from "node:http";
import {buildServer} from "./server.js";
import {clearJwksCacheForTests} from "./security.js";
import {MemoryMobilityStore} from "./mobility-store.js";
const original={...process.env};const pair=generateKeyPairSync("rsa",{modulusLength:2048});let jwks:Server;let issuer:string;
beforeEach(async()=>{jwks=createServer((_req,res)=>{res.setHeader("Content-Type","application/json");res.end(JSON.stringify({keys:[{...pair.publicKey.export({format:"jwk"}),kid:"test",alg:"RS256",use:"sig"}]}))});await new Promise<void>(resolve=>jwks.listen(0,"127.0.0.1",resolve));const address=jwks.address();if(!address||typeof address==="string")throw Error();issuer=`http://127.0.0.1:${address.port}`;process.env={...original,COP_AUTH_MODE:"oidc",COP_ALLOW_LAB_TOKEN:"false",COP_OIDC_ISSUER:issuer,COP_OIDC_JWKS_URI:issuer+"/jwks",COP_OIDC_ALLOWED_CLIENTS:"csm-mobile",COP_OIDC_CLIENT_ID:"csm-mobile",COP_OIDC_REQUIRED_ROLE:"cop_operator"};clearJwksCacheForTests()});
afterEach(async()=>{process.env={...original};clearJwksCacheForTests();jwks.closeAllConnections();await new Promise<void>(resolve=>jwks.close(()=>resolve()))});
function token(sub:string,extra={}){const time=Math.floor(Date.now()/1000);const h=Buffer.from(JSON.stringify({alg:"RS256",kid:"test"})).toString("base64url");const p=Buffer.from(JSON.stringify({iss:issuer,sub,azp:"csm-mobile",name:sub,email:sub+"@example.test",email_verified:true,exp:time+300,iat:time,realm_access:{roles:["cop_operator"]},...extra})).toString("base64url");const body=h+"."+p;const sign=createSign("RSA-SHA256");sign.update(body);return body+"."+sign.sign(pair.privateKey).toString("base64url")}
describe("actual signed OIDC shared mobility HTTP",()=>{
 it("returns authoritative create/accept receipts, isolates two accounts, rejects identity injection and private GPS",async()=>{const store=new MemoryMobilityStore();const app=buildServer({mobilityStore:store,sharedMobilityEnabled:true,privateDispatchEnabled:true});try{const a={authorization:"Bearer "+token("a")};const b={authorization:"Bearer "+token("b")};
 const call=async(method:"GET"|"POST"|"PUT",url:string,headers: Record<string,string>=a,payload?:unknown)=>app.inject({method,url,headers,...(payload===undefined?{}:{payload:payload as Record<string,unknown>})});
 expect((await call("GET","/api/v1/mobility/v1/account",{})).statusCode).toBe(401);expect((await call("GET","/api/v1/mobility/v1/account",{authorization:"Bearer "+token("a",{email_verified:"true"})})).statusCode).toBe(401);
 const accountA=(await call("GET","/api/v1/mobility/v1/account")).json();const accountB=(await call("GET","/api/v1/mobility/v1/account",b)).json();expect(accountA.accountId).not.toBe(accountB.accountId);
 const operationId=randomUUID();const create=await call("POST","/api/v1/shared-vehicles/v1/vehicles",a,{operationId,details:{name:"Synthetic API vehicle"}});expect(create.statusCode).toBe(200);const receipt=create.json();expect(receipt.operationId).toBe(operationId);expect(receipt.confirmed).toBe(true);const id=receipt.vehicle.vehicleId;
 expect((await call("GET",`/api/v1/shared-vehicles/v1/vehicles/${id}`,b)).statusCode).toBe(404);
 const invite=(await call("POST",`/api/v1/shared-vehicles/v1/vehicles/${id}/invitations`,a,{operationId:randomUUID(),expectedMembershipRevision:1,email:"b@example.test",capabilities:["readVehicle"]})).json();expect(invite.status).toBe("queued");
 const acceptId=randomUUID();const accept=await call("POST","/api/v1/shared-vehicles/v1/invitations/accept",b,{operationId:acceptId,invitationId:invite.invitationId});expect(accept.statusCode).toBe(200);expect(accept.json()).toMatchObject({operationId:acceptId,confirmed:true,vehicle:{vehicleId:id,membershipRevision:2}});
 expect((await call("GET",`/api/v1/shared-vehicles/v1/vehicles/${id}`,b)).statusCode).toBe(200);
 expect((await call("POST","/api/v1/shared-vehicles/v1/vehicles",a,{operationId:randomUUID(),details:{name:"bad"},accountId:accountB.accountId})).statusCode).toBe(400);
 expect((await call("GET","/api/v1/mobility/v1/account?accountId="+accountB.accountId)).statusCode).toBe(400);
 const gps=await call("PUT",`/api/v1/private-dispatch/v1/shares/${randomUUID()}/points`,a,{lat:50,lon:14,deviceId:randomUUID(),sequence:1});expect(gps.statusCode).toBe(400);expect(gps.json().error.correlationId).toBeTruthy();expect(gps.body).not.toContain('"lat"');
 }finally{await app.close()}});
 it("returns 503 on unavailable storage, never creates a transient fallback",async()=>{const store=new MemoryMobilityStore();const app=buildServer({mobilityStore:store,sharedMobilityEnabled:true,privateDispatchEnabled:false});await app.ready();store.transact=async()=>{throw Error("synthetic dependency unavailable")};try{const r=await app.inject({url:"/api/v1/mobility/v1/account",headers:{authorization:"Bearer "+token("a")}});expect(r.statusCode).toBe(503);expect(r.body).not.toContain("synthetic dependency")}finally{await app.close()}});
 it("separates vehicle capability availability from lease outage, and readiness fails closed",async()=>{
  class FlakyStore extends MemoryMobilityStore { available=true; override dispatchIsAvailable(){return this.available;} }
  const store=new FlakyStore();const app=buildServer({mobilityStore:store,sharedMobilityEnabled:true,privateDispatchEnabled:true});await app.ready();store.available=false;
  const headers={authorization:"Bearer "+token("a")};try{
   const caps=await app.inject({url:"/api/v1/mobility/v1/capabilities",headers});expect(caps.statusCode).toBe(200);expect(caps.json().serviceAvailability).toMatchObject({sharedVehicles:"ready",dispatch:"unavailable"});
   expect((await app.inject({url:"/api/v1/mobility/v1/account",headers})).statusCode).toBe(200);
   expect((await app.inject({url:"/api/v1/shared-vehicles/v1/vehicles",headers})).statusCode).toBe(200);
   const privateResult=await app.inject({url:"/api/v1/private-dispatch/v1/groups",headers});expect(privateResult.statusCode).toBe(503);expect(privateResult.json().error.code).toBe("DISPATCH_UNAVAILABLE");
   expect((await app.inject({url:"/health/live"})).statusCode).toBe(200);expect((await app.inject({url:"/health/ready"})).statusCode).toBe(503);
   const deps=(await app.inject({url:"/health/dependencies"})).json();expect(deps.status).toBe("degraded");expect(deps.dependencies).toContainEqual(expect.objectContaining({name:"private-dispatch",status:"unavailable"}));
   store.available=true;expect((await app.inject({url:"/health/ready"})).statusCode).toBe(200);
   const unverified=await app.inject({url:"/api/v1/mobility/v1/invitations",headers:{authorization:"Bearer "+token("a",{email_verified:false})}});expect(unverified.statusCode).toBe(403);expect(unverified.json().error.code).toBe("EMAIL_VERIFICATION_REQUIRED");
   store.transact=async()=>{throw Error("synthetic outage")};const down=await app.inject({url:"/api/v1/mobility/v1/capabilities",headers});expect(down.statusCode).toBe(200);expect(down.json().serviceAvailability).toMatchObject({sharedVehicles:"unavailable",dispatch:"unavailable"});expect(down.body).not.toContain("synthetic outage");
  }finally{await app.close()}
 });

 it("exposes the staged chat route with signed identity and never confirms a pending membership cutover", async () => {
  let pending = false, joined = false;
  const provider: VehicleConversationProvider = {
   ready: async () => true, snapshot: async () => undefined,
   close: async (vehicleId, plan) => ({ vehicleId, ...plan, conversationId: `conv_vehicle_${vehicleId}`, roomId: "!vehicle:synthetic.test" }),
   synchronize: async (_actor, vehicleId, plan, members) => pending ? { state: "pending" } : { state: "ready", proof: {
    vehicleId, membershipRevision: plan.membershipRevision, recipientEpoch: plan.recipientEpoch, operationId: plan.operationId,
    roomGeneration: 1, conversationId: `conv_vehicle_${vehicleId}`, roomId: "!vehicle:synthetic.test",
    memberAccountIds: members.map(m => m.accountId), joinedAccountIds: joined ? members.map(m => m.accountId) : [],
    encrypted: true, historyPolicy: "from_membership", membershipAuthority: "cop_vehicle", roomMembershipVerified: true,
    notificationAudienceVerified: true, clientMembershipChangesDenied: true, revocation: "server_enforced", retiredRoomIds: [], retirementVerified: true
   } }
  };
  const store = new MemoryMobilityStore(), app = buildServer({ mobilityStore: store, sharedMobilityEnabled: true,
   sharedVehicleCommunicationEnabled: true, vehicleConversationProvider: provider });
  try {
   const aSub = randomUUID(), bSub = randomUUID(), outsider = randomUUID();
   const a = { authorization: "Bearer " + token(aSub) }, b = { authorization: "Bearer " + token(bSub) };
   const call = (method: "GET" | "POST", url: string, headers: Record<string,string> = a, payload?: unknown) => app.inject({method,url,headers,...(payload === undefined ? {} : {payload: payload as Record<string,unknown>})});
   const accountB = (await call("GET", "/api/v1/mobility/v1/account", b)).json();
   const created = (await call("POST", "/api/v1/shared-vehicles/v1/vehicles", a, {operationId:randomUUID(),details:{name:"Synthetic chat vehicle"}})).json();
   const id = created.vehicle.vehicleId, path = `/api/v1/shared-vehicles/v1/vehicles/${id}/conversation`;
   // Creation confirms the vehicle, while native preparation is asynchronous.
   // The existing cutover fence intentionally blocks overlapping audience work.
   await vi.waitFor(async () => expect((await store.transact([], tx =>
    tx.get<import("./mobility-service.js").VehicleState>(`vehicle:${id}`)))?.conversationProjection?.status).toBe("ready"), { timeout: 2500 });
   const invitation = (await call("POST", `/api/v1/shared-vehicles/v1/vehicles/${id}/invitations`, a,
    {operationId:randomUUID(),expectedMembershipRevision:1,email:`${bSub}@example.test`,capabilities:["readVehicle"]})).json();
   expect((await call("POST", "/api/v1/shared-vehicles/v1/invitations/accept", b,
    {operationId:randomUUID(),invitationId:invitation.invitationId})).statusCode).toBe(200);
   const request = {operationId:randomUUID(),expectedMembershipRevision:2};
   expect((await call("POST", path, {}, request)).statusCode).toBe(401);
   expect((await call("POST", path, {authorization:"Bearer "+token(outsider)}, request)).statusCode).toBe(404);
   expect((await call("POST", path, a, {...request,roomId:"!chosen:elsewhere.test"})).statusCode).toBe(400);
   const prepared = await call("POST", path, a, request); expect(prepared.statusCode).toBe(202);
   expect(acceptsMobilitySchema("SharedVehicleConversationPending", prepared.json())).toBe(true);
   joined = true;
   const ready = await call("POST", path, a, request); expect(ready.statusCode).toBe(200);
   expect(acceptsMobilitySchema("SharedVehicleConversationReceipt", ready.json())).toBe(true);
   pending = true;
   const removal = {operationId:randomUUID(),expectedMembershipRevision:2,accountId:accountB.accountId,action:"remove"};
   const result = await call("POST", `/api/v1/shared-vehicles/v1/vehicles/${id}/members`, a, removal);
   expect(result.statusCode).toBe(202); expect(result.json().confirmed).toBe(false);
   expect(acceptsMobilitySchema("SharedVehicleMutationPending", result.json())).toBe(true);
   expect((await call("POST", path, b, request)).statusCode).toBe(404);
   pending = false;
   const completed = await call("POST", `/api/v1/shared-vehicles/v1/vehicles/${id}/members`, a, removal);
   expect(completed.statusCode).toBe(200); expect(completed.json().confirmed).toBe(true);
  } finally { await app.close(); }
 });

});
