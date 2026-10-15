import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, exact, hex, uuid, sha256, readRootFile, verifyRootRecord, requireGuard } from './root-records.mjs';
import { issueRootRecord, storeRootRecord } from './root-record-issuer.mjs';

const STATE = '/var/lib/cop-account-safety';
const OWNERS = ['keycloak', 'cop_sessions_profiles', 'cop_devices', 'messaging_matrix', 'voice_livekit',
  'cop_content_media', 'mobility_dispatch', 'sim_measurements', 'ai_router', 'moderation_audit', 'backup_restore'];
const LOCK = 'SELECT pg_advisory_xact_lock(hashtext(current_database()),904214)';
const IDENTITY = `SELECT row_to_json(i) AS identity,row_to_json(p) AS policy,
 (SELECT system_identifier::text FROM pg_control_system()) AS cluster_id,
 (SELECT timeline_id FROM pg_control_checkpoint()) AS timeline_id
 FROM cop_guard.guard_identity i JOIN cop_guard.policies p ON p.guard_store_id=i.guard_store_id
 AND p.policy_generation=(SELECT max(policy_generation) FROM cop_guard.policies) WHERE i.singleton`;
const ROWS = `SELECT sequence::text,guard_store_id,policy_generation::text,continuity_epoch,fence_operation_id,
 previous_digest,entry_digest,coverage_manifest_ref FROM cop_guard.fence_journal ORDER BY sequence LIMIT 100001`;
const HEAD = `SELECT sequence::text,entry_digest FROM cop_guard.fence_journal ORDER BY sequence DESC LIMIT 1`;
const INSERT = `INSERT INTO cop_guard.fence_journal(sequence,guard_store_id,policy_generation,continuity_epoch,
 fence_operation_id,previous_digest,entry_digest,coverage_manifest_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`;

export function validateFenceEntry(entry, binding) {
  requireGuard(exact(entry, ['contractVersion', 'applicationStoreId', 'configurationFingerprint', 'accountKey', 'job']) &&
    entry.contractVersion === 'cop-erasure-fence-entry-v1' && entry.applicationStoreId === binding.applicationStoreId &&
    entry.configurationFingerprint === binding.configurationFingerprint && hex(entry.accountKey), 'GUARD_FENCE_ENTRY');
  const j = entry.job;
  requireGuard(exact(j, ['operationId', 'requestedAt', 'required', 'checkpoints']) && uuid(j.operationId) &&
    typeof j.requestedAt === 'string' && Number.isFinite(Date.parse(j.requestedAt)) && new Date(j.requestedAt).toISOString() === j.requestedAt &&
    Array.isArray(j.required) && j.required.length === OWNERS.length && new Set(j.required).size === OWNERS.length &&
    OWNERS.every(o => j.required.includes(o)) && exact(j.checkpoints, []), 'GUARD_FENCE_JOB');
  requireGuard(Buffer.byteLength(canonical(entry)) <= 12_000, 'GUARD_FENCE_SIZE');
  return entry;
}
export function fenceRowDigest(row) {
  return sha256(canonical({ sequence: Number(row.sequence), guardStoreId: row.guard_store_id,
    policyGeneration: Number(row.policy_generation), continuityEpoch: row.continuity_epoch,
    operationId: row.fence_operation_id, previousDigest: row.previous_digest, manifestRef: row.coverage_manifest_ref }));
}
/** Ordered independent SQL journal, with a Root-signed immutable recovery
 * identity-free recovery manifest durable before INSERT. The account MAC stays
 * pseudonymous; no encrypted principal is retained in this permanent journal.
 * This class never receives a signing callback.
 * The application can neither select its credential nor choose a journal path. */
export class RootFenceJournal {
  constructor(metadata, keys, registration) {
    requireGuard(process.getuid?.() === 0 && process.geteuid?.() === 0, 'ROOT_EXECUTION_REQUIRED');
    requireGuard(uuid(registration.applicationStoreId) && uuid(registration.protectedConfigId) && hex(registration.configurationFingerprint) &&
      uuid(registration.guardStoreId) && uuid(registration.continuityEpoch), 'GUARD_COP_REGISTRATION');
    this.metadata = metadata; this.keys = keys; this.registration = registration;
  }
  manifest(row) {
    requireGuard(typeof row.coverage_manifest_ref === 'string' && /^[0-9a-f-]{36}:[0-9a-f]{64}$/.test(row.coverage_manifest_ref), 'GUARD_MANIFEST_REFERENCE');
    const [id, digest] = row.coverage_manifest_ref.split(':'); requireGuard(uuid(id), 'GUARD_MANIFEST_REFERENCE');
    const record = verifyRootRecord(readRootFile(join(STATE, 'fence-manifests', id + '.json'), { secret: true }),
      this.keys, 'cop-fence-manifest', { historical: true });
    const p = record.payload;
    requireGuard(exact(p, ['contractVersion', 'kind', 'recordId', 'issuedAt', 'expiresAt', 'guardStoreId',
      'continuityEpoch', 'policyGeneration', 'entry']) && p.recordId === row.fence_operation_id && id === p.recordId && record.digest === digest &&
      p.guardStoreId === row.guard_store_id && p.continuityEpoch === row.continuity_epoch &&
      String(p.policyGeneration) === row.policy_generation, 'GUARD_MANIFEST_BINDING');
    validateFenceEntry(p.entry, this.registration);
    requireGuard(p.entry.job.operationId === row.fence_operation_id, 'GUARD_MANIFEST_BINDING');
    return p.entry;
  }
  async locked(run) {
    await this.metadata.query('BEGIN');
    try {
      await this.metadata.query("SET LOCAL statement_timeout='10s'"); await this.metadata.query(LOCK);
      const result = await run(); await this.metadata.query('COMMIT'); return result;
    } catch (error) { try { await this.metadata.query('ROLLBACK'); } catch { /* Original uncertainty remains fenced. */ } throw error; }
  }
  async observe() {
    const observed = await this.metadata.query(IDENTITY); requireGuard(observed.rows.length === 1, 'GUARD_REGISTRY_UNAVAILABLE');
    const r = observed.rows[0], registration = this.registration;
    requireGuard(r.identity.application_id === 'cop' && r.identity.guard_contract_version === 'cop-account-safety-runtime-v1' &&
      r.identity.stream_scope_id === 'cop-global-fences-v1' && r.identity.guard_store_id === registration.guardStoreId &&
      r.policy.policy_id === 'cop-jizda-only-sim-preserved-v1' && r.policy.continuity_epoch === registration.continuityEpoch &&
      r.policy.protected_config_id === registration.protectedConfigId && hex(r.identity.initial_prefix_digest) &&
      Number.isSafeInteger(Number(r.policy.policy_generation)) && Number(r.policy.policy_generation) >= 1, 'GUARD_COP_POLICY');
    const anchor = verifyRootRecord(readRootFile(join(STATE, 'authority', 'current-frontier.json'), { secret: true }),
      this.keys, 'current-frontier', { historical: true }).payload;
    requireGuard(anchor.guardStoreId === registration.guardStoreId && anchor.continuityEpoch === registration.continuityEpoch &&
      anchor.machineBootId === readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() && anchor.clusterId === r.cluster_id &&
      anchor.timelineId === r.timeline_id && Number.isSafeInteger(anchor.sequence) && anchor.sequence >= 0 && hex(anchor.digest), 'GUARD_CONTINUITY_ANCHOR');
    const rows = (await this.metadata.query(ROWS)).rows;
    requireGuard(rows.length <= 100_000, 'GUARD_JOURNAL_BOUND');
    let previous = r.identity.initial_prefix_digest, sequence = 0;
    const entries = [], accounts = new Set(), operations = new Set();
    if (anchor.sequence === 0) requireGuard(anchor.digest === previous, 'GUARD_JOURNAL_ROLLBACK');
    for (const row of rows) {
      requireGuard(Number(row.sequence) === ++sequence && Number.isSafeInteger(sequence) && row.previous_digest === previous &&
        row.guard_store_id === registration.guardStoreId && row.continuity_epoch === registration.continuityEpoch &&
        hex(row.entry_digest) && fenceRowDigest(row) === row.entry_digest, 'GUARD_JOURNAL_CHAIN');
      const entry = this.manifest(row);
      requireGuard(!accounts.has(entry.accountKey) && !operations.has(entry.job.operationId), 'GUARD_JOURNAL_DUPLICATE');
      accounts.add(entry.accountKey); operations.add(entry.job.operationId); entries.push(entry); previous = row.entry_digest;
      if (anchor.sequence === sequence) requireGuard(anchor.digest === previous, 'GUARD_JOURNAL_ROLLBACK');
    }
    requireGuard(sequence >= anchor.sequence, 'GUARD_JOURNAL_ROLLBACK');
    return { r, entries, frontier: { sequence, digest: previous } };
  }
  async assertCurrent(frontier) {
    requireGuard(exact(frontier, ['sequence', 'digest']) && Number.isSafeInteger(frontier.sequence) && frontier.sequence >= 0 && hex(frontier.digest), 'GUARD_CONTINUITY_FRONTIER');
    return this.locked(async () => {
      const observed = await this.metadata.query(IDENTITY); requireGuard(observed.rows.length === 1, 'GUARD_REGISTRY_UNAVAILABLE');
      const r = observed.rows[0], registration = this.registration;
      const anchor = verifyRootRecord(readRootFile(join(STATE, 'authority', 'current-frontier.json'), { secret: true }),
        this.keys, 'current-frontier', { historical: true }).payload;
      const row = (await this.metadata.query(HEAD)).rows[0];
      const actual = { sequence: row ? Number(row.sequence) : 0, digest: row?.entry_digest ?? r.identity.initial_prefix_digest };
      requireGuard(canonical(actual) === canonical(frontier) && anchor.sequence === actual.sequence && anchor.digest === actual.digest &&
        r.identity.guard_store_id === registration.guardStoreId && r.identity.application_id === 'cop' &&
        r.identity.guard_contract_version === 'cop-account-safety-runtime-v1' && r.identity.stream_scope_id === 'cop-global-fences-v1' &&
        r.policy.policy_id === 'cop-jizda-only-sim-preserved-v1' && r.policy.continuity_epoch === registration.continuityEpoch &&
        r.policy.protected_config_id === registration.protectedConfigId &&
        anchor.guardStoreId === registration.guardStoreId && anchor.continuityEpoch === registration.continuityEpoch &&
        anchor.machineBootId === readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() &&
        anchor.clusterId === r.cluster_id && anchor.timelineId === r.timeline_id, 'GUARD_CONTINUITY_STALE');
      return { r, frontier: actual };
    });
  }
  async page(cursor, frontier) {
    if (cursor === 0 && frontier === null) {
      const replay = await this.snapshot();
      return { applicationStoreId: replay.applicationStoreId, configurationFingerprint: replay.configurationFingerprint,
        frontier: replay.frontier, entry: replay.entries[0] ?? null, nextCursor: replay.entries.length ? 1 : null };
    }
    await this.assertCurrent(frontier);
    requireGuard(Number.isSafeInteger(cursor) && cursor >= 0 && cursor <= frontier.sequence, 'GUARD_CONTINUITY_PAGE');
    const response = await this.metadata.query(`SELECT sequence::text,guard_store_id,policy_generation::text,continuity_epoch,
      fence_operation_id,previous_digest,entry_digest,coverage_manifest_ref FROM cop_guard.fence_journal WHERE sequence=$1`, [cursor + 1]);
    requireGuard(response.rows.length === (cursor < frontier.sequence ? 1 : 0), 'GUARD_CONTINUITY_PAGE');
    const entry = response.rows.length ? this.manifest(response.rows[0]) : null;
    await this.assertCurrent(frontier);
    return { applicationStoreId: this.registration.applicationStoreId, configurationFingerprint: this.registration.configurationFingerprint,
      frontier, entry, nextCursor: entry ? cursor + 1 : null };
  }
  refresh(observed) {
    const { r, frontier } = observed;
    const current = verifyRootRecord(readRootFile(join(STATE, 'authority', 'current-frontier.json'), { secret: true }),
      this.keys, 'current-frontier', { historical: true }).payload;
    if (current.sequence === frontier.sequence && current.digest === frontier.digest &&
        current.guardStoreId === this.registration.guardStoreId && current.continuityEpoch === this.registration.continuityEpoch &&
        current.clusterId === r.cluster_id && current.timelineId === r.timeline_id &&
        current.machineBootId === readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() &&
        Date.parse(current.expiresAt) - Date.now() > 10_000) return;
    const record = issueRootRecord('current-frontier', { guardStoreId: this.registration.guardStoreId,
      continuityEpoch: this.registration.continuityEpoch, ...frontier,
      machineBootId: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), clusterId: r.cluster_id, timelineId: r.timeline_id },
    { expectedKeyringDigest: sha256(canonical(this.keys) + '\n') });
    storeRootRecord(join(STATE, 'authority', 'current-frontier.json'), record.bytes, { replace: true });
  }
  async snapshot() {
    // Fresh locked read after COMMIT: an inner row read alone isn't acceptance.
    await this.locked(() => this.observe());
    const observed = await this.locked(() => this.observe()); this.refresh(observed);
    return { contractVersion: 'cop-erasure-replay-v1', applicationStoreId: this.registration.applicationStoreId,
      configurationFingerprint: this.registration.configurationFingerprint, frontier: observed.frontier, entries: observed.entries };
  }
  async publishFence(candidate) {
    validateFenceEntry(candidate, this.registration);
    await this.locked(async () => {
      const observed = await this.observe(), existing = observed.entries.find(e => e.accountKey === candidate.accountKey);
      if (existing) { requireGuard(existing.job.operationId === candidate.job.operationId, 'GUARD_FENCE_CONFLICT'); return; }
      const path = join(STATE, 'fence-manifests', candidate.job.operationId + '.json');
      let record;
      try { record = verifyRootRecord(readRootFile(path, { secret: true }), this.keys, 'cop-fence-manifest', { historical: true }); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const issued = issueRootRecord('cop-fence-manifest', { guardStoreId: this.registration.guardStoreId,
          continuityEpoch: this.registration.continuityEpoch, policyGeneration: Number(observed.r.policy.policy_generation), entry: candidate },
        { recordId: candidate.job.operationId, expectedKeyringDigest: sha256(canonical(this.keys) + '\n') });
        storeRootRecord(path, issued.bytes); record = { payload: issued.payload, digest: issued.digest };
      }
      validateFenceEntry(record.payload.entry, this.registration);
      requireGuard(record.payload.entry.accountKey === candidate.accountKey && record.payload.entry.job.operationId === candidate.job.operationId &&
        record.payload.guardStoreId === this.registration.guardStoreId && record.payload.continuityEpoch === this.registration.continuityEpoch &&
        record.payload.policyGeneration === Number(observed.r.policy.policy_generation), 'GUARD_FENCE_CONFLICT');
      const row = { sequence: String(observed.frontier.sequence + 1), guard_store_id: this.registration.guardStoreId,
        policy_generation: String(record.payload.policyGeneration), continuity_epoch: this.registration.continuityEpoch,
        fence_operation_id: candidate.job.operationId, previous_digest: observed.frontier.digest,
        coverage_manifest_ref: candidate.job.operationId + ':' + record.digest };
      await this.metadata.query(INSERT, [row.sequence, row.guard_store_id, row.policy_generation, row.continuity_epoch,
        row.fence_operation_id, row.previous_digest, fenceRowDigest(row), row.coverage_manifest_ref]);
    });
    const observed = await this.snapshot(), entry = observed.entries.find(e => e.accountKey === candidate.accountKey);
    requireGuard(entry?.job.operationId === candidate.job.operationId, 'GUARD_FENCE_READBACK');
    return { frontier: observed.frontier, entry };
  }
}
