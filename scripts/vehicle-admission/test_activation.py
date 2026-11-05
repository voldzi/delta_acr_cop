"""Finite activation/expiry/source-boundary tests, without host mutations."""
import base64
import copy
import datetime
import hashlib
import importlib.util
import json
import re
import os
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest

HERE = Path(__file__).parent


def load(name):
    spec = importlib.util.spec_from_file_location('activation_test_' + name, HERE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


c, k, i, control = load('contract'), load('kernel'), load('install_activation'), load('activation')
fixtures = load('test_kernel')


def release(now=1000):
    return {'contractVersion': 'cop-global-vehicle-admission-release-v1',
        'windowId': '12345678-1234-4234-8234-123456789abc', 'approvedManifestSha256': 'a' * 64,
        'scope': 'global_authorized_vehicle_members', 'purpose': 'human_requested_activation',
        'admissionLifetime': 'until_explicit_disable', 'approvedAt': now, 'activateBefore': now + 3600,
        'releaseClientGateRemainsOff': True, 'debugClientMayBeEnabled': True,
        'containment': 'close_cop_then_messaging_keep_cleanup_writers'}


class Activation(unittest.TestCase):
    def test_release_does_not_need_or_mint_synthetic_identity_authority(self):
        result = c.validate_window(release(), 1001, opening=True)
        self.assertEqual(result['admissionLifetime'], 'until_explicit_disable')
        self.assertNotIn('actorIds', result)
        self.assertNotIn('cases', result)
        for change in ({'scope': 'only_my_car'}, {'actorIds': []}, {'releaseClientGateRemainsOff': False},
                       {'admissionLifetime': 'forever_root_configuration_access'}, {'activateBefore': 4601}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                c.validate_window({**release(), **change}, 1001, opening=True)

    def test_only_entry_authority_expires_and_disable_stays_possible(self):
        with self.assertRaises(ValueError): c.validate_window(release(), 4600, opening=True)
        self.assertEqual(c.validate_window(release(), 9000, opening=False)['admissionLifetime'],
                         'until_explicit_disable')

    def test_live_source_file_modes_are_explicit_without_changing_private_default(self):
        observed = []
        runtime = SimpleNamespace(private_read=lambda path, uid, **kw: observed.append((path.name, uid, kw)) or b'')
        for name in c.SOURCE_COMPOSE_MODES:
            c.read_source(runtime, Path('/srv/cop'), 1000, name)
        c.read_source(runtime, Path('/srv/cop'), 1000, '.env')
        self.assertEqual([x[2]['mode'] for x in observed], [0o644, 0o664, 0o600, 0o600, 0o600])
        self.assertTrue(all(x[1] == x[2]['gid'] == 1000 for x in observed))
        with self.assertRaises(ValueError): c.read_source(runtime, Path('/srv/other'), 1000, '.env')
        with self.assertRaises(ValueError): c.read_source(runtime, Path('/srv/cop'), 1000, '../other')

    def prepared(self):
        f = fixtures.WindowKernel()
        f.setUp()
        authority = {**release(f.now - 7200), 'contractVersion': 'cop-root-vehicle-admission-release-v1'}
        authority['windowId'] = f.id
        f.docs[f.wpath] = k.encode(authority)
        f.p['windowReference']['sha256'] = k.sha(f.docs[f.wpath])
        f.c['windowReference'] = copy.deepcopy(f.p['windowReference'])
        f.p['checkedAt'] = datetime.datetime.fromtimestamp(f.now - 7200, datetime.timezone.utc).isoformat()
        f.p['expiresAt'] = datetime.datetime.fromtimestamp(f.now - 6300, datetime.timezone.utc).isoformat()
        f.c.update(checkedAt=f.p['checkedAt'], expiresAt=f.p['expiresAt'])
        f.freeze()
        return f

    def test_accepted_release_remains_readable_after_both_entry_and_transition_expiry(self):
        f = self.prepared()
        f.r.IMAGE = re.compile('sha256:[a-f0-9]{64}')
        f.r.REVISION = re.compile('[a-f0-9]{40}')
        with self.assertRaises(ValueError): k.evidence(f.r, f.p, True)
        binding = {**f.p['target'], 'profileId': k.PROFILE,
                   'previousReleaseId': f.p['previous']['releaseId']}
        value = k.read_proof(f.r, SimpleNamespace(root=Path('/state'), uid=1000),
            f.profile / ('account-erasure-' + f.id + '.json'), k.encode(f.p), binding)
        self.assertEqual(value[1], f.p)

    def ordinary_child(self):
        f = self.prepared()
        f.r.IMAGE = re.compile('sha256:[a-f0-9]{64}')
        f.r.REVISION = re.compile('[a-f0-9]{40}')
        # Actual unchanged c74 reader, not a stand-in implementation.
        parent_source = (HERE.parent / 'self-deploy/kernel.py').read_bytes()
        self.assertEqual(hashlib.sha256(parent_source).hexdigest(), k.PARENT)
        f.docs[f.profile / ('planning-config-v3-kernel-' + k.PARENT + '.py')] = parent_source
        parent_path = f.profile / ('account-erasure-' + f.id + '.json')
        parent_raw = k.encode(f.p)
        f.docs[parent_path] = parent_raw
        parent_ref = {'path': str(parent_path), 'sha256': k.sha(parent_raw)}
        predecessor = 'release-' + 'd' * 32
        old_release = {'imageId': k.IMAGE, 'accountErasureConfig': parent_ref}
        old_raw = k.encode(old_release)
        f.docs[Path('/state/releases') / predecessor / 'release.json'] = old_raw
        child_id = '22345678-1234-4234-8234-123456789abc'
        target = {'imageId': 'sha256:' + 'e' * 64, 'sourceRevision': 'f' * 40, 'profileGeneration': k.PROFILE}
        stamp = lambda seconds: datetime.datetime.fromtimestamp(seconds, datetime.timezone.utc).isoformat()
        proof = {'contractVersion': k.VERSION, 'transitionId': child_id, 'operation': 'maintain',
            'previous': {**f.p['previous'], 'releaseId': predecessor}, 'target': target,
            'changedKeys': [], 'ownerAcceptance': True, 'checks': f.p['checks'], 'cleanReset': f.p['cleanReset'],
            'parentProof': parent_ref, 'environmentMetadata': f.p['environmentMetadata'],
            'composeHashes': f.p['composeHashes'], 'checkedAt': stamp(f.now - 1), 'expiresAt': stamp(f.now + 899),
            'sourceSpecSha256': 'b' * 64, 'baselineSha256': 'c' * 64}
        compatibility = {'contractVersion': 'cop-application-image-compatibility-v1', 'target': target,
            'checks': dict.fromkeys(('x5RuntimeGuard', 'sharpConversion', 'databaseRouting',
                                    'actualImageTests', 'sameRuntimeEnvironment', 'sameTopology'), True),
            'sourceContextDigest': 'd' * 64, 'buildReceiptSha256': 'e' * 64}
        comp_path = f.profile / ('application-image-compatibility-' + child_id + '.json')
        f.docs[comp_path] = k.encode(compatibility)
        case = {'contractVersion': 'cop-application-image-case-v1', 'caseId': child_id,
            'approvalRef': 'cop-application-self-release-policy-v1',
            **{key: copy.deepcopy(proof[key]) for key in ('previous', 'target', 'parentProof',
                'environmentMetadata', 'composeHashes', 'sourceSpecSha256', 'baselineSha256', 'checkedAt', 'expiresAt')},
            'sourceEnvironmentSha256': k.sha(k.encode(f.target) + b'\n'), 'parentReleaseSha256': k.sha(old_raw),
            'sourceProcess': {'pid': 123, 'restartCount': 0, 'startedAt': 'fixed-start', 'running': True},
            'compatibilityReference': {'path': str(comp_path), 'sha256': k.sha(f.docs[comp_path])}}
        case_path = f.profile / ('application-image-case-' + child_id + '.json')
        f.docs[case_path] = k.encode(case)
        proof['caseReference'] = {'path': str(case_path), 'sha256': k.sha(f.docs[case_path])}
        return f, proof

    def test_real_image_only_reader_accepts_historical_admission_parent_after_expiry(self):
        f, proof = self.ordinary_child()
        # r.encoded in production includes the trailing newline.
        f.r.encoded = lambda value: k.encode(value) + b'\n'
        k.evidence(f.r, proof, True)
        binding = {**proof['target'], 'profileId': k.PROFILE,
                   'previousReleaseId': proof['previous']['releaseId']}
        self.assertEqual(k.read_proof(f.r, SimpleNamespace(root=Path('/state'), uid=1000),
            f.profile / ('account-erasure-' + proof['transitionId'] + '.json'), k.encode(proof), binding)[1], proof)
        k.environment(f.r, f.target, f.target, proof)
        with self.assertRaises(ValueError):
            k.environment(f.r, f.target, {**f.target, k.FLAG: 'false'}, proof)

    def test_disable_authority_can_be_fresh_even_when_entry_has_expired(self):
        f = self.prepared()
        f.p['stage'] = f.c['stage'] = 'close'
        f.p['checkedAt'] = f.c['checkedAt'] = datetime.datetime.fromtimestamp(f.now - 1, datetime.timezone.utc).isoformat()
        f.p['expiresAt'] = f.c['expiresAt'] = datetime.datetime.fromtimestamp(f.now + 899, datetime.timezone.utc).isoformat()
        f.p['sourceComposeHashes'] = copy.deepcopy(f.p['composeHashes'])
        f.c['sourceComposeHashes'] = copy.deepcopy(f.p['composeHashes'])
        f.freeze()
        k.evidence(f.r, f.p, True)

    def test_payload_is_only_public_frozen_python_assets_and_exact_baseline(self):
        files = {name + '.py': base64.b64encode((HERE / (name + '.py')).read_bytes()).decode() for name in i.NAMES}
        value = {'contractVersion': 'cop-vehicle-admission-root-payload-v1',
            'windowId': release()['windowId'], 'scope': release()['scope'],
            'admissionLifetime': release()['admissionLifetime'],
            'baselineCop': {'containerId': i.COP_CID, 'generation': i.GENERATION,
                'imageId': c.COP_IMAGE, 'profileGeneration': '206c4507-5e00-458e-b0ee-4061309aa7a8'},
            'baselineMessagingCanonicalDigest': 'a' * 64, 'expectedGuardSha256': 'b' * 64,
            'expectedPolicySha256': 'c' * 64, 'assets': files}
        raw = c.encode(value)
        self.assertEqual(i.payload(raw, i.sha(raw))[0], value)
        for change in ({'scope': 'all_root_commands'}, {'assets': {**files, '../escape.py': ''}}):
            mutated = c.encode({**value, **change})
            with self.assertRaises(RuntimeError): i.payload(mutated, i.sha(mutated))

    def test_later_writer_cannot_be_replaced_or_disabled_by_this_old_image_grant(self):
        m = {'contract': c, 'messaging': SimpleNamespace(IMAGE=c.MESSAGING_IMAGE)}
        for host, image in [('docker', c.COP_IMAGE), ('comm', c.MESSAGING_IMAGE)]:
            control.require_supported_image({'host': host}, m, {'imageId': image})
            with self.assertRaises(RuntimeError):
                control.require_supported_image({'host': host}, m, {'imageId': 'sha256:' + 'f' * 64})

    def test_public_installer_metadata_round_trip_preserves_permissions_and_owner(self):
        with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as tmp:
            target = Path(tmp) / 'public-guard.py'
            target.write_bytes(b'original public code\n');target.chmod(0o640)
            before = target.stat()
            i.replace(target, b'original public code\n', b'reviewed public code\n', os.getuid())
            self.assertEqual(target.read_bytes(), b'reviewed public code\n')
            after = target.stat()
            self.assertEqual((after.st_uid, after.st_gid, after.st_mode & 0o777),
                             (before.st_uid, before.st_gid, before.st_mode & 0o777))
            i.replace(target, b'reviewed public code\n', b'original public code\n', os.getuid())
            self.assertEqual(target.read_bytes(), b'original public code\n')

    def test_installer_metadata_cas_rejects_changed_parent_without_overwrite(self):
        with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as tmp:
            target = Path(tmp) / 'public-policy.json'
            target.write_bytes(b'different current policy');target.chmod(0o600)
            with self.assertRaises(RuntimeError):
                i.replace(target, b'old policy', b'new policy', os.getuid())
            self.assertEqual(target.read_bytes(), b'different current policy')


if __name__ == '__main__':
    unittest.main()
