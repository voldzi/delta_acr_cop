#!/usr/bin/env python3
"""Fixed build-only web candidate from the already sealed COP API checkout.
No application restart, configuration write, database access or active image tag.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
sys.dont_write_bytecode = True

SOURCE = Path('/srv/x5-production/staging/cop/clean-lifecycle-6c5c985')
REVISION = '6c5c9855b29644cdc6e86b5b66166c861226cdba'
IMAGE = 'delta-acr-cop-web:clean-6c5c985'
BASE = Path('/srv/cop')
ALLOWED_ARGS = {
 'VITE_COP_API_BASE_URL', 'VITE_COP_PUBLIC_LAB_VALUE', 'VITE_COP_AUTH_MODE',
 'VITE_COP_PUBLIC_READ_ENABLED', 'VITE_COP_OIDC_ISSUER', 'VITE_COP_OIDC_CLIENT_ID',
 'VITE_COP_OIDC_SCOPE', 'VITE_COP_OIDC_TOKEN_ENDPOINT', 'VITE_COP_BFF_SESSION_ENABLED',
 'VITE_COP_REFRESH_MS', 'VITE_COP_MAP_STYLE_URL', 'VITE_COP_TILE_URL',
 'VITE_COP_TILE_GLYPHS_URL', 'VITE_COP_TILE_ATTRIBUTION', 'VITE_COP_MAP_CENTER',
 'VITE_COP_MAP_ZOOM', 'VITE_COP_PUBLIC_ANALYTICS_ENABLED',
 'VITE_COP_PUBLIC_ANALYTICS_WEBSITE_ID', 'VITE_COP_MESSAGING_LAUNCHER_ENABLED'}
ENV = {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
       'HOME': '/home/voldzi', 'LANG': 'C', 'DOCKER_HOST': 'unix:///var/run/docker.sock',
       'PYTHONDONTWRITEBYTECODE': '1'}


def need(value, code):
    if not value:
        raise RuntimeError(code)


def run(args, timeout=60, extra_env=None):
    result = subprocess.run(args, cwd=BASE, env={**ENV, **(extra_env or {})},
                            capture_output=True, timeout=timeout, check=False)
    need(result.returncode == 0, 'CLEAN_WEB_BUILD_COMMAND_FAILED')
    return result.stdout


def current():
    return run(['/usr/bin/docker', 'inspect', '--format', '{{.Id}} {{.Image}} {{.State.Running}}',
                'cop-cop-api-1', 'cop-cop-web-1'])


def main():
    need(os.getuid() == 1000 and socket.gethostname().split('.')[0] == 'docker', 'CLEAN_WEB_BUILD_HOST_REQUIRED')
    need(len(__import__('sys').argv) == 1, 'CLEAN_WEB_BUILD_FIXED_OPERATION')
    os.umask(0o077)
    run(['/usr/bin/python3', 'scripts/cop-storage.py', 'preflight'])
    with open(BASE / '.storage.lock', 'ab') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        run(['/usr/bin/python3', 'scripts/cop-storage.py', 'preflight'])
        spec = importlib.util.spec_from_file_location('cop_pinned_context', BASE / 'scripts/cop-api-build-context.py')
        context = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(context)
        before_source = context.inspect_context(str(SOURCE), REVISION)
        before = current()
        need(all(line.endswith(b' true') for line in before.splitlines()) and len(before.splitlines()) == 2,
             'CLEAN_WEB_BUILD_CURRENT_UNAVAILABLE')
        run(['/usr/bin/python3', 'scripts/verify-cop-builder.py'])
        compose = ['/usr/bin/docker', 'compose', '--project-name', 'cop']
        for name in ['docker-compose.yml', 'docker-compose.driver-measurements.yml', 'docker-compose.x5.yml', 'docker-compose.ai-router.yml']:
            if name == 'docker-compose.ai-router.yml' and not (BASE / name).exists():
                continue
            compose += ['-f', name]
        # Compose may contain secrets: retain in RAM only, select only reviewed
        # public frontend build arguments; neither raw config nor args are logged.
        configuration = json.loads(run(compose + ['config', '--format', 'json']))
        arguments = configuration['services']['cop-web']['build']['args']
        need(set(arguments) == ALLOWED_ARGS and all(isinstance(v, str) and len(v) < 8192 and '\x00' not in v for v in arguments.values()),
             'CLEAN_WEB_BUILD_ARGUMENTS_CHANGED')
        need(arguments['VITE_COP_PUBLIC_ANALYTICS_ENABLED'] == 'false', 'CLEAN_WEB_ANALYTICS_NOT_APPROVED')
        args = ['/usr/bin/docker', 'buildx', 'build', '--builder', 'cop-x5', '--load', '--label',
                'org.opencontainers.image.revision=' + REVISION, '--tag', IMAGE, '--file', str(SOURCE / 'Dockerfile.web')]
        for name in sorted(arguments):
            args += ['--build-arg', name]
        args += [str(SOURCE)]
        try:
            run(args, timeout=1800, extra_env=arguments)
        finally:
            arguments.clear()
            configuration.clear()
        need(context.inspect_context(str(SOURCE), REVISION) == before_source, 'CLEAN_WEB_BUILD_SOURCE_CHANGED')
        need(current() == before, 'CLEAN_WEB_BUILD_RUNTIME_CHANGED')
        run(['/usr/bin/python3', 'scripts/cop-storage.py', 'preflight'])
        image = json.loads(run(['/usr/bin/docker', 'image', 'inspect', '--format', '{{json .}}', IMAGE]))
        need(image['Config']['Labels'].get('org.opencontainers.image.revision') == REVISION, 'CLEAN_WEB_IMAGE_SOURCE_CHANGED')
        print(json.dumps({'contractVersion': 'cop-clean-web-build-v1', 'sourceRevision': REVISION,
                          'imageId': image['Id'], 'sourceInputDigest': before_source['inputDigest'],
                          'runtimeUnchanged': True, 'accountDeletionEnabled': False, 'buildOnly': True}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, RuntimeError) else 'CLEAN_WEB_BUILD_FAILED'
        print(json.dumps({'contractVersion': 'cop-clean-web-build-v1', 'ok': False,
                          'code': code, 'accountDeletionEnabled': False}))
        raise SystemExit(2)
