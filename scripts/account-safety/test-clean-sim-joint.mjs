// Runs actual COP compiled adapters against actual SIM lifecycle HTTP+PostgreSQL.
// Both services are in this process, data live only in a newly owned local PG.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,chmod,rm,readFile} from 'node:fs/promises';
import {realpathSync,statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createSimCleanLifecycleErasureAdapter} from '../../apps/cop-api/dist/sim-clean-lifecycle-erasure.js';
import {signedCleanLifecycleActor} from '../../apps/cop-api/dist/clean-lifecycle-actor.js';
import {opaqueUserId} from '../../apps/cop-api/dist/ai-router-chat.js';
if(process.argv.length!==4||process.argv[2]!=='--sim-root')throw Error('Only --sim-root LOCAL_SOURCE; no service URL or DB target accepted');
const simRoot=realpathSync(resolve(process.argv[3]));
const {CleanLifecycle,installFence}=await import(pathToFileURL(join(simRoot,'packages/clean-lifecycle/store.mjs')));
const {registerCleanLifecycle}=await import(pathToFileURL(join(simRoot,'packages/clean-lifecycle/http.mjs')));
const express=createRequire(join(simRoot,'apps/ai-router-api/package.json'))('express');
const {Pool}=createRequire(new URL('../../apps/cop-api/package.json',import.meta.url))('pg');
const exec=promisify(execFile),bin='/opt/homebrew/opt/postgresql@18/bin';
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','HOME','USER','LOGNAME','LANG','LC_ALL','TMPDIR'].includes(k)));
const oldUmask=process.umask(0o077),root=await mkdtemp('/private/tmp/cop-sim-clean-joint-');await chmod(root,0o700);await mkdir(join(root,'s'),{mode:0o700});
let started=false,checks=0;const pools=[],servers=[];
const check=value=>{assert.ok(value);checks++};
function owned(){assert.equal(dirname(realpathSync(root)),'/private/tmp');assert.equal(statSync(root).uid,process.getuid());assert.equal(statSync(root).mode&0o777,0o700)}
async function start(){owned();await exec(join(bin,'pg_ctl'),['-D',join(root,'db'),'-l',join(root,'pg.log'),'-o',`-k ${join(root,'s')} -c listen_addresses=''`,'-w','start'],{env});started=true}
async function stop(){owned();await exec(join(bin,'pg_ctl'),['-D',join(root,'db'),'-m','fast','-w','stop'],{env});started=false}
function pool(database,user='fixture_owner'){const p=new Pool({host:join(root,'s'),database,user,connectionTimeoutMillis:2000});pools.push(p);return p}
const config={issuer:'https://identity.synthetic.invalid/realms/cop',resetEpoch:randomUUID(),actorSecret:'synthetic-joint-signing-at-least-32-characters',userIdSecret:'synthetic-joint-stable-hmac-at-least-32-characters',token:'synthetic-joint-service-token-at-least-32-characters'};
const ownerSecret='synthetic-joint-owner-secret-at-least-32-characters';
const a={authMode:'oidc',issuer:config.issuer,subjectId:randomUUID(),tokenIssuedAt:Math.floor(Date.now()/1000)-1,username:'',displayName:''},b={...a,subjectId:randomUUID()};
try{
 await exec(join(bin,'initdb'),['-D',join(root,'db'),'-U','fixture_owner','--auth-local=trust','--auth-host=reject','--no-locale'],{env});await start();
 const admin=pool('postgres');const actual=(await admin.query("SELECT current_setting('data_directory') d,current_setting('listen_addresses') l,inet_server_addr() a")).rows[0];check(actual.d===join(root,'db')&&actual.l===''&&actual.a===null);
 await admin.query('CREATE ROLE ai_router_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION');
 await admin.query('CREATE ROLE driver_measurements_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION');
 for(const lane of ['ai','driver']){
  const database='fixture_'+lane;await admin.query('CREATE DATABASE '+database);const db=pool(database);
  for(const path of lane==='ai'?['deploy/ai-router/001_schema.sql','deploy/ai-router/002_separate_billing.sql']:['deploy/driver-measurements/schema.sql'])await db.query(await readFile(join(simRoot,path),'utf8'));
  await db.query(await readFile(join(simRoot,'deploy/clean-lifecycle/001_clean_lifecycle.sql'),'utf8'));
  const expected={lane,mode:'isolated-clean-lifecycle-v1',environmentId:randomUUID(),resetEpoch:config.resetEpoch};
  await db.query("INSERT INTO sim_clean.config VALUES(true,'cop-sim-user-lifecycle-v1',$1,$2,$3,$4)",[expected.mode,expected.environmentId,expected.resetEpoch,lane]);await installFence(db,lane);
  if(lane==='ai')await db.query(await readFile(join(simRoot,'deploy/clean-lifecycle/002_ai_budget_views.sql'),'utf8'));
  await db.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await db.query(await readFile(join(simRoot,lane==='ai'?'deploy/clean-lifecycle/003_ai_runtime_grants.sql':'deploy/clean-lifecycle/004_driver_runtime_grants.sql'),'utf8'));
  const runtime=pool(database,lane==='ai'?'ai_router_runtime':'driver_measurements_runtime');
  const service=new CleanLifecycle(runtime,expected),hashResource=r=>createHash('sha256').update('synthetic:'+r).digest('hex');
  const app=express();app.use(express.json({limit:'32kb'}));const options={enabled:true,tokensNotBefore:0,workerReady:()=>true,serviceToken:config.token,actorSecret:config.actorSecret,ownerSecret,issuer:config.issuer,expected,service,hashResource};
  const worker=registerCleanLifecycle(app,options),writerPath=lane==='ai'?'/api/v1/ai-router/generate':'/api/v1/internal/driver-measurements/v1/batches';
  app.post(writerPath,async(req,res)=>{
   try{const resource=lane==='ai'?req.body.userId:req.body.contributorIdDay;
    if(lane==='ai')await runtime.query("INSERT INTO ai_router_request(id,client_id,user_hash,task_type,model,routing_reason,difficulty,status,reserved_microusd,charged_microusd) VALUES($1,'cop',$2,'cop_chat','synthetic','synthetic','simple','success',10,2)",[randomUUID(),hashResource(resource)]);
    else await runtime.query("INSERT INTO driver_measurement_receipts VALUES('cop',$1,$2,$3,now(),now()+interval '7 days','{}')",[randomUUID(),hashResource(resource),'1'.repeat(64)]);
    res.status(201).json({ok:true});
   }catch{res.status(503).json({error:'SYNTHETIC_WRITE_FAILED'})}
  });
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});servers.push(server);const baseUrl='http://127.0.0.1:'+server.address().port;
  const adapter=createSimCleanLifecycleErasureAdapter({...config,baseUrl,component:lane});
  check(await adapter.ready());check((await adapter.preflight(a,{signal:AbortSignal.timeout(5000)})).ready);
  const resource=x=>lane==='ai'?opaqueUserId(config.userIdSecret,x.subjectId):createHash('sha256').update('synthetic-daily:'+x.subjectId).digest('base64url');
  async function write(x){const r=await fetch(baseUrl+writerPath,{method:'POST',headers:{authorization:'Bearer '+config.token,'content-type':'application/json',...signedCleanLifecycleActor(config,x.subjectId,{tokenIssuedAt:x.tokenIssuedAt,resourceId:resource(x)})},body:JSON.stringify(lane==='ai'?{taskType:'cop_chat',userId:resource(x)}:{contributorIdDay:resource(x)})});await r.json();return r.status}
  check(await write(a)===201);check(await write(b)===201);
  const context={accountKey:'a'.repeat(64),operationId:randomUUID(),requestedAt:new Date().toISOString(),signal:AbortSignal.timeout(5000)};
  check((await adapter.erase(a,context)).status==='pending');check(await write(a)===503);check(await write(b)===201);
  await worker.tick();check((await adapter.verifiedCompletedOperationProof(a,context)).status==='completed');
  const table=lane==='ai'?'ai_router_request':'driver_measurement_receipts',column=lane==='ai'?'user_hash':'contributor_hash';
  check(Number((await db.query(`SELECT count(*) n FROM ${table} WHERE ${column}=$1`,[hashResource(resource(a))])).rows[0].n)===0);
  check(Number((await db.query(`SELECT count(*) n FROM ${table} WHERE ${column}=$1`,[hashResource(resource(b))])).rows[0].n)===2);
  check((await adapter.erase(a,context)).status==='completed');
  await assert.rejects(adapter.verifiedCompletedOperationProof(b,context));checks++;
  options.enabled=false;check(await adapter.ready()===false);await assert.rejects(adapter.erase(a,context));checks++;options.enabled=true;
  const unused={...a,subjectId:randomUUID()},unusedContext={...context,operationId:randomUUID(),requestedAt:new Date().toISOString()};
  check((await adapter.preflight(unused,{signal:AbortSignal.timeout(5000)})).ready);check((await adapter.erase(unused,unusedContext)).status==='pending');await worker.tick();check((await adapter.verifiedCompletedOperationProof(unused,unusedContext)).status==='completed');
  await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));servers.pop();
 }
 console.log(JSON.stringify({contractVersion:'cop-sim-clean-joint-test-v1',checks,actualCopAdapter:true,actualSimHttp:true,actualPostgres:true,businessWriter:'synthetic database-backed handler',externalProviderCalls:0,productionTouched:false,wholeAccountAcceptance:false}));
}finally{for(const s of servers)await new Promise(resolve=>s.close(()=>resolve()));await Promise.all(pools.filter(p=>!p.ended).map(p=>p.end().catch(()=>{})));if(started)await stop();owned();await rm(root,{recursive:true,force:true});process.umask(oldUmask)}
