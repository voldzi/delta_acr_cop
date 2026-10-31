import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Socket } from 'node:net';

const root = resolve(process.cwd(), 'apps/cop-api/dist');
const baseline = process.argv.includes('--expect-baseline-defect');
const moduleName = process.argv.includes('--local-baseline') ? 'cop-state-erasure.baseline-e10a.js' : 'cop-state-erasure.js';
let networkRequests = 0, databaseAttempts = 0;
globalThis.fetch = async () => { networkRequests++; throw new Error('FIXTURE_NETWORK_FORBIDDEN'); };
Socket.prototype.connect = function () { networkRequests++; throw new Error('FIXTURE_NETWORK_FORBIDDEN'); };
const require = createRequire(pathToFileURL(root + '/cop-state-erasure.js'));
const { Pool } = require('pg');
Pool.prototype.query = function () { databaseAttempts++; throw new Error('FIXTURE_DATABASE_FORBIDDEN'); };
Pool.prototype.connect = function () { databaseAttempts++; throw new Error('FIXTURE_DATABASE_FORBIDDEN'); };
const { createInitialState } = await import(pathToFileURL(root + '/state.js'));
const { installCopStateProjectionOwner } = await import(pathToFileURL(root + '/' + moduleName));
const actor = { issuer: 'https://identity.synthetic.test/realms/cop', subjectId: 'synthetic-owner-a' };
const other = { ...actor, subjectId: 'synthetic-owner-b' };
const results = [];
async function fixture(versioned = true) {
  const state = createInitialState(), denied = new Set(); let generation = 1, ready = true;
  const guard = { ready: () => ready, assertActorAllowed: owner => {
    if (denied.has(owner.subjectId)) throw Object.assign(new Error('CACHED_ACCOUNT_FENCE'), { status: 403, code: 'CACHED_ACCOUNT_FENCE' });
  } };
  if (versioned) guard.version = () => generation;
  const owner = installCopStateProjectionOwner(state, { issuer: actor.issuer, cachedGuard: guard,
    loadFences: async () => ({ resources: [], ownerHashes: [], subjectHashes: [], version: 'synthetic' }),
    retainedCopies: { ready: async () => true, preflight: async () => ({ ready: true, version: 'synthetic' }), erase: async () => true } });
  await owner.init();
  const id = '00000000-0000-4000-8000-000000000001';
  state.objects.set(id, { objectId: id, objectType: 'REPORT', affiliation: 'NEUTRAL', domain: 'COMMUNITY', status: 'ACTIVE', ownerSubjectId: actor.subjectId });
  const retained = state.objects.get(id); owner.assertWriteAllowed(retained); owner.assertWriteAllowed(retained);
  return { state, owner, denied, retained, id, advance: () => generation++, unavailable: () => { ready = false; } };
}
const deny = (fn, code) => assert.throws(fn, error => error?.code === code);
{
  const f = await fixture(); f.unavailable(); deny(() => f.owner.assertWriteAllowed(f.retained), 'CONTENT_PROJECTION_UNAVAILABLE'); results.push('LEASE_EXPIRY_DENIED');
}
{
  const f = await fixture(); f.denied.add(actor.subjectId); f.advance();
  deny(() => f.owner.assertWriteAllowed(f.retained), 'CACHED_ACCOUNT_FENCE');
  deny(() => f.state.objects.set(f.id, f.retained), 'CACHED_ACCOUNT_FENCE'); results.push('DURABLE_FRONTIER_REVOKE_DENIED');
}
{
  const f = await fixture(); f.owner.fence(other, { reportIds: [f.id], groupIds: [] });
  deny(() => f.owner.assertWriteAllowed(f.retained), 'CONTENT_PROJECTION_FENCED'); results.push('LOCAL_RESOURCE_FENCE_DENIED');
}
{
  const f = await fixture(false); f.denied.add(actor.subjectId);
  deny(() => f.owner.assertWriteAllowed(f.retained), 'CACHED_ACCOUNT_FENCE'); results.push('UNVERSIONED_GUARD_REVALIDATES');
}
{
  const f = await fixture(); f.owner.fence(other);
  deny(() => f.owner.assertWriteAllowed(f.retained, other), 'CONTENT_PROJECTION_FENCED'); results.push('EXPLICIT_CALLER_FENCE_DENIED');
}
{
  const f = await fixture(), nested = { note: 'synthetic-safe' }, external = Object.freeze({ nested });
  f.owner.assertWriteAllowed(external); f.owner.fence(other); nested.note = other.subjectId;
  if (baseline) { f.owner.assertWriteAllowed(external); results.push('SHALLOW_FREEZE_BASELINE_DEFECT_REPRODUCED'); }
  else { deny(() => f.owner.assertWriteAllowed(external), 'CONTENT_PROJECTION_FENCED'); results.push('SHALLOW_FREEZE_INPUT_REVALIDATED'); }
}
const state = createInitialState(); let deadline = Infinity;
const point = i => ({ objectId: 'synthetic-only', sourceSystemId: 'synthetic-source', timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), lat: 50 + i / 100000, lon: 15 + i / 100000, affiliation: 'NEUTRAL', status: 'ACTIVE', objectType: 'VEHICLE', domain: 'LAND' });
const owner = installCopStateProjectionOwner(state, { issuer: actor.issuer,
  cachedGuard: { ready: () => performance.now() < deadline, version: () => 1, assertActorAllowed: () => {} },
  loadFences: async () => ({ resources: [], ownerHashes: [], subjectHashes: [], version: 'synthetic' }),
  retainedCopies: { ready: async () => true, preflight: async () => ({ ready: true, version: 'synthetic' }), erase: async () => true } });
await owner.init(); state.trackHistory.set('synthetic-only', Array.from({ length: 5000 }, (_, i) => point(i)));
await sleep(20); const start = performance.now(); deadline = start + 5000;
let completed = 0, failureCode = null, timerObserved = 0;
const timer = new Promise(resolveTimer => setTimeout(() => { timerObserved = performance.now() - start; resolveTimer(); }, 1000));
try { for (let i = 0; i < 128; i++) { const old = state.trackHistory.get('synthetic-only'); state.trackHistory.set('synthetic-only', [...old.slice(-4999), point(5000 + i)]); completed++; } }
catch (error) { failureCode = error.code ?? 'UNKNOWN'; }
const blockMs = performance.now() - start; await timer;
if (baseline) { assert.equal(failureCode, 'CONTENT_PROJECTION_UNAVAILABLE'); assert.ok(completed < 128); results.push('BASELINE_FIVE_SECOND_LEASE_EXHAUSTION_REPRODUCED'); }
else { assert.equal(failureCode, null); assert.equal(completed, 128); results.push('IMMUTABLE_BATCH_WITHIN_UNCHANGED_FIVE_SECOND_LEASE'); }
assert.equal(networkRequests, 0); assert.equal(databaseAttempts, 0);
console.log(JSON.stringify({ syntheticOnly: true, productionHotspotProof: false, baselineDefectExpected: baseline,
  networkRequests, databaseAttempts, realDatabaseWrites: 0, results, historyCapacity: 5000, attemptedBatch: 128,
  completed, failureCode, synchronousBlockMs: +blockMs.toFixed(2), oneSecondTimerObservedMs: +timerObserved.toFixed(2), unchangedLeaseMs: 5000 }));
