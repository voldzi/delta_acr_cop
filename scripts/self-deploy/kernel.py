"""Image-only application release proof. Historical guards delegate unchanged.
Only Root-owned case/compatibility records authorize a new candidate. No installer,
shell, builder, secret reader, configuration writer or automatic rollback here.
"""
import hashlib,json,re,types
from contextlib import contextmanager
from pathlib import Path
VERSION='cop-application-owned-image-v1'
PROFILE='206c4507-5e00-458e-b0ee-4061309aa7a8'
PARENT='6609d8c272c8ec534a96de3233e85a50bddb062bb388bf8417de05f6d7b384b9'
HEALTH='e7eb01a0b41dcbbcfda0652a4d322c5f0d5d0eb4b6c411e1e6db174d8a596066'
KEYS=frozenset({'COP_ROUTING_PLANNING_ENABLED','COP_ROUTING_PLANNING_SERVICE_TOKEN','COP_AUTH_MODE','COP_ALLOW_LAB_TOKEN','COP_SHARED_VEHICLE_COMMUNICATION_ENABLED'})
def need(ok,code):
 if not ok:raise ValueError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def digest(value):return isinstance(value,str) and re.fullmatch('[a-f0-9]{64}',value) is not None
def parse(raw):
 need(isinstance(raw,bytes) and len(raw)<=65536,'APP_PROOF_BOUND')
 def pairs(items):
  out={}
  for k,v in items:
   need(k not in out,'APP_DUPLICATE_KEY');out[k]=v
  return out
 return json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(ValueError('APP_NONFINITE')))
def historical(r):
 path=r.PROFILES/PROFILE/('planning-config-v3-kernel-'+PARENT+'.py')
 raw=r.private_read(path,0,mode=0o640,gid=1000);need(sha(raw)==PARENT,'APP_PARENT_KERNEL_CHANGED')
 m=types.ModuleType('unchanged_application_parent');exec(compile(raw,str(path),'exec'),m.__dict__)
 proxy=types.SimpleNamespace(**vars(r));proxy.PLANNING_CONFIG_V3_KERNEL_SHA256=PARENT
 return m,proxy
def root_document(r,ref,prefix):
 need(isinstance(ref,dict) and set(ref)=={'path','sha256'} and digest(ref['sha256']),'APP_ROOT_REFERENCE')
 p=Path(ref['path']);need(p.parent==r.PROFILES/PROFILE and re.fullmatch(re.escape(prefix)+r'[a-f0-9-]{36}\.json',p.name),'APP_ROOT_PATH')
 raw=r.private_read(p,0,mode=0o640,gid=1000);need(sha(raw)==ref['sha256'],'APP_ROOT_DOCUMENT_CHANGED');return parse(raw)
def schema(r,p):
 if p.get('contractVersion')!=VERSION:return historical(r)[0].schema(historical(r)[1],p)
 keys={'contractVersion','transitionId','operation','previous','target','changedKeys','environmentMetadata','composeHashes','ownerAcceptance','checks','cleanReset','parentProof','caseReference','checkedAt','expiresAt','sourceSpecSha256','baselineSha256'}
 need(set(p)==keys and p['operation']=='maintain' and p['changedKeys']==[] and p['ownerAcceptance'] is True and r.PROFILE_UUID.fullmatch(p['transitionId']),'APP_IMAGE_ONLY_SCOPE')
 t=p['target'];need(set(t)=={'imageId','sourceRevision','profileGeneration'} and r.IMAGE.fullmatch(t['imageId']) and r.REVISION.fullmatch(t['sourceRevision']) and t['profileGeneration']==PROFILE,'APP_TARGET_IDENTITY')
 need(digest(p['sourceSpecSha256']) and digest(p['baselineSha256']) and 0<r.fenced_timestamp(p['expiresAt'])-r.fenced_timestamp(p['checkedAt'])<=900,'APP_PROOF_WINDOW')
 c=root_document(r,p['caseReference'],'application-image-case-')
 expected={'contractVersion','caseId','approvalRef','previous','target','parentProof','environmentMetadata','composeHashes','sourceSpecSha256','sourceEnvironmentSha256','baselineSha256','checkedAt','expiresAt','compatibilityReference','parentReleaseSha256','sourceProcess'}
 need(set(c)==expected and c['contractVersion']=='cop-application-image-case-v1' and c['caseId']==p['transitionId'] and c['approvalRef']=='cop-application-self-release-policy-v1','APP_CASE_SCOPE')
 process=c['sourceProcess'];need(isinstance(process,dict) and set(process)=={'pid','restartCount','startedAt','running'} and type(process['pid']) is int and process['pid']>0 and type(process['restartCount']) is int and process['restartCount']>=0 and process['running'] is True,'APP_SOURCE_PROCESS_SCOPE')
 need(all(c[k]==p[k] for k in ('previous','target','parentProof','environmentMetadata','composeHashes','sourceSpecSha256','baselineSha256','checkedAt','expiresAt')) and digest(c['sourceEnvironmentSha256']) and digest(c['parentReleaseSha256']),'APP_CASE_BINDING')
 v=root_document(r,c['compatibilityReference'],'application-image-compatibility-')
 need(set(v)=={'contractVersion','target','checks','sourceContextDigest','buildReceiptSha256'} and v['contractVersion']=='cop-application-image-compatibility-v1' and v['target']==t and digest(v['sourceContextDigest']) and digest(v['buildReceiptSha256']),'APP_COMPATIBILITY_BINDING')
 need(isinstance(v['checks'],dict) and all(type(item) is bool for item in v['checks'].values()) and v['checks']=={'x5RuntimeGuard':True,'sharpConversion':True,'databaseRouting':True,'actualImageTests':True,'sameRuntimeEnvironment':True,'sameTopology':True},'APP_COMPATIBILITY_UNPROVEN')
 return c

def evidence(r,p,fresh=True):
 if p.get('contractVersion')!=VERSION:
  m,proxy=historical(r);return m.evidence(proxy,p,fresh)
 c=schema(r,p)
 if fresh:need(r.fenced_timestamp(p['checkedAt'])<=r.datetime.now(r.timezone.utc).timestamp()<=r.fenced_timestamp(p['expiresAt']),'APP_EXPIRED')
 return c

def read_proof(r,store,path,raw,binding):
 p=parse(raw)
 if p.get('contractVersion')!=VERSION:
  m,proxy=historical(r);return m.read_proof(proxy,store,path,raw,binding)
 schema(r,p)
 need(Path(path)==r.PROFILES/PROFILE/('account-erasure-'+p['transitionId']+'.json') and all(binding[k]==p['target'][k] for k in p['target']) and binding['previousReleaseId']==p['previous']['releaseId'] and binding['profileId']==PROFILE,'APP_RELEASE_BINDING')
 c=schema(r,p)
 previous_path=store.root/'releases'/p['previous']['releaseId']/'release.json'
 previous_raw=r.private_read(previous_path,store.uid)
 need(sha(previous_raw)==c['parentReleaseSha256'],'APP_PARENT_RELEASE_CHANGED')
 old=parse(previous_raw)
 need(old['imageId']==p['previous']['imageId'] and old['accountErasureConfig']==p['parentProof'],'APP_PARENT_RELEASE_CHANGED')
 parent_path=Path(p['parentProof']['path'])
 need(parent_path.parent==r.PROFILES/PROFILE and re.fullmatch(r'account-erasure-[a-f0-9-]{36}\.json',parent_path.name),'APP_PARENT_PATH')
 parent_raw=r.private_read(parent_path,0,mode=0o640,gid=1000)
 need(sha(parent_raw)==p['parentProof']['sha256'],'APP_PARENT_PROOF_CHANGED')
 # Root sealed the exact already-accepted predecessor. Do not recursively
 # revalidate every earlier release (which causes exponential lineage reads).
 parent=parse(parent_raw)
 need(all(p[k]==parent[k] for k in ('checks','cleanReset','environmentMetadata','composeHashes')),'APP_EXISTING_PROTECTION_CHANGED')
 return sha(raw),p

def environment(r,actual,desired,p):
 if p.get('contractVersion')!=VERSION:
  m,proxy=historical(r);return m.environment(proxy,actual,desired,p)
 c=evidence(r,p,True)
 need(actual==desired and sha(r.encoded(actual))==c['sourceEnvironmentSha256'],'APP_ENVIRONMENT_CHANGED')
 need(desired.get('COP_AUTH_MODE')=='oidc' and desired.get('COP_ALLOW_LAB_TOKEN')=='false' and desired.get('COP_ACCOUNT_ERASURE_ENABLED')=='true','APP_PROTECTION_REQUIRED')

def image(r,docker,inspected,revision):
 m,proxy=historical(r);return m.image(proxy,docker,inspected,revision)

def assert_source(r,store,p):
 c=evidence(r,p,True)
 need(store.pointer()==p['previous'],'APP_SOURCE_POINTER_CHANGED')
 directory,_,_=store.binding(p['previous']['releaseId']);current=store.docker.current(directory)
 need(current['Id']==p['previous']['containerId'] and sha(r.encoded(r.fenced_public_source_spec(current)))==p['sourceSpecSha256'],'APP_SOURCE_SPEC_CHANGED')
 observed={'pid':current['State']['Pid'],'restartCount':current['RestartCount'],'startedAt':current['State']['StartedAt'],'running':current['State']['Running']}
 need(observed==c['sourceProcess'],'APP_SOURCE_PROCESS_CHANGED')
 values=dict(item.split('=',1) for item in current['Config'].get('Env',[]) if '=' in item)
 need(sha(r.encoded(values))==c['sourceEnvironmentSha256'],'APP_SOURCE_ENVIRONMENT_CHANGED')
 return current

@contextmanager
def health_scope(r,store,p):
 if p.get('contractVersion')!=VERSION:
  m,proxy=historical(r)
  with m.health_scope(proxy,store,p):yield
  return
 assert_source(r,store,p)
 need(getattr(store.docker,'planning_config_v3_health_scope',None) is None,'APP_HEALTH_NESTED')
 baseline_path=r.PROFILES/PROFILE/('planning-config-v3-source-health-'+p['transitionId']+'.json')
 baseline=r.private_read(baseline_path,0,mode=0o640,gid=1000);need(sha(baseline)==p['baselineSha256'],'APP_BASELINE_CHANGED');r.health_statuses(parse(baseline))
 path=r.PROFILES/PROFILE/('planning-config-v3-health-'+HEALTH+'.py');raw=r.private_read(path,0,mode=0o640,gid=1000);need(sha(raw)==HEALTH,'APP_HEALTH_READER_CHANGED')
 health=types.ModuleType('unchanged_application_health');exec(compile(raw,str(path),'exec'),health.__dict__)
 had='health' in store.docker.__dict__;prior=store.docker.__dict__.get('health');calls=[]
 def scoped(action,path):
  need((action=='capture' and path is None and calls==[]) or (action=='verify' and Path(path)==store.root/'pending-health.json' and calls==['capture']),'APP_HEALTH_ORDER')
  if action=='verify':need(sha(r.private_read(path,store.uid))==p['baselineSha256'],'APP_PENDING_BASELINE_CHANGED')
  started=__import__('time').monotonic();verified,observation=health.verify(r,baseline)
  if action=='verify':
   pending=r.private_json(store.root/'pending.json',store.uid);need(pending['previous']==p['previous'],'APP_PENDING_CAS')
   directory,binding,profile=store.binding(pending['targetReleaseId']);actual=store.docker.current(directory)
   while actual['State'].get('Health',{}).get('Status')=='starting':
    need(actual['Id']==pending['targetContainerId'] and actual['Image']==p['target']['imageId'] and actual['RestartCount']==0 and actual['State']['Running'] is True and __import__('time').monotonic()<started+120,'APP_TARGET_WAIT')
    __import__('time').sleep(1);actual=store.docker.current(directory)
   need(binding['imageId']==p['target']['imageId'] and binding['sourceRevision']==p['target']['sourceRevision'] and actual['Id']==pending['targetContainerId'] and actual['Image']==p['target']['imageId'] and actual['RestartCount']==0 and actual['State']['Running'] is True and actual['State'].get('Health',{}).get('Status')=='healthy','APP_TARGET_UNPROVEN')
  store.write(store.root/('application-image-'+p['transitionId']+'-'+action+'-health-observation.json'),r.encoded(observation));calls.append(action)
  return baseline if action=='capture' else verified
 store.docker.planning_config_v3_health_scope=p;store.docker.health=scoped
 try:yield
 finally:
  if had:store.docker.health=prior
  else:del store.docker.health
  store.docker.planning_config_v3_health_scope=None
