import { randomUUID } from 'node:crypto';
import { canonical, canonicalJson, exact, hex, uuid, sha256, readPublicVerificationKeys, verifyRootRecord, requireGuard } from './root-records.mjs';
import { nativeModule } from './root-native.mjs';
import { createProductionDriverRootPort } from './driver-root-channel.mjs';

export function validateRetentionContext(bytes, request, keys, peer) {
  const record = verifyRootRecord(bytes, keys, 'driver-retention-context'), p = record.payload;
  requireGuard(exact(p, ['contractVersion', 'kind', 'recordId', 'issuedAt', 'expiresAt', 'requestId', 'requestDigest', 'peer', 'owner',
    'cutoff', 'operation', 'originalPermitRef', 'guardStoreId', 'continuityEpoch', 'datasetBindingId', 'runtimeBindingId',
    'currentSourceProofId', 'storeIncarnation', 'frontierSequence', 'frontierDigest']) && p.requestId === request.requestId &&
    p.requestDigest === sha256(canonical({ action: 'current' })) && p.owner === 'sim_driver_measurements' &&
    typeof p.cutoff === 'string' && Number.isFinite(Date.parse(p.cutoff)) && new Date(p.cutoff).toISOString() === p.cutoff && Date.parse(p.cutoff) <= Date.now() &&
    exact(p.peer, ['device', 'inode', 'uid', 'gid']) && p.peer.device === peer.device && p.peer.inode === peer.inode &&
    Number.isSafeInteger(p.peer.uid) && p.peer.uid >= 0 && Number.isSafeInteger(p.peer.gid) && p.peer.gid >= 0 &&
    ['guardStoreId', 'continuityEpoch', 'datasetBindingId', 'runtimeBindingId', 'currentSourceProofId', 'storeIncarnation'].every(k => uuid(p[k])) &&
    exact(p.operation, ['operationId', 'kind']) && uuid(p.operation.operationId) && p.operation.kind === 'expire' &&
    exact(p.originalPermitRef, ['recordId', 'digest']) && uuid(p.originalPermitRef.recordId) && hex(p.originalPermitRef.digest) &&
    Number.isSafeInteger(p.frontierSequence) && p.frontierSequence >= 0 && hex(p.frontierDigest) &&
    Date.parse(p.expiresAt) - Date.parse(p.issuedAt) <= 5000, 'GUARD_RETENTION_CONTEXT');
  return Object.freeze({ owner: 'sim_driver_measurements', cutoff: p.cutoff, operation: Object.freeze({ ...p.operation }) });
}
/** Protected one-shot maintenance. A fulfilled callback is not completion:
 * resolve and verify the actual original Root SQL outcome after work. */
export function createProductionDriverRetentionConsumer() {
  const native = nativeModule(), port = createProductionDriverRootPort(); let busy = false;
  return Object.freeze({ owner: 'sim_driver_measurements', async execute(work) {
    requireGuard(typeof work === 'function' && !busy, 'GUARD_RETENTION_BUSY'); busy = true;
    try {
      const request = { contractVersion: 'cop-root-driver-retention-message-v1', requestId: randomUUID(), action: 'current' };
      const keys = readPublicVerificationKeys(), reply = await native.exchange(Buffer.from(canonical(request) + '\n'));
      requireGuard(canonical(readPublicVerificationKeys()) === canonical(keys), 'GUARD_KEYRING_CHANGED');
      const context = validateRetentionContext(reply, request, keys, native.selfIdentity());
      await work(context);
      const settled = await port.probe(context.operation);
      requireGuard(settled.state === 'origin-commit-known', 'GUARD_RETENTION_UNRESOLVED');
    } finally { busy = false; }
  } });
}
export function decodeRetentionRequest(bytes) {
  const r = canonicalJson(bytes, 16_384);
  requireGuard(exact(r, ['contractVersion', 'requestId', 'action']) && r.contractVersion === 'cop-root-driver-retention-message-v1' &&
    uuid(r.requestId) && r.action === 'current', 'GUARD_RETENTION_REQUEST'); return r;
}
