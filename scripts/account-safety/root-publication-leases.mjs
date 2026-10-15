/** Actual held metadata lease registry. No expiry, absent file, socket close or
 * dead pidfd is treated as proof that target SQL/publication has drained. */
import { pathToFileURL } from 'node:url';
import { canonical, sha256, requireGuard } from './root-records.mjs';
import { issueRootRecord } from './root-record-issuer.mjs';
import { decodePublicationLeaseRequest } from './driver-root-publication.mjs';

const leases = new Map();
const same = (a, b) => canonical(a) === canonical(b);
async function currentOwner(peer) {
  const module = await import(pathToFileURL('/opt/cop-account-safety/root-owner-authority.mjs').href);
  return module.requireCurrentOwner('sim_driver_measurements', peer, 'read');
}
export async function servePublicationLease(bytes, peer, native, connection) {
  requireGuard(process.getuid?.() === 0 && process.geteuid?.() === 0, 'ROOT_EXECUTION_REQUIRED');
  const request = decodePublicationLeaseRequest(bytes); let held;
  if (request.action === 'acquire') {
    requireGuard(leases.size < 256, 'GUARD_PUBLICATION_LEASE_CAPACITY');
    const authority = await currentOwner(peer); let handle;
    try {
      await authority.assertCurrent(); handle = native.retainPeer(connection);
      requireGuard(native.peerAlive(handle), 'GUARD_PUBLICATION_PEER_EXITED');
      const token = issueRootRecord('driver-publication-lease', { peer, publicationKind: request.kind,
        authorityRef: authority.reference, storeIncarnation: authority.storeIncarnation },
      { lifetimeMs: 5000, expectedKeyringDigest: sha256(canonical(authority.keys) + '\n') });
      held = { authority, peer, kind: request.kind, handle, reference: { recordId: token.payload.recordId, digest: token.digest }, released: false };
      leases.set(token.payload.recordId, held);
    } catch (error) {
      if (handle) native.close(handle);
      await authority.close(); throw error;
    }
  } else {
    held = leases.get(request.leaseRef.recordId);
    requireGuard(held && !held.released && held.kind === request.kind && same(held.reference, request.leaseRef) && same(held.peer, peer), 'GUARD_PUBLICATION_LEASE_UNKNOWN');
  }
  const a = held.authority;
  if (request.action === 'release') {
    // Only the same live kernel peer in the independently accepted immutable
    // consumer can finish its original callback. Unknown close keeps HOLD.
    requireGuard(native.peerAlive(held.handle), 'GUARD_PUBLICATION_PEER_EXITED');
    await a.close(); held.released = true; leases.delete(held.reference.recordId); native.close(held.handle);
  } else { requireGuard(native.peerAlive(held.handle), 'GUARD_PUBLICATION_PEER_EXITED'); await a.assertCurrent(); }
  const record = issueRootRecord('driver-publication-lease-reply', { requestId: request.requestId, requestDigest: sha256(canonical(request)),
    action: request.action, publicationKind: request.kind, leaseRef: held.reference, peer,
    guardStoreId: a.guardStoreId, continuityEpoch: a.continuityEpoch, datasetBindingId: a.datasetBindingId,
    runtimeBindingId: a.runtimeBindingId, sourceProofId: a.sourceProofId, storeIncarnation: a.storeIncarnation,
    frontierSequence: a.frontierSequence, frontierDigest: a.frontierDigest, state: request.action === 'release' ? 'released' : 'held' },
  { lifetimeMs: 5000, expectedKeyringDigest: sha256(canonical(a.keys) + '\n') });
  return record.bytes;
}
