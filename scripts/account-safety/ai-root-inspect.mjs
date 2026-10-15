import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { canonical, canonicalJson, exact, hex, uuid, sha256, requireGuard, readRootFile,
  readPublicVerificationKeys, verifyRootRecord, requireRootCodeTree } from './root-records.mjs';
import { nativeModule } from './root-native.mjs';

const VERSION = 'cop-root-ai-inspect-message-v1', REPLY = 'cop-root-ai-inspect-reply-v1';
const STATE = '/var/lib/cop-account-safety', COST = 'aggregate-costs-current-month-v1';
const ref = v => exact(v, ['recordId', 'digest']) && uuid(v.recordId) && hex(v.digest);
export function validateAiReadRequest(r) {
  requireGuard(exact(r, ['owner', 'scope', 'purpose', 'expectedSnapshot']) && r.owner === 'sim_ai_router' &&
    r.scope === 'cop_router_primary_database' && r.purpose === 'checkpoint', 'GUARD_AI_READ_REQUEST');
  const s = r.expectedSnapshot;
  requireGuard(exact(s, ['checkpointId', 'generation', 'operationDigest', 'schemaDigest']) && uuid(s.checkpointId) &&
    typeof s.generation === 'string' && /^(?:0|[1-9][0-9]{0,18})$/.test(s.generation) && BigInt(s.generation) <= 9223372036854775807n &&
    hex(s.operationDigest) && hex(s.schemaDigest), 'GUARD_AI_READ_REQUEST'); return r;
}
export function readAiClientRegistration(peer, keys = readPublicVerificationKeys()) {
  requireGuard(exact(peer, ['device', 'inode', 'uid', 'gid']) && /^[0-9]{1,20}$/.test(peer.device) &&
    /^[0-9]{1,20}$/.test(peer.inode) && peer.inode !== '0' && Number.isSafeInteger(peer.uid) && peer.uid >= 0 &&
    Number.isSafeInteger(peer.gid) && peer.gid >= 0, 'GUARD_CLIENT_PEER');
  const record = verifyRootRecord(readRootFile(join(STATE, 'ai-clients', peer.device + '-' + peer.inode + '.json'), { secret: true }), keys,
    'ai-router-client-registration');
  const p = record.payload;
  requireGuard(exact(p, ['contractVersion', 'kind', 'recordId', 'issuedAt', 'expiresAt', 'peer', 'runtimeBindingId',
    'datasetBindingId', 'guardStoreId', 'continuityEpoch', 'imageId', 'sourceRevision', 'machineBootId']) &&
    canonical(p.peer) === canonical(peer) && ['runtimeBindingId', 'datasetBindingId', 'guardStoreId', 'continuityEpoch'].every(k => uuid(p[k])) &&
    /^sha256:[0-9a-f]{64}$/.test(p.imageId) && /^[0-9a-f]{40}$/.test(p.sourceRevision) &&
    p.machineBootId === readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), 'GUARD_AI_REGISTRATION');
  return p;
}
export async function serveAiInspect(bytes, peer) {
  const r = canonicalJson(bytes, 16_384);
  requireGuard(exact(r, ['contractVersion', 'requestId', 'action', 'request']) && r.contractVersion === VERSION &&
    uuid(r.requestId) && r.action === 'inspect', 'GUARD_AI_READ_WIRE');
  const request = validateAiReadRequest(r.request), keys = readPublicVerificationKeys();
  const registration = readAiClientRegistration(peer, keys);
  requireRootCodeTree('/opt/cop-account-safety');
  const module = await import(pathToFileURL('/opt/cop-account-safety/root-owner-read.mjs').href);
  const result = await module.inspectRootAiOwner(peer, request);
  requireGuard(exact(result, ['admission', 'record', 'readPermitId']) && uuid(result.readPermitId) &&
    canonical(readPublicVerificationKeys()) === canonical(keys) && canonical(readAiClientRegistration(peer, keys)) === canonical(registration), 'GUARD_AI_READ_OWNER_CHANGED');
  const reply = Buffer.from(canonical({ contractVersion: REPLY, requestId: r.requestId, ...result }) + '\n');
  validateAiInspectReply(reply, r, keys, peer); return reply;
}
export function validateAiInspectReply(bytes, request, keys, peer) {
  const reply = canonicalJson(bytes, 16_384);
  requireGuard(exact(reply, ['contractVersion', 'requestId', 'readPermitId', 'admission', 'record']) && reply.contractVersion === REPLY &&
    reply.requestId === request.requestId && uuid(reply.readPermitId) && typeof reply.record === 'string', 'GUARD_AI_READ_REPLY');
  const record = verifyRootRecord(Buffer.from(reply.record), keys, 'ai-router-read-admission'), p = record.payload, a = reply.admission;
  requireGuard(exact(p, ['contractVersion', 'kind', 'recordId', 'issuedAt', 'expiresAt', 'readPermitId', 'readPermitDigest', 'request',
    'requestDigest', 'guardStoreId', 'continuityEpoch', 'datasetBindingId', 'runtimeBindingId', 'sourceProofId', 'policyGeneration',
    'frontierSequence', 'frontierDigest', 'storeIncarnation', 'schemaFingerprint', 'privilegeFingerprint', 'costPolicy', 'factsDigest', 'peer', 'clientRegistrationRef']) &&
    p.readPermitId === reply.readPermitId && hex(p.readPermitDigest) && canonical(p.request) === canonical(request.request) &&
    p.requestDigest === sha256(canonical(request.request)) && exact(p.peer, ['device', 'inode', 'uid', 'gid']) &&
    p.peer.device === peer.device && p.peer.inode === peer.inode && Number.isSafeInteger(p.peer.uid) && p.peer.uid >= 0 &&
    Number.isSafeInteger(p.peer.gid) && p.peer.gid >= 0 &&
    ['guardStoreId', 'continuityEpoch', 'datasetBindingId', 'runtimeBindingId', 'sourceProofId', 'storeIncarnation'].every(k => uuid(p[k])) &&
    ['frontierDigest', 'schemaFingerprint', 'privilegeFingerprint', 'factsDigest'].every(k => hex(p[k])) &&
    Number.isSafeInteger(p.policyGeneration) && p.policyGeneration >= 1 && Number.isSafeInteger(p.frontierSequence) && p.frontierSequence >= 0 &&
    p.costPolicy === COST && ref(p.clientRegistrationRef) && Date.parse(p.expiresAt) - Date.parse(p.issuedAt) <= 5000, 'GUARD_AI_READ_RECORD');
  requireGuard(exact(a, ['contractVersion', 'request', 'reference']) && a.contractVersion === 'sim-ai-router-checkpoint-admission-v1' &&
    canonical(a.request) === canonical(request.request) && ref(a.reference) && a.reference.recordId === p.recordId && a.reference.digest === record.digest,
  'GUARD_AI_READ_ADMISSION');
  return Object.freeze(structuredClone(a));
}
export function createProductionAiCheckpointAdmissionPort() {
  const native = nativeModule();
  return Object.freeze({ async inspect(input) {
    try {
      const request = { contractVersion: VERSION, requestId: randomUUID(), action: 'inspect', request: validateAiReadRequest(input) };
      const keys = readPublicVerificationKeys(), reply = await native.exchange(Buffer.from(canonical(request) + '\n'));
      requireGuard(canonical(readPublicVerificationKeys()) === canonical(keys), 'GUARD_KEYRING_CHANGED');
      return validateAiInspectReply(reply, request, keys, native.selfIdentity());
    } catch { return undefined; }
  } });
}
