#!/usr/bin/env python3
"""Synthetic Compose CLIENT tests; config only, never contacts Docker daemon."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('runtime', Path(__file__).parents[1] / 'cop-api-runtime.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class ComposeClientTests(unittest.TestCase):
    def test_real_render_preserves_literal_dollar_and_legacy_absence(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name).resolve()
            # All inputs are fixed synthetic values. No project/host env is read.
            (root / 'main.env').write_text('COP_DATABASE_URL=synthetic-direct\n')
            values = {'COP_DATABASE_URL': 'postgresql://fixture:literal$${unchanged}@db.fixture.invalid/cop',
                      'COP_LEASE_DATABASE_URL': '', 'COP_STREAM_BUS_DATABASE_URL': ''}
            (root / 'runtime.env').write_text(''.join(m.ENV[k] + "='" + v + "'\n" for k, v in values.items()))
            image = 'sha256:' + '2' * 64
            (root / 'image.env').write_text("COP_API_RUNTIME_IMAGE_ID='" + image + "'\n" + m.MODE_ENV + "='direct'\n")
            raw = {'COP_DATABASE_URL': '${COP_DATABASE_URL}',
                   'COP_DATABASE_POOL_MODE': '${COP_DATABASE_POOL_MODE:-direct}',
                   'COP_LEASE_DATABASE_URL': '${COP_LEASE_DATABASE_URL:-}',
                   'COP_STREAM_BUS_DATABASE_URL': '${COP_STREAM_BUS_DATABASE_URL:-}',
                   'COP_AUTH_MODE': '${COP_AUTH_MODE:-oidc}', 'COP_STREAM_BUS': 'memory'}
            base = {'services': {'cop-api': {'image': 'cop-fixture:local', 'environment': raw},
                                 'cop-web': {'image': 'cop-web-fixture:local'}}}
            for index, filename in enumerate(m.FILES):
                (root / filename).write_bytes(m.encoded(base if index == 0 else {'services': {}}))
            environment = {'PATH': os.environ['PATH'], 'HOME': os.environ['HOME'],
                           'COP_DATABASE_POOL_MODE': 'foreign-shell-mode',
                           'COP_LEASE_DATABASE_URL': 'foreign-shell-value'}
            args = ['docker', '--host', 'unix:///var/run/docker.sock', 'compose', '--project-name', 'cop',
                    '--project-directory', str(root), '--env-file', str(root / 'main.env')]
            files = [part for filename in m.FILES for part in ('-f', str(root / filename))]
            def config(extra):
                result = subprocess.run(args + extra + files +
                    (['-f', str(root / 'overlay.yml')] if extra else []) + ['config', '--format', 'json'],
                    capture_output=True, env=environment, check=False)
                self.assertEqual(result.returncode, 0, 'Synthetic Compose config must succeed; diagnostics suppressed')
                return json.loads(result.stdout)
            original = config([])
            extras = ['--env-file', str(root / 'runtime.env'), '--env-file', str(root / 'image.env')]
            presence = {'COP_DATABASE_URL': True, 'COP_DATABASE_POOL_MODE': False,
                        'COP_LEASE_DATABASE_URL': False, 'COP_STREAM_BUS_DATABASE_URL': True}
            for legacy in (False, True):
                with self.subTest(legacy=legacy):
                    binding = {'kind': 'accepted-baseline' if legacy else 'candidate',
                               'releaseId': 'synthetic-release', 'profileGeneration': 'synthetic-generation'}
                    if legacy:
                        binding['legacyEnvironment'] = {k: v for k, v in raw.items() if presence.get(k, True)}
                        for key in m.ENV:
                            if presence[key]: binding['legacyEnvironment'][key] = '${' + m.ENV[key] + '?Required}'
                    (root / 'overlay.yml').write_bytes(m.overlay_bytes(binding, 'direct'))
                    resolved = config(extras)
                    expected_values = {**values, 'COP_DATABASE_POOL_MODE': 'direct'}
                    actual = resolved['services']['cop-api']['environment']
                    self.assertTrue(actual['COP_DATABASE_URL'] == values['COP_DATABASE_URL'].replace('$', '$$'), 'Serializer dollar proof failed')
                    self.assertTrue(resolved['services']['cop-api']['image'] == image, 'Image identity changed')
                    m.normalized_config(original); m.normalized_config(resolved)
                    m.verify_api_diff(original, resolved, expected_values, 'direct', image, presence if legacy else None)
                    self.assertTrue(('COP_DATABASE_POOL_MODE' in actual) is not legacy)
                    self.assertTrue(('COP_LEASE_DATABASE_URL' in actual) is not legacy)
            self.assertEqual((root / 'main.env').read_text(), 'COP_DATABASE_URL=synthetic-direct\n')


if __name__ == '__main__': unittest.main()
