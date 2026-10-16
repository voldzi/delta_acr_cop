"""Run actual cached Keycloak26.8 in owned isolated containers, never production data."""
import argparse
import base64
import hashlib
import io
import json
import pathlib
import subprocess
import tarfile
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[2]
KEYCLOAK = 'sha256:43ebe9d4e97c2e5483b7637edf474e6adc1bbf4832a7396686cf90259c396d42'
NODE = 'sha256:a06c103764701e7debc6434e3dd98e9a6d5f218d30831cb62aad566265db392f'
KEYCLOAK_MANIFEST = 'quay.io/keycloak/keycloak@sha256:b0f60d489d51c5d113390bdf5461d4c06e6051be026c05549f2e1e10ec352bcc'
parser = argparse.ArgumentParser()
parser.add_argument('--run', action='store_true', required=True)
parser.add_argument('--host', choices=['docker.home.cz'], required=True)
parser.add_argument('--ssh-option', action='append', default=[])
args = parser.parse_args()
ssh = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=8']
for value in args.ssh_option:
    ssh += ['-o', value]
ssh += [args.host]
prefix = 'cop-keycloak-erasure-test-' + uuid.uuid4().hex[:12]
kc = prefix + '-kc'
probe = prefix + '-node'
fixture_image = prefix + '-image'


def remote(command, data=None, check=True, timeout=90):
    return subprocess.run(ssh + [command], input=data, text=True, capture_output=True, check=check, timeout=timeout)


sources = {
    'keycloak-account-erasure.js': ROOT / 'apps/cop-api/dist/keycloak-account-erasure.js',
    'bounded-upstream.js': ROOT / 'apps/cop-api/dist/bounded-upstream.js',
    'probe.mjs': ROOT / 'scripts/keycloak/erasure-provider-probe.mjs',
    'provision-erasure-client.mjs': ROOT / 'scripts/keycloak/provision-erasure-client.mjs'
}
files = {k: base64.b64encode(p.read_bytes()).decode() for k, p in sources.items()}
files['package.json'] = base64.b64encode(b'{"type":"module"}').decode()
bootstrap = """import{readFileSync,writeFileSync,mkdirSync}from'node:fs';
try{const files=JSON.parse(readFileSync(0,'utf8'));mkdirSync('/tmp/cop-probe',{recursive:true});
for(const[k,v]of Object.entries(files)){if(!/^[a-z.-]+$/.test(k))throw Error();writeFileSync('/tmp/cop-probe/'+k,Buffer.from(v,'base64'));}
await import('/tmp/cop-probe/probe.mjs');}catch(error){console.log(JSON.stringify({error:'isolated_keycloak_probe_failed',stage:globalThis.fixtureStage??'bootstrap',roleMetadata:globalThis.fixtureRoleMetadata,sourceFrames:String(error.stack??'').split('\\n').flatMap(x=>x.match(/(?:provision-erasure-client|probe)\\.mjs:[0-9]+:[0-9]+/g)??[])}));process.exitCode=1;}"""
# Base64 is only source transport for these synthetic fixture files, not encryption.
node_command = "node --input-type=module -e " + "'" + bootstrap.replace("'", "'\"'\"'") + "'"
before = remote("docker inspect keycloak --format '{{.Id}}'").stdout.strip()
result = None
try:
    # The cached upstream image is intentionally unoptimized. Build only its
    # dev-file configuration in an owned offline classic build, then run with
    # a read-only root. Never commit/copy a running production container.
    dockerfile = ('FROM ' + KEYCLOAK_MANIFEST + '\nLABEL cop.test.owner=' + prefix +
                  '\nRUN JAVA_OPTS_APPEND="-Xms128m -Xmx384m" /opt/keycloak/bin/kc.sh build --db=dev-file\n').encode()
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode='w') as tar:
        info = tarfile.TarInfo('Dockerfile')
        info.size = len(dockerfile)
        tar.addfile(info, io.BytesIO(dockerfile))
    build = remote('base64 -d | DOCKER_BUILDKIT=0 docker build --pull=false --network none --rm --force-rm'
                   ' --memory 768m --cpu-period 100000 --cpu-quota 100000 -t ' + fixture_image + ' -',
                   base64.b64encode(archive.getvalue()).decode(), check=False)
    if build.returncode:
        result = {'error': 'isolated_fixture_build_failed', 'exitCode': 1,
                  'fixtureBuildDiagnostics': (build.stdout + build.stderr).splitlines()[-10:]}
        raise SystemExit(1)
    built_image_id = remote('docker image inspect ' + fixture_image + ' --format "{{.Id}}"').stdout.strip()
    common = (' --label cop.test.owner=' + prefix + ' --read-only --cap-drop ALL'
              ' --security-opt no-new-privileges --pids-limit 128 --cpus 1')
    remote('docker run -d --name ' + kc + common + ' --network none --user 1000:0 --memory 768m'
           ' --tmpfs /opt/keycloak/data:rw,size=256m,uid=1000,gid=0,mode=0700'
           ' --tmpfs /tmp:rw,size=64m,uid=1000,gid=0,mode=0700'
           ' --env KC_BOOTSTRAP_ADMIN_USERNAME=fixture-admin'
           ' --env KC_BOOTSTRAP_ADMIN_PASSWORD=synthetic-bootstrap-not-production'
           ' --env JAVA_OPTS_APPEND="-Xms128m -Xmx384m" ' + fixture_image +
           ' start --optimized --http-enabled=true --hostname=http://127.0.0.1:8080 --db=dev-file --log-level=warn')
    remote('docker run -d --name ' + probe + common + ' --network container:' + kc +
           ' --user 1000:1000 --memory 192m --tmpfs /tmp:rw,size=32m,uid=1000,gid=1000,mode=0700'
           ' --entrypoint node ' + NODE + ' -e "setInterval(()=>{},1000)"')
    execution = remote('docker exec -i ' + probe + ' ' + node_command, json.dumps(files), check=False)
    lines = execution.stdout.strip().splitlines()
    result = json.loads(lines[-1]) if lines else {'error': 'isolated_probe_no_result'}
    if execution.returncode and result.get('stage') == 'provider_startup':
        state = json.loads(remote('docker inspect ' + kc).stdout)[0]['State']
        result['fixtureProviderState'] = {k: state[k] for k in ('Running', 'ExitCode', 'OOMKilled')}
        # Only our pre-provisioning fixture logs, never production/provider
        # user logs. No user or service credential has been created yet.
        logs = remote('docker logs ' + kc, check=False)
        lines = (logs.stdout + logs.stderr).splitlines()
        result['fixtureStartupDiagnostics'] = [line.replace('synthetic-bootstrap-not-production', '[fixture-redacted]') for line in lines[-12:]]
    result['exitCode'] = execution.returncode
    result['keycloakImage'] = KEYCLOAK
    result['fixtureOptimizedImage'] = built_image_id
    result['fixtureDockerfileSha256'] = hashlib.sha256(dockerfile).hexdigest()
    result['sourceSha256'] = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources.values()}
finally:
    remote('docker rm -f ' + probe, check=False)
    remote('docker rm -f ' + kc, check=False)
    remote('docker image rm ' + fixture_image, check=False)
    # Only this unique build's labeled objects, never a prune/shared builder.
    for _ in range(3):
        owned = remote('docker image ls -aq --filter label=cop.test.owner=' + prefix).stdout.split()
        if not owned:
            break
        if not all(len(value) in (12, 64) and all(c in '0123456789abcdef' for c in value) for value in owned):
            raise SystemExit('INVALID_OWNED_IMAGE_ID')
        remote('docker image rm ' + ' '.join(owned), check=False)
    containers = remote('docker ps -aq --filter label=cop.test.owner=' + prefix).stdout.strip()
    images = remote('docker image ls -aq --filter label=cop.test.owner=' + prefix).stdout.strip()
    after = remote("docker inspect keycloak --format '{{.Id}}'").stdout.strip()
    if result is not None:
        result['ownedFixturesRemoved'] = not containers and not images
        result['productionKeycloakContainerUnchanged'] = before == after
        print(json.dumps(result))
if not result or result.get('exitCode') != 0 or not result.get('ownedFixturesRemoved') or not result.get('productionKeycloakContainerUnchanged'):
    raise SystemExit(1)
