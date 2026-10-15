import { createPrivateKey, createPublicKey, randomUUID, sign } from 'node:crypto';
import { constants, openSync, closeSync, writeSync, fsyncSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { canonical, canonicalJson, readRootFile, requireRootDirectory, requireGuard, sha256, uuid } from './root-records.mjs';

/** Private fixed signer. Callers supply accepted facts, never a key or path. */
export function issueRootRecord(kind, facts, { recordId = randomUUID(), lifetimeMs = 30_000 } = {}) {
  requireGuard(process.getuid?.() === 0 && process.geteuid?.() === 0, 'ROOT_EXECUTION_REQUIRED');
  requireGuard(uuid(recordId) && typeof kind === 'string' && /^[a-z][a-z0-9-]{1,63}$/.test(kind) &&
    Number.isSafeInteger(lifetimeMs) && lifetimeMs > 0 && lifetimeMs <= 300_000 &&
    !Object.keys(facts).some(k => ['contractVersion', 'kind', 'recordId', 'issuedAt', 'expiresAt'].includes(k)), 'GUARD_ISSUER_FACTS');
  const keys = canonicalJson(readRootFile('/etc/cop-account-safety/public/verification-keys.json'));
  const key = createPrivateKey(readRootFile('/var/lib/cop-account-safety/authority/signing-key.pkcs8', { secret: true }));
  requireGuard(key.asymmetricKeyType === 'ed25519', 'GUARD_SIGNING_KEY');
  const publicKey = createPublicKey(key).export({ format: 'jwk' });
  const matches = keys.keys?.filter(k => k.kty === 'OKP' && k.crv === 'Ed25519' && k.x === publicKey.x);
  requireGuard(matches?.length === 1, 'GUARD_SIGNING_KEY');
  const now = Date.now(), payload = { contractVersion: 'cop-root-record-v1', kind, recordId,
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + lifetimeMs).toISOString(), ...facts };
  const bytes = Buffer.from(canonical({ keyId: matches[0].kid, payload,
    signature: sign(null, Buffer.from(canonical(payload)), key).toString('base64url') }) + '\n');
  return Object.freeze({ bytes, payload, digest: sha256(bytes) });
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
