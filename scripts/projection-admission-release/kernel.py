"""Closed image-only source proposal. No CLI, GO, deployment or secret reader.

Root separately seals each operation. Historical planning readers use their
original kernel bytes and original pin; only the new proof gets this boundary.
"""
import hashlib
import json
import re
import types
from contextlib import contextmanager
from pathlib import Path

VERSION = 'cop-projection-admission-image-v1'
PROFILE = '206c4507-5e00-458e-b0ee-4061309aa7a8'
OLD = 'sha256:6cdf302ea305e7fa58a11a1f9139deccd9f5b70cd0982a7ce87cd6b70d9d5c30'
NEW = 'sha256:51a10099616c4b2bbd2607391413de975fdf49ba0b2df403db6d3e9785eb9094'
OLD_SOURCE = '7c43b690edf687fefc04e17533894d118f457276'
NEW_SOURCE = 'b8d189780fd46b709307a3c0a28e46b85e84131d'
HISTORICAL = 'f847d23d9200fa80b98bbefef6214c4a0048c041a43dbe8b83faded1ae33142d'
HEALTH = 'e7eb01a0b41dcbbcfda0652a4d322c5f0d5d0eb4b6c411e1e6db174d8a596066'
CONFIG = '313d87440048eb3f57935f34bb6e73ae4decc48cf2435c41be3a548a583d1cc5'
ROOTFS = '038c3c2c4635deca2c8a41b7b6a046099be8f23a3c580cfac36c8d3e40caeb5d'
ACCEPTANCE = 'd205f70ceb083fb1d3754ecff3e974bd5f86bf012ac15b4a665c08fe0f7838d8'
BUILT = '944d01c598929f81e524889f1678d144acb8b9daa9c7d6b57f9527ecbe4378ae'
BUILD_ID = 'f65abfbf-d7d8-42e3-bd7a-0a628ff520d5'
APPROVAL = 'message:01a19160-ea8f-7362-a2dd-b185733f2ae9'
KEYS = frozenset({'COP_ROUTING_PLANNING_ENABLED', 'COP_ROUTING_PLANNING_SERVICE_TOKEN'})


def need(ok, code):
    if not ok:
        raise ValueError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def parse(raw):
    need(isinstance(raw, bytes) and len(raw) <= 65536, 'ADMISSION_DOCUMENT_BOUND')
    def pairs(items):
        out = {}
        for key, value in items:
            need(key not in out, 'ADMISSION_DUPLICATE_KEY')
            out[key] = value
        return out
    return json.loads(raw, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('ADMISSION_NONFINITE')))


def historical(r):
    path = r.PROFILES / PROFILE / ('planning-config-v3-kernel-' + HISTORICAL + '.py')
    raw = r.private_read(path, 0, mode=0o640, gid=1000)
    need(sha(raw) == HISTORICAL, 'ADMISSION_HISTORICAL_KERNEL_CHANGED')
    module = types.ModuleType('unchanged_planning_f847')
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    # The old V4 case must keep comparing its own original kernel pin.
    proxy = types.SimpleNamespace(**vars(r))
    proxy.PLANNING_CONFIG_V3_KERNEL_SHA256 = HISTORICAL
    return module, proxy


def document(r, reference, prefix):
    need(isinstance(reference, dict) and set(reference) == {'path', 'sha256'}
         and isinstance(reference['path'], str)
         and isinstance(reference['sha256'], str)
         and re.fullmatch('[0-9a-f]{64}', reference['sha256']), 'ADMISSION_REFERENCE')
    path = Path(reference['path'])
    need(path.parent == r.PROFILES / PROFILE
         and re.fullmatch(re.escape(prefix) + '[0-9a-f-]{36}\\.json', path.name), 'ADMISSION_REFERENCE_PATH')
    raw = r.private_read(path, 0, mode=0o640, gid=1000)
    need(sha(raw) == reference['sha256'], 'ADMISSION_REFERENCE_CHANGED')
    return parse(raw)


def build_evidence(r):
    values = []
    for prefix, expected in [('admission-image-built-', BUILT), ('admission-image-acceptance-', ACCEPTANCE)]:
        raw = r.private_read(r.PROFILES / PROFILE / (prefix + BUILD_ID + '.json'), 0, mode=0o640, gid=1000)
        need(sha(raw) == expected, 'ADMISSION_ACTUAL_IMAGE_RECEIPT_CHANGED')
        values.append(parse(raw))
    built, accepted = values
    need(built['candidateImage'] == accepted['candidateImage'] == NEW
         and built['baseImage'] == OLD and built['hotfixSourceRevision'] == NEW_SOURCE
         and built['imageConfigSha256'] == CONFIG and built['rootFsSha256'] == ROOTFS
         and built['canonicalFullBuildClaimed'] is False
         and built['imageConfigUnchanged'] is True
         and built['originalFileMetadataPreserved'] is True
         and built['productionActivated'] is False
         and accepted['productionActivated'] is False
         and accepted['ownBuildContainerRemoved'] is True
         and accepted['productionContainerConfigurationsUnchanged'] is True,
         'ADMISSION_ACTUAL_BUILD_SCOPE')
    return built, accepted


def target(stage):
    need(stage in {'forward', 'reverse'}, 'ADMISSION_STAGE')
    image, source = (NEW, NEW_SOURCE) if stage == 'forward' else (OLD, OLD_SOURCE)
    return {'imageId': image, 'sourceRevision': source, 'profileGeneration': PROFILE}


def case_for(r, p):
    c = document(r, p['caseReference'], 'admission-image-case-')
    fields = {'contractVersion', 'caseId', 'stage', 'approvalRef', 'kernelSha256', 'previous',
              'parentProof', 'environmentMetadata', 'composeHashes', 'sourceEnvironmentSha256',
              'sourceSpecSha256', 'baselineSha256', 'sourceProcess', 'checkedAt', 'expiresAt'}
    need(isinstance(c, dict) and set(c) == fields and c['contractVersion'] == 'cop-projection-admission-case-v1'
         and r.PROFILE_UUID.fullmatch(c['caseId']) and c['stage'] in {'forward', 'reverse'}
         and c['approvalRef'] == APPROVAL and c['kernelSha256'] == r.PLANNING_CONFIG_V3_KERNEL_SHA256
         and Path(p['caseReference']['path']).name == 'admission-image-case-' + c['caseId'] + '.json',
         'ADMISSION_CASE_SCOPE')
    process = c['sourceProcess']
    need(isinstance(process, dict) and set(process) == {'pid', 'restartCount', 'startedAt', 'running'}
         and type(process['pid']) is int and process['pid'] >= 0
         and type(process['restartCount']) is int and process['restartCount'] >= 0
         and type(process['running']) is bool and isinstance(process['startedAt'], str), 'ADMISSION_SOURCE_PROCESS')
    a, b = map(r.fenced_timestamp, (c['checkedAt'], c['expiresAt']))
    need(0 < b - a <= 900, 'ADMISSION_CASE_LIFETIME')
    return c


def schema(r, p):
    need(isinstance(p, dict), 'ADMISSION_PROOF_OBJECT')
    if p.get('contractVersion') != VERSION:
        old, proxy = historical(r)
        return old.schema(proxy, p)
    fields = {'contractVersion', 'transitionId', 'operation', 'stage', 'previous', 'target',
              'changedKeys', 'environmentMetadata', 'composeHashes', 'ownerAcceptance', 'checks',
              'cleanReset', 'parentProof', 'caseReference', 'checkedAt', 'expiresAt',
              'sourceSpecSha256', 'baselineSha256'}
    need(set(p) == fields and p['operation'] == 'maintain' and p['ownerAcceptance'] is True
         and p['changedKeys'] == [] and p['target'] == target(p['stage']), 'ADMISSION_PROOF_SCOPE')
    c = case_for(r, p)
    need(p['transitionId'] == c['caseId'] and p['stage'] == c['stage']
         and all(p[key] == c[key] for key in ('previous', 'parentProof', 'environmentMetadata',
                                             'composeHashes', 'sourceSpecSha256', 'baselineSha256')),
         'ADMISSION_PROOF_CASE_CAS')
    need(set(p['composeHashes']) == set(r.FILES)
         and all(isinstance(v, str) and re.fullmatch('[0-9a-f]{64}', v) for v in p['composeHashes'].values())
         and isinstance(p['checks'], dict) and p['checks']
         and all(type(v) is bool and v for v in p['checks'].values()), 'ADMISSION_PROTECTIONS')
    for key in ('sourceSpecSha256', 'baselineSha256'):
        need(isinstance(p[key], str) and re.fullmatch('[0-9a-f]{64}', p[key]), 'ADMISSION_DIGEST')
    need(isinstance(c['sourceEnvironmentSha256'], str)
         and re.fullmatch('[0-9a-f]{64}', c['sourceEnvironmentSha256']), 'ADMISSION_ENV_DIGEST')
    a, b = map(r.fenced_timestamp, (p['checkedAt'], p['expiresAt']))
    need(r.fenced_timestamp(c['checkedAt']) <= a < b <= r.fenced_timestamp(c['expiresAt'])
         and b - a <= 900, 'ADMISSION_PROOF_LIFETIME')
    build_evidence(r)
    return p


def evidence(r, p, fresh=True):
    need(isinstance(p, dict), 'ADMISSION_PROOF_OBJECT')
    if p.get('contractVersion') != VERSION:
        old, proxy = historical(r)
        return old.evidence(proxy, p, fresh)
    schema(r, p)
    if fresh:
        need(r.fenced_timestamp(p['checkedAt']) <= r.datetime.now(r.timezone.utc).timestamp()
             <= r.fenced_timestamp(p['expiresAt']), 'ADMISSION_EXPIRED')
        c = case_for(r, p)
        store = r.Store(uid=1000)
        need(store.pointer() == p['previous'], 'ADMISSION_CURRENT_CAS')
        current = json.loads(store.docker.run(['docker', 'inspect', p['previous']['containerId']]))[0]
        process = {'pid': current['State']['Pid'], 'restartCount': current['RestartCount'],
                   'startedAt': current['State']['StartedAt'], 'running': current['State']['Running']}
        need(current['Id'] == p['previous']['containerId'] and current['Image'] == p['previous']['imageId']
             and process == c['sourceProcess'] and current['State'].get('Restarting') is not True
             and r.sha(r.encoded(r.fenced_public_source_spec(current))) == p['sourceSpecSha256'],
             'ADMISSION_SOURCE_DRIFT')
        if p['stage'] == 'forward':
            need(current['State']['Running'] is True and current['State'].get('Health', {}).get('Status') == 'healthy',
                 'ADMISSION_FORWARD_SOURCE_UNHEALTHY')
    return p


def read_proof(r, store, path, raw, binding):
    p = parse(raw)
    if p.get('contractVersion') != VERSION:
        old, proxy = historical(r)
        return old.read_proof(proxy, store, path, raw, binding)
    schema(r, p)
    need(Path(path) == r.PROFILES / PROFILE / ('account-erasure-' + p['transitionId'] + '.json')
         and binding['profileId'] == PROFILE and all(binding[k] == p['target'][k] for k in p['target'])
         and binding['previousReleaseId'] == p['previous']['releaseId']
         and ('composeHashes' not in binding or binding['composeHashes'] == p['composeHashes']), 'ADMISSION_BINDING')
    origin = r.private_json(store.root / 'releases' / p['previous']['releaseId'] / 'release.json', store.uid)
    expected = (OLD, OLD_SOURCE) if p['stage'] == 'forward' else (NEW, NEW_SOURCE)
    need((origin['imageId'], origin['sourceRevision']) == expected and origin['profileId'] == PROFILE
         and origin['accountErasureConfig'] == p['parentProof'], 'ADMISSION_PARENT_LINEAGE')
    _, parent = store.erasure_config_proof(Path(p['parentProof']['path']), origin, p['parentProof']['sha256'])
    expected_parent = ('cop-planning-enable-v4', 'enable') if p['stage'] == 'forward' else (VERSION, 'forward')
    need((parent['contractVersion'], parent['stage']) == expected_parent
         and all(parent[k] == p[k] for k in ('checks', 'cleanReset', 'environmentMetadata', 'composeHashes')),
         'ADMISSION_PARENT_PROTECTIONS')
    if p['stage'] == 'reverse':
        need(p['baselineSha256'] == parent['baselineSha256']
             and case_for(r, p)['sourceEnvironmentSha256'] == case_for(r, parent)['sourceEnvironmentSha256'],
             'ADMISSION_REVERSE_NOT_ORIGINAL_BASELINE_ENV')
    return sha(raw), p


def environment(r, actual, desired, p):
    need(isinstance(p, dict), 'ADMISSION_PROOF_OBJECT')
    if p.get('contractVersion') != VERSION:
        old, proxy = historical(r)
        return old.environment(proxy, actual, desired, p)
    evidence(r, p, True)
    need(actual == desired and sha(canonical(actual)) == case_for(r, p)['sourceEnvironmentSha256'],
         'ADMISSION_ENV_CHANGED')
    need(desired.get('COP_AUTH_MODE') == 'oidc' and desired.get('COP_ALLOW_LAB_TOKEN') == 'false'
         and desired.get('COP_ACCOUNT_ERASURE_ENABLED') == 'true'
         and desired.get('COP_ACCOUNT_SAFETY_GUARD_REQUIRED') == 'true', 'ADMISSION_AUTH_ERASURE_REQUIRED')
    return True


def image(r, docker, inspected, revision):
    need(inspected['Id'] == NEW and revision == NEW_SOURCE, 'ADMISSION_IMAGE_IDENTITY')
    parent = json.loads(docker.run(['docker', 'image', 'inspect', OLD]))[0]
    need(parent['Id'] == OLD and inspected['Config'] == parent['Config']
         and sha(canonical(inspected['Config'])) == CONFIG
         and sha(canonical(inspected['RootFS'])) == ROOTFS
         and inspected['RootFS']['Layers'][:-1] == parent['RootFS']['Layers']
         and len(inspected['RootFS']['Layers']) == len(parent['RootFS']['Layers']) + 1
         and inspected.get('Os') == parent.get('Os') == 'linux'
         and inspected.get('Architecture') == parent.get('Architecture') == 'amd64',
         'ADMISSION_EXACT_OVERLAY')
    build_evidence(r)


def health_scope(r, store, p):
    if p.get('contractVersion') != VERSION:
        old, proxy = historical(r)
        return old.health_scope(proxy, store, p)
    return _health_scope(r, store, p)


@contextmanager
def _health_scope(r, store, p):
    evidence(r, p, True)
    need(getattr(store.docker, 'planning_config_v3_health_scope', None) is None, 'ADMISSION_HEALTH_NESTED')
    baseline_path = r.PROFILES / PROFILE / ('planning-config-v3-source-health-' + p['transitionId'] + '.json')
    baseline = r.private_read(baseline_path, 0, mode=0o640, gid=1000)
    need(sha(baseline) == p['baselineSha256'], 'ADMISSION_BASELINE_CHANGED')
    r.health_statuses(json.loads(baseline))
    health_path = r.PROFILES / PROFILE / ('planning-config-v3-health-' + HEALTH + '.py')
    raw = r.private_read(health_path, 0, mode=0o640, gid=1000)
    need(sha(raw) == HEALTH, 'ADMISSION_HEALTH_SOURCE_CHANGED')
    health = types.ModuleType('unchanged_admission_health')
    exec(compile(raw, str(health_path), 'exec'), health.__dict__)
    original = store.docker.health
    prior = store.docker.__dict__.get('health'); had = 'health' in store.docker.__dict__; calls = []
    def scoped(action, path):
        need((action == 'capture' and path is None and calls == [])
             or (action == 'verify' and Path(path) == store.root / 'pending-health.json' and calls == ['capture']),
             'ADMISSION_HEALTH_CALL_ORDER')
        if action == 'verify':
            need(sha(r.private_read(path, store.uid)) == p['baselineSha256'], 'ADMISSION_PENDING_BASELINE_CHANGED')
        started = __import__('time').monotonic()
        # Accepted return compares the retained healthy pre-forward baseline;
        # it must not require a broken candidate to become healthy before return.
        if action == 'capture' and p['stage'] == 'reverse':
            verified, observation = baseline, {'historicalBaselineUsedForReturn': True, 'freshTargetVerified': False}
        else:
            verified, observation = health.verify(r, baseline)
        if action == 'verify':
            pending = r.private_json(store.root / 'pending.json', store.uid)
            need(pending['previous'] == p['previous'], 'ADMISSION_PENDING_CAS')
            directory, binding, profile = store.binding(pending['targetReleaseId'])
            actual = store.docker.current(directory); expected = target(p['stage'])
            while actual['State'].get('Health', {}).get('Status') == 'starting':
                need(actual['Id'] == pending['targetContainerId'] and actual['Image'] == expected['imageId']
                     and actual['RestartCount'] == 0 and actual['State']['Running'] is True
                     and __import__('time').monotonic() < started + 120, 'ADMISSION_TARGET_WAIT_FAILED')
                __import__('time').sleep(min(1, max(0, started + 120 - __import__('time').monotonic())))
                actual = store.docker.current(directory)
            need(binding['imageId'] == expected['imageId'] and binding['sourceRevision'] == expected['sourceRevision']
                 and actual['Id'] == pending['targetContainerId'] and actual['Image'] == expected['imageId']
                 and actual['RestartCount'] == 0 and actual['State']['Running'] is True
                 and actual['State'].get('Health', {}).get('Status') == 'healthy', 'ADMISSION_TARGET_UNPROVEN')
        store.write(store.root / ('admission-image-' + p['transitionId'] + '-' + action + '-health-observation.json'), r.encoded(observation))
        calls.append(action)
        return baseline if action == 'capture' else verified
    store.docker.planning_config_v3_health_scope = p
    store.docker.health = scoped
    try:
        yield
    finally:
        if had:
            store.docker.health = prior
        else:
            del store.docker.health
        store.docker.planning_config_v3_health_scope = None
