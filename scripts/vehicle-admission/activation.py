"""Fixed application-owned admission release. NOT INSTALLED.

Root entry: status / enable / disable / contain, with no data arguments.
The installer seals exactly one release; the ordinary code broker is unchanged.
No shell, image selection, token reset, account provisioning or old-image return.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import stat
import sys
import time
import types

LIB = Path('/usr/local/lib/cop-vehicle-window')
APP = Path('/usr/local/lib/cop-self-release')
STATE = Path('/var/lib/cop-vehicle-window')
MODULES = ('contract', 'proposal', 'publisher', 'execution', 'messaging')
ASSETS = {*MODULES, 'kernel', 'worker', 'constructor', 'activation', 'install_activation'}


def need(value, code):
    if not value:
        raise RuntimeError(code)


def read(path, bound=1048576, owner=0):
    need(path.is_absolute() and not any(p.is_symlink() for p in (path, *path.parents)),
         'ADMISSION_ASSET_PATH')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_uid == owner and before.st_nlink == 1 and
             not before.st_mode & 0o022 and before.st_size <= bound, 'ADMISSION_ASSET_CUSTODY')
        raw = os.read(fd, bound + 1)
        after = os.fstat(fd)
        need(len(raw) == before.st_size and
             (before.st_ino, before.st_mtime_ns, before.st_ctime_ns) ==
             (after.st_ino, after.st_mtime_ns, after.st_ctime_ns), 'ADMISSION_ASSET_CHANGED')
        return raw
    finally:
        os.close(fd)


def load(path, digest, name):
    raw = read(path)
    need(hashlib.sha256(raw).hexdigest() == digest, 'ADMISSION_ASSET_HASH')
    module = types.ModuleType(name)
    module.__file__ = str(path)
    sys.modules[name] = module
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    return module


def modules():
    need(os.geteuid() == 0, 'ADMISSION_ROOT_REQUIRED')
    approval = json.loads(read(LIB / 'approval.json', 65536))
    need(approval['contractVersion'] == 'cop-root-window-installation-v1' and
         approval['operationKind'] == 'persistent_global_vehicle_admission' and
         approval['ordinaryConfigAuthority'] is False and
         approval['host'] == socket.gethostname().split('.')[0] and
         set(approval['assets']) == {name + '.py' for name in ASSETS}, 'ADMISSION_INSTALLATION_SCOPE')
    for name, digest in approval['assets'].items():
        need(hashlib.sha256(read(LIB / name)).hexdigest() == digest, 'ADMISSION_LIBRARY_DRIFT')
    result = {name: load(LIB / (name + '.py'), approval['assets'][name + '.py'], 'admission_' + name)
              for name in MODULES}
    result['contract'].validate_window(approval['window'], int(time.time()), opening=False)
    need(approval['window']['contractVersion'] == 'cop-global-vehicle-admission-release-v1' and
         approval['window']['windowId'] == approval['windowId'] and
         approval['window']['approvedManifestSha256'] == approval['approvedManifestSha256'],
         'ADMISSION_AUTHORITY_BINDING')
    if approval['host'] == 'docker':
        policy_raw = read(APP / 'policy.json')
        need(hashlib.sha256(policy_raw).hexdigest() == approval['installedPolicySha256'],
             'ADMISSION_CODE_POLICY_DRIFT')
        policy = json.loads(policy_raw)
        need(policy['guardSha256'] == approval['guardSha256'], 'ADMISSION_GUARD_POLICY')
        result['runtime'] = load(APP / 'scripts/cop-api-runtime.py', approval['guardSha256'], 'admission_runtime')
        need(hashlib.sha256(read(Path('/srv/cop/scripts/cop-api-runtime.py'), owner=1000)).hexdigest()
             == approval['guardSha256'], 'ADMISSION_OPERATIONAL_GUARD_DRIFT')
        result['storage'] = load(APP / 'scripts/cop-storage.py',
                                policy['assets']['scripts/cop-storage.py'], 'admission_storage')
        result['health'] = load(APP / 'scripts/cop-health-gate.py',
                               policy['assets']['scripts/cop-health-gate.py'], 'admission_health')
    else:
        need(approval['host'] == 'comm', 'ADMISSION_HOST_SCOPE')
    return approval, result


def case(approval):
    directory = STATE / approval['windowId']
    info = directory.lstat()
    need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and
         stat.S_IMODE(info.st_mode) == 0o700, 'ADMISSION_CASE_CUSTODY')
    return directory


def current(approval, m):
    if approval['host'] == 'docker':
        r = m['runtime']
        store = r.Store(uid=1000, guard=m['storage'].preflight)
        pointer, directory, binding, profile = store.active()
        store.docker.live(directory, binding, profile)
        value = store.docker.current(directory)
        rows = [s.split('=', 1) for s in value['Config']['Env']]
        need(len({r[0] for r in rows}) == len(rows) and all(len(r) == 2 for r in rows),
             'ADMISSION_ENV_AMBIGUOUS')
        flag = dict(rows).get(m['contract'].COP_FLAG, 'false')
    else:
        module = m['messaging']
        n = module.load(module.UTILITY, module.UTILITY_SHA)
        value = n.Live().inspect()
        flag = n.envmap(value['Config']['Env']).get(module.FLAG, 'false')
    need(flag in ('true', 'false'), 'ADMISSION_FLAG_AMBIGUOUS')
    return {'host': approval['host'], 'windowId': approval['windowId'],
            'scope': 'global_authorized_vehicle_members', 'admissionLifetime': 'until_explicit_disable',
            'activationEntryExpiresAt': approval['window']['activateBefore'],
            'imageId': value['Image'], 'containerId': value['Id'], 'enabled': flag == 'true',
            'healthy': value['State']['Running'] is True and
                       value['State'].get('Health', {}).get('Status') == 'healthy',
            'restartCount': value['RestartCount'], 'ordinaryConfigAuthority': False}


def require_supported_image(approval, m, observed):
    expected = m['contract'].COP_IMAGE if approval['host'] == 'docker' else m['messaging'].IMAGE
    need(observed['imageId'] == expected, 'ADMISSION_IMAGE_CHANGED_REQUIRES_NEW_BOUND_RELEASE')


def cop_stage(approval, m, stage):
    r, storage = m['runtime'], m['storage']
    store = r.Store(uid=1000, guard=storage.preflight)
    k = store.planning_config_v3_module()
    baseline = m['health'].capture(time.monotonic() + 45)
    r.health_statuses(baseline)
    need(all(baseline[url]['httpStatus'] == 200 for url in m['health'].URLS[:2]) and
         m['health'].no_regression(baseline, baseline), 'ADMISSION_SOURCE_HEALTH_UNPROVEN')
    with m['execution'].owned_storage_lock(storage) as storage_fd:
        return m['publisher'].execute(approval, r, store, k, m['contract'], m['proposal'],
                                      m['execution'], storage_fd, stage, r.encoded(baseline))


def contain_cop(approval, m):
    """Failure containment only. Never rewrite a pending release as accepted."""
    directory = case(approval)
    need((directory / 'open/started.json').is_file(), 'ADMISSION_NO_OWN_OPEN_ATTEMPT')
    r = m['runtime']
    store = r.Store(uid=1000)
    k = store.planning_config_v3_module()
    scope = store.post_edge_runtime()
    pointer = store.pointer()
    need(pointer is not None, 'ADMISSION_NO_POINTER')
    references = [(pointer['releaseId'], pointer['containerId'])]
    pending_path = store.root / 'pending.json'
    unknown = False
    if pending_path.exists():
        pending = r.private_json(pending_path, 1000)
        references.append((pending['targetReleaseId'], pending.get('targetContainerId')))
    stops = []
    for release_id, cid in references:
        release_dir, binding, _ = store.binding(release_id, probe_mounts=False)
        ref = binding['accountErasureConfig']
        _, proof = store.erasure_config_proof(Path(ref['path']), binding, ref['sha256'])
        baseline = (release_id == approval['baselineCop']['releaseId'] and
                    cid == approval['baselineCop']['containerId'])
        own = (proof['contractVersion'] == k.WINDOW_VERSION and
               k.window(scope, proof)['windowId'] == approval['windowId'] and
               k.window(scope, proof)['approvedManifestSha256'] == approval['approvedManifestSha256'])
        need(baseline or own, 'ADMISSION_FOREIGN_RELEASE')
        need(binding['imageId'] == k.IMAGE and binding['profileGeneration'] == k.PROFILE,
             'ADMISSION_FOREIGN_IMAGE')
        ids = store.docker.run(['docker', 'ps', '-aq', '--filter',
                               'label=com.cop.runtime.release=' + release_id]).decode().split()
        need(len(ids) <= 1, 'ADMISSION_AMBIGUOUS_INTAKE')
        if not ids:
            unknown = True
            continue
        value = json.loads(store.docker.run(['docker', 'inspect', ids[0]]))[0]
        binding_for_stop = {'containerId': value['Id'], 'releaseId': release_id,
                           'imageId': binding['imageId'], 'profileGeneration': binding['profileGeneration']}
        m['execution'].stop_candidate(value, binding_for_stop)
        rows = [v.split('=', 1) for v in value['Config']['Env']]
        need(all(len(v) == 2 for v in rows) and len({v[0] for v in rows}) == len(rows),
             'ADMISSION_ENV_AMBIGUOUS')
        flag = dict(rows).get(k.FLAG, 'false')
        need(flag in ('true', 'false'), 'ADMISSION_FLAG_AMBIGUOUS')
        if flag == 'true' and value['State']['Running']:
            stops.append(m['execution'].contain_owned_intake(binding_for_stop))
    # Persist only OFF. The image, remaining config, roles and cleanup records
    # are untouched. A metadata/pending repair still requires reconciliation.
    before = m['contract'].read_source(r, store.source, 1000, '.env')
    after = m['contract'].emergency_env_off(before)
    if before != after:
        m['publisher'].replace_source(store.source / '.env', before, after, 'contain-' + approval['windowId'])
    return {'newIntakeContainmentAttempted': True, 'unknownMissingRuntime': unknown,
            'apiStops': len(stops), 'persistentFlagOff': True, 'configurationAcceptanceClaimed': False,
            'rootReconciliationRequired': True, 'messagingCleanupStopped': False,
            'durableIntentsDeleted': False, 'oldImageFallback': False}


def execute(approval, m, action):
    need(action in ('status', 'enable', 'disable', 'contain'), 'ADMISSION_FIXED_ACTION')
    directory = case(approval)
    if action == 'status':
        return current(approval, m)
    lock_path = '/run/cop-self-release.lock' if approval['host'] == 'docker' else '/run/cop-vehicle-admission-control.lock'
    fd = os.open(lock_path, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        need(info.st_uid == 0 and stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and
             stat.S_IMODE(info.st_mode) == 0o600, 'ADMISSION_CONTROL_LOCK')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if action == 'contain':
            need(approval['host'] == 'docker', 'ADMISSION_CONTAINMENT_HOST')
            return contain_cop(approval, m)
        # Reject a later application image before allocating any mutation case.
        # The old helper must never bring its pinned old writer back.
        require_supported_image(approval, m, current(approval, m))
        target = action == 'enable'
        receipt_path = directory / ('enabled.json' if target else 'disabled.json')
        if receipt_path.exists():
            receipt = json.loads(read(receipt_path))
            observed = current(approval, m)
            need(observed['containerId'] == receipt['containerId'] and observed['enabled'] is target and
                 observed['healthy'] and observed['restartCount'] == 0, 'ADMISSION_ACCEPTED_STATE_DRIFT')
            return observed
        if target:
            m['contract'].validate_window(approval['window'], int(time.time()), opening=True)
        elif not (directory / 'enable-started.json').exists():
            observed = current(approval, m)
            need(observed['enabled'] is False, 'ADMISSION_UNOWNED_ENABLE')
            return observed
        elif approval['host'] == 'docker' and not (directory / 'open/started.json').exists():
            # Health/preflight failure before the publisher's first write is
            # not a partial config transition. Observe the unchanged baseline.
            observed = current(approval, m)
            need(observed['enabled'] is False and observed['containerId'] ==
                 approval['baselineCop']['containerId'], 'ADMISSION_UNSTARTED_OPEN_DRIFT')
            return {**observed, 'openNeverMutated': True}
        started = directory / (action + '-started.json')
        need(not started.exists(), 'ADMISSION_UNCERTAIN_ACTION_NO_RETRY')
        m['publisher'].root_write(started, json.dumps({'action': action, 'windowId': approval['windowId']}).encode())
        if approval['host'] == 'docker':
            cop_stage(approval, m, 'open' if target else 'close')
        else:
            m['messaging'].execute(approval, m['contract'], 'open' if target else 'close')
        observed = current(approval, m)
        need(observed['enabled'] is target and observed['healthy'] and observed['restartCount'] == 0,
             'ADMISSION_TARGET_NOT_ACCEPTED')
        m['publisher'].root_write(receipt_path, json.dumps(observed, sort_keys=True).encode() + b'\n')
        return observed
    finally:
        os.close(fd)


def main():
    need(len(sys.argv) == 2 and sys.argv[1] in ('status', 'enable', 'disable', 'contain'), 'ADMISSION_FIXED_ACTION')
    os.environ.clear()
    os.environ.update(PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
                      HOME='/root', LANG='C', DOCKER_HOST='unix:///var/run/docker.sock')
    os.umask(0o077)
    approval, loaded = modules()
    print(json.dumps(execute(approval, loaded, sys.argv[1])))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # No raw exception, Docker output, environment or provider reply.
        import traceback
        frame = traceback.extract_tb(error.__traceback__)[-1]
        print(json.dumps({'accepted': False, 'code': 'ADMISSION_ACTION_UNPROVEN',
                          'exceptionType': type(error).__name__,
                          'sourceFile': Path(frame.filename).name, 'sourceLine': frame.lineno,
                          'automaticRetry': False, 'automaticRollback': False}))
        raise SystemExit(2)
