#!/usr/bin/env python3
"""Root-only live admission for the finite COP/SIM reset.
No HTTP listener, password storage, Docker socket delegation or automatic reset.
The joint controller must keep this object/lock alive through every DB/file step.
"""
import fcntl
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import stat
import subprocess

BASE = Path('/srv/cop/runtime/clean-reset')
PLAN = BASE / 'plan.json'
X5 = Path('/srv/x5-production')
UUID = '2f93f595-b61b-4eea-9054-7afa9b275b5b'
LOCAL_WRITERS = ('cop-cop-api-1', 'cop-cop-edge-1', 'cop-cop-mcp-1',
                 'csm-sim-ai-router-api', 'csm-sim-situation-data-api', 'csm-sim-api')
REMOTE_WRITERS = ('csm-messaging-api', 'csm-matrix-synapse')
HEX = re.compile(r'[a-f0-9]{64}')
REV = re.compile(r'[a-f0-9]{40}')
IMAGE = re.compile(r'sha256:[a-f0-9]{64}')
ENV = {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
       'LANG': 'C', 'DOCKER_HOST': 'unix:///var/run/docker.sock', 'HOME': '/root'}


def need(value, code):
    if not value:
        raise RuntimeError(code)


def protected(path, mode=0o600, max_bytes=1048576):
    path = Path(path)
    current = Path('/')
    for part in path.parts[1:-1]:
        current /= part
        item = current.lstat()
        need(stat.S_ISDIR(item.st_mode) and not stat.S_ISLNK(item.st_mode),
             'RESET_ROOT_PARENT_CUSTODY')
    parent = path.parent.lstat()
    need(parent.st_uid == 0 and not parent.st_mode & 0o022, 'RESET_ROOT_PARENT_CUSTODY')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        item = os.fstat(fd)
        need(stat.S_ISREG(item.st_mode) and item.st_uid == 0 and item.st_nlink == 1
             and stat.S_IMODE(item.st_mode) in ((mode,) if isinstance(mode, int) else mode) and item.st_size <= max_bytes,
             'RESET_ROOT_FILE_CUSTODY')
        raw = os.read(fd, max_bytes + 1)
        after = os.fstat(fd)
        need(len(raw) == item.st_size and (item.st_ino, item.st_mtime_ns, item.st_ctime_ns)
             == (after.st_ino, after.st_mtime_ns, after.st_ctime_ns), 'RESET_ROOT_FILE_CHANGED')
        return raw
    finally:
        os.close(fd)


def command(args, *, input=None, timeout=45):
    value = subprocess.run(args, input=input, capture_output=True, timeout=timeout,
                           env=ENV, check=False)
    need(value.returncode == 0, 'RESET_HOST_COMMAND_FAILED')
    return value.stdout


def inspect_writers(run, names):
    # Deliberately no Config.Env, network credentials or user payloads.
    fmt = '{{json .Name}}\t{{json .Id}}\t{{json .Image}}\t{{json .State}}'
    raw = run(['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock',
               'inspect', '--format', fmt, *names])
    lines = raw.decode().splitlines()
    need(len(lines) == len(names), 'RESET_WRITER_INVENTORY_INCOMPLETE')
    out = {}
    for name, line in zip(names, lines):
        actual, ident, image, state = [json.loads(x) for x in line.split('\t')]
        need(actual == '/' + name and HEX.fullmatch(ident) and IMAGE.fullmatch(image)
             and isinstance(state, dict), 'RESET_WRITER_IDENTITY_INVALID')
        out[name] = {'id': ident, 'image': image, 'running': state.get('Running'),
                     'restarting': state.get('Restarting'), 'status': state.get('Status'),
                     'pid': state.get('Pid')}
    return out


def assert_stopped(actual, expected):
    need(set(actual) == set(expected), 'RESET_WRITER_SET_CHANGED')
    for name, item in actual.items():
        need(item['id'] == expected[name]['id'] and item['image'] == expected[name]['image']
             and item['running'] is False and item['restarting'] is False
             and item['status'] == 'exited' and item['pid'] == 0,
             'RESET_WRITER_NOT_STOPPED')


def assert_freeze_targets(actual, expected):
    need(set(actual) == set(expected), 'RESET_WRITER_SET_CHANGED')
    for name, item in actual.items():
        need(item['id'] == expected[name]['id'] and item['image'] == expected[name]['image']
             and item['restarting'] is False
             and ((item['running'] is True and item['status'] == 'running' and item['pid'] > 0)
                  or (item['running'] is False and item['status'] == 'exited' and item['pid'] == 0)),
             'RESET_FREEZE_TARGET_CHANGED')


def validate_plan(plan):
    keys = {'contractVersion', 'resetEpoch', 'tokensNotBefore', 'sources', 'localWriters',
            'remoteWriters', 'reviewedPlanDigests', 'producerInventorySha256', 'operationLockMetadata', 'runtimeBinding', 'operatorRuntime', 'candidateImages', 'scope'}
    need(isinstance(plan, dict) and set(plan) == keys
         and plan['contractVersion'] == 'cop-sim-clean-reset-root-plan-v1'
         and plan['scope'] == 'cop_sim_shared_identity_v1', 'RESET_ROOT_PLAN_SCOPE')
    import uuid
    need(str(uuid.UUID(plan['resetEpoch'])) == plan['resetEpoch']
         and type(plan['tokensNotBefore']) is int and 0 < plan['tokensNotBefore'] <= __import__('time').time(),
         'RESET_ROOT_PLAN_EPOCH')
    for key, names in [('localWriters', LOCAL_WRITERS), ('remoteWriters', REMOTE_WRITERS)]:
        need(isinstance(plan[key], dict) and set(plan[key]) == set(names), 'RESET_ROOT_PLAN_WRITERS')
        for item in plan[key].values():
            need(set(item) == {'id', 'image'} and HEX.fullmatch(item['id'])
                 and IMAGE.fullmatch(item['image']), 'RESET_ROOT_PLAN_WRITER_BINDING')
    gate = _acceptance_module()
    gate.validate_candidate_images(plan['candidateImages'])
    runtime = plan['operatorRuntime']
    need(isinstance(runtime, dict) and set(runtime) == {'root', 'imageId', 'nodeSha256', 'loaderSha256'}
         and runtime['root'] == '/srv/x5-production/staging/cop/clean-operator-2e61857'
         and runtime['imageId'] == 'sha256:2e61857d00f7fe0326a7b50a8f96f0cb4563d4d9028645dc08efe51b84e800df'
         and runtime['nodeSha256'] == 'c8726a01ce4ac245ea9e5cb483992a90e628e5847d98f9a9f3be048d09a50d75'
         and runtime['loaderSha256'] == '38d022ce7425ff105ccfb53598f606e6e5f5f0a34bfbc793d65e6f34c9d72806',
         'RESET_ROOT_OPERATOR_RUNTIME')
    need(isinstance(plan.get('sources'), dict) and isinstance(plan['sources'].get('cop'), dict)
         and plan['sources']['cop'].get('root') == runtime['root'] + '/app', 'RESET_ROOT_OPERATOR_SOURCE')
    need(plan['candidateImages']['cop_api'] == runtime['imageId'], 'RESET_ROOT_OPERATOR_SOURCE')
    active = plan['runtimeBinding']
    need(isinstance(active, dict) and active.get('contractVersion') == 'cop-api-runtime-active-v1'
         and isinstance(active.get('generation'), str) and re.fullmatch(r'[a-f0-9]{32}', active['generation'])
         and active.get('containerId') == plan['localWriters']['cop-cop-api-1']['id']
         and active.get('imageId') == plan['localWriters']['cop-cop-api-1']['image']
         and isinstance(active.get('profileId'), str) and active.get('profileGeneration') == active['profileId']
         and str(uuid.UUID(active['profileId'])) == active['profileId']
         and isinstance(active.get('releaseId'), str) and re.fullmatch(r'release-[a-f0-9]{32}', active['releaseId']),
         'RESET_ROOT_RUNTIME_BINDING')
    need(isinstance(plan['sources'], dict) and set(plan['sources']) == {'cop', 'sim', 'messaging'},
         'RESET_ROOT_PLAN_SOURCE_SET')
    for item in plan['sources'].values():
        need(set(item) == {'revision', 'root', 'files'} and REV.fullmatch(item['revision'])
             and isinstance(item['files'], dict) and item['files'], 'RESET_ROOT_PLAN_SOURCE')
        path = Path(item['root'])
        need(path.is_absolute() and str(path) == os.path.normpath(path)
             and X5 / 'staging' in path.parents and str(path) == str(path.resolve()),
             'RESET_ROOT_PLAN_SOURCE_PATH')
        for leaf, digest in item['files'].items():
            rel = Path(leaf)
            need(not rel.is_absolute() and '..' not in rel.parts and HEX.fullmatch(digest),
                 'RESET_ROOT_PLAN_SOURCE_FILE')
    need(isinstance(plan['reviewedPlanDigests'], dict)
         and set(plan['reviewedPlanDigests']) == {'cop', 'ai', 'driver', 'files', 'keycloak', 'messaging', 'media', 'edge', 'sim_app_files', 'sim_user_install', 'cop_safety_install'}
         and all(isinstance(x, str) and HEX.fullmatch(x) for x in plan['reviewedPlanDigests'].values())
         and HEX.fullmatch(plan['producerInventorySha256']), 'RESET_ROOT_PLAN_REVIEWED_SCOPE')
    lock = plan['operationLockMetadata']
    need(isinstance(lock, dict) and set(lock) == {'device','inode','uid','gid','mode'}
         and all(type(v) is int and v >= 0 for v in lock.values()) and lock['inode'] > 0
         and lock['uid'] in (0,1000) and lock['mode'] in (0o600,0o640,0o644,0o660,0o664), 'RESET_ROOT_PLAN_LOCK')
    return plan


def _acceptance_module():
    import importlib.util
    spec = importlib.util.spec_from_file_location('clean_acceptance', Path(__file__).with_name('clean-release-acceptance.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RootResetAdmission:
    """Concrete host custody. Remote and producer objects must be the fixed
    production transports, never worker-supplied callbacks or stored booleans.
    No method restarts writers after a failed or partially completed reset.
    """
    def __init__(self, remote, producers):
        need(os.getuid() == 0 and socket.gethostname().split('.')[0] == 'docker', 'RESET_ROOT_CONTEXT')
        need(type(remote) is CommunicationResetTransport
             and type(producers) is DriverReportProducerCustody, 'RESET_HOST_OWNER_REQUIRED')
        self.remote, self.producers = remote, producers
        self.plan_raw = protected(PLAN)
        self.plan = validate_plan(json.loads(self.plan_raw))
        self.fd = None
        self.open = False
        self.pre_stop_acceptance = None

    def _acquire(self):
        need(not self.open and self.fd is None, 'RESET_ADMISSION_ALREADY_OPEN')
        self.fd = os.open('/srv/cop/.storage.lock', os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
        self._lock_current()
        fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.open = True

    def __enter__(self):
        try:
            self._acquire()
            self.pre_stop_acceptance = _acceptance_module().verified_pre_stop_acceptance(self.plan['candidateImages'])
            self.assert_current()
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    @classmethod
    @contextmanager
    def freeze_reviewed(cls, remote, producers):
        """Explicit final-release step only. Freeze exactly the Root-reviewed
        instances, under the existing deployment lock. No automatic restart.
        """
        value = cls(remote, producers)
        try:
            value._acquire()
            value._assert_files()
            value.pre_stop_acceptance = _acceptance_module().verified_pre_stop_acceptance(value.plan['candidateImages'])
            local = inspect_writers(command, LOCAL_WRITERS)
            distant = inspect_writers(remote.run, REMOTE_WRITERS)
            assert_freeze_targets(local, value.plan['localWriters'])
            assert_freeze_targets(distant, value.plan['remoteWriters'])
            # Only the already-inventoried report cron is paused. A still-running
            # report task blocks; it is never killed by a guessed process name.
            need(_acceptance_module().verified_pre_stop_acceptance(value.plan['candidateImages']) == value.pre_stop_acceptance, 'RESET_WHOLE_ACCEPTANCE_CHANGED')
            need(producers.freeze() == value.plan['producerInventorySha256'], 'RESET_PRODUCER_PLAN_MISMATCH')
            command(['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock',
                     'stop', '--time', '30', *LOCAL_WRITERS], timeout=90)
            remote.run(['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock',
                        'stop', '--time', '30', *REMOTE_WRITERS])
            value.assert_current()
            yield value
        finally:
            value.__exit__(None, None, None)

    def _lock_current(self):
        need(self.fd is not None, 'RESET_OPERATION_LOCK_CLOSED')
        item, path = os.fstat(self.fd), Path('/srv/cop/.storage.lock').lstat()
        fields = lambda s: {'device':s.st_dev,'inode':s.st_ino,'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode)}
        need(stat.S_ISREG(item.st_mode) and stat.S_ISREG(path.st_mode) and item.st_nlink == path.st_nlink == 1
             and fields(item) == fields(path) == self.plan['operationLockMetadata'], 'RESET_OPERATION_LOCK_CUSTODY')

    def _assert_files(self):
        need(self.open and self.fd is not None, 'RESET_ADMISSION_CLOSED')
        self._lock_current()
        need(protected(PLAN) == self.plan_raw, 'RESET_ROOT_PLAN_CHANGED')
        need(X5.resolve() == X5 and X5.stat().st_dev != Path('/').stat().st_dev,
             'RESET_X5_FILESYSTEM_REQUIRED')
        need(command(['/usr/bin/findmnt', '-n', '-o', 'UUID', '--mountpoint', str(X5)]).decode().strip() == UUID,
             'RESET_X5_UUID_REQUIRED')
        runtime = self.plan['operatorRuntime']
        base = Path(runtime['root']) / 'runtime'
        for leaf, key in [('usr/local/bin/node', 'nodeSha256'), ('lib/ld-musl-x86_64.so.1', 'loaderSha256')]:
            need(hashlib.sha256(protected(base / leaf, mode=(0o444, 0o555), max_bytes=200*1024*1024)).hexdigest() == runtime[key],
                 'RESET_ROOT_OPERATOR_RUNTIME_CHANGED')
        for leaf in ['usr/lib/libstdc++.so.6.0.34', 'usr/lib/libgcc_s.so.1']:
            protected(base / leaf, mode=(0o444, 0o555), max_bytes=16*1024*1024)
        need(os.readlink(base / 'usr/lib/libstdc++.so.6') == 'libstdc++.so.6.0.34'
             and os.readlink(base / 'lib/libc.musl-x86_64.so.1') == 'ld-musl-x86_64.so.1', 'RESET_ROOT_OPERATOR_LIBRARY_CHANGED')
        for source in self.plan['sources'].values():
            base = Path(source['root'])
            for leaf, digest in source['files'].items():
                p = base / leaf
                need(hashlib.sha256(protected(p, mode=(0o444,0o555))).hexdigest() == digest,
                     'RESET_SOURCE_CHANGED')
    def assert_current(self):
        self._assert_files()
        need(isinstance(self.pre_stop_acceptance, dict) and hashlib.sha256(protected(_acceptance_module().REPORT)).hexdigest() == self.pre_stop_acceptance.get('reportSha256'), 'RESET_WHOLE_ACCEPTANCE_CHANGED')
        assert_stopped(inspect_writers(command, LOCAL_WRITERS), self.plan['localWriters'])
        self.remote.assert_stopped(self.plan['remoteWriters'])
        self.producers.assert_stopped(self.plan['producerInventorySha256'])

    def __exit__(self, *_):
        self.open = False
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None
        # Deliberately no automatic start/re-enable: two DBs/files are not atomic.


class CommunicationResetTransport:
    """One existing SSH/sudo identity, interactive password only in the TTY.
    No key installation, trust-on-first-use, agent forwarding or new listener.
    """
    directory = Path('/run/cop-clean-reset-comm')
    control = directory / 'master.sock'

    def __init__(self):
        need(os.getuid() == 0 and socket.gethostname().split('.')[0] == 'docker', 'RESET_ROOT_CONTEXT')
        self.identity = None

    def _args(self):
        return ['/usr/bin/ssh', '-F', '/dev/null', '-S', str(self.control),
                '-o', 'UserKnownHostsFile=/home/voldzi/.ssh/known_hosts',
                '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'StrictHostKeyChecking=yes',
                '-o', 'UpdateHostKeys=no', '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no',
                '-o', 'ClearAllForwardings=yes', '-o', 'ConnectTimeout=8']

    def open(self):
        need(not self.directory.exists(), 'RESET_COMM_TRANSPORT_BUSY')
        self.directory.mkdir(mode=0o700)
        meta = self.directory.lstat()
        self.identity = (meta.st_dev, meta.st_ino)
        try:
            args = self._args() + ['-M', '-o', 'ControlPersist=15m', '-o', 'BatchMode=no',
                  '-o', 'PubkeyAuthentication=no', '-o', 'PreferredAuthentications=password',
                  '-o', 'KbdInteractiveAuthentication=no', '-o', 'NumberOfPasswordPrompts=1',
                  'voldzi@comm.home.cz', '/usr/bin/sudo', '-n', '/usr/bin/id', '-u']
            with open('/dev/tty', 'r+b', buffering=0) as tty:
                r = subprocess.run(args, stdin=tty, stdout=subprocess.PIPE, stderr=tty,
                                   env=ENV, timeout=120, check=False)
            need(r.returncode == 0 and r.stdout == b'0\n', 'RESET_COMM_AUTH_REQUIRED')
            self._custody()
            need(self.run(['/usr/bin/hostname', '-s']).decode().strip() == 'comm', 'RESET_COMM_HOST_MISMATCH')
            return self
        except BaseException:
            self.close()
            raise

    def _custody(self):
        need(self.identity is not None, 'RESET_COMM_TRANSPORT_CLOSED')
        d, c = self.directory.lstat(), self.control.lstat()
        need(stat.S_ISDIR(d.st_mode) and (d.st_dev, d.st_ino) == self.identity and d.st_uid == c.st_uid == 0
             and stat.S_IMODE(d.st_mode) == 0o700 and not stat.S_IMODE(c.st_mode) & 0o077
             and stat.S_ISSOCK(c.st_mode), 'RESET_COMM_TRANSPORT_CHANGED')

    def run(self, args, *, input=None, timeout=45):
        import shlex
        self._custody()
        raw = command(self._args() + ['-o', 'BatchMode=yes', '-o', 'ControlMaster=no',
                      '-o', 'ProxyCommand=/usr/bin/false', 'voldzi@comm.home.cz',
                      shlex.join(['/usr/bin/sudo', '-n', *args])], input=input, timeout=timeout)
        self._custody()
        return raw

    def assert_stopped(self, expected):
        assert_stopped(inspect_writers(self.run, REMOTE_WRITERS), expected)

    def close(self):
        if self.identity is None:
            return
        try:
            self._custody()
            subprocess.run(self._args() + ['-O', 'exit', 'voldzi@comm.home.cz'],
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, env=ENV, timeout=10, check=False)
            self.control.unlink(missing_ok=True)
            self.directory.rmdir()
        except FileNotFoundError:
            try:
                d = self.directory.lstat()
                if stat.S_ISDIR(d.st_mode) and (d.st_dev,d.st_ino)==self.identity and d.st_uid==0 and not list(self.directory.iterdir()):
                    self.directory.rmdir()
            except FileNotFoundError:
                pass
        except RuntimeError:
            pass
        finally:
            self.identity = None


class DriverReportProducerCustody:
    """Exact already-inventoried application cron, not a global scheduler stop.
    The original command remains as a commented configuration line. Unknown
    producers block; active tasks must finish before the reset admission opens.
    """
    original_sha = 'c46a03b13ee8d39860fb7bd72df740006f8762fd421ded44e1b2cac990d15d78'
    prefix = b'# COP clean reset paused: '

    def _inventory(self):
        raw = command(['/usr/bin/crontab', '-u', 'voldzi', '-l'])
        matches = []
        for line in raw.splitlines():
            stripped = line[len(self.prefix):] if line.startswith(self.prefix) else line
            if hashlib.sha256(stripped).hexdigest() == self.original_sha:
                matches.append((line.startswith(self.prefix), line))
            elif not line.lstrip().startswith(b'#') and (
                b'driver-measurement' in line or b'driver_measurement' in line):
                raise RuntimeError('RESET_UNKNOWN_REPORT_PRODUCER')
        need(len(matches) == 1, 'RESET_REPORT_CRON_INVENTORY_CHANGED')
        active = []
        for path in Path('/proc').glob('[0-9]*/cmdline'):
            try:
                data = path.read_bytes()
            except (FileNotFoundError, ProcessLookupError):
                continue
            args = data.split(b'\0')
            if any((b'driver-measurement' in x or b'driver_measurement' in x)
                   and (b'cleanup' in x or b'report' in x) for x in args):
                active.append(path.parent.name)
        value = {'originalCronSha256': self.original_sha, 'paused': matches[0][0],
                 'activeProducerCount': len(active)}
        return raw, matches[0], value

    def freeze(self):
        raw, (paused, line), _ = self._inventory()
        if not paused:
            changed = b'\n'.join(self.prefix + x if x == line else x for x in raw.splitlines()) + b'\n'
            command(['/usr/bin/crontab', '-u', 'voldzi', '-'], input=changed)
        _, _, value = self._inventory()
        need(value['paused'] and value['activeProducerCount'] == 0, 'RESET_REPORT_PRODUCER_STILL_RUNNING')
        return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

    def assert_stopped(self, expected_digest):
        _, _, value = self._inventory()
        need(value['paused'] and value['activeProducerCount'] == 0
             and hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
             == expected_digest, 'RESET_REPORT_PRODUCER_REAPPEARED')
