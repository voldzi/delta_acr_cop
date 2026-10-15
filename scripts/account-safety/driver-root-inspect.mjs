import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonical, canonicalJson, exact, hex, uuid, sha256, requireGuard, readRootFile,
  readPublicVerificationKeys, verifyRootRecord, requireRootCodeTree } from './root-records.mjs';
import { nativeModule } from './root-native.mjs';
import { readClientRegistration } from './driver-root-channel.mjs';

const VERSION = 'cop-root-driver-inspect-message-v1', REPLY = 'cop-root-driver-inspect-reply-v1';
const ref = v => exact(v, ['recordId', 'digest']) && uuid(v.recordId) && hex(v.digest);
export function validateDriverReadRequest(request) {
  requireGuard(request?.owner === 'sim_driver_measurements' && request.scope === 'online_driver_scope' &&
    ['capability', 'intake', 'preflight', 'status', 'receipt'].includes(request.purpose), 'GUARD_READ_REQUEST');
  const bound = ['preflight', 'status', 'receipt'].includes(request.purpose);
  requireGuard(exact(request, ['owner', 'scope', 'purpose', ...(bound ? ['operationHash', 'actorHash'] : [])]) &&
    (!bound || hex(request.operationHash) && hex(request.actorHash)), 'GUARD_READ_REQUEST');
  return request;
}
export async function serveDriverInspect(bytes, peer) {
  const r = canonicalJson(bytes, 16_384);
  requireGuard(exact(r, ['contractVersion', 'requestId', 'action', 'request']) && r.contractVersion === VERSION &&
    uuid(r.requestId) && r.action === 'inspect', 'GUARD_READ_WIRE');
  const request = validateDriverReadRequest(r.request), keys = readPublicVerificationKeys();
  const registration = readClientRegistration(peer, keys), digest = sha256(canonical(request));
  // Internal Root-delivered selector: neither the browser nor application
  // supplies a Root permit UUID, pathname, source proof or database identity.
  const delivery = verifyRootRecord(readRootFile(join('/var/lib/cop-account-safety/read-deliveries',
    peer.device + '-' + peer.inode + '-' + digest + '.json'), { secret: true }), keys, 'driver-read-delivery');
  const d = delivery.payload;
  requireGuard(exact(d, ['contractVersion', 'kind', 'recordId', 'issuedAt', 'expiresAt', 'requestDigest', 'peer',
    'runtimeBindingId', 'datasetBindingId', 'guardStoreId', 'continuityEpoch', 'readPermitRef']) &&
    d.requestDigest === digest && canonical(d.peer) === canonical(peer) && ref(d.readPermitRef) &&
    ['runtimeBindingId', 'datasetBindingId', 'guardStoreId', 'continuityEpoch'].every(k => d[k] === registration[k]), 'GUARD_READ_DELIVERY');
  const permit = verifyRootRecord(readRootFile(join('/var/lib/cop-account-safety/read-permits', d.readPermitRef.recordId + '.json'), { secret: true }), keys, 'driver-read-permit');
  requireGuard(permit.digest === d.readPermitRef.digest && permit.payload.requestDigest === digest, 'GUARD_READ_DELIVERY');
  requireRootCodeTree('/opt/cop-account-safety');
  const module = await import(pathToFileURL('/opt/cop-account-safety/root-read-admission.mjs').href);
  const inspected = await module.inspectRootDriver(d.readPermitRef.recordId, request, peer);
  return Buffer.from(canonical({ contractVersion: REPLY, requestId: r.requestId, readPermitId: d.readPermitRef.recordId,
    admission: inspected.admission, record: inspected.record }) + '\n');
}
export function validateDriverInspectReply(bytes, request, keys, peer) {
  const reply = canonicalJson(bytes, 16_384);
  requireGuard(exact(reply, ['contractVersion', 'requestId', 'readPermitId', 'admission', 'record']) && reply.contractVersion === REPLY &&
    reply.requestId === request.requestId && uuid(reply.readPermitId) && typeof reply.record === 'string', 'GUARD_READ_REPLY');
  const record = verifyRootRecord(Buffer.from(reply.record), keys, 'driver-read-admission'), p = record.payload, a = reply.admission;
  requireGuard(exact(p, ['contractVersion', 'kind', 'recordId', 'issuedAt', 'expiresAt', 'readPermitId', 'readPermitDigest', 'request',
    'requestDigest', 'guardStoreId', 'continuityEpoch', 'datasetBindingId', 'runtimeBindingId', 'sourceProofId', 'policyGeneration',
    'frontierSequence', 'frontierDigest', 'storeIncarnation', 'checkpointHash', 'reportProtection', 'schemaFingerprint',
    'privilegeFingerprint', 'reportInventoryRef', 'factsDigest', 'operationDigest', 'peer', 'clientRegistrationRef']) &&
    p.readPermitId === reply.readPermitId && hex(p.readPermitDigest) && canonical(p.request) === canonical(request.request) &&
    p.requestDigest === sha256(canonical(request.request)) && exact(p.peer, ['device', 'inode', 'uid', 'gid']) &&
    p.peer.device === peer.device && p.peer.inode === peer.inode && Number.isSafeInteger(p.peer.uid) && p.peer.uid >= 0 &&
    Number.isSafeInteger(p.peer.gid) && p.peer.gid >= 0 &&
    ['guardStoreId', 'continuityEpoch', 'datasetBindingId', 'runtimeBindingId', 'sourceProofId', 'storeIncarnation'].every(k => uuid(p[k])) &&
    ['frontierDigest', 'checkpointHash', 'schemaFingerprint', 'privilegeFingerprint', 'factsDigest'].every(k => hex(p[k])) &&
    (p.operationDigest === null || hex(p.operationDigest)) && Number.isSafeInteger(p.policyGeneration) && p.policyGeneration >= 1 &&
    Number.isSafeInteger(p.frontierSequence) && p.frontierSequence >= 0 && ref(p.reportInventoryRef) && ref(p.clientRegistrationRef) &&
    ['no_report', 'enforced_single_writer', 'shared_generation_fence'].includes(p.reportProtection) &&
    Date.parse(p.expiresAt) - Date.parse(p.issuedAt) <= 5000, 'GUARD_READ_RECORD_BINDING');
  requireGuard(exact(a, ['contractVersion', ...Object.keys(request.request), 'checkpointHash', 'reportProtection', 'reference']) &&
    a.contractVersion === 'sim-driver-guarded-read-admission-v1' &&
    Object.keys(request.request).every(k => a[k] === request.request[k]) && a.checkpointHash === p.checkpointHash &&
    a.reportProtection === p.reportProtection && ref(a.reference) && a.reference.recordId === p.recordId && a.reference.digest === record.digest, 'GUARD_READ_ADMISSION');
  return Object.freeze(structuredClone(a));
}
export function createProductionDriverReadAdmissionPort() {
  const native = nativeModule();
  return Object.freeze({ async inspect(input) {
    try {
      const request = { contractVersion: VERSION, requestId: randomUUID(), action: 'inspect', request: validateDriverReadRequest(input) };
      const peer = native.selfIdentity();
      return validateDriverInspectReply(await native.exchange(Buffer.from(canonical(request) + '\n')), request, readPublicVerificationKeys(), peer);
    } catch { return undefined; }
  } });
}
