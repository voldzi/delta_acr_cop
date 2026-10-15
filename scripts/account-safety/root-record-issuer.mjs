import { createPrivateKey, createPublicKey, randomUUID, sign } from 'node:crypto';
import { constants, openSync, closeSync, writeSync, fsyncSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { canonical, canonicalJson, readRootFile, requireRootDirectory, requireGuard, sha256, uuid, hex } from './root-records.mjs';

/** Private fixed signer. Callers supply accepted facts, never a key or path. */
export function issueRootRecord(kind, facts, { recordId = randomUUID(), lifetimeMs = 30_000, expectedKeyringDigest } = {}) {
  requireGuard(process.getuid?.() === 0 && process.geteuid?.() === 0, 'ROOT_EXECUTION_REQUIRED');
  requireGuard(uuid(recordId) && typeof kind === 'string' && /^[a-z][a-z0-9-]{1,63}$/.test(kind) &&
    Number.isSafeInteger(lifetimeMs) && lifetimeMs > 0 && lifetimeMs <= 300_000 &&
    !Object.keys(facts).some(k => ['contractVersion', 'kind', 'recordId', 'issuedAt', 'expiresAt'].includes(k)), 'GUARD_ISSUER_FACTS');
  const keyringPath = '/etc/cop-account-safety/public/verification-keys.json', signerPath = '/var/lib/cop-account-safety/authority/signing-key.pkcs8';
  const keyBytes = readRootFile(keyringPath), keys = canonicalJson(keyBytes);
  requireGuard(expectedKeyringDigest === undefined || hex(expectedKeyringDigest) && expectedKeyringDigest === sha256(keyBytes), 'GUARD_KEYRING_CHANGED');
  const signerBytes = readRootFile(signerPath, { secret: true }), key = createPrivateKey(signerBytes);
  requireGuard(key.asymmetricKeyType === 'ed25519', 'GUARD_SIGNING_KEY');
  const publicKey = createPublicKey(key).export({ format: 'jwk' });
  const matches = keys.keys?.filter(k => k.kty === 'OKP' && k.crv === 'Ed25519' && k.x === publicKey.x);
  requireGuard(matches?.length === 1, 'GUARD_SIGNING_KEY');
  const now = Date.now(), payload = { contractVersion: 'cop-root-record-v1', kind, recordId,
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + lifetimeMs).toISOString(), ...facts };
  const bytes = Buffer.from(canonical({ keyId: matches[0].kid, payload,
    signature: sign(null, Buffer.from(canonical(payload)), key).toString('base64url') }) + '\n');
  requireGuard(sha256(readRootFile(keyringPath)) === sha256(keyBytes) &&
    sha256(readRootFile(signerPath, { secret: true })) === sha256(signerBytes), 'GUARD_SIGNER_CHANGED');
  return Object.freeze({ bytes, payload, digest: sha256(bytes) });
}
/** Actual compact JWS, not a JSON envelope mislabeled as proof_jws_digest. */
export function issueRootJws(kind, facts, options) {
  requireGuard(hex(options?.expectedKeyringDigest), 'GUARD_JWS_TRUST_SNAPSHOT');
  const record = issueRootRecord(kind, facts, options), envelope = canonicalJson(record.bytes);
  const keyringPath = '/etc/cop-account-safety/public/verification-keys.json', signerPath = '/var/lib/cop-account-safety/authority/signing-key.pkcs8';
  const keyBytes = readRootFile(keyringPath), keys = canonicalJson(keyBytes), signerBytes = readRootFile(signerPath, { secret: true });
  requireGuard(sha256(keyBytes) === options.expectedKeyringDigest, 'GUARD_KEYRING_CHANGED');
  const key = createPrivateKey(signerBytes), pub = createPublicKey(key).export({ format: 'jwk' });
  requireGuard(key.asymmetricKeyType === 'ed25519' && keys.keys.some(k => k.kid === envelope.keyId && k.x === pub.x && k.crv === 'Ed25519'), 'GUARD_SIGNING_KEY');
  const header = Buffer.from(canonical({ alg: 'EdDSA', kid: envelope.keyId, typ: 'cop-root-runtime-v1' })).toString('base64url');
  const body = Buffer.from(canonical(record.payload)).toString('base64url'), message = header + '.' + body;
  const bytes = Buffer.from(message + '.' + sign(null, Buffer.from(message), key).toString('base64url') + '\n');
  requireGuard(sha256(readRootFile(keyringPath)) === sha256(keyBytes) && sha256(readRootFile(signerPath, { secret: true })) === sha256(signerBytes), 'GUARD_SIGNER_CHANGED');
  return Object.freeze({ bytes, payload: record.payload, digest: sha256(bytes) });
}
/** Root file commits are durable before a database journal may reference them. */
export function storeRootRecord(path, bytes, { replace = false } = {}) {
  const directory = dirname(path); requireRootDirectory(directory, { secret: true });
  const target = replace ? join(directory, '.pending-' + randomUUID()) : path;
  const fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    let written = 0;
    while (written < bytes.length) written += writeSync(fd, bytes, written, bytes.length - written);
    fsyncSync(fd);
  } catch (error) { if (replace) try { unlinkSync(target); } catch { /* No authority published. */ } throw error; }
  finally { closeSync(fd); }
  if (replace) renameSync(target, path);
  const parent = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(parent); } finally { closeSync(parent); }
}
