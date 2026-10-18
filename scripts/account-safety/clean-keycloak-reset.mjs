/** Operator-only, all COP-realm test humans. No HTTP route, CLI or auto-apply.
 * The existing service account/clients/realm/master realm are preserved.
 * Identity lists and credentials stay in memory; receipts expose only counts.
 */
import {createHmac} from 'node:crypto';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha=(secret,value)=>createHmac('sha256',secret).update(JSON.stringify(value)).digest('hex');
export function createCleanKeycloakReset(config){
 const root=new URL(config.issuer),match=root.pathname.match(/^(.*)\/realms\/cop$/);
 if(root.protocol!=='https:'||root.username||root.password||root.hash||root.search||!match||config.clientId!=='cop-account-erasure-worker'||typeof config.clientSecret!=='string'||config.clientSecret.length<32)throw Error('RESET_IDENTITY_CONFIG_INVALID');
 const base=new URL(match[1]+'/admin/realms/cop/',root.origin);
 async function json(r){const reader=r.body?.getReader();if(!reader)return null;let n=0;const chunks=[];try{for(;;){const v=await reader.read();if(v.done)break;n+=v.value.byteLength;if(n>1048576){await reader.cancel();throw Error('RESET_IDENTITY_RESPONSE_TOO_LARGE')}chunks.push(v.value)}}finally{reader.releaseLock()}return JSON.parse(Buffer.concat(chunks).toString('utf8'))}
 async function bearer(){const r=await fetch(config.issuer+'/protocol/openid-connect/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:config.clientId,client_secret:config.clientSecret})});if(r.status!==200){await r.body?.cancel();throw Error('RESET_IDENTITY_AUTH_UNAVAILABLE')}const v=await json(r);if(typeof v?.access_token!=='string'||v.access_token.length>16384||v.token_type?.toLowerCase()!=='bearer')throw Error('RESET_IDENTITY_AUTH_UNAVAILABLE');return v.access_token}
 async function request(path,method='GET',body){const r=await fetch(new URL(path,base),{method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{authorization:'Bearer '+await bearer(),'cache-control':'no-store',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});if(r.status===200)return {status:200,value:await json(r)};await r.body?.cancel();return {status:r.status}}
 const validUser=x=>x&&typeof x==='object'&&uuid.test(x.id)&&Number.isSafeInteger(x.createdTimestamp)&&x.createdTimestamp>=0;
 async function list(){
  const services=new Map(),clientIds=new Set(),serviceClientNames=new Set();
  const c=await request('clients?first=0&max=1024');
  if(c.status!==200||!Array.isArray(c.value)||c.value.length>=1024)throw Error('RESET_CLIENT_INVENTORY_UNPROVEN');
  for(const client of c.value){
   if(!client||!uuid.test(client.id)||clientIds.has(client.id))throw Error('RESET_CLIENT_INVENTORY_UNPROVEN');
   clientIds.add(client.id);
   if(client.serviceAccountsEnabled===true){
    if(typeof client.clientId!=='string'||client.clientId.length===0||client.clientId.length>255||client.clientId.includes('\0')||serviceClientNames.has(client.clientId))throw Error('RESET_SERVICE_IDENTITY_UNPROVEN');
    serviceClientNames.add(client.clientId);
    const u=await request('clients/'+client.id+'/service-account-user');
    if(u.status!==200||!validUser(u.value)||services.has(u.value.id)||(Object.hasOwn(u.value,'serviceAccountClientId')&&u.value.serviceAccountClientId!==client.clientId))throw Error('RESET_SERVICE_IDENTITY_UNPROVEN');
    services.set(u.value.id,{id:u.value.id,createdTimestamp:u.value.createdTimestamp,clientUuid:client.id,clientId:client.clientId});
   }
  }
  const users=new Map();let closed=false;
  for(let first=0;first<5000;first+=100){
   const r=await request('users?first='+first+'&max=100&briefRepresentation=false');
   if(r.status!==200||!Array.isArray(r.value)||r.value.length>100)throw Error('RESET_USER_INVENTORY_UNPROVEN');
   for(const u of r.value){
    if(!validUser(u)||users.has(u.id))throw Error('RESET_USER_BINDING_UNPROVEN');
    const service=services.get(u.id);
    if(service){
     if(u.createdTimestamp!==service.createdTimestamp||(Object.hasOwn(u,'serviceAccountClientId')&&u.serviceAccountClientId!==service.clientId))throw Error('RESET_SERVICE_IDENTITY_UNPROVEN');
    }else if(Object.hasOwn(u,'serviceAccountClientId'))throw Error('RESET_UNKNOWN_SERVICE_IDENTITY');
    users.set(u.id,{id:u.id,createdTimestamp:u.createdTimestamp});
   }
   if(r.value.length<100){closed=true;break}
  }
  if(!closed)throw Error('RESET_USER_INVENTORY_UNPROVEN');
  // Ordinary /users may omit service accounts. Each service is authoritative
  // only through its client endpoint and is merged into the complete snapshot.
  // Services already present in /users were checked for an exact binding above.
  for(const service of services.values())if(!users.has(service.id))users.set(service.id,{id:service.id,createdTimestamp:service.createdTimestamp});
  const all=[...users.values()].sort((a,b)=>a.id.localeCompare(b.id));
  const serviceBindings=[...services.values()].sort((a,b)=>a.id.localeCompare(b.id));
  return {humans:all.filter(u=>!services.has(u.id)),services:serviceBindings,fingerprint:sha(config.clientSecret,[config.issuer,all,serviceBindings])};
 }
 async function inspect(){const v=await list();return {contractVersion:'cop-keycloak-test-reset-plan-v1',humanCount:v.humans.length,serviceCount:v.services.length,inventoryDigest:v.fingerprint}}
 async function apply(plan,authorization){
  if(authorization?.contractVersion!=='cop-keycloak-test-reset-authorization-v1'||authorization.allTestHumanIdentitiesApproved!==true||authorization.copSimWritersStopped!==true||authorization.createOldDataBackup!==false||!uuid.test(authorization.resetEpoch??''))throw Error('RESET_IDENTITY_AUTHORIZATION_REQUIRED');
  const before=await list();if(plan?.contractVersion!=='cop-keycloak-test-reset-plan-v1'||plan.inventoryDigest!==before.fingerprint||plan.humanCount!==before.humans.length||plan.serviceCount!==before.services.length)throw Error('RESET_IDENTITY_PLAN_CHANGED');
  // Disable all human identities before removing any. Client/service tokens keep working.
  for(const u of before.humans){const r=await request('users/'+u.id);if(r.status!==200||!validUser(r.value)||r.value.id!==u.id||r.value.createdTimestamp!==u.createdTimestamp||Object.hasOwn(r.value,'serviceAccountClientId'))throw Error('RESET_IDENTITY_CHANGED');const disabled=await request('users/'+u.id,'PUT',{enabled:false});if(disabled.status!==204)throw Error('RESET_IDENTITY_DISABLE_PENDING')}
  for(const u of before.humans){const r=await request('users/'+u.id);if(r.status!==200||r.value?.enabled!==false||r.value.id!==u.id||r.value.createdTimestamp!==u.createdTimestamp||Object.hasOwn(r.value,'serviceAccountClientId'))throw Error('RESET_IDENTITY_DISABLE_UNPROVEN');const deleted=await request('users/'+u.id,'DELETE');if(![204,404].includes(deleted.status)||(await request('users/'+u.id)).status!==404)throw Error('RESET_IDENTITY_DELETE_PENDING')}
  const after=await list();if(after.humans.length!==0||JSON.stringify(after.services)!==JSON.stringify(before.services))throw Error('RESET_IDENTITY_READBACK_FAILED');
  return {contractVersion:'cop-keycloak-test-reset-result-v1',resetEpoch:authorization.resetEpoch,removedHumanCount:before.humans.length,preservedServiceCount:after.services.length,realmConfigurationChanged:false,clientConfigurationChanged:false,oldDataBackupCreated:false};
 }
 return {inspect,apply};
}
