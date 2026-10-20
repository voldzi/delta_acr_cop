"""Finite, same-image communication-safety activation. Historical contracts stay immutable."""
import json,types
from pathlib import Path
VERSION='cop-api-communication-safety-activation-v1'
BASE_SHA='77b6df4c6c68637ab66ee67c43ec8de8d475afa0b9224b0cb7aa52e8971e7ca9'
PROFILE='206c4507-5e00-458e-b0ee-4061309aa7a8'
IMAGE='sha256:251374f1b612dec0b0f0335250f91bb44f9e420d0d92bc2a2a3f9bf459b02a0c'
REVISION='c1ca66ff49c8e250ec260bd199f0d41502d8d600'
PARENT='/etc/vcode-cop-api-runtime/'+PROFILE+'/account-erasure-5b9444dc-b2ed-4cf2-8900-f7fec3ea785b.json'
PARENT_SHA='12a046c7bb6fc66a8fb6b60a2f4f709831cefb2874ec8ce042dcfdec17734a3f'
KEYS=frozenset({'COP_COMMUNICATION_SAFETY_ENABLED','COP_COMMUNICATION_MODERATOR_ROLE','COP_COMMUNICATION_CONTACT_EMAIL','COP_COMMUNICATION_RETENTION_POLICY_ID','COP_COMMUNICATION_EVIDENCE_SECRET'})
FIXED={'COP_COMMUNICATION_SAFETY_ENABLED':'true','COP_COMMUNICATION_MODERATOR_ROLE':'cop_moderator','COP_COMMUNICATION_CONTACT_EMAIL':'podpora@zeleznalady.cz','COP_COMMUNICATION_RETENTION_POLICY_ID':'cop-communication-retention-90d-30d-180d-v1'}
SOURCE={'contractVersion':'cop-api-runtime-active-v1','generation':'e1d1bd93c2ed4e3b844a3a00826f8a06','containerId':'f5f6629754d94f877a0ed9a2962a9112814986d7069840d8df7712cc786fefa3','profileGeneration':PROFILE,'profileId':PROFILE,'imageId':IMAGE,'releaseId':'release-909b561e9952443c8c711660962c80d8'}
def base(r):
 p=r.PROFILES/PROFILE/('post-edge-promotion-helper-'+BASE_SHA+'.py');raw=r.private_read(p,0,mode=0o640,gid=1000);r.require(r.sha(raw)==BASE_SHA,'safety_parent_helper_changed');m=types.ModuleType('immutable_continuity_contract');exec(compile(raw,str(p),'exec'),m.__dict__);return m

def schema(r,p):
 if p.get('contractVersion')!=VERSION:return base(r).schema(r,p)
 fields={'contractVersion','transitionId','operation','previous','target','changedKeys','environmentMetadata','composeHashes','ownerAcceptance','checks','cleanReset','parentProof','checkedAt','expiresAt','sourceSpecSha256','evidenceSecretFile'}
 r.require(set(p)==fields and p['operation']=='maintain' and p['ownerAcceptance'] is True and r.PROFILE_UUID.fullmatch(p['transitionId']) and p['previous']==SOURCE and p['target']=={'imageId':IMAGE,'sourceRevision':REVISION,'profileGeneration':PROFILE} and p['changedKeys']==sorted(KEYS),'safety_activation_scope')
 r.require(p['parentProof']=={'path':PARENT,'sha256':PARENT_SHA} and set(p['checks'])=={'sameImage','sameAuthentication','sameErasureFence','sameTopology','targetedTests','moderatorAssigned'} and all(v is True for v in p['checks'].values()),'safety_activation_checks')
 r.require(isinstance(p['sourceSpecSha256'],str) and r.re.fullmatch('[0-9a-f]{64}',p['sourceSpecSha256']) and 0<r.fenced_timestamp(p['expiresAt'])-r.fenced_timestamp(p['checkedAt'])<=900,'safety_activation_freshness')
 r.require(isinstance(p['evidenceSecretFile'],dict) and set(p['evidenceSecretFile'])=={'path','metadata'} and p['evidenceSecretFile']['path']=='/srv/cop/.env.communication-safety','safety_secret_file_scope')
 return p

def read_proof(r,store,path,raw,binding):
 p=json.loads(raw)
 if p.get('contractVersion')!=VERSION:return base(r).read_proof(r,store,path,raw,binding)
 schema(r,p);r.require(r.environment_metadata(Path(p['evidenceSecretFile']['path']),store.uid)==p['evidenceSecretFile']['metadata'],'safety_secret_file_changed');store.protected_directory(store.protected_root);store.protected_directory(r.PROFILES/PROFILE)
 r.require(Path(path)==r.PROFILES/PROFILE/('account-erasure-'+p['transitionId']+'.json') and all(binding[k]==p['target'][k] for k in p['target']) and binding['previousReleaseId']==SOURCE['releaseId'] and binding['profileId']==PROFILE and ('composeHashes' not in binding or binding['composeHashes']==p['composeHashes']),'safety_activation_binding')
 old=json.loads(r.private_read(store.root/'releases'/SOURCE['releaseId']/'release.json',store.uid));r.require(old['accountErasureConfig']['path']==PARENT and old['accountErasureConfig']['sha256']==PARENT_SHA and old['imageId']==IMAGE,'safety_activation_parent')
 _,parent=store.erasure_config_proof(Path(PARENT),old,PARENT_SHA);r.require(p['cleanReset']==parent['cleanReset'],'safety_erasure_fence_changed')
 return r.sha(raw),p

def evidence(r,p,fresh=True):
 if p.get('contractVersion')!=VERSION:return base(r).evidence(r,p,fresh)
 schema(r,p)
 if fresh:r.require(r.fenced_timestamp(p['checkedAt'])<=r.datetime.now(r.timezone.utc).timestamp()<=r.fenced_timestamp(p['expiresAt']),'safety_activation_expired')
 return p

def environment(r,actual,desired,p):
 schema(r,p);changed={k for k in set(actual)|set(desired) if actual.get(k)!=desired.get(k) or (k in actual)!=(k in desired)}
 r.require(changed==KEYS and all(desired.get(k)==v for k,v in FIXED.items()) and actual.get('COP_COMMUNICATION_SAFETY_ENABLED','false')=='false' and all(not actual.get(k) for k in KEYS-{'COP_COMMUNICATION_SAFETY_ENABLED'}),'safety_environment_scope')
 r.require(isinstance(desired.get('COP_COMMUNICATION_EVIDENCE_SECRET'),str) and len(desired['COP_COMMUNICATION_EVIDENCE_SECRET'])>=43 and desired['COP_AUTH_MODE']=='oidc' and desired['COP_ALLOW_LAB_TOKEN']=='false' and desired['COP_ACCOUNT_ERASURE_ENABLED']=='true','safety_authentication_or_secret')
 evidence(r,p,True)

def comparison(r,before,after):return base(r).comparison(r,before,after)
def validate_health(r,store,binding,verified):
 ref=binding['accountErasureConfig'];_,p=store.erasure_config_proof(Path(ref['path']),binding,ref['sha256'])
 if p.get('contractVersion')!=VERSION:return base(r).validate_health(r,store,binding,verified)
 evidence(r,p,True);v=json.loads(verified);r.require(v.get('healthAndPublicDemoPreserved') is True,'safety_health_not_preserved');r.health_statuses(v['statuses']);return v
