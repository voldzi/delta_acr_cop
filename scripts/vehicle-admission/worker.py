"""Unprivileged worker for a future independently Root-sealed window case.
Not installed. The ordinary code-only broker is never used for configuration.
Only a fixed Root-owned approval and a fresh exact window proof can authorize it.
"""
import hashlib,json,os,socket,stat,sys,types
from pathlib import Path
APP=Path('/usr/local/lib/cop-self-release')
WINDOW=Path('/usr/local/lib/cop-vehicle-window')
def need(v,code):
 if not v:raise RuntimeError(code)
def read_root(path,bound=1048576):
 need(path.is_absolute() and not any(p.is_symlink() for p in (path,*path.parents)),'WINDOW_WORKER_SYMLINK')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and not s.st_mode&0o022 and s.st_size<=bound,'WINDOW_WORKER_CUSTODY');raw=os.read(fd,bound+1);t=os.fstat(fd);need(len(raw)==s.st_size and (s.st_ino,s.st_mtime_ns,s.st_ctime_ns)==(t.st_ino,t.st_mtime_ns,t.st_ctime_ns),'WINDOW_WORKER_CHANGED');return raw
 finally:os.close(fd)
def load(path,name,digest):
 raw=read_root(path);need(hashlib.sha256(raw).hexdigest()==digest,'WINDOW_WORKER_ASSET_CHANGED');m=types.ModuleType(name);m.__file__=str(path);sys.modules[name]=m;exec(compile(raw,str(path),'exec'),m.__dict__);return m

def execute(r,k,storage,approval,value):
 need(isinstance(value,dict) and value.get('action') in ('prepare','activate'),'WINDOW_WORKER_ACTION')
 with storage.operation_lock():
  store=r.Store(uid=1000,guard=storage.preflight)
  if value['action']=='prepare':
   need(set(value)=={'action','proof','attestation'},'WINDOW_WORKER_PREPARE_FIELDS');proofpath=Path(value['proof']);p=k.parse(r.private_read(proofpath,0,mode=0o640,gid=1000));k.evidence(store.post_edge_runtime(),p,True)
   need(p['contractVersion']==k.WINDOW_VERSION and k.window(store.post_edge_runtime(),p)['windowId']==approval['windowId'] and k.window(store.post_edge_runtime(),p)['approvedManifestSha256']==approval['approvedManifestSha256'] and store.pointer()==p['previous'],'WINDOW_WORKER_WINDOW_SCOPE')
   k.assert_source(store.post_edge_runtime(),store,p)
   result=store.prepare(p['target']['imageId'],p['target']['sourceRevision'],Path(value['attestation']),p['previous']['generation'],erasure_config=proofpath)
  else:
   need(set(value)=={'action','releaseId','expected'},'WINDOW_WORKER_ACTIVATE_FIELDS');directory,binding,profile=store.binding(value['releaseId']);ref=binding['accountErasureConfig'];_,p=store.erasure_config_proof(Path(ref['path']),binding,ref['sha256'])
   need(p['contractVersion']==k.WINDOW_VERSION and k.window(store.post_edge_runtime(),p)['windowId']==approval['windowId'] and k.window(store.post_edge_runtime(),p)['approvedManifestSha256']==approval['approvedManifestSha256'] and value['expected']==p['previous']['generation'],'WINDOW_WORKER_WINDOW_SCOPE')
   with k.health_scope(store.post_edge_runtime(),store,p):result=store.activate(value['releaseId'],value['expected'])
  return {key:result[key] for key in ('releaseId','imageId','profileId','profileGeneration','generation','containerId') if key in result}

def main():
 need(os.geteuid()==1000 and socket.gethostname().split('.')[0]=='docker','WINDOW_WORKER_FIXED_HOST_UID')
 approval=json.loads(read_root(WINDOW/'approval.json',65536));need(approval['contractVersion']=='cop-root-window-installation-v1' and approval['host']=='docker' and approval['ordinaryConfigAuthority'] is False,'WINDOW_WORKER_APPROVAL_SCOPE')
 policy=json.loads(read_root(APP/'policy.json',65536));need(hashlib.sha256(read_root(APP/'policy.json')).hexdigest()==approval['installedPolicySha256'],'WINDOW_WORKER_POLICY_CHANGED')
 r=load(APP/'scripts/cop-api-runtime.py','window_runtime',approval['guardSha256']);need(policy['guardSha256']==approval['guardSha256'],'WINDOW_WORKER_GUARD_BINDING')
 storage=load(APP/'scripts/cop-storage.py','window_storage',policy['assets']['scripts/cop-storage.py']);k=r.Store(uid=1000).planning_config_v3_module();value=k.parse(sys.stdin.buffer.read(65537));result=execute(r,k,storage,approval,value);print(json.dumps(result))
if __name__=='__main__':
 try:main()
 except Exception as error:
  import re
  message=str(error);print(json.dumps({'completed':False,'code':message if re.fullmatch('[A-Z0-9_]{1,100}',message) else 'WINDOW_WORKER_FAILED','automaticRetry':False,'automaticRollback':False}));raise SystemExit(2)
