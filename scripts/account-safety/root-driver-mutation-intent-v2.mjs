/** Explicit v2 necessary identity preparation with historical Root anchor.
 * The v1 file and its receipts remain unchanged. This is NOT owner admission.
 * Produces necessary identity facts, NOT owner admission or a dispatch permit.
 * Raw claims/principals/daily joins remain in RAM; only opaque digests enter
 * the private five-second record. No caller-supplied SQL/client/path/verifier.
 */
import { timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { canonical, canonicalJson, exact, hex, uuid, sha256, readRootFile, readPublicVerificationKeys,
  requireGuard, requireRootCodeTree, verifyRootRecord } from './root-records.mjs';
import { issueRootRecord, storeRootRecord } from './root-record-issuer.mjs';
import { connectionProfile } from './root-driver-runtime.mjs';
import { driverContextScope } from './driver-root-context.mjs';
import { readClientRegistration } from './driver-root-channel.mjs';
import { assertCopDriverErasureManifest, assertCopRevocationIntent } from './root-cop-actor.mjs';
import { parseDriverErasureRequest, verifyDriverErasureActor, prepareDriverErasureInput,
  driverErasureHash, validateDriverErasureCoverage } from './driver-account-erasure.js';
import { validateDriverReadFacts } from './read-admission-facts.mjs';
import { verifyDriverRevocationActor } from './driver-revocation-actor.js';
import { mutationIntentDeadline } from './mutation-intent-deadline.mjs';
import { readDriverBusinessOriginal } from './root-driver-business-original.mjs';

const PRIVATE='/run/cop-account-safety/private/owner-authority/';
const BASE=['contractVersion','kind','recordId','issuedAt','expiresAt'];
const BINDING=['guardStoreId','continuityEpoch','datasetBindingId','runtimeBindingId','peer','scopeDigest','actionKind'];
const ERASE=['businessOperationId','operationHash','actorHash','requestHash','contributorCount','manifestRef','journalRef','originalAcceptedAt',
  'manifestDigest','bodyCanonicalDigest','originalAnchorRef'];
const REVOKE=['identityIntentRef','contributorHash','consentRevokedAt','bodyCanonicalDigest'];
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
function identity(){
  requireGuard(process.getuid?.()===0&&process.geteuid?.()===0,'ROOT_EXECUTION_REQUIRED');requireRootCodeTree('/opt/cop-account-safety');
  const p=canonicalJson(readRootFile('/etc/cop-account-safety/root/driver-identity.json',{secret:true}));
  requireGuard(exact(p,['contractVersion','serviceToken','actorSecret','issuer','hashSecret'])&&p.contractVersion==='cop-root-driver-identity-v1'&&
    ['serviceToken','actorSecret','hashSecret'].every(k=>typeof p[k]==='string'&&p[k].length>=32&&Buffer.byteLength(p[k])<=4096&&!/[\u0000-\u001f\u007f-\u009f]/u.test(p[k]))&&
    typeof p.issuer==='string'&&p.issuer.startsWith('https://')&&Buffer.byteLength(p.issuer)<=2048,'GUARD_DRIVER_IDENTITY_PROFILE');return p;
}
async function factsFor(request){
  const {Client}=createRequire('/opt/cop-account-safety/package.json')('pg');
  const client=new Client(connectionProfile('driver-control','sim_driver_measurements','sim_driver_guard_control'));
  let ended=false,closing=false,failed=false;
  client.on('error',()=>{failed=true;});client.on('end',()=>{ended=true;if(!closing)failed=true;});
  try{
    await client.connect();await client.query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
    const result=await client.query('SELECT sim_driver_guard_source.read_admission_facts($1::jsonb) AS value',[JSON.stringify(request)]);
    requireGuard(result.rows.length===1,'GUARD_MUTATION_FACTS');
    const facts=validateDriverReadFacts(result.rows[0].value,request);
    requireGuard(Date.parse(facts.observedAtUTC)<=Date.now()&&Date.now()-Date.parse(facts.observedAtUTC)<=5000,'GUARD_MUTATION_FACTS_STALE');
    await client.query('COMMIT');return facts;
  }finally{
    closing=true;let timer;
    try{await Promise.race([client.end(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('GUARD_MUTATION_INTENT_END_UNKNOWN')),15000);})]);
      requireGuard(ended&&!failed,'GUARD_MUTATION_INTENT_END_UNKNOWN');}
    catch{throw new Error('GUARD_MUTATION_INTENT_END_UNKNOWN');}finally{clearTimeout(timer);}
  }
}
function record(kind,facts,keys,claimExpiryMs){
  requireGuard(canonical(readPublicVerificationKeys())===canonical(keys),'GUARD_KEYRING_CHANGED');
  // Absolute claim expiry survives key/signature I/O delays. The margin is
  // availability only; the actual signed timestamps below are decisive.
  const lifetimeMs=Math.min(5000,claimExpiryMs-Date.now()-100);
  requireGuard(Number.isSafeInteger(lifetimeMs)&&lifetimeMs>0&&lifetimeMs<=5000,'GUARD_MUTATION_INTENT_EXPIRED');
  const r=issueRootRecord(kind,facts,{lifetimeMs,expectedKeyringDigest:sha256(canonical(keys)+'\n')});
  mutationIntentDeadline(r.payload,claimExpiryMs,Date.now());
  storeRootRecord(PRIVATE+r.payload.recordId+'.json',r.bytes);return Object.freeze({recordId:r.payload.recordId,digest:r.digest});
}
function freeze(v){if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;}
/** Root caller must subsequently bind this intent to the actual held common
 * WeakMap context. The returned transient body is never a public/native reply. */
export async function prepareRootDriverMutationIntentV2(peer,input,previousIntentRef){
  const p=identity(),scope=driverContextScope(input),keys=readPublicVerificationKeys();
  requireGuard(scope&&equal(scope.authorization,'Bearer '+p.serviceToken),'GUARD_MUTATION_SERVICE');
  const registration=readClientRegistration(peer,keys),scopeDigest=sha256(canonical(scope));
  const binding=Object.fromEntries(['guardStoreId','continuityEpoch','datasetBindingId','runtimeBindingId'].map(k=>[k,registration[k]]));
  let previous;
  if(previousIntentRef!==undefined){
    requireGuard(exact(previousIntentRef,['recordId','digest'])&&uuid(previousIntentRef.recordId)&&hex(previousIntentRef.digest),'GUARD_MUTATION_PREVIOUS_REF');
    previous=verifyRootRecord(readRootFile(PRIVATE+previousIntentRef.recordId+'.json',{secret:true}),keys,'cop-driver-mutation-intent-v2');
    requireGuard(exact(previous.payload,[...BASE,...BINDING,...(scope.method==='DELETE'?REVOKE:ERASE)])&&
      previous.payload.actionKind===(scope.method==='DELETE'?'revoke':'erase')&&previous.digest===previousIntentRef.digest&&
      previous.payload.scopeDigest===scopeDigest&&canonical(previous.payload.peer)===canonical(peer)&&
      Object.keys(binding).every(k=>previous.payload[k]===binding[k])&&Date.parse(previous.payload.expiresAt)-Date.parse(previous.payload.issuedAt)<=5000,
      'GUARD_MUTATION_PREVIOUS_BINDING');
  }
  const deadline=claimExpiry=>Math.min(claimExpiry,previous?Date.parse(previous.payload.expiresAt):claimExpiry);
  if(scope.method==='DELETE'){
    verifyDriverRevocationActor(scope.actor,scope.actorSignature,p.actorSecret,p.issuer,scope.body.contributorIdDay,Date.now());
    const intentRef=await assertCopRevocationIntent(peer,scope),r=verifyRootRecord(readRootFile(PRIVATE+intentRef.recordId+'.json',{secret:true}),keys,'cop-driver-revocation-intent');
    requireGuard(r.digest===intentRef.digest&&Object.keys(binding).every(k=>r.payload[k]===binding[k])&&hex(r.payload.contributorHash),'GUARD_MUTATION_REVOCATION');
    const body={contractVersion:'sim-driver-guarded-db-v1',contributorHash:r.payload.contributorHash};
    requireGuard(!previous||previous.payload.bodyCanonicalDigest===sha256(canonical(body))&&
      previous.payload.consentRevokedAt===r.payload.consentRevokedAt,'GUARD_MUTATION_PREVIOUS_BODY');
    const signed=verifyDriverRevocationActor(scope.actor,scope.actorSignature,p.actorSecret,p.issuer,scope.body.contributorIdDay,Date.now());
    const reference=record('cop-driver-mutation-intent-v2',{...binding,peer,scopeDigest,actionKind:'revoke',identityIntentRef:intentRef,
      contributorHash:r.payload.contributorHash,consentRevokedAt:r.payload.consentRevokedAt,bodyCanonicalDigest:sha256(canonical(body))},keys,deadline(signed.exp*1000));
    return freeze({actionKind:'revoke',scopeDigest,reference,body});
  }
  const request=parseDriverErasureRequest(scope.body);
  requireGuard(canonical(request)===canonical(scope.body),'GUARD_MUTATION_CANONICAL_REQUEST');
  const signed=verifyDriverErasureActor(scope.actor,scope.actorSignature,p.actorSecret,p.issuer,request.operationId,Date.now());
  const actor={iss:signed.iss,sub:signed.sub,operationId:signed.operationId,routerUserId:signed.routerUserId};
  const prepared=prepareDriverErasureInput(request,signed,p.hashSecret);
  const operationHash=driverErasureHash(p.hashSecret,'cop:account-erasure-operation',request.operationId);
  const readRequest={owner:'sim_driver_measurements',scope:'online_driver_scope',purpose:'preflight',operationHash,actorHash:prepared.actorHash};
  const facts=await factsFor(readRequest),prior=facts.operation;
  requireGuard(prior===null||prior.requestHash===prepared.requestHash&&prior.contributorCount===prepared.contributors.length,'GUARD_MUTATION_REQUEST_CONFLICT');
  const manifestDigest=sha256(canonical(request));
  const business={operationHash,actorHash:prepared.actorHash,requestHash:prepared.requestHash,contributorCount:prepared.contributors.length,manifestDigest};
  const original=readDriverBusinessOriginal({guardStoreId:binding.guardStoreId,continuityEpoch:binding.continuityEpoch,
    datasetBindingId:binding.datasetBindingId,storeIncarnation:facts.storeIncarnation},business);
  const originalAcceptedAt=original?.originalAcceptedAtUTC??prior?.createdAtUTC??facts.observedAtUTC;
  requireGuard(!previous||previous.payload.actionKind==='erase'&&previous.payload.originalAcceptedAt===originalAcceptedAt&&
    previous.payload.manifestDigest===manifestDigest,'GUARD_MUTATION_PREVIOUS_ANCHOR');
  if(original?.ledgerBindingRef)requireGuard(prior!==null&&prior.createdAtUTC===original.ledgerCreatedAtUTC,'GUARD_MUTATION_LEDGER_CREATED_AT');
  validateDriverErasureCoverage(prepared,Date.parse(originalAcceptedAt));
  const manifestRef=await assertCopDriverErasureManifest(peer,actor,request,originalAcceptedAt);
  const manifest=verifyRootRecord(readRootFile(PRIVATE+manifestRef.recordId+'.json',{secret:true}),keys,'cop-driver-manifest-attestation');
  requireGuard(manifest.digest===manifestRef.digest&&manifest.payload.businessOperationId===request.operationId&&
    manifest.payload.manifestDigest===sha256(canonical(request))&&manifest.payload.originalAcceptedAt===originalAcceptedAt,'GUARD_MUTATION_MANIFEST');
  requireGuard(canonical(readClientRegistration(peer,keys))===canonical(registration),'GUARD_MUTATION_REGISTRATION_CHANGED');
  const body={contractVersion:'sim-driver-guarded-db-v1',operationHash,actorHash:prepared.actorHash,
    requestHash:prepared.requestHash,contributors:prepared.contributors};
  requireGuard(!previous||previous.payload.bodyCanonicalDigest===sha256(canonical(body)),'GUARD_MUTATION_PREVIOUS_BODY');
  const reference=record('cop-driver-mutation-intent-v2',{...binding,peer,scopeDigest,actionKind:'erase',businessOperationId:request.operationId,
    operationHash,actorHash:prepared.actorHash,requestHash:prepared.requestHash,contributorCount:prepared.contributors.length,
    manifestRef,journalRef:manifest.payload.journalRef,originalAcceptedAt,manifestDigest,bodyCanonicalDigest:sha256(canonical(body)),
    originalAnchorRef:original?.reference??null},keys,deadline(signed.exp*1000));
  return freeze({actionKind:'erase',scopeDigest,reference,body,originalAcceptedAt,business,original:original??null});
}
