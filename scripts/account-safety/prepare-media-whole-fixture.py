#!/usr/bin/env python3
"""Prepare only labelled synthetic S3 in an already-owned joint namespace.
Keeps the fixture until the coordinator explicitly removes its exact resources.
No ports, production mounts, real credentials, or application server starts.
"""
import hashlib,json,pathlib,re,secrets,subprocess,sys,time

HERE=pathlib.Path(__file__).resolve().parent
assert len(sys.argv)==3
HOLDER,OWNER=sys.argv[1:]
assert re.fullmatch('[a-f0-9]{64}',HOLDER) and re.fullmatch('cop-messaging-joint-[a-f0-9]{12}',OWNER)
IMAGE='chrislusf/seaweedfs@sha256:fc9f76fa993ad69966ffeb2f65d0318fcae39c6f8e20cf68ef7b3a5cb97769e5'
NODE='sha256:a06c103764701e7debc6434e3dd98e9a6d5f218d30831cb62aad566265db392f'
NAME='cop-media-whole-'+secrets.token_hex(6)
DATA=NAME+'-data'; META=NAME+'-private'; HELPER=NAME+'-probe'
def command(*args,input=None):
    result=subprocess.run(args,input=input,text=True,capture_output=True)
    if result.returncode:
        private=HERE/'fixture-private-error.log';private.write_text(result.stderr);private.chmod(0o600)
        raise RuntimeError('fixture_command_failed_private_details_'+str(private))
    return result.stdout.strip()
def inspect(name):return json.loads(command('docker','inspect',name))[0]
def put(path,value):command('docker','exec','-i',HELPER,'/bin/sh','-c','umask 077; cat > '+path,input=value)
def phase(value):return json.loads(command('docker','exec',HELPER,'node','/probe/media-whole-probe.mjs',value))
holder=inspect(HOLDER)
assert holder['State']['Running'] and holder['Config']['Labels']['cop.test.owner']==OWNER
for filename,digest in [('media-storage.js','655270a96fc98c1fed76d8efc782b6be4000aee847f95dc8cc2177dbf996fd30'),('bounded-upstream.js','1d4b36f1cd25993c2128dfd75d985648ca8cf399f7d0781ca663e38cc7ef871b')]:
    assert hashlib.sha256((HERE/filename).read_bytes()).hexdigest()==digest
command('docker','image','inspect',NODE)
command('docker','pull',IMAGE)
provider_uid=command('docker','run','--rm','--entrypoint','/bin/sh',IMAGE,'-c','id -u seaweed')
provider_gid=command('docker','run','--rm','--entrypoint','/bin/sh',IMAGE,'-c','id -g seaweed')
assert provider_uid.isdigit() and provider_gid.isdigit()
for volume in [DATA,META]:command('docker','volume','create','--label','cop.test.owner='+OWNER,'--label','cop.test.component=media',volume)
command('docker','run','-d','--log-driver','none','--name',HELPER,'--network','container:'+HOLDER,'--label','cop.test.owner='+OWNER,'--label','cop.test.component=media',
 '--mount','type=volume,source='+META+',target=/fixture','--tmpfs','/probe:rw,noexec,nosuid,size=8m','--entrypoint','/bin/sh',NODE,'-c','while :; do sleep 3600; done')
try:
    put('/probe/package.json','{"type":"module"}')
    for filename in ['media-storage.js','bounded-upstream.js','media-whole-probe.mjs']:put('/probe/'+filename,(HERE/filename).read_text())
    credential=lambda name:{'accessKeyId':'synthetic-'+name+'-'+secrets.token_hex(8),'secretAccessKey':secrets.token_hex(32)}
    manifest={'contractVersion':'cop-media-whole-fixture-v1','endpoint':'http://127.0.0.1:8333','bucket':'cop-community-media',
      'legacy':credential('old'),'current':credential('new'),'other':credential('other'),'holderId':HOLDER,
      'mediaContainer':NAME,'probeContainer':HELPER,'metadataVolume':META,'dataVolume':DATA,'providerEvidence':{}}
    identities=[]
    for name,key in [('cop-production','legacy'),('other-application','other')]:
        value=manifest[key];identities.append({'name':name,'credentials':[{'accessKey':value['accessKeyId'],'secretKey':value['secretAccessKey']}],'actions':['Admin','Read','Write']})
    put('/fixture/cop-media.json',json.dumps(manifest));put('/fixture/s3.json',json.dumps({'identities':identities}))
    command('docker','exec',HELPER,'chown',provider_uid+':'+provider_gid,'/fixture/s3.json')
    command('docker','run','-d','--log-driver','none','--name',NAME,'--network','container:'+HOLDER,'--label','cop.test.owner='+OWNER,'--label','cop.test.component=media',
      '--memory=512m','--cpus=1','--mount','type=volume,source='+META+',target=/fixture,readonly',
      '--mount','type=volume,source='+DATA+',target=/data',IMAGE,'server','-dir=/data','-ip=127.0.0.1','-ip.bind=0.0.0.0','-s3','-s3.port=8333',
      '-s3.config=/fixture/s3.json','-master.telemetry=false','-master.volumeSizeLimitMB=16','-volume.max=16','-volume.port=8081','-volume.preStopSeconds=0')
    phase('seed')
    slow=subprocess.Popen(['docker','exec',HELPER,'node','/probe/media-whole-probe.mjs','slow'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    for attempt in range(60):
        if subprocess.run(['docker','exec',HELPER,'test','-f','/fixture/admitted.json'],capture_output=True).returncode==0:break
        time.sleep(.1)
    else:raise RuntimeError('partial_upload_not_admitted')
    before=inspect(NAME);command('docker','stop','-t','3',NAME);stopped=inspect(NAME)
    assert not stopped['State']['Running'] and stopped['State']['Pid']==0
    slow.communicate(timeout=10);assert slow.returncode==0
    phase('rotate');command('docker','start',NAME);after=inspect(NAME)
    assert after['Id']==before['Id'] and after['Image']==before['Image'] and after['State']['StartedAt']!=before['State']['StartedAt']
    manifest=json.loads(command('docker','exec',HELPER,'cat','/fixture/cop-media.json'))
    manifest['providerEvidence']={'providerImageId':after['Image'],'providerDigest':IMAGE.split('@')[1],
      'providerStoppedAt':stopped['State']['FinishedAt'],'providerRestartedAt':after['State']['StartedAt'],
      'holderId':HOLDER,'fixtureOwner':OWNER,'productionChanged':False,'finalMetadataFaultInjection':False}
    put('/fixture/cop-media.json',json.dumps(manifest));result=phase('verify')
    print(json.dumps({'contractVersion':'cop-media-whole-fixture-ready-v1','holderId':HOLDER,'fixtureOwner':OWNER,
      'mediaContainer':NAME,'probeContainer':HELPER,'metadataVolume':META,'dataVolume':DATA,'privateManifest':'/fixture/cop-media.json',
      'endpoint':'http://127.0.0.1:8333','evidenceDigest':result['evidenceDigest'],'publishedPorts':False,'productionChanged':False,'leftRunning':True}))
except:
    failure=HERE/'fixture-private-provider.log'
    failure.write_text(subprocess.run(['docker','logs','--tail','60',NAME],capture_output=True,text=True).stderr);failure.chmod(0o600)
    for name in [NAME,HELPER]:subprocess.run(['docker','rm','-f',name],capture_output=True)
    for volume in [DATA,META]:subprocess.run(['docker','volume','rm',volume],capture_output=True)
    raise
