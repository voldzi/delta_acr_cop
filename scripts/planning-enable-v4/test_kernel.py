"""Synthetic source tests only. No production acceptance/host operation."""
import ast
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
LEGACY = HERE / 'fixtures'


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


K, C, ProposalModule = load('kernel'), load('constructor'), load('proposal')
OLD = (LEGACY / 'kernel.py.txt').read_bytes()
BASE = (LEGACY / 'cop-api-runtime.pg-reconnect.py.txt').read_bytes()
RAW = (HERE / 'kernel.py').read_bytes()
NOW = datetime.datetime.now(datetime.timezone.utc)


def stamp(offset):
    return (NOW + datetime.timedelta(seconds=offset)).isoformat()


def fixture(stage='enable'):
    uuid = ('1' if stage == 'enable' else '2') + '2345678-1234-4234-8234-123456789abc'
    root = Path('/synthetic/profiles')
    profile = root / K.PROFILE
    parent = {'path': str(profile / ('account-erasure-' + 'a'*8 + '-aaaa-4aaa-8aaa-' + 'a'*12 + '.json')),
              'sha256': 'a'*64, 'cleanScope': 'cop_sim_shared_identity_v1'}
    previous = {'contractVersion': 'cop-api-runtime-active-v1', 'generation': 'b'*32,
                'releaseId': 'release-' + 'b'*32, 'profileId': K.PROFILE,
                'profileGeneration': K.PROFILE, 'imageId': K.IMAGE, 'containerId': 'c'*64}
    metadata = dict(device=1, inode=2, size=300, mtimeNs=4, ctimeNs=5)
    compose = {'docker-compose.yml': 'd'*64}
    actual = {K.FLAG: 'false' if stage == 'enable' else 'true', K.TOKEN: 'synthetic-private-value',
              'COP_AUTH_MODE': 'oidc', 'COP_ALLOW_LAB_TOKEN': 'false',
              'COP_ACCOUNT_ERASURE_ENABLED': 'true', 'COP_ACCOUNT_SAFETY_GUARD_REQUIRED': 'true',
              'UNRELATED_SETTING': 'unchanged'}
    acceptance = {'contractVersion': 'cop-planning-enable-acceptance-v4',
                  'copImageId': K.IMAGE, 'simImageId': K.SIM_IMAGE, 'simSourceRevision': K.SIM_SOURCE,
                  'publicCaseIds': ['public-mnichov-stop', 'previous-public-center-control'],
                  'workflowResults': ['PASS', 'PASS'], 'ordinaryAdapterResultSha256': 'e'*64,
                  'wafReceiptSha256': 'f'*64, 'nativeCountReceiptSha256': '1'*64,
                  'checkedAt': stamp(-60), 'expiresAt': stamp(900)}
    ar = {'path': str(profile / ('planning-enable-v4-acceptance-' + uuid + '.json')),
          'sha256': K.sha(K.canonical(acceptance))} if stage == 'enable' else None
    case = {'contractVersion': 'cop-planning-enable-case-v4', 'caseId': uuid, 'stage': stage,
            'approvalRef': 'call_SYNTHETIC_NOT_REAL_APPROVAL', 'kernelSha256': K.sha(RAW),
            'previous': previous, 'parentProof': parent, 'sourceEnvironmentMetadata': metadata,
            'sourceComposeHashes': compose, 'sourceEnvironmentSha256': K.sha(K.canonical(actual)),
            'sourceSpecSha256': '2'*64, 'acceptance': ar, 'checkedAt': stamp(-30), 'expiresAt': stamp(600)}
    cr = {'path': str(profile / ('planning-enable-v4-case-' + uuid + '.json')), 'sha256': K.sha(K.canonical(case))}
    p = {'contractVersion': K.VERSION, 'transitionId': uuid, 'operation': 'maintain', 'stage': stage,
         'previous': previous, 'target': {'imageId': K.IMAGE, 'sourceRevision': K.SOURCE, 'profileGeneration': K.PROFILE},
         'changedKeys': [K.FLAG], 'environmentMetadata': {**metadata, 'inode': 9},
         'sourceEnvironmentMetadata': metadata, 'composeHashes': compose, 'sourceComposeHashes': compose,
         'ownerAcceptance': True, 'checks': {'real_legacy_protection': True}, 'cleanReset': {'synthetic': True},
         'parentProof': parent, 'caseReference': cr, 'checkedAt': stamp(-10), 'expiresAt': stamp(300),
         'sourceSpecSha256': '2'*64, 'baselineSha256': '3'*64, 'stageEvidence': ar}
    docs = {Path(cr['path']): K.canonical(case)}
    if ar:
        docs[Path(ar['path'])] = K.canonical(acceptance)
    docs[profile / ('planning-config-v3-kernel-' + K.LEGACY_SHA + '.py')] = OLD
    r = types.SimpleNamespace(PROFILES=root, FILES=tuple(compose), PLANNING_CONFIG_V3_KERNEL_SHA256=K.sha(RAW),
        PROFILE_UUID=re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}'),
        GENERATION=re.compile('[a-f0-9]{32}'), ID=re.compile('release-[a-f0-9]{32}'),
        fenced_timestamp=lambda v: datetime.datetime.fromisoformat(v).timestamp(),
        datetime=datetime.datetime, timezone=datetime.timezone,
        private_read=lambda path, uid, **kwargs: docs[Path(path)])
    if stage == 'disable':
        _, enabled, _, _, _, prior_docs = fixture('enable')
        docs.update(prior_docs)
        path = root / K.PROFILE / ('account-erasure-' + enabled['transitionId'] + '.json')
        raw = K.canonical(enabled); docs[path] = raw
        p['parentProof'] = case['parentProof'] = {'path': str(path), 'sha256': K.sha(raw),
                                               'cleanScope': 'cop_sim_shared_identity_v1'}
        rewrite_case(p, case, docs)
    return r, p, case, acceptance, actual, docs


def rewrite_case(p, case, docs):
    raw = K.canonical(case)
    docs[Path(p['caseReference']['path'])] = raw
    p['caseReference']['sha256'] = K.sha(raw)


class Tests(unittest.TestCase):
    def test_exact_constructor_reversible_only_explicit_dispatch_and_kernel_pin(self):
        target = C.construct(BASE, RAW)
        text = target.decode().replace("PLANNING_CONFIG_V3_KERNEL_SHA256 = '" + K.sha(RAW) + "'\nPLANNING_ENABLE_V4_VERSION = 'cop-planning-enable-v4'",
                                     "PLANNING_CONFIG_V3_KERNEL_SHA256 = '" + K.LEGACY_SHA + "'")
        text = text.replace('PLANNING_CONFIG_V3_VERSION, PLANNING_ENABLE_V4_VERSION}\n\n\ndef node_metadata_transition',
                            'PLANNING_CONFIG_V3_VERSION}\n\n\ndef node_metadata_transition')
        text = text.replace('in {PLANNING_CONFIG_V3_VERSION, PLANNING_ENABLE_V4_VERSION}:', '== PLANNING_CONFIG_V3_VERSION:')
        self.assertEqual(text.encode(), BASE)
        compile(target, '<source-only>', 'exec')

    def test_constructor_refuses_other_base(self):
        with self.assertRaises(ValueError): C.construct(BASE + b'\n', RAW)

    def test_health_body_is_original_policy_not_rewritten(self):
        old = ast.parse(OLD)
        new = ast.parse(RAW)
        a = next(n for n in old.body if isinstance(n, ast.FunctionDef) and n.name == 'health_scope')
        b = next(n for n in new.body if isinstance(n, ast.FunctionDef) and n.name == '_fresh_health_scope')
        b.name = a.name
        self.assertEqual(ast.dump(a, include_attributes=False), ast.dump(b, include_attributes=False))
        expected_pin = next(n.value.value for n in old.body if isinstance(n, ast.Assign)
                            and any(isinstance(t, ast.Name) and t.id == 'HEALTH_MODULE_SHA' for t in n.targets))
        self.assertEqual(K.HEALTH_MODULE_SHA, expected_pin)
        self.assertEqual(K.sha((LEGACY / 'health_verify.py.txt').read_bytes()), expected_pin)

    def test_four_byte_functions_are_identical_to_frozen_v3(self):
        old = {n.name: n for n in ast.parse(OLD).body if isinstance(n, ast.FunctionDef)}
        new = {n.name: n for n in ast.parse(RAW).body if isinstance(n, ast.FunctionDef)}
        for name in ('environment_keys', 'toggle_flag', 'env_plan', 'compose_plan'):
            self.assertEqual(ast.dump(old[name], include_attributes=False), ast.dump(new[name], include_attributes=False))
        before = b'OTHER=unchanged\nCOP_ROUTING_PLANNING_ENABLED=false\nCOP_ROUTING_PLANNING_SERVICE_TOKEN=synthetic\n'
        after = K.toggle_flag(before, 'enable')
        self.assertTrue(K.env_plan(before, after, 'enable', None))
        self.assertEqual(K.toggle_flag(after, 'disable'), before)
        for invalid in ('provision', 'remove'):
            with self.assertRaises(K.Rejected): K.env_plan(before, after, invalid, None)
        with self.assertRaises(K.Rejected): K.env_plan(before, after + b'EXTRA=x\n', 'enable', None)
        duplicate = before + b'COP_ROUTING_PLANNING_ENABLED=false\n'
        with self.assertRaises(K.Rejected): K.env_plan(duplicate, after, 'enable', None)

    def test_synthetic_fresh_case_and_mutation_only_flag(self):
        r, p, c, a, before, docs = fixture()
        after = {**before, K.FLAG: 'true'}
        self.assertEqual(K.evidence(r, p), p)
        self.assertTrue(K.environment(r, before, after, p))
        self.assertEqual(before[K.FLAG], 'false')

    def test_one_reverse_requires_its_own_fresh_case(self):
        r, p, c, a, before, docs = fixture('disable')
        self.assertTrue(K.environment(r, before, {**before, K.FLAG: 'false'}, p))
        p['stage'] = 'enable'
        with self.assertRaises(K.Rejected): K.evidence(r, p)

    def test_other_environment_changes_and_missing_existing_credential_denied(self):
        _, _, _, _, before, _ = fixture()
        for key, value in [(K.TOKEN, 'rotated'), ('UNRELATED_SETTING', 'changed'), ('COP_ALLOW_LAB_TOKEN', 'true')]:
            with self.subTest(key=key), self.assertRaises(K.Rejected):
                K.effective_delta(before, {**before, K.FLAG: 'true', key: value}, 'enable')
        before.pop(K.TOKEN)
        with self.assertRaises(K.Rejected): K.effective_delta(before, {**before, K.FLAG: 'true'}, 'enable')

    def test_actual_environment_must_match_fresh_case_hash(self):
        r, p, c, a, before, docs = fixture()
        before['UNRELATED_SETTING'] = 'drift'
        with self.assertRaises(K.Rejected): K.environment(r, before, {**before, K.FLAG: 'true'}, p)

    def test_compose_other_service_network_mount_or_resource_change_denied(self):
        _, _, _, _, before, _ = fixture()
        render = {'services': {'cop-api': {'image': K.IMAGE, 'environment': before, 'volumes': ['unchanged']}, 'peer': {'image': 'unchanged'}}}
        desired = copy.deepcopy(render); desired['services']['cop-api']['environment'][K.FLAG] = 'true'
        self.assertTrue(K.protected_render(render, desired, 'enable'))
        for mutate in (lambda v: v['services']['peer'].update(image='other'),
                       lambda v: v['services']['cop-api'].update(volumes=[]),
                       lambda v: v.update(networks={'new': {}}),
                       lambda v: v['services']['cop-api'].update(mem_limit='other')):
            bad = copy.deepcopy(desired); mutate(bad)
            with self.assertRaises(K.Rejected): K.protected_render(render, bad, 'enable')

    def test_expired_case_not_retimed_and_historical_read_distinct(self):
        r, p, c, a, before, docs = fixture()
        r.datetime = type('Future', (), {'now': staticmethod(lambda tz: NOW + datetime.timedelta(hours=2))})
        with self.assertRaises(K.Rejected): K.evidence(r, p, True)
        self.assertEqual(K.evidence(r, p, False), p)

    def test_proof_outside_own_fresh_case_denied(self):
        r, p, c, a, before, docs = fixture()
        p['expiresAt'] = stamp(1000)
        with self.assertRaises(K.Rejected): K.schema(r, p)

    def test_legacy_guard_keeps_legacy_reader(self):
        r, p, c, a, before, docs = fixture()
        sentinel = object()
        delegate = types.SimpleNamespace(schema=lambda r, p: sentinel)
        with patch.object(K, 'legacy', return_value=delegate):
            self.assertIs(K.schema(r, {'contractVersion': K.LEGACY_VERSION}), sentinel)
        self.assertEqual(K.sha(OLD), K.LEGACY_SHA)

    def test_old_sim_or_source_or_failed_workflow_denied(self):
        for key, value in [('simImageId', 'sha256:' + '0'*64), ('simSourceRevision', '0'*40), ('workflowResults', ['PASS', 'FAIL'])]:
            r, p, c, a, before, docs = fixture()
            a[key] = value; raw = K.canonical(a)
            docs[Path(p['stageEvidence']['path'])] = raw
            p['stageEvidence']['sha256'] = K.sha(raw)
            c['acceptance'] = p['stageEvidence']; rewrite_case(p, c, docs)
            with self.subTest(key=key), self.assertRaises(K.Rejected): K.schema(r, p)

    def test_wrong_pointer_changed_key_or_source_metadata_denied(self):
        for key, value in [('changedKeys', [K.FLAG, K.TOKEN]), ('sourceEnvironmentMetadata', {}), ('sourceSpecSha256', 'f'*64)]:
            r, p, c, a, before, docs = fixture(); p[key] = value
            with self.subTest(key=key), self.assertRaises(K.Rejected): K.schema(r, p)

    def test_no_approval_no_acceptance_or_wrong_kernel_denied(self):
        for key, value in [('approvalRef', ''), ('acceptance', None), ('kernelSha256', 'a'*64)]:
            r, p, c, a, before, docs = fixture(); c[key] = value; rewrite_case(p, c, docs)
            with self.subTest(key=key), self.assertRaises(K.Rejected): K.schema(r, p)

    def test_duplicate_or_oversize_json_denied(self):
        for raw in (b'{"a":1,"a":2}', b' ' * 65537, b'{"a":NaN}'):
            with self.assertRaises(K.Rejected): K.parse(raw)

    def test_exact_parent_protections_and_inverse_parent_stage(self):
        for stage in ('enable', 'disable'):
            r, p, c, a, before, docs = fixture(stage)
            parent = {'contractVersion': K.LEGACY_VERSION if stage == 'enable' else K.VERSION,
                      'stage': 'provision' if stage == 'enable' else 'enable',
                      'checks': p['checks'], 'cleanReset': p['cleanReset'],
                      'environmentMetadata': p['sourceEnvironmentMetadata'],
                      'composeHashes': p['sourceComposeHashes']}
            origin = {'imageId': K.IMAGE, 'sourceRevision': K.SOURCE, 'profileId': K.PROFILE,
                      'accountErasureConfig': p['parentProof']}
            r.private_json = lambda path, uid: origin
            store = types.SimpleNamespace(root=Path('/synthetic/releases'), uid=1000,
                                          erasure_config_proof=lambda *args: ('a'*64, parent))
            binding = {**p['target'], 'profileId': K.PROFILE,
                       'previousReleaseId': p['previous']['releaseId'], 'composeHashes': p['composeHashes']}
            proof_path = r.PROFILES / K.PROFILE / ('account-erasure-' + p['transitionId'] + '.json')
            raw = K.canonical(p)
            self.assertEqual(K.read_proof(r, store, proof_path, raw, binding), (K.sha(raw), p))
            for key, wrong in [('checks', {'weakened': True}), ('cleanReset', {}),
                               ('environmentMetadata', {}), ('composeHashes', {}),
                               ('stage', 'disable')]:
                saved = parent[key]; parent[key] = wrong
                with self.subTest(stage=stage, key=key), self.assertRaises(K.Rejected):
                    K.read_proof(r, store, proof_path, raw, binding)
                parent[key] = saved
            origin['accountErasureConfig'] = {'path': 'foreign', 'sha256': '0'*64}
            with self.assertRaises(K.Rejected): K.read_proof(r, store, proof_path, raw, binding)

    def test_provision_or_remove_or_foreign_image_not_new_authority(self):
        for key, value in [('stage', 'provision'), ('stage', 'remove'), ('operation', 'reset'),
                           ('target', {'imageId': 'foreign'})]:
            r, p, c, a, before, docs = fixture(); p[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(K.Rejected): K.schema(r, p)

    def test_case_nonce_cannot_be_aliased_to_another_filename(self):
        r, p, c, a, before, docs = fixture()
        old = Path(p['caseReference']['path'])
        new = old.with_name('planning-enable-v4-case-' + 'f'*8 + '-ffff-4fff-8fff-' + 'f'*12 + '.json')
        docs[new] = docs[old]; p['caseReference']['path'] = str(new)
        with self.assertRaises(K.Rejected): K.schema(r, p)

    def test_fixed_proposal_never_loads_a_credential_adapter(self):
        names = ('docker-compose.yml', 'docker-compose.driver-measurements.yml',
                 'docker-compose.x5.yml', 'docker-compose.ai-router.yml')
        data = {Path('/srv/cop') / n: b'services: synthetic\n' for n in names}
        before = b'COP_ROUTING_PLANNING_ENABLED=false\nCOP_ROUTING_PLANNING_SERVICE_TOKEN=synthetic\n'
        data[Path('/srv/cop/.env')] = before
        r = types.SimpleNamespace(FILES=names, private_read=lambda p, uid, **kw: data[p])
        def denied(): raise AssertionError('credential adapter must not be loaded')
        store = types.SimpleNamespace(source=Path('/srv/cop'), uid=1000, planning_config_v3_credential_module=denied)
        proposal = ProposalModule.propose(r, store, K, 'enable')
        self.assertNotIn('synthetic', repr(proposal))
        self.assertEqual(proposal.compose_bytes(), {n: data[Path('/srv/cop') / n] for n in names})
        self.assertEqual(proposal.consume_environment(), K.toggle_flag(before, 'enable'))
        with self.assertRaises(ValueError): proposal.consume_environment()
        for stage in ('provision', 'remove'):
            with self.assertRaises(K.Rejected): ProposalModule.propose(r, store, K, stage)

    def test_inverse_preserves_entire_original_environment_not_just_token(self):
        r, p, c, a, before, docs = fixture('disable')
        before['UNRELATED_SETTING'] = 'unexpected drift'
        c['sourceEnvironmentSha256'] = K.sha(K.canonical(before))
        rewrite_case(p, c, docs)
        with self.assertRaises(K.Rejected): K.environment(r, before, {**before, K.FLAG: 'false'}, p)

    def test_actual_parent_shape_against_real_unchanged_legacy_validator(self):
        root = Path('/etc/vcode-cop-api-runtime')
        r = types.SimpleNamespace(PROFILES=root, private_read=lambda path, uid, **kw: OLD)
        ref = {'path': '/etc/vcode-cop-api-runtime/206c4507-5e00-458e-b0ee-4061309aa7a8/account-erasure-2bdb23a7-dd67-5045-8cc8-878119a6a227.json',
               'sha256': 'a6c324d6429d7e488265a2a5c891044fc84fde55af84016ade48d74977c18c92',
               'cleanScope': 'cop_sim_shared_identity_v1'}
        before = copy.deepcopy(ref)
        with self.assertRaises(Exception): K.legacy(r).reference(r, ref)
        K.legacy(r).reference(r, {k: ref[k] for k in ('path', 'sha256')})
        K.parent_reference(r, ref)
        self.assertEqual(ref, before)
        for extra in ({'cleanScope': 'foreign'}, {'authScope': 'foreign'}, {'extra': True}):
            with self.assertRaises(K.Rejected): K.parent_reference(r, {**ref, **extra})

    def test_clean_scope_is_preserved_through_case_and_parent_lineage(self):
        r, p, c, a, before, docs = fixture()
        K.schema(r, p)
        self.assertEqual(p['parentProof']['cleanScope'], 'cop_sim_shared_identity_v1')
        p['parentProof'] = {k: v for k, v in p['parentProof'].items() if k != 'cleanScope'}
        with self.assertRaises(K.Rejected): K.schema(r, p)


if __name__ == '__main__':
    unittest.main()
