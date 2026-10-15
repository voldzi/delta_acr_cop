import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { canonical, canonicalJson, sha256 } from './root-records.mjs';
import { createProductionDriverReadAdmissionPort } from './driver-root-inspect.mjs';

assert.equal(process.env.COP_OWNED_NATIVE_FIXTURE, '1'); assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 0);
assert.ok(existsSync('/.dockerenv')); assert.equal(process.cwd(), '/tmp');
const require = createRequire(import.meta.url), native = require('/opt/cop-account-safety/native/root-seqpacket.node');
const etc = '/etc/cop-account-safety/public'; mkdirSync(etc, { recursive: true, mode: 0o755 });
mkdirSync('/run/cop-account-safety/public', { recursive: true, mode: 0o755 });
assert.equal(existsSync(etc + '/verification-keys.json'), false);
const pair = generateKeyPairSync('ed25519'), keys = { contractVersion: 'cop-root-verification-keys-v1',
  keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'owned-read-channel-fixture' }] };
writeFileSync(etc + '/verification-keys.json', canonical(keys) + '\n', { mode: 0o644, flag: 'wx' });
const listener = native.listen(), port = createProductionDriverReadAdmissionPort(), ref = () => ({ recordId: randomUUID(), digest: 'a'.repeat(64) });
function syntheticReply(request, peer) {
  // Real signature, kernel peer and production fixed client. Facts/enrollment
  // are deliberately synthetic; SIM separately verifies real SQL/TLS readback.
  const now = Date.now(), p = { contractVersion: 'cop-root-record-v1', kind: 'driver-read-admission', recordId: randomUUID(),
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 4000).toISOString(), readPermitId: randomUUID(),
    readPermitDigest: 'b'.repeat(64), request: request.request, requestDigest: sha256(canonical(request.request)),
    guardStoreId: randomUUID(), continuityEpoch: randomUUID(), datasetBindingId: randomUUID(), runtimeBindingId: randomUUID(),
    sourceProofId: randomUUID(), policyGeneration: 1, frontierSequence: 0, frontierDigest: 'c'.repeat(64), storeIncarnation: randomUUID(),
    checkpointHash: 'd'.repeat(64), reportProtection: 'no_report', schemaFingerprint: 'e'.repeat(64), privilegeFingerprint: 'f'.repeat(64),
    reportInventoryRef: ref(), factsDigest: '1'.repeat(64), operationDigest: null, peer, clientRegistrationRef: ref() };
  const record = canonical({ keyId: keys.keys[0].kid, payload: p, signature: sign(null, Buffer.from(canonical(p)), pair.privateKey).toString('base64url') }) + '\n';
  return { contractVersion: 'cop-root-driver-inspect-reply-v1', requestId: request.requestId, readPermitId: p.readPermitId,
    admission: { contractVersion: 'sim-driver-guarded-read-admission-v1', ...request.request, checkpointHash: p.checkpointHash,
      reportProtection: p.reportProtection, reference: { recordId: p.recordId, digest: sha256(record) } }, record };
}
async function serve(transform = r => r) {
  const item = await native.receive(listener), request = canonicalJson(item.packet);
  assert.equal(request.contractVersion, 'cop-root-driver-inspect-message-v1'); assert.equal(Object.hasOwn(request, 'readPermitId'), false);
  await native.reply(item.connection, Buffer.from(canonical(transform(syntheticReply(request, item.peer))) + '\n'));
}
test('fixed read client verifies actual native peer and signature for five purposes without selecting a Root UUID', async () => {
  for (const purpose of ['capability', 'intake', 'preflight', 'status', 'receipt']) {
    const request = { owner: 'sim_driver_measurements', scope: 'online_driver_scope', purpose,
      ...(['preflight', 'status', 'receipt'].includes(purpose) ? { operationHash: '2'.repeat(64), actorHash: '3'.repeat(64) } : {}) };
    const server = serve(), admission = await port.inspect(request); await server;
    assert.equal(admission.purpose, purpose); assert.equal(admission.checkpointHash, 'd'.repeat(64));
  }
});
test('wrong signature and cross-request reference remain undefined through actual process traffic', async () => {
  for (const transform of [r => { r.admission.reference = ref(); return r; },
    r => { const p = JSON.parse(r.record); p.payload.request.purpose = 'intake'; r.record = canonical(p) + '\n'; return r; }]) {
    const server = serve(transform), admission = await port.inspect({ owner: 'sim_driver_measurements', scope: 'online_driver_scope', purpose: 'capability' });
    await server; assert.equal(admission, undefined);
  }
});
test('invalid browser-selected context is rejected without any Root packet', async () => {
  assert.equal(await port.inspect({ owner: 'sim_driver_measurements', scope: 'online_driver_scope', purpose: 'intake', readPermitId: randomUUID() }), undefined);
});
after(() => { native.close(listener); unlinkSync(etc + '/verification-keys.json'); });
