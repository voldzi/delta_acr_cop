/** New owned PostgreSQL cluster only. No production DSN, network or secrets. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './root-records.mjs';
assert.deepEqual(process.argv.slice(2), ['--run']);
const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const foundation = '/Users/voldzi/Documents/Codex/2026-07-19/upgrade-proxmox-clusteru-c-lem-je-2/reports/cop-account-safety-20261014/isolated-continuity/001-guard-metadata.sql';
const sources = [foundation, join(repo, 'scripts/account-safety/002-root-reader.sql'), join(repo, 'scripts/account-safety/003-cop-consent-reader.sql')];
const bytes = await Promise.all(sources.map(p => readFile(p)));
assert.equal(sha256(bytes[0]), 'a29369e48a1380bb12ce3b40b9254d924e0d98a3b90f7cdcdc0fb7e9ba27aaba');
const actorSourcePath=join(repo,'scripts/account-safety/root-cop-actor.mjs');
const actorSource=await readFile(actorSourcePath,'utf8'), actorSourcePin=sha256(actorSource);
const surfaceQuery=actorSource.match(/const actual = await client\.query\(`(SELECT current_user AS current_role[\s\S]*?WHERE r\.rolname=current_user)`\);/);
assert.equal(surfaceQuery?.length,2,'Use the exact production read-surface query, not a fixture substitute.');
const pins = bytes.map(sha256), exec = promisify(execFile), pgBin = '/opt/homebrew/opt/postgresql@18/bin';
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => ['PATH', 'HOME', 'USER', 'LANG', 'TMPDIR'].includes(k)));
assert.match((await exec(join(pgBin, 'postgres'), ['--version'], { env })).stdout, /^postgres \(PostgreSQL\) 18\.3(?:\s|$)/);
const directory = await mkdtemp('/private/tmp/cop-safety-readers-pg-'), clients = [], checks = [];
assert.equal(dirname(await realpath(directory)), '/private/tmp'); await mkdir(join(directory, 'socket'), { mode: 0o700 });
const { Client } = createRequire(join(repo, 'apps/cop-api/package.json'))('pg');
async function connection(database, user = 'owned_fixture_admin') {
  const c = new Client({ host: join(directory, 'socket'), user, database, query_timeout: 5000 });
  c.on('error', () => undefined); clients.push(c); await c.connect(); return c;
}
const check = async (name, work) => { await work(); checks.push({ name, passed: true }); };
async function rejectedMigration(c, text, pattern) { await assert.rejects(c.query(text), pattern); await c.query('ROLLBACK'); }
let running = false, success = false;
try {
  await exec(join(pgBin, 'initdb'), ['-D', join(directory, 'data'), '--username=owned_fixture_admin', '--auth-local=trust', '--auth-host=reject', '--encoding=UTF8', '--locale=C'], { env });
  await exec(join(pgBin, 'pg_ctl'), ['-D', join(directory, 'data'), '-l', join(directory, 'log'), '-o',
    `-k ${join(directory, 'socket')} -c listen_addresses='' -c unix_socket_permissions=0700 -c log_statement=none -c log_min_error_statement=panic`, '-w', 'start'], { env }); running = true;
  const admin = await connection('postgres');
  await admin.query('CREATE DATABASE cop_account_safety_guard'); await admin.query('CREATE DATABASE cop');
  await admin.query('REVOKE ALL ON DATABASE cop_account_safety_guard FROM PUBLIC');
  const guard = await connection('cop_account_safety_guard'), cop = await connection('cop');
  await guard.query(bytes[0].toString());
  const roles = (await admin.query("SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolbypassrls FROM pg_roles WHERE rolname LIKE 'cop_guard_%' ORDER BY rolname")).rows;
  await check('guard reader supplements actual foundation with NOLOGIN, no membership and SELECT-only RLS', async () => {
    await guard.query(bytes[1].toString());
    const r = (await guard.query("SELECT rolcanlogin,rolsuper,rolinherit,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolconnlimit FROM pg_roles WHERE rolname='cop_guard_root_reader'")).rows[0];
    assert.deepEqual(Object.values(r), [false, false, false, false, false, false, false, 0]);
    assert.equal((await guard.query("SELECT count(*)::integer n FROM pg_auth_members WHERE member='cop_guard_root_reader'::regrole OR roleid='cop_guard_root_reader'::regrole")).rows[0].n, 0);
    assert.deepEqual((await guard.query("SELECT polcmd,pg_get_expr(polqual,polrelid) AS qualifier FROM pg_policy WHERE polrelid='cop_guard.owner_receipts'::regclass AND polname='root_readonly_receipt_read'")).rows, [{ polcmd: 'r', qualifier: 'true' }]);
  });
  // A superuser session can SET ROLE again using its session authority, so it
  // cannot be used to prove denial of role escalation. These disposable LOGIN
  // wrappers have only CONNECT and membership in the just-tested reader role.
  await admin.query('CREATE ROLE owned_fixture_guard_reader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
  await guard.query('GRANT CONNECT ON DATABASE cop_account_safety_guard TO owned_fixture_guard_reader; GRANT cop_guard_root_reader TO owned_fixture_guard_reader');
  const reader = await connection('cop_account_safety_guard', 'owned_fixture_guard_reader');
  await check('actual SET ROLE reads all nine metadata tables and pg control facts without RLS bypass', async () => {
    await reader.query('SET ROLE cop_guard_root_reader');
    for (const table of ['guard_identity', 'policies', 'fence_journal', 'dataset_bindings', 'runtime_bindings', 'accepted_runtime_proofs', 'replay_operations', 'owner_receipts', 'checkpoint_acceptances'])
      await reader.query('SELECT count(*) FROM cop_guard.' + table);
    await reader.query('SELECT system_identifier FROM pg_control_system()'); await reader.query('SELECT timeline_id FROM pg_control_checkpoint()');
    await reader.query('RESET ROLE');
  });
  await check('metadata writes and escalation are denied by actual ACLs, not only a default read-only setting', async () => {
    await reader.query('SET ROLE cop_guard_root_reader');
    for (const sql of ['DELETE FROM cop_guard.guard_identity', 'TRUNCATE cop_guard.fence_journal', 'CREATE TABLE cop_guard.forbidden(id int)',
      'SET ROLE cop_guard_root_checkpoint_acceptor', 'SELECT cop_guard.prefix_digest(0)']) await assert.rejects(reader.query(sql), /permission denied/);
    await reader.query('RESET ROLE');
  });
  await check('one-shot metadata rerun and wrong target database do not alter authority', async () => {
    await rejectedMigration(guard, bytes[1].toString(), /reader_role_already_exists/);
    await rejectedMigration(cop, bytes[1].toString(), /wrong_guard_database/);
    assert.deepEqual((await admin.query("SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolbypassrls FROM pg_roles WHERE rolname LIKE 'cop_guard_%' AND rolname<>'cop_guard_root_reader' ORDER BY rolname")).rows, roles);
  });
  await guard.query('DROP POLICY root_readonly_receipt_read ON cop_guard.owner_receipts; DROP OWNED BY cop_guard_root_reader; DROP ROLE cop_guard_root_reader');
  await check('inherited PUBLIC column UPDATE prevents metadata reader installation atomically', async () => {
    await guard.query('GRANT UPDATE(application_id) ON cop_guard.guard_identity TO PUBLIC');
    await rejectedMigration(guard, bytes[1].toString(), /reader_write_privilege_forbidden/);
    assert.equal((await guard.query("SELECT to_regrole('cop_guard_root_reader') AS role")).rows[0].role, null);
    await guard.query('REVOKE UPDATE(application_id) ON cop_guard.guard_identity FROM PUBLIC');
  });
  await check('PUBLIC database TEMP is refused without changing the database ACL', async () => {
    await guard.query('GRANT TEMP ON DATABASE cop_account_safety_guard TO PUBLIC');
    await rejectedMigration(guard, bytes[1].toString(), /guard_database_public_access/);
    await guard.query('REVOKE TEMP ON DATABASE cop_account_safety_guard FROM PUBLIC');
  });
  await cop.query(`CREATE TABLE public.cop_driver_measurement_config(id boolean PRIMARY KEY,secret_fingerprint text);
    CREATE TABLE public.cop_driver_measurement_consents(subject_id text PRIMARY KEY,revoked_at timestamptz,pending_days text[],granted_at timestamptz);
    CREATE TABLE public.cop_driver_consent_erasure_fences(subject_hash text PRIMARY KEY,owner_issuer text,operation_id uuid,pending_days text[])`);
  await check('consent reader refuses an old schema without adopting its missing issuer', async () => {
    await rejectedMigration(cop, bytes[2].toString(), /reviewed_cop_consent_columns/);
    assert.equal((await cop.query("SELECT to_regrole('cop_guard_consent_reader') AS role")).rows[0].role, null);
    await cop.query('ALTER TABLE public.cop_driver_measurement_consents ADD COLUMN owner_issuer text');
    await cop.query('ALTER TABLE public.cop_driver_measurement_consents ENABLE ROW LEVEL SECURITY');
    await rejectedMigration(cop, bytes[2].toString(), /cop_consent_rls_inventory_review_required/);
    await cop.query('ALTER TABLE public.cop_driver_measurement_consents DISABLE ROW LEVEL SECURITY');
  });
  await check('inherited PUBLIC definer function and column write each prevent consent reader installation', async () => {
    await cop.query('CREATE FUNCTION public.owned_fixture_definer() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$SELECT 1$$');
    await rejectedMigration(cop, bytes[2].toString(), /consent_reader_definer_function_review/); await cop.query('DROP FUNCTION public.owned_fixture_definer()');
    await cop.query('GRANT UPDATE(subject_id) ON public.cop_driver_measurement_consents TO PUBLIC');
    await rejectedMigration(cop, bytes[2].toString(), /consent_reader_effective_write/); await cop.query('REVOKE UPDATE(subject_id) ON public.cop_driver_measurement_consents FROM PUBLIC');
  });
  await check('consent reader reads only approved columns and cannot mutate or read other account data', async () => {
    await cop.query(bytes[2].toString());
    await admin.query('CREATE ROLE owned_fixture_consent_reader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
    await cop.query('GRANT CONNECT ON DATABASE cop TO owned_fixture_consent_reader; GRANT cop_guard_consent_reader TO owned_fixture_consent_reader');
    const consentReader = await connection('cop', 'owned_fixture_consent_reader'); await consentReader.query('SET ROLE cop_guard_consent_reader');
    await consentReader.query('SELECT id,secret_fingerprint FROM public.cop_driver_measurement_config');
    await consentReader.query('SELECT subject_id,owner_issuer,revoked_at,pending_days FROM public.cop_driver_measurement_consents');
    for (const sql of ['SELECT granted_at FROM public.cop_driver_measurement_consents', 'DELETE FROM public.cop_driver_measurement_consents',
      'UPDATE public.cop_driver_measurement_config SET secret_fingerprint=secret_fingerprint', 'CREATE TABLE public.forbidden(id int)', 'SET ROLE cop_guard_owner'])
      await assert.rejects(consentReader.query(sql), /permission denied/);
    const surface=(await consentReader.query(surfaceQuery[1])).rows[0];
    assert.equal(surface.current_role,'cop_guard_consent_reader');assert.equal(surface.session_role,'owned_fixture_consent_reader');
    assert.equal(surface.tables,3);assert.equal(surface.surface,true);assert.equal(surface.restricted,true);assert.equal(surface.memberships,0);
    await cop.query('GRANT UPDATE(subject_id) ON public.cop_driver_measurement_consents TO PUBLIC');
    assert.equal((await consentReader.query(surfaceQuery[1])).rows[0].surface,false);
    await cop.query('REVOKE UPDATE(subject_id) ON public.cop_driver_measurement_consents FROM PUBLIC');
    await cop.query('ALTER TABLE public.cop_driver_measurement_consents ENABLE ROW LEVEL SECURITY');
    assert.equal((await consentReader.query(surfaceQuery[1])).rows[0].surface,false);
    await cop.query('ALTER TABLE public.cop_driver_measurement_consents DISABLE ROW LEVEL SECURITY');
    await consentReader.query('RESET ROLE');
  });
  for (let i = 0; i < sources.length; i++) assert.equal(sha256(await readFile(sources[i])), pins[i]); assert.equal(sha256(await readFile(actorSourcePath)),actorSourcePin); success = true;
} finally {
  for (const c of clients) await c.end().catch(() => undefined);
  if (running) await exec(join(pgBin, 'pg_ctl'), ['-D', join(directory, 'data'), '-m', 'fast', '-w', 'stop'], { env });
  if (success) await rm(directory, { recursive: true }); else process.stderr.write('Owned reader fixture retained: ' + directory + '\n');
}
process.stdout.write(JSON.stringify({ contractVersion: 'cop-root-readers-sql-fixture-v1', checks, sourcePins: pins, actualReadSurfaceQuerySourcePin:actorSourcePin, actualReadSurfaceQuery:true,
  actualPostgres: '18.3', actualAclAndRlsPolicy: true, nonemptyOwnerReceiptReadback: false, syntheticAccountsOnly: true,
  fixtureLoginWrappers: true, productionLoginActivated: false, profileRolesRemainNOLOGIN: true,
  productionChanged: false, fixtureRemoved: success, tcp: false }) + '\n');
