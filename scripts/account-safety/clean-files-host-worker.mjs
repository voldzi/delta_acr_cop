/** Finite filesystem work on the real host mount. Existing host Node22 or24;
 * app/database runtime remains Node24. No CLI target/path/command selection.
 * Root controller seals all sources and supplies the one private pipe config.
 */
import {hostname} from 'node:os';
import {lstatSync,realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {runRootPipe} from './clean-reset-worker.mjs';
const need=(v,c)=>{if(!v)throw Error(c)};
export async function runCleanFilesHostWorker(config,host){
 const phases=['files','sim_app_files','file_readback'];
 need(config?.contractVersion==='cop-sim-clean-reset-worker-v1'&&phases.includes(config.phase),'RESET_FILE_WORKER_SCOPE');
 need(process.getuid?.()===0&&hostname().split('.')[0]==='docker'&&['22','24'].includes(process.versions.node.split('.')[0])&&!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'RESET_FILE_WORKER_HOST_ROOT');
 const source=config.simSource;
 need(typeof source==='string'&&source.startsWith('/srv/x5-production/staging/')&&realpathSync(source)===source,'RESET_FILE_WORKER_SOURCE');
 const st=lstatSync(source);need(st.isDirectory()&&st.uid===0&&!(st.mode&0o222),'RESET_FILE_WORKER_SOURCE');
 // The host controller checks source digests and all stopped processes before
 // launch and before every RPC. No application or worker supplies an authority.
 const files=await import(pathToFileURL(source+'/scripts/lib/clean-reset-files.mjs'));
 const app=await import(pathToFileURL(source+'/scripts/lib/sim-user-data-reset-files.mjs'));
 const ops=await import(pathToFileURL(source+'/scripts/lib/clean-reset-ops.mjs'));
 const gate={async withResetAdmission(context,work){
  const value=await host('begin',{phase:config.phase,context});need(typeof value?.leaseId==='string','RESET_ROOT_LEASE_REQUIRED');let open=true;
  const admission={async assertCurrent(){need(open,'RESET_ADMISSION_CLOSED');await host('assert',{leaseId:value.leaseId})},
   async assertReportProducersStopped(){need(open,'RESET_ADMISSION_CLOSED');await host('producers',{leaseId:value.leaseId})}};
  try{await admission.assertCurrent();const result=await work(admission);await admission.assertCurrent();return result}
  finally{open=false;await host('end',{leaseId:value.leaseId})}
 }};
 if(config.phase==='files'){
  need(config.reviewedPlans?.files?.planDigest===config.reviewedPlanDigests.files,'RESET_FILE_WORKER_PLAN');
  const receipt=await ops.stoppedWriters(name=>host('inspectWriter',{name}),config.expectedImages);
  return files.purgeResetFiles({reviewedPlan:config.reviewedPlans.files,writerReceipt:receipt,rootGate:gate});
 }
 if(config.phase==='sim_app_files'){
  need(config.reviewedPlans?.sim_app_files?.planDigest===config.reviewedPlanDigests.sim_app_files,'RESET_FILE_WORKER_PLAN');
  return app.resetSimAppFiles({reviewedPlan:config.reviewedPlans.sim_app_files,rootGate:gate,
   expectedMainImage:config.expectedMainImage,inspectMain:name=>host('inspectWriter',{name})});
 }
 return gate.withResetAdmission({phase:'file_readback'},async admission=>{
  await admission.assertCurrent();const f=files.inspectResetFiles(),a=app.inspectSimAppReset();
  need(f.counts.copRoutes===0&&f.counts.reports===0&&Object.values(a.counts).every(n=>n===0),'RESET_FILE_WORKER_NOT_EMPTY');
  await admission.assertCurrent();return {contractVersion:'cop-clean-host-file-readback-v1',resetEpoch:config.resetEpoch,
   files:{counts:f.counts,planDigest:f.planDigest},sim_app_files:{counts:a.counts,planDigest:a.planDigest},wholeAccountComplete:false};
 });
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)runRootPipe(runCleanFilesHostWorker);
