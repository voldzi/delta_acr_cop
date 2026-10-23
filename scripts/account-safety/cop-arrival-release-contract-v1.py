"""Closed image-only arrival release; historical Root proofs remain immutable."""
import json, types
from pathlib import Path
VERSION='cop-api-user-selected-arrival-release-v1'
BASE_SHA='5e084b39071ffb7b874bd33953fe0017ab1430855d7735625026790dc8ab2533'
PROFILE='206c4507-5e00-458e-b0ee-4061309aa7a8'
IMAGE='sha256:3f0054cb10e7c563c47cb010a7ea7cfbf4ff5a738e1261d77434be283baab430'
REVISION='333352a79cba641393e407e32d0a175867ca32c2'
PARENT='/etc/vcode-cop-api-runtime/'+PROFILE+'/account-erasure-294e6d07-ce5c-44a6-95e2-2fa29dddad5a.json'
PARENT_SHA='3d353ba636c269e3e7cf069e4f92aef12e6caac7e22d0bd8b8025d15e9fc6049'
SOURCE={'containerId':'2cd12dea0e291fc1a8356b38bf9c5718db74cdcf2a28bffa4d367f1bf067b482','contractVersion':'cop-api-runtime-active-v1','generation':'c2cfba51d59740f88c1af3f4d745101f','imageId':'sha256:251374f1b612dec0b0f0335250f91bb44f9e420d0d92bc2a2a3f9bf459b02a0c','profileGeneration':PROFILE,'profileId':PROFILE,'releaseId':'release-92a29dffbc0743d995f1fd6f47c114ff'}
KEYS=frozenset({'COP_COMMUNICATION_SAFETY_ENABLED','COP_COMMUNICATION_MODERATOR_ROLE','COP_COMMUNICATION_CONTACT_EMAIL','COP_COMMUNICATION_RETENTION_POLICY_ID','COP_COMMUNICATION_EVIDENCE_SECRET'})
CHECKS={'sameEnvironment','sameAuthentication','sameErasureFence','sameDatabaseRouting','sameTopology','exactPatchFiles','targetedTests','simArrivalAccepted'}
def base(r):
 path=r.PROFILES/PROFILE/('post-edge-promotion-helper-'+BASE_SHA+'.py');raw=r.private_read(path,0,mode=0o640,gid=1000);r.require(r.sha(raw)==BASE_SHA,'arrival_parent_helper_changed');m=types.ModuleType('immutable_previous_release_contract');exec(compile(raw,str(path),'exec'),m.__dict__);return m

def schema(r,p):
 if p.get('contractVersion')!=VERSION:return base(r).schema(r,p)
 fields={'contractVersion','transitionId','operation','previous','target','changedKeys','environmentMetadata','composeHashes','ownerAcceptance','checks','cleanReset','parentProof','checkedAt','expiresAt','sourceSpecSha256','patchFiles','simAcceptance'}
 r.require(set(p)==fields and p['operation']=='maintain' and p['ownerAcceptance'] is True and r.PROFILE_UUID.fullmatch(p['transitionId']) and p['previous']==SOURCE and p['target']=={'imageId':IMAGE,'sourceRevision':REVISION,'profileGeneration':PROFILE} and p['changedKeys']==[],'arrival_release_scope')
 r.require(p['parentProof']=={'path':PARENT,'sha256':PARENT_SHA} and set(p['checks'])==CHECKS and all(v is True for v in p['checks'].values()),'arrival_release_checks')
 digest=lambda x:isinstance(x,str) and r.re.fullmatch('[0-9a-f]{64}',x)
 r.require(digest(p['sourceSpecSha256']) and 0<r.fenced_timestamp(p['expiresAt'])-r.fenced_timestamp(p['checkedAt'])<=900,'arrival_release_freshness')
 r.require(p['patchFiles']==PATCH_FILES,'arrival_release_patch_scope')
 r.require(isinstance(p['simAcceptance'],dict) and p['simAcceptance']=={'imageId':'sha256:9f0a6d789116cad19d363e79e9c8e5963861106e10ecd9c281e9f864c1d2c124','schemaSha256':'210b06c0cd3f093d91529721b21b7ffed26e28be5d625a15a6d62a67c7f36e8c','actualEngineAccepted':True},'arrival_sim_acceptance')
 return p

def read_proof(r,store,path,raw,binding):
 p=json.loads(raw)
 if p.get('contractVersion')!=VERSION:return base(r).read_proof(r,store,path,raw,binding)
 schema(r,p);store.protected_directory(store.protected_root);store.protected_directory(r.PROFILES/PROFILE)
 r.require(Path(path)==r.PROFILES/PROFILE/('account-erasure-'+p['transitionId']+'.json') and all(binding[k]==p['target'][k] for k in p['target']) and binding['previousReleaseId']==SOURCE['releaseId'] and binding['profileId']==PROFILE and ('composeHashes'not in binding or binding['composeHashes']==p['composeHashes']),'arrival_release_binding')
 old=json.loads(r.private_read(store.root/'releases'/SOURCE['releaseId']/'release.json',store.uid));r.require(old['accountErasureConfig']['path']==PARENT and old['accountErasureConfig']['sha256']==PARENT_SHA and old['imageId']==SOURCE['imageId'],'arrival_release_parent')
 _,parent=store.erasure_config_proof(Path(PARENT),old,PARENT_SHA)
 r.require(all(p[k]==parent[k] for k in ('cleanReset','environmentMetadata','composeHashes')),'arrival_existing_protection_changed')
 return r.sha(raw),p

def evidence(r,p,fresh=True):
 if p.get('contractVersion')!=VERSION:return base(r).evidence(r,p,fresh)
 schema(r,p)
 if fresh:r.require(r.fenced_timestamp(p['checkedAt'])<=r.datetime.now(r.timezone.utc).timestamp()<=r.fenced_timestamp(p['expiresAt']),'arrival_release_expired')
 return p

def environment(r,actual,desired,p):
 if p.get('contractVersion')!=VERSION:return base(r).environment(r,actual,desired,p)
 schema(r,p);r.require(actual==desired and desired.get('COP_AUTH_MODE')=='oidc' and desired.get('COP_ALLOW_LAB_TOKEN')=='false' and desired.get('COP_ACCOUNT_ERASURE_ENABLED')=='true','arrival_environment_changed');evidence(r,p,True)

def comparison(r,before,after):return base(r).comparison(r,before,after)
def validate_health(r,store,binding,verified):
 ref=binding['accountErasureConfig'];_,p=store.erasure_config_proof(Path(ref['path']),binding,ref['sha256'])
 if p.get('contractVersion')!=VERSION:return base(r).validate_health(r,store,binding,verified)
 evidence(r,p,True);v=json.loads(verified);r.require(v.get('healthAndPublicDemoPreserved') is True,'arrival_health_not_preserved');r.health_statuses(v['statuses']);return v

PATCH_FILES={'apps/cop-api/dist/server.js': '940f510da7d5f515e66a32e696d42ff6df34ff66fe3aee00f00e722bb7e609f7', 'apps/cop-api/dist/routing-source.js': 'f71be6473e190cd197d9fcc5dfee004c20efc8b5c5b3f1ee777212feac11b7a1', 'apps/cop-api/dist/routing-user-arrival.js': '2c4e50ed16b729c3294608136c72855ad13d3bd59e7f21636c5b6b0b2156395c', 'apps/cop-api/src/server.ts': '85e0454c4ccb45866f578768e50da6847890b500a7ceb2ead28b3bfdc2d2e208', 'apps/cop-api/src/routing-source.ts': '05089c8713b200f072938d35c3977bd99f64d66c5cd77cdf8082500fbe11447b', 'apps/cop-api/src/routing-user-arrival.ts': '721e98b44a64a047a9d3443619b9d9edb798d84b6b45a64f95f765ac3ee3add4', 'docs/api/schemas/user-selected-arrival-v1.schemas.json': '210b06c0cd3f093d91529721b21b7ffed26e28be5d625a15a6d62a67c7f36e8c', 'openapi/openapi.json': '62b7c1ef49b0b824970aeaff5ffc35cb41bb92ed386d7968ef050aebc44fedb4'}
