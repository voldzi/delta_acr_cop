/** Pure derivation only. Actual Root factories must independently load and
 * authorize identity, key history, issuance bounds and database inventories. */
import { createHmac } from 'node:crypto';
import { exact, requireGuard } from './root-records.mjs';
const safe = (v, max = 512) => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v) <= max && !/[\u0000-\u001f\u007f-\u009f]/u.test(v);
const secret = v => safe(v, 4096) && v.length >= 32;
const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const hmac = (key, text, encoding = 'hex') => createHmac('sha256', key).update(text).digest(encoding);
export function copAccountMac(key, issuer, subject) {
  requireGuard(secret(key) && safe(issuer, 2048) && safe(subject), 'GUARD_IDENTITY_DERIVATION');
  return hmac(key, 'cop-account-erasure-identity-v1\0' + JSON.stringify([issuer, subject]));
}
export function copRouterAlias(key, subject) {
  requireGuard(secret(key) && safe(subject), 'GUARD_IDENTITY_DERIVATION');
  return 'cop_' + hmac(key, 'cop-router-chat-v1\0' + subject, 'base64url');
}
export function driverDailyIdentity(key, subject, day) {
  requireGuard(secret(key) && safe(subject) && date(day), 'GUARD_IDENTITY_DERIVATION');
  return hmac(key, 'cop-driver-contributor-v1\0' + subject + '\0' + day, 'base64url');
}
export function driverContributorHash(key, contributorIdDay) {
  requireGuard(secret(key) && typeof contributorIdDay === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(contributorIdDay), 'GUARD_IDENTITY_DERIVATION');
  return hmac(key, 'cop:' + contributorIdDay);
}
export function deriveDriverCandidateInventory(keys, subject, hashSecret) {
  requireGuard(Array.isArray(keys) && keys.length >= 1 && keys.length <= 4 && safe(subject) && secret(hashSecret), 'GUARD_DRIVER_INVENTORY_BOUND');
  let count = 0; const versions = new Set(), fingerprints = new Set();
  for (const k of keys) {
    requireGuard(exact(k, ['version', 'secret', 'firstDay', 'lastDay']) && safe(k.version, 64) && secret(k.secret) && date(k.firstDay) && date(k.lastDay) &&
      k.lastDay >= k.firstDay && !versions.has(k.version) && !fingerprints.has(hmac(k.secret, 'cop-key-history-distinct-v1')), 'GUARD_DRIVER_KEY_HISTORY');
    versions.add(k.version); fingerprints.add(hmac(k.secret, 'cop-key-history-distinct-v1'));
    count += (Date.parse(k.lastDay) - Date.parse(k.firstDay)) / 86_400_000 + 1;
    requireGuard(Number.isSafeInteger(count) && count <= 4096, 'GUARD_DRIVER_INVENTORY_BOUND');
  }
  const result = new Map();
  for (const k of keys) for (let ms = Date.parse(k.firstDay); ms <= Date.parse(k.lastDay); ms += 86_400_000) {
    const day = new Date(ms).toISOString().slice(0, 10), hash = driverContributorHash(hashSecret, driverDailyIdentity(k.secret, subject, day));
    requireGuard(!result.has(hash), 'GUARD_DRIVER_INVENTORY_COLLISION'); result.set(hash, day);
  }
  return result;
}
