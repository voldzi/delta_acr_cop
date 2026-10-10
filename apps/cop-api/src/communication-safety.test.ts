import Fastify from "fastify";
import { describe,expect,it,vi } from "vitest";
import { CommunicationSafetyError, CommunicationSafetyService, MessagingCommunicationPolicy, normalizeCommunicationReport, registerCommunicationSafetyRoutes } from "./communication-safety.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import type { AuthenticatedActor } from "./security.js";
const actor = (subjectId:string): AuthenticatedActor => ({authMode:"oidc",issuer:"https://identity.test/realms/cop",subjectId,displayName:"test",username:"test"});
const input = {target:{kind:"message" as const,peerSubjectId:"peer",conversationId:"conversation",eventId:"$event"},reason:"harassment" as const};
function setup() {
  const store = new MemoryMobilityStore();
  const validateTarget = vi.fn(async () => {});
  const policy = {block:vi.fn(async () => true),directAllowed:vi.fn(async () => false),eventMatchesPeer:vi.fn(async()=>true)};
  const service = new CommunicationSafetyService({store,policy,validateTarget,encryptionSecret:"test-secret-only-32-characters-long",moderatorRole:"cop-moderator",contactEmail:"moderation@example.test",retentionPolicyId:"test-policy",now:()=>new Date("2026-10-10T10:00:00Z")});
  return {store,service,validateTarget};
}
describe("communication safety",()=>{
  it("rejects caller identity, automatic history and unconfirmed E2EE evidence",()=>{
    expect(normalizeCommunicationReport({...input,reporter:"other"})).toBeNull();
    expect(normalizeCommunicationReport({...input,reason:["spam"]})).toBeNull();
    expect(normalizeCommunicationReport({...input,context:"private history"})).toBeNull();
    expect(normalizeCommunicationReport({...input,evidence:{selectedText:"selected",explicitlyConfirmed:false}})).toBeNull();
    expect(normalizeCommunicationReport({...input,evidence:{selectedText:"x".repeat(4097),explicitlyConfirmed:true}})).toBeNull();
    expect(normalizeCommunicationReport({...input,target:{...input.target,roomId:"!other:test"}})).toBeNull();
    expect(normalizeCommunicationReport({...input,target:{kind:"call",peerSubjectId:"peer",callId:"invalid-call"}})).toBeNull();
    expect(normalizeCommunicationReport({...input,target:{kind:"call",peerSubjectId:"peer",callId:"e6450609-cbe5-4c9c-adfa-598db1d125ef"}})).not.toBeNull();
    expect(normalizeCommunicationReport(input)).toEqual(input);
  });
  it("isolates accounts, scopes idempotence and encrypts selected evidence at rest",async()=>{
    const {store,service}=setup(),body={...input,evidence:{selectedText:"EXPLICIT_SELECTED_EVIDENCE",explicitlyConfirmed:true as const}};
    const a=await service.submit(actor("a"),body,"operation-00000001");
    expect(await service.submit(actor("a"),body,"operation-00000001")).toEqual(a);
    const b=await service.submit(actor("b"),body,"operation-00000001");
    expect(a.reportId).not.toBe(b.reportId);
    await expect(service.read(actor("b"),a.reportId)).rejects.toMatchObject({status:404});
    await expect(service.read({...actor("a"),issuer:"https://other.test/realm"},a.reportId)).rejects.toMatchObject({status:404});
    await expect(service.submit(actor("a"),{...body,reason:"spam"},"operation-00000001")).rejects.toMatchObject({status:409});
    expect(JSON.stringify(await store.transact([],tx=>tx.scan("communication-safety:")))).not.toContain("EXPLICIT_SELECTED_EVIDENCE");
    expect(await service.read(actor("a"),a.reportId)).not.toHaveProperty("evidence");
    expect(await service.read(actor("moderator"),a.reportId,true)).toHaveProperty("evidence.selectedText","EXPLICIT_SELECTED_EVIDENCE");
  });
  it("authorizes target before recording a report, no fabricated success on outage",async()=>{
    const {store,service,validateTarget}=setup();
    validateTarget.mockRejectedValueOnce(new CommunicationSafetyError(503,"unavailable"));
    await expect(service.submit(actor("a"),input,"operation-00000001")).rejects.toMatchObject({status:503});
    expect(await store.transact([],tx=>tx.scan("communication-safety:report:"))).toHaveLength(0);
  });
  it("serializes concurrent retries and enforces account report limit",async()=>{
    const {service}=setup();
    const responses=await Promise.all(Array.from({length:10},()=>service.submit(actor("a"),input,"operation-00000001")));
    expect(new Set(responses.map(r=>r.reportId)).size).toBe(1);
    for(let i=2;i<=20;i++) await service.submit(actor("a"),input,`operation-${String(i).padStart(8,"0")}`);
    await expect(service.submit(actor("a"),input,"operation-99999999")).rejects.toMatchObject({status:429});
    expect(await service.submit(actor("b"),input,"operation-99999999")).toHaveProperty("reportId");
  });
  it("audits operator review and preserves revision conflicts",async()=>{
    const {service}=setup(); const receipt=await service.submit(actor("a"),input,"operation-00000001");
    await service.review(actor("moderator"),receipt.reportId,{status:"reviewing",expectedRevision:1});
    await expect(service.review(actor("moderator"),receipt.reportId,{status:"resolved",resolution:"no_action",expectedRevision:1})).rejects.toMatchObject({status:409});
    await service.review(actor("moderator"),receipt.reportId,{status:"resolved",resolution:"no_action",expectedRevision:2});
    expect(await service.queue()).toHaveLength(0);
    expect(await service.read(actor("moderator"),receipt.reportId,true)).toHaveProperty("audit.length",3);
  });
  it("does not expose unavailable account deletion as an accepted capability",()=>{
    expect(setup().service.capabilities().accountDeletion).toBe(false);
  });
  it("sends identity only server-side and maps provider outages to 503",async()=>{
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify({contractVersion:"csm-communication-safety-v1",result:false})));vi.stubGlobal("fetch",fetchMock);
    try {
      const policy=new MessagingCommunicationPolicy({baseUrl:"http://messaging.test",token:"test-service-secret",timeoutMs:100});
      expect(await policy.directAllowed("session-owner","peer")).toBe(false);
      const [url,options]=fetchMock.mock.calls[0] as unknown as [string,RequestInit];
      expect(url).toBe("http://messaging.test/api/v1/communication/direct-allowed");
      expect(options.headers).toMatchObject({"x-csm-user-id":"session-owner",authorization:"Bearer test-service-secret"});
      expect(options.body).toBe(JSON.stringify({peerId:"peer"}));
      expect(options.redirect).toBe("error");
      fetchMock.mockResolvedValueOnce(new Response("",{status:503}));
      await expect(policy.directAllowed("session-owner","peer")).rejects.toMatchObject({status:503});
    } finally {vi.unstubAllGlobals();}
  });
});

describe("communication REST boundary",()=>{
  function httpFixture(enabled = true) {
    const {service}=setup(),app=Fastify();
    registerCommunicationSafetyRoutes(app,enabled?service:undefined,r=>{
      const subject=r.headers.authorization;
      if(typeof subject!=="string") return null;
      return {...actor(subject),roles:subject==="moderator"?["cop-moderator"]:[]};
    });
    return {app,service};
  }
  it("requires an actor, prevents identity spoofing, isolates reports and limits operator access",async()=>{
    const {app}=httpFixture();
    try {
      expect((await app.inject({url:"/api/v1/me/account-safety/capabilities"})).statusCode).toBe(401);
      const a=await app.inject({method:"POST",url:"/api/v1/me/communication/reports",headers:{authorization:"a","idempotency-key":"operation-00000001"},payload:input});
      expect(a.statusCode).toBe(200);expect(a.headers["cache-control"]).toBe("no-store");
      expect((await app.inject({method:"POST",url:"/api/v1/me/communication/reports",headers:{authorization:"a","idempotency-key":"operation-00000002"},payload:{...input,reporter:"b"}})).statusCode).toBe(400);
      expect((await app.inject({url:"/api/v1/me/communication/reports/"+a.json().reportId,headers:{authorization:"b"}})).statusCode).toBe(404);
      expect((await app.inject({url:"/api/v1/moderation/communication/reports",headers:{authorization:"a"}})).statusCode).toBe(403);
      const queue=await app.inject({url:"/api/v1/moderation/communication/reports",headers:{authorization:"moderator"}});
      expect(queue.statusCode).toBe(200);expect(queue.json().items).toHaveLength(1);
      expect((await app.inject({method:"PATCH",url:"/api/v1/moderation/communication/reports/"+a.json().reportId,headers:{authorization:"moderator"},payload:{status:"resolved",expectedRevision:1}})).statusCode).toBe(400);
    } finally {await app.close();}
  });
  it("uses only the session owner for block mutations; unavailable service is 503",async()=>{
    const {app,service}=httpFixture();
    try {
      const block=await app.inject({method:"PUT",url:"/api/v1/me/communication/blocks",headers:{authorization:"a"},payload:{peerSubjectId:"peer",blocked:true}});
      expect(block.statusCode).toBe(200);expect(service.options.policy.block).toHaveBeenCalledWith("a","peer",true);
      expect((await app.inject({method:"PUT",url:"/api/v1/me/communication/blocks",headers:{authorization:"a"},payload:{peerSubjectId:"peer",blocked:true,owner:"b"}})).statusCode).toBe(400);
      vi.mocked(service.options.policy.block).mockRejectedValueOnce(new Error("private internal failure"));
      const outage=await app.inject({method:"POST",url:"/api/v1/me/communication/blocks/query",headers:{authorization:"a"},payload:{peerSubjectId:"peer"}});
      expect(outage.statusCode).toBe(503);expect(outage.body).not.toContain("private internal failure");
    } finally {await app.close();}
    const disabled=httpFixture(false);
    try {
      expect((await disabled.app.inject({url:"/api/v1/me/account-safety/capabilities",headers:{authorization:"a"}})).json()).toMatchObject({reporting:false,blocking:false,accountDeletion:false});
      expect((await disabled.app.inject({method:"PUT",url:"/api/v1/me/communication/blocks",headers:{authorization:"a"},payload:{peerSubjectId:"peer",blocked:true}})).statusCode).toBe(503);
    } finally {await disabled.app.close();}
  });
});
