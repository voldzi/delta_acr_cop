#!/usr/bin/python3
"""Health-only completion of the already approved, already restored exact pair.
Never stops/starts/recreates an application. All recovery checks remain intact.
"""
import argparse,hashlib,json,os,socket,stat,subprocess,sys,time,types
from pathlib import Path
LIB=Path('/usr/local/lib/cop-self-release');PROFILE=Path('/etc/vcode-cop-api-runtime/206c4507-5e00-458e-b0ee-4061309aa7a8')
OLD='sha256:51a10099616c4b2bbd2607391413de975fdf49ba0b2df403db6d3e9785eb9094';FAILED='sha256:e4a94bb3f76bbcfe0d831b5aae993aabf79a2680208b10a10e552d5c8c5d6b49'
RELEASE='release-884b969e295347ed94f6a70fe8470c94';GENERATION='9737d2f07bb64a16886234bbebb58bdc';GUARD='e3d31a74d1c9cf296ad2afb26382824dbbd1c5faec2fcc59d954950216c14fc3';HEALTH='e7eb01a0b41dcbbcfda0652a4d322c5f0d5d0eb4b6c411e1e6db174d8a596066'
PERMIT=PROFILE/'manual-return-health-completion-20261104.json'
def need(v,code):
 if not v:raise RuntimeError(code)
def sha(b):return hashlib.sha256(b).hexdigest()
def load(path,name,digest):
 raw=path.read_bytes();s=path.lstat();need(not path.is_symlink() and s.st_uid==0 and s.st_nlink==1 and not s.st_mode&0o022 and sha(raw)==digest,'RETURN_COMPLETION_SOURCE_CUSTODY');m=types.ModuleType(name);m.__file__=str(path);sys.modules[name]=m;exec(compile(raw,str(path),'exec'),m.__dict__);return m
def observation(v):return {'containerId':v['Id'],'imageId':v['Image'],'pid':v['State']['Pid'],'startedAt':v['State']['StartedAt'],'restartCount':v['RestartCount']}
def verify_restored(r,s):
 pending=r.private_json(s.root/'pending.json',1000);active=s.pointer();need(active['generation']==GENERATION and active['imageId']==OLD and pending['previous']==active and pending['targetReleaseId']==RELEASE and pending['restoredContainerId'] is not None,'RETURN_COMPLETION_EXACT_PENDING')
 directory,binding,profile=s.binding(active['releaseId']);v=s.docker.current(directory);need(v['Id']==pending['restoredContainerId'] and v['Image']==OLD and v['State']['Running'] and v['State'].get('Health',{}).get('Status')=='healthy','RETURN_COMPLETION_HEALTH_REQUIRED');s.docker.live(directory,binding,profile)
 need(s.docker.peers(directory)==pending['peers'],'RETURN_COMPLETION_PEERS');return pending,active,directory,binding,profile,v

def main():
 a=argparse.ArgumentParser();a.add_argument('--seal-and-complete',action='store_true');a.add_argument('--worker',action='store_true');args=a.parse_args();need(os.geteuid()==(1000 if args.worker else 0) and socket.gethostname().split('.')[0]=='docker','RETURN_COMPLETION_UID')
 os.environ.clear();os.environ.update(PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME='/root',LANG='C',DOCKER_HOST='unix:///var/run/docker.sock',DOCKER_CONFIG=str(LIB/'docker'));os.umask(0o077)
 r=load(LIB/'scripts/cop-api-runtime.py','return_completion_runtime',GUARD);policy=json.loads((LIB/'policy.json').read_bytes());storage=load(LIB/'scripts/cop-storage.py','return_completion_storage',policy['assets']['scripts/cop-storage.py']);s=r.Store(uid=1000,guard=storage.preflight)
 if args.worker:
  permit=json.loads(r.private_read(PERMIT,0,mode=0o640,gid=1000));need(permit['contractVersion']=='cop-manual-return-health-completion-v1' and permit['approvalRef']=='call_57664092469a4e46bb6a896903e277fe' and 0<=time.time()-permit['checkedAt']<=180 and sha(Path(__file__).read_bytes())==permit['scriptSha256'],'RETURN_COMPLETION_ROOT_PERMIT')
  pending,active,directory,binding,profile,v=verify_restored(r,s);need(sha(r.private_read(s.root/'pending.json',1000))==permit['pendingSha256'] and active==permit['previous'] and observation(v)==permit['stableRuntime'],'RETURN_COMPLETION_CAS')
  baseline=r.private_read(s.root/'pending-health.json',1000);need(sha(baseline)==permit['healthSha256'],'RETURN_COMPLETION_HEALTH_WITNESS')
  reader=load(PROFILE/('planning-config-v3-health-'+HEALTH+'.py'),'return_completion_health',HEALTH);calls=[]
  def verify(action,path):
   need(action=='verify' and Path(path)==s.root/'pending-health.json' and calls==[] and r.private_read(path,1000)==baseline,'RETURN_COMPLETION_HEALTH_SCOPE')
   verified,observed=reader.verify(s.post_edge_runtime(),baseline);current=s.docker.current(directory)
   need(observation(current)==permit['stableRuntime'] and current['State']['Running'] and current['State'].get('Health',{}).get('Status')=='healthy','RETURN_COMPLETION_RUNTIME_CHANGED')
   calls.append(action);s.write(s.root/'manual-return-health-completion-20261104-observation.json',r.encoded(observed));return verified
  def no_recreation(*_):raise RuntimeError('RETURN_COMPLETION_RECREATION_FORBIDDEN')
  s.docker.health=verify;s.docker.up=no_recreation
  result=s._recover(GENERATION,rollback=True);need(calls==['verify'] and result['imageId']==OLD,'RETURN_COMPLETION_RESULT')
  print(json.dumps({'manualReturnCompleted':True,'imageId':result['imageId'],'generation':result['generation'],'containerId':result['containerId'],'newRestartsDuringCompletion':0,'healthy':True,'containerRecreated':False}),flush=True);return
 with storage.operation_lock():
  pending,active,directory,binding,profile,v=verify_restored(r,s)
  print(json.dumps({'healthCompletionPreflight':True,'healthyExistingContainer':True,'containerRecreationAllowed':False,'historicalRestartCount':v['RestartCount'],'productionChanged':False}),flush=True)
  if not args.seal_and_complete:return
  own=Path(__file__);meta=own.lstat();need(meta.st_uid==0 and meta.st_gid==1000 and stat.S_IMODE(meta.st_mode)==0o640,'RETURN_COMPLETION_WORKER_CUSTODY')
  proof={'contractVersion':'cop-manual-return-health-completion-v1','approvalRef':'call_57664092469a4e46bb6a896903e277fe','checkedAt':time.time(),'scriptSha256':sha(own.read_bytes()),'previous':active,'pendingSha256':sha(r.private_read(s.root/'pending.json',1000)),'healthSha256':sha(r.private_read(s.root/'pending-health.json',1000)),'stableRuntime':observation(v)}
  fd=os.open(PERMIT,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o640)
  try:os.fchown(fd,0,1000);os.fchmod(fd,0o640);os.write(fd,r.encoded(proof));os.fsync(fd)
  finally:os.close(fd)
  output=subprocess.run(['/usr/sbin/runuser','-u','voldzi','--','/usr/bin/env','-i','PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','HOME=/home/voldzi','LANG=C','DOCKER_HOST=unix:///var/run/docker.sock','DOCKER_CONFIG='+str(LIB/'docker'),'/usr/bin/python3','-I',str(own),'--worker'],capture_output=True,timeout=180)
  result=json.loads(output.stdout);case=Path('/var/lib/cop-self-release/manual-return-20261104');fd=os.open(case/'health-completion-result.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  try:os.write(fd,r.encoded(result));os.fsync(fd)
  finally:os.close(fd)
  print(json.dumps(result),flush=True);need(output.returncode==0 and result.get('manualReturnCompleted') is True,'RETURN_COMPLETION_FAILED')
if __name__=='__main__':
 try:main()
 except Exception as e:
  import traceback
  f=traceback.extract_tb(e.__traceback__)[-1];print(json.dumps({'manualReturnCompleted':False,'code':str(e) if isinstance(e,RuntimeError) and str(e).startswith('RETURN_COMPLETION_') else type(e).__name__,'failureFile':Path(f.filename).name,'failureLine':f.lineno}),flush=True);raise SystemExit(2)
