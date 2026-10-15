/** Read-only Root business-original registry. Signatures/custody/reference
 * checks are necessary historical facts, never current owner admission.
 * No writer, enroller, repair, clock tolerance or fallback is exported here.
 */
import {join} from 'node:path';
import {canonical,exact,hex,uuid,sha256,requireGuard,requireRootCodeTree,requireRootDirectory,readRootFile,
  readPublicVerificationKeys,verifyRootRecord} from './root-records.mjs';

const STATE='/var/lib/cop-account-safety';
const BASE=['contractVersion','kind','recordId','issuedAt','expiresAt'];
const BINDING=['guardStoreId','continuityEpoch','datasetBindingId','storeIncarnation'];
const BUSINESS=['operationHash','actorHash','requestHash','contributorCount','manifestDigest'];
const ref=v=>exact(v,['recordId','digest'])&&uuid(v.recordId)&&hex(v.digest);
const originRef=v=>exact(v,['operationId','permitRef'])&&uuid(v.operationId)&&ref(v.permitRef);
const stamp=v=>typeof v==='string'&&Number.isSafeInteger(Date.parse(v))&&new Date(v).toISOString()===v;
const same=(actual,expected,fields)=>fields.every(k=>canonical(actual[k])===canonical(expected[k]));
const freeze=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;};
export function driverBusinessOriginalKey(binding,request){
  requireGuard(exact(binding,BINDING)&&BINDING.every(k=>uuid(binding[k]))&&exact(request,BUSINESS)&&
    BUSINESS.filter(k=>k!=='contributorCount').every(k=>hex(request[k]))&&Number.isSafeInteger(request.contributorCount)&&
    request.contributorCount>=9&&request.contributorCount<=40,'GUARD_BUSINESS_ORIGINAL_REQUEST');
  // Immutable actor+business key, NOT requestHash: changing a request cannot
  // evade the original by selecting another filename.
  return sha256(canonical({...binding,operationHash:request.operationHash,actorHash:request.actorHash}));
}
function permit(read,keys,reference,binding){
  requireGuard(originRef(reference),'GUARD_BUSINESS_ORIGIN_REF');
  const r=verifyRootRecord(read(join(STATE,'operations',reference.operationId+'.json')),keys,'driver-origin-permit',{historical:true});
  const p=r.payload,op=p.operation;
  requireGuard(exact(p,[...BASE,'operation','guardStoreId','continuityEpoch','datasetBindingId','runtimeBindingId','sourceProofId',
    'policyGeneration','frontierSequence','frontierDigest','evidence'])&&
    exact(op,['contractVersion','operationId','storeIncarnation','permitId','kind','bodyDigest','schemaDigest','cutoff'])&&
    op.contractVersion==='cop-driver-origin-v1'&&uuid(p.runtimeBindingId)&&uuid(p.sourceProofId)&&
    Number.isSafeInteger(p.policyGeneration)&&p.policyGeneration>=1&&Number.isSafeInteger(p.frontierSequence)&&p.frontierSequence>=0&&hex(p.frontierDigest)&&
    exact(p.evidence,['identity-ownership','retention-decision','report-protection','operation-schema'])&&Object.values(p.evidence).every(ref)&&
    r.digest===reference.permitRef.digest&&p.recordId===reference.permitRef.recordId&&op?.operationId===reference.operationId&&
    op.permitId===p.recordId&&op.kind==='erase'&&op.cutoff===null&&hex(op.bodyDigest)&&hex(op.schemaDigest)&&
    same(p,binding,BINDING.filter(k=>k!=='storeIncarnation'))&&op.storeIncarnation===binding.storeIncarnation,'GUARD_BUSINESS_ORIGIN_BINDING');
  return r;
}
/** Pure signature/reference validation for focused tests. Supplied bytes/keys
 * prove no current authority. The production reader below selects all paths. */
export function validateDriverBusinessAnchor(bytes,keys,binding,request,permitBytes){
  driverBusinessOriginalKey(binding,request);
  const r=verifyRootRecord(bytes,keys,'driver-business-anchor',{historical:true}),p=r.payload;
  requireGuard(exact(p,[...BASE,...BINDING,...BUSINESS,'originalAcceptedAtUTC','initialOriginRef','initialBodyDigest','checkpointHash','baseBodyCanonicalDigest'])&&
    same(p,binding,BINDING)&&same(p,request,BUSINESS)&&stamp(p.originalAcceptedAtUTC)&&Date.parse(p.originalAcceptedAtUTC)<=Date.parse(p.issuedAt)&&
    originRef(p.initialOriginRef)&&hex(p.initialBodyDigest)&&hex(p.checkpointHash)&&hex(p.baseBodyCanonicalDigest),'GUARD_BUSINESS_ANCHOR_BINDING');
  const original=permit(()=>permitBytes,keys,p.initialOriginRef,binding);
  requireGuard(original.payload.operation.bodyDigest===p.initialBodyDigest,'GUARD_BUSINESS_ANCHOR_BODY');
  return freeze({reference:{recordId:p.recordId,digest:r.digest},originalAcceptedAtUTC:p.originalAcceptedAtUTC,
    initialOriginRef:p.initialOriginRef,initialBodyDigest:p.initialBodyDigest,checkpointHash:p.checkpointHash,baseBodyCanonicalDigest:p.baseBodyCanonicalDigest});
}
/** Fixed private filesystem only. Absence before first acceptance is explicit;
 * a bad/foreign/partial record always fails closed, never becomes absence. */
export function readDriverBusinessOriginal(binding,request){
  requireGuard(process.getuid?.()===0&&process.geteuid?.()===0,'ROOT_EXECUTION_REQUIRED');requireRootCodeTree('/opt/cop-account-safety');
  for(const directory of ['business-anchors','business-ledger-bindings'])requireRootDirectory(join(STATE,directory),{secret:true});
  const key=driverBusinessOriginalKey(binding,request),keys=readPublicVerificationKeys();
  const read=path=>readRootFile(path,{secret:true});
  let bytes;
  try{bytes=read(join(STATE,'business-anchors',key+'.json'));}
  catch(error){if(error.code==='ENOENT')return;throw error;}
  const envelope=verifyRootRecord(bytes,keys,'driver-business-anchor',{historical:true});
  requireGuard(originRef(envelope.payload.initialOriginRef),'GUARD_BUSINESS_ORIGIN_REF');
  const anchor=validateDriverBusinessAnchor(bytes,keys,binding,request,
    read(join(STATE,'operations',envelope.payload.initialOriginRef.operationId+'.json')));
  let ledgerBytes;
  try{ledgerBytes=read(join(STATE,'business-ledger-bindings',key+'.json'));}
  catch(error){if(error.code==='ENOENT'){
    requireGuard(canonical(readPublicVerificationKeys())===canonical(keys),'GUARD_KEYRING_CHANGED');return anchor;
  }throw error;}
  const ledger=verifyRootRecord(ledgerBytes,keys,'driver-business-ledger-binding',{historical:true}),p=ledger.payload;
  requireGuard(exact(p,[...BASE,...BINDING,...BUSINESS,'anchorRef','committedOriginRef','baseBodyDigest','ledgerCreatedAtUTC',
    'observedLedgerDigest','observedAtUTC','sqlOutcomeRef','effectQuiescenceRef'])&&same(p,binding,BINDING)&&same(p,request,BUSINESS)&&
    ref(p.anchorRef)&&canonical(p.anchorRef)===canonical(anchor.reference)&&originRef(p.committedOriginRef)&&hex(p.baseBodyDigest)&&
    stamp(p.ledgerCreatedAtUTC)&&stamp(p.observedAtUTC)&&Date.parse(p.ledgerCreatedAtUTC)<=Date.parse(p.observedAtUTC)&&
    Date.parse(p.observedAtUTC)<=Date.parse(p.issuedAt)&&hex(p.observedLedgerDigest)&&ref(p.sqlOutcomeRef)&&ref(p.effectQuiescenceRef)&&
    p.sqlOutcomeRef.recordId!==p.effectQuiescenceRef.recordId,'GUARD_BUSINESS_LEDGER_BINDING');
  const original=permit(read,keys,p.committedOriginRef,binding),op=original.payload.operation;
  requireGuard(op.bodyDigest===p.baseBodyDigest,'GUARD_BUSINESS_LEDGER_BODY');
  for(const [field,kind]of [['sqlOutcomeRef','driver-sql-outcome'],['effectQuiescenceRef','driver-effect-quiescence']]){
    const r=verifyRootRecord(read(join(STATE,'outcomes',p[field].recordId+'.json')),keys,kind,{historical:true}),v=r.payload;
    requireGuard(exact(v,[...BASE,'originId','originalPermitId','originalPermitDigest','storeIncarnation','bodyDigest','schemaDigest','originKind','originState'])&&
      r.digest===p[field].digest&&v.recordId===p[field].recordId&&v.originId===op.operationId&&v.originKind==='erase'&&
      v.originState==='origin-commit-known'&&v.originalPermitId===op.permitId&&v.originalPermitDigest===original.digest&&
      v.storeIncarnation===binding.storeIncarnation&&v.bodyDigest===op.bodyDigest&&v.schemaDigest===op.schemaDigest,'GUARD_BUSINESS_LEDGER_OUTCOME');
  }
  requireGuard(canonical(readPublicVerificationKeys())===canonical(keys),'GUARD_KEYRING_CHANGED');
  return freeze({...anchor,ledgerBindingRef:{recordId:p.recordId,digest:ledger.digest},ledgerCreatedAtUTC:p.ledgerCreatedAtUTC,
    committedOriginRef:p.committedOriginRef,baseBodyDigest:p.baseBodyDigest,observedLedgerDigest:p.observedLedgerDigest});
}
