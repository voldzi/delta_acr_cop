#!/usr/bin/python3
"""Finite fresh configuration-only case for the already-created controller.
Never creates/adopts an identity, enables admission, changes an image or retries.
Root-only private before snapshot is retained on COMM, never returned or copied.
"""
import argparse,copy,fcntl,hashlib,json,os,re,runpy,socket,time
from pathlib import Path
BASE_CID='d75a44cd259ececd4627fd8a06cf9cfdf3a2e96ce237dd461798d4e6bf95c811'
IMAGE='sha256:9a69b3f3b318732cfc175207df344c2bb724bbcd488db3383ac14d790e045c05'
PIN_SHA='4862272bf384dd5ca290ec3f837fecb94600548c300021e345afe9d931ed10a7'
SOURCE='19c9b39669877dfeacbe1bd996e9c8da7c4cd1ec'
UTILITY_SHA='f476afad20da3c877bcd1a5d8a98ba0a54c12659830a41f8d51e989492bffbc3'

def canonical_runtime(v,envmap):
 x=copy.deepcopy({'image':v['Image'],'config':v['Config'],'host':v['HostConfig'],'mounts':v['Mounts'],'networks':{k:n['NetworkID'] for k,n in v['NetworkSettings']['Networks'].items()}})
 x['config']['Env']=envmap(x['config']['Env'])
 if x['config'].get('Hostname')==v['Id'][:12]:x['config']['Hostname']='<docker-auto-hostname>'
 x['config']['Labels'].pop('com.docker.compose.config-hash',None)
 # Sorting retains every full bind string / structured option, not only paths.
 if isinstance(x['host'].get('Binds'),list):x['host']['Binds']=sorted(x['host']['Binds'])
 if isinstance(x['host'].get('Mounts'),list):x['host']['Mounts']=sorted(x['host']['Mounts'],key=lambda m:m['Target'])
 x['mounts']=sorted(x['mounts'],key=lambda m:m['Destination'])
 for collection,key in ((x['mounts'],'Destination'),(x['host'].get('Mounts') or [],'Target')):
  if len({m[key] for m in collection})!=len(collection):raise ValueError('AMBIGUOUS_MOUNT_TARGET')
 return x

def main():
 args=argparse.ArgumentParser();args.add_argument('--apply',action='store_true');a=args.parse_args()
 assert os.geteuid()==0 and socket.gethostname().split('.')[0]=='comm','ROOT_COMM_REQUIRED'
 p=Path('/srv/csm-messaging/account-safety/controller-only-executor-v1.py');assert hashlib.sha256(p.read_bytes()).hexdigest()==UTILITY_SHA
 n=runpy.run_path(str(p),run_name='config_only_utilities');o=n['Live']();need=n['need'];sha=n['sha'];enc=n['encoded'];pin=n['PIN'];case=pin.parent/'owned-controller-config-19c9b39-v1';o.journal.__func__.__globals__['CASE']=case
 fd=os.open('/run/cop-messaging-owned-release.lock',os.O_WRONLY|os.O_NOFOLLOW);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
 try:
  need(not case.exists(),'NEW_CONFIG_CASE_ALREADY_STARTED')
  created=json.loads(o.read(pin.parent/'controller-only-v1/created.json'));custody=json.loads(o.read(pin.parent/'controller-only-v1/custody.json'))
  need(created=={'created':True,'controller':n['CONTROLLER']} and custody.get('postLogoutReadback') is True and custody.get('dynamic')=={'identityProven':True,'logoutProven':True,'ttlBounded':True},'ORIGINAL_CONTROLLER_OWNERSHIP_UNPROVEN')
  before=o.inspect();need(before['Id']==BASE_CID and before['Image']==IMAGE and before['RestartCount']==0 and before['State']['Running'] and before['State'].get('Health',{}).get('Status')=='healthy','CURRENT_RUNTIME_CHANGED')
  env=n['envmap'](before['Config']['Env']);need(env.get(n['ADMISSION'],'false')=='false' and not env.get('CSM_VEHICLE_CONTROLLER_MATRIX_USER_ID') and env.get('CSM_VEHICLE_CONTROLLER_CUSTODY_REVIEWED','false')=='false','CURRENT_FLAGS_CHANGED')
  inputs=o.inputs();expectedinputs=dict(n['BASELINE']['inputSha256']);expectedinputs[str(pin)]=PIN_SHA;need(inputs==expectedinputs and o.peers()==n['BASELINE']['peers'],'CURRENT_INPUTS_CHANGED')
  n['assert_custody'](o.provider('custody'))
  raw=o.read(pin);value=json.loads(raw);need(sha(raw)==PIN_SHA and value['services']['api']['image']==IMAGE,'CURRENT_PIN_CHANGED')
  target=copy.deepcopy(value);targetenv=target['services']['api'].setdefault('environment',{});need(all(k not in targetenv for k in n['DELTA']),'PIN_CONTROLLER_ALREADY_CONFIGURED');targetenv.update(n['DELTA']);targetraw=enc(target)+b'\n'
  render=o.render();expectedrender=copy.deepcopy(render);expectedrender['services']['api']['environment'].update(n['DELTA'])
  baseline=canonical_runtime(before,n['envmap']);need(baseline['config']['Labels'].get('org.opencontainers.image.revision')==SOURCE,'CURRENT_SOURCE_CHANGED')
  if not a.apply:
   print(json.dumps({'configurationPreflight':True,'imageUnchanged':IMAGE,'currentContainer':BASE_CID,'controllerAlreadyOwned':True,'controllerCreated':False,'admissionEnabled':False,'productionChanged':False,'targetPinSha256':sha(targetraw),'rawSnapshotToBeStoredOnlyUnderRootCase':str(case)}));return
  case.mkdir(mode=0o700);n['sync_dir'](case.parent)
  o.journal('started.json',{'source':SOURCE,'image':IMAGE,'beforeContainer':BASE_CID,'beforeCanonicalDigest':sha(enc(baseline)),'beforeInputHashes':inputs,'controllerAlreadyOwned':True,'controllerCreated':False,'admissionEnabled':False,'automaticRetry':False,'automaticRollback':False})
  # Retain the WHOLE fresh original before-state, including all host/mount options,
  # only on the production server under Root400. Never print it or export to Git.
  for name,data in [('raw-before.json',enc(before)),('original-pin.json',raw)]:
   out=os.open(case/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
   try:n['write_all'](out,data);os.fsync(out)
   finally:os.close(out)
  n['sync_dir'](case)
  dynamic=o.provider('probe');need(dynamic=={'identityProven':True,'logoutProven':True,'ttlBounded':True},'CONTROLLER_PROBE_FAILED');n['assert_custody'](o.provider('custody'))
  need(o.inspect()['Id']==BASE_CID and canonical_runtime(o.inspect(),n['envmap'])==baseline and o.inputs()==inputs,'PRECONFIG_CAS_CHANGED')
  o.publish_pin(targetraw);need(o.render()==expectedrender,'CONFIG_EXCEEDS_TWO_KEYS');o.restart();until=time.monotonic()+120
  while True:
   after=o.inspect();need(after['Image']==IMAGE and after['RestartCount']==0 and after['State']['Running'],'TARGET_START_FAILED')
   if after['State'].get('Health',{}).get('Status')=='healthy':break
   need(time.monotonic()<until,'TARGET_HEALTH_TIMEOUT');time.sleep(1)
  expected=copy.deepcopy(baseline);expected['config']['Env'].update(n['DELTA']);actual=canonical_runtime(after,n['envmap']);need(actual==expected,'TARGET_FULL_SEMANTIC_PARITY_FAILED')
  targetinputs=dict(inputs);targetinputs[str(pin)]=sha(targetraw);need(o.inputs()==targetinputs and o.peers()==n['BASELINE']['peers'],'TARGET_INPUT_PARITY_FAILED');n['assert_custody'](o.provider('custody'))
  time.sleep(10);stable=o.inspect();need(stable['Id']==after['Id'] and stable['State']['Pid']==after['State']['Pid'] and stable['State']['StartedAt']==after['State']['StartedAt'] and stable['RestartCount']==0 and stable['State'].get('Health',{}).get('Status')=='healthy','TARGET_NOT_STABLE')
  result={'controllerConfigured':True,'controllerCreated':False,'controllerCustodyVerified':True,'admissionEnabled':False,'imageUnchanged':IMAGE,'container':after['Id'],'zeroRestarts':True,'fullCurrentTransitionSemanticParity':True,'historicalImageOnlyRawParity':False,'freshPrivateBeforeSnapshotRetained':True,'pairedAcceptanceComplete':False,'automaticRetry':False,'automaticRollback':False}
  o.journal('receipt.json',result);print(json.dumps(result))
 finally:os.close(fd)
if __name__=='__main__':
 try:main()
 except Exception as e:
  print(json.dumps({'configurationComplete':False,'code':str(e) if re.fullmatch('[A-Z0-9_]{1,80}',str(e)) else type(e).__name__,'automaticRetry':False,'automaticRollback':False}));raise SystemExit(1)
