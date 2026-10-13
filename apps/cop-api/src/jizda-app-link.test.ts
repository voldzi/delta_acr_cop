import Fastify from "fastify";
import { describe,it,expect,vi } from "vitest";
import { MemoryMobilityStore } from "./mobility-store.js";
import type { AuthenticatedActor } from "./security.js";
import { JizdaAppLinkService, registerJizdaAppLinkRoutes, disconnectJizdaMessaging } from "./jizda-app-link.js";
const op="a85c1e8c-358e-4e39-87a0-e0e9e09d8312";
const actor=(id="a",client="jizda-mobile"):AuthenticatedActor=>({authMode:"oidc",issuer:"https://identity.test/realm",authorizedParty:client,subjectId:id,username:id,displayName:id});
const complete={pushRegistrationsRemoved:true,legacyInstallationsResolved:true,matrixDevicesRevoked:true,livePermissionsRevoked:true};
function setup() {
  const store=new MemoryMobilityStore(),cleanup=vi.fn(async()=>complete);
  const service=new JizdaAppLinkService({store,clientId:"jizda-mobile",issuer:"https://identity.test/realm",cleanup});
  return {store,service,cleanup};
}
describe("Jizda app link scope",()=>{
  it("requires signed separate authorized party, not a shared client, audience or app header",async()=>{
    const {service}=setup();
    for (const a of [actor("a","csm-mobile"),actor("a","cop-web"),{...actor(),authorizedParty:undefined},{...actor(),issuer:"https://other.test"}]) {
      await expect(service.disconnect(a,op)).rejects.toMatchObject({status:403,code:"APP_SCOPE_NOT_PROVEN"});
    }
    expect(()=>new JizdaAppLinkService({...service.options,clientId:"csm-mobile"})).toThrow();
  });
  it("fences only this user's Jizda access durably before cleanup; other apps/accounts retain access",async()=>{
    const {service,cleanup}=setup();
    cleanup.mockRejectedValueOnce(new Error("private upstream"));
    await expect(service.disconnect(actor(),op)).rejects.toMatchObject({status:503});
    expect(await service.read(actor())).toMatchObject({status:"disconnecting",accountDeleted:false,localDataDeleted:false});
    await expect(service.assertAllowed(actor())).rejects.toMatchObject({code:"JIZDA_LINK_DISCONNECTED"});
    await service.assertAllowed(actor("a","csm-mobile"));
    await service.assertAllowed(actor("a","cop-web"));
    await service.assertAllowed(actor("b"));
    expect(await service.read(actor("b"))).toBeNull();
    expect(await service.disconnect(actor(),op)).toMatchObject({status:"disconnected",remaining:[]});
  });
  it("does not treat APNs removal or missing legacy/Matrix/live permission proof as completion",async()=>{
    const {service,cleanup}=setup();
    cleanup.mockResolvedValueOnce({...complete,legacyInstallationsResolved:false,matrixDevicesRevoked:false,livePermissionsRevoked:false});
    expect(await service.disconnect(actor(),op)).toMatchObject({status:"disconnecting",remaining:["legacy_installations","matrix_devices","live_permissions"]});
  });
  it("coalesces the durable operation across concurrent retries and never deletes unrelated store rows",async()=>{
    const {service,store,cleanup}=setup();
    await store.transact([],async tx=>{await tx.set("vehicle:owned",{owner:"a"});await tx.set("shared-history",{kept:true});});
    const receipts=await Promise.all(Array.from({length:5},()=>service.disconnect(actor(),op)));
    expect(new Set(receipts.map(r=>r.operationId)).size).toBe(1);
    const calls=cleanup.mock.calls.length;
    await service.disconnect(actor(),op);
    expect(cleanup).toHaveBeenCalledTimes(calls);
    expect(await store.transact([],tx=>tx.get("vehicle:owned"))).toEqual({owner:"a"});
    expect(await store.transact([],tx=>tx.get("shared-history"))).toEqual({kept:true});
  });
  it("maps disabled, forged-body and upstream failure truthfully and blocks ordinary routes",async()=>{
    const {service,cleanup}=setup(),app=Fastify();
    registerJizdaAppLinkRoutes(app,service,r=>typeof r.headers.authorization==="string"?actor(r.headers.authorization,r.headers["x-test-client"] as string??"jizda-mobile"):null);
    app.get("/private",()=>({allowed:true}));
    try {
      expect((await app.inject({url:"/api/v1/me/app-links/jizda/capabilities"})).statusCode).toBe(401);
      const shared=await app.inject({url:"/api/v1/me/app-links/jizda/capabilities",headers:{authorization:"a","x-test-client":"csm-mobile","x-app-bundle-id":"cz.voldzi.jizda"}});
      expect(shared.json()).toMatchObject({disconnectAvailable:false,accountDeletion:false});
      expect((await app.inject({method:"POST",url:"/api/v1/me/app-links/jizda/disconnect",headers:{authorization:"a","idempotency-key":op},payload:{userId:"b",app:"copmobile"}})).statusCode).toBe(400);
      cleanup.mockResolvedValueOnce({...complete,matrixDevicesRevoked:false});
      const pending=await app.inject({method:"POST",url:"/api/v1/me/app-links/jizda/disconnect",headers:{authorization:"a","idempotency-key":op}});
      expect(pending.statusCode).toBe(202);expect(pending.json().status).toBe("disconnecting");
      expect(pending.headers["cache-control"]).toBe("no-store");
      expect((await app.inject({url:"/private",headers:{authorization:"a"}})).statusCode).toBe(403);
      expect((await app.inject({url:"/private",headers:{authorization:"a","x-test-client":"csm-mobile"}})).statusCode).toBe(200);
      expect((await app.inject({url:"/private",headers:{authorization:"b"}})).statusCode).toBe(200);
      cleanup.mockRejectedValueOnce(new Error("secret internal failure"));
      const outage=await app.inject({method:"POST",url:"/api/v1/me/app-links/jizda/disconnect",headers:{authorization:"a","idempotency-key":op}});
      expect(outage.statusCode).toBe(503);expect(outage.body).not.toContain("secret internal");
    } finally {await app.close();}
  });
  it("does not send or accept a user-selected app/key and never fabricates downstream completion",async()=>{
    const fetchMock=vi.fn(async(_url:string|URL|Request,_options?:RequestInit)=>new Response(JSON.stringify({contractVersion:"csm-jizda-disconnect-v1",pushRegistrationsRemoved:true,legacyInstallationsResolved:true,matrixDevicesRevoked:true,livePermissionsRevoked:false})));
    vi.stubGlobal("fetch",fetchMock);
    try {
      const proof=await disconnectJizdaMessaging(actor(),{baseUrl:"http://internal.test",token:"fixture-service-token",timeoutMs:1000});
      expect(proof).toEqual({...complete,livePermissionsRevoked:false});
      const options=fetchMock.mock.calls[0]![1] as RequestInit;
      expect(options.headers).toMatchObject({"x-csm-user-id":"a","x-csm-app-client-id":"jizda-mobile","x-csm-oidc-issuer":actor().issuer});expect(options.body).toBeUndefined();expect(options.redirect).toBe("error");
    } finally {vi.unstubAllGlobals();}
  });
  it("rejects legacy, partial, unexpected and falsely completed provider proofs",async()=>{
    const exact={contractVersion:"csm-jizda-disconnect-v1",pushRegistrationsRemoved:true,legacyInstallationsResolved:true,matrixDevicesRevoked:true,livePermissionsRevoked:false};
    const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
    try {
      for (const [body,status] of [
        [{contractVersion:exact.contractVersion,pushRegistrationsRemoved:true,legacyInstallationsResolved:true},200],
        [{...exact,livePermissionsRevoked:true},200],[{...exact,userId:"other"},200],[exact,202]
      ] as const) {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body),{status}));
        await expect(disconnectJizdaMessaging(actor(),{baseUrl:"http://internal.test",token:"synthetic",timeoutMs:1000})).rejects.toMatchObject({status:503});
      }
    } finally {vi.unstubAllGlobals();}
  });
  it("retains accepted fences when intake is disabled and refuses an unreviewed scope change",async()=>{
    const {service,cleanup}=setup();cleanup.mockResolvedValue({...complete,livePermissionsRevoked:false});
    await service.disconnect(actor(),op);
    const rollback=new JizdaAppLinkService({...service.options,intakeEnabled:false});
    await expect(rollback.assertAllowed(actor())).rejects.toMatchObject({status:403});
    await rollback.assertAllowed(actor("a","csm-mobile"));
    expect(await rollback.disconnect(actor(),op)).toMatchObject({status:"disconnecting",remaining:["live_permissions"]});
    await expect(rollback.disconnect(actor("b"),op)).rejects.toMatchObject({status:503});
    const changed=new JizdaAppLinkService({...service.options,clientId:"jizda-mobile-other"});
    await expect(changed.init()).rejects.toMatchObject({code:"JIZDA_SCOPE_CONFIGURATION_CHANGED"});
  });
});
