"""Unprivileged execution of an exact Root-sealed application release only."""
import hashlib,json,os,sys,types
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def main():
 if os.geteuid()!=1000:raise RuntimeError('APP_WORKER_UID')
 policy=json.loads((ROOT/'policy.json').read_bytes())
 path=ROOT/'scripts/cop-api-runtime.py';raw=path.read_bytes()
 if hashlib.sha256(raw).hexdigest()!=policy['guardSha256']:raise RuntimeError('APP_GUARD_CHANGED')
 m=types.ModuleType('application_guard');m.__file__=str(path);exec(compile(raw,str(path),'exec'),m.__dict__)
 k=m.Store(uid=1000).planning_config_v3_module()
 value=json.loads(sys.stdin.buffer.read(65537));action=value['action']
 storage_path=ROOT/'scripts/cop-storage.py';storage_raw=storage_path.read_bytes()
 if hashlib.sha256(storage_raw).hexdigest()!=policy['assets']['scripts/cop-storage.py']:raise RuntimeError('APP_STORAGE_READER_CHANGED')
 storage=types.ModuleType('application_storage');storage.__file__=str(storage_path);exec(compile(storage_raw,str(storage_path),'exec'),storage.__dict__)
 with storage.operation_lock():
  store=m.Store(uid=1000,guard=storage.preflight)
  if action=='prepare':
   proofpath=Path(value['proof']);proof=k.parse(m.private_read(proofpath,0,mode=0o640,gid=1000));k.evidence(store.post_edge_runtime(),proof,True)
   if proof['contractVersion']!=k.VERSION or store.pointer()!=proof['previous']:raise RuntimeError('APP_PREPARE_SCOPE')
   result=store.prepare(proof['target']['imageId'],proof['target']['sourceRevision'],Path(value['attestation']),proof['previous']['generation'],erasure_config=proofpath)
  elif action=='activate':
   directory,binding,profile=store.binding(value['releaseId']);ref=binding['accountErasureConfig'];_,proof=store.erasure_config_proof(Path(ref['path']),binding,ref['sha256'])
   if proof['contractVersion']!=k.VERSION or value['expected']!=proof['previous']['generation']:raise RuntimeError('APP_ACTIVATE_SCOPE')
   with k.health_scope(store.post_edge_runtime(),store,proof):result=store.activate(value['releaseId'],value['expected'])
  else:raise RuntimeError('APP_WORKER_ACTION')
  print(json.dumps({key:result[key] for key in ['releaseId','imageId','profileId','profileGeneration'] if key in result}|({'generation':result['generation']} if 'generation' in result else {})))
if __name__=='__main__':main()
