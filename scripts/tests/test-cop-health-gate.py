#!/usr/bin/env python3
"""Exact additive readiness dependency; an unavailable owner is never accepted."""
import importlib.util
import pathlib
import subprocess
import sys
import unittest

PATH = pathlib.Path(__file__).resolve().parents[1] / 'cop-health-gate.py'
spec = importlib.util.spec_from_file_location('cop_health_gate', PATH)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

class OwnerHealthGateTests(unittest.TestCase):
    def baseline(self):
        return {url: {'httpStatus': 200, 'status': 'ok', 'dependencies': {}} for url in gate.URLS}

    def test_exact_new_owner_name_requires_explicit_acceptance(self):
        before, after = self.baseline(), self.baseline()
        after[gate.URLS[2]]['dependencies']['cop-account-erasure-owners'] = 'ok'
        self.assertFalse(gate.no_regression(before, after))
        self.assertTrue(gate.no_regression(before, after, ['cop-account-erasure-owners']))
        after[gate.URLS[2]]['dependencies']['cop-account-erasure-owners'] = 'disabled'
        self.assertTrue(gate.no_regression(before, after, ['cop-account-erasure-owners']))

    def test_owner_failure_cannot_be_added_even_when_the_name_is_allowed(self):
        for state in ['unavailable', 'degraded', 'unknown', 'offline']:
            before, after = self.baseline(), self.baseline()
            after[gate.URLS[2]]['dependencies']['cop-account-erasure-owners'] = state
            self.assertFalse(gate.no_regression(before, after, ['cop-account-erasure-owners']))

    def test_cli_rejects_other_additive_dependencies_before_any_request(self):
        result = subprocess.run([sys.executable, str(PATH), 'verify', '/nonexistent', '--allow-added-dependency', 'unknown-owner'], capture_output=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn(b'invalid choice', result.stderr)

if __name__ == '__main__':
    unittest.main()
