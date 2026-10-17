/** Actual HTTP/SQL/provider checks for the two owned whole12 actors. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {actualCodeLogin} from './whole12-login.mjs';
const root='/dev/shm/cop-clean-whole',file=root+'/cop-private.json';
const f=JSON.parse(readFileSync(file,'utf8')),env=f.integration.environment;
assert.equal(f.contractVersion,'cop-clean-whole12-private-v1');
assert.equal(env.COP_ACCOUNT_ERASURE_SCOPE,'cop_sim_shared_identity_v1');
const issuer='https://cop-erasure-keycloak.invalid/realms/cop';assert.equal(f.issuer,issuer);
const nativeFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{
 const u=new URL(String(input));
 if(u.origin==='https://cop-erasure-keycloak.invalid'){
  assert(u.pathname.startsWith('/realms/cop/')||u.pathname.startsWith('/admin/realms/cop/'));
  return nativeFetch('http://127.0.0.1:8080'+u.pathname+u.search,options);
 }
 assert.equal(u.hostname,'127.0.0.1');return nativeFetch(input,options);
};
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const save=(path,x)=>writeFileSync(root+'/'+path,JSON.stringify(x),{mode:0o600,flag:'wx'});
const read=path=>JSON.parse(readFileSync(root+'/'+path,'utf8'));
const path='/api/v1/me/account-deletion';
const headers=key=>({authorization:'Bearer '+f.actors[key].cop.access_token});
async function request(method,url,body,h={}){
 const r=await fetch('http://127.0.0.1:4310'+url,{method,headers:{...h,...(body?{'content-type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(45000)});
 const text=await r.text();assert(Buffer.byteLength(text)<=262144);
 return {status:r.status,headers:r.headers,value:text?JSON.parse(text):null};
}
async function messaging(){
 const r=await fetch('http://127.0.0.1:4323/readback',{headers:{authorization:'Bearer '+env.COP_CSM_MESSAGING_TOKEN},signal:AbortSignal.timeout(15000)});
 assert.equal(r.status,200);return (await r.json()).owners;
}
const {createWhole12SimReadbackAdapter}=await import('./sim-readback-source/scripts/fixtures/whole12-sim-readback-adapter.mjs');
const sim=await createWhole12SimReadbackAdapter(root+'/sim-private.json');
const local=await import('./whole12-local-fixture.mjs'),media=await import('./whole12-media-fixture.mjs');
const seeded=read('cop-seed.json'),compat={...f,contractVersion:'cop-account-erasure-whole-fixture-v1'};
async function owners(operationId){
 const context={manifest:compat,environment:env,operationId,seed:seeded};
 const [a,b,c,d,e]=await Promise.all([local.readCopLocalOwners(context),sim.readback(),messaging(),
  media.readMediaEdgeFixture({...context,seed:seeded.media}),local.readCopMeasurementConsent(context)]);
 const s=b.owners??b;
 s.sim_measurements={...s.sim_measurements,removableA:s.sim_measurements.removableA+e.a.count,
  removableB:s.sim_measurements.removableB+e.b.count,preservedBFingerprint:sha([s.sim_measurements.preservedBFingerprint,e.b.fingerprint])};
 const all={...a,...s,...c,...(d.owners??d)};
 assert.equal(Object.keys(all).length,12);
 return all;
}
try{
 const action=process.argv[2];
 if(action==='before'){
  for(const key of ['a','b'])f.actors[key].cop=await actualCodeLogin(f.actors[key],issuer);
  writeFileSync(file,JSON.stringify(f),{mode:0o600});
  const operationId=randomUUID(),before=await owners(operationId);
  const capability=await request('GET',path+'/capabilities',null,headers('a'));
  const plan=await request('POST',path+'/preflight',{}, {...headers('a'),'idempotency-key':operationId});
  if(plan.status!==200||plan.value.canConfirm!==true){
   console.log(JSON.stringify({phase:'whole12_preflight_not_ready',status:plan.status,capabilityStatus:capability.status,
    capabilityReady:capability.value?.accountDeletion===true,blockers:plan.value?.blockers?.map(x=>({domain:x.domain,reason:x.reason})),productionTouched:false}));
   process.exitCode=1;
  }else{
   const receiptCapability=plan.headers.get('x-cop-erasure-receipt-capability');assert(receiptCapability);
   save('whole12-before.json',{operationId,before,receiptCapability,planId:plan.value.planId,checkedAt:new Date().toISOString()});
   console.log(JSON.stringify({phase:'whole12_actual_preflight_ready',operationId,owners:Object.keys(before).sort(),
    actualADataCount:Object.values(before).reduce((n,x)=>n+x.removableA,0),actualBDataCount:Object.values(before).reduce((n,x)=>n+x.removableB,0),productionTouched:false}));
  }
 }else if(action==='confirm'||action==='retry'){
  const c=read('whole12-before.json');
  const r=await request('POST',path,{confirmAccountDeletion:true},{...headers('a'),'idempotency-key':c.operationId,
   'x-cop-erasure-plan':c.planId,'x-cop-erasure-receipt-capability':c.receiptCapability});
  save('whole12-'+action+'-'+randomUUID()+'.json',{operationId:c.operationId,status:r.status,value:r.value,checkedAt:new Date().toISOString()});
  console.log(JSON.stringify({phase:'whole12_actual_'+action,operationId:c.operationId,httpStatus:r.status,
   contractVersion:r.value?.contractVersion,status:r.value?.status,accountDeleted:r.value?.accountDeleted,
   errorCode:r.value?.error?.code,productionTouched:false}));
  assert([202,503].includes(r.status));
 }else if(action==='receipt'){
  const c=read('whole12-before.json');const r=await request('GET',path+'/receipts/'+c.operationId,null,{'x-cop-erasure-receipt-capability':c.receiptCapability});
  console.log(JSON.stringify({phase:'whole12_actual_receipt',operationId:c.operationId,httpStatus:r.status,
   contractVersion:r.value?.contractVersion,status:r.value?.status,accountDeleted:r.value?.accountDeleted,remaining:r.value?.remaining,productionTouched:false}));
  assert.equal(r.status,200);
 }else if(action==='readback'){
  const c=read('whole12-before.json'),after=await owners(c.operationId);
  console.log(JSON.stringify({phase:'whole12_actual_owner_readbacks',operationId:c.operationId,
   owners:Object.fromEntries(Object.entries(after).map(([id,x])=>[id,{remainingA:x.removableA,
    bPreserved:x.removableB===c.before[id].removableB&&x.preservedBFingerprint===c.before[id].preservedBFingerprint}])),productionTouched:false}));
 }else throw Error('WHOLE12_CHECK_ACTION');
}catch(error){
 const frames=String(error.stack??'').match(/(?:[A-Za-z0-9_-]+\.(?:mjs|js)):\d+:\d+/g)??[];
 const message=String(error.message??'');
 const code=/^[A-Z0-9_]{1,100}$/.test(message)?message:'WHOLE12_CHECK_FAILED';
 console.log(JSON.stringify({phase:'whole12_check_failed',code,sourceFrames:frames.slice(0,8),productionTouched:false}));process.exitCode=1;
}
