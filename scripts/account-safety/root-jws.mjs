import { createPublicKey, verify } from 'node:crypto';
import { canonical, canonicalJson, exact, uuid, sha256, requireGuard } from './root-records.mjs';

/** Strict RFC7515 compact EdDSA signature for the registry's exact JWS bytes.
 * This is verification only; no database flag or caller-selected key is used by
 * production factories, which load their fixed protected Root keyring. */
export function verifyRootJws(bytes, keys, expectedKind, { now = Date.now(), historical = false } = {}) {
  requireGuard(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 65_536, 'GUARD_JWS_SIZE');
  const text = bytes.toString('ascii');
  requireGuard(bytes.equals(Buffer.from(text, 'ascii')) && text.endsWith('\n') && text.indexOf('\n') === text.length - 1, 'GUARD_JWS_CANONICAL');
  const parts = text.slice(0, -1).split('.'); requireGuard(parts.length === 3, 'GUARD_JWS_SHAPE');
  const decode = (value, max) => {
    requireGuard(/^[A-Za-z0-9_-]+$/.test(value) && value.length <= max && Buffer.from(value, 'base64url').toString('base64url') === value, 'GUARD_JWS_BASE64');
    return canonicalJson(Buffer.concat([Buffer.from(value, 'base64url'), Buffer.from('\n')]));
  };
  const header = decode(parts[0], 4096), payload = decode(parts[1], 60_000);
  requireGuard(exact(header, ['alg', 'kid', 'typ']) && header.alg === 'EdDSA' && header.typ === 'cop-root-runtime-v1' &&
    typeof header.kid === 'string', 'GUARD_JWS_HEADER');
  requireGuard(exact(keys, ['contractVersion', 'keys']) && keys.contractVersion === 'cop-root-verification-keys-v1' &&
    Array.isArray(keys.keys) && keys.keys.length > 0 && keys.keys.length <= 8, 'GUARD_KEYRING');
  const seen = new Set();
  for (const key of keys.keys) {
    requireGuard(exact(key, ['kid', 'kty', 'crv', 'x']) && typeof key.kid === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(key.kid) &&
      !seen.has(key.kid) && key.kty === 'OKP' && key.crv === 'Ed25519' && typeof key.x === 'string' &&
      /^[A-Za-z0-9_-]{43}$/.test(key.x) && Buffer.from(key.x, 'base64url').toString('base64url') === key.x, 'GUARD_KEYRING'); seen.add(key.kid);
  }
  const key = keys.keys.find(k => k.kid === header.kid);
  requireGuard(key && /^[A-Za-z0-9_-]{86}$/.test(parts[2]) && Buffer.from(parts[2], 'base64url').toString('base64url') === parts[2], 'GUARD_JWS_KEY');
  let valid = false;
  try { valid = verify(null, Buffer.from(parts[0] + '.' + parts[1]), createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url')); } catch { /* Fixed failure. */ }
  requireGuard(valid, 'GUARD_JWS_SIGNATURE');
  requireGuard(payload.contractVersion === 'cop-root-record-v1' && payload.kind === expectedKind && uuid(payload.recordId) &&
    typeof payload.issuedAt === 'string' && typeof payload.expiresAt === 'string', 'GUARD_JWS_BINDING');
  const issued = Date.parse(payload.issuedAt), expires = Date.parse(payload.expiresAt);
  requireGuard(Number.isFinite(issued) && Number.isFinite(expires) && new Date(issued).toISOString() === payload.issuedAt &&
    new Date(expires).toISOString() === payload.expiresAt && issued <= now && issued < expires && expires - issued <= 300_000, 'GUARD_JWS_TIME');
  requireGuard(historical || expires > now, 'GUARD_JWS_EXPIRED');
  // Independent canonical check retained even if a future decoder is changed.
  requireGuard(Buffer.from(canonical(payload)).toString('base64url') === parts[1], 'GUARD_JWS_CANONICAL');
  return Object.freeze({ payload: Object.freeze(payload), digest: sha256(bytes) });
}
