/** Private Node24 worker for the Root controller. No port, environment-selected
 * target, credential file write or standalone automatic apply. Host owns the
 * finite reviewed plan, live admission and all container/producer controls.
 */
import {lstatSync,realpathSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {inspectCopUserReset,applyCopUserReset} from './clean-user-reset.mjs';
import {createCleanKeycloakReset} from './clean-keycloak-reset.mjs';
const need=(x,code)=>{if(!x)throw Error(code)};
const phases=['inspect','identity','cop','ai','driver','files','sim_app_files','sim_user_install','cop_safety_install','readback'];
const allowed=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join()===keys.sort().join();
export async function runCleanResetWorker(config,host){
 need(config?.contractVersion==='cop-sim-clean-reset-worker-v1'&&phases.includes(config.phase),'RESET_WORKER_SCOPE');
 need(process.versions.node.split('.')[0]==='24'&&process.getuid()===0&&typeof config.simSource==='string'&&config.simSource.startsWith('/srv/x5-production/staging/')&&realpathSync(config.simSource)===config.simSource&&lstatSync(config.simSource).uid===0&&!(lstatSync(config.simSource).mode&0o222),'RESET_WORKER_CONTEXT');
 need(allowed(config.connections,['cop','ai','driver'])&&config.connections.cop.database==='cop'&&config.connections.ai.database==='sim_ai_router'&&config.connections.driver.database==='sim_driver_measurements','RESET_WORKER_DATABASE_SCOPE');
 need(config.keycloak.issuer==='https://login.zeleznalady.cz/realms/cop'&&config.keycloak.clientId==='cop-account-erasure-worker','RESET_WORKER_IDENTITY_SCOPE');
 const {Pool}=createRequire(new URL('../../apps/cop-api/package.json',import.meta.url))('pg');
 const ops=await import(pathToFileURL(config.simSource+'/scripts/lib/clean-reset-ops.mjs'));
 const files=await import(pathToFileURL(config.simSource+'/scripts/lib/clean-reset-files.mjs'));
 const appFiles=await import(pathToFileURL(config.simSource+'/scripts/lib/sim-user-data-reset-files.mjs'));
 const pools=new Map(),epoch=config.resetEpoch,cutoff=config.tokensNotBefore;
 const pool=lane=>{if(!pools.has(lane)){const p=new Pool({...config.connections[lane],max:1,connectionTimeoutMillis:5000,idleTimeoutMillis:1000});p.on('error',()=>{});pools.set(lane,p)}return pools.get(lane)};
 const gate={async withResetAdmission(context,work){
   const lease=await host('begin',{phase:config.phase,context});need(typeof lease?.leaseId==='string','RESET_ROOT_LEASE_REQUIRED');let open=true;
   const admission={async assertCurrent(){need(open,'RESET_ADMISSION_CLOSED');await host('assert',{leaseId:lease.leaseId})},
     async assertReportProducersStopped(){need(open,'RESET_ADMISSION_CLOSED');await host('producers',{leaseId:lease.leaseId})}};
   try{await admission.assertCurrent();const value=await work(admission);await admission.assertCurrent();return value}
   finally{open=false;await host('end',{leaseId:lease.leaseId})}
 }};
 const identity=createCleanKeycloakReset(config.keycloak);
 async function simClient(lane,work){const c=await pool(lane).connect();try{await c.query('SET ROLE '+ops.SCOPES[lane].owner);return await work(c)}finally{c.release()}}
 async function writerReceipt(){return ops.stoppedWriters(async name=>host('inspectWriter',{name}),config.expectedImages)}
 try{
  if(config.phase==='inspect')return {contractVersion:'cop-sim-clean-reset-private-plans-v1',
   cop:await inspectCopUserReset(pool('cop')),ai:await simClient('ai',c=>ops.inspectPlan(c,'ai')),
   driver:await simClient('driver',c=>ops.inspectPlan(c,'driver')),files:files.inspectResetFiles(),sim_app_files:appFiles.inspectSimAppReset(),keycloak:await identity.inspect()};
  const plans=config.reviewedPlans;
  need(plans&&config.reviewedPlanDigests&&['cop','ai','driver','files','keycloak','sim_app_files','sim_user_install','cop_safety_install'].every(k=>config.reviewedPlanDigests[k]===(k==='keycloak'?plans[k]?.inventoryDigest:plans[k]?.planDigest)),'RESET_WORKER_REVIEW_REQUIRED');
  if(config.phase==='cop_safety_install'){
   const {installCleanCopSafety}=await import('./clean-cop-safety-install.mjs');return installCleanCopSafety(config,{rootGate:gate});
  }
  if(config.phase==='sim_user_install'){
   need(config.simUserInstall?.phase==='apply'&&config.simUserInstall.resetEpoch===epoch&&config.simUserInstall.tokensNotBefore===cutoff&&config.simUserInstall.reviewedPlan?.planDigest===config.reviewedPlanDigests.sim_user_install,'RESET_WORKER_SIM_INSTALL_BINDING');
   const {runSimUserInstall}=await import(pathToFileURL(config.simSource+'/scripts/lib/sim-user-data-private-install.mjs'));
   return runSimUserInstall(config.simUserInstall,{Pool,rootGate:gate,assertWritersStopped:async()=>{
    for(const name of ['csm-sim-api','csm-sim-ai-router-api','csm-sim-situation-data-api'])await host('inspectWriter',{name});
   }});
  }
  if(config.phase==='identity')return gate.withResetAdmission({phase:'identity',planDigest:plans.keycloak.inventoryDigest},async admission=>{
   await admission.assertCurrent();const result=await identity.apply(plans.keycloak,{contractVersion:'cop-keycloak-test-reset-authorization-v1',allTestHumanIdentitiesApproved:true,copSimWritersStopped:true,createOldDataBackup:false,resetEpoch:epoch});await admission.assertCurrent();return result;
  });
  if(config.phase==='cop')return gate.withResetAdmission({phase:'cop',planDigest:plans.cop.planDigest},admission=>applyCopUserReset(pool('cop'),plans.cop,{
   contractVersion:'cop-clean-user-reset-authorization-v1',allCopWritersStopped:true,oldIdentityAdmissionClosed:true,
   testDataDestructionApproved:true,createOldDataBackup:false,resetEpoch:epoch,tokensNotBefore:cutoff,rootAdmission:admission}));
  if(config.phase==='ai'||config.phase==='driver'){
   const lane=config.phase,enrollment=config.enrollments[lane];need(enrollment.resetEpoch===epoch&&enrollment.tokensNotBefore===cutoff,'RESET_WORKER_EPOCH_MISMATCH');
   const receipt=await writerReceipt();
   return simClient(lane,c=>ops.applyReset(c,lane,{reviewedPlan:plans[lane],expectedPlanDigest:config.reviewedPlanDigests[lane],writerReceipt:receipt,enrollment,rootGate:gate}));
  }
  if(config.phase==='files')return files.purgeResetFiles({reviewedPlan:plans.files,writerReceipt:await writerReceipt(),rootGate:gate});
  if(config.phase==='sim_app_files')return appFiles.resetSimAppFiles({reviewedPlan:plans.sim_app_files,rootGate:gate,expectedMainImage:config.expectedMainImage,inspectMain:name=>host('inspectWriter',{name})});
  if(config.phase==='readback')return gate.withResetAdmission({phase:'readback'},async admission=>{
   await admission.assertCurrent();const cop=await inspectCopUserReset(pool('cop'));
   const row=(await pool('cop').query('SELECT reset_epoch,tokens_not_before,scope FROM public.cop_clean_reset_epoch WHERE singleton')).rows;
   need(row.length===1&&row[0].reset_epoch===epoch&&Number(row[0].tokens_not_before)===cutoff&&row[0].scope==='cop_sim_shared_identity_v1','RESET_WORKER_READBACK_EPOCH');
   need(Object.values(cop.counts).every(x=>x===0)&&cop.kv.user_rows===0&&Object.values(cop.sideCounts).every(x=>x===null||x===0)&&(!cop.audits||cop.audits.user_audits===0),'RESET_WORKER_COP_NOT_EMPTY');
   const output={contractVersion:'cop-sim-clean-reset-worker-readback-v1',resetEpoch:epoch,copEmpty:true,wholeAccountComplete:false};
   for(const lane of ['ai','driver'])output[lane]=await simClient(lane,async c=>{
    if(lane==='ai'){
     const {verifiedUserMigrations}=await import(pathToFileURL(config.simSource+'/scripts/lib/sim-user-data-enroll.mjs'));
     const {inspectUserDataProfile}=await import(pathToFileURL(config.simSource+'/scripts/lib/sim-user-data-profile.mjs'));
     need(config.simUserInstall?.manifest,'RESET_WORKER_SIM_INSTALL_BINDING');await verifiedUserMigrations(config.simUserInstall.manifest);
     const profile=await inspectUserDataProfile(c,config.simUserInstall.manifest),data=await ops.dataSnapshot(c,lane);
     need(profile.state==='known-new-unused'&&Object.values(data.deleteCounts).every(x=>x===0),'RESET_WORKER_SIM_NOT_EMPTY');
     return {catalogDigest:profile.digest,baseCatalogDigest:profile.baseCatalogDigest,preserved:data.preserve};
    }
    const plan=await ops.inspectPlan(c,lane);need(plan.state==='known-new'&&Object.values(plan.data.deleteCounts).every(x=>x===0),'RESET_WORKER_SIM_NOT_EMPTY');return {catalogDigest:plan.catalogDigest,preserved:plan.data.preserve};
   });
   const fileReadback=await host('fileReadback',{});need(fileReadback?.contractVersion==='cop-clean-host-file-readback-v1'&&fileReadback.resetEpoch===epoch,'RESET_WORKER_FILES_NOT_EMPTY');output.files=fileReadback.files;output.sim_app_files=fileReadback.sim_app_files;
   need(config.simUserInstall?.resetEpoch===epoch&&config.simUserInstall.tokensNotBefore===cutoff&&config.simUserInstall.reviewedPlan?.planDigest===config.reviewedPlanDigests.sim_user_install,'RESET_WORKER_SIM_INSTALL_BINDING');
   const {runSimUserInstall}=await import(pathToFileURL(config.simSource+'/scripts/lib/sim-user-data-private-install.mjs'));
   output.sim_user_install=await runSimUserInstall({...config.simUserInstall,phase:'readback'},{Pool,rootGate:gate,assertWritersStopped:()=>admission.assertCurrent()});
   const k=await identity.inspect();need(k.humanCount===0,'RESET_WORKER_IDENTITIES_NOT_EMPTY');output.keycloak={humanCount:k.humanCount,serviceCount:k.serviceCount};
   await admission.assertCurrent();return output;
  });
  throw Error('RESET_WORKER_OPERATION_INVALID');
 }finally{await Promise.all([...pools.values()].map(p=>p.end().catch(()=>{})))}
}
export async function runRootPipe(runWork=runCleanResetWorker){
 need(process.argv.length===3&&process.argv[2]==='--root-pipe'&&!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'RESET_WORKER_FIXED_PIPE');
 const lines=createInterface({input:process.stdin,crlfDelay:Infinity}),pending=new Map();
 let configResolve,configReject,got=false,closed=false;
 const initial=new Promise((resolve,reject)=>{configResolve=resolve;configReject=reject});
 const firstTimer=setTimeout(()=>configReject(Error('RESET_ROOT_INITIAL_TIMEOUT')),15000);
 function closeWith(code){
  if(closed)return;closed=true;clearTimeout(firstTimer);configReject(Error(code));
  for(const p of pending.values())p.reject(Error(code));pending.clear();lines.close();
 }
 lines.on('line',line=>{try{
  need(!closed&&Buffer.byteLength(line)<=1048576,'RESET_WORKER_INPUT_LIMIT');const frame=JSON.parse(line);
  if(!got){got=true;clearTimeout(firstTimer);configResolve(frame);return}
  need(allowed(frame,['requestId','ok','value'])&&typeof frame.ok==='boolean'&&pending.has(frame.requestId),'RESET_WORKER_REPLY_INVALID');
  const p=pending.get(frame.requestId);pending.delete(frame.requestId);
  if(frame.ok)p.resolve(frame.value);else p.reject(Error('RESET_ROOT_ADMISSION_DENIED'));
 }catch{closeWith('RESET_WORKER_REPLY_INVALID')}});
 lines.on('close',()=>closeWith('RESET_ROOT_PIPE_CLOSED'));
 const host=(operation,payload)=>new Promise((resolve,reject)=>{
  if(closed){reject(Error('RESET_ROOT_PIPE_CLOSED'));return}
  const requestId=randomUUID(),timer=setTimeout(()=>{pending.delete(requestId);reject(Error('RESET_ROOT_REPLY_TIMEOUT'))},operation==='fileReadback'?120000:15000);
  pending.set(requestId,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});
  process.stdout.write(JSON.stringify({contractVersion:'cop-clean-reset-root-rpc-v1',requestId,operation,payload})+'\n');
 });
 try{const value=await runWork(await initial,host);process.stdout.write(JSON.stringify({contractVersion:'cop-clean-reset-worker-result-v1',ok:true,value})+'\n')}
 catch(error){const code=/^[A-Z][A-Z0-9_]{4,80}$/.test(error.message)?error.message:'RESET_WORKER_FAILED';process.stdout.write(JSON.stringify({contractVersion:'cop-clean-reset-worker-result-v1',ok:false,code})+'\n');process.exitCode=2}
 finally{clearTimeout(firstTimer);closeWith('RESET_ROOT_PIPE_CLOSED')}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)runRootPipe();
