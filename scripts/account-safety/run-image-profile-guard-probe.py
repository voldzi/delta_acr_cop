#!/usr/bin/env python3
"""Actual runtime X5 guard in owned synthetic RAM-only Docker fixtures.
No production mount, source mutation, server, DB, network or persistent key.
"""
import base64,hashlib,json,pathlib,shlex,subprocess,uuid
ROOT=pathlib.Path(__file__).resolve().parents[2]
NODE='sha256:a06c103764701e7debc6434e3dd98e9a6d5f218d30831cb62aad566265db392f'
OWNER='cop-image-profile-test-'+uuid.uuid4().hex[:12]
SSH=['ssh','-4','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8','-o','HostName=192.168.10.116','-o','HostKeyAlias=docker.home.cz','docker.home.cz']
created=[];volume=OWNER+'-marker'
def remote(*args,body=None):
    r=subprocess.run(SSH+[shlex.join(args)],input=body,text=True,capture_output=True,timeout=90)
    if r.returncode:raise RuntimeError('owned_image_guard_command_failed')
    return r.stdout.strip()
def docker(*args,body=None):return remote('docker','--host','unix:///var/run/docker.sock',*args,body=body)
def owned(name):
    c=json.loads(docker('inspect',name))[0]
    if c['Config']['Labels'].get('cop.test.owner')!=OWNER:raise RuntimeError('fixture_owner_changed')
    return c
try:
    image=json.loads(docker('image','inspect',NODE))[0]
    if image['Id']!=NODE:raise RuntimeError('fixture_image_changed')
    docker('volume','create','--label','cop.test.owner='+OWNER,'--opt','type=tmpfs','--opt','device=tmpfs','--opt','o=size=8m',volume)
    for mode in ['present','missing']:
        name=OWNER+'-'+mode
        args=['run','-d','--pull','never','--name',name,'--label','cop.test.owner='+OWNER,'--hostname','docker','--network','none','--read-only','--user','0:0','--cap-drop','ALL','--cap-add','DAC_OVERRIDE','--log-driver','none','--security-opt','no-new-privileges','--pids-limit','32','--memory','128m','--tmpfs','/app/scripts/account-safety:rw,noexec,nosuid,size=8m','--tmpfs','/app/apps/cop-api/dist:rw,noexec,nosuid,size=8m']
        if mode=='present':args+=['--mount','type=volume,src='+volume+',dst=/fixture-seed']
        args+=['--entrypoint','node',NODE,'-e','setInterval(()=>{},3600000)']
        docker(*args);created.append(name);owned(name)
        files={'/app/scripts/account-safety/image-profile-probe.mjs':ROOT/'scripts/account-safety/image-profile-probe.mjs','/app/scripts/account-safety/provision-database-v2.mjs':ROOT/'scripts/account-safety/provision-database-v2.mjs','/app/apps/cop-api/dist/media-conversion.js':ROOT/'apps/cop-api/dist/media-conversion.js'}
        data={k:base64.b64encode(v.read_bytes()).decode() for k,v in files.items()}
        install="const fs=require('fs');const p=JSON.parse(fs.readFileSync(0,'utf8'));for(const[k,v]of Object.entries(p)){if(!['/app/scripts/account-safety/image-profile-probe.mjs','/app/scripts/account-safety/provision-database-v2.mjs','/app/apps/cop-api/dist/media-conversion.js'].includes(k))process.exit(1);fs.writeFileSync(k,Buffer.from(v,'base64'),{mode:384});}"
        docker('exec','-i',name,'node','-e',install,body=json.dumps(data))
    carrier=created[0]
    seed="const fs=require('fs');fs.writeFileSync('/fixture-seed/.cop-storage.json',JSON.stringify({uuid:'2f93f595-b61b-4eea-9054-7afa9b275b5b'}),{mode:292});console.log(fs.lstatSync('/fixture-seed').dev)"
    device=docker('exec',carrier,'node','-e',seed)
    if not device.isdecimal():raise RuntimeError('fixture_device_missing')
    # A distinct RO consumer, while the RW keeper preserves the same tmpfs.
    name=OWNER+'-readonly';docker('run','-d','--pull','never','--name',name,'--label','cop.test.owner='+OWNER,'--hostname','docker','--network','none','--read-only','--user','0:0','--cap-drop','ALL','--cap-add','DAC_OVERRIDE','--log-driver','none','--security-opt','no-new-privileges','--pids-limit','32','--memory','128m','--tmpfs','/app/scripts/account-safety:rw,noexec,nosuid,size=8m','--tmpfs','/app/apps/cop-api/dist:rw,noexec,nosuid,size=8m','--mount','type=volume,src='+volume+',dst=/data/cop-media-conversions,readonly','--entrypoint','node',NODE,'-e','setInterval(()=>{},3600000)');created.append(name);owned(name)
    docker('exec','-i',name,'node','-e',install,body=json.dumps(data))
    config={'workDir':'/data/cop-media-conversions','expectedStorageUuid':'2f93f595-b61b-4eea-9054-7afa9b275b5b','expectedDeviceId':device,'expectedPresent':True}
    positive=json.loads(docker('exec','-i',name,'node','/app/scripts/account-safety/image-profile-probe.mjs','--x5-guard',body=json.dumps(config)))
    negative=json.loads(docker('exec','-i',created[1],'node','/app/scripts/account-safety/image-profile-probe.mjs','--x5-guard',body=json.dumps({**config,'expectedPresent':False})))
    assert positive=={'actualX5GuardVerified':True,'wrongUuidRejected':True,'wrongDeviceRejected':True,'x5Written':False}
    assert negative=={'missingMountRejected':True}
    print(json.dumps({'phase':'owned_image_profile_guard_verified','productionChanged':False,'productionX5Mounted':False,'candidateApiBooted':False,'syntheticRamOnly':True,'nodeBaseImageId':NODE,'helperSourceSha256':hashlib.sha256(files['/app/scripts/account-safety/image-profile-probe.mjs'].read_bytes()).hexdigest(),'compiledConversionSha256':hashlib.sha256(files['/app/apps/cop-api/dist/media-conversion.js'].read_bytes()).hexdigest(),**positive,**negative}))
finally:
    for name in reversed(created):
        owned(name);docker('rm','-f',name)
    v=json.loads(docker('volume','inspect',volume))[0]
    if v.get('Labels',{}).get('cop.test.owner')!=OWNER:raise RuntimeError('fixture_volume_owner_changed')
    docker('volume','rm',volume)
