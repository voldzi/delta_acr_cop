import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { canonical, canonicalJson, exact, hex, uuid, sha256, readPublicVerificationKeys, verifyRootRecord, requireGuard } from './root-records.mjs';
import { nativeModule } from './root-native.mjs';

const VERSION = 'cop-root-driver-context-message-v1';
const PREFIX = '/api/v1/internal/driver-measurements/v1';
const ref = v => exact(v, ['recordId', 'digest']) && uuid(v.recordId) && hex(v.digest);
/** Select only the two typed mutating requests. Batches/GPS and all unrelated
 * request bodies never enter Root scope or the native packet. */
export function driverContextScope(input) {
  if (!exact(input, ['method', 'path', 'authorization', 'actor', 'actorSignature', 'body'])) return undefined;
  if (typeof input.path !== 'string' || input.path.includes('?') || input.path.includes('#')) return undefined;
  const path = input.path.startsWith('/situation-data/') ? input.path.slice('/situation-data'.length) : input.path;
  const erase = input.method === 'POST' && path === PREFIX + '/account-erasure-operations';
  const revoke = input.method === 'DELETE' && path === PREFIX + '/contributions';
  if (!erase && !revoke) return undefined;
  requireGuard(typeof input.authorization === 'string' && /^Bearer [A-Za-z0-9._~+/-]{32,2048}={0,2}$/.test(input.authorization), 'GUARD_CONTEXT_AUTH');
  requireGuard(typeof input.actor === 'string' && typeof input.actorSignature === 'string', 'GUARD_CONTEXT_AUTH');
  if (erase) {
    requireGuard(/^[A-Za-z0-9_-]{20,2048}$/.test(input.actor) && hex(input.actorSignature) &&
      exact(input.body, ['contractVersion', 'operationId', 'contributors', 'attestation']) && input.body.contractVersion === 'sim-account-erasure-v1' &&
      uuid(input.body.operationId) && input.body.attestation === 'cop-account-erasure-contributors-reviewed-v1' &&
      Array.isArray(input.body.contributors) && input.body.contributors.length >= 9 && input.body.contributors.length <= 40 &&
      input.body.contributors.every(c => exact(c, ['contributorDay', 'contributorIdDay']) && /^\d{4}-\d{2}-\d{2}$/.test(c.contributorDay) &&
        typeof c.contributorIdDay === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(c.contributorIdDay)), 'GUARD_CONTEXT_BODY');
  } else requireGuard(/^[A-Za-z0-9_-]{20,2048}$/.test(input.actor) && hex(input.actorSignature) && exact(input.body, ['contractVersion', 'contributorIdDay']) &&
    input.body.contractVersion === 'sim-driver-measurements-v1' && typeof input.body.contributorIdDay === 'string' &&
    /^[A-Za-z0-9_-]{32,128}$/.test(input.body.contributorIdDay), 'GUARD_CONTEXT_BODY');
  const result = { ...input, path };
  requireGuard(Buffer.byteLength(canonical(result)) <= 14_000, 'GUARD_CONTEXT_SIZE');
  return structuredClone(result);
}
export function validateDriverContextReply(bytes, request, keys, peer) {
  const record = verifyRootRecord(bytes, keys, 'driver-request-context'), p = record.payload;
  const optional = p.publicationContext === undefined ? [] : ['publicationContext'];
  requireGuard(exact(p, ['contractVersion', 'kind', 'recordId', 'issuedAt', 'expiresAt', 'requestId', 'requestDigest', 'actionKind',
    'peer', 'guardStoreId', 'continuityEpoch', 'datasetBindingId', 'runtimeBindingId', 'currentSourceProofId', 'storeIncarnation',
    'frontierSequence', 'frontierDigest', 'operation', 'originalPermitRef', ...optional]) && p.requestId === request.requestId &&
    p.requestDigest === sha256(canonical({ kind: request.kind, scope: request.scope })) && p.actionKind === request.kind &&
    exact(p.peer, ['device', 'inode', 'uid', 'gid']) && p.peer.device === peer.device && p.peer.inode === peer.inode &&
    Number.isSafeInteger(p.peer.uid) && p.peer.uid >= 0 && Number.isSafeInteger(p.peer.gid) && p.peer.gid >= 0 &&
    ['guardStoreId', 'continuityEpoch', 'datasetBindingId', 'runtimeBindingId', 'currentSourceProofId', 'storeIncarnation'].every(k => uuid(p[k])) &&
    Number.isSafeInteger(p.frontierSequence) && p.frontierSequence >= 0 && hex(p.frontierDigest) && ref(p.originalPermitRef) &&
    exact(p.operation, ['operationId', 'kind']) && uuid(p.operation.operationId) && p.operation.kind === request.kind &&
    Date.parse(p.expiresAt) - Date.parse(p.issuedAt) <= 5000, 'GUARD_CONTEXT_REPLY');
  if (p.publicationContext !== undefined) {
    const c = p.publicationContext;
    requireGuard(request.kind === 'ack' && exact(c, ['contractVersion', 'recordId', 'recordDigest', 'storeIncarnation', 'operationDigest',
      'readbackDigest', 'reportProtection', 'observedAtUTC']) && c.contractVersion === 'cop-driver-publication-context-v1' &&
      uuid(c.recordId) && c.storeIncarnation === p.storeIncarnation && ['recordDigest', 'operationDigest', 'readbackDigest'].every(k => hex(c[k])) &&
      ['no_report', 'enforced_single_writer', 'shared_generation_fence'].includes(c.reportProtection) &&
      typeof c.observedAtUTC === 'string' && Number.isFinite(Date.parse(c.observedAtUTC)) &&
      new Date(c.observedAtUTC).toISOString() === c.observedAtUTC && Date.parse(c.observedAtUTC) <= Date.parse(p.issuedAt), 'GUARD_CONTEXT_PUBLICATION');
  }
  return Object.freeze({ operation: Object.freeze({ ...p.operation }),
    ...(p.publicationContext === undefined ? {} : { publicationContext: Object.freeze({ ...p.publicationContext }) }) });
}
export function createProductionDriverRequestScope() {
  const native = nativeModule(), storage = new AsyncLocalStorage();
  return Object.freeze({
    context: Object.freeze({ async current(kind) {
      try {
        const scope = storage.getStore();
        if (!scope || !['revoke', 'erase', 'ack'].includes(kind) || (kind === 'revoke') !== (scope.method === 'DELETE')) return undefined;
        const request = { contractVersion: VERSION, requestId: randomUUID(), action: 'current', kind, scope };
        const keys = readPublicVerificationKeys(), bytes = Buffer.from(canonical(request) + '\n');
        requireGuard(bytes.length <= 16_384, 'GUARD_CONTEXT_SIZE');
        const reply = await native.exchange(bytes);
        requireGuard(canonical(readPublicVerificationKeys()) === canonical(keys), 'GUARD_KEYRING_CHANGED');
        return validateDriverContextReply(reply, request, keys, native.selfIdentity());
      } catch { return undefined; }
    } }),
    run(input, work) {
      requireGuard(typeof work === 'function', 'GUARD_CONTEXT_CALLBACK');
      let scope;
      try { scope = driverContextScope(input); } catch { /* Actual HTTP auth/body handlers retain401/400 ordering. */ }
      return storage.run(scope, work);
    }
  });
}
/** Decoder is exported for the fixed Root broker; no HTTP-supplied UUID exists. */
export function decodeDriverContextRequest(bytes) {
  const r = canonicalJson(bytes, 16_384);
  requireGuard(exact(r, ['contractVersion', 'requestId', 'action', 'kind', 'scope']) && r.contractVersion === VERSION &&
    uuid(r.requestId) && r.action === 'current' && ['revoke', 'erase', 'ack'].includes(r.kind), 'GUARD_CONTEXT_REQUEST');
  const scope = driverContextScope(r.scope);
  requireGuard(scope && canonical(scope) === canonical(r.scope) && (r.kind === 'revoke') === (scope.method === 'DELETE'), 'GUARD_CONTEXT_REQUEST');
  return r;
}
