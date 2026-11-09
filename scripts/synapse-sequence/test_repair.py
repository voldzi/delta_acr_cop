import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('repair', Path(__file__).with_name('repair.py'))
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)

class SequenceBounds(unittest.TestCase):
    def snapshot(self):
        return dict(increment=1, cache=1, lastValue=630, sequenceMax=2**63-1,
                    maxima={'device_inbox': None, 'device_federation_outbox': None},
                    positions=[['master', 660]])

    def test_durable_position_survives_empty_tables(self):
        self.assertEqual(repair.target(self.snapshot()), 660)

    def test_existing_higher_sequence_never_rewinds(self):
        value = self.snapshot(); value['lastValue'] = 900
        self.assertEqual(repair.target(value), 900)

    def test_each_table_can_raise_the_floor(self):
        for table in ['device_inbox', 'device_federation_outbox']:
            value = self.snapshot(); value['maxima'][table] = 710
            self.assertEqual(repair.target(value), 710)

    def test_multiple_instances_contribute_to_floor(self):
        value = self.snapshot(); value['positions'].append(['worker', 720])
        self.assertEqual(repair.target(value), 720)

    def test_unsupported_sequence_shape_rejected(self):
        for key, value in [('increment', 2), ('cache', 32), ('lastValue', -1)]:
            snapshot = self.snapshot(); snapshot[key] = value
            with self.assertRaises(RuntimeError): repair.target(snapshot)

    def test_exhausted_sequence_rejected(self):
        value = self.snapshot(); value['sequenceMax'] = 660
        with self.assertRaises(RuntimeError): repair.target(value)

if __name__ == '__main__': unittest.main()
