import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { canonical, canonicalJson, sha256 } from './root-records.mjs';
import { createProductionDriverRetentionConsumer } from './driver-root-retention.mjs';
import { publishRootOutcome } from './root-outcome-records.mjs';

assert.equal(process.env.COP_OWNED_NATIVE_FIXTURE, '1'); assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 0);
assert.ok(existsSync('/.dockerenv')); assert.equal(process.cwd(), '/tmp');
const require = createRequire(import.meta.url), native = require('/opt/cop-account-safety/native/root-seqpacket.node');
const etc = '/etc/cop-account-safety/public', state = '/var/lib/cop-account-safety';
for (const [path, mode] of [[etc, 0o755], [state + '/authority', 0o700], [state + '/outcomes', 0o700], ['/run/cop-account-safety/public', 0o755]])
  mkdirSync(path, { recursive: true, mode });
assert.equal(existsSync(etc + '/verification-keys.json'), false);
const pair = generateKeyPairSync('ed25519'), keys = { contractVersion: 'cop-root-verification-keys-v1',
  keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'owned-retention-fixture' }] };
writeFileSync(etc + '/verification-keys.json', canonical(keys) + '\n', { mode: 0o644, flag: 'wx' });
writeFileSync(state + '/authority/signing-key.pkcs8', pair.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' });
const listener = native.listen(), consumer = createProductionDriverRetentionConsumer();
const operation = { operationId: randomUUID(), kind: 'expire' }, cutoff = '2026-01-01T00:00:00.000Z';
async function context(transform = p => p) {
  const item = await native.receive(listener), request = canonicalJson(item.packet), now = Date.now();
  assert.equal(request.contractVersion, 'cop-root-driver-retention-message-v1');
  assert.deepEqual(Object.keys(request).sort(), ['action', 'contractVersion', 'requestId']);
  // Real crypto/native client tests; owner registration/DB facts synthetic.
  const payload = transform({ contractVersion: 'cop-root-record-v1', kind: 'driver-retention-context', recordId: randomUUID(),
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 4000).toISOString(), requestId: request.requestId,
    requestDigest: sha256(canonical({ action: 'current' })), peer: item.peer, owner: 'sim_driver_measurements', cutoff, operation,
    originalPermitRef: { recordId: randomUUID(), digest: 'a'.repeat(64) }, guardStoreId: randomUUID(), continuityEpoch: randomUUID(),
    datasetBindingId: randomUUID(), runtimeBindingId: randomUUID(), currentSourceProofId: randomUUID(), storeIncarnation: randomUUID(),
    frontierSequence: 0, frontierDigest: 'b'.repeat(64) });
  await native.reply(item.connection, Buffer.from(canonical({ keyId: keys.keys[0].kid, payload,
    signature: sign(null, Buffer.from(canonical(payload)), pair.privateKey).toString('base64url') }) + '\n'));
}
async function outcome(pending = false) {
  const item = await native.receive(listener), request = canonicalJson(item.packet);
  assert.equal(request.action, 'probe'); assert.deepEqual(request.operation, operation); assert.equal(request.body, null);
  let result, records = [];
  if (pending) result = { contractVersion: 'cop-driver-origin-result-v1', state: 'pending', reason: 'origin-unresolved' };
  else {
    result = publishRootOutcome({ ...operation, permitId: randomUUID(), storeIncarnation: randomUUID(), bodyDigest: 'c'.repeat(64), schemaDigest: 'd'.repeat(64) },
      { contractVersion: 'cop-driver-origin-result-v1', operationId: operation.operationId, state: 'origin-commit-known' }, { digest: 'e'.repeat(64) });
    records = ['sqlOutcomeRef', 'effectQuiescenceRef'].map(k => readFileSync(state + '/outcomes/' + result[k].recordId + '.json', 'utf8'));
  }
  await native.reply(item.connection, Buffer.from(canonical({ contractVersion: 'cop-root-driver-reply-v1', requestId: request.requestId,
    operationId: operation.operationId, result, records }) + '\n'));
}
test('retention awaits actual callback then probes the same Root original and frozen cutoff', async () => {
  let calls = 0;
  const server = (async () => { await context(); await outcome(); })();
  await consumer.execute(async value => { calls++; assert.equal(Object.isFrozen(value), true); assert.deepEqual(value.operation, operation); assert.equal(value.cutoff, cutoff); });
  await server; assert.equal(calls, 1);
});
test('fulfilled callback with unresolved SQL remains unavailable; retry preserves its original', async () => {
  const server = (async () => { await context(); await outcome(true); })();
  await assert.rejects(consumer.execute(async value => { assert.deepEqual(value.operation, operation); }), /GUARD_RETENTION_UNRESOLVED/); await server;
});
test('future cutoff cannot dispatch maintenance callback', async () => {
  let called = false; const server = context(p => ({ ...p, cutoff: '2999-01-01T00:00:00.000Z' }));
  await assert.rejects(consumer.execute(async () => { called = true; }), /GUARD_RETENTION_CONTEXT/); await server; assert.equal(called, false);
});
after(() => { native.close(listener); unlinkSync(etc + '/verification-keys.json'); unlinkSync(state + '/authority/signing-key.pkcs8'); });
