#!/usr/bin/env python3
"""Read-only SELECT drill for the existing accepted production DB profile.
No image/profile activation, DDL, environment edit, new privilege or secret copy.
"""
import base64,json,pathlib,shlex,subprocess,uuid
ROOT=pathlib.Path(__file__).resolve().parents[2]
SSH=['ssh','-4','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8','-o','HostName=192.168.10.116','-o','HostKeyAlias=docker.home.cz','docker.home.cz']
OWNER='cop-image-profile-db-test-'+uuid.uuid4().hex[:12]
files={name:base64.b64encode((ROOT/'scripts/account-safety'/name).read_bytes()).decode() for name in ['image-profile-probe.mjs','provision-database-v2.mjs']}
source=r'''
import base64,hashlib,json,os,pathlib,re,stat,subprocess,sys
p=json.load(sys.stdin);name=p['owner'];root=pathlib.Path('/srv/cop');activePath=root/'runtime/api/active.json'
def call(*args,body=None):
 r=subprocess.run(args,input=body,text=True,capture_output=True,timeout=60)
 if r.returncode:
  for line in r.stdout.splitlines():
   try:
    item=json.loads(line)
    if item.get('phase')=='owned_profile_probe_fixed_diagnostic' and re.fullmatch('[A-Z_]{5,80}',item.get('code','')):print(json.dumps(item),flush=True)
   except (ValueError,AttributeError):pass
  raise RuntimeError('read_only_profile_probe_failed')
 return r.stdout.strip()
def docker(*args,body=None):return call('docker','--host','unix:///var/run/docker.sock',*args,body=body)
def inspect():return json.loads(docker('inspect',name))[0]
active=json.loads(activePath.read_bytes());profile=pathlib.Path('/etc/vcode-cop-api-runtime')/active['profileGeneration'];runtime=profile/'runtime.env';original=runtime.stat()
assert active['contractVersion']=='cop-api-runtime-active-v1' and len(active['containerId'])==64
live=json.loads(docker('inspect',active['containerId']))[0]
assert live['Image']==active['imageId'] and live['State']['Running'] and not live['State'].get('Paused')
attestation=profile/('attestation-'+active['imageId'][7:]+'.json');accepted=json.loads(attestation.read_bytes());ca=accepted['driverContract']['caSha256']
assert accepted['profileGeneration']==active['profileGeneration'] and accepted['imageId']==active['imageId'] and accepted['driverContract']['poolMode']=='transaction'
created=False
try:
 args=['run','-d','--pull','never','--name',name,'--label','cop.test.owner='+name,'--hostname','docker','--network','host','--read-only','--user','0:0','--group-add','982','--cap-drop','ALL','--cap-add','DAC_OVERRIDE','--log-driver','none','--security-opt','no-new-privileges','--pids-limit','32','--memory','128m','--tmpfs','/probe:rw,noexec,nosuid,size=8m']
 for src,dst in [('/srv/cop','/srv/cop'),('/run/vcode-cop-pgbouncer','/run/vcode-cop-pgbouncer'),('/etc/vcode-cop-pgbouncer/postgres-ca.crt','/etc/vcode-cop-pgbouncer/postgres-ca.crt'),(str(runtime),'/probe-profile/runtime.env')]:args+=['--mount','type=bind,src='+src+',dst='+dst+',readonly']
 args+=['--entrypoint','node',active['imageId'],'-e','setInterval(()=>{},3600000)'];docker(*args);created=True
 assert inspect()['Config']['Labels']['cop.test.owner']==name
 install="const fs=require('fs');const p=JSON.parse(fs.readFileSync(0,'utf8'));for(const[k,v]of Object.entries(p)){if(!['image-profile-probe.mjs','provision-database-v2.mjs'].includes(k))process.exit(1);fs.writeFileSync('/probe/'+k,Buffer.from(v,'base64'),{mode:384});}"
 docker('exec','-i',name,'node','-e',install,body=json.dumps(p['files']))
 bootstrap="const fs=require('fs'),cp=require('child_process');const config=JSON.parse(fs.readFileSync(0,'utf8'));let values={COP_DATABASE_POOL_MODE:'transaction'};for(const line of fs.readFileSync('/probe-profile/runtime.env','utf8').split(/\\r?\\n/)){if(!line.trim()||line.trimStart().startsWith('#'))continue;const m=/^COP_API_RUNTIME_([A-Z_]+)=(.*)$/.exec(line);if(!m)process.exit(1);let v=m[2];if((v.startsWith(\"'\")&&v.endsWith(\"'\"))||(v.startsWith('\"')&&v.endsWith('\"')))v=v.slice(1,-1);values['COP_'+m[1]]=v;}const r=cp.spawnSync(process.execPath,['/probe/image-profile-probe.mjs','--database'],{input:JSON.stringify({values,caSha256:config.ca}),encoding:'utf8',timeout:30000});if(r.status!==0){let code='IMAGE_PROFILE_CHILD_FAILED';for(const line of (r.stderr+'\\n'+r.stdout).split('\\n')){try{const v=JSON.parse(line);if(v.phase==='image_profile_probe_failed'&&/^[A-Z_]{5,80}$/.test(v.code))code=v.code;}catch{}}console.log(JSON.stringify({phase:'owned_profile_probe_fixed_diagnostic',code}));process.exit(1);}process.stdout.write(r.stdout);"
 result=json.loads(docker('exec','-i',name,'node','-e',bootstrap,body=json.dumps({'ca':ca})))
 assert result['databaseRoutingVerified'] and result['readOnlySelects'] in (3,4) and result['startupDdl'] is False
 now=runtime.stat();assert (original.st_ino,original.st_size,original.st_mtime_ns,original.st_ctime_ns)==(now.st_ino,now.st_size,now.st_mtime_ns,now.st_ctime_ns) and json.loads(activePath.read_bytes())==active
 print(json.dumps({'phase':'actual_accepted_profile_database_verified','existingProfileGeneration':active['profileGeneration'],'nodeBaseImageId':active['imageId'],'helperSourceSha256':hashlib.sha256(base64.b64decode(p['files']['image-profile-probe.mjs'])).hexdigest(),'productionChanged':False,'profileOrEnvironmentChanged':False,**result}))
finally:
 if created:
  assert inspect()['Config']['Labels']['cop.test.owner']==name;docker('rm','-f',name)
'''
r=subprocess.run(SSH+[shlex.join(['python3','-B','-c',source])],input=json.dumps({'owner':OWNER,'files':files}),text=True,capture_output=True,timeout=90)
if r.returncode:
    for line in r.stdout.splitlines():
        try:
            item=json.loads(line)
            if item.get('phase')=='owned_profile_probe_fixed_diagnostic':print(json.dumps(item))
        except (ValueError,AttributeError):pass
    print(json.dumps({'phase':'actual_accepted_profile_database_not_complete','code':'READ_ONLY_PROFILE_PROBE_FAILED','productionChanged':False}));raise SystemExit(1)
print(r.stdout.strip())
