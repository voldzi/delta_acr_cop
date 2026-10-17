"""Concrete remaining reset: Matrix/metadata, both media stores, and COP Edge.
No CLI, app endpoint, positive receipt injection, automatic resume or backup.
prepare_remaining_reset must run before the common owner stops any writer.
"""
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import select
import shlex
import socket
import subprocess
import re
import textwrap
import time
import uuid
from datetime import datetime

_prepared = None
ROOT = Path(__file__).parent


def need(value, code):
    if not value:
        raise RuntimeError(code)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def source(plan, relative):
    s = plan['sources']['cop']
    need(relative in s['files'] and not Path(relative).is_absolute() and '..' not in Path(relative).parts,
         'RESET_REMAINING_SOURCE_SCOPE')
    path = Path(s['root'])/relative
    raw = path.read_bytes()
    need(path.resolve() == path and hashlib.sha256(raw).hexdigest() == s['files'][relative],
         'RESET_REMAINING_SOURCE_CHANGED')
    return raw


def load(plan, filename, name):
    relative = 'scripts/account-safety/'+filename
    source(plan, relative)
    spec = importlib.util.spec_from_file_location(name, Path(plan['sources']['cop']['root'])/relative)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def validate_configuration(plan, private):
    need(private.get('resetEpoch') == plan['resetEpoch'] and private.get('tokensNotBefore') == plan['tokensNotBefore'],
         'RESET_REMAINING_EPOCH')
    value = private.get('remaining')
    need(isinstance(value, dict) and set(value) == {'contractVersion', 'connections', 'nativeAdminToken', 'reviewedPlans'}
         and value['contractVersion'] == 'cop-clean-remaining-private-v1', 'RESET_REMAINING_CONFIG')
    plans = value['reviewedPlans']
    need(set(plans) == {'messaging', 'media', 'edge'} and set(plans['messaging']) == {'native', 'metadata'}
         and set(plans['media']) == {'nativeMedia', 's3'}, 'RESET_REMAINING_PLAN_SCOPE')
    for key in plans:
        need(digest(plans[key]) == plan['reviewedPlanDigests'][key], 'RESET_REMAINING_PLAN_DIGEST')
    connections = value['connections']
    need(set(connections) == {'native', 'metadata'}, 'RESET_REMAINING_DATABASE_SCOPE')
    for key, database in [('native', 'csm_synapse'), ('metadata', 'csm_messaging')]:
        c = connections[key]
        need(set(c) == {'host', 'port', 'dbname', 'user', 'password', 'sslmode', 'sslrootcert'}
             and c['host'] == 'haproxy.home.cz' and c['port'] == 5000 and c['dbname'] == database
             and c['user'] == 'postgres' and isinstance(c['password'], str) and c['password']
             and c['sslmode'] == 'verify-full' and c['sslrootcert'] == '/etc/vcode-cop-pgbouncer/postgres-ca.crt',
             'RESET_REMAINING_DATABASE_SCOPE')
    need(isinstance(value['nativeAdminToken'], str) and 20 <= len(value['nativeAdminToken']) <= 16384,
         'RESET_REMAINING_NATIVE_CREDENTIAL')
    return value


def enroll_media_closure(plan, connections, evidence, s3, admission):
    """Trusted Root enrollment from this invocation's actual provider result.
    Runtime retains SELECT only; no receipt can be submitted through COP API.
    """
    admission.assert_current()
    need(evidence.get('contractVersion') == 'cop-clean-s3-reset-result-v1'
         and evidence.get('evidenceDigest') == s3.digest(evidence.get('evidence')), 'RESET_MEDIA_EVIDENCE_INVALID')
    e = evidence['evidence']
    need(e['contractVersion'] == 'cop-clean-s3-closure-evidence-v1' and e['bucket'] == s3.BUCKET
         and e['endpoint'] == s3.ENDPOINT and e['legacyAdmittedBodiesTerminated'] is True
         and e['oldCredentialDenied'] is True and e['remainingObjects'] == 0
         and e['credentialFingerprint'] != e['previousCredentialFingerprint']
         and s3.credential_fingerprint(s3.read_env()[2]) == e['credentialFingerprint'], 'RESET_MEDIA_EVIDENCE_INVALID')
    stopped, started, denied = [datetime.fromisoformat(e[k].replace('Z', '+00:00')) for k in
                               ['providerStoppedAt', 'providerRestartedAt', 'oldCredentialDeniedAt']]
    need(stopped < started <= denied, 'RESET_MEDIA_PROVIDER_TIME_INVALID')
    guard, cop = connections['guard'], connections['cop']
    try:
        g, c = guard.cursor(), cop.cursor()
        for q in (g, c):
            q.execute('BEGIN')
            q.execute("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; SET LOCAL log_statement='none'; SET LOCAL log_min_error_statement='panic'; SET LOCAL log_parameter_max_length=0; SET LOCAL log_parameter_max_length_on_error=0")
        g.execute("SELECT current_database(),current_user,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user)")
        need(g.fetchone() == ('cop_account_safety_guard', 'postgres', True), 'RESET_MEDIA_GUARD_ADMIN_REQUIRED')
        c.execute('SELECT current_database()'); need(c.fetchone() == ('cop',), 'RESET_MEDIA_TARGET_DATABASE')
        c.execute("SELECT value FROM public.cop_mobility_v1 WHERE key='account-safety:store-identity-v1'")
        rows = c.fetchall(); need(len(rows) == 1, 'RESET_MEDIA_TARGET_BINDING')
        marker = rows[0][0]
        c.execute("SELECT value FROM public.cop_mobility_v1 WHERE key='account-erasure:configuration-v1'")
        rows = c.fetchall(); need(len(rows) == 1, 'RESET_MEDIA_TARGET_BINDING')
        config = rows[0][0]
        g.execute("SELECT cfg.application_store_id::text,cfg.configuration_fingerprint,r.incarnation_id::text,r.restore_generation FROM cop_safety_v2.configuration cfg JOIN cop_safety_v2.dataset_replays r ON r.owner='cop' AND r.store_id=cfg.application_store_id WHERE cfg.singleton")
        rows = g.fetchall(); need(len(rows) == 1, 'RESET_MEDIA_GUARD_BINDING')
        store, fingerprint, incarnation, generation = rows[0]
        need(marker == {'storeId':store, 'incarnationId':incarnation} and config.get('version') == 4
             and config.get('storeId') == store and config.get('fingerprint') == fingerprint
             and config.get('datasetBinding') == {'incarnationId':incarnation, 'restoreGeneration':int(generation)},
             'RESET_MEDIA_TARGET_BINDING')
        g.execute("SELECT to_regclass('cop_safety_v2.media_upload_closures') IS NOT NULL")
        if not g.fetchone()[0]:
            migration = source(plan, 'scripts/account-safety/011_media_upload_closure.sql').decode()
            need(migration.count('\nBEGIN;\n') == 1 and migration.endswith('COMMIT;\n'), 'RESET_MEDIA_MIGRATION_SCOPE')
            migration = migration.replace('\nBEGIN;\n', '\n', 1).removesuffix('COMMIT;\n')
            g.execute('SET LOCAL ROLE cop_safety_v2_owner'); g.execute(migration); g.execute('RESET ROLE')
        g.execute("SELECT pg_get_userbyid(relowner),relkind FROM pg_class WHERE oid='cop_safety_v2.media_upload_closures'::regclass")
        need(g.fetchone() == ('cop_safety_v2_owner', 'r'), 'RESET_MEDIA_TABLE_OWNER')
        g.execute("SELECT tgname,tgenabled,tgfoid='cop_safety_v2.immutable()'::regprocedure FROM pg_trigger WHERE tgrelid='cop_safety_v2.media_upload_closures'::regclass AND NOT tgisinternal ORDER BY tgname")
        need(g.fetchall() == [('immutable_rows','O',True), ('immutable_truncate','O',True)], 'RESET_MEDIA_TABLE_IMMUTABILITY')
        g.execute("SELECT has_table_privilege('cop_safety_v2_runtime','cop_safety_v2.media_upload_closures','SELECT'),has_table_privilege('cop_safety_v2_runtime','cop_safety_v2.media_upload_closures','INSERT,UPDATE,DELETE,TRUNCATE')")
        need(g.fetchone() == (True, False), 'RESET_MEDIA_RUNTIME_PERMISSIONS')
        g.execute("SELECT has_schema_privilege('cop_safety_v2_runtime','cop_safety_v2','USAGE')")
        need(g.fetchone() == (True,), 'RESET_MEDIA_RUNTIME_PERMISSIONS')
        values = (s3.BUCKET,store,incarnation,int(generation),s3.ENDPOINT,e['credentialFingerprint'],
                  e['previousCredentialFingerprint'],e['providerImageId'],stopped,started,denied,evidence['evidenceDigest'])
        g.execute('INSERT INTO cop_safety_v2.media_upload_closures(bucket,application_store_id,incarnation_id,restore_generation,endpoint,credential_fingerprint,previous_credential_fingerprint,provider_image_id,provider_stopped_at,provider_restarted_at,old_credential_denied_at,evidence_digest) VALUES('+','.join(['%s']*12)+')', values)
        g.execute('SELECT endpoint,previous_credential_fingerprint,provider_image_id,evidence_digest FROM cop_safety_v2.media_upload_closures WHERE bucket=%s AND application_store_id=%s AND incarnation_id=%s AND restore_generation=%s AND credential_fingerprint=%s',
                  (s3.BUCKET,store,incarnation,int(generation),e['credentialFingerprint']))
        need(g.fetchall() == [(s3.ENDPOINT,e['previousCredentialFingerprint'],e['providerImageId'],evidence['evidenceDigest'])], 'RESET_MEDIA_ENROLLMENT_READBACK')
        admission.assert_current()
        guard.commit()
        cop.rollback()
        return {'contractVersion':'cop-clean-media-enrollment-result-v1', 'enrolled':True, 'runtimeWriteGranted':False}
    except BaseException:
        guard.rollback(); cop.rollback(); raise


# Only public source and finite paths enter this bootstrap. No SQL credential,
# token, Docker socket or host-wide secret mount is passed to a helper container.
HELPER = r'''
import json,os,pathlib,sys,types
p=json.loads(sys.stdin.buffer.readline(1048577))
def need(x):
 if not x:raise RuntimeError('RESET_FILE_HELPER_REFUSED')
need(p['kind'] in ('native_media','edge') and p['operation'] in ('inspect','apply','readback'))
m=types.ModuleType('fixed_reset');m.__file__='/reviewed/fixed-reset.py'
exec(compile(p['source'],m.__file__,'exec'),m.__dict__)
if p['kind']=='native_media':
 need(os.getuid()==0)
 m.ROOT=pathlib.Path('/srv/csm-messaging/matrix/data/media_store')
 inspect=lambda:m.inspect_media_reset(root=m.ROOT)
 apply=lambda a:m.apply_media_reset(p['reviewed'],a,root=m.ROOT)
else:
 need(os.getuid()==0)
 inspect=lambda:m.inspect_edge_reset()
 apply=lambda a:m.apply_edge_reset(p['reviewed'],a)
class Live:
 def assert_current(self):
  print(json.dumps({'operation':'assert'}),flush=True)
  need(json.loads(sys.stdin.buffer.readline(4097))=={'current':True})
if p['operation']=='apply':result=apply(Live())
else:result=inspect()
print(json.dumps({'operation':'result','value':result}),flush=True)
'''
HELPER = 'try:\n'+textwrap.indent(HELPER, ' ')+r'''
except BaseException as error:
 import re
 code=str(error)
 if not re.fullmatch(r'[A-Z][A-Z0-9_]{4,100}',code):
  code='RESET_FILE_HELPER_OS_ERROR_'+str(error.errno) if isinstance(error,OSError) and isinstance(error.errno,int) else 'RESET_FILE_HELPER_FAILED'
 print(json.dumps({'operation':'error','code':code}),flush=True)
 sys.exit(2)
'''


def helper(plan, remote, kind, operation, reviewed=None, admission=None):
    need(kind in {'native_media', 'edge'} and operation in {'inspect', 'apply', 'readback'}
         and (operation != 'apply' or admission is not None), 'RESET_REMAINING_HELPER_SCOPE')
    if admission is not None: admission.assert_current()
    leaf = 'clean-reset-media.py' if kind == 'native_media' else 'clean-reset-edge.py'
    payload = {'kind':kind, 'operation':operation, 'reviewed':reviewed,
               'source':source(plan, 'scripts/account-safety/'+leaf).decode()}
    name = 'cop-clean-edge-'+uuid.uuid4().hex[:12]
    owner = uuid.uuid4().hex
    if kind == 'native_media':
        # Verified production bind; never infer or open Docker's internal paths.
        c = json.loads(remote.run(['/usr/bin/docker', 'inspect', 'csm-matrix-synapse']))[0]
        need(c['Id'] == plan['remoteWriters']['csm-matrix-synapse']['id']
             and c['Image'] == plan['remoteWriters']['csm-matrix-synapse']['image']
             and any(x['Type'] == 'bind' and x['Source'] == '/srv/csm-messaging/matrix/data'
                     and x['Destination'] == '/data' and x['RW'] for x in c['Mounts']),
             'RESET_REMAINING_NATIVE_MOUNT')
        remote._custody()
        args = remote._args()+['-o', 'BatchMode=yes', '-o', 'ControlMaster=no',
            '-o', 'ProxyCommand=/usr/bin/false', 'voldzi@comm.home.cz',
            shlex.join(['/usr/bin/sudo', '-n', '/usr/bin/env', '-u', 'PYTHONPATH', '-u', 'PYTHONHOME',
                        '/usr/bin/python3', '-I', '-B', '-c', HELPER])]
    else:
        c = json.loads(subprocess.run(['/usr/bin/docker', 'inspect', 'cop-cop-edge-1'],
            capture_output=True, check=True, timeout=15).stdout)[0]
        need(c['Id'] == plan['localWriters']['cop-cop-edge-1']['id']
             and c['Image'] == plan['localWriters']['cop-cop-edge-1']['image']
             and c['Config']['User'] in {'', '0', 'root', '0:0'}
             and len(c['Mounts']) == 1 and c['Mounts'][0]['Type'] == 'volume'
             and c['Mounts'][0]['Name'] == 'cop_cop-edge-data'
             and c['Mounts'][0]['Destination'] == '/data/edge', 'RESET_REMAINING_EDGE_MOUNT')
        args = ['/usr/bin/docker', 'run', '--rm', '--pull', 'never', '--name', name,
            '--label', 'cop.clean.phase=edge', '--label', 'cop.clean.owner='+owner,
            '--network', 'none', '--read-only', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges', '--memory', '128m', '--pids-limit', '32', '--user', '0:0',
            '--mount', 'type=volume,source=cop_cop-edge-data,target=/edge-data'+
                (',readonly' if operation != 'apply' else ''),
            '--entrypoint', '/usr/local/bin/python', '-i', plan['candidateImages']['synapse'], '-I', '-B', '-c', HELPER]
    child = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        env={'PATH':'/usr/bin:/bin', 'DOCKER_HOST':'unix:///var/run/docker.sock', 'LANG':'C'})
    deadline, frame = time.monotonic()+240, bytearray()
    try:
        child.stdin.write(json.dumps(payload).encode()+b'\n'); child.stdin.flush()
        result = None
        while result is None:
            need(time.monotonic() < deadline, 'RESET_REMAINING_HELPER_TIMEOUT')
            ready, _, _ = select.select([child.stdout], [], [], 10)
            if not ready:
                if admission is not None: admission.assert_current()
                continue
            part = os.read(child.stdout.fileno(), 1)
            need(part, 'RESET_REMAINING_HELPER_CLOSED')
            frame.extend(part); need(len(frame) <= 1048576, 'RESET_REMAINING_HELPER_LIMIT')
            if part != b'\n': continue
            message = json.loads(frame); frame.clear()
            if message == {'operation':'assert'}:
                need(admission is not None, 'RESET_REMAINING_HELPER_UNEXPECTED_ADMISSION')
                admission.assert_current()
                child.stdin.write(b'{"current":true}\n'); child.stdin.flush()
            elif message.get('operation') == 'error':
                need(set(message) == {'operation','code'} and isinstance(message['code'], str)
                     and re.fullmatch(r'[A-Z][A-Z0-9_]{4,100}', message['code']), 'RESET_REMAINING_HELPER_FRAME')
                raise RuntimeError(message['code'])
            else:
                need(set(message) == {'operation', 'value'} and message['operation'] == 'result',
                     'RESET_REMAINING_HELPER_FRAME')
                result = message['value']
        child.stdin.close()
        need(child.wait(timeout=15) == 0, 'RESET_REMAINING_HELPER_FAILED')
        if admission is not None: admission.assert_current()
        return result
    finally:
        if child.poll() is None:
            child.kill(); child.wait(timeout=10)
        if kind == 'edge':
            # Remove only this operator's exact disposable helper, never a
            # volume or app container; an interrupted helper may remain running.
            inspected = subprocess.run(['/usr/bin/docker', 'inspect', name], capture_output=True, timeout=15, check=False)
            if inspected.returncode == 0:
                current = json.loads(inspected.stdout)[0]
                need(current['Config']['Labels'].get('cop.clean.owner') == owner
                     and current['Image'] == plan['candidateImages']['synapse'], 'RESET_REMAINING_HELPER_CUSTODY')
                subprocess.run(['/usr/bin/docker', 'rm', '-f', current['Id']], stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15, check=False)


@contextmanager
def prepare_remaining_reset(plan, private_config, remote):
    global _prepared
    need(_prepared is None and os.getuid() == 0 and socket.gethostname().split('.')[0] == 'docker',
         'RESET_REMAINING_ROOT_REQUIRED')
    value = validate_configuration(plan, private_config)
    source(plan, 'scripts/account-safety/native94-reset-profile.json')
    messaging = load(plan, 'clean-reset-messaging.py', 'remaining_messaging')
    s3 = load(plan, 'clean-reset-s3.py', 'remaining_s3')
    connections = {}
    storage = s3.ProductionStorage(plan)
    try:
        import psycopg2
        for key, connection in value['connections'].items():
            connections[key] = psycopg2.connect(**connection, connect_timeout=8,
                application_name='cop-clean-remaining-root')
        for key, database in [('guard', 'cop_account_safety_guard'), ('cop', 'cop')]:
            connections[key] = psycopg2.connect(**{**value['connections']['native'], 'dbname':database},
                connect_timeout=8, application_name='cop-clean-media-root')
        plans = value['reviewedPlans']
        need(messaging.inspect_metadata_reset(connections['metadata'], 'docker.home.cz') == plans['messaging']['metadata']
             and messaging.inspect_native_reset(connections['native'], value['nativeAdminToken'], 'docker.home.cz') == plans['messaging']['native'],
             'RESET_REMAINING_SQL_PLAN_DRIFT')
        need(helper(plan, remote, 'native_media', 'inspect') == plans['media']['nativeMedia']
             and helper(plan, remote, 'edge', 'inspect') == plans['edge'], 'RESET_REMAINING_FILE_PLAN_DRIFT')
        storage.open(plans['media']['s3'])
        need(s3.inspect_s3_reset(storage) == plans['media']['s3'], 'RESET_REMAINING_S3_PLAN_DRIFT')
        _prepared = {'plan':plan, 'private':private_config, 'remote':remote, 'connections':connections,
                     'messaging':messaging, 's3':s3, 'storage':storage}
        yield
    finally:
        _prepared = None
        try: storage.close()
        finally:
            for connection in connections.values(): connection.close()


def run_remaining_reset(admission, private_config):
    value = _prepared
    need(value is not None and value['private'] is private_config and admission.remote is value['remote']
         and admission.plan == value['plan'], 'RESET_REMAINING_NOT_PREFLIGHTED')
    admission.assert_current()
    cfg = validate_configuration(admission.plan, private_config)
    plans, m, c = cfg['reviewedPlans'], value['messaging'], value['connections']
    output = {}
    output['metadata'] = m.apply_metadata_reset(c['metadata'], plans['messaging']['metadata'], 'docker.home.cz', admission)
    output['native'] = m.apply_native_reset(c['native'], plans['messaging']['native'], cfg['nativeAdminToken'], 'docker.home.cz', admission)
    output['nativeMedia'] = helper(admission.plan, admission.remote, 'native_media', 'apply', plans['media']['nativeMedia'], admission)
    output['edge'] = helper(admission.plan, admission.remote, 'edge', 'apply', plans['edge'], admission)
    output['s3'] = value['s3'].apply_s3_reset(plans['media']['s3'], admission, value['storage'])
    output['mediaEnrollment'] = enroll_media_closure(admission.plan, c, output['s3'], value['s3'], admission)
    # Fresh provider readbacks, with the same operation lock/writers still held.
    native = m.inspect_native_reset(c['native'], cfg['nativeAdminToken'], 'docker.home.cz')
    metadata = m.inspect_metadata_reset(c['metadata'], 'docker.home.cz')
    media = helper(admission.plan, admission.remote, 'native_media', 'readback', admission=admission)
    edge = helper(admission.plan, admission.remote, 'edge', 'readback', admission=admission)
    need(native['humanCount'] == 0 and media['fileCount'] == 0
         and set(metadata['storeCounts']) == {'account_safety', 'matrix_identities'}
         and metadata['serviceMappingDigest'] == plans['messaging']['metadata']['serviceMappingDigest']
         and all(n == 0 for n in edge['counts'].values()), 'RESET_REMAINING_READBACK_FAILED')
    admission.assert_current()
    return {'contractVersion':'cop-clean-remaining-reset-result-v1', 'completedPhases':list(output),
            'freshReadback':True, 'applicationWritersRestarted':False,
            'storageProviderRestarted':True, 'wholeAccountComplete':False}
