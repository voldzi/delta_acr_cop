/** Read existing protected COP runtime-profile secrets only into operator RAM.
 * No .env write, new route, TLS downgrade, Docker socket or profile creation. */
import {constants,openSync,closeSync,fstatSync,readFileSync,lstatSync} from 'node:fs';
import {hostname} from 'node:os';
import {parseEnvironment} from './provision-database-v2.mjs';
import {validateProfileProbe} from './image-profile-probe.mjs';
const ROOT='/srv/cop',PROFILES='/etc/vcode-cop-api-runtime';
const need=(v,c='OPERATOR_PROFILE_UNPROVEN')=>{if(!v)throw Error(c);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const keys=['COP_DATABASE_URL','COP_LEASE_DATABASE_URL','COP_STREAM_BUS_DATABASE_URL'];
export function parseOperatorHostEnvironment(text){
 need(typeof text==='string'&&Buffer.byteLength(text)<=1048576&&!text.includes('\0'),'OPERATOR_HOST_ENVIRONMENT_SCOPE');
 const lines=text.split(/\r?\n/u),positions=new Map();for(const[i,line]of lines.entries()){if(!line.trim()||/^\s*#/u.test(line))continue;const match=/^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);need(match,'OPERATOR_HOST_ENVIRONMENT_SCOPE');positions.set(match[1],[...(positions.get(match[1])??[]),i]);}
 const removed=new Set();for(const[key,indices]of positions)if(indices.length>1){need(['COP_DEPLOY_DOMAIN','COP_LAB_TOKEN'].includes(key)&&indices.length===2,'OPERATOR_HOST_ENVIRONMENT_SCOPE');removed.add(indices[0]);}
 return Object.fromEntries(parseEnvironment(lines.filter((_,index)=>!removed.has(index)).join('\n')));
}
export function operatorProfileDirectory(active){
 need(active?.contractVersion==='cop-api-runtime-active-v1'&&/^[a-f0-9]{32}$/u.test(active.generation??'')&&/^[a-f0-9]{64}$/u.test(active.containerId??'')&&/^sha256:[a-f0-9]{64}$/u.test(active.imageId??'')&&/^release-[a-f0-9]{32}$/u.test(active.releaseId??'')&&active.profileId===active.profileGeneration&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(active.profileGeneration??''),'OPERATOR_PROFILE_BINDING');
 return PROFILES+'/'+active.profileGeneration;
}
export const OPERATOR_PROFILE_HOST_CHECK=String.raw`
def operator_profile_witness(st,current,directory,profile,require):
 fresh=st.profile(current['profileId'],profile['driverContract'])
 require(current['profileGeneration']==fresh['generation'] and fresh['directory']==profile['directory'] and fresh['values']==profile['values'],'operator_profile_changed')
 actual=st.docker.current(directory);require(actual['Id']==current['containerId'] and actual['Image']==current['imageId'],'operator_profile_container_changed')
 values=dict(v.split('=',1) for v in actual['Config'].get('Env',[]) if '=' in v)
 require(all(values.get(key)==value for key,value in fresh['values'].items()),'operator_profile_runtime_changed')
 path=fresh['directory']/'runtime.env';info=path.stat()
 return {'directory':str(fresh['directory']),'values':fresh['values'],'metadata':(info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns)}
`;
function read(path,{uid,gid,mode,max}){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const s=fstatSync(fd);need(s.isFile()&&s.nlink===1&&s.uid===uid&&(gid===undefined||s.gid===gid)&&(s.mode&0o777)===mode&&s.size<=max,'OPERATOR_PROFILE_FILE_CUSTODY');const raw=readFileSync(fd),t=fstatSync(fd);need(s.dev===t.dev&&s.ino===t.ino&&s.size===t.size&&s.mtimeMs===t.mtimeMs&&s.ctimeMs===t.ctimeMs,'OPERATOR_PROFILE_FILE_CHANGED');return raw;}finally{closeSync(fd);}
}
export function profileOperatorEnvironment(hostEnvironment,profileValues){
 need(hostEnvironment&&typeof hostEnvironment==='object'&&!Array.isArray(hostEnvironment)&&profileValues&&typeof profileValues==='object'&&!Array.isArray(profileValues)&&same(Object.keys(profileValues).sort(),keys.map(k=>'COP_API_RUNTIME_'+k.slice(4)).sort()),'OPERATOR_PROFILE_SCOPE');
 const values=Object.fromEntries(keys.map(k=>[k,profileValues['COP_API_RUNTIME_'+k.slice(4)]]));need(keys.every(k=>typeof values[k]==='string'),'OPERATOR_PROFILE_INCOMPLETE');
 const selected=validateProfileProbe({...values,COP_DATABASE_POOL_MODE:'transaction'});
 return {...hostEnvironment,...selected};
}
function loadReviewedEnvironment(clean){
 need(process.getuid?.()===0&&hostname().split('.')[0]==='docker'&&Number(process.versions.node.split('.')[0])===24&&!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'OPERATOR_PROFILE_CONTEXT');
 const planPath=ROOT+(clean?'/runtime/clean-reset/plan.json':'/runtime/account-erasure-install/release-plan.json');
 const raw=read(ROOT+'/.env',{uid:1000,mode:0o600,max:1048576}),planRaw=read(planPath,{uid:0,mode:0o600,max:1048576}),plan=JSON.parse(planRaw),active=clean?plan.runtimeBinding:plan.expectedActive;
 if(clean)need(plan.contractVersion==='cop-sim-clean-reset-root-plan-v1'&&plan.scope==='cop_sim_shared_identity_v1'&&/^[a-f0-9]{40}$/u.test(plan.sources?.cop?.revision??'')&&active?.containerId===plan.localWriters?.['cop-cop-api-1']?.id&&active?.imageId===plan.localWriters?.['cop-cop-api-1']?.image,'OPERATOR_PROFILE_BINDING');
 else need(plan.contractVersion==='cop-production-erasure-install-v1'&&/^[a-f0-9]{40}$/u.test(plan.sourceRevision)&&/^sha256:[a-f0-9]{64}$/u.test(plan.imageId),'OPERATOR_PROFILE_BINDING');
 const directory=operatorProfileDirectory(active),d=lstatSync(directory);need(d.isDirectory()&&!d.isSymbolicLink()&&d.uid===0&&d.gid===1000&&(d.mode&0o777)===0o750,'OPERATOR_PROFILE_DIRECTORY_CUSTODY');
 const profileRaw=read(directory+'/runtime.env',{uid:0,gid:1000,mode:0o640,max:16384});
 const profileValues={};for(const line of profileRaw.toString().split(/\r?\n/u)){if(!line.trim()||line.startsWith('#'))continue;const m=/^(COP_API_RUNTIME_[A-Z_]+)='([^'\r\n]*)'$/u.exec(line);need(m&&!Object.hasOwn(profileValues,m[1]),'OPERATOR_PROFILE_SYNTAX');profileValues[m[1]]=m[2];}
 const env=profileOperatorEnvironment(parseOperatorHostEnvironment(raw.toString()),profileValues);
 need(read(ROOT+'/.env',{uid:1000,mode:0o600,max:1048576}).equals(raw)&&read(planPath,{uid:0,mode:0o600,max:1048576}).equals(planRaw)&&read(directory+'/runtime.env',{uid:0,gid:1000,mode:0o640,max:16384}).equals(profileRaw),'OPERATOR_PROFILE_INPUT_CHANGED');return env;
}

/** Separate Root-reviewed clean scope. Never consumes the former v1 release
 * plan as authority for a shared-identity clean deployment. Secrets stay in RAM. */
export function loadOperatorEnvironment(){return loadReviewedEnvironment(false)}
export function loadCleanOperatorEnvironment(){return loadReviewedEnvironment(true)}
