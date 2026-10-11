import {describe,it,expect,afterEach,beforeEach} from "vitest";
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

});
