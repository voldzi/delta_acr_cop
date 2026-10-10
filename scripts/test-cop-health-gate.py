#!/usr/bin/env python3
"""The new worker may be added; existing health must still be preserved."""
import copy
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('cop_health_gate', pathlib.Path(__file__).with_name('cop-health-gate.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class HealthGateTests(unittest.TestCase):
    def setUp(self):
        self.before = {url: {'httpStatus': 200, 'status': 'ok'} for url in gate.URLS}
        self.before[gate.URLS[2]]['dependencies'] = {'existing-source': 'ok'}
        self.after = copy.deepcopy(self.before)

    def test_requires_explicit_approved_addition(self):
        self.after[gate.URLS[2]]['dependencies']['safety-notification-worker'] = 'ok'
        self.assertFalse(gate.no_regression(self.before, self.after))
        self.assertTrue(gate.no_regression(self.before, self.after, ['safety-notification-worker']))

    def test_new_worker_must_not_be_degraded(self):
        self.after[gate.URLS[2]]['dependencies']['safety-notification-worker'] = 'degraded'
        self.assertFalse(gate.no_regression(self.before, self.after, ['safety-notification-worker']))

    def test_existing_dependency_cannot_regress(self):
        self.after[gate.URLS[2]]['dependencies'].update({'safety-notification-worker': 'ok', 'existing-source': 'degraded'})
        self.assertFalse(gate.no_regression(self.before, self.after, ['safety-notification-worker']))

    def test_removal_or_unapproved_addition_is_rejected(self):
        del self.after[gate.URLS[2]]['dependencies']['existing-source']
        self.assertFalse(gate.no_regression(self.before, self.after, ['safety-notification-worker']))
        self.after = copy.deepcopy(self.before)
        self.after[gate.URLS[2]]['dependencies']['other-worker'] = 'ok'
        self.assertFalse(gate.no_regression(self.before, self.after, ['safety-notification-worker']))


if __name__ == '__main__':
    unittest.main()
