"""Owned PG18 fixture only; no application imports, installs or native authority.

Both SQL connections are driven here by the trusted fixture controller. The
ordinary runtime never supplies a connection, SQL, backend or XID. This does not
implement or accept production ROOT-controlled composition/delivery/custody.
"""
import hashlib
import json
import queue
from pathlib import Path
import re
import subprocess
import threading
import time
import unittest

BASE = Path(__file__).resolve().parent
IMAGE = 'sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873'
NAME = 'cop-retention-xid-b0-20261014'
LABEL = 'codex.cop.retention.fixture=20261014-v1'
DOCKER = ['docker', '--host', 'unix:///Users/voldzi/.docker/run/docker.sock']
DATABASE = 'retention_fixture'
CONTROL = 'cop_retention_control'
EXECUTOR = 'cop_retention_exec'
RUNTIME = 'cop_retention_runtime'
INCARNATION = '00000000-0000-4000-8000-000000000001'
CUTOFF = '2026-10-14T12:00:00.000Z'
BODY, SCHEMA = 'a' * 64, 'b' * 64
A, B = '1' * 64, '2' * 64
EVENTS, SESSIONS = [], []
CONTAINER_ID = None


def run(args, data=None, timeout=20, check=True):
    result = subprocess.run(args, input=data, text=True, capture_output=True, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or 'owned_command_failed')
    return result


def docker(*args, **kw):
    return run(DOCKER + list(args), **kw)


def sql(role, text, check=True):
    result = docker('exec', '-i', CONTAINER_ID, 'psql', '-X', '-qAt', '-v',
                    'ON_ERROR_STOP=1', '-U', role, '-d', DATABASE,
                    data=text + '\n', check=check)
    return result


def value(role, text):
    out = sql(role, text).stdout.strip()
    return json.loads(out)


def literal(value):
    if value is None:
        return 'NULL'
    return "'" + str(value).replace("'", "''") + "'"


class OriginConnection:
    """Persistent, fixture-controller-owned executor connection only."""
    def __init__(self):
        self.process = subprocess.Popen(DOCKER + ['exec', '-i', CONTAINER_ID, 'psql',
            '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', EXECUTOR, '-d', DATABASE],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, bufsize=1)
        self.lines, self.errors = queue.Queue(), []
        self.sequence = 0
        threading.Thread(target=self._read, daemon=True).start()
        self.error_reader=threading.Thread(target=self._errors, daemon=True)
        self.error_reader.start()
        SESSIONS.append(self)

    def _read(self):
        for line in self.process.stdout:
            self.lines.put(line.rstrip('\n'))
        self.lines.put(None)

    def _errors(self):
        self.errors.extend(line.rstrip('\n') for line in self.process.stderr)

    def send(self, text):
        self.process.stdin.write(text + '\n')
        self.process.stdin.flush()

    def command(self, text, timeout=8):
        self.sequence += 1
        token = '__owned_result_' + str(self.sequence)
        self.send(text + '\n\\echo ' + token)
        end, lines = time.monotonic() + timeout, []
        while time.monotonic() < end:
            try:
                line = self.lines.get(timeout=max(.01, end - time.monotonic()))
            except queue.Empty:
                break
            if line == token:
                return lines
            if line is None:
                self.process.wait(timeout=2)
                self.error_reader.join(timeout=1)
                raise RuntimeError('\n'.join(self.errors) or 'owned_origin_connection_ended')
            if line:
                lines.append(line)
        raise RuntimeError('owned_origin_result_timeout')

    def begin(self):
        lines = self.command("BEGIN; SELECT jsonb_build_object('xid',pg_current_xact_id()::text,"
            "'pid',pg_backend_pid(),'start',backend_start::text) FROM pg_stat_activity WHERE pid=pg_backend_pid();")
        return json.loads(lines[-1])

    def close(self):
        if self.process.poll() is None:
            try:
                self.send('ROLLBACK;\\q')
                self.process.wait(timeout=2)
            except (BrokenPipeError, subprocess.TimeoutExpired):
                self.process.terminate()
                try:
                    self.process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    self.process.kill(); self.process.wait(timeout=2)


def operation(number):
    return '10000000-0000-4000-8000-' + str(number).zfill(12)


def register(op, code='whole-cop-expiry-v1', contributor=None, until=None,
             cutoff=CUTOFF, body=BODY, store=INCARNATION):
    return value(CONTROL, 'SELECT cop_retention_source.register_origin(' + ','.join(map(literal,
        [op, store, code, '20000000-0000-4000-8000-000000000001', body, SCHEMA,
         cutoff, contributor, until])) + ');')


def claim(op, descriptor):
    return value(CONTROL, 'SELECT cop_retention_source.claim_origin(' + ','.join(map(literal,
        [op, INCARNATION, descriptor['xid'], descriptor['pid'], descriptor['start']])) + ');')


def resolve(op):
    return value(CONTROL, 'SELECT cop_retention_source.resolve_or_seal(' + literal(op) + ');')


def counts():
    fields = [(name, 'public.driver_measurement_' + name) for name in ('receipts', 'intervals', 'eta', 'revocations')]
    fields += [('fences', 'public.driver_account_erasure_fences')]
    return value('postgres', 'SELECT jsonb_build_object(' + ','.join(
        literal(name) + ',(SELECT count(*) FROM ' + table + ')' for name, table in fields) + ');')


def seed():
    sql('postgres', """
TRUNCATE public.driver_measurement_receipts,public.driver_measurement_intervals,
 public.driver_measurement_eta,public.driver_measurement_revocations;
INSERT INTO public.driver_measurement_receipts(owner,batch_id,contributor_hash,expires_at) VALUES
 ('cop','30000000-0000-4000-8000-000000000001','""" + A + """','2026-10-10T00:00:00Z'),
 ('cop','30000000-0000-4000-8000-000000000002','""" + B + """','2026-10-14T12:00:00Z'),
 ('cop','30000000-0000-4000-8000-000000000003','""" + A + """','2026-10-15T00:00:00Z');
INSERT INTO public.driver_measurement_intervals(owner,batch_id,measurement_key,dataset)
 SELECT owner,batch_id,md5(batch_id::text)||md5(batch_id::text),'synthetic-owned-dataset' FROM public.driver_measurement_receipts;
INSERT INTO public.driver_measurement_eta(owner,batch_id,observation_id,contributor_hash,dataset)
 SELECT owner,batch_id,batch_id,contributor_hash,'synthetic-owned-dataset' FROM public.driver_measurement_receipts;
INSERT INTO public.driver_measurement_revocations VALUES
 ('cop','""" + A + """','2026-10-10T00:00:00Z'),('cop','""" + B + """','2026-10-15T00:00:00Z');
""")


class MechanicalStoreTests(unittest.TestCase):
    def setUp(self):
        seed()

    def tearDown(self):
        for connection in list(SESSIONS):
            connection.close()
        SESSIONS.clear()

    def event(self, name, **facts):
        EVENTS.append({'case': name, **facts})

    def denied(self, role, statement, expected='permission denied'):
        result = sql(role, statement, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(expected, result.stderr)

    def test_01_runtime_delete_marker_and_role_bypasses_denied(self):
        for role in (RUNTIME, EXECUTOR):
            for table in ('receipts', 'intervals', 'eta', 'revocations'):
                self.denied(role, 'DELETE FROM public.driver_measurement_' + table + ';')
            self.denied(role, "UPDATE cop_retention_source.origins SET state='committed',committed_marker=true;")
            self.denied(role, 'TRUNCATE cop_retention_source.origins;')
            self.denied(role, 'SET ROLE cop_retention_owner;')
            self.denied(role, 'SET ROLE cop_retention_control;')
        self.denied(RUNTIME, 'SELECT cop_retention_source.expire_origin(' + literal(operation(1)) + ');')
        self.assertEqual(counts(), {'receipts':3,'intervals':3,'eta':3,'revocations':2,'fences':1})
        self.event('runtime_raw_delete_marker_roles', deniedStatements=17, effectsChanged=False)

    def test_02_claim_once_and_immutable_binding(self):
        op = operation(2); register(op); origin = OriginConnection(); desc = origin.begin()
        self.assertEqual(claim(op, desc)['state'], 'claimed')
        with self.assertRaisesRegex(RuntimeError, 'origin_claim_already_issued_or_closed'):
            claim(op, desc)
        with self.assertRaisesRegex(RuntimeError, 'origin_registration_conflict'):
            register(op, body='c' * 64)
        self.denied(EXECUTOR, 'SELECT cop_retention_source.resolve_or_seal(' + literal(op) + ');')
        origin.command('ROLLBACK;')
        self.assertEqual(resolve(op)['state'], 'origin_no_effect_closed')
        with self.assertRaisesRegex(RuntimeError, 'origin_claim_already_issued_or_closed'):
            claim(op, desc)
        self.event('once_claim_immutable', duplicateDenied=True, changedBodyDenied=True, sealResetDenied=True)

    def test_03_commit_marker_and_four_effects_share_transaction(self):
        op = operation(3); register(op); origin = OriginConnection(); desc = origin.begin(); claim(op,desc)
        origin.command('SELECT cop_retention_source.expire_origin(' + literal(op) + ');')
        self.assertEqual(resolve(op)['state'], 'pending')
        origin.command('COMMIT;')
        self.assertEqual(resolve(op)['state'], 'origin_commit_known')
        self.assertEqual(counts(), {'receipts':1,'intervals':1,'eta':1,'revocations':1,'fences':1})
        self.event('commit_marker_four_effects', markerKnown=True, permanentFencePreserved=True)

    def test_04_rollback_then_new_xid_cannot_reuse_claim(self):
        op=operation(4); register(op); origin=OriginConnection(); first=origin.begin(); claim(op,first)
        origin.command('SELECT cop_retention_source.expire_origin(' + literal(op) + '); ROLLBACK;')
        self.assertEqual(counts(), {'receipts':3,'intervals':3,'eta':3,'revocations':2,'fences':1})
        second=origin.begin(); self.assertNotEqual(first['xid'],second['xid'])
        with self.assertRaisesRegex(RuntimeError,'origin_claim_already_issued_or_closed'):
            claim(op,second)
        with self.assertRaisesRegex(RuntimeError,'origin_transaction_mismatch'):
            origin.command('SELECT cop_retention_source.expire_origin(' + literal(op) + ');')
        self.assertEqual(resolve(op)['state'],'origin_no_effect_closed')
        self.event('rollback_new_xid', rollbackEffectsAbsent=True, newXidDenied=True)

    def test_05_seal_denies_late_original_while_transaction_alive(self):
        op=operation(5); register(op); origin=OriginConnection(); desc=origin.begin(); claim(op,desc)
        resolved=resolve(op); self.assertEqual(resolved['state'],'origin_no_effect_closed')
        alive=value('postgres',"SELECT jsonb_build_object('alive',count(*)=1,'inTransaction',bool_and(xact_start IS NOT NULL)) FROM pg_stat_activity WHERE pid=" + str(desc['pid']) + ';')
        self.assertTrue(alive['alive']); self.assertTrue(alive['inTransaction'])
        with self.assertRaisesRegex(RuntimeError,'origin_not_claimed_for_expiry'):
            origin.command('SELECT cop_retention_source.expire_origin(' + literal(op) + ');')
        self.assertEqual(counts(), {'receipts':3,'intervals':3,'eta':3,'revocations':2,'fences':1})
        self.event('seal_late_original', originalAliveAtSeal=True, rollbackNotInferred=True, lateDeleteDenied=True)

    def test_06_active_executor_lock_keeps_sealer_pending(self):
        op=operation(6); register(op); origin=OriginConnection(); desc=origin.begin(); claim(op,desc)
        origin.command('SELECT cop_retention_source.expire_origin(' + literal(op) + ');')
        before=time.monotonic(); result=resolve(op)
        self.assertEqual(result['state'],'pending'); self.assertEqual(result['reason'],'origin_busy')
        self.assertLess(time.monotonic()-before,3)
        origin.command('ROLLBACK;')
        self.assertEqual(resolve(op)['state'],'origin_no_effect_closed')
        self.event('active_executor_lock', sealerPending=True, terminalOnlyAfterOriginEnd=True)

    def test_07_ambiguous_commit_uses_readback_without_reexecution(self):
        op=operation(7); register(op); origin=OriginConnection(); desc=origin.begin(); claim(op,desc)
        origin.command('SELECT cop_retention_source.expire_origin(' + literal(op) + ');')
        # Controller deliberately receives no originating COMMIT completion.
        # psql remains the protocol client: this is withheld controller delivery,
        # not a packet-loss/native-RPC acceptance test.
        origin.send('COMMIT; SELECT pg_sleep(2);')
        resolved=resolve(op); self.assertEqual(resolved['state'],'origin_commit_known')
        self.assertEqual(counts(), {'receipts':1,'intervals':1,'eta':1,'revocations':1,'fences':1})
        self.event('ambiguous_controller_commit_ack', originatingAckObservedByController=False,
                   readbackCommitted=True, destructiveExecutions=1, packetLossTest=False)

    def test_08_missing_origin_unknown_and_future_cutoff_excluded(self):
        missing=operation(8); result=resolve(missing)
        self.assertEqual(result['state'],'pending'); self.assertEqual(result['reason'],'origin_missing')
        op=operation(80); register(op,cutoff='2026-10-09T00:00:00.000Z')
        origin=OriginConnection(); desc=origin.begin(); claim(op,desc)
        origin.command('SELECT cop_retention_source.expire_origin(' + literal(op) + '); COMMIT;')
        self.assertEqual(resolve(op)['state'],'origin_commit_known')
        self.assertEqual(counts(), {'receipts':3,'intervals':3,'eta':3,'revocations':2,'fences':1})
        self.event('missing_origin_and_cutoff', missingStayedUnknown=True, laterRowsPreserved=True)

    def test_09_revocation_source_seam_is_contributor_bounded(self):
        with self.assertRaises(RuntimeError):
            register(operation(90),code='contributor-revocation-source-v1',cutoff=None,contributor=None,until='2026-11-01T00:00:00Z')
        op=operation(9); register(op,code='contributor-revocation-source-v1',cutoff=None,contributor=A,until='2026-11-01T00:00:00Z')
        origin=OriginConnection(); desc=origin.begin(); claim(op,desc)
        origin.command('SELECT cop_retention_source.revoke_contributor_origin(' + literal(op) + '); COMMIT;')
        self.assertEqual(resolve(op)['state'],'origin_commit_known')
        self.assertEqual(counts(), {'receipts':1,'intervals':1,'eta':1,'revocations':2,'fences':1})
        self.event('revocation_source_seam', otherContributorPreserved=True, missingContributorDenied=True,
                   actualConsentOrErasureAuthorityAccepted=False)


def main():
    global CONTAINER_ID
    proof={'status':'OWNED_MECHANICAL_SQL_FIXTURE_ONLY','image':IMAGE,'containerName':NAME,
           'actual':{key:False for key in ('nativeAuthority','nativeRpc','deliveryAccepted','rootCustody',
              'productionRootOriginComposition','producerAccepted','policyAccepted','storeContinuityAccepted',
              'restoreAccepted','productionInstall','realDataUsed')},'tests':[]}
    sql_before=hashlib.sha256((BASE/'candidate.sql').read_bytes()).hexdigest()
    volumes_before=[]; created=False; result=None; fatal=None
    try:
        docker('image','inspect',IMAGE,'--format','{{.Id}}')
        existing=docker('container','inspect',NAME,check=False)
        if existing.returncode==0: raise RuntimeError('owned_name_already_exists_not_adopted')
        volumes_before=docker('volume','ls','--format','{{.Name}}').stdout.splitlines()
        started=docker('run','--detach','--pull=never','--name',NAME,'--label',LABEL,
            '--network=none','--read-only','--user=postgres','--security-opt=no-new-privileges:true',
            '--cap-drop=ALL','--pids-limit=64','--memory=256m','--cpus=1',
            '--tmpfs','/var/lib/postgresql:rw,nosuid,nodev,mode=0700,uid=70,gid=70',
            '--tmpfs','/var/run/postgresql:rw,nosuid,nodev,mode=0777',
            '--tmpfs','/tmp:rw,nosuid,nodev,mode=1777',
            '-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB='+DATABASE,
            IMAGE,'-c','listen_addresses=','-c','max_prepared_transactions=0',
            '-c','log_statement=none','-c','logging_collector=off')
        CONTAINER_ID=started.stdout.strip()
        if not re.fullmatch(r'[0-9a-f]{64}',CONTAINER_ID): raise RuntimeError('owned_container_id_invalid')
        created=True
        deadline=time.monotonic()+35
        while time.monotonic()<deadline:
            # The image temporarily starts postgres during initdb, then restarts.
            # Wait for final exec-to-postgres PID1 rather than accepting that
            # temporary server's pg_isready response.
            final=docker('exec',CONTAINER_ID,'cat','/proc/1/comm',check=False)
            ready=docker('exec',CONTAINER_ID,'pg_isready','-U','postgres','-d',DATABASE,check=False)
            if final.stdout.strip()=='postgres' and ready.returncode==0: break
            time.sleep(.15)
        else: raise RuntimeError('owned_postgres_not_ready')
        inspected=json.loads(docker('inspect',CONTAINER_ID).stdout)[0]
        proof['isolation']={'networkMode':inspected['HostConfig']['NetworkMode'],
          'readOnlyRootfs':inspected['HostConfig']['ReadonlyRootfs'],'privileged':inspected['HostConfig']['Privileged'],
          'ports':inspected['HostConfig']['PortBindings'],'mountTypes':[m['Type'] for m in inspected['Mounts']],
          'tmpfsPaths':sorted(inspected['HostConfig']['Tmpfs']),'globalDockerContextChanged':False}
        if proof['isolation']['networkMode']!='none' or not proof['isolation']['readOnlyRootfs'] or proof['isolation']['ports'] or any(t!='tmpfs' for t in proof['isolation']['mountTypes']):
            raise RuntimeError('owned_isolation_mismatch')
        proof['server']=value('postgres',"SELECT jsonb_build_object('version',current_setting('server_version'),'preparedTransactions',current_setting('max_prepared_transactions'));")
        sql('postgres',(BASE/'candidate.sql').read_text())
        sql('postgres',"INSERT INTO public.driver_account_erasure_fences VALUES('40000000-0000-4000-8000-000000000001');")
        result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(MechanicalStoreTests))
        proof['tests']=EVENTS
        proof['result']={'run':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),'success':result.wasSuccessful() and result.testsRun==9}
    except BaseException as error:
        fatal=str(error); proof['fatal']=fatal
    finally:
        for connection in list(SESSIONS):
            try: connection.close()
            except BaseException: pass
        if created:
            if fatal:
                try:
                    logs=docker('logs',CONTAINER_ID,check=False)
                    (BASE/'owned-bootstrap-error.log').write_text(logs.stdout+logs.stderr)
                except BaseException: pass
            try:
                docker('rm','--force',CONTAINER_ID)
                proof['ownedContainerRemoved']=docker('inspect',CONTAINER_ID,check=False).returncode!=0
            except BaseException as error: proof['cleanupError']=str(error)
        else: proof['ownedContainerRemoved']=False
        try:
            volumes_after=docker('volume','ls','--format','{{.Name}}').stdout.splitlines()
            proof['volumes']={'beforeCount':len(volumes_before),'afterCount':len(volumes_after),
                'addedCount':len(set(volumes_after)-set(volumes_before)),'removedCount':len(set(volumes_before)-set(volumes_after))}
        except BaseException as error: proof['volumeReadError']=str(error)
        proof['sourcePins']={name:hashlib.sha256((BASE/name).read_bytes()).hexdigest() for name in ('candidate.sql','test_owned_pg.py')}
        proof['sourceUnchangedDuringRun']=proof['sourcePins']['candidate.sql']==sql_before
        (BASE/'proof.json').write_text(json.dumps(proof,indent=2,sort_keys=True)+'\n')
    print(json.dumps({'proof':str(BASE/'proof.json'),'result':proof.get('result'),'fatal':fatal,'ownedContainerRemoved':proof.get('ownedContainerRemoved')},sort_keys=True))
    return 0 if not fatal and result and result.wasSuccessful() and result.testsRun==9 and proof.get('ownedContainerRemoved') and proof['sourceUnchangedDuringRun'] else 1


if __name__=='__main__':
    raise SystemExit(main())
