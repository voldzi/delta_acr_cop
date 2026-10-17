#!/usr/bin/env python3
"""Fresh server-local, network-none Keycloak namespace for whole12 acceptance.
All generated credentials stay in private container tmpfs/server process RAM.
This creates no production identity and cannot publish a whole acceptance GO.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import uuid

NODE = 'sha256:2e61857d00f7fe0326a7b50a8f96f0cb4563d4d9028645dc08efe51b84e800df'
KC = 'sha256:74ae260e7c0dad4c11d01934f0f0b80752e2cb565991258f9a95788c6f53eaa0'
STAGING = Path('/srv/x5-production/staging/cop')
ISSUER = 'https://cop-erasure-keycloak.invalid/realms/cop'


def need(value, code):
    if not value: raise RuntimeError(code)


def docker(*args, body=None, timeout=90):
    r = subprocess.run(['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock', *args],
        input=body, capture_output=True, timeout=timeout, check=False)
    need(r.returncode == 0, 'CLEAN_FIXTURE_DOCKER_COMMAND_FAILED')
    return r.stdout


def prepare(public_sources):
    need(socket.gethostname().split('.')[0] == 'docker' and os.getuid() == 1000, 'CLEAN_FIXTURE_SERVER_OWNER_REQUIRED')
    need(set(public_sources) == {'seed.mjs','provision-erasure-client.mjs'}, 'CLEAN_FIXTURE_SOURCE_SCOPE')
    mem = dict(x.split(':',1) for x in Path('/proc/meminfo').read_text().splitlines())
    need(int(mem['MemAvailable'].split()[0]) >= 6*1024*1024, 'CLEAN_FIXTURE_MEMORY_HEADROOM')
    need(STAGING.resolve() == STAGING and STAGING.stat().st_dev != Path('/').stat().st_dev
         and subprocess.run(['/usr/bin/findmnt','-n','-o','UUID','--target',str(STAGING)], capture_output=True,
                            check=True).stdout.strip() == b'2f93f595-b61b-4eea-9054-7afa9b275b5b', 'CLEAN_FIXTURE_X5_REQUIRED')
    for image in (NODE,KC):
        need(json.loads(docker('image','inspect',image))[0]['Id'] == image, 'CLEAN_FIXTURE_IMAGE_REQUIRED')
    owner = 'cop-clean-whole12-'+uuid.uuid4().hex[:12]
    node, kc = owner+'-node', owner+'-kc'
    actual = {}
    try:
        common = ['--pull','never','--label','cop.test.owner='+owner,'--log-driver','none','--read-only',
                  '--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--cpus','1']
        docker('run','-d','--name',node,*common,'--network','none','--user','1000:1000','--memory','768m',
            '--tmpfs','/dev/shm:rw,size=256m,uid=1000,gid=1000,mode=0700',
            '--tmpfs','/tmp:rw,size=64m,uid=1000,gid=1000,mode=0700','--entrypoint','node',NODE,
            '-e','setInterval(()=>{},1000)')
        actual[node] = json.loads(docker('inspect',node))[0]['Id']
        create = "import{mkdirSync,writeFileSync}from'node:fs';import{randomBytes}from'node:crypto';const p='/dev/shm/cop-clean-whole';mkdirSync(p,{mode:448});const c=Object.fromEntries(['adminPassword','userPassword','workerSecret','readOnlyWorkerSecret'].map(k=>[k,randomBytes(48).toString('base64url')]));writeFileSync(p+'/credentials.json',JSON.stringify(c),{mode:384,flag:'wx'});process.stdout.write(c.adminPassword);"
        admin_password = docker('exec',node,'node','--input-type=module','-e',create)
        wait = "set -eu; i=0; while [ ! -f /tmp/cop-bootstrap/admin-password ]; do i=$((i+1)); [ \"$i\" -lt 120 ]; sleep 1; done; KC_BOOTSTRAP_ADMIN_USERNAME=fixture-admin; KC_BOOTSTRAP_ADMIN_PASSWORD=\"$(cat /tmp/cop-bootstrap/admin-password)\"; export KC_BOOTSTRAP_ADMIN_USERNAME KC_BOOTSTRAP_ADMIN_PASSWORD; exec /opt/keycloak/bin/kc.sh start --optimized --http-enabled=true --hostname=https://cop-erasure-keycloak.invalid --db=dev-file --log-level=warn"
        docker('run','-d','--name',kc,*common,'--network','container:'+node,'--user','1000:0','--memory','768m',
            '--tmpfs','/opt/keycloak/data:rw,size=256m,uid=1000,gid=0,mode=0700',
            '--tmpfs','/tmp:rw,size=64m,uid=1000,gid=0,mode=0700','--entrypoint','/bin/sh',KC,'-c',wait)
        actual[kc] = json.loads(docker('inspect',kc))[0]['Id']
        # Keycloak image has no Python; its existing Java shell accepts the
        # generated bootstrap through stdin, never Docker Config.Env/argv.
        docker('exec','-i',kc,'/bin/sh','-c',
            'set -eu; umask 077; mkdir /tmp/cop-bootstrap; cat > /tmp/cop-bootstrap/admin-password', body=admin_password)
        admin_password = b''
        bootstrap = "import{readFileSync,writeFileSync,mkdirSync}from'node:fs';const p='/dev/shm/cop-clean-whole/source';mkdirSync(p,{mode:448});for(const[k,v]of Object.entries(JSON.parse(readFileSync(0,'utf8')))){if(!['seed.mjs','provision-erasure-client.mjs'].includes(k))throw Error('SOURCE_SCOPE');writeFileSync(p+'/'+k,Buffer.from(v,'base64'),{mode:384,flag:'wx'});}try{await import(p+'/seed.mjs');}catch(e){process.stderr.write(JSON.stringify({stage:globalThis.fixtureStage??'seed',code:typeof e.code==='string'?e.code:'ACTUAL_KEYCLOAK_SEED_FAILED'})+'\\n');process.exitCode=1;}"
        r = subprocess.run(['/usr/bin/docker','exec','-i',node,'node','--input-type=module','-e',bootstrap],
            input=json.dumps(public_sources).encode(), capture_output=True, timeout=120, check=False)
        if r.returncode != 0:
            try: stage = json.loads(r.stderr.strip().splitlines()[-1]).get('stage')
            except (ValueError, IndexError): stage = None
            if stage in {'keycloak_startup','new_cop_realm','actual_two_users','exact_erasure_service'}:
                raise RuntimeError('CLEAN_FIXTURE_SEED_'+stage.upper()+'_FAILED')
            raise RuntimeError('CLEAN_FIXTURE_ACTUAL_KEYCLOAK_SEED_FAILED')
        need(json.loads(r.stdout).get('actualKeycloakPrepared') is True, 'CLEAN_FIXTURE_ACTUAL_KEYCLOAK_SEED_FAILED')
        # Verify generated values never entered persistent container metadata.
        verify = "import{readFileSync}from'node:fs';const c=JSON.parse(readFileSync('/dev/shm/cop-clean-whole/credentials.json','utf8'));const v=readFileSync(0,'utf8');if(Object.values(c).some(s=>v.includes(s)))throw Error('CONFIG_SECRET_LEAK');console.log('verified');"
        metadata = docker('inspect',node,kc)
        need(docker('exec','-i',node,'node','--input-type=module','-e',verify,body=metadata).strip() == b'verified',
             'CLEAN_FIXTURE_METADATA_SECRET_LEAK')
        directory = STAGING/owner; directory.mkdir(mode=0o700)
        receipt = {'contractVersion':'cop-clean-whole12-namespace-v1','owner':owner,
            'holder':node,'keycloak':kc,'containers':actual,'images':{'node':NODE,'keycloak':KC},'issuer':ISSUER,
            'namespace':'network-none','hostPorts':[],'actualKeycloakPrepared':True,'actorCount':2,
            'privateFixturePath':'/dev/shm/cop-clean-whole/keycloak-seed.json',
            'sourceDigests':{k:hashlib.sha256(base64.b64decode(v)).hexdigest() for k,v in public_sources.items()},
            'productionTouched':False,'wholeAccountAccepted':False}
        fd = os.open(directory/'namespace.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'w') as stream: json.dump(receipt,stream);stream.flush();os.fsync(stream.fileno())
        return receipt
    except BaseException:
        for name, cid in reversed(list(actual.items())):
            c = json.loads(docker('inspect',cid))[0]
            need(c['Id'] == cid and c['Name'] == '/'+name and c['Config']['Labels'].get('cop.test.owner') == owner,
                 'CLEAN_FIXTURE_CLEANUP_CUSTODY')
            docker('rm','-f',cid)
        raise


if __name__ == '__main__':
    try:
        data = sys.stdin.buffer.read(1048577)
        need(len(data) <= 1048576, 'CLEAN_FIXTURE_INPUT_LIMIT')
        print(json.dumps(prepare(json.loads(data))))
    except Exception as error:
        code = str(error)
        if not code.startswith('CLEAN_FIXTURE_') or not code.replace('_','').isalnum():
            code = 'CLEAN_FIXTURE_PREPARATION_FAILED'
        print(json.dumps({'phase':'clean_whole12_namespace_not_ready','code':code,'productionTouched':False,'wholeAccountAccepted':False}))
        sys.exit(2)
