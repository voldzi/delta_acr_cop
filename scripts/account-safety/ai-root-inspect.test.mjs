import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { canonical, canonicalJson, sha256 } from './root-records.mjs';
import { createProductionAiCheckpointAdmissionPort } from './ai-root-inspect.mjs';

assert.equal(process.env.COP_OWNED_NATIVE_FIXTURE, '1'); assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 0);
assert.ok(existsSync('/.dockerenv')); assert.equal(process.cwd(), '/tmp');
const require = createRequire(import.meta.url), native = require('/opt/cop-account-safety/native/root-seqpacket.node');
const etc = '/etc/cop-account-safety/public'; mkdirSync(etc, { recursive: true, mode: 0o755 });
mkdirSync('/run/cop-account-safety/public', { recursive: true, mode: 0o755 }); assert.equal(existsSync(etc + '/verification-keys.json'), false);
const pair = generateKeyPairSync('ed25519'), keys = { contractVersion: 'cop-root-verification-keys-v1',
  keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'owned-ai-channel-fixture' }] };
writeFileSync(etc + '/verification-keys.json', canonical(keys) + '\n', { mode: 0o644, flag: 'wx' });
const listener = native.listen(), port = createProductionAiCheckpointAdmissionPort(), ref = () => ({ recordId: randomUUID(), digest: 'a'.repeat(64) });
const request = () => ({ owner: 'sim_ai_router', scope: 'cop_router_primary_database', purpose: 'checkpoint',
  expectedSnapshot: { checkpointId: randomUUID(), generation: '9223372036854775807', operationDigest: 'b'.repeat(64), schemaDigest: 'c'.repeat(64) } });
function syntheticReply(wire, peer, transformPayload) {
  // Real signature/kernel transport/production consumer; explicitly synthetic
  // owner facts. SIM separately tests actual TLS, PostgreSQL and BYOK checks.
  const now = Date.now(), payload = { contractVersion: 'cop-root-record-v1', kind: 'ai-router-read-admission', recordId: randomUUID(),
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 4000).toISOString(), readPermitId: randomUUID(), readPermitDigest: 'd'.repeat(64),
    request: wire.request, requestDigest: sha256(canonical(wire.request)), guardStoreId: randomUUID(), continuityEpoch: randomUUID(),
    datasetBindingId: randomUUID(), runtimeBindingId: randomUUID(), sourceProofId: randomUUID(), policyGeneration: 1, frontierSequence: 0,
    frontierDigest: 'e'.repeat(64), storeIncarnation: randomUUID(), schemaFingerprint: 'f'.repeat(64), privilegeFingerprint: '1'.repeat(64),
    costPolicy: 'aggregate-costs-current-month-v1', factsDigest: '2'.repeat(64), peer, clientRegistrationRef: ref() };
  transformPayload?.(payload);
  const record = canonical({ keyId: keys.keys[0].kid, payload,
    signature: sign(null, Buffer.from(canonical(payload)), pair.privateKey).toString('base64url') }) + '\n';
  return { contractVersion: 'cop-root-ai-inspect-reply-v1', requestId: wire.requestId, readPermitId: payload.readPermitId,
    admission: { contractVersion: 'sim-ai-router-checkpoint-admission-v1', request: wire.request,
      reference: { recordId: payload.recordId, digest: sha256(record) } }, record };
}
async function serve(transformReply = r => r, transformPayload) {
  const item = await native.receive(listener), wire = canonicalJson(item.packet);
  assert.equal(wire.contractVersion, 'cop-root-ai-inspect-message-v1'); assert.equal(Object.hasOwn(wire, 'readPermitId'), false);
  const reply = transformReply(syntheticReply(wire, item.peer, transformPayload));
  await native.reply(item.connection, Buffer.from(canonical(reply) + '\n'));
}
test('fixed AI client verifies actual native peer and exact signed bigint checkpoint snapshot', async () => {
  const input = request(), server = serve(), admission = await port.inspect(input); await server;
  assert.deepEqual(admission.request, input); assert.equal(admission.contractVersion, 'sim-ai-router-checkpoint-admission-v1');
});
test('a different generation or financial policy cannot borrow a valid signature', async () => {
  for (const field of ['generation', 'operationDigest']) {
    const input = request(), server = serve(r => { r.admission.request.expectedSnapshot[field] = field === 'generation' ? '1' : '3'.repeat(64); return r; });
    assert.equal(await port.inspect(input), undefined); await server;
  }
  const server = serve(r => r, p => { p.costPolicy = 'pending_requires_review'; });
  assert.equal(await port.inspect(request()), undefined); await server;
});
test('keyring replacement during actual traffic is denied even while the old signature remains valid', async () => {
  const replacement = generateKeyPairSync('ed25519');
  const server = serve(r => {
    writeFileSync(etc + '/verification-keys.json', canonical({ ...keys, keys: [...keys.keys,
      { ...replacement.publicKey.export({ format: 'jwk' }), kid: 'another-trusted-fixture-key' }] }) + '\n'); return r;
  });
  try { assert.equal(await port.inspect(request()), undefined); await server; }
  finally { writeFileSync(etc + '/verification-keys.json', canonical(keys) + '\n'); }
});
test('free model, actor or Root permit fields are rejected before sending a packet', async () => {
  for (const extra of [{ readPermitId: randomUUID() }, { userId: 'not-allowed' }, { model: 'not-allowed' }])
    assert.equal(await port.inspect({ ...request(), ...extra }), undefined);
});
after(() => { native.close(listener); unlinkSync(etc + '/verification-keys.json'); });
