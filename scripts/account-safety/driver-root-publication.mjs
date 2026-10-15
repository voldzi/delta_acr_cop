/** Fixed, server-only publication lease. The accepted callback must await both
 * its real SQL work and HTTP finish/close before returning. An expiry rejects
 * publication; it never silently releases the Root-held database barrier. */
import { randomUUID } from 'node:crypto';
import { canonical, canonicalJson, exact, hex, uuid, sha256, readPublicVerificationKeys, verifyRootRecord, requireGuard } from './root-records.mjs';
import { nativeModule } from './root-native.mjs';

const VERSION = 'cop-root-driver-publication-message-v1';
const ref = v => exact(v, ['recordId', 'digest']) && uuid(v.recordId) && hex(v.digest);
export function decodePublicationLeaseRequest(bytes) {
  const r = canonicalJson(bytes, 16_384);
  requireGuard(exact(r, ['contractVersion', 'requestId', 'action', 'kind', 'leaseRef']) && r.contractVersion === VERSION && uuid(r.requestId) &&
    ['acquire', 'assert', 'release'].includes(r.action) && ['aggregates', 'quality'].includes(r.kind) &&
    (r.action === 'acquire' ? r.leaseRef === null : ref(r.leaseRef)), 'GUARD_PUBLICATION_LEASE_REQUEST'); return r;
}
export function validatePublicationLeaseReply(bytes, request, keys, peer) {
  const record = verifyRootRecord(bytes, keys, 'driver-publication-lease-reply'), p = record.payload;
  requireGuard(exact(p, ['contractVersion', 'kind', 'recordId', 'issuedAt', 'expiresAt', 'requestId', 'requestDigest', 'action',
    'publicationKind', 'leaseRef', 'peer', 'guardStoreId', 'continuityEpoch', 'datasetBindingId', 'runtimeBindingId',
    'sourceProofId', 'storeIncarnation', 'frontierSequence', 'frontierDigest', 'state']) && p.requestId === request.requestId &&
    p.requestDigest === sha256(canonical(request)) && p.action === request.action && p.publicationKind === request.kind && ref(p.leaseRef) &&
    (request.leaseRef === null || canonical(p.leaseRef) === canonical(request.leaseRef)) &&
    exact(p.peer, ['device', 'inode', 'uid', 'gid']) && p.peer.device === peer.device && p.peer.inode === peer.inode &&
    Number.isSafeInteger(p.peer.uid) && p.peer.uid >= 0 && Number.isSafeInteger(p.peer.gid) && p.peer.gid >= 0 &&
    ['guardStoreId', 'continuityEpoch', 'datasetBindingId', 'runtimeBindingId', 'sourceProofId', 'storeIncarnation'].every(k => uuid(p[k])) &&
    Number.isSafeInteger(p.frontierSequence) && p.frontierSequence >= 0 && hex(p.frontierDigest) &&
    p.state === (request.action === 'release' ? 'released' : 'held') && Date.parse(p.expiresAt) - Date.parse(p.issuedAt) <= 5000,
  'GUARD_PUBLICATION_LEASE_REPLY');
  return Object.freeze(structuredClone(p));
}
export function createProductionDriverPublicationPort() {
  const native = nativeModule();
  const call = async (action, kind, leaseRef) => {
    const request = { contractVersion: VERSION, requestId: randomUUID(), action, kind, leaseRef };
    const keys = readPublicVerificationKeys(), reply = await native.exchange(Buffer.from(canonical(request) + '\n'));
    requireGuard(canonical(readPublicVerificationKeys()) === canonical(keys), 'GUARD_KEYRING_CHANGED');
    return validatePublicationLeaseReply(reply, request, keys, native.selfIdentity());
  };
  return Object.freeze({ async withLease(input, work) {
    requireGuard(exact(input, ['kind']) && ['aggregates', 'quality'].includes(input.kind) && typeof work === 'function', 'GUARD_PUBLICATION_LEASE_INPUT');
    const acquired = await call('acquire', input.kind, null); let open = true;
    const lease = Object.freeze({ async assertCurrent() {
      requireGuard(open, 'GUARD_PUBLICATION_LEASE_CLOSED');
      const current = await call('assert', input.kind, acquired.leaseRef);
      requireGuard(['guardStoreId', 'continuityEpoch', 'datasetBindingId', 'runtimeBindingId', 'storeIncarnation', 'frontierSequence', 'frontierDigest']
        .every(k => current[k] === acquired[k]), 'GUARD_PUBLICATION_LEASE_CHANGED');
    } });
    try { return await work(lease); }
    finally {
      // Await the accepted callback even when its HTTP timeout already fired.
      // Release failure is an error/HOLD, never a positive drain assertion.
      open = false; await call('release', input.kind, acquired.leaseRef);
    }
  } });
}
