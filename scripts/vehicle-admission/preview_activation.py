"""Unprivileged READ-ONLY candidate-reader/source-delta preview on docker.

The candidate reader is injected only in this process to parse the actual old
accepted proof. No hypothetical Root authority is minted or consumed, no UID
check is bypassed, no future config proof is published and no writer is called.
This is not installation, activation or runtime acceptance of a new generation.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import socket
import sys
import types


def need(value):
    if not value:
        raise RuntimeError('READONLY_PREVIEW_UNPROVEN')


def module(raw, name):
    value = types.ModuleType(name)
    value.__file__ = name + '.py'
    sys.modules[name] = value
    exec(compile(raw, value.__file__, 'exec'), value.__dict__)
    return value


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--payload', required=True, type=Path)
    p.add_argument('--sha256', required=True)
    args = p.parse_args()
    need(os.geteuid() == 1000 and socket.gethostname().split('.')[0] == 'docker')
    raw = args.payload.read_bytes()
    need(len(raw) <= 2097152 and hashlib.sha256(raw).hexdigest() == args.sha256)
    payload = json.loads(raw)
    files = {name: base64.b64decode(value, validate=True) for name, value in payload['assets'].items()}
    ctor = module(files['constructor.py'], 'readonly_ctor')
    c = module(files['contract.py'], 'readonly_contract')
    old_guard = Path('/usr/local/lib/cop-self-release/scripts/cop-api-runtime.py').read_bytes()
    policy = Path('/usr/local/lib/cop-self-release/policy.json').read_bytes()
    guard = ctor.construct(old_guard, files['kernel.py'])
    need(hashlib.sha256(guard).hexdigest() == payload['expectedGuardSha256'] and
         hashlib.sha256(ctor.repin_policy(policy, guard)).hexdigest() == payload['expectedPolicySha256'])
    r = module(guard, 'readonly_candidate_runtime')
    kernel = module(files['kernel.py'], 'readonly_candidate_decoder')
    # Parser injection only, with actual existing Root-owned historical proofs.
    # The code under test is not installed into any protected directory.
    r.Store.planning_config_v3_module = lambda self: kernel
    store = r.Store(uid=1000)
    active, directory, binding, profile = store.active(probe_mounts=False)
    need(active == payload['baselineCop'] and c.COP_FLAG not in profile.get('values', {}))
    store.docker.live(directory, binding, profile)
    sources = {name: c.read_source(r, store.source, 1000, name) for name in r.FILES}
    need({name: hashlib.sha256(value).hexdigest() for name, value in sources.items()} == binding['composeHashes'])
    dotenv = c.read_source(r, store.source, 1000, '.env')
    target_env = c.env_delta(dotenv, 'open')
    target_compose = c.compose_delta(sources['docker-compose.yml'], 'open')
    need(target_compose.replace(c.MAPPING, b'') == sources['docker-compose.yml'])
    need(target_env == dotenv + (b'' if dotenv.endswith(b'\n') else b'\n') + c.COP_FLAG.encode() + b'=true\n')
    lock = Path('/srv/cop/.storage.lock').lstat()
    need(lock.st_uid == lock.st_gid == 1000 and lock.st_nlink == 1 and lock.st_mode & 0o777 == 0o664)
    print(json.dumps({'scope': 'unprivileged_readonly_candidate_reader_and_source_delta_preview',
        'existingAcceptedProofParsedByCandidate': True, 'actualRuntimeParityVerifiedReadOnly': True,
        'sourceComposeModesAndHashesMatched': True, 'existingStorageLockModeMatched': True,
        'onlyPlannedChanges': ['COP_SHARED_VEHICLE_COMMUNICATION_ENABLED', 'one_compose_mapping_line'],
        'allOtherDotenvBytesPreservedInRam': True, 'productionChanged': False,
        'rootAuthorityIssued': False, 'newRuntimeAccepted': False}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        import traceback
        frame = traceback.extract_tb(error.__traceback__)[-1]
        print(json.dumps({'previewPassed': False, 'productionChanged': False,
                          'exceptionType': type(error).__name__, 'sourceLine': frame.lineno,
                          'sourceFile': Path(frame.filename).name}))
        raise SystemExit(2)
