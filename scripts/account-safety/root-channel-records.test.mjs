import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { canonical, sha256 } from './root-records.mjs';
import { validateDriverReadRequest, validateDriverInspectReply } from './driver-root-inspect.mjs';
import { validateContinuityReply, validateContinuityRequest } from './cop-root-continuity.mjs';
import { validateFenceEntry } from './root-fence-journal.mjs';

const pair = generateKeyPairSync('ed25519');
const keys = { contractVersion: 'cop-root-verification-keys-v1', keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'synthetic-wire-fixture' }] };
const bytes = payload => Buffer.from(canonical({ keyId: keys.keys[0].kid, payload,
  signature: sign(null, Buffer.from(canonical(payload)), pair.privateKey).toString('base64url') }) + '\n');
const base = kind => ({ contractVersion: 'cop-root-record-v1', kind, recordId: randomUUID(), issuedAt: new Date(Date.now() - 100).toISOString(),
  expiresAt: new Date(Date.now() + 4000).toISOString() });
const peer = { device: '1', inode: '2', uid: 1000, gid: 1000 };
const ref = () => ({ recordId: randomUUID(), digest: 'a'.repeat(64) });
function readFixture(purpose) {
  const request = { owner: 'sim_driver_measurements', scope: 'online_driver_scope', purpose,
    ...(['preflight', 'status', 'receipt'].includes(purpose) ? { operationHash: 'b'.repeat(64), actorHash: 'c'.repeat(64) } : {}) };
  const wire = { contractVersion: 'cop-root-driver-inspect-message-v1', requestId: randomUUID(), action: 'inspect', request };
  const p = { ...base('driver-read-admission'), readPermitId: randomUUID(), readPermitDigest: 'd'.repeat(64), request,
    requestDigest: sha256(canonical(request)), guardStoreId: randomUUID(), continuityEpoch: randomUUID(), datasetBindingId: randomUUID(),
    runtimeBindingId: randomUUID(), sourceProofId: randomUUID(), policyGeneration: 1, frontierSequence: 0, frontierDigest: 'e'.repeat(64),
    storeIncarnation: randomUUID(), checkpointHash: 'f'.repeat(64), reportProtection: 'no_report', schemaFingerprint: '1'.repeat(64),
    privilegeFingerprint: '2'.repeat(64), reportInventoryRef: ref(), factsDigest: '3'.repeat(64), operationDigest: null,
    peer, clientRegistrationRef: ref() };
  const record = bytes(p), admission = { contractVersion: 'sim-driver-guarded-read-admission-v1', ...request,
    checkpointHash: p.checkpointHash, reportProtection: p.reportProtection, reference: { recordId: p.recordId, digest: sha256(record) } };
  return { wire, p, reply: { contractVersion: 'cop-root-driver-inspect-reply-v1', requestId: wire.requestId, readPermitId: p.readPermitId,
    admission, record: record.toString() } };
}
// Synthetic facts/enrollment only. These tests exercise real cryptography and
// exact consumers, not a live owner read, kernel transport or production proof.
test('five exact read purposes consume actual signatures with request/peer/reference bindings', () => {
  for (const purpose of ['capability', 'intake', 'preflight', 'status', 'receipt']) {
    const { wire, reply } = readFixture(purpose);
    assert.deepEqual(validateDriverInspectReply(Buffer.from(canonical(reply) + '\n'), wire, keys, peer), reply.admission);
  }
});
test('a browser-selected permit, missing actor or free request fields are rejected', () => {
  for (const request of [
    { owner: 'sim_driver_measurements', scope: 'online_driver_scope', purpose: 'status' },
    { owner: 'sim_driver_measurements', scope: 'online_driver_scope', purpose: 'intake', readPermitId: randomUUID() },
    { owner: 'sim_ai_router', scope: 'online_driver_scope', purpose: 'capability' }
  ]) assert.throws(() => validateDriverReadRequest(request), /GUARD_READ_REQUEST/);
});
test('altered actor, signature, peer, checkpoint, Root reference and correlation do not admit a read', () => {
  for (const mutate of [
    r => { r.admission.actorHash = '9'.repeat(64); },
    r => { const p = JSON.parse(r.record); p.payload.factsDigest = '9'.repeat(64); r.record = canonical(p) + '\n'; },
    r => { r.admission.checkpointHash = '9'.repeat(64); },
    r => { r.admission.reference = ref(); },
    r => { r.requestId = randomUUID(); },
    r => { r.readPermitId = randomUUID(); }
  ]) {
    const { wire, reply } = readFixture('status'); mutate(reply);
    assert.throws(() => validateDriverInspectReply(Buffer.from(canonical(reply) + '\n'), wire, keys, peer));
  }
  const { wire, reply } = readFixture('status');
  assert.throws(() => validateDriverInspectReply(Buffer.from(canonical(reply) + '\n'), wire, keys, { ...peer, inode: '3' }));
});
test('a signed but overlong or expired read admission remains unavailable', () => {
  for (const times of [
    { issuedAt: new Date(Date.now() - 100).toISOString(), expiresAt: new Date(Date.now() + 9000).toISOString() },
    { issuedAt: new Date(Date.now() - 5000).toISOString(), expiresAt: new Date(Date.now() - 100).toISOString() }
  ]) {
    const { wire, p, reply } = readFixture('capability'); Object.assign(p, times);
    const record = bytes(p); reply.record = record.toString(); reply.admission.reference.digest = sha256(record);
    assert.throws(() => validateDriverInspectReply(Buffer.from(canonical(reply) + '\n'), wire, keys, peer));
  }
});
test('continuity replies bind the actual request, store and five-second lifetime', () => {
  const request = { contractVersion: 'cop-root-continuity-message-v1', requestId: randomUUID(), action: 'page', input: { cursor: 0, frontier: null } };
  validateContinuityRequest(Buffer.from(canonical(request) + '\n'));
  const applicationStoreId = randomUUID(), configurationFingerprint = 'a'.repeat(64);
  const p = { ...base('cop-continuity-reply'), requestId: request.requestId, action: request.action,
    inputDigest: sha256(canonical(request.input)), applicationStoreId, configurationFingerprint, guardStoreId: randomUUID(), continuityEpoch: randomUUID(),
    result: { applicationStoreId, configurationFingerprint, frontier: { sequence: 0, digest: '0'.repeat(64) }, entry: null, nextCursor: null } };
  assert.deepEqual(validateContinuityReply(bytes(p), request, keys), p);
  assert.throws(() => validateContinuityReply(bytes({ ...p, inputDigest: 'b'.repeat(64) }), request, keys));
  assert.throws(() => validateContinuityReply(bytes({ ...p, result: { ...p.result, applicationStoreId: randomUUID() } }), request, keys));
  assert.throws(() => validateContinuityReply(bytes(p), { ...request, requestId: randomUUID() }, keys));
});
test('permanent Root manifest rejects any recoverable principal or free identity fields', () => {
  const binding = { applicationStoreId: randomUUID(), configurationFingerprint: 'a'.repeat(64) };
  const entry = { contractVersion: 'cop-erasure-fence-entry-v1', ...binding, accountKey: 'b'.repeat(64),
    job: { operationId: randomUUID(), requestedAt: new Date().toISOString(), checkpoints: {}, required: ['keycloak', 'cop_sessions_profiles',
      'cop_devices', 'messaging_matrix', 'voice_livekit', 'cop_content_media', 'mobility_dispatch', 'sim_measurements', 'ai_router', 'moderation_audit', 'backup_restore'] } };
  assert.deepEqual(validateFenceEntry(entry, binding), entry);
  for (const value of [{ ...entry, subjectId: 'forbidden' }, { ...entry, job: { ...entry.job, sealedPrincipal: 'forbidden' } },
    { ...entry, job: { ...entry.job, email: 'forbidden' } }]) assert.throws(() => validateFenceEntry(value, binding));
});
