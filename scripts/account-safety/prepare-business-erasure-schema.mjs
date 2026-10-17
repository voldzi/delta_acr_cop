/** One bounded first-enrollment DDL step. No server, backfill, grants or cleanup. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { hostname } from 'node:os';
import { loadOperatorEnvironment, loadCleanOperatorEnvironment } from './operator-profile-environment.mjs';
const need=(v,code='BUSINESS_ERASURE_SCHEMA_UNPROVEN')=>{if(!v)throw Error(code);};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hex=/^[a-f0-9]{64}$/u,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const CA_SHA='7a3f9d9373cd63361148230e6c2804c6fb76dc204e18d5039aad7c7838d7a14a';
const specs={
 cop_content_erasure_fences:{columns:[['owner_key','text',true],['subject_key','text',true],['operation_id','text',true],['created_at','timestamp with time zone',true,'now()']],pk:['owner_key'],indexes:{cop_content_erasure_fences_subject_idx:['subject_key']}},
 cop_content_erasure_component_proofs:{columns:[['owner_key','text',true],['component','text',true],['operation_id','text',true],['proof_id','text',true]],pk:['owner_key','component'],fk:true},
 cop_content_erasure_projection_manifest:{columns:[['owner_key','text',true],['operation_id','text',true],['kind','text',true],['row_key','text',true]],pk:['owner_key','kind','row_key'],fk:true},
 cop_community_erasure_ownership:{columns:[['kind','text',true],['row_key','text',true],['subject_id','text',true],['issuer','text',false]],pk:['kind','row_key'],indexes:{cop_community_erasure_ownership_owner_idx:['subject_id','issuer']}},
 cop_community_owned_media:{columns:[['bucket','text',true],['object_key','text',true],['subject_id','text',true],['issuer','text',false],['upload_expires_at','timestamp with time zone',true]],pk:['bucket','object_key']},
 cop_community_metadata_owners:{columns:[['group_id','uuid',true],['field_name','text',true],['subject_id','text',true],['issuer','text',false]],pk:['group_id','field_name']},
 cop_community_media_write_leases:{columns:[['lease_id','uuid',true],['bucket','text',true],['object_key','text',true],['subject_id','text',true],['issuer','text',true]],pk:['lease_id']},
 cop_content_erasure_media_manifest:{columns:[['owner_key','text',true],['operation_id','text',true],['bucket','text',true],['object_key','text',true],['not_before','timestamp with time zone',true]],pk:['owner_key','bucket','object_key'],fk:true},
 cop_runtime_owner_fences:{columns:[['domain','text',true],['subject_hash','text',true],['owner_hash','text',true],['operation_id','text',true],['requested_at','timestamp with time zone',true]],pk:['domain','subject_hash']}
};
const names=Object.keys(specs),empty=['cop_content_erasure_fences','cop_content_erasure_component_proofs','cop_content_erasure_projection_manifest','cop_content_erasure_media_manifest','cop_runtime_owner_fences','cop_community_media_write_leases'];
async function schemas(){
 const a=await import('../../apps/cop-api/dist/content-erasure.js'),b=await import('../../apps/cop-api/dist/community-erasure.js'),c=await import('../../apps/cop-api/dist/runtime-owner-erasure.js');
 const sql=[a.contentErasureSchema,b.communityErasureSchema,c.runtimeOwnerFenceTableSql].join('\n');
 const statements=sql.split(';').map(v=>v.trim()).filter(Boolean);
 const allowedIndexes=new Set(['CREATE INDEX IF NOT EXISTS cop_content_erasure_fences_subject_idx ON cop_content_erasure_fences(subject_key)','CREATE INDEX IF NOT EXISTS cop_community_erasure_ownership_owner_idx ON cop_community_erasure_ownership(subject_id,issuer)']);
 need(statements.every(v=>/^CREATE TABLE IF NOT EXISTS cop_[a-z_]+\s*\(/u.test(v)||allowedIndexes.has(v)),'BUSINESS_DDL_SCOPE_CHANGED');
 need(same([...new Set(statements.flatMap(v=>/^CREATE TABLE IF NOT EXISTS (cop_[a-z_]+)/u.exec(v)?.[1]??[]))].sort(),[...names].sort()),'BUSINESS_DDL_TABLES_CHANGED');
 // Preserve the actual exported definitions, only qualify fixed relation names.
 const qualified=statements.map(v=>v.replace(/CREATE TABLE IF NOT EXISTS (cop_[a-z_]+)/u,'CREATE TABLE IF NOT EXISTS public.$1').replace(/REFERENCES (cop_[a-z_]+)/gu,'REFERENCES public.$1').replace(/\bON (cop_[a-z_]+)/gu,'ON public.$1'));
 return {sql:qualified.map(v=>v+';').join('\n'),digest:hash([a.contentErasureSchema,b.communityErasureSchema,c.runtimeOwnerFenceTableSql])};
}
async function catalog(c,owner){
 const missing=[],seen=[];
 for(const name of names){
  const relation=(await c.query(`SELECT c.oid,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.relispartition,pg_get_userbyid(c.relowner) owner,
   EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal) custom_trigger,
   EXISTS(SELECT 1 FROM pg_inherits WHERE inhrelid=c.oid OR inhparent=c.oid) inherited,
   EXISTS(SELECT 1 FROM pg_rewrite WHERE ev_class=c.oid AND rulename<>'_RETURN') custom_rule,
   EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) WHERE grantee=0) public_acl
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1`,[name])).rows;
  if(!relation.length){missing.push(name);continue;}
  need(relation.length===1,'BUSINESS_RELATION_AMBIGUOUS');const r=relation[0],s=specs[name];
  need(r.relkind==='r'&&r.relpersistence==='p'&&!r.relrowsecurity&&!r.relforcerowsecurity&&!r.relispartition&&!r.custom_trigger&&!r.custom_rule&&!r.inherited&&!r.public_acl&&r.owner===owner,'BUSINESS_TABLE_DRIFT');
  const columns=(await c.query(`SELECT a.attname name,format_type(a.atttypid,a.atttypmod) type,a.attnotnull required,
   pg_get_expr(d.adbin,d.adrelid) default_value,a.attidentity,a.attgenerated,a.attcollation=t.typcollation ordinary_collation
   FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE a.attrelid=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,[r.oid])).rows;
  need(same(columns.map(v=>[v.name,v.type,v.required,...(v.default_value===null?[]:[v.default_value])]),s.columns)&&columns.every(v=>!v.attidentity&&!v.attgenerated&&v.ordinary_collation),'BUSINESS_COLUMN_DRIFT');
  const constraints=(await c.query(`SELECT contype,convalidated,condeferrable,condeferred,pg_get_constraintdef(oid) definition,confrelid::regclass::text target
   FROM pg_constraint WHERE conrelid=$1 AND contype<>'n' ORDER BY contype`,[r.oid])).rows;
  const expected=[...(s.fk?[{type:'f',definition:'FOREIGN KEY (owner_key) REFERENCES cop_content_erasure_fences(owner_key)'}]:[]),{type:'p',definition:'PRIMARY KEY ('+s.pk.join(', ')+')'}];
  need(constraints.length===expected.length&&constraints.every((v,i)=>v.contype===expected[i].type&&v.convalidated&&!v.condeferrable&&!v.condeferred&&v.definition.replaceAll('public.','')===expected[i].definition&&(!s.fk||v.contype!=='f'||v.target.replace(/^public\./u,'')==='cop_content_erasure_fences')),'BUSINESS_CONSTRAINT_DRIFT');
  const indexes=(await c.query(`SELECT ci.relname name,i.indisprimary primary_index,i.indisunique unique_index,i.indisvalid,i.indisready,i.indislive,
   i.indexprs IS NULL AND i.indpred IS NULL plain,i.indnatts=i.indnkeyatts keys_only,am.amname method,
   ARRAY(SELECT pg_get_indexdef(i.indexrelid,n,false) FROM generate_series(1,i.indnkeyatts) n) keys
   FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid JOIN pg_am am ON am.oid=ci.relam WHERE i.indrelid=$1 ORDER BY ci.relname`,[r.oid])).rows;
  const expectedIndexes={[name+'_pkey']:{keys:s.pk,primary:true,unique:true},...Object.fromEntries(Object.entries(s.indexes??{}).map(([k,v])=>[k,{keys:v,primary:false,unique:false}]))};
  need(indexes.length===Object.keys(expectedIndexes).length&&indexes.every(v=>{const e=expectedIndexes[v.name];return e&&v.primary_index===e.primary&&v.unique_index===e.unique&&v.indisvalid&&v.indisready&&v.indislive&&v.plain&&v.keys_only&&v.method==='btree'&&same(v.keys,e.keys);}),'BUSINESS_INDEX_DRIFT');
  seen.push({table:name,owner,columns:s.columns,pk:s.pk,indexes:expectedIndexes});
 }
 return {missing,digest:hash(seen)};
}
async function binding(g,b,expected,locking){
 const rows=(await g.query(`SELECT c.contract_version,c.guard_store_id,c.application_store_id,c.configuration_fingerprint,c.initial_digest,
  r.store_id,r.incarnation_id,r.restore_generation,r.replay_sequence,r.replay_digest FROM cop_safety_v2.configuration c
  JOIN cop_safety_v2.dataset_replays r ON r.owner='cop' WHERE c.singleton`+(locking?' FOR SHARE OF c,r':''))).rows;
 need(rows.length===1,'BUSINESS_GUARD_NOT_ENROLLED');const v=rows[0];
 need(v.contract_version==='cop-database-safety-v2'&&v.guard_store_id===expected.guardStoreId&&v.application_store_id===expected.applicationStoreId&&v.store_id===expected.applicationStoreId&&v.configuration_fingerprint===expected.configurationFingerprint&&v.incarnation_id===expected.incarnationId&&Number(v.restore_generation)>0&&Number(v.replay_sequence)===0&&v.replay_digest===v.initial_digest&&hex.test(v.initial_digest),'BUSINESS_GUARD_BINDING_CHANGED');
 need((await g.query('SELECT count(*)::int n FROM cop_safety_v2.fences')).rows[0].n===0,'BUSINESS_NOT_FIRST_ENROLLMENT');
 const actual=(await b.query("SELECT key,value FROM public.cop_mobility_v1 WHERE key IN ('account-safety:store-identity-v1','account-erasure:configuration-v1') ORDER BY key")).rows;
 const local=actual.find(x=>x.key==='account-erasure:configuration-v1')?.value,marker=actual.find(x=>x.key==='account-safety:store-identity-v1')?.value;
 if(expected.deletionScope!==undefined){
  need(expected.deletionScope==='cop_sim_shared_identity_v1'&&uuid.test(expected.resetEpoch??'')&&Number.isSafeInteger(expected.tokensNotBefore)&&expected.tokensNotBefore>0&&local?.deletionScope===expected.deletionScope,'BUSINESS_CLEAN_SCOPE_UNPROVEN');
  const epoch=(await b.query('SELECT reset_epoch,tokens_not_before,scope FROM public.cop_clean_reset_epoch WHERE singleton')).rows;
  need(epoch.length===1&&epoch[0].reset_epoch===expected.resetEpoch&&Number(epoch[0].tokens_not_before)===expected.tokensNotBefore&&epoch[0].scope===expected.deletionScope,'BUSINESS_CLEAN_RESET_UNPROVEN');
 }
 need(local?.version===4&&local.storeId===expected.applicationStoreId&&local.fingerprint===expected.configurationFingerprint&&local.datasetBinding?.incarnationId===expected.incarnationId&&local.datasetBinding.restoreGeneration===Number(v.restore_generation)&&marker?.storeId===expected.applicationStoreId&&marker.incarnationId===expected.incarnationId,'BUSINESS_LOCAL_BINDING_CHANGED');
 need((await b.query("SELECT count(*)::int n FROM public.cop_mobility_v1 WHERE key LIKE 'account-erasure:job:%'")).rows[0].n===0,'BUSINESS_NOT_FIRST_ENROLLMENT');
 return hash({guard:rows[0],local,marker});
}
async function prepare({mode,business,guard,expected,appRole,admission}){
 if(expected?.deletionScope!==undefined){need(typeof admission?.assertCurrent==='function','BUSINESS_CLEAN_ADMISSION_REQUIRED');await admission.assertCurrent();}
 need(['check','apply'].includes(mode)&&[expected.guardStoreId,expected.applicationStoreId,expected.incarnationId].every(v=>uuid.test(v??''))&&hex.test(expected.configurationFingerprint??'')&&/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/u.test(appRole),'BUSINESS_PREP_SCOPE');
 const ddl=await schemas(),g=await guard.connect(),b=await business.connect();let gt=false,bt=false;
 try{
  await g.query('BEGIN');gt=true;await g.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='15s'");await g.query('SELECT pg_advisory_xact_lock(1932540802,2)');
  await b.query('BEGIN');bt=true;await b.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='15s'; SET LOCAL search_path=pg_catalog,public");
  const facts=(await b.query(`SELECT current_database() database,pg_get_userbyid(c.relowner) owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='cop_mobility_v1' AND c.relkind='r'`)).rows;
  need(facts.length===1&&/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/u.test(facts[0].owner),'BUSINESS_BASE_STORE_UNPROVEN');const owner=facts[0].owner;
  const roles=(await b.query('SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=ANY($1::text[])',[[owner,appRole]])).rows;
  need(roles.length===(owner===appRole?1:2)&&roles.every(v=>!v.rolsuper&&!v.rolcreatedb&&!v.rolcreaterole&&!v.rolbypassrls),'BUSINESS_ROLE_UNPROVEN');
  const access=(await b.query("SELECT pg_has_role($1,$2,'USAGE') allowed,has_schema_privilege($2,'public','CREATE') create_allowed",[appRole,owner])).rows[0];need(access?.allowed===true&&access.create_allowed===true,'BUSINESS_OWNER_NOT_EXISTING_APP_ROLE');
  if(mode==='apply'){need((await b.query('SELECT rolsuper FROM pg_roles WHERE rolname=session_user')).rows[0]?.rolsuper===true,'BUSINESS_ADMIN_REQUIRED');await b.query('SET LOCAL ROLE "'+owner+'"');}
  // First enrollment only: lock existing KV writes while checking config/jobs.
  await b.query('LOCK TABLE public.cop_mobility_v1 IN SHARE MODE');
  const beforeBinding=await binding(g,b,expected,mode==='apply'),before=await catalog(b,owner);
  if(mode==='apply'&&before.missing.length)await b.query(ddl.sql);
  const after=await catalog(b,owner);let zeroWriteLeases=null;
  if(after.missing.length===0){
   for(const table of empty)need((await b.query('SELECT count(*)::int n FROM public.'+table)).rows[0].n===0,'BUSINESS_EXISTING_ERASURE_STATE');
   zeroWriteLeases=(await b.query('SELECT count(*)::int n FROM public.cop_community_media_write_leases')).rows[0].n===0;
  }
  need(beforeBinding===await binding(g,b,expected,mode==='apply'),'BUSINESS_BINDING_MOVED');
  const result={contractVersion:'cop-business-erasure-schema-preparation-v1',mode,schemaReady:after.missing.length===0,missingTables:after.missing,tableCount:names.length,
   createdTables:mode==='apply'?before.missing:[],zeroWriteLeases,firstEnrollmentConfirmed:true,bindingDigest:beforeBinding,catalogDigest:after.digest,exportedSchemasDigest:ddl.digest};
  if(admission)await admission.assertCurrent();
  await b.query('COMMIT');bt=false;await g.query('COMMIT');gt=false;return result;
 }catch(error){if(bt)await b.query('ROLLBACK').catch(()=>{});if(gt)await g.query('ROLLBACK').catch(()=>{});throw Error(typeof error?.message==='string'&&/^BUSINESS_[A-Z_]+$/u.test(error.message)?error.message:'BUSINESS_ERASURE_SCHEMA_UNPROVEN');}
 finally{b.release();g.release();}
}
export async function prepareBusinessErasureSchema({mode,password,cleanReset=false,admission}={}){
 need(typeof cleanReset==='boolean','BUSINESS_FIXED_MODE');
 need(['check','apply'].includes(mode),'BUSINESS_FIXED_MODE');need(process.getuid?.()===0&&hostname().split('.')[0]==='docker'&&Number(process.versions.node.split('.')[0])===24&&!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'BUSINESS_ROOT_CONTEXT');const env=cleanReset?loadCleanOperatorEnvironment():loadOperatorEnvironment();need(env.COP_ACCOUNT_SAFETY_AUTHORITY_MODE==='database_v2'&&(!env.COP_ACCOUNT_ERASURE_ENABLED||env.COP_ACCOUNT_ERASURE_ENABLED==='false')&&(env.COP_ACCOUNT_ERASURE_SECRET??'').length>=32,'BUSINESS_PRODUCTION_SCOPE');
 if(cleanReset){need(env.COP_ACCOUNT_ERASURE_SCOPE==='cop_sim_shared_identity_v1'&&typeof admission?.assertCurrent==='function','BUSINESS_CLEAN_ADMISSION_REQUIRED');await admission.assertCurrent();}
 const ca=readFileSync('/etc/vcode-cop-pgbouncer/postgres-ca.crt');need(createHash('sha256').update(ca).digest('hex')===CA_SHA,'BUSINESS_CA_CHANGED');
 const{databaseContinuityEndpoints}=await import('../../apps/cop-api/dist/account-erasure-continuity-production.js');const routes=databaseContinuityEndpoints(env);
 const{Pool}=createRequire(new URL('../../apps/cop-api/package.json',import.meta.url))('pg');const pools=[];
 const pool=(value,database,admin)=>{const u=new URL(value);need(['postgres:','postgresql:'].includes(u.protocol)&&u.hostname==='haproxy.home.cz'&&u.port==='5000'&&u.pathname==='/'+database&&!u.hash&&[...u.searchParams.keys()].every(k=>k==='application_name'),'BUSINESS_DATABASE_ROUTE');
  if(admin)need(typeof password==='string'&&password.length>0&&!/[\r\n\0]/u.test(password),'BUSINESS_ADMIN_PASSWORD_REQUIRED');
  const p=new Pool({host:'haproxy.home.cz',port:5000,database,user:admin?'postgres':decodeURIComponent(u.username),password:admin?password:decodeURIComponent(u.password),max:1,connectionTimeoutMillis:3000,query_timeout:20000,ssl:{ca:ca.toString(),rejectUnauthorized:true,servername:'haproxy.home.cz'},application_name:'cop-business-schema-prep'});p.on('error',()=>{});pools.push(p);return p;};
 try{return await prepare({mode,business:pool(routes.targetUrl,'cop',mode==='apply'),guard:pool(routes.guardUrl,'cop_account_safety_guard',mode==='apply'),appRole:decodeURIComponent(new URL(routes.targetUrl).username),admission,expected:{...(cleanReset?{deletionScope:env.COP_ACCOUNT_ERASURE_SCOPE,resetEpoch:env.COP_USER_RESET_EPOCH,tokensNotBefore:Number(env.COP_USER_RESET_TOKENS_NOT_BEFORE)}:{}),guardStoreId:env.COP_ACCOUNT_SAFETY_GUARD_STORE_ID,applicationStoreId:env.COP_ACCOUNT_SAFETY_STORE_ID,incarnationId:env.COP_ACCOUNT_SAFETY_INCARNATION_ID,configurationFingerprint:createHash('sha256').update('cop-account-erasure-config-v1\0'+env.COP_ACCOUNT_ERASURE_SECRET).digest('hex')}});}finally{await Promise.all(pools.map(p=>p.end()));}
}
/** Import-only seam refuses every non-owned loopback fixture before connecting. */
export async function prepareBusinessErasureSchemaFixture(options){
 for(const[key,db]of[['business','cop_business_schema_test'],['guard','cop_business_schema_guard_test']]){
  const u=new URL(options[key].options.connectionString);need(u.hostname==='127.0.0.1'&&u.pathname==='/'+db&&u.username==='cop_business_schema_test_admin'&&!u.search&&!u.hash&&Number(u.port)>=1024&&Number(u.port)<=65535,'BUSINESS_FIXTURE_ONLY');need((await options[key].query('SHOW cluster_name')).rows[0]?.cluster_name==='cop_business_erasure_schema_test','BUSINESS_FIXTURE_CLUSTER');
 }
 need(options.appRole==='cop_business_schema_test_app','BUSINESS_FIXTURE_ROLE');return prepare(options);
}
