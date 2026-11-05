"""Proposal only: Root-sealed ONE-flag window, unchanged image/old readers.
No host writer or authority is issued on import. Not installed in production.
The ordinary code broker keeps VERSION=image-only and no config capability.
"""
import copy,datetime,hashlib,json,re,types,time
from pathlib import Path
from contextlib import contextmanager
PROFILE='206c4507-5e00-458e-b0ee-4061309aa7a8'
PARENT='c74e60fc58ef31fe2e8bca422345460c32575bca34db7255bdca2c9ddf38d9a1'
HEALTH='e7eb01a0b41dcbbcfda0652a4d322c5f0d5d0eb4b6c411e1e6db174d8a596066'
VERSION='cop-application-owned-image-v1'
WINDOW_VERSION='cop-shared-vehicle-admission-window-v1'
FLAG='COP_SHARED_VEHICLE_COMMUNICATION_ENABLED'
IMAGE='sha256:1338179f0f66abf904aad04da82fc87f82f9676d758842bd00eec4b9e0662d7d'
SOURCE='00c854d56eb9fd4346e26dade622776c83bee9a5'
KEYS=frozenset({'COP_ROUTING_PLANNING_ENABLED','COP_ROUTING_PLANNING_SERVICE_TOKEN','COP_AUTH_MODE','COP_ALLOW_LAB_TOKEN',FLAG})
def need(v,code):
 if not v:raise ValueError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encode(v):return json.dumps(v,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def parse(raw):
 need(isinstance(raw,bytes) and len(raw)<=65536,'WINDOW_DOCUMENT_BOUND')
 def pairs(items):
  out={}
  for k,v in items:need(k not in out,'WINDOW_DUPLICATE_KEY');out[k]=v
  return out
 return json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(ValueError('WINDOW_NONFINITE')))
def digest(v):return isinstance(v,str) and re.fullmatch('[a-f0-9]{64}',v) is not None
def historical(r):
 p=r.PROFILES/PROFILE/('planning-config-v3-kernel-'+PARENT+'.py');raw=r.private_read(p,0,mode=0o640,gid=1000);need(sha(raw)==PARENT,'WINDOW_PARENT_KERNEL_CHANGED')
 m=types.ModuleType('unchanged_image_kernel');exec(compile(raw,str(p),'exec'),m.__dict__);proxy=types.SimpleNamespace(**vars(r));proxy.PLANNING_CONFIG_V3_KERNEL_SHA256=PARENT;return m,proxy

def root_document(r,reference,prefix):
 need(isinstance(reference,dict) and set(reference)=={'path','sha256'} and digest(reference['sha256']) and isinstance(reference['path'],str),'WINDOW_ROOT_REFERENCE')
 p=Path(reference['path']);need(p.parent==r.PROFILES/PROFILE and re.fullmatch(re.escape(prefix)+r'[a-f0-9-]{36}\.json',p.name),'WINDOW_ROOT_PATH')
 raw=r.private_read(p,0,mode=0o640,gid=1000);need(sha(raw)==reference['sha256'],'WINDOW_ROOT_BYTES_CHANGED');return parse(raw)
def window(r,p,fresh=False):
 w=root_document(r,p['windowReference'],'vehicle-window-')
 if w.get('contractVersion')=='cop-root-vehicle-admission-release-v1':
  fields={'contractVersion','windowId','approvedManifestSha256','scope','purpose','admissionLifetime','approvedAt','activateBefore','releaseClientGateRemainsOff','debugClientMayBeEnabled','containment'}
  need(set(w)==fields and r.PROFILE_UUID.fullmatch(w['windowId']) and digest(w['approvedManifestSha256']),'ADMISSION_ROOT_RELEASE_SCHEMA')
  need(w['scope']=='global_authorized_vehicle_members' and w['purpose']=='human_requested_activation' and w['admissionLifetime']=='until_explicit_disable' and w['releaseClientGateRemainsOff'] is True and w['debugClientMayBeEnabled'] is True and w['containment']=='close_cop_then_messaging_keep_cleanup_writers','ADMISSION_ROOT_RELEASE_SCOPE')
  need(type(w['approvedAt']) is int and type(w['activateBefore']) is int and 0<w['activateBefore']-w['approvedAt']<=3600,'ADMISSION_ROOT_RELEASE_TIME')
  if fresh:
   now=int(r.datetime.now(r.timezone.utc).timestamp());need(now>=w['approvedAt'],'WINDOW_NOT_STARTED')
   if p['stage']=='open':need(now<w['activateBefore'],'ADMISSION_RELEASE_ACTIVATION_EXPIRED')
  return {**w,'notBefore':w['approvedAt'],'openBefore':w['activateBefore'],'deadline':w['activateBefore']}
 fields={'contractVersion','windowId','approvedManifestSha256','scope','actorIds','vehicleBudget','durationSeconds','notBefore','openBefore','deadline','containment','clientGateRemainsOff'}
 need(isinstance(w,dict) and set(w)==fields and w['contractVersion']=='cop-root-vehicle-window-v1' and r.PROFILE_UUID.fullmatch(w['windowId']) and digest(w['approvedManifestSha256']),'WINDOW_AUTHORITY_SCHEMA')
 need(w['scope']=='global_not_isolated' and w['vehicleBudget']==1 and type(w['vehicleBudget']) is int and type(w['durationSeconds']) is int and 0<w['durationSeconds']<=1800 and w['clientGateRemainsOff'] is True and w['containment']=='close_cop_then_messaging_keep_cleanup_writers','WINDOW_AUTHORITY_BOUNDS')
 need(isinstance(w['actorIds'],list) and len(w['actorIds'])==len(set(w['actorIds']))==3 and all(isinstance(x,str) and r.PROFILE_UUID.fullmatch(x) for x in w['actorIds']),'WINDOW_ACTOR_BINDING')
 need(all(type(w[k]) is int for k in ('notBefore','openBefore','deadline')) and w['notBefore']<w['openBefore']<=w['deadline'] and 0<w['deadline']-w['notBefore']<=w['durationSeconds'],'WINDOW_DEADLINE')
 if fresh:
  now=int(r.datetime.now(r.timezone.utc).timestamp());need(now>=w['notBefore'],'WINDOW_NOT_STARTED')
  if p['stage']=='open':need(now<w['openBefore'] and now<w['deadline'],'WINDOW_OPEN_EXPIRED')
 return w

def case_for(r,p):
 c=root_document(r,p['caseReference'],'vehicle-window-case-')
 fields={'contractVersion','caseId','stage','windowReference','previous','target','parentProof','sourceEnvironmentMetadata','environmentMetadata','sourceComposeHashes','composeHashes','sourceEnvironmentSha256','targetEnvironmentSha256','sourceSpecSha256','sourceProcess','sourcePeers','baselineSha256','parentReleaseSha256','checkedAt','expiresAt'}
 need(isinstance(c,dict) and set(c)==fields and c['contractVersion']=='cop-root-vehicle-window-case-v1' and c['caseId']==p['transitionId'] and c['stage']==p['stage'],'WINDOW_CASE_SCHEMA')
 need(all(c[k]==p[k] for k in ('windowReference','previous','target','parentProof','sourceEnvironmentMetadata','environmentMetadata','sourceComposeHashes','composeHashes','sourceSpecSha256','baselineSha256','checkedAt','expiresAt')),'WINDOW_CASE_BINDING')
 process=c['sourceProcess'];need(set(process)=={'pid','startedAt','restartCount','running','health'} and type(process['pid']) is int and process['pid']>0 and process['restartCount']==0 and type(process['restartCount']) is int and process['running'] is True and process['health']=='healthy' and isinstance(process['startedAt'],str),'WINDOW_SOURCE_PROCESS')
 need(isinstance(c['sourcePeers'],dict) and all(isinstance(k,str) and digest(v) for k,v in c['sourcePeers'].items()) and all(digest(c[k]) for k in ('sourceEnvironmentSha256','targetEnvironmentSha256','sourceSpecSha256','baselineSha256','parentReleaseSha256')),'WINDOW_CASE_DIGESTS')
 return c

def schema(r,p):
 if p.get('contractVersion')!=WINDOW_VERSION:
  m,proxy=historical(r);return m.schema(proxy,p)
 fields={'contractVersion','transitionId','operation','stage','windowReference','previous','target','changedKeys','ownerAcceptance','checks','cleanReset','parentProof','sourceEnvironmentMetadata','environmentMetadata','sourceComposeHashes','composeHashes','sourceSpecSha256','baselineSha256','caseReference','checkedAt','expiresAt'}
 need(set(p)==fields and r.PROFILE_UUID.fullmatch(p['transitionId']) and p['operation']=='maintain' and p['stage'] in ('open','close') and p['changedKeys']==[FLAG] and p['ownerAcceptance'] is True,'WINDOW_PROOF_SCOPE')
 need(p['target']=={'imageId':IMAGE,'sourceRevision':SOURCE,'profileGeneration':PROFILE} and p['previous']['imageId']==IMAGE,'WINDOW_IMAGE_FIXED')
 need(isinstance(p['checks'],dict) and p['checks'] and all(type(v) is bool and v for v in p['checks'].values()),'WINDOW_EXISTING_CHECKS')
 need(set(p['composeHashes'])==set(p['sourceComposeHashes'])==set(r.FILES) and all(digest(v) for v in [*p['composeHashes'].values(),*p['sourceComposeHashes'].values()]),'WINDOW_COMPOSE_SCOPE')
 changed={k for k in r.FILES if p['composeHashes'][k]!=p['sourceComposeHashes'][k]};need(changed==({'docker-compose.yml'} if p['stage']=='open' else set()),'WINDOW_ONE_MAPPING_FILE_ONLY')
 a,b=map(r.fenced_timestamp,(p['checkedAt'],p['expiresAt']));need(0<b-a<=900,'WINDOW_PROOF_LIFETIME');window(r,p,False);return case_for(r,p)
def evidence(r,p,fresh=True):
 if p.get('contractVersion')!=WINDOW_VERSION:
  m,proxy=historical(r);return m.evidence(proxy,p,fresh)
 c=schema(r,p)
 if fresh:need(r.fenced_timestamp(p['checkedAt'])<=r.datetime.now(r.timezone.utc).timestamp()<=r.fenced_timestamp(p['expiresAt']),'WINDOW_PROOF_EXPIRED');window(r,p,True)
 return c

def read_proof(r,store,path,raw,binding):
 p=parse(raw)
 if p.get('contractVersion')!=WINDOW_VERSION:
  m,proxy=historical(r);return m.read_proof(proxy,store,path,raw,binding)
 c=schema(r,p);need(Path(path)==r.PROFILES/PROFILE/('account-erasure-'+p['transitionId']+'.json') and binding['profileId']==PROFILE and all(binding[k]==p['target'][k] for k in p['target']) and binding['previousReleaseId']==p['previous']['releaseId'],'WINDOW_RELEASE_BINDING')
 old_raw=r.private_read(store.root/'releases'/p['previous']['releaseId']/'release.json',store.uid);need(sha(old_raw)==c['parentReleaseSha256'],'WINDOW_PARENT_RELEASE_CHANGED');old=parse(old_raw);need(old['imageId']==IMAGE and old['sourceRevision']==SOURCE and old['accountErasureConfig']==p['parentProof'],'WINDOW_PARENT_LINEAGE')
 reference=p['parentProof'];need(set(reference) in ({'path','sha256'},{'path','sha256','cleanScope'},{'path','sha256','cleanScope','authScope'}) and digest(reference['sha256']),'WINDOW_PARENT_REFERENCE')
 parent_path=Path(reference['path']);need(parent_path.parent==r.PROFILES/PROFILE and re.fullmatch(r'account-erasure-[a-f0-9-]{36}\.json',parent_path.name),'WINDOW_PARENT_PATH');parent_raw=r.private_read(parent_path,0,mode=0o640,gid=1000);need(sha(parent_raw)==reference['sha256'],'WINDOW_PARENT_BYTES');parent=parse(parent_raw)
 need(all(parent[k]==p[k] for k in ('checks','cleanReset')) and parent['environmentMetadata']==p['sourceEnvironmentMetadata'] and parent['composeHashes']==p['sourceComposeHashes'],'WINDOW_PARENT_PROTECTION_CHANGED')
 if p['stage']=='close':need(parent['contractVersion']==WINDOW_VERSION and parent['stage']=='open' and parent['windowReference']==p['windowReference'],'WINDOW_CLOSE_WRONG_PARENT')
 else:need(parent['contractVersion']==VERSION,'WINDOW_OPEN_WRONG_PARENT')
 return sha(raw),p

def environment(r,actual,desired,p):
 if p.get('contractVersion')!=WINDOW_VERSION:
  m,proxy=historical(r);return m.environment(proxy,actual,desired,p)
 c=evidence(r,p,True);need(sha(encode(actual))==c['sourceEnvironmentSha256'] and sha(encode(desired))==c['targetEnvironmentSha256'],'WINDOW_ENVIRONMENT_CAS')
 changed={k for k in set(actual)|set(desired) if (k in actual)!=(k in desired) or actual.get(k)!=desired.get(k)};need(changed=={FLAG},'WINDOW_EXACT_ONE_FLAG')
 need((FLAG not in actual or actual[FLAG]=='false') and desired.get(FLAG)=='true' if p['stage']=='open' else actual.get(FLAG)=='true' and desired.get(FLAG)=='false','WINDOW_FLAG_DIRECTION')
 need(desired.get('COP_AUTH_MODE')=='oidc' and desired.get('COP_ALLOW_LAB_TOKEN')=='false' and desired.get('COP_ACCOUNT_ERASURE_ENABLED')=='true' and desired.get('COP_ACCOUNT_SAFETY_GUARD_REQUIRED')=='true','WINDOW_PROTECTION_REQUIRED')
 if p['stage']=='close':
  parent=root_document(r,{'path':p['parentProof']['path'],'sha256':p['parentProof']['sha256']},'account-erasure-');opening=case_for(r,parent)
  original=dict(desired);original.pop(FLAG,None)
  need(sha(encode(original))==opening['sourceEnvironmentSha256'] or sha(encode(desired))==opening['sourceEnvironmentSha256'],'WINDOW_CLOSE_NOT_ORIGINAL_OTHER_ENV')

def image(r,docker,inspected,revision):
 m,proxy=historical(r);return m.image(proxy,docker,inspected,revision)
def assert_source(r,store,p):
 c=evidence(r,p,True);need(store.pointer()==p['previous'],'WINDOW_SOURCE_POINTER_CHANGED');directory,_,_=store.binding(p['previous']['releaseId']);v=store.docker.current(directory)
 proc={'pid':v['State']['Pid'],'startedAt':v['State']['StartedAt'],'restartCount':v['RestartCount'],'running':v['State']['Running'],'health':v['State'].get('Health',{}).get('Status')}
 need(v['Id']==p['previous']['containerId'] and v['Image']==IMAGE and proc==c['sourceProcess'] and sha(r.encoded(r.fenced_public_source_spec(v)))==p['sourceSpecSha256'] and store.docker.peers(directory)==c['sourcePeers'],'WINDOW_FRESH_SOURCE_CHANGED')
 rows=[x.split('=',1) for x in v['Config']['Env']];need(all(len(x)==2 for x in rows) and len({x[0] for x in rows})==len(rows) and sha(encode(dict(rows)))==c['sourceEnvironmentSha256'],'WINDOW_SOURCE_ENVIRONMENT_CHANGED');return v

@contextmanager
def health_scope(r,store,p):
 if p.get('contractVersion')!=WINDOW_VERSION:
  m,proxy=historical(r)
  with m.health_scope(proxy,store,p):yield
  return
 assert_source(r,store,p);need(getattr(store.docker,'planning_config_v3_health_scope',None) is None,'WINDOW_NESTED_HEALTH')
 baseline_path=r.PROFILES/PROFILE/('planning-config-v3-source-health-'+p['transitionId']+'.json');baseline=r.private_read(baseline_path,0,mode=0o640,gid=1000);need(sha(baseline)==p['baselineSha256'],'WINDOW_BASELINE_CHANGED');r.health_statuses(parse(baseline))
 hp=r.PROFILES/PROFILE/('planning-config-v3-health-'+HEALTH+'.py');hr=r.private_read(hp,0,mode=0o640,gid=1000);need(sha(hr)==HEALTH,'WINDOW_HEALTH_READER_CHANGED');h=types.ModuleType('unchanged_health_reader');exec(compile(hr,str(hp),'exec'),h.__dict__)
 had='health' in store.docker.__dict__;prior=store.docker.__dict__.get('health');calls=[]
 def scoped(action,path):
  need((action=='capture' and path is None and calls==[]) or (action=='verify' and Path(path)==store.root/'pending-health.json' and calls==['capture']),'WINDOW_HEALTH_ORDER')
  if action=='verify':need(sha(r.private_read(path,store.uid))==p['baselineSha256'],'WINDOW_PENDING_BASELINE_CHANGED')
  started=time.monotonic();verified,observation=h.verify(r,baseline)
  if action=='verify':
   pending=r.private_json(store.root/'pending.json',store.uid);need(pending['previous']==p['previous'],'WINDOW_PENDING_CAS');directory,binding,_=store.binding(pending['targetReleaseId']);v=store.docker.current(directory)
   while v['State'].get('Health',{}).get('Status')=='starting':
    need(v['Id']==pending['targetContainerId'] and v['Image']==IMAGE and v['RestartCount']==0 and v['State']['Running'] is True and time.monotonic()<started+120,'WINDOW_TARGET_WAIT');time.sleep(1);v=store.docker.current(directory)
   need(binding['imageId']==IMAGE and binding['sourceRevision']==SOURCE and v['Id']==pending['targetContainerId'] and v['Image']==IMAGE and v['RestartCount']==0 and v['State']['Running'] is True and v['State'].get('Health',{}).get('Status')=='healthy','WINDOW_TARGET_UNPROVEN')
  store.write(store.root/('vehicle-window-'+p['transitionId']+'-'+action+'-health-observation.json'),r.encoded(observation));calls.append(action);return baseline if action=='capture' else verified
 store.docker.planning_config_v3_health_scope=p;store.docker.health=scoped
 try:yield
 finally:
  if had:store.docker.health=prior
  else:del store.docker.health
  store.docker.planning_config_v3_health_scope=None
