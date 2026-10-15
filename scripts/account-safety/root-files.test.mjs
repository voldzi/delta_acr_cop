import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, writeFileSync, chmodSync, linkSync, symlinkSync, rmSync, readFileSync } from 'node:fs';
import { canonical, readRootFile, requireRootDirectory, requireRootCodeTree, verifyRootRecord } from './root-records.mjs';
import { RootDispatchFiles } from './driver-origin-producer.mjs';
import { publishRootOutcome } from './root-outcome-records.mjs';
import { RootDriverAuthority } from './root-driver-runtime.mjs';

// Must be run in the dedicated disposable Linux container. No host bind mounts.
assert.equal(process.env.COP_OWNED_ROOT_FIXTURE, '1');
assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 0);
const mounts = readFileSync('/proc/self/mountinfo', 'utf8').split('\n');
for (const target of ['/root', '/etc/cop-account-safety', '/var/lib/cop-account-safety'])
  assert.ok(mounts.some(line => line.split(' ')[4] === target && line.includes(' - tmpfs ')), 'owned tmpfs required');
const directory = '/root/cop-root-fixture-' + process.pid;
mkdirSync(directory, { mode: 0o700 });
let fixtureKeys, fixturePair;
function file(name, value = '{"ok":true}\n', mode = 0o600) {
  const path = directory + '/' + name; writeFileSync(path, value, { mode }); return path;
}
test('Root file custody accepts private file and rejects public secret, symlink and hard link', () => {
  const path = file('record');
  assert.equal(readRootFile(path, { secret: true }).toString(), '{"ok":true}\n');
  chmodSync(path, 0o644); assert.throws(() => readRootFile(path, { secret: true }), /GUARD_FILE_CUSTODY/);
  assert.equal(readRootFile(path).toString(), '{"ok":true}\n');
  symlinkSync(path, directory + '/link'); assert.throws(() => readRootFile(directory + '/link'));
  linkSync(path, directory + '/hard'); assert.throws(() => readRootFile(path), /GUARD_FILE_CUSTODY/);
});
test('Root parent custody rejects writable ancestor and private directory disclosure', () => {
  const parent = directory + '/parent'; mkdirSync(parent, { mode: 0o700 });
  const path = parent + '/record'; writeFileSync(path, 'x', { mode: 0o600 });
  chmodSync(parent, 0o722); assert.throws(() => readRootFile(path), /GUARD_PARENT_CUSTODY/);
  chmodSync(parent, 0o755); assert.throws(() => requireRootDirectory(parent, { secret: true }), /GUARD_PARENT_CUSTODY/);
  assert.throws(() => readRootFile(parent + '/../record'), /GUARD_PATH/);
});
test('privileged dependency tree rejects symlinks, writable files and oversized tree', () => {
  const tree = directory + '/code'; mkdirSync(tree, { mode: 0o755 });
  const path = tree + '/module.mjs'; writeFileSync(path, 'export {};', { mode: 0o644 });
  requireRootCodeTree(tree);
  assert.throws(() => requireRootCodeTree(tree, 0), /GUARD_CODE_TREE_SIZE/);
  chmodSync(path, 0o666); assert.throws(() => requireRootCodeTree(tree), /GUARD_CODE_CUSTODY/);
  chmodSync(path, 0o644); symlinkSync(path, tree + '/alias');
  assert.throws(() => requireRootCodeTree(tree), /GUARD_CODE_CUSTODY/);
});
test('durable Root dispatch is immutable for the original operation and digest', async () => {
  const path = directory + '/dispatch'; mkdirSync(path, { mode: 0o700 });
  const dispatch = new RootDispatchFiles(path), op = { operationId: randomUUID(), bodyDigest: 'a'.repeat(64) };
  assert.equal(await dispatch.exists(op), false);
  assert.equal(await dispatch.claim(op), true); assert.equal(await dispatch.claim(op), false);
  assert.equal(await dispatch.exists(op), true);
  await assert.rejects(dispatch.exists({ ...op, bodyDigest: 'b'.repeat(64) }), /GUARD_DISPATCH_UNKNOWN/);
  await assert.rejects(dispatch.claim({ ...op, bodyDigest: 'b'.repeat(64) }), /GUARD_DISPATCH_BINDING/);
  chmodSync(path, 0o755); await assert.rejects(dispatch.claim({ operationId: randomUUID() }), /GUARD_PARENT_CUSTODY/);
});
test('Root scalar persists across producer objects and cannot change its count or binding', async () => {
  const path = directory + '/scalar'; mkdirSync(path, { mode: 0o700 });
  const op = { operationId: randomUUID(), kind: 'revoke', bodyDigest: 'a'.repeat(64) };
  const first = new RootDispatchFiles(path); assert.equal(await first.readRevokeEffect(op), null);
  await first.recordRevokeEffect(op, { deletedBatchCount: 7 });
  const next = new RootDispatchFiles(path); assert.deepEqual(await next.readRevokeEffect(op), { deletedBatchCount: 7 });
  await next.recordRevokeEffect(op, { deletedBatchCount: 7 });
  await assert.rejects(next.recordRevokeEffect(op, { deletedBatchCount: 0 }), /GUARD_REVOKE_EFFECT_CHANGED/);
  await assert.rejects(next.readRevokeEffect({ ...op, bodyDigest: 'b'.repeat(64) }), /GUARD_REVOKE_EFFECT_BINDING/);
  await assert.rejects(next.recordRevokeEffect({ ...op, operationId: randomUUID() }, { deletedBatchCount: -1 }), /GUARD_REVOKE_EFFECT/);
});
test('Root outcome writes and actually signs two separately typed original-operation records', () => {
  const etc = '/etc/cop-account-safety/public', state = '/var/lib/cop-account-safety';
  mkdirSync(etc, { recursive: true, mode: 0o755 });
  mkdirSync(state + '/authority', { recursive: true, mode: 0o700 });
  mkdirSync(state + '/outcomes', { mode: 0o700 });
  const pair = generateKeyPairSync('ed25519');
  const keys = { contractVersion: 'cop-root-verification-keys-v1',
    keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'owned-root-test' }] };
  fixtureKeys = keys; fixturePair = pair;
  writeFileSync(etc + '/verification-keys.json', canonical(keys) + '\n', { mode: 0o644, flag: 'wx' });
  writeFileSync(state + '/authority/signing-key.pkcs8', pair.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' });
  const op = { operationId: randomUUID(), permitId: randomUUID(), storeIncarnation: randomUUID(), kind: 'revoke',
    bodyDigest: 'a'.repeat(64), schemaDigest: 'b'.repeat(64) };
  const permit = { digest: 'c'.repeat(64) };
  for (const originState of ['origin-commit-known', 'origin-no-effects-closed']) {
    const result = publishRootOutcome(op, { operationId: op.operationId, state: originState,
      ...(originState === 'origin-commit-known' ? { revokeEffect: { deletedBatchCount: 3 } } : {}) }, permit);
    for (const [field, kind] of [['sqlOutcomeRef', 'driver-sql-outcome'], ['effectQuiescenceRef', 'driver-effect-quiescence']]) {
      const bytes = readRootFile(state + '/outcomes/' + result[field].recordId + '.json', { secret: true });
      const record = verifyRootRecord(bytes, keys, kind);
      assert.equal(record.digest, result[field].digest); assert.equal(record.payload.originId, op.operationId);
      assert.equal(record.payload.originState, originState); assert.equal(record.payload.originalPermitDigest, permit.digest);
      assert.equal(record.payload.bodyDigest, op.bodyDigest); assert.equal(record.payload.storeIncarnation, op.storeIncarnation);
      assert.deepEqual(record.payload.revokeEffect, originState === 'origin-commit-known' ? { deletedBatchCount: 3 } : undefined);
    }
    assert.notEqual(result.sqlOutcomeRef.recordId, result.effectQuiescenceRef.recordId);
  }
  assert.throws(() => publishRootOutcome(op, { operationId: op.operationId, state: 'pending' }, permit), /GUARD_OUTCOME_UNRESOLVED/);
  assert.throws(() => publishRootOutcome(op, { operationId: randomUUID(), state: 'origin-commit-known' }, permit), /GUARD_OUTCOME_UNRESOLVED/);
  assert.throws(() => publishRootOutcome(op, { operationId: op.operationId, state: 'origin-no-effects-closed',
    revokeEffect: { deletedBatchCount: 0 } }, permit), /GUARD_REVOKE_EFFECT/);
});
function authorityFixture() {
  const state = '/var/lib/cop-account-safety', now = Date.now();
  for (const name of ['operations', 'evidence']) mkdirSync(state + '/' + name, { recursive: true, mode: 0o700 });
  const issue = (kind, extra, recordId = randomUUID()) => ({ contractVersion: 'cop-root-record-v1', kind, recordId,
    issuedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 29_000).toISOString(), ...extra });
  const save = (path, payload) => {
    const bytes = canonical({ keyId: fixtureKeys.keys[0].kid, payload,
      signature: sign(null, Buffer.from(canonical(payload)), fixturePair.privateKey).toString('base64url') }) + '\n';
    writeFileSync(path, bytes, { mode: 0o600 }); return verifyRootRecord(Buffer.from(bytes), fixtureKeys, payload.kind);
  };
  const operation = { contractVersion: 'cop-driver-origin-v1', operationId: randomUUID(), storeIncarnation: randomUUID(),
    permitId: randomUUID(), kind: 'expire', bodyDigest: 'a'.repeat(64), schemaDigest: 'b'.repeat(64),
    cutoff: new Date(now - 86_400_000).toISOString() };
  const context = { guardStoreId: randomUUID(), continuityEpoch: randomUUID(), datasetBindingId: randomUUID(),
    runtimeBindingId: randomUUID(), storeIncarnation: operation.storeIncarnation, operationId: operation.operationId,
    bodyDigest: operation.bodyDigest, schemaDigest: operation.schemaDigest };
  const evidence = {};
  const decisions = { 'identity-ownership': 'cop-jizda-owned', 'retention-decision': 'remove-expired-entire-cop-namespace',
    'report-protection': 'unprotected-entire-cop-namespace', 'operation-schema': 'exact-guarded-plan-verified' };
  for (const [kind, decision] of Object.entries(decisions)) {
    const payload = issue(kind, { ...context, scope: 'cop_jizda_preserve_shared_identity_sim', decision });
    const record = save(state + '/evidence/' + payload.recordId + '.json', payload);
    evidence[kind] = { recordId: payload.recordId, digest: record.digest };
  }
  const permitPath = state + '/operations/' + operation.operationId + '.json';
  const permit = issue('driver-origin-permit', { operation, guardStoreId: context.guardStoreId,
    continuityEpoch: context.continuityEpoch, datasetBindingId: context.datasetBindingId, runtimeBindingId: context.runtimeBindingId,
    sourceProofId: randomUUID(), policyGeneration: 1, frontierSequence: 0, frontierDigest: 'c'.repeat(64), evidence }, operation.permitId);
  save(permitPath, permit);
  const anchorPath = state + '/authority/current-frontier.json';
  const anchor = issue('current-frontier', { guardStoreId: context.guardStoreId, continuityEpoch: context.continuityEpoch,
    sequence: 0, digest: permit.frontierDigest, machineBootId: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
    clusterId: '123456789', timelineId: 1 });
  save(anchorPath, anchor);
  const row = { identity: { application_id: 'cop', guard_contract_version: 'cop-account-safety-runtime-v1',
    stream_scope_id: 'cop-global-fences-v1', guard_store_id: context.guardStoreId },
    policy: { policy_id: 'cop-jizda-only-sim-preserved-v1', policy_generation: 1, continuity_epoch: context.continuityEpoch },
    dataset: { projection_contract_id: 'cop-sim-driver-projection-v1', continuity_epoch: context.continuityEpoch,
      target_incarnation_id: operation.storeIncarnation },
    runtime: { dataset_binding_id: context.datasetBindingId, policy_generation: 1 },
    proof: { binding_id: context.runtimeBindingId, frontier_sequence: 0, frontier_digest: permit.frontierDigest },
    frontier_sequence: '0', frontier_digest: permit.frontierDigest, cluster_id: anchor.clusterId,
    timeline_id: anchor.timelineId, proof_current: true };
  let calls = 0;
  // Deliberately synthetic metadata rows. This is a verifier unit test, not a
  // production SQL, independently owned current anchor or enrollment proof.
  const metadata = { async query(sql, args) {
    calls++; assert.ok(sql.includes('pg_control_checkpoint()'));
    assert.deepEqual(args, [context.datasetBindingId, context.runtimeBindingId, permit.sourceProofId]);
    return { rows: [row] };
  } };
  return { operation, row, permit, permitPath, anchor, anchorPath, save,
    authority: new RootDriverAuthority(metadata, operation.operationId), calls: () => calls };
}
test('Root verifier checks signed evidence and current binding against metadata observations', async () => {
  const f = authorityFixture(); await f.authority.validate(f.operation, 'work'); assert.equal(f.calls(), 1);
  f.row.frontier_digest = 'd'.repeat(64);
  await assert.rejects(f.authority.validate(f.operation, 'work'), /GUARD_REGISTRY_FRONTIER_MISMATCH/);
});
test('expired runtime freshness permits original resolution but never fresh work', async () => {
  const f = authorityFixture(); f.row.proof_current = false;
  await assert.rejects(f.authority.validate(f.operation, 'work'), /GUARD_ORIGIN_NOT_CURRENT/);
  await f.authority.validate(f.operation, 'probe');
});
test('reboot or database timeline mismatch holds even an original resolution', async () => {
  const f = authorityFixture();
  f.save(f.anchorPath, { ...f.anchor, machineBootId: randomUUID() });
  await assert.rejects(f.authority.validate(f.operation, 'probe'), /GUARD_FRONTIER_BINDING/); assert.equal(f.calls(), 0);
  f.save(f.anchorPath, f.anchor); f.row.timeline_id = 2;
  await assert.rejects(f.authority.validate(f.operation, 'probe'), /GUARD_REGISTRY_FRONTIER_MISMATCH/);
});
test('Root permit cannot be replaced or retargeted between admission and SQL', async () => {
  const f = authorityFixture();
  await assert.rejects(f.authority.validate({ ...f.operation, storeIncarnation: randomUUID() }, 'work'), /GUARD_PERMIT_BINDING/);
  f.save(f.permitPath, { ...f.permit, frontierDigest: 'd'.repeat(64) });
  await assert.rejects(f.authority.validate(f.operation, 'probe'), /GUARD_PERMIT_CHANGED/); assert.equal(f.calls(), 0);
});
after(() => rmSync(directory, { recursive: true, force: true }));
