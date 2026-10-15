import { createHash, createPublicKey, verify } from 'node:crypto';
import { constants, openSync, fstatSync, readSync, closeSync, lstatSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

export class GuardFailure extends Error {
  constructor(code = 'GUARD_UNAVAILABLE') { super(code); this.code = code; }
}
export function requireGuard(condition, code) { if (!condition) throw new GuardFailure(code); }
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export function canonical(value) {
  if (typeof value === 'string') {
    requireGuard(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value), 'GUARD_RECORD_UNICODE');
    return JSON.stringify(value);
  }
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    requireGuard(Number.isSafeInteger(value) && !Object.is(value, -0), 'GUARD_RECORD_NUMBER');
    return String(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  requireGuard(value && Object.getPrototypeOf(value) === Object.prototype, 'GUARD_RECORD_SHAPE');
  return '{' + Object.keys(value).sort().map(key => canonical(key) + ':' + canonical(value[key])).join(',') + '}';
}
export function exact(value, keys) {
  return value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function canonicalJson(bytes, max = 65_536) {
  requireGuard(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= max, 'GUARD_RECORD_SIZE');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let value;
  try { value = JSON.parse(text); } catch { throw new GuardFailure('GUARD_RECORD_JSON'); }
  // Exact canonical bytes also reject duplicate keys, lossy numbers and trailing data.
  requireGuard(text === canonical(value) + '\n', 'GUARD_RECORD_CANONICAL');
  return value;
}
export function requireRootDirectory(path, { secret = false } = {}) {
  requireGuard(process.getuid?.() === 0 && process.geteuid?.() === 0, 'ROOT_EXECUTION_REQUIRED');
  requireGuard(isAbsolute(path) && resolve(path) === path, 'GUARD_PATH');
  for (let parent = path;; parent = dirname(parent)) {
    const item = lstatSync(parent);
    requireGuard(item.isDirectory() && item.uid === 0 && (item.mode & (parent === path && secret ? 0o077 : 0o022)) === 0,
      'GUARD_PARENT_CUSTODY');
    if (parent === '/') break;
  }
}
/** The fixed installation uses ordinary files, never application-owned pnpm
 * links. Check the complete dependency tree before importing privileged code. */
export function requireRootCodeTree(path, maxEntries = 20_000) {
  requireRootDirectory(path);
  let count = 0;
  const visit = directory => {
    for (const name of readdirSync(directory)) {
      requireGuard(++count <= maxEntries, 'GUARD_CODE_TREE_SIZE');
      const child = directory + '/' + name, item = lstatSync(child);
      requireGuard(item.uid === 0 && (item.mode & 0o022) === 0 &&
        (item.isDirectory() || (item.isFile() && item.nlink === 1)), 'GUARD_CODE_CUSTODY');
      if (item.isDirectory()) visit(child);
    }
  };
  visit(path);
}
export function readRootFile(path, { secret = false, max = 65_536 } = {}) {
  requireGuard(isAbsolute(path) && resolve(path) === path, 'GUARD_PATH');
  requireRootDirectory(dirname(path));
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, { bigint: true });
    requireGuard(before.isFile() && before.uid === 0n && before.nlink === 1n &&
      (before.mode & (secret ? 0o077n : 0o022n)) === 0n && before.size > 0n && before.size <= BigInt(max), 'GUARD_FILE_CUSTODY');
    const bytes = Buffer.alloc(Number(before.size) + 1); let count = 0;
    while (count < bytes.length) { const n = readSync(fd, bytes, count, bytes.length - count, null); if (!n) break; count += n; }
    const after = fstatSync(fd, { bigint: true });
    requireGuard(BigInt(count) === before.size && ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(k => before[k] === after[k]), 'GUARD_FILE_CHANGED');
    return bytes.subarray(0, count);
  } finally { closeSync(fd); }
}
export function verifyRootRecord(bytes, keys, expectedKind, { now = Date.now(), historical = false } = {}) {
  const record = canonicalJson(bytes);
  requireGuard(exact(record, ['keyId', 'payload', 'signature']) && typeof record.keyId === 'string' &&
    typeof record.signature === 'string' && /^[A-Za-z0-9_-]{86}$/.test(record.signature), 'GUARD_SIGNATURE_SHAPE');
  requireGuard(exact(keys, ['contractVersion', 'keys']) && keys.contractVersion === 'cop-root-verification-keys-v1' &&
    Array.isArray(keys.keys) && keys.keys.length > 0 && keys.keys.length <= 8, 'GUARD_KEYRING');
  const seen = new Set();
  for (const key of keys.keys) {
    requireGuard(exact(key, ['kid', 'kty', 'crv', 'x']) && typeof key.kid === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(key.kid) &&
      !seen.has(key.kid) && key.kty === 'OKP' && key.crv === 'Ed25519' && typeof key.x === 'string' &&
      /^[A-Za-z0-9_-]{43}$/.test(key.x) && Buffer.from(key.x, 'base64url').toString('base64url') === key.x, 'GUARD_KEYRING');
    seen.add(key.kid);
  }
  const matching = keys.keys.filter(key => key.kid === record.keyId);
  requireGuard(matching.length === 1 && exact(matching[0], ['kid', 'kty', 'crv', 'x']) && matching[0].kty === 'OKP' &&
    matching[0].crv === 'Ed25519' && typeof matching[0].x === 'string' && /^[A-Za-z0-9_-]{43}$/.test(matching[0].x), 'GUARD_KEY');
  requireGuard(Buffer.from(record.signature, 'base64url').toString('base64url') === record.signature, 'GUARD_SIGNATURE_SHAPE');
  let valid = false;
  try { valid = verify(null, Buffer.from(canonical(record.payload)), createPublicKey({ key: matching[0], format: 'jwk' }), Buffer.from(record.signature, 'base64url')); } catch { /* Fixed failure below. */ }
  requireGuard(valid, 'GUARD_SIGNATURE_INVALID');
  const p = record.payload;
  requireGuard(p && p.contractVersion === 'cop-root-record-v1' && p.kind === expectedKind && uuid(p.recordId) &&
    typeof p.issuedAt === 'string' && typeof p.expiresAt === 'string', 'GUARD_RECORD_BINDING');
  const issued = Date.parse(p.issuedAt), expires = Date.parse(p.expiresAt);
  requireGuard(Number.isFinite(issued) && Number.isFinite(expires) && new Date(issued).toISOString() === p.issuedAt &&
    new Date(expires).toISOString() === p.expiresAt && issued < expires && expires - issued <= 300_000 && issued <= now,
  'GUARD_RECORD_TIME');
  requireGuard(historical || expires > now, 'GUARD_RECORD_EXPIRED');
  return Object.freeze({ payload: Object.freeze(p), digest: sha256(bytes) });
}
