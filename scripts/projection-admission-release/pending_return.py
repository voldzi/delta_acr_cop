"""Closed pending return for the exact admission pair; never generic rollback.

Root supplies a fresh immutable authorization. Original pending bytes are retained.
No CLI, automatic retry, intake pause, configuration change or DB operation.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import types
import uuid

VERSION = 'cop-admission-pending-return-v1'
JOURNAL = 'admission-pending-return.json'


def need(ok, code):
    if not ok:
        raise ValueError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def digest(value):
    return sha(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode())


def process(actual):
    return {'pid': actual['State']['Pid'], 'restartCount': actual['RestartCount'],
            'startedAt': actual['State']['StartedAt'], 'running': actual['State']['Running']}


def inspect_pending(r, k, store):
    archive = None
    if os.path.lexists(store.root / JOURNAL):
        own = k.parse(r.private_read(store.root / JOURNAL, store.uid))
        if own.get('archiveId') is not None:
            need(r.PROFILE_UUID.fullmatch(own['archiveId']), 'ADMISSION_RETURN_ARCHIVE_ID')
            archive = store.directory(store.root / 'admission-return-history' / own['archiveId'])
    def retained(name):
        original = store.root / name
        if os.path.lexists(original):
            return original
        need(archive is not None, 'ADMISSION_RETURN_ORIGINAL_MISSING')
        return archive / name
    pending_path, health_path = retained('pending.json'), retained('pending-health.json')
    raw = r.private_read(pending_path, store.uid)
    health = r.private_read(health_path, store.uid)
    pending = k.parse(raw)
    need(set(pending) == {'contractVersion', 'previous', 'targetReleaseId', 'targetContainerId', 'restoredContainerId', 'peers'}
         and pending['contractVersion'] == 'cop-api-runtime-pending-v1'
         and pending['restoredContainerId'] is None, 'ADMISSION_RETURN_PENDING_SCOPE')
    for value in (pending['targetContainerId'], pending['previous']['containerId']):
        need(value is None or (isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value)), 'ADMISSION_RETURN_PENDING_CID')
    old_dir, old_binding, old_profile = store.binding(pending['previous']['releaseId'], probe_mounts=False)
    new_dir, new_binding, new_profile = store.binding(pending['targetReleaseId'], probe_mounts=False)
    need((old_binding['imageId'], old_binding['sourceRevision']) == (k.OLD, k.OLD_SOURCE)
         and (new_binding['imageId'], new_binding['sourceRevision']) == (k.NEW, k.NEW_SOURCE)
         and new_binding['previousReleaseId'] == old_binding['releaseId']
         and old_binding['profileGeneration'] == new_binding['profileGeneration'] == k.PROFILE
         and old_binding['driverContract'] == new_binding['driverContract']
         and old_binding['composeHashes'] == new_binding['composeHashes'], 'ADMISSION_RETURN_EXACT_PAIR')
    reference = new_binding['accountErasureConfig']
    _, forward = store.erasure_config_proof(Path(reference['path']), new_binding, reference['sha256'])
    need(forward['contractVersion'] == k.VERSION and forward['stage'] == 'forward'
         and forward['previous'] == pending['previous']
         and forward['parentProof'] == old_binding['accountErasureConfig']
         and forward['composeHashes'] == old_binding['composeHashes']
         and sha(health) == forward['baselineSha256'], 'ADMISSION_RETURN_FORWARD_LINEAGE')
    r.health_statuses(k.parse(health))
    current = store.docker.current(new_dir)
    labels = current['Config'].get('Labels', {})
    if current['Image'] == k.NEW:
        need(labels.get('com.cop.runtime.release') == new_binding['releaseId']
             and pending['targetContainerId'] in {None, current['Id']}, 'ADMISSION_RETURN_NEW_TARGET')
        store.docker.live(new_dir, new_binding, new_profile)
    else:
        need(current['Image'] == k.OLD and labels.get('com.cop.runtime.release') == old_binding['releaseId'],
             'ADMISSION_RETURN_OLD_TARGET')
        store.docker.live(old_dir, old_binding, old_profile)
    need(store.docker.peers(new_dir) == pending['peers'], 'ADMISSION_RETURN_PEERS_CHANGED')
    return types.SimpleNamespace(raw=raw, health=health, pending_path=pending_path, health_path=health_path,
        pending=pending, forward=forward, reference=reference,
        old_dir=old_dir, old_binding=old_binding, old_profile=old_profile,
        new_dir=new_dir, new_binding=new_binding, new_profile=new_profile, current=current)


def propose(r, k, store, operation_id, mode):
    """Read-only Root preparation; the result is not a GO or a published proof."""
    need(str(uuid.UUID(operation_id)) == operation_id and mode in {'start', 'finish', 'adopt-finish'}, 'ADMISSION_RETURN_OPERATION')
    v = inspect_pending(r, k, store)
    active = store.pointer()
    own = store.root / JOURNAL
    journal_raw = r.private_read(own, store.uid) if os.path.lexists(own) else None
    now = r.datetime.now(r.timezone.utc)
    stamp = lambda value: value.isoformat().replace('+00:00', 'Z')
    p = {'contractVersion': VERSION, 'transitionId': operation_id, 'mode': mode, 'approvalRef': k.APPROVAL,
         'kernelSha256': r.PLANNING_CONFIG_V3_KERNEL_SHA256, 'workerSha256': r.ADMISSION_PENDING_RETURN_SHA256,
         'activePointer': active, 'pendingPrevious': v.pending['previous'], 'forwardReleaseId': v.new_binding['releaseId'],
         'forwardProof': v.reference, 'pendingSha256': sha(v.raw), 'pendingHealthSha256': sha(v.health),
         'returnJournalSha256': sha(journal_raw) if journal_raw is not None else None,
         'physicalSource': {'containerId': v.current['Id'], 'imageId': v.current['Image'],
                            'specSha256': r.sha(r.encoded(r.fenced_public_source_spec(v.current))), **process(v.current)},
         'peersSha256': digest(v.pending['peers']), 'environmentMetadata': v.forward['environmentMetadata'],
         'composeHashes': v.forward['composeHashes'], 'checkedAt': stamp(now),
         'expiresAt': stamp(now + datetime.timedelta(seconds=900))}
    validate(r, k, store, p, v)
    return {'document': r.encoded(p), 'path': str(r.PROFILES / k.PROFILE / ('admission-pending-return-' + operation_id + '.json')),
            'goIssued': False, 'productionChanged': False}


def validate(r, k, store, p, v):
    fields = {'contractVersion', 'transitionId', 'mode', 'approvalRef', 'kernelSha256', 'workerSha256', 'activePointer',
              'pendingPrevious', 'forwardReleaseId', 'forwardProof', 'pendingSha256', 'pendingHealthSha256',
              'returnJournalSha256', 'physicalSource', 'peersSha256', 'environmentMetadata', 'composeHashes', 'checkedAt', 'expiresAt'}
    need(isinstance(p, dict) and set(p) == fields and p['contractVersion'] == VERSION
         and r.PROFILE_UUID.fullmatch(p['transitionId']) and p['mode'] in {'start', 'finish', 'adopt-finish'}
         and p['approvalRef'] == k.APPROVAL and p['kernelSha256'] == r.PLANNING_CONFIG_V3_KERNEL_SHA256
         and p['workerSha256'] == r.ADMISSION_PENDING_RETURN_SHA256, 'ADMISSION_RETURN_AUTHORITY_SCOPE')
    a, b = map(r.fenced_timestamp, (p['checkedAt'], p['expiresAt']))
    need(0 < b - a <= 900 and a <= r.datetime.now(r.timezone.utc).timestamp() <= b, 'ADMISSION_RETURN_EXPIRED')
    need(store.pointer() == p['activePointer'] and p['pendingPrevious'] == v.pending['previous']
         and p['forwardReleaseId'] == v.new_binding['releaseId'] and p['forwardProof'] == v.reference
         and p['pendingSha256'] == sha(v.raw) and p['pendingHealthSha256'] == sha(v.health)
         and p['peersSha256'] == digest(v.pending['peers'])
         and p['environmentMetadata'] == v.forward['environmentMetadata']
         and p['composeHashes'] == v.forward['composeHashes'], 'ADMISSION_RETURN_JOURNAL_CAS')
    physical = {'containerId': v.current['Id'], 'imageId': v.current['Image'],
                'specSha256': r.sha(r.encoded(r.fenced_public_source_spec(v.current))), **process(v.current)}
    need(p['physicalSource'] == physical and v.current['State'].get('Restarting') is not True,
         'ADMISSION_RETURN_SOURCE_DRIFT')
    need(r.environment_metadata(store.source / '.env', store.uid) == p['environmentMetadata'], 'ADMISSION_RETURN_ENV_CHANGED')
    own = store.root / JOURNAL
    if p['mode'] == 'start':
        need(p['activePointer'] == v.pending['previous'] and not os.path.lexists(own)
             and p['returnJournalSha256'] is None, 'ADMISSION_RETURN_ALREADY_STARTED')
        if v.current['Image'] == k.OLD:
            need(v.current['Id'] == v.pending['previous']['containerId'] and v.pending['targetContainerId'] is None,
                 'ADMISSION_RETURN_UNOWNED_OLD_SOURCE')
    else:
        raw = r.private_read(own, store.uid)
        journal = k.parse(raw)
        need(sha(raw) == p['returnJournalSha256'] and journal['contractVersion'] == 'cop-admission-return-journal-v1'
             and journal['pendingSha256'] == p['pendingSha256'] and journal['pendingHealthSha256'] == p['pendingHealthSha256']
             and journal['previous'] == v.pending['previous'] and journal['forwardReleaseId'] == p['forwardReleaseId']
             and v.current['Image'] == k.OLD and v.current['RestartCount'] == 0
             and v.current['State']['Running'] is True
             and (journal['targetContainerId'] == v.current['Id'] if p['mode'] == 'finish'
                  else journal['targetContainerId'] is None and v.current['Id'] != journal['originalPhysicalContainerId']),
             'ADMISSION_RETURN_CONTINUATION_SCOPE')
        if p['mode'] == 'adopt-finish':
            need(r.fenced_timestamp(journal['upStartedAt']) <= r.fenced_timestamp(v.current['State']['StartedAt'])
                 <= r.fenced_timestamp(journal['upExpiresAt']), 'ADMISSION_RETURN_ADOPTION_TIME')
        need(r.PROFILE_UUID.fullmatch(journal['transitionId']), 'ADMISSION_RETURN_ORIGINAL_OPERATION')
        original_path = r.PROFILES / k.PROFILE / ('admission-pending-return-' + journal['transitionId'] + '.json')
        original_raw = r.private_read(original_path, 0, mode=0o640, gid=1000)
        original = k.parse(original_raw)
        need(sha(original_raw) == journal['authorizationSha256'] and original['mode'] == 'start'
             and original['pendingSha256'] == p['pendingSha256']
             and original['pendingHealthSha256'] == p['pendingHealthSha256']
             and original['forwardReleaseId'] == p['forwardReleaseId'] and original['forwardProof'] == p['forwardProof']
             and original['physicalSource']['containerId'] == journal['originalPhysicalContainerId']
             and r.fenced_timestamp(original['checkedAt']) <= r.fenced_timestamp(journal['upStartedAt'])
             <= r.fenced_timestamp(original['expiresAt']) == r.fenced_timestamp(journal['upExpiresAt']),
             'ADMISSION_RETURN_ORIGINAL_AUTHORITY')
        pointer = p['activePointer']
        need(pointer == v.pending['previous'] or (pointer['releaseId'] == v.old_binding['releaseId']
             and pointer['containerId'] == v.current['Id'] and pointer['imageId'] == k.OLD
             and pointer['profileGeneration'] == k.PROFILE), 'ADMISSION_RETURN_CONTINUATION_POINTER')
    return p


def execute(r, k, store, path, expected):
    """Exactly one recreate or an explicitly authorized finish-only continuation."""
    path = Path(path)
    store.protected_directory(r.PROFILES / k.PROFILE)
    raw = r.private_read(path, 0, mode=0o640, gid=1000)
    p = k.parse(raw)
    need(path == r.PROFILES / k.PROFILE / ('admission-pending-return-' + p['transitionId'] + '.json'), 'ADMISSION_RETURN_AUTHORITY_PATH')
    need(expected == p['activePointer']['generation'], 'ADMISSION_RETURN_EXPECTED_CAS')
    store.guard()
    v = inspect_pending(r, k, store)
    validate(r, k, store, p, v)
    store.check_mounts(v.old_binding, v.old_profile)
    store.check_mounts(v.new_binding, v.new_profile)
    store.assert_erasure_environment(v.old_binding)
    store.assert_erasure_environment(v.new_binding)
    store.docker.image(k.OLD, revision=k.OLD_SOURCE)
    # Same original config/runtime parity gates; only the selected image/release
    # metadata may differ. No generic recover/activate rollback path is invoked.
    desired = store.docker.config(v.old_dir, v.old_profile['directory'])
    r.verify_api_diff(store.docker.config(v.old_dir), desired, v.old_profile['values'], v.old_profile['mode'],
                      k.OLD, v.old_binding['legacyEnvPresence'], store.clean_runtime_values(v.old_binding, desired),
                      auth_scope=v.old_binding['accountErasureConfig'].get('authScope') == r.POST_EDGE_AUTH_SCOPE)
    store.docker.preserve(v.old_dir, v.old_profile['directory'], v.current)
    store.docker.unchanged(v.new_dir, v.current)
    validate(r, k, store, p, inspect_pending(r, k, store))
    own = store.root / JOURNAL
    if p['mode'] == 'start':
        journal = {'contractVersion': 'cop-admission-return-journal-v1', 'transitionId': p['transitionId'],
                   'authorizationSha256': sha(raw), 'pendingSha256': p['pendingSha256'], 'pendingHealthSha256': p['pendingHealthSha256'],
                   'previous': v.pending['previous'], 'forwardReleaseId': p['forwardReleaseId'],
                   'originalPhysicalContainerId': v.current['Id'], 'targetContainerId': None,
                   'upStartedAt': r.datetime.now(r.timezone.utc).isoformat(), 'upExpiresAt': p['expiresAt']}
        store.write(own, r.encoded(journal))
        # One explicit COP-only recreation also handles a pre-up failure where
        # the unchanged old container still exists with its earlier restart count.
        store.docker.run(store.docker.compose(v.old_dir, v.old_profile['directory']) +
                         ['up', '-d', '--force-recreate', '--no-build', '--pull', 'never', '--no-deps', 'cop-api'])
        actual = store.docker.current(v.old_dir)
        need(actual['Image'] == k.OLD, 'ADMISSION_RETURN_IMAGE_UNPROVEN')
        journal['targetContainerId'] = actual['Id']; store.write(own, r.encoded(journal))
    else:
        journal = k.parse(r.private_read(own, store.uid))
        journal['targetContainerId'] = v.current['Id']
        store.write(own, r.encoded(journal))
    actual = store.docker.current(v.old_dir)
    need(actual['Id'] == journal['targetContainerId'] and actual['Image'] == k.OLD, 'ADMISSION_RETURN_TARGET_CAS')
    store.docker.live(v.old_dir, v.old_binding, v.old_profile)
    adapter_path = r.PROFILES / k.PROFILE / ('planning-config-v3-health-' + k.HEALTH + '.py')
    adapter_raw = r.private_read(adapter_path, 0, mode=0o640, gid=1000)
    need(sha(adapter_raw) == k.HEALTH, 'ADMISSION_RETURN_HEALTH_ADAPTER')
    adapter = types.ModuleType('unchanged_pending_return_health')
    exec(compile(adapter_raw, str(adapter_path), 'exec'), adapter.__dict__)
    started = __import__('time').monotonic()
    verified, observation = adapter.verify(r, v.health)
    actual = store.docker.current(v.old_dir)
    while actual['State'].get('Health', {}).get('Status') == 'starting':
        need(actual['Id'] == journal['targetContainerId'] and actual['Image'] == k.OLD and actual['RestartCount'] == 0
             and actual['State']['Running'] is True and __import__('time').monotonic() < started + 120,
             'ADMISSION_RETURN_TARGET_WAIT_FAILED')
        __import__('time').sleep(min(1, max(0, started + 120 - __import__('time').monotonic())))
        actual = store.docker.current(v.old_dir)
    need(actual['Id'] == journal['targetContainerId'] and actual['Image'] == k.OLD and actual['RestartCount'] == 0
         and actual['State']['Running'] is True and actual['State'].get('Health', {}).get('Status') == 'healthy',
         'ADMISSION_RETURN_TARGET_UNHEALTHY')
    need(store.docker.peers(v.old_dir) == v.pending['peers'], 'ADMISSION_RETURN_PEERS_CHANGED')
    need(sha(r.private_read(v.pending_path, store.uid)) == p['pendingSha256']
         and sha(r.private_read(v.health_path, store.uid)) == p['pendingHealthSha256'],
         'ADMISSION_RETURN_ORIGINAL_JOURNAL_CHANGED')
    store.docker.live(v.old_dir, v.old_binding, v.old_profile)
    store.docker.unchanged(v.old_dir, actual)
    store.assert_erasure_environment(v.old_binding)
    need(r.fenced_timestamp(p['checkedAt']) <= r.datetime.now(r.timezone.utc).timestamp() <= r.fenced_timestamp(p['expiresAt']),
         'ADMISSION_RETURN_EXPIRED_BEFORE_COMMIT')
    store.record_accepted_health(v.old_dir, v.old_binding, actual, verified)
    pointer = store.pointer()
    need(pointer == p['activePointer'], 'ADMISSION_RETURN_FINAL_CAS')
    if pointer == v.pending['previous']:
        pointer = store.commit_pointer(v.old_binding, expected, actual['Id'])
    else:
        need(pointer['containerId'] == actual['Id'] and pointer['releaseId'] == v.old_binding['releaseId'],
             'ADMISSION_RETURN_COMMITTED_POINTER_CHANGED')
    history = store.directory(store.root / 'admission-return-history', create=True)
    if journal.get('archiveId') is None:
        journal['archiveId'] = p['transitionId']
        store.write(own, r.encoded(journal))
    need(r.PROFILE_UUID.fullmatch(journal['archiveId']), 'ADMISSION_RETURN_ARCHIVE_ID')
    destination = store.directory(history / journal['archiveId'], create=True)
    store.write(destination / 'health-observation.json', r.encoded(observation))
    store.write(destination / 'authorization-reference.json', r.encoded({'path': str(path), 'sha256': sha(raw)}))
    # Preserve original bytes by rename only AFTER fresh health and pointer CAS.
    for name, expected_hash in [('pending.json', p['pendingSha256']), ('pending-health.json', p['pendingHealthSha256'])]:
        original, archived = store.root / name, destination / name
        if os.path.lexists(original):
            need(not os.path.lexists(archived) and sha(r.private_read(original, store.uid)) == expected_hash,
                 'ADMISSION_RETURN_ARCHIVE_EXISTS')
            os.replace(original, archived)
        else:
            need(sha(r.private_read(archived, store.uid)) == expected_hash, 'ADMISSION_RETURN_ARCHIVE_CHANGED')
    need(not os.path.lexists(destination / JOURNAL), 'ADMISSION_RETURN_ARCHIVE_EXISTS')
    os.replace(own, destination / JOURNAL)
    store.sync(destination); store.sync(store.root)
    return pointer
