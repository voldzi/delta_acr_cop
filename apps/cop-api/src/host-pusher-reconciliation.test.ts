import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { describe, it, expect, vi } from "vitest";
import { HostPusherReconciliation, registerHostPusherReconciliationRoutes } from "./host-pusher-reconciliation.js";
import type { AuthenticatedActor } from "./security.js";
const now = new Date("2026-11-06T10:00:00Z");
const actor = (subjectId = "synthetic-a"): AuthenticatedActor => ({subjectId, authMode:"oidc",issuer:"https://identity.test/cop",authorizedParty:"csm-mobile",authTime:now.getTime()/1000,username:"test",displayName:"test"});
const input = {contractVersion:"cop-host-pusher-reconcile-v1",operationId:"00000000-0000-4000-8000-000000000001",appInstanceId:"00000000-0000-4000-8000-000000000002",bundleId:"cz.voldzi.jizda",pushKey:"synthetic-push",confirmation:"remove_stale_pusher"};
const receipt = (owner = "synthetic-a") => ({contractVersion:input.contractVersion,operationId:input.operationId,appInstanceId:input.appInstanceId,bundleId:input.bundleId,actorSubjectId:owner,targetFingerprint:createHash("sha256").update(input.bundleId+"\0"+input.pushKey).digest("hex"),outcome:"complete",registryRevision:1,matrixDeviceCreated:false,chatSessionRestored:false});
function fixture(reply: unknown = receipt(), status = 200) {
  const wire = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(reply),{status}));
  const active = vi.fn(async (_actor: AuthenticatedActor) => undefined);
  const service = new HostPusherReconciliation({config:{baseUrl:"http://messaging.test",enabled:true,token:"synthetic-service",timeoutMs:1000,cacheTtlMs:0},issuer:actor().issuer!,now:()=>now,fetch:wire,assertActorActive:active});
  return {service,wire,active};
}
describe("fresh-owner exact pusher reconciliation", () => {
  it("forwards only authenticated server identity and returns exact-target completion without credentials",async()=>{
    const {service,wire,active}=fixture();expect(await service.reconcile(actor(),input)).toEqual(receipt());
    const [url,opts]=wire.mock.calls[0]!;expect(String(url)).toBe("http://messaging.test/api/v1/matrix/pushers/reconcile");
    expect(opts?.redirect).toBe("error");expect(opts?.headers).toMatchObject({"x-csm-user-id":"synthetic-a","x-csm-recovery-auth-time":String(now.getTime()/1000)});
    expect(JSON.parse(String(opts?.body))).toEqual(input);expect(active).toHaveBeenCalledTimes(2);
  });
  it("requires signed recent auth_time, correct issuer and native authorized party",async()=>{
    for(const bad of [{...actor(),authMode:"lab" as const},{...actor(),authTime:undefined},{...actor(),authTime:actor().authTime!-301},{...actor(),authTime:actor().authTime!+31},{...actor(),issuer:"https://wrong.test"},{...actor(),authorizedParty:"cop-web"}]){
      const {service,wire}=fixture();await expect(service.reconcile(bad,input)).rejects.toBeDefined();expect(wire).not.toHaveBeenCalled();
    }
  });
  it("rejects browser-selected owner, model, homeserver, credentials and malformed input before transport",async()=>{
    for(const extra of [{userId:"foreign"},{matrixUserId:"@other:test"},{homeserver:"https://other.test"},{accessToken:"secret"},{model:"x"},{pushKey:"\n"},{bundleId:"foreign"},{confirmation:"yes"}]){
      const {service,wire}=fixture();await expect(service.reconcile(actor(),{...input,...extra})).rejects.toMatchObject({status:400});expect(wire).not.toHaveBeenCalled();
    }
  });
  it("never accepts another owner, operation, installation or target receipt, or a claimed new device",async()=>{
    for(const extra of [{actorSubjectId:"synthetic-b"},{operationId:"wrong"},{appInstanceId:"wrong"},{targetFingerprint:"wrong"},{matrixDeviceCreated:true},{chatSessionRestored:true},{accessToken:"secret"}]){
      const {service}=fixture({...receipt(),...extra});await expect(service.reconcile(actor(),input)).rejects.toMatchObject({status:503,code:"RECOVERY_UNPROVEN"});
    }
    const {service}=fixture(receipt("synthetic-b"));await expect(service.reconcile(actor("synthetic-b"),input)).resolves.toMatchObject({actorSubjectId:"synthetic-b"});
  });
  it("preserves limits, conflicts and dependency failure without direct Matrix fallback",async()=>{
    for(const [upstream,status] of [[429,429],[409,409],[403,403],[500,503],[503,503]]){
      const {service,wire}=fixture({error:{code:"private-error"}},upstream);await expect(service.reconcile(actor(),input)).rejects.toMatchObject({status});expect(wire).toHaveBeenCalledTimes(1);
    }
    const {service,wire}=fixture();wire.mockRejectedValueOnce(new Error("network secret"));await expect(service.reconcile(actor(),input)).rejects.toMatchObject({status:503});expect(wire).toHaveBeenCalledTimes(1);
  });
  it("does not acknowledge success if account authorization changes during the upstream await",async()=>{
    const {service,active}=fixture();active.mockImplementationOnce(async()=>undefined).mockRejectedValueOnce(new Error("account changed"));
    await expect(service.reconcile(actor(),input)).rejects.toMatchObject({status:503});
  });
  it("applies an independent per-owner rate limit",async()=>{
    const {service,wire}=fixture();for(let n=0;n<6;n++)await service.reconcile(actor(),input);
    await expect(service.reconcile(actor(),input)).rejects.toMatchObject({status:429});expect(wire).toHaveBeenCalledTimes(6);
  });
  it("keeps the actual HTTP route authenticated and disabled until paired acceptance",async()=>{
    const app=Fastify(),{service,wire}=fixture();let selected:AuthenticatedActor|null=null,enabled=false;
    registerHostPusherReconciliationRoutes(app,{service,actor:()=>selected,enabled:()=>enabled});
    expect((await app.inject({method:"POST",url:"/api/v1/mobile/host-pushers/reconcile",payload:input})).statusCode).toBe(401);
    selected=actor();expect((await app.inject({method:"POST",url:"/api/v1/mobile/host-pushers/reconcile",payload:input})).statusCode).toBe(503);
    enabled=true;const success=await app.inject({method:"POST",url:"/api/v1/mobile/host-pushers/reconcile",payload:input});expect(success.statusCode).toBe(200);expect(success.headers["cache-control"]).toBe("no-store");expect(wire).toHaveBeenCalledTimes(1);await app.close();
  });
});

const sessionInput={contractVersion:"cop-host-current-chat-session-v1",operationId:"00000000-0000-4000-8000-000000000003",appInstanceId:input.appInstanceId,bundleId:input.bundleId,cleanupOperationId:input.operationId,cleanupTargetFingerprint:receipt().targetFingerprint,deviceId:"CSMIOS.S.00000000000040008000000000000003",confirmation:"new_isolated_chat_session"};
const prepared=()=>({contractVersion:"cop-host-current-chat-session-prepare-v1",operationId:sessionInput.operationId,appInstanceId:sessionInput.appInstanceId,bundleId:sessionInput.bundleId,actorSubjectId:"synthetic-a",deviceId:sessionInput.deviceId,userId:"@synthetic:matrix.test",homeserverBaseUrl:"https://matrix.test",cleanupOperationId:sessionInput.cleanupOperationId,cleanupTargetFingerprint:sessionInput.cleanupTargetFingerprint,validUntil:new Date(now.getTime()+240_000).toISOString(),historyReset:false});
const session=()=>({contractVersion:sessionInput.contractVersion,operationId:sessionInput.operationId,appInstanceId:sessionInput.appInstanceId,bundleId:sessionInput.bundleId,actorSubjectId:"synthetic-a",deviceId:sessionInput.deviceId,userId:"@synthetic:matrix.test",homeserverBaseUrl:"https://matrix.test",accessToken:"synthetic-access",refreshToken:"synthetic-refresh",expiresInMs:60000,e2eeRequired:true,newIsolatedDevice:true,historyReset:false});
describe("current mapped-user isolated session boundary",()=>{
 it("prepares only exact existing mapping and refuses token-bearing/expired or mismatched preparation",async()=>{
  const good=fixture(prepared());good.service.options.config.matrixHomeserverPublicUrl="https://matrix.test";
  expect(await good.service.openCurrentSession(actor(),{...sessionInput,confirmation:"prepare_isolated_chat_session"},true)).toEqual(prepared());
  expect(String(good.wire.mock.calls[0]![0])).toBe("http://messaging.test/api/v1/matrix/sessions/current/prepare");
  for(const extra of [{accessToken:"secret"},{actorSubjectId:"foreign"},{deviceId:"old-device"},{cleanupTargetFingerprint:"wrong"},{validUntil:now.toISOString()},{homeserverBaseUrl:"https://untrusted.test"}]){
   const f=fixture({...prepared(),...extra});f.service.options.config.matrixHomeserverPublicUrl="https://matrix.test";
   await expect(f.service.openCurrentSession(actor(),{...sessionInput,confirmation:"prepare_isolated_chat_session"},true)).rejects.toMatchObject({status:503,code:"SESSION_PREPARATION_UNPROVEN"});
  }
 });
 it("returns credentials only for the exact session/device and configured public homeserver",async()=>{
  const f=fixture(session());f.service.options.config.matrixHomeserverPublicUrl="https://matrix.test";
  expect(await f.service.openCurrentSession(actor(),sessionInput)).toEqual(session());
  expect(String(f.wire.mock.calls[0]![0])).toBe("http://messaging.test/api/v1/matrix/sessions/current");
  for(const extra of [{userId:"not-matrix"},{deviceId:"other"},{historyReset:true},{newIsolatedDevice:false},{e2eeRequired:false},{accessToken:""},{refreshToken:"invalid token"},{expiresInMs:true},{password:"unexpected"}]){
   const bad=fixture({...session(),...extra});bad.service.options.config.matrixHomeserverPublicUrl="https://matrix.test";
   await expect(bad.service.openCurrentSession(actor(),sessionInput)).rejects.toMatchObject({status:503,code:"SESSION_UNPROVEN"});
  }
 });
 it("rejects stale/wrong owner authority and cannot select original arbitrary device, target, URI or identity",async()=>{
  const f=fixture(session());f.service.options.config.matrixHomeserverPublicUrl="https://matrix.test";
  for(const extra of [{deviceId:"ORIGINAL"},{matrixUserId:"@other:test"},{operationId:input.operationId},{confirmation:"reset_history"},{homeserver:"https://other.test"}])await expect(f.service.openCurrentSession(actor(),{...sessionInput,...extra})).rejects.toMatchObject({status:400});
  await expect(f.service.openCurrentSession({...actor(),authTime:undefined},sessionInput)).rejects.toMatchObject({status:401});
  expect(f.wire).not.toHaveBeenCalled();
 });
 it("preserves unknown outcome/conflict and never calls ordinary bootstrap as fallback",async()=>{
  const f=fixture({error:{code:"private"}},409);f.service.options.config.matrixHomeserverPublicUrl="https://matrix.test";
  await expect(f.service.openCurrentSession(actor(),sessionInput)).rejects.toMatchObject({status:409});expect(f.wire).toHaveBeenCalledTimes(1);
  expect(String(f.wire.mock.calls[0]![0])).not.toContain("/matrix/token");
 });
 it("advertises capability only from fresh paired server readiness and source flags",async()=>{
  const disabled=fixture();const off=await disabled.service.capabilities(actor(),false,true);expect(off.exactTargetReconciliation.enabled).toBe(false);expect(disabled.wire).not.toHaveBeenCalled();
  const ready=fixture({contractVersion:"csm-host-pusher-recovery-capabilities-v1",exactTargetReconciliationEnabled:true,isolatedCurrentSessionEnabled:true});
  const on=await ready.service.capabilities(actor(),true,true);expect(on.isolatedCurrentSession.enabled).toBe(true);expect(Date.parse(on.validUntil)).toBe(now.getTime()+30_000);
  const invalid=fixture({enabled:true});await expect(invalid.service.capabilities(actor(),true,true)).rejects.toMatchObject({status:503});
 });
});

describe("session app-link revocation fence",()=>{
 it("denies a revoked scoped app before transport and discards credentials if revoked during RPC",async()=>{
  for(const after of [false,true]){
   const f=fixture(session());f.service.options.config.matrixHomeserverPublicUrl="https://matrix.test";
   let checks=0;f.service.options.assertSessionActorActive=async()=>{checks++;if(!after||checks>1)throw Object.assign(new Error("revoked"),{status:403});};
   await expect(f.service.openCurrentSession(actor(),sessionInput)).rejects.toMatchObject({status:403,code:"APP_ACCESS_REVOKED"});
   expect(f.wire).toHaveBeenCalledTimes(after?1:0);
  }
 });
 it("does not misreport a failed app-link dependency as permission denial",async()=>{
  const f=fixture(session());f.service.options.config.matrixHomeserverPublicUrl="https://matrix.test";
  f.service.options.assertSessionActorActive=async()=>{throw new Error("storage outage");};
  await expect(f.service.openCurrentSession(actor(),sessionInput)).rejects.toMatchObject({status:503});expect(f.wire).not.toHaveBeenCalled();
 });
});

describe("actual Messaging-to-COP paired wire contract",()=>{
 it("accepts actual authenticated backend receipts unchanged and never provisions a fallback",async()=>{
  const f=JSON.parse(readFileSync(new URL("../../../tests/fixtures/native-relogin-paired-v1.json",import.meta.url),"utf8"));
  expect(f.syntheticOnly).toBe(true);expect(f.productionChanged).toBe(false);
  const calls:string[]=[];
  const transport=vi.fn<typeof fetch>(async(url)=>{
   const path=new URL(String(url)).pathname;calls.push(path);
   const body=path.endsWith("reconciliation-capabilities")?f.capabilities:path.endsWith("/reconcile")?f.cleanupReceipt:path.endsWith("/prepare")?f.preparation:f.session;
   return new Response(JSON.stringify(body),{status:200});
  });
  const service=new HostPusherReconciliation({config:{baseUrl:"http://messaging.test",enabled:true,token:"synthetic-service",timeoutMs:1000,cacheTtlMs:0,matrixHomeserverPublicUrl:f.session.homeserverBaseUrl},issuer:f.issuer,now:()=>new Date(f.observedAt),fetch:transport,assertActorActive:async()=>undefined});
  const principal={...actor(f.owner),issuer:f.issuer,authTime:Date.parse(f.observedAt)/1000};
  expect((await service.capabilities(principal,true,true)).isolatedCurrentSession.enabled).toBe(true);
  expect(await service.reconcile(principal,f.cleanupRequest)).toEqual(f.cleanupReceipt);
  expect(await service.openCurrentSession(principal,f.prepareRequest,true)).toEqual(f.preparation);
  expect(await service.openCurrentSession(principal,f.sessionRequest)).toEqual(f.session);
  expect(calls).toEqual(["/api/v1/matrix/pushers/reconciliation-capabilities","/api/v1/matrix/pushers/reconcile","/api/v1/matrix/sessions/current/prepare","/api/v1/matrix/sessions/current"]);
 });
});
