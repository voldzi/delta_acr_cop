#!/usr/bin/env python3
"""Actual Edge server in the owned joint namespace; no production mounts/ports.
Carries exact compiled sources in private tmpfs and keeps its own data volume.
"""
import hashlib,json,pathlib,re,secrets,subprocess,sys,time
HERE=pathlib.Path(__file__).resolve().parent
assert len(sys.argv)==3
HOLDER,OWNER=sys.argv[1:]
assert re.fullmatch('[a-f0-9]{64}',HOLDER) and re.fullmatch('cop-messaging-joint-[a-f0-9]{12}',OWNER)
IMAGE='sha256:a06c103764701e7debc6434e3dd98e9a6d5f218d30831cb62aad566265db392f'
NAME='cop-edge-whole-'+secrets.token_hex(6);DATA=NAME+'-data';META=NAME+'-private'
def command(*args,input=None):
    result=subprocess.run(args,input=input,text=True,capture_output=True)
    if result.returncode:raise RuntimeError('owned_edge_fixture_command_failed')
    return result.stdout.strip()
def inspect(value):return json.loads(command('docker','inspect',value))[0]
def put(path,value):command('docker','exec','-i',NAME,'/bin/sh','-c','umask 077; cat > '+path,input=value)
holder=inspect(HOLDER)
assert holder['State']['Running'] and holder['Config']['Labels']['cop.test.owner']==OWNER
hashes={'edge-index.js':'d1c8549d13e0624094bc7c8658f185797d0c517cdeb912d40aafd7e431eae838',
 'edge-account-erasure.js':'4b568dc22e70a8674aae491daf1e0e548fc8455962c0b3b344446a13ac0668ac',
 'service-token.js':'1c55c7f54344d3aad7c7e8d1acd72eb8a009a1d8bf217b39cec0d253dc3e05a0',
 'core-package.json':'005d150caf4331c60282b9e729a3c5bfd806e70b20912f1e36e4d0073d1a5b14'}
for filename,digest in hashes.items():assert hashlib.sha256((HERE/filename).read_bytes()).hexdigest()==digest
command('docker','image','inspect',IMAGE)
for volume in [DATA,META]:command('docker','volume','create','--label','cop.test.owner='+OWNER,'--label','cop.test.component=edge',volume)
try:
 command('docker','run','-d','--log-driver','none','--name',NAME,'--network','container:'+HOLDER,'--label','cop.test.owner='+OWNER,'--label','cop.test.component=edge',
  '--memory=256m','--cpus=1','--pids-limit','128','--cap-drop','ALL','--security-opt','no-new-privileges','--read-only',
  '--mount','type=volume,source='+META+',target=/fixture','--mount','type=volume,source='+DATA+',target=/data/edge',
  '--tmpfs','/probe:rw,nosuid,nodev,noexec,size=8m','--entrypoint','node',IMAGE,'-e','setInterval(()=>{},1000)')
 command('docker','exec',NAME,'mkdir','-p','/probe/edge','/probe/node_modules/@cop/core/dist')
 put('/probe/package.json','{"type":"module"}')
 for filename,target in [('edge-index.js','/probe/edge/index.js'),('edge-account-erasure.js','/probe/edge/account-erasure.js'),
   ('service-token.js','/probe/node_modules/@cop/core/dist/service-token.js'),('core-package.json','/probe/node_modules/@cop/core/package.json')]:put(target,(HERE/filename).read_text())
 manifest={'contractVersion':'cop-edge-whole-fixture-v1','container':NAME,'metadataVolume':META,'dataVolume':DATA,
  'endpoint':'http://127.0.0.1:4313','nodeId':'synthetic-edge-whole','adminToken':'synthetic-edge-'+secrets.token_hex(32),
  'holderId':HOLDER,'fixtureOwner':OWNER,'sourceHashes':hashes,'productionChanged':False}
 put('/fixture/cop-edge.json',json.dumps(manifest))
 put('/probe/boot.mjs',"""import {readFileSync,writeFileSync} from 'node:fs';
import {readEdgeConfig,startEdgeServer} from './edge/index.js';
const m=JSON.parse(readFileSync('/fixture/cop-edge.json','utf8'));
writeFileSync('/fixture/edge-process.pid',String(process.pid),{mode:0o600});
await startEdgeServer(readEdgeConfig({COP_EDGE_DATA_DIR:'/data/edge',COP_EDGE_HOST:'127.0.0.1',COP_EDGE_PORT:'4313',COP_EDGE_NODE_ID:m.nodeId,
COP_EDGE_ADMIN_TOKEN:m.adminToken,COP_EDGE_AUTO_SYNC:'false',COP_EDGE_CENTRAL_API_URL:'http://127.0.0.1:4310',COP_EDGE_CENTRAL_TOKEN:'synthetic-not-enabled'}));
""")
 command('docker','exec','-d',NAME,'node','/probe/boot.mjs')
 probe="""const m=JSON.parse(require('fs').readFileSync('/fixture/cop-edge.json','utf8'));fetch(m.endpoint+'/edge/internal/account-erasure/capabilities',{headers:{authorization:'Bearer '+m.adminToken}}).then(async r=>{const v=await r.json();if(r.status!==200||v.nodeId!==m.nodeId||v.writerFenceInstalled!==true||v.stateReadbackVerified!==true)process.exit(2);console.log(JSON.stringify(v));}).catch(()=>process.exit(3));"""
 for attempt in range(40):
  result=subprocess.run(['docker','exec',NAME,'node','-e',probe],capture_output=True,text=True)
  if result.returncode==0:break
  time.sleep(.1)
 else:raise RuntimeError('actual_edge_capability_failed')
 print(json.dumps({'contractVersion':'cop-edge-whole-fixture-ready-v1','container':NAME,'metadataVolume':META,'dataVolume':DATA,
  'privateManifest':'/fixture/cop-edge.json','endpoint':manifest['endpoint'],'nodeId':manifest['nodeId'],'holderId':HOLDER,
  'fixtureOwner':OWNER,'actualCapabilities':json.loads(result.stdout),'sourceHashes':hashes,'publishedPorts':False,
  'productionChanged':False,'leftRunning':True,'seededCopies':0}))
except:
 subprocess.run(['docker','rm','-f',NAME],capture_output=True)
 for volume in [DATA,META]:subprocess.run(['docker','volume','rm',volume],capture_output=True)
 raise
