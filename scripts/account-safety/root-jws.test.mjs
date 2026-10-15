import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { test } from 'node:test';
import { canonical } from './root-records.mjs';
import { verifyRootJws } from './root-jws.mjs';

const pair = generateKeyPairSync('ed25519'), keys = { contractVersion: 'cop-root-verification-keys-v1',
  keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'synthetic-runtime-jws' }] };
const now = Date.parse('2026-10-15T10:00:00.000Z');
const payload = { contractVersion: 'cop-root-record-v1', kind: 'accepted-runtime-proof', recordId: randomUUID(),
  issuedAt: new Date(now - 100).toISOString(), expiresAt: new Date(now + 29_000).toISOString(), frontierSequence: 1, frontierDigest: 'a'.repeat(64) };
function token(p = payload, h = { alg: 'EdDSA', kid: keys.keys[0].kid, typ: 'cop-root-runtime-v1' }) {
  const message = Buffer.from(canonical(h)).toString('base64url') + '.' + Buffer.from(canonical(p)).toString('base64url');
  return Buffer.from(message + '.' + sign(null, Buffer.from(message), pair.privateKey).toString('base64url') + '\n');
}
test('actual compact EdDSA JWS verifies its exact typed canonical runtime payload', () => {
  assert.deepEqual(verifyRootJws(token(), keys, 'accepted-runtime-proof', { now }).payload, payload);
});
test('modified header/body, wrong algorithm and unknown/private/duplicate keys are rejected', () => {
  const parts = token().toString().trim().split('.');
  parts[1] = Buffer.from(canonical({ ...payload, frontierSequence: 2 })).toString('base64url');
  assert.throws(() => verifyRootJws(Buffer.from(parts.join('.') + '\n'), keys, 'accepted-runtime-proof', { now }));
  assert.throws(() => verifyRootJws(token(payload, { alg: 'none', kid: keys.keys[0].kid, typ: 'cop-root-runtime-v1' }), keys, 'accepted-runtime-proof', { now }));
  for (const rows of [[{ ...keys.keys[0], kid: 'unknown' }], [keys.keys[0], keys.keys[0]], [{ ...keys.keys[0], d: 'forbidden' }]])
    assert.throws(() => verifyRootJws(token(), { ...keys, keys: rows }, 'accepted-runtime-proof', { now }));
});
test('expired/future/wrong-kind and noncanonical compact bytes cannot become fresh proof', () => {
  const expired = token({ ...payload, expiresAt: new Date(now - 1).toISOString() });
  assert.throws(() => verifyRootJws(expired, keys, 'accepted-runtime-proof', { now }));
  assert.ok(verifyRootJws(expired, keys, 'accepted-runtime-proof', { now, historical: true }));
  assert.throws(() => verifyRootJws(token({ ...payload, issuedAt: new Date(now + 1).toISOString() }), keys, 'accepted-runtime-proof', { now }));
  assert.throws(() => verifyRootJws(token(), keys, 'other-proof', { now }));
  for (const bytes of [Buffer.from(token().toString().trim()), Buffer.concat([token(), Buffer.from('\n')]), Buffer.from('a.b.c\n')])
    assert.throws(() => verifyRootJws(bytes, keys, 'accepted-runtime-proof', { now }));
});
