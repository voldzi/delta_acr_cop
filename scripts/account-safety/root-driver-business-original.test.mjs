/** Pure actual-crypto history checks. Synthetic trusted key/records; no Root
 * filesystem, live registry, SQL, current-owner or production acceptance. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {canonical,sha256} from './root-records.mjs';
import {driverBusinessOriginalKey,validateDriverBusinessAnchor,validateDriverBusinessLedger} from './root-driver-business-original.mjs';
const pair=generateKeyPairSync('ed25519'),pub=pair.publicKey.export({format:'jwk'});
const keys={contractVersion:'cop-root-verification-keys-v1',keys:[{kid:'synthetic-business-test',kty:'OKP',crv:'Ed25519',x:pub.x}]};
const ref=()=>({recordId:randomUUID(),digest:'a'.repeat(64)});
const binding={guardStoreId:randomUUID(),continuityEpoch:randomUUID(),datasetBindingId:randomUUID(),storeIncarnation:randomUUID()};
const request={operationHash:'1'.repeat(64),actorHash:'2'.repeat(64),requestHash:'3'.repeat(64),contributorCount:9,manifestDigest:'4'.repeat(64)};
function record(kind,facts){
  const now=Date.now(),payload={contractVersion:'cop-root-record-v1',kind,recordId:randomUUID(),issuedAt:new Date(now).toISOString(),
    expiresAt:new Date(now+300000).toISOString(),...facts};
  const bytes=Buffer.from(canonical({keyId:keys.keys[0].kid,payload,signature:sign(null,Buffer.from(canonical(payload)),pair.privateKey).toString('base64url')})+'\n');
  return {payload,bytes,digest:sha256(bytes)};
}
function setup(){
  const operationId=randomUUID(),permitId=randomUUID();
  const permitFacts={operation:{contractVersion:'cop-driver-origin-v1',operationId,storeIncarnation:binding.storeIncarnation,permitId,kind:'erase',bodyDigest:'5'.repeat(64),schemaDigest:'6'.repeat(64),cutoff:null},
    ...Object.fromEntries(Object.entries(binding).filter(([k])=>k!=='storeIncarnation')),runtimeBindingId:randomUUID(),sourceProofId:randomUUID(),policyGeneration:1,frontierSequence:2,frontierDigest:'7'.repeat(64),
    evidence:Object.fromEntries(['identity-ownership','retention-decision','report-protection','operation-schema'].map(k=>[k,ref()]))};
  const permit=record('driver-origin-permit',{...permitFacts,recordId:permitId});
  const anchorFacts={...binding,...request,originalAcceptedAtUTC:new Date(Date.now()-1000).toISOString(),
    initialOriginRef:{operationId,permitRef:{recordId:permitId,digest:permit.digest}},initialBodyDigest:permitFacts.operation.bodyDigest,
    checkpointHash:'8'.repeat(64),baseBodyCanonicalDigest:'9'.repeat(64)};
  return {permit,permitFacts,anchorFacts,anchor:record('driver-business-anchor',anchorFacts)};
}
test('actual signatures bind immutable actor business anchor and original permit',()=>{
  const s=setup(),r=validateDriverBusinessAnchor(s.anchor.bytes,keys,binding,request,s.permit.bytes);
  assert.equal(r.reference.digest,s.anchor.digest);assert.equal(r.originalAcceptedAtUTC,s.anchorFacts.originalAcceptedAtUTC);assert.equal(Object.isFrozen(r.initialOriginRef),true);
});
test('request changes cannot evade the original by selecting a new file key',()=>{
  assert.equal(driverBusinessOriginalKey(binding,request),driverBusinessOriginalKey(binding,{...request,requestHash:'f'.repeat(64)}));
  assert.notEqual(driverBusinessOriginalKey(binding,request),driverBusinessOriginalKey(binding,{...request,actorHash:'f'.repeat(64)}));
});
test('foreign actor request manifest count and dataset fail exact matching',()=>{
  const s=setup();
  for(const extra of [{actorHash:'f'.repeat(64)},{requestHash:'f'.repeat(64)},{manifestDigest:'f'.repeat(64)},{contributorCount:10}])
    assert.throws(()=>validateDriverBusinessAnchor(s.anchor.bytes,keys,binding,{...request,...extra},s.permit.bytes));
  assert.throws(()=>validateDriverBusinessAnchor(s.anchor.bytes,keys,{...binding,datasetBindingId:randomUUID()},request,s.permit.bytes));
});
test('a valid signature alone cannot approve wrong original kind or body',()=>{
  const s=setup();
  for(const extra of [{kind:'expire'},{bodyDigest:'f'.repeat(64)}]){
    const permit=record('driver-origin-permit',{...s.permitFacts,recordId:s.permit.payload.recordId,operation:{...s.permitFacts.operation,...extra}});
    const anchor=record('driver-business-anchor',{...s.anchorFacts,initialOriginRef:{...s.anchorFacts.initialOriginRef,permitRef:{recordId:permit.payload.recordId,digest:permit.digest}}});
    assert.throws(()=>validateDriverBusinessAnchor(anchor.bytes,keys,binding,request,permit.bytes));
  }
});
test('missing evidence extra anchor fields and impossible original time deny',()=>{
  const s=setup();
  for(const extra of [{freeContext:'forbidden'},{originalAcceptedAtUTC:new Date(Date.now()+60000).toISOString()},{initialBodyDigest:'not-a-digest'}]){
    const anchor=record('driver-business-anchor',{...s.anchorFacts,...extra});assert.throws(()=>validateDriverBusinessAnchor(anchor.bytes,keys,binding,request,s.permit.bytes));
  }
  const permit=record('driver-origin-permit',{...s.permitFacts,recordId:s.permit.payload.recordId,evidence:{}});
  const anchor=record('driver-business-anchor',{...s.anchorFacts,initialOriginRef:{...s.anchorFacts.initialOriginRef,permitRef:{recordId:permit.payload.recordId,digest:permit.digest}}});
  assert.throws(()=>validateDriverBusinessAnchor(anchor.bytes,keys,binding,request,permit.bytes));
});
test('tampered bytes and mismatched original reference never validate',()=>{
  const s=setup();assert.throws(()=>validateDriverBusinessAnchor(Buffer.from(s.anchor.bytes.toString().replace(request.actorHash,'f'.repeat(64))),keys,binding,request,s.permit.bytes));
  const other=setup();assert.throws(()=>validateDriverBusinessAnchor(s.anchor.bytes,keys,binding,request,other.permit.bytes));
});
function ledger(s,committed=s.permit,changes={}){
  const op=committed.payload.operation,facts={originId:op.operationId,originalPermitId:op.permitId,originalPermitDigest:committed.digest,
    storeIncarnation:op.storeIncarnation,bodyDigest:op.bodyDigest,schemaDigest:op.schemaDigest,originKind:'erase',originState:'origin-commit-known'};
  const sql=record('driver-sql-outcome',facts),end=record('driver-effect-quiescence',facts);
  const p={...binding,...request,anchorRef:{recordId:s.anchor.payload.recordId,digest:s.anchor.digest},
    committedOriginRef:{operationId:op.operationId,permitRef:{recordId:op.permitId,digest:committed.digest}},baseBodyDigest:op.bodyDigest,
    ledgerCreatedAtUTC:new Date(Date.now()-500).toISOString(),observedLedgerDigest:'b'.repeat(64),observedAtUTC:new Date().toISOString(),
    sqlOutcomeRef:{recordId:sql.payload.recordId,digest:sql.digest},effectQuiescenceRef:{recordId:end.payload.recordId,digest:end.digest},...changes};
  return {anchor:s.anchor.bytes,initialPermit:s.permit.bytes,ledger:record('driver-business-ledger-binding',p).bytes,
    committedPermit:committed.bytes,sqlOutcome:sql.bytes,effectQuiescence:end.bytes};
}
test('signed ledger binding preserves original anchor while pinning exact committed body',()=>{
  const s=setup(),v=validateDriverBusinessLedger(ledger(s),keys,binding,request);
  assert.equal(v.reference.digest,s.anchor.digest);assert.equal(v.baseBodyDigest,s.anchorFacts.initialBodyDigest);
  assert.notEqual(v.ledgerCreatedAtUTC,v.originalAcceptedAtUTC);
});
test('another valid signed ERASE body in the same store cannot bind the original anchor',()=>{
  const s=setup(),operationId=randomUUID(),permitId=randomUUID();
  const other=record('driver-origin-permit',{...s.permitFacts,recordId:permitId,
    operation:{...s.permitFacts.operation,operationId,permitId,bodyDigest:'f'.repeat(64)}});
  assert.throws(()=>validateDriverBusinessLedger(ledger(s,other),keys,binding,request),{message:'GUARD_BUSINESS_LEDGER_BODY'});
});
test('foreign anchor and unknown commit or quiescence evidence cannot validate a ledger binding',()=>{
  const s=setup(),other=setup();
  assert.throws(()=>validateDriverBusinessLedger(ledger(s,s.permit,{anchorRef:{recordId:other.anchor.payload.recordId,digest:other.anchor.digest}}),keys,binding,request));
  const bundle=ledger(s),known=JSON.parse(bundle.sqlOutcome.toString()).payload;
  const bad=record('driver-sql-outcome',{...known,originState:'origin-no-effects-closed'});
  const p=JSON.parse(bundle.ledger.toString()).payload;
  const changed=record('driver-business-ledger-binding',{...p,sqlOutcomeRef:{recordId:bad.payload.recordId,digest:bad.digest}});
  assert.throws(()=>validateDriverBusinessLedger({...bundle,ledger:changed.bytes,sqlOutcome:bad.bytes},keys,binding,request));
});
