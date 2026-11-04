"""Future fixed Root COP publisher. Not installed or authorized to run.
Caller must hold the app release lock and the verified inherited storage lock,
arm the independent closer, and supply ONLY Root-loaded pinned module objects.
No generic CLI, arbitrary image/env option, rollback or retry is provided.
"""
import copy,json,os,socket,stat,uuid
from pathlib import Path
STATE=Path('/var/lib/cop-vehicle-window')
PROFILE=Path('/etc/vcode-cop-api-runtime/206c4507-5e00-458e-b0ee-4061309aa7a8')
def need(v,code):
 if not v:raise RuntimeError(code)
def root_write(path,raw,*,group=0,mode=0o400):
 need(path.parent.is_dir() and path.parent.stat().st_uid==0 and not path.parent.is_symlink() and not path.parent.stat().st_mode&0o022,'WINDOW_ROOT_DESTINATION');fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
 try:
  os.fchown(fd,0,group);os.fchmod(fd,mode);view=memoryview(raw)
  while view:
   n=os.write(fd,view);need(n>0,'WINDOW_SHORT_WRITE');view=view[n:]
  os.fsync(fd)
 finally:os.close(fd)
 sync(path.parent)
def sync(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def replace_source(path,before,after,transition):
 need(path.parent==Path('/srv/cop') and path.name in ('.env','docker-compose.yml') and not any(x.is_symlink() for x in (path,*path.parents)),'WINDOW_FIXED_SOURCE_PATH');fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  st=os.fstat(fd);need(stat.S_ISREG(st.st_mode) and st.st_uid==1000 and st.st_nlink==1 and st.st_size<=1048576,'WINDOW_SOURCE_CUSTODY');raw=os.read(fd,1048577);need(raw==before and len(raw)==st.st_size,'WINDOW_SOURCE_BYTES_CHANGED')
 finally:os.close(fd)
 temporary=path.parent/('.vehicle-window-'+transition+'-'+path.name+'.tmp');out=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  view=memoryview(after)
  while view:
   n=os.write(out,view);need(n>0,'WINDOW_SHORT_WRITE');view=view[n:]
  os.fsync(out);os.fchown(out,st.st_uid,st.st_gid);os.fchmod(out,stat.S_IMODE(st.st_mode))
 finally:os.close(out)
 current=path.stat();need((current.st_dev,current.st_ino,current.st_mtime_ns,current.st_ctime_ns)==(st.st_dev,st.st_ino,st.st_mtime_ns,st.st_ctime_ns),'WINDOW_SOURCE_METADATA_CHANGED');os.replace(temporary,path);sync(path.parent)
def prewrite_matches(r,k,public,inspected,pointer,peers,environment_metadata):
 proc={'pid':inspected['State']['Pid'],'startedAt':inspected['State']['StartedAt'],'restartCount':inspected['RestartCount'],'running':inspected['State']['Running'],'health':inspected['State'].get('Health',{}).get('Status')}
 rows=[x.split('=',1) for x in inspected['Config']['Env']]
 return (inspected['Id']==public['sourceContainer'] and inspected['Image']==k.IMAGE and proc==public['sourceProcess'] and pointer['generation']==public['sourceGeneration'] and pointer['containerId']==public['sourceContainer'] and peers==public['sourcePeers'] and k.sha(r.encoded(r.fenced_public_source_spec(inspected)))==public['sourceSpecSha256'] and all(len(x)==2 for x in rows) and len({x[0] for x in rows})==len(rows) and k.sha(k.encode(dict(rows)))==public['sourceEnvironmentSha256'] and environment_metadata==public['sourceEnvironmentMetadata'])

def execute(approval,r,store,k,contract,proposal,execution,storage_fd,stage,baseline_raw):
 need(os.geteuid()==0 and socket.gethostname().split('.')[0]=='docker' and approval['host']=='docker' and stage in ('open','close'),'WINDOW_FIXED_ROOT_PUBLISHER')
 # No approval is inferred from a fixture, test result, source commit or caller
 # boolean. The concrete loader must have verified the Root-owned approval.
 w=contract.validate_window(approval['window'],int(r.datetime.now(r.timezone.utc).timestamp()),opening=stage=='open');need(w['windowId']==approval['windowId'] and w['approvedManifestSha256']==approval['approvedManifestSha256'],'WINDOW_PUBLISHER_APPROVAL_BINDING')
 base=STATE/w['windowId'];phase=base/stage
 if not base.exists():base.mkdir(mode=0o700);sync(base.parent)
 need(base.is_dir() and base.stat().st_uid==0 and stat.S_IMODE(base.stat().st_mode)==0o700 and not base.is_symlink() and not phase.exists() and not phase.is_symlink(),'WINDOW_PUBLISHER_CASE_CONSUMED');phase.mkdir(mode=0o700);sync(base)
 claimed=False
 try:
  reference=approval['windowReference'];prepared=proposal.propose(r,store,k,contract,stage,reference,baseline_raw);public=prepared.public;transition=public['transitionId'];need(reference['path']==str(PROFILE/('vehicle-window-'+w['windowId']+'.json')),'WINDOW_ROOT_WINDOW_PATH');k.need(k.window(store.post_edge_runtime(),{'stage':stage,'windowReference':reference})['approvedManifestSha256']==approval['approvedManifestSha256'],'WINDOW_ROOT_WINDOW_BINDING')
  destinations=[PROFILE/('vehicle-window-case-'+transition+'.json'),PROFILE/('account-erasure-'+transition+'.json'),PROFILE/('planning-config-v3-source-health-'+transition+'.json')];need(all(not x.exists() and not x.is_symlink() for x in destinations),'WINDOW_PROOF_DESTINATION_CONSUMED')
  root_write(phase/'started.json',k.encode(public)+b'\n');claimed=True
  current=store.docker.current(store.active()[1]);root_write(phase/'raw-before.json',k.encode(current))
  originals=prepared.consume_originals();writes=prepared.consume_source_writes()
  # Never persist a copy/digest of the secrets FILE. Its original bytes are
  # compared only in RAM; its actual filesystem metadata remains the CAS.
  for name,raw in originals.items():
   if name!='.env':root_write(phase/('original-'+name),raw)
  fresh=store.docker.current(store.active()[1]);need(prewrite_matches(r,k,public,fresh,store.pointer(),store.docker.peers(store.active()[1]),r.environment_metadata(store.source/'.env',1000)),'WINDOW_PUBLISHER_PREWRITE_PROCESS_CHANGED')
  for name,original in originals.items():need(r.private_read(store.source/name,1000,limit=1048576)==original,'WINDOW_PUBLISHER_PREWRITE_FILE_CHANGED')
  for name,after in writes.items():replace_source(store.source/name,originals[name],after,transition)
  for name,after in writes.items():need(r.private_read(store.source/name,1000,limit=1048576)==after,'WINDOW_POSTWRITE_SOURCE_DRIFT')
  metadata=r.environment_metadata(store.source/'.env',1000);hashes={name:k.sha(r.private_read(store.source/name,1000,limit=65536)) for name in r.FILES};built=prepared.finalize(metadata,hashes)
  for name,raw in built['documents'].items():root_write(PROFILE/name,raw,group=1000,mode=0o640)
  prepared_result=execution.run_worker({'action':'prepare','proof':built['proofPath'],'attestation':built['attestationPath']},storage_fd);root_write(phase/'prepared.json',k.encode(prepared_result));active=execution.run_worker({'action':'activate','releaseId':prepared_result['releaseId'],'expected':built['expected']},storage_fd);root_write(phase/'activated.json',k.encode(active))
  pointer,directory,binding,profile=store.active();after=store.docker.current(directory);need(pointer['imageId']==k.IMAGE and binding['sourceRevision']==k.SOURCE and after['Id']==pointer['containerId'] and after['RestartCount']==0 and after['State']['Running'] and after['State'].get('Health',{}).get('Status')=='healthy','WINDOW_PUBLISHER_TARGET_UNPROVEN');rows=[x.split('=',1) for x in after['Config']['Env']];need(all(len(x)==2 for x in rows) and len({x[0] for x in rows})==len(rows),'WINDOW_TARGET_ENV_AMBIGUOUS');need(dict(rows).get(k.FLAG)==('true' if stage=='open' else 'false'),'WINDOW_PUBLISHER_TARGET_FLAG');root_write(phase/'raw-after.json',k.encode(after))
  result={'windowId':w['windowId'],'stage':stage,'generation':pointer['generation'],'containerId':pointer['containerId'],'imageUnchanged':k.IMAGE,'admissionOff':stage=='close','zeroRestarts':True,'guardedAcceptanceComplete':True,'ordinaryBrokerCanChangeConfiguration':False,'automaticRetry':False,'automaticRollback':False};root_write(phase/'receipt.json',k.encode(result)+b'\n');return result
 except Exception:
  if claimed:
   try:root_write(phase/'failure.json',b'{"code":"WINDOW_COP_STAGE_UNPROVEN","automaticRetry":false,"automaticRollback":false}\n')
   except Exception:pass
  raise
