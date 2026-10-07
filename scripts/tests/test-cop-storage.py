#!/usr/bin/env python3
"""Destructive paths use temporary files and injected mount guards only."""
import contextlib
import datetime as dt
import fcntl
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import types
import unittest
from unittest import mock

MODULE = Path(__file__).resolve().parents[1] / 'cop-storage.py'
spec = importlib.util.spec_from_file_location('cop_storage', MODULE)
storage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(storage)
UTC = dt.timezone.utc


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.x5 = self.root / 'x5'
        self.x5.mkdir(mode=0o700)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.guard = lambda: {'ok': True}
        if not hasattr(os, 'listxattr'):
            # macOS bundled Python does not expose Linux xattrs. Production does
            # not bypass this requirement; Linux run exercises the real API.
            self.xattr_patch = mock.patch.object(storage, 'extended_attributes', return_value={})
            self.xattr_patch.start()
            self.addCleanup(self.xattr_patch.stop)

    def tearDown(self):
        self.tmp.cleanup()

    def mount(self, **change):
        value = {'target': str(self.x5), 'uuid': storage.EXPECTED_UUID,
                 'fstype': 'ext4', 'options': 'rw,relatime'}
        value.update(change)
        return lambda _argv: json.dumps({'filesystems': [value]}).encode()

    def stat_mount(self, path):
        return types.SimpleNamespace(st_dev=2 if Path(path) == self.x5 or self.x5 in Path(path).parents else 1)

    def test_correct_mount_requires_pinned_uuid_and_separate_device(self):
        result = storage.preflight(self.mount(), self.stat_mount, self.x5)
        self.assertTrue(result['ok'])
        self.assertEqual(result['uuid'], storage.EXPECTED_UUID)
        self.assertGreater(result['freeBytes'], 0)

    def test_root_owned_mount_only_needs_traversal_and_cop_dirs_need_write(self):
        storage.layout(self.guard, self.x5)
        def permissions(path, requested):
            if Path(path) == self.x5:
                return requested == os.X_OK  # Mount root 0755, no write access.
            return Path(path).name == 'cop' and requested == os.W_OK | os.X_OK
        with mock.patch.object(os, 'access', side_effect=permissions):
            self.assertTrue(storage.preflight(self.mount(), self.stat_mount, self.x5)['ok'])
        with mock.patch.object(os, 'access', side_effect=lambda path, requested: Path(path) == self.x5):
            with self.assertRaisesRegex(storage.StorageError, 'cop_storage_permissions'):
                storage.preflight(self.mount(), self.stat_mount, self.x5)

    def test_missing_wrong_uuid_wrong_filesystem_same_device_refuse_without_creation(self):
        invalid = [self.mount(target='/'), self.mount(uuid='unexpected'),
                   self.mount(fstype='xfs'), self.mount(options='ro')]
        for run in invalid:
            with self.subTest(run=run):
                def guard():
                    return storage.preflight(run, self.stat_mount, self.x5)
                with self.assertRaises(storage.StorageError):
                    storage.layout(guard, self.x5)
                self.assertEqual(list(self.x5.iterdir()), [])
        with self.assertRaisesRegex(storage.StorageError, 'separate'):
            storage.preflight(self.mount(), lambda _: types.SimpleNamespace(st_dev=1), self.x5)

    def test_missing_mount_does_not_create_operational_lock(self):
        lock = self.source / '.storage.lock'
        def reject():
            raise storage.StorageError('x5_mount_missing')
        with self.assertRaises(storage.StorageError):
            with storage.operation_lock(reject, lock):
                self.fail('must not enter')
        self.assertFalse(lock.exists())

    def test_nested_category_symlink_and_other_filesystem_refused(self):
        category = self.x5 / 'staging'
        category.symlink_to(self.source, target_is_directory=True)
        with self.assertRaisesRegex(storage.StorageError, 'symlink'):
            storage.preflight(self.mount(), self.stat_mount, self.x5)
        category.unlink()
        category.mkdir()
        def nested_mount(path):
            return types.SimpleNamespace(st_dev=3 if Path(path) == category else self.stat_mount(path).st_dev)
        with self.assertRaisesRegex(storage.StorageError, 'not_on_x5'):
            storage.preflight(self.mount(), nested_mount, self.x5)

    def test_global_lock_refuses_concurrent_operation(self):
        lock = self.source / '.storage.lock'
        with storage.operation_lock(self.guard, lock):
            with self.assertRaisesRegex(storage.StorageError, 'cop_storage_busy'):
                with storage.operation_lock(self.guard, lock):
                    self.fail('must not enter second operation')
        with storage.operation_lock(self.guard, lock):
            pass
        self.assertEqual(stat.S_IMODE(lock.stat().st_mode), 0o600)

    def test_inherited_lock_must_match_and_reacquires_same_open_description(self):
        lock = self.source / '.storage.lock'
        fd = os.open(lock, os.O_RDWR | os.O_CREAT, 0o600)
        other = os.open(self.source / 'foreign', os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with mock.patch.dict(os.environ, {'COP_STORAGE_LOCK_FD': str(fd)}):
                with storage.operation_lock(self.guard, lock):
                    pass
            with mock.patch.dict(os.environ, {'COP_STORAGE_LOCK_FD': str(other)}):
                with self.assertRaisesRegex(storage.StorageError, 'identity_mismatch'):
                    with storage.operation_lock(self.guard, lock):
                        self.fail('foreign descriptor accepted')
            with mock.patch.dict(os.environ, {'COP_STORAGE_LOCK_FD': '1'}):
                with self.assertRaisesRegex(storage.StorageError, 'invalid_inherited'):
                    with storage.operation_lock(self.guard, lock):
                        self.fail('stdout accepted')
        finally:
            os.close(other)
            os.close(fd)

    def test_existing_broad_permissions_are_not_silently_changed(self):
        (self.x5 / 'backups').mkdir()
        app = self.x5 / 'backups' / 'cop'
        app.mkdir(mode=0o755)
        with self.assertRaisesRegex(storage.StorageError, 'permissions'):
            storage.layout(self.guard, self.x5)
        self.assertEqual(stat.S_IMODE(app.stat().st_mode), 0o755)

    def git(self, *args):
        subprocess.run(['git', '-C', str(self.source), *args], check=True, capture_output=True)

    def snapshot(self):
        self.git('init')
        self.git('config', 'user.email', 'synthetic@example.invalid')
        self.git('config', 'user.name', 'Synthetic test')
        (self.source / 'docker-compose.yml').write_text('services: {}\n')
        self.git('add', 'docker-compose.yml')
        self.git('commit', '-m', 'synthetic fixture')
        (self.source / '.env').write_text('SYNTHETIC_SECRET=never-output-this\n')
        (self.source / '.env').chmod(0o600)
        (self.source / 'docker-compose.yml').write_text('services: {}\n# dirty\n')
        return storage.snapshot(['docker-compose.yml'], self.guard, self.x5, self.source)

    def test_snapshot_verifies_isolated_restore_no_active_state_no_secret_output(self):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            result = self.snapshot()
        self.assertNotIn('never-output-this', output.getvalue())
        self.assertNotIn('sha256', json.dumps(result))
        self.assertTrue(result['isolatedRestoreVerified'])
        self.assertFalse(result['databaseRestoreVerified'])
        dest = Path(result['snapshot'])
        meta = storage.read_marker(dest / '.cop-backup.json')
        self.assertTrue(meta['verified'])
        self.assertEqual(meta['scope'], 'deployment_config_and_git_only')
        self.assertIn('databases', meta['excludes'])
        self.assertEqual(stat.S_IMODE((dest / 'config' / '.env').stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(dest.stat().st_mode), 0o700)
        self.assertEqual(list(dest.glob('.restore-check-*')), [])
        # Standalone verification uses the archived bundle, not the live repo.
        self.tmp_verify = storage.verify_snapshot(dest, self.guard)
        self.assertTrue(self.tmp_verify['isolatedRestoreVerified'])

    def test_tampered_backup_rejected(self):
        result = self.snapshot()
        dest = Path(result['snapshot'])
        (dest / 'config' / '.env').write_text('tampered')
        with self.assertRaisesRegex(storage.StorageError, 'integrity'):
            storage.verify_snapshot(dest, self.guard)

    @unittest.skipUnless(hasattr(os, 'listxattr'), 'Linux xattr API unavailable in this Python')
    def test_linux_extended_metadata_round_trip(self):
        result = self.snapshot()
        source = self.source / '.env'
        os.setxattr(source, 'user.cop_storage_test', b'synthetic-metadata')
        # The second snapshot must retain and verify the real extended metadata.
        second = storage.snapshot(['docker-compose.yml'], self.guard, self.x5, self.source)
        metadata = storage.read_marker(Path(second['snapshot']) / '.cop-backup.json')
        self.assertIn('user.cop_storage_test', metadata['files']['.env']['xattrs'])
        self.assertTrue(storage.verify_snapshot(Path(second['snapshot']), self.guard)['ok'])

    def test_snapshot_refuses_config_symlink(self):
        self.snapshot()
        source = self.source / '.env'
        source.unlink()
        source.symlink_to(self.source / 'docker-compose.yml')
        with self.assertRaisesRegex(storage.StorageError, 'symlink'):
            storage.snapshot(['docker-compose.yml'], self.guard, self.x5, self.source)

    def test_git_artifacts_require_private_regular_files(self):
        dest = Path(self.snapshot()['snapshot'])
        (dest / 'dirty.patch').chmod(0o644)
        with self.assertRaisesRegex(storage.StorageError, 'not_private'):
            storage.verify_snapshot(dest, self.guard)

    def test_source_change_during_copy_refuses_verification(self):
        path = self.source / '.env'
        path.write_text('synthetic')
        target = self.x5 / 'copy'
        original_digest = storage.digest
        def changing_digest(value):
            if value == path:
                path.write_text('changed')
            return original_digest(value)
        with mock.patch.object(storage, 'digest', side_effect=changing_digest):
            with self.assertRaisesRegex(storage.StorageError, 'changed'):
                storage.copy_private(path, target, self.guard)

    def backup(self, name, when, **changes):
        directory = self.x5 / 'backups' / 'cop' / name
        directory.mkdir(parents=True, mode=0o700)
        value = {'tool': storage.TOOL, 'version': 1, 'scope': 'deployment_config_and_git_only',
                 'createdAt': when.isoformat(), 'verified': True,
                 'verification': 'isolated_config_restore_and_git_bundle_verify'}
        value.update(changes)
        (directory / '.cop-backup.json').write_text(json.dumps(value))
        (directory / '.cop-backup.json').chmod(0o600)
        return directory

    def test_retention_protects_last_verified_unverified_legacy_audit_active_hold(self):
        now = dt.datetime(2026, 10, 7, tzinfo=UTC)
        for age in range(120):
            self.backup('verified-%03d' % age, now - dt.timedelta(days=age))
        self.backup('unverified', now, verified=False)
        self.backup('active', now, active=True)
        self.backup('audit-hold', now, hold=True)
        self.backup('invalid-time', now, createdAt='bad')
        legacy = self.x5 / 'backups' / 'cop' / 'legacy'
        legacy.mkdir()
        plan = storage.backup_retention_plan(legacy.parent)
        self.assertIn('verified-000', plan['retain'])
        for name in ('unverified', 'active', 'audit-hold', 'invalid-time', 'legacy'):
            self.assertIn(name, plan['protected'])
            self.assertNotIn(name, plan['eligible'])
        self.assertIn('verified-119', plan['eligible'])
        self.assertGreaterEqual(len(plan['retain']), 7)
        self.assertLessEqual(len(plan['retain']), 14)
        self.assertTrue(legacy.exists())  # Planning never deletes.

    def test_job_cleanup_only_completed_owned_inactive_not_media(self):
        job = storage.new_job('staging', self.guard, self.x5)
        path = Path(job['job'])
        (path / 'artifact').write_bytes(b'fixture')
        with (path / '.job.lock').open('rb') as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(storage.StorageError, 'still_writing'):
                storage.complete_job(str(path), self.guard, self.x5)
        storage.complete_job(str(path), self.guard, self.x5)
        marker = storage.read_marker(path / '.cop-job.json')
        marker['completedAt'] = (dt.datetime.now(UTC) - dt.timedelta(days=15)).isoformat()
        storage.write_json(path / '.cop-job.json', marker, self.guard)
        active = Path(storage.new_job('staging', self.guard, self.x5)['job'])
        media = self.x5 / 'staging' / 'cop' / 'media'
        media.mkdir()
        with (path / '.job.lock').open('rb') as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = storage.cleanup(self.guard, self.x5)
            self.assertEqual(result['removedJobs'], 0)
            self.assertEqual(result['skippedJobs'], 1)
        result = storage.cleanup(self.guard, self.x5)
        self.assertEqual(result['removedJobs'], 1)
        self.assertFalse(path.exists())
        self.assertTrue(active.exists())
        self.assertTrue(media.exists())

    def test_symlink_work_is_never_cleaned(self):
        path = Path(storage.new_job('cache', self.guard, self.x5)['job'])
        (path / 'escape').symlink_to(self.source, target_is_directory=True)
        with self.assertRaisesRegex(storage.StorageError, 'symlink'):
            storage.complete_job(str(path), self.guard, self.x5)
        self.assertEqual(storage.work_plan(self.x5)['eligible'], [])

    def test_forged_legacy_work_marker_does_not_make_media_eligible(self):
        storage.layout(self.guard, self.x5)
        media = self.x5 / 'staging' / 'cop' / 'media'
        media.mkdir(mode=0o700)
        storage.write_json(media / '.cop-job.json', {'tool': storage.TOOL, 'version': 1,
             'kind': 'staging', 'state': 'completed', 'classification': 'rebuildable',
             'toolOwned': True, 'completedAt': '2020-01-01T00:00:00Z'}, self.guard)
        self.assertEqual(storage.work_plan(self.x5)['eligible'], [])
        self.assertEqual(storage.cleanup(self.guard, self.x5)['removedJobs'], 0)
        self.assertTrue(media.exists())

    def test_no_production_mount_override_or_source_root_cli(self):
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                storage.main(['preflight', '--source-root', str(self.source)])
        self.assertEqual(storage.image_plan()['eligible'], [])
        self.assertFalse(storage.image_plan()['automaticImageDeletion'])


if __name__ == '__main__':
    unittest.main()
