#!/usr/bin/env node
/** Read-only candidate compatibility checks. No server boot or startup DDL. */
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,openSync,closeSync,fstatSync,constants} from 'node:fs';
import {hostname} from 'node:os';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {parseEnvironment} from './provision-database-v2.mjs';
const SOCKET='/run/vcode-cop-pgbouncer',CA='/etc/vcode-cop-pgbouncer/postgres-ca.crt';
const UUID='2f93f595-b61b-4eea-9054-7afa9b275b5b',WORK='/data/cop-media-conversions';
const need=(v,code='IMAGE_PROFILE_PROBE_UNPROVEN')=>{if(!v)throw Error(code);};
export function validateProfileProbe(v){
 need(v&&v.COP_DATABASE_POOL_MODE==='transaction'&&v.COP_DATABASE_URL&&v.COP_LEASE_DATABASE_URL&&typeof v.COP_STREAM_BUS_DATABASE_URL==='string','IMAGE_PROFILE_INCOMPLETE');
 const main=new URL(v.COP_DATABASE_URL);need(['postgres:','postgresql:'].includes(main.protocol)&&decodeURIComponent(main.hostname)===SOCKET&&main.port==='6432'&&main.pathname==='/cop'&&!main.hash&&main.searchParams.get('sslmode')==='disable'&&[...main.searchParams.keys()].every(k=>['sslmode','application_name'].includes(k)),'IMAGE_PROFILE_UNIX_ROUTE');
 for(const key of ['COP_LEASE_DATABASE_URL','COP_STREAM_BUS_DATABASE_URL']){if(key==='COP_STREAM_BUS_DATABASE_URL'&&v[key]==='')continue;const u=new URL(v[key]);need(['postgres:','postgresql:'].includes(u.protocol)&&u.hostname==='haproxy.home.cz'&&u.port==='5000'&&u.pathname==='/cop'&&!u.hash&&u.searchParams.get('sslmode')==='verify-full'&&u.searchParams.get('sslrootcert')===CA&&[...u.searchParams.keys()].every(k=>['sslmode','sslrootcert','application_name'].includes(k)),'IMAGE_PROFILE_SESSION_ROUTE');}
 return v;
}
export function validateX5Probe(v){need(v?.workDir===WORK&&v.expectedStorageUuid===UUID&&typeof v.expectedDeviceId==='string'&&/^[1-9][0-9]*$/u.test(v.expectedDeviceId)&&Number.isSafeInteger(Number(v.expectedDeviceId))&&typeof v.expectedPresent==='boolean','IMAGE_PROFILE_X5_INPUT');return v;}
async function databaseProbe(input){
 const values=validateProfileProbe(input.values),ca=readFileSync(CA);
 const fd=openSync('/srv/cop/.env',constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let mainEnv;try{const st=fstatSync(fd);need(st.isFile()&&st.nlink===1&&st.uid===1000&&(st.mode&0o777)===0o600&&st.size<=1048576,'IMAGE_PROFILE_MAIN_ENV_CUSTODY');mainEnv=parseEnvironment(readFileSync(fd).toString().split(/\r?\n/u).filter(line=>/^(COP_DATABASE_URL|COP_STREAM_BUS)=/u.test(line)).join('\n'));}finally{closeSync(fd);}
 const mainUrl=new URL(mainEnv.get('COP_DATABASE_URL'));need(['postgres:','postgresql:'].includes(mainUrl.protocol)&&mainUrl.hostname==='haproxy.home.cz'&&mainUrl.port==='5000'&&mainUrl.pathname==='/cop'&&!mainUrl.hash&&(mainEnv.get('COP_STREAM_BUS')??'memory')==='memory','IMAGE_PROFILE_MAIN_ENV_NOT_DIRECT');need(createHash('sha256').update(ca).digest('hex')===input.caSha256,'IMAGE_PROFILE_CA_MISMATCH');
 const require=createRequire('/app/apps/cop-api/package.json');need(require('pg/package.json').version==='8.23.1','IMAGE_PROFILE_PG_VERSION');const {Pool}=require('pg');
 const {readCopDatabasePoolMode,resolveCopSessionDatabaseUrl}=await import('/app/apps/cop-api/dist/cop-session-database.js');
 need(readCopDatabasePoolMode(values)==='transaction','IMAGE_PROFILE_RUNTIME_MODE');for(const key of ['COP_LEASE_DATABASE_URL','COP_STREAM_BUS_DATABASE_URL'])if(values[key])need(resolveCopSessionDatabaseUrl(values,key)===values[key],'IMAGE_PROFILE_RUNTIME_SESSION');
 for(const key of ['COP_DATABASE_URL','COP_LEASE_DATABASE_URL','COP_STREAM_BUS_DATABASE_URL','MAIN_ENV_DIRECT']){
  if(key==='COP_STREAM_BUS_DATABASE_URL'&&values[key]==='')continue;const u=key==='MAIN_ENV_DIRECT'?mainUrl:new URL(values[key]),unix=key==='COP_DATABASE_URL',user=decodeURIComponent(u.username);need(user&&decodeURIComponent(u.password),'IMAGE_PROFILE_CREDENTIAL_MISSING');
  const pool=new Pool({host:unix?SOCKET:'haproxy.home.cz',port:unix?6432:5000,database:'cop',user,password:decodeURIComponent(u.password),max:1,connectionTimeoutMillis:3000,query_timeout:5000,ssl:unix?false:{ca:ca.toString(),rejectUnauthorized:true,servername:'haproxy.home.cz'},application_name:'cop-root-image-profile-readback'});pool.on('error',()=>{});
  let client;try{client=await pool.connect();await client.query('BEGIN READ ONLY');const actual=(await client.query("SELECT current_database() db,current_user actor,current_setting('transaction_read_only') ro")).rows;need(actual.length===1&&actual[0].db==='cop'&&actual[0].actor===user&&actual[0].ro==='on','IMAGE_PROFILE_SELECT_FAILED');if(!unix)need((await client.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0]?.ssl===true,'IMAGE_PROFILE_REMOTE_NOT_TLS');await client.query('COMMIT');}finally{client?.release();await pool.end();}
 }
 return {databaseRoutingVerified:true,readOnlySelects:values.COP_STREAM_BUS_DATABASE_URL?4:3,startupDdl:false};
}
async function x5Probe(input){
 const config=validateX5Probe(input),{AsyncMediaConversionManager}=await import('/app/apps/cop-api/dist/media-conversion.js');
 const run=async change=>{
  const id=randomUUID(),attachment={reportId:id,attachmentId:randomUUID(),fileName:'root-attestation.mov',objectKey:'synthetic-in-ram-only',kind:'video',status:'uploaded',metadata:{spatialVideo:{mode:'apple_mv_hevc'}}};
  let finish,timer;const complete=new Promise((resolve,reject)=>{finish=resolve;timer=setTimeout(()=>reject(Error('IMAGE_PROFILE_GUARD_TIMEOUT')),5000);});
  const manager=new AsyncMediaConversionManager({config:{enabled:true,ffmpegPath:'/cop-root-probe-no-executable',maxConcurrent:1,timeoutMs:1000,workDir:WORK,expectedStorageUuid:UUID,expectedDeviceId:config.expectedDeviceId,...change},mediaStorage:{getObject:async()=>({body:Buffer.from('SYNTHETIC_READ_ONLY_GUARD_PROBE')}),putObject:async()=>{throw Error('IMAGE_PROFILE_UNEXPECTED_MEDIA_WRITE');}},logger:{error:()=>{}},updateAttachmentMetadata:async value=>{const derivative=value.metadata?.spatialVideo?.xrDerivative;if(derivative?.status==='failed')finish(derivative.error);return {...attachment,metadata:value.metadata};}});
  try{await manager.enqueueAttachment({attachment,requestNow:new Date()});return await complete;}finally{clearTimeout(timer);manager.close();}
 };
 const rejected=error=>typeof error==='string'&&error.includes('Spatial conversion storage guard rejected unavailable or unverified storage.');
 if(!config.expectedPresent){need(rejected(await run({})),'IMAGE_PROFILE_MISSING_MOUNT_NOT_REJECTED');return {missingMountRejected:true};}
 // The real runtime guard must pass before the following deliberate RO write
 // fails. The synthetic source/metadata remain in RAM; no X5 file can be written.
 const positive=await run({});need(typeof positive==='string'&&positive.includes('EROFS'),'IMAGE_PROFILE_ACTUAL_X5_GUARD_FAILED');
 need(rejected(await run({expectedStorageUuid:'00000000-0000-4000-8000-000000000000'}))&&rejected(await run({expectedDeviceId:String(Number(config.expectedDeviceId)+1)})),'IMAGE_PROFILE_NEGATIVE_X5_GUARD_FAILED');
 return {actualX5GuardVerified:true,wrongUuidRejected:true,wrongDeviceRejected:true,x5Written:false};
}
async function main(){
 need(Number(process.versions.node.split('.')[0])===24&&process.getuid?.()===0&&hostname().split('.')[0]==='docker'&&!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'IMAGE_PROFILE_CONTEXT');const mode=process.argv[2];need(process.argv.length===3&&['--database','--x5-guard'].includes(mode),'IMAGE_PROFILE_OPERATION');
 const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;need(size<=65536,'IMAGE_PROFILE_INPUT_BOUND');chunks.push(chunk);}const input=JSON.parse(Buffer.concat(chunks).toString());const result=mode==='--database'?await databaseProbe(input):await x5Probe(input);console.log(JSON.stringify(result));
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{const code=typeof error?.message==='string'&&/^[A-Z_]{5,80}$/u.test(error.message)?error.message:'IMAGE_PROFILE_PROBE_UNPROVEN';console.error(JSON.stringify({phase:'image_profile_probe_failed',code}));process.exitCode=1;});
