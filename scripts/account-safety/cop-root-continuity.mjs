import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, canonicalJson, exact, hex, uuid, requireGuard, readPublicVerificationKeys,
  readRootFile, verifyRootRecord, requireRootCodeTree, sha256 } from './root-records.mjs';
import { RootFenceJournal, validateFenceEntry } from './root-fence-journal.mjs';
import { issueRootRecord } from './root-record-issuer.mjs';
import { connectionProfile } from './root-driver-runtime.mjs';
import { nativeModule } from './root-native.mjs';

const VERSION = 'cop-root-continuity-message-v1';
const STATE = '/var/lib/cop-account-safety';
const frontierValid = f => exact(f, ['sequence', 'digest']) && Number.isSafeInteger(f.sequence) && f.sequence >= 0 && hex(f.digest);
export function readCopClientRegistration(peer, keys = readPublicVerificationKeys()) {
  requireGuard(exact(peer, ['device', 'inode', 'uid', 'gid']) && /^[0-9]{1,20}$/.test(peer.device) &&
    /^[0-9]{1,20}$/.test(peer.inode) && peer.inode !== '0' && Number.isSafeInteger(peer.uid) && peer.uid >= 0 &&
    Number.isSafeInteger(peer.gid) && peer.gid >= 0, 'GUARD_CLIENT_PEER');
  const record = verifyRootRecord(readRootFile(join(STATE, 'cop-clients', peer.device + '-' + peer.inode + '.json'), { secret: true }), keys, 'cop-client-registration');
  const p = record.payload;
  requireGuard(exact(p, ['contractVersion', 'kind', 'recordId', 'issuedAt', 'expiresAt', 'peer', 'applicationStoreId',
    'protectedConfigId', 'configurationFingerprint', 'guardStoreId', 'continuityEpoch', 'imageId', 'sourceRevision', 'machineBootId']) &&
    canonical(p.peer) === canonical(peer) && uuid(p.applicationStoreId) && uuid(p.protectedConfigId) && hex(p.configurationFingerprint) &&
    uuid(p.guardStoreId) && uuid(p.continuityEpoch) && /^sha256:[0-9a-f]{64}$/.test(p.imageId) && /^[0-9a-f]{40}$/.test(p.sourceRevision) &&
    p.machineBootId === readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), 'GUARD_COP_REGISTRATION');
  return p;
}
export function validateContinuityRequest(bytes) {
  const r = canonicalJson(bytes, 16_384);
  requireGuard(exact(r, ['contractVersion', 'requestId', 'action', 'input']) && r.contractVersion === VERSION && uuid(r.requestId), 'GUARD_CONTINUITY_REQUEST');
  requireGuard(['page', 'assert', 'publish'].includes(r.action), 'GUARD_CONTINUITY_REQUEST');
  if (r.action === 'page') requireGuard(exact(r.input, ['cursor', 'frontier']) && Number.isSafeInteger(r.input.cursor) &&
    r.input.cursor >= 0 && r.input.cursor <= 100_000 && (r.input.frontier === null && r.input.cursor === 0 || frontierValid(r.input.frontier)), 'GUARD_CONTINUITY_PAGE');
  if (r.action === 'assert') requireGuard(frontierValid(r.input), 'GUARD_CONTINUITY_FRONTIER');
  return r;
}
/** Real Root factory, fixed database/credential/code. No production callback can
 * turn database flags into authorization or substitute an application store. */
export async function serveContinuityRequest(bytes, peer) {
  const request = validateContinuityRequest(bytes), keys = readPublicVerificationKeys(), registration = readCopClientRegistration(peer, keys);
  requireRootCodeTree('/opt/cop-account-safety');
  const require = createRequire('/opt/cop-account-safety/package.json'), { Client } = require('pg');
  const client = new Client(connectionProfile('registry-journal', 'cop_account_safety_guard', 'cop_guard_root_journal'));
  client.on('error', () => undefined);
  const watchdog = setTimeout(() => client.connection?.stream?.destroy(), 15_000);
  try {
    await client.connect(); await client.query('SET ROLE cop_guard_journal_writer');
    const journal = new RootFenceJournal(client, keys, registration);
    let result;
    if (request.action === 'publish') {
      validateFenceEntry(request.input, registration); result = await journal.publishFence(request.input);
    } else {
      if (request.action === 'assert') {
        const observed = await journal.assertCurrent(request.input); journal.refresh(observed);
        result = { frontier: observed.frontier };
      } else {
        result = await journal.page(request.input.cursor, request.input.frontier);
      }
    }
    // Registration/peer may have expired while SQL was unavailable.
    requireGuard(canonical(readCopClientRegistration(peer, keys)) === canonical(registration), 'GUARD_COP_REGISTRATION_CHANGED');
    const record = issueRootRecord('cop-continuity-reply', { requestId: request.requestId, action: request.action,
      inputDigest: sha256(canonical(request.input)),
      applicationStoreId: registration.applicationStoreId, configurationFingerprint: registration.configurationFingerprint,
      guardStoreId: registration.guardStoreId, continuityEpoch: registration.continuityEpoch, result },
    { lifetimeMs: 5000, expectedKeyringDigest: sha256(canonical(keys) + '\n') });
    requireGuard(record.bytes.length <= 16_384, 'GUARD_CONTINUITY_SIZE'); return record.bytes;
  } finally { try { await client.end().catch(() => undefined); } finally { clearTimeout(watchdog); } }
}

export function validateContinuityReply(bytes, request, keys) {
  const record = verifyRootRecord(bytes, keys, 'cop-continuity-reply'), p = record.payload;
  requireGuard(exact(p, ['contractVersion', 'kind', 'recordId', 'issuedAt', 'expiresAt', 'requestId', 'action', 'inputDigest',
    'applicationStoreId', 'configurationFingerprint', 'guardStoreId', 'continuityEpoch', 'result']) && p.requestId === request.requestId &&
    p.action === request.action && uuid(p.applicationStoreId) && hex(p.configurationFingerprint) && uuid(p.guardStoreId) &&
    uuid(p.continuityEpoch) && p.inputDigest === sha256(canonical(request.input)) && Date.parse(p.expiresAt) - Date.parse(p.issuedAt) <= 5000,
  'GUARD_CONTINUITY_REPLY');
  if (request.action === 'page') requireGuard(p.result?.applicationStoreId === p.applicationStoreId &&
    p.result?.configurationFingerprint === p.configurationFingerprint, 'GUARD_CONTINUITY_REPLY_BINDING');
  return p;
}
/** Client transports only pseudonymous fence metadata over the fixed protected
 * process channel. Browser identity, SQL, credentials and file paths are absent. */
export function createProductionAccountErasureContinuity() {
  const native = nativeModule();
  let binding;
  const call = async (action, input) => {
    const request = { contractVersion: VERSION, requestId: randomUUID(), action, input };
    const bytes = Buffer.from(canonical(request) + '\n'); requireGuard(bytes.length <= 16_384, 'GUARD_CONTINUITY_SIZE');
    const keys = readPublicVerificationKeys(), reply = await native.exchange(bytes);
    requireGuard(canonical(readPublicVerificationKeys()) === canonical(keys), 'GUARD_KEYRING_CHANGED');
    const p = validateContinuityReply(reply, request, keys);
    requireGuard(p.inputDigest === sha256(canonical(input)), 'GUARD_CONTINUITY_REPLY_BINDING');
    const current = canonical([p.applicationStoreId, p.configurationFingerprint, p.guardStoreId, p.continuityEpoch]);
    requireGuard(binding === undefined || binding === current, 'GUARD_CONTINUITY_BINDING_CHANGED'); binding = current;
    return p;
  };
  return Object.freeze({
    async snapshot() {
      const entries = []; let cursor = 0, frontier = null, applicationStoreId, configurationFingerprint;
      for (;;) {
        const { result: r } = await call('page', { cursor, frontier });
        requireGuard(exact(r, ['applicationStoreId', 'configurationFingerprint', 'frontier', 'entry', 'nextCursor']) &&
          uuid(r.applicationStoreId) && hex(r.configurationFingerprint) && frontierValid(r.frontier) &&
          (frontier === null || canonical(frontier) === canonical(r.frontier)) &&
          (r.entry === null ? r.nextCursor === null : r.nextCursor === cursor + 1), 'GUARD_CONTINUITY_PAGE');
        applicationStoreId = r.applicationStoreId; configurationFingerprint = r.configurationFingerprint; frontier = r.frontier;
        if (r.entry === null) break;
        validateFenceEntry(r.entry, { applicationStoreId, configurationFingerprint }); entries.push(r.entry);
        requireGuard(entries.length <= 100_000, 'GUARD_CONTINUITY_BOUND'); cursor = r.nextCursor;
      }
      return { contractVersion: 'cop-erasure-replay-v1', applicationStoreId, configurationFingerprint, frontier, entries };
    },
    async assertCurrent(frontier) {
      requireGuard(frontierValid(frontier), 'GUARD_CONTINUITY_FRONTIER');
      const { result, expiresAt } = await call('assert', frontier);
      requireGuard(exact(result, ['frontier']) && canonical(result.frontier) === canonical(frontier), 'GUARD_CONTINUITY_STALE');
      return { validUntil: expiresAt };
    },
    async publishFence(entry) {
      const { result } = await call('publish', entry);
      requireGuard(exact(result, ['frontier', 'entry']) && frontierValid(result.frontier), 'GUARD_CONTINUITY_PUBLISH');
      validateFenceEntry(result.entry, entry);
      requireGuard(result.entry.accountKey === entry.accountKey && result.entry.job.operationId === entry.job.operationId, 'GUARD_CONTINUITY_PUBLISH');
      return result;
    }
  });
}
