/** NEW isolated actual Root common/crypto/TLS/PostgreSQL integration fixture.
 * Host/container observations and accepted enrollment are SYNTHETIC. The
 * actual native transport, receiver credentials and child pidfs are exercised.
 * No positive verifier callback, pg stub, provider, production account or
 * external network access is supplied. Parent Root broker and child process
 * have actual pidfs/start/executable facts. A real in-progress historical XID
 * must retain HOLD without allocating a replacement original or cutoff.
 * Fixture teardown is NOT production quiescence or recovery acceptance.
 */
import assert from 'node:assert/strict';
import {execFile, fork} from 'node:child_process';
import {createServer, connect} from 'node:net';
import {once} from 'node:events';
import {createHash, generateKeyPairSync, randomBytes, randomUUID} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {chmod, chown, lstat, mkdir, readFile, readdir, unlink, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {networkInterfaces} from 'node:os';
import {join} from 'node:path';
import {checkServerIdentity,createSecureContext,TLSSocket,connect as tlsConnect} from 'node:tls';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {certificates} from './certificates.mjs';

const OPT = '/opt/cop-account-safety', ETC = '/etc/cop-account-safety', STATE = '/var/lib/cop-account-safety';
const PRIVATE = '/run/cop-account-safety/private', PGROOT = '/var/lib/postgresql/root-owner-fixture', PORT = 6543;
const COST = 'aggregate-costs-current-month-v1';
const hash = value => createHash('sha256').update(value).digest('hex');
const execute = promisify(execFile), delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const clients = new Set(), events = [], specs = {
  sim_driver_measurements: {scope: 'online_driver_scope', profile: 'driver-control', user: 'sim_driver_guard_control', directory: 'clients', registration: 'driver-client-registration',
    request: () => ({owner: 'sim_driver_measurements', scope: 'online_driver_scope', purpose: 'capability'})},
  sim_ai_router: {scope: 'cop_router_primary_database', profile: 'ai-router-control', user: 'sim_ai_guard_control', directory: 'ai-clients', registration: 'ai-router-client-registration'},
};
const startedAt = new Date().toISOString(), deadline = setTimeout(() => {process.stderr.write('ROOT_OWNER_FIXTURE_DEADLINE\n'); process.exit(2);}, 260000);
const env = {PATH: '/usr/local/bin:/usr/bin:/bin', HOME: PGROOT, LANG: 'C', LC_ALL: 'C', TZ: 'UTC'};
let canonical, canonicalJson, verifyRootRecord, issueRootRecord, issueRootJws, storeRootRecord;
let app, broker, proxy, brokerFailure;
const pendingCommands=new Map(), proxySockets=new Set();
let pgUser, tls, started = false, admin, registry, driver, ai, driverAdmin, aiAdmin, hostTimer, brokerSelf, stage = 'preconditions';
const pausedHost = new Set(), ids = {guard: randomUUID(), epoch: randomUUID(), config: randomUUID(), policy: hash('synthetic independent Root policy'),
  frontier: hash('synthetic independent initial prefix'), owners: Object.fromEntries(Object.keys(specs).map((owner, i) => [owner, {
    store: randomUUID(), dataset: randomUUID(), runtime: randomUUID(), target: randomUUID(), runtimeProfile: randomUUID(),
    peer: {device: String(101 + i), inode: String(201 + i), uid: 1000, gid: 1000}, container: hash('synthetic container ' + owner),
    checkpoint: hash('synthetic accepted checkpoint ' + owner), policy: undefined, policyRef: undefined, observation: undefined,
  }]))};
const pendingHostWrites = new Map(Object.keys(specs).map(owner => [owner, new Set()]));
const passwords = Object.fromEntries(['admin', 'registry', 'driver', 'ai', 'runtime', 'executor'].map(k => [k, randomBytes(32).toString('hex')]));
const boot = () => readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
async function privateFile(path, value, mode = 0o600) {await writeFile(path, value, {mode}); await chmod(path, mode);}
async function pgCommand(command, args, timeout = 15000) {
  return execute('/usr/local/bin/' + command, args, {env, uid: pgUser.uid, gid: pgUser.gid, timeout, maxBuffer: 65536});
}
function db(database, user = 'synthetic_admin', password) {
  const {Client} = createRequire(OPT + '/package.json')('pg');
  const value = new Client(user === 'synthetic_admin' ? {host: PGROOT + '/socket', port: PORT, database, user} : {
    host: '127.0.0.1', port: PORT, database, user, password,
    ssl: {ca: tls.ca, rejectUnauthorized: true, servername: 'localhost', checkServerIdentity: (_host, certificate) => checkServerIdentity('localhost', certificate)},
  });
  value.on('error', () => {}); clients.add(value); return value;
}
async function open(database, user, password) {const value = db(database, user, password); await value.connect(); return value;}
async function signFile(path, kind, facts, ttl = 300000, recordId = randomUUID()) {
  const record = issueRootRecord(kind, facts, {recordId, lifetimeMs: ttl, expectedKeyringDigest: hash(await readFile(ETC + '/public/verification-keys.json'))});
  await privateFile(path, record.bytes); return {recordId, digest: record.digest};
}
function binding(owner) {
  const o = ids.owners[owner]; return {guardStoreId: ids.guard, continuityEpoch: ids.epoch, protectedConfigId: ids.config,
    datasetBindingId: o.dataset, runtimeBindingId: o.runtime, policyGeneration: 1, policyDigest: ids.policy, storeIncarnation: o.store};
}
function syntheticObservation(owner) {
  const o = ids.owners[owner]; return {contractVersion: 'cop-root-host-observation-v1', owner, observedAtUTC: new Date().toISOString(),
    machineBootId: boot(), dockerContainerId: o.container, imageId: 'sha256:' + hash('synthetic reviewed image'),
    sourceRevision: 'f3c05e3ae1ca3081d2f5551bc03da233c0c3a473', configurationDigest: hash('synthetic immutable configuration ' + owner),
    readOnlyRootfs: true, peer: o.peer, startTicks: o.actualStartTicks ?? String(BigInt(brokerSelf.startTicks) + 1n), executableDigest: o.actualExecutableDigest ?? hash('synthetic declared app executable'),
    broker: {dockerContainerId: hash('synthetic broker'), imageId: 'sha256:' + hash('synthetic reviewed broker image'),
      configurationDigest: hash('synthetic immutable broker configuration'), peer: brokerSelf.peer,
      startTicks: brokerSelf.startTicks, executableDigest: brokerSelf.executableDigest}};
}
async function hostFact(owner) {
  const o = ids.owners[owner]; o.observation = syntheticObservation(owner);
  const record = issueRootRecord('host-runtime-observation', {observation: o.observation}, {lifetimeMs: 5000,
    expectedKeyringDigest: hash(await readFile(ETC + '/public/verification-keys.json'))});
  storeRootRecord(PRIVATE + '/runtime-observations/' + owner + '.json', record.bytes, {replace: true});
}
async function targetFacts(owner) {
  const o = ids.owners[owner], client = owner === 'sim_driver_measurements' ? driver : ai;
  let request = specs[owner].request?.();
  if (!request) {
    const cp = (await aiAdmin.query("SELECT checkpoint_id,checkpoint_generation::text AS generation FROM ai_router_erasure_checkpoint WHERE id=1")).rows[0];
    request = {owner, scope: specs[owner].scope, purpose: 'checkpoint', expectedSnapshot: {checkpointId: cp.checkpoint_id, generation: cp.generation, operationDigest: '0'.repeat(64), schemaDigest: '0'.repeat(64)}};
  }
  await client.query('BEGIN READ ONLY');
  try {
    const functionName = owner === 'sim_driver_measurements' ? 'sim_driver_guard_source.read_admission_facts' : 'sim_ai_guard_source.read_checkpoint_facts';
    const facts = (await client.query('SELECT ' + functionName + '($1::jsonb) AS value', [JSON.stringify(request)])).rows[0].value;
    if (owner === 'sim_ai_router') request.expectedSnapshot = {checkpointId: facts.checkpoint.checkpoint_id, generation: facts.checkpoint.checkpoint_generation,
      operationDigest: facts.checkpoint.operation_digest, schemaDigest: facts.checkpoint.schema_digest};
    return {facts, request};
  } finally {await client.query('ROLLBACK');}
}
async function seedPolicy(owner, transition) {
  const o = ids.owners[owner], b = binding(owner), scope = specs[owner].scope, {facts, request} = await targetFacts(owner);
  const evidence = {};
  for (const [field, kind, decision, fingerprint] of [
    ['identityEvidenceRef', 'owner-identity', 'cop-jizda-owned-sim-preserved'], ['retentionEvidenceRef', 'owner-retention', 'bounded-owner-retention'],
    ['schemaEvidenceRef', 'owner-schema', 'exact-schema-reviewed', facts.schema.fingerprint],
    ['privilegeEvidenceRef', 'owner-privileges', 'least-privilege-reviewed', (facts.privileges ?? facts.permissions).fingerprint],
    owner === 'sim_driver_measurements' ? ['reportPolicyRef', 'driver-report-policy', 'verified-report-inventory'] : ['costEvidenceRef', 'ai-cost-policy', 'financial-caps-preserved'],
  ]) {
    const id = randomUUID(); evidence[field] = await signFile(STATE + '/evidence/' + id + '.json', kind,
      {...b, owner, scope, decision, ...(fingerprint ? {fingerprint} : {})}, 300000, id);
  }
  const policy = {contractVersion: 'cop-root-owner-policy-v1', owner, scope,
    identityEvidenceRef: evidence.identityEvidenceRef, retentionEvidenceRef: evidence.retentionEvidenceRef,
    schemaEvidenceRef: evidence.schemaEvidenceRef, privilegeEvidenceRef: evidence.privilegeEvidenceRef,
    schemaFingerprint: facts.schema.fingerprint, privilegeFingerprint: (facts.privileges ?? facts.permissions).fingerprint,
    ...(owner === 'sim_driver_measurements' ? {expectedCheckpointHash: facts.state.checkpointHash, reportProtection: 'no_report', reportPolicyRef: evidence.reportPolicyRef} :
      {costPolicy: COST, costEvidenceRef: evidence.costEvidenceRef, expectedSnapshot: request.expectedSnapshot})};
  if (transition) {
    const id = transition.operationId;
    const intentRef = await signFile(STATE + '/owner-transitions/' + id + '.json', 'owner-checkpoint-transition', {...b, owner, scope, transition}, 300000, id);
    policy.transition = {...transition, intentRef};
  }
  o.policy = policy; o.policyRef = await signFile(STATE + '/owner-policies/' + owner + '.json', 'owner-policy', {binding: b, policy});
}
async function frontier() {
  const value = (await registry.query('SELECT system_identifier::text AS cluster,(SELECT timeline_id FROM pg_control_checkpoint()) AS timeline FROM pg_control_system()')).rows[0];
  await signFile(STATE + '/authority/current-frontier.json', 'current-frontier', {guardStoreId: ids.guard, continuityEpoch: ids.epoch,
    sequence: 0, digest: ids.frontier, machineBootId: boot(), clusterId: value.cluster, timelineId: value.timeline}, 25000);
  return value;
}
async function refresh(owner, {kind = 'refresh', acceptanceRef = ids.owners[owner].acceptanceRef ?? null, ttl = 20000} = {}) {
  const o = ids.owners[owner]; await hostFact(owner); const identity = await frontier();
  const observation = o.observation, proofId = randomUUID(), operationId = randomUUID();
  const record = issueRootJws('runtime-proof', {owner, binding: binding(owner), operationId, operationKind: kind, trustProfileId: 'synthetic-fixture-v1',
    ownerPolicyRef: o.policyRef, checkpointAcceptanceRef: acceptanceRef, frontierSequence: 0, frontierDigest: ids.frontier,
    clusterId: identity.cluster, timelineId: identity.timeline, observation},
  {recordId: proofId, lifetimeMs: ttl, expectedKeyringDigest: hash(await readFile(ETC + '/public/verification-keys.json'))});
  await privateFile(STATE + '/runtime-proofs/' + proofId + '.jws', record.bytes);
  await registry.query(`INSERT INTO cop_guard.accepted_runtime_proofs(proof_id,operation_id,operation_kind,binding_id,proof_jws_digest,accepted_jws_ref,
    trust_profile_id,frontier_sequence,frontier_digest,observed_at,issued_at,valid_until,root_evidence_ref)
    VALUES($1,$2,$3,$4,$5,$6,'synthetic-fixture-v1',0,$7,$8,$9,$10,'synthetic-source-proof')`,
  [proofId, operationId, kind, o.runtime, record.digest, proofId + ':' + record.digest, ids.frontier, observation.observedAtUTC, record.payload.issuedAt, record.payload.expiresAt]);
  return {proofId, operationId, record};
}
async function seedAcceptance(owner) {
  // Non-circular protocol: historical enrollment P0 -> immutable receipt /
  // replay / acceptance -> signed acceptance artifact -> fresh current P1.
  // P1 intentionally does NOT have to be P0. All seeds are synthetic and are
  // administered here, never auto-adopted by the actual common under test.
  const o = ids.owners[owner], original = await refresh(owner, {kind: 'enrollment', acceptanceRef: null});
  const receiptId = randomUUID(), acceptanceId = randomUUID();
  await registry.query("INSERT INTO cop_guard.replay_operations(operation_id,operation_kind,source_proof_id,binding_id,root_evidence_ref) VALUES($1,'enrollment',$2,$3,'synthetic-fixture-replay')",
    [original.operationId, original.proofId, o.runtime]);
  await registry.query(`INSERT INTO cop_guard.owner_receipts(receipt_id,replay_operation_id,source_proof_id,source_proof_jws_digest,binding_id,owner_id,
    expected_checkpoint_generation,expected_fence_sequence,expected_fence_digest,expected_cleanup_sequence,expected_cleanup_digest,expected_cleanup_status,
    fence_sequence,fence_digest,cleanup_sequence,cleanup_digest,cleanup_status,coverage_evidence_ref,readback_evidence_ref,attempt,observed_at)
    VALUES($1,$2,$3,$4,$5,$6,0,0,$7,0,$7,'unknown',0,$7,0,$7,'complete','synthetic-covered','synthetic-readback',1,clock_timestamp())`,
  [receiptId, original.operationId, original.proofId, original.record.digest, o.runtime, owner, ids.frontier]);
  await registry.query(`INSERT INTO cop_guard.checkpoint_acceptances(acceptance_id,dataset_binding_id,generation,receipt_id,policy_generation,policy_digest,
    protected_config_id,admission_policy_id,continuity_epoch,accepted_frontier_sequence,accepted_frontier_digest,fence_sequence,fence_digest,
    cleanup_sequence,cleanup_digest,cleanup_status,root_evidence_ref)
    VALUES($1::uuid,$2,1,$3,1,$4,$5,'synthetic-fixture-v1',$6,0,$7,0,$7,0,$7,'complete',($1::uuid)::text)`,
  [acceptanceId, o.dataset, receiptId, ids.policy, ids.config, ids.epoch, ids.frontier]);
  await registry.query("SET TimeZone='UTC'");
  const digest = async (table, key, value) => (await registry.query('SELECT encode(sha256(convert_to(to_jsonb(t)::text,\'UTF8\')),\'hex\') AS digest FROM cop_guard.' + table + ' t WHERE ' + key + '=$1', [value])).rows[0].digest;
  o.acceptanceRef = await signFile(STATE + '/checkpoint-acceptances/' + acceptanceId + '.json', 'checkpoint-acceptance', {
    acceptanceId, datasetBindingId: o.dataset, receiptId, replayOperationId: original.operationId, sourceProofId: original.proofId,
    acceptanceDigest: await digest('checkpoint_acceptances', 'acceptance_id', acceptanceId),
    receiptDigest: await digest('owner_receipts', 'receipt_id', receiptId), replayDigest: await digest('replay_operations', 'operation_id', original.operationId),
  }, 300000, acceptanceId);
  o.receiptId = receiptId; o.acceptanceId = acceptanceId;
  o.original = original; await refresh(owner);
}
async function nextAcceptance(owner) {
  const o = ids.owners[owner], previous = (await registry.query('SELECT * FROM cop_guard.checkpoint_acceptances WHERE dataset_binding_id=$1 ORDER BY generation DESC LIMIT 1', [o.dataset])).rows[0];
  const original = o.original, receiptId = randomUUID(), acceptanceId = randomUUID();
  await registry.query(`INSERT INTO cop_guard.owner_receipts(receipt_id,replay_operation_id,source_proof_id,source_proof_jws_digest,binding_id,owner_id,
    expected_checkpoint_id,expected_checkpoint_generation,expected_fence_sequence,expected_fence_digest,expected_cleanup_sequence,expected_cleanup_digest,expected_cleanup_status,
    fence_sequence,fence_digest,cleanup_sequence,cleanup_digest,cleanup_status,coverage_evidence_ref,readback_evidence_ref,attempt,observed_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,0,$9,0,$9,'complete',0,$9,0,$9,'complete','synthetic-covered','synthetic-readback',2,clock_timestamp())`,
  [receiptId, original.operationId, original.proofId, original.record.digest, o.runtime, owner, previous.acceptance_id, previous.generation, ids.frontier]);
  await registry.query(`INSERT INTO cop_guard.checkpoint_acceptances(acceptance_id,dataset_binding_id,generation,previous_acceptance_id,receipt_id,policy_generation,policy_digest,
    protected_config_id,admission_policy_id,continuity_epoch,accepted_frontier_sequence,accepted_frontier_digest,fence_sequence,fence_digest,cleanup_sequence,cleanup_digest,cleanup_status,root_evidence_ref)
    VALUES($1::uuid,$2,$3,$4,$5,1,$6,$7,'synthetic-fixture-v1',$8,0,$9,0,$9,0,$9,'complete',($1::uuid)::text)`,
  [acceptanceId, o.dataset, String(BigInt(previous.generation) + 1n), previous.acceptance_id, receiptId, ids.policy, ids.config, ids.epoch, ids.frontier]);
  const digest = async (table, key, value) => (await registry.query('SELECT encode(sha256(convert_to(to_jsonb(t)::text,\'UTF8\')),\'hex\') AS digest FROM cop_guard.' + table + ' t WHERE ' + key + '=$1', [value])).rows[0].digest;
  const next = await signFile(STATE + '/checkpoint-acceptances/' + acceptanceId + '.json', 'checkpoint-acceptance', {
    acceptanceId, datasetBindingId: o.dataset, receiptId, replayOperationId: original.operationId, sourceProofId: original.proofId,
    acceptanceDigest: await digest('checkpoint_acceptances', 'acceptance_id', acceptanceId), receiptDigest: await digest('owner_receipts', 'receipt_id', receiptId),
    replayDigest: await digest('replay_operations', 'operation_id', original.operationId),
  }, 300000, acceptanceId);
  return {next, receiptId, acceptanceId};
}
async function bootstrap() {
  stage = 'bootstrap.platform-node';
  assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'arm64'); assert.equal(process.version, 'v24.20.0');
  stage = 'bootstrap.root-container';
  assert.equal(process.getuid(), 0); assert.equal(process.geteuid(), 0); assert.ok(existsSync('/.dockerenv'));
  stage = 'bootstrap.network-isolation';
  for (const [name, addresses] of Object.entries(networkInterfaces())) {assert.equal(name, 'lo'); assert.ok(addresses.every(a => a.internal));}
  stage = 'bootstrap.staged-source-pins';
  const pins = JSON.parse(await readFile('/fixture/source-pins.json', 'utf8'));
  for (const [path, pin] of Object.entries(pins)) {const s = await lstat(path); assert.ok(s.isFile() && s.uid === 0 && s.nlink === 1 && !(s.mode & 0o022)); assert.equal(hash(await readFile(path)), pin);}
  stage = 'bootstrap.root-records-import';
  ({canonical, canonicalJson, verifyRootRecord} = await import(OPT + '/root-records.mjs'));
  stage = 'bootstrap.root-issuer-import';
  ({issueRootRecord, issueRootJws, storeRootRecord} = await import(OPT + '/root-record-issuer.mjs'));
  stage = 'bootstrap.native-module-import';
  const {nativeModule} = await import(OPT + '/root-native.mjs');
  stage = 'bootstrap.native-self-identity';
  const peer = nativeModule().selfIdentity();
  assert.deepEqual(Object.keys(peer).sort(), ['device', 'inode']);
  stage = 'bootstrap.actual-proc-self';
  const stat = readFileSync('/proc/self/stat', 'utf8');
  brokerSelf = {peer: {...peer, uid: process.getuid(), gid: process.getgid()},
    startTicks: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19], executableDigest: hash(await readFile('/proc/self/exe'))};
  assert.match(brokerSelf.startTicks, /^[0-9]+$/); assert.match(peer.device, /^[0-9]+$/); assert.match(peer.inode, /^[1-9][0-9]*$/);
  stage = 'bootstrap.actual-native-app-peer';
  await delay(30);
  app=fork('/fixture/retention-client.mjs',[],{execPath:process.execPath,env,stdio:['ignore','ignore','inherit','ipc']});
  const ready=(await once(app,'message'))[0]; assert.equal(ready.ready,true);
  const actualPeer=nativeModule().inspectProcess(app.pid); assert.deepEqual(ready.pidfs,actualPeer);
  const appStat=readFileSync('/proc/'+app.pid+'/stat','utf8');
  ids.owners.sim_driver_measurements.peer={...actualPeer,uid:0,gid:0};
  ids.owners.sim_driver_measurements.actualStartTicks=appStat.slice(appStat.lastIndexOf(')')+2).split(' ')[19];
  ids.owners.sim_driver_measurements.actualExecutableDigest=hash(await readFile('/proc/'+app.pid+'/exe'));
  assert.ok(BigInt(ids.owners.sim_driver_measurements.actualStartTicks)>BigInt(brokerSelf.startTicks));
  app.on('message',message=>{const p=pendingCommands.get(message.id);if(!p)return;
    if(message.status==='held')p.held(); else {pendingCommands.delete(message.id);p.done(message);}});
  stage = 'bootstrap.postgres-unix-identity';
  const pg = readFileSync('/etc/passwd', 'utf8').split('\n').find(row => row.startsWith('postgres:')).split(':'); pgUser = {uid: Number(pg[2]), gid: Number(pg[3])};
  stage = 'bootstrap.fresh-private-directories';
  for (const path of [ETC, STATE, PGROOT]) {assert.equal(existsSync(path), false); await mkdir(path, {mode: 0o700});}
  for (const name of ['root', 'public']) await mkdir(ETC + '/' + name, {mode: 0o700});
  for (const name of ['authority', 'clients', 'ai-clients', 'evidence', 'owner-policies', 'owner-transitions', 'runtime-proofs', 'checkpoint-acceptances', 'checkpoint-intents', 'checkpoint-dispatches','operations','outcomes','dispatches','maintenance-active'])
    await mkdir(STATE + '/' + name, {mode: 0o700});
  await mkdir('/run/cop-account-safety/public',{mode:0o755});
  stage = 'bootstrap.private-tmpfs';
  const mounts = readFileSync('/proc/self/mountinfo', 'utf8').split('\n').map(row => row.split(' - '));
  assert.ok(mounts.some(row => row[0].split(' ')[4] === PRIVATE && row[1]?.split(' ')[0] === 'tmpfs'));
  for (const name of ['owner-authority', 'runtime-observations', 'read-evidence', 'read-permits', 'ai-read-permits']) await mkdir(PRIVATE + '/' + name, {mode: 0o700});
  stage = 'bootstrap.postgres-directory-custody';
  await chown(PGROOT, pgUser.uid, pgUser.gid); await mkdir(PGROOT + '/socket', {mode: 0o700}); await chown(PGROOT + '/socket', pgUser.uid, pgUser.gid);
  stage = 'bootstrap.synthetic-tls-certificates';
  tls = certificates(); await privateFile(ETC + '/public/postgres-ca.crt', tls.ca, 0o644);
  for (const [name, data] of [['server.crt', tls.cert], ['server.key', tls.key], ['bootstrap-password', passwords.admin]]) {
    await privateFile(PGROOT + '/' + name, data); await chown(PGROOT + '/' + name, pgUser.uid, pgUser.gid);
  }
  stage = 'bootstrap.postgres-initdb';
  await pgCommand('initdb', ['-D', PGROOT + '/data', '--username=synthetic_admin', '--pwfile=' + PGROOT + '/bootstrap-password', '--auth-local=trust', '--auth-host=scram-sha-256', '--encoding=UTF8', '--locale=C'], 30000);
  await unlink(PGROOT + '/bootstrap-password');
  await privateFile(PGROOT + '/data/pg_hba.conf', 'local all all trust\nhostssl all all 127.0.0.1/32 scram-sha-256\nhostnossl all all 127.0.0.1/32 reject\nhost all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\n');
  await chown(PGROOT + '/data/pg_hba.conf', pgUser.uid, pgUser.gid);
  stage = 'bootstrap.postgres-start';
  await pgCommand('pg_ctl', ['-D', PGROOT + '/data', '-l', PGROOT + '/server.log', '-o', `-k ${PGROOT}/socket -p ${PORT} -c listen_addresses=127.0.0.1 -c unix_socket_permissions=0700 -c ssl=on -c ssl_cert_file=${PGROOT}/server.crt -c ssl_key_file=${PGROOT}/server.key -c timezone=UTC -c log_statement=none -c log_min_error_statement=panic`, '-w', 'start']); started = true;
  stage = 'bootstrap.postgres-admin-connect';
  admin = await open('postgres');
  stage = 'bootstrap.empty-target-databases';
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM pg_database WHERE datname IN ('cop_account_safety_guard','sim_ai_router','sim_driver_measurements')")).rows[0].n, 0);
  stage = 'bootstrap.synthetic-target-roles';
  await admin.query(`CREATE ROLE driver_measurements_migrator NOLOGIN; CREATE ROLE driver_measurements_runtime LOGIN;
    CREATE ROLE sim_driver_guard_owner NOLOGIN; CREATE ROLE sim_driver_guard_control LOGIN PASSWORD '${passwords.driver}'; CREATE ROLE sim_driver_guard_exec LOGIN PASSWORD '${passwords.executor}';
    CREATE ROLE ai_router_migrator NOLOGIN; CREATE ROLE ai_router_runtime LOGIN;
    CREATE ROLE sim_ai_guard_owner NOLOGIN; CREATE ROLE sim_ai_guard_control LOGIN PASSWORD '${passwords.ai}'`);
  stage = 'bootstrap.synthetic-target-databases';
  for (const [database, owner] of [['sim_driver_measurements', 'driver_measurements_migrator'], ['sim_ai_router', 'ai_router_migrator'], ['cop_account_safety_guard', 'synthetic_admin']])
    await admin.query('CREATE DATABASE ' + database + ' OWNER ' + owner);
  stage = 'bootstrap.target-admin-connections';
  registry = await open('cop_account_safety_guard'); driver = await open('sim_driver_measurements'); ai = await open('sim_ai_router');
  driverAdmin = driver; aiAdmin = ai;
  stage = 'bootstrap.metadata-001';
  await registry.query(await readFile('/fixture/sql/metadata/001-guard-metadata.sql', 'utf8'));
  stage = 'bootstrap.metadata-public-revoke';
  await registry.query('REVOKE ALL ON DATABASE cop_account_safety_guard FROM PUBLIC');
  // This MUST be the separately reviewed actual narrow metadata-reader source.
  // No fixture-only RLS bypass, allow-all policy or checkpoint-writer role
  // membership may substitute for that deployment prerequisite.
  stage = 'bootstrap.metadata-002-root-reader';
  await registry.query(await readFile('/fixture/sql/metadata/002-root-reader.sql', 'utf8'));
  // Separate fixture-only credential/LOGIN activation; 002 itself starts the
  // real narrow reader NOLOGIN/connection-limit zero, without any password.
  stage = 'bootstrap.metadata-synthetic-login';
  await registry.query("ALTER ROLE cop_guard_root_reader LOGIN CONNECTION LIMIT 8 PASSWORD '" + passwords.registry + "'");
  stage = 'bootstrap.driver-migrator-role';
  await driver.query('SET ROLE driver_measurements_migrator');
  for (const name of ['schema.sql', '002_account_erasure.sql']) {
    stage = 'bootstrap.driver.' + name; await driver.query(await readFile('/fixture/sql/driver/' + name, 'utf8'));
  }
  stage = 'bootstrap.driver-guard-namespace';
  await driver.query('RESET ROLE; CREATE SCHEMA sim_driver_guard_source AUTHORIZATION sim_driver_guard_owner; GRANT sim_driver_guard_exec TO sim_driver_guard_owner');
  for (const name of ['003_guarded_operations.sql', '004_read_admission_facts.sql']) {
    stage = 'bootstrap.driver.' + name; await driver.query(await readFile('/fixture/sql/driver/' + name, 'utf8'));
  }
  stage = 'bootstrap.driver-prebound-store';
  await driver.query('INSERT INTO sim_driver_guard_source.store_binding VALUES(true,$1)', [ids.owners.sim_driver_measurements.store]);
  stage = 'bootstrap.driver-synthetic-checkpoint';
  await driver.query("UPDATE driver_account_erasure_state SET replay_ready=true,replay_checkpoint_hash=$1,proof_valid_until=clock_timestamp()+interval '10 minutes',retention_reviewed=true,report_protection='no_report',publication_fence_verified=true WHERE singleton", [ids.owners.sim_driver_measurements.checkpoint]);
  for (const name of ['005_root_checkpoint.sql', '006_inventory_candidates.sql']) {
    stage = 'bootstrap.driver.' + name; await driver.query(await readFile('/fixture/sql/driver/' + name, 'utf8'));
  }
  stage = 'bootstrap.ai-migrator-role';
  await ai.query('SET ROLE ai_router_migrator');
  for (const name of ['001_schema.sql', '002_separate_billing.sql', '003_account_erasure.sql']) {
    stage = 'bootstrap.ai.' + name; await ai.query(await readFile('/fixture/sql/ai/' + name, 'utf8'));
  }
  stage = 'bootstrap.ai-runtime-profile-and-namespace';
  await ai.query(`RESET ROLE; REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE TEMP ON DATABASE sim_ai_router FROM PUBLIC;
    GRANT SELECT,INSERT,UPDATE ON ai_router_request,ai_router_policy,ai_router_policy_audit TO ai_router_runtime; GRANT USAGE,SELECT ON SEQUENCE ai_router_policy_audit_id_seq TO ai_router_runtime;
    CREATE SCHEMA sim_ai_guard_source AUTHORIZATION sim_ai_guard_owner`);
  stage = 'bootstrap.ai.004_root_checkpoint_facts.sql';
  await ai.query(await readFile('/fixture/sql/ai/004_root_checkpoint_facts.sql', 'utf8'));
  stage = 'bootstrap.ai-prebound-store';
  await ai.query('INSERT INTO sim_ai_guard_source.store_binding VALUES(true,$1)', [ids.owners.sim_ai_router.store]);
  stage = 'bootstrap.ai.005_root_checkpoint.sql';
  await ai.query(await readFile('/fixture/sql/ai/005_root_checkpoint.sql', 'utf8'));
  stage = 'bootstrap.ai-synthetic-checkpoint';
  await ai.query("UPDATE ai_router_erasure_checkpoint SET identity_reviewed=true,replay_ready=true,cost_policy=$1 WHERE id=1", [COST]);
  stage = 'bootstrap.target-tls-control-connect';
  driver = await open('sim_driver_measurements', 'sim_driver_guard_control', passwords.driver);
  ai = await open('sim_ai_router', 'sim_ai_guard_control', passwords.ai);
  stage = 'bootstrap.target-strict-tls-assert';
  for (const client of [driver, ai]) assert.equal((await client.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0].ssl, true);
  stage = 'bootstrap.synthetic-root-keyring';
  const rootKey = generateKeyPairSync('ed25519'), pub = rootKey.publicKey.export({format: 'jwk'});
  await privateFile(ETC + '/public/verification-keys.json', canonical({contractVersion: 'cop-root-verification-keys-v1', keys: [{kid: 'synthetic-common-root', kty: 'OKP', crv: 'Ed25519', x: pub.x}]}) + '\n', 0o644);
  await privateFile(STATE + '/authority/signing-key.pkcs8', rootKey.privateKey.export({type: 'pkcs8', format: 'pem'}));
  stage = 'bootstrap.fixed-tls-profiles';
  for (const [file, database, user, password] of [['registry-probe', 'cop_account_safety_guard', 'cop_guard_root_reader', passwords.registry],
    ['driver-control', 'sim_driver_measurements', 'sim_driver_guard_control', passwords.driver], ['driver-executor','sim_driver_measurements','sim_driver_guard_exec',passwords.executor], ['ai-router-control', 'sim_ai_router', 'sim_ai_guard_control', passwords.ai]])
    await privateFile(ETC + '/root/' + file + '.json', canonical({contractVersion: 'cop-root-postgres-profile-v1', host: '127.0.0.1', port: PORT, database, user, password,
      serverName: 'localhost', caFile: ETC + '/public/postgres-ca.crt'}) + '\n');
  stage = 'bootstrap.metadata-identity-seed';
  await registry.query("INSERT INTO cop_guard.guard_identity(guard_store_id,application_id,guard_contract_version,stream_scope_id,initial_prefix_digest,enrollment_evidence_ref) VALUES($1,'cop','cop-account-safety-runtime-v1','cop-global-fences-v1',$2,'synthetic-fixture-only')", [ids.guard, ids.frontier]);
  stage = 'bootstrap.metadata-policy-seed';
  await registry.query("INSERT INTO cop_guard.policies(policy_generation,guard_store_id,policy_id,policy_digest,protected_config_id,admission_policy_id,continuity_epoch,root_evidence_ref) VALUES(1,$1,'cop-jizda-only-sim-preserved-v1',$2,$3,'synthetic-fixture-v1',$4,'synthetic-fixture-only')", [ids.guard, ids.policy, ids.config, ids.epoch]);
  for (const owner of Object.keys(specs)) {
    const o = ids.owners[owner];
    stage = 'bootstrap.' + owner + '.dataset-binding-seed';
    await registry.query(`INSERT INTO cop_guard.dataset_bindings(dataset_binding_id,guard_store_id,owner_id,projection_contract_id,continuity_epoch,target_store_id,target_dataset_id,target_incarnation_id,target_restore_generation,root_evidence_ref)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,'synthetic-fixture-only')`, [o.dataset, ids.guard, owner, owner === 'sim_ai_router' ? 'cop-sim-ai-projection-v1' : 'cop-sim-driver-projection-v1', ids.epoch, randomUUID(), o.target, o.store]);
    const observation = syntheticObservation(owner);
    stage = 'bootstrap.' + owner + '.runtime-binding-seed';
    await registry.query(`INSERT INTO cop_guard.runtime_bindings(binding_id,dataset_binding_id,owner_id,policy_generation,image_id,source_revision,runtime_instance_id,runtime_profile_id,root_evidence_ref)
      VALUES($1,$2,$3,1,$4,$5,$6,$7,'synthetic-fixture-only')`, [o.runtime, o.dataset, owner, observation.imageId, observation.sourceRevision, o.container, o.runtimeProfile]);
    stage = 'bootstrap.' + owner + '.client-registration';
    await signFile(STATE + '/' + specs[owner].directory + '/' + o.peer.device + '-' + o.peer.inode + '.json', specs[owner].registration,
      {peer: o.peer, runtimeBindingId: o.runtime, datasetBindingId: o.dataset, guardStoreId: ids.guard, continuityEpoch: ids.epoch,
        imageId: observation.imageId, sourceRevision: observation.sourceRevision, machineBootId: boot()});
    let initialTransition;
    if (owner === 'sim_driver_measurements') initialTransition = {
      contractVersion: 'cop-root-driver-checkpoint-transition-v1', operationId: randomUUID(),
      expectedPreviousCheckpointHash: o.checkpoint, checkpointHash: hash('synthetic initial explicitly accepted transition'),
      proofValidUntilUTC: new Date(Date.now() + 12000).toISOString(), replayReady: true, retentionReviewed: true,
      reportProtection: 'no_report', publicationFenceVerified: true,
    };
    stage = 'bootstrap.' + owner + '.root-policy-seed';
    await seedPolicy(owner, initialTransition);
    stage = 'bootstrap.' + owner + '.p0-receipt-acceptance-p1-seed';
    await seedAcceptance(owner);
    o.fixedSchemaFingerprint = o.policy.schemaFingerprint; o.fixedPrivilegeFingerprint = o.policy.privilegeFingerprint;
  }
  stage = 'bootstrap.fresh-host-observation-timer';
  hostTimer = setInterval(() => {for (const owner of Object.keys(specs)) if (!pausedHost.has(owner)) {
    const jobs = pendingHostWrites.get(owner), job = hostFact(owner); jobs.add(job);
    void job.catch(() => {}).finally(() => jobs.delete(job));
  }}, 750);
  return pins;
}

function command(action){const id=randomUUID(),done=new Promise(resolve=>pendingCommands.set(id,{done:resolve}));app.send({id,action});return done;}
async function request(action){const r=await command(action);assert.equal(r.error,undefined);return r.result;}
async function seed(){await driverAdmin.query('TRUNCATE driver_measurement_receipts CASCADE');
  await driverAdmin.query("INSERT INTO driver_measurement_receipts VALUES('cop',$1,repeat('1',64),repeat('2',64),'2026-10-01T00:00:00Z','2026-10-02T00:00:00Z','{}')",[randomUUID()]);}
const count=async()=>(await driverAdmin.query('SELECT count(*)::int n FROM driver_measurement_receipts')).rows[0].n;
const active=()=>verifyRootRecord(readFileSync(STATE+'/maintenance-active/driver.json'),canonicalJson(readFileSync(ETC+'/public/verification-keys.json')),'driver-retention-active',{historical:true});
const permit=id=>verifyRootRecord(readFileSync(STATE+'/operations/'+id+'.json'),canonicalJson(readFileSync(ETC+'/public/verification-keys.json')),'driver-origin-permit',{historical:true});
async function check(name,fn){stage=name;await fn();events.push({case:name,passed:true});process.stdout.write('PASS '+name+'\n');}
let pins,success=false,result,first,fresh,executor;
try{
  assert.deepEqual(process.argv.slice(2),['--run']);pins=await bootstrap();
  const channel=await import(OPT+'/driver-root-channel.mjs'),common=await import(OPT+'/root-owner-authority.mjs');
  broker=channel.main();void broker.catch(error=>{brokerFailure=error;});
  await check('actual Root producer creates and executes fixed expiry original without a precreated delivery',async()=>{
    await seed();assert.deepEqual(await readdir(STATE+'/operations'),[]);first=await request('run');assert.equal(await count(),0);
    const p=permit(first.operation.operationId),a=active();assert.equal(p.digest,a.payload.originalPermitRef.digest);
    assert.equal(p.payload.operation.kind,'expire');assert.equal(p.payload.operation.cutoff,first.cutoff);
    assert.ok(Date.parse(first.cutoff)<=Date.now());assert.equal(p.payload.operation.storeIncarnation,ids.owners.sim_driver_measurements.store);
    assert.equal((await driverAdmin.query('SELECT committed_marker FROM sim_driver_guard_source.origins WHERE operation_id=$1',[first.operation.operationId])).rows[0].committed_marker,true);
  });
  await check('another current delivery preserves exact original UUID and cutoff and cannot repeat DELETE',async()=>{
    await seed();const again=await request('run');assert.deepEqual(again,first);assert.equal(await count(),1);
    assert.equal((await readdir(STATE+'/operations')).length,1);
  });
  await check('expired original source requires committed same-origin reconciliation before a fresh Root original',async()=>{
    const old=permit(first.operation.operationId);await delay(31000);await refresh('sim_driver_measurements',{ttl:29900});
    fresh=await request('context');assert.notEqual(fresh.operation.operationId,first.operation.operationId);assert.ok(Date.parse(fresh.cutoff)>Date.parse(first.cutoff));
    const p=permit(fresh.operation.operationId);assert.notEqual(p.payload.sourceProofId,old.payload.sourceProofId);
    assert.equal(await count(),1);assert.equal((await driverAdmin.query('SELECT count(*)::int n FROM sim_driver_guard_source.origins WHERE operation_id=$1',[fresh.operation.operationId])).rows[0].n,0);
    assert.equal((await readdir(STATE+'/operations')).length,2);
  });
  await check('a delayed claimed transaction is sealed before any effect and cannot execute later',async()=>{
    const op=permit(fresh.operation.operationId).payload.operation;
    const {RootDispatchFiles}=await import(OPT+'/driver-origin-producer.mjs');assert.equal(await new RootDispatchFiles(STATE+'/dispatches').claim(op),true);
    await driver.query('SELECT sim_driver_guard_source.register_origin($1,$2,$3,$4,$5,$6,$7)',[op.operationId,op.storeIncarnation,op.permitId,op.kind,op.bodyDigest,op.schemaDigest,op.cutoff]);
    executor=await open('sim_driver_measurements','sim_driver_guard_exec',passwords.executor);await executor.query('BEGIN');
    const d=(await executor.query("SELECT pg_current_xact_id()::text xid,pg_backend_pid() pid,backend_start::text start FROM pg_stat_activity WHERE pid=pg_backend_pid()")).rows[0];
    await driver.query('SELECT sim_driver_guard_source.claim_origin($1,$2,$3::xid8,$4,$5::timestamptz)',[op.operationId,op.storeIncarnation,d.xid,d.pid,d.start]);
    await delay(31000);await refresh('sim_driver_measurements',{ttl:29900});
    const next=await request('context');assert.notEqual(next.operation.operationId,op.operationId);assert.equal(await count(),1);
    assert.equal((await driverAdmin.query('SELECT state FROM sim_driver_guard_source.origins WHERE operation_id=$1',[op.operationId])).rows[0].state,'sealed_no_effect');
    await assert.rejects(executor.query('SELECT sim_driver_guard_source.execute_origin($1,$2::jsonb)',[op.operationId,JSON.stringify({contractVersion:'sim-driver-guarded-db-v1'})]),/origin_not_claimed_for_execution/);
    await executor.query('ROLLBACK');await executor.end();clients.delete(executor);fresh=next;
  });
  await check('actual uncommitted DELETE and marker retain HOLD with no replacement original or cutoff',async()=>{
    const op=permit(fresh.operation.operationId).payload.operation;
    const {RootDispatchFiles}=await import(OPT+'/driver-origin-producer.mjs');assert.equal(await new RootDispatchFiles(STATE+'/dispatches').claim(op),true);
    await driver.query('SELECT sim_driver_guard_source.register_origin($1,$2,$3,$4,$5,$6,$7)',[op.operationId,op.storeIncarnation,op.permitId,op.kind,op.bodyDigest,op.schemaDigest,op.cutoff]);
    executor=await open('sim_driver_measurements','sim_driver_guard_exec',passwords.executor);await executor.query('BEGIN');
    const d=(await executor.query("SELECT pg_current_xact_id()::text xid,pg_backend_pid() pid,backend_start::text start FROM pg_stat_activity WHERE pid=pg_backend_pid()")).rows[0];
    await driver.query('SELECT sim_driver_guard_source.claim_origin($1,$2,$3::xid8,$4,$5::timestamptz)',[op.operationId,op.storeIncarnation,d.xid,d.pid,d.start]);
    const provisional=(await executor.query('SELECT sim_driver_guard_source.execute_origin($1,$2::jsonb) AS value',[op.operationId,JSON.stringify({contractVersion:'sim-driver-guarded-db-v1'})])).rows[0].value;
    assert.equal(provisional.provisionalInCallerTransaction,true);assert.equal(provisional.requiresOriginCommitAndFreshReadback,true);assert.equal(provisional.deletedBatchCount,1);
    assert.equal(await count(),1); // Another committed observer still sees the row.
    const pointer=hash(await readFile(STATE+'/maintenance-active/driver.json')),files=(await readdir(STATE+'/operations')).length;
    await delay(31000);const current=await refresh('sim_driver_measurements',{ttl:29900});
    const started=performance.now(),denied=await command('context');assert.ok(denied.error);assert.equal(denied.result,undefined);
    await assert.rejects(common.requireCurrentOwner('sim_driver_measurements',ids.owners.sim_driver_measurements.peer,'retention'),{message:'GUARD_OWNER_LEASE_BUSY'});
    let hold=false;for(let i=0;i<100&&!hold;i++){
      try{const lease=await common.requireCurrentOwner('sim_driver_measurements',ids.owners.sim_driver_measurements.peer,'retention');await lease.close();assert.fail('Unknown target work released its barrier');}
      catch(error){if(error.message==='GUARD_OWNER_REQUEST'||error.message==='GUARD_OWNER_HOLD'){
        assert.ok(performance.now()-started>=9500);assert.ok(Date.now()<Date.parse(current.record.payload.expiresAt));hold=true;
      }else assert.equal(error.message,'GUARD_OWNER_LEASE_BUSY');}if(!hold)await delay(100);
    }assert.equal(hold,true);
    assert.equal(hash(await readFile(STATE+'/maintenance-active/driver.json')),pointer);assert.equal((await readdir(STATE+'/operations')).length,files);
    assert.equal(await count(),1);assert.equal((await driverAdmin.query('SELECT committed_marker FROM sim_driver_guard_source.origins WHERE operation_id=$1',[op.operationId])).rows[0].committed_marker,false);
    assert.equal((await driverAdmin.query('SELECT pg_xact_status($1::xid8) value',[d.xid])).rows[0].value,'in progress');
  });
  assert.equal(brokerFailure,undefined);for(const [path,pin]of Object.entries(pins))assert.equal(hash(await readFile(path)),pin);
  result={contractVersion:'cop-root-retention-producer-isolated-linux-v1',passed:events.length,cases:events,actualPostgresTLS:true,
    actualNativeTransport:true,actualKernelReceiverPeer:true,actualPidfdSelf:true,actualRootRetentionProducer:true,precreatedDelivery:false,
    actualHistoricalInProgressXid:true,actualUncommittedDelete:true,delayedClaimSealedWithoutEffects:true,globalHoldNotReset:true,actualHostObserverExecuted:false,hostObservationSynthetic:true,
    acceptedOwnerEvidence:false,productionEnrollment:false,productionChanged:false,realAccounts:false,providerCalls:0,actualAccountErasure:false,restoreAccepted:false};success=true;
}catch(error){process.stderr.write('FAIL '+stage+' '+String(error.code??error.message)+' '+String(error.stack??'').split('\n').filter(line=>line.includes('/fixture/')).join(' ')+'\n');process.exitCode=1;}
finally{
  clearInterval(hostTimer);clearTimeout(deadline);for(const set of pendingHostWrites.values())await Promise.allSettled([...set]);app?.kill('SIGTERM');
  // Owned fixture teardown, never evidence of production HOLD recovery.
  for(const c of clients)try{await c.end();}catch{}
  if(started)try{await pgCommand('pg_ctl',['-D',PGROOT+'/data','-m','immediate','-w','stop']);}catch{}
}
if(success)process.stdout.write(JSON.stringify(result)+'\n');process.exit(success?0:1);
