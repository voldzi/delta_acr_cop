// Own Unix-socket-only cluster. No external URL or production target accepted.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,chmod,rm} from 'node:fs/promises';
import {realpathSync,statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {join,dirname} from 'node:path';
import {userTables,inspectCopUserReset,applyCopUserReset} from './clean-user-reset.mjs';
if(process.argv.length!==3||process.argv[2]!=='--run')throw Error('Only --run; no external targets');
const {Pool}=createRequire(new URL('../../apps/cop-api/package.json',import.meta.url))('pg');
const exec=promisify(execFile),bin='/opt/homebrew/opt/postgresql@18/bin';
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','HOME','USER','LOGNAME','LANG','LC_ALL','TMPDIR'].includes(k)));
const oldUmask=process.umask(0o077),root=await mkdtemp('/private/tmp/cop-clean-reset-pg-');
await chmod(root,0o700);await mkdir(join(root,'s'),{mode:0o700});
const pools=[];let started=false,checks=0;
function owned(){assert.equal(dirname(realpathSync(root)),'/private/tmp');assert.equal(statSync(root).uid,process.getuid());assert.equal(statSync(root).mode&0o777,0o700)}
async function start(){owned();await exec(join(bin,'pg_ctl'),['-D',join(root,'db'),'-l',join(root,'pg.log'),'-o',`-k ${join(root,'s')} -c listen_addresses=''`,'-w','start'],{env});started=true}
async function stop(){owned();await exec(join(bin,'pg_ctl'),['-D',join(root,'db'),'-m','fast','-w','stop'],{env});started=false}
function pool(database){const p=new Pool({host:join(root,'s'),port:5432,database,user:'fixture_owner',connectionTimeoutMillis:2000});pools.push(p);return p}
function check(value){assert.ok(value);checks++}
try{
 await exec(join(bin,'initdb'),['-D',join(root,'db'),'-U','fixture_owner','--auth-local=trust','--auth-host=reject','--no-locale'],{env});await start();
 const admin=pool('postgres');await admin.query('CREATE DATABASE cop');let db=pool('cop');
 const actual=(await db.query("SELECT current_setting('data_directory') d,current_setting('listen_addresses') l,inet_server_addr() a")).rows[0];check(actual.d===join(root,'db')&&actual.l===''&&actual.a===null);
 for(const t of userTables)await db.query('CREATE TABLE '+t+'(id int PRIMARY KEY,subject_id text)');
 await db.query('CREATE TABLE cop_mobility_v1(key text PRIMARY KEY,value jsonb)');
 for(const t of ['cop_driver_measurement_config','cop_federation_nodes','cop_track_history','cop_current_tracks']) {await db.query('CREATE TABLE '+t+'(id int PRIMARY KEY,configuration text)');await db.query('INSERT INTO '+t+" VALUES(1,'preserved synthetic control')");}
 for(const t of userTables)await db.query('INSERT INTO '+t+" VALUES(1,'synthetic-user-a')");
 await db.query('ALTER TABLE cop_community_report_confirmations ADD CONSTRAINT fixture_report_fk FOREIGN KEY(id) REFERENCES cop_community_reports');
 await db.query("INSERT INTO cop_mobility_v1 VALUES('identity:synthetic-a','{}'),('vehicle:synthetic-a','{}'),('system-configuration','{\"keep\":true}')");
 await db.query("CREATE TABLE cop_community_erasure_ownership(id int PRIMARY KEY,subject_id text); INSERT INTO cop_community_erasure_ownership VALUES(1,'synthetic A')");
 await db.query("CREATE TABLE cop_domain_events(id int PRIMARY KEY,entity_type text NOT NULL,payload text); INSERT INTO cop_domain_events VALUES(1,'auditRecord','synthetic user audit'),(2,'sensorObservation','preserved provider sentinel')");
 const auth={contractVersion:'cop-clean-user-reset-authorization-v1',allCopWritersStopped:true,oldIdentityAdmissionClosed:true,testDataDestructionApproved:true,createOldDataBackup:false,resetEpoch:randomUUID(),tokensNotBefore:1792195200};
 const p=await inspectCopUserReset(db);check(p.kv.user_rows===2&&p.kv.total===3);
 await assert.rejects(applyCopUserReset(db,p,{...auth,testDataDestructionApproved:false}),/RESET_AUTHORIZATION_REQUIRED/);checks++;
 await assert.rejects(applyCopUserReset(db,{...p,counts:{}},auth),/RESET_AUTHORIZATION_REQUIRED/);checks++;
 await db.query("INSERT INTO cop_user_profiles VALUES(2,'synthetic-racing-writer')");
 await assert.rejects(applyCopUserReset(db,p,auth),/RESET_PLAN_CHANGED/);checks++;
 check(Number((await db.query('SELECT count(*) n FROM cop_community_reports')).rows[0].n)===1);
 await db.query('CREATE TABLE external_dependent(id int REFERENCES cop_user_profiles)');
 await assert.rejects(inspectCopUserReset(db),/UNPLANNED_FOREIGN_KEY/);checks++;
 await db.query('DROP TABLE external_dependent');
 // Deliberately fail after TRUNCATE. PostgreSQL must roll back all removed rows.
 await db.query('ALTER TABLE cop_user_profiles ADD COLUMN issuer text');
 await db.query("ALTER TABLE cop_user_profiles ADD CONSTRAINT cop_clean_profile_issuer CHECK(issuer IS NULL OR issuer<>'forbidden')");
 const latest=await inspectCopUserReset(db);
 await assert.rejects(applyCopUserReset(db,latest,auth));checks++;
 check(Number((await db.query('SELECT count(*) n FROM cop_user_profiles')).rows[0].n)===2);
 check(Number((await db.query('SELECT count(*) n FROM cop_mobility_v1')).rows[0].n)===3);
 await db.query('ALTER TABLE cop_user_profiles DROP CONSTRAINT cop_clean_profile_issuer');
 const result=await applyCopUserReset(db,await inspectCopUserReset(db),auth);
 check(result.removedRows===userTables.length+5&&result.configurationPreserved&&result.oldDataBackupCreated===false);
 for(const t of userTables)check(Number((await db.query('SELECT count(*) n FROM '+t)).rows[0].n)===0);
 check((await db.query('SELECT key FROM cop_mobility_v1')).rows[0].key==='system-configuration');
 check(Number((await db.query('SELECT count(*) n FROM cop_community_erasure_ownership')).rows[0].n)===0);
 check((await db.query('SELECT entity_type,payload FROM cop_domain_events')).rows[0].payload==='preserved provider sentinel');

 for(const t of ['cop_driver_measurement_config','cop_federation_nodes','cop_track_history','cop_current_tracks'])check((await db.query('SELECT configuration FROM '+t)).rows[0].configuration==='preserved synthetic control');
 await assert.rejects(db.query("INSERT INTO cop_user_profiles(id,subject_id) VALUES(1,'10000000-0000-4000-8000-000000000001')"));checks++;
 await db.query("INSERT INTO cop_user_profiles(id,subject_id,issuer) VALUES(1,'10000000-0000-4000-8000-000000000001','https://identity.synthetic.invalid/realms/cop')");
 await assert.rejects(applyCopUserReset(db,await inspectCopUserReset(db),{...auth,resetEpoch:randomUUID()}),/RESET_ALREADY_ENROLLED/);checks++;
 check(Number((await db.query('SELECT count(*) n FROM cop_user_profiles')).rows[0].n)===1);
 await Promise.all(pools.map(p=>p.end()));await stop();await start();db=pool('cop');
 check((await db.query('SELECT reset_epoch FROM cop_clean_reset_epoch')).rows[0].reset_epoch===auth.resetEpoch);
 check(Number((await db.query('SELECT count(*) n FROM cop_community_reports')).rows[0].n)===0);
 console.log(JSON.stringify({contractVersion:'cop-clean-user-reset-test-v1',checks,postgresRestarted:true,rollbackVerified:true,providerAndConfigurationPreserved:true,productionTouched:false}));
}finally{await Promise.all(pools.filter(p=>!p.ended).map(p=>p.end().catch(()=>{})));if(started)await stop();owned();await rm(root,{recursive:true,force:true});process.umask(oldUmask)}
