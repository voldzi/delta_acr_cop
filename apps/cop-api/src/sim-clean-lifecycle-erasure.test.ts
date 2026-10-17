import { createHmac, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSimCleanLifecycleErasureAdapter } from "./sim-clean-lifecycle-erasure.js";
import { signedCleanLifecycleActor, cleanLifecycleActorConfigFromEnv } from "./clean-lifecycle-actor.js";
import { CopByokRouterClient } from "./ai-router-byok.js";
import { HttpDriverMeasurementSource } from "./driver-measurement-source.js";
import { contributorIdDay } from "./driver-measurement-contract.js";
import type { AuthenticatedActor } from "./security.js";
const now = new Date(), issuer = "https://identity.synthetic.invalid/realms/cop";
const config = { issuer, resetEpoch: randomUUID(), actorSecret: "synthetic-clean-signing-secret-32-characters", userIdSecret: "synthetic-stable-user-hmac-secret-32-characters",
  baseUrl: "http://sim.synthetic.invalid", token: "synthetic-service-token-at-least-32-characters", now: () => now };
const actor: AuthenticatedActor = { authMode: "oidc", issuer, subjectId: randomUUID(), tokenIssuedAt: Math.floor(now.getTime()/1000)-1, username: "", displayName: "" };
const context = { accountKey: "synthetic-owner-digest", operationId: randomUUID(), requestedAt: now.toISOString(), signal: new AbortController().signal };
function claims(headers: Record<string,string>) {
  const encoded = headers["x-cop-clean-actor"]!;
  expect(headers["x-cop-clean-actor-signature"]).toBe(createHmac("sha256",config.actorSecret).update(encoded).digest("hex"));
  const value = JSON.parse(Buffer.from(encoded,"base64url").toString("utf8"));
  expect(Object.keys(value).sort()).toEqual(["iss","aud","sub","oidcIssuer","oidcSubject","resetEpoch","operationId","requestedAt","iat","exp","jti","resourceId","oidcIat"].sort());
  expect(value).toMatchObject({iss:"cop",aud:"sim-clean-lifecycle-v1",oidcIssuer:issuer,resetEpoch:config.resetEpoch});
  expect(value.exp-value.iat).toBe(60); return value;
}
afterEach(() => vi.unstubAllGlobals());
describe.each(["ai","driver","sim_user_data"] as const)("SIM clean lifecycle %s boundary", component => {
  const prefix = component === "sim_user_data" ? "/api/v1/internal/sim-user-data/v1" : component === "ai" ? "/api/v1/ai-router/internal/user-lifecycle/v1" : "/api/v1/internal/user-lifecycle/v1";
  const receipt = {contractVersion:component === "sim_user_data" ? "cop-sim-user-data-v1" : "cop-sim-user-lifecycle-v1",scope:"cop_sim_shared_identity_v1",resetEpoch:config.resetEpoch,operationId:context.operationId,state:"deletion_pending",component,wholeAccountComplete:false};
  function fixture(options: {state?:string;postStatus?:number;wrongEpoch?:boolean;wrongComponent?:boolean;wrongOp?:boolean;noStore?:boolean;extra?:boolean;pendingSubcomponent?:boolean;missingSubcomponents?:boolean;wrongSubcomponent?:boolean}={}) {
    const mock=vi.fn(async(input:URL|string,init?:RequestInit)=>{
      const url=new URL(String(input));expect(url.origin).toBe(config.baseUrl);expect(init?.redirect).toBe("error");expect(init?.signal).toBeInstanceOf(AbortSignal);
      const headers=init?.headers as Record<string,string>;expect(headers.authorization).toBe("Bearer "+config.token);
      const responseHeaders={"cache-control":options.noStore?"public,max-age=100":"no-store"};
      if(url.pathname.endsWith('/capabilities'))return Response.json({contractVersion:receipt.contractVersion,scope:receipt.scope,resetEpoch:config.resetEpoch,component,ready:true,wholeAccountComplete:false},{headers:responseHeaders});
      const claim=claims(headers);expect(claim.oidcSubject).toBe(actor.subjectId);expect(claim.operationId).toBe(context.operationId);expect(claim.oidcIat).toBe(actor.tokenIssuedAt);
      expect(url.pathname.startsWith(prefix)).toBe(true);
      if(init?.method==='POST')expect(JSON.parse(String(init.body))).toEqual({contractVersion:receipt.contractVersion,scope:receipt.scope,resetEpoch:config.resetEpoch,operationId:context.operationId,requestedAt:context.requestedAt});
      const state = options.state ?? 'deletion_pending';
      const subcomponents = component === 'sim_user_data' && !options.missingSubcomponents ? {subcomponents:{
        app_store:state === 'deleted' ? 'deleted' : 'pending',
        audit_and_publisher: options.pendingSubcomponent ? 'pending' : state === 'deleted' ? 'deleted' : 'pending',
        router_sim_history: options.wrongSubcomponent ? 'complete' : state === 'deleted' ? 'deleted' : 'pending'
      }} : {};
      return Response.json({...receipt,...subcomponents,state:options.state??'deletion_pending',...(options.wrongEpoch?{resetEpoch:randomUUID()}:{}),...(options.wrongComponent?{component:component==='ai'?'driver':'ai'}:{}),...(options.wrongOp?{operationId:randomUUID()}:{}),...(options.extra?{subjectId:actor.subjectId}:{})},{status:init?.method==='POST'?(options.postStatus??202):200,headers:responseHeaders});
    });vi.stubGlobal('fetch',mock);return {mock,adapter:createSimCleanLifecycleErasureAdapter({...config,component})};
  }
  it('signs the exact verified owner and retains202 as pending; uses separate endpoints',async()=>{
    const f=fixture();expect(await f.adapter.ready()).toBe(true);expect((await f.adapter.preflight!(actor,context)).ready).toBe(true);
    expect(await f.adapter.erase(actor,context)).toEqual({status:'pending',remaining:'cleanup_pending'});
  });
  it('accepts completion only with an exact epoch, operation and component readback',async()=>{
    const f=fixture({state:'deleted',postStatus:200});expect((await f.adapter.erase(actor,context)).status).toBe('completed');
    expect((await f.adapter.verifiedCompletedOperationProof(actor,context)).status).toBe('completed');
  });
  it.each([{wrongEpoch:true},{wrongComponent:true},{wrongOp:true},{noStore:true},{extra:true},{state:'deleted',postStatus:202}])('refuses unproven completion %j',async options=>{
    const f=fixture(options);await expect(f.adapter.erase(actor,context)).rejects.toThrow();
  });
  if (component === 'sim_user_data') it.each([{pendingSubcomponent:true},{missingSubcomponents:true},{wrongSubcomponent:true}])('requires all three typed SIM subcomponent readbacks %j',async options=>{
    const f=fixture({...options,state:'deleted',postStatus:200});await expect(f.adapter.erase(actor,context)).rejects.toThrow();
  });
  it('does not turn outage or404 into completed erasure and never calls a provider',async()=>{
    const fetcher=vi.fn(async()=>new Response(null,{status:503}));vi.stubGlobal('fetch',fetcher);
    const adapter=createSimCleanLifecycleErasureAdapter({...config,component});expect(await adapter.ready()).toBe(false);
    await expect(adapter.erase(actor,context)).rejects.toThrow('CLEAN_SIM_UNAVAILABLE');
    expect(fetcher.mock.calls).toHaveLength(2);
  });
  it('rejects another issuer before network effects',async()=>{
    const f=fixture();await expect(f.adapter.erase({...actor,issuer:'https://foreign.invalid'},context)).rejects.toThrow();expect(f.mock).not.toHaveBeenCalled();
  });
});
describe('actual writer assertions',()=>{
  it('binds BYOK key writes to the same server identity as the ordinary Router assertion',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(_input:URL|string,init?:RequestInit)=>{
      const h=init!.headers as Record<string,string>,clean=claims(h),ordinary=JSON.parse(Buffer.from(h['x-cop-actor']!,'base64url').toString('utf8'));
      expect(clean.sub).toBe(ordinary.sub);expect(clean.resourceId).toBe(clean.sub);expect(clean.oidcSubject).toBe(actor.subjectId);expect(clean.oidcIat).toBe(actor.tokenIssuedAt);
      expect(JSON.stringify(clean)).not.toContain('sk-proj-');return Response.json({configured:true});
    }));
    const client=new CopByokRouterClient({...config,cleanLifecycle:config});
    await client.putKey(actor.subjectId,'sk-proj-'+'a'.repeat(40),actor.tokenIssuedAt);
  });
  it('attests only the correctly derived driver contributor and rejects a mismatched source owner',async()=>{
    const contributorSecret='synthetic-driver-hmac-at-least-32-characters',day=now.toISOString().slice(0,10),batch={batchId:randomUUID(),contributorDay:day,contributorIdDay:contributorIdDay(contributorSecret,actor.subjectId,day)};
    const fetcher=vi.fn(async(_input:URL|string,init?:RequestInit)=>{const v=claims(init!.headers as Record<string,string>);expect(v.resourceId).toBe(batch.contributorIdDay);return new Response(null,{status:503})});vi.stubGlobal('fetch',fetcher);
    const source=new HttpDriverMeasurementSource(config.baseUrl,config.token,10000,{issuer,actorSecret:config.actorSecret,contributorSecret},config);
    await expect(source.send(batch,{subjectId:actor.subjectId,contributorDay:day,tokenIssuedAt:actor.tokenIssuedAt})).rejects.toMatchObject({statusCode:503});expect(fetcher).toHaveBeenCalledOnce();
    await expect(source.send(batch,{subjectId:randomUUID(),contributorDay:day,tokenIssuedAt:actor.tokenIssuedAt})).rejects.toMatchObject({statusCode:503});expect(fetcher).toHaveBeenCalledOnce();
  });
  it('isolates opaque owners and refuses a missing original token issue time',()=>{
    const a=claims(signedCleanLifecycleActor(config,actor.subjectId,{tokenIssuedAt:actor.tokenIssuedAt}));
    const b=claims(signedCleanLifecycleActor(config,randomUUID(),{tokenIssuedAt:actor.tokenIssuedAt}));expect(a.sub).not.toBe(b.sub);
    expect(()=>signedCleanLifecycleActor(config,actor.subjectId)).toThrow('CLEAN_LIFECYCLE_ACTOR_INVALID');
  });
});


describe("clean production configuration", () => {
  it("does not activate for the former scope and rejects missing, malformed or future cutoff", () => {
    expect(cleanLifecycleActorConfigFromEnv(config.actorSecret, {})).toBeUndefined();
    const env = { COP_ACCOUNT_ERASURE_SCOPE: "cop_sim_shared_identity_v1", COP_OIDC_ISSUER: issuer,
      COP_USER_RESET_EPOCH: config.resetEpoch, COP_AI_CHAT_ROUTER_USER_ID_SECRET: config.userIdSecret };
    for(const cutoff of ["", "0", "NaN", String(Math.floor(Date.now()/1000)+86400)])
      expect(()=>cleanLifecycleActorConfigFromEnv(config.actorSecret,{...env,COP_USER_RESET_TOKENS_NOT_BEFORE:cutoff})).toThrow("CLEAN_LIFECYCLE_CUTOFF_INVALID");
    const cutoff=Math.floor(Date.now()/1000)-100;
    const actual=cleanLifecycleActorConfigFromEnv(config.actorSecret,{...env,COP_USER_RESET_TOKENS_NOT_BEFORE:String(cutoff)})!;
    expect(actual.resetEpoch).toBe(config.resetEpoch);
    expect(()=>signedCleanLifecycleActor(actual,actor.subjectId,{tokenIssuedAt:cutoff})).toThrow();
    expect(()=>signedCleanLifecycleActor(actual,actor.subjectId,{tokenIssuedAt:actor.tokenIssuedAt})).not.toThrow();
  });
});
