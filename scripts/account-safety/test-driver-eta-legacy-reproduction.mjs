/** Reproduces an OLD SQL defect in an owned cluster. PASS means reproduced,
 * never accepted erasure/readiness. No Root verifier/authority callback. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdir,mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
assert.deepEqual(process.argv.slice(2),['--run']);
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),sim='/Users/voldzi/.codex/worktrees/sim-account-erasure/02 SIM';
const selected='6c6d9f22470891227a1a00fb83012c60cfce429c',hash=b=>createHash('sha256').update(b).digest('hex'),execute=promisify(execFile);
const sourceNames=['schema.sql','002_account_erasure.sql','003_guarded_operations.sql','004_read_admission_facts.sql','005_root_checkpoint.sql','006_inventory_candidates.sql'];
const source=new Map(),sourcePins={};
for(const name of sourceNames){const b=(await execute('/usr/bin/git',['-C',sim,'show',selected+':deploy/driver-measurements/'+name],{encoding:'buffer',maxBuffer:1024*1024,env:{PATH:'/usr/bin:/bin',LANG:'C'}})).stdout;source.set(name,b);sourcePins[name]=hash(b);}
assert.equal(sourcePins['003_guarded_operations.sql'],'e3513a983a3b6d1bd52d46851c734dd1c3b208e2e2f6430a6f9eddd38b10d3b5');
const receiptPath=join(repo,'docs/testing/account-safety-driver-eta-legacy-reproduction-20261015.json');assert.equal(existsSync(receiptPath),false);
const selfPin=hash(await readFile(fileURLToPath(import.meta.url))),pgBin='/opt/homebrew/opt/postgresql@18/bin';
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','HOME','USER','LANG','TMPDIR'].includes(k)));
assert.match((await execute(pgBin+'/postgres',['--version'],{env})).stdout,/18\.3/);
const directory=await mkdtemp('/private/tmp/cop-driver-eta-legacy-');assert.equal(dirname(await realpath(directory)),'/private/tmp');
await mkdir(directory+'/socket',{mode:0o700});
const {Client}=createRequire(join(repo,'apps/cop-api/package.json'))('pg'),clients=[];let running=false,success=false,observed;
async function open(database,user='owned_fixture_admin'){const c=new Client({host:directory+'/socket',database,user,query_timeout:5000});c.on('error',()=>{});clients.push(c);await c.connect();return c;}
const store=randomUUID(),checkpoint=hash('synthetic reviewed checkpoint'),aHash=hash('synthetic own contributor A today'),bHash=hash('synthetic other contributor B today');
try{
  await execute(pgBin+'/initdb',['-D',directory+'/data','--username=owned_fixture_admin','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--locale=C'],{env});
  await execute(pgBin+'/pg_ctl',['-D',directory+'/data','-l',directory+'/log','-o',`-k ${directory}/socket -c listen_addresses='' -c unix_socket_permissions=0700 -c log_statement=none -c log_min_error_statement=panic`,'-w','start'],{env});running=true;
  const bootstrap=await open('postgres');await bootstrap.query(`CREATE ROLE driver_measurements_migrator NOLOGIN;CREATE ROLE driver_measurements_runtime LOGIN;
    CREATE ROLE sim_driver_guard_owner NOLOGIN;CREATE ROLE sim_driver_guard_control LOGIN;CREATE ROLE sim_driver_guard_exec LOGIN`);
  await bootstrap.query('CREATE DATABASE sim_driver_measurements OWNER driver_measurements_migrator');
  const admin=await open('sim_driver_measurements'),control=await open('sim_driver_measurements','sim_driver_guard_control'),executor=await open('sim_driver_measurements','sim_driver_guard_exec');
  await admin.query('SET ROLE driver_measurements_migrator');for(const n of sourceNames.slice(0,2))await admin.query(source.get(n).toString());
  await admin.query('RESET ROLE;REVOKE ALL ON SCHEMA public FROM PUBLIC;CREATE SCHEMA sim_driver_guard_source AUTHORIZATION sim_driver_guard_owner;GRANT sim_driver_guard_exec TO sim_driver_guard_owner');
  for(const n of sourceNames.slice(2,4))await admin.query(source.get(n).toString());
  await admin.query('INSERT INTO sim_driver_guard_source.store_binding VALUES(true,$1)',[store]);
  for(const n of sourceNames.slice(4))await admin.query(source.get(n).toString());
  await admin.query("UPDATE driver_account_erasure_state SET replay_ready=true,replay_checkpoint_hash=$1,proof_valid_until=clock_timestamp()+interval '10 minutes',retention_reviewed=true,report_protection='no_report',publication_fence_verified=true WHERE singleton",[checkpoint]);
  const batchA=randomUUID(),batchB=randomUUID(),batchB2=randomUUID();
  for(const [id,h]of[[batchA,aHash],[batchB,bHash],[batchB2,bHash]])await admin.query("INSERT INTO driver_measurement_receipts VALUES('cop',$1,$2,repeat('3',64),clock_timestamp(),clock_timestamp()+interval '7 days','{}')",[id,h]);
  for(const [id,h]of[[batchB,aHash],[batchB2,bHash]])await admin.query("INSERT INTO driver_measurement_eta VALUES('cop',$1,$2,$3,'synthetic-dataset',clock_timestamp(),60,65)",[id,randomUUID(),h]);
  const mismatchBefore=(await admin.query('SELECT count(*)::int n FROM driver_measurement_eta e JOIN driver_measurement_receipts r USING(owner,batch_id) WHERE e.contributor_hash<>r.contributor_hash')).rows[0].n;
  assert.equal(mismatchBefore,1,'Old pair-only FK must actually permit the counterexample.');
  const day=new Date().toISOString().slice(0,10),midnight=Date.parse(day),contributors=Array.from({length:9},(_,i)=>({contributorDay:new Date(midnight-(8-i)*86400000).toISOString().slice(0,10),contributorHash:i===8?aHash:hash('synthetic A '+i)}));
  const toleranceDay=new Date(Date.now()+30000).toISOString().slice(0,10);if(toleranceDay!==day)contributors.push({contributorDay:toleranceDay,contributorHash:hash('synthetic A tolerance')});
  const body={contractVersion:'sim-driver-guarded-db-v1',operationHash:hash('synthetic A operation'),actorHash:hash('synthetic A actor'),requestHash:hash('synthetic immutable manifest'),contributors,checkpointHash:checkpoint};
  const bodyText=JSON.stringify(body),digest=(await control.query("SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') value",[bodyText])).rows[0].value,op=randomUUID(),permit=randomUUID();
  await control.query('BEGIN');await control.query('SELECT sim_driver_guard_source.register_origin($1,$2,$3,$4,$5,$6,NULL)',[op,store,permit,'erase',digest,sourcePins['003_guarded_operations.sql']]);await control.query('COMMIT');
  await executor.query('BEGIN');const d=(await executor.query('SELECT pg_current_xact_id()::text xid,pg_backend_pid() pid,backend_start::text start FROM pg_stat_activity WHERE pid=pg_backend_pid()')).rows[0];
  await control.query('BEGIN');await control.query('SELECT sim_driver_guard_source.claim_origin($1,$2,$3::xid8,$4,$5::timestamptz)',[op,store,d.xid,d.pid,d.start]);await control.query('COMMIT');
  const provisional=(await executor.query('SELECT sim_driver_guard_source.execute_origin($1,$2::jsonb) value',[op,bodyText])).rows[0].value;
  assert.equal(provisional.provisionalInCallerTransaction,true);await executor.query('COMMIT');
  const zero=(await admin.query('SELECT database_zero_verified,remaining_batch_count FROM driver_account_erasure_operations WHERE operation_hash=$1',[body.operationHash])).rows[0];
  const ownReceipts=(await admin.query('SELECT count(*)::int n FROM driver_measurement_receipts WHERE contributor_hash=$1',[aHash])).rows[0].n;
  const ownEta=(await admin.query('SELECT count(*)::int n FROM driver_measurement_eta WHERE contributor_hash=$1',[aHash])).rows[0].n;
  const otherReceipts=(await admin.query('SELECT count(*)::int n FROM driver_measurement_receipts WHERE contributor_hash=$1',[bHash])).rows[0].n;
  const otherEta=(await admin.query('SELECT count(*)::int n FROM driver_measurement_eta WHERE contributor_hash=$1',[bHash])).rows[0].n;
  assert.equal(ownReceipts,0);assert.equal(ownEta,1);assert.equal(zero.database_zero_verified,true);assert.equal(zero.remaining_batch_count,0);assert.equal(otherReceipts,2);assert.equal(otherEta,1);
  observed={oldFkAcceptedMismatch:true,ownReceiptsRemaining:ownReceipts,ownEtaRemaining:ownEta,ledgerDatabaseZeroVerified:zero.database_zero_verified,
    ledgerRemainingBatchCount:zero.remaining_batch_count,otherReceiptsPreserved:otherReceipts,otherEtaPreserved:otherEta};success=true;
}finally{
  for(const c of clients)await c.end().catch(()=>{});
  if(running)await execute(pgBin+'/pg_ctl',['-D',directory+'/data','-m','fast','-w','stop'],{env});
  if(success)await rm(directory,{recursive:true});else process.stderr.write('Owned legacy ETA reproduction retained: '+directory+'\n');
}
assert.equal(hash(await readFile(fileURLToPath(import.meta.url))),selfPin);
const r={status:'LEGACY_DEFECT_REPRODUCED_NOT_ACCEPTANCE',contractVersion:'cop-driver-eta-legacy-reproduction-v1',simDeployCommit:selected,executingRunnerSha256:selfPin,
  sourcePins,observed,actualPostgres:'18.3',actualOriginalTransaction:true,sqlRolesRestricted:true,rootAuthority:false,rootAdmission:false,nativeTransport:false,
  identityAttributionSynthetic:true,productionChanged:false,realAccounts:false,providerCalls:0,forward007Applied:false,wholeAccountComplete:false,restoreAccepted:false,
  cleanup:{ownedClusterRemoved:success,tcp:false,globalPrune:false}};
await writeFile(receiptPath,JSON.stringify(r,null,2)+'\n',{mode:0o600,flag:'wx'});process.stdout.write(JSON.stringify({receiptPath,status:r.status})+'\n');
