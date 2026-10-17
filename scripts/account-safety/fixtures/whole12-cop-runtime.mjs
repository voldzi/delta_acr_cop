/** Real immutable COP composition in the owned whole12 namespace.
 * Fixture credentials remain in private server tmpfs. No adapter replacement.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash,randomBytes} from 'node:crypto';
const directory='/dev/shm/cop-clean-whole';
const manifest=JSON.parse(readFileSync(directory+'/cop-private.json','utf8'));
const issuer='https://cop-erasure-keycloak.invalid/realms/cop';
assert.equal(manifest.contractVersion,'cop-clean-whole12-private-v1');
assert.equal(manifest.ownerLabel,'cop-clean-whole12-9aff26e65b74');
assert.equal(manifest.issuer,issuer);
const env=manifest.integration.environment;
assert.equal(env.COP_ACCOUNT_ERASURE_SCOPE,'cop_sim_shared_identity_v1');
for(const key of Object.keys(process.env)) if(key.startsWith('COP_'))delete process.env[key];
Object.assign(process.env,env);
const nativeFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{
 const url=new URL(String(input));
 if(url.origin==='https://cop-erasure-keycloak.invalid'){
  assert(url.pathname.startsWith('/realms/cop/')||url.pathname.startsWith('/admin/realms/cop/'));
  return nativeFetch('http://127.0.0.1:8080'+url.pathname+url.search,options);
 }
 if(url.origin==='https://cop-erasure-messaging.invalid'){
  assert.equal(url.pathname,'/api/v1/communication/voice-erasure');assert.equal(url.search,'');
  return nativeFetch('http://127.0.0.1:4000'+url.pathname,options);
 }
 assert.equal(url.hostname,'127.0.0.1','WHOLE12_EXTERNAL_NETWORK_REJECTED');
 return nativeFetch(input,options);
};
const require=createRequire('/app/apps/cop-api/package.json');
const {Pool}=require('pg');
const api='file:///app/apps/cop-api/dist/';
const {buildServer}=await import(api+'server.js');
const {PostgresAccountErasureContinuity}=await import(api+'account-erasure-continuity-postgres.js');
const {createBackupRestoreErasureAdapter}=await import(api+'backup-restore-erasure.js');
const {PostgresMediaUploadSettlement,mediaCredentialFingerprint}=await import(api+'media-upload-settlement.js');
const {createMediaStorageFromEnv}=await import(api+'media-storage.js');
const db=manifest.database,pools=[];
const pool=url=>{const p=new Pool({connectionString:url,max:2,connectionTimeoutMillis:3000});pools.push(p);return p;};
const continuity=new PostgresAccountErasureContinuity(pool(db.guardRuntimeUrl),pool(db.guardTargetReadUrl),{
 guardStoreId:db.guardStoreId,applicationStoreId:db.applicationStoreId,incarnationId:db.incarnationId,
 configurationFingerprint:db.configurationFingerprint});
const settlement=new PostgresMediaUploadSettlement(pool(db.guardRuntimeUrl),pool(db.businessRuntimeUrl),{
 bucket:env.COP_MEDIA_S3_BUCKET,endpoint:env.COP_MEDIA_S3_ENDPOINT,
 credentialFingerprint:mediaCredentialFingerprint(env.COP_MEDIA_S3_ACCESS_KEY_ID,env.COP_MEDIA_S3_SECRET_ACCESS_KEY),
 applicationStoreId:db.applicationStoreId,incarnationId:db.incarnationId});
let app;
try{
 app=buildServer({logger:false,accountErasureContinuity:continuity,
  backupRestoreErasureAdapter:createBackupRestoreErasureAdapter({continuity,issuer,identitySecret:env.COP_ACCOUNT_ERASURE_SECRET}),
  mediaStorage:createMediaStorageFromEnv(process.env,{uploadSettlement:settlement})});
 await app.listen({host:'127.0.0.1',port:4310});
 writeFileSync(directory+'/cop-runtime-pid.json',JSON.stringify({pid:process.pid,image:'sha256:2e61857d00f7fe0326a7b50a8f96f0cb4563d4d9028645dc08efe51b84e800df'}),{mode:0o600});
 if(process.argv[2]==='seed'){
  assert(!existsSync(directory+'/cop-seed.json'),'WHOLE12_ALREADY_SEEDED');
  const admin=pool(db.businessRuntimeUrl);
  // Initial fixture DDL is the immutable candidate's actual exported schema.
  // This is synthetic database setup, not a production operator admission.
  const content=await import(api+'content-erasure.js');
  const community=await import(api+'community-erasure.js');
  const runtime=await import(api+'runtime-owner-erasure.js');
  await admin.query([content.contentErasureSchema,community.communityErasureSchema,runtime.runtimeOwnerFenceTableSql].join('\n'));
  const {actualCodeLogin}=await import('./whole12-login.mjs');
  for(const key of ['a','b'])manifest.actors[key].cop=await actualCodeLogin(manifest.actors[key],issuer);
  const headersA={authorization:'Bearer '+manifest.actors.a.cop.access_token};
  const headersB={authorization:'Bearer '+manifest.actors.b.cop.access_token};
  const context={manifest:{...manifest,contractVersion:'cop-account-erasure-whole-fixture-v1'},environment:process.env,app,headersA,headersB};
  const {seedCopLocalOwners}=await import('./whole12-local-fixture.mjs');
  const {seedMediaEdgeFixture}=await import('./whole12-media-fixture.mjs');
  const local=existsSync(directory+'/cop-local-seed.json')
   ? JSON.parse(readFileSync(directory+'/cop-local-seed.json','utf8')) : await seedCopLocalOwners(context);
  if(!existsSync(directory+'/cop-local-seed.json'))
   writeFileSync(directory+'/cop-local-seed.json',JSON.stringify(local),{mode:0o600,flag:'wx'});
  const media=await seedMediaEdgeFixture(context);
  writeFileSync(directory+'/cop-seed.json',JSON.stringify({local,media}),{mode:0o600,flag:'wx'});
  writeFileSync(directory+'/cop-private.json',JSON.stringify(manifest),{mode:0o600});
  console.log(JSON.stringify({phase:'whole12_actual_cop_seed_complete',actorCount:2,actualMediaUploads:true,actualVoiceJwtLifetimeSeconds:3600,productionTouched:false}));
  await app.close();await Promise.all(pools.map(p=>p.end()));
 }else{
  assert.equal(process.argv[2],'start');
  console.log(JSON.stringify({phase:'whole12_actual_cop_started',scope:env.COP_ACCOUNT_ERASURE_SCOPE,productionTouched:false}));
 }
}catch(error){
 const frames=String(error.stack??'').match(/(?:[A-Za-z0-9_-]+\.(?:mjs|js)):\d+:\d+/g)??[];
 const code=typeof error.code==='string'&&/^[A-Z0-9_]{1,90}$/.test(error.code)?error.code:'WHOLE12_COP_RUNTIME_FAILED';
 console.log(JSON.stringify({phase:'whole12_cop_not_ready',code,sourceFrames:frames.slice(0,8),productionTouched:false}));
 await app?.close();await Promise.all(pools.map(p=>p.end()));process.exitCode=1;
}
