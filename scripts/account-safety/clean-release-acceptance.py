"""Root-owned isolated whole-provider acceptance gate. Read-only, no CLI/app API.
A component receipt, old v1 scope or caller-supplied success boolean is insufficient.
The actual whole12 producer has to write this report before any production stop.
"""
import datetime
import hashlib
import json
from pathlib import Path
import re

REPORT = Path('/srv/cop/runtime/clean-reset/whole12-acceptance.json')
OWNERS = frozenset({'keycloak', 'cop_sessions_profiles', 'cop_devices', 'messaging_matrix',
 'voice_livekit', 'cop_content_media', 'mobility_dispatch', 'sim_measurements', 'ai_router',
 'moderation_audit', 'backup_restore', 'sim_user_data'})
IMAGE_KEYS = frozenset({'cop_api', 'cop_web', 'sim_api', 'sim_web', 'ai_router',
                       'situation_data', 'messaging_api', 'synapse', 'voice_proxy'})
HEX = re.compile(r'[a-f0-9]{64}')
IMAGE = re.compile(r'sha256:[a-f0-9]{64}')
UUID = re.compile(r'[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}')

# Operator-approved on 2026-10-18 for this one unchanged release. This is an
# exception to report age only, never a replacement or refreshed acceptance.
APPROVED_REPORT_SHA256 = '66b6fb13c8a52c3d06f6aecafe3c9b101e5376cda3049988843e9d4961e0e38a'
APPROVED_REPORT_STAMP = '2026-10-17T15:22:13Z'
APPROVED_REPORT_DEADLINE = '2026-10-19T15:22:00Z'
APPROVED_RELEASE_IMAGES = {
    'cop_api': 'sha256:28648cded21fbd52602a197693d0b0dc9eb213cd2bd84d6227b7da34c0cbab86',
    'cop_web': 'sha256:6481b7c29d462b10e365692231c19b1b88a631693a09826003333106771b7329',
    'sim_api': 'sha256:4076069b3f8c935c0cd07ea2bf95d92703270b72197ff2b74a27d1aee8c6bdf0',
    'sim_web': 'sha256:fea1f5c2d508392a509486fb9b4881a5524936a32967748c52583640bad878f7',
    'ai_router': 'sha256:3fcc09192e451c9a45f839271055e93f7b5250b6e05c6e122223e964ee0247a6',
    'situation_data': 'sha256:3c07a98618867f6bfe3712f6156c8100808d9f9d08f7f8a63e9e5f64b6719d94',
    'messaging_api': 'sha256:b14037387b410dc8647f84fb992e050bd6ac339f75a14fdf05374aed436fab8e',
    'synapse': 'sha256:a91dfb8de38a87d4cb9ccbc2008b99b397d3f64a4a5363cec65f41716132db19',
    'voice_proxy': 'sha256:05909abc87ca68db1810e6180ddfc655438688ace86cde5a1443a053d651d517',
}


def need(value, code='CLEAN_WHOLE_ACCEPTANCE_UNPROVEN'):
    if not value:
        raise RuntimeError(code)


def validate_candidate_images(images):
    need(isinstance(images, dict) and set(images) == IMAGE_KEYS
         and all(isinstance(v, str) and IMAGE.fullmatch(v) for v in images.values()),
         'CLEAN_WHOLE_IMAGE_BINDING')
    return images


def validate_voice_image_equivalence(report, expected_images):
    tested=report.get('testedRuntimeImages')
    need(isinstance(tested,dict) and set(tested)==IMAGE_KEYS, 'CLEAN_WHOLE_TESTED_IMAGES')
    for key in IMAGE_KEYS:
        need(isinstance(tested[key],str) and IMAGE.fullmatch(tested[key]), 'CLEAN_WHOLE_TESTED_IMAGES')
        if key!='voice_proxy':
            need(tested[key]==expected_images[key], 'CLEAN_WHOLE_TESTED_IMAGES')
    records=report.get('imageEquivalence',{})
    if tested['voice_proxy']==expected_images['voice_proxy']:
        need(records=={}, 'CLEAN_WHOLE_UNNEEDED_EQUIVALENCE')
        return
    need(isinstance(records,dict) and set(records)=={'voice_proxy'}, 'CLEAN_WHOLE_VOICE_EQUIVALENCE')
    e=records['voice_proxy']
    need(isinstance(e,dict) and e.get('kind')=='identical_rootfs_and_launch'
         and e.get('testedImageId')==tested['voice_proxy']
         and e.get('candidateImageId')==expected_images['voice_proxy'], 'CLEAN_WHOLE_VOICE_EQUIVALENCE')
    layers=e.get('testedRootFsDiffIds')
    need(isinstance(layers,list) and 0<len(layers)<=128
         and all(isinstance(x,str) and IMAGE.fullmatch(x) for x in layers)
         and layers==e.get('candidateRootFsDiffIds'), 'CLEAN_WHOLE_VOICE_ROOTFS')
    launch=e.get('testedLaunch')
    need(isinstance(launch,dict) and set(launch)=={'entrypoint','cmd','workingDir','user','envSha256'}
         and launch==e.get('candidateLaunch')
         and isinstance(launch['entrypoint'],list) and launch['entrypoint']
         and all(isinstance(x,str) for x in launch['entrypoint'])
         and (launch['cmd'] is None or isinstance(launch['cmd'],list) and all(isinstance(x,str) for x in launch['cmd']))
         and isinstance(launch['workingDir'],str) and isinstance(launch['user'],str)
         and isinstance(launch['envSha256'],str) and HEX.fullmatch(launch['envSha256']), 'CLEAN_WHOLE_VOICE_LAUNCH')


def validate_completed_outage_v3(value, operation):
    need(value.get('phase')=='completed_operation_replay'
         and value.get('dependencyHttpSequence')==[200,503,200]
         and all(type(x) is int for x in value['dependencyHttpSequence'])
         and value.get('operationStatus')=='deleted'
         and value.get('operationCompletedBeforeOutage') is True,
         'CLEAN_WHOLE_COMPLETED_OUTAGE')
    bindings=value.get('databaseBindingReadbacks')
    need(isinstance(bindings,dict) and set(bindings)=={'before','during','after'}, 'CLEAN_WHOLE_COMPLETED_BINDING')
    for binding in bindings.values():
        need(isinstance(binding,dict) and binding.get('operationId')==operation['operationId']
             and binding.get('resetEpoch')==operation['resetEpoch']
             and binding.get('operationState')=='deleted'
             and isinstance(binding.get('terminalBindingDigest'),str)
             and HEX.fullmatch(binding['terminalBindingDigest']), 'CLEAN_WHOLE_COMPLETED_BINDING')
    need(len({x['terminalBindingDigest'] for x in bindings.values()})==1, 'CLEAN_WHOLE_COMPLETED_BINDING_CHANGED')
    final=value.get('finalReadback')
    need(isinstance(final,dict) and final.get('operationId')==operation['operationId']
         and final.get('resetEpoch')==operation['resetEpoch'] and final.get('status')=='completed'
         and type(final.get('userARemaining')) is int and final['userARemaining']==0
         and isinstance(final.get('readbackDigest'),str) and HEX.fullmatch(final['readbackDigest']),
         'CLEAN_WHOLE_COMPLETED_FINAL')


def _validate_clean_whole_report(report, expected_images, now, version, *, raw_sha256=None):
    validate_candidate_images(expected_images)
    need(isinstance(report, dict) and report.get('contractVersion') == 'cop-sim-whole-clean-acceptance-v'+str(version)
         and report.get('deletionScope') == 'cop_sim_shared_identity_v1'
         and report.get('kind') == 'isolated_whole_provider'
         and report.get('productionTouched') is False
         and report.get('externalProviderCalls') == 0 and report.get('actorCount') == 2)
    need(report.get('candidateImages') == expected_images, 'CLEAN_WHOLE_IMAGE_BINDING')
    if version==3:
        need(isinstance(report.get('resetEpoch'),str) and UUID.fullmatch(report['resetEpoch']), 'CLEAN_WHOLE_RESET_EPOCH')
        validate_voice_image_equivalence(report,expected_images)
    stamp = report.get('checkedAt')
    need(isinstance(stamp, str) and stamp.endswith('Z'), 'CLEAN_WHOLE_TIME')
    checked = datetime.datetime.fromisoformat(stamp.replace('Z', '+00:00')).timestamp()
    deadline = datetime.datetime.fromisoformat(APPROVED_REPORT_DEADLINE.replace('Z', '+00:00')).timestamp()
    approved_age = (version == 3 and raw_sha256 == APPROVED_REPORT_SHA256
                    and stamp == APPROVED_REPORT_STAMP
                    and expected_images == APPROVED_RELEASE_IMAGES
                    and checked <= now <= deadline)
    need(0 <= now - checked <= 24*3600 or approved_age, 'CLEAN_WHOLE_TIME')
    op = report.get('operation')
    need(isinstance(op, dict) and isinstance(op.get('operationId'), str) and UUID.fullmatch(op['operationId'])
         and op.get('initialHttpStatus') == 202 and op.get('initialStatus') == 'deleting'
         and op.get('initialAccountDeleted') is False
         and op.get('finalHttpStatus') == 200 and op.get('finalStatus') == 'deleted'
         and op.get('finalAccountDeleted') is True
         and op.get('finalContractVersion') == 'cop-account-erasure-v2'
         and op.get('requiredOwners') == sorted(OWNERS))
    if version==3:
        need(op.get('resetEpoch')==report['resetEpoch'], 'CLEAN_WHOLE_RESET_EPOCH')
    owners = report.get('providerReadbacks')
    need(isinstance(owners, dict) and set(owners) == OWNERS)
    for owner, value in owners.items():
        need(isinstance(value, dict) and value.get('operationId') == op['operationId']
             and value.get('status') == 'completed' and value.get('userARemaining') == 0
             and isinstance(value.get('userBStateBefore'), str) and HEX.fullmatch(value['userBStateBefore'])
             and value.get('userBStateBefore') == value.get('userBStateAfter')
             and isinstance(value.get('readbackDigest'), str) and HEX.fullmatch(value['readbackDigest']))
        if version==3:
            need(value.get('resetEpoch')==report['resetEpoch']
                 and type(value.get('userARemaining')) is int, 'CLEAN_WHOLE_OWNER_EPOCH')
    identity = report.get('identityReadback')
    need(isinstance(identity, dict) and identity.get('userAGetStatus') == 404
         and identity.get('userARefreshStatus') in (400, 401)
         and (identity.get('userALoginStatus') in (400, 401)
              or identity.get('userALoginStatus') == 200
              and identity.get('userALoginDenied') is True
              and identity.get('userALoginKnownError') is True)
         and identity.get('userBProfileStatus') == 200 and identity.get('userBRefreshStatus') == 200
         and identity.get('deletedAfterProviderProofs') is True)
    cases = report.get('recoveryReadbacks')
    need(isinstance(cases, dict) and set(cases) == {'router_outage', 'messaging_outage', 'worker_restart', 'restored_user_data', 'late_write'})
    for name, value in cases.items():
        need(isinstance(value, dict) and value.get('operationId') == op['operationId']
             and value.get('finalUserARemaining') == 0 and value.get('userBPreserved') is True
             and isinstance(value.get('readbackDigest'), str) and HEX.fullmatch(value['readbackDigest']))
        if version==3:
            need(value.get('resetEpoch')==report['resetEpoch']
                 and type(value.get('finalUserARemaining')) is int, 'CLEAN_WHOLE_RECOVERY_EPOCH')
        if name in {'router_outage', 'messaging_outage'}:
            if version==2:
                need(value.get('dependencyHttpStatus') == 503 and value.get('operationStatus') == 'deleting')
            else:
                validate_completed_outage_v3(value,op)
        if name == 'late_write':
            need(value.get('httpStatus') in (401, 403, 409, 410, 503) and value.get('rowsRecreated') == 0)
        if name == 'restored_user_data':
            need(type(value.get('restoredRows')) is int and value['restoredRows'] > 0)
    pins = report.get('testedSourceDigests')
    need(isinstance(pins, dict) and set(pins) == {'cop', 'sim', 'messaging', 'producer'}
         and all(isinstance(v, str) and HEX.fullmatch(v) for v in pins.values()))
    return {'contractVersion': report['contractVersion'], 'operationId': op['operationId'],
            'candidateImages': expected_images, 'checkedAt': stamp,
            **({'resetEpoch':report['resetEpoch'],'outageSemantics':'completed_operation_replay'} if version==3 else {})}


def validate_clean_whole_report(report, expected_images, now):
    """Original v2 pending-outage contract; never accepts relabeled v3 evidence."""
    return _validate_clean_whole_report(report,expected_images,now,2)


def validate_clean_whole_report_v3(report, expected_images, now):
    """Separate explicit v3 contract: completed-operation dependency replay."""
    return _validate_clean_whole_report(report,expected_images,now,3)


def validate_clean_whole_report_bytes(raw, expected_images, now):
    """Validate original bytes; callers must enforce custody before this gate.

    Only an exact byte digest can use the finite approved age exception. Dict
    validators keep their normal 24-hour limit and cannot opt into it.
    """
    need(isinstance(raw, bytes), 'CLEAN_WHOLE_REPORT_BYTES')
    report = json.loads(raw)
    version = 3 if isinstance(report, dict) and report.get('contractVersion') == 'cop-sim-whole-clean-acceptance-v3' else 2
    digest = hashlib.sha256(raw).hexdigest()
    value = _validate_clean_whole_report(report, expected_images, now, version, raw_sha256=digest)
    return {**value, 'reportSha256': digest}


def verified_pre_stop_acceptance(expected_images):
    # Use the same actual Root custody reader as the production controller.
    import importlib.util
    spec = importlib.util.spec_from_file_location('clean_gate_root', Path(__file__).with_name('clean-reset-root.py'))
    root = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(root)
    need(root.os.getuid() == 0, 'CLEAN_WHOLE_ROOT_REQUIRED')
    raw = root.protected(REPORT)
    return validate_clean_whole_report_bytes(raw, expected_images, datetime.datetime.now(datetime.timezone.utc).timestamp())


def validate_for_plan(plan):
    """Fixed coordinator import; no caller callback or success flag."""
    need(isinstance(plan, dict) and plan.get('scope') == 'cop_sim_shared_identity_v1', 'CLEAN_WHOLE_PLAN_SCOPE')
    return verified_pre_stop_acceptance(plan['candidateImages'])
