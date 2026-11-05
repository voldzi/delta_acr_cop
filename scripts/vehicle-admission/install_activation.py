"""Attended installation for ONE exact application admission release.

Public payload hash is required. Does not enable admission or restart a service.
No credentials, image selection, database grants or network changes accepted.
"""
import argparse
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import time
import types

LIB = Path('/usr/local/lib/cop-vehicle-window')
APP = Path('/usr/local/lib/cop-self-release')
STATE = Path('/var/lib/cop-vehicle-window')
PROFILE = Path('/etc/vcode-cop-api-runtime/206c4507-5e00-458e-b0ee-4061309aa7a8')
NAMES = {'contract', 'proposal', 'publisher', 'execution', 'messaging', 'kernel',
         'worker', 'constructor', 'activation', 'install_activation'}
PARENT_GUARD = 'e3d31a74d1c9cf296ad2afb26382824dbbd1c5faec2fcc59d954950216c14fc3'
PARENT_POLICY = '2517bfc17a2d11e6a87ac2fc3a280b51da79c5044228f716cdb71ad9d13f84a7'
COP_CID = '9e0af82d3bfa1355e14180c6d0adf6fe0f0d86c4dbc768b0371f2d54ca8aa2cf'
GENERATION = '55190b1dc87f4bf59dec02d3396c41a3'
LAUNCHER = b'#!/bin/sh\nexec /usr/bin/python3 -I /usr/local/lib/cop-vehicle-window/activation.py "$@"\n'
SUDOERS = (b'voldzi ALL=(root) NOPASSWD: NOSETENV: /usr/local/sbin/cop-vehicle-admission status, '
           b'/usr/local/sbin/cop-vehicle-admission enable, /usr/local/sbin/cop-vehicle-admission disable, '
           b'/usr/local/sbin/cop-vehicle-admission contain\n')


def need(value, code):
    if not value:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def module(raw, name):
    value = types.ModuleType(name)
    value.__file__ = name + '.py'
    sys.modules[name] = value
    exec(compile(raw, value.__file__, 'exec'), value.__dict__)
    return value


def source(path, bound=2097152, owner=None):
    need(path.is_absolute() and not any(p.is_symlink() for p in (path, *path.parents)), 'INSTALL_PATH')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        a = os.fstat(fd)
        need(stat.S_ISREG(a.st_mode) and a.st_nlink == 1 and a.st_size <= bound and
             not a.st_mode & 0o022 and (owner is None or a.st_uid == owner), 'INSTALL_CUSTODY')
        raw = os.read(fd, bound + 1)
        b = os.fstat(fd)
        need(len(raw) == a.st_size and (a.st_dev, a.st_ino, a.st_mtime_ns, a.st_ctime_ns) ==
             (b.st_dev, b.st_ino, b.st_mtime_ns, b.st_ctime_ns), 'INSTALL_CHANGED')
        return raw, a
    finally:
        os.close(fd)


def directory(path, group=0, mode=0o700):
    need(not any(p.is_symlink() for p in (path, *path.parents)), 'INSTALL_DIRECTORY_PATH')
    if not path.exists():
        path.mkdir(mode=mode)
        os.chown(path, 0, group)
        path.chmod(mode)
    s = path.lstat()
    need(stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and s.st_gid == group and
         stat.S_IMODE(s.st_mode) == mode, 'INSTALL_DIRECTORY_CUSTODY')


def write(path, raw, *, group=0, mode=0o400):
    if path.exists():
        old, info = source(path, owner=0)
        need(old == raw and info.st_gid == group and stat.S_IMODE(info.st_mode) == mode,
             'INSTALL_EXISTING_FILE_DIFFERS')
        return
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        os.fchown(fd, 0, group)
        os.fchmod(fd, mode)
        view = memoryview(raw)
        while view:
            n = os.write(fd, view)
            need(n > 0, 'INSTALL_SHORT_WRITE')
            view = view[n:]
        os.fsync(fd)
    finally:
        os.close(fd)
    sync(path.parent)


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def replace(path, before, after, owner):
    raw, info = source(path, owner=owner)
    need(raw == before, 'INSTALL_PARENT_CAS')
    temporary = path.with_name('.' + path.name + '.admission-install.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        view = memoryview(after)
        while view:
            count = os.write(fd, view)
            need(count > 0, 'INSTALL_SHORT_WRITE')
            view = view[count:]
        os.fchown(fd, info.st_uid, info.st_gid)
        os.fchmod(fd, stat.S_IMODE(info.st_mode))
        os.fsync(fd)
    finally:
        os.close(fd)
    current, again = source(path, owner=owner)
    need(current == before and (again.st_ino, again.st_mtime_ns, again.st_ctime_ns) ==
         (info.st_ino, info.st_mtime_ns, info.st_ctime_ns), 'INSTALL_FINAL_PARENT_CAS')
    os.replace(temporary, path)
    sync(path.parent)


def payload(raw, expected):
    need(len(raw) <= 2097152 and sha(raw) == expected, 'INSTALL_PAYLOAD_HASH')
    value = json.loads(raw)
    need(set(value) == {'contractVersion', 'windowId', 'scope', 'admissionLifetime', 'baselineCop',
                       'baselineMessagingCanonicalDigest', 'expectedGuardSha256', 'expectedPolicySha256', 'assets'} and
         value['contractVersion'] == 'cop-vehicle-admission-root-payload-v1' and
         value['scope'] == 'global_authorized_vehicle_members' and
         value['admissionLifetime'] == 'until_explicit_disable' and
         set(value['assets']) == {name + '.py' for name in NAMES}, 'INSTALL_PAYLOAD_SCOPE')
    files = {name: base64.b64decode(encoded, validate=True) for name, encoded in value['assets'].items()}
    contract = module(files['contract.py'], 'sealed_admission_contract')
    need(isinstance(value['windowId'], str) and contract.UUID.fullmatch(value['windowId']) and
         value['baselineCop']['containerId'] == COP_CID and value['baselineCop']['generation'] == GENERATION and
         value['baselineCop']['imageId'] == contract.COP_IMAGE and
         value['baselineCop']['profileGeneration'] == '206c4507-5e00-458e-b0ee-4061309aa7a8' and
         isinstance(value['baselineMessagingCanonicalDigest'], str) and
         __import__('re').fullmatch('[a-f0-9]{64}', value['baselineMessagingCanonicalDigest']), 'INSTALL_BASELINE_SCOPE')
    for name, body in files.items():
        need(len(body) <= 1048576, 'INSTALL_ASSET_BOUND')
        compile(body, name, 'exec')
    return value, files, contract


def install(value, files, contract, digest, host):
    need(os.geteuid() == 0 and host == socket.gethostname().split('.')[0] and
         host in ('docker', 'comm'), 'INSTALL_ROOT_HOST')
    lockname = '/run/cop-self-release.lock' if host == 'docker' else '/run/cop-vehicle-admission-control.lock'
    fd = os.open(lockname, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    changed = []
    published = False
    created_entrypoints = []
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if LIB.exists():
            old = json.loads(source(LIB / 'approval.json', owner=0)[0])
            need(old['windowId'] == value['windowId'] and old['approvedManifestSha256'] == digest and
                 old['host'] == host and all(source(LIB / n, owner=0)[0] == body for n, body in files.items()) and
                 source(Path('/usr/local/sbin/cop-vehicle-admission'), owner=0)[0] == LAUNCHER and
                 source(Path('/etc/sudoers.d/cop-vehicle-admission'), owner=0)[0] == SUDOERS,
                 'INSTALL_OTHER_RELEASE_PRESENT')
            if host == 'docker':
                need(sha(source(APP / 'policy.json', owner=0)[0]) == old['installedPolicySha256'] and
                     sha(source(APP / 'scripts/cop-api-runtime.py', owner=0)[0]) == old['guardSha256'] and
                     sha(source(Path('/srv/cop/scripts/cop-api-runtime.py'), owner=1000)[0]) == old['guardSha256'],
                     'INSTALL_EXISTING_POLICY_DRIFT')
            return {'installed': True, 'alreadyInstalled': True, 'host': host,
                    'windowId': value['windowId'], 'activationEntryExpiresAt': old['window']['activateBefore'],
                    'authorityRefreshed': False, 'admissionEnabledByInstaller': False}
        need(not LIB.is_symlink() and
             not Path('/usr/local/sbin/cop-vehicle-admission').exists() and
             not Path('/etc/sudoers.d/cop-vehicle-admission').exists(), 'INSTALL_ALREADY_PRESENT')
        directory(STATE)
        case = STATE / value['windowId']
        directory(case)
        staging = LIB.with_name('.cop-vehicle-window-' + value['windowId'] + '.staging')
        now = int(time.time())
        window = {'contractVersion': 'cop-global-vehicle-admission-release-v1',
            'windowId': value['windowId'], 'approvedManifestSha256': digest,
            'scope': value['scope'], 'purpose': 'human_requested_activation',
            'admissionLifetime': value['admissionLifetime'], 'approvedAt': now, 'activateBefore': now + 3600,
            'releaseClientGateRemainsOff': True, 'debugClientMayBeEnabled': True,
            'containment': 'close_cop_then_messaging_keep_cleanup_writers'}
        if (staging / 'approval.json').is_file():
            prior = json.loads(source(staging / 'approval.json', owner=0)[0])
            need(prior['approvedManifestSha256'] == digest and prior['host'] == host and
                 prior['windowId'] == value['windowId'], 'INSTALL_STAGING_SCOPE')
            window = prior['window']  # Resume public preparation; never refresh authority.
        contract.validate_window(window, now, opening=True)
        approval = {'contractVersion': 'cop-root-window-installation-v1',
            'operationKind': 'persistent_global_vehicle_admission', 'host': host,
            'windowId': value['windowId'], 'approvedManifestSha256': digest,
            'ordinaryConfigAuthority': False, 'window': window, 'baselineCop': value['baselineCop'],
            'baselineCanonicalDigest': value['baselineMessagingCanonicalDigest'],
            'assets': {name: sha(raw) for name, raw in files.items()}}
        if host == 'docker':
            guard_path = Path('/srv/cop/scripts/cop-api-runtime.py')
            original, _ = source(guard_path, owner=1000)
            library_guard, _ = source(APP / 'scripts/cop-api-runtime.py', owner=0)
            policy, _ = source(APP / 'policy.json', owner=0)
            need(sha(original) == sha(library_guard) == PARENT_GUARD and
                 sha(policy) == PARENT_POLICY, 'INSTALL_EXACT_PARENT_REQUIRED')
            ctor = module(files['constructor.py'], 'sealed_admission_constructor')
            guard = ctor.construct(original, files['kernel.py'])
            policy_target = ctor.repin_policy(policy, guard)
            need(sha(guard) == value['expectedGuardSha256'] and sha(policy_target) ==
                 value['expectedPolicySha256'], 'INSTALL_CONSTRUCTION_MISMATCH')
            directory(PROFILE, 1000, 0o750)
            write(PROFILE / ('planning-config-v3-kernel-' + sha(files['kernel.py']) + '.py'),
                  files['kernel.py'], group=1000, mode=0o640)
            preview = module(guard, 'sealed_admission_runtime_preview')
            store = preview.Store(uid=1000)
            active, old_dir, binding, profile = store.active()
            need(active == value['baselineCop'] and contract.COP_FLAG not in profile.get('values', {}),
                 'INSTALL_RUNTIME_BASELINE_CHANGED')
            store.docker.live(old_dir, binding, profile)
            lock_info = Path('/srv/cop/.storage.lock').lstat()
            need(stat.S_ISREG(lock_info.st_mode) and lock_info.st_uid == lock_info.st_gid == 1000 and
                 lock_info.st_nlink == 1 and stat.S_IMODE(lock_info.st_mode) == 0o664,
                 'INSTALL_EXISTING_OPERATION_LOCK_CHANGED')
            for name, expected_mode in contract.SOURCE_COMPOSE_MODES.items():
                body = contract.read_source(preview, store.source, 1000, name)
                need(preview.sha(body) == binding['composeHashes'][name], 'INSTALL_SOURCE_COMPOSE_DRIFT')
            need(contract.sha(contract.read_source(preview, store.source, 1000, 'docker-compose.yml'))
                 == contract.BASE_COMPOSE_SHA, 'INSTALL_MAPPING_BASELINE')
            approval.update(guardSha256=sha(guard), installedPolicySha256=sha(policy_target))
            authority = {**window, 'contractVersion': 'cop-root-vehicle-admission-release-v1'}
            authority_raw = contract.encode(authority) + b'\n'
            authority_path = PROFILE / ('vehicle-window-' + value['windowId'] + '.json')
            write(authority_path, authority_raw, group=1000, mode=0o640)
            approval['windowReference'] = {'path': str(authority_path), 'sha256': sha(authority_raw)}
            write(case / 'original-host-guard.py', original)
            write(case / 'original-library-guard.py', library_guard)
            write(case / 'original-policy.json', policy)
        else:
            messaging = module(files['messaging.py'], 'sealed_admission_messaging')
            n = messaging.load(messaging.UTILITY, messaging.UTILITY_SHA)
            c = messaging.load(messaging.CANONICAL, messaging.CANONICAL_SHA)
            ops = n.Live()
            inspected = ops.inspect()
            inputs = dict(n.BASELINE['inputSha256'])
            inputs[str(n.PIN)] = messaging.BASE_PIN
            need(inspected['Id'] == messaging.BASE_CID and inspected['Image'] == messaging.IMAGE and
                 inspected['RestartCount'] == 0 and inspected['State']['Running'] is True and
                 inspected['State'].get('Health', {}).get('Status') == 'healthy' and
                 ops.inputs() == inputs and ops.peers() == n.BASELINE['peers'] and
                 n.sha(n.encoded(c.canonical_runtime(inspected, n.envmap))) ==
                 value['baselineMessagingCanonicalDigest'], 'INSTALL_MESSAGING_BASELINE_CHANGED')
        # Validate the exact additional sudo rule before publishing a launcher.
        test = Path('/run') / ('cop-vehicle-admission-' + value['windowId'] + '.sudoers')
        write(test, SUDOERS, mode=0o440)
        try:
            subprocess.run(['/usr/sbin/visudo', '-cf', str(test)], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=15)
        finally:
            test.unlink()
        directory(staging, 1000, 0o750)
        for name, raw in files.items():
            write(staging / name, raw, group=1000, mode=0o640)
        write(staging / 'approval.json', contract.encode(approval) + b'\n', group=1000, mode=0o640)
        # The fixed launcher has no runnable library until the final atomic
        # publish. Any failure before that can restore only public tool metadata.
        for path, body, mode in ((Path('/usr/local/sbin/cop-vehicle-admission'), LAUNCHER, 0o755),
                                 (Path('/etc/sudoers.d/cop-vehicle-admission'), SUDOERS, 0o440)):
            write(path, body, mode=mode)
            created_entrypoints.append((path, body))
        if host == 'docker':
            for path, before, after, owner in (
                (APP / 'scripts/cop-api-runtime.py', library_guard, guard, 0),
                (guard_path, original, guard, 1000), (APP / 'policy.json', policy, policy_target, 0)):
                replace(path, before, after, owner)
                changed.append((path, before, after, owner))
        write(case / 'prepared-install.json', contract.encode({'payloadSha256': digest,
            'host': host, 'state': 'public_metadata_prepared_not_runtime_acceptance',
            'admissionEnabledByInstaller': False, 'ordinaryBrokerConfigAuthority': False}) + b'\n')
        os.rename(staging, LIB)
        sync(LIB.parent)
        published = True
        return {'installed': True, 'host': host, 'windowId': value['windowId'],
                'scope': value['scope'], 'admissionLifetime': value['admissionLifetime'],
                'activationEntryExpiresAt': window['activateBefore'], 'admissionEnabledByInstaller': False,
                'applicationRestarted': False, 'ordinaryBrokerConfigAuthority': False}
    except Exception:
        # Only public installer metadata can be restored here, and only if the
        # target still equals our exact bytes. Never an application/image rollback.
        if not published:
            for path, before, after, owner in reversed(changed):
                replace(path, after, before, owner)
            for path, body in reversed(created_entrypoints):
                actual, _ = source(path, owner=0)
                need(actual == body, 'INSTALL_ENTRYPOINT_CHANGED')
                path.unlink()
                sync(path.parent)
        raise
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--payload', type=Path, required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--host', choices=('docker', 'comm'), required=True)
    args = parser.parse_args()
    os.environ.clear()
    os.environ.update(PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
                      HOME='/root', LANG='C', DOCKER_HOST='unix:///var/run/docker.sock')
    os.umask(0o077)
    raw, _ = source(args.payload)
    value, files, contract = payload(raw, args.sha256)
    print(json.dumps(install(value, files, contract, args.sha256, args.host)))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        import traceback
        frame = traceback.extract_tb(error.__traceback__)[-1]
        print(json.dumps({'installed': False, 'code': 'ADMISSION_INSTALL_UNPROVEN',
                          'exceptionType': type(error).__name__, 'sourceFile': Path(frame.filename).name,
                          'sourceLine': frame.lineno, 'admissionEnabledByInstaller': False}))
        raise SystemExit(2)
