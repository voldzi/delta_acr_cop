import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { chmod, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DriverOriginProducer, resolveOriginal } from './driver-origin-producer.mjs';

assert.deepEqual(process.argv.slice(2), ['--run']);
const rootRepo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sim = '/Users/voldzi/.codex/worktrees/sim-account-erasure/02 SIM';
const inputs = {
  'deploy/driver-measurements/schema.sql': '6dd60a3acf28d63575198c8526c368df19bbd543f4063d4985fb55f308da02d0',
  'deploy/driver-measurements/002_account_erasure.sql': 'f13db2106a1fe1a02d0d1a26afa8ad7d7c045172ba4419749719ed0f166e16ad',
  'deploy/driver-measurements/003_guarded_operations.sql': 'e3513a983a3b6d1bd52d46851c734dd1c3b208e2e2f6430a6f9eddd38b10d3b5',
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = {};
for (const [path, pin] of Object.entries(inputs)) { const bytes = await readFile(join(sim, path)); assert.equal(hash(bytes), pin); source[path] = bytes.toString(); }
const codeFiles = ['driver-origin-producer.mjs', 'root-records.mjs', 'root-driver-runtime.mjs', 'root-publication.mjs', 'root-outcome-records.mjs', 'test-driver-origin-postgres.mjs'];
const codePins = {};
for (const path of codeFiles) codePins[path] = hash(await readFile(new URL(path, import.meta.url)));
const exec = promisify(execFile), pgBin = '/opt/homebrew/opt/postgresql@18/bin';
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR'].includes(key)));
for (const key of Object.keys(process.env)) if (/^PG|DATABASE_URL$|SECRET|TOKEN|API_KEY/.test(key)) delete process.env[key];
assert.match((await exec(join(pgBin, 'postgres'), ['--version'], { env })).stdout, /^postgres \(PostgreSQL\) 18\.3(?:\s|$)/);
assert.equal(realpathSync('/private/tmp'), '/private/tmp');
const directory = await mkdtemp('/private/tmp/cop-root-origin-pg-'); await chmod(directory, 0o700);
await mkdir(join(directory, 'socket'), { mode: 0o700 });
const require = createRequire(join(rootRepo, 'apps/cop-api/package.json'));
const { Client } = require('pg');
const clients = [], cases = []; let running = false, succeeded = false;
const own = () => { assert.equal(dirname(realpathSync(directory)), '/private/tmp'); assert.ok(realpathSync(directory).startsWith('/private/tmp/cop-root-origin-pg-')); };
const client = async (user, database = 'sim_driver_measurements') => {
  const c = new Client({ host: join(directory, 'socket'), user, database, connectionTimeoutMillis: 2000, statement_timeout: 5000 });
  clients.push(c); await c.connect(); return c;
};
const value = async (c, sql, args) => (await c.query(sql, args)).rows[0].value;
const store = randomUUID(), body = JSON.stringify({ contractVersion: 'sim-driver-guarded-db-v1' });
let admin, control, executor, bodyDigest, cutoff;
const operation = () => ({ contractVersion: 'cop-driver-origin-v1', operationId: randomUUID(), storeIncarnation: store,
  permitId: randomUUID(), kind: 'expire', bodyDigest, schemaDigest: inputs['deploy/driver-measurements/003_guarded_operations.sql'], cutoff });
const dispatch = () => {
  const rows = new Set(), effects = new Map();
  return { async exists(op) { return rows.has(op.operationId); },
    async claim(op) { if (rows.has(op.operationId)) return false; rows.add(op.operationId); return true; },
    async recordRevokeEffect(op, effect) { effects.set(op.operationId, effect); },
    async readRevokeEffect(op) { return effects.get(op.operationId) ?? null; }, effects };
};
// Deliberately synthetic admission only. Production uses RootDriverAuthority;
// these cases test the actual pg dispatcher against actual bounded SQL roles.
const producer = (c = control, x = executor, d = dispatch()) => new DriverOriginProducer({ control: c, executor: x, dispatch: d, validateCurrent: async () => undefined });
const count = () => value(admin, 'SELECT count(*)::integer AS value FROM driver_measurement_receipts');
const seed = async () => {
  await admin.query('TRUNCATE driver_measurement_receipts CASCADE');
  await admin.query("INSERT INTO driver_measurement_receipts VALUES('cop',$1,repeat('1',64),repeat('2',64),'2026-10-01T00:00:00Z','2026-10-02T00:00:00Z','{}')", [randomUUID()]);
};
const check = async (name, fn) => { await seed(); await fn(); cases.push({ case: name, passed: true }); console.log('PASS ' + name); };
try {
  own();
  await exec(join(pgBin, 'initdb'), ['-D', join(directory, 'data'), '--username=synthetic_admin', '--auth-local=trust', '--auth-host=reject', '--encoding=UTF8', '--locale=C'], { env });
  await exec(join(pgBin, 'pg_ctl'), ['-D', join(directory, 'data'), '-l', join(directory, 'log'), '-o',
    `-k ${join(directory, 'socket')} -c listen_addresses='' -c unix_socket_permissions=0700 -c log_statement=none -c log_min_error_statement=panic -c max_prepared_transactions=0`, '-w', 'start'], { env }); running = true;
  const bootstrap = await client('synthetic_admin', 'postgres');
  await bootstrap.query(`CREATE ROLE driver_measurements_migrator NOLOGIN; CREATE ROLE driver_measurements_runtime LOGIN;
    CREATE ROLE sim_driver_guard_owner NOLOGIN; CREATE ROLE sim_driver_guard_control LOGIN; CREATE ROLE sim_driver_guard_exec LOGIN`);
  await bootstrap.query('CREATE DATABASE sim_driver_measurements OWNER driver_measurements_migrator');
  admin = await client('synthetic_admin'); control = await client('sim_driver_guard_control'); executor = await client('sim_driver_guard_exec');
  await admin.query('SET ROLE driver_measurements_migrator');
  await admin.query(source['deploy/driver-measurements/schema.sql']); await admin.query(source['deploy/driver-measurements/002_account_erasure.sql']);
  await admin.query('RESET ROLE');
  await admin.query('REVOKE ALL ON SCHEMA public FROM PUBLIC; CREATE SCHEMA sim_driver_guard_source AUTHORIZATION sim_driver_guard_owner; GRANT sim_driver_guard_exec TO sim_driver_guard_owner');
  await admin.query(source['deploy/driver-measurements/003_guarded_operations.sql']);
  await admin.query('INSERT INTO sim_driver_guard_source.store_binding VALUES(true,$1)', [store]);
  cutoff = (await value(admin, "SELECT date_trunc('second',clock_timestamp()) AS value")).toISOString();
  bodyDigest = await value(control, "SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') AS value", [body]);
  await check('producer executes actual original transaction and commits marker', async () => {
    const op = operation(), result = await producer().runOnce(op, body);
    assert.equal(result.state, 'origin-commit-known'); assert.equal(await count(), 0);
    assert.equal(await value(admin, 'SELECT committed_marker AS value FROM sim_driver_guard_source.origins WHERE operation_id=$1', [op.operationId]), true);
  });
  await check('same dispatch is probe-only and cannot delete later expired rows', async () => {
    const op = operation(), p = producer(); assert.equal((await p.runOnce(op, body)).state, 'origin-commit-known');
    await seed(); assert.equal((await p.runOnce(op, body)).state, 'origin-commit-known'); assert.equal(await count(), 1);
  });
  await check('lost executor commit acknowledgement resolves existing commit without repeat', async () => {
    const op = operation(); let swallowed = false, calls = 0;
    const wrapped = { async query(sql, args) { if (sql.includes('execute_origin')) calls++; const result = await executor.query(sql, args);
      if (sql === 'COMMIT' && !swallowed) { swallowed = true; throw new Error('deliberately ignored ACK'); } return result; } };
    const p = producer(control, wrapped);
    assert.equal((await p.runOnce(op, body)).state, 'origin-commit-known'); assert.equal(calls, 1); assert.equal(await count(), 0);
    assert.equal((await p.runOnce(op, body)).state, 'origin-commit-known'); assert.equal(calls, 1);
  });
  await check('lost registration commit acknowledgement seals original without effects', async () => {
    const op = operation(); let swallowed = false;
    const wrapped = { async query(sql, args) { const result = await control.query(sql, args);
      if (sql === 'COMMIT' && !swallowed) { swallowed = true; throw new Error('deliberately ignored ACK'); } return result; } };
    const p = producer(wrapped); assert.equal((await p.runOnce(op, body)).state, 'origin-no-effects-closed'); assert.equal(await count(), 1);
    assert.equal((await p.runOnce(op, body)).state, 'origin-no-effects-closed'); assert.equal(await count(), 1);
  });
  await check('inner seal result with lost outer acknowledgement remains pending', async () => {
    const op = operation();
    await control.query('SELECT sim_driver_guard_source.register_origin($1,$2,$3,$4,$5,$6,$7)',
      [op.operationId, store, op.permitId, op.kind, op.bodyDigest, op.schemaDigest, op.cutoff]);
    let lost = false;
    const wrapped = { async query(sql, args) { const result = await control.query(sql, args);
      if (sql === 'COMMIT' && !lost) { lost = true; throw new Error('deliberately ignored ACK'); } return result; } };
    assert.equal((await resolveOriginal(wrapped, op.operationId)).state, 'pending');
    assert.equal((await resolveOriginal(control, op.operationId)).state, 'origin-no-effects-closed'); assert.equal(await count(), 1);
  });
  await check('payload mismatch cannot execute or create a target origin', async () => {
    const op = operation(); assert.equal((await producer().runOnce(op, '{"wrong":true}')).state, 'pending'); assert.equal(await count(), 1);
    assert.equal(await value(admin, 'SELECT count(*)::integer AS value FROM sim_driver_guard_source.origins WHERE operation_id=$1', [op.operationId]), 0);
  });
  const revoke = async () => {
    const text = JSON.stringify({ contractVersion: 'sim-driver-guarded-db-v1', contributorHash: '1'.repeat(64) });
    return { text, op: { ...operation(), kind: 'revoke', cutoff: null,
      bodyDigest: await value(control, "SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') AS value", [text]) } };
  };
  await check('revoke persists exact scalar before COMMIT and recovers it without another DELETE', async () => {
    const { text, op } = await revoke(), d = dispatch(); let swallowed = false, executions = 0;
    const wrapped = { async query(sql, args) {
      if (sql.includes('execute_origin')) executions++;
      if (sql === 'COMMIT') assert.deepEqual(d.effects.get(op.operationId), { deletedBatchCount: 1 });
      const result = await executor.query(sql, args);
      if (sql === 'COMMIT' && !swallowed) { swallowed = true; throw new Error('deliberately ignored ACK'); } return result;
    } };
    const result = await producer(control, wrapped, d).runOnce(op, text);
    assert.equal(result.state, 'origin-commit-known'); assert.deepEqual(result.revokeEffect, { deletedBatchCount: 1 });
    await seed();
    const recovered = await producer(control, wrapped, d).runOnce(op, text);
    assert.deepEqual(recovered.revokeEffect, { deletedBatchCount: 1 }); assert.equal(executions, 1); assert.equal(await count(), 1);
    d.effects.clear();
    const missing = await producer(control, wrapped, d).probe(op);
    assert.equal(missing.state, 'origin-commit-known'); assert.equal(missing.revokeEffect, undefined);
    assert.equal(executions, 1); assert.equal(await count(), 1);
  });
  await check('failed durable scalar storage rolls back original revoke instead of committing effects', async () => {
    const { text, op } = await revoke(), d = dispatch();
    d.recordRevokeEffect = async () => { throw new Error('owned disk unavailable'); };
    const result = await producer(control, executor, d).runOnce(op, text);
    assert.equal(result.state, 'origin-no-effects-closed'); assert.equal(result.revokeEffect, undefined); assert.equal(await count(), 1);
  });
  for (const path of codeFiles) assert.equal(hash(await readFile(new URL(path, import.meta.url))), codePins[path]);
  for (const [path, pin] of Object.entries(inputs)) assert.equal(hash(await readFile(join(sim, path))), pin);
  succeeded = true;
} finally {
  for (const c of clients) try { await c.query('ROLLBACK'); await c.end(); } catch { /* No production clients. */ }
  if (running || existsSync(join(directory, 'data/postmaster.pid'))) {
    own(); const pid = (await readFile(join(directory, 'data/postmaster.pid'), 'utf8')).split('\n'); assert.equal(pid[1], join(directory, 'data'));
    await exec(join(pgBin, 'pg_ctl'), ['-D', join(directory, 'data'), '-m', 'fast', '-w', 'stop'], { env });
  }
  if (succeeded) { own(); await rm(directory, { recursive: true }); }
  else console.error('Owned failed fixture retained: ' + directory);
}
console.log(JSON.stringify({ contractVersion: 'cop-root-producer-sql-test-v1', passed: cases.length, cases, inputs, codePins,
  postgresVersion: '18.3', ownedClusterRemoved: succeeded, tcp: false, sourceUnchangedDuringRun: true,
  actualRootAuthority: false, actualNativeDelivery: false, actualRestore: false, productionChanged: false,
  ackQualification: 'Controller deliberately discarded ACK; not network packet loss.' }));
