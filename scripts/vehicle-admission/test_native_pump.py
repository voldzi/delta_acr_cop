import importlib.util
from pathlib import Path
import tempfile
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
        result = {'commandSHA256': 'a' * 64, 'status': self.status}
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


if __name__ == '__main__':
    unittest.main()
