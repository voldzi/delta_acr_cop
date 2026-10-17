import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('edge_reset', Path(__file__).parents[1] / 'account-safety/clean-reset-edge.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Admission:
    def __init__(self, fail_at=None):
        self.calls = 0
        self.fail_at = fail_at

    def assert_current(self):
        self.calls += 1
        if self.calls == self.fail_at:
            raise RuntimeError('SYNTHETIC_ADMISSION_LOST')


class EdgeResetTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='cop-edge-reset-test-', dir='/private/tmp')
        self.root = Path(self.tmp.name)
        os.chmod(self.root, 0o700)
        self.path = self.root / 'state.json'
        self.state = {'contractVersion': 'cop-edge-node-state-v1',
                      'node': {'nodeId': 'synthetic-edge', 'nodeName': 'Synthetic', 'classificationMax': 'INTERNAL',
                               'softwareVersion': 'synthetic', 'lastHeartbeatAt': '2026-10-17T00:00:00Z'},
                      'cursor': {'lastAckedOffset': 6, 'lastReplayAt': '2026-10-17T00:00:00Z'},
                      'sync': {'lastError': 'synthetic old user detail', 'lastSyncAt': None, 'mode': 'OFFLINE'},
                      'updatedAt': '2026-10-17T00:00:00Z',
                      'inboundEvents': [{'event': {'body': 'synthetic old personal detail'}}],
                      'outbox': [{'event': {'body': 'synthetic pending user event'}}], 'deadLetters': []}
        self.path.write_text(json.dumps(self.state))
        os.chmod(self.path, 0o640)

    def tearDown(self):
        self.tmp.cleanup()

    def test_removes_all_event_copies_and_operational_details_preserving_config_and_file_access(self):
        before = m.inspect_edge_reset(self.root, True)
        result = m.apply_edge_reset(before, Admission(), self.root, True)
        after = json.loads(self.path.read_text())
        self.assertTrue(result['configurationPreserved'])
        self.assertFalse(result['oldDataBackupCreated'])
        self.assertNotIn('synthetic old', self.path.read_text())
        self.assertEqual(after['cursor'], {'lastAckedOffset': 0, 'lastReplayAt': None})
        self.assertEqual(after['node']['nodeName'], self.state['node']['nodeName'])
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o640)
        self.assertEqual(list(x.name for x in self.root.iterdir()), ['state.json'])

    def test_lost_admission_before_atomic_replace_leaves_original_and_no_backup_or_tempfile(self):
        original = self.path.read_bytes()
        with self.assertRaisesRegex(RuntimeError, 'SYNTHETIC_ADMISSION_LOST'):
            m.apply_edge_reset(m.inspect_edge_reset(self.root, True), Admission(2), self.root, True)
        self.assertEqual(self.path.read_bytes(), original)
        self.assertEqual(list(x.name for x in self.root.iterdir()), ['state.json'])

    def test_changed_state_is_rejected_before_removing_any_copy(self):
        before = m.inspect_edge_reset(self.root, True)
        self.state['outbox'].append({'event': {'body': 'synthetic concurrent update'}})
        self.path.write_text(json.dumps(self.state))
        original = self.path.read_bytes()
        with self.assertRaisesRegex(RuntimeError, 'RESET_EDGE_PLAN_DRIFT'):
            m.apply_edge_reset(before, Admission(), self.root, True)
        self.assertEqual(self.path.read_bytes(), original)

    def test_unknown_files_and_existing_durable_erasure_marker_are_never_discarded(self):
        for name in ['unknown.json', '.erasure-fence-v1']:
            p = self.root / name
            p.write_text('synthetic preserve')
            with self.assertRaisesRegex(RuntimeError, 'RESET_EDGE_UNKNOWN_FILE_OR_FENCE'):
                m.inspect_edge_reset(self.root, True)
            self.assertEqual(p.read_text(), 'synthetic preserve')
            p.unlink()

    def test_unknown_state_fields_and_other_node_identity_are_rejected(self):
        for value in [{**self.state, 'accountErasure': {}}, {**self.state, 'node': {**self.state['node'], 'nodeId': 'another-node'}}]:
            self.path.write_text(json.dumps(value))
            with self.assertRaises(RuntimeError):
                m.inspect_edge_reset(self.root, True)


if __name__ == '__main__':
    unittest.main()
