#!/usr/bin/env node
/** External clean-release Root preparation, separate from the immutable bundle.
 * The hash-bound release launcher verifies the existing sealed COP source first.
 * Uses its canonical host parser without rewriting unrelated/duplicate lines.
 * Does not enable erasure or recreate any container.
 * Administrator password/token stay in RAM; the worker secret is written only
 * by atomic replacement of the existing /srv/cop/.env. No credential backup. */
import {randomBytes} from 'node:crypto';
import {constants,openSync,fstatSync,readFileSync,closeSync,writeFileSync,fsyncSync,fchownSync,fchmodSync,renameSync,unlinkSync} from 'node:fs';
import {hostname} from 'node:os';
import {provisionErasureClient,ERASURE_CLIENT_ID,ERASURE_EFFECTIVE_ROLES} from '/srv/x5-production/staging/cop/clean-operator-shared-v3/app/scripts/keycloak/provision-erasure-client.mjs';
import {parseOperatorHostEnvironment} from '/srv/x5-production/staging/cop/clean-operator-shared-v3/app/scripts/account-safety/operator-profile-environment.mjs';
const check=v=>{if(!v)throw Error('KEYCLOAK_INSTALL_UNPROVEN');};
const envPath='/srv/cop/.env';
function readPrivate() {
 const fd=openSync(envPath,constants.O_RDONLY|constants.O_NOFOLLOW);
 try {const st=fstatSync(fd);check(st.isFile()&&st.nlink===1&&(st.mode&0o777)===0o600&&st.size<1048576);
 return {bytes:readFileSync(fd),uid:st.uid,gid:st.gid,mode:st.mode&0o777,ino:st.ino};}finally{closeSync(fd);}
}
function parse(bytes) {
 return new Map(Object.entries(parseOperatorHostEnvironment(bytes.toString('utf8'))));
}
function replace(original,updates) {
 const now=readPrivate();check(now.ino===original.ino&&now.bytes.equals(original.bytes));
 let text=original.bytes.toString('utf8');if(!text.endsWith('\n'))text+='\n';
 for(const [k,v]of updates) {check(/^[A-Z_]+$/u.test(k)&&/^[A-Za-z0-9_-]+$/u.test(v));
  const lines=text.split('\n');const index=lines.findIndex(line=>line.startsWith(k+'='));
  if(index>=0)lines[index]=k+'='+v;else lines.splice(-1,0,k+'='+v);text=lines.join('\n');}
 const tmp=envPath+'.keycloak-atomic-'+randomBytes(12).toString('hex');let fd;
 try {fd=openSync(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  fchownSync(fd,original.uid,original.gid);writeFileSync(fd,text);fchmodSync(fd,original.mode);fsyncSync(fd);closeSync(fd);fd=undefined;
  check(readPrivate().bytes.equals(original.bytes));renameSync(tmp,envPath);
  const dir=openSync('/srv/cop',constants.O_RDONLY);try{fsyncSync(dir);}finally{closeSync(dir);}
 }finally{if(fd!==undefined)closeSync(fd);try{unlinkSync(tmp);}catch(e){if(e.code!=='ENOENT')throw e;}}
 const final=parse(readPrivate().bytes);for(const[k,v]of updates)check(final.get(k)===v);
}
async function boundedJson(response) {
 const reader=response.body?.getReader();check(reader);let size=0;const chunks=[];
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>1048576){await reader.cancel();throw Error();}chunks.push(part.value);}}
 finally{reader.releaseLock();}
 const bytes=Buffer.concat(chunks);return bytes.length?JSON.parse(bytes.toString('utf8')):null;
}
async function prompt(label,secret=false) {
 check(process.stdin.isTTY&&process.stdout.isTTY);process.stdout.write(label);
 return new Promise((resolve,reject)=>{
  let value='';const input=process.stdin;input.setEncoding('utf8');if(secret)input.setRawMode(true);input.resume();
  const cleanup=()=>{input.off('data',onData);if(secret)input.setRawMode(false);input.pause();};
  function onData(chunk){for(const c of chunk){if(c==='\u0003'){cleanup();reject(Error('ABORTED'));return;}
   if(c==='\n'||c==='\r'){cleanup();process.stdout.write('\n');resolve(value);return;}
   if(c==='\u007f'||c==='\b'){value=value.slice(0,-1);continue;}
   if(c>=' '&&value.length<4096)value+=c;}}
  input.on('data',onData);
 });
}
let lock,lockCreated=false;
let preparationStage='context';
try {
 check(Number(process.versions.node.split('.')[0])===24&&process.argv.length===3&&process.argv[2]==='--apply'&&process.getuid?.()===0&&hostname().split('.')[0]==='docker');
 check(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH);
 lock=openSync('/srv/cop/.keycloak-erasure-install.lock',constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);lockCreated=true;
 preparationStage='host_configuration';
 const original=readPrivate(),env=parse(original.bytes);
 check(env.get('COP_OIDC_ISSUER')==='https://login.zeleznalady.cz/realms/cop');
 for(const key of ['COP_ACCOUNT_ERASURE_ENABLED','COP_ACCOUNT_SAFETY_GUARD_REQUIRED','COP_KEYCLOAK_COP_SCOPE_AUTHORITY_ACCEPTED'])check(!env.has(key)||env.get(key)==='false');
 const existingId=env.get('COP_KEYCLOAK_ERASURE_CLIENT_ID'),existingSecret=env.get('COP_KEYCLOAK_ERASURE_CLIENT_SECRET');
 check((!existingId&&!existingSecret)||(existingId===ERASURE_CLIENT_ID&&/^[A-Za-z0-9_-]{43,128}$/u.test(existingSecret??'')));
 preparationStage='administrator_authentication';
 const username=await prompt('Keycloak administrator username: ');let password=await prompt('Keycloak administrator password (not echoed): ',true);
 check(username.length>0&&password.length>0);
 const tokenResponse=await fetch('https://login.zeleznalady.cz/realms/master/protocol/openid-connect/token',{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/x-www-form-urlencoded','cache-control':'no-store'},
  body:new URLSearchParams({grant_type:'password',client_id:'admin-cli',username,password})});password='';
 check(tokenResponse.status===200);const tokenBody=await boundedJson(tokenResponse);check(typeof tokenBody.access_token==='string'&&tokenBody.access_token.length<32768);
 let bearer=tokenBody.access_token;delete tokenBody.access_token;
 const secret=existingSecret??randomBytes(32).toString('base64url');
 // Persist before remote creation so an interruption cannot orphan its secret.
 if(!existingSecret)replace(original,new Map([['COP_KEYCLOAK_ERASURE_CLIENT_ID',ERASURE_CLIENT_ID],['COP_KEYCLOAK_ERASURE_CLIENT_SECRET',secret],['COP_KEYCLOAK_COP_SCOPE_AUTHORITY_ACCEPTED','false']]));
 preparationStage='worker_provisioning';
 const result=await provisionErasureClient({secret,request:async(path,method='GET',body)=>{
  const r=await fetch(new URL(path,'https://login.zeleznalady.cz/admin/realms/cop/'),{method,redirect:'error',signal:AbortSignal.timeout(15000),
   headers:{authorization:'Bearer '+bearer,'cache-control':'no-store',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:r.status,value:await boundedJson(r)};
 }});bearer='';
 preparationStage='worker_token_verification';
 const ownTokenResponse=await fetch('https://login.zeleznalady.cz/realms/cop/protocol/openid-connect/token',{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/x-www-form-urlencoded','cache-control':'no-store'},
  body:new URLSearchParams({grant_type:'client_credentials',client_id:ERASURE_CLIENT_ID,client_secret:secret})});
 check(ownTokenResponse.status===200);const ownToken=await boundedJson(ownTokenResponse);
 check(typeof ownToken.access_token==='string'&&ownToken.access_token.length<32768);
 const claims=JSON.parse(Buffer.from(ownToken.access_token.split('.')[1],'base64url').toString('utf8'));delete ownToken.access_token;
 check(claims.sub===result.serviceUuid&&claims.iss==='https://login.zeleznalady.cz/realms/cop'&&claims.azp===ERASURE_CLIENT_ID&&claims.exp>Math.floor(Date.now()/1000)&&claims.exp-claims.iat<=60&&
   JSON.stringify(Object.keys(claims.resource_access??{}))===JSON.stringify(['realm-management'])&&
   JSON.stringify((claims.resource_access['realm-management'].roles??[]).sort())===JSON.stringify(ERASURE_EFFECTIVE_ROLES));
 // No target user API is invoked by provisioning; no runtime flag is enabled.
 console.log(JSON.stringify({phase:'complete_disabled',clientId:result.clientId,created:result.created,roles:result.roles,effectiveRoles:result.effectiveRoles,fullScopeAllowed:false,erasureEnabled:false,servicesChanged:false,secretsPrinted:false}));
}catch{console.error(JSON.stringify({phase:'not_complete',code:'KEYCLOAK_INSTALL_UNPROVEN',stage:preparationStage,erasureEnabled:false}));process.exitCode=1;}
finally{if(lock!==undefined)closeSync(lock);if(lockCreated)unlinkSync('/srv/cop/.keycloak-erasure-install.lock');}
