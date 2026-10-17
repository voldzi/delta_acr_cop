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


def need(value, code='CLEAN_WHOLE_ACCEPTANCE_UNPROVEN'):
    if not value:
        raise RuntimeError(code)


def validate_candidate_images(images):
    need(isinstance(images, dict) and set(images) == IMAGE_KEYS
         and all(isinstance(v, str) and IMAGE.fullmatch(v) for v in images.values()),
         'CLEAN_WHOLE_IMAGE_BINDING')
    return images


def validate_clean_whole_report(report, expected_images, now):
    validate_candidate_images(expected_images)
    need(isinstance(report, dict) and report.get('contractVersion') == 'cop-sim-whole-clean-acceptance-v2'
         and report.get('deletionScope') == 'cop_sim_shared_identity_v1'
         and report.get('kind') == 'isolated_whole_provider'
         and report.get('productionTouched') is False
         and report.get('externalProviderCalls') == 0 and report.get('actorCount') == 2)
    need(report.get('candidateImages') == expected_images, 'CLEAN_WHOLE_IMAGE_BINDING')
    stamp = report.get('checkedAt')
    need(isinstance(stamp, str) and stamp.endswith('Z'), 'CLEAN_WHOLE_TIME')
    checked = datetime.datetime.fromisoformat(stamp.replace('Z', '+00:00')).timestamp()
    need(0 <= now - checked <= 24*3600, 'CLEAN_WHOLE_TIME')
    op = report.get('operation')
    need(isinstance(op, dict) and isinstance(op.get('operationId'), str) and UUID.fullmatch(op['operationId'])
         and op.get('initialHttpStatus') == 202 and op.get('initialStatus') == 'deleting'
         and op.get('initialAccountDeleted') is False
         and op.get('finalHttpStatus') == 200 and op.get('finalStatus') == 'deleted'
         and op.get('finalAccountDeleted') is True
         and op.get('finalContractVersion') == 'cop-account-erasure-v2'
         and op.get('requiredOwners') == sorted(OWNERS))
    owners = report.get('providerReadbacks')
    need(isinstance(owners, dict) and set(owners) == OWNERS)
    for owner, value in owners.items():
        need(isinstance(value, dict) and value.get('operationId') == op['operationId']
             and value.get('status') == 'completed' and value.get('userARemaining') == 0
             and isinstance(value.get('userBStateBefore'), str) and HEX.fullmatch(value['userBStateBefore'])
             and value.get('userBStateBefore') == value.get('userBStateAfter')
             and isinstance(value.get('readbackDigest'), str) and HEX.fullmatch(value['readbackDigest']))
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
        if name in {'router_outage', 'messaging_outage'}:
            need(value.get('dependencyHttpStatus') == 503 and value.get('operationStatus') == 'deleting')
        if name == 'late_write':
            need(value.get('httpStatus') in (401, 403, 409, 410, 503) and value.get('rowsRecreated') == 0)
        if name == 'restored_user_data':
            need(type(value.get('restoredRows')) is int and value['restoredRows'] > 0)
    pins = report.get('testedSourceDigests')
    need(isinstance(pins, dict) and set(pins) == {'cop', 'sim', 'messaging', 'producer'}
         and all(isinstance(v, str) and HEX.fullmatch(v) for v in pins.values()))
    return {'contractVersion': report['contractVersion'], 'operationId': op['operationId'],
            'candidateImages': expected_images, 'checkedAt': stamp}


def verified_pre_stop_acceptance(expected_images):
    # Use the same actual Root custody reader as the production controller.
    import importlib.util
    spec = importlib.util.spec_from_file_location('clean_gate_root', Path(__file__).with_name('clean-reset-root.py'))
    root = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(root)
    need(root.os.getuid() == 0, 'CLEAN_WHOLE_ROOT_REQUIRED')
    raw = root.protected(REPORT)
    value = validate_clean_whole_report(json.loads(raw), expected_images,
                                      datetime.datetime.now(datetime.timezone.utc).timestamp())
    return {**value, 'reportSha256': hashlib.sha256(raw).hexdigest()}


def validate_for_plan(plan):
    """Fixed coordinator import; no caller callback or success flag."""
    need(isinstance(plan, dict) and plan.get('scope') == 'cop_sim_shared_identity_v1', 'CLEAN_WHOLE_PLAN_SCOPE')
    return verified_pre_stop_acceptance(plan['candidateImages'])
