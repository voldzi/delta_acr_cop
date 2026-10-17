"""Finite stopped-writer reset of the COP Edge disposable event projection.
No CLI/HTTP, credential read, accepted-fence reset or arbitrary production path.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile

ROOT = Path('/edge-data')
KEYS = {'contractVersion', 'cursor', 'deadLetters', 'inboundEvents', 'node', 'outbox', 'sync', 'updatedAt'}
NODE = {'classificationMax', 'lastHeartbeatAt', 'nodeId', 'nodeName', 'softwareVersion'}


def need(value, code):
    if not value:
        raise RuntimeError(code)


def snapshot(root=ROOT, synthetic=False):
    if synthetic:
        need(root.parent == Path('/private/tmp') and root.name.startswith('cop-edge-reset-test-')
             and root.lstat().st_uid == os.getuid() and stat.S_IMODE(root.lstat().st_mode) == 0o700,
             'RESET_EDGE_OWNED_FIXTURE_REQUIRED')
    else:
        need(root == ROOT and os.getuid() == 0, 'RESET_EDGE_ROOT_CONTEXT')
    need(root.resolve() == root and root.is_dir() and not root.is_symlink(), 'RESET_EDGE_DIRECTORY_UNSAFE')
    need(sorted(x.name for x in root.iterdir()) == ['state.json'], 'RESET_EDGE_UNKNOWN_FILE_OR_FENCE')
    path = root / 'state.json'
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        s = os.fstat(fd)
        need(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and s.st_dev == root.stat().st_dev
             and 0 < s.st_size <= 32 * 1024 * 1024, 'RESET_EDGE_FILE_UNSAFE')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            raw = stream.read(32 * 1024 * 1024 + 1)
        a = os.fstat(fd)
        need(len(raw) == s.st_size and (s.st_ino, s.st_mtime_ns, s.st_ctime_ns) ==
             (a.st_ino, a.st_mtime_ns, a.st_ctime_ns), 'RESET_EDGE_FILE_CHANGED')
    finally:
        os.close(fd)
    value = json.loads(raw)
    need(isinstance(value, dict) and set(value) == KEYS
         and value['contractVersion'] == 'cop-edge-node-state-v1', 'RESET_EDGE_STATE_UNKNOWN')
    need(isinstance(value['node'], dict) and set(value['node']) == NODE
         and all(isinstance(value['node'][k], str) and value['node'][k] for k in NODE - {'lastHeartbeatAt'})
         and value['node']['nodeId'] == ('synthetic-edge' if synthetic else 'node_edge_pilot_01'), 'RESET_EDGE_NODE_UNKNOWN')
    need(isinstance(value['cursor'], dict) and set(value['cursor']) == {'lastAckedOffset', 'lastReplayAt'}
         and type(value['cursor']['lastAckedOffset']) is int and value['cursor']['lastAckedOffset'] >= 0
         and isinstance(value['sync'], dict) and set(value['sync']) == {'lastError', 'lastSyncAt', 'mode'},
         'RESET_EDGE_STATE_UNKNOWN')
    need(all(isinstance(value[k], list) for k in ['inboundEvents', 'outbox', 'deadLetters']), 'RESET_EDGE_STATE_UNKNOWN')
    configuration = {k: v for k, v in value['node'].items() if k != 'lastHeartbeatAt'}
    plan = {'contractVersion': 'cop-edge-clean-reset-plan-v1', 'device': s.st_dev, 'inode': s.st_ino,
            'uid': s.st_uid, 'gid': s.st_gid, 'mode': stat.S_IMODE(s.st_mode), 'bytes': len(raw),
            'stateSha256': hashlib.sha256(raw).hexdigest(),
            'configurationSha256': hashlib.sha256(json.dumps(configuration, sort_keys=True).encode()).hexdigest(),
            'counts': {k: len(value[k]) for k in ['inboundEvents', 'outbox', 'deadLetters']}}
    return plan, value


def inspect_edge_reset(root=ROOT, synthetic=False):
    return snapshot(root, synthetic)[0]


def apply_edge_reset(reviewed_plan, admission, root=ROOT, synthetic=False):
    admission.assert_current()
    before, value = snapshot(root, synthetic)
    need(before == reviewed_plan, 'RESET_EDGE_PLAN_DRIFT')
    for key in ['inboundEvents', 'outbox', 'deadLetters']:
        value[key] = []
    value['cursor'] = {'lastAckedOffset': 0, 'lastReplayAt': None}
    value['sync'] = {'lastError': None, 'lastSyncAt': None, 'mode': 'DEGRADED'}
    value['node']['lastHeartbeatAt'] = None
    # A timestamp is operational state, never an assertion that sync succeeded.
    from datetime import datetime, timezone
    value['updatedAt'] = datetime.now(timezone.utc).isoformat()
    fd, temporary = tempfile.mkstemp(prefix='.clean-reset-', dir=root)
    try:
        os.fchmod(fd, before['mode'])
        os.fchown(fd, before['uid'], before['gid'])
        with os.fdopen(fd, 'wb') as output:
            output.write(json.dumps(value, separators=(',', ':')).encode())
            output.flush()
            os.fsync(output.fileno())
        # The temporary filename is controller-owned; inventory compares only
        # the original file while the actual host admission keeps writers stopped.
        admission.assert_current()
        path = root / 'state.json'
        s = path.lstat()
        need(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and s.st_ino == before['inode']
             and hashlib.sha256(path.read_bytes()).hexdigest() == before['stateSha256'], 'RESET_EDGE_PLAN_DRIFT')
        os.replace(temporary, path)
        temporary = None
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        admission.assert_current()
        after = inspect_edge_reset(root, synthetic)
        need(all(n == 0 for n in after['counts'].values())
             and after['configurationSha256'] == before['configurationSha256'], 'RESET_EDGE_READBACK_FAILED')
        return {'contractVersion': 'cop-edge-clean-reset-result-v1', 'counts': after['counts'],
                'configurationPreserved': True, 'oldDataBackupCreated': False, 'wholeAccountComplete': False}
    finally:
        if temporary is not None:
            os.unlink(temporary)
