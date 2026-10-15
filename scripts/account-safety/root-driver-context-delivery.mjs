import { join } from 'node:path';
import { canonical, exact, hex, uuid, sha256, requireGuard, readPublicVerificationKeys, readRootFile, verifyRootRecord } from './root-records.mjs';
import { readClientRegistration } from './driver-root-channel.mjs';
import { decodeDriverContextRequest } from './driver-root-context.mjs';
import { inspectRootDriverContext } from './root-driver-runtime.mjs';
import { issueRootRecord } from './root-record-issuer.mjs';

/** Private ephemeral delivery only. Root's producer must independently verify
 * the service claim, actor/body/coverage, original body hash and current owner
 * lease before creating this record. A request or DB boolean cannot create it. */
export async function serveDriverContext(bytes, peer) {
  const r = decodeDriverContextRequest(bytes), keys = readPublicVerificationKeys(), registration = readClientRegistration(peer, keys);
  const digest = sha256(canonical({ kind: r.kind, scope: r.scope }));
  const delivery = verifyRootRecord(readRootFile(join('/run/cop-account-safety/private/request-contexts',
    peer.device + '-' + peer.inode + '-' + digest + '.json'), { secret: true }), keys, 'driver-context-delivery');
  const p = delivery.payload, optional = p.publicationContext === undefined ? [] : ['publicationContext'];
  requireGuard(exact(p, ['contractVersion', 'kind', 'recordId', 'issuedAt', 'expiresAt', 'requestDigest', 'actionKind', 'peer',
    'guardStoreId', 'continuityEpoch', 'datasetBindingId', 'runtimeBindingId', 'currentSourceProofId', 'storeIncarnation',
    'frontierSequence', 'frontierDigest', 'operation', 'originalPermitRef', ...optional]) && p.requestDigest === digest && p.actionKind === r.kind &&
    canonical(p.peer) === canonical(peer) && ['guardStoreId', 'continuityEpoch', 'datasetBindingId', 'runtimeBindingId'].every(k => p[k] === registration[k]) &&
    uuid(p.currentSourceProofId) && uuid(p.storeIncarnation) && Number.isSafeInteger(p.frontierSequence) && p.frontierSequence >= 0 &&
    hex(p.frontierDigest) && exact(p.operation, ['operationId', 'kind']) && uuid(p.operation.operationId) && p.operation.kind === r.kind &&
    exact(p.originalPermitRef, ['recordId', 'digest']) && uuid(p.originalPermitRef.recordId) && hex(p.originalPermitRef.digest) &&
    Date.parse(p.expiresAt) - Date.parse(p.issuedAt) <= 5000, 'GUARD_CONTEXT_DELIVERY');
  const observed = await inspectRootDriverContext(p.operation.operationId, registration, p.currentSourceProofId,
    { sequence: p.frontierSequence, digest: p.frontierDigest });
  requireGuard(canonical(observed.originalPermitRef) === canonical(p.originalPermitRef) && observed.operation.kind === r.kind &&
    observed.operation.storeIncarnation === p.storeIncarnation && canonical(observed.keys) === canonical(keys), 'GUARD_CONTEXT_ORIGINAL');
  requireGuard(canonical(readClientRegistration(peer, keys)) === canonical(registration), 'GUARD_CONTEXT_REGISTRATION_CHANGED');
  const lifetimeMs = Math.min(5000, Date.parse(p.expiresAt) - Date.now(), observed.expiresAt - Date.now());
  requireGuard(lifetimeMs > 0, 'GUARD_CONTEXT_EXPIRED');
  const facts = Object.fromEntries(Object.entries(p).filter(([key]) => !['contractVersion', 'kind', 'recordId', 'issuedAt', 'expiresAt'].includes(key)));
  return issueRootRecord('driver-request-context', { ...facts, requestId: r.requestId },
    { lifetimeMs, expectedKeyringDigest: sha256(canonical(keys) + '\n') }).bytes;
}
