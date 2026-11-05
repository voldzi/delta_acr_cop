import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


p, s = load('native_pump'), load('server_steps')
RUN = '11111111-1111-4111-8111-111111111111'


class FakeSpool:
    def __init__(self, root):
        self.root, self.run_id = Path(root), RUN
        self.published, self.failure, self.status = [], False, 'passed'
        (self.root / 'commands').mkdir()
        (self.root / 'results').mkdir()

    def publish(self, command):
        self.published.append(command)
        if self.failure:
            raise OSError('simulated publication uncertainty')
        return 'a' * 64

    def result(self, command):
        result = {'commandSHA256': 'a' * 64, 'status': self.status, 'processId': 123}
        return result, {'action': command['action'], 'status': self.status}


class NativePump(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve())
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.spool = FakeSpool(self.root)
        (self.root / 'private').mkdir(mode=0o700)
        self.clock = 100
        self.window = True
        self.pump = p.Pump(self.spool, s.Journal(self.root / 'private'), s, 130,
            lambda: self.window, now=lambda: self.clock, monotonic=lambda: self.clock,
            sleep=lambda n: setattr(self, 'clock', self.clock + n))

    def test_native_observation_cannot_be_aggregate_case_or_notification_pass(self):
        self.pump.request('stable-binding', 'a', 'preflight_actor')
        out = self.pump.public_observations()
        self.assertFalse(out['aggregatePass'])
        self.assertEqual(out['nativeStages'], [{'action': 'preflight_actor', 'status': 'passed'}])

    def test_publication_uncertainty_is_durable_stop_without_second_command(self):
        self.spool.failure = True
        with self.assertRaises(OSError): self.pump.request('stable-binding', 'a', 'bootstrap_actor')
        with self.assertRaises(ValueError): self.pump.request('stable-binding', 'a', 'bootstrap_actor')
        self.assertEqual(len(self.spool.published), 1)
        self.assertTrue((self.root / 'private/coordinator-0001-intent.json').is_file())

    def test_failed_or_missing_stage_cannot_allow_next_sequence(self):
        self.spool.status = 'not_observed'
        with self.assertRaises(ValueError): self.pump.request('notifications', 'a', 'preflight_actor')
        self.assertTrue(self.pump.blocked)
        self.assertEqual(self.pump.sequence, 1)

    def test_timeout_stays_unproven_without_retry(self):
        self.spool.result = lambda _: None
        with self.assertRaises(ValueError): self.pump.request('stable-binding', 'a', 'preflight_actor')
        self.assertEqual(len(self.spool.published), 1)
        self.assertTrue(self.pump.blocked)

    def test_checkpoint_requires_process_cursor_reconciliation(self):
        self.pump.request('pending-restart', 'a', 'checkpoint_exit')
        with self.assertRaises(ValueError): self.pump.request('pending-restart', 'a', 'preflight_actor')

    def test_no_arbitrary_command_or_fields_and_closed_window_has_no_effect(self):
        for action, fields in (('http', {'url': 'https://other.test'}), ('preflight_actor', {'token': 'bad'})):
            with self.assertRaises(ValueError): self.pump.request('stable-binding', 'a', action, **fields)
        self.window = False
        with self.assertRaises(ValueError): self.pump.request('stable-binding', 'a', 'preflight_actor')
        self.assertEqual(self.spool.published, [])

    def test_existing_spool_cannot_be_silently_adopted(self):
        (self.root / 'commands/0001.json').write_text('prior')
        with self.assertRaises(ValueError):
            p.Pump(self.spool, s.Journal(self.root / 'private'), s, 130, lambda: True)

    def checkpoint_fixture(self, large_text=None):
        """Synthetic producer/process observations only; no native execution."""
        for folder in ('commands', 'results'):
            (self.root / folder).chmod(0o700)
        s.Journal(self.root).save('fixture.json', {'synthetic': True})
        fixture_sha = hashlib.sha256(s.private_read(self.root / 'fixture.json')).hexdigest()
        def publish(command):
            stem = f'{command["sequence"]:04d}.json'
            s.Journal(self.root / 'commands').save(stem, command)
            return hashlib.sha256(s.private_read(self.root / 'commands' / stem)).hexdigest()
        def result(command):
            stem = f'{command["sequence"]:04d}.json'
            target = self.root / 'results' / stem
            if not target.exists():
                value = {'contractVersion': 'jizda-vehicle-native-result-v1', 'runId': RUN,
                    'sequence': command['sequence'], 'commandId': command['id'],
                    'commandSHA256': hashlib.sha256(s.private_read(self.root / 'commands' / stem)).hexdigest(),
                    'caseID': command['caseID'], 'action': command['action'], 'status': 'passed',
                    'reasonCode': 'STAGE_OBSERVED', 'processId': 123}
                if command['action'] == 'resolve_conversation' and large_text is not None:
                    value['binding'] = {'conversation': {'metadata': {'synthetic': large_text}}}
                # Model the producer's native UTF-8 JSON, not Python's escaped
                # canonical copy in the coordinator journal.
                target.write_bytes(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode())
                target.chmod(0o600)
            value = s.parse(s.private_read(target, bound=p.NATIVE_WIRE_BOUND))
            return value, {'action': command['action'], 'status': value['status']}
        self.spool.publish, self.spool.result = publish, result
        if large_text is not None:
            self.pump.request('stable-binding', 'a', 'resolve_conversation',
                operationId='44444444-4444-4444-8444-444444444444',
                membershipRevision=1, expectedResolution='ready')
        command, _ = self.pump.request('pending-restart', 'a', 'checkpoint_exit')
        proof = {'run_id': RUN, 'checkpoint_id': command['id'], 'next_sequence': self.pump.sequence,
            'old_process_id': 123, 'new_process_id': 124,
            'old_launch_id': '22222222-2222-4222-8222-222222222222',
            'new_launch_id': '33333333-3333-4333-8333-333333333333',
            'fixture_sha256': fixture_sha, 'receipt_sha256': 'a' * 64}
        self.spool.observe_resume = lambda _: SimpleNamespace(**proof)
        return command, proof

    def test_explicit_resume_reconciles_own_journal_without_assigning_caller_cursor(self):
        command, _ = self.checkpoint_fixture()
        self.assertIsNone(self.pump.resume(command))
        self.assertEqual(self.pump.sequence, 2)
        self.assertEqual(self.pump.expected_process_id, 124)
        self.assertFalse(self.pump.checkpointed)
        self.assertTrue((self.root / 'private' / ('native-resume-' + command['id'] + '.json')).is_file())
        self.assertFalse(self.pump.public_observations()['aggregatePass'])
        self.assertNotIn('124', str(self.pump.public_observations()))
        with self.assertRaises(ValueError): self.pump.resume(command)

    def test_resume_missing_or_modified_own_observation_is_not_native_authority(self):
        command, _ = self.checkpoint_fixture()
        path = self.root / 'private/coordinator-0001-observation.json'
        value = s.parse(s.private_read(path));value['processId'] = 999
        path.write_bytes(s.canonical(value))
        with self.assertRaises(ValueError): self.pump.resume(command)
        self.assertTrue(self.pump.checkpointed)

    def test_resume_does_not_accept_exit_boolean_or_foreign_cursor(self):
        command, proof = self.checkpoint_fixture()
        proof['processExited'] = True
        with self.assertRaises(ValueError): self.pump.resume(command)
        proof.pop('processExited');proof['next_sequence'] = 20
        with self.assertRaises(ValueError): self.pump.resume(command)
        self.assertEqual(self.pump.sequence, 2)
        self.assertTrue(self.pump.checkpointed)

    def test_resume_rejects_prefix_drift_during_process_observation(self):
        command, proof = self.checkpoint_fixture()
        def drift(_):
            path = self.root / 'private/coordinator-0001-intent.json'
            path.write_bytes(s.private_read(path) + b' ')
            return SimpleNamespace(**proof)
        self.spool.observe_resume = drift
        with self.assertRaises(ValueError): self.pump.resume(command)
        self.assertTrue(self.pump.checkpointed)

    def test_old_native_process_cannot_satisfy_next_stage_after_resume(self):
        command, _ = self.checkpoint_fixture()
        self.pump.resume(command)
        with self.assertRaises(ValueError): self.pump.request('pending-restart', 'a', 'preflight_actor')
        self.assertEqual(self.pump.sequence, 2)
        self.assertTrue(self.pump.blocked)

    def test_finish_never_authorizes_resume(self):
        command, _ = self.pump.request('lifecycle', 'a', 'finish')
        with self.assertRaises(ValueError): self.pump.resume(command)

    def assert_large_prefix_resume(self, text):
        command, _ = self.checkpoint_fixture(large_text=text)
        native = self.root / 'results/0001.json'
        own = self.root / 'private/coordinator-0001-observation.json'
        self.assertGreater(native.stat().st_size, 65536)
        self.assertLessEqual(native.stat().st_size, p.NATIVE_WIRE_BOUND)
        self.assertLessEqual(own.stat().st_size, p.OWN_CANONICAL_BOUND)
        with self.assertRaises(ValueError): s.private_read(native)  # Default unchanged.
        self.pump.resume(command)
        self.assertFalse(self.pump.checkpointed)
        self.assertEqual(self.pump.sequence, 3)
        self.assertFalse(self.pump.public_observations()['aggregatePass'])

    def test_accepted_large_ascii_result_reconciles_on_both_reads(self):
        self.assert_large_prefix_resume('A' * 70000)

    def test_native_utf8_unicode_has_larger_finite_canonical_journal(self):
        self.assert_large_prefix_resume('á' * 50000)
        self.assertGreater((self.root / 'private/coordinator-0001-observation.json').stat().st_size,
                           p.NATIVE_WIRE_BOUND)

    def test_del_escape_expansion_is_covered_by_sixfold_finite_bound(self):
        self.assert_large_prefix_resume('\x7f' * 70000)
        self.assertGreater((self.root / 'private/coordinator-0001-observation.json').stat().st_size,
                           p.NATIVE_WIRE_BOUND)

    def test_wire_bound_still_rejects_oversize_native_file(self):
        target = self.root / 'results/0001.json'
        target.write_bytes(b' ' * (p.NATIVE_WIRE_BOUND + 1));target.chmod(0o600)
        with self.assertRaises(ValueError): self.pump._prefix_read(target)


if __name__ == '__main__':
    unittest.main()
