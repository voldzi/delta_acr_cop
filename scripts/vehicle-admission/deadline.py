"""Future independent Root deadline containment. NOT INSTALLED.
Normal guarded closing is requested first. An unresponsive/failed COP closing
may only persist OFF for its one flag and stop its validated intake lineage.
This NEVER reports that a pending/failed release was accepted or repairs it.
"""
import hashlib,json,os,re,socket,stat,subprocess,sys,time,types
from pathlib import Path
LIB=Path('/usr/local/lib/cop-vehicle-window')
APP=Path('/usr/local/lib/cop-self-release')
STATE=Path('/var/lib/cop-vehicle-window')
PROFILE='206c4507-5e00-458e-b0ee-4061309aa7a8'
def need(v,code):
 if not v:raise RuntimeError(code)
def root_read(path,bound=1048576):
 need(not any(p.is_symlink() for p in (path,*path.parents)),'WINDOW_DEADLINE_SYMLINK');fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  a=os.fstat(fd);need(stat.S_ISREG(a.st_mode) and a.st_uid==0 and a.st_nlink==1 and not a.st_mode&0o022 and a.st_size<=bound,'WINDOW_DEADLINE_FILE_CUSTODY');raw=os.read(fd,bound+1);b=os.fstat(fd);need(len(raw)==a.st_size and (a.st_ino,a.st_mtime_ns,a.st_ctime_ns)==(b.st_ino,b.st_mtime_ns,b.st_ctime_ns),'WINDOW_DEADLINE_FILE_CHANGED');return raw
 finally:os.close(fd)
def load(path,digest,name):
 raw=root_read(path);need(hashlib.sha256(raw).hexdigest()==digest,'WINDOW_DEADLINE_ASSET_CHANGED');m=types.ModuleType(name);m.__file__=str(path);sys.modules[name]=m;exec(compile(raw,str(path),'exec'),m.__dict__);return m

def stop_plan(actual,pointer,binding,proof,approval,k):
 """All bindings/proofs must have just passed the unchanged runtime reader.
 Baseline original intake or this exact window lineage only; no other app.
 """
 need(binding['imageId']==k.IMAGE and binding['profileGeneration']==PROFILE and actual['Image']==k.IMAGE and actual['Config']['Labels'].get('com.cop.runtime.release')==binding['releaseId'] and actual['Config']['Labels'].get('com.cop.runtime.profile-generation')==PROFILE,'WINDOW_DEADLINE_OTHER_RUNTIME')
 is_base=binding['releaseId']==approval['baselineCop']['releaseId'] and actual['Id']==approval['baselineCop']['containerId']
 is_own=proof['contractVersion']==k.WINDOW_VERSION and k.window(approval['_runtime'],proof)['windowId']==approval['windowId'] and k.window(approval['_runtime'],proof)['approvedManifestSha256']==approval['approvedManifestSha256']
 need(is_base or is_own,'WINDOW_DEADLINE_OTHER_LINEAGE')
 rows=[x.split('=',1) for x in actual['Config']['Env']];need(all(len(x)==2 for x in rows) and len({x[0] for x in rows})==len(rows),'WINDOW_DEADLINE_ENV_AMBIGUOUS');flag=dict(rows).get(k.FLAG,'false');need(flag in ('true','false'),'WINDOW_DEADLINE_FLAG_AMBIGUOUS')
 return {'binding':{'containerId':actual['Id'],'releaseId':binding['releaseId'],'imageId':binding['imageId'],'profileGeneration':binding['profileGeneration']},'mustStop':flag=='true' and actual['State']['Running'],'intakeAlreadyOff':flag=='false' or actual['State']['Running'] is False}

def execute(approval,modules):
 need(os.geteuid()==0 and approval['host']==socket.gethostname().split('.')[0],'WINDOW_DEADLINE_ROOT_HOST');contract=modules['contract'];execution=modules['execution'];publisher=modules['publisher'];window=approval['window'];contract.validate_window(window,max(int(time.time()),window['notBefore']),opening=False);need(window['windowId']==approval['windowId'] and window['approvedManifestSha256']==approval['approvedManifestSha256'],'WINDOW_DEADLINE_APPROVAL')
 if approval['host']=='comm':return modules['messaging'].execute(approval,contract,'close')
 need(approval['host']=='docker','WINDOW_DEADLINE_HOST_SCOPE')
 case=STATE/approval['windowId'];need(case.is_dir() and case.stat().st_uid==0 and stat.S_IMODE(case.stat().st_mode)==0o700,'WINDOW_DEADLINE_STATE_CUSTODY')
 request=case/'close-request'
 if not request.exists():publisher.root_write(request,approval['windowId'].encode(),mode=0o600)
 else:need(root_read(request)==approval['windowId'].encode(),'WINDOW_DEADLINE_REQUEST_CHANGED')
 # Ask the finite supervisor first. This wait is bounded; missing receipt is
 # not a successful close. No retry of a failed activation occurs here.
 until=time.monotonic()+10
 while time.monotonic()<until:
  if (case/'close'/'receipt.json').exists():break
  time.sleep(0.25)
 service='cop-vehicle-window-'+approval['windowId']+'.service'
 need(hashlib.sha256(root_read(Path('/etc/systemd/system')/service,65536)).hexdigest()==approval['supervisorUnitSha256'],'WINDOW_DEADLINE_SUPERVISOR_UNIT_CHANGED')
 # It is only this separately approved app supervisor, never Docker/another app.
 subprocess.run(['/usr/bin/systemctl','stop',service],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=30,check=True)
 r=modules['runtime'];k=r.Store(uid=1000).planning_config_v3_module();store=r.Store(uid=1000);scope=store.post_edge_runtime();approval={**approval,'_runtime':scope};pointer=store.pointer();need(pointer is not None,'WINDOW_DEADLINE_POINTER_MISSING');directory,binding,_=store.binding(pointer['releaseId'],probe_mounts=False);ref=binding['accountErasureConfig'];_,proof=store.erasure_config_proof(Path(ref['path']),binding,ref['sha256'])
 actual=store.docker.current(directory);plans=[stop_plan(actual,pointer,binding,proof,approval,k)];pending_path=store.root/'pending.json';pending_unknown=False
 if pending_path.exists():
  pending=r.private_json(pending_path,1000);target_id=pending['targetReleaseId'];td,tb,_=store.binding(target_id,probe_mounts=False);tr=tb['accountErasureConfig'];_,tp=store.erasure_config_proof(Path(tr['path']),tb,tr['sha256']);need(tp['contractVersion']==k.WINDOW_VERSION and k.window(scope,tp)['windowId']==approval['windowId'],'WINDOW_DEADLINE_OTHER_PENDING')
  ids=store.docker.run(['docker','ps','-aq','--filter','label=com.cop.runtime.release='+target_id]).decode().split();need(len(ids)<=1,'WINDOW_DEADLINE_MULTIPLE_PENDING_TARGETS')
  if not ids:pending_unknown=True
  for cid in ids:
   value=json.loads(store.docker.run(['docker','inspect',cid]))[0];plans.append(stop_plan(value,pointer,tb,tp,approval,k))
 stopped=[]
 # Only a Root-recorded attempt permits an emergency change of the source flag.
 # Do not poison untouched original metadata when opening was never attempted.
 persistent_off=False;open_attempted=(case/'open'/'started.json').exists()
 if open_attempted:
  before=r.private_read(Path('/srv/cop/.env'),1000,limit=1048576)
  try:
   after=contract.emergency_env_off(before)
   if before!=after:publisher.replace_source(Path('/srv/cop/.env'),before,after,'deadline-'+approval['windowId'])
   persistent_off=True
  except Exception:pass # Even a source-file error must not skip intake stop.
 for plan in plans:
  if plan['mustStop']:stopped.append(execution.contain_owned_intake(plan['binding']))
 outcome={'windowId':approval['windowId'],'newAdmissionContained':not pending_unknown and all(x['intakeAlreadyOff'] or any(y['containerId']==x['binding']['containerId'] and y['apiStopped'] for y in stopped) for x in plans),'persistentFlagOff':persistent_off,'pendingTargetUnproven':pending_unknown,'configurationCloseAccepted':False,'apiStops':stopped,'messagingCleanupStopped':False,'durableIntentsDeleted':False,'oldImageFallback':False,'rootReconciliationRequired':bool(stopped) or pending_unknown or (open_attempted and not persistent_off)}
 destination=case/'deadline-containment.json'
 if not destination.exists():publisher.root_write(destination,json.dumps(outcome,sort_keys=True).encode()+b'\n')
 return outcome

def main():
 need(os.geteuid()==0 and len(sys.argv)==1,'WINDOW_DEADLINE_ROOT_ENTRY');approval=json.loads(root_read(LIB/'approval.json',65536));need(approval['contractVersion']=='cop-root-window-installation-v1' and approval['ordinaryConfigAuthority'] is False,'WINDOW_DEADLINE_APPROVAL_SCOPE')
 modules={name:load(LIB/(name+'.py'),approval['assets'][name+'.py'],'window_deadline_'+name) for name in ['contract','execution','publisher','messaging']}
 if approval['host']=='docker':modules['runtime']=load(APP/'scripts/cop-api-runtime.py',approval['guardSha256'],'window_deadline_runtime')
 print(json.dumps(execute(approval,modules)))
if __name__=='__main__':
 try:main()
 except Exception:print(json.dumps({'containmentComplete':False,'code':'WINDOW_DEADLINE_CONTAINMENT_UNPROVEN','oldImageFallback':False}));raise SystemExit(2)
