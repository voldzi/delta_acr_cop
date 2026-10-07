#!/usr/bin/env python3
"""Refuse a misconfigured dedicated COP builder; never changes a builder."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('cop_storage', Path(__file__).with_name('cop-storage.py'))
storage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(storage)
NAME = 'buildx_buildkit_cop-x50'
VOLUME = NAME + '_state'
HOST_DATA = Path('/srv/x5-production/cache/cop/buildkit')


def docker(*args):
    result = subprocess.run(['docker', *args], text=True, capture_output=True)
    if result.returncode:
        raise ValueError('docker metadata unavailable')
    return result.stdout


def builder_identity(text):
    # buildx inspect has no --format even on some current releases. Parse only
    # exact documented field headers; ambiguous/multiple nodes fail closed.
    sections = re.split(r'^[ \t]*Nodes:[ \t]*$', text, flags=re.MULTILINE)
    if len(sections) != 2:
        raise ValueError('builder node section unavailable')
    def field(section, name):
        values = re.findall(r'^[ \t]*' + re.escape(name) + r':[ \t]*([^\r\n]+)$',
                            section, flags=re.MULTILINE)
        if len(values) != 1:
            raise ValueError('builder field ambiguous')
        return values[0].strip()
    return {'Name': field(sections[0], 'Name'), 'Driver': field(sections[0], 'Driver'),
            'Nodes': [{'Name': field(sections[1], 'Name'), 'Endpoint': field(sections[1], 'Endpoint')}]}


def verify(allow_stopped=False):
    storage.preflight()
    x5_device = storage.X5_ROOT.stat().st_dev
    if HOST_DATA.is_symlink() or not HOST_DATA.is_dir() or HOST_DATA.stat().st_dev != x5_device:
        raise ValueError('dedicated builder host directory is not on X5')
    context = json.loads(docker('context', 'inspect'))[0]
    endpoint = os.environ.get('DOCKER_HOST') or context['Endpoints']['docker']['Host']
    if endpoint not in ('unix:///var/run/docker.sock', 'unix:///run/docker.sock'):
        raise ValueError('Docker daemon is not the local production socket')
    builder = builder_identity(docker('buildx', 'inspect', 'cop-x5'))
    nodes = builder['Nodes']
    if (builder['Name'] != 'cop-x5' or builder['Driver'] != 'docker-container' or len(nodes) != 1
            or nodes[0]['Name'] != 'cop-x50' or nodes[0]['Endpoint'] not in (endpoint, context['Name'])):
        raise ValueError('dedicated builder node identity mismatch')
    volume = json.loads(docker('volume', 'inspect', VOLUME))[0]
    if (volume['Driver'] != 'local' or volume.get('Options') !=
            {'type': 'none', 'o': 'bind', 'device': str(HOST_DATA)}):
        raise ValueError('dedicated builder volume is not its expected X5 bind')
    container = json.loads(docker('inspect', NAME))[0]
    if container['HostConfig']['RestartPolicy']['Name'] != 'no':
        raise ValueError('dedicated builder can restart without a mount guard')
    mounts = [mount for mount in container['Mounts'] if mount['Destination'] == '/var/lib/buildkit']
    if len(mounts) != 1 or mounts[0].get('Name') != VOLUME or mounts[0].get('RW') is not True:
        raise ValueError('dedicated builder runtime mount identity mismatch')
    running = container['State']['Running'] is True
    if not running and not allow_stopped:
        raise ValueError('dedicated builder is not running')
    if running:
        actual_device = int(docker('exec', NAME, 'stat', '-c', '%d', '/var/lib/buildkit').strip())
        if actual_device != x5_device:
            raise ValueError('dedicated builder is mounted on a different filesystem')
    return {'copBuilderX5ConfigurationVerified': True, 'running': running,
            'copBuilderRuntimeX5Verified': running}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-stopped', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.allow_stopped), sort_keys=True))
    except (OSError, ValueError, KeyError, TypeError, storage.StorageError):
        raise SystemExit('Dedicated COP X5 builder verification failed; no build or prune is allowed') from None
