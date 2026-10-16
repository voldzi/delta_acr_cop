#!/usr/bin/env python3
"""Fixed immutable COP Edge release under the existing deployment lock.

No secrets are saved, new networks/volumes created or fallback images selected.
The only mutable Docker operation is replacing the existing cop-edge service.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time

sys.dont_write_bytecode = True
ROOT = Path('/srv/cop')
FILES = ('docker-compose.yml', 'docker-compose.driver-measurements.yml',
         'docker-compose.x5.yml', 'docker-compose.ai-router.yml')


def require(value, code):
    if not value:
        raise RuntimeError(code)


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def command(args, input=None):
    result = subprocess.run(args, input=input, capture_output=True, timeout=90,
                            env={**os.environ, 'DOCKER_HOST': 'unix:///var/run/docker.sock',
                                 'DOCKER_CONTEXT': 'default', 'PYTHONDONTWRITEBYTECODE': '1'})
    require(result.returncode == 0, 'edge_command_failed')
    return result.stdout


def docker(*args):
    return command(['docker', '--host', 'unix:///var/run/docker.sock', *args])


def inspected(identifier):
    values = json.loads(docker('inspect', identifier))
    require(len(values) == 1, 'edge_container_ambiguous')
    return values[0]


def verify_image(value, image, revision):
    require(re.fullmatch(r'sha256:[a-f0-9]{64}', image) is not None and
            re.fullmatch(r'[a-f0-9]{40}', revision) is not None and value.get('Id') == image and
            value.get('Config', {}).get('Labels', {}).get('org.opencontainers.image.revision') == revision,
            'edge_image_source_unpinned')


def environment(config):
    values = config.get('Env') or []
    require(all(isinstance(value, str) and '=' in value for value in values), 'edge_environment_invalid')
    result = dict(value.split('=', 1) for value in values)
    require(len(result) == len(values), 'edge_environment_duplicate')
    return result


def desired_runtime(config, current):
    """Resolve a named volume by its actual Docker volume identity, never path guess."""
    desired = copy.deepcopy(config['services']['cop-edge'])
    actual = {mount['Destination']: mount for mount in current.get('Mounts', [])}
    for mount in desired.get('volumes', []):
        if mount['type'] == 'volume':
            value = actual.get(mount['target'], {})
            require(value.get('Type') == 'volume' and
                    value.get('Name') == config['volumes'][mount['source']]['name'], 'edge_volume_identity_changed')
            mount['source'] = value['Source']
    return desired


def validate_runtime(runtime, config, image_config, parity):
    labels = runtime.get('Config', {}).get('Labels', {})
    require(labels.get('com.docker.compose.project') == 'cop' and
            labels.get('com.docker.compose.service') == 'cop-edge' and
            runtime.get('State', {}).get('Running') is True and
            runtime['State'].get('Paused') is False and runtime['State'].get('Pid', 0) > 0,
            'edge_runtime_unowned')
    desired = desired_runtime(config, runtime)
    wanted = environment(image_config)
    wanted.update(desired.get('environment', {}))
    require(environment(runtime['Config']) == wanted, 'edge_environment_drift')
    parity(runtime, desired, image_config)
    expected_networks = {config['networks'][name]['name'] for name in desired.get('networks', {})}
    require(set(runtime.get('NetworkSettings', {}).get('Networks', {})) == expected_networks,
            'edge_network_scope_changed')
    require('/data/edge' in {mount['Destination'] for mount in runtime.get('Mounts', [])},
            'edge_persistent_store_missing')


def container_witness(value):
    return {key: value[key] for key in ('Id', 'Image', 'Config', 'HostConfig', 'Mounts')} | {
        'process': {key: value['State'].get(key) for key in ('Running', 'Paused', 'Pid', 'StartedAt')},
        'networks': {key: item['NetworkID'] for key, item in value['NetworkSettings']['Networks'].items()}}


def preserve(old, new):
    """All mounted data and network objects retain their actual daemon identities."""
    def mounts(value):
        return sorted((m['Destination'], m['Type'], m['Source'], m.get('Name'), m['RW'])
                      for m in value.get('Mounts', []))
    require(mounts(old) == mounts(new), 'edge_persistent_mount_changed')
    def networks(value):
        return {key: item['NetworkID'] for key, item in value['NetworkSettings']['Networks'].items()}
    require(networks(old) == networks(new), 'edge_network_identity_changed')


PROBE = r"""
const base='http://127.0.0.1:4312';
for(const path of ['/health/live','/health/ready']){const r=await fetch(base+path,{redirect:'error',signal:AbortSignal.timeout(3000)});const b=await r.json();if(r.status!==200||b.status!=='ok')process.exit(1);}
const token=process.env.COP_EDGE_ADMIN_TOKEN;if(!token)process.exit(1);
const r=await fetch(base+'/edge/internal/account-erasure/capabilities',{headers:{authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(3000)});const b=await r.json();
if(r.status!==200||b.contractVersion!=='cop-edge-account-erasure-v1'||b.nodeId!==process.env.COP_EDGE_NODE_ID||b.writerFenceInstalled!==true||b.stateReadbackVerified!==true)process.exit(1);
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--job', required=True)
    args = parser.parse_args()
    require(os.geteuid() == 1000 and Path.cwd() == ROOT and os.environ.get('COP_STORAGE_LOCK_FD'),
            'edge_deployment_context_invalid')
    storage = load('cop_storage_edge', ROOT / 'scripts/cop-storage.py')
    runtime = load('cop_runtime_edge', ROOT / 'scripts/cop-api-runtime.py')
    with storage.operation_lock():
        job = Path(args.job)
        require(job.parent == Path('/srv/x5-production/staging/cop') and
                re.fullmatch(r'job-[a-f0-9]{32}', job.name) is not None and not job.is_symlink(),
                'edge_job_scope_invalid')
        info = job.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 1000 and stat.S_IMODE(info.st_mode) == 0o700,
                'edge_job_custody_invalid')
        require(command(['git', 'rev-parse', 'HEAD']).decode().strip() == args.revision,
                'edge_source_checkout_changed')
        records=command(['git','status','--porcelain=v1','--untracked-files=all','-z']).split(b'\0')
        require(all(not value or value in {b'?? .storage.lock',b'?? docker-compose.ai-router.yml'} for value in records),
                'edge_source_checkout_dirty')
        image = json.loads(docker('image', 'inspect', args.image))[0]
        verify_image(image, args.image, args.revision)
        docker('run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
               '--entrypoint', 'node', args.image, '--input-type=module', '-e',
               "import('/app/apps/cop-edge-node/dist/account-erasure.js').then(m=>{if(typeof m.parseEdgeErasureRequest!=='function'||typeof m.validateEdgeErasureJournal!=='function')process.exit(1)}).catch(()=>process.exit(1))")
        paths = [ROOT / name for name in FILES if (ROOT / name).exists()]
        require(len(paths) >= 3, 'edge_compose_missing')
        private_paths = [ROOT / '.env', *paths]
        env_stat=(ROOT / '.env').lstat()
        require(stat.S_ISREG(env_stat.st_mode) and env_stat.st_nlink == 1 and env_stat.st_uid == 1000 and
                stat.S_IMODE(env_stat.st_mode) == 0o600, 'edge_environment_custody_invalid')
        pins = {str(path): hashlib.sha256(path.read_bytes()).digest() for path in private_paths}
        def unchanged():
            require(all(not Path(path).is_symlink() and hashlib.sha256(Path(path).read_bytes()).digest() == digest
                        for path, digest in pins.items()), 'edge_source_or_environment_changed')
        def compose(extra=()):
            return ['docker', '--host', 'unix:///var/run/docker.sock', 'compose', '--project-name', 'cop',
                    '--project-directory', str(ROOT), '--env-file', str(ROOT / '.env'),
                    *[part for path in paths for part in ('-f', str(path))], *extra]
        def current():
            ids = command(compose() + ['ps', '--all', '-q', 'cop-edge']).decode().split()
            require(len(ids) == 1, 'edge_container_ambiguous')
            return inspected(ids[0])
        before = current()
        config = json.loads(command(compose() + ['config', '--format', 'json']))
        previous_image = json.loads(docker('image', 'inspect', before['Image']))[0]
        validate_runtime(before, config, previous_image['Config'], runtime.runtime_parity)
        others = docker('ps', '--filter', 'label=com.docker.compose.project=cop', '--format', '{{.ID}}').decode().split()
        others = sorted(inspected(identifier)['Id'] for identifier in others if inspected(identifier)['Id'] != before['Id'])
        overlay = job / 'edge-image.json'
        with overlay.open('x') as handle:
            json.dump({'services': {'cop-edge': {'image': args.image}}}, handle)
        desired = json.loads(command(compose(['-f', str(overlay)]) + ['config', '--format', 'json']))
        expected = copy.deepcopy(config)
        expected['services']['cop-edge']['image'] = args.image
        require(desired == expected, 'edge_compose_scope_changed')
        unchanged()
        witnessed = current()
        require(container_witness(witnessed) == container_witness(before), 'edge_container_changed_before_release')
        command(compose(['-f', str(overlay)]) + ['up', '-d', '--no-build', '--pull', 'never', '--no-deps', 'cop-edge'])
        actual = current()
        require(actual['Image'] == args.image, 'edge_target_image_changed')
        validate_runtime(actual, desired, image['Config'], runtime.runtime_parity)
        preserve(before, actual)
        after_others = sorted(inspected(identifier)['Id'] for identifier in
                              docker('ps', '--filter', 'label=com.docker.compose.project=cop', '--format', '{{.ID}}').decode().split()
                              if inspected(identifier)['Id'] != actual['Id'])
        require(others == after_others, 'edge_other_service_changed')
        ready = False
        for _ in range(20):
            result = subprocess.run(['docker', '--host', 'unix:///var/run/docker.sock', 'exec', actual['Id'],
                                     'node', '--input-type=module', '-e', PROBE], capture_output=True, timeout=15)
            if result.returncode == 0:
                ready = True
                break
            time.sleep(1)
        require(ready, 'edge_actual_readiness_failed')
        unchanged()
        after = current()
        require(after['Id'] == actual['Id'] and after['Image'] == args.image and
                after['State']['Pid'] == actual['State']['Pid'] and
                after['State']['StartedAt'] == actual['State']['StartedAt'], 'edge_container_changed_after_readiness')
        validate_runtime(after, desired, image['Config'], runtime.runtime_parity)
        print(json.dumps({'phase': 'edge_immutable_release_verified', 'sourceRevision': args.revision,
                          'imageId': args.image, 'containerId': actual['Id'], 'dataMountPreserved': True,
                          'networkIdentityPreserved': True, 'accountErasureCapabilitiesVerified': True}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'phase': 'edge_release_not_complete', 'fallbackPerformed': False}), file=sys.stderr)
        sys.exit(1)
