/** New disposable real Keycloak realm. No production host or deletion claim. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {provisionErasureClient,ERASURE_CLIENT_ID} from './provision-erasure-client.mjs';
const directory='/dev/shm/cop-clean-whole';
const secret=JSON.parse(readFileSync(directory+'/credentials.json','utf8'));
const origin='http://127.0.0.1:8080', realm='cop';
const issuer='https://cop-erasure-keycloak.invalid/realms/cop';
globalThis.fixtureStage='keycloak_startup';
async function request(path,method='GET',body,bearer){
 assert(path.startsWith('/realms/')||path.startsWith('/admin/realms'));
 const r=await fetch(origin+path,{method,redirect:'error',signal:AbortSignal.timeout(10000),
  headers:{...(bearer?{authorization:'Bearer '+bearer}:{}),...(body?{'content-type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})});
 const raw=await r.text();assert(Buffer.byteLength(raw)<=1048576);
 return {status:r.status,value:raw?JSON.parse(raw):null};
}
const until=Date.now()+90000;
while(true){try{if((await request('/realms/master')).status===200)break}catch{}
 assert(Date.now()<until,'ACTUAL_KEYCLOAK_STARTUP_TIMEOUT');await new Promise(r=>setTimeout(r,250));}
async function token(client,form,which=realm){
 const r=await fetch(origin+'/realms/'+which+'/protocol/openid-connect/token',{method:'POST',redirect:'error',
  signal:AbortSignal.timeout(10000),headers:{'content-type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({client_id:client,...form})});
 assert.equal(r.status,200,'ACTUAL_KEYCLOAK_TOKEN_FAILED');return r.json();
}
const admin=(await token('admin-cli',{grant_type:'password',username:'fixture-admin',password:secret.adminPassword},'master')).access_token;
async function manage(path,method='GET',body){
 assert(path==='/admin/realms'||path.startsWith('/admin/realms/cop/'));
 const result=await request(path,method,body,admin);assert([200,201,204].includes(result.status),'ACTUAL_KEYCLOAK_ADMIN_FAILED');
 return result.value;
}
globalThis.fixtureStage='new_cop_realm';
await manage('/admin/realms','POST',{realm,enabled:true,registrationAllowed:false,sslRequired:'none'});
const base='/admin/realms/cop/';
await manage(base+'roles','POST',{name:'SIM_ADMIN',composite:false});
const simRole=await manage(base+'roles/SIM_ADMIN');
const clients={};
for(const clientId of ['cop-web','csm-mobile','csm-sim-web']){
 await manage(base+'clients','POST',{clientId,enabled:true,protocol:'openid-connect',publicClient:true,
  standardFlowEnabled:clientId==='cop-web',directAccessGrantsEnabled:true,serviceAccountsEnabled:false,
  defaultClientScopes:['basic','profile','email','roles'],optionalClientScopes:['offline_access'],
  ...(clientId==='cop-web'?{redirectUris:['https://cop-erasure-whole.invalid/auth/callback'],
   attributes:{'pkce.code.challenge.method':'S256'}}:{})});
 const result=await manage(base+'clients?'+new URLSearchParams({clientId,search:'false'}));
 assert.equal(result.length,1);clients[clientId]=result[0].id;
}
globalThis.fixtureStage='actual_two_users';
const actors={};
for(const [key,username] of [['a','fixture-owner-a'],['b','fixture-owner-b']]){
 await manage(base+'users','POST',{username,enabled:true,firstName:'Synthetic',lastName:key,
  email:username+'@example.invalid',emailVerified:true,
  credentials:[{type:'password',value:secret.userPassword,temporary:false}]});
 const users=await manage(base+'users?'+new URLSearchParams({username,exact:'true'}));assert.equal(users.length,1);
 const subjectId=users[0].id;await manage(base+'users/'+subjectId+'/role-mappings/realm','POST',[simRole]);
 const tokens={};
 for(const client of Object.keys(clients)){
  tokens[client]=await token(client,{grant_type:'password',username,password:secret.userPassword,scope:'openid offline_access'});
  const claims=JSON.parse(Buffer.from(tokens[client].access_token.split('.')[1],'base64url'));
  assert.equal(claims.iss,issuer);assert.equal(claims.sub,subjectId);assert(claims.realm_access.roles.includes('SIM_ADMIN'));
 }
 const userinfo=await request('/realms/cop/protocol/openid-connect/userinfo','GET',undefined,tokens['cop-web'].access_token);
 assert.equal(userinfo.status,200);assert.equal(userinfo.value.sub,subjectId);
 actors[key]={subjectId,username,password:secret.userPassword,cop:tokens['cop-web'],sim:tokens['csm-sim-web'],mobile:tokens['csm-mobile']};
}
globalThis.fixtureStage='exact_erasure_service';
const provision=async(path,method='GET',body)=>request(base+path,method,body,admin);
const worker=await provisionErasureClient({request:provision,secret:secret.workerSecret});
assert.equal(worker.created,true);
const workerToken=await token(ERASURE_CLIENT_ID,{grant_type:'client_credentials',client_secret:secret.workerSecret});
const workerClaims=JSON.parse(Buffer.from(workerToken.access_token.split('.')[1],'base64url'));
assert.equal(workerClaims.sub,worker.serviceUuid);
const state={contractVersion:'cop-clean-whole12-keycloak-private-v1',issuer,actors,clientUuids:clients,
 erasureClient:{id:ERASURE_CLIENT_ID,secret:secret.workerSecret,clientUuid:worker.clientUuid,serviceUuid:worker.serviceUuid}};
writeFileSync(directory+'/keycloak-seed.json',JSON.stringify(state),{mode:0o600,flag:'wx'});
console.log(JSON.stringify({actualKeycloakPrepared:true,actorCount:2,realm:'cop',productionTouched:false,wholeAccountAccepted:false}));
