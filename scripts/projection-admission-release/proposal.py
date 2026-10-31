"""Finite RAM proposal; returns metadata bytes, never installs or issues a GO.

Root holds the existing lock, independently checks current runtime/peers and
captures health. Environment values stay in Root memory and never enter output.
"""
import copy
import datetime
from pathlib import Path
import uuid


def propose(r, kernel, store, operation_id, stage, *, current, environment,
            environment_metadata, compose_bytes, baseline_bytes, candidate_checks=None):
    k = kernel
    k.need(str(uuid.UUID(operation_id)) == operation_id, 'ADMISSION_PROPOSAL_UUID')
    active, directory, binding, profile = store.active()
    expected = (k.OLD, k.OLD_SOURCE) if stage == 'forward' else (k.NEW, k.NEW_SOURCE)
    k.need(stage in {'forward', 'reverse'} and (binding['imageId'], binding['sourceRevision']) == expected
           and current['Id'] == active['containerId'] and current['Image'] == active['imageId'] == expected[0]
           and binding['profileGeneration'] == k.PROFILE, 'ADMISSION_PROPOSAL_SOURCE')
    reference = copy.deepcopy(binding['accountErasureConfig'])
    _, parent = store.erasure_config_proof(Path(reference['path']), binding, reference['sha256'])
    expected_parent = ('cop-planning-enable-v4', 'enable') if stage == 'forward' else (k.VERSION, 'forward')
    k.need((parent['contractVersion'], parent['stage']) == expected_parent
           and environment_metadata == parent['environmentMetadata']
           and {name: k.sha(raw) for name, raw in compose_bytes.items()} == binding['composeHashes'] == parent['composeHashes'],
           'ADMISSION_PROPOSAL_PARENT')
    r.health_statuses(k.parse(baseline_bytes))
    baseline_sha = k.sha(baseline_bytes)
    if stage == 'reverse':
        k.need(baseline_sha == parent['baselineSha256']
               and k.sha(k.canonical(environment)) == k.case_for(r, parent)['sourceEnvironmentSha256'],
               'ADMISSION_PROPOSAL_RETURN_BASELINE_ENV')
    now = r.datetime.now(r.timezone.utc)
    stamp = lambda value: value.isoformat().replace('+00:00', 'Z')
    start, end = stamp(now), stamp(now + datetime.timedelta(seconds=900))
    source_spec_sha = r.sha(r.encoded(r.fenced_public_source_spec(current)))
    process = {'pid': current['State']['Pid'], 'restartCount': current['RestartCount'],
               'startedAt': current['State']['StartedAt'], 'running': current['State']['Running']}
    case = {'contractVersion': 'cop-projection-admission-case-v1', 'caseId': operation_id, 'stage': stage,
            'approvalRef': k.APPROVAL, 'kernelSha256': r.PLANNING_CONFIG_V3_KERNEL_SHA256,
            'previous': copy.deepcopy(active), 'parentProof': reference,
            'environmentMetadata': copy.deepcopy(environment_metadata), 'composeHashes': copy.deepcopy(binding['composeHashes']),
            'sourceEnvironmentSha256': k.sha(k.canonical(environment)), 'sourceSpecSha256': source_spec_sha,
            'baselineSha256': baseline_sha, 'sourceProcess': process, 'checkedAt': start, 'expiresAt': end}
    encode = lambda value: k.canonical(value) + b'\n'
    case_name = 'admission-image-case-' + operation_id + '.json'
    proof = {'contractVersion': k.VERSION, 'transitionId': operation_id, 'operation': 'maintain', 'stage': stage,
             'previous': copy.deepcopy(active), 'target': k.target(stage), 'changedKeys': [],
             'environmentMetadata': copy.deepcopy(environment_metadata), 'composeHashes': copy.deepcopy(binding['composeHashes']),
             'ownerAcceptance': True, 'checks': copy.deepcopy(parent['checks']), 'cleanReset': copy.deepcopy(parent['cleanReset']),
             'parentProof': reference, 'caseReference': {'path': str(r.PROFILES / k.PROFILE / case_name), 'sha256': k.sha(encode(case))},
             'checkedAt': start, 'expiresAt': end, 'sourceSpecSha256': source_spec_sha, 'baselineSha256': baseline_sha}
    outputs = {case_name: encode(case), 'account-erasure-' + operation_id + '.json': encode(proof),
               'planning-config-v3-source-health-' + operation_id + '.json': baseline_bytes}
    image = k.target(stage)['imageId']
    attestation_path = r.PROFILES / k.PROFILE / ('attestation-' + image[7:] + '.json')
    if stage == 'forward':
        k.need(candidate_checks == {'x5RuntimeGuard': True, 'sharpConversion': True, 'databaseRouting': True}
               and all(type(value) is bool for value in candidate_checks.values()),
               'ADMISSION_PROPOSAL_CANDIDATE_COMPATIBILITY_UNPROVEN')
        attestation = {'contractVersion': 'cop-api-runtime-attestation-v1', 'application': 'cop', 'service': 'cop-api',
                       **k.target(stage), 'kind': 'candidate', 'ownerAcceptance': True,
                       'driverContract': copy.deepcopy(binding['driverContract']),
                       'checks': {**candidate_checks, 'acceptedBaselineRollback': False},
                       'legacyContainerId': None, 'legacyEnvPresence': None}
        outputs[attestation_path.name] = encode(attestation)
    else:
        # The immutable existing rollback attestation must be validated by Root;
        # this proposal never rewrites it or invents a replacement.
        target_binding = {**binding, **k.target(stage), 'kind': 'candidate'}
        _, contract, legacy_id, legacy_presence = store.attestation(attestation_path, target_binding)
        k.need(contract == binding['driverContract'] and legacy_id is None and legacy_presence is None,
               'ADMISSION_PROPOSAL_ROLLBACK_ATTESTATION')
    k.need(store.pointer() == active, 'ADMISSION_PROPOSAL_FINAL_CAS')
    return {'documents': outputs, 'proofPath': str(r.PROFILES / k.PROFILE / ('account-erasure-' + operation_id + '.json')),
            'attestationPath': str(attestation_path), 'expected': active['generation'], 'case': case, 'proof': proof,
            'goIssued': False, 'productionActivated': False}
