"""Real temporary journal files, fake Docker; no host/DB/network/production I/O."""
import copy
import datetime
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent


def load(path):
    spec = importlib.util.spec_from_file_location('synthetic_pending_' + path.stem, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module


P = load(HERE / 'pending_return.py'); K = load(HERE / 'kernel.py')


class Harness:
    def __init__(self, root, after_up=True):
        self.root = root; self.calls = []; self.return_status = 'healthy'; self.return_restarts = 0
        self.fail_record = False; self.fail_commit = False; self.fail_up_after_create = False
        self.encode = lambda v: K.canonical(v) + b'\n'
        self.meta = {'device': 1, 'inode': 2, 'size': 3, 'mtimeNs': 4, 'ctimeNs': 5}
        self.old = {'releaseId': 'release-' + 'b'*32, 'imageId': K.OLD, 'sourceRevision': K.OLD_SOURCE,
                    'profileGeneration': K.PROFILE, 'profileId': K.PROFILE, 'driverContract': {'synthetic': True},
                    'composeHashes': {'compose.yml': 'a'*64}, 'legacyEnvPresence': None,
                    'accountErasureConfig': {'path': '/synthetic/old-proof.json', 'sha256': 'b'*64, 'cleanScope': 'cop_sim_shared_identity_v1'}}
        self.new = {**copy.deepcopy(self.old), 'releaseId': 'release-' + 'd'*32, 'imageId': K.NEW, 'sourceRevision': K.NEW_SOURCE,
                    'previousReleaseId': self.old['releaseId'],
                    'accountErasureConfig': {'path': '/synthetic/forward-proof.json', 'sha256': 'c'*64, 'cleanScope': 'cop_sim_shared_identity_v1'}}
        self.pointer = {'contractVersion': 'cop-api-runtime-active-v1', 'generation': 'f'*32,
                        'containerId': 'c'*64, 'releaseId': self.old['releaseId'], 'imageId': K.OLD,
                        'profileId': K.PROFILE, 'profileGeneration': K.PROFILE}
        self.original_pointer = copy.deepcopy(self.pointer)
        self.profile = {'directory': Path('/synthetic/profile'), 'values': {}, 'mode': 'tx'}
        self.peers = {'cop-web': 'same', 'cop-chat': 'same', 'cop-edge': 'same', 'cop-mcp': 'same'}
        self.current = self.container('e'*64 if after_up else 'c'*64, K.NEW if after_up else K.OLD,
                                      self.new['releaseId'] if after_up else self.old['releaseId'],
                                      status='unhealthy' if after_up else 'healthy', restarts=0 if after_up else 1)
        self.pending = {'contractVersion': 'cop-api-runtime-pending-v1', 'previous': self.pointer,
                        'targetReleaseId': self.new['releaseId'], 'targetContainerId': 'e'*64 if after_up else None,
                        'restoredContainerId': None, 'peers': self.peers}
        self.health = self.encode({'syntheticBaseline': 'healthy'})
        self.forward = {'contractVersion': K.VERSION, 'stage': 'forward', 'previous': self.pointer,
                        'parentProof': self.old['accountErasureConfig'], 'composeHashes': self.old['composeHashes'],
                        'environmentMetadata': self.meta, 'baselineSha256': K.sha(self.health)}
        self.original_pending = self.encode(self.pending)
        (root / 'pending.json').write_bytes(self.original_pending)
        (root / 'pending-health.json').write_bytes(self.health)
        adapter = b'def verify(r, baseline):\n r.verify_calls.append(1)\n return baseline, {"synthetic": True}\n'
        self.adapter_sha = K.sha(adapter)
        self.docs = {}
        self.r = types.SimpleNamespace(PROFILES=Path('/synthetic/profiles'), PROFILE_UUID=re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}'),
            PLANNING_CONFIG_V3_KERNEL_SHA256='1'*64, ADMISSION_PENDING_RETURN_SHA256='2'*64,
            datetime=datetime.datetime, timezone=datetime.timezone, verify_calls=[],
            fenced_timestamp=lambda v: datetime.datetime.fromisoformat(v).timestamp(),
            sha=K.sha, encoded=self.encode, fenced_public_source_spec=lambda v: {key: v[key] for key in ('Id', 'Image', 'Config')},
            environment_metadata=lambda *_: self.meta, health_statuses=lambda v: v,
            POST_EDGE_AUTH_SCOPE='synthetic', verify_api_diff=lambda *_args, **_kwargs: self.calls.append('parity'))
        adapter_path = self.r.PROFILES / K.PROFILE / ('planning-config-v3-health-' + self.adapter_sha + '.py')
        self.docs[adapter_path] = adapter
        def read(path, uid, **kwargs):
            return self.docs[Path(path)] if Path(path) in self.docs else Path(path).read_bytes()
        self.r.private_read = read
        self.docker = types.SimpleNamespace(current=lambda *_: copy.deepcopy(self.current), peers=lambda *_: copy.deepcopy(self.peers),
            live=self.live, image=lambda *_args, **_kwargs: self.calls.append('image'), config=lambda *_: {'services': {'cop-api': {}}},
            preserve=lambda *_: self.calls.append('preserve'), unchanged=self.unchanged, run=self.run,
            compose=lambda *_: ['docker', 'compose', '--project-name', 'cop'])
        self.store = types.SimpleNamespace(root=root, source=Path('/synthetic/cop'), uid=os.getuid(), docker=self.docker,
            binding=self.binding, pointer=lambda: copy.deepcopy(self.pointer), erasure_config_proof=lambda *_: ('c'*64, self.forward),
            guard=lambda: self.calls.append('guard'), protected_directory=lambda *_: None,
            check_mounts=lambda *_: self.calls.append('mount'), assert_erasure_environment=lambda *_: self.calls.append('env'),
            clean_runtime_values=lambda *_: {}, write=self.write, record_accepted_health=self.record,
            commit_pointer=self.commit, directory=self.directory, sync=lambda *_: None)

    def container(self, cid, image, release, status='healthy', restarts=0):
        return {'Id': cid, 'Image': image, 'RestartCount': restarts,
                'Config': {'Labels': {'com.cop.runtime.release': release, 'com.cop.runtime.profile-generation': K.PROFILE}},
                'State': {'Pid': 123, 'StartedAt': '2026-10-31T10:00:00Z', 'Running': True,
                          'Restarting': False, 'Health': {'Status': status}}}

    def binding(self, release, **kwargs):
        value = self.old if release == self.old['releaseId'] else self.new
        return self.root / release, copy.deepcopy(value), copy.deepcopy(self.profile)

    def live(self, directory, binding, profile):
        assert self.current['Image'] == binding['imageId']
        assert self.current['Config']['Labels']['com.cop.runtime.release'] == binding['releaseId']
        self.calls.append('live')

    def unchanged(self, directory, old):
        assert old == self.current
        self.calls.append('unchanged')

    def run(self, args):
        assert args == ['docker', 'compose', '--project-name', 'cop', 'up', '-d', '--force-recreate', '--no-build', '--pull', 'never', '--no-deps', 'cop-api']
        self.calls.append('up')
        self.current = self.container('9'*64, K.OLD, self.old['releaseId'], self.return_status, self.return_restarts)
        self.current['State']['StartedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        if self.fail_up_after_create: raise TimeoutError('SYNTHETIC_UP_OUTCOME_UNKNOWN')
        return b''

    def write(self, path, raw):
        Path(path).write_bytes(raw)

    def record(self, *_):
        if self.fail_record: raise ValueError('SYNTHETIC_HEALTH_RECORD_FAILURE')
        self.calls.append('health-record')

    def commit(self, binding, expected, cid):
        if self.fail_commit: raise ValueError('SYNTHETIC_PRE_COMMIT_FAILURE')
        assert self.pointer['generation'] == expected
        self.pointer = {**self.pointer, 'generation': '0'*32, 'containerId': cid}
        self.calls.append('commit')
        return copy.deepcopy(self.pointer)

    def directory(self, path, create=False):
        if create: Path(path).mkdir(parents=True, exist_ok=True)
        return Path(path)

    def authorize(self, operation, mode):
        value = P.propose(self.r, K, self.store, operation, mode)
        self.docs[Path(value['path'])] = value['document']
        return value

    def execute(self, value):
        proof = K.parse(value['document'])
        with patch.object(K, 'HEALTH', self.adapter_sha):
            return P.execute(self.r, K, self.store, value['path'], proof['activePointer']['generation'])


class Tests(unittest.TestCase):
    def test_both_pre_up_and_failed_new_target_return_with_original_journals_preserved(self):
        for after_up in (False, True):
            with self.subTest(after_up=after_up), tempfile.TemporaryDirectory() as directory:
                h = Harness(Path(directory), after_up)
                v = h.authorize('12345678-1234-4234-8234-123456789abc', 'start')
                result = h.execute(v)
                self.assertEqual(result['imageId'], K.OLD)
                self.assertEqual(result['containerId'], '9'*64)
                self.assertEqual(h.calls.count('up'), 1)
                self.assertEqual(h.current['RestartCount'], 0)
                archived = h.root / 'admission-return-history' / '12345678-1234-4234-8234-123456789abc'
                self.assertEqual((archived / 'pending.json').read_bytes(), h.original_pending)
                self.assertEqual((archived / 'pending-health.json').read_bytes(), h.health)
                self.assertFalse((h.root / 'pending.json').exists())
                self.assertFalse((h.root / P.JOURNAL).exists())
                self.assertEqual(h.calls.index('health-record') < h.calls.index('commit'), True)

    def test_changed_journal_peer_or_source_denied_before_any_recreate(self):
        for mutation in ('pending', 'health', 'peer', 'source', 'config', 'pair', 'expired', 'worker', 'pointer'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                h = Harness(Path(directory)); v = h.authorize('12345678-1234-4234-8234-123456789abc', 'start')
                if mutation == 'pending': (h.root / 'pending.json').write_bytes(h.original_pending + b'\n')
                elif mutation == 'health': (h.root / 'pending-health.json').write_bytes(h.health + b'\n')
                elif mutation == 'peer': h.peers['cop-edge'] = 'drift'
                elif mutation == 'source': h.current['RestartCount'] = 2
                elif mutation == 'config': h.current['Config']['extra'] = 'drift'
                elif mutation == 'pair': h.new['imageId'] = K.OLD
                elif mutation == 'pointer': h.pointer['generation'] = '3'*32
                elif mutation == 'worker': h.r.ADMISSION_PENDING_RETURN_SHA256 = '3'*64
                else: h.r.datetime = type('Future', (), {'now': staticmethod(lambda tz: datetime.datetime.now(tz) + datetime.timedelta(hours=2))})
                with self.assertRaises((ValueError, AssertionError)): h.execute(v)
                self.assertNotIn('up', h.calls)
                self.assertTrue((h.root / 'pending.json').exists())
                self.assertFalse((h.root / P.JOURNAL).exists())

    def test_unhealthy_or_restarted_return_never_commits_or_archives_original(self):
        for status, restarts in [('unhealthy', 0), ('healthy', 1)]:
            with self.subTest(status=status, restarts=restarts), tempfile.TemporaryDirectory() as directory:
                h = Harness(Path(directory)); h.return_status, h.return_restarts = status, restarts
                v = h.authorize('12345678-1234-4234-8234-123456789abc', 'start')
                with self.assertRaises(ValueError): h.execute(v)
                self.assertEqual(h.pointer, h.original_pointer)
                self.assertEqual((h.root / 'pending.json').read_bytes(), h.original_pending)
                self.assertTrue((h.root / P.JOURNAL).exists())
                self.assertEqual(h.calls.count('up'), 1)
                with self.assertRaises(ValueError): h.execute(v)
                self.assertEqual(h.calls.count('up'), 1)

    def test_crash_before_commit_finishes_without_another_recreate(self):
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(Path(directory)); h.fail_commit = True
            v = h.authorize('12345678-1234-4234-8234-123456789abc', 'start')
            with self.assertRaises(ValueError): h.execute(v)
            self.assertEqual(h.pointer, h.original_pointer)
            h.fail_commit = False
            fresh = h.authorize('22345678-1234-4234-8234-123456789abc', 'finish')
            result = h.execute(fresh)
            self.assertEqual(result['containerId'], '9'*64)
            self.assertEqual(h.calls.count('up'), 1)
            self.assertFalse((h.root / P.JOURNAL).exists())

    def test_crash_after_commit_finishes_without_new_pointer_or_recreate(self):
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(Path(directory)); v = h.authorize('12345678-1234-4234-8234-123456789abc', 'start')
            original_directory = h.store.directory
            def fail_history(path, create=False):
                if Path(path).name == 'admission-return-history': raise ValueError('SYNTHETIC_AFTER_COMMIT_CRASH')
                return original_directory(path, create)
            h.store.directory = fail_history
            with self.assertRaises(ValueError): h.execute(v)
            pointer = copy.deepcopy(h.pointer); self.assertNotEqual(pointer, h.original_pointer)
            h.store.directory = original_directory
            fresh = h.authorize('22345678-1234-4234-8234-123456789abc', 'finish')
            result = h.execute(fresh)
            self.assertEqual(result, pointer)
            self.assertEqual(h.calls.count('up'), 1)
            self.assertEqual(h.calls.count('commit'), 1)

    def test_worker_transport_routes_only_to_dedicated_guard_method(self):
        worker = load(HERE / 'worker.py'); calls = []
        store = types.SimpleNamespace(revert_admission_pending=lambda *args: calls.append(args) or {'synthetic': True})
        result = worker.return_pending(None, store, '/synthetic/proof.json', 'expected')
        self.assertEqual(calls, [(Path('/synthetic/proof.json'), 'expected')])
        self.assertEqual(result, {'synthetic': True})

    def test_up_timeout_never_retries_and_requires_explicit_root_adoption(self):
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(Path(directory)); h.fail_up_after_create = True
            v = h.authorize('12345678-1234-4234-8234-123456789abc', 'start')
            with self.assertRaises(TimeoutError): h.execute(v)
            self.assertEqual(h.calls.count('up'), 1)
            self.assertEqual(K.parse((h.root / P.JOURNAL).read_bytes())['targetContainerId'], None)
            self.assertEqual((h.root / 'pending.json').read_bytes(), h.original_pending)
            with self.assertRaises(ValueError): h.authorize('22345678-1234-4234-8234-123456789abc', 'finish')
            fresh = h.authorize('32345678-1234-4234-8234-123456789abc', 'adopt-finish')
            h.fail_up_after_create = False
            result = h.execute(fresh)
            self.assertEqual(result['containerId'], '9'*64)
            self.assertEqual(h.calls.count('up'), 1)

    def test_adoption_rejects_stale_start_time_foreign_cid_or_tampered_original_authority(self):
        for mutation in ('time', 'original', 'source'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                h = Harness(Path(directory)); h.fail_up_after_create = True
                v = h.authorize('12345678-1234-4234-8234-123456789abc', 'start')
                with self.assertRaises(TimeoutError): h.execute(v)
                if mutation == 'time': h.current['State']['StartedAt'] = '2020-01-01T00:00:00Z'
                elif mutation == 'source': h.current['Config']['Labels']['com.cop.runtime.release'] = 'foreign'
                else: h.docs[Path(v['path'])] += b'\n'
                with self.assertRaises((ValueError, AssertionError)):
                    h.authorize('22345678-1234-4234-8234-123456789abc', 'adopt-finish')
                self.assertEqual(h.calls.count('up'), 1)

    def test_partial_archive_after_each_original_rename_finishes_without_recreate(self):
        for fail_after in ('pending.json', 'pending-health.json'):
            with self.subTest(fail_after=fail_after), tempfile.TemporaryDirectory() as directory:
                h = Harness(Path(directory)); v = h.authorize('12345678-1234-4234-8234-123456789abc', 'start')
                original_replace = os.replace
                def fail_once(source, destination):
                    original_replace(source, destination)
                    if Path(source).name == fail_after: raise ValueError('SYNTHETIC_PARTIAL_ARCHIVE')
                with patch.object(P.os, 'replace', side_effect=fail_once), self.assertRaises(ValueError): h.execute(v)
                pointer = copy.deepcopy(h.pointer)
                self.assertTrue((h.root / P.JOURNAL).exists())
                fresh = h.authorize('22345678-1234-4234-8234-123456789abc', 'finish')
                self.assertEqual(h.execute(fresh), pointer)
                self.assertEqual(h.calls.count('up'), 1)
                self.assertEqual(h.calls.count('commit'), 1)
                archive = h.root / 'admission-return-history' / '12345678-1234-4234-8234-123456789abc'
                self.assertEqual((archive / 'pending.json').read_bytes(), h.original_pending)
                self.assertEqual((archive / 'pending-health.json').read_bytes(), h.health)
                self.assertFalse((h.root / P.JOURNAL).exists())

    def test_crash_after_final_rename_is_already_restored_and_unlatched(self):
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(Path(directory)); v = h.authorize('12345678-1234-4234-8234-123456789abc', 'start')
            original_replace = os.replace
            def fail_final(source, destination):
                original_replace(source, destination)
                if Path(source).name == P.JOURNAL: raise ValueError('SYNTHETIC_AFTER_FINAL_MOVE')
            with patch.object(P.os, 'replace', side_effect=fail_final), self.assertRaises(ValueError): h.execute(v)
            self.assertEqual(h.pointer['containerId'], '9'*64)
            self.assertEqual(h.current['RestartCount'], 0)
            self.assertEqual(h.current['State']['Health']['Status'], 'healthy')
            self.assertFalse((h.root / 'pending.json').exists())
            self.assertFalse((h.root / P.JOURNAL).exists())
            archive = h.root / 'admission-return-history' / '12345678-1234-4234-8234-123456789abc'
            self.assertEqual((archive / 'pending.json').read_bytes(), h.original_pending)
            self.assertEqual((archive / 'pending-health.json').read_bytes(), h.health)
            self.assertTrue((archive / P.JOURNAL).is_file())
            self.assertEqual(h.calls.count('up'), 1)

    def test_actual_derived_guard_loads_exact_worker_and_preserves_ordinary_latch(self):
        ctor = load(HERE / 'constructor.py')
        old_ctor = load(HERE.parent / 'planning-enable-v4/constructor.py')
        old = old_ctor.construct((HERE.parent / 'planning-enable-v4/fixtures/cop-api-runtime.pg-reconnect.py.txt').read_bytes(),
                                 (HERE.parent / 'planning-enable-v4/kernel.py').read_bytes())
        worker_raw = (HERE / 'pending_return.py').read_bytes()
        derived = ctor.construct(old, (HERE / 'kernel.py').read_bytes(), worker_raw)
        module = types.ModuleType('actual_derived_guard_synthetic')
        exec(compile(derived, '<actual-derived-source-only>', 'exec'), module.__dict__)
        with tempfile.TemporaryDirectory() as directory:
            h = Harness(Path(directory))
            h.r.ADMISSION_PENDING_RETURN_SHA256 = K.sha(worker_raw)
            worker_path = h.r.PROFILES / K.PROFILE / ('admission-pending-return-worker-' + K.sha(worker_raw) + '.py')
            h.docs[worker_path] = worker_raw
            h.store.protected_root = h.r.PROFILES
            h.store.post_edge_runtime = lambda: h.r
            h.store.planning_config_v3_module = lambda: K
            module.private_read = h.r.private_read
            v = h.authorize('12345678-1234-4234-8234-123456789abc', 'start')
            with patch.object(K, 'HEALTH', h.adapter_sha):
                result = module.Store.revert_admission_pending(h.store, Path(v['path']), h.pointer['generation'])
            self.assertEqual(result['imageId'], K.OLD)
            self.assertEqual(h.calls.count('up'), 1)
            # The new latch is an ADDITION; generic recover/rollback remains its
            # complete original byte sequence (also covered by reversibility).
            (h.root / P.JOURNAL).write_bytes(b'{}')
            with self.assertRaises(module.RuntimeError): module.Store.clean(h.store)


if __name__ == '__main__': unittest.main()
