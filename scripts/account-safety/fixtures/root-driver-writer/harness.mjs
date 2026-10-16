/** NEW isolated actual Root common/crypto/TLS/PostgreSQL integration fixture.
 * Host/container observations and accepted enrollment are SYNTHETIC. The
 * actual native transport, receiver credentials and child pidfs are exercised.
 * No positive verifier callback, pg stub, provider, production account or
 * external network access is supplied. Parent Root broker and child process
 * have actual pidfs/start/executable facts. The final executor END loss creates HOLD.
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
import {checkServerIdentity,createSecureContext,TLSSocket,connect as tlsConnect} from 'node:tls';
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
const deadline = setTimeout(() => {process.stderr.write('ROOT_OWNER_FIXTURE_DEADLINE\n'); process.exit(2);}, 260000);
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
  const client = owner === 'sim_driver_measurements' ? driver : ai;
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
  app=fork('/fixture/writer-client.mjs',[],{execPath:process.execPath,env,stdio:['ignore','ignore','inherit','ipc']});
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
  for (const name of ['authority', 'clients', 'ai-clients', 'evidence', 'owner-policies', 'owner-transitions', 'runtime-proofs', 'checkpoint-acceptances', 'checkpoint-intents', 'checkpoint-dispatches','operations','outcomes','dispatches'])
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

function command(action,operation,body) {
  const id=randomUUID();let held,rejectHeld,didHold=false;
  const acquired=action==='hold-publication'?new Promise((resolve,reject)=>{held=()=>{didHold=true;resolve();};rejectHeld=reject;}):null;
  const done=new Promise(resolve=>{pendingCommands.set(id,{held:()=>held?.(),done:message=>{
    if(action==='hold-publication'&&!didHold)rejectHeld(new Error(message.error??'FIXTURE_PUBLICATION_NOT_HELD'));resolve(message);
  }});});
  app.send({id,action,operation,body});return {id,acquired,done};
}
async function request(action,op,body) {const r=await command(action,{operationId:op.operationId,kind:op.kind},body).done;assert.equal(r.error,undefined);return r.result;}
async function lockProbe() {
  const c=await open('cop_account_safety_guard');try {
    const held=(await c.query('SELECT pg_try_advisory_lock(hashtext(current_database()),904214) AS value')).rows[0].value;
    if(held)await c.query('SELECT pg_advisory_unlock(hashtext(current_database()),904214)');return held;
  }finally{await c.end();clients.delete(c);}
}
async function seed() {
  await driverAdmin.query('TRUNCATE driver_measurement_receipts CASCADE');
  await driverAdmin.query("INSERT INTO driver_measurement_receipts VALUES('cop',$1,repeat('1',64),repeat('2',64),'2026-10-01T00:00:00Z','2026-10-02T00:00:00Z','{}')",[randomUUID()]);
}
const count=async()=> (await driverAdmin.query('SELECT count(*)::int AS n FROM driver_measurement_receipts')).rows[0].n;
const originCount=async op=>(await driverAdmin.query('SELECT count(*)::int AS n FROM sim_driver_guard_source.origins WHERE operation_id=$1',[op.operationId])).rows[0].n;
const readPublicKeys=()=>canonicalJson(readFileSync(ETC+'/public/verification-keys.json'));
async function original() {
  const owner='sim_driver_measurements',o=ids.owners[owner],proof=await refresh(owner,{ttl:29900});
  const body={contractVersion:'sim-driver-guarded-db-v1'},text=canonical(body);
  const bodyDigest=(await driver.query("SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') AS value",[text])).rows[0].value;
  const operation={contractVersion:'cop-driver-origin-v1',operationId:randomUUID(),permitId:randomUUID(),storeIncarnation:o.store,kind:'expire',bodyDigest,
    schemaDigest:'e3513a983a3b6d1bd52d46851c734dd1c3b208e2e2f6430a6f9eddd38b10d3b5',cutoff:new Date(Date.now()-7*86400000).toISOString()};
  const context={guardStoreId:ids.guard,continuityEpoch:ids.epoch,datasetBindingId:o.dataset,runtimeBindingId:o.runtime,
    storeIncarnation:o.store,operationId:operation.operationId,bodyDigest,schemaDigest:operation.schemaDigest};
  const evidence={};
  for(const [kind,decision] of Object.entries({'identity-ownership':'cop-jizda-owned','retention-decision':'remove-expired-entire-cop-namespace',
    'report-protection':'unprotected-entire-cop-namespace','operation-schema':'exact-guarded-plan-verified'})){
    const id=randomUUID();evidence[kind]=await signFile(STATE+'/evidence/'+id+'.json',kind,
      {...context,scope:'cop_jizda_preserve_shared_identity_sim',decision},300000,id);
  }
  await signFile(STATE+'/operations/'+operation.operationId+'.json','driver-origin-permit',{operation,
    guardStoreId:ids.guard,continuityEpoch:ids.epoch,datasetBindingId:o.dataset,runtimeBindingId:o.runtime,
    sourceProofId:proof.proofId,policyGeneration:1,frontierSequence:0,frontierDigest:ids.frontier,evidence},300000,operation.permitId);
  const anchor=verifyRootRecord(await readFile(STATE+'/authority/current-frontier.json'),readPublicKeys(),'current-frontier');
  return {operation,body,text,proofExpiresAt:proof.record.payload.expiresAt,anchorExpiresAt:anchor.payload.expiresAt};
}
async function check(name,work){stage=name;await work();events.push({case:name,passed:true});process.stdout.write('PASS '+name+'\n');}
async function proxyExecutorEnd(operationId) {
  let withheld=0,terminateObserved=0,proxyFailure,executorCommitAcknowledged=false,committedResolverReadbacks=0,terminateAt,backendEndAt,terminateMonotonic;
  const upgradeRequest=Buffer.from('0000000804d2162f','hex');
  const part=async(socket,size)=>{let timer;try{return await Promise.race([new Promise((resolve,reject)=>{
    let bytes=Buffer.alloc(0);const data=chunk=>{bytes=Buffer.concat([bytes,chunk]);if(bytes.length>size){clean();reject(new Error('FIXTURE_TLS_UPGRADE_OVERSIZE'));}
      else if(bytes.length===size){socket.pause();clean();resolve(bytes);}};
    const error=()=>{clean();reject(new Error('FIXTURE_TLS_UPGRADE_CLOSED'));};
    const clean=()=>{socket.off('data',data);socket.off('error',error);socket.off('end',error);};
    socket.on('data',data);socket.once('error',error);socket.once('end',error);socket.resume();
  }),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('FIXTURE_TLS_UPGRADE_TIMEOUT')),5000);})]);}finally{clearTimeout(timer);}};
  proxy=createServer({allowHalfOpen:true},front=>{void(async()=>{
    proxySockets.add(front);front.on('error',()=>{});
    assert.deepEqual(await part(front,8),upgradeRequest);front.pause();front.write('S');
    const clearFront=new TLSSocket(front,{isServer:true,secureContext:createSecureContext({key:tls.key,cert:tls.cert}),allowHalfOpen:true});
    proxySockets.add(clearFront);clearFront.on('error',()=>{});assert.equal(clearFront.allowHalfOpen,true);
    const rawBack=connect({host:'127.0.0.1',port:PORT,allowHalfOpen:true});proxySockets.add(rawBack);rawBack.on('error',()=>{});
    await once(rawBack,'connect');const accepted=part(rawBack,1);rawBack.write(upgradeRequest);assert.deepEqual(await accepted,Buffer.from('S'));rawBack.pause();
    const clearBack=tlsConnect({socket:rawBack,ca:tls.ca,rejectUnauthorized:true,servername:'localhost',allowHalfOpen:true});
    proxySockets.add(clearBack);clearBack.on('error',()=>{});await once(clearBack,'secureConnect');assert.equal(clearBack.authorized,true);
    let pending=Buffer.alloc(0),serverPending=Buffer.alloc(0),startup=true,terminated=false,user,pendingResolver=false;
    clearFront.on('data',chunk=>{
      pending=Buffer.concat([pending,chunk]);
      while(pending.length>=(startup?4:5)) {
        const length=pending.readUInt32BE(startup?0:1),frameLength=length+(startup?0:1);
        if(length<4||frameLength>1024*1024){proxyFailure='FIXTURE_PG_FRAME';front.destroy();return;}
        if(pending.length<frameLength)break;
        if(startup){const fields=pending.subarray(8,frameLength).toString('utf8').split('\0');for(let i=0;i<fields.length-1;i+=2)if(fields[i]==='user')user=fields[i+1];}
        else if(pending[0]===0x58){assert.equal(length,4);terminated=true;if(user==='sim_driver_guard_exec'){terminateObserved++;terminateAt=new Date().toISOString();terminateMonotonic=performance.now();assert.equal(executorCommitAcknowledged,true);assert.equal(committedResolverReadbacks,2);}}
        pending=pending.subarray(frameLength);startup=false;
      }
      // Forward every actual PG byte. No query, COMMIT reply or pg method is
      // replaced. TLS is terminated only inside this owned network fixture.
      clearBack.write(chunk);
    });
    clearBack.on('data',chunk=>{
      serverPending=Buffer.concat([serverPending,chunk]);
      while(serverPending.length>=5){const length=serverPending.readUInt32BE(1),size=length+1;assert.ok(length>=4&&size<=1024*1024);if(serverPending.length<size)break;
        const frame=serverPending.subarray(0,size);
        if(frame[0]===0x44&&frame.readUInt16BE(5)===1&&frame.length>=11){const n=frame.readInt32BE(7);if(n>0&&11+n===frame.length){
          let value;try{value=JSON.parse(frame.subarray(11).toString('utf8'));}catch{}
          if(user==='sim_driver_guard_control'&&value?.operationId===operationId&&value.state==='origin_commit_known')pendingResolver=true;
        }}
        if(frame[0]===0x43&&frame.subarray(5).toString('utf8')==='COMMIT\0'){
          if(user==='sim_driver_guard_exec')executorCommitAcknowledged=true;
          if(user==='sim_driver_guard_control'&&pendingResolver){committedResolverReadbacks++;pendingResolver=false;}
        }serverPending=serverPending.subarray(size);
      }
      if(!terminated)clearFront.write(chunk);else assert.fail('Unexpected PG response after Terminate');
    });
    clearFront.on('end',()=>clearBack.end());
    clearBack.on('end',()=>{if(terminated&&user==='sim_driver_guard_exec'){withheld++;backendEndAt=new Date().toISOString();}else if(terminated)clearFront.end();else{proxyFailure='FIXTURE_EARLY_END';front.destroy();}});
    clearFront.resume();
  })().catch(()=>{proxyFailure='FIXTURE_TLS_PROXY';front.destroy();});});
  proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
  for(const name of ['driver-executor','driver-control']){const path=ETC+'/root/'+name+'.json',p=canonicalJson(await readFile(path));
    await privateFile(path,canonical({...p,port:proxy.address().port})+'\n');}
  return ()=>{assert.equal(proxyFailure,undefined);return {withheld,terminateObserved,executorCommitAcknowledged,committedResolverReadbacks,terminateAt,backendEndAt,terminateMonotonic};};
}
let pins,success=false,result,transportObservations;
try {
  assert.deepEqual(process.argv.slice(2),['--run']);pins=await bootstrap();
  const channel=await import(OPT+'/driver-root-channel.mjs'),runtime=await import(OPT+'/root-driver-runtime.mjs');
  const common=await import(OPT+'/root-owner-authority.mjs');
  broker=channel.main();void broker.catch(error=>{brokerFailure=error;});
  for(let i=0;i<100&&!existsSync('/run/cop-account-safety/driver.sock');i++)await delay(10);
  // The actual native listen() fixed path is asserted independently below.
  await check('native publication holds actual shared barrier; writer cannot start effects',async()=>{
    await seed();const x=await original();const publication=command('hold-publication');await publication.acquired;
    assert.equal(await lockProbe(),false);
    const blocked=await request('execute',x.operation,x.body);assert.equal(blocked.state,'pending');
    assert.equal(await originCount(x.operation),0);assert.equal(await count(),1);
    app.send({action:'release'});const done=await publication.done;assert.equal(done.error,undefined);assert.equal(done.result,'released');
    assert.equal(await lockProbe(),true);
    const result=await request('execute',x.operation,x.body);assert.equal(result.state,'origin-commit-known');
    assert.equal(await count(),0);assert.equal(await originCount(x.operation),1);
    assert.ok(result.sqlOutcomeRef&&result.effectQuiescenceRef);
    await seed();assert.equal((await request('execute',x.operation,x.body)).state,'origin-commit-known');
    assert.equal((await request('probe',x.operation)).state,'origin-commit-known');assert.equal(await count(),1);
  });
  await check('missing kernel peer and mismatched body cannot create original or mutate target',async()=>{
    await seed();const x=await original(),peer=ids.owners.sim_driver_measurements.peer,registration=channel.readClientRegistration(peer);
    await assert.rejects(runtime.executeRootDriver('execute',x.operation.operationId,x.text,registration),{message:'GUARD_EXECUTION_PEER_REQUIRED'});
    await assert.rejects(runtime.executeRootDriver('execute',x.operation.operationId,'{"wrong":true}',registration,peer),{message:'GUARD_EXECUTION_BODY'});
    assert.equal(await count(),1);assert.equal(await originCount(x.operation),0);assert.equal(await lockProbe(),true);
    assert.equal((await request('execute',x.operation,x.body)).state,'origin-commit-known');assert.equal(await count(),0);
  });
  await check('durable Root dispatch without SQL registration resolves same original without effects',async()=>{
    await seed();const x=await original();const {RootDispatchFiles}=await import(OPT+'/driver-origin-producer.mjs');
    assert.equal(await new RootDispatchFiles(STATE+'/dispatches').claim(x.operation),true);
    assert.equal((await request('probe',x.operation)).state,'origin-no-effects-closed');assert.equal(await count(),1);
    assert.equal((await request('execute',x.operation,x.body)).state,'origin-no-effects-closed');assert.equal(await count(),1);
    assert.equal(await originCount(x.operation),1);assert.equal(await lockProbe(),true);
  });
  await check('actual executor END acknowledgement loss retains HOLD and publishes no terminal outcome',async()=>{
    await seed();const x=await original(),before=(await readdir(STATE+'/outcomes')).length;
    const withheld=await proxyExecutorEnd(x.operation.operationId);const pending=request('execute',x.operation,x.body);
    let marker=false;for(let i=0;i<300&&!marker;i++){
      marker=(await driverAdmin.query('SELECT committed_marker FROM sim_driver_guard_source.origins WHERE operation_id=$1',[x.operation.operationId])).rows[0]?.committed_marker===true;
      if(!marker)await delay(20);
    }assert.equal(marker,true);assert.equal(await count(),0);
    const response=await pending;assert.equal(response.state,'pending');assert.equal(response.sqlOutcomeRef,undefined);
    await assert.rejects(common.requireCurrentOwner('sim_driver_measurements',ids.owners.sim_driver_measurements.peer,'retention'),{message:'GUARD_OWNER_LEASE_BUSY'});
    // Wait for the real factory's bounded END watchdog, never clear/reset HOLD.
    let held=false,firstHoldAt,holdDelayMs;for(let i=0;i<100&&!held;i++){
      try{const lease=await common.requireCurrentOwner('sim_driver_measurements',ids.owners.sim_driver_measurements.peer,'retention');await lease.close();}
      catch(error){if(error.message==='GUARD_OWNER_REQUEST'||error.message==='GUARD_OWNER_HOLD'){
          assert.ok(performance.now()-withheld().terminateMonotonic>=14500,'END watchdog must cause HOLD, not an earlier unrelated failure');
          assert.ok(Date.now()<Date.parse(x.proofExpiresAt)&&Date.now()<Date.parse(x.anchorExpiresAt),'Authority remains unexpired at first HOLD');firstHoldAt=new Date().toISOString();holdDelayMs=performance.now()-withheld().terminateMonotonic;held=true;}
        else assert.equal(error.message,'GUARD_OWNER_LEASE_BUSY');}
      if(!held)await delay(250);
    }assert.equal(held,true);assert.ok(withheld().withheld>0);assert.equal(withheld().terminateObserved,1);assert.equal(withheld().executorCommitAcknowledged,true);assert.equal(withheld().committedResolverReadbacks,2);assert.equal(await lockProbe(),false);
    assert.equal((await readdir(STATE+'/outcomes')).length,before);
    assert.equal((await request('probe',x.operation)).state,'pending');transportObservations={...withheld(),firstHoldAt,holdDelayMs};delete transportObservations.terminateMonotonic;
  });
  assert.equal(brokerFailure,undefined);
  for(const [path,pin] of Object.entries(pins))assert.equal(hash(await readFile(path)),pin);
  result={contractVersion:'cop-root-native-writer-isolated-linux-v1',passed:events.length,cases:events,
    actualPostgresTLS:true,actualNativeTransport:true,actualKernelReceiverPeer:true,actualPidfdSelf:true,
    actualExclusiveWriterBarrier:true,actualTargetEndLoss:true,globalHoldNotReset:true,transportObservations,actualHostObserverExecuted:false,
    hostObservationSynthetic:true,acceptedOwnerEvidence:false,productionEnrollment:false,productionChanged:false,
    realAccounts:false,providerCalls:0,actualAccountErasure:false,restoreAccepted:false};success=true;
} catch(error){process.stderr.write('FAIL '+stage+' '+String(error.code??error.message)+'\n');process.exitCode=1;}
finally {
  clearInterval(hostTimer);clearTimeout(deadline);
  for(const set of pendingHostWrites.values())await Promise.allSettled([...set]);
  app?.kill('SIGTERM');for(const socket of proxySockets)socket.destroy();proxy?.close();
  // This is teardown of an owned, disposable fixture, NOT a HOLD recovery claim.
  for(const c of clients)try{await c.end();}catch{}
  if(started)try{await pgCommand('pg_ctl',['-D',PGROOT+'/data','-m','immediate','-w','stop']);}catch{}
}
if(success)process.stdout.write(JSON.stringify(result)+'\n');
process.exit(success?0:1);
