#!/usr/bin/env python3
"""Recover only a missing dedicated COP BuildKit container above verified X5.
No prune, volume creation/deletion, shared builder or Docker data-root changes.
"""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('cop_builder', Path(__file__).with_name('verify-cop-builder.py'))
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)
IMAGE = 'sha256:27933730df224df80c41f4e5a9b33fa78831a79fd31903df3bb7deb49363422f'
REFERENCE = 'moby/buildkit@sha256:cec9f139f45e93c5c69c60f8b07cfad9f43f4ef6b6a6cd917527fea5ff2e3dea'
CONFIG = Path('/home/voldzi/.docker/buildx/instances/cop-x5')
FLAGS = ['--oci-worker-gc', '--oci-worker-gc-keepstorage', '1000,10000,10000', '--allow-insecure-entitlement=network.host']
ENV = {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/home/voldzi',
       'LANG': 'C', 'DOCKER_HOST': 'unix:///var/run/docker.sock'}


def need(value, code):
    if not value:
        raise RuntimeError(code)


def command(args, timeout=30):
    r = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=ENV)
    need(r.returncode == 0, 'COP_BUILDER_COMMAND_FAILED')
    return r.stdout


def configuration(raw):
    v = json.loads(raw)
    need(set(v) == {'Name', 'Driver', 'Nodes', 'Dynamic'} and v['Name'] == 'cop-x5'
         and v['Driver'] == 'docker-container' and v['Dynamic'] is False
         and isinstance(v['Nodes'], list) and len(v['Nodes']) == 1, 'COP_BUILDER_CONFIG_CHANGED')
    n = v['Nodes'][0]
    need(set(n) == {'Name', 'Endpoint', 'Platforms', 'DriverOpts', 'Flags', 'Files'}
         and n['Name'] == 'cop-x50' and n['Endpoint'] == 'unix:///var/run/docker.sock'
         and not n['Platforms'] and not n['Files']
         and (n['Flags'] == FLAGS or n['Flags'] == FLAGS + [FLAGS[-1]]
              and n['DriverOpts'] == {'image': REFERENCE, 'restart-policy': 'no'})
         and isinstance(n['DriverOpts'], dict) and set(n['DriverOpts']) <= {'image', 'restart-policy'}
         and n['DriverOpts'].get('image') in {'moby/buildkit:buildx-stable-1', REFERENCE}
         and n['DriverOpts'].get('restart-policy', 'no') == 'no', 'COP_BUILDER_NODE_CHANGED')
    return v


def read_config():
    fd = os.open(CONFIG, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        s = os.fstat(fd)
        need(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and s.st_uid == 1000 and not s.st_mode & 0o022
             and s.st_size < 16384, 'COP_BUILDER_CONFIG_UNSAFE')
        raw = os.read(fd, 16385)
        need(len(raw) == s.st_size, 'COP_BUILDER_CONFIG_UNSAFE')
        return raw, configuration(raw)
    finally:
        os.close(fd)


def runtime_identity():
    value = json.loads(command(['docker', 'inspect', verify.NAME]))[0]
    need(value['Name'] == '/' + verify.NAME and value['Image'] == IMAGE, 'COP_BUILDER_IMAGE_CHANGED')
    return value


def recover():
    need(os.getuid() == 1000 and Path.home() == Path('/home/voldzi'), 'COP_BUILDER_OPERATOR_REQUIRED')
    os.environ.update(ENV)
    lock = os.open('/srv/cop/.storage.lock', os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        verify.storage.preflight()
        need(verify.HOST_DATA.is_dir() and not verify.HOST_DATA.is_symlink()
             and verify.HOST_DATA.stat().st_dev == verify.storage.X5_ROOT.stat().st_dev, 'COP_BUILDER_X5_REQUIRED')
        _, before = read_config()
        expected = {'Name': 'cop-x5', 'Driver': 'docker-container', 'Nodes': [{'Name': 'cop-x50', 'Endpoint': 'unix:///var/run/docker.sock'}]}
        need(verify.builder_identity(command(['docker', 'buildx', 'inspect', 'cop-x5'])) == expected, 'COP_BUILDER_IDENTITY_CHANGED')
        volume = json.loads(command(['docker', 'volume', 'inspect', verify.VOLUME]))[0]
        need(volume['Name'] == verify.VOLUME and volume['Driver'] == 'local' and volume.get('Options') ==
             {'type': 'none', 'o': 'bind', 'device': str(verify.HOST_DATA)}, 'COP_BUILDER_VOLUME_CHANGED')
        names = command(['docker', 'container', 'ls', '-a', '--format', '{{.Names}}']).splitlines()
        need(verify.NAME not in names, 'COP_BUILDER_CONTAINER_ALREADY_EXISTS')
        image = json.loads(command(['docker', 'image', 'inspect', REFERENCE]))[0]
        need(image['Id'] == IMAGE and REFERENCE in image['RepoDigests'], 'COP_BUILDER_LOCAL_IMAGE_CHANGED')
        # Buildx's documented create --node modifies this one existing node.
        # Keep GC/entitlement flags; pin the already-installed image and ensure
        # future daemon restarts cannot start this builder without X5 checks.
        command(['docker', 'buildx', 'create', '--name', 'cop-x5', '--node', 'cop-x50',
                 '--driver-opt', 'image=' + REFERENCE, '--driver-opt', 'restart-policy=no',
                 '--buildkitd-flags', ' '.join(FLAGS[:-1]), 'unix:///var/run/docker.sock'])
        _, after = read_config()
        expected_config = json.loads(json.dumps(before))
        expected_config['Nodes'][0]['DriverOpts'] = {'image': REFERENCE, 'restart-policy': 'no'}
        expected_config['Nodes'][0]['Flags'] = FLAGS
        need(after == expected_config, 'COP_BUILDER_UNEXPECTED_CONFIG_DELTA')
        try:
            command(['docker', 'buildx', 'inspect', 'cop-x5', '--bootstrap'], timeout=120)
            actual = runtime_identity()
            need(actual['HostConfig']['RestartPolicy']['Name'] == 'no', 'COP_BUILDER_RESTART_UNSAFE')
            proof = verify.verify(False)
            need(proof['copBuilderRuntimeX5Verified'] is True, 'COP_BUILDER_RUNTIME_UNVERIFIED')
        except BaseException:
            # Never alter a different image/container after a failed bootstrap.
            try:
                actual = runtime_identity()
                command(['docker', 'stop', '--time', '10', actual['Id']], timeout=20)
            except BaseException:
                pass
            raise
        return {'contractVersion': 'cop-dedicated-builder-recovery-v1', **proof, 'imageId': IMAGE,
                'existingCachePreserved': True, 'prunePerformed': False, 'applicationRestarted': False,
                'configurationSha256': hashlib.sha256(json.dumps(after, sort_keys=True).encode()).hexdigest()}
    finally:
        os.close(lock)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recover-missing', action='store_true', required=True)
    parser.parse_args()
    try:
        print(json.dumps(recover(), sort_keys=True))
    except Exception as e:
        code = str(e) if isinstance(e, RuntimeError) and str(e).startswith('COP_BUILDER_') else 'COP_BUILDER_RECOVERY_FAILED'
        print(json.dumps({'code': code, 'applicationRestarted': False, 'prunePerformed': False}))
        raise SystemExit(2)
