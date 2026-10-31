"""Synthetic boundary tests only; no production command, GO, credentials or DB."""
import copy
import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
V4 = HERE.parent / 'planning-enable-v4'


def load(path):
    spec = importlib.util.spec_from_file_location('synthetic_' + path.stem, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


K = load(HERE / 'kernel.py'); C = load(HERE / 'constructor.py')
V4C = load(V4 / 'constructor.py'); V4T = load(V4 / 'test_kernel.py')
RAW = (HERE / 'kernel.py').read_bytes()
BASE = V4C.construct((V4 / 'fixtures/cop-api-runtime.pg-reconnect.py.txt').read_bytes(), (V4 / 'kernel.py').read_bytes())
NOW = datetime.datetime.now(datetime.timezone.utc)


def fixture():
    root = Path('/synthetic/profiles'); uid = '12345678-1234-4234-8234-123456789abc'
    env = {'COP_AUTH_MODE': 'oidc', 'COP_ALLOW_LAB_TOKEN': 'false', 'COP_ACCOUNT_ERASURE_ENABLED': 'true',
           'COP_ACCOUNT_SAFETY_GUARD_REQUIRED': 'true', 'COP_ROUTING_PLANNING_ENABLED': 'true',
           'COP_ROUTING_PLANNING_SERVICE_TOKEN': 'synthetic-not-a-real-token'}
    previous = {'contractVersion': 'cop-api-runtime-active-v1', 'generation': 'a'*32,
                'releaseId': 'release-' + 'b'*32, 'profileId': K.PROFILE, 'profileGeneration': K.PROFILE,
                'imageId': K.OLD, 'containerId': 'c'*64}
    current = {'Id': 'c'*64, 'Image': K.OLD, 'RestartCount': 1,
               'State': {'Pid': 123, 'StartedAt': '2026-10-31T09:55:54Z', 'Running': True,
                         'Restarting': False, 'Health': {'Status': 'healthy'}}}
    canonical = lambda v: K.canonical(v) + b'\n'
    public_spec = lambda v: {key: v[key] for key in ('Id', 'Image')}
    spec_sha = K.sha(canonical(public_spec(current)))
    metadata = dict(device=1, inode=2, size=300, mtimeNs=4, ctimeNs=5)
    parent = {'path': str(root / K.PROFILE / ('account-erasure-' + 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json')),
              'sha256': 'd'*64, 'cleanScope': 'cop_sim_shared_identity_v1'}
    stamp = lambda n: (NOW + datetime.timedelta(seconds=n)).isoformat()
    case = {'contractVersion': 'cop-projection-admission-case-v1', 'caseId': uid, 'stage': 'forward',
            'approvalRef': K.APPROVAL, 'kernelSha256': K.sha(RAW), 'previous': previous,
            'parentProof': parent, 'environmentMetadata': metadata, 'composeHashes': {'compose.yml': 'e'*64},
            'sourceEnvironmentSha256': K.sha(K.canonical(env)), 'sourceSpecSha256': spec_sha,
            'baselineSha256': 'f'*64, 'checkedAt': stamp(-30), 'expiresAt': stamp(600),
            'sourceProcess': {'pid': 123, 'restartCount': 1, 'startedAt': current['State']['StartedAt'], 'running': True}}
    reference = {'path': str(root / K.PROFILE / ('admission-image-case-' + uid + '.json')),
                 'sha256': K.sha(K.canonical(case))}
    proof = {'contractVersion': K.VERSION, 'transitionId': uid, 'operation': 'maintain', 'stage': 'forward',
             'previous': previous, 'target': K.target('forward'), 'changedKeys': [], 'environmentMetadata': metadata,
             'composeHashes': case['composeHashes'], 'ownerAcceptance': True, 'checks': {'real_legacy_protection': True},
             'cleanReset': {'synthetic': True}, 'parentProof': parent, 'caseReference': reference,
             'checkedAt': stamp(-10), 'expiresAt': stamp(300), 'sourceSpecSha256': spec_sha, 'baselineSha256': 'f'*64}
    docs = {Path(reference['path']): K.canonical(case)}
    def run(args):
        assert args == ['docker', 'inspect', 'c'*64]
        return json.dumps([current]).encode()
    store = types.SimpleNamespace(pointer=lambda: previous, docker=types.SimpleNamespace(run=run))
    r = types.SimpleNamespace(PROFILES=root, FILES=('compose.yml',), PLANNING_CONFIG_V3_KERNEL_SHA256=K.sha(RAW),
        PROFILE_UUID=re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}'),
        fenced_timestamp=lambda value: datetime.datetime.fromisoformat(value).timestamp(),
        datetime=datetime.datetime, timezone=datetime.timezone, Store=lambda **_: store,
        private_read=lambda path, uid, **kwargs: docs[Path(path)], sha=K.sha, encoded=canonical,
        fenced_public_source_spec=public_spec)
    return r, proof, case, env, docs, current, store


def rewrite(proof, case, docs):
    raw = K.canonical(case); docs[Path(proof['caseReference']['path'])] = raw
    proof['caseReference']['sha256'] = K.sha(raw)


class Tests(unittest.TestCase):
    def test_constructor_exact_and_fully_reversible(self):
        target = C.construct(BASE, RAW).decode()
        target = target.replace("PLANNING_CONFIG_V3_KERNEL_SHA256 = '" + K.sha(RAW) + "'\nADMISSION_IMAGE_VERSION = '" + K.VERSION + "'",
                                "PLANNING_CONFIG_V3_KERNEL_SHA256 = '" + K.HISTORICAL + "'")
        target = target.replace('PLANNING_CONFIG_V3_VERSION, PLANNING_ENABLE_V4_VERSION, ADMISSION_IMAGE_VERSION',
                                'PLANNING_CONFIG_V3_VERSION, PLANNING_ENABLE_V4_VERSION')
        new = "        if image == '" + K.NEW + "':\n            store=Store(uid=1000)\n            store.planning_config_v3_module().image(store.post_edge_runtime(),self,inspected,revision)\n        elif image == PLANNING_BOOTSTRAP_V3_IMAGE:"
        target = target.replace(new, '        if image == PLANNING_BOOTSTRAP_V3_IMAGE:')
        self.assertEqual(target.encode(), BASE)
        with self.assertRaises(ValueError): C.construct(BASE + b'\n', RAW)

    def test_actual_historical_v4_read_uses_original_kernel_pin(self):
        r, p, case, acceptance, env, docs = V4T.fixture()
        docs[r.PROFILES / K.PROFILE / ('planning-config-v3-kernel-' + K.HISTORICAL + '.py')] = (V4 / 'kernel.py').read_bytes()
        r.PLANNING_CONFIG_V3_KERNEL_SHA256 = K.sha(RAW)
        self.assertEqual(K.schema(r, p), p)
        self.assertEqual(K.evidence(r, p, False), p)
        self.assertEqual(r.PLANNING_CONFIG_V3_KERNEL_SHA256, K.sha(RAW))
        r.datetime = type('Future', (), {'now': staticmethod(lambda tz: NOW + datetime.timedelta(hours=2))})
        self.assertEqual(K.evidence(r, p, False), p)
        with self.assertRaises(ValueError): K.evidence(r, p, True)

    def test_actual_historical_v4_binding_reader_keeps_parent_scope(self):
        r, p, case, acceptance, env, docs = V4T.fixture()
        docs[r.PROFILES / K.PROFILE / ('planning-config-v3-kernel-' + K.HISTORICAL + '.py')] = (V4 / 'kernel.py').read_bytes()
        r.PLANNING_CONFIG_V3_KERNEL_SHA256 = K.sha(RAW)
        origin = {'imageId': K.OLD, 'sourceRevision': K.OLD_SOURCE, 'profileId': K.PROFILE,
                  'accountErasureConfig': p['parentProof']}
        r.private_json = lambda *_: origin
        parent = {'contractVersion': 'cop-planning-config-v3', 'stage': 'provision', 'checks': p['checks'],
                  'cleanReset': p['cleanReset'], 'environmentMetadata': p['sourceEnvironmentMetadata'],
                  'composeHashes': p['sourceComposeHashes']}
        store = types.SimpleNamespace(root=Path('/synthetic/runtime'), uid=1000, erasure_config_proof=lambda *_: ('a'*64, parent))
        binding = {**p['target'], 'profileId': K.PROFILE, 'previousReleaseId': p['previous']['releaseId']}
        path = r.PROFILES / K.PROFILE / ('account-erasure-' + p['transitionId'] + '.json')
        self.assertEqual(K.read_proof(r, store, path, K.canonical(p), binding)[1], p)

    @patch.object(K, 'build_evidence', return_value=(None, None))
    def test_nested_new_proof_to_real_v4_reader_to_unchanged_v3_boundary(self, _):
        r, v4, old_case, _, _, docs = V4T.fixture()
        _, p, c, _, own_docs, _, _ = fixture()
        docs.update(own_docs)
        docs[r.PROFILES / K.PROFILE / ('planning-config-v3-kernel-' + K.HISTORICAL + '.py')] = (V4 / 'kernel.py').read_bytes()
        r.PLANNING_CONFIG_V3_KERNEL_SHA256 = K.sha(RAW)
        parent_path = r.PROFILES / K.PROFILE / ('account-erasure-' + v4['transitionId'] + '.json')
        docs[parent_path] = K.canonical(v4)
        reference = {'path': str(parent_path), 'sha256': K.sha(docs[parent_path]), 'cleanScope': 'cop_sim_shared_identity_v1'}
        p['transitionId'] = c['caseId'] = '32345678-1234-4234-8234-123456789abc'
        p['previous']['releaseId'] = 'release-' + 'f'*32
        c['previous'] = p['previous']
        p['parentProof'] = c['parentProof'] = reference
        for key in ('environmentMetadata', 'composeHashes', 'checks', 'cleanReset'):
            p[key] = copy.deepcopy(v4[key])
            if key in c: c[key] = copy.deepcopy(v4[key])
        p['caseReference'] = {'path': str(r.PROFILES / K.PROFILE / ('admission-image-case-' + p['transitionId'] + '.json')), 'sha256': ''}
        rewrite(p, c, docs)
        v4_binding = {**v4['target'], 'profileId': K.PROFILE, 'previousReleaseId': v4['previous']['releaseId'], 'accountErasureConfig': reference}
        prior_binding = {'imageId': K.OLD, 'sourceRevision': K.OLD_SOURCE, 'profileId': K.PROFILE,
                         'accountErasureConfig': v4['parentProof']}
        r.private_json = lambda path, uid: v4_binding if 'release-' + 'f'*32 in str(path) else prior_binding
        verified_v3 = {key: v4[key] for key in ('checks', 'cleanReset')}
        verified_v3.update(contractVersion='cop-planning-config-v3', stage='provision',
                           environmentMetadata=v4['sourceEnvironmentMetadata'], composeHashes=v4['sourceComposeHashes'])
        calls = []
        store = types.SimpleNamespace(root=Path('/synthetic/runtime'), uid=1000)
        def nested(path, binding, digest):
            calls.append(path)
            if path == parent_path:
                return K.read_proof(r, store, path, docs[path], binding)
            self.assertEqual(path, Path(v4['parentProof']['path']))
            return v4['parentProof']['sha256'], verified_v3
        store.erasure_config_proof = nested
        binding = {**p['target'], 'profileId': K.PROFILE, 'previousReleaseId': p['previous']['releaseId']}
        path = r.PROFILES / K.PROFILE / ('account-erasure-' + p['transitionId'] + '.json')
        self.assertEqual(K.read_proof(r, store, path, K.canonical(p), binding)[1], p)
        self.assertEqual(calls, [parent_path, Path(v4['parentProof']['path'])])
        self.assertEqual(r.PLANNING_CONFIG_V3_KERNEL_SHA256, K.sha(RAW))

    @patch.object(K, 'build_evidence', return_value=(None, None))
    def test_fresh_exact_case_and_zero_environment_delta(self, _):
        r, p, c, env, docs, current, store = fixture()
        self.assertEqual(K.evidence(r, p), p)
        self.assertTrue(K.environment(r, env, dict(env), p))

    @patch.object(K, 'build_evidence', return_value=(None, None))
    def test_auth_token_flag_limit_or_added_env_rejected(self, _):
        r, p, c, env, docs, current, store = fixture()
        for key, value in [('COP_ALLOW_LAB_TOKEN', 'true'), ('COP_ROUTING_PLANNING_ENABLED', 'false'),
                           ('COP_ROUTING_PLANNING_SERVICE_TOKEN', 'rotated'), ('COP_API_MAX_EVENT_LOOP_DELAY_MS', '9999')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                K.environment(r, env, {**env, key: value}, p)
        changed = {**env, 'OTHER': 'changed'}
        with self.assertRaises(ValueError): K.environment(r, changed, changed, p)

    @patch.object(K, 'build_evidence', return_value=(None, None))
    def test_source_pid_restart_pointer_or_health_drift_rejected(self, _):
        for mutation in (lambda v: v['State'].update(Pid=999), lambda v: v.update(RestartCount=2),
                         lambda v: v['State']['Health'].update(Status='unhealthy'), lambda v: v.update(Image=K.NEW)):
            r, p, c, env, docs, current, store = fixture(); mutation(current)
            with self.assertRaises(ValueError): K.evidence(r, p)
        r, p, c, env, docs, current, store = fixture(); store.pointer = lambda: {}
        with self.assertRaises(ValueError): K.evidence(r, p)

    @patch.object(K, 'build_evidence', return_value=(None, None))
    def test_expired_authority_not_refreshed_and_historical_distinct(self, _):
        r, p, c, env, docs, current, store = fixture()
        r.datetime = type('Future', (), {'now': staticmethod(lambda tz: NOW + datetime.timedelta(hours=2))})
        with self.assertRaises(ValueError): K.evidence(r, p, True)
        self.assertEqual(K.evidence(r, p, False), p)

    @patch.object(K, 'build_evidence', return_value=(None, None))
    def test_changed_image_stage_field_or_case_authority_rejected(self, _):
        for mutate in (lambda p: p['target'].update(imageId=K.OLD), lambda p: p.update(stage='other'),
                       lambda p: p.update(changedKeys=['ANY']), lambda p: p.update(extra=True)):
            r, p, c, env, docs, current, store = fixture(); mutate(p)
            with self.assertRaises(ValueError): K.schema(r, p)
        r, p, c, env, docs, current, store = fixture(); c['approvalRef'] = 'call_OTHER'; rewrite(p, c, docs)
        with self.assertRaises(ValueError): K.schema(r, p)

    def test_receipt_unknown_bytes_and_document_duplicate_rejected(self):
        r, p, c, env, docs, current, store = fixture()
        r.private_read = lambda *_, **__: b'{}'
        with self.assertRaises(ValueError): K.build_evidence(r)
        for raw in (b'{"k":1,"k":2}', b'{"x":NaN}', b'x'*65537):
            with self.assertRaises(ValueError): K.parse(raw)

    @patch.object(K, 'build_evidence', return_value=(None, None))
    def test_image_config_layer_architecture_and_revision_exact(self, _):
        r, p, c, env, docs, current, store = fixture()
        parent = {'Id': K.OLD, 'Config': {'Env': ['SYNTHETIC=true']}, 'RootFS': {'Layers': ['old']}, 'Os': 'linux', 'Architecture': 'amd64'}
        candidate = {**copy.deepcopy(parent), 'Id': K.NEW, 'RootFS': {'Layers': ['old', 'new']}}
        docker = types.SimpleNamespace(run=lambda *_: json.dumps([parent]).encode())
        with patch.object(K, 'CONFIG', K.sha(K.canonical(parent['Config']))), patch.object(K, 'ROOTFS', K.sha(K.canonical(candidate['RootFS']))):
            K.image(r, docker, candidate, K.NEW_SOURCE)
            for mutate in (lambda v: v['Config'].update(User='other'), lambda v: v['RootFS']['Layers'].append('extra'),
                           lambda v: v.update(Architecture='arm64')):
                bad = copy.deepcopy(candidate); mutate(bad)
                with self.assertRaises(ValueError): K.image(r, docker, bad, K.NEW_SOURCE)
            with self.assertRaises(ValueError): K.image(r, docker, candidate, K.OLD_SOURCE)

    @patch.object(K, 'build_evidence', return_value=(None, None))
    def test_forward_parent_lineage_and_protections(self, _):
        r, p, c, env, docs, current, store = fixture()
        origin = {'imageId': K.OLD, 'sourceRevision': K.OLD_SOURCE, 'profileId': K.PROFILE,
                  'accountErasureConfig': p['parentProof']}
        parent = {key: p[key] for key in ('checks', 'cleanReset', 'environmentMetadata', 'composeHashes')}
        parent.update(contractVersion='cop-planning-enable-v4', stage='enable')
        store.root, store.uid = Path('/synthetic/runtime'), 1000
        store.erasure_config_proof = lambda *_: ('a'*64, parent)
        r.private_json = lambda *_: origin
        binding = {**p['target'], 'profileId': K.PROFILE, 'previousReleaseId': p['previous']['releaseId']}
        path = r.PROFILES / K.PROFILE / ('account-erasure-' + p['transitionId'] + '.json')
        self.assertEqual(K.read_proof(r, store, path, K.canonical(p), binding)[1], p)
        origin['sourceRevision'] = '0'*40
        with self.assertRaises(ValueError): K.read_proof(r, store, path, K.canonical(p), binding)
        origin['sourceRevision'] = K.OLD_SOURCE
        parent['checks'] = {'different': True}
        with self.assertRaises(ValueError): K.read_proof(r, store, path, K.canonical(p), binding)

    @patch.object(K, 'build_evidence', return_value=(None, None))
    def test_reverse_exact_forward_baseline_and_environment(self, _):
        r, p, c, env, docs, current, store = fixture()
        forward = copy.deepcopy(p)
        forward_path = r.PROFILES / K.PROFILE / ('account-erasure-' + forward['transitionId'] + '.json')
        docs[forward_path] = K.canonical(forward)
        uid = '22345678-1234-4234-8234-123456789abc'
        p.update(transitionId=uid, stage='reverse', target=K.target('reverse'),
                 parentProof={'path': str(forward_path), 'sha256': K.sha(docs[forward_path]), 'cleanScope': 'cop_sim_shared_identity_v1'},
                 previous={**p['previous'], 'imageId': K.NEW, 'releaseId': 'release-' + '9'*32})
        c = copy.deepcopy(c)
        c.update(caseId=uid, stage='reverse', previous=p['previous'], parentProof=p['parentProof'])
        p['caseReference'] = {'path': str(r.PROFILES / K.PROFILE / ('admission-image-case-' + uid + '.json')), 'sha256': ''}
        rewrite(p, c, docs)
        origin = {'imageId': K.NEW, 'sourceRevision': K.NEW_SOURCE, 'profileId': K.PROFILE,
                  'accountErasureConfig': p['parentProof']}
        store.root, store.uid = Path('/synthetic/runtime'), 1000
        store.erasure_config_proof = lambda *_: ('a'*64, forward)
        r.private_json = lambda *_: origin
        binding = {**p['target'], 'profileId': K.PROFILE, 'previousReleaseId': p['previous']['releaseId']}
        path = r.PROFILES / K.PROFILE / ('account-erasure-' + uid + '.json')
        self.assertEqual(K.read_proof(r, store, path, K.canonical(p), binding)[1], p)
        p['baselineSha256'] = c['baselineSha256'] = '8'*64; rewrite(p, c, docs)
        with self.assertRaises(ValueError): K.read_proof(r, store, path, K.canonical(p), binding)
        p['baselineSha256'] = c['baselineSha256'] = forward['baselineSha256']
        c['sourceEnvironmentSha256'] = '7'*64; rewrite(p, c, docs)
        with self.assertRaises(ValueError): K.read_proof(r, store, path, K.canonical(p), binding)

    @patch.object(K, 'build_evidence', return_value=(None, None))
    def test_health_order_and_fresh_target_even_for_return(self, _):
        for stage in ('forward', 'reverse'):
            for status, restarts, succeeds in [('healthy', 0, True), ('unhealthy', 0, False), ('healthy', 1, False)]:
                with self.subTest(stage=stage, status=status, restarts=restarts):
                    r, p, c, env, docs, current, source_store = fixture()
                    p['stage'] = stage
                    baseline = K.canonical({'syntheticHealth': 'healthy'})
                    p['baselineSha256'] = K.sha(baseline)
                    adapter = b'def verify(r, baseline):\n r.synthetic_calls.append("verify")\n return baseline, {"syntheticOnly": True}\n'
                    health_sha = K.sha(adapter)
                    docs[r.PROFILES / K.PROFILE / ('planning-config-v3-source-health-' + p['transitionId'] + '.json')] = baseline
                    docs[r.PROFILES / K.PROFILE / ('planning-config-v3-health-' + health_sha + '.py')] = adapter
                    r.health_statuses = lambda value: value; r.synthetic_calls = []
                    r.private_json = lambda *_: {'previous': p['previous'], 'targetReleaseId': 'synthetic', 'targetContainerId': 'target'}
                    expected = K.target(stage)
                    target = {'Id': 'target', 'Image': expected['imageId'], 'RestartCount': restarts,
                              'State': {'Running': True, 'Health': {'Status': status}}}
                    docker = types.SimpleNamespace(health=lambda *_: None, current=lambda *_: target)
                    root = Path('/synthetic/runtime')
                    store = types.SimpleNamespace(root=root, uid=1000, docker=docker, write=lambda *_: None,
                        binding=lambda *_: (None, expected, None))
                    docs[root / 'pending-health.json'] = baseline
                    with patch.object(K, 'evidence', return_value=p), patch.object(K, 'HEALTH', health_sha):
                        if succeeds:
                            with K.health_scope(r, store, p):
                                self.assertEqual(docker.health('capture', None), baseline)
                                docker.health('verify', root / 'pending-health.json')
                        else:
                            with self.assertRaises(ValueError), K.health_scope(r, store, p):
                                docker.health('capture', None)
                                docker.health('verify', root / 'pending-health.json')
                    self.assertEqual(len(r.synthetic_calls), 2 if stage == 'forward' else 1)
                    self.assertIsNone(docker.planning_config_v3_health_scope)

    def test_proposal_requires_actual_checks_and_never_exports_environment(self):
        proposal = load(HERE / 'proposal.py')
        r, p, c, env, docs, current, store = fixture()
        compose = {'compose.yml': b'services: {}\n'}
        hashes = {name: K.sha(raw) for name, raw in compose.items()}
        binding = {'imageId': K.OLD, 'sourceRevision': K.OLD_SOURCE, 'profileGeneration': K.PROFILE,
                   'accountErasureConfig': p['parentProof'], 'composeHashes': hashes,
                   'driverContract': {'syntheticDriver': True}}
        parent = {'contractVersion': 'cop-planning-enable-v4', 'stage': 'enable', 'environmentMetadata': c['environmentMetadata'],
                  'composeHashes': hashes, 'checks': {'real_legacy_protection': True}, 'cleanReset': {'synthetic': True}}
        store.active = lambda: (p['previous'], None, binding, None)
        store.erasure_config_proof = lambda *_: ('a'*64, parent)
        r.health_statuses = lambda value: value
        args = dict(current=current, environment=env, environment_metadata=c['environmentMetadata'],
                    compose_bytes=compose, baseline_bytes=K.canonical({'syntheticHealth': 'healthy'}))
        with self.assertRaises(ValueError): proposal.propose(r, K, store, p['transitionId'], 'forward', **args)
        checks = {'x5RuntimeGuard': True, 'sharpConversion': True, 'databaseRouting': True}
        value = proposal.propose(r, K, store, p['transitionId'], 'forward', **args, candidate_checks=checks)
        self.assertEqual(len(value['documents']), 4)
        self.assertFalse(value['goIssued']); self.assertFalse(value['productionActivated'])
        self.assertNotIn(env['COP_ROUTING_PLANNING_SERVICE_TOKEN'].encode(), b''.join(value['documents'].values()))
        self.assertEqual(value['proof']['changedKeys'], [])
        self.assertEqual(value['proof']['parentProof'], p['parentProof'])
        with self.assertRaises(ValueError):
            proposal.propose(r, K, store, p['transitionId'], 'forward', **args, candidate_checks={**checks, 'databaseRouting': 1})

    def test_worker_pending_failure_propagates_without_retry(self):
        worker = load(HERE / 'worker.py')
        r, p, c, env, docs, current, store = fixture()
        path = r.PROFILES / K.PROFILE / ('account-erasure-' + p['transitionId'] + '.json')
        docs[path] = K.canonical(p)
        calls = []
        def prepare(*args, **kwargs):
            calls.append(1); raise ValueError('pending_activation_requires_recovery')
        store.prepare = prepare
        attestation = r.PROFILES / K.PROFILE / ('attestation-' + K.NEW[7:] + '.json')
        with patch.object(K, 'evidence', return_value=p), self.assertRaises(ValueError):
            worker.prepare(r, K, store, path, attestation, p['previous']['generation'])
        self.assertEqual(calls, [1])


if __name__ == '__main__':
    unittest.main()
