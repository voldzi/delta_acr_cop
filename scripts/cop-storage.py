#!/usr/bin/env python3
"""COP host storage operations. Linux/Python stdlib; never follows a missing X5.

Snapshot scope is deployment configuration and Git only, not a database backup.
All retention plans are previews. Only explicit completed work owned by this tool
can be removed by cleanup; media directories and Docker images are never removed.
"""

import argparse
import base64
import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import uuid

X5_ROOT = Path('/srv/x5-production')
EXPECTED_UUID = '2f93f595-b61b-4eea-9054-7afa9b275b5b'
SOURCE_ROOT = Path('/srv/cop')
TOOL = 'cop-storage-v1'
KINDS = ('backups', 'archives', 'cache', 'staging')
CACHE_DAYS = 14
CACHE_BYTES = 10 * 1024 ** 3


class StorageError(Exception):
    pass


def command(argv):
    result = subprocess.run(argv, capture_output=True, check=False)
    if result.returncode:
        raise StorageError('command_failed:' + Path(argv[0]).name)
    return result.stdout


def preflight(run=command, stat_fn=os.stat, root=X5_ROOT, system_root=Path('/')):
    """Inject dependencies only in unit tests; CLI pins production paths/UUID."""
    try:
        mount = json.loads(run(['findmnt', '--json', '--target', str(root),
                                '--output', 'TARGET,UUID,FSTYPE,OPTIONS']))
        entries = mount.get('filesystems', [])
        if len(entries) != 1:
            raise StorageError('x5_mount_ambiguous')
        entry = entries[0]
        if entry.get('target') != str(root):
            raise StorageError('x5_mount_missing')
        if str(entry.get('uuid', '')).lower() != EXPECTED_UUID:
            raise StorageError('x5_uuid_mismatch')
        if entry.get('fstype') != 'ext4':
            raise StorageError('x5_filesystem_mismatch')
        if 'rw' not in str(entry.get('options', '')).split(','):
            raise StorageError('x5_not_writable')
        if root.is_symlink():
            raise StorageError('x5_symlink_forbidden')
        x5_device = stat_fn(root).st_dev
        if x5_device == stat_fn(system_root).st_dev:
            raise StorageError('x5_not_separate_filesystem')
        # The mount root and shared category parents can intentionally be
        # root-owned 0755. COP only needs traversal there, and write access in
        # its own already provisioned directories.
        if not os.access(root, os.X_OK):
            raise StorageError('x5_permissions_insufficient')
        for kind in KINDS:
            category = root / kind
            app = root / kind / 'cop'
            if category.is_symlink() or app.is_symlink():
                raise StorageError('cop_storage_symlink_forbidden')
            for path in (category, app):
                if path.exists() and stat_fn(path).st_dev != x5_device:
                    raise StorageError('cop_storage_not_on_x5')
            if app.exists() and not os.access(app, os.W_OK | os.X_OK):
                raise StorageError('cop_storage_permissions_insufficient')
        capacity = shutil.disk_usage(root)
        return {'ok': True, 'mount': str(root), 'uuid': EXPECTED_UUID,
                'filesystem': 'ext4', 'freeBytes': capacity.free,
                'totalBytes': capacity.total}
    except StorageError:
        raise
    except (OSError, ValueError, TypeError, KeyError):
        raise StorageError('x5_preflight_failed') from None


@contextlib.contextmanager
def operation_lock(guard=preflight, lock_path=SOURCE_ROOT / '.storage.lock'):
    guard()  # Even the operational lock is created only after mount validation.
    inherited = os.environ.get('COP_STORAGE_LOCK_FD')
    if inherited is not None:
        if not inherited.isdecimal() or int(inherited) < 3:
            raise StorageError('invalid_inherited_lock')
        try:
            inherited_info = os.fstat(int(inherited))
            path_info = lock_path.lstat()
            if (not stat.S_ISREG(inherited_info.st_mode) or not stat.S_ISREG(path_info.st_mode) or
                    (inherited_info.st_dev, inherited_info.st_ino) !=
                    (path_info.st_dev, path_info.st_ino)):
                raise StorageError('inherited_lock_identity_mismatch')
            fd = os.dup(int(inherited))
        except OSError:
            raise StorageError('invalid_inherited_lock') from None
    else:
        fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise StorageError('invalid_operation_lock')
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise StorageError('cop_storage_busy') from None
        guard()
        yield
    finally:
        os.close(fd)


def private_dir(path, guard):
    guard()
    if path.is_symlink():
        raise StorageError('symlink_directory_forbidden')
    if path.exists():
        info = path.stat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid():
            raise StorageError('directory_owner_mismatch')
        if stat.S_IMODE(info.st_mode) != 0o700:
            raise StorageError('directory_permissions_not_private')
    else:
        path.mkdir(mode=0o700)


def layout(guard=preflight, root=X5_ROOT):
    for kind in KINDS:
        base = root / kind
        # Shared category parents are infrastructure owned; never chmod them.
        guard()
        if base.is_symlink():
            raise StorageError('category_symlink_forbidden')
        if not base.exists():
            base.mkdir(mode=0o700)
        private_dir(base / 'cop', guard)


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def write_private(path, content, guard):
    guard()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())


def write_json(path, value, guard):
    content = (json.dumps(value, indent=2, sort_keys=True) + '\n').encode()
    temporary = path.with_name(path.name + '.tmp-' + uuid.uuid4().hex)
    write_private(temporary, content, guard)
    guard()
    os.replace(temporary, path)


def safe_relative(value):
    path = Path(value)
    if path.is_absolute() or '..' in path.parts or not path.parts:
        raise StorageError('invalid_config_path')
    return path


def regular_source(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise StorageError('config_must_be_regular_file')
    return info


def source_signature(path):
    info = regular_source(path)
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
            info.st_ctime_ns, info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode))


def extended_attributes(path):
    # ACLs/capabilities are represented by Linux xattrs as well. These values
    # stay in the private manifest, never CLI output.
    if not hasattr(os, 'listxattr') or not hasattr(os, 'getxattr'):
        raise StorageError('extended_metadata_inspection_unavailable')
    return {name: base64.b64encode(os.getxattr(path, name, follow_symlinks=False)).decode()
            for name in os.listxattr(path, follow_symlinks=False)}


def copy_private(source, target, guard):
    before = source_signature(source)
    attributes = extended_attributes(source)
    guard()
    with source.open('rb') as reader:
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as writer:
            shutil.copyfileobj(reader, writer)
            writer.flush()
            os.fsync(writer.fileno())
    if (source_signature(source) != before or digest(source) != digest(target) or
            extended_attributes(source) != attributes):
        raise StorageError('config_changed_during_copy')
    return {'sha256': digest(target), 'bytes': before[2], 'mtimeNs': before[3],
            'uid': before[5], 'gid': before[6], 'mode': before[7], 'xattrs': attributes}


def git_state(source, run):
    return (run(['git', '-C', str(source), 'rev-parse', 'HEAD']),
            run(['git', '-C', str(source), 'show-ref']),
            run(['git', '-C', str(source), 'diff', '--binary', 'HEAD']),
            run(['git', '-C', str(source), 'ls-files', '--others', '--exclude-standard', '-z']))


def snapshot(compose_files, guard=preflight, root=X5_ROOT, source=SOURCE_ROOT,
             run=command, now=None):
    """Returns public status only. Private manifest retains hashes/metadata."""
    guard()
    layout(guard, root)
    now = now or dt.datetime.now(dt.timezone.utc)
    name = now.strftime('%Y-%m-%dT%H%M%S.%fZ')
    dest = root / 'backups' / 'cop' / name
    private_dir(dest, guard)
    private_dir(dest / 'config', guard)
    marker = dest / '.cop-backup.json'
    metadata = {'tool': TOOL, 'version': 1, 'scope': 'deployment_config_and_git_only',
                'createdAt': now.isoformat(), 'verified': False, 'files': {},
                'excludes': ['databases', 'active_queues', 'media', 'untracked_file_contents']}
    write_json(marker, metadata, guard)
    files = [Path('.env')] + [safe_relative(value) for value in compose_files]
    if len(set(files)) != len(files):
        raise StorageError('duplicate_config_path')
    for relative in files:
        # No nested symlink escape, including source-root configuration folders.
        src = source / relative
        if src.resolve().parent != src.parent.resolve() or any(
                (source / Path(*relative.parts[:index])).is_symlink()
                for index in range(1, len(relative.parts) + 1)):
            raise StorageError('config_symlink_forbidden')
        target = dest / 'config' / relative
        for parent in reversed(target.parents):
            if parent == dest / 'config' or dest / 'config' in parent.parents:
                private_dir(parent, guard)
        metadata['files'][str(relative)] = copy_private(src, target, guard)
    before_git = git_state(source, run)
    bundle = dest / 'source.bundle'
    guard()
    run(['git', '-C', str(source), 'bundle', 'create', str(bundle), '--all'])
    guard()
    bundle.chmod(0o600)
    run(['git', '-C', str(source), 'bundle', 'verify', str(bundle)])
    write_private(dest / 'dirty.patch', before_git[2], guard)
    # Untracked names/contents may themselves identify people. Record only count.
    metadata['untrackedFileCount'] = len([item for item in before_git[3].split(b'\0') if item])
    if git_state(source, run) != before_git:
        raise StorageError('git_changed_during_snapshot')
    metadata['gitHead'] = before_git[0].decode().strip()
    metadata['gitBundleSha256'] = digest(bundle)
    metadata['dirtyPatchSha256'] = digest(dest / 'dirty.patch')
    write_json(marker, metadata, guard)
    verify_snapshot(dest, guard, source=source, run=run)
    if git_state(source, run) != before_git:
        raise StorageError('git_changed_during_verification')
    metadata['verified'] = True
    metadata['verification'] = 'isolated_config_restore_and_git_bundle_verify'
    metadata['verifiedAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
    write_json(marker, metadata, guard)
    return {'ok': True, 'snapshot': str(dest), 'scope': metadata['scope'],
            'isolatedRestoreVerified': True, 'databaseRestoreVerified': False,
            'untrackedFileCount': metadata['untrackedFileCount']}


def read_marker(path):
    if path.is_symlink() or not path.is_file():
        return None
    try:
        info = path.stat()
        if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 1024 ** 2:
            return None
        value = json.loads(path.read_text())
        return value if value.get('tool') == TOOL and value.get('version') == 1 else None
    except (OSError, ValueError, AttributeError):
        return None


def verify_snapshot(dest, guard=preflight, source=None, run=command):
    guard()
    metadata = read_marker(dest / '.cop-backup.json')
    if not metadata or metadata.get('scope') != 'deployment_config_and_git_only':
        raise StorageError('unrecognized_backup')
    guard()
    scratch = Path(tempfile.mkdtemp(prefix='.restore-check-', dir=dest))
    try:
        for relative, item in metadata['files'].items():
            relative = safe_relative(relative)
            archived = dest / 'config' / relative
            regular_source(archived)
            if digest(archived) != item['sha256'] or stat.S_IMODE(archived.stat().st_mode) != 0o600:
                raise StorageError('backup_integrity_failed')
            restored = scratch / relative
            # Never recursively recreate a disappeared mount's parents.
            parent = scratch
            for component in relative.parts[:-1]:
                parent = parent / component
                private_dir(parent, guard)
            guard()
            shutil.copyfile(archived, restored)
            if os.geteuid() == 0:
                os.chown(restored, item['uid'], item['gid'])
            for name, value in item.get('xattrs', {}).items():
                os.setxattr(restored, name, base64.b64decode(value, validate=True), follow_symlinks=False)
            # chown can clear setid bits; restore permissions after ownership.
            restored.chmod(item['mode'])
            os.utime(restored, ns=(item['mtimeNs'], item['mtimeNs']))
            restored_info = restored.stat()
            if (digest(restored) != item['sha256'] or
                    stat.S_IMODE(restored_info.st_mode) != item['mode'] or
                    restored_info.st_uid != item['uid'] or restored_info.st_gid != item['gid'] or
                    restored_info.st_mtime_ns != item['mtimeNs'] or
                    extended_attributes(restored) != item.get('xattrs', {})):
                raise StorageError('isolated_restore_metadata_failed')
            if source is not None and (digest(source / relative) != item['sha256'] or
                    source_signature(source / relative)[5:8] != (item['uid'], item['gid'], item['mode']) or
                    extended_attributes(source / relative) != item.get('xattrs', {})):
                raise StorageError('source_changed_before_verification')
        for filename in ('source.bundle', 'dirty.patch'):
            info = regular_source(dest / filename)
            if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o600:
                raise StorageError('backup_artifact_not_private')
        if digest(dest / 'source.bundle') != metadata['gitBundleSha256']:
            raise StorageError('git_bundle_integrity_failed')
        if digest(dest / 'dirty.patch') != metadata['dirtyPatchSha256']:
            raise StorageError('dirty_patch_integrity_failed')
        # A complete --all bundle must verify against an empty repository, not
        # depend on objects still available in the live checkout.
        guard()
        run(['git', 'init', '--bare', str(scratch / 'git')])
        run(['git', '-C', str(scratch / 'git'), 'bundle', 'verify', str(dest / 'source.bundle')])
        return {'ok': True, 'isolatedRestoreVerified': True,
                'databaseRestoreVerified': False}
    finally:
        guard()
        shutil.rmtree(scratch)


def parse_time(value):
    result = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('timezone missing')
    return result.astimezone(dt.timezone.utc)


def backup_retention_plan(directory):
    """7 distinct days + 4 ISO weeks + 3 months, union; never delete here."""
    verified, protected = [], []
    if not directory.exists():
        return {'retain': [], 'eligible': [], 'protected': []}
    for path in directory.iterdir():
        metadata = read_marker(path / '.cop-backup.json') if path.is_dir() and not path.is_symlink() else None
        try:
            if (not metadata or metadata.get('verified') is not True or
                    metadata.get('scope') != 'deployment_config_and_git_only' or
                    metadata.get('verification') != 'isolated_config_restore_and_git_bundle_verify' or
                    metadata.get('hold') is True or metadata.get('active') is True):
                protected.append(path.name)
                continue
            verified.append((parse_time(metadata['createdAt']), path.name))
        except (ValueError, KeyError, TypeError):
            protected.append(path.name)
    verified.sort(reverse=True)
    keep = set()
    for count, key in ((7, lambda value: value.date()),
                       (4, lambda value: value.isocalendar()[:2]),
                       (3, lambda value: (value.year, value.month))):
        seen = set()
        for when, name in verified:
            period = key(when)
            if period not in seen and len(seen) < count:
                keep.add(name)
                seen.add(period)
    if verified:
        keep.add(verified[0][1])
    return {'retain': sorted(keep), 'eligible': [name for _, name in verified if name not in keep],
            'protected': sorted(protected)}


def tree_bytes(path):
    total = 0
    for parent, directories, files in os.walk(path, followlinks=False):
        if any((Path(parent) / item).is_symlink() for item in directories + files):
            raise StorageError('job_symlink_forbidden')
        for name in files:
            info = (Path(parent) / name).lstat()
            if not stat.S_ISREG(info.st_mode):
                raise StorageError('job_special_file_forbidden')
            total += info.st_size
    return total


def owned_job(path, metadata, kind):
    try:
        identifier = metadata['jobId']
        return (metadata.get('kind') == kind and metadata.get('classification') == 'rebuildable' and
                metadata.get('toolOwned') is True and uuid.UUID(hex=identifier).hex == identifier and
                path.name == 'job-' + identifier)
    except (KeyError, ValueError, TypeError, AttributeError):
        return False


def work_plan(root=X5_ROOT, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    result = {'eligible': [], 'protectedCount': 0, 'managedBytes': 0,
              'maxAgeDays': CACHE_DAYS, 'sizeLimitBytes': CACHE_BYTES}
    completed = []
    for kind in ('cache', 'staging'):
        directory = root / kind / 'cop'
        if not directory.exists():
            continue
        for path in directory.iterdir():
            marker = read_marker(path / '.cop-job.json') if path.is_dir() and not path.is_symlink() else None
            try:
                if (not marker or not owned_job(path, marker, kind) or marker.get('state') != 'completed' or
                        marker.get('hold') is True):
                    result['protectedCount'] += 1
                    continue
                when = parse_time(marker['completedAt'])
                if when > now:
                    raise StorageError('job_time_uncertain')
                size = tree_bytes(path)
                completed.append((when, str(path), size))
                result['managedBytes'] += size
            except (ValueError, KeyError, TypeError, OSError, StorageError):
                result['protectedCount'] += 1
    remaining = result['managedBytes']
    for when, path, size in sorted(completed):
        if now - when > dt.timedelta(days=CACHE_DAYS) or remaining > CACHE_BYTES:
            result['eligible'].append(path)
            remaining -= size
    result['remainingManagedBytes'] = remaining
    return result


def new_job(kind, guard=preflight, root=X5_ROOT):
    if kind not in ('cache', 'staging'):
        raise StorageError('invalid_job_kind')
    layout(guard, root)
    identifier = uuid.uuid4().hex
    dest = root / kind / 'cop' / ('job-' + identifier)
    private_dir(dest, guard)
    write_json(dest / '.cop-job.json', {'tool': TOOL, 'version': 1, 'kind': kind,
               'state': 'active', 'classification': 'rebuildable', 'toolOwned': True,
               'jobId': identifier}, guard)
    # The producer MUST hold .job.lock for its whole lifetime, and complete only
    # after its writers exit. Active/unrecognized directories are never removed.
    write_private(dest / '.job.lock', b'', guard)
    return {'ok': True, 'job': str(dest), 'lock': str(dest / '.job.lock')}


def complete_job(value, guard=preflight, root=X5_ROOT):
    path = Path(value)
    if path.parent not in [root / kind / 'cop' for kind in ('cache', 'staging')] or path.is_symlink():
        raise StorageError('job_outside_managed_scope')
    metadata = read_marker(path / '.cop-job.json')
    if (not metadata or metadata.get('state') != 'active' or
            not owned_job(path, metadata, path.parent.parent.name)):
        raise StorageError('job_not_owned_or_active')
    guard()
    with (path / '.job.lock').open('rb') as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise StorageError('job_still_writing') from None
        tree_bytes(path)
        metadata.update(state='completed', completedAt=dt.datetime.now(dt.timezone.utc).isoformat())
        write_json(path / '.cop-job.json', metadata, guard)
    return {'ok': True, 'job': str(path), 'state': 'completed'}


def cleanup(guard=preflight, root=X5_ROOT):
    plan = work_plan(root)
    removed, skipped, freed = 0, 0, 0
    for value in plan['eligible']:
        path = Path(value)
        guard()
        try:
            fd = os.open(path / '.job.lock', os.O_RDONLY | os.O_NOFOLLOW)
        except OSError:
            skipped += 1
            continue
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                skipped += 1
                continue
            metadata = read_marker(path / '.cop-job.json')
            if (not metadata or metadata.get('state') != 'completed' or metadata.get('hold') is True or
                    not owned_job(path, metadata, path.parent.parent.name)):
                skipped += 1
                continue
            size = tree_bytes(path)
            guard()
            shutil.rmtree(path)
            freed += size
            removed += 1
        finally:
            os.close(fd)
    return {'ok': True, 'removedJobs': removed, 'skippedJobs': skipped, 'removedBytes': freed}


def image_plan():
    # This tool cannot establish image ownership from tags or age. In particular
    # it must not prune a shared daemon/builder. A separately reviewed manifest
    # inventory is required before even proposing exact image IDs for removal.
    return {'mode': 'plan_only', 'eligible': [],
            'protected': 'all_container_images_current_and_two_verified_releases',
            'reason': 'verified_owned_image_inventory_required', 'automaticImageDeletion': False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    commands.add_parser('preflight')
    commands.add_parser('init')
    snap = commands.add_parser('snapshot')
    snap.add_argument('--compose-file', action='append', default=None,
                      help='Actual compose file relative to /srv/cop; repeat for overrides')
    verify = commands.add_parser('verify')
    verify.add_argument('snapshot')
    commands.add_parser('retention-plan')
    commands.add_parser('cleanup')
    job = commands.add_parser('new-job')
    job.add_argument('kind', choices=('cache', 'staging'))
    complete = commands.add_parser('complete-job')
    complete.add_argument('job')
    commands.add_parser('image-plan')
    args = parser.parse_args(argv)
    try:
        if args.action == 'preflight':
            result = preflight()
        elif args.action in ('retention-plan', 'image-plan'):
            preflight()
            result = image_plan() if args.action == 'image-plan' else {
                'mode': 'plan_only', 'backups': backup_retention_plan(X5_ROOT / 'backups' / 'cop'),
                'work': work_plan(), 'images': image_plan(), 'backupDeletionEnabled': False}
        else:
            with operation_lock():
                if args.action == 'init':
                    layout()
                    result = {'ok': True, 'paths': [str(X5_ROOT / kind / 'cop') for kind in KINDS]}
                elif args.action == 'snapshot':
                    result = snapshot(args.compose_file or ['docker-compose.yml'])
                elif args.action == 'verify':
                    path = Path(args.snapshot)
                    if path.parent != X5_ROOT / 'backups' / 'cop' or path.is_symlink():
                        raise StorageError('backup_outside_managed_scope')
                    result = verify_snapshot(path)
                elif args.action == 'new-job':
                    result = new_job(args.kind)
                elif args.action == 'complete-job':
                    result = complete_job(args.job)
                else:
                    result = cleanup()
        print(json.dumps(result, sort_keys=True))
        return 0
    except (StorageError, OSError, ValueError, TypeError, KeyError):
        # Never emit captured command output, file data, hashes, or credentials.
        error = sys.exc_info()[1]
        category = str(error) if isinstance(error, StorageError) else 'operation_failed_without_data_output'
        print(json.dumps({'ok': False, 'error': category}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
