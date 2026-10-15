import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { test } from 'node:test';
import { canonical, canonicalJson, verifyRootRecord } from './root-records.mjs';
import { DriverOriginProducer } from './driver-origin-producer.mjs';

const now = Date.parse('2026-10-15T12:00:00.000Z');
function fixture() {
  const pair = generateKeyPairSync('ed25519');
  const key = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'owned-test' };
  const keys = { contractVersion: 'cop-root-verification-keys-v1', keys: [key] };
  const payload = { contractVersion: 'cop-root-record-v1', kind: 'owned-proof', recordId: randomUUID(),
    issuedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 1000).toISOString() };
  const encode = p => Buffer.from(canonical({ keyId: key.kid, payload: p,
    signature: sign(null, Buffer.from(canonical(p)), pair.privateKey).toString('base64url') }) + '\n');
  return { pair, keys, payload, encode };
}
test('verifies an actual Ed25519 signature over canonical typed record', () => {
  const f = fixture(); assert.equal(verifyRootRecord(f.encode(f.payload), f.keys, 'owned-proof', { now }).payload.recordId, f.payload.recordId);
});
test('changed signed body, unknown key and wrong record kind are rejected', () => {
  const f = fixture(), record = JSON.parse(f.encode(f.payload));
  record.payload.recordId = randomUUID();
  assert.throws(() => verifyRootRecord(Buffer.from(canonical(record) + '\n'), f.keys, 'owned-proof', { now }), /GUARD_SIGNATURE_INVALID/);
  assert.throws(() => verifyRootRecord(f.encode(f.payload), { ...f.keys, keys: [{ ...f.keys.keys[0], kid: 'other' }] }, 'owned-proof', { now }), /GUARD_KEY/);
  assert.throws(() => verifyRootRecord(f.encode(f.payload), f.keys, 'wrong', { now }), /GUARD_RECORD_BINDING/);
});
test('expired record is historical resolution only, not fresh work', () => {
  const f = fixture(), body = f.encode({ ...f.payload, expiresAt: new Date(now).toISOString() });
  assert.throws(() => verifyRootRecord(body, f.keys, 'owned-proof', { now }), /GUARD_RECORD_EXPIRED/);
  assert.ok(verifyRootRecord(body, f.keys, 'owned-proof', { now, historical: true }));
});
test('future, noncanonical or excessively long validity cannot authorize', () => {
  const f = fixture();
  for (const change of [
    { issuedAt: new Date(now + 1).toISOString() },
    { issuedAt: '2026-10-15T11:59:59Z' },
    { expiresAt: new Date(now + 300001).toISOString() },
  ]) assert.throws(() => verifyRootRecord(f.encode({ ...f.payload, ...change }), f.keys, 'owned-proof', { now }));
});
test('canonical reader rejects duplicate keys, lossy numeric notation and invalid Unicode', () => {
  for (const text of ['{"a":1,"a":1}\n', '{"a":1.0}\n', '{"a":1e0}\n', '{"a":9007199254740992}\n', '{"a":"\\ud800"}\n', '{"\\ud800":1}\n'])
    assert.throws(() => canonicalJson(Buffer.from(text)));
  assert.throws(() => canonicalJson(Buffer.from([0xff])));
});
test('keyring rejects duplicate IDs, private keys and noncanonical key bytes', () => {
  const f = fixture(), bytes = f.encode(f.payload);
  for (const keys of [[f.keys.keys[0], f.keys.keys[0]], [{ ...f.keys.keys[0], d: 'x' }],
    [{ ...f.keys.keys[0], x: f.keys.keys[0].x + '=' }]])
    assert.throws(() => verifyRootRecord(bytes, { ...f.keys, keys }, 'owned-proof', { now }), /GUARD_KEYRING/);
});
test('authority denial performs no target SQL, including a resolver mutation', async () => {
  let sqlCalls = 0;
  const sql = { query() { sqlCalls++; throw new Error('unexpected'); } };
  const producer = new DriverOriginProducer({ control: sql, executor: sql,
    dispatch: { exists() { throw new Error('unexpected'); } }, validateCurrent: async () => { throw new Error('not accepted'); } });
  const op = { contractVersion: 'cop-driver-origin-v1', operationId: randomUUID(), storeIncarnation: randomUUID(),
    permitId: randomUUID(), kind: 'expire', bodyDigest: 'a'.repeat(64), schemaDigest: 'b'.repeat(64), cutoff: '2026-10-15T12:00:00.000Z' };
  assert.equal((await producer.runOnce(op, '{}')).state, 'pending'); assert.equal(sqlCalls, 0);
  assert.equal((await producer.probe(op)).state, 'pending'); assert.equal(sqlCalls, 0);
});
