#!/usr/bin/env node
/** One human-approved production closure, not a privileged service. Keys travel
 * only in RAM over SSH/stdin and into the two existing production secret files.
 * No production work runs on import. Intake stays disabled; no leases are aged
 * out and no old credential is restored. */
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,readFileSync,writeFileSync,fsyncSync,fchownSync,fchmodSync,renameSync,unlinkSync,existsSync,mkdirSync,rmdirSync,lstatSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {request as httpRequest} from 'node:http';
import {hostname} from 'node:os';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {validatePlan,validateWholeReceipt,checkedCandidateClosure} from './install-production-erasure.mjs';
import {parseEnvironment} from './provision-database-v2.mjs';
import {loadOperatorEnvironment,OPERATOR_PROFILE_HOST_CHECK} from './operator-profile-environment.mjs';
let profileStorageLock;
const ROOT='/srv/cop',DIR=ROOT+'/runtime/account-erasure-install',PLAN=DIR+'/release-plan.json',CLOSURE_PLAN=DIR+'/media-closure-plan.json';
const SELF='scripts/account-safety/install-media-upload-closure.mjs',SQL='scripts/account-safety/011_media_upload_closure.sql';
const ENDPOINT='http://storage.home.cz:8333',BUCKET='cop-community-media';
export const PROVIDER_REFERENCE='chrislusf/seaweedfs@sha256:fc9f76fa993ad69966ffeb2f65d0318fcae39c6f8e20cf68ef7b3a5cb97769e5';
const CA='/etc/vcode-cop-pgbouncer/postgres-ca.crt';
const CA_SHA='7a3f9d9373cd63361148230e6c2804c6fb76dc204e18d5039aad7c7838d7a14a';
const hex=/^[a-f0-9]{64}$/u,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const need=(v,code='MEDIA_CLOSURE_UNPROVEN')=>{if(!v)throw Error(code);};
const sha=v=>createHash('sha256').update(v).digest('hex');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const same=(a,b)=>canonical(a)===canonical(b);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&same(Object.keys(v).sort(),[...keys].sort());
export function validateClosurePlan(p,release){
 need(exact(p,['contractVersion','providerContainerId','providerImageId','otherIdentity','otherBucket','writerContainerIds']),'MEDIA_PLAN_SCHEMA');
 need(p.contractVersion==='cop-production-media-closure-v1'&&hex.test(p.providerContainerId)&&/^sha256:[a-f0-9]{64}$/u.test(p.providerImageId)&&typeof p.otherIdentity==='string'&&/^[A-Za-z0-9_-]{1,80}$/u.test(p.otherIdentity)&&p.otherIdentity!=='cop-production'&&typeof p.otherBucket==='string'&&/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(p.otherBucket)&&p.otherBucket!==BUCKET,'MEDIA_PLAN_SCOPE');
 // Actual production has one API process; converters are threads in that CID.
 need(Array.isArray(p.writerContainerIds)&&same(p.writerContainerIds,[release.expectedActive.containerId]),'MEDIA_WRITERS_NOT_EXACT');
 return p;
}
/** Bounded, non-entity XML for the fixed S3 versions response. No prefix
 * neighbour, pagination, duplicate version or ambiguous key may authorize a
 * delete. Only caller-owned UUID canaries are queried by the CLI. */
export function exactCanaryVersions(xml,key){
 need(typeof xml==='string'&&Buffer.byteLength(xml)<=262144&&!/<!|<\?(?!xml\s)/u.test(xml),'MEDIA_VERSION_INVENTORY_INVALID');
 xml=xml.replace(/^\s*<\?xml[^?]*\?>/u,'');const root={name:'document',children:[],text:''},stack=[root];let offset=0;
 const text=value=>{need(!/&(?!(?:amp|lt|gt|quot|apos|#[0-9]{1,8}|#x[0-9A-Fa-f]{1,6});)/u.test(value),'MEDIA_VERSION_XML_ENTITY');return value.replace(/&(amp|lt|gt|quot|apos|#[0-9]{1,8}|#x[0-9A-Fa-f]{1,6});/gu,(_,name)=>{if(!name.startsWith('#'))return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[name];const point=name.startsWith('#x')?Number.parseInt(name.slice(2),16):Number.parseInt(name.slice(1),10);need([9,10,13].includes(point)||point>=0x20&&point<=0xd7ff||point>=0xe000&&point<=0xfffd||point>=0x10000&&point<=0x10ffff,'MEDIA_VERSION_XML_CODEPOINT');return String.fromCodePoint(point);});};
 for(const token of xml.matchAll(/<[^>]*>/gu)){
  stack.at(-1).text+=text(xml.slice(offset,token.index));offset=token.index+token[0].length;
  const close=/^<\/([A-Za-z][A-Za-z0-9]*)\s*>$/u.exec(token[0]);if(close){need(stack.length>1&&stack.at(-1).name===close[1],'MEDIA_VERSION_XML_BALANCE');stack.pop();continue;}
  const open=/^<([A-Za-z][A-Za-z0-9]*)(\s+xmlns=["']http:\/\/s3\.amazonaws\.com\/doc\/2006-03-01\/["'])?\s*(\/)?>$/u.exec(token[0]);need(open&&(!open[2]||open[1]==='ListVersionsResult')&&stack.length<8,'MEDIA_VERSION_XML_TAG');const node={name:open[1],children:[],text:''};stack.at(-1).children.push(node);if(!open[3])stack.push(node);
 }
 stack.at(-1).text+=text(xml.slice(offset));need(stack.length===1&&!root.text.trim()&&root.children.length===1&&root.children[0].name==='ListVersionsResult','MEDIA_VERSION_XML_ROOT');
 const result=root.children[0],one=(node,name)=>{const values=node.children.filter(v=>v.name===name);need(values.length===1&&values[0].children.length===0,'MEDIA_VERSION_XML_FIELD');return values[0].text;};
 need(!result.text.trim()&&one(result,'Name')===BUCKET&&one(result,'Prefix')===key&&one(result,'IsTruncated')==='false','MEDIA_VERSION_INVENTORY_SCOPE');
 const known=new Set(['Name','Prefix','KeyMarker','VersionIdMarker','MaxKeys','Delimiter','IsTruncated','NextKeyMarker','NextVersionIdMarker','EncodingType']);
 const seen=new Set(),versions=[];for(const node of result.children){if(known.has(node.name)){need(!seen.has(node.name)&&node.children.length===0,'MEDIA_VERSION_DUPLICATE_FIELD');seen.add(node.name);continue;}need(['Version','DeleteMarker'].includes(node.name)&&versions.length<100&&!node.text.trim(),'MEDIA_VERSION_INVENTORY_UNKNOWN');need(one(node,'Key')===key,'MEDIA_VERSION_PREFIX_NEIGHBOUR');const versionId=one(node,'VersionId');need(/^[A-Za-z0-9_+/=.~-]{1,1024}$/u.test(versionId)&&!versions.some(v=>v.versionId===versionId),'MEDIA_VERSION_ID_INVALID');for(const child of node.children)need(['Key','VersionId','IsLatest','LastModified','ETag','Size','StorageClass','Owner','ChecksumAlgorithm','ChecksumType'].includes(child.name),'MEDIA_VERSION_METADATA_UNKNOWN');versions.push({versionId});}
 return versions;
}
export function validateRuntimeMediaProbe(env,key){
 need(env?.COP_ACCOUNT_SAFETY_GUARD_REQUIRED==='true'&&env.COP_MEDIA_UPLOAD_TRANSPORT==='cop_api'&&env.COP_MEDIA_S3_ENDPOINT===ENDPOINT&&env.COP_MEDIA_S3_BUCKET===BUCKET&&(env.COP_MEDIA_S3_REGION??'us-east-1')==='us-east-1'&&/^community-reports\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/release-check\.txt$/u.test(key),'MEDIA_RUNTIME_CANARY_SCOPE');return true;
}
/** Actual exact candidate runtime credentials, with an owned synthetic key only.
 * The Root caller records the key privately before starting, allowing cleanup
 * after an interrupted probe. No user account, report row or media lease exists. */
export async function verifyRuntimeMediaRoundTrip(key,resume=false){
 validateRuntimeMediaProbe(process.env,key);need(typeof resume==='boolean','MEDIA_RUNTIME_CANARY_SCOPE');
 const {createMediaStorageFromEnv}=await import('/app/apps/cop-api/dist/media-storage.js'),storage=createMediaStorageFromEnv(process.env);need(storage,'MEDIA_RUNTIME_STORAGE_MISSING');
 const credential={accessKeyId:process.env.COP_MEDIA_S3_ACCESS_KEY_ID,secretAccessKey:process.env.COP_MEDIA_S3_SECRET_ACCESS_KEY};
 const signed=(objectKey,method,query={})=>signedClosureRequest({credential,bucket:BUCKET,objectKey,method,query});
 const versions=async()=>{const response=await signed('','GET',{versions:'',prefix:key,'max-keys':'100'});need(response.status===200,'MEDIA_RUNTIME_VERSIONS_FAILED');return exactCanaryVersions(await boundedText(response),key);};
 const cleanup=async()=>{for(const entry of await versions()){const response=await signed(key,'DELETE',{versionId:entry.versionId});await response.body?.cancel();need(response.ok||response.status===404,'MEDIA_RUNTIME_DELETE_FAILED');}need((await versions()).length===0,'MEDIA_RUNTIME_VERSION_REMAINS');const response=await signed(key,'HEAD');await response.body?.cancel();need(response.status===404,'MEDIA_RUNTIME_CANARY_REMAINS');};
 if(resume)await cleanup();else{need((await versions()).length===0,'MEDIA_RUNTIME_CANARY_COLLISION');const absent=await signed(key,'HEAD');await absent.body?.cancel();need(absent.status===404,'MEDIA_RUNTIME_CANARY_COLLISION');}try{await storage.putObject({objectKey:key,contentType:'text/plain',body:Buffer.from('COP_RELEASE_MEDIA_CANARY')},new Date());need((await storage.getObject({objectKey:key},new Date())).body.toString()==='COP_RELEASE_MEDIA_CANARY','MEDIA_RUNTIME_READ_WRITE_FAILED');}finally{await cleanup();}
 return {verified:true,canaryRemoved:true};
}
async function boundedText(response,max=262144){
 need(response.body,'MEDIA_RESPONSE_BODY_MISSING');const reader=response.body.getReader(),chunks=[];let size=0;try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;need(size<=max,'MEDIA_RESPONSE_TOO_LARGE');chunks.push(part.value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}return Buffer.concat(chunks).toString('utf8');
}
function privateFile(path,uid){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const s=fstatSync(fd);need(s.isFile()&&s.nlink===1&&s.size<=1048576&&(s.mode&0o777)===0o600&&(uid===undefined||s.uid===uid),'MEDIA_PRIVATE_FILE');const bytes=readFileSync(fd),t=fstatSync(fd);need(s.ino===t.ino&&s.size===t.size&&s.mtimeMs===t.mtimeMs&&s.ctimeMs===t.ctimeMs&&bytes.length===s.size,'MEDIA_FILE_CHANGED');return {bytes,stat:s};}finally{closeSync(fd);}
}
function atomic(path,original,bytes){
 const current=privateFile(path,original.stat.uid);need(current.stat.ino===original.stat.ino&&current.bytes.equals(original.bytes),'MEDIA_ENV_CHANGED');
 const temp=path+'.media-atomic-'+randomBytes(12).toString('hex');let fd;
 try{fd=openSync(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);fchownSync(fd,original.stat.uid,original.stat.gid);fchmodSync(fd,0o600);writeFileSync(fd,bytes);fsyncSync(fd);closeSync(fd);fd=undefined;const again=privateFile(path,original.stat.uid);need(again.stat.ino===original.stat.ino&&again.bytes.equals(original.bytes),'MEDIA_ENV_CHANGED');renameSync(temp,path);const dir=openSync(dirname(path),constants.O_RDONLY);try{fsyncSync(dir);}finally{closeSync(dir);}}finally{if(fd!==undefined)closeSync(fd);try{unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
 need(privateFile(path,original.stat.uid).bytes.equals(bytes),'MEDIA_SECRET_READBACK');
}
export function replaceMediaEnvironment(bytes,credential){
 const env=parseEnvironment(bytes.toString());need(!env.has('COP_ACCOUNT_ERASURE_ENABLED')||env.get('COP_ACCOUNT_ERASURE_ENABLED')==='false','MEDIA_INTAKE_NOT_DISABLED');
 for(const value of [credential.accessKeyId,credential.secretAccessKey])need(typeof value==='string'&&/^[A-Za-z0-9_-]{32,128}$/u.test(value),'MEDIA_NEW_CREDENTIAL_INVALID');
 const updates=new Map([['COP_MEDIA_S3_ACCESS_KEY_ID',credential.accessKeyId],['COP_MEDIA_S3_SECRET_ACCESS_KEY',credential.secretAccessKey],['COP_MEDIA_UPLOAD_TRANSPORT','cop_api']]);
 const lines=bytes.toString().split('\n');for(const[k,v]of updates){const i=lines.findIndex(line=>line.startsWith(k+'='));if(i>=0)lines[i]=k+'='+v;else lines.splice(lines.at(-1)===''?lines.length-1:lines.length,0,k+'='+v);}
 const result=Buffer.from(lines.join('\n')),after=parseEnvironment(result.toString());for(const[k,v]of env)if(!updates.has(k))need(after.get(k)===v,'MEDIA_ENV_SCOPE');return result;
}
function command(args,input,timeout=60000){
 const r=spawnSync(args[0],args.slice(1),{input,encoding:'utf8',timeout,maxBuffer:4*1048576,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C',PYTHONDONTWRITEBYTECODE:'1'}});
 need(!r.error&&r.status===0,'MEDIA_COMMAND_FAILED');return r.stdout;
}
const docker=(...args)=>command(['docker','--host','unix:///var/run/docker.sock',...args]);
const inspect=id=>JSON.parse(docker('inspect',id))[0];
const quoted=s=>"'"+s.replaceAll("'","'\\''")+"'";
export const STORAGE_PROGRAM=String.raw`
import hashlib,json,os,pathlib,socket,stat,subprocess,sys,tempfile
CONFIG=pathlib.Path('/srv/seaweedfs/config/s3.json')
REFERENCE='chrislusf/seaweedfs@sha256:fc9f76fa993ad69966ffeb2f65d0318fcae39c6f8e20cf68ef7b3a5cb97769e5'
def require(v):
 if not v:raise RuntimeError('storage_closure_unproven')
def call(*args):
 r=subprocess.run(['docker','--host','unix:///var/run/docker.sock',*args],capture_output=True,text=True,timeout=90)
 require(r.returncode==0);return r.stdout
def spec(c):return {k:c[k] for k in ('Id','Image','Path','Args','Config','HostConfig','Mounts')}
def inspect(cid,image_id):
 c=json.loads(call('inspect',cid))[0]
 require(c['Id']==cid and c['Name']=='/seaweedfs' and c['Image']==image_id)
 image=json.loads(call('image','inspect',image_id))[0];require(image['Id']==image_id and REFERENCE in image.get('RepoDigests',[]))
 require(c['Args']==['server','-dir=/data','-ip.bind=0.0.0.0','-s3','-s3.port=8333','-s3.config=/etc/seaweedfs/s3.json'])
 require(any(m['Type']=='bind' and m['Source']==str(CONFIG) and m['Destination']=='/etc/seaweedfs/s3.json' and not m['RW'] for m in c['Mounts']))
 require(any(m['Type']=='bind' and m['Source']=='/srv/seaweedfs/data' and m['Destination']=='/data' for m in c['Mounts']))
 return c
def read():
 fd=os.open(CONFIG,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);require(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_size<=1048576 and not s.st_mode&0o022)
  raw=os.read(fd,1048577);t=os.fstat(fd);require(len(raw)==s.st_size and (s.st_ino,s.st_mtime_ns,s.st_ctime_ns)==(t.st_ino,t.st_mtime_ns,t.st_ctime_ns))
  return raw,s
 finally:os.close(fd)
def rotate(raw,old,new):
 c=json.loads(raw);selected=[v for v in c['identities'] if v['name']=='cop-production'];require(len(selected)==1)
 require(selected[0]['credentials']==[{'accessKey':old['accessKeyId'],'secretKey':old['secretAccessKey']}])
 before=json.dumps(c,sort_keys=True);selected[0]['credentials']=[{'accessKey':new['accessKeyId'],'secretKey':new['secretAccessKey']}]
 after=json.loads(json.dumps(c));[v for v in after['identities'] if v['name']=='cop-production'][0]['credentials']=[{'accessKey':old['accessKeyId'],'secretKey':old['secretAccessKey']}]
 require(json.dumps(after,sort_keys=True)==before)
 return (json.dumps(c,separators=(',',':'))+'\n').encode()
def main():
 require(os.getuid()==0 and socket.gethostname().split('.')[0]=='storage')
 p=json.load(sys.stdin);require(p['phase'] in ('inspect','stop','rotate','start'))
 c=inspect(p['containerId'],p['providerImageId']);raw,s=read();h=hashlib.sha256(raw).hexdigest()
 if p['phase']!='inspect':require(p['spec']==spec(c) and h==p['configDigest'])
 if p['phase']=='inspect':
  require(c['State']['Running'] and not c['State']['Paused'])
  print(json.dumps({'spec':spec(c),'configuration':json.loads(raw),'configDigest':h,'state':c['State']}));return
 if p['phase']=='stop':
  require(c['State']['Running'] and not c['State']['Paused']);call('stop','--time','30',p['containerId']);c=inspect(p['containerId'],p['providerImageId']);require(not c['State']['Running'] and c['State']['Pid']==0)
  print(json.dumps({'stoppedAt':c['State']['FinishedAt'],'sameSpec':spec(c)==p['spec'],'pid':0}));return
 if p['phase']=='rotate':
  require(not c['State']['Running'] and c['State']['Pid']==0)
  proposed=rotate(raw,p['oldCredential'],p['newCredential']);tmp=None
  try:
   fd,tmp=tempfile.mkstemp(prefix='.cop-media-atomic-',dir=CONFIG.parent)
   try:
    os.fchown(fd,s.st_uid,s.st_gid);os.fchmod(fd,stat.S_IMODE(s.st_mode))
    view=memoryview(proposed)
    while view:view=view[os.write(fd,view):]
    os.fsync(fd)
   finally:os.close(fd)
   again,t=read();require(again==raw and (s.st_ino,s.st_mtime_ns,s.st_ctime_ns)==(t.st_ino,t.st_mtime_ns,t.st_ctime_ns))
   os.replace(tmp,CONFIG);tmp=None;d=os.open(CONFIG.parent,os.O_RDONLY)
   try:os.fsync(d)
   finally:os.close(d)
  finally:
   if tmp:os.unlink(tmp)
  final,t=read();require(final==proposed and t.st_uid==s.st_uid and t.st_gid==s.st_gid and stat.S_IMODE(t.st_mode)==stat.S_IMODE(s.st_mode))
  print(json.dumps({'configDigest':hashlib.sha256(final).hexdigest(),'scoped':True}));return
 require(not c['State']['Running'] and c['State']['Pid']==0);call('start',p['containerId']);c=inspect(p['containerId'],p['providerImageId'])
 require(c['State']['Running'] and c['State']['Pid']>0 and spec(c)==p['spec'])
 print(json.dumps({'startedAt':c['State']['StartedAt'],'sameSpec':True,'imageId':c['Image']}))
try:main()
except Exception:
 print('{"phase":"storage_closure_not_complete"}');sys.exit(1)
`;
const TRANSPORT_DIRECTORY='/run/cop-storage-transport',TRANSPORT_SOCKET=TRANSPORT_DIRECTORY+'/master.sock';let activeStorageTransport;
export function storageTransportArguments(kind){
 const common=['-F','/dev/null','-S',TRANSPORT_SOCKET,'-o','UserKnownHostsFile=/home/voldzi/.ssh/known_hosts','-o','GlobalKnownHostsFile=/dev/null','-o','HostKeyAlgorithms=ssh-ed25519','-o','StrictHostKeyChecking=yes','-o','UpdateHostKeys=no','-o','ForwardAgent=no','-o','ForwardX11=no','-o','ClearAllForwardings=yes','-o','RequestTTY=no','-o','ConnectTimeout=8'];
 if(kind==='master')return [...common,'-M','-o','ControlPersist=15m','-o','PubkeyAuthentication=no','-o','PreferredAuthentications=password','-o','PasswordAuthentication=yes','-o','KbdInteractiveAuthentication=no','-o','NumberOfPasswordPrompts=1','-o','BatchMode=no','voldzi@storage.home.cz','/usr/bin/sudo','-n','/usr/bin/id','-u'];
 need(['command','exit'].includes(kind),'MEDIA_TRANSPORT_OPERATION');
 return [...common,'-o','ControlMaster=no','-o','BatchMode=yes','-o','ProxyCommand=/usr/bin/false',...(kind==='exit'?['-O','exit']:[]),'voldzi@storage.home.cz'];
}
export function storageTransportLifecycle(d){
 const owner=d.create();let closed=false;
 const cleanup=()=>{if(closed)return;closed=true;try{if(d.owned(owner))d.exit(storageTransportArguments('exit'));}finally{d.remove(owner);}};
 try{const result=d.authenticate(storageTransportArguments('master'));need(result.status===0&&!result.error&&result.stdout==='0\n','MEDIA_STORAGE_PASSWORD_OR_SUDO_REJECTED');d.capture(owner);need(d.owned(owner),'MEDIA_STORAGE_CONTROL_CUSTODY');return {owner,cleanup};}
 catch(error){cleanup();throw error;}
}
export function prepareProductionStorageTransport(){
 need(process.getuid?.()===0&&hostname().split('.')[0]==='docker'&&!process.env.NODE_OPTIONS&&!process.env.NODE_PATH&&!activeStorageTransport,'MEDIA_ROOT_CONTEXT');
 const env={PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',LANG:'C'};
 const directoryOwned=owner=>{try{const value=lstatSync(TRANSPORT_DIRECTORY);return value.isDirectory()&&!value.isSymbolicLink()&&value.uid===0&&(value.mode&0o777)===0o700&&value.dev===owner.directoryDevice&&value.ino===owner.directoryInode;}catch{return false;}};
 const socketOwned=owner=>{try{const value=lstatSync(TRANSPORT_SOCKET);return directoryOwned(owner)&&value.isSocket()&&value.uid===0&&(value.mode&0o077)===0&&(!owner.socketInode||value.ino===owner.socketInode&&value.dev===owner.socketDevice);}catch{return false;}};
 let session,createdOwner;
 const exitOwned=args=>{spawnSync('ssh',args,{stdio:'ignore',timeout:10000,env});};
 const removeOwned=owner=>{if(!socketOwned(owner)&&existsSync(TRANSPORT_SOCKET))return;if(directoryOwned(owner)){try{unlinkSync(TRANSPORT_SOCKET);}catch(error){if(error.code!=='ENOENT')throw error;}rmdirSync(TRANSPORT_DIRECTORY);}};
 const stop=()=>{process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);try{if(session)session.cleanup();else if(createdOwner){try{if(socketOwned(createdOwner))exitOwned(storageTransportArguments('exit'));}finally{removeOwned(createdOwner);}}}finally{activeStorageTransport=undefined;}};
 const interrupt=()=>{try{stop();}finally{process.exit(130);}},terminate=()=>{try{stop();}finally{process.exit(143);}};
 process.once('SIGINT',interrupt);process.once('SIGTERM',terminate);
 try{session=storageTransportLifecycle({
  create:()=>{const run=lstatSync('/run');need(run.isDirectory()&&!run.isSymbolicLink()&&run.uid===0&&(run.mode&0o022)===0&&!existsSync(TRANSPORT_DIRECTORY),'MEDIA_STORAGE_CONTROL_DIRECTORY_BUSY');mkdirSync(TRANSPORT_DIRECTORY,{mode:0o700});const stat=lstatSync(TRANSPORT_DIRECTORY);need(stat.uid===0&&(stat.mode&0o777)===0o700,'MEDIA_STORAGE_CONTROL_CUSTODY');createdOwner={directoryDevice:stat.dev,directoryInode:stat.ino,socketInode:null,socketDevice:null};return createdOwner;},
  authenticate:args=>{const tty=openSync('/dev/tty',constants.O_RDWR);try{return spawnSync('ssh',args,{stdio:[tty,'pipe',tty],encoding:'utf8',timeout:120000,maxBuffer:8192,env});}finally{closeSync(tty);}},
  capture:owner=>{need(socketOwned(owner),'MEDIA_STORAGE_CONTROL_CUSTODY');const stat=lstatSync(TRANSPORT_SOCKET);owner.socketInode=stat.ino;owner.socketDevice=stat.dev;},
  owned:socketOwned,exit:exitOwned,remove:removeOwned
 });}catch(error){stop();throw error;}
 activeStorageTransport={...session.owner,verify:()=>need(socketOwned(session.owner),'MEDIA_STORAGE_CONTROL_REPLACED')};return stop;
}
function remote(phase,payload){
 const cmd='/usr/bin/sudo -n /usr/bin/env -u PYTHONPATH -u PYTHONHOME /usr/bin/python3 -I -c '+quoted(STORAGE_PROGRAM);
 if(activeStorageTransport){activeStorageTransport.verify();const value=JSON.parse(command(['ssh',...storageTransportArguments('command'),cmd],JSON.stringify({phase,...payload}),120000));activeStorageTransport.verify();return value;}
 return JSON.parse(command(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8','storage.home.cz',cmd],JSON.stringify({phase,...payload}),120000));
}
export function checkWriter(c,p,r,running=true){
 need(typeof running==='boolean'&&c?.Id===r?.expectedActive?.containerId&&c?.Image===r?.expectedActive?.imageId&&c?.Config?.Labels?.['com.docker.compose.project']==='cop'&&c?.Config?.Labels?.['com.docker.compose.service']==='cop-api'&&c?.State?.Running===running&&Number.isSafeInteger(c?.State?.Pid)&&c.State.Pid>0,'MEDIA_WRITER_CHANGED');
 need(p.writerContainerIds.includes(c.Id),'MEDIA_FOREIGN_WRITER');
}
function checkOnlyWriter(p){
 const ids=docker('ps','--filter','label=com.docker.compose.project=cop','--filter','label=com.docker.compose.service=cop-api','--format','{{.ID}}').trim().split('\n').filter(Boolean).map(id=>inspect(id).Id);
 need(same(ids.sort(),[...p.writerContainerIds].sort()),'MEDIA_UNKNOWN_WRITER');
}
export const MEDIA_PROFILE_STAGE_PROGRAM=String.raw`${OPERATOR_PROFILE_HOST_CHECK}
import fcntl,hashlib,json,os,pathlib,stat,subprocess,sys,types
p=json.loads(sys.stdin.read());release=p['release'];base=pathlib.Path('/srv/cop')
def load_checked(name,relative):
 raw=(base/relative).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=release['fileSha256'][relative]:raise RuntimeError('install_source_changed')
 m=types.ModuleType(name);m.__file__=str(base/relative);exec(compile(raw,m.__file__,'exec'),m.__dict__);return m
r=load_checked('runtime','scripts/cop-api-runtime.py');storage=load_checked('storage','scripts/cop-storage.py')
# FD3 is the existing Root caller's held storage lock, never a Docker socket.
info=os.fstat(3);actual_lock=(base/'.storage.lock').stat();r.require(stat.S_ISREG(info.st_mode) and info.st_uid==1000 and stat.S_IMODE(info.st_mode)==0o600 and info.st_nlink==1 and (info.st_dev,info.st_ino)==(actual_lock.st_dev,actual_lock.st_ino),'media_profile_lock_custody');fcntl.flock(3,fcntl.LOCK_EX|fcntl.LOCK_NB);storage.preflight()
for relative,digest in release['fileSha256'].items():r.require(hashlib.sha256((base/relative).read_bytes()).hexdigest()==digest,'media_profile_source_changed')
st=r.Store(uid=1000,guard=storage.preflight);current,directory,binding,profile=st.active();r.require(current==release['expectedActive'],'media_profile_active_changed')
metadata=r.environment_metadata(base/'.env',1000);actual=st.docker.current(directory);witness=operator_profile_witness(st,current,directory,profile,r.require)
r.require(p['operation'] in ('preflight','seed','verify','enroll','database-readback'),'media_profile_fixed_operation')
args=['docker','--host','unix:///var/run/docker.sock','run','--rm','--pull','never','--log-driver','none','-i','--network','host','--hostname','docker','--read-only','--user','0:0','--cap-drop','ALL','--cap-add','DAC_OVERRIDE','--security-opt','no-new-privileges','--pids-limit','64','--memory','256m','--mount','type=bind,src=/srv/cop,dst=/srv/cop,readonly','--mount','type=bind,src=/etc/vcode-cop-pgbouncer/postgres-ca.crt,dst=/etc/vcode-cop-pgbouncer/postgres-ca.crt,readonly','--mount','type=bind,src='+witness['directory']+',dst='+witness['directory']+',readonly','--entrypoint','node',release['imageId']]
args+=['/app/scripts/account-safety/install-production-erasure.mjs','--database-readback','/srv/cop/runtime/account-erasure-install/release-plan.json'] if p['operation']=='database-readback' else ['/app/scripts/account-safety/install-media-upload-closure.mjs','--worker']
result=subprocess.run(args,input=json.dumps(p).encode(),capture_output=True,env={'PATH':'/usr/bin:/bin','LANG':'C'})
r.require(st.pointer()==current and r.environment_metadata(base/'.env',1000)==metadata and operator_profile_witness(st,current,directory,profile,r.require)==witness,'media_profile_changed');st.docker.unchanged(directory,actual)
r.require(result.returncode==0 and len(result.stdout)<=1048576,'media_profile_worker_failed');print(result.stdout.decode().strip())
`;
function helper(release,operation,payload={}){
 need(Number.isInteger(profileStorageLock),'MEDIA_PROFILE_LOCK_MISSING');
 const result=spawnSync('python3',['-B','-c',MEDIA_PROFILE_STAGE_PROGRAM],{input:JSON.stringify({operation,release,...payload}),encoding:'utf8',timeout:120000,maxBuffer:1048576,stdio:['pipe','pipe','pipe',profileStorageLock],env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C',PYTHONDONTWRITEBYTECODE:'1'}});
 need(!result.error&&result.status===0,'MEDIA_PROFILE_STAGE_FAILED');return JSON.parse(result.stdout);
}
function slowUpload(url){
 let request,admittedAt,endedAt,endedResolve;
 const ended=new Promise(resolve=>{endedResolve=resolve;});
 const admitted=new Promise((resolve,reject)=>{
  request=httpRequest(url,{method:'PUT',headers:{'content-type':'text/plain','content-length':1048576,Expect:'100-continue'}},response=>{response.resume();response.on('end',()=>{endedAt=new Date().toISOString();endedResolve(false);reject(Error('MEDIA_SLOW_UPLOAD_NOT_OPEN'));});});
  request.on('continue',()=>{request.write(Buffer.alloc(65536,65));admittedAt=new Date().toISOString();resolve();});
  request.on('error',()=>{endedAt=new Date().toISOString();endedResolve(true);if(!admittedAt)reject(Error('MEDIA_SLOW_UPLOAD_NOT_ADMITTED'));});request.setTimeout(120000,()=>request.destroy());request.flushHeaders();
 });
 return {admitted,ended,isOpen:()=>!!admittedAt&&!request.destroyed&&!endedAt,endedAt:()=>endedAt,cancel:()=>request.destroy()};
}
export async function runMediaClosure(d){
 // The injected operations are only an offline fault-test seam. The CLI binds
 // each to fixed hosts/paths/commands below; no action selector comes from JSON.
 await d.preflight();await d.seed();let paused=false,providerRunning=true,resumeSafe=true,slow;
 try{
  await d.pause();paused=true;await d.assertPaused();slow=await d.slow();await slow.admitted;need(slow.isOpen(),'MEDIA_SLOW_UPLOAD_NOT_OPEN');
  resumeSafe=false;providerRunning=false;const stopped=await d.stop();need(stopped.pid===0&&stopped.sameSpec,'MEDIA_PROVIDER_NOT_STOPPED');
  let timer;try{need(await Promise.race([slow.ended,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),10000);})]),'MEDIA_LEGACY_BODY_NOT_TERMINATED');}finally{clearTimeout(timer);}
  await d.persistCredential();await d.rotate();const restarted=await d.start();need(restarted.sameSpec&&restarted.imageId===d.providerImageId&&Date.parse(restarted.startedAt)>Date.parse(stopped.stoppedAt),'MEDIA_PROVIDER_RESTART_CHANGED');providerRunning=true;
  const evidence=await d.verify(stopped,restarted);resumeSafe=true;await d.assertPaused();await d.enroll(evidence);await d.unpause();paused=false;await d.actualOldHealth();return await d.publish(evidence);
 }finally{
  slow?.cancel();
  // Never start a stopped provider, restore a key or resume uncertain writers
  // as generic error recovery. An already running, inspected provider permits
  // only unpausing the same original process; no erasure intake is enabled.
  if(paused&&providerRunning&&resumeSafe)await d.safeUnpause().catch(()=>{});
 }
}
function checkedRelease(readOnlyTransport=false){
 const f=privateFile(PLAN,0),r=validatePlan(JSON.parse(f.bytes));need(readOnlyTransport||r.operation==='prepare','MEDIA_INITIAL_PREPARE_ONLY');
 for(const[k,h]of Object.entries(r.fileSha256))need(sha(readFileSync(ROOT+'/'+k))===h,'MEDIA_SOURCE_CHANGED');
 need(r.fileSha256[SELF]&&r.fileSha256[SQL],'MEDIA_SOURCE_PIN_MISSING');
 const whole=privateFile(r.wholeAcceptancePath,0);need(sha(whole.bytes)===r.wholeAcceptanceSha256,'MEDIA_WHOLE_RECEIPT_CHANGED');const closure=checkedCandidateClosure(r);validateWholeReceipt(r,JSON.parse(whole.bytes),closure);
 const candidate=JSON.parse(docker('image','inspect',r.imageId))[0];need(candidate.Id===r.imageId&&candidate.Config?.Labels?.['org.opencontainers.image.revision']===r.sourceRevision,'MEDIA_CANDIDATE_IMAGE_CHANGED');
 const pinCheck="const fs=require('fs'),c=require('crypto');const p=JSON.parse(fs.readFileSync(0,'utf8'));for(const k of ['"+SELF+"','"+SQL+"'])if(c.createHash('sha256').update(fs.readFileSync('/app/'+k)).digest('hex')!==p.fileSha256[k])process.exit(1)";
 command(['docker','--host','unix:///var/run/docker.sock','run','--rm','--pull','never','-i','--network','none','--read-only','--cap-drop','ALL','--entrypoint','node',r.imageId,'-e',pinCheck],JSON.stringify(r));return {release:r,file:f};
}
function takeStorageLock(release){
 const preflight=()=>command(['python3','-B','-c',"import hashlib,json,pathlib,sys,types;p=json.load(sys.stdin);raw=pathlib.Path('/srv/cop/scripts/cop-storage.py').read_bytes();assert hashlib.sha256(raw).hexdigest()==p['sha'];m=types.ModuleType('cop_storage');m.__file__='/srv/cop/scripts/cop-storage.py';exec(compile(raw,m.__file__,'exec'),m.__dict__);m.preflight()"],JSON.stringify({sha:release.fileSha256['scripts/cop-storage.py']}));
 preflight();const fd=openSync(ROOT+'/.storage.lock',constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const st=fstatSync(fd);need(st.isFile()&&st.nlink===1&&st.uid===1000&&(st.mode&0o777)===0o600,'MEDIA_STORAGE_LOCK_CUSTODY');const locked=spawnSync('/usr/bin/flock',['-n','3'],{stdio:['ignore','pipe','pipe',fd],env:{PATH:'/usr/bin:/bin',LANG:'C'},timeout:3000});need(locked.status===0&&!locked.error,'MEDIA_STORAGE_BUSY');preflight();profileStorageLock=fd;return fd;}catch(error){closeSync(fd);throw error;}
}
export function validateStorageInspection(provider,p,oldCredential){
 need(provider?.spec?.Id===p.providerContainerId&&provider?.spec?.Image===p.providerImageId&&provider?.state?.Running===true&&provider.state.Paused===false&&Number.isSafeInteger(provider.state.Pid)&&provider.state.Pid>0&&Array.isArray(provider?.configuration?.identities),'MEDIA_STORAGE_INSPECTION_UNPROVEN');
 const selected=provider.configuration.identities.filter(v=>v.name==='cop-production'),other=provider.configuration.identities.filter(v=>v.name===p.otherIdentity);
 need(selected.length===1&&same(selected[0].credentials,[{accessKey:oldCredential.accessKeyId,secretKey:oldCredential.secretAccessKey}])&&other.length===1&&Array.isArray(other[0].credentials)&&other[0].credentials.length===1,'MEDIA_IDENTITY_NOT_EXACT');
 return true;
}
/** Same fixed SSH inspection as apply, before any configuration/DB mutation.
 * Only the media subset is parsed here; approved unrelated legacy duplicates
 * are normalized by the later strict full-environment preparation stage. */
function inspectStorageTransport(verifyWriter){
 need(process.getuid?.()===0&&hostname().split('.')[0]==='docker'&&!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'MEDIA_ROOT_CONTEXT');
 const {release:r}=checkedRelease(true),storageLock=takeStorageLock(r);
 try{
  const rawPlan=JSON.parse(privateFile(CLOSURE_PLAN,0).bytes),p=validateClosurePlan(rawPlan,verifyWriter?r:{expectedActive:{containerId:rawPlan.writerContainerIds?.[0]}}),original=privateFile(ROOT+'/.env',1000);
  const selectedKeys=new Set(['COP_MEDIA_S3_ENDPOINT','COP_MEDIA_S3_BUCKET','COP_MEDIA_S3_ACCESS_KEY_ID','COP_MEDIA_S3_SECRET_ACCESS_KEY']);
  const env=parseEnvironment(original.bytes.toString().split(/\r?\n/u).filter(line=>selectedKeys.has(line.split('=',1)[0])).join('\n'));
  need(env.get('COP_MEDIA_S3_ENDPOINT')===ENDPOINT&&env.get('COP_MEDIA_S3_BUCKET')===BUCKET,'MEDIA_ENDPOINT_SCOPE');
  const provider=remote('inspect',{containerId:p.providerContainerId,providerImageId:p.providerImageId});validateStorageInspection(provider,p,{accessKeyId:env.get('COP_MEDIA_S3_ACCESS_KEY_ID'),secretAccessKey:env.get('COP_MEDIA_S3_SECRET_ACCESS_KEY')});
  if(verifyWriter){checkWriter(inspect(r.expectedActive.containerId),p,r);checkOnlyWriter(p);}
  const now=privateFile(ROOT+'/.env',1000);need(now.stat.ino===original.stat.ino&&now.bytes.equals(original.bytes),'MEDIA_ENV_CHANGED');
  return {storageTransportVerified:true,providerContainerId:p.providerContainerId,providerImageId:p.providerImageId,providerReference:PROVIDER_REFERENCE,configurationVerified:true,mutated:false};
 }finally{closeSync(storageLock);}
}
export function inspectProductionStorageTransport(){return inspectStorageTransport(true);}
/** Provider-only transport proof also precedes metadata recovery. Writer CAS is
 * then established separately by the exact protected runtime recovery gate. */
export function inspectProductionStorageProviderTransport(){return inspectStorageTransport(false);}
/** Reuse only an actual Root receipt with current provider, credentials and
 * independent SQL closure readback. No repeat rotation, key restoration or PUT. */
export function verifyProductionMediaClosure(expectedReceiptSha256){
 need(process.getuid?.()===0&&hostname().split('.')[0]==='docker'&&!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'MEDIA_ROOT_CONTEXT');
 const {release:r}=checkedRelease(),lock=takeStorageLock(r);try{
  const p=validateClosurePlan(JSON.parse(privateFile(CLOSURE_PLAN,0).bytes),r),receipt=privateFile(r.mediaClosureEvidencePath,0);const receiptSha256=expectedReceiptSha256??r.mediaClosureEvidenceSha256;need(hex.test(receiptSha256)&&sha(receipt.bytes)===receiptSha256,'MEDIA_RECEIPT_CHANGED');
  const evidence=JSON.parse(receipt.bytes);need(evidence.contractVersion==='cop-media-upload-closure-evidence-v1'&&evidence.production===true&&evidence.providerImageId===p.providerImageId&&evidence.providerReference===PROVIDER_REFERENCE&&evidence.sourceRevision===r.sourceRevision&&evidence.endpoint===ENDPOINT&&evidence.bucket===BUCKET&&['legacySlowBodyTerminated','oldSignatureDenied','newCredentialWorks','otherIdentityAndBucketPreserved','canaryObjectsRemoved'].every(k=>evidence[k]===true),'MEDIA_RECEIPT_UNPROVEN');
  const env=parseEnvironment(privateFile(ROOT+'/.env',1000).bytes.toString()),credential={accessKeyId:env.get('COP_MEDIA_S3_ACCESS_KEY_ID'),secretAccessKey:env.get('COP_MEDIA_S3_SECRET_ACCESS_KEY')};
  const peer=remote('inspect',{containerId:p.providerContainerId,providerImageId:p.providerImageId});validateStorageInspection(peer,p,credential);need(peer.state.StartedAt===evidence.providerRestartedAt,'MEDIA_PROVIDER_RESTART_CHANGED');
  const other=peer.configuration.identities.find(v=>v.name===p.otherIdentity),otherCredential={accessKeyId:other.credentials[0].accessKey,secretAccessKey:other.credentials[0].secretKey};
  const before=helper(r,'preflight',{otherCredential,otherBucket:p.otherBucket});need(before.ready===true,'MEDIA_REUSE_PREFLIGHT_FAILED');
  const actual=helper(r,'database-readback');need(actual.databaseReadback===true&&actual.mediaReadback===true&&actual.mutated===false,'MEDIA_REUSE_DATABASE_UNPROVEN');checkOnlyWriter(p);checkWriter(inspect(r.expectedActive.containerId),p,r);
  return {verified:true,mutated:false,receiptSha256};
 }finally{closeSync(lock);}
}
export async function executeProductionMediaClosure(password){return hostMain('--apply',password);}
export async function preflightProductionMediaClosure(){return hostMain('--check','');}
async function hostMain(mode,passwordInput){
 need(['--check','--apply'].includes(mode)&&(passwordInput===undefined?process.argv.length===3:process.argv[1]==='/srv/cop/scripts/account-safety/install-production-erasure.mjs')&&process.getuid?.()===0&&hostname().split('.')[0]==='docker'&&!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'MEDIA_ROOT_CONTEXT');
 const {release:r,file:releaseFile}=checkedRelease();const storageLock=takeStorageLock(r);try{const p=validateClosurePlan(JSON.parse(privateFile(CLOSURE_PLAN,0).bytes),r);
 need(!existsSync(r.mediaClosureEvidencePath),'MEDIA_RECEIPT_ALREADY_EXISTS');
 const original=privateFile(ROOT+'/.env',1000),env=parseEnvironment(original.bytes.toString());need(env.get('COP_MEDIA_S3_ENDPOINT')===ENDPOINT&&env.get('COP_MEDIA_S3_BUCKET')===BUCKET,'MEDIA_ENDPOINT_SCOPE');
 const oldCredential={accessKeyId:env.get('COP_MEDIA_S3_ACCESS_KEY_ID'),secretAccessKey:env.get('COP_MEDIA_S3_SECRET_ACCESS_KEY')};
 const provider=remote('inspect',{containerId:p.providerContainerId,providerImageId:p.providerImageId});
 validateStorageInspection(provider,p,oldCredential);const other=provider.configuration.identities.filter(v=>v.name===p.otherIdentity);
 const otherCredential={accessKeyId:other[0].credentials[0].accessKey,secretAccessKey:other[0].credentials[0].secretKey};
 const peer={containerId:p.providerContainerId,providerImageId:p.providerImageId,spec:provider.spec,configDigest:provider.configDigest};
 const writer=inspect(r.expectedActive.containerId);checkWriter(writer,p,r);need(!writer.State.Paused,'MEDIA_WRITER_ALREADY_PAUSED');checkOnlyWriter(p);
 const before=helper(r,'preflight',{otherCredential,otherBucket:p.otherBucket});need(before.ready===true,'MEDIA_ACTUAL_PREFLIGHT_FAILED');
 if(mode==='--check'){console.log(JSON.stringify({phase:'media_closure_checked',providerImageId:p.providerImageId,providerReference:PROVIDER_REFERENCE,sourceRevision:r.sourceRevision,configurationChanged:false,servicesChanged:false,secretsPrinted:false}));return;}
 let password=passwordInput??await promptPassword();need(typeof password==='string'&&password.length>0&&password.length<=4096,'MEDIA_PRIVATE_PASSWORD_REQUIRED');const current={accessKeyId:'cop-production-'+randomBytes(24).toString('base64url'),secretAccessKey:randomBytes(48).toString('base64url')};
 const updated=replaceMediaEnvironment(original.bytes,current);let seed,evidenceBytes;
 const assertPaused=async()=>{checkOnlyWriter(p);const actual=inspect(writer.Id);checkWriter(actual,p,r);need(actual.State.Paused,'MEDIA_WRITER_NOT_PAUSED');};
 const safeUnpause=async()=>{const service=remote('inspect',{containerId:p.providerContainerId,providerImageId:p.providerImageId});need(same(service.spec,peer.spec)&&service.configDigest===peer.configDigest,'MEDIA_RECOVERY_PROVIDER_UNKNOWN');const actual=inspect(writer.Id);checkWriter(actual,p,r);if(actual.State.Paused)docker('unpause',writer.Id);};
 try{
  const result=await runMediaClosure({
   providerImageId:p.providerImageId,
   preflight:async()=>{const currentEnv=privateFile(ROOT+'/.env',1000);need(currentEnv.stat.ino===original.stat.ino&&currentEnv.bytes.equals(original.bytes),'MEDIA_ENV_CHANGED');},
   seed:async()=>{seed=helper(r,'seed',{otherCredential,otherBucket:p.otherBucket});},
   pause:async()=>{checkOnlyWriter(p);checkWriter(inspect(writer.Id),p,r);docker('pause',writer.Id);},assertPaused,
   slow:async()=>slowUpload(seed.legacySlot.uploadUrl),stop:async()=>remote('stop',peer),
   persistCredential:async()=>atomic(ROOT+'/.env',original,updated),
   rotate:async()=>{const result=remote('rotate',{...peer,oldCredential,newCredential:current});need(result.scoped===true,'MEDIA_ROTATION_SCOPE');peer.configDigest=result.configDigest;},
   start:async()=>remote('start',peer),
   verify:async(stopped,restarted)=>{
    const facts=helper(r,'verify',{seed,otherCredential,otherBucket:p.otherBucket});need(facts.verified===true,'MEDIA_ACTUAL_VERIFICATION_FAILED');
    const evidence={contractVersion:'cop-media-upload-closure-evidence-v1',production:true,endpoint:ENDPOINT,bucket:BUCKET,sourceRevision:r.sourceRevision,providerImageId:p.providerImageId,providerReference:PROVIDER_REFERENCE,providerContainerId:p.providerContainerId,providerStoppedAt:stopped.stoppedAt,providerRestartedAt:restarted.startedAt,oldCredentialDeniedAt:facts.oldCredentialDeniedAt,legacySlowBodyTerminated:true,oldSignatureDenied:true,newCredentialWorks:true,secondAccountPreserved:true,otherIdentityAndBucketPreserved:true,canaryObjectsRemoved:true,writerContainerIds:p.writerContainerIds};
    evidenceBytes=Buffer.from(JSON.stringify(evidence)+'\n');return evidence;
   },
   enroll:async evidence=>{const result=helper(r,'enroll',{password,expectedBinding:before.binding,evidence,evidenceDigest:sha(evidenceBytes),previousCredentialFingerprint:before.credentialFingerprint});need(result.enrolled===true&&result.readback===true,'MEDIA_GUARD_ENROLLMENT_FAILED');},
   unpause:safeUnpause,safeUnpause,
   actualOldHealth:async()=>{const actual=inspect(writer.Id);checkWriter(actual,p,r);need(!actual.State.Paused,'MEDIA_WRITER_STILL_PAUSED');const health=JSON.parse(docker('exec',writer.Id,'node','-e',"Promise.all(['/health/live','/health/ready','/health/dependencies'].map(async p=>{const r=await fetch('http://127.0.0.1:4310'+p,{signal:AbortSignal.timeout(5000)});await r.body?.cancel();return r.status})).then(v=>console.log(JSON.stringify(v)))"));need(same(health,[200,200,200]),'MEDIA_OLD_API_HEALTH_FAILED');},
   publish:async()=>{
    const next={...r,mediaClosureEvidenceSha256:sha(evidenceBytes)},nextBytes=Buffer.from(JSON.stringify(next)+'\n');
    const transition={contractVersion:'cop-production-media-plan-transition-v1',previousReleasePlanSha256:sha(releaseFile.bytes),nextReleasePlanSha256:sha(nextBytes),nextPlan:next,sourceRevision:r.sourceRevision,imageId:r.imageId,expectedActive:r.expectedActive,receiptSha256:sha(evidenceBytes)};
    const transitionFd=openSync(DIR+'/media-plan-transition.json',constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{fchownSync(transitionFd,0,0);fchmodSync(transitionFd,0o600);writeFileSync(transitionFd,JSON.stringify(transition)+'\n');fsyncSync(transitionFd);}finally{closeSync(transitionFd);}
    const receiptFd=openSync(r.mediaClosureEvidencePath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{fchownSync(receiptFd,0,0);fchmodSync(receiptFd,0o600);writeFileSync(receiptFd,evidenceBytes);fsyncSync(receiptFd);}finally{closeSync(receiptFd);}
    const parent=openSync(DIR,constants.O_RDONLY);try{fsyncSync(parent);}finally{closeSync(parent);}
    atomic(PLAN,releaseFile,nextBytes);
    return {phase:'media_closure_enrolled',receiptPath:r.mediaClosureEvidencePath,receiptSha256:sha(evidenceBytes),providerImageId:p.providerImageId,providerReference:PROVIDER_REFERENCE,oldApiHealthVerified:true,erasureEnabled:false,wholeAccountComplete:false,secretsPrinted:false};
   }
  });console.log(JSON.stringify(result));
 }finally{password='';}
 }finally{closeSync(storageLock);}
}
async function promptPassword(){
 need(process.stdin.isTTY&&process.stdout.isTTY,'MEDIA_ADMIN_TTY_REQUIRED');process.stdout.write('PostgreSQL administrator password (not echoed): ');process.stdin.setEncoding('utf8');process.stdin.setRawMode(true);process.stdin.resume();
 return new Promise((resolve,reject)=>{let value='';const done=()=>{process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');};const onData=chunk=>{for(const c of chunk){if(c==='\u0003'){done();reject(Error('MEDIA_CANCELLED'));return;}if(c==='\n'||c==='\r'){done();resolve(value);return;}if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else if(c>=' '&&value.length<4096)value+=c;}};process.stdin.on('data',onData);});
}
export async function signedClosureRequest({credential:key,bucket=BUCKET,objectKey='',method='HEAD',query={},endpoint=ENDPOINT}){
 need(['HEAD','GET','DELETE'].includes(method)&&/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(bucket),'MEDIA_SIGNED_REQUEST_SCOPE');const origin=new URL(endpoint);need(origin.origin===endpoint&&!origin.username&&!origin.password,'MEDIA_SIGNED_REQUEST_ORIGIN');
 const amz=new Date().toISOString().replaceAll(/[:-]|\.\d{3}/gu,''),date=amz.slice(0,8),scope=date+'/us-east-1/s3/aws4_request',host=origin.host;
 const path='/'+bucket+(objectKey?'/'+objectKey.split('/').map(encodeURIComponent).join('/'):'');const qs=Object.entries(query).sort().map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');
 const headers={'x-amz-date':amz,'x-amz-content-sha256':sha('')};const names='host;x-amz-content-sha256;x-amz-date',canonicalHeaders='host:'+host+'\nx-amz-content-sha256:'+headers['x-amz-content-sha256']+'\nx-amz-date:'+amz+'\n';
 const hmac=(key,value)=>createHmac('sha256',key).update(value).digest();const signing=hmac(hmac(hmac(hmac('AWS4'+key.secretAccessKey,date),'us-east-1'),'s3'),'aws4_request');
 const signature=createHmac('sha256',signing).update('AWS4-HMAC-SHA256\n'+amz+'\n'+scope+'\n'+sha([method,path,qs,canonicalHeaders,names,sha('')].join('\n'))).digest('hex');
 return fetch(endpoint+path+(qs?'?'+qs:''),{method,redirect:'error',signal:AbortSignal.timeout(5000),headers:{...headers,authorization:'AWS4-HMAC-SHA256 Credential='+key.accessKeyId+'/'+scope+', SignedHeaders='+names+', Signature='+signature}});
}
async function workerMain(){
 need(process.argv.length===3&&process.getuid?.()===0&&hostname().split('.')[0]==='docker'&&Number(process.versions.node.split('.')[0])===24&&!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'MEDIA_WORKER_CONTEXT');
 const chunks=[];let length=0;for await(const chunk of process.stdin){length+=chunk.length;need(length<1048576,'MEDIA_WORKER_INPUT_BOUND');chunks.push(chunk);}const p=JSON.parse(Buffer.concat(chunks).toString());
 validatePlan(p.release);const currentPlan=JSON.parse(privateFile(PLAN,0).bytes);need(same(p.release,currentPlan),'MEDIA_WORKER_PLAN_CHANGED');for(const name of [SELF,SQL])need(sha(readFileSync('/app/'+name))===p.release.fileSha256[name],'MEDIA_WORKER_SOURCE_CHANGED');
 need(['preflight','seed','verify','enroll'].includes(p.operation),'MEDIA_WORKER_OPERATION');
 const env=new Map(Object.entries(loadOperatorEnvironment()));need(env.get('COP_MEDIA_S3_ENDPOINT')===ENDPOINT&&env.get('COP_MEDIA_S3_BUCKET')===BUCKET&&(!env.has('COP_ACCOUNT_ERASURE_ENABLED')||env.get('COP_ACCOUNT_ERASURE_ENABLED')==='false'),'MEDIA_CONFIGURATION_SCOPE');
 const credential={accessKeyId:env.get('COP_MEDIA_S3_ACCESS_KEY_ID'),secretAccessKey:env.get('COP_MEDIA_S3_SECRET_ACCESS_KEY')};
 const {S3PresignedMediaStorage}=await import('/app/apps/cop-api/dist/media-storage.js');
 const storage=new S3PresignedMediaStorage({...credential,bucket:BUCKET,endpoint:ENDPOINT,publicEndpoint:ENDPOINT,region:'us-east-1',uploadExpiresSeconds:900});
 const makeHead=(credential,bucket=BUCKET,objectKey='',method='HEAD',query={})=>signedClosureRequest({credential,bucket,objectKey,method,query});
 const head=async(key,bucket)=>{const r=await makeHead(key,bucket);await r.body?.cancel();need(r.status===200,'MEDIA_BUCKET_UNAVAILABLE');};
 const version=async()=>{const r=await makeHead(credential,BUCKET,'','GET',{versioning:''});need(r.status===200,'MEDIA_VERSIONING_UNKNOWN');const raw=await boundedText(r,4096);need(raw.length<4096&&/^\s*(?:<\?xml[^?]*\?>\s*)?<VersioningConfiguration\s+xmlns=["']http:\/\/s3\.amazonaws\.com\/doc\/2006-03-01\/["']\s*(?:\/>|>\s*<\/VersioningConfiguration>)\s*$/u.test(raw),'MEDIA_VERSIONING_UNSUPPORTED');return raw;};
 if(p.operation==='preflight'||p.operation==='seed'||p.operation==='verify'){
  need(typeof p.otherBucket==='string'&&/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(p.otherBucket)&&p.otherBucket!==BUCKET&&p.otherCredential?.accessKeyId&&p.otherCredential?.secretAccessKey,'MEDIA_OTHER_IDENTITY_REQUIRED');
  await head(credential,BUCKET);await head(p.otherCredential,p.otherBucket);
 }
 if(p.operation==='seed'){
  const a=randomUUID(),b=randomUUID();const keys={a:'community-reports/'+a+'/'+randomUUID()+'/closure-a.txt',b:'community-reports/'+b+'/'+randomUUID()+'/closure-b.txt'};
  await version();await storage.putObject({objectKey:keys.a,contentType:'text/plain',body:Buffer.from('COP_CLOSURE_SYNTHETIC_A')},new Date());await storage.putObject({objectKey:keys.b,contentType:'text/plain',body:Buffer.from('COP_CLOSURE_SYNTHETIC_B')},new Date());
  const legacySlot=await storage.createUploadSlot({reportId:a,attachmentId:randomUUID(),fileName:'closure-slow.txt',contentType:'text/plain',byteSize:1048576},new Date());console.log(JSON.stringify({keys,legacySlot}));return;
 }
 if(p.operation==='verify'){
  need(p.seed?.keys&&Object.values(p.seed.keys).every(v=>/^community-reports\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/closure-[ab]\.txt$/u.test(v))&&/^community-reports\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/closure-slow\.txt$/u.test(p.seed.legacySlot?.objectKey),'MEDIA_CANARY_SCOPE');
  const legacyUrl=new URL(p.seed.legacySlot.uploadUrl);need(legacyUrl.origin===ENDPOINT&&!legacyUrl.username&&!legacyUrl.password&&!legacyUrl.hash&&legacyUrl.pathname==='/'+BUCKET+'/'+p.seed.legacySlot.objectKey&&legacyUrl.searchParams.get('X-Amz-Expires')==='900','MEDIA_LEGACY_URL_SCOPE');need(Date.parse(p.seed.legacySlot.expiresAt)>Date.now()+5000,'MEDIA_OLD_SIGNATURE_EXPIRED');
  const denied=await fetch(p.seed.legacySlot.uploadUrl,{method:'PUT',redirect:'error',headers:{'content-type':'text/plain'},body:'COP_SYNTHETIC_LATE',signal:AbortSignal.timeout(5000)});await denied.body?.cancel();need(denied.status===403,'MEDIA_OLD_SIGNATURE_NOT_REVOKED');const oldCredentialDeniedAt=new Date().toISOString();
  need((await storage.getObject({objectKey:p.seed.keys.b},new Date())).body.toString()==='COP_CLOSURE_SYNTHETIC_B','MEDIA_SECOND_CANARY_CHANGED');
  await storage.putObject({objectKey:p.seed.keys.a,contentType:'text/plain',body:Buffer.from('COP_CLOSURE_SYNTHETIC_NEW')},new Date());need((await storage.getObject({objectKey:p.seed.keys.a},new Date())).body.toString()==='COP_CLOSURE_SYNTHETIC_NEW','MEDIA_NEW_CREDENTIAL_FAILED');await version();
  const versions=async key=>{const response=await makeHead(credential,BUCKET,'','GET',{versions:'',prefix:key,'max-keys':'100'});need(response.status===200,'MEDIA_VERSION_INVENTORY_UNAVAILABLE');return exactCanaryVersions(await boundedText(response),key);};
  for(const key of [...Object.values(p.seed.keys),p.seed.legacySlot.objectKey]){
   for(const entry of await versions(key)){const deleted=await makeHead(credential,BUCKET,key,'DELETE',{versionId:entry.versionId});await deleted.body?.cancel();need(deleted.ok||deleted.status===404,'MEDIA_CANARY_VERSION_DELETE_FAILED');}
   need((await versions(key)).length===0,'MEDIA_CANARY_VERSIONS_REMAIN');const absent=await makeHead(credential,BUCKET,key);await absent.body?.cancel();need(absent.status===404,'MEDIA_CANARY_NOT_ABSENT');
  }
  console.log(JSON.stringify({verified:true,oldCredentialDeniedAt}));return;
 }
 const ca=readFileSync(CA);need(sha(ca)===CA_SHA,'MEDIA_DATABASE_CA_CHANGED');const require=createRequire('/app/apps/cop-api/package.json');need(require('pg/package.json').version==='8.23.1','MEDIA_PG_DEPENDENCY_CHANGED');const {Pool}=require('pg');
 const pool=(value,database,user)=>{const u=new URL(value);need(['postgres:','postgresql:'].includes(u.protocol)&&u.hostname==='haproxy.home.cz'&&u.port==='5000'&&u.pathname==='/'+database&&!u.hash&&(!user||decodeURIComponent(u.username)===user),'MEDIA_DATABASE_SCOPE');return new Pool({host:'haproxy.home.cz',port:5000,database,user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),max:1,connectionTimeoutMillis:3000,query_timeout:5000,ssl:{ca:ca.toString(),rejectUnauthorized:true,servername:'haproxy.home.cz'},application_name:'cop-media-closure-root'});};
 const {databaseContinuityEndpoints}=await import('/app/apps/cop-api/dist/account-erasure-continuity-production.js');const routes=databaseContinuityEndpoints(Object.fromEntries(env));
 const guard=pool(routes.guardUrl,'cop_account_safety_guard','cop_safety_v2_runtime'),target=pool(routes.targetUrl,'cop');guard.on('error',()=>{});target.on('error',()=>{});
 let admin;
 try{
  const {PostgresAccountErasureContinuity}=await import('/app/apps/cop-api/dist/account-erasure-continuity-postgres.js');const {mediaCredentialFingerprint}=await import('/app/apps/cop-api/dist/media-upload-settlement.js');
  const expected={guardStoreId:env.get('COP_ACCOUNT_SAFETY_GUARD_STORE_ID'),applicationStoreId:env.get('COP_ACCOUNT_SAFETY_STORE_ID'),incarnationId:env.get('COP_ACCOUNT_SAFETY_INCARNATION_ID'),configurationFingerprint:sha('cop-account-erasure-config-v1\0'+env.get('COP_ACCOUNT_ERASURE_SECRET'))};
  need([expected.guardStoreId,expected.applicationStoreId,expected.incarnationId].every(v=>uuid.test(v??''))&&(env.get('COP_ACCOUNT_ERASURE_SECRET')??'').length>=32,'MEDIA_GUARD_NOT_ENROLLED');
  const snapshot=await new PostgresAccountErasureContinuity(guard,target,expected).snapshot();
  const replay=(await guard.query("SELECT replay_sequence,replay_digest FROM cop_safety_v2.dataset_replays WHERE owner='cop'")).rows[0];need(Number(replay?.replay_sequence)===snapshot.frontier.sequence&&replay.replay_digest===snapshot.frontier.digest,'MEDIA_REPLAY_NOT_CURRENT');
  const local=(await target.query("SELECT value FROM cop_mobility_v1 WHERE key='account-erasure:configuration-v1'")).rows[0]?.value;
  need(local?.version===4&&local.storeId===expected.applicationStoreId&&local.fingerprint===expected.configurationFingerprint&&same(local.datasetBinding,snapshot.datasetBinding),'MEDIA_LOCAL_BINDING_UNPROVEN');
  const jobs=(await target.query("SELECT key,value FROM cop_mobility_v1 WHERE left(key,20)='account-erasure:job:'")).rows;need(jobs.length===snapshot.entries.length&&snapshot.entries.every(e=>jobs.some(j=>j.key==='account-erasure:job:'+e.accountKey&&j.value.operationId===e.job.operationId&&j.value.requestedAt===e.job.requestedAt&&same(j.value.required,e.job.required))),'MEDIA_LOCAL_JOBS_UNPROVEN');
  need((await target.query('SELECT count(*) n FROM cop_community_media_write_leases')).rows[0]?.n==='0','MEDIA_UNKNOWN_WRITE_LEASE');
  const binding={...expected,...snapshot.datasetBinding,frontier:snapshot.frontier};const fingerprint=mediaCredentialFingerprint(credential.accessKeyId,credential.secretAccessKey);
  if(p.operation==='preflight'){await version();console.log(JSON.stringify({ready:true,binding,credentialFingerprint:fingerprint}));return;}
  need(same(p.expectedBinding,binding)&&hex.test(p.previousCredentialFingerprint)&&p.previousCredentialFingerprint!==fingerprint&&hex.test(p.evidenceDigest),'MEDIA_ENROLLMENT_BINDING_CHANGED');
  need(typeof p.password==='string'&&p.password.length>0&&!/[\r\n\0]/u.test(p.password),'MEDIA_ADMIN_REQUIRED');
  const adminUrl=new URL('postgresql://haproxy.home.cz:5000/cop_account_safety_guard');adminUrl.username='postgres';adminUrl.password=p.password;admin=pool(adminUrl.href,'cop_account_safety_guard','postgres');delete p.password;admin.on('error',()=>{});
  // The same session logging suppression used by the existing provisioner;
  // passwords never enter SQL text, history, Docker env or the receipt.
  const connection=await admin.connect();let business, businessTransaction=false;try{
   const facts=(await connection.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0];need(facts?.rolsuper===true,'MEDIA_POSTGRES_ADMIN_REQUIRED');
   for(const[k,v]of Object.entries({log_statement:'none',log_min_error_statement:'panic',log_min_duration_statement:'-1',log_min_duration_sample:'-1',log_statement_sample_rate:'0',log_transaction_sample_rate:'0',log_parameter_max_length:'0',log_parameter_max_length_on_error:'0',log_duration:'off',debug_print_parse:'off',debug_print_rewritten:'off',debug_print_plan:'off'}))await connection.query("SELECT set_config($1,$2,false)",[k,v]);
   const exists=(await connection.query("SELECT to_regclass('cop_safety_v2.media_upload_closures') present")).rows[0]?.present;
   if(!exists){const migration=readFileSync('/app/'+SQL);need(sha(migration)===p.release.fileSha256[SQL],'MEDIA_MIGRATION_CHANGED');await connection.query('SET ROLE cop_safety_v2_owner');try{await connection.query(migration.toString());}finally{await connection.query('RESET ROLE');}}
   const table=(await connection.query("SELECT c.relkind,pg_get_userbyid(c.relowner) owner FROM pg_class c WHERE c.oid='cop_safety_v2.media_upload_closures'::regclass")).rows[0];need(table?.relkind==='r'&&table.owner==='cop_safety_v2_owner','MEDIA_TABLE_OWNERSHIP_CHANGED');
   const triggers=(await connection.query("SELECT tgname,tgenabled,tgfoid='cop_safety_v2.immutable()'::regprocedure correct FROM pg_trigger WHERE tgrelid='cop_safety_v2.media_upload_closures'::regclass AND NOT tgisinternal ORDER BY tgname")).rows;need(same(triggers,[{tgname:'immutable_rows',tgenabled:'O',correct:true},{tgname:'immutable_truncate',tgenabled:'O',correct:true}]),'MEDIA_TABLE_NOT_IMMUTABLE');
   const rights=(await connection.query("SELECT has_table_privilege('cop_safety_v2_runtime','cop_safety_v2.media_upload_closures','SELECT') r,has_table_privilege('cop_safety_v2_runtime','cop_safety_v2.media_upload_closures','INSERT,UPDATE,DELETE,TRUNCATE') w")).rows[0];need(rights?.r===true&&rights.w===false,'MEDIA_RUNTIME_PERMISSIONS_CHANGED');
   business=await target.connect();await business.query('BEGIN');businessTransaction=true;await business.query("SELECT pg_advisory_xact_lock(hashtextextended($1,731032))",['cop-content-writers-v1']);
   need((await business.query('SELECT count(*) n FROM cop_community_media_write_leases')).rows[0]?.n==='0','MEDIA_UNKNOWN_WRITE_LEASE');
   const marker=(await business.query("SELECT value FROM cop_mobility_v1 WHERE key='account-safety:store-identity-v1'")).rows[0]?.value;const localNow=(await business.query("SELECT value FROM cop_mobility_v1 WHERE key='account-erasure:configuration-v1'")).rows[0]?.value;
   need(marker?.storeId===binding.applicationStoreId&&marker.incarnationId===binding.incarnationId&&localNow?.version===4&&localNow.storeId===binding.applicationStoreId&&localNow.fingerprint===binding.configurationFingerprint&&same(localNow.datasetBinding,{incarnationId:binding.incarnationId,restoreGeneration:binding.restoreGeneration}),'MEDIA_LOCAL_BINDING_MOVED');
   await connection.query('BEGIN');try{
    await connection.query('SELECT pg_advisory_xact_lock(1932540802,2)');
    const actual=(await connection.query("SELECT c.guard_store_id,c.application_store_id,c.configuration_fingerprint,r.store_id,r.incarnation_id,r.restore_generation,r.replay_sequence,r.replay_digest FROM cop_safety_v2.configuration c JOIN cop_safety_v2.dataset_replays r ON r.owner='cop' WHERE c.singleton FOR SHARE OF c,r")).rows[0];
    need(actual?.guard_store_id===binding.guardStoreId&&actual.application_store_id===binding.applicationStoreId&&actual.store_id===binding.applicationStoreId&&actual.configuration_fingerprint===binding.configurationFingerprint&&actual.incarnation_id===binding.incarnationId&&Number(actual.restore_generation)===binding.restoreGeneration&&Number(actual.replay_sequence)===binding.frontier.sequence&&actual.replay_digest===binding.frontier.digest,'MEDIA_GUARD_MOVED');
    const head=(await connection.query('SELECT sequence,digest FROM cop_safety_v2.fences ORDER BY sequence DESC LIMIT 1')).rows[0];need(head?Number(head.sequence)===binding.frontier.sequence&&head.digest===binding.frontier.digest:binding.frontier.sequence===0,'MEDIA_FRONTIER_MOVED');
    const e=p.evidence;need(e?.contractVersion==='cop-media-upload-closure-evidence-v1'&&e.production===true&&/^sha256:[a-f0-9]{64}$/u.test(e.providerImageId)&&e.providerReference===PROVIDER_REFERENCE&&e.endpoint===ENDPOINT&&e.bucket===BUCKET&&e.sourceRevision===p.release.sourceRevision&&['legacySlowBodyTerminated','oldSignatureDenied','newCredentialWorks','otherIdentityAndBucketPreserved','canaryObjectsRemoved'].every(k=>e[k]===true)&&sha(Buffer.from(JSON.stringify(e)+'\n'))===p.evidenceDigest,'MEDIA_ACTUAL_RECEIPT_REQUIRED');
    const values=[BUCKET,binding.applicationStoreId,binding.incarnationId,binding.restoreGeneration,ENDPOINT,fingerprint,p.previousCredentialFingerprint,e.providerImageId,e.providerStoppedAt,e.providerRestartedAt,e.oldCredentialDeniedAt,p.evidenceDigest];
    await connection.query('INSERT INTO cop_safety_v2.media_upload_closures(bucket,application_store_id,incarnation_id,restore_generation,endpoint,credential_fingerprint,previous_credential_fingerprint,provider_image_id,provider_stopped_at,provider_restarted_at,old_credential_denied_at,evidence_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',values);
    const readback=(await connection.query('SELECT endpoint,previous_credential_fingerprint,evidence_digest,provider_image_id FROM cop_safety_v2.media_upload_closures WHERE bucket=$1 AND application_store_id=$2 AND incarnation_id=$3 AND restore_generation=$4 AND credential_fingerprint=$5',[BUCKET,binding.applicationStoreId,binding.incarnationId,binding.restoreGeneration,fingerprint])).rows;need(readback.length===1&&readback[0].endpoint===ENDPOINT&&readback[0].previous_credential_fingerprint===p.previousCredentialFingerprint&&readback[0].evidence_digest===p.evidenceDigest&&readback[0].provider_image_id===e.providerImageId,'MEDIA_ENROLLMENT_READBACK_FAILED');
    await connection.query('COMMIT');await business.query('COMMIT');businessTransaction=false;
   }catch(error){await connection.query('ROLLBACK').catch(()=>{});throw error;}
  }finally{if(businessTransaction)await business?.query('ROLLBACK').catch(()=>{});business?.release();connection.release();}
  console.log(JSON.stringify({enrolled:true,readback:true}));
 }finally{await Promise.all([guard.end(),target.end(),admin?.end()]);}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const operation=process.argv[2];let lock,created=false,stopTransport;
 try{
  if(operation==='--worker')await workerMain();
  else{need(operation==='--check'||operation==='--apply','MEDIA_FIXED_OPERATION');checkedRelease();stopTransport=prepareProductionStorageTransport();need(inspectProductionStorageProviderTransport().storageTransportVerified===true,'MEDIA_STORAGE_TRANSPORT_UNPROVEN');lock=openSync(DIR+'/media-closure.lock',constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);created=true;await hostMain(operation);}
 }catch(error){const code=typeof error?.message==='string'&&/^[A-Z_]{5,80}$/u.test(error.message)?error.message:'MEDIA_CLOSURE_UNPROVEN';console.error(JSON.stringify({phase:'media_closure_not_complete',code,erasureEnabled:false,wholeAccountComplete:false,secretsPrinted:false}));process.exitCode=1;}
 finally{try{if(lock!==undefined)closeSync(lock);if(created)unlinkSync(DIR+'/media-closure.lock');}finally{stopTransport?.();}}
}
