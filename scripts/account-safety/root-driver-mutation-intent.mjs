/** Independent Root verification of the actual COP mutation request.
 * Produces necessary identity facts, NOT owner admission or a dispatch permit.
 * Raw claims/principals/daily joins remain in RAM; only opaque digests enter
 * the private five-second record. No caller-supplied SQL/client/path/verifier.
 */
import { timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { canonical, canonicalJson, exact, hex, sha256, readRootFile, readPublicVerificationKeys,
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

const PRIVATE='/run/cop-account-safety/private/owner-authority/';
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
export async function prepareRootDriverMutationIntent(peer,input){
  const p=identity(),scope=driverContextScope(input),keys=readPublicVerificationKeys();
  requireGuard(scope&&equal(scope.authorization,'Bearer '+p.serviceToken),'GUARD_MUTATION_SERVICE');
  const registration=readClientRegistration(peer,keys),scopeDigest=sha256(canonical(scope));
  const binding=Object.fromEntries(['guardStoreId','continuityEpoch','datasetBindingId','runtimeBindingId'].map(k=>[k,registration[k]]));
  if(scope.method==='DELETE'){
    verifyDriverRevocationActor(scope.actor,scope.actorSignature,p.actorSecret,p.issuer,scope.body.contributorIdDay,Date.now());
    const intentRef=await assertCopRevocationIntent(peer,scope),r=verifyRootRecord(readRootFile(PRIVATE+intentRef.recordId+'.json',{secret:true}),keys,'cop-driver-revocation-intent');
    requireGuard(r.digest===intentRef.digest&&Object.keys(binding).every(k=>r.payload[k]===binding[k])&&hex(r.payload.contributorHash),'GUARD_MUTATION_REVOCATION');
    const body={contractVersion:'sim-driver-guarded-db-v1',contributorHash:r.payload.contributorHash};
    const signed=verifyDriverRevocationActor(scope.actor,scope.actorSignature,p.actorSecret,p.issuer,scope.body.contributorIdDay,Date.now());
    const reference=record('cop-driver-mutation-intent',{...binding,peer,scopeDigest,actionKind:'revoke',identityIntentRef:intentRef,
      contributorHash:r.payload.contributorHash,consentRevokedAt:r.payload.consentRevokedAt},keys,signed.exp*1000);
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
  const originalAcceptedAt=prior?.createdAtUTC??facts.observedAtUTC;
  validateDriverErasureCoverage(prepared,Date.parse(originalAcceptedAt));
  const manifestRef=await assertCopDriverErasureManifest(peer,actor,request,originalAcceptedAt);
  const manifest=verifyRootRecord(readRootFile(PRIVATE+manifestRef.recordId+'.json',{secret:true}),keys,'cop-driver-manifest-attestation');
  requireGuard(manifest.digest===manifestRef.digest&&manifest.payload.businessOperationId===request.operationId&&
    manifest.payload.manifestDigest===sha256(canonical(request))&&manifest.payload.originalAcceptedAt===originalAcceptedAt,'GUARD_MUTATION_MANIFEST');
  requireGuard(canonical(readClientRegistration(peer,keys))===canonical(registration),'GUARD_MUTATION_REGISTRATION_CHANGED');
  const reference=record('cop-driver-mutation-intent',{...binding,peer,scopeDigest,actionKind:'erase',businessOperationId:request.operationId,
    operationHash,actorHash:prepared.actorHash,requestHash:prepared.requestHash,contributorCount:prepared.contributors.length,
    manifestRef,journalRef:manifest.payload.journalRef,originalAcceptedAt},keys,signed.exp*1000);
  // The actual held owner policy supplies checkpointHash later. Target SQL
  // booleans/fingerprints above cannot approve/adopt a checkpoint or policy.
  const body={contractVersion:'sim-driver-guarded-db-v1',operationHash,actorHash:prepared.actorHash,
    requestHash:prepared.requestHash,contributors:prepared.contributors};
  return freeze({actionKind:'erase',scopeDigest,reference,body,originalAcceptedAt});
}
