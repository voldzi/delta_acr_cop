/** Root-owned retention ORIGINAL producer. No caller-selected cutoff/UUID,
 * authority callback, environment acceptance flag or direct business DELETE.
 * This component is not an installer/enroller or whole-account owner. */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { canonical, exact, uuid, hex, sha256, requireGuard, requireRootCodeTree, requireRootDirectory,
  readRootFile, readPublicVerificationKeys, verifyRootRecord } from './root-records.mjs';
import { issueRootRecord, storeRootRecord } from './root-record-issuer.mjs';
import { connectionProfile, RootDriverAuthority } from './root-driver-runtime.mjs';
import { DriverOriginProducer, RootDispatchFiles } from './driver-origin-producer.mjs';
import { decodeRetentionRequest } from './driver-root-retention.mjs';

const STATE='/var/lib/cop-account-safety',OWNER='sim_driver_measurements';
const ACTIVE=STATE+'/maintenance-active/driver.json';
const SCHEMA='e3513a983a3b6d1bd52d46851c734dd1c3b208e2e2f6430a6f9eddd38b10d3b5';
const BINDING=['guardStoreId','continuityEpoch','datasetBindingId','runtimeBindingId'];
const BODY=canonical({contractVersion:'sim-driver-guarded-db-v1'});
const DECISIONS={'identity-ownership':'cop-jizda-owned','retention-decision':'remove-expired-entire-cop-namespace',
  'report-protection':'unprotected-entire-cop-namespace','operation-schema':'exact-guarded-plan-verified'};
const shared=(ctx,p)=>['guardStoreId','continuityEpoch','datasetBindingId','storeIncarnation'].every(k=>p[k]===ctx[k]);
function sign(ctx,kind,facts,options={}) {
  requireGuard(canonical(readPublicVerificationKeys())===canonical(ctx.keys),'GUARD_KEYRING_CHANGED');
  return issueRootRecord(kind,facts,{lifetimeMs:300000,expectedKeyringDigest:sha256(canonical(ctx.keys)+'\n'),...options});
}
function previous(ctx) {
  let bytes;try{bytes=readRootFile(ACTIVE,{secret:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
  const r=verifyRootRecord(bytes,ctx.keys,'driver-retention-active',{historical:true}),p=r.payload;
  requireGuard(exact(p,['contractVersion','kind','recordId','issuedAt','expiresAt','owner',...BINDING,'storeIncarnation','operation','originalPermitRef'])&&
    p.owner===OWNER&&shared(ctx,p)&&exact(p.operation,['operationId','kind'])&&uuid(p.operation.operationId)&&p.operation.kind==='expire'&&
    exact(p.originalPermitRef,['recordId','digest'])&&uuid(p.originalPermitRef.recordId)&&hex(p.originalPermitRef.digest),'GUARD_RETENTION_ACTIVE');
  return p;
}
/** Every real client is closed and its END observed while the actual common
 * lease remains held. Unknown query/END retains HOLD; no error can advance an
 * active original. This callback is private Root control flow, not a verifier. */
async function controlWork(common,ctx,work) {
  const {Client}=createRequire('/opt/cop-account-safety/package.json')('pg'),states=[];
  let failed=false;
  const hold=()=>{failed=true;common.holdOwnerLease(ctx);};
  const end=async state=>{
    if(state.ended)return;state.ending=true;let timer;
    try{await Promise.race([state.client.end(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('GUARD_RETENTION_END_UNKNOWN')),15000);})]);
      requireGuard(state.ended,'GUARD_RETENTION_END_UNKNOWN');}
    catch{hold();throw new Error('GUARD_RETENTION_END_UNKNOWN');}finally{clearTimeout(timer);}
  };
  try{
    for(const profile of [['registry-probe','cop_account_safety_guard','cop_guard_root_reader'],['driver-control','sim_driver_measurements','sim_driver_guard_control']]){
      const client=new Client(connectionProfile(...profile)),state={client,ended:false,ending:false};states.push(state);
      client.on('error',hold);client.on('end',()=>{state.ended=true;if(!state.ending)hold();});await client.connect();
    }
    const query=(index,text,args)=>states[index].client.query(text,args).catch(error=>{hold();throw error;});
    await query(0,'BEGIN READ ONLY');
    const result=await work({metadata:{query:(text,args)=>query(0,text,args)},control:{query:(text,args)=>query(1,text,args)}});
    await query(0,'ROLLBACK');
    const closed=await Promise.allSettled(states.map(end));requireGuard(closed.every(r=>r.status==='fulfilled')&&!failed,'GUARD_RETENTION_SQL_UNSETTLED');
    await ctx.assertCurrent();return result;
  }finally{await Promise.allSettled(states.filter(s=>!s.ended).map(end));}
}
async function chooseOriginal(common,ctx) {
  requireGuard(ctx.owner===OWNER&&ctx.purpose==='retention'&&ctx.rootPolicy.reportProtection==='no_report','GUARD_RETENTION_POLICY');
  requireRootDirectory(STATE+'/maintenance-active',{secret:true});
  for(const name of ['operations','evidence','dispatches'])requireRootDirectory(STATE+'/'+name,{secret:true});
  const active=previous(ctx);
  return controlWork(common,ctx,async({metadata,control})=>{
    const digest=(await control.query("SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') AS value",[BODY])).rows[0]?.value;
    requireGuard(hex(digest),'GUARD_RETENTION_BODY_DIGEST');
    if(active){
      const authority=new RootDriverAuthority(metadata,active.operation.operationId),op=authority.operation,p=authority.permit;
      requireGuard(op.kind==='expire'&&op.schemaDigest===SCHEMA&&op.bodyDigest===digest&&shared(ctx,{...p,storeIncarnation:op.storeIncarnation})&&
        authority.permitRecord.digest===active.originalPermitRef.digest&&p.recordId===active.originalPermitRef.recordId,'GUARD_RETENTION_ORIGINAL');
      await authority.validate(op,'probe');
      let current=false;
      if(p.runtimeBindingId===ctx.runtimeBindingId&&p.policyGeneration===ctx.policyGeneration&&p.frontierSequence===ctx.frontierSequence&&p.frontierDigest===ctx.frontierDigest){
        try{await authority.validate(op,'work');current=true;}catch(error){if(!['GUARD_ORIGIN_NOT_CURRENT','GUARD_RECORD_EXPIRED'].includes(error.code))throw error;}
      }
      if(current)return {operation:op,originalPermitRef:active.originalPermitRef};
      // Only the immutable historical original is reconciled. The actual
      // dispatcher registers its exact tuple and obtains two committed reads;
      // this path never claims an executor or invokes execute_origin.
      const producer=new DriverOriginProducer({control,executor:control,dispatch:new RootDispatchFiles(STATE+'/dispatches'),
        validateCurrent:async(operation,mode)=>{requireGuard(mode==='probe','GUARD_RETENTION_PROBE_ONLY');await ctx.assertCurrent();await authority.validate(operation,'probe');}});
      const resolution=await producer.probe(op);
      if(resolution.state==='pending'){common.holdOwnerLease(ctx);throw new Error('GUARD_RETENTION_ORIGINAL_PENDING');}
      requireGuard(['origin-commit-known','origin-no-effects-closed'].includes(resolution.state),'GUARD_RETENTION_ORIGINAL_PENDING');
    }
    await ctx.assertCurrent();
    return {newBodyDigest:digest};
  });
}
function issueOriginal(ctx,bodyDigest) {
  const cutoff=new Date().toISOString();
  const operation={contractVersion:'cop-driver-origin-v1',operationId:randomUUID(),storeIncarnation:ctx.storeIncarnation,
    permitId:randomUUID(),kind:'expire',bodyDigest,schemaDigest:SCHEMA,cutoff};
  const context={...Object.fromEntries(BINDING.map(k=>[k,ctx[k]])),storeIncarnation:ctx.storeIncarnation,
    operationId:operation.operationId,bodyDigest,schemaDigest:SCHEMA};
  const evidence={};
  for(const [kind,decision]of Object.entries(DECISIONS)){
    const r=sign(ctx,kind,{...context,scope:'cop_jizda_preserve_shared_identity_sim',decision});
    storeRootRecord(join(STATE,'evidence',r.payload.recordId+'.json'),r.bytes);evidence[kind]={recordId:r.payload.recordId,digest:r.digest};
  }
  const r=sign(ctx,'driver-origin-permit',{operation,...Object.fromEntries(BINDING.map(k=>[k,ctx[k]])),sourceProofId:ctx.sourceProofId,
    policyGeneration:ctx.policyGeneration,frontierSequence:ctx.frontierSequence,frontierDigest:ctx.frontierDigest,evidence},{recordId:operation.permitId});
  storeRootRecord(join(STATE,'operations',operation.operationId+'.json'),r.bytes);
  const originalPermitRef={recordId:r.payload.recordId,digest:r.digest};
  const pointer=sign(ctx,'driver-retention-active',{owner:OWNER,...Object.fromEntries(BINDING.map(k=>[k,ctx[k]])),
    storeIncarnation:ctx.storeIncarnation,operation:{operationId:operation.operationId,kind:'expire'},originalPermitRef});
  storeRootRecord(ACTIVE,pointer.bytes,{replace:true});return {operation,originalPermitRef};
}
export async function produceDriverRetention(bytes,peer) {
  requireGuard(process.getuid?.()===0&&process.geteuid?.()===0,'ROOT_EXECUTION_REQUIRED');requireRootCodeTree('/opt/cop-account-safety');
  const request=decodeRetentionRequest(bytes),common=await import(pathToFileURL('/opt/cop-account-safety/root-owner-authority.mjs').href);
  const ctx=await common.requireCurrentOwner(OWNER,peer,'retention');
  try{
    let selected=await chooseOriginal(common,ctx);await ctx.assertCurrent();
    if(selected.newBodyDigest)selected=issueOriginal(ctx,selected.newBodyDigest);
    await ctx.assertCurrent();
    const lifetimeMs=Math.min(5000,Date.parse(ctx.expiresAtUTC)-Date.now()-100);requireGuard(lifetimeMs>0,'GUARD_RETENTION_EXPIRED');
    return sign(ctx,'driver-retention-context',{requestId:request.requestId,requestDigest:sha256(canonical({action:'current'})),peer,
      owner:OWNER,cutoff:selected.operation.cutoff,operation:{operationId:selected.operation.operationId,kind:'expire'},
      originalPermitRef:selected.originalPermitRef,...Object.fromEntries(BINDING.map(k=>[k,ctx[k]])),currentSourceProofId:ctx.sourceProofId,
      storeIncarnation:ctx.storeIncarnation,frontierSequence:ctx.frontierSequence,frontierDigest:ctx.frontierDigest},{lifetimeMs}).bytes;
  }finally{await ctx.close();}
}
