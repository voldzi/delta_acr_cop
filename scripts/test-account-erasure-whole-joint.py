#!/usr/bin/env python3
"""Owned whole-erasure fixture coordinator. No production providers or public ports.

Keycloak preparation creates real A/B identities for the shared SIM holder. Whole
acceptance refuses to run until the actual remaining providers are attached.
Private manifests contain only synthetic fixture credentials and are never printed.
"""
import argparse
import base64
import hashlib
import io
import json
import os
import pathlib
import re
import shlex
import stat
import subprocess
import sys
import tarfile
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/account-safety'))
import whole_server_local as server_local
SERVER_LOCAL = False
PUBLIC_SOURCE_PROOF = None
KC_IMAGE = 'sha256:43ebe9d4e97c2e5483b7637edf474e6adc1bbf4832a7396686cf90259c396d42'
KC_MANIFEST = 'quay.io/keycloak/keycloak@sha256:b0f60d489d51c5d113390bdf5461d4c06e6051be026c05549f2e1e10ec352bcc'
NODE_IMAGE = 'sha256:a06c103764701e7debc6434e3dd98e9a6d5f218d30831cb62aad566265db392f'
ISSUER = 'https://cop-erasure-keycloak.invalid/realms/cop-erasure-whole'
PREFIX = 'cop-erasure-whole-'
SSH = ['ssh', '-4', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=8',
       '-o', 'HostName=192.168.10.116', '-o', 'HostKeyAlias=docker.home.cz', 'docker.home.cz']


def remote_argv(command):
    return ['/usr/bin/env', '-u', 'DOCKER_CONTEXT', 'DOCKER_HOST=unix:///var/run/docker.sock', '/bin/sh', '-c', command] if SERVER_LOCAL else SSH + [command]


def remote(command, body=None, check=True, timeout=90):
    return subprocess.run(remote_argv(command), input=body, text=True, capture_output=True, check=check, timeout=timeout)


def safe_manifest(path, required=False):
    if SERVER_LOCAL:
        return server_local.validate_server_manifest_path(path, required)
    value = pathlib.Path(path)
    if value.parent != pathlib.Path('/private/tmp') or not re.fullmatch(r'cop-account-erasure-whole-(?:fixture|full)-[a-zA-Z0-9-]+\.json', value.name):
        raise RuntimeError('FIXTURE_MANIFEST_PATH_REJECTED')
    if value.exists() or value.is_symlink():
        observed = value.lstat()
        if not stat.S_ISREG(observed.st_mode) or observed.st_nlink != 1 or observed.st_uid != os.getuid() or stat.S_IMODE(observed.st_mode) != 0o600:
            raise RuntimeError('FIXTURE_MANIFEST_CUSTODY_REJECTED')
    elif required:
        raise RuntimeError('WHOLE_FIXTURE_MANIFEST_REQUIRED')
    return value



def case_suffix(manifest):
    name = pathlib.Path(manifest['_manifestPath']).name
    match = re.fullmatch(r'cop-account-erasure-whole-(?:fixture-)?([a-zA-Z0-9-]+)\.json', name)
    if not match:
        raise RuntimeError('FIXTURE_CASE_NAME_REJECTED')
    return match.group(1)


def case_private_path(manifest, prefix):
    if prefix not in ['cop-messaging-joint-bootstrap', 'cop-sim-whole-erasure-fixture']:
        raise RuntimeError('FIXTURE_PRIVATE_PREFIX_REJECTED')
    parent = pathlib.Path(manifest['_manifestPath']).parent if SERVER_LOCAL else pathlib.Path('/private/tmp')
    return parent / (prefix + '-' + case_suffix(manifest) + '.json')


def write_private(path, value):
    encoded = json.dumps(value, indent=2).encode() + b'\n'
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        pending=memoryview(encoded)
        while pending:pending=pending[os.write(fd,pending):]
        os.fsync(fd)
    finally:
        os.close(fd)


def check_owned(name, owner):
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{1,100}', name):
        raise RuntimeError('FIXTURE_CONTAINER_NAME_REJECTED')
    actual = remote('docker inspect ' + shlex.quote(name) + ' --format ' + shlex.quote('{{index .Config.Labels "cop.test.owner"}}')).stdout.strip()
    if actual != owner:
        raise RuntimeError('FIXTURE_CONTAINER_CUSTODY_REJECTED')


def cleanup(manifest, remove_file=True):
    owner = manifest['ownerLabel']
    if not re.fullmatch(PREFIX + r'[a-f0-9]{12}', owner):
        raise RuntimeError('FIXTURE_OWNER_REJECTED')
    owned_names=[manifest['keycloak'][key] for key in ['probeContainer','container']]
    if manifest.get('postgis'):
        owned_names.insert(0,manifest['postgis']['container'])
    for name in owned_names:
        result = remote('docker inspect ' + shlex.quote(name) + ' --format ' + shlex.quote('{{index .Config.Labels "cop.test.owner"}}'), check=False)
        if result.returncode == 0:
            if result.stdout.strip() != owner:
                raise RuntimeError('FIXTURE_CLEANUP_CUSTODY_REJECTED')
            remote('docker rm -f ' + shlex.quote(name))
    image = manifest['keycloak']['optimizedImageTag']
    if image != owner + '-kc-image':
        raise RuntimeError('FIXTURE_IMAGE_CUSTODY_REJECTED')
    remote('docker image rm ' + shlex.quote(image), check=False)
    # No global prune, no volume removal, no shared holder or other provider.
    leftovers = remote('docker ps -aq --filter ' + shlex.quote('label=cop.test.owner=' + owner)).stdout.strip()
    if leftovers:
        raise RuntimeError('FIXTURE_OWNED_CONTAINER_REMAINS')
    if remove_file:
        exported=manifest.get('simBootstrap')
        if exported:
            location=pathlib.Path(exported['path'])
            if location==case_private_path(manifest, 'cop-messaging-joint-bootstrap') and location.is_file() and not location.is_symlink() and hashlib.sha256(location.read_bytes()).hexdigest()==exported['sha256']:
                location.unlink()
        if SERVER_LOCAL and manifest.get('simAliasBootstrap'):
            value=manifest['simAliasBootstrap'];location=case_private_path(manifest,'cop-sim-whole-erasure-fixture')
            if location.is_file() and not location.is_symlink() and hashlib.sha256(location.read_bytes()).hexdigest()==value['sha256']:
                location.unlink()
        pathlib.Path(manifest['_manifestPath']).unlink()


def verify_cached_cop_runtime_before_create():
    if not SERVER_LOCAL:return
    packages={json.loads(p.read_text())['name']:p for p in (ROOT/'packages').glob('*/package.json')}
    queue=[n for n in json.loads((ROOT/'apps/cop-api/package.json').read_text())['dependencies'] if n.startswith('@cop/')]
    seen=set();hashes={}
    while queue:
        name=queue.pop()
        if name in seen:continue
        seen.add(name);package=packages[name]
        for path in [package,*package.parent.joinpath('dist').rglob('*')]:
            if path.is_file() and (path==package or path.suffix in ['.js','.json']):hashes[path.relative_to(ROOT).as_posix()]=hashlib.sha256(path.read_bytes()).hexdigest()
        queue.extend(n for n in json.loads(package.read_text()).get('dependencies',{}) if n.startswith('@cop/'))
    code="const fs=require('fs'),c=require('crypto');let raw='';process.stdin.on('data',b=>raw+=b);process.stdin.on('end',()=>{if(Number(process.versions.node.split('.')[0])!==24)process.exit(1);const hashes=JSON.parse(raw);for(const[p,h]of Object.entries(hashes)){if(!/^packages\\/[A-Za-z0-9_./-]+$/.test(p)||p.split('/').includes('..')||c.createHash('sha256').update(fs.readFileSync('/app/'+p)).digest('hex')!==h)process.exit(1)}console.log(JSON.stringify({actualNode24:true,workspaceFileCount:Object.keys(hashes).length}));});"
    result=remote('docker run --rm -i --pull never --log-driver none --label cop.test.owner='+server_local.CASE_OWNER+' --network none --read-only --user 0:0 --cap-drop ALL --security-opt no-new-privileges --memory 128m --pids-limit 32 --entrypoint node '+NODE_IMAGE+' -e '+shlex.quote(code),json.dumps(hashes),check=False,timeout=20)
    if result.returncode:raise RuntimeError('WHOLE_CACHED_NODE_WORKSPACE_PREFLIGHT_FAILED')
    actual=json.loads(result.stdout)
    if actual.get('actualNode24') is not True or actual.get('workspaceFileCount')!=len(hashes):raise RuntimeError('WHOLE_CACHED_RUNTIME_PREFLIGHT_UNPROVEN')
    print(json.dumps({'phase':'actual_cached_cop_runtime_verified_before_create',**actual,'productionChanged':False}),flush=True)


def prepare_server_holder(args):
    if not SERVER_LOCAL or args.holder!=server_local.HOLDER_NAME or args.holder_owner!=server_local.HOLDER_OWNER:
        raise RuntimeError('WHOLE_NEW_SERVER_HOLDER_SCOPE_REQUIRED')
    safe_manifest(args.manifest)
    measured=server_local.headroom()
    verify_cached_cop_runtime_before_create()
    if remote('docker inspect '+shlex.quote(args.holder),check=False).returncode==0:
        raise RuntimeError('WHOLE_NEW_SERVER_HOLDER_ALREADY_EXISTS')
    image=server_local.PG_IMAGE
    if remote('docker image inspect '+image+' --format "{{.Id}}"').stdout.strip()!=image:
        raise RuntimeError('WHOLE_CACHED_PG18_IMAGE_REQUIRED')
    remote('docker run -d --name '+args.holder+' --pull never --network none --log-driver none --label cop.test.owner='+args.holder_owner+
        ' --label cop.test.component=whole-guard-holder --read-only --cap-drop ALL --cap-add CHOWN --cap-add SETUID --cap-add SETGID --cap-add DAC_OVERRIDE --security-opt no-new-privileges --pids-limit 128 --memory 1g --cpus 1'
        ' --tmpfs /var/lib/postgresql:rw,size=768m --tmpfs /var/run/postgresql:rw,size=16m --tmpfs /tmp:rw,size=32m'
        ' --env PGDATA=/var/lib/postgresql/approved-joint --env POSTGRES_USER=owned_fixture_admin --env POSTGRES_HOST_AUTH_METHOD=trust '+image+
        ' postgres -c cluster_name=messaging_approved_joint_fixture -c listen_addresses=127.0.0.1')
    for attempt in range(100):
        check=remote('docker exec '+args.holder+' pg_isready -h 127.0.0.1 -U owned_fixture_admin',check=False)
        if check.returncode==0: break
        time.sleep(.2)
    else: raise RuntimeError('WHOLE_NEW_GUARD_HOLDER_NOT_READY')
    actual=json.loads(remote('docker inspect '+args.holder).stdout)[0]
    if actual['Image']!=image or actual['Config']['Labels'].get('cop.test.owner')!=args.holder_owner or actual['HostConfig']['NetworkMode']!='none' or actual['HostConfig'].get('PortBindings') or actual['Mounts']:
        raise RuntimeError('WHOLE_NEW_GUARD_HOLDER_CUSTODY_REJECTED')
    settings=remote('docker exec '+args.holder+' psql -X -A -t -h 127.0.0.1 -U owned_fixture_admin -d postgres -c '+shlex.quote("SELECT json_build_object('version',current_setting('server_version'),'cluster',current_setting('cluster_name'),'data',current_setting('data_directory'),'admin',current_user)")).stdout.strip()
    settings=json.loads(settings)
    if not settings['version'].startswith('18.') or settings['cluster']!='messaging_approved_joint_fixture' or settings['data']!='/var/lib/postgresql/approved-joint' or settings['admin']!='owned_fixture_admin':
        raise RuntimeError('WHOLE_NEW_GUARD_HOLDER_SETTINGS_REJECTED')
    print(json.dumps({'phase':'actual_new_server_holder_ready','holder':args.holder,'holderId':actual['Id'],'owner':args.holder_owner,'imageId':image,'settings':settings,'headroom':measured,'productionChanged':False,'wholeAccountAccepted':False}),flush=True)


def prepare_server_local_keycloak(manifest, path):
    """All synthetic secrets stay in this server's RAM and owned tmpfs."""
    if not SERVER_LOCAL or manifest['ownerLabel'] != server_local.CASE_OWNER:
        raise RuntimeError('WHOLE_NEW_SERVER_PRIVATE_SCOPE_REQUIRED')
    owner=manifest['ownerLabel'];kc=manifest['keycloak']['container'];carrier=manifest['keycloak']['probeContainer']
    common=' --log-driver none --label cop.test.owner='+owner+' --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 128 --cpus 1'
    remote('docker run -d --name '+carrier+common+' --network container:'+manifest['sharedHolder']+' --user 0:0 --memory 384m'
        ' --shm-size 256m --tmpfs /tmp:rw,size=64m,mode=0700 --entrypoint node '+NODE_IMAGE+' -e "setInterval(()=>{},1000)"')
    helper=(ROOT/'scripts/account-safety/prepare-whole-server-private.mjs').read_text()
    installer="import{readFileSync,writeFileSync,mkdirSync}from'node:fs';mkdirSync('/dev/shm/cop-whole',{mode:448});writeFileSync('/dev/shm/cop-whole/server-private-helper.mjs',readFileSync(0),{mode:384,flag:'wx'});"
    remote('docker exec --user 0:0 -i '+carrier+' node --input-type=module -e '+shlex.quote(installer),helper)
    reference=remote('docker exec --user 0:0 -i '+carrier+' node /dev/shm/cop-whole/server-private-helper.mjs',
        json.dumps({'action':'create-credentials','options':{'ownerLabel':owner}}),check=False)
    if reference.returncode or json.loads(reference.stdout).get('serverOnly') is not True:
        raise RuntimeError('WHOLE_SERVER_PRIVATE_CREDENTIAL_CREATION_FAILED')
    remote('docker run -d --name '+kc+common+' --network container:'+manifest['sharedHolder']+' --user 1000:0 --memory 768m'
        ' --tmpfs /opt/keycloak/data:rw,size=256m,uid=1000,gid=0,mode=0700 --tmpfs /tmp:rw,size=64m,uid=1000,gid=0,mode=0700'
        ' --entrypoint /bin/bash '+manifest['keycloak']['optimizedImageTag']+' -c '+shlex.quote('while :; do sleep 3600; done'))
    # Read only into server Python RAM. Values never enter Docker Config.Env,
    # process argv, source pack, stdout, or the Mac-side SSH response.
    credentials=json.loads(remote('docker exec --user 0:0 '+carrier+' cat /dev/shm/cop-whole/server-fixture-credentials.json').stdout)
    password=credentials.pop('adminPassword');credentials.clear()
    remote('docker exec --user 1000:0 -i '+kc+' /bin/bash -c '+shlex.quote('umask 077; set -C; cat > /opt/keycloak/data/cop-fixture-admin.password'),password)
    password=None
    child='umask 077; KC_BOOTSTRAP_ADMIN_USERNAME=fixture-admin; IFS= read -r KC_BOOTSTRAP_ADMIN_PASSWORD < /opt/keycloak/data/cop-fixture-admin.password || test -n "$KC_BOOTSTRAP_ADMIN_PASSWORD"; export KC_BOOTSTRAP_ADMIN_USERNAME KC_BOOTSTRAP_ADMIN_PASSWORD; JAVA_OPTS_APPEND="-Xms128m -Xmx384m"; export JAVA_OPTS_APPEND; exec /opt/keycloak/bin/kc.sh start --optimized --http-enabled=true --hostname=https://cop-erasure-keycloak.invalid --db=dev-file --log-level=warn > /opt/keycloak/data/fixture-private-start.log 2>&1'
    remote('docker exec --user 1000:0 -d '+kc+' /bin/bash -c '+shlex.quote(child))
    source={'action':'seed-keycloak','options':{'seedSource':(ROOT/'scripts/keycloak/erasure-provider-probe.mjs').read_text(),
        'provisionSource':(ROOT/'scripts/keycloak/provision-erasure-client.mjs').read_text()}}
    result=remote('docker exec --user 0:0 -i '+carrier+' node /dev/shm/cop-whole/server-private-helper.mjs',json.dumps(source),check=False,timeout=100)
    if result.returncode:
        raise RuntimeError('WHOLE_ACTUAL_SERVER_KEYCLOAK_SEED_FAILED')
    observed=json.loads(result.stdout)
    if observed.get('actualKeycloakSeedVerified') is not True:
        raise RuntimeError('WHOLE_ACTUAL_SERVER_KEYCLOAK_SEED_UNPROVEN')
    seeded=json.loads(remote('docker exec --user 0:0 '+carrier+' cat /dev/shm/cop-whole/keycloak-private.json').stdout)
    if seeded.get('issuer')!=ISSUER or seeded['actors']['a']['subjectId']==seeded['actors']['b']['subjectId']:
        raise RuntimeError('WHOLE_ACTUAL_SERVER_KEYCLOAK_IDENTITY_FAILED')
    manifest.update(seeded)
    manifest['keycloak']['sourceSha256']=hashlib.sha256(source['options']['seedSource'].encode()).hexdigest()
    check_owned(kc,owner);check_owned(carrier,owner)
    write_private(path,manifest)
    print(json.dumps({'phase':'actual_server_keycloak_shared_fixture_prepared','manifestPath':str(path),'carrier':carrier,
        'issuer':ISSUER,'subjects':observed['subjects'],'serverOnly':True,'productionChanged':False,'wholeAccountAccepted':False}),flush=True)


def export_server_private_bootstraps(manifest,path):
    if not SERVER_LOCAL or manifest['ownerLabel']!=server_local.CASE_OWNER:
        raise RuntimeError('WHOLE_NEW_SERVER_PRIVATE_SCOPE_REQUIRED')
    carrier=manifest['keycloak']['probeContainer'];check_owned(carrier,manifest['ownerLabel'])
    paths={name:base64.b64encode((ROOT/'apps/cop-api/dist'/name).read_bytes()).decode() for name in ['ai-router-chat.js','driver-measurement-contract.js','bounded-upstream.js']}
    install=r"""
import{readFileSync,writeFileSync,mkdirSync,symlinkSync}from'node:fs';
const files=JSON.parse(readFileSync(0,'utf8')),root='/dev/shm/cop-whole';mkdirSync(root+'/apps/cop-api/dist',{recursive:true,mode:448});
for(const[name,value]of Object.entries(files)){if(!['ai-router-chat.js','driver-measurement-contract.js','bounded-upstream.js'].includes(name))throw Error('WHOLE_IDENTITY_HELPER_PATH_REJECTED');writeFileSync(root+'/apps/cop-api/dist/'+name,Buffer.from(value,'base64'),{mode:384,flag:'wx'});}
writeFileSync(root+'/package.json','{"type":"module"}',{mode:384,flag:'wx'});symlinkSync('/app/node_modules',root+'/node_modules','dir');symlinkSync('/app/apps/cop-api/node_modules',root+'/apps/cop-api/node_modules','dir');
"""
    remote('docker exec --user 0:0 -i '+carrier+' node --input-type=module -e '+shlex.quote(install),json.dumps(paths))
    result=remote('docker exec --user 0:0 -i '+carrier+' node /dev/shm/cop-whole/server-private-helper.mjs',json.dumps({'action':'export-bootstraps'}),check=False)
    if result.returncode or json.loads(result.stdout).get('serverOnly') is not True:
        raise RuntimeError('WHOLE_SERVER_PRIVATE_BOOTSTRAP_FAILED')
    refs=json.loads(result.stdout)
    for key,name in [('messaging','cop-messaging-joint-bootstrap'),('sim','cop-sim-whole-erasure-fixture')]:
        value=json.loads(remote('docker exec --user 0:0 '+carrier+' cat '+shlex.quote(refs[key+'Ref'])).stdout)
        target=case_private_path(manifest,name);write_private(target,value)
        field='simBootstrap' if key=='messaging' else 'simAliasBootstrap'
        manifest[field]={'path':str(target),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'carrierRef':{'container':carrier,'path':refs[key+'Ref']},'serverOnly':True}
    replace_private(path,manifest)
    print(json.dumps({'phase':'actual_server_private_bootstraps_prepared','carrier':carrier,'messagingRef':refs['messagingRef'],'simRef':refs['simRef'],
        'contributorDaysPerActor':9,'serverOnly':True,'secretsPrinted':False,'productionChanged':False}),flush=True)


def prepare(args):
    path = safe_manifest(args.manifest)
    if path.exists():
        raise RuntimeError('FIXTURE_MANIFEST_ALREADY_EXISTS')
    if not args.holder or not args.holder_owner or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{1,100}', args.holder_owner):
        raise RuntimeError('SHARED_SIM_HOLDER_REQUIRED')
    check_owned(args.holder, args.holder_owner)
    holder = json.loads(remote('docker inspect ' + shlex.quote(args.holder)).stdout)[0]
    if not holder['State']['Running'] or holder['HostConfig']['NetworkMode'] not in ['none'] or holder['HostConfig'].get('PortBindings'):
        raise RuntimeError('SHARED_SIM_HOLDER_MUST_HAVE_NO_PORTS_OR_NETWORK')
    # Both image identities are checked before any creation. No registry pull.
    for image in [KC_IMAGE, NODE_IMAGE]:
        if remote('docker image inspect ' + image + ' --format "{{.Id}}"').stdout.strip() != image:
            raise RuntimeError('CACHED_FIXTURE_IMAGE_REQUIRED')
    if SERVER_LOCAL:
        if args.holder != server_local.HOLDER_NAME or args.holder_owner != server_local.HOLDER_OWNER:
            raise RuntimeError('WHOLE_NEW_SERVER_HOLDER_REQUIRED')
        measured = server_local.headroom()
        verify_cached_cop_runtime_before_create()
        print(json.dumps({'phase':'new_fixture_headroom_verified',**measured,'productionChanged':False}),flush=True)
        owner = server_local.CASE_OWNER
        for name in [owner+'-kc',owner+'-node']:
            if remote('docker inspect '+shlex.quote(name),check=False).returncode == 0:
                raise RuntimeError('WHOLE_NEW_SERVER_RESOURCE_ALREADY_EXISTS')
    else:
        owner = PREFIX + uuid.uuid4().hex[:12]
    manifest = {'contractVersion': 'cop-account-erasure-whole-fixture-v1', '_manifestPath': str(path),
        'ownerLabel': owner, 'createdAt': int(time.time()), 'leaseExpiresAt': int(time.time()) + 10800,
        'host': 'docker.home.cz', 'sharedHolder': args.holder, 'sharedHolderOwner': args.holder_owner,
        'issuer': ISSUER, 'keycloak': {'container': owner + '-kc', 'probeContainer': owner + '-node',
            'optimizedImageTag': owner + '-kc-image', 'baseImageId': KC_IMAGE, 'nodeImageId': NODE_IMAGE},
        'integration': {'ready': False, 'missingComponents': ['cop_business_postgres', 'independent_guard_postgres', 'sim_measurements',
            'ai_router', 'messaging_matrix', 'voice_livekit', 's3_media', 'actual_provider_seed_readback'], 'environment': {}},
        'productionChanged': False, 'wholeAccountAccepted': False}
    if SERVER_LOCAL:
        manifest['integration']['expectedInitialOutage503'] = True
        manifest['integration']['requireControlledCrashRetry'] = True
        manifest['sharedHolderId'] = holder['Id']
        manifest['serverLocal'] = {'contractVersion':'cop-whole-server-local-v1','privateRoot':str(server_local.PRIVATE_ROOT),'sourceProof':PUBLIC_SOURCE_PROOF}
    kc, probe = manifest['keycloak']['container'], manifest['keycloak']['probeContainer']
    try:
        dockerfile = ('FROM ' + KC_MANIFEST + '\nLABEL cop.test.owner=' + owner +
            '\nRUN JAVA_OPTS_APPEND="-Xms128m -Xmx384m" /opt/keycloak/bin/kc.sh build --db=dev-file\n').encode()
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode='w') as tar:
            info = tarfile.TarInfo('Dockerfile'); info.size = len(dockerfile); tar.addfile(info, io.BytesIO(dockerfile))
        built = remote('base64 -d | DOCKER_BUILDKIT=0 docker build --pull=false --network none --rm --force-rm --memory 768m'
            ' --cpu-period 100000 --cpu-quota 100000 -t ' + manifest['keycloak']['optimizedImageTag'] + ' -',
            base64.b64encode(archive.getvalue()).decode(), check=False)
        if built.returncode:
            raise RuntimeError('OWNED_KEYCLOAK_FIXTURE_BUILD_FAILED')
        manifest['keycloak']['optimizedImageId'] = remote('docker image inspect ' + manifest['keycloak']['optimizedImageTag'] + ' --format "{{.Id}}"').stdout.strip()
        if SERVER_LOCAL:
            prepare_server_local_keycloak(manifest,path)
            return
        common = ' --log-driver none --label cop.test.owner=' + owner + ' --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 128 --cpus 1'
        remote('docker run -d --name ' + kc + common + ' --network container:' + args.holder + ' --user 1000:0 --memory 768m'
            ' --tmpfs /opt/keycloak/data:rw,size=256m,uid=1000,gid=0,mode=0700 --tmpfs /tmp:rw,size=64m,uid=1000,gid=0,mode=0700'
            ' --env KC_BOOTSTRAP_ADMIN_USERNAME=fixture-admin --env KC_BOOTSTRAP_ADMIN_PASSWORD=synthetic-bootstrap-not-production'
            ' --env JAVA_OPTS_APPEND="-Xms128m -Xmx384m" ' + manifest['keycloak']['optimizedImageTag'] +
            ' start --optimized --http-enabled=true --hostname=https://cop-erasure-keycloak.invalid --db=dev-file --log-level=warn')
        remote('docker run -d --name ' + probe + common + ' --network container:' + args.holder + ' --user 1000:1000 --memory 256m'
            ' --tmpfs /tmp:rw,size=64m,uid=1000,gid=1000,mode=0700 --entrypoint node ' + NODE_IMAGE + ' -e "setInterval(()=>{},1000)"')
        source = (ROOT / 'scripts/keycloak/erasure-provider-probe.mjs').read_text().split('const calls = [];')[0]
        source = source.replace("import { createKeycloakAccountErasureAdapter } from './keycloak-account-erasure.js';\n", '')
        source = source.replace("const realm = 'cop-erasure-fixture';", "const realm = 'cop-erasure-whole';")
        source = source.replace("publicClient: !worker, standardFlowEnabled", "publicClient: !worker, ...(worker ? {} : { defaultClientScopes: ['basic','profile','email','roles'] }), standardFlowEnabled")
        source += """
globalThis.fixtureStage='actual_shared_identity_readback';
for (const owner of [a,b]) {
 const claims = JSON.parse(Buffer.from(offline[owner.id+'cop-web'].access_token.split('.')[1], 'base64url'));
 assert.equal(claims.iss, issuer); assert.equal(claims.sub, owner.id);
 assert.equal((await response('/realms/'+realm+'/protocol/openid-connect/userinfo','GET',undefined,offline[owner.id+'cop-web'].access_token)).value.sub,owner.id);
}
console.log(JSON.stringify({issuer,realm,actors:{a:{subjectId:a.id,username:a.username,password:'synthetic-user-not-production',cop:offline[a.id+'cop-web'],sim:offline[a.id+'csm-sim-web']},b:{subjectId:b.id,username:b.username,password:'synthetic-user-not-production',cop:offline[b.id+'cop-web'],sim:offline[b.id+'csm-sim-web']}},erasureClient:{id:ERASURE_CLIENT_ID,secret:provisionSecret,clientUuid:provisioned.clientUuid,serviceUuid:provisioned.serviceUuid},clientUuids:Object.fromEntries(Object.entries(clients).map(([key,value])=>[key,value.id])),actualSeedChecks:checks}));
"""
        files = {'seed.mjs': base64.b64encode(source.encode()).decode(),
            'provision-erasure-client.mjs': base64.b64encode((ROOT / 'scripts/keycloak/provision-erasure-client.mjs').read_bytes()).decode(),
            'package.json': base64.b64encode(b'{"type":"module"}').decode()}
        bootstrap = "import{readFileSync,writeFileSync,mkdirSync}from'node:fs';const f=JSON.parse(readFileSync(0,'utf8'));mkdirSync('/tmp/cop-whole-kc',{mode:448});for(const[k,v]of Object.entries(f)){if(!/^[a-z.-]+$/.test(k))throw Error('SOURCE_PATH');writeFileSync('/tmp/cop-whole-kc/'+k,Buffer.from(v,'base64'),{mode:384});}try{await import('/tmp/cop-whole-kc/seed.mjs');}catch(error){console.error(JSON.stringify({fixtureStage:globalThis.fixtureStage,code:typeof error.code==='string'?error.code:'SEED_ASSERTION_FAILED',sourceFrames:String(error.stack??'').split('\\n').flatMap(line=>line.match(/(?:seed|provision-erasure-client)\\.mjs:[0-9]+:[0-9]+/g)??[])}));process.exitCode=1;}"
        executed = remote('docker exec -i ' + probe + ' node --input-type=module -e ' + shlex.quote(bootstrap), json.dumps(files), check=False)
        if executed.returncode:
            try:
                diagnostic = json.loads(executed.stderr.strip().splitlines()[-1])
                print(json.dumps({'phase': 'owned_keycloak_seed_diagnostic', 'fixtureStage': diagnostic.get('fixtureStage'), 'code': diagnostic.get('code'), 'sourceFrames': diagnostic.get('sourceFrames')}))
            except (ValueError, IndexError):
                print(json.dumps({'phase': 'owned_keycloak_seed_diagnostic', 'code': 'NO_SAFE_SEED_DIAGNOSTIC'}))
            raise RuntimeError('ACTUAL_KEYCLOAK_A_B_SEED_FAILED')
        seeded = json.loads(executed.stdout.strip().splitlines()[-1])
        if seeded['issuer'] != ISSUER or seeded['actors']['a']['subjectId'] == seeded['actors']['b']['subjectId']:
            raise RuntimeError('ACTUAL_KEYCLOAK_A_B_IDENTITY_FAILED')
        manifest.update(seeded)
        manifest['keycloak']['sourceSha256'] = hashlib.sha256(source.encode()).hexdigest()
        check_owned(kc, owner); check_owned(probe, owner)
        write_private(path, manifest)
        print(json.dumps({'phase': 'actual_keycloak_shared_fixture_prepared', 'manifestPath': str(path),
            'issuer': ISSUER, 'accountA': seeded['actors']['a']['subjectId'], 'accountB': seeded['actors']['b']['subjectId'],
            'sharedHolder': args.holder, 'actualProviderSeed': True, 'wholeAccountAccepted': False,
            'missingComponents': manifest['integration']['missingComponents'], 'productionChanged': False}))
    except BaseException:
        cleanup(manifest, remove_file=False)
        raise



def replace_private(path, value):
    temporary = pathlib.Path(str(path) + '.' + uuid.uuid4().hex + '.tmp')
    write_private(temporary, value)
    os.replace(temporary, path)


def prepare_cop_database(manifest, path):
    check_owned(manifest['sharedHolder'], manifest['sharedHolderOwner'])
    check_owned(manifest['keycloak']['probeContainer'], manifest['ownerLabel'])
    if manifest.get('database'):
        raise RuntimeError('COP_FIXTURE_DATABASE_ALREADY_ENROLLED')
    bootstrap_path = case_private_path(manifest, 'cop-messaging-joint-bootstrap')
    if not bootstrap_path.exists() or stat.S_IMODE(bootstrap_path.stat().st_mode) != 0o600:
        raise RuntimeError('ACTUAL_SIM_BOOTSTRAP_REQUIRED')
    bootstrap = json.loads(bootstrap_path.read_text())
    if bootstrap.get('issuer') != manifest['issuer'] or bootstrap.get('subjects') != {key: manifest['actors'][key]['subjectId'] for key in ['a','b']}:
        raise RuntimeError('ACTUAL_SIM_SUBJECT_BINDING_CONFLICT')
    payload = {'manifest': manifest, 'bootstrap': bootstrap,
        'guardSql': (ROOT / 'scripts/account-safety/010_database_safety_v2.sql').read_text()}
    source = r"""
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
const {Pool}=createRequire('/app/apps/cop-api/package.json')('pg');
const {manifest:f,bootstrap,guardSql}=JSON.parse(readFileSync(0,'utf8'));
const admin=new Pool({host:'127.0.0.1',port:5432,user:'owned_fixture_admin',database:'postgres',max:1,connectionTimeoutMillis:3000});
const open=[];
try {
 const actual=(await admin.query("SELECT current_user usr,current_setting('is_superuser') superuser,inet_server_addr() address,pg_is_in_recovery() recovery")).rows[0];
 if(actual.usr!=='owned_fixture_admin'||actual.superuser!=='on'||actual.address!=='127.0.0.1'||actual.recovery)throw Error('OWNED_PG_IDENTITY_REQUIRED');
 if((await admin.query("SELECT count(*) n FROM pg_database WHERE datname IN ('cop_erasure_test','cop_account_safety_guard')")).rows[0].n!=='0')throw Error('OWNED_COP_DATABASE_NAMES_NOT_EMPTY');
 if((await admin.query("SELECT count(*) n FROM pg_roles WHERE rolname IN ('cop_whole_app','cop_whole_guard_runtime')")).rows[0].n!=='0')throw Error('OWNED_COP_ROLE_NAMES_NOT_EMPTY');
 await admin.query('CREATE ROLE cop_whole_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION; CREATE ROLE cop_whole_guard_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION');
 await admin.query('CREATE DATABASE cop_erasure_test OWNER cop_whole_app');
 await admin.query('CREATE DATABASE cop_account_safety_guard');
 const config={guardStoreId:randomUUID(),applicationStoreId:randomUUID(),incarnationId:randomUUID()};
 const secret=randomBytes(48).toString('base64url'),webSecret=randomBytes(48).toString('base64url'),evidenceSecret=randomBytes(48).toString('base64url');
 config.configurationFingerprint=createHash('sha256').update('cop-account-erasure-config-v1\0').update(secret).digest('hex');
 const guardUrl='postgresql://owned_fixture_admin@127.0.0.1:5432/cop_account_safety_guard';
 const businessUrl='postgresql://cop_whole_app@127.0.0.1:5432/cop_erasure_test';
 const guard=new Pool({connectionString:guardUrl,max:1}),business=new Pool({connectionString:businessUrl,max:1});open.push(guard,business);
 await guard.query(guardSql);
 await guard.query("INSERT INTO cop_safety_v2.configuration VALUES(true,'cop-database-safety-v2',$1,$2,$3,$4,$5)",
 [config.guardStoreId,config.applicationStoreId,config.configurationFingerprint,'0'.repeat(64),{
 contractVersion:'cop-existing-router-identity-v1',issuer:f.issuer,
 routerKeyFingerprint:createHash('sha256').update('cop-router-identity-key-v1\0').update(bootstrap.root).digest('hex'),
 evidenceDigest:createHash('sha256').update(JSON.stringify([f.keycloak.sourceSha256,bootstrap.subjects])).digest('hex')}]);
 await guard.query("INSERT INTO cop_safety_v2.dataset_replays VALUES('cop',$1,$2,1,0,$3,clock_timestamp())",[config.applicationStoreId,config.incarnationId,'0'.repeat(64)]);
 await guard.query('GRANT USAGE ON SCHEMA cop_safety_v2 TO cop_whole_guard_runtime; GRANT SELECT ON ALL TABLES IN SCHEMA cop_safety_v2 TO cop_whole_guard_runtime; GRANT INSERT ON cop_safety_v2.fences TO cop_whole_guard_runtime; GRANT UPDATE(replay_sequence,replay_digest) ON cop_safety_v2.dataset_replays TO cop_whole_guard_runtime; GRANT EXECUTE ON FUNCTION cop_safety_v2.append_fence() TO cop_whole_guard_runtime');
 await business.query('CREATE TABLE cop_mobility_v1(key text PRIMARY KEY,value jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())');
 await business.query("INSERT INTO cop_mobility_v1(key,value) VALUES('account-safety:store-identity-v1',$1)",[{storeId:config.applicationStoreId,incarnationId:config.incarnationId}]);
 await business.query('GRANT SELECT ON cop_mobility_v1 TO cop_whole_guard_runtime');
 const environment={COP_DATABASE_URL:businessUrl,COP_DATABASE_SSL:'false',COP_AUTH_MODE:'oidc',COP_OIDC_ISSUER:f.issuer,COP_OIDC_ALLOWED_CLIENTS:'cop-web,csm-mobile',COP_OIDC_REQUIRED_ROLE:'',COP_ALLOW_LAB_TOKEN:'false',
 COP_ACCOUNT_ERASURE_ENABLED:'true',COP_ACCOUNT_SAFETY_GUARD_REQUIRED:'true',COP_ACCOUNT_SAFETY_AUTHORITY_MODE:'database_v2',COP_ACCOUNT_SAFETY_RUNTIME_ATTESTATION:'account-safety-guard-v1',COP_ACCOUNT_ERASURE_SECRET:secret,COP_ACCOUNT_SAFETY_STORE_ID:config.applicationStoreId,COP_ACCOUNT_SAFETY_INCARNATION_ID:config.incarnationId,
 COP_AI_CHAT_ROUTER_USER_ID_SECRET:bootstrap.root,COP_SIM_ERASURE_ACTOR_SECRET:bootstrap.root,COP_DRIVER_MEASUREMENTS_HASH_SECRET:bootstrap.root,
 COP_SIM_ERASURE_ROUTER_URL:'http://127.0.0.1:4312',COP_SIM_ERASURE_DRIVER_URL:'http://127.0.0.1:4311',COP_SIM_ERASURE_ROUTER_TOKEN:bootstrap.serviceToken,COP_SIM_ERASURE_DRIVER_TOKEN:bootstrap.serviceToken,
 COP_CSM_MESSAGING_ENABLED:'true',COP_CSM_MESSAGING_BASE_URL:'http://127.0.0.1:4000',COP_CSM_MESSAGING_TOKEN:bootstrap.serviceToken,
 COP_KEYCLOAK_ERASURE_CLIENT_ID:f.erasureClient.id,COP_KEYCLOAK_ERASURE_CLIENT_SECRET:f.erasureClient.secret,COP_KEYCLOAK_COP_SCOPE_AUTHORITY_ACCEPTED:'true',
 COP_SHARED_MOBILITY_ENABLED:'true',COP_PRIVATE_DISPATCH_ENABLED:'true',COP_WEB_BFF_SESSION_ENABLED:'true',COP_WEB_SESSION_SECRET:webSecret,
 COP_COMMUNICATION_SAFETY_ENABLED:'true',COP_COMMUNICATION_EVIDENCE_SECRET:evidenceSecret,COP_COMMUNICATION_MODERATOR_ROLE:'synthetic-moderator',COP_COMMUNICATION_CONTACT_EMAIL:'fixture@example.invalid',COP_COMMUNICATION_RETENTION_POLICY_ID:'cop-communication-retention-90d-30d-180d-v1',
 COP_LIVEKIT_ERASURE_RELAY_URL:'https://cop-erasure-messaging.invalid',COP_MEDIA_UPLOAD_TRANSPORT:'cop_api',COP_PUBLIC_URL:'https://cop-erasure-whole.invalid',COP_AI_SEMANTIC_RETRIEVAL_ENABLED:'false',COP_AI_CONTEXT_INDEX_ENABLED:'false',
 COP_SITUATION_DATA_ENABLED:'false',COP_SIM_SEARCH_DATA_ENABLED:'false',COP_SAFETY_DATA_ENABLED:'false',COP_FLIGHT_DATA_ENABLED:'false',COP_MISSION_ARENA_ENABLED:'false',COP_TAK_GATEWAY_ENABLED:'false',
 COP_DRIVER_MEASUREMENTS_ENABLED:'false',COP_DRIVER_MEASUREMENTS_CLEANUP_ENABLED:'false',COP_WEB_PUSH_ENABLED:'false'};
 console.log(JSON.stringify({database:{...config,restoreGeneration:1,guardRuntimeUrl:'postgresql://cop_whole_guard_runtime@127.0.0.1:5432/cop_account_safety_guard',guardTargetReadUrl:'postgresql://cop_whole_guard_runtime@127.0.0.1:5432/cop_erasure_test',businessRuntimeUrl:businessUrl,guardAdminUrl:guardUrl,businessAdminUrl:'postgresql://owned_fixture_admin@127.0.0.1:5432/cop_erasure_test'},environment,actualDatabaseEnrolled:true}));
} finally {await Promise.all(open.map(pool=>pool.end()));await admin.end();}
"""
    execution = remote('docker exec --user 0:0 -i ' + manifest['keycloak']['probeContainer'] + ' node --input-type=module -e ' + shlex.quote(source), json.dumps(payload), check=False)
    if execution.returncode:
        raise RuntimeError('ACTUAL_COP_DATABASE_FIXTURE_PREPARE_FAILED')
    prepared=json.loads(execution.stdout.strip().splitlines()[-1])
    if prepared.get('actualDatabaseEnrolled') is not True:
        raise RuntimeError('ACTUAL_COP_DATABASE_FIXTURE_READBACK_FAILED')
    manifest['database']=prepared['database']
    manifest['integration']['environment'].update(prepared['environment'])
    manifest['integration']['missingComponents']=[value for value in manifest['integration']['missingComponents'] if value not in ['cop_business_postgres','independent_guard_postgres']]
    replace_private(path,manifest)
    print(json.dumps({'phase':'actual_cop_business_guard_fixture_prepared','manifestPath':str(path),'runtimeGuardRoleRestricted':True,'newProductionRoles':False,'wholeAccountAccepted':False,'productionChanged':False}))



def snapshot_actual_business_databases(manifest, operation_id):
    if not re.fullmatch(r'[a-f0-9-]{36}',operation_id):
        raise RuntimeError('WHOLE_SNAPSHOT_OPERATION_REJECTED')
    owner=manifest['sharedHolderOwner']
    holder=manifest['sharedHolder']
    services=[owner+'-sim-driver',owner+'-sim-router',owner+'-messaging',owner+'-synapse']
    paused=[]
    dumps=[]
    try:
        # Freeze the exact owned writers while each real PG archive is taken.
        # The independent guard is intentionally not a snapshot target.
        for container in services:
            check_owned(container,owner)
            remote('docker pause '+shlex.quote(container),timeout=20)
            paused.append(container)
        targets=[(manifest['postgis']['container'],'cop_erasure_test',5433,'cop_whole_postgis_admin',manifest['ownerLabel'])]
        targets.extend((holder,name,5432,'owned_fixture_admin',owner) for name in ['sim_driver_measurements','sim_ai_router','messaging_joint_test','csm_synapse'])
        for container,database,port,user,label in targets:
            check_owned(container,label)
            location='/dev/shm/cop-whole-'+operation_id+'-'+database+'.dump'
            exists=remote('docker exec --user 0:0 '+shlex.quote(container)+' test ! -e '+shlex.quote(location),check=False)
            if exists.returncode:
                raise RuntimeError('WHOLE_SNAPSHOT_ALREADY_EXISTS')
            command=['docker','exec','--user','0:0',container,'pg_dump','--no-password','-h','127.0.0.1','-p',str(port),'-U',user,'-d',database,'-Fc','-f',location]
            remote(shlex.join(command),timeout=35)
            remote(shlex.join(['docker','exec','--user','0:0',container,'chmod','600',location]))
            listing=remote(shlex.join(['docker','exec','--user','0:0',container,'pg_restore','--list',location]),timeout=20).stdout
            if 'cop_account_safety_guard' in listing or not re.search(r'\n[0-9]+;',listing):
                raise RuntimeError('WHOLE_SNAPSHOT_ARCHIVE_UNPROVEN')
            digest=remote(shlex.join(['docker','exec','--user','0:0',container,'sha256sum',location])).stdout.split()[0]
            if not re.fullmatch(r'[a-f0-9]{64}',digest):
                raise RuntimeError('WHOLE_SNAPSHOT_DIGEST_INVALID')
            dumps.append({'database':database,'container':container,'path':location,'sha256':digest})
    finally:
        for container in reversed(paused):
            remote('docker unpause '+shlex.quote(container),check=False,timeout=20)
    result={'contractVersion':'cop-whole-pre-deletion-snapshot-v1','operationId':operation_id,'dumps':dumps,'independentGuardIncluded':False,'productionChanged':False}
    source="import{readFileSync,writeFileSync}from'node:fs';const v=JSON.parse(readFileSync(0,'utf8'));writeFileSync('/dev/shm/cop-whole/pre-deletion-snapshot-ack.json',JSON.stringify(v),{mode:384,flag:'wx'});"
    remote('docker exec --user 0:0 -i '+manifest['keycloak']['probeContainer']+' node --input-type=module -e '+shlex.quote(source),json.dumps(result),timeout=20)
    print(json.dumps({'phase':'actual_predeletion_pg_snapshots_verified','businessDatabaseCount':len(dumps),'independentGuardIncluded':False,'productionChanged':False}),flush=True)


def prepare_whole_source(manifest, path):
    if SERVER_LOCAL and manifest.get('serverLocal',{}).get('sourceProof') != PUBLIC_SOURCE_PROOF:
        raise RuntimeError('WHOLE_SERVER_PUBLIC_SOURCE_BINDING_CHANGED')
    check_owned(manifest['sharedHolder'], manifest['sharedHolderOwner'])
    check_owned(manifest['keycloak']['probeContainer'], manifest['ownerLabel'])
    module_path=manifest['integration'].get('fixtureModulePath')
    module_sha=manifest['integration'].get('fixtureModuleSha256')
    if not module_path or not re.fullmatch(r'[a-f0-9]{64}',str(module_sha)):
        raise RuntimeError('WHOLE_ACTUAL_PROVIDER_FIXTURE_MODULE_REQUIRED')
    module=pathlib.Path(module_path)
    if not module.is_file() or module.is_symlink() or hashlib.sha256(module.read_bytes()).hexdigest()!=module_sha:
        raise RuntimeError('WHOLE_ACTUAL_PROVIDER_FIXTURE_SOURCE_MISMATCH')
    dist=ROOT/'apps/cop-api/dist'
    if not (dist/'server.js').is_file():
        raise RuntimeError('WHOLE_CURRENT_COP_BUILD_REQUIRED')
    files={}
    for file in sorted(dist.rglob('*')):
        if file.is_file() and file.suffix in ['.js','.json']:
            files['apps/cop-api/dist/'+file.relative_to(dist).as_posix()]=base64.b64encode(file.read_bytes()).decode()
    revision=subprocess.run(['git','rev-parse','HEAD'],cwd=ROOT,text=True,capture_output=True,check=True).stdout.strip()
    if not re.fullmatch(r'[a-f0-9]{40}',revision):
        raise RuntimeError('WHOLE_SOURCE_REVISION_REQUIRED')
    dirty=subprocess.run(['git','status','--porcelain','--','apps/cop-api/src'],cwd=ROOT,text=True,capture_output=True,check=True).stdout.strip()!=''
    manifest['testedSource']={'sourceRevision':revision,'sourceWorkingTreeDirty':dirty,'compiledApiClosureSha256':hashlib.sha256('\n'.join(name+'\0'+hashlib.sha256(base64.b64decode(value)).hexdigest() for name,value in sorted(files.items())).encode()).hexdigest(),'nodeBaseImageId':manifest['keycloak']['nodeImageId']}
    resources=['docs/api/shared-mobility-v1.openapi.json','docs/api/schemas/mapped-road-profile-v1.schemas.json','docs/api/schemas/road-trip-v1.schemas.json','docs/api/schemas/known-road-closures-v1.schema.json']
    resource_hashes={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in resources}
    for name in resources:
        files[name]=base64.b64encode((ROOT/name).read_bytes()).decode()
    packages={json.loads(value.read_text())['name']:value for value in (ROOT/'packages').glob('*/package.json')}
    queue=[name for name in json.loads((ROOT/'apps/cop-api/package.json').read_text())['dependencies'] if name.startswith('@cop/')]
    visited=set();workspace_hashes={}
    while queue:
        name=queue.pop()
        if name in visited:continue
        visited.add(name);package=packages[name]
        for value in [package,*package.parent.joinpath('dist').rglob('*')]:
            if value.is_file() and (value==package or value.suffix in ['.js','.json']):
                workspace_hashes[value.relative_to(ROOT).as_posix()]=hashlib.sha256(value.read_bytes()).hexdigest()
        queue.extend(name for name in json.loads(package.read_text()).get('dependencies',{}) if name.startswith('@cop/'))
    closure=lambda values:hashlib.sha256('\n'.join(name+'\0'+value for name,value in sorted(values.items())).encode()).hexdigest()
    manifest['testedSource']['runtimeResourceClosureSha256']=closure(resource_hashes)
    manifest['testedSource']['compiledWorkspaceClosureSha256']=closure(workspace_hashes)
    files['package.json']=base64.b64encode(b'{"type":"module"}').decode()
    media_helper=ROOT/'scripts/account-safety/whole-media-edge-fixture.mjs'
    if not media_helper.is_file():
        raise RuntimeError('ACTUAL_MEDIA_EDGE_FIXTURE_HELPER_REQUIRED')
    files['media-edge-fixture.mjs']=base64.b64encode(media_helper.read_bytes()).decode()
    files['media-upload-closure.sql']=base64.b64encode((ROOT/'scripts/account-safety/011_media_upload_closure.sql').read_bytes()).decode()
    files['cop-local-fixture.mjs']=base64.b64encode((ROOT/'scripts/account-safety/whole-cop-local-fixture.mjs').read_bytes()).decode()
    files['probe.mjs']=base64.b64encode((ROOT/'scripts/account-safety/whole-account-erasure-probe.mjs').read_bytes()).decode()
    files['confirmation-evidence.mjs']=base64.b64encode((ROOT/'scripts/account-safety/whole-confirmation-evidence.mjs').read_bytes()).decode()
    files['integration-fixture.mjs']=base64.b64encode(module.read_bytes()).decode()
    bootstrap=r"""
import{readFileSync,writeFileSync,mkdirSync,symlinkSync}from'node:fs';import{dirname}from'node:path';import{createHash}from'node:crypto';
const{files,manifest,workspaceHashes}=JSON.parse(readFileSync(0,'utf8'));for(const[name,digest]of Object.entries(workspaceHashes)){if(createHash('sha256').update(readFileSync('/app/'+name)).digest('hex')!==digest)throw Error('WHOLE_CACHED_WORKSPACE_RUNTIME_MISMATCH');}const root='/dev/shm/cop-whole';mkdirSync(root,{recursive:true,mode:448});
for(const[name,value]of Object.entries(files)){if(!/^[A-Za-z0-9_./-]+$/.test(name)||name.split('/').includes('..')||name.startsWith('/'))throw Error('WHOLE_SOURCE_PATH');const path=root+'/'+name;mkdirSync(dirname(path),{recursive:true,mode:448});writeFileSync(path,Buffer.from(value,'base64'),{mode:384});}
for(const[target,path]of [['/app/node_modules',root+'/node_modules'],['/app/apps/cop-api/node_modules',root+'/apps/cop-api/node_modules']]){try{symlinkSync(target,path,'dir');}catch(error){if(error.code!=='EEXIST')throw error;}}
writeFileSync(root+'/private-manifest.json',JSON.stringify(manifest),{mode:384});
"""
    execution=remote('docker exec --user 0:0 -i '+manifest['keycloak']['probeContainer']+' node --input-type=module -e '+shlex.quote(bootstrap),json.dumps({'files':files,'manifest':manifest,'workspaceHashes':workspace_hashes}),check=False,timeout=60)
    if execution.returncode:
        raise RuntimeError('WHOLE_CURRENT_COP_SOURCE_INSTALL_FAILED')
    print(json.dumps({'phase':'whole_runtime_source_pinned',**manifest['testedSource'],'wholeAccountAccepted':False,'productionChanged':False}),flush=True)
    replace_private(path,manifest)
    return manifest


def pause_actual_messaging_outage(manifest,operation_id):
    if not SERVER_LOCAL or manifest.get('ownerLabel')!=server_local.CASE_OWNER or manifest['integration'].get('expectedInitialOutage503') is not True or not re.fullmatch('[0-9a-f-]{36}',str(operation_id)):
        raise RuntimeError('WHOLE_NEW_OWNED_OUTAGE_SCOPE_REQUIRED')
    name=manifest['sharedHolderOwner']+'-messaging';check_owned(name,manifest['sharedHolderOwner'])
    current=json.loads(remote('docker inspect '+name).stdout)[0]
    if not current['State']['Running'] or current['State']['Paused'] or current['HostConfig']['NetworkMode']!='container:'+manifest['sharedHolderId'] or current['HostConfig'].get('PortBindings') or current['HostConfig'].get('Binds'):
        raise RuntimeError('WHOLE_OUTAGE_PROVIDER_NOT_EXACT_OWNED_RUNNING')
    carrier=manifest['keycloak']['probeContainer'];check_owned(carrier,manifest['ownerLabel'])
    # Actual durable admission must already exist. We never manufacture an
    # operation, principal, receipt, readiness response, or provider response.
    verify=r"""
import{readFileSync}from'node:fs';import{createHmac}from'node:crypto';import{createRequire}from'node:module';const{Pool}=createRequire('/app/apps/cop-api/package.json')('pg');const{manifest:f,operationId}=JSON.parse(readFileSync(0,'utf8'));const g=new Pool({connectionString:f.database.guardRuntimeUrl,max:1}),b=new Pool({connectionString:f.database.guardTargetReadUrl,max:1});try{const key=createHmac('sha256',f.integration.environment.COP_ACCOUNT_ERASURE_SECRET).update('cop-account-erasure-identity-v1\0').update(JSON.stringify([f.issuer,f.actors.a.subjectId])).digest('hex');const guard=(await g.query('SELECT entry FROM cop_safety_v2.fences WHERE account_key=$1',[key])).rows[0]?.entry;const local=(await b.query('SELECT value FROM cop_mobility_v1 WHERE key=$1',['account-erasure:job:'+key])).rows[0]?.value;if(!guard||guard.job?.operationId!==operationId||local?.operationId!==operationId||local.requestedAt!==guard.job.requestedAt||typeof local.sealedPrincipal!=='string'||!local.sealedPrincipal)throw Error('WHOLE_OUTAGE_DURABLE_ORIGINAL_JOB_UNPROVEN');console.log(JSON.stringify({operationId,requestedAt:local.requestedAt,originalSealedJobVerified:true}));}finally{await g.end();await b.end();}
"""
    result=remote('docker exec --user 0:0 -i '+carrier+' node --input-type=module -e '+shlex.quote(verify),json.dumps({'manifest':manifest,'operationId':operation_id}),check=False,timeout=8)
    if result.returncode:
        raise RuntimeError('WHOLE_OUTAGE_DURABLE_ORIGINAL_JOB_UNPROVEN')
    binding=json.loads(result.stdout)
    try:
        remote('docker pause '+current['Id'],timeout=10)
        observed=json.loads(remote('docker inspect '+name).stdout)[0]
        if observed['Id']!=current['Id'] or observed['State']['Paused'] is not True:
            raise RuntimeError('WHOLE_ACTUAL_PROVIDER_PAUSE_UNPROVEN')
        proof={'contractVersion':'cop-whole-injected-provider-outage-v1','operationId':operation_id,'requestedAt':binding['requestedAt'],'provider':'messaging',
            'container':name,'containerId':observed['Id'],'ownerLabel':manifest['sharedHolderOwner'],'actualPaused':True,'originalSealedJobVerified':True,
            'pausedAt':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z'),'productionChanged':False}
        install="import{readFileSync,writeFileSync}from'node:fs';writeFileSync('/dev/shm/cop-whole/injected-provider-outage.json',readFileSync(0),{mode:384,flag:'wx'});"
        remote('docker exec --user 0:0 -i '+carrier+' node --input-type=module -e '+shlex.quote(install),json.dumps(proof),timeout=10)
    except BaseException:
        # Undo only the immutable container ID whose ownership was verified
        # before this attempted pause. Even a failed inspect cannot retarget it.
        remote('docker unpause '+current['Id'],check=False,timeout=10)
        raise
    print(json.dumps({'phase':'actual_owned_messaging_outage_injected','operationId':operation_id,'originalSealedJobVerified':True,'actualPaused':True,'productionChanged':False}),flush=True)


def recover_actual_messaging_outage(manifest,operation_id):
    if not SERVER_LOCAL or manifest.get('ownerLabel')!=server_local.CASE_OWNER:
        raise RuntimeError('WHOLE_NEW_OWNED_OUTAGE_SCOPE_REQUIRED')
    carrier=manifest['keycloak']['probeContainer'];name=manifest['sharedHolderOwner']+'-messaging';check_owned(name,manifest['sharedHolderOwner'])
    proof=json.loads(remote('docker exec --user 0:0 '+carrier+' cat /dev/shm/cop-whole/injected-provider-outage.json').stdout)
    current=json.loads(remote('docker inspect '+name).stdout)[0]
    if proof.get('operationId')!=operation_id or proof.get('containerId')!=current['Id'] or proof.get('actualPaused') is not True or current['State']['Paused'] is not True:
        raise RuntimeError('WHOLE_OUTAGE_RECOVERY_CUSTODY_CHANGED')
    remote('docker unpause '+name,timeout=10)
    if json.loads(remote('docker inspect '+name).stdout)[0]['State']['Paused'] is not False:
        raise RuntimeError('WHOLE_OUTAGE_PROVIDER_NOT_RESUMED')
    source=r"""
import{readFileSync,writeFileSync}from'node:fs';const f=JSON.parse(readFileSync(0,'utf8'));const r=await fetch('http://127.0.0.1:4000/api/v1/communication/mobility-effects-erasure/capabilities',{headers:{authorization:'Bearer '+f.integration.environment.COP_CSM_MESSAGING_TOKEN},signal:AbortSignal.timeout(10000)});const v=await r.json();if(r.status!==200||v.localMetadataErasure!==true||v.wholeAccountErasure!==false||v.externalCopiesErased!==false)throw Error('WHOLE_ACTUAL_RECOVERED_PROVIDER_NOT_READY');writeFileSync('/dev/shm/cop-whole/provider-outage-recovered.json',JSON.stringify({contractVersion:'cop-whole-provider-outage-recovered-v1',actualReadinessHttpStatus:r.status,recoveredAt:new Date().toISOString(),productionChanged:false}),{mode:384,flag:'wx'});console.log(JSON.stringify({phase:'actual_owned_messaging_outage_recovered',actualReadinessHttpStatus:200,productionChanged:false}));
"""
    result=remote('docker exec --user 0:0 -i '+carrier+' node --input-type=module -e '+shlex.quote(source),json.dumps(manifest),check=False,timeout=15)
    if result.returncode:raise RuntimeError('WHOLE_ACTUAL_OUTAGE_RECOVERY_NOT_READY')
    print(result.stdout.strip(),flush=True)


def run_whole(manifest, path):
    provider_source=verify_full_messaging_source(manifest)
    if provider_source is not None and manifest['integration'].get('messagingProviderSource') != provider_source:
        raise RuntimeError('WHOLE_FULL_V2_RUNTIME_SOURCE_DRIFT')
    manifest=prepare_whole_source(manifest,path)
    # The private manifest is passed through stdin; provider credentials are not
    # shell arguments, public artifacts, chat output or a production env file.
    command='docker exec --user 0:0 -i '+manifest['keycloak']['probeContainer']+' node /dev/shm/cop-whole/probe.mjs'
    # Stream only deliberately sanitized phase records. Raw provider stderr is
    # held privately, never forwarded to a chat or public test artifact.
    import tempfile
    records=[]
    controlled_crash=False
    injected_outage_operation=None
    with tempfile.TemporaryFile(dir=server_local.PRIVATE_ROOT if SERVER_LOCAL else None) as diagnostic:
        execution=subprocess.Popen(remote_argv(command),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=diagnostic,text=True)
        execution.stdin.write(json.dumps(manifest));execution.stdin.close()
        try:
            for line in execution.stdout:
                try:
                    value=json.loads(line)
                except (ValueError,AttributeError):
                    continue
                phase=value.get('phase')
                if phase=='whole_fixture_snapshot_required':
                    snapshot_actual_business_databases(manifest,value.get('operationId'))
                elif phase=='whole_inject_provider_outage_required':
                    pause_actual_messaging_outage(manifest,value.get('operationId'))
                    injected_outage_operation=value['operationId']
                elif phase in ['actual_confirmation_http_observed','whole_original_operation_continuation_verified','whole_fixture_preflight_diagnostic','whole_actual_deletion_pending','actual_online_whole_deletion_verified','whole_account_acceptance_complete','whole_account_acceptance_failed']:
                    records.append(value)
                    if phase!='whole_account_acceptance_complete':print(json.dumps(value),flush=True)
                    if SERVER_LOCAL and phase=='actual_confirmation_http_observed' and manifest['integration'].get('expectedInitialOutage503') is True:
                        if value.get('actualHttpStatus')!=503:
                            raise RuntimeError('WHOLE_INJECTED_OUTAGE_DID_NOT_RETURN_ACTUAL_503')
                        recover_actual_messaging_outage(manifest,value['operationId'])
                        injected_outage_operation=None
                        retry_original_confirmation(manifest)
                        crash_pending_whole(manifest)
                        controlled_crash=True
                    elif SERVER_LOCAL and phase=='whole_actual_deletion_pending' and manifest['integration'].get('continueOperation') is True and manifest['integration'].get('requireControlledCrashRetry') is True:
                        retry_original_confirmation(manifest)
            exit_code=execution.wait(timeout=30)
        except BaseException:
            try:
                if injected_outage_operation is not None:
                    recover_actual_messaging_outage(manifest,injected_outage_operation)
                    injected_outage_operation=None
            finally:
                execution.terminate()
                try:execution.wait(timeout=10)
                except subprocess.TimeoutExpired:execution.kill();execution.wait()
            raise
    if injected_outage_operation is not None:
        recover_actual_messaging_outage(manifest,injected_outage_operation)
        raise RuntimeError('WHOLE_INJECTED_OUTAGE_ENDED_WITHOUT_CONFIRMED_HTTP_FACT')
    if controlled_crash:
        if exit_code==0:
            raise RuntimeError('WHOLE_CONTROLLED_CRASH_DID_NOT_STOP_ACTUAL_MAIN')
        manifest['integration']['continueOperation']=True
        replace_private(path,manifest)
        return run_whole(manifest,path)
    if exit_code or not records or records[-1].get('wholeAccountAccepted') is not True:
        raise RuntimeError('WHOLE_ACTUAL_PROVIDER_ACCEPTANCE_FAILED')
    final_source=verify_full_messaging_source(manifest)
    if provider_source != final_source:
        raise RuntimeError('WHOLE_FULL_V2_RUNTIME_SOURCE_CHANGED_DURING_TEST')
    if final_source is not None:records[-1]['messagingSource']=final_source['messagingSource']
    print(json.dumps(records[-1]),flush=True)



def export_sim_aliases(manifest,path):
    check_owned(manifest['keycloak']['probeContainer'],manifest['ownerLabel'])
    if not manifest.get('database'):
        raise RuntimeError('COP_DATABASE_BINDING_REQUIRED_FOR_SIM_ALIASES')
    location=case_private_path(manifest,'cop-sim-whole-erasure-fixture')
    if location.exists():
        raise RuntimeError('SIM_ALIAS_BOOTSTRAP_ALREADY_EXISTS')
    sources={}
    for name in ['ai-router-chat.js','driver-measurement-contract.js','bounded-upstream.js']:
        source=ROOT/'apps/cop-api/dist'/name
        if not source.is_file():
            raise RuntimeError('CURRENT_COP_IDENTITY_HELPER_BUILD_REQUIRED')
        sources[name]=base64.b64encode(source.read_bytes()).decode()
    source=r"""
import{readFileSync,writeFileSync,mkdirSync,symlinkSync,readlinkSync,unlinkSync}from'node:fs';import{randomBytes}from'node:crypto';
const{manifest:f,sources}=JSON.parse(readFileSync(0,'utf8'));const path='/dev/shm/cop-whole-identity/apps/cop-api/dist';mkdirSync(path,{recursive:true,mode:448});
for(const[name,value]of Object.entries(sources)){if(!['ai-router-chat.js','driver-measurement-contract.js','bounded-upstream.js'].includes(name))throw Error('HELPER_PATH');writeFileSync(path+'/'+name,Buffer.from(value,'base64'),{mode:384});}
for(const[target,destination]of [['/app/node_modules','/dev/shm/cop-whole-identity/node_modules'],['/app/apps/cop-api/node_modules','/dev/shm/cop-whole-identity/apps/cop-api/node_modules']]){try{symlinkSync(target,destination,'dir');}catch(error){if(error.code!=='EEXIST'||readlinkSync(destination)!==target)throw error;}}
writeFileSync(path+'/package.json','{"type":"module"}',{mode:384});
const{opaqueUserId}=await import(path+'/ai-router-chat.js');const{contributorIdDay}=await import(path+'/driver-measurement-contract.js');
const day=new Date().toISOString().slice(0,10),env=f.integration.environment;
const actors=Object.fromEntries(['a','b'].map(key=>[key,{subjectId:f.actors[key].subjectId,routerUserId:opaqueUserId(env.COP_AI_CHAT_ROUTER_USER_ID_SECRET,f.actors[key].subjectId),contributors:Array.from({length:9},(_,offset)=>{const contributorDay=new Date(Date.parse(day+'T00:00:00.000Z')-offset*86400000).toISOString().slice(0,10);return {contributorIdDay:contributorIdDay(env.COP_DRIVER_MEASUREMENTS_HASH_SECRET,f.actors[key].subjectId,contributorDay),contributorDay};})}]));
const token=()=>randomBytes(32).toString('base64url');
console.log(JSON.stringify({contractVersion:'cop-sim-whole-erasure-fixture-v1',issuer:f.issuer,actors,environment:{copServiceToken:env.COP_SIM_ERASURE_ROUTER_TOKEN,driverHashSecret:env.COP_DRIVER_MEASUREMENTS_HASH_SECRET,driverActorSecret:env.COP_SIM_ERASURE_ACTOR_SECRET,routerHashSecret:token(),routerActorSecret:env.COP_SIM_ERASURE_ACTOR_SECRET,routerEncryptionKey:randomBytes(32).toString('base64'),routerSimToken:token(),routerAdminToken:token()}}));
"""
    execution=remote('docker exec --user 0:0 -i '+manifest['keycloak']['probeContainer']+' node --input-type=module -e '+shlex.quote(source),json.dumps({'manifest':manifest,'sources':sources}),check=False,timeout=30)
    if execution.returncode:
        lines=execution.stderr.splitlines()
        codes=[line.strip() for line in lines if re.fullmatch(r'code: [A-Z_\"\':,]+',line.strip()) or 'ERR_MODULE_NOT_FOUND' in line or 'Cannot find package' in line or 'Cannot find module' in line]
        print(json.dumps({'phase':'owned_cop_alias_diagnostic','dependencyErrors':[line[:200] for line in codes[:3]]}))
        raise RuntimeError('ACTUAL_COP_ALIAS_HELPER_FAILED')
    aliases=json.loads(execution.stdout.strip().splitlines()[-1])
    if aliases.get('issuer')!=manifest['issuer'] or any(aliases['actors'][key]['subjectId']!=manifest['actors'][key]['subjectId'] for key in ['a','b']):
        raise RuntimeError('ACTUAL_COP_ALIAS_SUBJECT_BINDING_FAILED')
    write_private(location,aliases)
    manifest['simAliasBootstrap']={'path':str(location),'sha256':hashlib.sha256(location.read_bytes()).hexdigest(),
        'helperSourceSha256':{name:hashlib.sha256(base64.b64decode(value)).hexdigest() for name,value in sources.items()}}
    replace_private(path,manifest)
    print(json.dumps({'phase':'actual_cop_user_aliases_exported_for_sim','bootstrapPath':str(location),'actualKeycloakSubjectsBound':True,'actualCopHelperFunctionsUsed':True,'secretsPrinted':False,'productionChanged':False}))



def prepare_postgis(manifest,path):
    check_owned(manifest['sharedHolder'],manifest['sharedHolderOwner'])
    check_owned(manifest['keycloak']['probeContainer'],manifest['ownerLabel'])
    if not manifest.get('database') or manifest.get('postgis'):
        raise RuntimeError('COP_POSTGIS_FIXTURE_BINDING_CONFLICT')
    image=json.loads(remote('docker image inspect postgis/postgis:18-3.6').stdout)[0]
    image_id=image['Id']
    if not re.fullmatch(r'sha256:[a-f0-9]{64}',image_id) or not any(value.startswith('postgis/postgis@sha256:') for value in image.get('RepoDigests',[])):
        raise RuntimeError('OFFICIAL_POSTGIS18_FIXTURE_IMAGE_REQUIRED')
    name=manifest['ownerLabel']+'-cop-pg'
    remote('docker run -d --log-driver none --name '+name+' --label cop.test.owner='+manifest['ownerLabel']+' --network container:'+manifest['sharedHolder']+
        ' --read-only --cap-drop ALL --security-opt no-new-privileges --user 999:999 --pids-limit 128 --memory 512m --cpus 1'
        ' --tmpfs /var/lib/postgresql:rw,size=256m,uid=999,gid=999,mode=0700'
        ' --tmpfs /var/run/postgresql:rw,size=16m,uid=999,gid=999,mode=0700 --tmpfs /tmp:rw,size=32m,uid=999,gid=999,mode=0700'
        ' --env POSTGRES_USER=cop_whole_postgis_admin --env POSTGRES_HOST_AUTH_METHOD=trust --env POSTGRES_DB=postgres '+image_id+
        " postgres -p 5433 -c listen_addresses=127.0.0.1 -c log_statement=none -c log_min_error_statement=panic")
    manifest['postgis']={'container':name,'imageId':image_id,'repoDigests':image['RepoDigests'],'port':5433}
    replace_private(path,manifest)
    source=r"""
import{readFileSync}from'node:fs';import{createRequire}from'node:module';const{Pool}=createRequire('/app/apps/cop-api/package.json')('pg');
const f=JSON.parse(readFileSync(0,'utf8')),admin=new Pool({host:'127.0.0.1',port:5433,user:'cop_whole_postgis_admin',database:'postgres',max:1,connectionTimeoutMillis:1000});admin.on('error',()=>{});
let business;try{
const deadline=Date.now()+60000;while(true){try{await admin.query('SELECT 1');break;}catch(error){if(Date.now()>deadline)throw error;await new Promise(resolve=>setTimeout(resolve,250));}}
const observed=(await admin.query("SELECT current_user usr,current_setting('server_version_num') version,current_setting('is_superuser') superuser,inet_server_addr() address")).rows[0];
if(observed.usr!=='cop_whole_postgis_admin'||observed.superuser!=='on'||observed.address!=='127.0.0.1'||Number(observed.version)<180000||Number(observed.version)>=190000)throw Error('OWNED_POSTGIS18_IDENTITY_REQUIRED');
if((await admin.query("SELECT count(*) n FROM pg_database WHERE datname='cop_erasure_test'")).rows[0].n!=='0')throw Error('OWNED_POSTGIS_BUSINESS_NOT_EMPTY');
await admin.query('CREATE ROLE cop_whole_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION; CREATE ROLE cop_whole_guard_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION');
await admin.query('CREATE DATABASE cop_erasure_test OWNER cop_whole_app');
business=new Pool({host:'127.0.0.1',port:5433,user:'cop_whole_postgis_admin',database:'cop_erasure_test',max:1});
await business.query('CREATE EXTENSION postgis');
const postgis=(await business.query('SELECT postgis_full_version() version')).rows[0].version;
await business.query('SET ROLE cop_whole_app; CREATE TABLE cop_mobility_v1(key text PRIMARY KEY,value jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())');
await business.query("INSERT INTO cop_mobility_v1(key,value) VALUES('account-safety:store-identity-v1',$1)",[{storeId:f.database.applicationStoreId,incarnationId:f.database.incarnationId}]);
await business.query('GRANT SELECT ON cop_mobility_v1 TO cop_whole_guard_runtime');
console.log(JSON.stringify({postgresVersion:Number(observed.version),postgisVersion:postgis,actualPostgisExtensionInstalled:true}));
}finally{await business?.end();await admin.end();}
"""
    execution=remote('docker exec --user 0:0 -i '+manifest['keycloak']['probeContainer']+' node --input-type=module -e '+shlex.quote(source),json.dumps(manifest),check=False,timeout=80)
    if execution.returncode:
        raise RuntimeError('ACTUAL_COP_POSTGIS_FIXTURE_PREPARE_FAILED')
    actual=json.loads(execution.stdout.strip().splitlines()[-1])
    manifest['postgis'].update(actual)
    manifest['leaseExpiresAt']=int(time.time())+10800
    manifest['database']['businessRuntimeUrl']='postgresql://cop_whole_app@127.0.0.1:5433/cop_erasure_test'
    manifest['database']['guardTargetReadUrl']='postgresql://cop_whole_guard_runtime@127.0.0.1:5433/cop_erasure_test'
    manifest['database']['businessAdminUrl']='postgresql://cop_whole_postgis_admin@127.0.0.1:5433/cop_erasure_test'
    manifest['integration']['environment']['COP_DATABASE_URL']=manifest['database']['businessRuntimeUrl']
    replace_private(path,manifest)
    print(json.dumps({'phase':'actual_cop_postgis18_business_fixture_prepared','container':name,'imageId':image_id,
        'postgresVersion':actual['postgresVersion'],'postgisVersion':actual['postgisVersion'],'publicPorts':False,'sharedHolderChanged':False,'productionChanged':False}))



def attach_media_edge(manifest,path):
    providers=manifest.get('providerFixtures')
    if not isinstance(providers,dict) or set(providers)!=set(['media','edge']):
        raise RuntimeError('EXPLICIT_ACTUAL_MEDIA_EDGE_FIXTURE_REFERENCES_REQUIRED')
    expected_paths={'media':'/fixture/cop-media.json','edge':'/fixture/cop-edge.json'}
    for key,ref in providers.items():
        if not isinstance(ref,dict) or set(ref)!=set(['container','path','owner']) or ref['path']!=expected_paths[key] or ref['owner']!=manifest['sharedHolderOwner']:
            raise RuntimeError('ACTUAL_MEDIA_EDGE_REFERENCE_SCOPE_REJECTED')
    providers={key:(ref['container'],ref['path'],ref['owner']) for key,ref in providers.items()}
    for key,(container,location,owner) in providers.items():
        check_owned(container,owner)
        observed=remote('docker exec '+container+' cat '+location)
        value=json.loads(observed.stdout)
        manifest[key]=value
    env=manifest['integration']['environment'];media=manifest['media'];edge=manifest['edge']
    if media.get('endpoint')!='http://127.0.0.1:8333' or not media.get('current') or not edge.get('adminToken'):
        raise RuntimeError('ACTUAL_MEDIA_EDGE_METADATA_REJECTED')
    env.update({'COP_MEDIA_STORE':'s3','COP_MEDIA_S3_ENDPOINT':media['endpoint'],'COP_MEDIA_S3_PUBLIC_ENDPOINT':media['endpoint'],
        'COP_MEDIA_S3_BUCKET':media['bucket'],'COP_MEDIA_S3_ACCESS_KEY_ID':media['current']['accessKeyId'],
        'COP_MEDIA_S3_SECRET_ACCESS_KEY':media['current']['secretAccessKey'],'COP_MEDIA_S3_REGION':'us-east-1',
        'COP_ACCOUNT_ERASURE_EDGE_URL':'http://127.0.0.1:4313','COP_EDGE_NODE_ID':edge.get('nodeId','synthetic-edge-whole'),'COP_EDGE_ADMIN_TOKEN':edge['adminToken']})
    replace_private(path,manifest)
    print(json.dumps({'phase':'actual_media_edge_fixture_metadata_attached','secretsPrinted':False,'productionChanged':False}))


def restore_cop_business_database(manifest):
    carrier=manifest['keycloak']['probeContainer']
    check_owned(carrier,manifest['ownerLabel'])
    directory='/dev/shm/cop-whole/'
    def private_json(name):
        return json.loads(remote('docker exec --user 0:0 '+carrier+' cat '+directory+name).stdout)
    online=private_json('online-deletion-verified-checkpoint.json')
    original=private_json('pre-deletion-checkpoint.json')
    snapshot=private_json('pre-deletion-snapshot-ack.json')
    operation=original['operationId']
    if online.get('contractVersion')!='cop-whole-online-deletion-checkpoint-v1' or online.get('operationId')!=operation or online.get('appStopped') is not True or online.get('allOwnerReadbacksVerified') is not True or online.get('actualOwnerCount')!=11 or snapshot.get('operationId')!=operation or snapshot.get('independentGuardIncluded') is not False:
        raise RuntimeError('WHOLE_ONLINE_ERASURE_BEFORE_RESTORE_UNPROVEN')
    dump=next((value for value in snapshot['dumps'] if value['database']=='cop_erasure_test'),None)
    container=manifest['postgis']['container']
    if not dump or dump['container']!=container or dump['path']!='/dev/shm/cop-whole-'+operation+'-cop_erasure_test.dump':
        raise RuntimeError('WHOLE_COP_RESTORE_ARCHIVE_SCOPE_REJECTED')
    check_owned(container,manifest['ownerLabel'])
    digest=remote(shlex.join(['docker','exec','--user','0:0',container,'sha256sum',dump['path']])).stdout.split()[0]
    if digest!=dump['sha256']:
        raise RuntimeError('WHOLE_COP_RESTORE_ARCHIVE_CHANGED')
    source=r"""
import{readFileSync}from'node:fs';import{createRequire}from'node:module';const{Pool}=createRequire('/app/apps/cop-api/package.json')('pg');const f=JSON.parse(readFileSync(0,'utf8'));const p=new Pool({connectionString:f.database.businessAdminUrl,max:1});try{let alive=false;try{const r=await fetch('http://127.0.0.1:4310/health/live',{signal:AbortSignal.timeout(1000)});alive=r.status>0;}catch{}if(alive)throw Error('COP_RESTORE_APP_NOT_STOPPED');const a=(await p.query("SELECT current_setting('is_superuser') s,current_database() d,(SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()) others")).rows[0];if(a.s!=='on'||a.d!=='cop_erasure_test'||a.others!==0)throw Error('COP_RESTORE_NOT_QUIESCED');console.log(JSON.stringify({quiesced:true}));}finally{await p.end();}
"""
    checked=remote('docker exec --user 0:0 -i '+carrier+' node --input-type=module -e '+shlex.quote(source),json.dumps(manifest),check=False)
    if checked.returncode:
        raise RuntimeError('WHOLE_COP_RESTORE_NOT_QUIESCED')
    base=['docker','exec','--user','0:0',container,'psql','-X','--no-password','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','5433','-U','cop_whole_postgis_admin','-d','postgres','-c']
    remote(shlex.join(base+['DROP DATABASE cop_erasure_test']),timeout=25)
    remote(shlex.join(base+['CREATE DATABASE cop_erasure_test OWNER cop_whole_app']),timeout=25)
    remote(shlex.join(['docker','exec','--user','0:0',container,'pg_restore','--exit-on-error','--no-password','-h','127.0.0.1','-p','5433','-U','cop_whole_postgis_admin','-d','cop_erasure_test',dump['path']]),timeout=45)
    source=r"""
import{readFileSync,writeFileSync}from'node:fs';import{randomUUID}from'node:crypto';import{createRequire}from'node:module';const{Pool}=createRequire('/app/apps/cop-api/package.json')('pg');const{transitionAccountErasureDataset}=await import('file:///dev/shm/cop-whole/apps/cop-api/dist/account-erasure-dataset-transition.js');const f=JSON.parse(readFileSync(0,'utf8'));const g=new Pool({connectionString:f.database.guardAdminUrl,max:1}),b=new Pool({connectionString:f.database.businessAdminUrl,max:1});try{const prior={incarnationId:f.database.incarnationId,restoreGeneration:f.database.restoreGeneration};const result=await transitionAccountErasureDataset(g,b,{guardStoreId:f.database.guardStoreId,applicationStoreId:f.database.applicationStoreId,configurationFingerprint:f.database.configurationFingerprint,previous:prior,restoredLocal:prior,next:{incarnationId:randomUUID(),restoreGeneration:prior.restoreGeneration+1}});if(result.status!=='replay_required')throw Error('RESTORE_TRANSITION_UNPROVEN');writeFileSync('/dev/shm/cop-whole/cop-database-restored-quarantined.json',JSON.stringify({contractVersion:'cop-whole-cop-restore-stage-v1',...result.datasetBinding,journalSequence:result.journalSequence,journalDigest:result.journalDigest,independentGuardRestored:false,replayRequired:true}),{mode:384,flag:'wx'});console.log(JSON.stringify({phase:'actual_cop_database_restored_quarantined',restoreGeneration:result.datasetBinding.restoreGeneration,independentGuardRestored:false,replayRequired:true,wholeAccountAccepted:false,productionChanged:false}));}finally{await g.end();await b.end();}
"""
    transitioned=remote('docker exec --user 0:0 -i '+carrier+' node --input-type=module -e '+shlex.quote(source),json.dumps(manifest),check=False,timeout=45)
    if transitioned.returncode:
        raise RuntimeError('WHOLE_COP_RESTORE_TRANSITION_PENDING')
    print(transitioned.stdout.strip(),flush=True)



def crash_pending_whole(manifest):
    carrier=manifest['keycloak']['probeContainer'];check_owned(carrier,manifest['ownerLabel'])
    script=ROOT/'scripts/account-safety/whole-main-crash.mjs'
    source="import{readFileSync,writeFileSync}from'node:fs';writeFileSync('/dev/shm/cop-whole/main-crash.mjs',Buffer.from(readFileSync(0,'utf8'),'base64'),{mode:384});"
    remote('docker exec --user 0:0 -i '+carrier+' node --input-type=module -e '+shlex.quote(source),base64.b64encode(script.read_bytes()).decode(),timeout=20)
    expected={'sourceSha':hashlib.sha256((ROOT/'scripts/account-safety/whole-account-erasure-probe.mjs').read_bytes()).hexdigest()}
    result=remote('docker exec --user 0:0 -i '+carrier+' node /dev/shm/cop-whole/main-crash.mjs',json.dumps(expected),check=False,timeout=45)
    if result.returncode:
        codes=re.findall(r'Error: (WHOLE_[A-Z0-9_]+)',result.stderr)
        print(json.dumps({'phase':'actual_whole_main_crash_rejected','code':codes[-1] if codes else 'WHOLE_CRASH_UNPROVEN','wholeAccountAccepted':False,'productionChanged':False}))
        raise RuntimeError('WHOLE_CONTROLLED_CRASH_NOT_VERIFIED')
    value=json.loads(result.stdout.strip().splitlines()[-1])
    if value.get('contractVersion')!='cop-whole-main-crash-checkpoint-v1' or value.get('processStopped') is not True or value.get('originalSealedJobPreserved') is not True:
        raise RuntimeError('WHOLE_CRASH_CHECKPOINT_INVALID')
    print(json.dumps(value),flush=True)


def retry_original_confirmation(manifest):
    carrier=manifest['keycloak']['probeContainer'];check_owned(carrier,manifest['ownerLabel'])
    script=ROOT/'scripts/account-safety/whole-confirmation-retry.mjs'
    source="import{readFileSync,writeFileSync}from'node:fs';const v=JSON.parse(readFileSync(0,'utf8'));writeFileSync('/dev/shm/cop-whole/confirmation-retry.mjs',Buffer.from(v.source,'base64'),{mode:384});"
    remote('docker exec --user 0:0 -i '+carrier+' node --input-type=module -e '+shlex.quote(source),json.dumps({'source':base64.b64encode(script.read_bytes()).decode()}),timeout=20)
    result=remote('docker exec --user 0:0 '+carrier+' node /dev/shm/cop-whole/confirmation-retry.mjs',check=False,timeout=200)
    for line in result.stdout.splitlines():
        try:
            value=json.loads(line)
            if value.get('phase') in ['actual_original_confirmation_recovery_accepted','actual_original_confirmation_retry','actual_original_confirmation_retry_failed']:
                print(json.dumps(value),flush=True)
        except ValueError:pass
    if result.returncode:raise RuntimeError('WHOLE_ACTUAL_ORIGINAL_RETRY_NOT_202')


def prepare_fixture_code_login(manifest):
    check_owned(manifest['keycloak']['probeContainer'],manifest['ownerLabel'])
    source=r"""
import{readFileSync}from'node:fs';const f=JSON.parse(readFileSync(0,'utf8')),base='http://127.0.0.1:8080';const response=await fetch(base+'/realms/master/protocol/openid-connect/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:'admin-cli',grant_type:'password',username:'fixture-admin',password:(f.serverLocal ? JSON.parse(readFileSync('/dev/shm/cop-whole/server-fixture-credentials.json','utf8')).adminPassword : 'synthetic-bootstrap-not-production')})});if(response.status!==200)throw Error('FIXTURE_ADMIN_LOGIN_FAILED');const authorization='Bearer '+(await response.json()).access_token;const url=base+'/admin/realms/cop-erasure-whole/clients/'+f.clientUuids['cop-web'];const original=await fetch(url,{headers:{authorization}});if(original.status!==200)throw Error('FIXTURE_CODE_CLIENT_NOT_FOUND');const client=await original.json();if(client.clientId!=='cop-web'||client.publicClient!==true||client.serviceAccountsEnabled===true)throw Error('FIXTURE_CODE_CLIENT_SCOPE_REJECTED');const expected='https://cop-erasure-whole.invalid/auth/callback';if(client.redirectUris?.some(value=>value!==expected))throw Error('FIXTURE_CODE_REDIRECT_CONFLICT');const updated=await fetch(url,{method:'PUT',headers:{authorization,'content-type':'application/json'},body:JSON.stringify({...client,standardFlowEnabled:true,redirectUris:[expected],attributes:{...client.attributes,'pkce.code.challenge.method':'S256'}})});if(updated.status!==204)throw Error('FIXTURE_CODE_CLIENT_UPDATE_FAILED');const final=await(await fetch(url,{headers:{authorization}})).json();if(final.standardFlowEnabled!==true||final.publicClient!==true||final.redirectUris?.join()!==expected||final.attributes?.['pkce.code.challenge.method']!=='S256')throw Error('FIXTURE_CODE_CLIENT_READBACK_FAILED');console.log(JSON.stringify({phase:'actual_fixture_code_login_configured',pkceRequired:true,publicClient:true,productionChanged:false}));
"""
    observed=remote('docker exec --user 0:0 -i '+manifest['keycloak']['probeContainer']+' node --input-type=module -e '+shlex.quote(source),json.dumps(manifest),check=False,timeout=25)
    if observed.returncode:
        raise RuntimeError('ACTUAL_FIXTURE_CODE_LOGIN_CONFIGURATION_FAILED')
    print(observed.stdout.strip(),flush=True)


def verify_full_messaging_source(manifest):
    if SERVER_LOCAL:
        proof=PUBLIC_SOURCE_PROOF['messagingSource']
        server_local.verify_messaging_source_paths(ROOT,proof)
        profile_path=ROOT/proof['profilePath'];profile_sha=proof['profileSha256']
        archive_path=ROOT/proof['archivePath'];archive_sha=proof['archiveSha256']
    elif case_suffix(manifest) != 'full-20261016':
        return None
    else:
        profile_path = pathlib.Path('/Users/voldzi/.codex/worktrees/cop-messaging-erasure-finish/05 Messaging/test/provider/messaging_approved_joint_full_v2.freeze-v3.json')
        profile_sha = '1cbeaad91663bf740a58bd8bbce54d15d9e592f30dd3d3b37d3dfa602cb1ae6b'
        archive_path = pathlib.Path('/private/tmp/cop-messaging-joint-source-full-v2-v3.tar.gz')
        archive_sha = '0aed0b1bfa86777c68e092910fa2b71b636467e7a7e8f4accc5c8545c31fe189'
    if profile_path.is_symlink() or hashlib.sha256(profile_path.read_bytes()).hexdigest() != profile_sha or \
       archive_path.is_symlink() or hashlib.sha256(archive_path.read_bytes()).hexdigest() != archive_sha:
        raise RuntimeError('WHOLE_FULL_V2_SOURCE_PROFILE_CHANGED')
    profile = json.loads(profile_path.read_text())
    owner = server_local.HOLDER_OWNER if SERVER_LOCAL else 'cop-messaging-joint-7fb1c640a2de'
    if manifest['sharedHolderOwner'] != owner or profile.get('contractVersion') != 'messaging-approved-joint-full-v2-freeze-v1':
        raise RuntimeError('WHOLE_FULL_V2_SOURCE_OWNER_MISMATCH')
    holder=json.loads(remote('docker inspect '+shlex.quote(manifest['sharedHolder'])).stdout)[0]
    expected_holder=manifest.get('sharedHolderId') if SERVER_LOCAL else '3a2f1f879b6fd76038c2ad619f5e405fac62b1cbd0ad5e7d654515a875bb062f'
    if holder['Id']!=expected_holder or holder['Config']['Labels'].get('cop.test.owner')!=owner or holder['Image']!=profile['images']['pg'] or holder['HostConfig']['NetworkMode']!='none' or holder['State']['Running'] is not True:
        raise RuntimeError('WHOLE_FULL_V2_HOLDER_BINDING_UNPROVEN')
    components = {}
    for component, prefix in [('synapse','/data/source'),('messaging','/fixture/project')]:
        name = owner + '-' + component
        state = json.loads(remote('docker inspect '+name).stdout)[0]
        if state['Config']['Labels'].get('cop.test.owner') != owner or state['Image'] != profile['images'][component] or state['State']['Running'] is not True or \
           state['HostConfig']['NetworkMode'] != 'container:'+holder['Id'] or state['HostConfig'].get('PortBindings') or state['HostConfig'].get('Binds') or \
           state['HostConfig'].get('LogConfig',{}).get('Type') != 'none' or state['HostConfig'].get('ReadonlyRootfs') is not True:
            raise RuntimeError('WHOLE_FULL_V2_RUNTIME_BINDING_UNPROVEN')
        files={prefix+'/'+path:digest for path,digest in profile['sourceSha256'].items()}
        if component=='synapse':
            files.update({'/data/'+path.rsplit('/',1)[1]:digest for path,digest in profile['sourceSha256'].items() if path.startswith('deploy/synapse/')})
            files['/data/joint-owner-bridge-full-v2.py']=profile['sourceSha256']['test/provider/messaging_approved_joint_full_v2_owner_bridge.py']
        if any(not re.fullmatch(r'/[A-Za-z0-9_./-]{1,250}',path) or '..' in pathlib.Path(path).parts for path in files):
            raise RuntimeError('WHOLE_FULL_V2_SOURCE_PATH_UNPROVEN')
        script='set -e\n'+'\n'.join('test -f '+shlex.quote(path)+' && test ! -L '+shlex.quote(path) for path in files)+'\nsha256sum '+' '.join(shlex.quote(path) for path in files)
        checked=remote('docker exec '+name+' /bin/sh -c '+shlex.quote(script),check=False,timeout=30)
        if checked.returncode:
            raise RuntimeError('WHOLE_FULL_V2_ACTUAL_SOURCE_BYTES_UNPROVEN')
        actual={}
        for line in checked.stdout.splitlines():
            match=re.fullmatch(r'([0-9a-f]{64})  (/[A-Za-z0-9_./-]+)',line)
            if not match or match.group(2) in actual:
                raise RuntimeError('WHOLE_FULL_V2_SOURCE_READBACK_INVALID')
            actual[match.group(2)]=match.group(1)
        if actual!=files:
            raise RuntimeError('WHOLE_FULL_V2_ACTUAL_SOURCE_BYTES_MISMATCH')
        components[component]={'containerId':state['Id'],'imageId':state['Image'],'verifiedFileCount':len(files)}
    hashes=profile['sourceSha256']
    public={'scopeSha256':hashes['deploy/synapse/approved-account-scope-full-v2.json'],'profileSha256':profile_sha,'sourceArchiveSha256':archive_sha,
        'providerSha256':hashes['deploy/synapse/cop_account_erasure_full_v2.py'],'clientSha256':hashes['lib/csm_messaging/synapse_erasure_client.ex'],
        'helperSha256':hashes['deploy/synapse/cop_owner_stream_erasure.py'],'sql005Sha256':hashes['deploy/synapse/005_reviewed_owner_stream_cleanup.sql']}
    return {'contractVersion':'cop-whole-full-v2-provider-source-v1','messagingSource':public,
        'sourceFileCount':len(hashes),'runtimeSourceBytesVerified':True,'components':components}


def bind_actual_readbacks(manifest,path):
    check_owned(manifest['keycloak']['probeContainer'],manifest['ownerLabel'])
    module=ROOT/'scripts/account-safety/whole-sim-messaging-fixture.mjs'
    if not module.is_file() or module.is_symlink():
        raise RuntimeError('WHOLE_ACTUAL_PROVIDER_FIXTURE_SOURCE_REQUIRED')
    env=manifest['integration']['environment']
    if not env.get('COP_LIVEKIT_API_KEY') or not env.get('COP_LIVEKIT_API_SECRET'):
        raise RuntimeError('WHOLE_ACTUAL_LIVEKIT_FIXTURE_REQUIRED')
    token=env['COP_CSM_MESSAGING_TOKEN']
    readbacks={owner:{'url':'http://127.0.0.1:'+str(port)+'/readback','token':token} for owner,port in [('sim_measurements',4321),('ai_router',4322),('messaging_matrix',4323)]}
    source=r"""
import{readFileSync}from'node:fs';
const f=JSON.parse(readFileSync(0,'utf8'));for(const[owner,binding]of Object.entries(f.readbacks)){const r=await fetch(binding.url,{redirect:'error',headers:{authorization:'Bearer '+binding.token},signal:AbortSignal.timeout(15000)});if(r.status!==200)throw Error('READBACK_'+owner+'_'+r.status);const v=await r.json();if(v.contractVersion!=='cop-whole-erasure-readback-v1'||Object.keys(v.owners??{}).join()!==owner||v.owners[owner].removableA<=0||v.owners[owner].removableB<=0)throw Error('READBACK_'+owner+'_MISSING_SEED');}console.log(JSON.stringify({actualReadbacksReady:true}));
"""
    execution=remote('docker exec --user 0:0 -i '+manifest['keycloak']['probeContainer']+' node --input-type=module -e '+shlex.quote(source),json.dumps({'readbacks':readbacks}),check=False,timeout=55)
    if execution.returncode:
        code=re.findall(r'Error: (READBACK_[A-Za-z0-9_]+)',execution.stderr)
        raise RuntimeError(code[-1] if code else 'ACTUAL_PROVIDER_READBACK_NOT_READY')
    provider_source=verify_full_messaging_source(manifest)
    if provider_source is not None:
        manifest['integration']['messagingProviderSource']=provider_source
    manifest['integration']['providerReadbacks']=readbacks
    manifest['integration']['fixtureModulePath']=str(module)
    manifest['integration']['fixtureModuleSha256']=hashlib.sha256(module.read_bytes()).hexdigest()
    manifest['integration']['missingComponents']=[]
    manifest['integration']['ready']=True
    # Renew only the lifetime of these still-running, exact owned fixtures.
    manifest['leaseExpiresAt']=int(time.time())+10800
    replace_private(path,manifest)
    print(json.dumps({'phase':'actual_whole_readbacks_bound','ownerCount':3,'productionChanged':False,'wholeAccountAccepted':False}))


def prepare_edge_auth(manifest,path):
    check_owned(manifest['keycloak']['probeContainer'],manifest['ownerLabel'])
    if not manifest.get('edge') or manifest['edge'].get('centralAuth'):
        raise RuntimeError('EDGE_SERVICE_FIXTURE_BINDING_CONFLICT')
    source=r"""
import{readFileSync}from'node:fs';import{randomBytes}from'node:crypto';
const f=JSON.parse(readFileSync(0,'utf8')),realm='cop-erasure-whole',origin='http://127.0.0.1:8080',clientId='cop-edge-whole-sync';
const token=async(client,form,realmName=realm)=>{const r=await fetch(origin+'/realms/'+realmName+'/protocol/openid-connect/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:client,...form}),signal:AbortSignal.timeout(10000)});if(r.status!==200)throw Error('KC_SERVICE_TOKEN_FAILED');return r.json();};
const admin=(await token('admin-cli',{grant_type:'password',username:'fixture-admin',password:(f.serverLocal ? JSON.parse(readFileSync('/dev/shm/cop-whole/server-fixture-credentials.json','utf8')).adminPassword : 'synthetic-bootstrap-not-production')},'master')).access_token;
const request=async(path,method='GET',body)=>{const r=await fetch(origin+'/admin/realms/'+realm+'/'+path,{method,headers:{authorization:'Bearer '+admin,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});if(![200,201,204].includes(r.status))throw Error('KC_SERVICE_ADMIN_REQUEST_FAILED');const text=await r.text();return text?JSON.parse(text):null;};
const existing=await request('clients?'+new URLSearchParams({clientId,search:'false'}));
if(existing.length>1)throw Error('KC_SERVICE_CLIENT_AMBIGUOUS');
let secret=existing.length?(await request('clients/'+existing[0].id+'/client-secret')).value:randomBytes(32).toString('base64url');
if(existing.length&&(existing[0].publicClient!==false||existing[0].serviceAccountsEnabled!==true||existing[0].fullScopeAllowed!==false||existing[0].standardFlowEnabled!==false||existing[0].directAccessGrantsEnabled!==false))throw Error('KC_SERVICE_RETRY_CONFIGURATION_CONFLICT');
if(!existing.length)await request('clients','POST',{clientId,secret,enabled:true,publicClient:false,protocol:'openid-connect',standardFlowEnabled:false,directAccessGrantsEnabled:false,serviceAccountsEnabled:true,fullScopeAllowed:false,defaultClientScopes:['basic'],optionalClientScopes:[],protocolMappers:[
{name:'cop-api-audience',protocol:'openid-connect',protocolMapper:'oidc-audience-mapper',config:{'included.custom.audience':'cop-api','id.token.claim':'false','access.token.claim':'true'}},
{name:'cop-tenant',protocol:'openid-connect',protocolMapper:'oidc-hardcoded-claim-mapper',config:{'claim.name':'cop_tenant_id','claim.value':'cop','jsonType.label':'String','id.token.claim':'false','access.token.claim':'true'}}]});
const clients=await request('clients?'+new URLSearchParams({clientId,search:'false'}));if(clients.length!==1)throw Error('KC_SERVICE_CLIENT_IDENTITY_FAILED');
const mappers=await request('clients/'+clients[0].id+'/protocol-mappers/models');const audienceMapper=mappers.find(mapper=>mapper.name==='cop-api-audience');if(!audienceMapper)throw Error('KC_SERVICE_AUDIENCE_MAPPER_MISSING');if(audienceMapper.config?.['included.custom.audience']!=='cop-api')await request('clients/'+clients[0].id+'/protocol-mappers/models/'+audienceMapper.id,'PUT',{...audienceMapper,config:{...audienceMapper.config,'included.client.audience':'','included.custom.audience':'cop-api'}});
const service=await request('clients/'+clients[0].id+'/service-account-user');
const roles=await request('users/'+service.id+'/role-mappings');if(roles.clientMappings?.['realm-management'])throw Error('KC_SERVICE_ADMIN_ROLES_FORBIDDEN');
const issued=await token(clientId,{grant_type:'client_credentials',client_secret:secret});
const claims=JSON.parse(Buffer.from(issued.access_token.split('.')[1],'base64url'));
const audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud];
if(claims.iss!==f.issuer||claims.sub!==service.id||claims.azp!==clientId||!audiences.includes('cop-api')||claims.cop_tenant_id!=='cop'||claims.resource_access?.['realm-management'])throw Error('KC_SERVICE_ACTUAL_CLAIMS_FAILED_'+[claims.iss===f.issuer,claims.sub===service.id,claims.azp===clientId,audiences.includes('cop-api'),claims.cop_tenant_id==='cop',!claims.resource_access?.['realm-management']].map(Boolean).map(Number).join(''));
console.log(JSON.stringify({centralAuth:{mode:'oidc',issuer:f.issuer,clientId,clientSecret:secret},binding:{kind:'edge',issuer:f.issuer,clientId,subjectId:service.id,audience:'cop-api',tenantId:'cop',nodeId:f.edge.nodeId??'synthetic-edge-whole',maxClassification:'INTERNAL'},actualServiceSub:service.id}));
"""
    execution=remote('docker exec --user 0:0 -i '+manifest['keycloak']['probeContainer']+' node --input-type=module -e '+shlex.quote(source),json.dumps({'issuer':manifest['issuer'],'edge':{'nodeId':manifest['edge']['nodeId']},'serverLocal':manifest.get('serverLocal')}),check=False,timeout=30)
    if execution.returncode:
        code=re.findall(r'Error: (KC_[A-Z0-9_]+)',execution.stderr)
        print(json.dumps({'phase':'owned_keycloak_edge_service_diagnostic','code':code[-1] if code else 'KC_SERVICE_EXECUTION_FAILED'}))
        raise RuntimeError('ACTUAL_KEYCLOAK_EDGE_SERVICE_PREPARE_FAILED')
    observed=json.loads(execution.stdout.strip().splitlines()[-1])
    manifest['edge']['centralAuth']=observed['centralAuth']
    manifest['edge']['actualServiceSubjectId']=observed['actualServiceSub']
    env=manifest['integration']['environment'];env['COP_SERVICE_AUTH_BINDINGS']=json.dumps([observed['binding']])
    env['COP_OIDC_ALLOWED_CLIENTS']='cop-web,csm-mobile,cop-edge-whole-sync'
    replace_private(path,manifest)
    print(json.dumps({'phase':'actual_keycloak_edge_service_prepared','actualServiceSub':observed['actualServiceSub'],'noRealmAdminRoles':True,'secretsPrinted':False,'productionChanged':False}))



def extend_contributor_days(manifest,path):
    check_owned(manifest['keycloak']['probeContainer'],manifest['ownerLabel'])
    carrier=manifest['keycloak']['probeContainer'];location='/tmp/'+case_private_path(manifest,'cop-sim-whole-erasure-fixture').name
    original=remote('docker exec --user 1000:1000 '+carrier+' cat '+location).stdout
    payload=json.loads(original)
    if payload.get('contractVersion')!='cop-sim-whole-erasure-fixture-v1' or payload.get('issuer')!=manifest['issuer'] or any(payload['actors'][key]['subjectId']!=manifest['actors'][key]['subjectId'] for key in ['a','b']):
        raise RuntimeError('ACTUAL_SIM_ALIAS_BINDING_CONFLICT')
    source=r"""
import{readFileSync}from'node:fs';const body=JSON.parse(readFileSync(0,'utf8'));
const{contributorIdDay}=await import('/dev/shm/cop-whole-identity/apps/cop-api/dist/driver-measurement-contract.js');
const today=Date.parse(new Date().toISOString().slice(0,10)+'T00:00:00.000Z');
for(const key of ['a','b'])body.actors[key].contributors=Array.from({length:9},(_,offset)=>{const contributorDay=new Date(today-offset*86400000).toISOString().slice(0,10);return{contributorIdDay:contributorIdDay(body.environment.driverHashSecret,body.actors[key].subjectId,contributorDay),contributorDay};});
console.log(JSON.stringify(body));
"""
    derived=remote('docker exec --user 0:0 -i '+carrier+' node --input-type=module -e '+shlex.quote(source),json.dumps(payload),check=False,timeout=20)
    if derived.returncode:
        raise RuntimeError('ACTUAL_NINE_DAY_CONTRIBUTOR_HELPER_FAILED')
    revised=json.loads(derived.stdout.strip().splitlines()[-1])
    before=json.loads(json.dumps(payload));after=json.loads(json.dumps(revised))
    for key in ['a','b']:
        before['actors'][key].pop('contributors');after['actors'][key].pop('contributors')
    if before!=after:
        raise RuntimeError('UNRELATED_SIM_FIXTURE_CHANGE_REJECTED')
    source=r"""
import{readFileSync,lstatSync,writeFileSync,renameSync,openSync,closeSync,fsyncSync,constants}from'node:fs';import{createHash,randomBytes}from'node:crypto';
const{body,expectedSha,location}=JSON.parse(readFileSync(0,'utf8'));if(!/^\/tmp\/cop-sim-whole-erasure-fixture-[a-zA-Z0-9-]+\.json$/.test(location))throw Error('PRIVATE_SIM_PATH_REJECTED');const path=location,s=lstatSync(path);
if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||s.nlink!==1||(s.mode&511)!==384)throw Error('PRIVATE_SIM_FILE_CUSTODY');
if(createHash('sha256').update(readFileSync(path)).digest('hex')!==expectedSha)throw Error('PRIVATE_SIM_FILE_CHANGED');
const tmp=path+'.cop-nine-days-'+randomBytes(8).toString('hex');writeFileSync(tmp,JSON.stringify(body),{mode:384,flag:'wx'});
const fd=openSync(tmp,constants.O_RDONLY);fsyncSync(fd);closeSync(fd);renameSync(tmp,path);console.log(JSON.stringify({updated:true,days:9,onlyContributorsChanged:true}));
"""
    written=remote('docker exec --user 1000:1000 -i '+carrier+' node --input-type=module -e '+shlex.quote(source),json.dumps({'body':revised,'expectedSha':hashlib.sha256(original.encode()).hexdigest(),'location':location}),check=False,timeout=20)
    if written.returncode:
        raise RuntimeError('PRIVATE_SIM_NINE_DAY_UPDATE_FAILED')
    local=case_private_path(manifest,'cop-sim-whole-erasure-fixture')
    replace_private(local,revised)
    manifest['simAliasBootstrap']['sha256']=hashlib.sha256(local.read_bytes()).hexdigest()
    replace_private(path,manifest)
    print(json.dumps({'phase':'actual_nine_day_contributors_updated','carrier':carrier,'remotePath':location,'daysPerActualUser':9,'onlyContributorsChanged':True,'secretsPrinted':False,'productionChanged':False}))


def configure_server_local(args,create=False):
    global SERVER_LOCAL,PUBLIC_SOURCE_PROOF
    if args.server_local:
        SERVER_LOCAL=True
        if not ROOT.is_relative_to(pathlib.Path('/srv/x5-production/staging/cop')):
            raise RuntimeError('WHOLE_PUBLIC_SOURCE_X5_STAGING_REQUIRED')
        PUBLIC_SOURCE_PROOF=server_local.verify_source_proof(ROOT,args.source_proof or '',args.source_proof_sha256)
        server_local.ensure_private_root(create=create)
    elif args.source_proof or args.source_proof_sha256:
        raise RuntimeError('WHOLE_SERVER_SOURCE_PROOF_REQUIRES_EXPLICIT_MODE')


def main():
    global SERVER_LOCAL, PUBLIC_SOURCE_PROOF
    parser = argparse.ArgumentParser()
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--prepare-keycloak', action='store_true')
    action.add_argument('--prepare-holder', action='store_true')
    action.add_argument('--run', action='store_true')
    action.add_argument('--prepare-source', action='store_true')
    action.add_argument('--continue-confirmed', action='store_true')
    action.add_argument('--retry-confirmed', action='store_true')
    action.add_argument('--crash-pending', action='store_true')
    action.add_argument('--export-sim-bootstrap', action='store_true')
    action.add_argument('--prepare-cop-database', action='store_true')
    action.add_argument('--export-sim-aliases', action='store_true')
    action.add_argument('--prepare-cop-postgis', action='store_true')
    action.add_argument('--attach-media-edge', action='store_true')
    action.add_argument('--prepare-edge-auth', action='store_true')
    action.add_argument('--bind-readbacks', action='store_true')
    action.add_argument('--restore-cop-database', action='store_true')
    action.add_argument('--prepare-code-login', action='store_true')
    action.add_argument('--extend-contributor-days', action='store_true')
    action.add_argument('--cleanup', action='store_true')
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--server-local', action='store_true')
    parser.add_argument('--source-proof')
    parser.add_argument('--source-proof-sha256')
    parser.add_argument('--holder')
    parser.add_argument('--holder-owner')
    args = parser.parse_args()
    configure_server_local(args, create=args.prepare_keycloak or args.prepare_holder)
    if args.prepare_holder:
        prepare_server_holder(args); return
    if args.prepare_keycloak:
        prepare(args); return
    path = safe_manifest(args.manifest, required=True)
    manifest = json.loads(path.read_text())
    if manifest.get('contractVersion') != 'cop-account-erasure-whole-fixture-v1' or manifest.get('_manifestPath') != str(path):
        raise RuntimeError('WHOLE_FIXTURE_CONTRACT_REJECTED')
    if SERVER_LOCAL and (manifest.get('ownerLabel')!=server_local.CASE_OWNER or manifest.get('sharedHolderOwner')!=server_local.HOLDER_OWNER or manifest.get('sharedHolder')!=server_local.HOLDER_NAME or manifest.get('serverLocal',{}).get('sourceProof')!=PUBLIC_SOURCE_PROOF):
        raise RuntimeError('WHOLE_SERVER_CASE_OR_PUBLIC_SOURCE_BINDING_CHANGED')
    if args.prepare_source:
        module=ROOT/'scripts/account-safety/whole-sim-messaging-fixture.mjs'
        manifest['integration']['fixtureModulePath']=str(module)
        manifest['integration']['fixtureModuleSha256']=hashlib.sha256(module.read_bytes()).hexdigest()
        prepare_whole_source(manifest,path)
        print(json.dumps({'phase':'actual_whole_source_prepared_without_runtime_start','integrationReady':manifest['integration']['ready'],'workerStarted':False,'wholeAccountAccepted':False,'productionChanged':False}))
        return
    if args.extend_contributor_days and SERVER_LOCAL:
        raise RuntimeError('WHOLE_SERVER_ALIASES_ALREADY_HAVE_NINE_REAL_UTC_DAYS')
    if args.extend_contributor_days:
        extend_contributor_days(manifest,path)
        return
    if args.attach_media_edge:
        attach_media_edge(manifest,path)
        return
    if args.prepare_edge_auth:
        prepare_edge_auth(manifest,path)
        return
    if args.bind_readbacks:
        bind_actual_readbacks(manifest,path)
        return
    if args.restore_cop_database:
        restore_cop_business_database(manifest)
        return
    if args.prepare_code_login:
        prepare_fixture_code_login(manifest)
        return
    if args.crash_pending:
        crash_pending_whole(manifest)
        return
    if args.retry_confirmed:
        retry_original_confirmation(manifest)
        return
    if args.prepare_cop_postgis:
        prepare_postgis(manifest,path)
        return
    if args.export_sim_aliases and SERVER_LOCAL:
        if not manifest.get('simAliasBootstrap',{}).get('serverOnly'):
            raise RuntimeError('WHOLE_SERVER_PRIVATE_BOOTSTRAP_REQUIRED')
        value=manifest['simAliasBootstrap'];target=case_private_path(manifest,'cop-sim-whole-erasure-fixture')
        if hashlib.sha256(target.read_bytes()).hexdigest()!=value['sha256']:
            raise RuntimeError('WHOLE_SERVER_PRIVATE_BOOTSTRAP_CHANGED')
        print(json.dumps({'phase':'actual_server_private_aliases_already_prepared','carrierRef':value['carrierRef'],'secretsPrinted':False,'productionChanged':False}))
        return
    if args.export_sim_aliases:
        export_sim_aliases(manifest,path)
        return
    if args.prepare_cop_database:
        prepare_cop_database(manifest, path)
        return
    if args.export_sim_bootstrap and SERVER_LOCAL:
        export_server_private_bootstraps(manifest,path)
        return
    if args.export_sim_bootstrap:
        bootstrap_path = case_private_path(manifest, 'cop-messaging-joint-bootstrap')
        if bootstrap_path.exists():
            raise RuntimeError('SIM_BOOTSTRAP_ALREADY_EXISTS')
        bootstrap = {'contractVersion': 'cop-messaging-joint-bootstrap-v1', 'issuer': manifest['issuer'],
            'subjects': {key: manifest['actors'][key]['subjectId'] for key in ['a', 'b']},
            'clientIds': ['cop-web', 'csm-mobile', 'csm-sim-web'],
            'serviceToken': base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('='),
            'root': base64.b64encode(os.urandom(32)).decode()}
        write_private(bootstrap_path, bootstrap)
        manifest['simBootstrap']={'path':str(bootstrap_path),'sha256':hashlib.sha256(bootstrap_path.read_bytes()).hexdigest()}
        replace_private(path,manifest)
        print(json.dumps({'phase': 'actual_keycloak_subjects_exported_for_sim', 'bootstrapPath': str(bootstrap_path),
            'actualKeycloakSubjects': bootstrap['subjects'], 'secretsPrinted': False, 'productionChanged': False}))
        return
    if args.cleanup:
        cleanup(manifest)
        print(json.dumps({'phase': 'owned_keycloak_fixture_removed', 'sharedHolderChanged': False, 'productionChanged': False})); return
    check_owned(manifest['keycloak']['container'], manifest['ownerLabel'])
    check_owned(manifest['keycloak']['probeContainer'], manifest['ownerLabel'])
    if manifest['leaseExpiresAt'] <= time.time():
        raise RuntimeError('WHOLE_FIXTURE_LEASE_EXPIRED')
    integration = manifest.get('integration', {})
    missing = integration.get('missingComponents', [])
    if integration.get('ready') is not True or missing:
        print(json.dumps({'phase': 'whole_acceptance_not_ready', 'missingComponents': missing or ['actual_full_provider_binding'],
            'actualKeycloakPrepared': True, 'wholeAccountAccepted': False, 'productionChanged': False}))
        raise SystemExit(2)
    if args.continue_confirmed:
        manifest['integration']['continueOperation']=True
    run_whole(manifest,path)


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as error:
        print(json.dumps({'phase': 'whole_acceptance_blocked', 'code': str(error), 'wholeAccountAccepted': False, 'productionChanged': False}))
        raise SystemExit(2)
    except subprocess.SubprocessError:
        print(json.dumps({'phase': 'whole_acceptance_blocked', 'code': 'OWNED_FIXTURE_COMMAND_FAILED', 'wholeAccountAccepted': False, 'productionChanged': False}))
        raise SystemExit(2)
