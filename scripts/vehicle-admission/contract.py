"""Offline finite admission contract. No authority, credentials or host mutation."""
import copy,datetime,hashlib,json,re
COP_FLAG='COP_SHARED_VEHICLE_COMMUNICATION_ENABLED'
MESSAGING_FLAG='CSM_SHARED_VEHICLE_COMMUNICATION_ADMISSION_ENABLED'
COP_IMAGE='sha256:1338179f0f66abf904aad04da82fc87f82f9676d758842bd00eec4b9e0662d7d'
COP_SOURCE='00c854d56eb9fd4346e26dade622776c83bee9a5'
MESSAGING_IMAGE='sha256:9a69b3f3b318732cfc175207df344c2bb724bbcd488db3383ac14d790e045c05'
MESSAGING_SOURCE='19c9b39669877dfeacbe1bd996e9c8da7c4cd1ec'
ISSUER='https://login.zeleznalady.cz/realms/cop'
COP_ORIGIN='https://cop.zeleznalady.cz'
BASE_COMPOSE_SHA='25d29b0e1d8c9a87fbc1c74d402ca4d9ec268581ecdf4c7cbfa0ade4797ecc6a'
ANCHOR=b'      COP_ROUTING_PLANNING_ENABLED: "${COP_ROUTING_PLANNING_ENABLED:-false}"\n'
MAPPING=b'      COP_SHARED_VEHICLE_COMMUNICATION_ENABLED: "${COP_SHARED_VEHICLE_COMMUNICATION_ENABLED:-false}"\n'
CASES=('stable-binding','explicit-join','outsider','source-pending','pending-restart','revoke-joined','revoke-invited','stale-context','history-and-keys','notifications','vehicle-close','lifecycle','privacy-boundaries')
UUID=re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}')
class Rejected(ValueError):pass
def need(v,code):
 if not v:raise Rejected(code)
def encode(v):return json.dumps(v,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def parse(raw):
 need(isinstance(raw,bytes) and len(raw)<=65536,'WINDOW_DOCUMENT_BOUND')
 def pairs(items):
  out={}
  for k,v in items:need(k not in out,'WINDOW_DUPLICATE_KEY');out[k]=v
  return out
 return json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(Rejected('WINDOW_NONFINITE')))
def effective_delta(actual,desired,stage):
 need(stage in ('open','close') and isinstance(actual,dict) and isinstance(desired,dict),'WINDOW_DELTA_SHAPE')
 changed={k for k in set(actual)|set(desired) if (k in actual)!=(k in desired) or actual.get(k)!=desired.get(k)}
 need(changed=={COP_FLAG},'WINDOW_EXACT_ONE_FLAG')
 need((COP_FLAG not in actual or actual[COP_FLAG]=='false') and desired.get(COP_FLAG)=='true' if stage=='open' else actual.get(COP_FLAG)=='true' and desired.get(COP_FLAG)=='false','WINDOW_FLAG_DIRECTION')
 for k,v in [('COP_AUTH_MODE','oidc'),('COP_ALLOW_LAB_TOKEN','false'),('COP_ACCOUNT_ERASURE_ENABLED','true'),('COP_ACCOUNT_SAFETY_GUARD_REQUIRED','true')]:need(desired.get(k)==v,'WINDOW_PROTECTION_REQUIRED')
 return True
def env_delta(before,stage):
 need(isinstance(before,bytes) and len(before)<=1048576 and b'\0' not in before and stage in ('open','close'),'WINDOW_ENV_BYTES')
 matches=list(re.finditer(rb'(?m)^[ \t]*(?:export[ \t]+)?'+COP_FLAG.encode()+rb'[ \t]*=(.*)$',before))
 need(len(matches)<=1,'WINDOW_DUPLICATE_FLAG')
 if stage=='open' and not matches:
  return before+(b'' if not before or before.endswith(b'\n') else b'\n')+COP_FLAG.encode()+b'=true\n'
 need(len(matches)==1,'WINDOW_FLAG_MISSING')
 m=matches[0];expected=b'false' if stage=='open' else b'true';need(m.group(1)==expected and m.group(0)==COP_FLAG.encode()+b'='+expected,'WINDOW_NONCANONICAL_FLAG')
 return before[:m.start()]+COP_FLAG.encode()+(b'=true' if stage=='open' else b'=false')+before[m.end():]
def emergency_env_off(before):
 need(isinstance(before,bytes) and len(before)<=1048576 and b'\0' not in before,'WINDOW_ENV_BYTES')
 rows=list(re.finditer(rb'(?m)^[ \t]*(?:export[ \t]+)?'+COP_FLAG.encode()+rb'[ \t]*=(.*)$',before));need(len(rows)<=1,'WINDOW_DUPLICATE_FLAG')
 if not rows:return before+(b'' if not before or before.endswith(b'\n') else b'\n')+COP_FLAG.encode()+b'=false\n'
 row=rows[0];need(row.group(0) in (COP_FLAG.encode()+b'=true',COP_FLAG.encode()+b'=false'),'WINDOW_NONCANONICAL_FLAG')
 return before[:row.start()]+COP_FLAG.encode()+b'=false'+before[row.end():]

def compose_delta(before,stage):
 need(stage in ('open','close') and isinstance(before,bytes),'WINDOW_COMPOSE_SHAPE')
 if stage=='close':
  need(before.count(MAPPING)==1 and before.count(COP_FLAG.encode())==2,'WINDOW_MAPPING_MISSING');return before
 need(sha(before)==BASE_COMPOSE_SHA and COP_FLAG.encode() not in before and before.count(ANCHOR)==1 and before.startswith(b'services:\n  cop-api:\n'),'WINDOW_COMPOSE_BASELINE')
 at=before.index(ANCHOR);next_service=re.search(rb'(?m)^  [a-zA-Z0-9_-]+:\s*$',before[len(b'services:\n  cop-api:\n'):]);need(next_service is None or at<len(b'services:\n  cop-api:\n')+next_service.start(),'WINDOW_MAPPING_WRONG_SERVICE')
 return before.replace(ANCHOR,ANCHOR+MAPPING,1)
def validate_window(w,now,*,opening):
 fields={'contractVersion','windowId','approvedManifestSha256','scope','identityBudget','vehicleBudget','durationSeconds','notBefore','openBefore','deadline','actorIds','cases','clientGateRemainsOff','containment'}
 need(isinstance(w,dict) and set(w)==fields and w['contractVersion']=='cop-global-vehicle-admission-window-v1','WINDOW_SCHEMA')
 need(isinstance(w['windowId'],str) and UUID.fullmatch(w['windowId']) and isinstance(w['approvedManifestSha256'],str) and re.fullmatch('[0-9a-f]{64}',w['approvedManifestSha256']),'WINDOW_BINDING')
 need(w['scope']=='global_not_isolated' and type(w['identityBudget']) is int and w['identityBudget']==3 and type(w['vehicleBudget']) is int and w['vehicleBudget']==1 and type(w['durationSeconds']) is int and 0<w['durationSeconds']<=1800,'WINDOW_BUDGET')
 need(w['cases']==list(CASES) and w['clientGateRemainsOff'] is True and w['containment']=='close_cop_then_messaging_keep_cleanup_writers','WINDOW_SCOPE')
 need(isinstance(w['actorIds'],list) and len(w['actorIds'])==3 and len(set(w['actorIds']))==3 and all(isinstance(x,str) and UUID.fullmatch(x) for x in w['actorIds']),'WINDOW_REAL_ACTOR_BINDINGS')
 for k in ('notBefore','openBefore','deadline'):need(type(w[k]) is int,'WINDOW_TIME_TYPE')
 need(w['notBefore']<w['openBefore']<=w['deadline'] and 0<w['deadline']-w['notBefore']<=w['durationSeconds'],'WINDOW_TIME_BOUND')
 need(type(now) is int and now>=w['notBefore'],'WINDOW_NOT_STARTED')
 if opening:need(now<w['openBefore'] and now<w['deadline'],'WINDOW_OPEN_EXPIRED')
 # Expiry prohibits NEW admission; it never revokes authority to close intake.
 return w

def process_cas(before,fresh):
 return before['Id']==fresh['Id'] and before['Image']==fresh['Image'] and before['State']['Pid']==fresh['State']['Pid'] and before['State']['StartedAt']==fresh['State']['StartedAt'] and fresh['State']['Running'] is True and fresh['RestartCount']==0 and fresh['State'].get('Health',{}).get('Status')=='healthy'
