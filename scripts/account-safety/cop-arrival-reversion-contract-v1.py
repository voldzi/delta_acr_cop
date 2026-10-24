"""Exact two-image arrival authority. No data/config restoration or generic rollback."""
import copy, json, types
from pathlib import Path
FORWARD='cop-api-user-selected-arrival-release-v1'
REVERSE='cop-api-user-selected-arrival-reversion-v1'
PROFILE='206c4507-5e00-458e-b0ee-4061309aa7a8'
OLD='sha256:251374f1b612dec0b0f0335250f91bb44f9e420d0d92bc2a2a3f9bf459b02a0c'
NEW='sha256:3f0054cb10e7c563c47cb010a7ea7cfbf4ff5a738e1261d77434be283baab430'
OLD_REVISION='c1ca66ff49c8e250ec260bd199f0d41502d8d600'
NEW_REVISION='333352a79cba641393e407e32d0a175867ca32c2'
BASE_SHA='5e084b39071ffb7b874bd33953fe0017ab1430855d7735625026790dc8ab2533'
FORWARD_SHA='6f0f6f8d8ad6f33fd57c1adbd6b0829c32f595da57e0df3287373792cfdaa0ad'
KEYS=frozenset({'COP_COMMUNICATION_SAFETY_ENABLED','COP_COMMUNICATION_MODERATOR_ROLE','COP_COMMUNICATION_CONTACT_EMAIL','COP_COMMUNICATION_RETENTION_POLICY_ID','COP_COMMUNICATION_EVIDENCE_SECRET'})
def module(r,digest):
 path=r.PROFILES/PROFILE/('post-edge-promotion-helper-'+digest+'.py');raw=r.private_read(path,0,mode=0o640,gid=1000);r.require(r.sha(raw)==digest,'arrival_immutable_parent_changed');m=types.ModuleType('immutable_arrival_parent');exec(compile(raw,str(path),'exec'),m.__dict__);return m

def schema(r,p):
 if p.get('contractVersion')not in{FORWARD,REVERSE}:return module(r,BASE_SHA).schema(r,p)
 f=module(r,FORWARD_SHA)
 if p['contractVersion']==FORWARD:
  if p['previous']==f.SOURCE:return f.schema(r,p)
  q=copy.deepcopy(p);q['previous']=f.SOURCE;q['parentProof']={'path':f.PARENT,'sha256':f.PARENT_SHA};f.schema(r,q)
  previous=p['previous'];ref=p['parentProof']
  r.require(isinstance(previous,dict)and set(previous)==set(f.SOURCE)and previous['contractVersion']=='cop-api-runtime-active-v1'and previous['imageId']==OLD and previous['profileId']==PROFILE and previous['profileGeneration']==PROFILE and r.GENERATION.fullmatch(previous['generation'])and r.ID.fullmatch(previous['releaseId'])and r.re.fullmatch('[0-9a-f]{64}',previous['containerId']),'arrival_forward_reentry_scope')
  r.require(isinstance(ref,dict)and set(ref)=={'path','sha256'}and Path(ref['path']).parent==r.PROFILES/PROFILE and Path(ref['path']).name.startswith('account-erasure-')and r.re.fullmatch('[0-9a-f]{64}',ref['sha256']),'arrival_forward_reentry_parent')
  return p
 fields={'contractVersion','transitionId','operation','previous','target','changedKeys','environmentMetadata','composeHashes','ownerAcceptance','checks','cleanReset','parentProof','checkedAt','expiresAt','sourceSpecSha256','patchFiles','simAcceptance','reversion'}
 r.require(set(p)==fields and p['operation']=='maintain' and p['ownerAcceptance'] is True and r.PROFILE_UUID.fullmatch(p['transitionId']) and p['changedKeys']==[] and p['target']=={'imageId':OLD,'sourceRevision':OLD_REVISION,'profileGeneration':PROFILE},'arrival_reverse_scope')
 a=p['reversion'];r.require(isinstance(a,dict) and set(a)=={'mode','sourceReleaseId','sourceContainerId','sourceImage','pendingForwardSha256','pendingHealthSha256','baselineSha256'} and a['mode'] in {'accepted','pending'} and r.ID.fullmatch(a['sourceReleaseId']) and r.re.fullmatch('[0-9a-f]{64}',a['sourceContainerId']),'arrival_reverse_source')
 previous=p['previous'];r.require(isinstance(previous,dict) and set(previous)==set(f.SOURCE) and previous['contractVersion']=='cop-api-runtime-active-v1' and previous['profileId']==PROFILE and previous['profileGeneration']==PROFILE and r.GENERATION.fullmatch(previous['generation']) and r.ID.fullmatch(previous['releaseId']) and r.re.fullmatch('[0-9a-f]{64}',previous['containerId']),'arrival_reverse_pointer')
 digest=lambda v:isinstance(v,str) and r.re.fullmatch('[0-9a-f]{64}',v)
 r.require(digest(a['baselineSha256']),'arrival_reverse_baseline_ref')
 if a['mode']=='accepted':
  r.require(previous['imageId']==NEW and previous['releaseId']==a['sourceReleaseId'] and previous['containerId']==a['sourceContainerId'] and a['sourceImage']==NEW and a['pendingForwardSha256'] is None and a['pendingHealthSha256'] is None,'arrival_reverse_accepted')
 else:r.require(previous['imageId']==OLD and a['sourceImage'] in {OLD,NEW} and digest(a['pendingForwardSha256']) and digest(a['pendingHealthSha256']) and a['baselineSha256']==a['pendingHealthSha256'],'arrival_reverse_pending')
 r.require(set(p['checks'])==f.CHECKS|{'noSchemaDowngrade','retainedPendingHistory'} and all(v is True for v in p['checks'].values()) and p['patchFiles']==f.PATCH_FILES,'arrival_reverse_checks')
 r.require(digest(p['sourceSpecSha256']) and 0<r.fenced_timestamp(p['expiresAt'])-r.fenced_timestamp(p['checkedAt'])<=900,'arrival_reverse_freshness')
 r.require(isinstance(p['parentProof'],dict) and set(p['parentProof'])=={'path','sha256'} and Path(p['parentProof']['path']).parent==r.PROFILES/PROFILE and Path(p['parentProof']['path']).name.startswith('account-erasure-') and digest(p['parentProof']['sha256']),'arrival_reverse_parent_ref')
 r.require(p['simAcceptance']=={'imageId':'sha256:9f0a6d789116cad19d363e79e9c8e5963861106e10ecd9c281e9f864c1d2c124','schemaSha256':'210b06c0cd3f093d91529721b21b7ffed26e28be5d625a15a6d62a67c7f36e8c','actualEngineAccepted':True},'arrival_reverse_sim_lineage')
 return p

def read_proof(r,store,path,raw,binding):
 p=json.loads(raw)
 if p.get('contractVersion')not in{FORWARD,REVERSE}:return module(r,BASE_SHA).read_proof(r,store,path,raw,binding)
 if p['contractVersion']==FORWARD and p['previous']==module(r,FORWARD_SHA).SOURCE:return module(r,FORWARD_SHA).read_proof(r,store,path,raw,binding)
 schema(r,p);store.protected_directory(store.protected_root);store.protected_directory(r.PROFILES/PROFILE)
 if p['contractVersion']==FORWARD:
  r.require(Path(path)==r.PROFILES/PROFILE/('account-erasure-'+p['transitionId']+'.json')and all(binding[k]==p['target'][k]for k in p['target'])and binding['previousReleaseId']==p['previous']['releaseId']and binding['profileId']==PROFILE and('composeHashes'not in binding or binding['composeHashes']==p['composeHashes']),'arrival_forward_reentry_binding')
  origin=json.loads(r.private_read(store.root/'releases'/p['previous']['releaseId']/'release.json',store.uid));ref=origin.get('accountErasureConfig',{})
  r.require(origin['imageId']==OLD and origin['sourceRevision']==OLD_REVISION and origin['profileId']==PROFILE and ref.get('path')==p['parentProof']['path']and ref.get('sha256')==p['parentProof']['sha256']and ref.get('authScope')=='oidc_no_lab_v1','arrival_forward_reentry_source')
  _,parent=store.erasure_config_proof(Path(ref['path']),origin,ref['sha256'])
  r.require(parent['contractVersion']==REVERSE and all(p[k]==parent[k]for k in('cleanReset','environmentMetadata','composeHashes','patchFiles','simAcceptance')),'arrival_forward_reentry_protection_changed')
  return r.sha(raw),p
 r.require(Path(path)==r.PROFILES/PROFILE/('account-erasure-'+p['transitionId']+'.json') and all(binding[k]==p['target'][k] for k in p['target']) and binding['previousReleaseId']==p['previous']['releaseId'] and binding['profileId']==PROFILE and ('composeHashes'not in binding or binding['composeHashes']==p['composeHashes']),'arrival_reverse_binding')
 origin=json.loads(r.private_read(store.root/'releases'/p['reversion']['sourceReleaseId']/'release.json',store.uid));ref=origin.get('accountErasureConfig',{})
 r.require(origin['imageId']==NEW and origin['sourceRevision']==NEW_REVISION and origin['profileId']==PROFILE and ref.get('path')==p['parentProof']['path'] and ref.get('sha256')==p['parentProof']['sha256'] and ref.get('authScope')=='oidc_no_lab_v1','arrival_reverse_parent_binding')
 _,parent=store.erasure_config_proof(Path(ref['path']),origin,ref['sha256'])
 r.require(parent['contractVersion']==FORWARD and (p['reversion']['mode']!='pending' or p['previous']==parent['previous']) and all(p[k]==parent[k] for k in ('cleanReset','environmentMetadata','composeHashes','patchFiles','simAcceptance')),'arrival_reverse_protection_changed')
 return r.sha(raw),p

def evidence(r,p,fresh=True):
 if p.get('contractVersion') not in {FORWARD,REVERSE}:return module(r,BASE_SHA).evidence(r,p,fresh)
 schema(r,p)
 if fresh:r.require(r.fenced_timestamp(p['checkedAt'])<=r.datetime.now(r.timezone.utc).timestamp()<=r.fenced_timestamp(p['expiresAt']),'arrival_mutation_authority_expired')
 return p

def environment(r,actual,desired,p):
 if p.get('contractVersion')not in{FORWARD,REVERSE}:return module(r,BASE_SHA).environment(r,actual,desired,p)
 schema(r,p);r.require(actual==desired and desired.get('COP_AUTH_MODE')=='oidc' and desired.get('COP_ALLOW_LAB_TOKEN')=='false' and desired.get('COP_ACCOUNT_ERASURE_ENABLED')=='true','arrival_environment_changed');evidence(r,p,True)

def comparison(r,before,after):return module(r,BASE_SHA).comparison(r,before,after)
def validate_health(r,store,binding,verified):
 ref=binding['accountErasureConfig'];_,p=store.erasure_config_proof(Path(ref['path']),binding,ref['sha256'])
 if p.get('contractVersion')not in{FORWARD,REVERSE}:return module(r,BASE_SHA).validate_health(r,store,binding,verified)
 # No new mutation is authorized here. Activation/reversion checks fresh authority
 # immediately before mutation; an already-started target needs fresh real health.
 evidence(r,p,False);v=json.loads(verified);r.require(v.get('healthAndPublicDemoPreserved')is True,'arrival_health_not_preserved');r.health_statuses(v['statuses']);return v
