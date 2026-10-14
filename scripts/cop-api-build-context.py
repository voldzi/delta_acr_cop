#!/usr/bin/env python3
"""Offline source validator. Never builds, deploys, clones or changes permissions."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

sys.dont_write_bytecode = True
STAGING = Path('/srv/x5-production/staging/cop')
OPERATIONAL = Path('/srv/cop')
ORIGINS = {
    'https://github.com/voldzi/delta_acr_cop.git',
    'https://github.com/voldzi/delta_acr_cop',
    'git@github.com:voldzi/delta_acr_cop.git',
    'git@github-cop:voldzi/delta_acr_cop.git',
    'ssh://git@github.com/voldzi/delta_acr_cop.git',
    'ssh://git@github-cop/voldzi/delta_acr_cop.git',
}


class ContextError(Exception):
    pass


def require(value, code):
    if not value:
        raise ContextError(code)


def unreadable_tree(_error):
    raise ContextError('api_context_unreadable_tree')


def validate_mode(build_only, deploy_only, services):
    require(build_only and not deploy_only and services == ['cop-api'],
            'api_context_requires_build_only_single_cop_api')


def git(root, *args):
    # Git environment/config cannot redirect provenance or start a fsmonitor.
    env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null', GIT_OPTIONAL_LOCKS='0')
    result = subprocess.run(['git', '-c', 'safe.directory=' + str(root),
                             '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
                             '-C', str(root), *args], env=env, capture_output=True, check=False)
    require(result.returncode == 0, 'api_context_git_unavailable')
    return result.stdout


def origin(root):
    values = git(root, 'config', '--local', '--no-includes', '--get-all', 'remote.origin.url').decode().splitlines()
    require(len(values) == 1 and values[0] in ORIGINS, 'api_context_not_cop_repository')
    config = git(root, 'config', '--local', '--no-includes', '--name-only', '--list').decode().splitlines()
    require(not any(key.lower().startswith(('include.', 'includeif.', 'filter.', 'diff.', 'core.fsmonitor',
                                           'core.worktree', 'extensions.worktreeconfig')) for key in config),
            'api_context_unsupported_git_config')


def inspect_context(value, revision, *, staging=STAGING, operational=OPERATIONAL, uid=0):
    require(bool(re.fullmatch(r'[a-f0-9]{40}', revision)), 'api_context_requires_reviewed_revision')
    require(isinstance(value, str) and value.startswith('/') and value == os.path.normpath(value),
            'api_context_absolute_normalized_path_required')
    root = Path(value)
    require(root != staging and staging in root.parents, 'api_context_outside_cop_x5_staging')
    require(root != operational and operational not in root.parents and root not in operational.parents,
            'api_context_overlaps_operational_checkout')
    current = Path(root.anchor)
    for part in root.parts[1:]:
        current /= part
        require(not current.is_symlink(), 'api_context_symlink_forbidden')
    require(root.is_dir() and (root / '.git').is_dir() and not (root / '.git').is_symlink(),
            'api_context_full_git_checkout_required')
    device = staging.stat().st_dev
    info = root.stat()
    metadata = hashlib.sha256()
    actual_files = set()
    for directory, dirs, files in os.walk(root, followlinks=False, onerror=unreadable_tree):
        for path in [Path(directory), *(Path(directory) / name for name in dirs + files)]:
            item = path.lstat()
            require(not stat.S_ISLNK(item.st_mode), 'api_context_symlink_forbidden')
            require(item.st_uid == uid and not stat.S_IMODE(item.st_mode) & 0o222,
                    'api_context_requires_root_owned_read_only_tree')
            require(item.st_dev == device, 'api_context_not_on_x5')
            require(stat.S_ISDIR(item.st_mode) or stat.S_ISREG(item.st_mode), 'api_context_special_file_forbidden')
            require(not stat.S_ISREG(item.st_mode) or item.st_nlink == 1, 'api_context_hardlink_alias_forbidden')
            if stat.S_ISREG(item.st_mode) and root / '.git' not in path.parents:
                actual_files.add(os.fsencode(path.relative_to(root)))
    require(not any((root / '.git' / path).exists() for path in ('commondir', 'objects/info/alternates', 'worktrees')),
            'api_context_external_git_metadata_forbidden')
    origin(root)
    origin(operational)
    require(git(root, 'rev-parse', '--show-toplevel').decode().strip() == str(root), 'api_context_git_root_mismatch')
    require(git(root, 'rev-parse', '--abbrev-ref', 'HEAD').strip() == b'HEAD', 'api_context_detached_revision_required')
    require(git(root, 'rev-parse', 'HEAD').decode().strip() == revision, 'api_context_reviewed_revision_mismatch')
    require(not git(root, 'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching', '-z'),
            'api_context_dirty_or_untracked')
    # Compare actual tracked bytes to HEAD as well: status alone can miss
    # assume-unchanged/skip-worktree input or trusted timestamp metadata.
    records = git(root, 'ls-tree', '-r', '-z', 'HEAD').split(b'\0')
    tracked_files = set()
    for record in records:
        if not record:
            continue
        fields, name = record.split(b'\t', 1)
        mode, kind, blob = fields.split(b' ')
        tracked_files.add(name)
        require(mode in (b'100644', b'100755') and kind == b'blob', 'api_context_symlink_or_submodule_forbidden')
        path = root / os.fsdecode(name)
        require(path.is_file(), 'api_context_tracked_file_missing')
        data = path.read_bytes()
        actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest().encode()
        require(actual == blob, 'api_context_tracked_bytes_mismatch')
        require(path.stat().st_mode & 0o111 == (0o111 if mode == b'100755' else 0), 'api_context_tracked_mode_mismatch')
        metadata.update(record + b'\0')
    require(actual_files == tracked_files, 'api_context_untracked_build_bytes')
    for name in ('HEAD', 'config', 'index'):
        metadata.update(name.encode() + b'\0' + (root / '.git' / name).read_bytes())
    return {'contractVersion': 'cop-api-build-context-v1', 'context': str(root), 'revision': revision,
            'device': info.st_dev, 'inode': info.st_ino, 'inputDigest': metadata.hexdigest()}


def pin_context(value, revision, pin_file, **test_layout):
    result = inspect_context(value, revision, **test_layout)
    with open(pin_file, 'x', encoding='utf8') as handle:
        json.dump(result, handle, sort_keys=True)
        handle.write('\n')
    return result


def verify_context(value, revision, pin_file, **test_layout):
    result = inspect_context(value, revision, **test_layout)
    with open(pin_file, encoding='utf8') as handle:
        expected = json.load(handle)
    require(result == expected, 'api_context_pin_changed')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('validate', 'pin', 'verify'))
    parser.add_argument('--context', required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--build-only', choices=('true', 'false'))
    parser.add_argument('--deploy-only', choices=('true', 'false'))
    parser.add_argument('--service', action='append', default=[])
    parser.add_argument('--pin-file')
    args = parser.parse_args()
    if args.command == 'validate':
        validate_mode(args.build_only == 'true', args.deploy_only == 'true', args.service)
    if args.command == 'pin':
        require(bool(args.pin_file), 'api_context_pin_file_required')
        pin_context(args.context, args.revision, args.pin_file)
    elif args.command == 'verify':
        require(bool(args.pin_file), 'api_context_pin_file_required')
        verify_context(args.context, args.revision, args.pin_file)
    else:
        result = inspect_context(args.context, args.revision)
        print(result['revision'])


if __name__ == '__main__':
    try:
        main()
    except (ContextError, OSError, ValueError, KeyError, UnicodeError):
        # No subprocess stderr, Git URL/config or private operational metadata.
        print('COP API build context validation failed', file=sys.stderr)
        sys.exit(1)
