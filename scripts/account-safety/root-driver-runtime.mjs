import { createRequire } from 'node:module';
import { checkServerIdentity } from 'node:tls';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { requireGuard, exact, hex, uuid, canonical, canonicalJson, readRootFile, requireRootCodeTree, verifyRootRecord } from './root-records.mjs';
import { DriverOriginProducer, RootDispatchFiles, validateOperation } from './driver-origin-producer.mjs';
import { validateRootPublication } from './root-publication.mjs';
import { publishRootOutcome } from './root-outcome-records.mjs';

const ETC = '/etc/cop-account-safety';
const STATE = '/var/lib/cop-account-safety';
const REF_KINDS = ['identity-ownership', 'retention-decision', 'report-protection', 'operation-schema'];
const SQL = `SELECT row_to_json(i) AS identity,row_to_json(p) AS policy,row_to_json(d) AS dataset,
 row_to_json(b) AS runtime,row_to_json(a) AS proof,
 coalesce((SELECT sequence::text FROM cop_guard.fence_journal ORDER BY sequence DESC LIMIT 1),'0') AS frontier_sequence,
 coalesce((SELECT entry_digest FROM cop_guard.fence_journal ORDER BY sequence DESC LIMIT 1),i.initial_prefix_digest) AS frontier_digest,
 (SELECT system_identifier::text FROM pg_control_system()) AS cluster_id,
 (SELECT timeline_id FROM pg_control_checkpoint()) AS timeline_id,
 (a.observed_at<=clock_timestamp() AND a.issued_at<=clock_timestamp() AND a.valid_until>clock_timestamp()) AS proof_current
 FROM cop_guard.guard_identity i
 JOIN cop_guard.policies p ON p.guard_store_id=i.guard_store_id AND
 p.policy_generation=(SELECT max(policy_generation) FROM cop_guard.policies)
 JOIN cop_guard.dataset_bindings d ON d.dataset_binding_id=$1::uuid AND d.guard_store_id=i.guard_store_id
 JOIN cop_guard.runtime_bindings b ON b.binding_id=$2::uuid AND b.dataset_binding_id=d.dataset_binding_id
 JOIN cop_guard.accepted_runtime_proofs a ON a.proof_id=$3::uuid AND a.binding_id=b.binding_id
 WHERE i.singleton AND d.owner_id='sim_driver_measurements' AND b.owner_id=d.owner_id`;

function connectionProfile(name, expectedDatabase, fixedUser) {
  const p = canonicalJson(readRootFile(join(ETC, 'root', name + '.json'), { secret: true }));
  requireGuard(exact(p, ['contractVersion', 'host', 'port', 'database', 'user', 'password', 'serverName', 'caFile']) &&
    p.contractVersion === 'cop-root-postgres-profile-v1' && p.database === expectedDatabase &&
    typeof p.host === 'string' && /^[A-Za-z0-9.-]{1,253}$/.test(p.host) &&
    Number.isSafeInteger(p.port) && p.port > 0 && p.port <= 65535 &&
    typeof p.user === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(p.user) && (!fixedUser || p.user === fixedUser) &&
    typeof p.password === 'string' && p.password.length >= 32 &&
    typeof p.serverName === 'string' && /^[A-Za-z0-9.-]{1,253}$/.test(p.serverName) &&
    p.caFile === join(ETC, 'public', 'postgres-ca.crt'), 'GUARD_DATABASE_PROFILE');
  const ca = readRootFile(p.caFile).toString('utf8');
  return { host: p.host, port: p.port, database: p.database, user: p.user, password: p.password,
    ssl: { ca, rejectUnauthorized: true, servername: p.serverName,
      checkServerIdentity: (_host, certificate) => checkServerIdentity(p.serverName, certificate) },
    connectionTimeoutMillis: 5000, statement_timeout: 10_000, application_name: 'cop-root-driver-origin-v1' };
}
function sharedContext(p, op, permit) {
  return p.guardStoreId === permit.guardStoreId && p.continuityEpoch === permit.continuityEpoch &&
    p.datasetBindingId === permit.datasetBindingId && p.runtimeBindingId === permit.runtimeBindingId &&
    p.storeIncarnation === op.storeIncarnation && p.operationId === op.operationId &&
    p.bodyDigest === op.bodyDigest && p.schemaDigest === op.schemaDigest;
}

/** Real signature, protected-file and live SQL checks. No supplied application
 * callback or environment acceptance bit participates in this factory. The
 * signer/enroller must produce these records from accepted owner evidence;
 * this verifier cannot create or silently refresh them. */
export class RootDriverAuthority {
  constructor(metadata, operationId, registration) {
    requireGuard(process.getuid?.() === 0 && process.geteuid?.() === 0 && uuid(operationId), 'ROOT_EXECUTION_REQUIRED');
    this.metadata = metadata; this.operationId = operationId; this.registration = registration;
    this.keys = canonicalJson(readRootFile(join(ETC, 'public', 'verification-keys.json')));
    const record = verifyRootRecord(readRootFile(join(STATE, 'operations', operationId + '.json'), { secret: true }),
      this.keys, 'driver-origin-permit', { historical: true });
    this.permitRecord = record; this.permit = record.payload;
    requireGuard(exact(this.permit, ['contractVersion', 'kind', 'recordId', 'issuedAt', 'expiresAt', 'operation',
      'guardStoreId', 'continuityEpoch', 'datasetBindingId', 'runtimeBindingId', 'sourceProofId', 'policyGeneration',
      'frontierSequence', 'frontierDigest', 'evidence']) && this.permit.recordId === this.permit.operation.permitId &&
      this.permit.operation.operationId === operationId && uuid(this.permit.guardStoreId) && uuid(this.permit.continuityEpoch) &&
      uuid(this.permit.datasetBindingId) && uuid(this.permit.runtimeBindingId) && uuid(this.permit.sourceProofId) &&
      Number.isSafeInteger(this.permit.policyGeneration) && this.permit.policyGeneration >= 1 &&
      Number.isSafeInteger(this.permit.frontierSequence) && this.permit.frontierSequence >= 0 && hex(this.permit.frontierDigest) &&
      exact(this.permit.evidence, REF_KINDS), 'GUARD_PERMIT_BINDING');
    this.operation = validateOperation(this.permit.operation);
  }
  async validate(operation, mode) {
    requireGuard(canonical(operation) === canonical(this.operation) && ['work', 'probe'].includes(mode), 'GUARD_PERMIT_BINDING');
    const historical = mode === 'probe';
    const currentPermit = verifyRootRecord(readRootFile(join(STATE, 'operations', this.operationId + '.json'), { secret: true }),
      this.keys, 'driver-origin-permit', { historical });
    requireGuard(currentPermit.digest === this.permitRecord.digest, 'GUARD_PERMIT_CHANGED');
    const anchor = verifyRootRecord(readRootFile(join(STATE, 'authority', 'current-frontier.json'), { secret: true }),
      this.keys, 'current-frontier');
    requireGuard(exact(anchor.payload, ['contractVersion', 'kind', 'recordId', 'issuedAt', 'expiresAt',
      'guardStoreId', 'continuityEpoch', 'sequence', 'digest', 'machineBootId', 'clusterId', 'timelineId']) && anchor.payload.guardStoreId === this.permit.guardStoreId &&
      anchor.payload.continuityEpoch === this.permit.continuityEpoch && Number.isSafeInteger(anchor.payload.sequence) &&
      anchor.payload.sequence >= 0 && hex(anchor.payload.digest) && uuid(anchor.payload.machineBootId) &&
      anchor.payload.machineBootId === readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() &&
      typeof anchor.payload.clusterId === 'string' && /^[0-9]{1,20}$/.test(anchor.payload.clusterId) &&
      Number.isSafeInteger(anchor.payload.timelineId) && anchor.payload.timelineId > 0 &&
      Date.parse(anchor.payload.expiresAt) - Date.parse(anchor.payload.issuedAt) <= 30_000, 'GUARD_FRONTIER_BINDING');
    const response = await this.metadata.query(SQL, [this.permit.datasetBindingId, this.permit.runtimeBindingId, this.permit.sourceProofId]);
    requireGuard(response.rows.length === 1, 'GUARD_REGISTRY_UNAVAILABLE');
    const r = response.rows[0];
    if (this.registration) requireGuard(r.runtime.image_id === this.registration.imageId &&
      r.runtime.source_revision === this.registration.sourceRevision && Date.parse(this.registration.expiresAt) > Date.now() &&
      this.registration.machineBootId === anchor.payload.machineBootId, 'GUARD_CLIENT_BINDING');
    requireGuard(r.identity.application_id === 'cop' && r.identity.guard_contract_version === 'cop-account-safety-runtime-v1' &&
      r.identity.stream_scope_id === 'cop-global-fences-v1' && r.policy.policy_id === 'cop-jizda-only-sim-preserved-v1' &&
      r.dataset.projection_contract_id === 'cop-sim-driver-projection-v1' &&
      r.identity.guard_store_id === this.permit.guardStoreId && r.policy.continuity_epoch === this.permit.continuityEpoch &&
      r.dataset.continuity_epoch === this.permit.continuityEpoch && r.dataset.target_incarnation_id === operation.storeIncarnation &&
      r.runtime.dataset_binding_id === this.permit.datasetBindingId && r.proof.binding_id === this.permit.runtimeBindingId &&
      String(anchor.payload.sequence) === r.frontier_sequence && anchor.payload.digest === r.frontier_digest &&
      anchor.payload.clusterId === r.cluster_id && anchor.payload.timelineId === r.timeline_id,
    'GUARD_REGISTRY_FRONTIER_MISMATCH');
    // An old accepted permit can settle its original work, but never authorize
    // fresh work under a changed runtime policy/frontier.
    if (!historical) requireGuard(r.proof_current && String(r.policy.policy_generation) === String(this.permit.policyGeneration) &&
      String(r.runtime.policy_generation) === String(this.permit.policyGeneration) &&
      r.proof.frontier_sequence === this.permit.frontierSequence && r.proof.frontier_digest === this.permit.frontierDigest &&
      String(this.permit.frontierSequence) === r.frontier_sequence && this.permit.frontierDigest === r.frontier_digest,
    'GUARD_ORIGIN_NOT_CURRENT');
    for (const kind of REF_KINDS) {
      const ref = this.permit.evidence[kind];
      requireGuard(exact(ref, ['recordId', 'digest']) && uuid(ref.recordId) && hex(ref.digest), 'GUARD_EVIDENCE_REFERENCE');
      const record = verifyRootRecord(readRootFile(join(STATE, 'evidence', ref.recordId + '.json'), { secret: true }),
        this.keys, kind, { historical });
      requireGuard(record.digest === ref.digest && record.payload.recordId === ref.recordId &&
        sharedContext(record.payload, operation, this.permit), 'GUARD_EVIDENCE_BINDING');
      requireGuard(record.payload.scope === 'cop_jizda_preserve_shared_identity_sim' &&
        record.payload.decision === ({ 'identity-ownership': 'cop-jizda-owned',
          'retention-decision': operation.kind === 'expire' ? 'remove-expired-entire-cop-namespace' : 'scoped-removal-permitted',
          'report-protection': operation.kind === 'expire' ? 'unprotected-entire-cop-namespace' : 'removal-with-publication-barrier',
          'operation-schema': 'exact-guarded-plan-verified' })[kind], 'GUARD_EVIDENCE_DECISION');
    }
  }
}

export async function executeRootDriver(mode, operationId, body, registration) {
  requireGuard(process.getuid?.() === 0 && process.geteuid?.() === 0, 'ROOT_EXECUTION_REQUIRED');
  requireGuard(['execute', 'probe'].includes(mode) && uuid(operationId) &&
    (mode === 'probe' ? body === null : typeof body === 'string' && Buffer.byteLength(body) <= 16_384), 'GUARD_USAGE');
  // The dependency tree is installed read-only by the same accepted Root
  // installation. No app CWD, NODE_PATH or application-selected module path.
  requireRootCodeTree('/opt/cop-account-safety');
  readRootFile('/opt/cop-account-safety/package.json');
  const require = createRequire('/opt/cop-account-safety/package.json');
  const { Client } = require('pg');
  const clients = [new Client(connectionProfile('registry-probe', 'cop_account_safety_guard')),
    new Client(connectionProfile('driver-control', 'sim_driver_measurements', 'sim_driver_guard_control')),
    new Client(connectionProfile('driver-executor', 'sim_driver_measurements', 'sim_driver_guard_exec'))];
  // Idle errors must not print raw provider diagnostics through EventEmitter.
  // Actual query failures still reject and keep their original unknown state.
  for (const client of clients) client.on('error', () => {});
  try {
    for (const client of clients) await client.connect();
    const authority = new RootDriverAuthority(clients[0], operationId, registration);
    if (registration) requireGuard(registration.runtimeBindingId === authority.permit.runtimeBindingId &&
      registration.datasetBindingId === authority.permit.datasetBindingId && registration.guardStoreId === authority.permit.guardStoreId &&
      registration.continuityEpoch === authority.permit.continuityEpoch, 'GUARD_CLIENT_BINDING');
    const producer = new DriverOriginProducer({ control: clients[1], executor: clients[2],
      dispatch: new RootDispatchFiles(join(STATE, 'dispatches')), validateCurrent: async (operation, mode, transientBody) => {
        await authority.validate(operation, mode);
        if (mode === 'work' && operation.kind === 'ack')
          await validateRootPublication(clients[1], transientBody, operation, authority.keys, authority.permit);
      } });
    let result;
    if (mode === 'probe') result = await producer.probe(authority.operation);
    else result = await producer.runOnce(authority.operation, body);
    if (result.state !== 'pending') {
      await authority.validate(authority.operation, 'probe');
      result = publishRootOutcome(authority.operation, result, authority.permitRecord);
    }
    return result;
  } finally { for (const client of clients) try { await client.end(); } catch { /* Unknown stays unknown. */ } }
}
export async function main(args = process.argv.slice(2)) {
  requireGuard(process.getuid?.() === 0 && process.geteuid?.() === 0, 'ROOT_EXECUTION_REQUIRED');
  requireGuard(args.length === 3 && ['--run', '--probe'].includes(args[0]) && args[1] === '--operation' && uuid(args[2]), 'GUARD_USAGE');
  let body = null;
  if (args[0] === '--run') {
    const chunks = []; let size = 0;
    for await (const chunk of process.stdin) { size += chunk.length; requireGuard(size <= 16_384, 'GUARD_PAYLOAD_SIZE'); chunks.push(chunk); }
    body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  }
  process.stdout.write(canonical(await executeRootDriver(args[0] === '--run' ? 'execute' : 'probe', args[2], body)) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stderr.write('COP_ROOT_DRIVER_UNAVAILABLE\n'); process.exitCode = 1; });
}
