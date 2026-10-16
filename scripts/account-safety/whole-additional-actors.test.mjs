import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { validateAdditionalActorReadback, verifyActualPeerAttestation, prepareAdditionalActors,
  verifyAdditionalActorsPreserved, eraseNoviceAfterPrimaryRestore, WHOLE_PHASE_LIMITS } from "./whole-additional-actors.mjs";
const manifest = () => ({ ownerLabel: "cop-erasure-whole-92f0a7d635c8", serverLocal: { contractVersion: "cop-whole-server-local-v1" },
  issuer: "https://cop-erasure-keycloak.invalid/realms/cop-erasure-whole", actors: Object.fromEntries(["a","b","c","d"].map((key,index) => [key,{subjectId:`10000000-0000-4000-8000-00000000000${index+1}`} ])),
  integration: { providerReadbacks: { messaging_matrix: { url: "http://127.0.0.1:4323/readback", token: "synthetic-readback-token-not-production-32-plus" } } } });
const empty = () => ({ matrixMappingCount: 0, communicationUsageCount: 0, matrixRemovableCount: 0, fingerprint: "a".repeat(64) });
const contact = () => ({ matrixMappingCount: 1, communicationUsageCount: 1, matrixRemovableCount: 3, fingerprint: "b".repeat(64) });
const readback = (d = empty(), c = empty()) => ({ contractVersion: "cop-whole-erasure-readback-v1", additionalActors: { c, d } });
const response = (statusCode, body = {}, headers = {}) => ({ statusCode, json: () => body, headers });
function peerRequest(f) { const now = new Date(); return { checkedAt: now.toISOString(), actorUserId: f.actors.a.subjectId, issuer: f.issuer, targetUserIds: [f.actors.d.subjectId], peerBindings: {
  contractVersion: "cop-verified-peer-bindings-v1", actorUserId: f.actors.a.subjectId, issuer: f.issuer, source: "canonical_cop_profile",
  observedAt: now.toISOString(), validUntil: new Date(now.getTime() + 30000).toISOString(), peers: [{ userId: f.actors.d.subjectId, issuer: f.issuer }] } }; }
function context(values = []) {
  const f = manifest(), calls = [];
  return { manifest: f, headersA: { authorization: "Bearer synthetic-a-not-production" }, calls,
    nativeFetch: async (url, options) => { calls.push(["readback", url, options.method]); const next = values.shift(); assert(next, "Unit fixture readback exhausted"); return new Response(JSON.stringify(next)); },
    app: { inject: async options => { calls.push(["cop", options.url]); if (options.url.endsWith("/preflight")) return response(200,{canConfirm:true,planId:"synthetic-plan"},{"x-cop-erasure-receipt-capability":"synthetic-private-capability"});
      if (options.url === "/api/v1/me/preferences") return response(200,{actor:{subjectId:f.actors.d.subjectId,issuer:f.issuer}});
      if (options.url === "/api/v1/messaging/conversations") return response(201,{conversation:{matrix:{roomId:"!synthetic:matrix.invalid"}}});
      throw Error("Unexpected unit request"); } } };
}
test("additional readback exact finite shape fails closed on missing, malformed, unknown data",()=>{
 assert.deepEqual(validateAdditionalActorReadback(readback()),{c:empty(),d:empty()});
 for(const mutate of [value=>delete value.additionalActors.c,value=>value.additionalActors.e=empty(),value=>value.additionalActors.d.matrixMappingCount=-1,
  value=>value.additionalActors.c.fingerprint="unproven",value=>value.additionalActors.c.claimedReady=true]) { const value=readback();mutate(value);assert.throws(()=>validateAdditionalActorReadback(value),/WHOLE_ADDITIONAL_READBACK/u); }
});
test("observed private outbound attestation requires actual actor, target, exact source and current 30s lifetime",()=>{
 const f=manifest();assert.match(verifyActualPeerAttestation([peerRequest(f)],f),/^[a-f0-9]{64}$/u);
 for(const mutate of [request=>request.actorUserId=f.actors.c.subjectId,request=>request.peerBindings.peers[0].issuer="https://wrong.invalid",request=>request.peerBindings.peers[0].userId=f.actors.c.subjectId,
  request=>request.peerBindings.email="unallowed",request=>request.peerBindings.validUntil=request.peerBindings.observedAt,request=>request.peerBindings.observedAt="2000-01-01T00:00:00.000Z"]) {const request=peerRequest(f);mutate(request);assert.throws(()=>verifyActualPeerAttestation([request],f),/ATTESTATION_UNPROVEN/u);}
 assert.throws(()=>verifyActualPeerAttestation([],f),/OUTBOUND_REQUEST_UNPROVEN/u);
});
test("source flow previews C without warmup, warms actual D through COP and creates first contact before main seed",async()=>{
 const c=context([readback(),readback(),readback(contact())]), logins=[];
 const result=await prepareAdditionalActors(c,{login:async actor=>{logins.push(actor.subjectId);return{access_token:"synthetic-unit-token"};},observePeerRequest:async action=>{await action();return[peerRequest(c.manifest)];}});
 assert.deepEqual(logins,[c.manifest.actors.c.subjectId,c.manifest.actors.d.subjectId]);
 assert.deepEqual(c.calls.filter(call=>call[0]==="cop").map(call=>call[1]),["/api/v1/me/account-deletion/preflight","/api/v1/me/preferences","/api/v1/messaging/conversations"]);
 assert.deepEqual(result.noviceBefore,empty());assert.deepEqual(result.preservedD,contact());assert.equal(result.firstContactViaCopVerified,true);
});
test("preprovisioned D, mutating pure preview and missing outbound proof reject acceptance",async()=>{
 for(const values of [[readback(contact())],[readback(),readback(empty(),{...empty(),communicationUsageCount:1})]]) {
  const c=context(values);await assert.rejects(()=>prepareAdditionalActors(c,{login:async()=>({access_token:"unit"}),observePeerRequest:async()=>[]}),/PREPROVISIONED|PREVIEW_MUTATED/u);
 }
 const c=context([readback(),readback()]);await assert.rejects(()=>prepareAdditionalActors(c,{login:async()=>({access_token:"unit"}),observePeerRequest:async action=>{await action();return[];}}),/OUTBOUND_REQUEST_UNPROVEN/u);
});
test("D original mapping/usage fingerprint must stay exact through the primary restore",async()=>{
 const c=context([readback({...contact(),fingerprint:"c".repeat(64)})]);
 await assert.rejects(()=>verifyAdditionalActorsPreserved(c,{contractVersion:"cop-whole-additional-actors-checkpoint-v1",preservedD:contact(),noviceBefore:empty()}),/CONTROL_D_CHANGED/u);
});
test("novice deletion cannot start before primary restore or target a historical case",async()=>{
 const c=context();await assert.rejects(()=>eraseNoviceAfterPrimaryRestore(c,{}, {primaryRestoreVerified:false}),/MUST_FOLLOW_PRIMARY_RESTORE/u);assert.deepEqual(c.calls,[]);
 c.manifest.ownerLabel="cop-erasure-whole-e70f147c5b2f";await assert.rejects(()=>prepareAdditionalActors(c,{}),/SCOPE_REJECTED/u);assert.deepEqual(c.calls,[]);
});
test("new server lease covers each explicit real voice interval without reducing phase bounds",()=>{
 assert.equal(WHOLE_PHASE_LIMITS.onlineWaitMs,70*60*1000);assert.equal(WHOLE_PHASE_LIMITS.postRestoreWaitMs,70*60*1000);
 assert.equal(WHOLE_PHASE_LIMITS.noviceWaitMs,70*60*1000);assert.equal(WHOLE_PHASE_LIMITS.operatorRestoreWaitMs,30*60*1000);
 const total=WHOLE_PHASE_LIMITS.onlineWaitMs+WHOLE_PHASE_LIMITS.postRestoreWaitMs+WHOLE_PHASE_LIMITS.noviceWaitMs+WHOLE_PHASE_LIMITS.operatorRestoreWaitMs;
 assert.equal(WHOLE_PHASE_LIMITS.serverLocalLeaseSeconds*1000-total,60*60*1000);
 const coordinator=readFileSync(new URL("../test-account-erasure-whole-joint.py",import.meta.url),"utf8");
 assert.equal(coordinator.split("(18000 if SERVER_LOCAL else 10800)").length-1,3);
 const source=readFileSync(new URL("./whole-account-erasure-probe.mjs",import.meta.url),"utf8");
 assert(source.indexOf('seeded.additional = await prepareAdditionalActors')<source.indexOf('seeded.local = await localFixture.seedCopLocalOwners'));
 assert(source.indexOf('await waitDeleted({ authorization: "Bearer " + freshA.access_token }')<source.indexOf('const noviceDeletion = await eraseNoviceAfterPrimaryRestore'));
 assert(source.includes('if (awaitedOperationId === operationId) lastReceipt = value'));
});

test("novice source waits on its own true 202 operation and keeps checkpoint private without replacing A receipt",async()=>{
 const c=context([readback(contact()),readback(contact(),{...empty(),communicationUsageCount:1,fingerprint:"c".repeat(64)})]);
 c.operationId="20000000-0000-4000-8000-000000000001";let ownOperation,checkpoint,simChecked=false,waited=false;
 c.app.inject=async options=>{if(options.url.endsWith("/preflight"))return response(200,{canConfirm:true,planId:"plan"},{"x-cop-erasure-receipt-capability":"private-capability"});
  if(options.url==="/api/v1/me/account-deletion"){ownOperation=options.headers["idempotency-key"];return response(202,{operationId:ownOperation,requestedAt:"2026-10-16T00:00:00.000Z",accountDeleted:false});}
  if(options.url==="/api/v1/me/preferences")return response(options.headers.authorization.includes(c.manifest.actors.c.subjectId)?403:200);throw Error("Unexpected unit request");};
 const result=await eraseNoviceAfterPrimaryRestore(c,{contractVersion:"cop-whole-additional-actors-checkpoint-v1",preservedD:contact(),noviceBefore:empty(),peerAttestationSha256:"a".repeat(64)},
  {primaryRestoreVerified:true,login:async actor=>({access_token:actor.subjectId}),writeCheckpoint:value=>{checkpoint=value;},phase:value=>assert.equal(value.expectedMinimumVoiceWaitSeconds,3690),
   waitDeleted:async(_headers,capability,operationId,maxWaitMs)=>{assert.equal(capability,"private-capability");assert.equal(operationId,ownOperation);assert.notEqual(operationId,c.operationId);assert.equal(maxWaitMs,4200000);waited=true;return{operationId,requestedAt:"2026-10-16T00:00:00.000Z",status:"deleted",accountDeleted:true,remaining:[]};},
   verifySimIdentity:async actor=>{assert.equal(actor.subjectId,c.manifest.actors.c.subjectId);simChecked=true;return{status:200,subjectId:actor.subjectId};},readOwnerCompletion:async(operationId,requestedAt)=>({operationId,requestedAt,completedOwners:[],journalDigest:"a".repeat(64)})});
 assert(waited&&simChecked);assert.equal(checkpoint.operationId,ownOperation);assert.equal(checkpoint.primaryOperationId,c.operationId);assert.equal(checkpoint.receiptCapability,"private-capability");
 assert.equal(result.operationId,ownOperation);assert.equal(result.actualHttpStatus,202);assert.equal(result.simUserinfo.subjectId,c.manifest.actors.c.subjectId);assert.doesNotMatch(JSON.stringify(result),/capability/u);
});
