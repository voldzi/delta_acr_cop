#!/usr/bin/python3
"""One explicitly approved manual return, after paused intake and zero enrollment.
Not installed in sudoers. No automatic retry, guard edit or configuration change.
"""
import argparse,fcntl,hashlib,json,os,socket,stat,subprocess,sys,time,types
from pathlib import Path
LIB=Path('/usr/local/lib/cop-self-release')
OLD='sha256:51a10099616c4b2bbd2607391413de975fdf49ba0b2df403db6d3e9785eb9094'
FAILED='sha256:e4a94bb3f76bbcfe0d831b5aae993aabf79a2680208b10a10e552d5c8c5d6b49'
RELEASE='release-884b969e295347ed94f6a70fe8470c94'
GENERATION='9737d2f07bb64a16886234bbebb58bdc'
GUARD='e3d31a74d1c9cf296ad2afb26382824dbbd1c5faec2fcc59d954950216c14fc3'
HEALTH='e7eb01a0b41dcbbcfda0652a4d322c5f0d5d0eb4b6c411e1e6db174d8a596066'
def need(ok,code):
 if not ok:raise RuntimeError(code)
def load(path,name,digest=None):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  st=os.fstat(fd);need(st.st_uid==0 and stat.S_ISREG(st.st_mode) and st.st_nlink==1 and not st.st_mode&0o022 and st.st_size<1048576,'RETURN_ASSET_CUSTODY');raw=os.read(fd,1048576)
 finally:os.close(fd)
 if digest:need(hashlib.sha256(raw).hexdigest()==digest,'RETURN_ASSET_HASH')
 m=types.ModuleType(name);m.__file__=str(path);sys.modules[name]=m;exec(compile(raw,str(path),'exec'),m.__dict__);return m

def preflight(r,s):
 active=s.pointer();pending=r.private_json(s.root/'pending.json',1000)
 need(active['generation']==GENERATION and active['imageId']==OLD and pending['previous']==active and pending['targetReleaseId']==RELEASE and pending['restoredContainerId'] is None,'RETURN_EXACT_PENDING')
 old_dir,old,profile=s.binding(active['releaseId']);new_dir,new,new_profile=s.binding(RELEASE)
 need(new['imageId']==FAILED and old['imageId']==OLD and old['profileGeneration']==new['profileGeneration'],'RETURN_EXACT_PAIR')
 actual=s.docker.current(new_dir);need(actual['Id']==pending['targetContainerId'] and actual['Image']==FAILED and actual['RestartCount']>0 and actual['State'].get('Health',{}).get('Status')!='healthy','RETURN_FAILED_TARGET_ONLY')
 s.docker.live(new_dir,new,new_profile);s.docker.preserve(old_dir,profile['directory'],actual)
 values=dict(x.split('=',1) for x in actual['Config']['Env'] if '=' in x)
 need(values.get('COP_SHARED_VEHICLE_COMMUNICATION_ENABLED') in (None,'false'),'RETURN_ADMISSION_MUST_BE_OFF')
 need(s.docker.peers(new_dir)==pending['peers'],'RETURN_PEERS_CHANGED')
 # Only a fixed read-only count; no application initialization or account writes.
 probe="import('/app/apps/cop-api/dist/account-erasure-continuity-production.js').then(async({loadAccountErasureContinuity})=>{let o,c;try{o=await loadAccountErasureContinuity();c=await o.target.connect();await c.query('BEGIN READ ONLY');const r=await c.query(\"SELECT count(*)::integer n FROM cop_mobility_v1 WHERE value ? 'conversationProjection'\");await c.query('ROLLBACK');console.log(JSON.stringify({readOnly:true,count:r.rows[0].n}));}finally{c?.release();await o?.close?.();}}).catch(()=>process.exitCode=2)"
 result=json.loads(s.docker.run(['docker','exec',actual['Id'],'node','-e',probe]));need(result=={'readOnly':True,'count':0},'RETURN_NEW_ENROLLMENT_EXISTS_OR_UNPROVEN')
 return active,pending,old_dir,old,profile,new_dir,new,actual

def main():
 a=argparse.ArgumentParser();a.add_argument('--apply',action='store_true');a.add_argument('--worker',action='store_true');args=a.parse_args()
 need(os.geteuid()==(1000 if args.worker else 0) and socket.gethostname().split('.')[0]=='docker','RETURN_SCOPED_UID_REQUIRED')
 os.environ.clear();os.environ.update(PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME='/root',LANG='C',DOCKER_HOST='unix:///var/run/docker.sock',DOCKER_CONFIG=str(LIB/'docker'));os.umask(0o077)
 r=load(LIB/'scripts/cop-api-runtime.py','manual_return_runtime',GUARD);policy=json.loads((LIB/'policy.json').read_bytes());storage=load(LIB/'scripts/cop-storage.py','manual_return_storage',policy['assets']['scripts/cop-storage.py'])
 if args.worker:
  permit_path=r.PROFILES/'206c4507-5e00-458e-b0ee-4061309aa7a8'/'manual-return-20261104.json'
  permit=json.loads(r.private_read(permit_path,0,mode=0o640,gid=1000))
  need(set(permit)=={'contractVersion','approvalRef','guardSha256','previous','pendingSha256','healthSha256','scriptSha256','checkedAt','intakePausedContainerId','copManagedProjectionCount','messagingManagedRecordCount'} and permit['contractVersion']=='cop-manual-paused-return-v1' and permit['approvalRef']=='call_57664092469a4e46bb6a896903e277fe' and permit['guardSha256']==GUARD and 0<=time.time()-permit['checkedAt']<=300 and permit['copManagedProjectionCount']==permit['messagingManagedRecordCount']==0,'RETURN_ROOT_PERMIT')
  own=Path(__file__);meta=own.lstat();need(meta.st_uid==0 and meta.st_gid==1000 and stat.S_IMODE(meta.st_mode)==0o640 and not own.is_symlink() and hashlib.sha256(own.read_bytes()).hexdigest()==permit['scriptSha256'],'RETURN_WORKER_CUSTODY')
  s=r.Store(uid=1000,guard=storage.preflight);pending_raw=r.private_read(s.root/'pending.json',1000);need(hashlib.sha256(pending_raw).hexdigest()==permit['pendingSha256'] and s.pointer()==permit['previous'],'RETURN_WORKER_CAS')
  pending=json.loads(pending_raw);need(pending['targetReleaseId']==RELEASE and pending['targetContainerId']==permit['intakePausedContainerId'],'RETURN_WORKER_TARGET')
  new_dir,new,new_profile=s.binding(RELEASE);paused=s.docker.current(new_dir);need(paused['Id']==permit['intakePausedContainerId'] and paused['Image']==FAILED and paused['State']['Running'] is False,'RETURN_INTAKE_NOT_PAUSED')
  old_dir,old,profile=s.binding(permit['previous']['releaseId']);need(old['imageId']==OLD,'RETURN_EXACT_OLD_IMAGE')
  baseline=r.private_read(s.root/'pending-health.json',1000);need(hashlib.sha256(baseline).hexdigest()==permit['healthSha256'],'RETURN_BASELINE_CHANGED')
  reader=load(r.PROFILES/profile['profileId']/('planning-config-v3-health-'+HEALTH+'.py'),'manual_return_health',HEALTH);calls=[]
  def verify(action,path):
   need(action=='verify' and Path(path)==s.root/'pending-health.json' and calls==[] and r.private_read(path,1000)==baseline,'RETURN_HEALTH_SCOPE')
   verified,observation=reader.verify(s.post_edge_runtime(),baseline)
   current=s.docker.current(old_dir);deadline=time.monotonic()+120
   while current['State'].get('Health',{}).get('Status')=='starting':
    need(current['Image']==OLD and current['RestartCount']==0 and current['State']['Running'] and time.monotonic()<deadline,'RETURN_TARGET_NOT_STABLE');time.sleep(1);current=s.docker.current(old_dir)
   need(current['Image']==OLD and current['RestartCount']==0 and current['State']['Running'] and current['State'].get('Health',{}).get('Status')=='healthy','RETURN_TARGET_NOT_HEALTHY')
   calls.append(action);s.write(s.root/'manual-return-20261104-health-observation.json',r.encoded(observation));return verified
  s.docker.health=verify
  result=s._recover(GENERATION,rollback=True)
  need(calls==['verify'] and result['imageId']==OLD,'RETURN_RESULT_UNPROVEN');print(json.dumps({'manualReturnCompleted':True,'imageId':result['imageId'],'generation':result['generation'],'healthy':True,'automaticRollback':False}),flush=True);return
 with storage.operation_lock():
  storage.preflight();s=r.Store(uid=1000,guard=storage.preflight);facts=preflight(r,s)
  print(json.dumps({'manualReturnPreflight':True,'oldImage':OLD,'failedImage':FAILED,'copManagedProjections':0,'admissionOff':True,'runtimeAndPeerChecksPassed':True,'productionChanged':False}),flush=True)
  if not args.apply:return
  # Exact additional operator observation: live COMM read-only SQL count0,
  # imagee9c50077, admissionOFF, user approval call57664092469a4e46bb6a896903e277fe.
  case=Path('/var/lib/cop-self-release/manual-return-20261104');need(not case.exists(),'RETURN_ALREADY_ATTEMPTED');case.mkdir(mode=0o700)
  active,pending,old_dir,old,profile,new_dir,new,actual=facts
  def record(name,raw):
   fd=os.open(case/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
   try:os.write(fd,raw);os.fsync(fd)
   finally:os.close(fd)
  record('original-pending.json',r.private_read(s.root/'pending.json',1000));record('original-active.json',r.private_read(s.root/'active.json',1000));baseline=r.private_read(s.root/'pending-health.json',1000);record('original-health.json',baseline)
  record('manual-authorization.json',r.encoded({'approvalRef':'call_57664092469a4e46bb6a896903e277fe','oldImage':OLD,'failedImage':FAILED,'copProjectionCount':0,'messagingManagedRecordCount':0,'messagingObservation':'operator live read-only SQL, admission disabled, image e9c50077','automaticRollback':False}))
  # Pause the exact failed writer before the narrowly authorized return.
  s.docker.run(['docker','stop','--time','30',actual['Id']]);paused=s.docker.current(new_dir)
  need(paused['Id']==actual['Id'] and paused['State']['Running'] is False and paused['Image']==FAILED,'RETURN_INTAKE_NOT_PAUSED')
  s.docker.live(new_dir,new,s.profile(new['profileGeneration'],new['driverContract']))
  permit={'contractVersion':'cop-manual-paused-return-v1','approvalRef':'call_57664092469a4e46bb6a896903e277fe','guardSha256':GUARD,'previous':active,'pendingSha256':hashlib.sha256(r.private_read(s.root/'pending.json',1000)).hexdigest(),'healthSha256':hashlib.sha256(baseline).hexdigest(),'scriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'checkedAt':time.time(),'intakePausedContainerId':actual['Id'],'copManagedProjectionCount':0,'messagingManagedRecordCount':0}
  permit_path=r.PROFILES/profile['profileId']/'manual-return-20261104.json';fd=os.open(permit_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o640)
  try:os.fchown(fd,0,1000);os.fchmod(fd,0o640);os.write(fd,r.encoded(permit));os.fsync(fd)
  finally:os.close(fd)
  output=subprocess.run(['/usr/sbin/runuser','-u','voldzi','--','/usr/bin/env','-i','PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','HOME=/home/voldzi','LANG=C','DOCKER_HOST=unix:///var/run/docker.sock','DOCKER_CONFIG='+str(LIB/'docker'),'/usr/bin/python3','-I',str(Path(__file__)),'--worker'],capture_output=True,timeout=300)
  result=json.loads(output.stdout);record('worker-result.json',r.encoded(result));print(json.dumps(result),flush=True)
  need(output.returncode==0 and result.get('manualReturnCompleted') is True,'RETURN_NOT_COMPLETE')

if __name__=='__main__':
 try:main()
 except Exception as e:
  import traceback
  frame=traceback.extract_tb(e.__traceback__)[-1];print(json.dumps({'manualReturnCompleted':False,'code':str(e) if isinstance(e,RuntimeError) and str(e).startswith('RETURN_') else type(e).__name__,'failureFile':Path(frame.filename).name,'failureLine':frame.lineno}),flush=True);raise SystemExit(2)
