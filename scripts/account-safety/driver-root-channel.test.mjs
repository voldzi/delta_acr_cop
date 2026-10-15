import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { canonical, canonicalJson } from './root-records.mjs';
import { publishRootOutcome } from './root-outcome-records.mjs';
import { createProductionDriverRootPort } from './driver-root-channel.mjs';

assert.equal(process.env.COP_OWNED_NATIVE_FIXTURE, '1');
assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 0);
assert.ok(existsSync('/.dockerenv')); assert.equal(process.cwd(), '/tmp');
const require = createRequire(import.meta.url), native = require('/opt/cop-account-safety/native/root-seqpacket.node');
const etc = '/etc/cop-account-safety/public', state = '/var/lib/cop-account-safety';
mkdirSync(etc, { recursive: true, mode: 0o755 });
mkdirSync(state + '/authority', { recursive: true, mode: 0o700 });
mkdirSync(state + '/outcomes', { recursive: true, mode: 0o700 });
mkdirSync('/run/cop-account-safety/public', { recursive: true, mode: 0o755 });
assert.equal(existsSync(etc + '/verification-keys.json'), false, 'refuse existing production keyring');
const pair = generateKeyPairSync('ed25519');
const keys = { contractVersion: 'cop-root-verification-keys-v1',
  keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'owned-channel-fixture' }] };
writeFileSync(etc + '/verification-keys.json', canonical(keys) + '\n', { flag: 'wx', mode: 0o644 });
writeFileSync(state + '/authority/signing-key.pkcs8', pair.privateKey.export({ format: 'pem', type: 'pkcs8' }), { flag: 'wx', mode: 0o600 });
const listener = native.listen(), port = createProductionDriverRootPort();
const request = () => ({ operation: { operationId: randomUUID(), kind: 'revoke' },
  body: { contractVersion: 'sim-driver-guarded-db-v1', contributorHash: '1'.repeat(64) } });
function reply(request, transform = value => value) {
  const op = { ...request.operation, permitId: randomUUID(), storeIncarnation: randomUUID(),
    bodyDigest: 'a'.repeat(64), schemaDigest: 'b'.repeat(64) };
  // Synthetic SQL settlement ONLY: this tests the actual fixed client/native
  // path and signature consumer, not deployed enrollment or a real SQL effect.
  const result = publishRootOutcome(op, { contractVersion: 'cop-driver-origin-result-v1', operationId: op.operationId, state: 'origin-commit-known',
    revokeEffect: { deletedBatchCount: 4 } }, { digest: 'c'.repeat(64) });
  return transform(structuredClone({ contractVersion: 'cop-root-driver-reply-v1', requestId: request.requestId,
    operationId: op.operationId, result, records: ['sqlOutcomeRef', 'effectQuiescenceRef'].map(field =>
      readFileSync(state + '/outcomes/' + result[field].recordId + '.json', 'utf8')) }));
}
async function serve(transform) {
  const item = await native.receive(listener), request = canonicalJson(item.packet);
  await native.reply(item.connection, Buffer.from(canonical(reply(request, transform)) + '\n'));
  return request;
}
test('fixed production client verifies actual native peer plus two real signed result records', async () => {
  const job = request(), server = serve();
  const result = await port.execute(job); await server;
  assert.equal(result.operationId, job.operation.operationId); assert.equal(result.state, 'origin-commit-known');
  assert.deepEqual(result.revokeEffect, { deletedBatchCount: 4 });
});
test('same-input repeat is correlated, changed input is denied before transport', async () => {
  const job = request(); let server = serve(); assert.equal((await port.execute(job)).state, 'origin-commit-known'); await server;
  server = serve(); assert.equal((await port.execute(job)).state, 'origin-commit-known'); await server;
  assert.equal((await port.execute({ ...job, body: { ...job.body, contributorHash: '2'.repeat(64) } })).reason, 'authority-unavailable');
});
test('altered signature, original operation or scalar never becomes a terminal app result', async () => {
  for (const transform of [
    value => { const record = JSON.parse(value.records[0]); record.payload.bodyDigest = 'd'.repeat(64); value.records[0] = canonical(record) + '\n'; return value; },
    value => { value.result.operationId = randomUUID(); return value; },
    value => { value.result.revokeEffect.deletedBatchCount = 0; return value; },
    value => { value.records[1] = value.records[0]; return value; },
  ]) {
    const server = serve(transform), result = await port.execute(request()); await server;
    assert.equal(result.state, 'pending'); assert.equal(result.reason, 'transport-unavailable');
  }
});
test('unknown original result carries no invented count or terminal references', async () => {
  const itemPromise = native.receive(listener), job = request(), resultPromise = port.probe(job.operation);
  const item = await itemPromise, wire = canonicalJson(item.packet);
  assert.equal(wire.action, 'probe'); assert.equal(wire.body, null);
  await native.reply(item.connection, Buffer.from(canonical({ contractVersion: 'cop-root-driver-reply-v1', requestId: wire.requestId,
    operationId: job.operation.operationId, result: { contractVersion: 'cop-driver-origin-result-v1', state: 'pending', reason: 'origin-unresolved' }, records: [] }) + '\n'));
  const result = await resultPromise;
  assert.equal(result.state, 'pending'); assert.equal(result.operationId, job.operation.operationId);
  assert.equal(result.revokeEffect, undefined); assert.equal(result.sqlOutcomeRef, undefined);
});
after(() => {
  native.close(listener);
  assert.equal(JSON.parse(readFileSync(etc + '/verification-keys.json')).keys[0].kid, 'owned-channel-fixture');
  unlinkSync(etc + '/verification-keys.json'); unlinkSync(state + '/authority/signing-key.pkcs8');
});
