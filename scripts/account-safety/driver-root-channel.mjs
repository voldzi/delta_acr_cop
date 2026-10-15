import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { canonical, canonicalJson, exact, hex, uuid, sha256, requireGuard, requireRootCodeTree, readRootFile,
  readPublicVerificationKeys, verifyRootRecord } from './root-records.mjs';
import { validateRevokeEffect } from './driver-origin-producer.mjs';
import { executeRootDriver } from './root-driver-runtime.mjs';

const VERSION = 'cop-root-driver-message-v1', REPLY = 'cop-root-driver-reply-v1';
const STATE = '/var/lib/cop-account-safety';
const kinds = ['expire', 'revoke', 'erase', 'ack'];
const reasons = ['origin-busy', 'origin-unresolved', 'store-unavailable', 'authority-unavailable',
  'transport-unavailable', 'effect-observation-unavailable'];
const isRef = value => exact(value, ['recordId', 'digest']) && uuid(value.recordId) && hex(value.digest);
function operationRef(op) {
  requireGuard(exact(op, ['operationId', 'kind']) && uuid(op.operationId) && kinds.includes(op.kind), 'GUARD_CHANNEL_OPERATION');
  return { operationId: op.operationId, kind: op.kind };
}
function nativeModule() {
  requireRootCodeTree('/opt/cop-account-safety');
  const require = createRequire('/opt/cop-account-safety/package.json');
  return require('/opt/cop-account-safety/native/root-seqpacket.node');
}
export function validateDriverReply(bytes, request, keys) {
  const reply = canonicalJson(bytes, 16_384);
  requireGuard(exact(reply, ['contractVersion', 'requestId', 'operationId', 'result', 'records']) && reply.contractVersion === REPLY &&
    reply.requestId === request.requestId && reply.operationId === request.operation.operationId && Array.isArray(reply.records), 'GUARD_CHANNEL_REPLY');
  const r = reply.result;
  if (r?.state === 'pending') {
    requireGuard(exact(r, ['contractVersion', 'state', 'reason']) && r.contractVersion === 'cop-driver-origin-result-v1' &&
      reasons.includes(r.reason) && reply.records.length === 0, 'GUARD_CHANNEL_PENDING');
    return Object.freeze({ ...r, operationId: request.operation.operationId });
  }
  requireGuard(exact(r, ['contractVersion', 'operationId', 'state', 'sqlOutcomeRef', 'effectQuiescenceRef',
    ...(r?.revokeEffect === undefined ? [] : ['revokeEffect'])]) && r.contractVersion === 'cop-driver-origin-result-v1' &&
    r.operationId === request.operation.operationId && ['origin-commit-known', 'origin-no-effects-closed'].includes(r.state) &&
    isRef(r.sqlOutcomeRef) && isRef(r.effectQuiescenceRef) && r.sqlOutcomeRef.recordId !== r.effectQuiescenceRef.recordId &&
    reply.records.length === 2, 'GUARD_CHANNEL_TERMINAL');
  if (r.revokeEffect !== undefined) requireGuard(request.operation.kind === 'revoke' && r.state === 'origin-commit-known' &&
    validateRevokeEffect(r.revokeEffect), 'GUARD_CHANNEL_SCALAR');
  let previous;
  for (const [i, field, kind] of [[0, 'sqlOutcomeRef', 'driver-sql-outcome'], [1, 'effectQuiescenceRef', 'driver-effect-quiescence']]) {
    requireGuard(typeof reply.records[i] === 'string', 'GUARD_CHANNEL_RECORD');
    const record = verifyRootRecord(Buffer.from(reply.records[i]), keys, kind);
    const p = record.payload;
    requireGuard(record.digest === r[field].digest && p.recordId === r[field].recordId &&
      p.originId === request.operation.operationId && p.originKind === request.operation.kind && p.originState === r.state && uuid(p.originalPermitId) &&
      hex(p.originalPermitDigest) && uuid(p.storeIncarnation) && hex(p.bodyDigest) && hex(p.schemaDigest) &&
      canonical(p.revokeEffect ?? null) === canonical(r.revokeEffect ?? null), 'GUARD_CHANNEL_RECORD_BINDING');
    const context = canonical([p.originId, p.originKind, p.originState, p.originalPermitId, p.originalPermitDigest,
      p.storeIncarnation, p.bodyDigest, p.schemaDigest, p.revokeEffect ?? null]);
    requireGuard(previous === undefined || previous === context, 'GUARD_CHANNEL_RECORD_BINDING'); previous = context;
  }
  return Object.freeze({ ...r, ...(r.revokeEffect ? { revokeEffect: Object.freeze({ ...r.revokeEffect }) } : {}) });
}

/** Fixed in-process transport. No shell, socket path, identity, DSN or positive
 * verification callback is supplied by the application or browser. */
export function createProductionDriverRootPort() {
  let native;
  try { native = nativeModule(); } catch { /* An absent installation is unavailable. */ }
  let busy = false;
  const bindings = new Map();
  const pending = (op, reason) => Object.freeze({ contractVersion: 'cop-driver-origin-result-v1', operationId: op.operationId, state: 'pending', reason });
  const call = async (action, operation, body) => {
    const op = operationRef(operation);
    if (!native) return pending(op, 'transport-unavailable');
    if (busy) return pending(op, 'origin-busy');
    busy = true;
    try {
      const request = { contractVersion: VERSION, requestId: randomUUID(), action, operation: op, body };
      const bytes = Buffer.from(canonical(request) + '\n');
      requireGuard(bytes.length <= 16_384, 'GUARD_CHANNEL_SIZE');
      const keys = readPublicVerificationKeys();
      return validateDriverReply(await native.exchange(bytes), request, keys);
    } catch { return pending(op, 'transport-unavailable'); }
    finally { busy = false; }
  };
  return Object.freeze({
    async execute(request) {
      requireGuard(exact(request, ['operation', 'body']), 'GUARD_CHANNEL_REQUEST');
      const op = operationRef(request.operation), binding = sha256(canonical(request));
      // Same-process repeats preserve the original input as well as Root's
      // durable guard. A restart still reaches Root's exact original dispatch.
      if (bindings.has(op.operationId) && bindings.get(op.operationId) !== binding) return pending(op, 'authority-unavailable');
      if (!bindings.has(op.operationId)) {
        if (bindings.size >= 4096) return pending(op, 'origin-busy');
        // Keep only a digest, never a contributor body, in the client journal.
        bindings.set(op.operationId, binding);
      }
      // Root checks the original PostgreSQL body digest on every execute, even
      // when it then resolves a previous attempt without repeating any effects.
      return call('execute', op, canonical(request.body));
    },
    async probe(op) { return call('probe', op, null); },
  });
}

export function readClientRegistration(peer, keys = readPublicVerificationKeys()) {
  requireGuard(exact(peer, ['device', 'inode', 'uid', 'gid']) && /^[0-9]{1,20}$/.test(peer.device) &&
    /^[0-9]{1,20}$/.test(peer.inode) && peer.inode !== '0' && Number.isSafeInteger(peer.uid) && peer.uid >= 0 &&
    Number.isSafeInteger(peer.gid) && peer.gid >= 0, 'GUARD_CLIENT_PEER');
  const file = join(STATE, 'clients', peer.device + '-' + peer.inode + '.json');
  const record = verifyRootRecord(readRootFile(file, { secret: true }), keys, 'driver-client-registration');
  const p = record.payload;
  requireGuard(exact(p, ['contractVersion', 'kind', 'recordId', 'issuedAt', 'expiresAt', 'peer', 'runtimeBindingId',
    'datasetBindingId', 'guardStoreId', 'continuityEpoch', 'imageId', 'sourceRevision', 'machineBootId']) &&
    canonical(p.peer) === canonical(peer) && uuid(p.runtimeBindingId) && uuid(p.datasetBindingId) && uuid(p.guardStoreId) &&
    uuid(p.continuityEpoch) && /^sha256:[0-9a-f]{64}$/.test(p.imageId) && /^[0-9a-f]{40}$/.test(p.sourceRevision) &&
    p.machineBootId === readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), 'GUARD_CLIENT_REGISTRATION');
  return p;
}
function decodeRequest(bytes) {
  const r = canonicalJson(bytes, 16_384);
  requireGuard(exact(r, ['contractVersion', 'requestId', 'action', 'operation', 'body']) && r.contractVersion === VERSION &&
    uuid(r.requestId) && ['execute', 'probe'].includes(r.action) &&
    (r.action === 'probe' ? r.body === null : typeof r.body === 'string' && Buffer.byteLength(r.body) <= 16_384), 'GUARD_CHANNEL_REQUEST');
  operationRef(r.operation); return r;
}
export async function main() {
  requireGuard(process.getuid?.() === 0 && process.geteuid?.() === 0, 'ROOT_EXECUTION_REQUIRED');
  const native = nativeModule(), listener = native.listen();
  try {
    for (;;) {
      let item;
      try { item = await native.receive(listener); } catch { continue; }
      try {
        const request = decodeRequest(item.packet), registration = readClientRegistration(item.peer);
        const permit = verifyRootRecord(readRootFile(join(STATE, 'operations', request.operation.operationId + '.json'), { secret: true }),
          readPublicVerificationKeys(), 'driver-origin-permit', { historical: true });
        requireGuard(permit.payload.operation.kind === request.operation.kind, 'GUARD_CHANNEL_OPERATION');
        const result = await executeRootDriver(request.action, request.operation.operationId, request.body, registration);
        const records = result.state === 'pending' ? [] : ['sqlOutcomeRef', 'effectQuiescenceRef'].map(field =>
          readRootFile(join(STATE, 'outcomes', result[field].recordId + '.json'), { secret: true }).toString('utf8'));
        const reply = Buffer.from(canonical({ contractVersion: REPLY, requestId: request.requestId,
          operationId: request.operation.operationId, result, records }) + '\n');
        requireGuard(reply.length <= 16_384, 'GUARD_CHANNEL_SIZE');
        await native.reply(item.connection, reply);
      } catch { try { native.close(item.connection); } catch { /* Closing a channel is never SQL settlement. */ } }
    }
  } finally { native.close(listener); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => { process.stderr.write('COP_ROOT_DRIVER_CHANNEL_UNAVAILABLE\n'); process.exitCode = 1; });
