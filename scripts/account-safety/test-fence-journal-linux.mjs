import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, chownSync } from 'node:fs';
import { canonical, sha256 } from '/opt/cop-account-safety/root-records.mjs';
import { issueRootRecord, storeRootRecord } from '/opt/cop-account-safety/root-record-issuer.mjs';
import { RootFenceJournal } from '/opt/cop-account-safety/root-fence-journal.mjs';

assert.equal(process.env.COP_OWNED_FENCE_FIXTURE, '1'); assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 0);
assert.equal(readFileSync('/proc/self/mountinfo', 'utf8').split('\n').some(l => l.split(' ')[4] === '/fixture/state' && l.includes(' - tmpfs ')), true);
const state = '/var/lib/cop-account-safety', etc = '/etc/cop-account-safety/public';
for (const path of ['/fixture/state/data', '/fixture/state/socket']) { mkdirSync(path, { recursive: true, mode: 0o700 }); chownSync(path, 70, 70); }
for (const path of [state + '/authority', state + '/fence-manifests']) mkdirSync(path, { recursive: true, mode: 0o700 });
mkdirSync(etc, { recursive: true, mode: 0o755 });
const pair = generateKeyPairSync('ed25519'), keys = { contractVersion: 'cop-root-verification-keys-v1',
  keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'owned-fence-fixture' }] };
writeFileSync(etc + '/verification-keys.json', canonical(keys) + '\n', { mode: 0o644, flag: 'wx' });
writeFileSync(state + '/authority/signing-key.pkcs8', pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
const runPg = ([command, ...args]) => execFileSync(command, args, { uid: 70, gid: 70, cwd: '/fixture/state',
  stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, LANG: 'C.UTF-8' } });
runPg(['initdb', '-D', '/fixture/state/data', '--username=synthetic_admin', '--auth-local=trust', '--auth-host=reject', '--encoding=UTF8', '--locale=C']);
runPg(['pg_ctl', '-D', '/fixture/state/data', '-l', '/fixture/state/data/pg.log', '-o',
  "-k /fixture/state/socket -c listen_addresses='' -c unix_socket_permissions=0700 -c log_statement=none -c log_min_error_statement=panic", '-w', 'start']);
const require = createRequire('/opt/cop-account-safety/package.json'), { Client } = require('pg');
const clients = [], checks = [];
async function connection(user, database = 'cop_account_safety_guard') {
  const c = new Client({ host: '/fixture/state/socket', user, database, query_timeout: 5000 }); c.on('error', () => {});
  clients.push(c); await c.connect(); return c;
}
const registration = { applicationStoreId: randomUUID(), protectedConfigId: randomUUID(), configurationFingerprint: 'a'.repeat(64),
  guardStoreId: randomUUID(), continuityEpoch: randomUUID() };
let admin, target, journal;
const entry = accountKey => ({ contractVersion: 'cop-erasure-fence-entry-v1', applicationStoreId: registration.applicationStoreId,
  configurationFingerprint: registration.configurationFingerprint, accountKey,
  job: { operationId: randomUUID(), requestedAt: new Date().toISOString(), required: ['keycloak', 'cop_sessions_profiles', 'cop_devices',
    'messaging_matrix', 'voice_livekit', 'cop_content_media', 'mobility_dispatch', 'sim_measurements', 'ai_router', 'moderation_audit', 'backup_restore'],
  checkpoints: {} } });
const check = async (name, fn) => { await fn(); checks.push({ name, passed: true }); console.log('PASS ' + name); };
try {
  const bootstrap = await connection('synthetic_admin', 'postgres'); await bootstrap.query('CREATE DATABASE cop_account_safety_guard');
  admin = await connection('synthetic_admin'); await admin.query(readFileSync('/fixture/foundation.sql', 'utf8'));
  await admin.query(`GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system(),pg_catalog.pg_control_checkpoint() TO cop_guard_journal_writer;
    CREATE ROLE synthetic_journal LOGIN NOINHERIT; GRANT cop_guard_journal_writer TO synthetic_journal`);
  await admin.query(`INSERT INTO cop_guard.guard_identity(singleton,guard_store_id,application_id,guard_contract_version,stream_scope_id,initial_prefix_digest,enrollment_evidence_ref)
    VALUES(true,$1,'cop','cop-account-safety-runtime-v1','cop-global-fences-v1',$2,'fixture-enrollment')`, [registration.guardStoreId, '0'.repeat(64)]);
  await admin.query(`INSERT INTO cop_guard.policies VALUES(1,NULL,$1,'cop-jizda-only-sim-preserved-v1',$2,$3,'fixture-admission',$4,'fixture-policy',clock_timestamp())`,
  [registration.guardStoreId, 'b'.repeat(64), registration.protectedConfigId, registration.continuityEpoch]);
  const system = (await admin.query('SELECT system_identifier::text AS cluster_id FROM pg_control_system()')).rows[0];
  const timeline = (await admin.query('SELECT timeline_id FROM pg_control_checkpoint()')).rows[0].timeline_id;
  const anchor = issueRootRecord('current-frontier', { guardStoreId: registration.guardStoreId, continuityEpoch: registration.continuityEpoch,
    sequence: 0, digest: '0'.repeat(64), machineBootId: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), clusterId: system.cluster_id, timelineId: timeline });
  storeRootRecord(state + '/authority/current-frontier.json', anchor.bytes);
  target = await connection('synthetic_journal'); await target.query('SET ROLE cop_guard_journal_writer'); journal = new RootFenceJournal(target, keys, registration);
  await check('empty actual Root journal matches signed actual cluster and boot', async () => {
    assert.deepEqual((await journal.snapshot()).frontier, { sequence: 0, digest: '0'.repeat(64) });
  });
  const first = entry('1'.repeat(64));
  await check('Root manifest is durable and signed before actual narrow-role INSERT and fresh readback', async () => {
    const result = await journal.publishFence(first); assert.deepEqual(result.entry, first); assert.equal(result.frontier.sequence, 1);
    const row = (await admin.query('SELECT * FROM cop_guard.fence_journal')).rows[0];
    assert.equal(row.coverage_manifest_ref, first.job.operationId + ':' + sha256(readFileSync(state + '/fence-manifests/' + first.job.operationId + '.json')));
    await journal.assertCurrent(result.frontier);
    await assert.rejects(target.query('DELETE FROM cop_guard.fence_journal'), /permission denied/);
  });
  await check('repeat returns immutable original job, not replacement timestamp or ciphertext', async () => {
    const changed = structuredClone(first); changed.job.requestedAt = '2026-01-01T00:00:00.000Z';
    assert.deepEqual((await journal.publishFence(changed)).entry, first);
    assert.equal(Number((await admin.query('SELECT count(*) FROM cop_guard.fence_journal')).rows[0].count), 1);
  });
  const second = entry('2'.repeat(64));
  await check('discarded actual outer COMMIT acknowledgement recovers original journal entry without replacement', async () => {
    let lost = false;
    const wrapped = { async query(sql, args) { const r = await target.query(sql, args); if (sql === 'COMMIT' && !lost) { lost = true; throw new Error('synthetic discarded COMMIT ACK'); } return r; } };
    await assert.rejects(new RootFenceJournal(wrapped, keys, registration).publishFence(second));
    const recovered = await journal.snapshot(); assert.equal(recovered.frontier.sequence, 2); assert.deepEqual(recovered.entries[1], second);
    assert.deepEqual((await journal.publishFence(second)).entry, second);
  });
  await check('foreign-account reuse of an operation cannot borrow its Root manifest', async () => {
    await assert.rejects(journal.publishFence({ ...first, accountKey: '3'.repeat(64) }), /GUARD_FENCE_CONFLICT/);
  });
  const head = (await admin.query('SELECT * FROM cop_guard.fence_journal WHERE sequence=2')).rows[0];
  await check('older restored SQL frontier is rejected against independent Root frontier', async () => {
    await admin.query('ALTER TABLE cop_guard.fence_journal DISABLE TRIGGER USER; DELETE FROM cop_guard.fence_journal WHERE sequence=2; ALTER TABLE cop_guard.fence_journal ENABLE TRIGGER USER');
    await assert.rejects(journal.snapshot(), /GUARD_JOURNAL_ROLLBACK/);
    await admin.query(`INSERT INTO cop_guard.fence_journal VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, Object.values(head));
    assert.equal((await journal.snapshot()).frontier.sequence, 2);
  });
  await check('same-sequence digest fork is rejected rather than signed as a new frontier', async () => {
    await admin.query("ALTER TABLE cop_guard.fence_journal DISABLE TRIGGER USER; UPDATE cop_guard.fence_journal SET entry_digest=repeat('e',64) WHERE sequence=2; ALTER TABLE cop_guard.fence_journal ENABLE TRIGGER USER");
    await assert.rejects(journal.assertCurrent({ sequence: 2, digest: head.entry_digest }), /GUARD_CONTINUITY_STALE/);
    await assert.rejects(journal.snapshot(), /GUARD_JOURNAL_CHAIN/);
    await admin.query('ALTER TABLE cop_guard.fence_journal DISABLE TRIGGER USER');
    await admin.query('UPDATE cop_guard.fence_journal SET entry_digest=$1 WHERE sequence=2', [head.entry_digest]);
    await admin.query('ALTER TABLE cop_guard.fence_journal ENABLE TRIGGER USER');
  });
  await check('tampered pseudonymous manifest fails actual signature verification', async () => {
    const path = state + '/fence-manifests/' + first.job.operationId + '.json', original = readFileSync(path);
    const changed = JSON.parse(original); changed.payload.entry.accountKey = 'f'.repeat(64); writeFileSync(path, canonical(changed) + '\n');
    await assert.rejects(journal.snapshot(), /GUARD_SIGNATURE_INVALID/); writeFileSync(path, original);
  });
  console.log(JSON.stringify({ contractVersion: 'cop-fence-journal-fixture-v1', postgres: (await admin.query('SHOW server_version')).rows[0].server_version,
    actualRootFiles: true, actualEd25519: true, actualPostgres: true, syntheticEnrollment: true, productionAcceptance: false, checks }));
} finally {
  for (const c of clients) await c.end().catch(() => {});
  runPg(['pg_ctl', '-D', '/fixture/state/data', '-m', 'immediate', '-w', 'stop']);
}
