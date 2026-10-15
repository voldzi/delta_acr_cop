import { join } from 'node:path';
import { canonical, canonicalJson, readRootFile, sha256, requireGuard, requireRootDirectory } from './root-records.mjs';
import { validateRevokeEffect } from './driver-origin-producer.mjs';
import { issueRootRecord, storeRootRecord } from './root-record-issuer.mjs';

/** Root-only publication after control COMMIT and fresh exact SQL readback.
 * No application JSON or inner function result reaches this production path. */
export function publishRootOutcome(operation, resolution, permitRecord, expectedKeys) {
  requireGuard(process.getuid?.() === 0 && process.geteuid?.() === 0, 'ROOT_EXECUTION_REQUIRED');
  requireGuard(resolution.operationId === operation.operationId &&
    ['origin-commit-known', 'origin-no-effects-closed'].includes(resolution.state), 'GUARD_OUTCOME_UNRESOLVED');
  const revokeEffect = resolution.revokeEffect === undefined ? undefined : validateRevokeEffect(resolution.revokeEffect);
  requireGuard(!revokeEffect || operation.kind === 'revoke' && resolution.state === 'origin-commit-known', 'GUARD_REVOKE_EFFECT');
  const keyring = canonicalJson(readRootFile('/etc/cop-account-safety/public/verification-keys.json'));
  requireGuard(expectedKeys === undefined || canonical(expectedKeys) === canonical(keyring), 'GUARD_KEYRING_CHANGED');
  const expectedKeyringDigest = sha256(canonical(keyring) + '\n');
  const directory = '/var/lib/cop-account-safety/outcomes';
  requireRootDirectory(directory, { secret: true });
  const issue = kind => {
    const record = issueRootRecord(kind, { originId: operation.operationId,
      originalPermitId: operation.permitId, originalPermitDigest: permitRecord.digest,
      storeIncarnation: operation.storeIncarnation, bodyDigest: operation.bodyDigest, schemaDigest: operation.schemaDigest,
      originKind: operation.kind, originState: resolution.state, ...(revokeEffect ? { revokeEffect } : {}) },
    { lifetimeMs: 300_000, expectedKeyringDigest });
    storeRootRecord(join(directory, record.payload.recordId + '.json'), record.bytes);
    return Object.freeze({ recordId: record.payload.recordId, digest: record.digest });
  };
  const sqlOutcomeRef = issue('driver-sql-outcome');
  const effectQuiescenceRef = issue('driver-effect-quiescence');
  return Object.freeze({ ...resolution, sqlOutcomeRef, effectQuiescenceRef });
}
