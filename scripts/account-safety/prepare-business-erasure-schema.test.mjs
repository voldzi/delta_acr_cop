import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { prepareBusinessErasureSchemaFixture } from './prepare-business-erasure-schema.mjs';
const {Pool}=createRequire(new URL('../../apps/cop-api/package.json',import.meta.url))('pg');
const url=process.env.COP_BUSINESS_SCHEMA_TEST_URL;
const tables=['cop_content_erasure_fences','cop_content_erasure_component_proofs','cop_content_erasure_projection_manifest','cop_community_erasure_ownership','cop_community_owned_media','cop_community_metadata_owners','cop_community_media_write_leases','cop_content_erasure_media_manifest','cop_runtime_owner_fences'];
const expected={guardStoreId:'36c4e7a7-61fa-4097-b0e6-92024371f4dd',applicationStoreId:'b34bc2ca-bc5d-4252-9fb8-bc27fc71f530',incarnationId:'d6303a9f-5304-47e5-90b5-fd928ed77590',configurationFingerprint:'a'.repeat(64)};
let business,guard;
const run=mode=>prepareBusinessErasureSchemaFixture({mode,business,guard,expected,appRole:'cop_business_schema_test_app'});
const missing=async()=>{const r=await business.query("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND relname=ANY($1)",[tables]);return tables.length-r.rows.length;};
describe('actual owned PostgreSQL narrow first-enrollment DDL',{skip:!url,concurrency:false},()=>{
 before(async()=>{
  business=new Pool({connectionString:url,max:3});const guardUrl=new URL(url);guardUrl.pathname='/cop_business_schema_guard_test';guard=new Pool({connectionString:guardUrl.href,max:2});
  assert.equal((await business.query('SHOW cluster_name')).rows[0].cluster_name,'cop_business_erasure_schema_test');
  await business.query('SET ROLE cop_business_schema_test_app; CREATE TABLE cop_mobility_v1(key text PRIMARY KEY,value jsonb NOT NULL); RESET ROLE');
  await guard.query(`CREATE SCHEMA cop_safety_v2;CREATE TABLE cop_safety_v2.configuration(singleton boolean,contract_version text,guard_store_id uuid,application_store_id uuid,configuration_fingerprint text,initial_digest text);
   CREATE TABLE cop_safety_v2.dataset_replays(owner text,store_id uuid,incarnation_id uuid,restore_generation bigint,replay_sequence bigint,replay_digest text);CREATE TABLE cop_safety_v2.fences(sequence bigint);`);
 });
 beforeEach(async()=>{
  await business.query('DROP TABLE IF EXISTS public.cop_clean_reset_epoch');
  await business.query('DROP TABLE IF EXISTS '+tables.map(v=>'public.'+v).join(',')+' CASCADE');
  await business.query('TRUNCATE cop_mobility_v1');
  await business.query('INSERT INTO cop_mobility_v1 VALUES($1,$2),($3,$4)',[
   'account-safety:store-identity-v1',{storeId:expected.applicationStoreId,incarnationId:expected.incarnationId},
   'account-erasure:configuration-v1',{version:4,storeId:expected.applicationStoreId,fingerprint:expected.configurationFingerprint,datasetBinding:{incarnationId:expected.incarnationId,restoreGeneration:1}}]);
  await guard.query('TRUNCATE cop_safety_v2.configuration,cop_safety_v2.dataset_replays,cop_safety_v2.fences');
  await guard.query("INSERT INTO cop_safety_v2.configuration VALUES(true,'cop-database-safety-v2',$1,$2,$3,$4)",[expected.guardStoreId,expected.applicationStoreId,expected.configurationFingerprint,'b'.repeat(64)]);
  await guard.query("INSERT INTO cop_safety_v2.dataset_replays VALUES('cop',$1,$2,1,0,$3)",[expected.applicationStoreId,expected.incarnationId,'b'.repeat(64)]);
 });
 after(async()=>{await business?.end();await guard?.end();});
 it('check reports missing tables explicitly, never missing table as zero leases',async()=>{const r=await run('check');assert.equal(r.schemaReady,false);assert.equal(r.zeroWriteLeases,null);assert.equal(r.missingTables.length,9);assert.equal(await missing(),9);});
 it('creates precisely actual exported schemas under the existing app owner and is idempotent',async()=>{const r=await run('apply');assert.equal(r.schemaReady,true);assert.equal(r.zeroWriteLeases,true);assert.equal(r.createdTables.length,9);assert.equal(await missing(),0);const second=await run('apply');assert.deepEqual(second.createdTables,[]);assert.equal(second.catalogDigest,r.catalogDigest);assert.equal((await run('check')).schemaReady,true);});
 it('does not modify existing application contributions or grant roles',async()=>{await run('apply');await business.query("INSERT INTO cop_community_owned_media VALUES('synthetic-bucket','synthetic-b-object','synthetic-b-subject',NULL,now())");const before=(await business.query('SELECT * FROM cop_community_owned_media')).rows;const grants=(await business.query("SELECT oid,rolname,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles ORDER BY oid")).rows;await run('apply');assert.deepEqual((await business.query('SELECT * FROM cop_community_owned_media')).rows,before);assert.deepEqual((await business.query("SELECT oid,rolname,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles ORDER BY oid")).rows,grants);});
 it('rejects existing column drift before any missing table creation',async()=>{await run('apply');await business.query('ALTER TABLE cop_community_owned_media ADD COLUMN unexpected text;DROP TABLE cop_runtime_owner_fences');await assert.rejects(run('apply'),/BUSINESS_COLUMN_DRIFT/);assert.equal(await missing(),1);});
 it('rejects foreign key and index drift',async()=>{await run('apply');await business.query('ALTER TABLE cop_content_erasure_component_proofs DROP CONSTRAINT cop_content_erasure_component_proofs_owner_key_fkey');await assert.rejects(run('apply'),/BUSINESS_CONSTRAINT_DRIFT/);await business.query('ALTER TABLE cop_content_erasure_component_proofs ADD FOREIGN KEY(owner_key) REFERENCES cop_content_erasure_fences(owner_key)');await business.query('DROP INDEX cop_community_erasure_ownership_owner_idx');await assert.rejects(run('apply'),/BUSINESS_INDEX_DRIFT/);});
 it('rejects a changed table owner before creating another missing table',async()=>{await run('apply');await business.query('ALTER TABLE cop_community_owned_media OWNER TO cop_business_schema_test_admin;DROP TABLE cop_runtime_owner_fences');await assert.rejects(run('apply'),/BUSINESS_TABLE_DRIFT/);assert.equal(await missing(),1);});
 it('rejects existing RLS and rewrite rules rather than modifying them',async()=>{await run('apply');await business.query('ALTER TABLE cop_community_owned_media ENABLE ROW LEVEL SECURITY');await assert.rejects(run('apply'),/BUSINESS_TABLE_DRIFT/);await business.query('ALTER TABLE cop_community_owned_media DISABLE ROW LEVEL SECURITY;CREATE RULE fixture_skip AS ON INSERT TO cop_community_owned_media DO INSTEAD NOTHING');await assert.rejects(run('apply'),/BUSINESS_TABLE_DRIFT/);});
 it('never removes an unsettled lease and rolls back all new DDL',async()=>{await run('apply');await business.query("INSERT INTO cop_community_media_write_leases VALUES('abc86018-23e3-4d0f-9d66-291139d40bd8','synthetic-bucket','synthetic-object','synthetic-user','https://synthetic.invalid/')");await business.query('DROP TABLE cop_runtime_owner_fences');await assert.rejects(run('apply'),/BUSINESS_EXISTING_ERASURE_STATE/);assert.equal(await missing(),1);assert.equal((await business.query('SELECT count(*)::int n FROM cop_community_media_write_leases')).rows[0].n,1);});
 it('rejects changed independent and local bindings',async()=>{await guard.query("UPDATE cop_safety_v2.configuration SET configuration_fingerprint=repeat('c',64)");await assert.rejects(run('apply'),/BUSINESS_GUARD_BINDING_CHANGED/);assert.equal(await missing(),9);await guard.query('UPDATE cop_safety_v2.configuration SET configuration_fingerprint=$1',[expected.configurationFingerprint]);await business.query("UPDATE cop_mobility_v1 SET value=jsonb_set(value,'{incarnationId}',to_jsonb('abc86018-23e3-4d0f-9d66-291139d40bd8'::text)) WHERE key='account-safety:store-identity-v1'");await assert.rejects(run('apply'),/BUSINESS_LOCAL_BINDING_CHANGED/);});
 it('refuses progressed journal, accepted jobs and local erasure evidence',async()=>{await guard.query('INSERT INTO cop_safety_v2.fences VALUES(1)');await assert.rejects(run('apply'),/BUSINESS_NOT_FIRST_ENROLLMENT/);await guard.query('TRUNCATE cop_safety_v2.fences');await business.query("INSERT INTO cop_mobility_v1 VALUES('account-erasure:job:synthetic','{}')");await assert.rejects(run('apply'),/BUSINESS_NOT_FIRST_ENROLLMENT/);await business.query("DELETE FROM cop_mobility_v1 WHERE key LIKE 'account-erasure:job:%'");await run('apply');await business.query("INSERT INTO cop_runtime_owner_fences VALUES('synthetic','hash','hash','operation',now())");await assert.rejects(run('apply'),/BUSINESS_EXISTING_ERASURE_STATE/);});
 it('uses the actual guard row lock and times out without partial DDL',async()=>{const c=await guard.connect();try{await c.query('BEGIN');await c.query('UPDATE cop_safety_v2.configuration SET singleton=singleton');await assert.rejects(run('apply'),/BUSINESS_ERASURE_SCHEMA_UNPROVEN/);assert.equal(await missing(),9);}finally{await c.query('ROLLBACK');c.release();}});
 it('clean scope requires its actual reset witness and rolls back DDL when live admission is lost',async()=>{
  const clean={...expected,deletionScope:'cop_sim_shared_identity_v1',resetEpoch:'10000000-0000-4000-8000-000000000001',tokensNotBefore:1792195200};
  const options={mode:'apply',business,guard,expected:clean,appRole:'cop_business_schema_test_app'};
  await assert.rejects(prepareBusinessErasureSchemaFixture(options),/BUSINESS_CLEAN_ADMISSION_REQUIRED/);
  await business.query("UPDATE cop_mobility_v1 SET value=jsonb_set(value,'{deletionScope}',to_jsonb('cop_sim_shared_identity_v1'::text)) WHERE key='account-erasure:configuration-v1'");
  await business.query('CREATE TABLE public.cop_clean_reset_epoch(singleton boolean,reset_epoch uuid,tokens_not_before bigint,scope text); GRANT SELECT ON public.cop_clean_reset_epoch TO cop_business_schema_test_app');
  await business.query('INSERT INTO public.cop_clean_reset_epoch VALUES(true,$1,$2,$3)',[clean.resetEpoch,clean.tokensNotBefore,clean.deletionScope]);
  let calls=0;
  await assert.rejects(prepareBusinessErasureSchemaFixture({...options,admission:{async assertCurrent(){if(++calls===2)throw Error('BUSINESS_SYNTHETIC_ADMISSION_LOST')}}}),/BUSINESS_SYNTHETIC_ADMISSION_LOST/);
  assert.equal(await missing(),9);
  const admission={async assertCurrent(){}};
  await assert.rejects(prepareBusinessErasureSchemaFixture({...options,expected:{...clean,tokensNotBefore:clean.tokensNotBefore+1},admission}),/BUSINESS_CLEAN_RESET_UNPROVEN/);
  assert.equal(await missing(),9);
  const r=await prepareBusinessErasureSchemaFixture({...options,admission});assert.equal(r.schemaReady,true);assert.equal(await missing(),0);
  const reader=await business.connect();try{await reader.query('SET ROLE cop_business_schema_test_app');assert.equal((await reader.query('SELECT scope FROM public.cop_clean_reset_epoch')).rows[0].scope,clean.deletionScope);await assert.rejects(reader.query('UPDATE public.cop_clean_reset_epoch SET tokens_not_before=1'),error=>error.code==='42501');}finally{await reader.query('RESET ROLE');reader.release();}
 });
 it('refuses a non-owned fixture route before connecting',async()=>{await assert.rejects(prepareBusinessErasureSchemaFixture({mode:'apply',business:{options:{connectionString:'postgresql://cop_business_schema_test_admin@production.invalid:5432/cop_business_schema_test'}},guard,expected,appRole:'cop_business_schema_test_app'}),/BUSINESS_FIXTURE_ONLY/);});
});
