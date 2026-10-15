import { createPrivateKey, createPublicKey, randomUUID, sign } from 'node:crypto';
import { constants, openSync, closeSync, writeSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, canonicalJson, readRootFile, sha256, requireGuard, requireRootDirectory } from './root-records.mjs';
import { validateRevokeEffect } from './driver-origin-producer.mjs';

/** Root-only publication after control COMMIT and fresh exact SQL readback.
 * No application JSON or inner function result reaches this production path. */
export function publishRootOutcome(operation, resolution, permitRecord) {
  requireGuard(process.getuid?.() === 0 && process.geteuid?.() === 0, 'ROOT_EXECUTION_REQUIRED');
  requireGuard(resolution.operationId === operation.operationId &&
    ['origin-commit-known', 'origin-no-effects-closed'].includes(resolution.state), 'GUARD_OUTCOME_UNRESOLVED');
  const revokeEffect = resolution.revokeEffect === undefined ? undefined : validateRevokeEffect(resolution.revokeEffect);
  requireGuard(!revokeEffect || operation.kind === 'revoke' && resolution.state === 'origin-commit-known', 'GUARD_REVOKE_EFFECT');
  const keyring = canonicalJson(readRootFile('/etc/cop-account-safety/public/verification-keys.json'));
  const key = createPrivateKey(readRootFile('/var/lib/cop-account-safety/authority/signing-key.pkcs8', { secret: true }));
  requireGuard(key.asymmetricKeyType === 'ed25519', 'GUARD_SIGNING_KEY');
  const publicKey = createPublicKey(key).export({ format: 'jwk' });
  const matches = keyring.keys?.filter(row => row.kty === 'OKP' && row.crv === 'Ed25519' && row.x === publicKey.x);
  requireGuard(matches?.length === 1, 'GUARD_SIGNING_KEY');
  const directory = '/var/lib/cop-account-safety/outcomes';
  requireRootDirectory(directory, { secret: true });
  const issue = kind => {
    const now = new Date(), recordId = randomUUID();
    const payload = { contractVersion: 'cop-root-record-v1', kind, recordId, issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 300_000).toISOString(), originId: operation.operationId,
      originalPermitId: operation.permitId, originalPermitDigest: permitRecord.digest,
      storeIncarnation: operation.storeIncarnation, bodyDigest: operation.bodyDigest, schemaDigest: operation.schemaDigest,
      originKind: operation.kind, originState: resolution.state, ...(revokeEffect ? { revokeEffect } : {}) };
    const bytes = Buffer.from(canonical({ keyId: matches[0].kid, payload,
      signature: sign(null, Buffer.from(canonical(payload)), key).toString('base64url') }) + '\n');
    const fd = openSync(join(directory, recordId + '.json'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { let written = 0; while (written < bytes.length) written += writeSync(fd, bytes, written, bytes.length - written); fsyncSync(fd); }
    finally { closeSync(fd); }
    return Object.freeze({ recordId, digest: sha256(bytes) });
  };
  const sqlOutcomeRef = issue('driver-sql-outcome');
  const effectQuiescenceRef = issue('driver-effect-quiescence');
  const parent = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(parent); } finally { closeSync(parent); }
  return Object.freeze({ ...resolution, sqlOutcomeRef, effectQuiescenceRef });
}
