/** NEW isolated actual Root common/crypto/TLS/PostgreSQL integration fixture.
 * Host/container observations and accepted enrollment are SYNTHETIC. The
 * actor helpers execute directly in Root; child pidfs identity is actual.
 * No native actor packet/receiver endpoint or HTTP authorization is exercised.
 * No positive verifier callback, pg stub, provider, production account or
 * external network access is supplied. Parent Root broker and child process
 * have actual pidfs/start/executable facts. Actor helpers are called in Root,
 * not through a native actor endpoint. Current owner enrollment is NOT tested.
 * Fixture teardown is NOT production quiescence or recovery acceptance.
 */
import assert from 'node:assert/strict';
import {execFile, fork} from 'node:child_process';
import {createServer, connect} from 'node:net';
import {once} from 'node:events';
import {createHash, createHmac, generateKeyPairSync, randomBytes, randomUUID} from 'node:crypto';
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
  app=fork('/fixture/actor-client.mjs',[],{execPath:process.execPath,env,stdio:['ignore','ignore','inherit','ipc']});
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
  for (const name of ['authority', 'clients', 'ai-clients', 'evidence', 'owner-policies', 'owner-transitions', 'runtime-proofs', 'checkpoint-acceptances', 'checkpoint-intents', 'checkpoint-dispatches','operations','outcomes','dispatches','maintenance-active','fence-manifests'])
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

async function check(name,work){stage=name;await work();events.push({case:name,passed:true});process.stdout.write('PASS '+name+'\n');}
let success=false,result,pins,cop,copReader,identity,driverIdentity,keyProfile,actors,requests,profiles,actorModule,readers,derived;
const issuer='https://identity.synthetic.invalid/realms/cop';
const ago=n=>new Date(Date.now()-n*86400000).toISOString().slice(0,10);
const record=ref=>verifyRootRecord(readFileSync(PRIVATE+'/owner-authority/'+ref.recordId+'.json'),canonicalJson(readFileSync(ETC+'/public/verification-keys.json')),
  JSON.parse(readFileSync(PRIVATE+'/owner-authority/'+ref.recordId+'.json')).payload.kind);
try{
  assert.deepEqual(process.argv.slice(2),['--run']);pins=await bootstrap();
  actorModule=await import(OPT+'/root-cop-actor.mjs');derived=await import(OPT+'/root-cop-identity.mjs');
  const {RootFenceJournal}=await import(OPT+'/root-fence-journal.mjs');
  identity={contractVersion:'cop-root-cop-identity-v1',issuer,identitySecret:randomBytes(32).toString('hex'),routerUserIdSecret:randomBytes(32).toString('hex'),
    applicationStoreId:randomUUID(),protectedConfigId:ids.config};identity.configurationFingerprint=hash('cop-account-erasure-config-v1\0'+identity.identitySecret);
  driverIdentity={contractVersion:'cop-root-driver-identity-v1',issuer,serviceToken:randomBytes(32).toString('hex'),actorSecret:randomBytes(32).toString('hex'),hashSecret:randomBytes(32).toString('hex')};
  keyProfile={contractVersion:'cop-root-driver-contributor-keys-v1',currentVersion:'synthetic-current',keys:[
    {version:'synthetic-old',secret:randomBytes(32).toString('hex')},{version:'synthetic-current',secret:randomBytes(32).toString('hex')}]};
  for(const [name,data]of Object.entries({'cop-identity':identity,'driver-identity':driverIdentity,'driver-contributor-keys':keyProfile}))
    await privateFile(ETC+'/root/'+name+'.json',canonical(data)+'\n');
  await signFile(STATE+'/authority/driver-key-history.json','driver-key-history',{guardStoreId:ids.guard,continuityEpoch:ids.epoch,protectedConfigId:ids.config,
    keys:keyProfile.keys.map((k,i)=>({version:k.version,secretFingerprint:hash(k.secret),firstIssuableDay:ago(30),lastIssuableDay:i===0?ago(5):null}))});
  actors=['synthetic-a','synthetic-b'].map(sub=>({iss:issuer,sub,operationId:randomUUID(),routerUserId:derived.copRouterAlias(identity.routerUserIdSecret,sub)}));
  const journal=new RootFenceJournal(registry,canonicalJson(readFileSync(ETC+'/public/verification-keys.json')),
    {...identity,guardStoreId:ids.guard,continuityEpoch:ids.epoch});
  const required=['keycloak','cop_sessions_profiles','cop_devices','messaging_matrix','voice_livekit','cop_content_media','mobility_dispatch','sim_measurements','ai_router','moderation_audit','backup_restore'];
  for(const actor of actors)await journal.publishFence({contractVersion:'cop-erasure-fence-entry-v1',applicationStoreId:identity.applicationStoreId,
    configurationFingerprint:identity.configurationFingerprint,accountKey:derived.copAccountMac(identity.identitySecret,issuer,actor.sub),
    job:{operationId:actor.operationId,requestedAt:new Date().toISOString(),required,checkpoints:{}}});
  await admin.query('CREATE DATABASE cop');cop=await open('cop');
  await cop.query(`CREATE TABLE public.cop_driver_measurement_config(id boolean PRIMARY KEY,secret_fingerprint text);
    CREATE TABLE public.cop_driver_measurement_consents(subject_id text PRIMARY KEY,owner_issuer text,revoked_at timestamptz,pending_days text[],granted_at timestamptz);
    CREATE TABLE public.cop_driver_consent_erasure_fences(subject_hash text PRIMARY KEY,owner_issuer text,operation_id uuid,pending_days text[])`);
  await cop.query(await readFile('/fixture/sql/cop/003-cop-consent-reader.sql','utf8'));
  const password=randomBytes(32).toString('hex');await cop.query("ALTER ROLE cop_guard_consent_reader LOGIN CONNECTION LIMIT 4 PASSWORD '"+password+"'");
  await privateFile(ETC+'/root/cop-consent-reader.json',canonical({contractVersion:'cop-root-postgres-profile-v1',host:'127.0.0.1',port:PORT,database:'cop',user:'cop_guard_consent_reader',password,
    serverName:'localhost',caFile:ETC+'/public/postgres-ca.crt'})+'\n');
  await privateFile(ETC+'/root/driver-inventory.json',await readFile(ETC+'/root/driver-control.json'));
  await cop.query('INSERT INTO cop_driver_measurement_config VALUES(true,$1)',[hash('cop-driver-secret-v1\0'+keyProfile.keys[1].secret)]);
  for(const actor of actors)await cop.query('INSERT INTO cop_driver_measurement_consents VALUES($1,$2,clock_timestamp(),$3,clock_timestamp())',[actor.sub,issuer,[ago(15),ago(0)]]);
  for(const actor of actors){const contributor=derived.driverContributorHash(driverIdentity.hashSecret,derived.driverDailyIdentity(keyProfile.keys[0].secret,actor.sub,ago(20)));
    await driverAdmin.query("INSERT INTO driver_measurement_receipts VALUES('cop',$1,$2,repeat('2',64),clock_timestamp(),clock_timestamp()+interval '7 days','{}')",[randomUUID(),contributor]);}
  const acceptedAt=new Date().toISOString(),days=[...new Set([...Array.from({length:9},(_,i)=>ago(i)),ago(15),ago(20),new Date(Date.parse(acceptedAt)+30000).toISOString().slice(0,10)])].sort();
  requests=actors.map(actor=>({contractVersion:'sim-account-erasure-v1',operationId:actor.operationId,
    contributors:keyProfile.keys.flatMap(k=>days.map(d=>({contributorDay:d,contributorIdDay:derived.driverDailyIdentity(k.secret,actor.sub,d)})))
      .sort((a,b)=>a.contributorDay.localeCompare(b.contributorDay)||a.contributorIdDay.localeCompare(b.contributorIdDay)),attestation:'cop-account-erasure-contributors-reviewed-v1'}));
  const peer=ids.owners.sim_driver_measurements.peer;
  await check('actual narrow Root reader verifies two distinct signed pseudonymous journal actors',async()=>{
    profiles=await Promise.all(actors.map(a=>actorModule.assertCopJournalActor(peer,a,a.operationId)));
    assert.notEqual(profiles[0].accountKey,profiles[1].accountKey);assert.notEqual(profiles[0].reference.digest,profiles[1].reference.digest);
    for(const [i,a]of actors.entries())assert.equal(profiles[i].accountKey,derived.copAccountMac(identity.identitySecret,issuer,a.sub));
    for(const name of await readdir(STATE+'/fence-manifests')){const text=readFileSync(STATE+'/fence-manifests/'+name,'utf8');for(const a of actors){assert.equal(text.includes(a.sub),false);assert.equal(text.includes(a.routerUserId),false);}}
  });
  await check('foreign operation, alias and issuer cannot bind another actor',async()=>{
    await assert.rejects(actorModule.assertCopJournalActor(peer,{...actors[0],operationId:actors[1].operationId},actors[1].operationId),{message:'GUARD_COP_JOURNAL_ACTOR'});
    await assert.rejects(actorModule.assertCopJournalActor(peer,{...actors[0],routerUserId:actors[1].routerUserId},actors[0].operationId),{message:'GUARD_COP_ACTOR_ALIAS'});
    await assert.rejects(actorModule.assertCopJournalActor(peer,{...actors[0],iss:'https://foreign.synthetic.invalid'},actors[0].operationId),{message:'GUARD_COP_ACTOR'});
  });
  await check('actual preheld exclusive metadata barrier does not self-deadlock the readonly actor proof',async()=>{
    const held=await open('cop_account_safety_guard','cop_guard_root_reader',passwords.registry);await held.query('SELECT pg_advisory_lock(hashtext(current_database()),904214)');
    const probe=await open('cop_account_safety_guard');assert.equal((await probe.query('SELECT pg_try_advisory_lock(hashtext(current_database()),904214) held')).rows[0].held,false);
    const proof=await actorModule.assertCopJournalActor(peer,actors[0],actors[0].operationId);assert.equal(proof.accountKey,profiles[0].accountKey);
    assert.equal((await held.query('SELECT pg_advisory_unlock(hashtext(current_database()),904214) unlocked')).rows[0].unlocked,true);await held.end();clients.delete(held);await probe.end();clients.delete(probe);
  });
  await check('actual retained hashes and consent outbox extend each exact historical-key manifest',async()=>{
    for(const [i,a]of actors.entries()){
      const ref=await actorModule.assertCopDriverErasureManifest(peer,a,requests[i],acceptedAt),r=record(ref);assert.equal(r.digest,ref.digest);
      assert.equal(r.payload.accountKey,profiles[i].accountKey);assert.equal(r.payload.businessOperationId,a.operationId);assert.ok(requests[i].contributors.length>18);
    }
  });
  await check('omitted retained/outbox dates and foreign user contributions are rejected',async()=>{
    await assert.rejects(actorModule.assertCopDriverErasureManifest(peer,actors[0],{...requests[0],contributors:requests[0].contributors.filter(c=>c.contributorDay!==ago(20))},acceptedAt),{message:'GUARD_DRIVER_MANIFEST_IDENTITY'});
    await assert.rejects(actorModule.assertCopDriverErasureManifest(peer,actors[0],{...requests[0],contributors:requests[0].contributors.filter(c=>c.contributorDay!==ago(15))},acceptedAt),{message:'GUARD_DRIVER_MANIFEST_IDENTITY'});
    await assert.rejects(actorModule.assertCopDriverErasureManifest(peer,actors[0],{...requests[0],contributors:requests[1].contributors},acceptedAt),{message:'GUARD_DRIVER_MANIFEST_IDENTITY'});
  });
  await check('permanent own fences preserve the exact original manifest after receipts and outbox cleanup',async()=>{
    // Privileged fixture setup only: reproduce the permanent hashes installed
    // by the actual guarded erase plan before it removes receipt/outbox data.
    const hashes=requests[0].contributors.map(c=>derived.driverContributorHash(driverIdentity.hashSecret,c.contributorIdDay));
    await driverAdmin.query("INSERT INTO driver_account_erasure_revocations(owner,contributor_hash) SELECT 'cop',h FROM unnest($1::text[]) h ON CONFLICT DO NOTHING",[hashes]);
    await driverAdmin.query("DELETE FROM driver_measurement_receipts WHERE owner='cop' AND contributor_hash=ANY($1::text[])",[hashes]);
    await cop.query('UPDATE cop_driver_measurement_consents SET pending_days=$1 WHERE subject_id=$2',[[ago(0)],actors[0].sub]);
    const ref=await actorModule.assertCopDriverErasureManifest(peer,actors[0],requests[0],acceptedAt),r=record(ref);
    assert.equal(r.payload.manifestDigest,hash(canonical(requests[0])));assert.equal(r.payload.originalAcceptedAt,acceptedAt);
    assert.equal(r.payload.accountKey,profiles[0].accountKey);
  });
  await check('late RLS or inherited column write cannot hide or rewrite consent inventory',async()=>{
    await cop.query('ALTER TABLE cop_driver_measurement_consents ENABLE ROW LEVEL SECURITY');
    await assert.rejects(actorModule.assertCopDriverErasureManifest(peer,actors[0],requests[0],acceptedAt),{message:'GUARD_COP_CONSENT_READ_SURFACE'});
    await cop.query('ALTER TABLE cop_driver_measurement_consents DISABLE ROW LEVEL SECURITY; GRANT UPDATE(subject_id) ON cop_driver_measurement_consents TO PUBLIC');
    await assert.rejects(actorModule.assertCopDriverErasureManifest(peer,actors[0],requests[0],acceptedAt),{message:'GUARD_COP_CONSENT_READ_SURFACE'});
    await cop.query('REVOKE UPDATE(subject_id) ON cop_driver_measurement_consents FROM PUBLIC');
  });
  const revocation=(actor=actors[0])=>{
    const current=keyProfile.keys[1],id=derived.driverDailyIdentity(current.secret,actor.sub,ago(0)),now=Math.floor(Date.now()/1000);
    const claim={iss:issuer,sub:actor.sub,aud:'sim-driver-revocation',iat:now,exp:now+60,contributorDay:ago(0),contributorIdDay:id,actorSource:'consent_ledger'};
    const encoded=Buffer.from(JSON.stringify(claim)).toString('base64url');return {authorization:'Bearer '+driverIdentity.serviceToken,method:'DELETE',path:'/api/v1/internal/driver-measurements/v1/contributions',
      actor:encoded,actorSignature:createHmac('sha256',driverIdentity.actorSecret).update(encoded).digest('hex'),body:{contractVersion:'sim-driver-measurements-v1',contributorIdDay:id}};
  };
  await check('actual signed daily withdrawal uses only its own issuer and current-key ledger intent',async()=>{
    const ref=await actorModule.assertCopRevocationIntent(peer,revocation()),r=record(ref);assert.equal(r.digest,ref.digest);
    assert.equal(r.payload.contributorHash,derived.driverContributorHash(driverIdentity.hashSecret,derived.driverDailyIdentity(keyProfile.keys[1].secret,actors[0].sub,ago(0))));
    await assert.rejects(actorModule.assertCopRevocationIntent(peer,{...revocation(),body:revocation(actors[1]).body}),{message:'GUARD_REVOCATION_ACTOR'});
    await assert.rejects(actorModule.assertCopRevocationIntent(peer,{...revocation(),actorSignature:'0'.repeat(64)}),{message:'GUARD_REVOCATION_ACTOR'});
  });
  await check('missing pending day, secret mismatch or whole-account local fence cannot become daily consent',async()=>{
    await cop.query('UPDATE cop_driver_measurement_consents SET pending_days=$1 WHERE subject_id=$2',[[ago(15)],actors[0].sub]);
    await assert.rejects(actorModule.assertCopRevocationIntent(peer,revocation()),{message:'GUARD_REVOCATION_INTENT'});
    await cop.query('UPDATE cop_driver_measurement_consents SET pending_days=$1 WHERE subject_id=$2',[[ago(15),ago(0)],actors[0].sub]);
    await cop.query("UPDATE cop_driver_measurement_config SET secret_fingerprint=repeat('0',64)");
    await assert.rejects(actorModule.assertCopRevocationIntent(peer,revocation()),{message:'GUARD_REVOCATION_INTENT'});
    await cop.query('UPDATE cop_driver_measurement_config SET secret_fingerprint=$1',[hash('cop-driver-secret-v1\0'+keyProfile.keys[1].secret)]);
    const subjectHash=createHmac('sha256',keyProfile.keys[1].secret).update('cop-driver-consent-erasure-v1\0').update(actors[0].sub).digest('hex');
    await cop.query('INSERT INTO cop_driver_consent_erasure_fences VALUES($1,$2,$3,$4)',[subjectHash,issuer,actors[0].operationId,[ago(0)]]);
    await assert.rejects(actorModule.assertCopRevocationIntent(peer,revocation()),{message:'GUARD_REVOCATION_INTENT'});
  });

  const mutation=await import(OPT+'/root-driver-mutation-intent.mjs');
  const erasurePure=await import(OPT+'/driver-account-erasure.js');
  const eraseScope=(i,body=requests[i],changes={})=>{
    const a=actors[i],now=Math.floor(Date.now()/1000),claim={iss:a.iss,sub:a.sub,aud:'sim-account-erasure',iat:now,exp:now+60,
      operationId:body.operationId,routerUserId:a.routerUserId,...changes};
    const encoded=Buffer.from(JSON.stringify(claim)).toString('base64url');
    return {method:'POST',path:'/api/v1/internal/driver-measurements/v1/account-erasure-operations',authorization:'Bearer '+driverIdentity.serviceToken,
      actor:encoded,actorSignature:createHmac('sha256',driverIdentity.actorSecret).update(encoded).digest('hex'),body};
  };
  let prepared;
  await check('actual Root mutation preparation separates two users without creating a ledger or dispatch',async()=>{
    prepared=[];
    for(let i=0;i<2;i++)prepared.push(await mutation.prepareRootDriverMutationIntent(peer,eraseScope(i)));
    assert.notEqual(prepared[0].body.actorHash,prepared[1].body.actorHash);
    assert.notEqual(prepared[0].body.operationHash,prepared[1].body.operationHash);
    for(let i=0;i<2;i++){
      const v=prepared[i],signed=record(v.reference);assert.equal(signed.payload.peer.inode,peer.inode);
      assert.equal(signed.payload.businessOperationId,actors[i].operationId);assert.equal(signed.payload.actorHash,v.body.actorHash);
      assert.equal(signed.payload.requestHash,v.body.requestHash);assert.equal(signed.payload.contributorCount,requests[i].contributors.length);
      assert.equal(Object.hasOwn(v.body,'checkpointHash'),false);assert.equal(Object.hasOwn(v.body,'publicationContext'),false);
      assert.equal(Object.isFrozen(v.body.contributors),true);
    }
    assert.equal((await driverAdmin.query('SELECT count(*)::int AS n FROM driver_account_erasure_operations')).rows[0].n,0);
    assert.equal((await driverAdmin.query('SELECT count(*)::int AS n FROM sim_driver_guard_source.origins')).rows[0].n,0);
  });
  await check('wrong service signature expired claim alias and foreign manifest cannot create a mutation intent',async()=>{
    await assert.rejects(mutation.prepareRootDriverMutationIntent(peer,{...eraseScope(0),authorization:'Bearer '+ 'x'.repeat(64)}),{message:'GUARD_MUTATION_SERVICE'});
    await assert.rejects(mutation.prepareRootDriverMutationIntent(peer,{...eraseScope(0),actorSignature:'0'.repeat(64)}));
    const now=Math.floor(Date.now()/1000);await assert.rejects(mutation.prepareRootDriverMutationIntent(peer,eraseScope(0,requests[0],{iat:now-61,exp:now-1})));
    await assert.rejects(mutation.prepareRootDriverMutationIntent(peer,eraseScope(0,requests[0],{routerUserId:actors[1].routerUserId})),{message:'GUARD_COP_ACTOR_ALIAS'});
    await assert.rejects(mutation.prepareRootDriverMutationIntent(peer,eraseScope(0,{...requests[0],contributors:requests[1].contributors})),{message:'GUARD_DRIVER_MANIFEST_IDENTITY'});
  });
  await check('private signed intent contains digests only and no principal service secret or daily identity',async()=>{
    for(const v of prepared){
      const bytes=readFileSync(PRIVATE+'/owner-authority/'+v.reference.recordId+'.json','utf8');
      for(const a of actors){assert.equal(bytes.includes(a.sub),false);assert.equal(bytes.includes(a.routerUserId),false);}
      assert.equal(bytes.includes(driverIdentity.serviceToken),false);assert.equal(bytes.includes(driverIdentity.actorSecret),false);
      for(const request of requests)for(const c of request.contributors)assert.equal(bytes.includes(c.contributorIdDay),false);
      const signed=record(v.reference);assert.ok(Date.parse(signed.payload.expiresAt)-Date.parse(signed.payload.issuedAt)<=5000);
    }
  });
  await check('actual actor-owned ledger preserves original anchor and rejects a changed immutable request',async()=>{
    const old=prepared[0];
    // Privileged fixture-only existing ledger setup. No production or Root
    // mutation authorization is claimed by this synthetic business row.
    await driverAdmin.query(`INSERT INTO driver_account_erasure_operations(operation_hash,actor_hash,request_hash,contributor_count,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$5)`,[old.body.operationHash,old.body.actorHash,old.body.requestHash,old.body.contributors.length,old.originalAcceptedAt]);
    const retry=await mutation.prepareRootDriverMutationIntent(peer,eraseScope(0));
    assert.equal(retry.originalAcceptedAt,old.originalAcceptedAt);assert.deepEqual(retry.body,old.body);
    const altered={...requests[0],contributors:requests[0].contributors.slice(2)};
    await assert.rejects(mutation.prepareRootDriverMutationIntent(peer,eraseScope(0,altered)),{message:'GUARD_MUTATION_REQUEST_CONFLICT'});
    assert.equal((await driverAdmin.query('SELECT count(*)::int AS n FROM driver_account_erasure_operations')).rows[0].n,1);
  });
  await check('actual daily revocation preparation derives its own hash from fixed Root consent intent',async()=>{
    const s=revocation(actors[1]),v=await mutation.prepareRootDriverMutationIntent(peer,s),signed=record(v.reference);
    assert.equal(v.actionKind,'revoke');assert.equal(v.body.contributorHash,derived.driverContributorHash(driverIdentity.hashSecret,s.body.contributorIdDay));
    assert.equal(signed.payload.contributorHash,v.body.contributorHash);assert.equal(signed.payload.peer.inode,peer.inode);
    assert.deepEqual(Object.keys(v.body).sort(),['contractVersion','contributorHash']);
    await assert.rejects(mutation.prepareRootDriverMutationIntent(peer,{...s,body:revocation(actors[0]).body}));
  });

  for(const [path,pin]of Object.entries(pins))assert.equal(hash(await readFile(path)),pin);
  result={contractVersion:'cop-root-mutation-intent-isolated-linux-v1',passed:events.length,cases:events,actualPostgresTLS:true,actualRootActorHelpers:true,actualRootMutationIntent:true,actualReadOnlyOriginalAnchor:true,
    actualPrivateProfiles:true,actualJournalCrypto:true,actualHeldAdvisoryBarrier:true,actualCopReadSurface:true,actualTwoSyntheticUsers:true,
    actualNativeTransport:false,actualKernelReceiverPeer:false,actualPidfdSelf:true,hostObservationSynthetic:true,actualHostObserverExecuted:false,
    journalSetupSyntheticAdministrator:true,copConsentSchemaSynthetic:true,metadataAuthorityCurrentClaim:false,acceptedOwnerEvidence:false,productionEnrollment:false,productionChanged:false,
    realAccounts:false,providerCalls:0,actualAccountErasure:false,actualHttpAuthorization:false,restoreAccepted:false};success=true;
}catch(error){process.stderr.write('FAIL '+stage+' '+String(error.code??error.message)+' '+String(error.stack??'').split('\n').filter(line=>line.includes('/fixture/')).join(' ')+'\n');process.exitCode=1;}
finally{
  clearInterval(hostTimer);clearTimeout(deadline);for(const set of pendingHostWrites.values())await Promise.allSettled([...set]);app?.kill('SIGTERM');
  for(const c of clients)try{await c.end();}catch{}
  if(started)try{await pgCommand('pg_ctl',['-D',PGROOT+'/data','-m','immediate','-w','stop']);}catch{}
}
if(success)process.stdout.write(JSON.stringify(result)+'\n');process.exit(success?0:1);
