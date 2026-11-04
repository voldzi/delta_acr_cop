"""Future finite COMM adapter. Not installed/authorized/executed.
Exactly one admission flag; same image/controller/keys/topology. Close reduces
intake even when the accepted open process has restarted or is unhealthy.
"""
import copy,fcntl,hashlib,ipaddress,json,os,socket,stat,time,types
from pathlib import Path
IMAGE='sha256:9a69b3f3b318732cfc175207df344c2bb724bbcd488db3383ac14d790e045c05'
BASE_CID='df775c70de0716b556ef0299716cc450584581a4021ca9189bdde7df6c1cc4e6'
BASE_PIN='23927e64f99bd09782c415b61e8d82dcfa8d36109b1e1a0b1b2034ee0120f8a8'
FLAG='CSM_SHARED_VEHICLE_COMMUNICATION_ADMISSION_ENABLED'
UTILITY='/srv/csm-messaging/account-safety/controller-only-executor-v1.py'
UTILITY_SHA='f476afad20da3c877bcd1a5d8a98ba0a54c12659830a41f8d51e989492bffbc3'
CANONICAL='/srv/csm-messaging/account-safety/owned-controller-config-501035c5b028.py'
CANONICAL_SHA='501035c5b028637091b1c68930928188c663b1035bf20d5cf0820cb77fa59bea'
def need(v,code):
 if not v:raise RuntimeError(code)
def load(path,digest):
 p=Path(path);fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o400 and s.st_nlink==1 and s.st_size<100000,'WINDOW_COMM_ASSET_CUSTODY');raw=os.read(fd,100000);t=os.fstat(fd);need(len(raw)==s.st_size and (s.st_ino,s.st_mtime_ns,s.st_ctime_ns)==(t.st_ino,t.st_mtime_ns,t.st_ctime_ns) and hashlib.sha256(raw).hexdigest()==digest,'WINDOW_COMM_ASSET_CHANGED')
 finally:os.close(fd)
 m=types.ModuleType('window_comm_utility');m.__file__=str(p);exec(compile(raw,str(p),'exec'),m.__dict__);return m

def pin_delta(raw,stage):
 v=json.loads(raw);need(v['services']['api']['image']==IMAGE and stage in ('open','close'),'WINDOW_COMM_PIN_SCOPE');value=copy.deepcopy(v);e=value['services']['api'].setdefault('environment',{});need(e.get('CSM_VEHICLE_CONTROLLER_MATRIX_USER_ID')=='@csm.vehicle.controller.v1:docker.home.cz' and e.get('CSM_VEHICLE_CONTROLLER_CUSTODY_REVIEWED')=='true','WINDOW_COMM_CONTROLLER_REQUIRED')
 if stage=='open':need(FLAG not in e or e[FLAG]=='false','WINDOW_COMM_ALREADY_OPEN')
 else:need(e.get(FLAG)=='true','WINDOW_COMM_CLOSE_SOURCE')
 e[FLAG]='true' if stage=='open' else 'false';return json.dumps(value,sort_keys=True,separators=(',',':')).encode()+b'\n'
def close_source_kind(runtime_flag,actual_digest,original_digest,target_digest,pin_digest,original_pin,target_pin):
 if runtime_flag=='false' and actual_digest==original_digest:
  if pin_digest==original_pin:return 'no_open_observed'
  if pin_digest==target_pin:return 'pin_only'
 if runtime_flag=='true' and actual_digest==target_digest and pin_digest==target_pin:return 'recreate_off'
 raise RuntimeError('WINDOW_COMM_CLOSE_RUNTIME_DRIFT')

def readiness(o,inspected):
 address=inspected['NetworkSettings']['Networks']['csm-messaging_default']['IPAddress'];ip=ipaddress.ip_address(address);need(ip.version==4 and ip.is_private,'WINDOW_COMM_HEALTH_ORIGIN')
 code="import json,sys,urllib.request,urllib.error;p=json.load(sys.stdin);r=urllib.request.urlopen('http://'+p['ip']+':4050/health/ready',timeout=15);b=json.load(r);print(json.dumps({'ok':r.status==200 and b.get('status')=='ok' and all(x.get('status')=='ok' for x in b.get('checks',[])),'checkedCount':len(b.get('checks',[]))}))"
 try:
  v=json.loads(o.docker('exec','-i','csm-matrix-synapse','python3','-c',code,body=json.dumps({'ip':address}).encode()))
  need(set(v)=={'ok','checkedCount'} and type(v['ok']) is bool and type(v['checkedCount']) is int and 0<v['checkedCount']<=256,'WINDOW_COMM_HEALTH_RECEIPT');return v
 except Exception:return {'ok':False,'checkedCount':0}

def expected_runtime(before,stage,canonical,envmap):
 value=canonical(before,envmap);value['config']['Env'][FLAG]='true' if stage=='open' else 'false';return value

def execute(approval,contract,stage):
 need(os.geteuid()==0 and socket.gethostname().split('.')[0]=='comm' and approval['host']=='comm' and stage in ('open','close'),'WINDOW_COMM_ROOT_SCOPE')
 window=contract.validate_window(approval['window'],int(time.time()),opening=stage=='open');need(window['windowId']==approval['windowId'] and window['approvedManifestSha256']==approval['approvedManifestSha256'],'WINDOW_COMM_APPROVAL_BINDING')
 n=load(UTILITY,UTILITY_SHA);canon=load(CANONICAL,CANONICAL_SHA).canonical_runtime;o=n.Live();pin=n.PIN;case=pin.parent/('vehicle-admission-'+window['windowId']);phase=case/stage;phase_claimed=False;pin_only=False
 lock=os.open('/run/cop-messaging-owned-release.lock',os.O_WRONLY|os.O_NOFOLLOW);fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 try:
  before=o.inspect();raw=o.read(pin);env=n.envmap(before['Config']['Env']);need(before['Image']==IMAGE and env.get('CSM_VEHICLE_CONTROLLER_MATRIX_USER_ID')==n.CONTROLLER and env.get('CSM_VEHICLE_CONTROLLER_CUSTODY_REVIEWED')=='true','WINDOW_COMM_CURRENT_IDENTITY')
  original_inputs=dict(n.BASELINE['inputSha256']);original_inputs[str(pin)]=BASE_PIN
  if stage=='close' and not case.exists():
   need(o.inputs()==original_inputs and env.get(FLAG,'false')=='false','WINDOW_COMM_NO_OPEN_NOT_PROVEN');return {'admissionOff':True,'configurationChanged':False,'openNeverAttempted':True}
  if stage=='open':
   need(not case.exists() and not case.is_symlink() and before['Id']==BASE_CID and before['RestartCount']==0 and before['State']['Running'] and before['State'].get('Health',{}).get('Status')=='healthy','WINDOW_COMM_OPEN_BASELINE')
   need(o.inputs()==original_inputs and o.peers()==n.BASELINE['peers'] and n.sha(n.encoded(canon(before,n.envmap)))==approval['baselineCanonicalDigest'],'WINDOW_COMM_INPUTS_CHANGED');need(readiness(o,before)['ok'],'WINDOW_COMM_SOURCE_READINESS');n.assert_custody(o.provider('custody'));case.mkdir(mode=0o700);n.sync_dir(case.parent)
  else:
   need(case.is_dir() and not case.is_symlink() and case.stat().st_uid==0 and stat.S_IMODE(case.stat().st_mode)==0o700,'WINDOW_COMM_CASE_CUSTODY')
   if not (case/'open'/'started.json').exists():
    need(o.inputs()==original_inputs and env.get(FLAG,'false')=='false','WINDOW_COMM_UNSTARTED_OPEN_DRIFT');return {'admissionOff':True,'configurationChanged':False,'openNeverMutated':True}
   opened=json.loads(o.read(case/'open'/'started.json'));need(opened['windowId']==window['windowId'] and opened['approvedManifestSha256']==approval['approvedManifestSha256'],'WINDOW_COMM_OWN_OPEN_REQUIRED')
   current_digest=n.sha(n.encoded(canon(before,n.envmap)))
   if (case/'close'/'started.json').is_file():
    prior=json.loads(o.read(case/'close'/'started.json'))
    if env.get(FLAG,'false')=='false' and n.sha(raw)==prior['targetPinSha256'] and (current_digest==prior['expectedTargetCanonicalDigest'] or (prior.get('recreationRequired') is False and current_digest==prior['sourceCanonicalDigest'])):
     return {'admissionOff':True,'configurationChanged':False,'priorCloseReceiptPresent':(case/'close'/'receipt.json').is_file(),'newHealthyAcceptanceClaimed':False}
   kind=close_source_kind(env.get(FLAG,'false'),current_digest,opened['sourceCanonicalDigest'],opened['expectedTargetCanonicalDigest'],n.sha(raw),opened['sourceInputs'][str(pin)],opened['targetPinSha256'])
   expected_inputs=dict(opened['sourceInputs']);expected_inputs[str(pin)]=n.sha(raw);need(o.inputs()==expected_inputs and o.peers()==opened['sourcePeers'],'WINDOW_COMM_CLOSE_INPUT_DRIFT')
   if kind=='no_open_observed':return {'admissionOff':True,'configurationChanged':False,'openFailureRetained':True,'newHealthyAcceptanceClaimed':False}
   pin_only=kind=='pin_only'
  need(not phase.exists() and not phase.is_symlink(),'WINDOW_COMM_STAGE_CONSUMED');phase.mkdir(mode=0o700);phase_claimed=True;o.journal.__func__.__globals__['CASE']=phase
  targetraw=pin_delta(raw,stage);render=o.render();targetrender=copy.deepcopy(render);targetrender['services']['api']['environment'][FLAG]='true' if stage=='open' else 'false';inputs=o.inputs();peers=o.peers();canonical=canon(before,n.envmap)
  def private(name,data):
   fd=os.open(phase/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
   try:n.write_all(fd,data);os.fsync(fd)
   finally:os.close(fd)
  o.journal('started.json',{'windowId':window['windowId'],'approvedManifestSha256':approval['approvedManifestSha256'],'stage':stage,'recreationRequired':not pin_only,'sourceContainer':before['Id'],'sourceInputs':inputs,'sourcePeers':peers,'sourceProcess':{'pid':before['State']['Pid'],'startedAt':before['State']['StartedAt'],'restarts':before['RestartCount']},'sourceCanonicalDigest':n.sha(n.encoded(canonical)),'expectedTargetCanonicalDigest':n.sha(n.encoded(expected_runtime(before,stage,canon,n.envmap))),'targetPinSha256':n.sha(targetraw),'automaticRetry':False,'automaticRollback':False})
  private('raw-before.json',n.encoded(before));private('original-pin.json',raw);n.sync_dir(phase)
  fresh=o.inspect();need(fresh['Id']==before['Id'] and fresh['State']['Pid']==before['State']['Pid'] and fresh['State']['StartedAt']==before['State']['StartedAt'] and fresh['RestartCount']==before['RestartCount'] and canon(fresh,n.envmap)==canonical and o.inputs()==inputs and o.peers()==peers,'WINDOW_COMM_PREWRITE_CAS')
  if stage=='open':need(fresh['RestartCount']==0 and fresh['State']['Running'] and fresh['State'].get('Health',{}).get('Status')=='healthy' and int(time.time())<window['openBefore'],'WINDOW_COMM_OPEN_NOT_FRESH')
  o.publish_pin(targetraw);need(o.render()==targetrender,'WINDOW_COMM_EXCEEDS_ONE_FLAG')
  if pin_only:
   unchanged=o.inspect();need(unchanged['Id']==before['Id'] and canon(unchanged,n.envmap)==canonical and n.envmap(unchanged['Config']['Env']).get(FLAG,'false')=='false','WINDOW_COMM_PIN_ONLY_RUNTIME_CHANGED')
   result={'windowId':window['windowId'],'stage':'close','admissionOff':True,'persistentFlagOff':True,'configurationChanged':True,'recreationPerformed':False,'openFailureRetained':True,'newHealthyAcceptanceClaimed':False};o.journal('receipt.json',result);return result
  o.restart();until=time.monotonic()+120
  while True:
   after=o.inspect();need(after['Image']==IMAGE and after['RestartCount']==0 and after['State']['Running'],'WINDOW_COMM_TARGET_START_FAILED')
   if after['State'].get('Health',{}).get('Status')=='healthy':break
   need(time.monotonic()<until,'WINDOW_COMM_TARGET_HEALTH_TIMEOUT');time.sleep(1)
  private('raw-after.json',n.encoded(after));n.sync_dir(phase);need(canon(after,n.envmap)==expected_runtime(before,stage,canon,n.envmap),'WINDOW_COMM_TARGET_SEMANTIC_PARITY');expected_inputs=dict(inputs);expected_inputs[str(pin)]=n.sha(targetraw);need(o.inputs()==expected_inputs and o.peers()==peers,'WINDOW_COMM_TARGET_INPUTS_CHANGED')
  ready=readiness(o,after)
  if stage=='open':need(ready['ok'],'WINDOW_COMM_TARGET_READINESS')
  result={'windowId':window['windowId'],'readiness':ready,'stage':stage,'container':after['Id'],'imageUnchanged':IMAGE,'zeroRestarts':True,'fullCurrentTransitionParity':True,'admissionOff':stage=='close','controllerIdentityOrKeysChanged':False,'rawBeforeAfterRoot400':True,'automaticRetry':False,'automaticRollback':False};o.journal('receipt.json',result);return result
 except Exception:
  if phase_claimed and phase.is_dir() and (phase/'started.json').is_file():
   try:o.journal('failure.json',{'code':'WINDOW_COMM_STAGE_UNPROVEN','automaticRetry':False,'automaticRollback':False})
   except Exception:pass
  raise
 finally:os.close(lock)
