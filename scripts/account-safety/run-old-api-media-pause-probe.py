#!/usr/bin/env python3
"""Actual old COP image pause/credential-rotation regression in owned fixtures.
No production mounts, service credentials, published ports, or shared namespace.
"""
import json, pathlib, shlex, subprocess
REMOTE = r'''
import hashlib,json,re,secrets,subprocess,sys,time
OLD='sha256:a06c103764701e7debc6434e3dd98e9a6d5f218d30831cb62aad566265db392f'
S3='chrislusf/seaweedfs@sha256:fc9f76fa993ad69966ffeb2f65d0318fcae39c6f8e20cf68ef7b3a5cb97769e5'
OWNER='cop-old-api-media-pause-'+secrets.token_hex(6)
HELPER=OWNER+'-helper';API=OWNER+'-api';PROVIDER=OWNER+'-s3';META=OWNER+'-private';DATA=OWNER+'-data'
containers=[];volumes=[];modules=json.load(sys.stdin);phase='prepare'
def run(*args,input=None):
 r=subprocess.run(args,input=input,text=True,capture_output=True)
 if r.returncode:raise RuntimeError('OWNED_FIXTURE_COMMAND_FAILED')
 return r.stdout.strip()
def inspect(name):return json.loads(run('docker','inspect',name))[0]
def put(path,body):run('docker','exec','--user','0:0','-i',HELPER,'/bin/sh','-c','umask 077; cat > '+path,input=body)
def node(source):
 r=subprocess.run(['docker','exec','--user','0:0',HELPER,'node','--input-type=module','-e',source],capture_output=True,text=True)
 if r.returncode:
  codes=re.findall(r'Error: ([A-Z][A-Z0-9_]+)',r.stderr)
  raise RuntimeError(codes[-1] if codes else 'OWNED_NODE_PROBE_FAILED')
 return json.loads(r.stdout.strip().splitlines()[-1])
def read(path):return json.loads(run('docker','exec','--user','0:0',HELPER,'cat',path))
def wait_file(path):
 for _ in range(200):
  if subprocess.run(['docker','exec','--user','0:0',HELPER,'test','-f',path],capture_output=True).returncode==0:return read(path)
  time.sleep(.1)
 raise RuntimeError('ACTUAL_API_RESULT_TIMEOUT')
COMMON="""import{readFileSync}from'node:fs';const m=JSON.parse(readFileSync('/fixture/fixture.json','utf8'));
const{S3PresignedMediaStorage}=await import('/app/apps/cop-api/dist/media-storage.js');
const make=(key,bucket=m.bucket)=>new S3PresignedMediaStorage({...m[key],bucket,endpoint:m.endpoint,publicEndpoint:m.endpoint,region:'us-east-1',uploadExpiresSeconds:900});
const current=make('current'),old=make('legacy'),other=make('other','other-fixture-bucket');
"""
HEALTH="""let observation={};for(const name of ['live','ready','dependencies']){const r=await fetch('http://127.0.0.1:4310/health/'+name,{signal:AbortSignal.timeout(15000)}),body=await r.json();if(r.status!==200)throw Error('ACTUAL_OLD_API_HEALTH_'+name.toUpperCase()+'_HTTP_'+r.status+'_'+String(body.error?.code??'NO_FIXED_CODE').replace(/[^A-Z0-9_]/g,''));observation[name]={http:r.status,status:body.status};if(name==='dependencies'){const media=body.dependencies.find(v=>v.name==='media-storage');if(media?.status!=='ok')throw Error('ACTUAL_OLD_API_MEDIA_INIT_NOT_OK');observation.mediaStatus=media.status;}}console.log(JSON.stringify(observation));"""
result=None
try:
 run('docker','image','inspect',OLD);run('docker','image','inspect',S3)
 uid=run('docker','run','--rm','--entrypoint','/bin/sh',S3,'-c','id -u seaweed');gid=run('docker','run','--rm','--entrypoint','/bin/sh',S3,'-c','id -g seaweed')
 assert uid.isdigit() and gid.isdigit()
 for volume in [META,DATA]:
  run('docker','volume','create','--label','cop.test.owner='+OWNER,volume);volumes.append(volume)
 run('docker','run','-d','--name',HELPER,'--network','none','--label','cop.test.owner='+OWNER,'--memory=256m','--cpus=1',
  '--mount','type=volume,source='+META+',target=/fixture','--entrypoint','node',OLD,'-e','setInterval(()=>{},1000)');containers.append(HELPER)
 holder=inspect(HELPER)['Id']
 credential=lambda name:{'accessKeyId':'synthetic-'+name+'-'+secrets.token_hex(8),'secretAccessKey':secrets.token_hex(32)}
 manifest={'contractVersion':'cop-old-api-media-pause-fixture-v1','endpoint':'http://127.0.0.1:8333','bucket':'cop-community-media',
  'legacy':credential('old'),'current':credential('new'),'other':credential('other')}
 identities=[]
 for name,key in [('cop-production','legacy'),('other-application','other')]:
  c=manifest[key];identities.append({'name':name,'credentials':[{'accessKey':c['accessKeyId'],'secretKey':c['secretAccessKey']}],'actions':['Admin','Read','Write']})
 put('/fixture/fixture.json',json.dumps(manifest));put('/fixture/s3.json',json.dumps({'identities':identities}))
 for name,body in modules.items():
  assert name in ['install-media-upload-closure.mjs','install-production-erasure.mjs','provision-database-v2.mjs']
  put('/fixture/'+name,body)
 run('docker','exec','--user','0:0',HELPER,'chown',uid+':'+gid,'/fixture/s3.json')
 run('docker','run','-d','--name',PROVIDER,'--network','container:'+holder,'--label','cop.test.owner='+OWNER,'--memory=512m','--cpus=1',
  '--mount','type=volume,source='+META+',target=/fixture,readonly','--mount','type=volume,source='+DATA+',target=/data',S3,
  'server','-dir=/data','-ip=127.0.0.1','-ip.bind=0.0.0.0','-s3','-s3.port=8333','-s3.config=/fixture/s3.json',
  '-master.telemetry=false','-master.volumeSizeLimitMB=16','-volume.max=16','-volume.port=8081','-volume.preStopSeconds=0');containers.append(PROVIDER)
 node(COMMON+"""for(let n=0;;n++){try{await old.init();await other.init();break;}catch{if(n>160)throw Error('ACTUAL_PROVIDER_NOT_READY');await new Promise(r=>setTimeout(r,250));}}
await old.putObject({objectKey:'community-reports/synthetic-b/a/b.txt',contentType:'text/plain',body:Buffer.from('SYNTHETIC_B')},new Date());
await other.putObject({objectKey:'preserved.txt',contentType:'text/plain',body:Buffer.from('SYNTHETIC_OTHER')},new Date());console.log(JSON.stringify({actualSeed:true}));""")
 boot="""import{readFileSync,writeFileSync}from'node:fs';
const m=JSON.parse(readFileSync('/fixture/fixture.json','utf8'));
for(const key of Object.keys(process.env))if(key.startsWith('COP_')||['DATABASE_URL','PGHOST','PGPASSWORD','PGUSER'].includes(key))delete process.env[key];
process.env.NODE_ENV='test';process.env.COP_ACCOUNT_ERASURE_ENABLED='false';process.env.COP_ACCOUNT_SAFETY_GUARD_REQUIRED='false';
const{buildServer}=await import('/app/apps/cop-api/dist/server.js');
const{S3PresignedMediaStorage}=await import('/app/apps/cop-api/dist/media-storage.js');
const storage=new S3PresignedMediaStorage({...m.legacy,bucket:m.bucket,endpoint:m.endpoint,publicEndpoint:m.endpoint,region:'us-east-1',uploadExpiresSeconds:900});
const app=buildServer({logger:false,mediaStorage:storage});await app.listen({host:'127.0.0.1',port:4310});
writeFileSync('/fixture/api-started.json',JSON.stringify({pid:process.pid,uptime:process.uptime()}),{mode:0o600});
let iteration=0,busy=false;process.on('SIGUSR2',()=>{if(busy)return;busy=true;const n=++iteration;void(async()=>{let status;try{await storage.putObject({objectKey:'community-reports/synthetic-ram/a/probe.txt',contentType:'text/plain',body:Buffer.from('SYNTHETIC_RAM_'+n)},new Date());status=200;}catch(error){const match=/^object upload failed with HTTP ([0-9]{3})$/.exec(error.message);status=match?Number(match[1]):'unknown';}writeFileSync('/fixture/ram-'+n+'.json',JSON.stringify({pid:process.pid,status}),{mode:0o600});busy=false;})();});
"""
 put('/fixture/api.mjs',boot)
 run('docker','run','-d','--name',API,'--network','container:'+holder,'--label','cop.test.owner='+OWNER,'--memory=768m','--cpus=1',
  '--mount','type=volume,source='+META+',target=/fixture','--entrypoint','node',OLD,'/fixture/api.mjs');containers.append(API)
 try:started=wait_file('/fixture/api-started.json')
 except:
  # Keep raw startup details out of output. Inspect only a fixed missing-module/config code.
  logs=run('docker','logs',API)
  code='OLD_API_ISOLATED_START_FAILED'
  for token in ['ERR_MODULE_NOT_FOUND','ENOENT','ECONNREFUSED']:
   if token in logs:code+='_'+token;break
  raise RuntimeError(code)
 assert started['pid']==1
 before_api=inspect(API);before_provider=inspect(PROVIDER)
 provider_version=run('docker','exec',PROVIDER,'weed','version');assert '4.45' in provider_version and '79b872021' in provider_version
 assert before_api['Image']==OLD and before_api['State']['Running'] and before_api['State']['Pid']>0
 phase='before_pause';before_health=node(HEALTH)
 run('docker','kill','--signal','USR2',API);ram_before=wait_file('/fixture/ram-1.json');assert ram_before['pid']==1 and ram_before['status']==200
 run('docker','pause',API);paused=inspect(API);assert paused['State']['Paused'] and paused['State']['Pid']==before_api['State']['Pid']
 run('docker','stop','-t','3',PROVIDER);stopped=inspect(PROVIDER);assert not stopped['State']['Running'] and stopped['State']['Pid']==0
 rotation=node("""import{readFileSync,writeFileSync}from'node:fs';const m=JSON.parse(readFileSync('/fixture/fixture.json','utf8')),p='/fixture/s3.json',c=JSON.parse(readFileSync(p,'utf8'));
const before=JSON.stringify(c.identities.filter(v=>v.name!=='cop-production')),target=c.identities.filter(v=>v.name==='cop-production');if(target.length!==1)throw Error('EXACT_COP_IDENTITY_REQUIRED');target[0].credentials=[{accessKey:m.current.accessKeyId,secretKey:m.current.secretAccessKey}];if(JSON.stringify(c.identities.filter(v=>v.name!=='cop-production'))!==before)throw Error('OTHER_IDENTITY_CHANGED');writeFileSync(p,JSON.stringify(c),{mode:0o600});console.log(JSON.stringify({onlyCopCredential:true}));""")
 run('docker','start',PROVIDER);after_provider=inspect(PROVIDER)
 assert after_provider['Id']==before_provider['Id'] and after_provider['Image']==before_provider['Image'] and after_provider['State']['StartedAt']!=before_provider['State']['StartedAt']
 provider=node(COMMON+"""for(let n=0;;n++){try{await current.init();const b=await current.getObject({objectKey:'community-reports/synthetic-b/a/b.txt'},new Date());if(b.body.toString()!=='SYNTHETIC_B')throw Error('SECOND_ACCOUNT_CHANGED');break;}catch{if(n>160)throw Error('ACTUAL_PROVIDER_RESTART_NOT_READY');await new Promise(r=>setTimeout(r,250));}}
const otherBody=await other.getObject({objectKey:'preserved.txt'},new Date());if(otherBody.body.toString()!=='SYNTHETIC_OTHER')throw Error('OTHER_IDENTITY_CHANGED');
await current.putObject({objectKey:'community-reports/synthetic-new/a/probe.txt',contentType:'text/plain',body:Buffer.from('SYNTHETIC_NEW')},new Date());
if((await current.getObject({objectKey:'community-reports/synthetic-new/a/probe.txt'},new Date())).body.toString()!=='SYNTHETIC_NEW')throw Error('NEW_CREDENTIAL_READBACK_FAILED');
console.log(JSON.stringify({newCredentialWriteRead:true,secondAccountPreserved:true,otherIdentityPreserved:true}));""")
 run('docker','unpause',API);after_api=inspect(API)
 assert after_api['Id']==before_api['Id'] and after_api['Image']==OLD and after_api['State']['Pid']==before_api['State']['Pid'] and after_api['State']['StartedAt']==before_api['State']['StartedAt'] and not after_api['State']['Paused']
 phase='after_unpause';after_health=node(HEALTH)
 run('docker','kill','--signal','USR2',API);ram_after=wait_file('/fixture/ram-2.json');assert ram_after['pid']==1 and ram_after['status']==403
 phase='version_cleanup';versions=node(COMMON+"""const{signedClosureRequest,exactCanaryVersions}=await import('/fixture/install-media-upload-closure.mjs');
const key='community-reports/synthetic-new/a/probe.txt',request=(method,objectKey='',query={})=>signedClosureRequest({credential:m.current,bucket:m.bucket,objectKey,method,query,endpoint:m.endpoint});
const inventory=async()=>{const response=await request('GET','',{versions:'',prefix:key,'max-keys':'100'});if(response.status!==200)throw Error('ACTUAL_VERSIONS_QUERY_FAILED');const xml=await response.text();return exactCanaryVersions(xml,key);};
const before=await inventory();if(before.length!==1||before[0].versionId!=='null')throw Error('ACTUAL_UNVERSIONED_NULL_VERSION_MISSING');
const deleted=await request('DELETE',key,{versionId:'null'});if(!deleted.ok)throw Error('ACTUAL_NULL_VERSION_DELETE_FAILED');await deleted.body?.cancel();
const after=await inventory();if(after.length!==0)throw Error('ACTUAL_VERSION_REMAINS');const head=await request('HEAD',key);if(head.status!==404)throw Error('ACTUAL_CANARY_HEAD_NOT_ABSENT');await head.body?.cancel();
console.log(JSON.stringify({actualSignerExport:true,listObjectVersionsHttp:200,beforeNullVersionCount:before.length,nullVersionDeleteHttp:deleted.status,afterVersionCount:after.length,headAfterDeleteHttp:head.status}));""")
 result={'contractVersion':'cop-old-api-media-pause-regression-v1','passed':True,'testedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'oldApiImageId':OLD,'providerImageId':after_provider['Image'],'providerPinnedReference':S3,'providerVersion':provider_version,
  'sameApiContainer':True,'sameApiHostPid':True,'sameApiStartedAt':True,'apiProcessPid':1,'actualBuildServer':True,'actualMediaInit':True,'actualDockerPauseUnpause':True,
  'actualProviderStoppedPidZero':True,'sameProviderContainerAndImage':True,'onlyCopCredentialRotated':rotation['onlyCopCredential'],
  'beforeHealth':before_health,'afterHealth':after_health,'oldRamWriteBeforeHttp':ram_before['status'],'oldRamWriteAfterHttp':ram_after['status'],
  **provider,'versionCanaryCleanup':versions,'operatorHelperSha256':hashlib.sha256(modules['install-media-upload-closure.mjs'].encode()).hexdigest(),'publishedPorts':False,'productionChanged':False,'wholeFixturesChanged':False,'fixtureOwner':OWNER}
 result['evidenceDigest']=hashlib.sha256(json.dumps(result,separators=(',',':')).encode()).hexdigest()
except Exception as error:
 code=str(error) if re.fullmatch('[A-Z][A-Z0-9_]{1,200}',str(error)) else 'OWNED_OLD_API_PAUSE_PROBE_FAILED'
 result={'contractVersion':'cop-old-api-media-pause-regression-v1' ,'code':code,'phase':phase,'productionChanged':False,'wholeFixturesChanged':False,'passed':False}
finally:
 for name in reversed(containers):
  actual=inspect(name);assert actual['Config']['Labels']['cop.test.owner']==OWNER
  if actual['State'].get('Paused'):run('docker','unpause',name)
  run('docker','rm','-f',name)
 for volume in reversed(volumes):
  actual=json.loads(run('docker','volume','inspect',volume))[0];assert actual['Labels']['cop.test.owner']==OWNER
  run('docker','volume','rm',volume)
 if result is not None:result['ownedFixturesCleaned']=True;print(json.dumps(result))
if not result or result.get('passed') is False:sys.exit(1)
'''
SSH=['ssh','-4','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8','-o','HostName=192.168.10.116','-o','HostKeyAlias=docker.home.cz','docker.home.cz']
root=pathlib.Path(__file__).resolve().parent
modules={name:(root/name).read_text() for name in ['install-media-upload-closure.mjs','install-production-erasure.mjs','provision-database-v2.mjs']}
execution=subprocess.run(SSH+['python3 -c '+shlex.quote(REMOTE)],input=json.dumps(modules),capture_output=True,text=True,timeout=240)
if execution.stdout:print(execution.stdout.strip())
if execution.returncode:raise SystemExit(execution.returncode)
