// Reserved, disposable provider only. All local checkpoints are explicit fixtures.
import assert from 'node:assert/strict';
import { createKeycloakAccountErasureAdapter } from './keycloak-account-erasure.js';
import { provisionErasureClient, ERASURE_CLIENT_ID } from './provision-erasure-client.mjs';

const nativeFetch = globalThis.fetch;
const origin = 'http://127.0.0.1:8080';
const realm = 'cop-erasure-fixture';
const issuer = `https://cop-erasure-keycloak.invalid/realms/${realm}`;
const syntheticSecret = 'synthetic-fixture-worker-not-a-production-secret';
const provisionSecret='synthetic-only-erasure-client-secret-not-production-v1';
const checks = [];
globalThis.fixtureStage = 'provider_startup';

async function response(path, method = 'GET', body, bearer) {
  assert(path.startsWith('/'));
  const headers = { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await nativeFetch(origin + path, { method, headers, redirect: 'error',
    signal: AbortSignal.timeout(10000), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  return { status: r.status, value: text ? JSON.parse(text) : null, location: r.headers.get('location') };
}
async function token(client, form, clientSecret) {
  const r = await nativeFetch(`${origin}/realms/${client === 'admin-cli' ? 'master' : realm}/protocol/openid-connect/token`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client, ...form, ...(clientSecret ? { client_secret: clientSecret } : {}) })
  });
  assert.equal(r.status, 200);
  const result = await r.json();
  assert.equal(typeof result.access_token, 'string');
  return result;
}
const until = Date.now() + 60000;
while (true) {
  try { if ((await response('/realms/master')).status === 200) break; } catch {}
  assert(Date.now() < until);
  await new Promise(resolve => setTimeout(resolve, 200));
}
globalThis.fixtureStage = 'synthetic_realm_provision';
const admin = (await token('admin-cli', { grant_type: 'password', username: 'fixture-admin', password: 'synthetic-bootstrap-not-production' })).access_token;
async function manage(path, method = 'GET', body) {
  assert(path === '/admin/realms' || path.startsWith(`/admin/realms/${realm}/`));
  const r = await response(path, method, body, admin);
  assert([200, 201, 204].includes(r.status));
  return r;
}
await manage('/admin/realms', 'POST', { realm, enabled: true, registrationAllowed: false,
  directGrantFlow: 'direct grant', sslRequired: 'none' });
const base = `/admin/realms/${realm}/`;
async function client(clientId, worker = false) {
  await manage(base + 'clients', 'POST', { clientId, enabled: true, protocol: 'openid-connect',
    publicClient: !worker, standardFlowEnabled: false, directAccessGrantsEnabled: !worker,
    serviceAccountsEnabled: worker, consentRequired: false,
    ...(worker ? { secret: syntheticSecret } : { optionalClientScopes: ['offline_access'] }) });
  const r = await manage(base + 'clients?' + new URLSearchParams({ clientId, search: 'false' }));
  assert.equal(r.value.length, 1);
  return r.value[0];
}
const clients = {};
for (const id of ['cop-web', 'csm-mobile', 'csm-sim-web']) clients[id] = await client(id);
const roles = {};
for (const id of Object.keys(clients)) {
  const name = id === 'csm-sim-web' ? 'sim-operator' : id + '-user';
  await manage(base + `clients/${clients[id].id}/roles`, 'POST', { name, composite: false });
  roles[id] = (await manage(base + `clients/${clients[id].id}/roles/${name}`)).value;
}
async function user(name) {
  await manage(base + 'users', 'POST', { username: name, enabled: true,
    firstName: 'Synthetic', lastName: name, email: `${name}@example.invalid`, emailVerified: true,
    credentials: [{ type: 'password', value: 'synthetic-user-not-production', temporary: false }] });
  const r = await manage(base + 'users?' + new URLSearchParams({ username: name, exact: 'true' }));
  assert.equal(r.value.length, 1);
  const result = r.value[0];
  for (const id of Object.keys(clients))
    await manage(base + `users/${result.id}/role-mappings/clients/${clients[id].id}`, 'POST', [roles[id]]);
  return result;
}
const a = await user('fixture-owner-a'), b = await user('fixture-owner-b');
const offline = {};
for (const owner of [a, b]) for (const id of Object.keys(clients)) {
  const r = await token(id, { grant_type: 'password', username: owner.username,
    password: 'synthetic-user-not-production', scope: 'openid offline_access' });
  assert.equal(typeof r.refresh_token, 'string');
  offline[owner.id + id] = r;
}
checks.push('actual two-user profiles COP roles offline grants and independent SIM tokens seeded');
async function providerState(owner) {
  const value = { user: (await manage(base + `users/${owner.id}`)).value,
    consents: (await manage(base + `users/${owner.id}/consents`)).value,
    roles: {}, offline: {} };
  for (const id of Object.keys(clients)) {
    value.roles[id] = (await manage(base + `users/${owner.id}/role-mappings/clients/${clients[id].id}`)).value;
    value.offline[id] = (await manage(base + `users/${owner.id}/offline-sessions/${clients[id].id}`)).value;
  }
  return value;
}
const beforeA = await providerState(a), beforeB = await providerState(b);
for (const id of Object.keys(clients)) assert(beforeA.offline[id].length > 0);
async function worker(clientId, managementRoles) {
  const c = await client(clientId, true);
  const service = (await manage(base + `clients/${c.id}/service-account-user`)).value;
  const manager = (await manage(base + 'clients?' + new URLSearchParams({ clientId: 'realm-management', search: 'false' }))).value;
  assert.equal(manager.length, 1);
  const available = (await manage(base + `clients/${manager[0].id}/roles`)).value;
  const selected = managementRoles.map(name => available.find(r => r.name === name));
  assert(selected.every(Boolean));
  await manage(base + `users/${service.id}/role-mappings/clients/${manager[0].id}`, 'POST', selected);
}
await worker('fixture-readonly-worker', ['view-users', 'query-clients', 'view-clients']);
const provisionRequest=async(path,method='GET',body)=>response(base+path,method,body,admin);
const management=(await manage(base+'clients?'+new URLSearchParams({clientId:'realm-management',search:'false'}))).value[0];
globalThis.fixtureRoleMetadata=[];
for(const name of ['manage-users','query-clients','view-clients','view-users']) {
 const role=(await manage(base+`clients/${management.id}/roles/${name}`)).value;
 const children=(await manage(base+`clients/${management.id}/roles/${name}/composites`)).value;
 globalThis.fixtureRoleMetadata.push({name:role.name,composite:role.composite,clientRole:role.clientRole,
  correctContainer:role.containerId===management.id,children:children.map(r=>({name:r.name,composite:r.composite,clientRole:r.clientRole,correctContainer:r.containerId===management.id}))});
}
globalThis.fixtureStage='exact_worker_provision';
const provisioned=await provisionErasureClient({request:provisionRequest,secret:provisionSecret});
assert.equal(provisioned.created,true);
const retryProvision=await provisionErasureClient({request:provisionRequest,secret:provisionSecret});
assert.equal(retryProvision.created,false);
assert.equal(retryProvision.clientUuid,provisioned.clientUuid);
await assert.rejects(()=>provisionErasureClient({request:provisionRequest,secret:provisionSecret+'x'}));
const workerToken=await token(ERASURE_CLIENT_ID,{grant_type:'client_credentials'},provisionSecret);
const claims=JSON.parse(Buffer.from(workerToken.access_token.split('.')[1],'base64url').toString());
assert.equal(claims.sub,provisioned.serviceUuid);
assert.deepEqual(claims.resource_access['realm-management'].roles.sort(),['manage-users','query-clients','query-groups','query-users','view-clients','view-users']);
assert.deepEqual(Object.keys(claims.resource_access),['realm-management']);
assert(claims.exp-claims.iat<=60);
checks.push('actual scoped provisioner creates exact four-role worker with fullScopeAllowed false, retries without rotation and rejects wrong secret');

const calls = [];
// Only fixture transport is rewritten; bodies, methods, authentication and
// responses are genuine provider traffic. Production TLS is not exercised.
globalThis.fetch = (input, options) => {
  const u = new URL(String(input));
  assert.equal(u.origin, 'https://cop-erasure-keycloak.invalid');
  assert(u.pathname.startsWith(`/realms/${realm}/`) || u.pathname.startsWith(`/admin/realms/${realm}/`));
  calls.push({ method: options?.method ?? 'GET', path: u.pathname });
  return nativeFetch(origin + u.pathname + u.search, options);
};
function checkpointStore() {
  const values = new Map();
  return { transact: async (_keys, action) => action({
    get: async key => structuredClone(values.get(key)),
    set: async (key, value) => { values.set(key, structuredClone(value)); }
  }) };
}
const actor = { authMode: 'oidc', issuer, subjectId: a.id, username: '', displayName: '' };
const binding1 = { incarnationId: '10000000-0000-4000-8000-000000000001', restoreGeneration: 1 };
const binding2 = { incarnationId: '20000000-0000-4000-8000-000000000001', restoreGeneration: 2 };
const ctx = binding => ({ accountKey: 'a'.repeat(64), operationId: '30000000-0000-4000-8000-000000000001',
  requestedAt: '2026-10-16T00:00:00.000Z', datasetBinding: binding, signal: AbortSignal.timeout(20000) });
function adapter(clientId) {
  return createKeycloakAccountErasureAdapter({ issuer, clientId, clientSecret: clientId===ERASURE_CLIENT_ID ? provisionSecret : syntheticSecret,
    authorityAccepted: true, assertCopAccessFenced: async value => value.issuer === issuer && value.subjectId === a.id
  }, checkpointStore());
}
globalThis.fixtureStage = 'insufficient_authority_denied';
const readonly = adapter('fixture-readonly-worker');
assert.equal(await readonly.ready(), true);
await assert.rejects(readonly.erase(actor, ctx(binding1)), /REVOCATION_UNPROVEN/);
assert.deepEqual(await providerState(a), beforeA);
checks.push('actual read-only worker receives revocation denial without changing grants');

globalThis.fixtureStage = 'scoped_real_provider_erase';
const full = adapter(ERASURE_CLIENT_ID);
assert.equal(await full.ready(), true);
assert.equal((await full.preflight(actor, ctx(binding1))).ready, true);
const first = await full.erase(actor, ctx(binding1));
assert.equal(first.status, 'completed');
const afterA = await providerState(a);
assert.deepEqual(afterA.user, beforeA.user);
assert.deepEqual(afterA.roles['csm-sim-web'], beforeA.roles['csm-sim-web']);
assert.deepEqual(afterA.offline['csm-sim-web'], beforeA.offline['csm-sim-web']);
assert.deepEqual(await providerState(b), beforeB);
for (const id of ['cop-web', 'csm-mobile']) {
  assert.deepEqual(afterA.roles[id], []); assert.deepEqual(afterA.offline[id], []);
}
checks.push('actual adapter removes A COP grants while preserving shared identity SIM and complete B state');
const deletes = calls.filter(c => c.method === 'DELETE').length;
assert.deepEqual(await full.erase(actor, ctx(binding1)), first);
assert.equal(calls.filter(c => c.method === 'DELETE').length, deletes);
checks.push('actual completed retry performs fresh provider reads without repeating removals');

globalThis.fixtureStage = 'actual_restored_grants_recovery';
await token('cop-web', { grant_type: 'password', username: a.username,
  password: 'synthetic-user-not-production', scope: 'openid offline_access' });
await manage(base + `users/${a.id}/role-mappings/clients/${clients['cop-web'].id}`, 'POST', [roles['cop-web']]);
await assert.rejects(full.erase(actor, ctx(binding1)), /GRANTS_REAPPEARED/);
const recovered = await full.erase(actor, ctx(binding2));
assert.equal(recovered.status, 'completed'); assert.notDeepEqual(recovered, first);
assert.deepEqual(await providerState(b), beforeB);
checks.push('same-generation restored grants denied; explicit new generation rechecks and removes actual COP grants');
globalThis.fixtureStage = 'sim_access_preservation';
const sim = await token('csm-sim-web', { grant_type: 'refresh_token', refresh_token: offline[a.id + 'csm-sim-web'].refresh_token });
const info = await response(`/realms/${realm}/protocol/openid-connect/userinfo`, 'GET', undefined, sim.access_token);
assert.equal(info.status, 200); assert.equal(info.value.sub, a.id);
checks.push('actual retained SIM refresh token still obtains usable userinfo access after COP removal');
assert(calls.filter(c => c.method === 'DELETE').every(c =>
  /^\/admin\/realms\/cop-erasure-fixture\/users\/[^/]+\/(consents\/(cop-web|csm-mobile)|role-mappings\/clients\/[^/]+)$/.test(c.path)));
checks.push('adapter traffic contains no user deletion global logout realm or SIM mutations');
globalThis.fixtureStage='tampered_worker_scope_rejected';
const administratorRole=(await manage(base+`clients/${management.id}/roles/realm-admin`)).value;
await manage(base+`clients/${provisioned.clientUuid}/scope-mappings/clients/${management.id}`,'POST',[administratorRole]);
await assert.rejects(()=>provisionErasureClient({request:provisionRequest,secret:provisionSecret}));
assert.deepEqual(await providerState(b),beforeB);
checks.push('actual unexpected realm-admin scope injection is rejected rather than adopted or repaired silently');
console.log(JSON.stringify({ scope: 'actual Keycloak26.8 disposable provider; explicit in-memory COP checkpoints',
  passed: checks.length, checks, productionChanged: false, actualProductionAuthorityProvisioned: false,
  actualPostgresCheckpoints: false, productionTlsVerified: false, wholeAccountReady: false,
  authorityQualification: 'Human approved four stock management roles, including their exact built-in query role expansion. Fixture verifies fullScopeAllowed false and 60-second service token; no production grant was made.' }));
