import { join } from 'node:path';
import { canonical, exact, uuid, hex, sha256, readPublicVerificationKeys, readRootFile, verifyRootRecord, requireGuard } from './root-records.mjs';
import { issueRootRecord } from './root-record-issuer.mjs';
import { readClientRegistration } from './driver-root-channel.mjs';
import { inspectRootDriverContext } from './root-driver-runtime.mjs';
import { decodeRetentionRequest } from './driver-root-retention.mjs';

export async function serveDriverRetention(bytes, peer) {
  const request = decodeRetentionRequest(bytes), keys = readPublicVerificationKeys(), registration = readClientRegistration(peer, keys);
  const record = verifyRootRecord(readRootFile(join('/run/cop-account-safety/private/maintenance-deliveries',
    peer.device + '-' + peer.inode + '.json'), { secret: true }), keys, 'driver-retention-delivery');
  const p = record.payload;
  requireGuard(exact(p, ['contractVersion', 'kind', 'recordId', 'issuedAt', 'expiresAt', 'peer', 'owner', 'cutoff', 'operation',
    'originalPermitRef', 'guardStoreId', 'continuityEpoch', 'datasetBindingId', 'runtimeBindingId', 'currentSourceProofId',
    'storeIncarnation', 'frontierSequence', 'frontierDigest']) && p.owner === 'sim_driver_measurements' &&
    canonical(p.peer) === canonical(peer) && ['guardStoreId', 'continuityEpoch', 'datasetBindingId', 'runtimeBindingId'].every(k => p[k] === registration[k]) &&
    uuid(p.currentSourceProofId) && uuid(p.storeIncarnation) && typeof p.cutoff === 'string' && Number.isFinite(Date.parse(p.cutoff)) &&
    new Date(p.cutoff).toISOString() === p.cutoff && exact(p.operation, ['operationId', 'kind']) && uuid(p.operation.operationId) &&
    p.operation.kind === 'expire' && exact(p.originalPermitRef, ['recordId', 'digest']) && uuid(p.originalPermitRef.recordId) && hex(p.originalPermitRef.digest) &&
    Number.isSafeInteger(p.frontierSequence) && p.frontierSequence >= 0 && hex(p.frontierDigest), 'GUARD_RETENTION_DELIVERY');
  const observed = await inspectRootDriverContext(p.operation.operationId, registration, p.currentSourceProofId,
    { sequence: p.frontierSequence, digest: p.frontierDigest });
  requireGuard(observed.operation.kind === 'expire' && observed.operation.cutoff === p.cutoff && observed.operation.storeIncarnation === p.storeIncarnation &&
    canonical(observed.originalPermitRef) === canonical(p.originalPermitRef) && canonical(observed.keys) === canonical(keys), 'GUARD_RETENTION_ORIGINAL');
  const facts = Object.fromEntries(Object.entries(p).filter(([key]) => !['contractVersion', 'kind', 'recordId', 'issuedAt', 'expiresAt'].includes(key)));
  requireGuard(canonical(readClientRegistration(peer, keys)) === canonical(registration), 'GUARD_RETENTION_REGISTRATION_CHANGED');
  const lifetimeMs = Math.min(5000, Date.parse(p.expiresAt) - Date.now(), observed.expiresAt - Date.now()); requireGuard(lifetimeMs > 0, 'GUARD_RETENTION_EXPIRED');
  return issueRootRecord('driver-retention-context', { ...facts, requestId: request.requestId, requestDigest: sha256(canonical({ action: 'current' })) },
    { lifetimeMs, expectedKeyringDigest: sha256(canonical(keys) + '\n') }).bytes;
}
