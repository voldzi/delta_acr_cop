#!/usr/bin/env python3
"""Actual local Git fixtures. No Docker, SSH, network or production filesystem."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('build_context', Path(__file__).parents[1] / 'cop-api-build-context.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class BuildContextTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.staging = self.root / 'x5' / 'staging' / 'cop'
        self.staging.mkdir(parents=True)
        self.context = self.staging / 'reviewed-source'
        self.context.mkdir()
        self.operational = self.root / 'operational'
        self.operational.mkdir()
        self.command(self.context, 'init', '-q')
        self.command(self.operational, 'init', '-q')
        for path in (self.context, self.operational):
            self.command(path, 'remote', 'add', 'origin', 'git@github-cop:voldzi/delta_acr_cop.git')
        (self.context / '.gitignore').write_text('ignored-cache\n')
        (self.context / 'application.txt').write_text('reviewed immutable source\n')
        (self.context / 'run.sh').write_text('#!/bin/sh\nexit 0\n')
        (self.context / 'run.sh').chmod(0o755)
        self.command(self.context, 'add', '.')
        self.command(self.context, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture')
        self.revision = self.command(self.context, 'rev-parse', 'HEAD').strip()
        self.command(self.context, 'checkout', '--detach', '-q', self.revision)
        self.read_only()
        self.layout = {'staging': self.staging, 'operational': self.operational, 'uid': os.geteuid()}

    def tearDown(self):
        for directory, dirs, files in os.walk(self.root):
            for path in [Path(directory), *(Path(directory) / name for name in dirs + files)]:
                if not path.is_symlink():
                    path.chmod(path.stat().st_mode | 0o700)
        self.temp.cleanup()

    @staticmethod
    def command(path, *args):
        result = subprocess.run(['git', '-C', str(path), *args], capture_output=True, text=True)
        if result.returncode:
            raise AssertionError('fixture Git failed: ' + result.stderr)
        return result.stdout

    def writable(self):
        for directory, dirs, files in os.walk(self.context):
            for path in [Path(directory), *(Path(directory) / name for name in dirs + files)]:
                if not path.is_symlink():
                    path.chmod(path.stat().st_mode | 0o200)

    def read_only(self):
        for directory, dirs, files in os.walk(self.context):
            for path in [Path(directory), *(Path(directory) / name for name in dirs + files)]:
                if not path.is_symlink():
                    path.chmod(path.stat().st_mode & ~0o222)

    def inspect(self, context=None, revision=None, **layout):
        return m.inspect_context(str(context or self.context), revision or self.revision, **(self.layout | layout))

    def test_only_one_build_only_api_service_is_accepted(self):
        m.validate_mode(True, False, ['cop-api'])
        for arguments in ((False, False, ['cop-api']), (True, True, ['cop-api']),
                          (True, False, []), (True, False, ['cop-web']),
                          (True, False, ['cop-api', 'cop-web']), (True, False, ['cop-api', 'cop-api'])):
            with self.subTest(arguments=arguments), self.assertRaises(m.ContextError):
                m.validate_mode(*arguments)

    def test_actual_clean_detached_git_context_and_pin_readback(self):
        result = self.inspect()
        self.assertEqual(result['revision'], self.revision)
        self.assertEqual(result['inode'], self.context.stat().st_ino)
        pin = self.staging / 'locked-job-pin.json'
        self.assertEqual(m.pin_context(str(self.context), self.revision, pin, **self.layout), result)
        self.assertEqual(m.verify_context(str(self.context), self.revision, pin, **self.layout), result)
        self.assertEqual(json.loads(pin.read_text()), result)

    def test_relative_outside_root_and_non_normalized_paths_rejected(self):
        for path in ('relative', str(self.staging), str(self.root), str(self.context) + '/..', str(self.context) + '//'):
            with self.subTest(path=path), self.assertRaises(m.ContextError):
                m.inspect_context(path, self.revision, **self.layout)

    def test_symlink_path_and_tree_and_external_git_metadata_rejected(self):
        link = self.staging / 'alias'
        link.symlink_to(self.context, target_is_directory=True)
        with self.assertRaisesRegex(m.ContextError, 'symlink'):
            self.inspect(link)
        self.writable()
        (self.context / 'extra-link').symlink_to(self.operational)
        self.read_only()
        with self.assertRaisesRegex(m.ContextError, 'symlink'):
            self.inspect()
        self.writable()
        (self.context / 'extra-link').unlink()
        (self.context / '.git' / 'objects' / 'info' / 'alternates').write_text(str(self.operational / '.git' / 'objects'))
        self.read_only()
        with self.assertRaisesRegex(m.ContextError, 'external_git_metadata'):
            self.inspect()

    def test_operational_overlap_wrong_owner_or_writable_file_rejected(self):
        with self.assertRaisesRegex(m.ContextError, 'overlaps'):
            self.inspect(operational=self.context / 'operations')
        with self.assertRaisesRegex(m.ContextError, 'root_owned'):
            self.inspect(uid=os.geteuid() + 1)
        (self.context / 'application.txt').chmod(0o644)
        with self.assertRaisesRegex(m.ContextError, 'read_only'):
            self.inspect()

    def test_hardlink_alias_to_another_source_path_is_rejected(self):
        self.writable()
        os.link(self.context / 'application.txt', self.operational / 'shared-alias')
        self.read_only()
        with self.assertRaisesRegex(m.ContextError, 'hardlink_alias'):
            self.inspect()

    def test_wrong_revision_or_branch_head_rejected(self):
        with self.assertRaisesRegex(m.ContextError, 'reviewed_revision_mismatch'):
            self.inspect(revision='a' * 40)
        with self.assertRaisesRegex(m.ContextError, 'reviewed_revision'):
            self.inspect(revision='HEAD')
        self.writable()
        self.command(self.context, 'checkout', '-qb', 'mutable-branch')
        self.read_only()
        with self.assertRaisesRegex(m.ContextError, 'detached'):
            self.inspect()

    def test_wrong_cop_origin_and_executable_git_filter_rejected(self):
        self.writable()
        self.command(self.context, 'remote', 'set-url', 'origin', 'https://github.com/foreign/project.git')
        self.read_only()
        with self.assertRaisesRegex(m.ContextError, 'not_cop'):
            self.inspect()
        self.writable()
        self.command(self.context, 'remote', 'set-url', 'origin', 'https://github.com/voldzi/delta_acr_cop.git')
        self.command(self.context, 'config', 'filter.untrusted.clean', 'false')
        self.read_only()
        with self.assertRaisesRegex(m.ContextError, 'unsupported_git_config'):
            self.inspect()

    def test_tracked_changes_untracked_and_ignored_inputs_rejected(self):
        for name in ('application.txt', 'untracked.txt', 'ignored-cache'):
            with self.subTest(name=name):
                self.writable()
                path = self.context / name
                path.write_text('not approved\n')
                self.read_only()
                with self.assertRaises(m.ContextError):
                    self.inspect()
                self.writable()
                if name == 'application.txt':
                    self.command(self.context, 'checkout', 'HEAD', '--', name)
                else:
                    path.unlink()
                self.read_only()

    def test_assume_unchanged_cannot_hide_modified_build_bytes(self):
        self.writable()
        self.command(self.context, 'update-index', '--assume-unchanged', 'application.txt')
        (self.context / 'application.txt').write_text('hidden mutation\n')
        self.read_only()
        with self.assertRaisesRegex(m.ContextError, 'tracked_bytes_mismatch'):
            self.inspect()

    def test_status_cache_cannot_hide_untracked_build_bytes(self):
        self.writable()
        (self.context / 'concealed-input').write_text('not in the pinned tree\n')
        self.read_only()
        actual_git = m.git
        with mock.patch.object(m, 'git', side_effect=lambda root, *args: b'' if args[0] == 'status' else actual_git(root, *args)):
            with self.assertRaisesRegex(m.ContextError, 'untracked_build_bytes'):
                self.inspect()

    def test_assume_unchanged_does_not_hide_partial_execute_mode_changes(self):
        self.writable()
        self.command(self.context, 'update-index', '--assume-unchanged', 'run.sh')
        self.read_only()
        (self.context / 'run.sh').chmod(0o544)
        with self.assertRaisesRegex(m.ContextError, 'tracked_mode_mismatch'):
            self.inspect()

    def test_before_after_identity_pin_detects_directory_replacement(self):
        pin = self.staging / 'locked-job-pin.json'
        m.pin_context(str(self.context), self.revision, pin, **self.layout)
        old = self.staging / 'old-source'
        self.context.rename(old)
        import shutil
        shutil.copytree(old, self.context)
        with self.assertRaisesRegex(m.ContextError, 'pin_changed'):
            m.verify_context(str(self.context), self.revision, pin, **self.layout)

    def test_environment_cannot_redirect_git_to_another_tree(self):
        with mock.patch.dict(os.environ, {'GIT_DIR': str(self.operational / '.git'), 'GIT_WORK_TREE': str(self.operational)}):
            self.assertEqual(self.inspect()['revision'], self.revision)

    def test_cli_invalid_mode_stops_before_inspection(self):
        script = Path(__file__).parents[1] / 'cop-api-build-context.py'
        result = subprocess.run([sys.executable, '-B', str(script), 'validate', '--context', '/not-a-checkout',
                                 '--revision', self.revision, '--build-only', 'true', '--deploy-only', 'true',
                                 '--service', 'cop-api'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stderr.strip(), 'COP API build context validation failed')

    def run_arguments(self, *args):
        # Execute the actual shell parser/validation block, before its Compose,
        # locks or Docker work. Only validator filesystem/UID dependencies point
        # at the actual disposable local Git fixture.
        source = Path(__file__).parents[1]
        scripts = self.operational / 'scripts'
        scripts.mkdir(exist_ok=True)
        wrapper = scripts / 'cop-api-build-context.py'
        wrapper.write_text(f'''import importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location("fixture_validator", {str(source / 'cop-api-build-context.py')!r})
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
inspect=m.inspect_context
m.inspect_context=lambda value, revision: inspect(value, revision, staging=Path({str(self.staging)!r}), operational=Path({str(self.operational)!r}), uid={os.geteuid()})
try: m.main()
except m.ContextError: raise SystemExit(1)
''')
        shell = (source / 'deploy-production.sh').read_text()
        fragment = shell[shell.index('build_only=false'):shell.index('files=(docker-compose.yml')]
        return subprocess.run(['bash', '-c', 'set -euo pipefail\n' + fragment + '\nprintf "%s\\n" "$@"\n', 'fixture', *args],
                              cwd=self.operational, capture_output=True, text=True)

    def test_actual_shell_parser_accepts_only_the_pinned_api_build_combination(self):
        result = self.run_arguments('--build-only', '--api-source', self.revision, '--api-build-context', str(self.context), 'cop-api')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'cop-api')
        # Operational files deliberately need not be the clean source tree.
        (self.operational / 'protected-operational-change').write_text('preserve this\n')
        result = self.run_arguments('--api-build-context', str(self.context), '--api-source', self.revision, '--build-only', 'cop-api')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_actual_shell_parser_rejects_missing_duplicate_deploy_or_mixed_arguments(self):
        common = ('--build-only', '--api-source', self.revision)
        cases = [common + ('--api-build-context',), common + ('--api-build-context', ''),
                 common + ('--api-build-context', str(self.context), '--api-build-context', str(self.context), 'cop-api'),
                 ('--api-build-context', str(self.context), '--api-source', self.revision, 'cop-api'),
                 common + ('--api-build-context', str(self.context), '--api-image', 'sha256:' + 'a' * 64),
                 common + ('--api-build-context', str(self.context), 'cop-web'),
                 common + ('--api-build-context', str(self.context), 'cop-api', 'cop-web'),
                 ('--build-only', '--api-build-context', str(self.context), 'cop-api')]
        for args in cases:
            with self.subTest(args=args):
                self.assertNotEqual(self.run_arguments(*args).returncode, 0)


if __name__ == '__main__':
    unittest.main()
