#!/usr/bin/env python3
"""Fixed COP API image/profile bindings. Never prints resolved config or secrets."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import uuid

sys.dont_write_bytecode = True
SOURCE = Path('/srv/cop')
ROOT = SOURCE / 'runtime/api'
PROFILES = Path('/etc/vcode-cop-api-runtime')
FILES = ('docker-compose.yml', 'docker-compose.driver-measurements.yml',
         'docker-compose.x5.yml', 'docker-compose.ai-router.yml')
NETWORKS = {
    'cop_default': 'c0718b9d5b24d006c5b16bc74e2582032ac1b9e1c632a0fcfc31d767b4df9b91',
    'cop_sim_ai_router_internal': '58b669ceb047fa6dd127bb189dc1ce5fba49cd6bdc39db8bff055546534171e9',
    'cop_sim_driver_measurements_internal': 'b0dba318afe538b7abd8593623611f393dfdbf0c3c8923598176625e3ff3f946'}
SOCKET = Path('/run/vcode-cop-pgbouncer')
CA = Path('/etc/vcode-cop-pgbouncer/postgres-ca.crt')
BASE_NAME_LABEL = 'org.opencontainers.image.base.name'
APPROVED_BASE_NAME = 'node@sha256:83f1c388c31fb2e51f7cbd4dea949b96260798c98f206e8e4696bc93bd964e3a'
ENV = {name: 'COP_API_RUNTIME_' + name.removeprefix('COP_') for name in (
    'COP_DATABASE_URL', 'COP_LEASE_DATABASE_URL',
    'COP_STREAM_BUS_DATABASE_URL')}
ID = re.compile(r'[a-z0-9][a-z0-9-]{0,63}')
IMAGE = re.compile(r'sha256:[0-9a-f]{64}')
REVISION = re.compile(r'[0-9a-f]{40}')
GENERATION = re.compile(r'[0-9a-f]{32}')
PROFILE_UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
MODE_ENV = 'COP_API_RUNTIME_DATABASE_POOL_MODE'
HEALTH_URLS = ('http://127.0.0.1:4310/health/live', 'http://127.0.0.1:4310/health/ready',
               'http://127.0.0.1:4310/health/dependencies',
               'https://cop.zeleznalady.cz/demo/flood-central-bohemia')
HEALTH_STATES = {'ok', 'online', 'degraded', 'unavailable', 'offline', 'disabled', 'skipped'}

# Finite Root-reviewed account-erasure installation scope. Existing actor/HMAC
# identity, authentication, business DB routes and other features stay unchanged.
ERASURE_CONFIG_KEYS = frozenset({
    'COP_ACCOUNT_ERASURE_ENABLED', 'COP_ACCOUNT_ERASURE_SECRET',
    'COP_ACCOUNT_SAFETY_GUARD_REQUIRED', 'COP_ACCOUNT_SAFETY_AUTHORITY_MODE',
    'COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL', 'COP_ACCOUNT_SAFETY_GUARD_STORE_ID',
    'COP_ACCOUNT_SAFETY_INCARNATION_ID', 'COP_ACCOUNT_SAFETY_STORE_ID',
    'COP_ACCOUNT_SAFETY_RUNTIME_ATTESTATION',
    'COP_KEYCLOAK_ERASURE_CLIENT_ID', 'COP_KEYCLOAK_ERASURE_CLIENT_SECRET',
    'COP_KEYCLOAK_COP_SCOPE_AUTHORITY_ACCEPTED', 'COP_SIM_ERASURE_ROUTER_URL',
    'COP_SIM_ERASURE_ROUTER_TOKEN', 'COP_SIM_ERASURE_DRIVER_URL',
    'COP_SIM_ERASURE_DRIVER_TOKEN', 'COP_LIVEKIT_ADMIN_URL',
    'COP_LIVEKIT_ERASURE_RELAY_URL', 'COP_MEDIA_UPLOAD_TRANSPORT',
    'COP_MEDIA_S3_ACCESS_KEY_ID', 'COP_MEDIA_S3_SECRET_ACCESS_KEY',
    'COP_ACCOUNT_ERASURE_EDGE_URL', 'COP_EDGE_ADMIN_TOKEN', 'COP_EDGE_NODE_ID'})
ERASURE_FIXED = {
    'COP_ACCOUNT_SAFETY_GUARD_REQUIRED': 'true',
    'COP_ACCOUNT_SAFETY_AUTHORITY_MODE': 'database_v2',
    'COP_ACCOUNT_SAFETY_RUNTIME_ATTESTATION': 'account-safety-guard-v1',
    'COP_KEYCLOAK_COP_SCOPE_AUTHORITY_ACCEPTED': 'true',
    'COP_KEYCLOAK_ERASURE_CLIENT_ID': 'cop-account-erasure-worker',
    'COP_MEDIA_UPLOAD_TRANSPORT': 'cop_api',
    'COP_ACCOUNT_ERASURE_EDGE_URL': 'http://cop-edge:4312',
    'COP_EDGE_NODE_ID': 'node_edge_pilot_01'}
ERASURE_PROOF_CHECKS = {'jointSyntheticAcceptance', 'providerClosureVerified',
                        'preservesSharedIdentity', 'restoreReplayVerified'}
# Separate reviewed clean-reset scope. An old v1 proof never authorizes these.
CLEAN_ERASURE_CONFIG_KEYS = ERASURE_CONFIG_KEYS | frozenset({
    'COP_ACCOUNT_ERASURE_SCOPE', 'COP_KEYCLOAK_SHARED_IDENTITY_DELETE_ACCEPTED',
    'COP_USER_RESET_EPOCH', 'COP_USER_RESET_TOKENS_NOT_BEFORE',
    'COP_SIM_USER_DATA_ERASURE_URL', 'COP_SIM_USER_DATA_ERASURE_TOKEN',
    'COP_SIM_USER_DATA_ERASURE_ACTOR_SECRET'})
CLEAN_ERASURE_PROOF_CHECKS = {'jointSyntheticAcceptance', 'providerClosureVerified',
                             'sharedIdentityDeletionApproved', 'cleanResetVerified', 'restoreReplayVerified'}
CLEAN_ERASURE_PROOF_VERSION = 'cop-api-account-erasure-clean-config-v1'
# A closed operator-proof extension, not an application configuration key.
NODE_METADATA_PROOF_VERSION = 'cop-api-account-erasure-clean-config-v2'
NODE_METADATA_FROM_IMAGE = 'sha256:a06c103764701e7debc6434e3dd98e9a6d5f218d30831cb62aad566265db392f'
NODE_METADATA_TO_IMAGE = 'sha256:28648cded21fbd52602a197693d0b0dc9eb213cd2bd84d6227b7da34c0cbab86'
NODE_METADATA_FROM_VERSION = '24.21.0'
NODE_METADATA_TO_VERSION = '24.22.0'
NODE_METADATA_KEY = 'NODE_VERSION'
EXISTING_ACTOR_KEY = 'COP_SIM_ERASURE_ACTOR_SECRET'
PENDING_REPLACEMENT_VERSION = 'cop-api-account-erasure-pending-replacement-config-v1'
PENDING_REPLACEMENT_ENABLE_VERSION = 'cop-api-account-erasure-pending-replacement-enable-v1'
REPLACEMENT_PREPARE_CHECKS = {'historicalOriginalJointAcceptanceVerified',
    'focusedContinuityRegressionVerified', 'providerClosureVerified',
    'sharedIdentityDeletionApproved', 'cleanResetVerified', 'restoreReplayVerified'}
REPLACEMENT_ENABLE_CHECKS = {'replacementRuntimeAccepted', 'freshOwnerReadinessVerified',
    'sharedIdentityDeletionApproved', 'cleanResetVerified', 'restoreReplayVerified',
    'productionSyntheticAcceptancePending'}
REPLACEMENT_IMAGE = 'sha256:056a735741395677ad7742f7a9f21c13f3d0e9f1a8e367494fa5a5d48ea6111f'
REPLACEMENT_REVISION = '2cea89023dc61a9ac82c186385b2cb62aac15183'


def pending_replacement_schema(proof):
    require(proof.get('contractVersion') == PENDING_REPLACEMENT_VERSION
            and proof.get('operation') == 'prepare' and proof.get('changedKeys') == [],
            'pending_replacement_scope')
    w = proof.get('pendingTargetReplacement')
    fixed = {
        'contractVersion': 'cop-pending-target-replacement-witness-v1',
        'originalPlanSha256': '74f333d3d7a21ce2643756769fa1b6fd14f259319b7afb22155cb47076d381b1',
        'originalWholeReportSha256': '66b6fb13c8a52c3d06f6aecafe3c9b101e5376cda3049988843e9d4961e0e38a',
        'resetEpoch': 'ea1699f1-16c7-47cb-9d81-9ab423e349df',
        'historicalBaselineSha256': '0d80ff6b78f046ddfcb5ca4b8865ae72aabcc0c8c7f5d76daa9b7cf46d0d7ef2',
        'pendingSha256': '4b8534417f9ff45d66f57ae16393b450ebbc5bec9bc511144288665a27654c6e',
        'pendingHealthSha256': 'bee9c12f612c9967452802d03ddbe21b2dd6aa7765735d232c9b788dfa2f85f2',
        'acceptedPointerSha256': 'b987a423f28f4715d353010d94ced745e479f3d6f41574151d7a8a8df092c70b',
        'failedContainerId': '1f50bd766d3865933d4ea1fcd5cebc27728185f47798855dc4c716d79e76cc45',
        'failedImageId': NODE_METADATA_TO_IMAGE,
        'failedReleaseId': 'release-2fbcedbc83f14f49949530b3ca79a29b',
        'targetImageId': REPLACEMENT_IMAGE,
        'targetSourceRevision': REPLACEMENT_REVISION,
        'plannedUnchangedImageBindingsSha256': '2d77e672466224fbb9a82e374e3a6a47924d1b4c6e5c292d6cb61592e97df61b'}
    digests = {'sourceSpecSha256', 'authorizationRecordSha256', 'focusedRegressionSha256',
               'imageBuildReceiptSha256', 'targetAttestationSha256',
               'actualProviderReadinessSha256', 'actualProducerInventorySha256'}
    require(isinstance(w, dict) and set(w) == set(fixed) | digests | {'checkedAt', 'expiresAt'}
            and all(w[k] == v for k, v in fixed.items())
            and all(isinstance(w[k], str) and re.fullmatch(r'[0-9a-f]{64}', w[k]) for k in digests),
            'pending_replacement_witness_schema')
    require(proof['cleanReset']['resetEpoch'] == w['resetEpoch']
            and proof['target']['imageId'] == REPLACEMENT_IMAGE
            and proof['target']['sourceRevision'] == REPLACEMENT_REVISION,
            'pending_replacement_target_binding')
    checked, expires = fenced_timestamp(w['checkedAt']), fenced_timestamp(w['expiresAt'])
    require(0 < expires - checked <= 600, 'pending_replacement_validity')
    return w


def pending_replacement_enable_schema(proof):
    require(proof.get('contractVersion') == PENDING_REPLACEMENT_ENABLE_VERSION
            and proof.get('operation') == 'enable'
            and proof.get('changedKeys') == ['COP_ACCOUNT_ERASURE_ENABLED']
            and proof['previous']['imageId'] == proof['target']['imageId'] == REPLACEMENT_IMAGE
            and proof['target']['sourceRevision'] == REPLACEMENT_REVISION
            and proof['cleanReset']['resetEpoch'] == 'ea1699f1-16c7-47cb-9d81-9ab423e349df',
            'pending_replacement_enable_scope')
    w = proof.get('pendingTargetReplacementEnable')
    digests = {'replacementPrepareProofSha256', 'runtimeAcceptanceReceiptSha256',
               'authorizationRecordSha256', 'freshOwnerReadinessSha256'}
    require(isinstance(w, dict) and set(w) == digests | {'contractVersion', 'checkedAt', 'expiresAt'}
            and w['contractVersion'] == 'cop-pending-target-replacement-enable-witness-v1'
            and all(isinstance(w[k], str) and re.fullmatch(r'[0-9a-f]{64}', w[k]) for k in digests),
            'pending_replacement_enable_witness')
    require(0 < fenced_timestamp(w['expiresAt']) - fenced_timestamp(w['checkedAt']) <= 600,
            'pending_replacement_enable_validity')
    return w
FENCED_SOURCE_PROOF_VERSION = 'cop-api-account-erasure-clean-config-v3'
FENCED_SOURCE_PLAN_SHA256 = '74f333d3d7a21ce2643756769fa1b6fd14f259319b7afb22155cb47076d381b1'
FENCED_SOURCE_BASELINE_SHA256 = '0d80ff6b78f046ddfcb5ca4b8865ae72aabcc0c8c7f5d76daa9b7cf46d0d7ef2'
FENCED_SOURCE_DEADLINE = '2026-10-19T15:22:00Z'
CLEAN_RESET_DIRECTORY = SOURCE / 'runtime/clean-reset'
CLEAN_RESET_PHASES = ['identity', 'cop', 'ai', 'driver', 'files', 'sim_app_files',
                      'sim_user_install', 'cop_safety_install', 'remaining', 'messaging_install', 'readback', 'sim_config']



def environment_metadata(path, uid):
    """CAS for the one existing secrets file; no copy or digest of secrets."""
    require(not any(p.is_symlink() for p in (path, *path.parents)), 'erasure_env_path_invalid')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == uid
                and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1
                and info.st_size <= 1048576, 'erasure_env_permissions')
        return {'device': info.st_dev, 'inode': info.st_ino, 'size': info.st_size,
                'mtimeNs': info.st_mtime_ns, 'ctimeNs': info.st_ctime_ns}
    finally:
        os.close(fd)


def erasure_target_environment(target, operation, clean=None):
    fixed = {k: v for k, v in ERASURE_FIXED.items() if not clean or k != 'COP_KEYCLOAK_COP_SCOPE_AUTHORITY_ACCEPTED'}
    require(all(target.get(k) == v for k, v in fixed.items()), 'erasure_target_fixed_config')
    if clean is not None:
        require(target.get('COP_ACCOUNT_ERASURE_SCOPE') == 'cop_sim_shared_identity_v1'
                and target.get('COP_KEYCLOAK_SHARED_IDENTITY_DELETE_ACCEPTED') == 'true'
                and target.get('COP_USER_RESET_EPOCH') == clean['resetEpoch']
                and target.get('COP_USER_RESET_TOKENS_NOT_BEFORE') == str(clean['tokensNotBefore']),
                'clean_erasure_target_binding')
        for key in ('COP_SIM_USER_DATA_ERASURE_TOKEN', 'COP_SIM_USER_DATA_ERASURE_ACTOR_SECRET'):
            require(isinstance(target.get(key), str) and 32 <= len(target[key]) <= 16384
                    and not any(ord(c) < 32 for c in target[key]), 'clean_erasure_app_credential_missing')
        from urllib.parse import urlsplit
        app_url = urlsplit(target.get('COP_SIM_USER_DATA_ERASURE_URL', ''))
        require(app_url.scheme in {'http', 'https'} and bool(app_url.hostname)
                and not app_url.username and not app_url.password and not app_url.query
                and not app_url.fragment and app_url.path in {'', '/'}, 'clean_erasure_app_url_invalid')
    intake = target.get('COP_ACCOUNT_ERASURE_ENABLED')
    require(intake in {'true', 'false'} and (operation == 'maintain' or
            intake == ('true' if operation == 'enable' else 'false')), 'erasure_target_intake')
    for key in ('COP_ACCOUNT_SAFETY_GUARD_STORE_ID', 'COP_ACCOUNT_SAFETY_INCARNATION_ID',
                'COP_ACCOUNT_SAFETY_STORE_ID'):
        require(isinstance(target.get(key), str) and PROFILE_UUID.fullmatch(target[key]), 'erasure_target_binding')
    for key in ('COP_ACCOUNT_ERASURE_SECRET', 'COP_KEYCLOAK_ERASURE_CLIENT_SECRET',
                'COP_SIM_ERASURE_ROUTER_TOKEN', 'COP_SIM_ERASURE_DRIVER_TOKEN',
                'COP_SIM_ERASURE_ACTOR_SECRET'):
        require(isinstance(target.get(key), str) and 32 <= len(target[key]) <= 16384
                and not any(ord(c) < 32 for c in target[key]), 'erasure_target_credential_missing')
    for key in ('COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL', 'COP_SIM_ERASURE_ROUTER_URL',
                'COP_SIM_ERASURE_DRIVER_URL', 'COP_LIVEKIT_ERASURE_RELAY_URL',
                'COP_MEDIA_S3_ACCESS_KEY_ID', 'COP_MEDIA_S3_SECRET_ACCESS_KEY', 'COP_EDGE_ADMIN_TOKEN'):
        require(isinstance(target.get(key), str) and 0 < len(target[key]) <= 16384
                and not any(ord(c) < 32 for c in target[key]), 'erasure_target_owner_missing')
    require(not target.get('COP_LIVEKIT_ADMIN_URL'), 'erasure_livekit_transport_conflict')


STARTUP_REPAIR_VERSION = 'cop-api-account-erasure-bounded-startup-repair-config-v1'
STARTUP_REPAIR_ENABLE_VERSION = 'cop-api-account-erasure-bounded-startup-repair-enable-v1'
STARTUP_REPAIR_IMAGE = 'sha256:b4e6087f33fa1c1e8dee19b32bb3036f8e0266de39d1e3f150c6c639d0a46e28'
STARTUP_REPAIR_FAILED_IMAGE = REPLACEMENT_IMAGE
STARTUP_REPAIR_REVISION = 'bbd3c49ec9818ae87f636e3faa59c78c7c784b88'
STARTUP_REPAIR_PREPARE_CHECKS = REPLACEMENT_PREPARE_CHECKS | {'boundedStartupConfigurationVerified'}
STARTUP_REPAIR_ENABLE_CHECKS = REPLACEMENT_ENABLE_CHECKS


def startup_repair_schema(proof):
    require(proof.get('contractVersion') == STARTUP_REPAIR_VERSION
            and proof.get('operation') == 'prepare' and proof.get('changedKeys') == [],
            'bounded_startup_repair_scope')
    w = proof.get('boundedStartupRepair')
    fixed = {
        'contractVersion': 'cop-bounded-startup-repair-witness-v1',
        'originalPlanSha256': '74f333d3d7a21ce2643756769fa1b6fd14f259319b7afb22155cb47076d381b1',
        'originalWholeReportSha256': '66b6fb13c8a52c3d06f6aecafe3c9b101e5376cda3049988843e9d4961e0e38a',
        'resetEpoch': 'ea1699f1-16c7-47cb-9d81-9ab423e349df',
        'historicalBaselineSha256': '0d80ff6b78f046ddfcb5ca4b8865ae72aabcc0c8c7f5d76daa9b7cf46d0d7ef2',
        'pendingSha256': 'bd4e3f5e81c5cd6de48ba5b53ae791f7381c81b1fb100c9b99dc11b210636b03',
        'pendingHealthSha256': 'bee9c12f612c9967452802d03ddbe21b2dd6aa7765735d232c9b788dfa2f85f2',
        'acceptedPointerSha256': 'b987a423f28f4715d353010d94ced745e479f3d6f41574151d7a8a8df092c70b',
        'failedContainerId': 'ac5e8d9b52fb6d18acab78482ffd0fee22ba7db4b1c1a3518f2106915b8ae286',
        'failedImageId': STARTUP_REPAIR_FAILED_IMAGE,
        'failedReleaseId': 'release-084c89ea02114ec088ccb36809aa35a1',
        'targetImageId': STARTUP_REPAIR_IMAGE,
        'targetSourceRevision': STARTUP_REPAIR_REVISION,
        'plannedUnchangedImageBindingsSha256': '2d77e672466224fbb9a82e374e3a6a47924d1b4c6e5c292d6cb61592e97df61b'}
    digests = {'sourceSpecSha256', 'authorizationRecordSha256', 'focusedRegressionSha256',
               'imageBuildReceiptSha256', 'targetAttestationSha256',
               'actualProviderReadinessSha256', 'actualProducerInventorySha256'}
    require(isinstance(w, dict) and set(w) == set(fixed) | digests | {'checkedAt', 'expiresAt'}
            and all(w[k] == v for k, v in fixed.items())
            and all(isinstance(w[k], str) and re.fullmatch(r'[0-9a-f]{64}', w[k]) for k in digests),
            'bounded_startup_repair_witness_schema')
    require(proof['cleanReset']['resetEpoch'] == w['resetEpoch']
            and proof['target']['imageId'] == STARTUP_REPAIR_IMAGE
            and proof['target']['sourceRevision'] == STARTUP_REPAIR_REVISION,
            'bounded_startup_repair_target_binding')
    checked, expires = fenced_timestamp(w['checkedAt']), fenced_timestamp(w['expiresAt'])
    require(0 < expires - checked <= 600, 'bounded_startup_repair_validity')
    return w


def startup_repair_enable_schema(proof):
    require(proof.get('contractVersion') == STARTUP_REPAIR_ENABLE_VERSION
            and proof.get('operation') == 'enable'
            and proof.get('changedKeys') == ['COP_ACCOUNT_ERASURE_ENABLED']
            and proof['previous']['imageId'] == proof['target']['imageId'] == STARTUP_REPAIR_IMAGE
            and proof['target']['sourceRevision'] == STARTUP_REPAIR_REVISION
            and proof['cleanReset']['resetEpoch'] == 'ea1699f1-16c7-47cb-9d81-9ab423e349df',
            'bounded_startup_repair_enable_scope')
    w = proof.get('boundedStartupRepairEnable')
    digests = {'replacementPrepareProofSha256', 'runtimeAcceptanceReceiptSha256',
               'authorizationRecordSha256', 'freshOwnerReadinessSha256'}
    require(isinstance(w, dict) and set(w) == digests | {'contractVersion', 'checkedAt', 'expiresAt'}
            and w['contractVersion'] == 'cop-bounded-startup-repair-enable-witness-v1'
            and all(isinstance(w[k], str) and re.fullmatch(r'[0-9a-f]{64}', w[k]) for k in digests),
            'bounded_startup_repair_enable_witness')
    require(0 < fenced_timestamp(w['expiresAt']) - fenced_timestamp(w['checkedAt']) <= 600,
            'bounded_startup_repair_enable_validity')
    return w
INDEX_BOUNDARY_REPAIR_VERSION = 'cop-api-account-erasure-index-boundary-repair-config-v1'
INDEX_BOUNDARY_REPAIR_ENABLE_VERSION = 'cop-api-account-erasure-index-boundary-repair-enable-v1'
INDEX_BOUNDARY_REPAIR_IMAGE = 'sha256:979004d63d3615926ef9905b05365a9d2ebe6044033fd2a5d2f28c48cd3e21c5'
INDEX_BOUNDARY_REPAIR_FAILED_IMAGE = STARTUP_REPAIR_IMAGE
INDEX_BOUNDARY_REPAIR_REVISION = '6e2de62ee97dd81e09dc62446b6a81d56b2770a5'
INDEX_BOUNDARY_REPAIR_PREPARE_CHECKS = STARTUP_REPAIR_PREPARE_CHECKS | {'indexBoundaryRefreshVerified'}
INDEX_BOUNDARY_REPAIR_ENABLE_CHECKS = STARTUP_REPAIR_ENABLE_CHECKS


def index_boundary_repair_schema(proof):
    require(proof.get('contractVersion') == INDEX_BOUNDARY_REPAIR_VERSION
            and proof.get('operation') == 'prepare' and proof.get('changedKeys') == [],
            'index_boundary_repair_scope')
    w = proof.get('indexBoundaryRepair')
    fixed = {
        'contractVersion': 'cop-index-boundary-repair-witness-v1',
        'originalPlanSha256': '74f333d3d7a21ce2643756769fa1b6fd14f259319b7afb22155cb47076d381b1',
        'originalWholeReportSha256': '66b6fb13c8a52c3d06f6aecafe3c9b101e5376cda3049988843e9d4961e0e38a',
        'resetEpoch': 'ea1699f1-16c7-47cb-9d81-9ab423e349df',
        'historicalBaselineSha256': '0d80ff6b78f046ddfcb5ca4b8865ae72aabcc0c8c7f5d76daa9b7cf46d0d7ef2',
        'pendingSha256': '3df46df4c8da253f494c653bab52446bcbf3e34be9275a83794802201381b105',
        'pendingHealthSha256': 'bee9c12f612c9967452802d03ddbe21b2dd6aa7765735d232c9b788dfa2f85f2',
        'acceptedPointerSha256': 'b987a423f28f4715d353010d94ced745e479f3d6f41574151d7a8a8df092c70b',
        'failedContainerId': 'fb800679222a33cc0eb4930c353d7882e0a31ce07a3bb24a74cf86836c71fee7',
        'failedImageId': INDEX_BOUNDARY_REPAIR_FAILED_IMAGE,
        'failedReleaseId': 'release-4e83883771dd464e8df4a50213b83a36',
        'targetImageId': INDEX_BOUNDARY_REPAIR_IMAGE,
        'targetSourceRevision': INDEX_BOUNDARY_REPAIR_REVISION,
        'plannedUnchangedImageBindingsSha256': '2d77e672466224fbb9a82e374e3a6a47924d1b4c6e5c292d6cb61592e97df61b'}
    digests = {'sourceSpecSha256', 'authorizationRecordSha256', 'focusedRegressionSha256',
               'imageBuildReceiptSha256', 'targetAttestationSha256',
               'actualProviderReadinessSha256', 'actualProducerInventorySha256'}
    require(isinstance(w, dict) and set(w) == set(fixed) | digests | {'checkedAt', 'expiresAt'}
            and all(w[k] == v for k, v in fixed.items())
            and all(isinstance(w[k], str) and re.fullmatch(r'[0-9a-f]{64}', w[k]) for k in digests),
            'index_boundary_repair_witness_schema')
    require(proof['cleanReset']['resetEpoch'] == w['resetEpoch']
            and proof['target']['imageId'] == INDEX_BOUNDARY_REPAIR_IMAGE
            and proof['target']['sourceRevision'] == INDEX_BOUNDARY_REPAIR_REVISION,
            'index_boundary_repair_target_binding')
    checked, expires = fenced_timestamp(w['checkedAt']), fenced_timestamp(w['expiresAt'])
    require(0 < expires - checked <= 600, 'index_boundary_repair_validity')
    return w


def index_boundary_repair_enable_schema(proof):
    require(proof.get('contractVersion') == INDEX_BOUNDARY_REPAIR_ENABLE_VERSION
            and proof.get('operation') == 'enable'
            and proof.get('changedKeys') == ['COP_ACCOUNT_ERASURE_ENABLED']
            and proof['previous']['imageId'] == proof['target']['imageId'] == INDEX_BOUNDARY_REPAIR_IMAGE
            and proof['target']['sourceRevision'] == INDEX_BOUNDARY_REPAIR_REVISION
            and proof['cleanReset']['resetEpoch'] == 'ea1699f1-16c7-47cb-9d81-9ab423e349df',
            'index_boundary_repair_enable_scope')
    w = proof.get('indexBoundaryRepairEnable')
    digests = {'replacementPrepareProofSha256', 'runtimeAcceptanceReceiptSha256',
               'authorizationRecordSha256', 'freshOwnerReadinessSha256'}
    require(isinstance(w, dict) and set(w) == digests | {'contractVersion', 'checkedAt', 'expiresAt'}
            and w['contractVersion'] == 'cop-index-boundary-repair-enable-witness-v1'
            and all(isinstance(w[k], str) and re.fullmatch(r'[0-9a-f]{64}', w[k]) for k in digests),
            'index_boundary_repair_enable_witness')
    require(0 < fenced_timestamp(w['expiresAt']) - fenced_timestamp(w['checkedAt']) <= 600,
            'index_boundary_repair_enable_validity')
    return w
PROVIDER_BOUNDARY_REPAIR_VERSION = 'cop-api-account-erasure-provider-boundary-repair-config-v1'
PROVIDER_BOUNDARY_REPAIR_ENABLE_VERSION = 'cop-api-account-erasure-provider-boundary-repair-enable-v1'
PROVIDER_BOUNDARY_REPAIR_IMAGE = 'sha256:6bc4920b772ba8317da8dba470558aa5daf26d2bce35f3703af5b1bc40f932b1'
PROVIDER_BOUNDARY_REPAIR_FAILED_IMAGE = INDEX_BOUNDARY_REPAIR_IMAGE
PROVIDER_BOUNDARY_REPAIR_REVISION = '733885bb5445b561a9bed6fa0a8287c5653a5eb1'
PROVIDER_BOUNDARY_REPAIR_PREPARE_CHECKS = INDEX_BOUNDARY_REPAIR_PREPARE_CHECKS | {'providerBoundaryRefreshVerified'}
PROVIDER_BOUNDARY_REPAIR_ENABLE_CHECKS = INDEX_BOUNDARY_REPAIR_ENABLE_CHECKS


def provider_boundary_repair_schema(proof):
    require(proof.get('contractVersion') == PROVIDER_BOUNDARY_REPAIR_VERSION
            and proof.get('operation') == 'prepare' and proof.get('changedKeys') == [],
            'provider_boundary_repair_scope')
    w = proof.get('providerBoundaryRepair')
    fixed = {
        'contractVersion': 'cop-provider-boundary-repair-witness-v1',
        'originalPlanSha256': '74f333d3d7a21ce2643756769fa1b6fd14f259319b7afb22155cb47076d381b1',
        'originalWholeReportSha256': '66b6fb13c8a52c3d06f6aecafe3c9b101e5376cda3049988843e9d4961e0e38a',
        'resetEpoch': 'ea1699f1-16c7-47cb-9d81-9ab423e349df',
        'historicalBaselineSha256': '0d80ff6b78f046ddfcb5ca4b8865ae72aabcc0c8c7f5d76daa9b7cf46d0d7ef2',
        'pendingSha256': '1d2bff33b9ebe25ece9643865cb8fa3f52ea99e78b5bc8c19259b965926d8997',
        'pendingHealthSha256': 'bee9c12f612c9967452802d03ddbe21b2dd6aa7765735d232c9b788dfa2f85f2',
        'acceptedPointerSha256': 'b987a423f28f4715d353010d94ced745e479f3d6f41574151d7a8a8df092c70b',
        'failedContainerId': '5c638b0f8431c1eb2b52fd1ac8a165b1d66acbdd1f0cc71705e94278f25d62a1',
        'failedImageId': PROVIDER_BOUNDARY_REPAIR_FAILED_IMAGE,
        'failedReleaseId': 'release-6e970c09a18e4455980a01eb47f01965',
        'targetImageId': PROVIDER_BOUNDARY_REPAIR_IMAGE,
        'targetSourceRevision': PROVIDER_BOUNDARY_REPAIR_REVISION,
        'plannedUnchangedImageBindingsSha256': '2d77e672466224fbb9a82e374e3a6a47924d1b4c6e5c292d6cb61592e97df61b'}
    digests = {'sourceSpecSha256', 'authorizationRecordSha256', 'focusedRegressionSha256',
               'imageBuildReceiptSha256', 'targetAttestationSha256',
               'actualProviderReadinessSha256', 'actualProducerInventorySha256'}
    require(isinstance(w, dict) and set(w) == set(fixed) | digests | {'checkedAt', 'expiresAt'}
            and all(w[k] == v for k, v in fixed.items())
            and all(isinstance(w[k], str) and re.fullmatch(r'[0-9a-f]{64}', w[k]) for k in digests),
            'provider_boundary_repair_witness_schema')
    require(proof['cleanReset']['resetEpoch'] == w['resetEpoch']
            and proof['target']['imageId'] == PROVIDER_BOUNDARY_REPAIR_IMAGE
            and proof['target']['sourceRevision'] == PROVIDER_BOUNDARY_REPAIR_REVISION,
            'provider_boundary_repair_target_binding')
    checked, expires = fenced_timestamp(w['checkedAt']), fenced_timestamp(w['expiresAt'])
    require(0 < expires - checked <= 600, 'provider_boundary_repair_validity')
    return w


def provider_boundary_repair_enable_schema(proof):
    require(proof.get('contractVersion') == PROVIDER_BOUNDARY_REPAIR_ENABLE_VERSION
            and proof.get('operation') == 'enable'
            and proof.get('changedKeys') == ['COP_ACCOUNT_ERASURE_ENABLED']
            and proof['previous']['imageId'] == proof['target']['imageId'] == PROVIDER_BOUNDARY_REPAIR_IMAGE
            and proof['target']['sourceRevision'] == PROVIDER_BOUNDARY_REPAIR_REVISION
            and proof['cleanReset']['resetEpoch'] == 'ea1699f1-16c7-47cb-9d81-9ab423e349df',
            'provider_boundary_repair_enable_scope')
    w = proof.get('providerBoundaryRepairEnable')
    digests = {'replacementPrepareProofSha256', 'runtimeAcceptanceReceiptSha256',
               'authorizationRecordSha256', 'freshOwnerReadinessSha256'}
    require(isinstance(w, dict) and set(w) == digests | {'contractVersion', 'checkedAt', 'expiresAt'}
            and w['contractVersion'] == 'cop-provider-boundary-repair-enable-witness-v1'
            and all(isinstance(w[k], str) and re.fullmatch(r'[0-9a-f]{64}', w[k]) for k in digests),
            'provider_boundary_repair_enable_witness')
    require(0 < fenced_timestamp(w['expiresAt']) - fenced_timestamp(w['checkedAt']) <= 600,
            'provider_boundary_repair_enable_validity')
    return w
OWNER_READINESS_REPAIR_VERSION = 'cop-api-account-erasure-owner-readiness-repair-config-v1'
OWNER_READINESS_REPAIR_ENABLE_VERSION = 'cop-api-account-erasure-owner-readiness-repair-enable-v1'
OWNER_READINESS_REPAIR_IMAGE = 'sha256:7a77ff158165048ff4bbed69cb69548c76260f8bc4e7e385b888ee36a3aa4551'
OWNER_READINESS_REPAIR_FAILED_IMAGE = PROVIDER_BOUNDARY_REPAIR_IMAGE
OWNER_READINESS_REPAIR_REVISION = 'c4c76cc9f3cfe3f9e6d6a1f28e7ed328c2b0b82d'
OWNER_READINESS_REPAIR_PREPARE_CHECKS = PROVIDER_BOUNDARY_REPAIR_PREPARE_CHECKS | {'ownerReadinessFrontierRefreshVerified'}
OWNER_READINESS_REPAIR_ENABLE_CHECKS = PROVIDER_BOUNDARY_REPAIR_ENABLE_CHECKS


def owner_readiness_repair_schema(proof):
    require(proof.get('contractVersion') == OWNER_READINESS_REPAIR_VERSION
            and proof.get('operation') == 'prepare' and proof.get('changedKeys') == [],
            'owner_readiness_repair_scope')
    w = proof.get('ownerReadinessRepair')
    fixed = {
        'contractVersion': 'cop-owner-readiness-repair-witness-v1',
        'originalPlanSha256': '74f333d3d7a21ce2643756769fa1b6fd14f259319b7afb22155cb47076d381b1',
        'originalWholeReportSha256': '66b6fb13c8a52c3d06f6aecafe3c9b101e5376cda3049988843e9d4961e0e38a',
        'resetEpoch': 'ea1699f1-16c7-47cb-9d81-9ab423e349df',
        'historicalBaselineSha256': '0d80ff6b78f046ddfcb5ca4b8865ae72aabcc0c8c7f5d76daa9b7cf46d0d7ef2',
        'pendingSha256': '4d267e151063b16008e0bb385d59da5589796a7ca5337a4ab80ec27f1d13effd',
        'pendingHealthSha256': 'bee9c12f612c9967452802d03ddbe21b2dd6aa7765735d232c9b788dfa2f85f2',
        'acceptedPointerSha256': 'b987a423f28f4715d353010d94ced745e479f3d6f41574151d7a8a8df092c70b',
        'failedContainerId': '314b7cc084a80d88cb121a9146c0e2eb5e1732dda8baa28aadc1dd3016b6751a',
        'failedImageId': OWNER_READINESS_REPAIR_FAILED_IMAGE,
        'failedReleaseId': 'release-122fc831a4aa47c2a60457ad259269ab',
        'targetImageId': OWNER_READINESS_REPAIR_IMAGE,
        'targetSourceRevision': OWNER_READINESS_REPAIR_REVISION,
        'plannedUnchangedImageBindingsSha256': '2d77e672466224fbb9a82e374e3a6a47924d1b4c6e5c292d6cb61592e97df61b'}
    digests = {'sourceSpecSha256', 'authorizationRecordSha256', 'focusedRegressionSha256',
               'imageBuildReceiptSha256', 'targetAttestationSha256',
               'actualProviderReadinessSha256', 'actualProducerInventorySha256'}
    require(isinstance(w, dict) and set(w) == set(fixed) | digests | {'checkedAt', 'expiresAt'}
            and all(w[k] == v for k, v in fixed.items())
            and all(isinstance(w[k], str) and re.fullmatch(r'[0-9a-f]{64}', w[k]) for k in digests),
            'owner_readiness_repair_witness_schema')
    require(re.fullmatch(r'sha256:[0-9a-f]{64}', OWNER_READINESS_REPAIR_IMAGE)
            and proof['cleanReset']['resetEpoch'] == w['resetEpoch']
            and proof['target']['imageId'] == OWNER_READINESS_REPAIR_IMAGE
            and proof['target']['sourceRevision'] == OWNER_READINESS_REPAIR_REVISION,
            'owner_readiness_repair_target_binding')
    checked, expires = fenced_timestamp(w['checkedAt']), fenced_timestamp(w['expiresAt'])
    require(0 < expires - checked <= 600, 'owner_readiness_repair_validity')
    return w


def owner_readiness_repair_enable_schema(proof):
    require(proof.get('contractVersion') == OWNER_READINESS_REPAIR_ENABLE_VERSION
            and proof.get('operation') == 'enable'
            and proof.get('changedKeys') == ['COP_ACCOUNT_ERASURE_ENABLED']
            and proof['previous']['imageId'] == proof['target']['imageId'] == OWNER_READINESS_REPAIR_IMAGE
            and re.fullmatch(r'sha256:[0-9a-f]{64}', OWNER_READINESS_REPAIR_IMAGE)
            and proof['target']['sourceRevision'] == OWNER_READINESS_REPAIR_REVISION
            and proof['cleanReset']['resetEpoch'] == 'ea1699f1-16c7-47cb-9d81-9ab423e349df',
            'owner_readiness_repair_enable_scope')
    w = proof.get('ownerReadinessRepairEnable')
    digests = {'replacementPrepareProofSha256', 'runtimeAcceptanceReceiptSha256',
               'authorizationRecordSha256', 'freshOwnerReadinessSha256'}
    require(isinstance(w, dict) and set(w) == digests | {'contractVersion', 'checkedAt', 'expiresAt'}
            and w['contractVersion'] == 'cop-owner-readiness-repair-enable-witness-v1'
            and all(isinstance(w[k], str) and re.fullmatch(r'[0-9a-f]{64}', w[k]) for k in digests),
            'owner_readiness_repair_enable_witness')
    require(0 < fenced_timestamp(w['expiresAt']) - fenced_timestamp(w['checkedAt']) <= 600,
            'owner_readiness_repair_enable_validity')
    return w


PUBLIC_FLIGHT_REPAIR_VERSION = 'cop-api-account-erasure-public-flight-repair-config-v1'
PUBLIC_FLIGHT_REPAIR_ENABLE_VERSION = 'cop-api-account-erasure-public-flight-repair-enable-v1'
PUBLIC_FLIGHT_REPAIR_IMAGE = OWNER_READINESS_REPAIR_IMAGE
PUBLIC_FLIGHT_REPAIR_FAILED_IMAGE = OWNER_READINESS_REPAIR_FAILED_IMAGE
PUBLIC_FLIGHT_REPAIR_REVISION = OWNER_READINESS_REPAIR_REVISION
PUBLIC_FLIGHT_REPAIR_PREPARE_CHECKS = OWNER_READINESS_REPAIR_PREPARE_CHECKS | {'publicFlightDegradationPolicyReviewed'}
PUBLIC_FLIGHT_REPAIR_ENABLE_CHECKS = OWNER_READINESS_REPAIR_ENABLE_CHECKS | {'publicFlightDegradationPolicyReviewed'}


def public_flight_policy_ref(proof):
    ref = proof.get('publicFlightPolicy')
    require(isinstance(ref, dict) and set(ref) == {'path', 'sha256', 'operationId'}
            and isinstance(ref['operationId'], str) and PROFILE_UUID.fullmatch(ref['operationId'])
            and ref['operationId'] == proof['transitionId']
            and isinstance(ref['sha256'], str) and re.fullmatch(r'[0-9a-f]{64}', ref['sha256'])
            and ref['path'] == str(PROFILES / proof['target']['profileGeneration'] /
                                  ('public-flight-' + ref['operationId'] + '.json')),
            'public_flight_policy_reference')
    return ref


def public_flight_repair_schema(proof):
    normalized = dict(proof)
    normalized['contractVersion'] = OWNER_READINESS_REPAIR_VERSION
    normalized['ownerReadinessRepair'] = dict(proof.get('publicFlightRepair', {}))
    normalized['ownerReadinessRepair']['contractVersion'] = 'cop-owner-readiness-repair-witness-v1'
    require(proof.get('contractVersion') == PUBLIC_FLIGHT_REPAIR_VERSION
            and proof.get('publicFlightRepair', {}).get('contractVersion') == 'cop-public-flight-repair-witness-v1',
            'public_flight_repair_scope')
    owner_readiness_repair_schema(normalized)
    public_flight_policy_ref(proof)
    return proof['publicFlightRepair']


def public_flight_repair_enable_schema(proof):
    normalized = dict(proof)
    normalized['contractVersion'] = OWNER_READINESS_REPAIR_ENABLE_VERSION
    normalized['ownerReadinessRepairEnable'] = dict(proof.get('publicFlightRepairEnable', {}))
    normalized['ownerReadinessRepairEnable']['contractVersion'] = 'cop-owner-readiness-repair-enable-witness-v1'
    require(proof.get('contractVersion') == PUBLIC_FLIGHT_REPAIR_ENABLE_VERSION
            and proof.get('publicFlightRepairEnable', {}).get('contractVersion') == 'cop-public-flight-repair-enable-witness-v1',
            'public_flight_repair_enable_scope')
    owner_readiness_repair_enable_schema(normalized)
    public_flight_policy_ref(proof)
    return proof['publicFlightRepairEnable']


def public_flight_evidence_schema(value, ref, proof, fresh=False):
    fixed = {
        'contractVersion': 'cop-public-flight-upstream-degradation-v1',
        'operationId': ref['operationId'],
        'resetEpoch': 'ea1699f1-16c7-47cb-9d81-9ab423e349df',
        'targetImageId': PUBLIC_FLIGHT_REPAIR_IMAGE,
        'targetSourceRevision': PUBLIC_FLIGHT_REPAIR_REVISION,
        'historicalBaselineSha256': '0d80ff6b78f046ddfcb5ca4b8865ae72aabcc0c8c7f5d76daa9b7cf46d0d7ef2',
        'failedContainerId': '314b7cc084a80d88cb121a9146c0e2eb5e1732dda8baa28aadc1dd3016b6751a',
        'pendingSha256': '4d267e151063b16008e0bb385d59da5589796a7ca5337a4ab80ec27f1d13effd',
        'acceptedPointerSha256': 'b987a423f28f4715d353010d94ced745e479f3d6f41574151d7a8a8df092c70b'}
    digests = {'sourceSpecSha256', 'adapterConfigSha256', 'routeSha256'}
    request = {'origin': 'http://docker.home.cz:5020', 'path': '/flight-data/api/v1/cop/tracks',
               'limit': 500, 'includeStale': True, 'source': None, 'bbox': None}
    observation = {'httpStatus': 502, 'errorCode': 'SOURCE_UNAVAILABLE', 'jsonProblem': True,
                   'allEnabledSourcesFailed': True, 'onlyUpstream429': True, 'upstreamHttpCodes': [429],
                   'enabledSources': ['adsb_lol'], 'simServiceAlive': True, 'simServiceReady': True}
    require(isinstance(value, dict) and set(value) == set(fixed) | digests | {'request', 'observation', 'checkedAt', 'expiresAt'}
            and all(value[k] == v for k, v in fixed.items())
            and all(isinstance(value[k], str) and re.fullmatch(r'[0-9a-f]{64}', value[k]) for k in digests)
            and encoded(value['request']) == encoded(request)
            and encoded(value['observation']) == encoded(observation)
            and value['routeSha256'] == sha(encoded(request))
            and proof['target']['imageId'] == value['targetImageId']
            and proof['target']['sourceRevision'] == value['targetSourceRevision']
            and proof['cleanReset']['resetEpoch'] == value['resetEpoch'], 'public_flight_evidence_scope')
    if proof['operation'] == 'prepare':
        require(value['sourceSpecSha256'] == proof['publicFlightRepair']['sourceSpecSha256'],
                'public_flight_evidence_source_spec')
    checked, expires = fenced_timestamp(value['checkedAt']), fenced_timestamp(value['expiresAt'])
    require(0 < expires - checked <= 600, 'public_flight_evidence_lifetime')
    if fresh:
        require(checked <= datetime.now(timezone.utc).timestamp() <= expires, 'public_flight_evidence_expired')
    return value


def public_flight_health_comparison(before, after):
    """One explicit optional-feed delta, never a rewritten baseline or success stub."""
    health_statuses(before); health_statuses(after)
    ranks = {'ok': 0, 'online': 0, 'degraded': 1, 'unavailable': 2, 'offline': 2}
    for url in HEALTH_URLS:
        old, new = before[url], after[url]
        require(new['httpStatus'] == old['httpStatus'] or
                (old['httpStatus'] == 503 and new['httpStatus'] == 200), 'critical_health_http_changed')
        require(new['httpStatus'] == 200, 'critical_health_http_not_ready')
        if url == HEALTH_URLS[-1]:
            continue
        a = {'self': old.get('status'), **old.get('dependencies', {})}
        b = {'self': new.get('status'), **new.get('dependencies', {})}
        added = b.keys() - a.keys()
        require(not a.keys() - b.keys() and added <= {'safety-notification-worker', 'cop-account-erasure-owners'}
                and all(b[k] in {'ok', 'online', 'disabled'} for k in added), 'critical_health_dependency_set')
        for name, previous in a.items():
            current = b[name]
            if url == HEALTH_URLS[2] and name == 'flight-data-source':
                require(previous in {'ok', 'degraded'} and current in {'ok', 'degraded'}, 'public_flight_state_not_permitted')
            else:
                require(current != 'unknown' and previous != 'unknown' and
                        (current == previous or previous in ranks and current in ranks and ranks[current] <= ranks[previous]),
                        'critical_health_regression')
    deps = after[HEALTH_URLS[2]].get('dependencies', {})
    require(deps.get('cop-account-erasure-owners') == 'ok'
            and deps.get('flight-data-source') in {'ok', 'degraded'}, 'critical_owner_or_public_flight_missing')
    critical = {'csm-messaging-provider', 'situation-data-source', 'safety-data-source', 'sim-search-data-source',
                'cop-stream-bus', 'federation-runtime-store', 'track-history-store', 'user-profile-store',
                'community-report-store', 'incident-store', 'sketch-drawing-store', 'mobile-device-store', 'media-storage'}
    require(all(deps.get(name) == 'ok' for name in critical), 'critical_dependency_not_ready')
    return deps['flight-data-source']


def public_flight_auth_boundary():
    import urllib.request
    import urllib.error
    for path in ('/api/v1/auth/session', '/api/v1/me/account-deletion/capabilities'):
        try:
            response = urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:4310' + path,
                headers={'DNT': '1', 'Sec-GPC': '1'}), timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            require(response.status == 401, 'public_flight_critical_auth_failed')


PREPARED_CONTINUATION_VERSION = 'cop-api-account-erasure-prepared-target-continuation-v1'
PREPARED_CONTINUATION_ENABLE_VERSION = 'cop-api-account-erasure-prepared-target-continuation-enable-v1'
PREPARED_CONTINUATION_CHECKS = {'currentPreparedTargetVerified', 'currentProvidersAndProducersVerified',
                               'originalEvidencePreserved', 'criticalHealthPolicyReviewed'}
PREPARED_CONTINUATION_ENABLE_CHECKS = PUBLIC_FLIGHT_REPAIR_ENABLE_CHECKS | {'acceptedPreparedContinuationVerified'}
PREPARED_CONTINUATION_CID = '7e7423bb9e42794d24896e682731479ae1e1c815827a0a33ea73d876231fe206'
PREPARED_CONTINUATION_RELEASE = 'release-818c6ce08ff648e9a845dde2c155e056'
PREPARED_CONTINUATION_PENDING = 'fc93ba32d0ebb2442b62f10dad60a365a269c15363d5a8adde878b0fbf1a7860'


def prepared_continuation_ref(proof):
    ref = proof.get('publicFlightPolicy')
    require(isinstance(ref, dict) and set(ref) == {'path', 'sha256', 'operationId'}
            and ref['operationId'] == proof['transitionId'] and PROFILE_UUID.fullmatch(ref['operationId'])
            and isinstance(ref['sha256'], str) and re.fullmatch(r'[0-9a-f]{64}', ref['sha256'])
            and ref['path'] == str(PROFILES / proof['target']['profileGeneration'] /
                                  ('prepared-flight-' + ref['operationId'] + '.json')), 'prepared_continuation_reference')
    return ref


def prepared_continuation_schema(proof):
    require(proof.get('contractVersion') == PREPARED_CONTINUATION_VERSION
            and proof.get('operation') == 'prepare' and proof.get('changedKeys') == []
            and proof['target']['imageId'] == PUBLIC_FLIGHT_REPAIR_IMAGE
            and proof['target']['sourceRevision'] == PUBLIC_FLIGHT_REPAIR_REVISION,
            'prepared_continuation_scope')
    w = proof.get('preparedTargetContinuation')
    fixed = {'contractVersion': 'cop-prepared-target-continuation-witness-v1',
             'originalProofPath': str(PROFILES / proof['target']['profileGeneration'] /
                 'account-erasure-ada81c52-8e1a-46c0-8b42-5b7a05e8390f.json'),
             'originalExternalReceiptSha256': '3e11eff3022bab050e16dfa61ba49533dbfac3d547932a939e55fe1e37937486',
             'originalProofSha256': '0706a8d3dd5782b29db2870c011e8d1fe419fdd46d68462408c7411310aaca8f',
             'originalBindingSha256': '9319dea17eba6fccadf24b805ec0c144ae7fa98e618e6925c8ee6421d512236b',
             'sourceSpecSha256': 'f3a037ccf1e01c321ce20a6e6d70bbb9ff860f1c179052b8a2167f1aaec05912',
             'pendingSha256': PREPARED_CONTINUATION_PENDING,
             'originalAcceptedPointerSha256': 'b987a423f28f4715d353010d94ced745e479f3d6f41574151d7a8a8df092c70b',
             'targetContainerId': PREPARED_CONTINUATION_CID, 'targetReleaseId': PREPARED_CONTINUATION_RELEASE}
    digests = {'authorizationRecordSha256',
               'actualProviderReadinessSha256', 'actualProducerInventorySha256'}
    require(isinstance(w, dict) and set(w) == set(fixed) | digests | {'checkedAt', 'expiresAt'}
            and all(w[k] == v for k, v in fixed.items())
            and all(isinstance(w[k], str) and re.fullmatch(r'[0-9a-f]{64}', w[k]) for k in digests),
            'prepared_continuation_witness')
    require(0 < fenced_timestamp(w['expiresAt']) - fenced_timestamp(w['checkedAt']) <= 600,
            'prepared_continuation_lifetime')
    prepared_continuation_ref(proof)
    return w


def prepared_continuation_enable_schema(proof):
    require(proof.get('contractVersion') == PREPARED_CONTINUATION_ENABLE_VERSION
            and proof.get('operation') == 'enable' and proof.get('changedKeys') == ['COP_ACCOUNT_ERASURE_ENABLED']
            and proof['previous']['imageId'] == proof['target']['imageId'] == PUBLIC_FLIGHT_REPAIR_IMAGE
            and proof['target']['sourceRevision'] == PUBLIC_FLIGHT_REPAIR_REVISION,
            'prepared_continuation_enable_scope')
    w = proof.get('preparedTargetContinuationEnable')
    digests = {'acceptedContinuationProofSha256', 'runtimeAcceptanceReceiptSha256',
               'authorizationRecordSha256', 'freshOwnerReadinessSha256'}
    require(isinstance(w, dict) and set(w) == digests | {'contractVersion', 'checkedAt', 'expiresAt', 'acceptedContinuationProofPath'}
            and w['contractVersion'] == 'cop-prepared-target-continuation-enable-witness-v1'
            and all(isinstance(w[k], str) and re.fullmatch(r'[0-9a-f]{64}', w[k]) for k in digests)
            and 0 < fenced_timestamp(w['expiresAt']) - fenced_timestamp(w['checkedAt']) <= 600,
            'prepared_continuation_enable_witness')
    require(isinstance(w['acceptedContinuationProofPath'], str)
            and Path(w['acceptedContinuationProofPath']).parent == PROFILES / proof['target']['profileGeneration']
            and re.fullmatch(r'account-erasure-[0-9a-f-]{36}\.json', Path(w['acceptedContinuationProofPath']).name),
            'prepared_continuation_enable_prepare_path')
    prepared_continuation_ref(proof)
    return w


def prepared_target_observation_schema(value, proof, basis, fresh=False):
    recovered = {'httpStatus': 200, 'responseContractMatches': True, 'enabledSources': ['adsb_lol'],
                 'simServiceAlive': True, 'simServiceReady': True}
    fixed = {'contractVersion': 'cop-public-flight-prepared-target-observation-v1',
             'operationId': proof['transitionId'], 'originalProofSha256': basis['originalProofSha256'],
             'originalExternalReceiptSha256': basis['originalExternalReceiptSha256'],
             'resetEpoch': 'ea1699f1-16c7-47cb-9d81-9ab423e349df',
             'targetContainerId': PREPARED_CONTINUATION_CID, 'targetReleaseId': PREPARED_CONTINUATION_RELEASE,
             'targetImageId': PUBLIC_FLIGHT_REPAIR_IMAGE, 'targetSourceRevision': PUBLIC_FLIGHT_REPAIR_REVISION,
             'preparedPendingSha256': PREPARED_CONTINUATION_PENDING,
             'originalAcceptedPointerSha256': basis['originalAcceptedPointerSha256'],
             'preparedSourceSpecSha256': basis['sourceSpecSha256']}
    digests = {'currentActivePointerSha256', 'observedSourceSpecSha256', 'adapterConfigSha256', 'routeSha256',
               'actualProviderReadinessSha256', 'actualProducerInventorySha256'}
    request = {'origin': 'http://docker.home.cz:5020', 'path': '/flight-data/api/v1/cop/tracks',
               'limit': 500, 'includeStale': True, 'source': None, 'bbox': None}
    observation = {'httpStatus': 502, 'errorCode': 'SOURCE_UNAVAILABLE', 'jsonProblem': True,
                   'allEnabledSourcesFailed': True, 'onlyUpstream429': True, 'upstreamHttpCodes': [429],
                   'enabledSources': ['adsb_lol'], 'simServiceAlive': True, 'simServiceReady': True}
    require(isinstance(value, dict) and set(value) == set(fixed) | digests | {'request', 'observation', 'checkedAt', 'expiresAt'}
            and all(value[k] == v for k, v in fixed.items())
            and all(isinstance(value[k], str) and re.fullmatch(r'[0-9a-f]{64}', value[k]) for k in digests)
            and encoded(value['request']) == encoded(request)
            and encoded(value['observation']) in {encoded(observation), encoded(recovered)}
            and value['routeSha256'] == sha(encoded(request)), 'prepared_target_observation_scope')
    w = basis if proof['operation'] == 'prepare' else proof['preparedTargetContinuationEnable']
    require(value['checkedAt'] == w['checkedAt'] and value['expiresAt'] == w['expiresAt']
            and 0 < fenced_timestamp(value['expiresAt']) - fenced_timestamp(value['checkedAt']) <= 600,
            'prepared_target_observation_lifetime')
    if proof['operation'] == 'prepare':
        require(value['currentActivePointerSha256'] == basis['originalAcceptedPointerSha256']
                and value['observedSourceSpecSha256'] == basis['sourceSpecSha256']
                and value['actualProviderReadinessSha256'] == basis['actualProviderReadinessSha256']
                and value['actualProducerInventorySha256'] == basis['actualProducerInventorySha256'],
                'prepared_target_current_facts')
    if fresh:
        require(fenced_timestamp(value['checkedAt']) <= datetime.now(timezone.utc).timestamp() <= fenced_timestamp(value['expiresAt']),
                'prepared_target_observation_expired')
    return value


POST_EDGE_VERSION = 'cop-api-post-edge-promotion-v1'
POST_EDGE_ENABLE_VERSION = 'cop-api-post-edge-enable-v1'
POST_EDGE_ENABLE_AUTH_VERSION = 'cop-api-post-edge-enable-oidc-v1'
CONTINUITY_REPAIR_VERSION = 'cop-api-continuity-image-repair-v1'
COMMUNICATION_SAFETY_VERSION = 'cop-api-communication-safety-activation-v1'
ARRIVAL_RELEASE_VERSION = 'cop-api-user-selected-arrival-release-v1'
ARRIVAL_REVERSION_VERSION = 'cop-api-user-selected-arrival-reversion-v1'
POST_EDGE_AUTH_SCOPE = 'oidc_no_lab_v1'
POST_EDGE_AUTH_KEYS = frozenset({'COP_AUTH_MODE', 'COP_ALLOW_LAB_TOKEN'})
POST_EDGE_HELPER_SHA256 = '3844d42977343fe934b097ce87e9ff416817b88b66d2e94e1b8aecf0d1b744f5'
ARRIVAL_REVERSION_WORKER_SHA256 = '7a29b158cddcc7883a851367dc5352aee7c8f77200e2baa75f1fdc078cdb4b10'
POST_EDGE_PEER_HELPER_SHA256 = '02892fda977ba186694ff4bac536db40ad7bedf14eb3e5e819ae0698e44ec8f5'


def is_clean_erasure_proof(value):
    return isinstance(value, dict) and value.get('contractVersion') in {
        CLEAN_ERASURE_PROOF_VERSION, NODE_METADATA_PROOF_VERSION, FENCED_SOURCE_PROOF_VERSION,
        PENDING_REPLACEMENT_VERSION, PENDING_REPLACEMENT_ENABLE_VERSION,
        STARTUP_REPAIR_VERSION, STARTUP_REPAIR_ENABLE_VERSION,
        INDEX_BOUNDARY_REPAIR_VERSION, INDEX_BOUNDARY_REPAIR_ENABLE_VERSION,
        PROVIDER_BOUNDARY_REPAIR_VERSION, PROVIDER_BOUNDARY_REPAIR_ENABLE_VERSION,
        OWNER_READINESS_REPAIR_VERSION, OWNER_READINESS_REPAIR_ENABLE_VERSION,
        PUBLIC_FLIGHT_REPAIR_VERSION, PUBLIC_FLIGHT_REPAIR_ENABLE_VERSION,
        PREPARED_CONTINUATION_VERSION, PREPARED_CONTINUATION_ENABLE_VERSION,
        POST_EDGE_VERSION, POST_EDGE_ENABLE_VERSION, POST_EDGE_ENABLE_AUTH_VERSION, CONTINUITY_REPAIR_VERSION, COMMUNICATION_SAFETY_VERSION, ARRIVAL_RELEASE_VERSION, ARRIVAL_REVERSION_VERSION}


def node_metadata_transition(proof):
    """Root-attested, single-image-pair metadata witness; never a general override."""
    require(isinstance(proof, dict) and proof.get('contractVersion') in {NODE_METADATA_PROOF_VERSION, FENCED_SOURCE_PROOF_VERSION}
            and proof.get('operation') == 'prepare', 'node_metadata_proof_scope')
    witness = proof.get('imageMetadataTransition')
    require(isinstance(witness, dict) and set(witness) == {
        'contractVersion', 'key', 'fromImageId', 'toImageId', 'fromNodeVersion',
        'toNodeVersion', 'fromBinaryVersion', 'toBinaryVersion'}, 'node_metadata_witness_schema')
    require(witness == {
        'contractVersion': 'cop-node-image-metadata-v1', 'key': NODE_METADATA_KEY,
        'fromImageId': NODE_METADATA_FROM_IMAGE, 'toImageId': NODE_METADATA_TO_IMAGE,
        'fromNodeVersion': NODE_METADATA_FROM_VERSION, 'toNodeVersion': NODE_METADATA_TO_VERSION,
        'fromBinaryVersion': 'v' + NODE_METADATA_FROM_VERSION,
        'toBinaryVersion': 'v' + NODE_METADATA_TO_VERSION}, 'node_metadata_witness_binding')
    require(proof.get('previous', {}).get('imageId') == NODE_METADATA_FROM_IMAGE
            and proof.get('target', {}).get('imageId') == NODE_METADATA_TO_IMAGE,
            'node_metadata_image_pair')
    keys = proof.get('changedKeys')
    extras = {NODE_METADATA_KEY}
    if proof['contractVersion'] == FENCED_SOURCE_PROOF_VERSION:
        existing_actor_introduction(proof)
        extras.add(EXISTING_ACTOR_KEY)
    require(isinstance(keys, list) and all(isinstance(k, str) for k in keys)
            and keys == sorted(set(keys)) and set(keys) - CLEAN_ERASURE_CONFIG_KEYS == extras,
            'node_metadata_delta_scope')
    return witness


def existing_actor_introduction(proof):
    witness = proof.get('existingActorIntroduction')
    require(proof.get('contractVersion') == FENCED_SOURCE_PROOF_VERSION
            and proof.get('operation') == 'prepare'
            and isinstance(witness, dict) and set(witness) == {
                'contractVersion', 'key', 'sourceAbsent', 'existingCopEnvironmentVerified',
                'simRouterBindingVerified', 'simDriverBindingVerified',
                'composeFile', 'beforeSha256', 'afterSha256'}
            and witness['contractVersion'] == 'cop-existing-erasure-actor-binding-v1'
            and witness['key'] == EXISTING_ACTOR_KEY
            and all(witness[k] is True for k in ('sourceAbsent', 'existingCopEnvironmentVerified',
                'simRouterBindingVerified', 'simDriverBindingVerified'))
            and witness['composeFile'] == 'docker-compose.yml'
            and all(isinstance(witness[k], str) and re.fullmatch(r'[0-9a-f]{64}', witness[k])
                    for k in ('beforeSha256', 'afterSha256'))
            and witness['beforeSha256'] != witness['afterSha256']
            and witness['afterSha256'] == proof.get('composeHashes', {}).get('docker-compose.yml'),
            'existing_actor_introduction_unproven')


def existing_actor_from_dotenv(raw):
    require(isinstance(raw, bytes) and len(raw) <= 1048576, 'existing_actor_environment_invalid')
    rows = re.findall(rb'^(?:export[ \t]+)?COP_SIM_ERASURE_ACTOR_SECRET[ \t]*=(.*)$', raw, re.MULTILINE)
    require(len(rows) == 1, 'existing_actor_environment_ambiguous')
    value = rows[0].strip().decode('utf-8')
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'\"', "'"}:
        value = value[1:-1]
    require(32 <= len(value) <= 16384 and not any(ord(c) < 32 for c in value)
            and EXISTING_ACTOR_KEY not in os.environ, 'existing_actor_environment_invalid')
    return value


def node_image_default(image, expected_id):
    require(isinstance(image, dict) and image.get('Id') == expected_id
            and isinstance(image.get('Config'), dict), 'node_metadata_actual_image')
    rows = image['Config'].get('Env')
    require(isinstance(rows, list) and all(isinstance(x, str) for x in rows), 'node_metadata_image_environment')
    values = [x.split('=', 1)[1] for x in rows if x.startswith(NODE_METADATA_KEY + '=')]
    require(len(values) == 1, 'node_metadata_unique_default')
    return values[0]


def node_metadata_witness(from_image, to_image, *, binary_versions):
    """Producer inputs are actual inspect records and bounded --version receipts."""
    require(node_image_default(from_image, NODE_METADATA_FROM_IMAGE) == NODE_METADATA_FROM_VERSION
            and node_image_default(to_image, NODE_METADATA_TO_IMAGE) == NODE_METADATA_TO_VERSION,
            'node_metadata_actual_defaults')
    require(binary_versions == {NODE_METADATA_FROM_IMAGE: 'v' + NODE_METADATA_FROM_VERSION,
                                NODE_METADATA_TO_IMAGE: 'v' + NODE_METADATA_TO_VERSION},
            'node_metadata_binary_receipts')
    return {'contractVersion': 'cop-node-image-metadata-v1', 'key': NODE_METADATA_KEY,
            'fromImageId': NODE_METADATA_FROM_IMAGE, 'toImageId': NODE_METADATA_TO_IMAGE,
            'fromNodeVersion': NODE_METADATA_FROM_VERSION, 'toNodeVersion': NODE_METADATA_TO_VERSION,
            'fromBinaryVersion': binary_versions[NODE_METADATA_FROM_IMAGE],
            'toBinaryVersion': binary_versions[NODE_METADATA_TO_IMAGE]}


def validate_node_metadata_images(proof, from_image, to_image, *, compose_environment,
                                  dotenv_raw, profile_environment):
    """Called with actual Docker inspect/config and protected server files only."""
    witness = node_metadata_transition(proof)
    require(node_image_default(from_image, NODE_METADATA_FROM_IMAGE) == witness['fromNodeVersion']
            and node_image_default(to_image, NODE_METADATA_TO_IMAGE) == witness['toNodeVersion'],
            'node_metadata_actual_defaults')
    require(isinstance(compose_environment, dict) and NODE_METADATA_KEY not in compose_environment
            and isinstance(profile_environment, dict) and NODE_METADATA_KEY not in profile_environment,
            'node_metadata_config_override')
    require(isinstance(dotenv_raw, bytes) and len(dotenv_raw) <= 1048576
            and not re.search(rb'^\s*(?:export\s+)?NODE_VERSION\s*=', dotenv_raw, re.MULTILINE)
            and NODE_METADATA_KEY not in os.environ, 'node_metadata_environment_override')
    return witness


def erasure_environment_changes(actual, desired, proof):
    """Compare complete actual/effective environments only in RAM."""
    changed = {key for key in set(actual) | set(desired)
               if (key in actual) != (key in desired) or actual.get(key) != desired.get(key)}
    require(changed == set(proof['changedKeys']), 'erasure_configuration_delta_mismatch')
    if proof.get('contractVersion') in {COMMUNICATION_SAFETY_VERSION, ARRIVAL_RELEASE_VERSION, ARRIVAL_REVERSION_VERSION}:
        scope_store = Store(uid=1000)
        scope_store.post_edge_module().environment(scope_store.post_edge_runtime(), actual, desired, proof)
        erasure_target_environment(desired, proof['operation'], proof['cleanReset'])
        return
    operation = proof['operation']
    clean = proof.get('cleanReset') if is_clean_erasure_proof(proof) else None
    if proof.get('contractVersion') in {NODE_METADATA_PROOF_VERSION, FENCED_SOURCE_PROOF_VERSION}:
        witness = node_metadata_transition(proof)
        require(actual.get(NODE_METADATA_KEY) == witness['fromNodeVersion']
                and desired.get(NODE_METADATA_KEY) == witness['toNodeVersion']
                and NODE_METADATA_KEY in changed, 'node_metadata_actual_delta')
    if proof.get('contractVersion') == FENCED_SOURCE_PROOF_VERSION:
        existing_actor_introduction(proof)
        require(EXISTING_ACTOR_KEY not in actual and EXISTING_ACTOR_KEY in changed,
                'existing_actor_source_not_absent')
    erasure_target_environment(desired, operation, clean)
    if operation == 'prepare':
        require(bool(changed) and actual.get('COP_ACCOUNT_ERASURE_ENABLED', 'false') == 'false'
                and actual.get('COP_ACCOUNT_SAFETY_GUARD_REQUIRED', 'false') == 'false', 'erasure_first_install_only')
    elif operation in {'enable', 'pause'}:
        if proof.get('contractVersion') == POST_EDGE_ENABLE_AUTH_VERSION:
            require(operation == 'enable' and changed == {'COP_ACCOUNT_ERASURE_ENABLED'} | POST_EDGE_AUTH_KEYS
                    and {k: actual.get(k) for k in changed} == {
                        'COP_ACCOUNT_ERASURE_ENABLED': 'false', 'COP_AUTH_MODE': 'hybrid', 'COP_ALLOW_LAB_TOKEN': 'true'}
                    and {k: desired.get(k) for k in changed} == {
                        'COP_ACCOUNT_ERASURE_ENABLED': 'true', 'COP_AUTH_MODE': 'oidc', 'COP_ALLOW_LAB_TOKEN': 'false'},
                    'erasure_oidc_auth_transition_invalid')
        else:
            require(changed == {'COP_ACCOUNT_ERASURE_ENABLED'}
                    and actual.get('COP_ACCOUNT_ERASURE_ENABLED') == ('false' if operation == 'enable' else 'true'),
                    'erasure_intake_transition_invalid')
    else:
        require(operation == 'maintain' and not changed, 'erasure_maintain_config_changed')
        if proof.get('contractVersion') == CONTINUITY_REPAIR_VERSION:
            require(desired.get('COP_ACCOUNT_ERASURE_ENABLED') == 'true'
                    and desired.get('COP_AUTH_MODE') == 'oidc' and desired.get('COP_ALLOW_LAB_TOKEN') == 'false',
                    'continuity_repair_auth_not_preserved')


class RuntimeError(Exception):
    pass


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def private_read(path, uid, limit=65536, mode=0o600, gid=None):
    """Owner-private regular files only; no symlink at any component."""
    require(not any(p.is_symlink() for p in (path, *path.parents)), 'private_path_symlink')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == uid
                and stat.S_IMODE(info.st_mode) == mode and info.st_nlink == 1
                and (gid is None or info.st_gid == gid), 'private_file_permissions')
        raw = os.read(fd, limit + 1)
        require(len(raw) <= limit, 'private_file_too_large')
        return raw
    finally:
        os.close(fd)


def private_json(path, uid):
    try:
        return json.loads(private_read(path, uid))
    except (ValueError, UnicodeError):
        raise RuntimeError('private_json_invalid') from None


def env_values(raw):
    # Compose single quotes preserve literal $ and ${...}; never source this file.
    values = {}
    for line in raw.decode().splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        match = re.fullmatch(r"(COP_API_RUNTIME_[A-Z_]+)='([^'\r\n]*)'", line)
        require(match is not None, 'runtime_env_syntax')
        key, value = match.groups()
        require(key in ENV.values() and key not in values, 'runtime_env_scope')
        values[key] = value
    require(set(values) == set(ENV.values()), 'runtime_env_incomplete')
    return {name: values[key] for name, key in ENV.items()}


def driver_contract(value):
    keys = {'poolMode', 'streamMode', 'mainEnvAndMigrations', 'frontend', 'socketPath',
            'socketPort', 'supplementaryGid', 'caPath', 'caSha256', 'leasePath',
            'backendBudget', 'clientBudget'}
    require(isinstance(value, dict) and set(value) == keys
            and value['poolMode'] in {'direct', 'session', 'transaction'}
            and value['streamMode'] == 'memory' and value['mainEnvAndMigrations'] == 'direct',
            'driver_contract_invalid')
    if value['poolMode'] == 'transaction':
        require(value['frontend'] == 'unix' and value['socketPath'] == str(SOCKET)
                and value['socketPort'] == 6432 and value['supplementaryGid'] == 982
                and value['caPath'] == str(CA) and re.fullmatch(r'[0-9a-f]{64}', value['caSha256'])
                and value['leasePath'] == 'direct_verify_full'
                and value['backendBudget'] == 10 and value['clientBudget'] == 80,
                'transaction_contract_invalid')
    else:
        require(value['frontend'] == value['poolMode'] and value['leasePath'] == 'direct'
                and all(value[key] is None for key in ('socketPath', 'socketPort', 'supplementaryGid',
                    'caPath', 'caSha256', 'backendBudget', 'clientBudget')), 'direct_contract_invalid')
    return value


def unresolved_config(value):
    """Normalize raw Compose environment shapes without interpolation/decoding."""
    require(isinstance(value, dict) and isinstance(value.get('services'), dict), 'unresolved_compose_invalid')
    for service in value['services'].values():
        require(isinstance(service, dict), 'unresolved_compose_invalid')
        if 'environment' not in service:
            continue
        environment = service['environment']
        require(isinstance(environment, (dict, list)), 'unresolved_environment_invalid')
        if isinstance(environment, list):
            mapping = {}
            for entry in environment:
                require(isinstance(entry, str), 'unresolved_environment_invalid')
                key, separator, item = entry.partition('=')
                require(separator == '=' and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key) and key not in mapping,
                        'unresolved_environment_invalid')
                mapping[key] = item
            environment = mapping
        require(all(isinstance(key, str) and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key)
                    and (item is None or isinstance(item, str)) for key, item in environment.items()),
                'unresolved_environment_invalid')
        service['environment'] = environment
    return value


def normalized_config(value):
    # Compose's reusable config serializer doubles literal dollars. Decode its
    # environment serialization once in RAM; never write/pass resolved config.
    for service in value.get('services', {}).values():
        service['environment'] = {key: item.replace('$$', '$') if isinstance(item, str) else item
                                  for key, item in service.get('environment', {}).items()}
    return value


def health_statuses(value):
    """Closed public status metadata only; never retain raw health responses."""
    require(isinstance(value, dict) and set(value) == set(HEALTH_URLS), 'health_witness_status_invalid')
    for url, item in value.items():
        require(isinstance(item, dict) and type(item.get('httpStatus')) is int
                and 100 <= item['httpStatus'] <= 599, 'health_witness_status_invalid')
        if url == HEALTH_URLS[-1]:
            require(set(item) == {'httpStatus'} and item['httpStatus'] == 200, 'health_witness_status_invalid')
        else:
            require(set(item) in ({'httpStatus', 'status'}, {'httpStatus', 'status', 'dependencies'})
                    and item['status'] in HEALTH_STATES, 'health_witness_status_invalid')
            dependencies = item.get('dependencies', {})
            require(isinstance(dependencies, dict) and len(dependencies) <= 256
                    and all(re.fullmatch(r'[a-z0-9_-]{1,80}', key) and state in HEALTH_STATES
                            for key, state in dependencies.items()), 'health_witness_status_invalid')
    require(value[HEALTH_URLS[0]]['httpStatus'] == 200, 'health_witness_status_invalid')
    return value



def fenced_timestamp(value):
    require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z', value), 'fenced_source_time_format')
    return datetime.fromisoformat(value[:-1] + '+00:00').timestamp()


def fenced_public_source_spec(actual):
    """No environment, credentials or data payload in this public runtime hash."""
    return {'Id': actual.get('Id'), 'Image': actual.get('Image'),
            'HostConfig': actual.get('HostConfig'),
            'Mounts': sorted(actual.get('Mounts', []), key=lambda x: x['Destination']),
            'NetworkSettings': actual.get('NetworkSettings')}


def fenced_source_witness_schema(proof):
    """Immutable historical readback; no current-clock or Docker dependency."""
    require(isinstance(proof, dict) and proof.get('contractVersion') == FENCED_SOURCE_PROOF_VERSION
            and proof.get('operation') == 'prepare', 'fenced_source_proof_scope')
    node_metadata_transition(proof)
    w = proof.get('fencedSourceReadiness')
    fields = {'contractVersion', 'planSha256', 'resetEpoch', 'resetReceiptSha256',
              'historicalBaselineSha256', 'preStopReportSha256', 'sourceContainerId',
              'sourceImageId', 'targetImageId', 'sourceStartedAt', 'sourceFinishedAt',
              'sourceSpecSha256', 'checkedAt', 'expiresAt', 'sourceStopped',
              'sourceHealthHistorical', 'producerPaused', 'activeProducerCount',
              'simReadiness', 'messagingReadiness'}
    require(isinstance(w, dict) and set(w) == fields, 'fenced_source_witness_schema')
    require(w['contractVersion'] == 'cop-clean-fenced-source-readiness-v1'
            and w['planSha256'] == FENCED_SOURCE_PLAN_SHA256
            and w['historicalBaselineSha256'] == FENCED_SOURCE_BASELINE_SHA256
            and w['resetEpoch'] == proof['cleanReset']['resetEpoch']
            and w['resetReceiptSha256'] == proof['cleanReset']['receiptSha256']
            and w['sourceContainerId'] == proof['previous']['containerId']
            and w['sourceImageId'] == proof['previous']['imageId'] == NODE_METADATA_FROM_IMAGE
            and w['targetImageId'] == proof['target']['imageId'] == NODE_METADATA_TO_IMAGE,
            'fenced_source_schema_binding')
    require(all(isinstance(w[k], str) and re.fullmatch(r'[0-9a-f]{64}', w[k])
                for k in ('resetReceiptSha256', 'preStopReportSha256', 'sourceSpecSha256', 'sourceContainerId'))
            and w['sourceStopped'] is True and w['sourceHealthHistorical'] is True
            and w['producerPaused'] is True and type(w['activeProducerCount']) is int
            and w['activeProducerCount'] == 0, 'fenced_source_schema_values')
    started, finished, checked, expires = [fenced_timestamp(w[k]) for k in
        ('sourceStartedAt', 'sourceFinishedAt', 'checkedAt', 'expiresAt')]
    require(started <= finished <= checked < expires <= fenced_timestamp(FENCED_SOURCE_DEADLINE)
            and expires - checked <= 600, 'fenced_source_schema_time')
    sim, message = w['simReadiness'], w['messagingReadiness']
    require(isinstance(sim, dict) and set(sim) == {'ready', 'count', 'resetEpoch', 'proofSha256'}
            and sim['ready'] is True and type(sim['count']) is int and sim['count'] == 5
            and sim['resetEpoch'] == w['resetEpoch']
            and isinstance(sim['proofSha256'], str) and re.fullmatch(r'[0-9a-f]{64}', sim['proofSha256']),
            'fenced_source_sim_schema')
    require(isinstance(message, dict) and set(message) == {'ready', 'authenticatedOwnerPreflight', 'proofSha256'}
            and message['ready'] is True and message['authenticatedOwnerPreflight'] is True
            and isinstance(message['proofSha256'], str) and re.fullmatch(r'[0-9a-f]{64}', message['proofSha256']),
            'fenced_source_message_schema')
    return w


def validate_fenced_source_readiness(proof, previous, actual, receipt_raw, baseline_raw, *, now=None):
    """Fresh stopped-source continuity, NOT a fresh health claim for the old API.
    Historical health stays unmodified and remains only the regression baseline.
    The target still passes the existing real live/ready/dependency/demo gates.
    """
    require(proof.get('contractVersion') == FENCED_SOURCE_PROOF_VERSION and proof.get('operation') == 'prepare', 'fenced_source_proof_scope')
    node_metadata_transition(proof)
    witness = fenced_source_witness_schema(proof)
    fields = {'contractVersion', 'planSha256', 'resetEpoch', 'resetReceiptSha256',
              'historicalBaselineSha256', 'preStopReportSha256', 'sourceContainerId',
              'sourceImageId', 'targetImageId', 'sourceStartedAt', 'sourceFinishedAt',
              'sourceSpecSha256', 'checkedAt', 'expiresAt', 'sourceStopped',
              'sourceHealthHistorical', 'producerPaused', 'activeProducerCount',
              'simReadiness', 'messagingReadiness'}
    require(isinstance(witness, dict) and set(witness) == fields, 'fenced_source_witness_schema')
    receipt, baseline = json.loads(receipt_raw), json.loads(baseline_raw)
    require(witness['contractVersion'] == 'cop-clean-fenced-source-readiness-v1'
            and witness['planSha256'] == FENCED_SOURCE_PLAN_SHA256
            and witness['resetEpoch'] == proof['cleanReset']['resetEpoch'] == receipt['resetEpoch'] == baseline['resetEpoch']
            and witness['resetReceiptSha256'] == sha(receipt_raw) == proof['cleanReset']['receiptSha256']
            and witness['historicalBaselineSha256'] == sha(baseline_raw) == FENCED_SOURCE_BASELINE_SHA256
            and witness['preStopReportSha256'] == receipt['preStopReportSha256'] == baseline['preStopReportSha256'], 'fenced_source_historical_binding')
    require(witness['sourceContainerId'] == previous['containerId'] == actual['Id'] == baseline['containerId']
            and witness['sourceImageId'] == previous['imageId'] == actual['Image'] == NODE_METADATA_FROM_IMAGE
            and witness['targetImageId'] == proof['target']['imageId'] == NODE_METADATA_TO_IMAGE,
            'fenced_source_runtime_binding')
    state = actual.get('State', {})
    require(witness['sourceStopped'] is True and witness['sourceHealthHistorical'] is True
            and state.get('Running') is False and state.get('Restarting') is False
            and state.get('Status') == 'exited' and state.get('Pid') == 0,
            'fenced_source_not_stopped')
    require(witness['sourceStartedAt'] == state.get('StartedAt')
            and witness['sourceFinishedAt'] == state.get('FinishedAt')
            and witness['sourceSpecSha256'] == sha(encoded(fenced_public_source_spec(actual))),
            'fenced_source_continuity_changed')
    started = fenced_timestamp(witness['sourceStartedAt']); finished = fenced_timestamp(witness['sourceFinishedAt'])
    historical = fenced_timestamp(baseline['checkedAt']); checked = fenced_timestamp(witness['checkedAt'])
    expires = fenced_timestamp(witness['expiresAt']); current = datetime.now(timezone.utc).timestamp() if now is None else now
    require(started <= historical <= finished <= checked <= current <= expires
            and 0 <= current - checked <= 600 and 0 < expires - checked <= 600
            and expires <= fenced_timestamp(FENCED_SOURCE_DEADLINE), 'fenced_source_freshness')
    require(witness['producerPaused'] is True and type(witness['activeProducerCount']) is int
            and witness['activeProducerCount'] == 0, 'fenced_source_producer_unproven')
    sim = witness['simReadiness']; message = witness['messagingReadiness']
    require(isinstance(sim, dict) and set(sim) == {'ready', 'count', 'resetEpoch', 'proofSha256'}
            and sim['ready'] is True and type(sim['count']) is int and sim['count'] == 5
            and sim['resetEpoch'] == receipt['resetEpoch']
            and isinstance(sim['proofSha256'], str) and re.fullmatch(r'[0-9a-f]{64}', sim['proofSha256']),
            'fenced_source_sim_unproven')
    require(isinstance(message, dict) and set(message) == {'ready', 'authenticatedOwnerPreflight', 'proofSha256'}
            and message['ready'] is True and message['authenticatedOwnerPreflight'] is True
            and isinstance(message['proofSha256'], str) and re.fullmatch(r'[0-9a-f]{64}', message['proofSha256']),
            'fenced_source_messaging_unproven')
    return witness


def stopped_clean_baseline(proof, previous, actual, receipt_raw, baseline_raw, now=None):
    """Validate actual Root-owned reset output before using pre-stop health.
    This never authorizes an old-image restart or manufactures a healthy state.
    The normal live source path does not use this exceptional reset transition.
    """
    require(is_clean_erasure_proof(proof)
            and proof.get('operation') == 'prepare', 'clean_stopped_source_scope')
    reset = proof.get('cleanReset', {})
    require(sha(receipt_raw) == reset.get('receiptSha256'), 'clean_reset_receipt_changed')
    receipt, baseline = json.loads(receipt_raw), json.loads(baseline_raw)
    require(isinstance(receipt, dict) and set(receipt) == {
        'contractVersion', 'resetEpoch', 'preStopReportSha256', 'completedPhases',
        'simConfiguration', 'servicesRestarted', 'runtimeFlagsEnabled', 'wholeAccountComplete'}
        and receipt['contractVersion'] == 'cop-sim-common-reset-fenced-v1'
        and receipt['resetEpoch'] == reset.get('resetEpoch')
        and receipt['completedPhases'] == CLEAN_RESET_PHASES
        and receipt['servicesRestarted'] is False and receipt['runtimeFlagsEnabled'] is False
        and receipt['wholeAccountComplete'] is False
        and re.fullmatch(r'[0-9a-f]{64}', receipt['preStopReportSha256'] or ''),
        'clean_reset_receipt_incomplete')
    staged = receipt['simConfiguration']
    require(isinstance(staged, dict) and set(staged) == {'contractVersion', 'environmentSha256',
        'overlaySha256', 'intakeEnabled', 'baseCleanEnabled', 'servicesStarted'}
        and staged['contractVersion'] == 'sim-clean-runtime-config-staged-v1'
        and all(re.fullmatch(r'[0-9a-f]{64}', staged[k] or '') for k in ('environmentSha256', 'overlaySha256'))
        and all(staged[k] is False for k in ('intakeEnabled', 'baseCleanEnabled', 'servicesStarted')),
        'clean_reset_configuration_incomplete')
    require(isinstance(baseline, dict) and set(baseline) == {
        'contractVersion', 'resetEpoch', 'containerId', 'imageId',
        'preStopReportSha256', 'checkedAt', 'statuses'}
        and baseline['contractVersion'] == 'cop-clean-pre-stop-health-v1'
        and baseline['resetEpoch'] == receipt['resetEpoch']
        and baseline['preStopReportSha256'] == receipt['preStopReportSha256']
        and baseline['containerId'] == previous['containerId'] == actual['Id']
        and baseline['imageId'] == previous['imageId'] == actual['Image'],
        'clean_reset_health_binding')
    state = actual.get('State', {})
    require(state.get('Running') is False and state.get('Restarting') is False
            and state.get('Status') == 'exited' and state.get('Pid') == 0,
            'clean_reset_source_not_stopped')
    stamp = baseline['checkedAt']
    require(isinstance(stamp, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', stamp),
            'clean_reset_health_time')
    checked = datetime.strptime(stamp, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc).timestamp()
    current = datetime.now(timezone.utc).timestamp() if now is None else now
    if proof.get('contractVersion') == FENCED_SOURCE_PROOF_VERSION:
        validate_fenced_source_readiness(proof, previous, actual, receipt_raw, baseline_raw, now=current)
    else:
        require(0 <= current - checked <= 3600, 'clean_reset_health_time')
    return encoded(health_statuses(baseline['statuses']))


def overlay(binding, mode):
    service = {
        'image': '${COP_API_RUNTIME_IMAGE_ID:?Immutable API image is required}',
        'environment': ({**{name: '${' + key + '?Runtime profile value is required}' for name, key in ENV.items()},
                         'COP_DATABASE_POOL_MODE': '${' + MODE_ENV + ':?Runtime pool mode is required}'}
                        if binding['kind'] != 'accepted-baseline' else binding['legacyEnvironment']),
        'labels': {'com.cop.runtime.release': binding['releaseId'],
                   'com.cop.runtime.profile-generation': binding['profileGeneration']}}
    if binding.get('accountErasureConfig', {}).get('cleanScope') == 'cop_sim_shared_identity_v1':
        # The approved clean proof carries these additional server settings.
        # Keep the deployment's base Compose files unchanged; only the API's
        # guarded release overlay gains exact .env references, never values.
        service['environment'].update({name: '${' + name + '?Clean lifecycle setting is required}'
            for name in sorted(CLEAN_ERASURE_CONFIG_KEYS)})
        if binding['accountErasureConfig'].get('authScope') == POST_EDGE_AUTH_SCOPE:
            service['environment'].update({name: '${' + name + '?Reviewed OIDC setting is required}'
                for name in sorted(POST_EDGE_AUTH_KEYS)})
    if mode == 'transaction':
        service['group_add'] = ['982']
        service['volumes'] = [
            {'type': 'bind', 'source': str(path), 'target': str(path), 'read_only': True,
             'bind': {'create_host_path': False}} for path in (SOCKET, CA)]
    return {'services': {'cop-api': service}}


def overlay_bytes(binding, mode):
    value = overlay(binding, mode)
    if binding['kind'] != 'accepted-baseline':
        return encoded(value)
    api = value['services']['cop-api']
    # !override replaces the complete environment map, omitting legacy-absent
    # keys even when base Compose or the shell would otherwise supply them.
    return ('services:\n  cop-api:\n' + ''.join(
        '    ' + key + (': !override ' if key == 'environment' else ': ') +
        json.dumps(item, sort_keys=True) + '\n' for key, item in api.items())).encode()


def verify_api_diff(base, desired, values, mode, image, presence=None, clean_values=None, auth_scope=False):
    """Compare resolved values in RAM; all non-API services/topology stay equal."""
    require(set(base) == set(desired), 'compose_topology_changed')
    for key in base:
        if key != 'services':
            require(base[key] == desired[key], 'compose_topology_changed')
    require(set(base['services']) == set(desired['services']), 'compose_services_changed')
    for name in base['services']:
        if name != 'cop-api':
            require(base['services'][name] == desired['services'][name], 'non_api_service_changed')
    old, new = base['services']['cop-api'], desired['services']['cop-api']
    for key in set(old) | set(new):
        if key not in {'image', 'environment', 'labels', 'volumes', 'group_add'}:
            require(old.get(key) == new.get(key), 'api_non_profile_field_changed')
    require(old.get('environment', {}).get('COP_STREAM_BUS', 'memory') == 'memory', 'stream_contract_not_approved')
    expected_env = {**old.get('environment', {}), **values}
    if clean_values is not None:
        require(isinstance(clean_values, dict) and set(clean_values) ==
                (CLEAN_ERASURE_CONFIG_KEYS | POST_EDGE_AUTH_KEYS if auth_scope else CLEAN_ERASURE_CONFIG_KEYS),
                'clean_overlay_scope')
        if auth_scope:
            require(clean_values['COP_AUTH_MODE'] == 'oidc' and clean_values['COP_ALLOW_LAB_TOKEN'] == 'false',
                    'clean_oidc_overlay_values')
        expected_env.update(clean_values)
    if presence is not None:
        for key, included in presence.items():
            if not included:
                expected_env.pop(key, None)
    require(new.get('environment') == expected_env and new.get('image') == image,
            'runtime_interpolation_mismatch')
    old_volumes = {v['target']: v for v in old.get('volumes', [])}
    new_volumes = {v['target']: v for v in new.get('volumes', [])}
    for target, mount in old_volumes.items():
        require(new_volumes.get(target) == mount, 'existing_mount_changed')
    additions = set(new_volumes) - set(old_volumes)
    require(additions == ({str(SOCKET), str(CA)} if mode == 'transaction' else set()), 'runtime_mount_scope')
    for target in additions:
        mount = new_volumes[target]
        require(mount.get('type') == 'bind' and mount.get('source') == target
                and mount.get('read_only') is True
                and mount.get('bind', {}).get('create_host_path') is False, 'unsafe_runtime_mount')
    groups = list(old.get('group_add', []))
    require('982' not in groups, 'base_runtime_group_forbidden')
    require(new.get('group_add', []) == groups + (['982'] if mode == 'transaction' else []), 'runtime_group_scope')
    labels = {**old.get('labels', {}), **{k: v for k, v in new.get('labels', {}).items()
              if k in {'com.cop.runtime.release', 'com.cop.runtime.profile-generation'}}}
    require(new.get('labels', {}) == labels, 'runtime_label_scope')


def duration(value):
    if value is None:
        return 0
    units = {'h': 3600000000000, 'm': 60000000000, 's': 1000000000,
             'ms': 1000000, 'us': 1000, 'ns': 1}
    pieces = re.findall(r'([0-9]+(?:\.[0-9]+)?)(ns|us|ms|s|m|h)', str(value))
    require(pieces and ''.join(number + unit for number, unit in pieces) == str(value), 'health_duration_invalid')
    return int(sum(float(number) * units[unit] for number, unit in pieces))


def host_parity(current, desired, image_config):
    host = current['HostConfig']
    def number(value):
        if value is None: return 0
        return int(value)
    limits = desired.get('deploy', {}).get('resources', {}).get('limits', {})
    expected = {'Memory': number(desired.get('mem_limit', limits.get('memory'))),
                'MemoryReservation': number(desired.get('mem_reservation')),
                'MemorySwap': number(desired.get('memswap_limit')),
                'NanoCpus': int(float(desired.get('cpus', limits.get('cpus', 0))) * 1_000_000_000),
                'CpuShares': number(desired.get('cpu_shares')), 'CpuPeriod': number(desired.get('cpu_period')),
                'CpuQuota': number(desired.get('cpu_quota')), 'CpusetCpus': desired.get('cpuset', ''),
                'OomKillDisable': desired.get('oom_kill_disable', False),
                'PidsLimit': number(desired.get('pids_limit'))}
    for key, expected_value in expected.items():
        actual = host.get(key)
        if actual is None: actual = '' if isinstance(expected_value, str) else False if isinstance(expected_value, bool) else 0
        require(actual == expected_value, 'live_resource_parity_mismatch')
    expected_ports = {}
    for port in desired.get('ports', []):
        require(port.get('mode', 'ingress') == 'ingress', 'port_contract_unsupported')
        key = str(port['target']) + '/' + port.get('protocol', 'tcp')
        expected_ports.setdefault(key, []).append({'HostIp': port.get('host_ip', '0.0.0.0'),
                                                 'HostPort': str(port['published'])})
    actual_ports = {key: [{**item, 'HostIp': item.get('HostIp') or '0.0.0.0'} for item in values]
                    for key, values in (host.get('PortBindings') or {}).items()}
    require(actual_ports == expected_ports, 'live_port_parity_mismatch')
    check = desired.get('healthcheck')
    expected_health = image_config.get('Healthcheck')
    if check is not None:
        expected_health = {'Test': ['NONE']} if check.get('disable') else {'Test': check['test']}
        for key, field in (('interval', 'Interval'), ('timeout', 'Timeout'), ('start_period', 'StartPeriod'), ('start_interval', 'StartInterval')):
            if key in check: expected_health[field] = duration(check[key])
        if 'retries' in check: expected_health['Retries'] = check['retries']
    actual_health = current['Config'].get('Healthcheck')
    # Docker may serialize optional zero durations omitted by Compose.
    normalize = lambda value: {k: v for k, v in (value or {}).items() if v not in (0, None)}
    require(normalize(actual_health) == normalize(expected_health), 'live_healthcheck_parity_mismatch')


def host_pairs(value):
    """Only delimiter spelling differs; names, addresses and counts stay exact."""
    require(isinstance(value, (dict, list)), 'extra_hosts_invalid')
    if isinstance(value, dict):
        pairs = list(value.items())
    else:
        pairs = []
        for item in value:
            require(isinstance(item, str), 'extra_hosts_invalid')
            separator = '=' if '=' in item else ':'
            name, delimiter, address = item.partition(separator)
            require(bool(delimiter), 'extra_hosts_invalid')
            pairs.append((name, address))
    require(all(isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9_.-]+', name)
                and isinstance(address, str) and address and not any(char.isspace() for char in address)
                for name, address in pairs), 'extra_hosts_invalid')
    require(len(set(pairs)) == len(pairs) and len({name for name, _ in pairs}) == len(pairs), 'extra_hosts_duplicate')
    return sorted(pairs)


def runtime_parity(current, desired, image_config, transition=False):
    """Compare desired runtime with inspected API, never a second new render.

    During an approved profile transition only the two profile mounts and GID
    982 may differ. This is deliberately limited to the fixed COP deployment.
    """
    host_parity(current, desired, image_config)
    expected_mounts = {v['target']: (v['source'], not v.get('read_only', False), v['type'])
                       for v in desired.get('volumes', [])}
    actual_mounts = {v['Destination']: (v['Source'], v['RW'], v['Type']) for v in current.get('Mounts', [])}
    if transition:
        for key in (str(SOCKET), str(CA)):
            expected_mounts.pop(key, None); actual_mounts.pop(key, None)
    require(actual_mounts == expected_mounts, 'live_mount_parity_mismatch')
    host = current['HostConfig']
    host_mounts = {v['Target']: v for v in host.get('Mounts', [])}
    actual_mount_details = {v['Destination']: v for v in current.get('Mounts', [])}
    for mount in desired.get('volumes', []):
        if transition and mount['target'] in {str(SOCKET), str(CA)}: continue
        if mount['type'] == 'bind':
            options = mount.get('bind', {})
            require(set(options) <= {'create_host_path', 'propagation'}, 'unsupported_bind_options')
            actual_options = host_mounts.get(mount['target'], {}).get('BindOptions', {})
            require(actual_options.get('CreateMountpoint', False) == options.get('create_host_path', False)
                    and actual_mount_details[mount['target']].get('Propagation', 'rprivate') ==
                    options.get('propagation', 'rprivate'), 'live_bind_options_parity_mismatch')
    groups, wanted_groups = host.get('GroupAdd') or [], desired.get('group_add', [])
    if transition:
        groups, wanted_groups = [v for v in groups if v != '982'], [v for v in wanted_groups if v != '982']
    require(groups == wanted_groups, 'live_runtime_group_mismatch')
    for field, key, default in (
        ('Privileged', 'privileged', False), ('ReadonlyRootfs', 'read_only', False),
        ('CapAdd', 'cap_add', []), ('CapDrop', 'cap_drop', []), ('SecurityOpt', 'security_opt', []),
        ('PidMode', 'pid', ''), ('IpcMode', 'ipc', 'private'), ('UTSMode', 'uts', ''),
        ('UsernsMode', 'userns_mode', ''), ('Isolation', 'isolation', ''), ('Runtime', 'runtime', 'runc'),
        ('Init', 'init', None), ('Dns', 'dns', []), ('DnsOptions', 'dns_opt', []), ('DnsSearch', 'dns_search', [])):
        require((host.get(field) if host.get(field) is not None else default) == desired.get(key, default),
                'live_host_parity_mismatch')
    require(host_pairs(host.get('ExtraHosts') or []) == host_pairs(desired.get('extra_hosts', {})),
            'live_extra_hosts_parity_mismatch')
    wanted_restart = desired.get('restart', 'no').split(':', 1)
    require(host.get('RestartPolicy', {}).get('Name', 'no') == wanted_restart[0]
            and host.get('RestartPolicy', {}).get('MaximumRetryCount', 0) ==
            (int(wanted_restart[1]) if len(wanted_restart) == 2 else 0), 'live_restart_parity_mismatch')
    for field, key in (('User', 'user'), ('Cmd', 'command'), ('Entrypoint', 'entrypoint'), ('WorkingDir', 'working_dir')):
        actual, expected = current['Config'].get(field), desired.get(key, image_config.get(field))
        if key in {'command', 'entrypoint'} and expected is None:
            expected = image_config.get(field)  # Compose null inherits; []/'' do not.
        if key in {'user', 'working_dir'} and key not in desired and expected in (None, ''):
            require(actual in (None, ''), 'live_command_parity_mismatch')
        else:
            require(actual == expected, 'live_command_parity_mismatch')
    ignored_labels = {'com.cop.runtime.release', 'com.cop.runtime.profile-generation', 'org.opencontainers.image.revision'}
    expected_labels = {**(image_config.get('Labels') or {}), **(desired.get('labels') or {})}
    public_labels = lambda labels: {k: v for k, v in labels.items()
                                    if k not in ignored_labels and not k.startswith('com.docker.compose.')}
    actual_public = public_labels(current['Config'].get('Labels') or {})
    expected_public = public_labels(expected_labels)
    # The single approved derivative carries one image-owned provenance label.
    # Only the stopped, pinned failed candidate may lack it before replacement;
    # post-start live validation compares the complete target labels normally.
    provenance = 'cop.continuity.refresh.base'
    if (transition and current.get('Id') == '1f50bd766d3865933d4ea1fcd5cebc27728185f47798855dc4c716d79e76cc45'
            and current.get('Image') == NODE_METADATA_TO_IMAGE
            and desired.get('image') == REPLACEMENT_IMAGE
            and image_config.get('Labels', {}).get('org.opencontainers.image.revision') == REPLACEMENT_REVISION
            and image_config.get('Labels', {}).get(provenance) == NODE_METADATA_TO_IMAGE
            and provenance not in (desired.get('labels') or {})
            and provenance not in actual_public
            and current.get('State', {}).get('Running') is False
            and current.get('State', {}).get('Restarting') is False
            and current.get('State', {}).get('Pid') == 0):
        expected_public.pop(provenance, None)
    # The reviewed replacement image adds this exact base provenance label.
    # Permit only its image-owned addition/removal during the transition;
    # post-start validation still compares the complete target label strictly.
    if transition and BASE_NAME_LABEL not in (desired.get('labels') or {}):
        approved_change = (
            BASE_NAME_LABEL not in actual_public and expected_public.get(BASE_NAME_LABEL) == APPROVED_BASE_NAME
            or BASE_NAME_LABEL not in expected_public and actual_public.get(BASE_NAME_LABEL) == APPROVED_BASE_NAME)
        if approved_change:
            actual_public.pop(BASE_NAME_LABEL, None)
            expected_public.pop(BASE_NAME_LABEL, None)
    require(actual_public == expected_public,
            'live_label_parity_mismatch')
    # Fixed COP does not use these escape hatches. Refuse an out-of-band setting
    # instead of letting recreation silently remove it.
    for field, default in (('Devices', []), ('DeviceRequests', []), ('Ulimits', []),
                           ('VolumesFrom', []), ('Links', []), ('ContainerIDFile', ''),
                           ('AutoRemove', False), ('PublishAllPorts', False)):
        require((host.get(field) if host.get(field) is not None else default) == default, 'unsupported_live_runtime')


def network_scope(config):
    api = config['services']['cop-api']
    require({config['networks'][key]['name'] for key in api.get('networks', {})} == set(NETWORKS),
            'target_network_scope_changed')


class Docker:
    def __init__(self, source=SOURCE):
        self.source = source

    def run(self, args):
        require(os.environ.get('DOCKER_HOST', 'unix:///var/run/docker.sock') in (
            'unix:///var/run/docker.sock', 'unix:///run/docker.sock')
            and os.environ.get('DOCKER_CONTEXT', 'default') == 'default', 'foreign_docker_host')
        env = {k: v for k, v in os.environ.items() if not k.startswith('COP_API_RUNTIME_')
               and k not in {'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'}}
        # Existing health/storage child scripts also use the local daemon.
        env['DOCKER_HOST'] = 'unix:///var/run/docker.sock'
        if args[0] == 'docker':
            args = ['docker', '--host', 'unix:///var/run/docker.sock', *args[1:]]
        result = subprocess.run(args, capture_output=True, env=env, check=False)
        require(result.returncode == 0, 'runtime_command_failed')  # Never emit stdout/stderr.
        return result.stdout

    def compose(self, directory, profile=None):
        args = ['docker', 'compose', '--project-name', 'cop', '--project-directory', str(self.source),
                '--env-file', str(self.source / '.env')]
        if profile:
            args += ['--env-file', str(profile / 'runtime.env'), '--env-file', str(directory / 'image.env')]
        args += [part for name in FILES for part in ('-f', str(directory / 'compose' / name))]
        if profile:
            args += ['-f', str(directory / 'compose.runtime.yml')]
        return args

    def config(self, directory, profile=None, raw=False):
        args = self.compose(directory, profile) + ['config', '--format', 'json']
        if raw:
            args += ['--no-interpolate', '--no-env-resolution']
        value = json.loads(self.run(args))
        return unresolved_config(value) if raw else normalized_config(value)

    def source_config(self):
        args = ['docker', 'compose', '--project-name', 'cop', '--project-directory', str(self.source),
                '--env-file', str(self.source / '.env')]
        args += [part for name in FILES for part in ('-f', str(self.source / name))]
        return unresolved_config(json.loads(self.run(args + ['config', '--format', 'json', '--no-interpolate', '--no-env-resolution'])))

    def mounts(self, image, fingerprint):
        # UID1000 has no host traversal grant. Root attestation owns parent/path
        # integrity; this fixed offline container checks mounted metadata only.
        require(IMAGE.fullmatch(image) is not None, 'mount_probe_image_unpinned')
        probe = (
            'const fs=require("fs"),crypto=require("crypto");try{'
            'const d=fs.lstatSync("/run/vcode-cop-pgbouncer"),'
            's=fs.lstatSync("/run/vcode-cop-pgbouncer/.s.PGSQL.6432"),'
            'c=fs.lstatSync("/etc/vcode-cop-pgbouncer/postgres-ca.crt");'
            'if(!c.isFile()||c.size>65536)process.exit(1);'
            'const v={contractVersion:"cop-api-runtime-mount-probe-v1",'
            'socketDirectoryApproved:d.isDirectory()&&d.gid===982&&!(d.mode&7),'
            'socketApproved:s.isSocket()&&s.gid===982&&!(s.mode&7),'
            'caApproved:c.isFile()&&!(c.mode&18)&&c.nlink===1&&c.size<=65536,'
            'caSha256:crypto.createHash("sha256").update(fs.readFileSync("/etc/vcode-cop-pgbouncer/postgres-ca.crt")).digest("hex")};'
            'process.stdout.write(JSON.stringify(v));}catch{process.exit(1)}')
        raw = self.run(['docker', 'run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                        '--group-add', '982', '--mount', 'type=bind,src=' + str(SOCKET) + ',dst=' + str(SOCKET) + ',readonly',
                        '--mount', 'type=bind,src=' + str(CA) + ',dst=' + str(CA) + ',readonly',
                        '--entrypoint', 'node', image, '-e', probe])
        require(len(raw) <= 4096, 'mount_probe_invalid')
        value = json.loads(raw)
        require(isinstance(value, dict) and all(type(value.get(k)) is bool for k in
                ('socketDirectoryApproved', 'socketApproved', 'caApproved'))
                and value == {'contractVersion': 'cop-api-runtime-mount-probe-v1',
                         'socketDirectoryApproved': True, 'socketApproved': True,
                         'caApproved': True, 'caSha256': fingerprint}, 'mount_probe_rejected')

    def image(self, image, baseline=False, revision=None):
        inspected = json.loads(self.run(['docker', 'image', 'inspect', image]))[0]
        require(inspected['Id'] == image, 'image_identity_mismatch')
        if baseline:
            return
        require(inspected['Config'].get('Labels', {}).get('org.opencontainers.image.revision') == revision,
                'image_source_revision_mismatch')
        guard = ('const fs=require("fs");const s=fs.readFileSync("/app/apps/cop-api/dist/media-conversion.js","utf8");'
                 'if(!s.includes("verifyConversionStorage")||!s.includes("expectedStorageUuid")||'
                 '!s.includes("expectedDeviceId"))process.exit(1);'
                 'const sharp=require("/app/apps/cop-api/node_modules/sharp");'
                 'sharp({create:{width:1,height:1,channels:3,background:{r:0,g:0,b:0}}}).png().toBuffer()'
                 '.then(b=>{if(!b.length)process.exitCode=1}).catch(()=>{process.exitCode=1})')
        self.run(['docker', 'run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                  '--entrypoint', 'node', image, '-e', guard])

    def peers(self, directory):
        result = {}
        for service in ('cop-web', 'cop-chat', 'cop-edge', 'cop-mcp'):
            result[service] = self.run(self.compose(directory) + ['ps', '-q', service]).decode().strip()
        return result

    def current(self, directory):
        ids = self.run(self.compose(directory) + ['ps', '--all', '-q', 'cop-api']).decode().split()
        require(len(ids) == 1, 'api_container_ambiguous')
        return json.loads(self.run(['docker', 'inspect', ids[0]]))[0]

    def live(self, directory, binding, profile, require_label=True):
        current = self.current(directory)
        require(current['Image'] == binding['imageId'], 'live_image_mismatch')
        values = dict(item.split('=', 1) for item in current['Config'].get('Env', []) if '=' in item)
        presence = binding['legacyEnvPresence']
        if presence is not None:
            require(all((key in values) == included for key, included in presence.items()), 'legacy_presence_mismatch')
        require(all(values.get(key) == value for key, value in profile['values'].items()
                    if presence is None or presence[key]), 'live_profile_mismatch')
        self.non_profile(directory, profile['directory'], current)
        require({key: value['NetworkID'] for key, value in current['NetworkSettings']['Networks'].items()}
                == NETWORKS, 'live_network_mismatch')
        if require_label:
            require(current['Config'].get('Labels', {}).get('com.cop.runtime.release') == binding['releaseId'],
                    'live_binding_mismatch')
            require(current['Config'].get('Labels', {}).get('com.cop.runtime.profile-generation') == binding['profileGeneration'],
                    'live_profile_label_mismatch')
        resolved = self.config(directory, profile['directory']); network_scope(resolved)
        desired = resolved['services']['cop-api']
        image_config = json.loads(self.run(['docker', 'image', 'inspect', binding['imageId']]))[0]['Config']
        runtime_parity(current, desired, image_config)

    def preserve(self, directory, profile, current):
        """Pre-mutation gate: target image/profile may not change other runtime."""
        resolved = self.config(directory, profile); network_scope(resolved)
        desired = resolved['services']['cop-api']
        image_config = json.loads(self.run(['docker', 'image', 'inspect', desired['image']]))[0]['Config']
        self.non_profile(directory, profile, current)
        runtime_parity(current, desired, image_config, transition=True)
        require({key: value['NetworkID'] for key, value in current['NetworkSettings']['Networks'].items()}
                == NETWORKS, 'live_network_mismatch')

    def unchanged(self, directory, witnessed):
        actual = self.current(directory)
        require(all(actual.get(key) == witnessed.get(key) for key in
                ('Id', 'Image', 'Config', 'HostConfig', 'Mounts'))
                and actual['NetworkSettings']['Networks'] == witnessed['NetworkSettings']['Networks'],
                'api_runtime_changed_before_mutation')

    def non_profile(self, directory, profile, current=None):
        current = current or self.current(directory)
        actual = dict(item.split('=', 1) for item in current['Config'].get('Env', []) if '=' in item)
        api = self.config(directory, profile)['services']['cop-api']
        image_config = json.loads(self.run(['docker', 'image', 'inspect', api['image']]))[0]['Config']
        inherited = dict(item.split('=', 1) for item in image_config.get('Env', []) if '=' in item)
        desired = {**inherited, **api.get('environment', {})}
        excluded = set(ENV) | {'COP_DATABASE_POOL_MODE'}
        expected = {key: value for key, value in desired.items() if key not in excluded}
        relevant = {key: value for key, value in actual.items() if key not in excluded}
        scope = getattr(self, 'account_erasure_scope', None)
        if scope is not None and current['Id'] == scope['containerId']:
            changed = {key for key in set(relevant) | set(expected)
                       if (key in relevant) != (key in expected) or relevant.get(key) != expected.get(key)}
            require(changed <= set(scope['changedKeys']), 'non_profile_environment_drift')
        else:
            require(relevant == expected, 'non_profile_environment_drift')

    def erasure_edge_credential(self, directory, target):
        edge_id = self.peers(directory)['cop-edge']
        require(re.fullmatch(r'[0-9a-f]{64}', edge_id), 'erasure_edge_identity_unavailable')
        edge = json.loads(self.run(['docker', 'inspect', edge_id]))[0]
        labels = edge['Config'].get('Labels', {})
        environment = dict(line.split('=', 1) for line in edge['Config'].get('Env', []) if '=' in line)
        require(edge['Id'] == edge_id and edge['State'].get('Running') is True
                and labels.get('com.docker.compose.project') == 'cop'
                and labels.get('com.docker.compose.service') == 'cop-edge'
                and environment.get('COP_EDGE_ADMIN_TOKEN') == target['COP_EDGE_ADMIN_TOKEN']
                and environment.get('COP_EDGE_NODE_ID', 'node_edge_pilot_01') == target['COP_EDGE_NODE_ID'],
                'erasure_existing_edge_credential_changed')
        return edge_id

    def up(self, directory, profile):
        self.run(self.compose(directory, profile) + ['up', '-d', '--no-build', '--pull', 'never', '--no-deps', 'cop-api'])

    def health(self, action, path):
        return self.run(['python3', str(self.source / 'scripts/cop-health-gate.py'), action,
                         *([str(path), '--allow-added-dependency', 'safety-notification-worker',
                            '--allow-added-dependency', 'cop-account-erasure-owners'] if action == 'verify' else [])])


class Store:
    def __init__(self, root=ROOT, source=SOURCE, guard=lambda: None, docker=None,
                 uid=None, protected_uid=0, protected_gid=1000, protected_root=PROFILES,
                 mount_guard=None):
        self.root, self.source, self.guard = root, source, guard
        self.uid = os.geteuid() if uid is None else uid
        self.protected_uid, self.protected_gid, self.protected_root = protected_uid, protected_gid, protected_root
        self.docker = docker or Docker(source)
        self.mount_guard = mount_guard

    def directory(self, path, create=False):
        self.guard()
        require(not any(p.is_symlink() for p in (path, *path.parents)), 'runtime_directory_symlink')
        if create and not path.exists():
            path.mkdir(mode=0o700)
        info = path.stat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == self.uid
                and stat.S_IMODE(info.st_mode) == 0o700, 'runtime_directory_permissions')
        return path

    def write(self, path, raw):
        self.directory(path.parent)
        temporary = path.with_name('.' + path.name + '-' + uuid.uuid4().hex)
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(fd, 'wb') as handle:
                handle.write(raw); handle.flush(); os.fsync(handle.fileno())
            self.guard()
            os.replace(temporary, path)
            self.sync(path.parent)
        finally:
            if temporary.exists():
                temporary.unlink()

    @staticmethod
    def sync(path):
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def protected_directory(self, directory):
        require(not any(p.is_symlink() for p in (directory, *directory.parents)), 'protected_path_symlink')
        info = directory.stat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == self.protected_uid
                and info.st_gid == self.protected_gid and stat.S_IMODE(info.st_mode) == 0o750,
                'protected_directory_permissions')
        return directory

    def profile(self, identifier, contract):
        require(PROFILE_UUID.fullmatch(identifier) is not None, 'profile_generation_invalid')
        driver_contract(contract)
        self.directory(self.root); self.protected_directory(self.protected_root)
        directory = self.protected_directory(self.protected_root / identifier)
        raw = private_read(directory / 'runtime.env', self.protected_uid, 16384,
                           mode=0o640, gid=self.protected_gid)
        values = env_values(raw) | {'COP_DATABASE_POOL_MODE': contract['poolMode']}
        require(values['COP_DATABASE_URL'].startswith(('postgresql://', 'postgres://')), 'profile_route_invalid')
        if contract['poolMode'] == 'transaction':
            require(bool(values['COP_LEASE_DATABASE_URL']), 'profile_session_route_missing')
        return {'profileId': identifier, 'generation': identifier, 'mode': contract['poolMode'],
                'driverContract': contract, 'directory': directory, 'values': values}

    def check_mounts(self, binding, profile):
        if profile['mode'] == 'transaction':
            if self.mount_guard is not None:
                self.mount_guard(profile['driverContract']['caSha256'])
            else:
                self.docker.mounts(binding['imageId'], profile['driverContract']['caSha256'])

    def pointer(self):
        path = self.root / 'active.json'
        if not path.exists():
            require(not path.is_symlink(), 'active_pointer_symlink')
            return None
        value = private_json(path, self.uid)
        require(set(value) == {'contractVersion', 'generation', 'releaseId', 'profileId', 'profileGeneration', 'imageId', 'containerId'}
                and value['contractVersion'] == 'cop-api-runtime-active-v1'
                and GENERATION.fullmatch(value['generation']) and ID.fullmatch(value['releaseId'])
                and IMAGE.fullmatch(value['imageId'])
                and re.fullmatch(r'[0-9a-f]{64}', value['containerId']), 'active_pointer_invalid')
        return value

    def check_cas(self, expected):
        current = self.pointer()
        require((current['generation'] if current else 'absent') == expected, 'active_pointer_changed')
        return current

    def clean(self):
        self.directory(self.root)
        require(not (self.root / 'pending.json').exists() and not (self.root / 'pending.json').is_symlink(),
                'runtime_activation_pending')
        require(not (self.root / 'arrival-reversion-pending.json').exists() and not (self.root / 'arrival-reversion-pending.json').is_symlink(), 'arrival_reversion_pending')

    def attestation(self, path, binding):
        require(path.parent == self.protected_root / binding['profileGeneration']
                and path.name == 'attestation-' + binding['imageId'].removeprefix('sha256:') + '.json',
                'attestation_scope_invalid')
        self.protected_directory(self.protected_root); self.protected_directory(path.parent)
        raw = private_read(path, self.protected_uid, mode=0o640, gid=self.protected_gid)
        value = json.loads(raw)
        keys = {'contractVersion', 'application', 'service', 'profileGeneration', 'imageId',
                'sourceRevision', 'kind', 'ownerAcceptance', 'driverContract', 'checks', 'legacyContainerId', 'legacyEnvPresence'}
        require(isinstance(value, dict) and set(value) == keys
                and value['contractVersion'] == 'cop-api-runtime-attestation-v1'
                and value['application'] == 'cop' and value['service'] == 'cop-api'
                and value['ownerAcceptance'] is True
                and all(value[key] == binding[key] for key in (
                    'imageId', 'sourceRevision', 'profileGeneration', 'kind')), 'attestation_binding_mismatch')
        contract = driver_contract(value['driverContract'])
        if 'driverContract' in binding:
            require(binding['driverContract'] == contract, 'driver_contract_changed')
        require(isinstance(value['checks'], dict) and set(value['checks']) == {
            'x5RuntimeGuard', 'sharpConversion', 'databaseRouting', 'acceptedBaselineRollback'}
            and all(type(item) is bool for item in value['checks'].values()), 'attestation_checks_invalid')
        baseline = binding['kind'] == 'accepted-baseline'
        if baseline:
            require(value['sourceRevision'] is None and contract['poolMode'] == 'direct'
                    and re.fullmatch(r'[0-9a-f]{64}', value['legacyContainerId'])
                    and value['checks']['acceptedBaselineRollback'] is True
                    and isinstance(value['legacyEnvPresence'], dict)
                    and set(value['legacyEnvPresence']) == set(ENV) | {'COP_DATABASE_POOL_MODE'}
                    and all(type(v) is bool for v in value['legacyEnvPresence'].values())
                    and value['legacyEnvPresence']['COP_DATABASE_URL'] is True, 'legacy_witness_invalid')
        else:
            require(value['legacyContainerId'] is None and value['legacyEnvPresence'] is None
                    and value['checks']['acceptedBaselineRollback'] is False
                    and all(value['checks'][key] for key in ('x5RuntimeGuard', 'sharpConversion', 'databaseRouting')),
                    'compatibility_not_accepted')
        return sha(raw), contract, value['legacyContainerId'], value['legacyEnvPresence']

    def erasure_config_proof(self, path, binding, digest=None):
        require(path.parent == self.protected_root / binding['profileGeneration']
                and re.fullmatch(r'account-erasure-[0-9a-f-]{36}\.json', path.name), 'erasure_proof_path')
        self.protected_directory(self.protected_root); self.protected_directory(path.parent)
        raw = private_read(path, self.protected_uid, mode=0o640, gid=self.protected_gid)
        if digest is not None:
            require(sha(raw) == digest, 'erasure_proof_changed')
        value = json.loads(raw)
        clean = is_clean_erasure_proof(value)
        if isinstance(value, dict) and value.get('contractVersion') in {POST_EDGE_VERSION, POST_EDGE_ENABLE_VERSION, POST_EDGE_ENABLE_AUTH_VERSION, CONTINUITY_REPAIR_VERSION, COMMUNICATION_SAFETY_VERSION, ARRIVAL_RELEASE_VERSION, ARRIVAL_REVERSION_VERSION}:
            return self.post_edge_module().read_proof(self.post_edge_runtime(), self, path, raw, binding)
        metadata_v2 = isinstance(value, dict) and value.get('contractVersion') in {NODE_METADATA_PROOF_VERSION, FENCED_SOURCE_PROOF_VERSION}
        replacement_enable = isinstance(value, dict) and value.get('contractVersion') == PENDING_REPLACEMENT_ENABLE_VERSION
        startup_prepare = isinstance(value, dict) and value.get('contractVersion') == STARTUP_REPAIR_VERSION
        startup_enable = isinstance(value, dict) and value.get('contractVersion') == STARTUP_REPAIR_ENABLE_VERSION
        index_prepare = isinstance(value, dict) and value.get('contractVersion') == INDEX_BOUNDARY_REPAIR_VERSION
        index_enable = isinstance(value, dict) and value.get('contractVersion') == INDEX_BOUNDARY_REPAIR_ENABLE_VERSION
        provider_prepare = isinstance(value, dict) and value.get('contractVersion') == PROVIDER_BOUNDARY_REPAIR_VERSION
        provider_enable = isinstance(value, dict) and value.get('contractVersion') == PROVIDER_BOUNDARY_REPAIR_ENABLE_VERSION
        owner_prepare = isinstance(value, dict) and value.get('contractVersion') == OWNER_READINESS_REPAIR_VERSION
        owner_enable = isinstance(value, dict) and value.get('contractVersion') == OWNER_READINESS_REPAIR_ENABLE_VERSION
        flight_prepare = isinstance(value, dict) and value.get('contractVersion') == PUBLIC_FLIGHT_REPAIR_VERSION
        flight_enable = isinstance(value, dict) and value.get('contractVersion') == PUBLIC_FLIGHT_REPAIR_ENABLE_VERSION
        continuation_prepare = isinstance(value, dict) and value.get('contractVersion') == PREPARED_CONTINUATION_VERSION
        continuation_enable = isinstance(value, dict) and value.get('contractVersion') == PREPARED_CONTINUATION_ENABLE_VERSION
        fields = {'contractVersion', 'transitionId', 'operation', 'previous', 'target', 'changedKeys',
                  'environmentMetadata', 'composeHashes', 'ownerAcceptance', 'checks'} | ({'cleanReset'} if clean else set()) | ({'imageMetadataTransition'} if metadata_v2 else set()) | ({'fencedSourceReadiness', 'existingActorIntroduction'} if value.get('contractVersion') == FENCED_SOURCE_PROOF_VERSION else set()) | ({'pendingTargetReplacement'} if value.get('contractVersion') == PENDING_REPLACEMENT_VERSION else set()) | ({'pendingTargetReplacementEnable'} if replacement_enable else set()) | ({'boundedStartupRepair'} if startup_prepare else set()) | ({'boundedStartupRepairEnable'} if startup_enable else set()) | ({'indexBoundaryRepair'} if index_prepare else set()) | ({'indexBoundaryRepairEnable'} if index_enable else set()) | ({'providerBoundaryRepair'} if provider_prepare else set()) | ({'providerBoundaryRepairEnable'} if provider_enable else set()) | ({'ownerReadinessRepair'} if owner_prepare else set()) | ({'ownerReadinessRepairEnable'} if owner_enable else set()) | ({'publicFlightRepair', 'publicFlightPolicy'} if flight_prepare else set()) | ({'publicFlightRepairEnable', 'publicFlightPolicy'} if flight_enable else set()) | ({'preparedTargetContinuation', 'publicFlightPolicy'} if continuation_prepare else set()) | ({'preparedTargetContinuationEnable', 'publicFlightPolicy'} if continuation_enable else set())
        require(isinstance(value, dict) and set(value) == fields
                and value['contractVersion'] in {'cop-api-account-erasure-config-v1', CLEAN_ERASURE_PROOF_VERSION, NODE_METADATA_PROOF_VERSION, FENCED_SOURCE_PROOF_VERSION, PENDING_REPLACEMENT_VERSION, PENDING_REPLACEMENT_ENABLE_VERSION, STARTUP_REPAIR_VERSION, STARTUP_REPAIR_ENABLE_VERSION, INDEX_BOUNDARY_REPAIR_VERSION, INDEX_BOUNDARY_REPAIR_ENABLE_VERSION, PROVIDER_BOUNDARY_REPAIR_VERSION, PROVIDER_BOUNDARY_REPAIR_ENABLE_VERSION, OWNER_READINESS_REPAIR_VERSION, OWNER_READINESS_REPAIR_ENABLE_VERSION, PUBLIC_FLIGHT_REPAIR_VERSION, PUBLIC_FLIGHT_REPAIR_ENABLE_VERSION, PREPARED_CONTINUATION_VERSION, PREPARED_CONTINUATION_ENABLE_VERSION}
                and isinstance(value['transitionId'], str) and PROFILE_UUID.fullmatch(value['transitionId'])
                and path.name == 'account-erasure-' + value['transitionId'] + '.json'
                and value['operation'] in {'prepare', 'enable', 'pause', 'maintain'}
                and value['ownerAcceptance'] is True, 'erasure_proof_schema')
        if clean:
            reset = value['cleanReset']
            require(isinstance(reset, dict) and set(reset) == {'resetEpoch', 'tokensNotBefore', 'receiptSha256'}
                    and isinstance(reset['resetEpoch'], str) and PROFILE_UUID.fullmatch(reset['resetEpoch'])
                    and type(reset['tokensNotBefore']) is int and reset['tokensNotBefore'] > 0
                    and isinstance(reset['receiptSha256'], str) and re.fullmatch(r'[0-9a-f]{64}', reset['receiptSha256']),
                    'clean_erasure_reset_proof')
        require(isinstance(value['target'], dict) and set(value['target']) ==
                {'imageId', 'sourceRevision', 'profileGeneration'}
                and all(value['target'][key] == binding[key] for key in value['target']), 'erasure_proof_target')
        previous = value['previous']
        require(isinstance(previous, dict) and set(previous) == {'contractVersion', 'generation', 'releaseId',
                'profileId', 'profileGeneration', 'imageId', 'containerId'}
                and previous['contractVersion'] == 'cop-api-runtime-active-v1'
                and isinstance(previous['generation'], str) and GENERATION.fullmatch(previous['generation'])
                and isinstance(previous['containerId'], str) and re.fullmatch(r'[0-9a-f]{64}', previous['containerId'])
                and previous['profileGeneration'] == binding['profileGeneration']
                and previous['profileId'] == binding['profileId']
                and previous['releaseId'] == binding['previousReleaseId'], 'erasure_proof_previous')
        keys = value['changedKeys']
        if value.get('contractVersion') == PENDING_REPLACEMENT_VERSION:
            pending_replacement_schema(value)
        if replacement_enable:
            pending_replacement_enable_schema(value)
        if startup_prepare:
            startup_repair_schema(value)
        if startup_enable:
            startup_repair_enable_schema(value)
        if index_prepare:
            index_boundary_repair_schema(value)
        if index_enable:
            index_boundary_repair_enable_schema(value)
        if provider_prepare:
            provider_boundary_repair_schema(value)
        if provider_enable:
            provider_boundary_repair_enable_schema(value)
        if owner_prepare:
            owner_readiness_repair_schema(value)
        if owner_enable:
            owner_readiness_repair_enable_schema(value)
        if flight_prepare:
            public_flight_repair_schema(value)
        if flight_enable:
            public_flight_repair_enable_schema(value)
        if continuation_prepare:
            prepared_continuation_schema(value)
        if continuation_enable:
            prepared_continuation_enable_schema(value)
        if metadata_v2:
            node_metadata_transition(value)
            if value.get('contractVersion') == FENCED_SOURCE_PROOF_VERSION:
                fenced_source_witness_schema(value)
        else:
            require(isinstance(keys, list) and all(isinstance(k, str) for k in keys)
                    and keys == sorted(set(keys)) and set(keys) <= (CLEAN_ERASURE_CONFIG_KEYS if clean else ERASURE_CONFIG_KEYS), 'erasure_proof_keys')
        require(isinstance(value['composeHashes'], dict) and set(value['composeHashes']) == set(FILES)
                and all(isinstance(v, str) and re.fullmatch(r'[0-9a-f]{64}', v) for v in value['composeHashes'].values()),
                'erasure_proof_compose_scope')
        if 'composeHashes' in binding:
            require(value['composeHashes'] == binding['composeHashes'], 'erasure_proof_compose_changed')
        metadata = value['environmentMetadata']
        require(isinstance(metadata, dict) and set(metadata) == {'device', 'inode', 'size', 'mtimeNs', 'ctimeNs'}
                and all(type(v) is int and v >= 0 for v in metadata.values()), 'erasure_proof_environment_metadata')
        required_checks = (PREPARED_CONTINUATION_CHECKS if continuation_prepare else PREPARED_CONTINUATION_ENABLE_CHECKS if continuation_enable
                           else PUBLIC_FLIGHT_REPAIR_PREPARE_CHECKS if flight_prepare else PUBLIC_FLIGHT_REPAIR_ENABLE_CHECKS if flight_enable
                           else OWNER_READINESS_REPAIR_PREPARE_CHECKS if owner_prepare else OWNER_READINESS_REPAIR_ENABLE_CHECKS if owner_enable
                           else PROVIDER_BOUNDARY_REPAIR_PREPARE_CHECKS if provider_prepare else PROVIDER_BOUNDARY_REPAIR_ENABLE_CHECKS if provider_enable
                           else INDEX_BOUNDARY_REPAIR_PREPARE_CHECKS if index_prepare else INDEX_BOUNDARY_REPAIR_ENABLE_CHECKS if index_enable
                           else STARTUP_REPAIR_PREPARE_CHECKS if startup_prepare else STARTUP_REPAIR_ENABLE_CHECKS if startup_enable
                           else REPLACEMENT_PREPARE_CHECKS if value['contractVersion'] == PENDING_REPLACEMENT_VERSION
                           else REPLACEMENT_ENABLE_CHECKS if replacement_enable
                           else CLEAN_ERASURE_PROOF_CHECKS if clean else ERASURE_PROOF_CHECKS)
        require(isinstance(value['checks'], dict) and set(value['checks']) == required_checks
                and all(v is True for v in value['checks'].values()), 'erasure_proof_acceptance_missing')
        if flight_prepare or flight_enable:
            self.public_flight_evidence(value, fresh=False)
        if continuation_prepare or continuation_enable:
            self.prepared_continuation_evidence(value, binding, fresh=False)
        return sha(raw), value

    def assert_erasure_environment(self, binding):
        reference = binding.get('accountErasureConfig')
        if reference is None:
            return
        _, proof = self.erasure_config_proof(Path(reference['path']), binding, reference['sha256'])
        require(not (ERASURE_CONFIG_KEYS & set(os.environ)), 'erasure_shell_override_forbidden')
        if proof['contractVersion'] in {COMMUNICATION_SAFETY_VERSION, ARRIVAL_RELEASE_VERSION, ARRIVAL_REVERSION_VERSION}:
            require(not (self.post_edge_module().KEYS & set(os.environ)), 'safety_shell_override_forbidden')
        if proof['contractVersion'] in {POST_EDGE_ENABLE_AUTH_VERSION, CONTINUITY_REPAIR_VERSION, COMMUNICATION_SAFETY_VERSION, ARRIVAL_RELEASE_VERSION, ARRIVAL_REVERSION_VERSION}:
            require(not (POST_EDGE_AUTH_KEYS & set(os.environ)), 'erasure_auth_shell_override_forbidden')
        require(environment_metadata(self.source / '.env', self.uid) == proof['environmentMetadata'], 'erasure_env_cas_changed')
        scope = getattr(self.docker, 'account_erasure_scope', None)
        if scope is not None and scope.get('edgeContainerId') is not None:
            require(self.docker.peers(self.root / 'releases' / binding['releaseId'])['cop-edge'] == scope['edgeContainerId'],
                    'erasure_edge_peer_changed')

    @contextmanager
    def erasure_configuration_scope(self, directory, binding, profile, previous, owned_target=False):
        reference = binding.get('accountErasureConfig')
        if reference is None:
            yield
            return
        _, proof = self.erasure_config_proof(Path(reference['path']), binding, reference['sha256'])
        require(proof['contractVersion'] not in {PENDING_REPLACEMENT_VERSION, STARTUP_REPAIR_VERSION, INDEX_BOUNDARY_REPAIR_VERSION, PROVIDER_BOUNDARY_REPAIR_VERSION, OWNER_READINESS_REPAIR_VERSION, PUBLIC_FLIGHT_REPAIR_VERSION, PREPARED_CONTINUATION_VERSION, POST_EDGE_VERSION},
                'pending_replacement_requires_dedicated_transition')
        require(proof['previous'] == previous, 'erasure_previous_cas_changed')
        self.assert_erasure_environment(binding)
        current = self.docker.current(directory)
        api = self.docker.config(directory, profile['directory'])['services']['cop-api']
        image_config = json.loads(self.docker.run(['docker', 'image', 'inspect', binding['imageId']]))[0]['Config']
        target = dict(line.split('=', 1) for line in image_config.get('Env', []) if '=' in line)
        target.update(api.get('environment', {}))
        if proof.get('contractVersion') == FENCED_SOURCE_PROOF_VERSION:
            require(target.get(EXISTING_ACTOR_KEY) == existing_actor_from_dotenv(
                private_read(self.source / '.env', self.uid, 1048576)), 'existing_actor_target_mismatch')
        erasure_target_environment(target, proof['operation'],
            proof.get('cleanReset') if is_clean_erasure_proof(proof) else None)
        if proof.get('contractVersion') in {NODE_METADATA_PROOF_VERSION, FENCED_SOURCE_PROOF_VERSION}:
            records = json.loads(self.docker.run(['docker', 'image', 'inspect',
                NODE_METADATA_FROM_IMAGE, NODE_METADATA_TO_IMAGE]))
            require(isinstance(records, list) and len(records) == 2, 'node_metadata_image_inventory')
            validate_node_metadata_images(proof, records[0], records[1],
                compose_environment=api.get('environment', {}),
                dotenv_raw=private_read(self.source / '.env', self.uid, 1048576),
                profile_environment=profile['values'])
        if owned_target and current['Image'] == binding['imageId'] and current['Config'].get('Labels', {}).get(
                'com.cop.runtime.release') == binding['releaseId']:
            yield  # Normal pending recovery still requires its exact saved CID and complete target parity.
            return
        require(current['Id'] == previous['containerId'], 'erasure_source_container_changed')
        actual = dict(line.split('=', 1) for line in current['Config'].get('Env', []) if '=' in line)
        erasure_environment_changes(actual, target, proof)
        edge_id = self.docker.erasure_edge_credential(directory, target) if proof['operation'] == 'prepare' else None
        require(getattr(self.docker, 'account_erasure_scope', None) is None, 'erasure_scope_nested')
        self.docker.account_erasure_scope = {'containerId': current['Id'], 'changedKeys': proof['changedKeys'],
                                            'edgeContainerId': edge_id}
        try:
            yield
            self.assert_erasure_environment(binding)
        finally:
            self.docker.account_erasure_scope = None

    def binding(self, identifier, probe_mounts=True):
        require(ID.fullmatch(identifier) is not None, 'release_id_invalid')
        directory = self.directory(self.root / 'releases' / identifier)
        binding = private_json(directory / 'release.json', self.uid)
        release_keys = {'contractVersion', 'releaseId', 'imageId', 'sourceRevision', 'profileId',
                'profileGeneration', 'kind', 'attestationPath', 'previousReleaseId', 'attestationSha256',
                'driverContract', 'legacyContainerId', 'legacyEnvPresence', 'legacyEnvironment', 'composeHashes',
                'acceptedHealthSha256'}
        require(set(binding) in (release_keys, release_keys | {'accountErasureConfig'}), 'release_schema_invalid')
        if 'accountErasureConfig' in binding:
            reference = binding['accountErasureConfig']
            require(isinstance(reference, dict) and set(reference) in ({'path', 'sha256'}, {'path', 'sha256', 'cleanScope'},
                    {'path', 'sha256', 'cleanScope', 'authScope'})
                    and reference.get('cleanScope', 'cop_sim_shared_identity_v1') == 'cop_sim_shared_identity_v1'
                    and isinstance(reference['path'], str) and isinstance(reference['sha256'], str)
                    and re.fullmatch(r'[0-9a-f]{64}', reference['sha256']), 'erasure_reference_invalid')
            _, config_proof = self.erasure_config_proof(Path(reference['path']), binding, reference['sha256'])
            require(('cleanScope' in reference) == is_clean_erasure_proof(config_proof), 'erasure_reference_scope')
            require(('authScope' in reference) == (config_proof['contractVersion'] in {POST_EDGE_ENABLE_AUTH_VERSION, CONTINUITY_REPAIR_VERSION, COMMUNICATION_SAFETY_VERSION, ARRIVAL_RELEASE_VERSION, ARRIVAL_REVERSION_VERSION})
                    and reference.get('authScope', POST_EDGE_AUTH_SCOPE) == POST_EDGE_AUTH_SCOPE,
                    'erasure_auth_reference_scope')
        require(set(binding['composeHashes']) == set(FILES), 'release_compose_scope')
        require(binding.get('contractVersion') == 'cop-api-runtime-release-v1'
                and binding.get('releaseId') == identifier and IMAGE.fullmatch(binding.get('imageId', ''))
                and (binding.get('sourceRevision') is None if binding.get('kind') == 'accepted-baseline'
                     else REVISION.fullmatch(binding.get('sourceRevision', '')))
                and binding.get('kind') in {'candidate', 'accepted-baseline'}, 'release_binding_invalid')
        profile = self.profile(binding['profileId'], binding['driverContract'])
        require(binding['profileGeneration'] == profile['generation'], 'profile_generation_changed')
        attestation_sha, _, witness, presence = self.attestation(Path(binding['attestationPath']), binding)
        require(binding['legacyEnvPresence'] == presence, 'legacy_presence_changed')
        require(binding['legacyContainerId'] == witness, 'legacy_witness_changed')
        require(binding['attestationSha256'] == attestation_sha,
                'attestation_changed')
        if probe_mounts:
            self.check_mounts(binding, profile)
        self.directory(directory / 'compose')
        for name in FILES:
            require(sha(private_read(directory / 'compose' / name, self.uid)) == binding['composeHashes'][name],
                    'release_compose_changed')
        require(private_read(directory / 'compose.runtime.yml', self.uid) == overlay_bytes(binding, profile['mode']),
                'runtime_overlay_changed')
        require(private_read(directory / 'image.env', self.uid) == self.image_env(binding, profile['mode']),
                'runtime_image_file_changed')
        if binding['acceptedHealthSha256'] is not None:
            self.accepted_health(directory, binding)
        return directory, binding, profile

    def active(self, probe_mounts=True):
        self.clean()
        pointer = self.pointer()
        require(pointer is not None, 'active_runtime_profile_missing')
        directory, binding, profile = self.binding(pointer['releaseId'], probe_mounts=probe_mounts)
        require(all(pointer[key] == binding[key] for key in ('profileId', 'profileGeneration', 'imageId')),
                'active_pair_mismatch')
        if profile['mode'] == 'direct':
            self.accepted_health(directory, binding)
        return pointer, directory, binding, profile

    def clean_runtime_values(self, binding, config):
        reference = binding.get('accountErasureConfig', {})
        if reference.get('cleanScope') != 'cop_sim_shared_identity_v1':
            return None
        _, proof = self.erasure_config_proof(Path(reference['path']), binding, reference['sha256'])
        values = config['services']['cop-api']['environment']
        erasure_target_environment(values, proof['operation'], proof['cleanReset'])
        keys = CLEAN_ERASURE_CONFIG_KEYS | (POST_EDGE_AUTH_KEYS if proof['contractVersion'] in {POST_EDGE_ENABLE_AUTH_VERSION, CONTINUITY_REPAIR_VERSION, COMMUNICATION_SAFETY_VERSION, ARRIVAL_RELEASE_VERSION, ARRIVAL_REVERSION_VERSION} else set())
        require(keys <= set(values), 'clean_overlay_missing')
        if proof['contractVersion'] in {POST_EDGE_ENABLE_AUTH_VERSION, CONTINUITY_REPAIR_VERSION, COMMUNICATION_SAFETY_VERSION, ARRIVAL_RELEASE_VERSION, ARRIVAL_REVERSION_VERSION}:
            require(values['COP_AUTH_MODE'] == 'oidc' and values['COP_ALLOW_LAB_TOKEN'] == 'false', 'clean_oidc_values')
            if proof['contractVersion'] == CONTINUITY_REPAIR_VERSION:
                require(values.get('COP_ACCOUNT_ERASURE_ENABLED') == 'true', 'continuity_repair_intake_changed')
        return {key: values[key] for key in keys}

    def prepare(self, image, revision, attestation, expected, profile_id=None, baseline=False, erasure_config=None):
        self.clean(); pointer = self.check_cas(expected)
        require(IMAGE.fullmatch(image) and (revision is None if baseline else isinstance(revision, str)
                and REVISION.fullmatch(revision)), 'candidate_identity_invalid')
        if profile_id is None:
            require(pointer is not None, 'active_runtime_profile_missing')
            self.active(); profile_id = pointer['profileId']
        require(PROFILE_UUID.fullmatch(profile_id) and (not baseline or pointer is None), 'profile_scope_invalid')
        binding = {'contractVersion': 'cop-api-runtime-release-v1', 'releaseId': 'release-' + uuid.uuid4().hex,
                   'imageId': image, 'sourceRevision': revision, 'profileId': profile_id,
                   'profileGeneration': profile_id,
                   'kind': 'accepted-baseline' if baseline else 'candidate',
                   'attestationPath': str(attestation), 'previousReleaseId': pointer['releaseId'] if pointer else None}
        receipt_sha, contract, witness, presence = self.attestation(attestation, binding)
        profile = self.profile(profile_id, contract)
        if pointer and profile_id == pointer['profileId']:
            _, _, active_binding, _ = self.active()
            require(active_binding['driverContract'] == contract, 'active_profile_contract_changed')
        binding.update(attestationSha256=receipt_sha, driverContract=contract, legacyContainerId=witness,
                       legacyEnvPresence=presence, legacyEnvironment=None, acceptedHealthSha256=None)
        if pointer:
            old_binding = self.active()[2]
            require(not old_binding.get('accountErasureConfig') or erasure_config is not None,
                    'guarded_release_requires_root_config_review')
        if erasure_config is not None:
            require(pointer is not None and not baseline, 'erasure_candidate_required')
            digest, proof = self.erasure_config_proof(Path(erasure_config), binding)
            require(proof['contractVersion'] not in {PENDING_REPLACEMENT_VERSION, STARTUP_REPAIR_VERSION, INDEX_BOUNDARY_REPAIR_VERSION, PROVIDER_BOUNDARY_REPAIR_VERSION, OWNER_READINESS_REPAIR_VERSION, PUBLIC_FLIGHT_REPAIR_VERSION, PREPARED_CONTINUATION_VERSION, POST_EDGE_VERSION},
                    'pending_replacement_requires_dedicated_transition')
            require(proof['previous'] == pointer, 'erasure_previous_cas_changed')
            require(environment_metadata(self.source / '.env', self.uid) == proof['environmentMetadata'], 'erasure_env_cas_changed')
            binding['accountErasureConfig'] = {'path': str(erasure_config), 'sha256': digest}
            if is_clean_erasure_proof(proof):
                binding['accountErasureConfig']['cleanScope'] = 'cop_sim_shared_identity_v1'
            if proof['contractVersion'] in {POST_EDGE_ENABLE_AUTH_VERSION, CONTINUITY_REPAIR_VERSION, COMMUNICATION_SAFETY_VERSION, ARRIVAL_RELEASE_VERSION, ARRIVAL_REVERSION_VERSION}:
                binding['accountErasureConfig']['authScope'] = POST_EDGE_AUTH_SCOPE
            self.assert_erasure_environment(binding)
        self.docker.image(image, baseline=baseline, revision=revision)
        self.check_mounts(binding, profile)
        # Validate unresolved source in RAM before any release artifact is
        # written. Invalid inline secrets must not survive in a failed release.
        sources = {}
        for name in FILES:
            path = self.source / name
            require(not path.is_symlink() and path.is_file(), 'approved_compose_missing')
            sources[name] = path.read_bytes()
            require(len(sources[name]) <= 65536, 'approved_compose_too_large')
        if 'accountErasureConfig' in binding:
            _, reviewed = self.erasure_config_proof(Path(binding['accountErasureConfig']['path']), binding,
                                                   binding['accountErasureConfig']['sha256'])
            require({name: sha(raw) for name, raw in sources.items()} == reviewed['composeHashes'],
                    'erasure_proof_compose_changed')
        raw_config = self.docker.source_config()
        require(all((self.source / name).read_bytes() == raw for name, raw in sources.items()), 'compose_source_changed')
        for service in raw_config['services'].values():
            for key, value in service.get('environment', {}).items():
                if re.search(r'(TOKEN|SECRET|PASSWORD|API_KEY|DATABASE_URL)$', key):
                    require(not value or str(value).startswith('${'), 'inline_secret_in_compose')
        releases = self.directory(self.root / 'releases', create=True)
        directory = self.directory(releases / binding['releaseId'], create=True)
        compose = self.directory(directory / 'compose', create=True)
        binding['composeHashes'] = {}
        for name, raw in sources.items():
            self.write(compose / name, raw); binding['composeHashes'][name] = sha(raw)
        if baseline:
            raw_env = dict(raw_config['services']['cop-api'].get('environment', {}))
            for key, included in presence.items():
                if not included:
                    raw_env.pop(key, None)
                else:
                    variable = ENV[key] if key in ENV else MODE_ENV
                    raw_env[key] = '${' + variable + '?Legacy runtime value is required}'
            binding['legacyEnvironment'] = raw_env
        self.write(directory / 'compose.runtime.yml', overlay_bytes(binding, profile['mode']))
        self.write(directory / 'image.env', self.image_env(binding, profile['mode']))
        verify_api_diff(self.docker.config(directory), self.docker.config(directory, profile['directory']),
                        profile['values'], profile['mode'], image, presence,
                        self.clean_runtime_values(binding, self.docker.config(directory, profile['directory'])),
                        auth_scope=binding.get('accountErasureConfig', {}).get('authScope') == POST_EDGE_AUTH_SCOPE)
        self.write(directory / 'release.json', encoded(binding))
        self.check_cas(expected)
        return binding

    @staticmethod
    def image_env(binding, mode):
        return ("COP_API_RUNTIME_IMAGE_ID='" + binding['imageId'] + "'\n" + MODE_ENV + "='" + mode + "'\n").encode()

    def commit_pointer(self, binding, expected, container_id):
        self.check_cas(expected)
        pointer = {'contractVersion': 'cop-api-runtime-active-v1', 'generation': uuid.uuid4().hex,
                   'containerId': container_id,
                   **{key: binding[key] for key in ('releaseId', 'profileId', 'profileGeneration', 'imageId')}}
        self.write(self.root / 'active.json', encoded(pointer))
        return pointer

    def accepted_ancestor(self, binding, release, probe_mounts=True):
        ancestor = binding['previousReleaseId']
        for _ in range(128):
            if ancestor == release:
                return True
            if ancestor is None:
                break
            ancestor = self.binding(ancestor, probe_mounts=probe_mounts)[1]['previousReleaseId']
        return False

    def accepted_health(self, directory, binding):
        digest = binding['acceptedHealthSha256']
        require(binding['driverContract']['poolMode'] == 'direct' and isinstance(digest, str)
                and re.fullmatch(r'[0-9a-f]{64}', digest), 'accepted_health_witness_missing')
        raw = private_read(directory / 'accepted-health.json', self.uid)
        require(sha(raw) == digest, 'accepted_health_witness_changed')
        value = json.loads(raw)
        scope = ('releaseId', 'imageId', 'sourceRevision', 'profileId', 'profileGeneration')
        require(set(value) == {'contractVersion', 'containerId', 'acceptedAtUtc', 'statuses', *scope}
                and value['contractVersion'] == 'cop-api-runtime-health-witness-v1'
                and all(value[key] == binding[key] for key in scope)
                and re.fullmatch(r'[0-9a-f]{64}', value['containerId'])
                and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', value['acceptedAtUtc']),
                'accepted_health_witness_scope_changed')
        return encoded(health_statuses(value['statuses']))

    def post_edge_runtime(self):
        import types
        return types.SimpleNamespace(**globals())

    def post_edge_module(self):
        import types
        path = self.protected_root / '206c4507-5e00-458e-b0ee-4061309aa7a8' / ('post-edge-promotion-helper-' + POST_EDGE_HELPER_SHA256 + '.py')
        self.protected_directory(path.parent)
        raw = private_read(path, 0, mode=0o640, gid=1000)
        require(sha(raw) == POST_EDGE_HELPER_SHA256, 'post_edge_operator_source_changed')
        module = types.ModuleType('closed_post_edge_promotion')
        exec(compile(raw, str(path), 'exec'), module.__dict__)
        return module

    def prepared_continuation_basis(self, proof, binding):
        prepared = proof
        if proof['contractVersion'] == PREPARED_CONTINUATION_ENABLE_VERSION:
            w = prepared_continuation_enable_schema(proof)
            path = Path(w['acceptedContinuationProofPath'])
            raw = private_read(path, 0, mode=0o640, gid=1000)
            require(sha(raw) == w['acceptedContinuationProofSha256'], 'prepared_continuation_prepare_changed')
            prepared = json.loads(raw)
            require(prepared.get('contractVersion') == PREPARED_CONTINUATION_VERSION,
                    'prepared_continuation_prepare_contract')
            self.erasure_config_proof(path, {**binding, 'previousReleaseId': prepared['previous']['releaseId']}, sha(raw))
            require(proof['cleanReset'] == prepared['cleanReset']
                    and w['authorizationRecordSha256'] == prepared['preparedTargetContinuation']['authorizationRecordSha256'],
                    'prepared_continuation_enable_history')
        basis = prepared_continuation_schema(prepared)
        path = Path(basis['originalProofPath'])
        _, original = self.erasure_config_proof(path, {**binding, 'previousReleaseId': prepared['previous']['releaseId']},
                                                basis['originalProofSha256'])
        require(original['contractVersion'] == PUBLIC_FLIGHT_REPAIR_VERSION
                and original['transitionId'] == 'ada81c52-8e1a-46c0-8b42-5b7a05e8390f'
                and original['publicFlightPolicy']['sha256'] == basis['originalExternalReceiptSha256']
                and all(prepared[key] == original[key] for key in
                    ('previous', 'target', 'changedKeys', 'environmentMetadata', 'composeHashes', 'cleanReset')),
                'prepared_continuation_original_history_changed')
        return basis

    def prepared_continuation_evidence(self, proof, binding, fresh=False):
        ref = prepared_continuation_ref(proof)
        self.protected_directory(self.protected_root); self.protected_directory(Path(ref['path']).parent)
        raw = private_read(Path(ref['path']), 0, mode=0o640, gid=1000)
        require(sha(raw) == ref['sha256'], 'prepared_continuation_observation_changed')
        basis = self.prepared_continuation_basis(proof, binding)
        return prepared_target_observation_schema(json.loads(raw), proof, basis, fresh)

    def prepared_continuation_verified_health(self, binding, verified):
        reference = binding['accountErasureConfig']
        _, proof = self.erasure_config_proof(Path(reference['path']), binding, reference['sha256'])
        if proof['contractVersion'] in {POST_EDGE_VERSION, POST_EDGE_ENABLE_VERSION, POST_EDGE_ENABLE_AUTH_VERSION, CONTINUITY_REPAIR_VERSION, COMMUNICATION_SAFETY_VERSION, ARRIVAL_RELEASE_VERSION, ARRIVAL_REVERSION_VERSION}:
            return self.post_edge_module().validate_health(self.post_edge_runtime(), self, binding, verified)
        require(proof['contractVersion'] in {PREPARED_CONTINUATION_VERSION, PREPARED_CONTINUATION_ENABLE_VERSION},
                'prepared_continuation_health_contract')
        evidence = self.prepared_continuation_evidence(proof, binding, fresh=True)
        public_flight_auth_boundary()
        value = json.loads(verified)
        require(isinstance(value, dict) and set(value) == {'contractVersion', 'criticalHealthAndDemoPreserved',
                'publicFlightStatus', 'externalEvidenceSha256', 'operationId', 'baselineSha256', 'statuses',
                'unauthorizedRequestsRejected', 'authorityProofSha256'}
                and value['contractVersion'] == 'cop-critical-health-prepared-continuation-v1'
                and value['criticalHealthAndDemoPreserved'] is True and value['unauthorizedRequestsRejected'] is True
                and value['authorityProofSha256'] == reference['sha256']
                and value['externalEvidenceSha256'] == proof['publicFlightPolicy']['sha256']
                and value['operationId'] == proof['transitionId']
                and value['baselineSha256'] == '0d80ff6b78f046ddfcb5ca4b8865ae72aabcc0c8c7f5d76daa9b7cf46d0d7ef2',
                'prepared_continuation_health_result')
        baseline_raw = private_read(CLEAN_RESET_DIRECTORY / 'pre-stop-health.json', 0, mode=0o640, gid=1000)
        require(sha(baseline_raw) == value['baselineSha256'], 'prepared_continuation_original_baseline_changed')
        status = public_flight_health_comparison(json.loads(baseline_raw)['statuses'], value['statuses'])
        require(value['publicFlightStatus'] == status
                and (evidence['observation']['httpStatus'] == 502 or status == 'ok'),
                'prepared_continuation_recovered_feed_not_ok')
        return value

    def public_flight_evidence(self, proof, fresh=False):
        ref = public_flight_policy_ref(proof)
        path = Path(ref['path'])
        self.protected_directory(self.protected_root); self.protected_directory(path.parent)
        raw = private_read(path, self.protected_uid, mode=0o640, gid=self.protected_gid)
        require(sha(raw) == ref['sha256'], 'public_flight_evidence_changed')
        return public_flight_evidence_schema(json.loads(raw), ref, proof, fresh)

    def public_flight_verified_health(self, binding, verified):
        reference = binding.get('accountErasureConfig')
        require(reference is not None, 'public_flight_health_proof_missing')
        _, proof = self.erasure_config_proof(Path(reference['path']), binding, reference['sha256'])
        if proof['contractVersion'] in {POST_EDGE_VERSION, POST_EDGE_ENABLE_VERSION, POST_EDGE_ENABLE_AUTH_VERSION, CONTINUITY_REPAIR_VERSION, COMMUNICATION_SAFETY_VERSION, ARRIVAL_RELEASE_VERSION, ARRIVAL_REVERSION_VERSION}:
            return self.post_edge_module().validate_health(self.post_edge_runtime(), self, binding, verified)
        if proof['contractVersion'] in {PREPARED_CONTINUATION_VERSION, PREPARED_CONTINUATION_ENABLE_VERSION}:
            return self.prepared_continuation_verified_health(binding, verified)
        require(proof['contractVersion'] in {PUBLIC_FLIGHT_REPAIR_VERSION, PUBLIC_FLIGHT_REPAIR_ENABLE_VERSION, PREPARED_CONTINUATION_VERSION, PREPARED_CONTINUATION_ENABLE_VERSION},
                'public_flight_health_contract')
        evidence = self.public_flight_evidence(proof, fresh=True)
        public_flight_auth_boundary()
        value = json.loads(verified)
        require(isinstance(value, dict) and set(value) == {'contractVersion', 'criticalHealthAndDemoPreserved',
                'publicFlightStatus', 'externalEvidenceSha256', 'operationId', 'baselineSha256', 'statuses', 'unauthorizedRequestsRejected'}
                and value['contractVersion'] == 'cop-critical-health-public-flight-v1'
                and value['criticalHealthAndDemoPreserved'] is True
                and value['unauthorizedRequestsRejected'] is True
                and value['externalEvidenceSha256'] == proof['publicFlightPolicy']['sha256']
                and value['operationId'] == proof['transitionId']
                and value['baselineSha256'] == evidence['historicalBaselineSha256'], 'public_flight_health_result')
        baseline_raw = private_read(CLEAN_RESET_DIRECTORY / 'pre-stop-health.json', self.protected_uid,
                                    mode=0o640, gid=self.protected_gid)
        require(sha(baseline_raw) == evidence['historicalBaselineSha256'], 'public_flight_original_baseline_changed')
        baseline = json.loads(baseline_raw)
        require(baseline['statuses'][HEALTH_URLS[2]]['dependencies'].get('flight-data-source') == 'ok',
                'public_flight_original_source_baseline')
        require(value['publicFlightStatus'] == public_flight_health_comparison(baseline['statuses'], value['statuses']),
                'public_flight_health_observation_mismatch')
        return value

    def record_accepted_health(self, directory, binding, current, verified):
        finite_flight = False
        if binding.get('accountErasureConfig'):
            reference = binding['accountErasureConfig']
            _, proof = self.erasure_config_proof(Path(reference['path']), binding, reference['sha256'])
            finite_flight = proof['contractVersion'] in {PUBLIC_FLIGHT_REPAIR_VERSION, PUBLIC_FLIGHT_REPAIR_ENABLE_VERSION, PREPARED_CONTINUATION_VERSION, PREPARED_CONTINUATION_ENABLE_VERSION, POST_EDGE_VERSION, POST_EDGE_ENABLE_VERSION, POST_EDGE_ENABLE_AUTH_VERSION, CONTINUITY_REPAIR_VERSION}
        if finite_flight:
            value = self.public_flight_verified_health(binding, verified)
            expected_image = binding['imageId'] if proof['contractVersion'] == CONTINUITY_REPAIR_VERSION else PUBLIC_FLIGHT_REPAIR_IMAGE
            expected_revision = proof['target']['sourceRevision'] if proof['contractVersion'] == CONTINUITY_REPAIR_VERSION else PUBLIC_FLIGHT_REPAIR_REVISION
            require(current.get('State', {}).get('Running') is True and current['Image'] == expected_image
                    and binding['sourceRevision'] == expected_revision, 'public_flight_live_target')
            self.write(directory / 'accepted-public-flight-health.json', encoded(value))
        if binding['driverContract']['poolMode'] != 'direct':
            return
        if binding['acceptedHealthSha256'] is not None:
            self.accepted_health(directory, binding)
            return  # Preserve the original accepted observation, including CID.
        value = json.loads(verified)
        require((finite_flight or set(value) == {'healthAndPublicDemoPreserved', 'statuses'}
                and value['healthAndPublicDemoPreserved'] is True)
                and current.get('State', {}).get('Running') is True
                and current['Image'] == binding['imageId'], 'accepted_health_verification_invalid')
        witness = {'contractVersion': 'cop-api-runtime-health-witness-v1',
                   'containerId': current['Id'],
                   'acceptedAtUtc': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                   'statuses': health_statuses(value['statuses']),
                   **{key: binding[key] for key in ('releaseId', 'imageId', 'sourceRevision', 'profileId', 'profileGeneration')}}
        raw = encoded(witness)
        require(len(raw) <= 65536, 'health_witness_too_large')
        self.write(directory / 'accepted-health.json', raw)
        binding['acceptedHealthSha256'] = sha(raw)
        self.write(directory / 'release.json', encoded(binding))

    def activate(self, release, expected, adopt=False, rollback=False):
        self.clean(); previous = self.check_cas(expected)
        directory, binding, profile = self.binding(release, probe_mounts=False)
        guarded = binding.get('accountErasureConfig') or (self.active(probe_mounts=False)[2].get('accountErasureConfig') if previous else None)
        require(not rollback or not guarded, 'guarded_rollback_requires_intake_pause')
        with self.erasure_configuration_scope(directory, binding, profile, previous):
            return self._activate(release, expected, adopt, rollback)

    def revert_arrival(self, proof, attestation, expected):
        # The ordinary rollback/recovery prohibitions remain intact. Only this
        # root-hash-pinned exact-pair coordinator may supersede a pending forward.
        import types
        path = self.protected_root / '206c4507-5e00-458e-b0ee-4061309aa7a8' / ('arrival-reversion-worker-' + ARRIVAL_REVERSION_WORKER_SHA256 + '.py')
        self.protected_directory(path.parent)
        raw = private_read(path, 0, mode=0o640, gid=1000)
        require(sha(raw) == ARRIVAL_REVERSION_WORKER_SHA256, 'arrival_reversion_worker_changed')
        worker = types.ModuleType('closed_arrival_reversion_worker')
        exec(compile(raw, str(path), 'exec'), worker.__dict__)
        return worker.revert(self.post_edge_runtime(), self, proof, attestation, expected)

    def stopped_reset_health(self, binding, previous, actual):
        reference = binding.get('accountErasureConfig')
        require(reference is not None, 'clean_stopped_source_scope')
        _, proof = self.erasure_config_proof(Path(reference['path']), binding, reference['sha256'])
        self.protected_directory(CLEAN_RESET_DIRECTORY)
        receipt = private_read(CLEAN_RESET_DIRECTORY / 'reset-result.json', self.protected_uid,
                               mode=0o640, gid=self.protected_gid)
        baseline = private_read(CLEAN_RESET_DIRECTORY / 'pre-stop-health.json', self.protected_uid,
                                mode=0o640, gid=self.protected_gid)
        return stopped_clean_baseline(proof, previous, actual, receipt, baseline)

    def _activate(self, release, expected, adopt=False, rollback=False):
        self.clean(); previous = self.check_cas(expected)
        directory, binding, profile = self.binding(release)
        require(adopt == (binding['kind'] == 'accepted-baseline' and previous is None), 'activation_kind_invalid')
        require(not rollback or previous is not None and not adopt, 'rollback_kind_invalid')
        # A failed source TX endpoint must not prevent explicit restoration of
        # an accepted DIRECT pair. Its protected identity/parity still applies;
        # availability probes remain mandatory for every TX target.
        restore_direct = rollback and profile['mode'] == 'direct'
        if previous:
            _, old_dir, old_binding, old_profile = self.active(probe_mounts=not restore_direct)
            self.docker.live(old_dir, old_binding, old_profile,
                             require_label=old_binding['kind'] != 'accepted-baseline')
            require(self.docker.current(old_dir)['Id'] == previous['containerId'], 'live_container_changed')
            if rollback:
                require(self.accepted_ancestor(old_binding, release, probe_mounts=not restore_direct),
                        'rollback_pair_not_previously_accepted')
            else:
                require(binding['previousReleaseId'] == previous['releaseId'], 'prepared_pair_stale')
            if old_profile['mode'] != profile['mode'] and not rollback:
                require(old_binding['imageId'] == binding['imageId'], 'route_change_requires_same_accepted_image')
        self.docker.image(binding['imageId'], baseline=binding['kind'] == 'accepted-baseline',
                          revision=binding['sourceRevision'])
        verify_api_diff(self.docker.config(directory), self.docker.config(directory, profile['directory']),
                        profile['values'], profile['mode'], binding['imageId'], binding['legacyEnvPresence'],
                        self.clean_runtime_values(binding, self.docker.config(directory, profile['directory'])),
                        auth_scope=binding.get('accountErasureConfig', {}).get('authScope') == POST_EDGE_AUTH_SCOPE)
        if adopt:
            actual = self.docker.current(directory)
            require(actual['Id'] == binding['legacyContainerId'], 'legacy_container_witness_mismatch')
            self.docker.live(directory, binding, profile, require_label=False)
            self.write(directory / 'adoption-health.json', self.docker.health('capture', None))
            self.docker.unchanged(directory, actual)
            verified = self.docker.health('verify', directory / 'adoption-health.json')
            self.docker.live(directory, binding, profile, require_label=False)
            self.docker.unchanged(directory, actual)
            self.record_accepted_health(directory, binding, actual, verified)
            return self.commit_pointer(binding, expected, binding['legacyContainerId'])
        require(previous is not None, 'accepted_baseline_pair_required')
        self.docker.preserve(directory, profile['directory'], self.docker.current(old_dir))
        source = self.docker.current(old_dir)
        clean = False
        reference = binding.get('accountErasureConfig')
        if reference:
            _, proof = self.erasure_config_proof(Path(reference['path']), binding, reference['sha256'])
            clean = is_clean_erasure_proof(proof)
        if clean and source.get('State', {}).get('Running') is False:
            # Global test-data reset has already closed the old writer. It must
            # remain stopped; use its bound real pre-stop health, then verify
            # the new candidate against that same baseline after recreation.
            require(not rollback and not restore_direct, 'clean_stopped_source_scope')
            baseline = self.stopped_reset_health(binding, previous, source)
        else:
            baseline = (self.accepted_health(directory, binding) if restore_direct
                        else self.docker.health('capture', None))
        self.write(self.root / 'pending-health.json', baseline)
        pending = {'contractVersion': 'cop-api-runtime-pending-v1', 'previous': previous,
                   'targetReleaseId': release, 'targetContainerId': None,
                   'restoredContainerId': None, 'peers': self.docker.peers(directory)}
        self.write(self.root / 'pending.json', encoded(pending))
        actual = self.docker.current(old_dir)
        require(actual['Id'] == previous['containerId'], 'live_container_changed')
        self.docker.preserve(directory, profile['directory'], actual)
        self.docker.unchanged(old_dir, actual)
        self.assert_erasure_environment(binding)
        self.docker.up(directory, profile['directory'])
        self.docker.live(directory, binding, profile)
        pending['targetContainerId'] = self.docker.current(directory)['Id']
        self.write(self.root / 'pending.json', encoded(pending))
        require(self.docker.peers(directory) == pending['peers'], 'peer_container_changed')
        verified = self.docker.health('verify', self.root / 'pending-health.json')
        actual = self.docker.current(directory)
        require(actual['Id'] == pending['targetContainerId'], 'live_container_changed')
        self.docker.live(directory, binding, profile)
        self.docker.unchanged(directory, actual)
        self.record_accepted_health(directory, binding, actual, verified)
        self.docker.unchanged(directory, actual)
        self.assert_erasure_environment(binding)
        pointer = self.commit_pointer(binding, expected, pending['targetContainerId'])
        self.finish_pending()
        return pointer

    def finish_pending(self):
        self.guard()
        for name in ('pending.json', 'pending-health.json'):
            (self.root / name).unlink(missing_ok=True)
        self.sync(self.root)

    def recover(self, expected, rollback=False):
        self.directory(self.root); self.check_cas(expected)
        pending = private_json(self.root / 'pending.json', self.uid)
        require(isinstance(pending, dict) and isinstance(pending.get('targetReleaseId'), str)
                and isinstance(pending.get('previous'), dict), 'pending_invalid')
        directory, binding, profile = self.binding(pending['targetReleaseId'], probe_mounts=False)
        old_binding = self.binding(pending['previous']['releaseId'], probe_mounts=False)[1]
        require(not rollback or not (binding.get('accountErasureConfig') or old_binding.get('accountErasureConfig')),
                'guarded_rollback_requires_intake_pause')
        with self.erasure_configuration_scope(directory, binding, profile, pending['previous'], owned_target=True):
            return self._recover(expected, rollback)

    def _recover(self, expected, rollback=False):
        self.directory(self.root); current = self.check_cas(expected)
        pending = private_json(self.root / 'pending.json', self.uid)
        require(set(pending) == {'contractVersion', 'previous', 'targetReleaseId', 'targetContainerId',
                'restoredContainerId', 'peers'}
                and pending['contractVersion'] == 'cop-api-runtime-pending-v1'
                and all(value is None or re.fullmatch(r'[0-9a-f]{64}', value)
                        for value in (pending['targetContainerId'], pending['restoredContainerId'])), 'pending_invalid')
        previous = pending['previous']
        require(current is not None and (current == previous or current['releaseId'] == pending['targetReleaseId']
                or current['releaseId'] == previous['releaseId']
                and current['containerId'] == pending['restoredContainerId']),
                'recovery_pointer_changed')
        old_dir, old_binding, old_profile = self.binding(previous['releaseId'], probe_mounts=False)
        new_dir, new_binding, new_profile = self.binding(pending['targetReleaseId'], probe_mounts=False)
        restore_direct = (rollback and old_profile['mode'] == 'direct' or not rollback
                          and new_profile['mode'] == 'direct'
                          and self.accepted_ancestor(old_binding, new_binding['releaseId'], probe_mounts=False))
        if not restore_direct:
            self.check_mounts(old_binding, old_profile)
            self.check_mounts(new_binding, new_profile)
        elif not rollback:
            require(private_read(self.root / 'pending-health.json', self.uid) ==
                    self.accepted_health(new_dir, new_binding), 'recovery_health_witness_changed')
        actual = self.docker.current(new_dir)
        if actual['Image'] == new_binding['imageId'] and actual['Config'].get('Labels', {}).get('com.cop.runtime.release') == new_binding['releaseId']:
            self.docker.live(new_dir, new_binding, new_profile)
            if pending['targetContainerId'] is not None:
                require(actual['Id'] == pending['targetContainerId'], 'recovery_container_changed')
            target_running = True
        else:
            self.docker.live(old_dir, old_binding, old_profile,
                             require_label=old_binding['kind'] != 'accepted-baseline')
            require(actual['Id'] == (pending['restoredContainerId'] or previous['containerId']), 'recovery_container_changed')
            target_running = False
        directory, binding, profile = ((old_dir, old_binding, old_profile) if rollback
                                       else (new_dir, new_binding, new_profile))
        self.docker.image(binding['imageId'], baseline=binding['kind'] == 'accepted-baseline',
                          revision=binding['sourceRevision'])
        verify_api_diff(self.docker.config(directory), self.docker.config(directory, profile['directory']),
                        profile['values'], profile['mode'], binding['imageId'], binding['legacyEnvPresence'],
                        self.clean_runtime_values(binding, self.docker.config(directory, profile['directory'])),
                        auth_scope=binding.get('accountErasureConfig', {}).get('authScope') == POST_EDGE_AUTH_SCOPE)
        self.docker.preserve(directory, profile['directory'], actual)
        self.docker.unchanged(directory, actual)
        if rollback and target_running:
            self.assert_erasure_environment(binding)
            self.docker.up(directory, profile['directory'])
        require(rollback or target_running, 'activation_did_not_start')
        self.docker.live(directory, binding, profile,
                         require_label=not (binding['kind'] == 'accepted-baseline' and not target_running))
        owned_id = self.docker.current(directory)['Id']
        if rollback and target_running:
            pending['restoredContainerId'] = owned_id
            self.write(self.root / 'pending.json', encoded(pending))
        require(self.docker.peers(directory) == pending['peers'], 'peer_container_changed')
        verified = self.docker.health('verify', self.root / 'pending-health.json')
        actual = self.docker.current(directory)
        require(actual['Id'] == owned_id, 'recovery_container_changed')
        self.docker.live(directory, binding, profile,
                         require_label=not (binding['kind'] == 'accepted-baseline' and not target_running))
        self.docker.unchanged(directory, actual)
        self.record_accepted_health(directory, binding, actual, verified)
        self.docker.unchanged(directory, actual)
        self.assert_erasure_environment(binding)
        pointer = self.commit_pointer(binding, expected, owned_id)
        self.finish_pending()
        return pointer


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    commands.add_parser('validate')
    prepare = commands.add_parser('prepare')
    for name in ('image', 'attestation', 'expect-active'):
        prepare.add_argument('--' + name, required=True)
    prepare.add_argument('--revision')
    prepare.add_argument('--profile'); prepare.add_argument('--baseline', action='store_true')
    prepare.add_argument('--account-erasure-config')
    activate = commands.add_parser('activate')
    activate.add_argument('--release', required=True); activate.add_argument('--expect-active', required=True)
    activate.add_argument('--adopt', action='store_true')
    activate.add_argument('--rollback', action='store_true')
    reversion = commands.add_parser('arrival-revert')
    reversion.add_argument('--proof', required=True); reversion.add_argument('--attestation', required=True)
    reversion.add_argument('--expect-active', required=True)
    recover = commands.add_parser('recover')
    recover.add_argument('--expect-active', required=True); recover.add_argument('--rollback', action='store_true')
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('cop_storage', Path(__file__).with_name('cop-storage.py'))
    storage = importlib.util.module_from_spec(spec); spec.loader.exec_module(storage)
    try:
        with storage.operation_lock():
            store = Store(guard=storage.preflight)
            if args.action == 'validate':
                pointer, directory, binding, profile = store.active()
                store.docker.live(directory, binding, profile, require_label=binding['kind'] != 'accepted-baseline')
                require(store.docker.current(directory)['Id'] == pointer['containerId'], 'live_container_changed')
                result = pointer
            elif args.action == 'prepare':
                result = store.prepare(args.image, args.revision, Path(args.attestation), args.expect_active,
                                       args.profile, args.baseline, args.account_erasure_config)
            elif args.action == 'activate':
                result = store.activate(args.release, args.expect_active, args.adopt, args.rollback)
            elif args.action == 'arrival-revert':
                result = store.revert_arrival(Path(args.proof), Path(args.attestation), args.expect_active)
            else:
                result = store.recover(args.expect_active, args.rollback)
            print(json.dumps({key: result[key] for key in (
                'releaseId', 'profileId', 'profileGeneration', 'imageId') } |
                ({'generation': result['generation']} if 'generation' in result else {}), sort_keys=True))
        return 0
    except (RuntimeError, OSError, ValueError, KeyError, TypeError, storage.StorageError):
        print(json.dumps({'ok': False, 'error': 'cop_api_runtime_rejected'}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
