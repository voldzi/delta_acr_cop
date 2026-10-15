import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { canonical, canonicalJson, sha256 } from './root-records.mjs';
import { createProductionDriverRequestScope } from './driver-root-context.mjs';

assert.equal(process.env.COP_OWNED_NATIVE_FIXTURE, '1'); assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 0);
assert.ok(existsSync('/.dockerenv')); assert.equal(process.cwd(), '/tmp');
const require = createRequire(import.meta.url), native = require('/opt/cop-account-safety/native/root-seqpacket.node');
const etc = '/etc/cop-account-safety/public'; mkdirSync(etc, { recursive: true, mode: 0o755 });
mkdirSync('/run/cop-account-safety/public', { recursive: true, mode: 0o755 }); assert.equal(existsSync(etc + '/verification-keys.json'), false);
const pair = generateKeyPairSync('ed25519'), keys = { contractVersion: 'cop-root-verification-keys-v1',
  keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'owned-request-scope-fixture' }] };
writeFileSync(etc + '/verification-keys.json', canonical(keys) + '\n', { mode: 0o644, flag: 'wx' });
const listener = native.listen(), port = createProductionDriverRequestScope();
const scope = id => ({ method: 'DELETE', path: '/api/v1/internal/driver-measurements/v1/contributions',
  authorization: 'Bearer ' + 'synthetic-service-token'.repeat(3), actor: 'A'.repeat(64), actorSignature: 'a'.repeat(64),
  body: { contractVersion: 'sim-driver-measurements-v1', contributorIdDay: id.repeat(43) } });
function reply(request, peer, operationId, mutate = () => {}) {
  // Real native transport and signatures; Root owner/context facts are synthetic.
  const now = Date.now(), p = { contractVersion: 'cop-root-record-v1', kind: 'driver-request-context', recordId: randomUUID(),
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 4000).toISOString(), requestId: request.requestId,
    requestDigest: sha256(canonical({ kind: request.kind, scope: request.scope })), actionKind: request.kind, peer,
    guardStoreId: randomUUID(), continuityEpoch: randomUUID(), datasetBindingId: randomUUID(), runtimeBindingId: randomUUID(),
    currentSourceProofId: randomUUID(), storeIncarnation: randomUUID(), frontierSequence: 0, frontierDigest: 'a'.repeat(64),
    operation: { operationId, kind: request.kind }, originalPermitRef: { recordId: randomUUID(), digest: 'b'.repeat(64) } };
  mutate(p);
  return Buffer.from(canonical({ keyId: keys.keys[0].kid, payload: p,
    signature: sign(null, Buffer.from(canonical(p)), pair.privateKey).toString('base64url') }) + '\n');
}
async function serve(operationId, mutate) {
  const item = await native.receive(listener), request = canonicalJson(item.packet);
  assert.equal(request.contractVersion, 'cop-root-driver-context-message-v1'); assert.equal(Object.hasOwn(request, 'operationId'), false);
  await native.reply(item.connection, reply(request, item.peer, operationId, mutate)); return request;
}
test('two concurrent ALS invocations keep their typed scopes and Root original IDs isolated', async () => {
  const ids = [randomUUID(), randomUUID()], observed = [];
  const server = (async () => { for (let i = 0; i < 2; i++) observed.push(await serve(ids[i])); })();
  const a = port.run(scope('A'), () => port.context.current('revoke'));
  const b = port.run(scope('B'), () => port.context.current('revoke'));
  const values = await Promise.all([a, b]); await server;
  for (let i = 0; i < values.length; i++) {
    const position = observed.findIndex(r => r.scope.body.contributorIdDay === ['A', 'B'][i].repeat(43));
    assert.equal(values[i].operation.operationId, ids[position]);
  }
  assert.equal(await port.context.current('revoke'), undefined);
});
test('GPS batches, unrelated paths and wrong operation kind never produce a Root packet', async () => {
  assert.equal(await port.run({ ...scope('A'), method: 'POST', path: '/api/v1/internal/driver-measurements/v1/batches',
    body: { points: [{ latitude: 50, longitude: 14 }] } }, () => port.context.current('erase')), undefined);
  assert.equal(await port.run(scope('A'), () => port.context.current('erase')), undefined);
});
test('changed signed request binding or Root original kind remains unavailable', async () => {
  for (const mutate of [p => { p.requestDigest = 'f'.repeat(64); }, p => { p.operation.kind = 'erase'; }]) {
    const server = serve(randomUUID(), mutate), value = await port.run(scope('A'), () => port.context.current('revoke'));
    await server; assert.equal(value, undefined);
  }
});
after(() => { native.close(listener); unlinkSync(etc + '/verification-keys.json'); });
