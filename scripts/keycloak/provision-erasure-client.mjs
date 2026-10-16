/** Exact, retryable server-account provisioning. No action runs on import.
 * Secrets exist only in caller memory/provider secret store. The caller must
 * persist the selected secret in the existing COP env before first creation.
 * No existing foreign client, user identity or SSO setting is modified. */
export const ERASURE_CLIENT_ID = 'cop-account-erasure-worker';
export const ERASURE_MANAGEMENT_ROLES = Object.freeze(['manage-users', 'query-clients', 'view-clients', 'view-users']);
export const ERASURE_EFFECTIVE_ROLES=Object.freeze([...ERASURE_MANAGEMENT_ROLES,'query-groups','query-users'].sort());
const composites=Object.freeze({'manage-users':[],'query-clients':[],'view-clients':['query-clients'],'view-users':['query-groups','query-users']});
const marker = 'cop-jizda-erasure-preserve-sim-v1';
const fail = () => { throw new Error('KEYCLOAK_PROVISION_UNPROVEN'); };
const check = value => { if (!value) fail(); };
const names = rows => rows.map(row => row.name).sort();
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const uuid = value => typeof value === 'string' && /^[0-9a-f-]{36}$/u.test(value);

export async function provisionErasureClient({ request, secret }) {
  check(typeof secret === 'string' && /^[A-Za-z0-9_-]{43,128}$/u.test(secret));
  const call = async (path, method='GET', body) => {
    check(path.startsWith('clients') || path.startsWith('users/'));
    const r = await request(path, method, body);
    check([200,201,204].includes(r.status)); return r.value;
  };
  const find = async id => {
    const rows=await call('clients?'+new URLSearchParams({clientId:id,search:'false',first:'0',max:'2'}));
    check(Array.isArray(rows) && rows.length <= 1);
    if(rows.length) check(rows[0].clientId===id && uuid(rows[0].id));
    return rows[0];
  };
  // Validate both fixed consuming clients before preparing any authority.
  for(const id of ['cop-web','csm-mobile']) {
    const c=await find(id); check(c && c.protocol==='openid-connect');
  }
  const manager=await find('realm-management');check(manager);
  const roles=[];
  for(const name of ERASURE_MANAGEMENT_ROLES) {
    const r=await call(`clients/${manager.id}/roles/${name}`);
    check(r.name===name && r.clientRole===true && r.containerId===manager.id && uuid(r.id) && r.composite===(composites[name].length>0));
    const children=await call(`clients/${manager.id}/roles/${name}/composites`);
    check(Array.isArray(children) && same(names(children),composites[name]) && children.every(c=>c.clientRole===true&&c.containerId===manager.id&&c.composite===false&&uuid(c.id)));
    roles.push(r);
  }
  let worker=await find(ERASURE_CLIENT_ID),created=false;
  if(!worker) {
    await call('clients','POST',{clientId:ERASURE_CLIENT_ID,protocol:'openid-connect',enabled:true,
      publicClient:false,clientAuthenticatorType:'client-secret',serviceAccountsEnabled:true,
      standardFlowEnabled:false,implicitFlowEnabled:false,directAccessGrantsEnabled:false,
      fullScopeAllowed:false,consentRequired:false,secret,
      redirectUris:[],webOrigins:[],attributes:{'cop.erasure.purpose':marker,'access.token.lifespan':'60'}});
    worker=await find(ERASURE_CLIENT_ID);created=true;
  }
  check(worker);
  const current=await call('clients/'+worker.id);
  check(current.clientId===ERASURE_CLIENT_ID && current.protocol==='openid-connect' && current.enabled===true &&
    current.publicClient===false && current.clientAuthenticatorType==='client-secret' &&
    current.serviceAccountsEnabled===true && current.standardFlowEnabled===false &&
    current.implicitFlowEnabled===false && current.directAccessGrantsEnabled===false &&
    current.fullScopeAllowed===false && current.consentRequired===false &&
    Array.isArray(current.redirectUris) && current.redirectUris.length===0 &&
    Array.isArray(current.webOrigins) && current.webOrigins.length===0 && current.attributes?.['cop.erasure.purpose']===marker && current.attributes?.['access.token.lifespan']==='60');
  const providerSecret=await call(`clients/${worker.id}/client-secret`);
  check(providerSecret.type==='secret' && providerSecret.value===secret);
  const service=await call(`clients/${worker.id}/service-account-user`);
  check(uuid(service.id) && service.username==='service-account-'+ERASURE_CLIENT_ID && service.enabled===true &&
    (!Object.hasOwn(service,'serviceAccountClientId')||service.serviceAccountClientId===ERASURE_CLIENT_ID));
  const mapping=`users/${service.id}/role-mappings/clients/${manager.id}`;
  const scope=`clients/${worker.id}/scope-mappings/clients/${manager.id}`;
  for(const path of [mapping,scope]) {
    const rows=await call(path); check(Array.isArray(rows));
    check(rows.every(r=>roles.some(w=>r.id===w.id && r.name===w.name)));
    const missing=roles.filter(r=>!rows.some(x=>x.id===r.id));
    if(missing.length) await call(path,'POST',missing);
    const readback=await call(path);check(Array.isArray(readback) && same(names(readback),ERASURE_MANAGEMENT_ROLES));
  }
  const scopeReadback=await call(`clients/${worker.id}/scope-mappings`);
  check(!scopeReadback.realmMappings?.length && same(Object.keys(scopeReadback.clientMappings??{}),['realm-management']));
  const ownScope=scopeReadback.clientMappings['realm-management'];
  check(ownScope.id===manager.id&&ownScope.client==='realm-management'&&same(names(ownScope.mappings),ERASURE_MANAGEMENT_ROLES));
  // No realm-admin/group/composite authority may hide in this dedicated user.
  const effective=await call(mapping+'/composite');
  check(Array.isArray(effective) && same(names(effective),ERASURE_EFFECTIVE_ROLES) && effective.every(r=>r.clientRole===true&&r.containerId===manager.id));
  const groups=await call(`users/${service.id}/groups?first=0&max=2`);
  check(Array.isArray(groups) && groups.length===0);
  return {clientId:ERASURE_CLIENT_ID,clientUuid:worker.id,serviceUuid:service.id,created,roles:[...ERASURE_MANAGEMENT_ROLES],effectiveRoles:[...ERASURE_EFFECTIVE_ROLES],
    fullScopeAllowed:false,erasureEnabled:false,sharedIdentityChanged:false};
}
