import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { canonical, canonicalJson, sha256 } from './root-records.mjs';
import { createProductionDriverPublicationPort } from './driver-root-publication.mjs';

assert.equal(process.env.COP_OWNED_NATIVE_FIXTURE, '1'); assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 0);
assert.ok(existsSync('/.dockerenv')); assert.equal(process.cwd(), '/tmp');
const require = createRequire(import.meta.url), native = require('/opt/cop-account-safety/native/root-seqpacket.node');
const etc = '/etc/cop-account-safety/public'; mkdirSync(etc, { recursive: true, mode: 0o755 });
mkdirSync('/run/cop-account-safety/public', { recursive: true, mode: 0o755 }); assert.equal(existsSync(etc + '/verification-keys.json'), false);
const pair = generateKeyPairSync('ed25519'), keys = { contractVersion: 'cop-root-verification-keys-v1',
  keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'owned-publication-port-fixture' }] };
writeFileSync(etc + '/verification-keys.json', canonical(keys) + '\n', { mode: 0o644, flag: 'wx' });
const listener = native.listen(), port = createProductionDriverPublicationPort();
const context = Object.fromEntries(['guardStoreId', 'continuityEpoch', 'datasetBindingId', 'runtimeBindingId', 'sourceProofId', 'storeIncarnation'].map(k => [k, randomUUID()]));
let leaseRef;
async function serve(action, transform = p => p) {
  const item = await native.receive(listener), request = canonicalJson(item.packet);
  assert.equal(request.action, action);
  assert.deepEqual(Object.keys(request).sort(), ['action', 'contractVersion', 'kind', 'leaseRef', 'requestId']);
  if (action === 'acquire') { assert.equal(request.leaseRef, null); leaseRef = { recordId: randomUUID(), digest: 'a'.repeat(64) }; }
  else assert.deepEqual(request.leaseRef, leaseRef);
  const now = Date.now();
  // Actual kernel transport + Ed25519 consumer test. Owner/PG lease facts are
  // explicitly synthetic; this does not attest a real metadata writer barrier.
  const payload = transform({ contractVersion: 'cop-root-record-v1', kind: 'driver-publication-lease-reply', recordId: randomUUID(),
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 4000).toISOString(), requestId: request.requestId,
    requestDigest: sha256(canonical(request)), action, publicationKind: request.kind, leaseRef, peer: item.peer,
    ...context, frontierSequence: 0, frontierDigest: 'b'.repeat(64), state: action === 'release' ? 'released' : 'held' });
  await native.reply(item.connection, Buffer.from(canonical({ keyId: keys.keys[0].kid, payload,
    signature: sign(null, Buffer.from(canonical(payload)), pair.privateKey).toString('base64url') }) + '\n'));
}
test('accepted callback verifies held lease before publication and releases only after awaited completion', async () => {
  const server = (async () => { await serve('acquire'); await serve('assert'); await serve('release'); })();
  const value = await port.withLease({ kind: 'aggregates' }, async lease => { await lease.assertCurrent(); return 42; });
  await server; assert.equal(value, 42);
});
test('a still-running callback cannot release its lease early', async () => {
  let resolveWork, entered;
  const ready = new Promise(r => { entered = r; }), gate = new Promise(r => { resolveWork = r; });
  const acquired = serve('acquire'), work = port.withLease({ kind: 'quality' }, async () => { entered(); await gate; return 'drained'; });
  await acquired; await ready;
  let completed = false; void work.then(() => { completed = true; }); await Promise.resolve(); assert.equal(completed, false);
  const released = serve('release'); resolveWork(); assert.equal(await work, 'drained'); await released;
});
test('failed callback still awaits release and cannot retain a reusable lease object', async () => {
  let saved;
  const server = (async () => { await serve('acquire'); await serve('release'); })();
  await assert.rejects(port.withLease({ kind: 'quality' }, async lease => { saved = lease; throw new Error('fixture-work-failed'); }), /fixture-work-failed/);
  await server; await assert.rejects(saved.assertCurrent(), /GUARD_PUBLICATION_LEASE_CLOSED/);
});
test('foreign signed peer never invokes the callback', async () => {
  let called = false;
  const server = serve('acquire', p => ({ ...p, peer: { ...p.peer, inode: String(BigInt(p.peer.inode) + 1n) } }));
  await assert.rejects(port.withLease({ kind: 'aggregates' }, async () => { called = true; }), /GUARD_PUBLICATION_LEASE_REPLY/);
  await server; assert.equal(called, false);
});
test('unknown release never turns successful work into a positive drained result', async () => {
  const server = (async () => { await serve('acquire'); await serve('release', p => ({ ...p, state: 'held' })); })();
  await assert.rejects(port.withLease({ kind: 'quality' }, async () => 'must-not-resolve'), /GUARD_PUBLICATION_LEASE_REPLY/); await server;
});
after(() => { native.close(listener); unlinkSync(etc + '/verification-keys.json'); });
