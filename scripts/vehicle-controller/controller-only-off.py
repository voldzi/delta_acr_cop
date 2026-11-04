#!/usr/bin/python3
"""Finite COMM controller/custody/config action. Never enables admission.
Review artifact only until explicitly executed. No arbitrary identities/paths.
"""
import argparse, copy, datetime, fcntl, hashlib, json, os, socket, stat, subprocess, time
from pathlib import Path
IMAGE='sha256:e9c50077e596718f267b65422e5c95169ea6e3f88d55ce734c5d5939183b9907'
CID='2aca47ebb9140f0c75e27fc580054545c30acf5415b7742fb0789f2e55d3e5b5'
CONTROLLER='@csm.vehicle.controller.v1:docker.home.cz'
CONTAINER='csm-messaging-api'
PIN=Path('/srv/csm-messaging/account-safety/disabled-runtime-portable.compose.json')
FILES=['/srv/csm-messaging/docker-compose.yml','/srv/csm-messaging/docker-compose.pool-budget-20261012.json','/srv/csm-messaging/docker-compose.cop-erasure-candidate-20261015.json','/srv/csm-messaging/docker-compose.livekit-erasure-unix-cc26a20.json','/srv/csm-messaging/docker-compose.messaging-private-client-8012490.json',str(PIN)]
ENVFILE=Path('/srv/csm-messaging/.env')
CASE=Path('/srv/csm-messaging/account-safety/controller-only-v1')
BASELINE={'containerId': '2aca47ebb9140f0c75e27fc580054545c30acf5415b7742fb0789f2e55d3e5b5', 'imageId': 'sha256:e9c50077e596718f267b65422e5c95169ea6e3f88d55ce734c5d5939183b9907', 'startedAt': '2026-11-04T16:37:38.311942467Z', 'pid': 146258, 'runtimeSha256': '33fdb795f220f5cc56cb7cea3ecc468729f9b1a42c9fa09fcc9d9c2799fa44ef', 'inputSha256': {'/srv/csm-messaging/docker-compose.yml': 'a14e744dc5a1ae680dd32edbc4e3ed2eec703c414984de7186c9b4d0d40fa379', '/srv/csm-messaging/docker-compose.pool-budget-20261012.json': '81edf4c135a6322ca246c432e4e742e819b9b650d2c4f56efb484ef8bb370ba7', '/srv/csm-messaging/docker-compose.cop-erasure-candidate-20261015.json': '9510df2c302c7d1d984293cde739b438126f1f1130bda7afc4b6fd2b67c9b3c9', '/srv/csm-messaging/docker-compose.livekit-erasure-unix-cc26a20.json': 'b939c8294e37eca6f4add2fb50764a74cfec789dde74dfce4d0caf5b9e6cd7df', '/srv/csm-messaging/docker-compose.messaging-private-client-8012490.json': 'b096a10bb06fdf1474ab7dd8a015a4d0518f1a0b37953366ff7b289879bd5ad7', '/srv/csm-messaging/account-safety/disabled-runtime-portable.compose.json': 'c2d70f07dd5df6cc62cd1dcc02acabc8d1afca29a516afeefc39f98a94d7e035', '/srv/csm-messaging/.env': 'a48500818bee855dad928494443b3d9871b88750cff8c6c863c2a6ebc2606c67'}, 'peers': {'/csm-matrix-synapse': '6b6edd6e50dac87a39ede98bbfacca0b250953b7e9fd50b9cf0fd258178a239c', '/csm-matrix-synapse-failed-b42cf080c81241f3ae28a941204f61d0': '200492f6be4facb8f10b17efe8afd683ca3b709377384d212ca167557e2c935a', '/csm-matrix-synapse-rollback-06976bb832c3402db460f20ff4507af6': '1b21c94079bfe80a4f00ecc0c0ae3daf1216741e13b8cb0518a7b24398687f30', '/csm-livekit-erasure-proxy': '0df9d3dc78ed78ab47a70539a38880e498a8923acadf6be1341153109df0033e'}}
DELTA={'CSM_VEHICLE_CONTROLLER_MATRIX_USER_ID':CONTROLLER,'CSM_VEHICLE_CONTROLLER_CUSTODY_REVIEWED':'true'}
ADMISSION='CSM_SHARED_VEHICLE_COMMUNICATION_ADMISSION_ENABLED'
ENV={'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/root','LANG':'C','DOCKER_HOST':'unix:///var/run/docker.sock'}
class Stop(Exception): pass
def need(ok,code):
 if not ok: raise Stop(code)
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def write_all(fd,raw):
 view=memoryview(raw)
 while view:
  n=os.write(fd,view);need(n>0,'SHORT_WRITE');view=view[n:]
def sync_dir(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def envmap(v):
 pairs=[x.split('=',1) for x in v];need(all(len(x)==2 for x in pairs) and len({x[0] for x in pairs})==len(pairs),'ENV_DUPLICATE_OR_INVALID');return dict(pairs)
def runtime_spec(v):
 return copy.deepcopy({'image':v['Image'],'config':v['Config'],'host':v['HostConfig'],'mounts':sorted(v['Mounts'],key=lambda x:x['Destination']),'networks':{n:net['NetworkID'] for n,net in v['NetworkSettings']['Networks'].items()}})
def validate_live(v):
 need(v['Id']==CID and v['Image']==IMAGE,'RUNTIME_IDENTITY_CHANGED')
 need(v['State']['Running'] and v['State'].get('Health',{}).get('Status')=='healthy' and v['RestartCount']==0,'RUNTIME_NOT_HEALTHY')
 e=envmap(v['Config']['Env'])
 need(e.get(ADMISSION,'false')=='false' and not e.get('CSM_VEHICLE_CONTROLLER_MATRIX_USER_ID') and e.get('CSM_VEHICLE_CONTROLLER_CUSTODY_REVIEWED','false')=='false','CONTROLLER_OR_ADMISSION_ALREADY_SET')
 need(v['Config']['Labels']['com.docker.compose.project.config_files'].split(',')==FILES,'COMPOSE_FILES_CHANGED')
 return e

def proposed_pin(raw):
 value=json.loads(raw);new=copy.deepcopy(value)
 service=new['services']['api'];need(service['image']==IMAGE,'PIN_IMAGE_CHANGED')
 target=service.setdefault('environment',{})
 need(isinstance(target,dict),'PIN_ENVIRONMENT_TYPE')
 for k in DELTA:need(k not in target or target[k] in ('','false',None),'PIN_CONTROLLER_ALREADY_SET')
 need(target.get(ADMISSION,'false')=='false','PIN_ADMISSION_ENABLED')
 target.update(DELTA)
 return encoded(new)+b'\n'

def assert_render_delta(before,after):
 expected=copy.deepcopy(before);e=expected['services']['api'].setdefault('environment',{});e.update(DELTA)
 need(after==expected,'RENDER_EXCEEDS_TWO_CONTROLLER_KEYS')
 need(after['services']['api']['environment'].get(ADMISSION,'false')=='false','RENDER_ADMISSION_ENABLED')

def post_runtime(before,after):
 need(after['Image']==IMAGE and after['State']['Running'] and after['RestartCount']==0 and after['State'].get('Health',{}).get('Status')=='healthy','TARGET_NOT_HEALTHY')
 expected=runtime_spec(before);actual=runtime_spec(after)
 ee=envmap(expected['config']['Env']);ee.update(DELTA);aa=envmap(actual['config']['Env'])
 need(aa==ee and aa.get(ADMISSION,'false')=='false','TARGET_ENVIRONMENT_CHANGED')
 for obj in (expected,actual):
  obj['config'].pop('Env',None)
  hostname=obj['config'].get('Hostname')
  own=before if obj is expected else after
  need(hostname==own['Id'][:12] or hostname==before['Config'].get('Hostname'),'HOSTNAME_SCOPE')
  if hostname==own['Id'][:12]:obj['config']['Hostname']='<docker-auto-hostname>'
  obj['config']['Labels'].pop('com.docker.compose.config-hash',None)
 need(actual==expected,'TARGET_RUNTIME_PARITY_FAILED')

# Runs only inside the existing Synapse container. All credentials stay in memory.
# Only the exact controller row is read; no identities/keys/hashes are returned.
SYNAPSE_CODE=r'''
import json,sys,urllib.request,urllib.error,urllib.parse,os,hmac,hashlib,secrets,time
p=json.load(sys.stdin)
controller='@csm.vehicle.controller.v1:docker.home.cz'
assert p['controller']==controller
path='/_synapse/admin/v2/users/'+urllib.parse.quote(controller,safe='')
def api(method,path,body=None,token=None):
 raw=None if body is None else json.dumps(body).encode()
 req=urllib.request.Request('http://127.0.0.1:8008'+path,data=raw,method=method,headers={'Authorization':'Bearer '+(token or p['token']),'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=8) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:
  try:return e.code,json.load(e)
  except Exception:return e.code,{}
  finally:e.close()
def database():
 import yaml,psycopg2
 with open(os.environ.get('SYNAPSE_CONFIG_PATH','/data/homeserver.yaml')) as f:cfg=yaml.safe_load(f)
 args=dict(cfg['database']['args']);args.pop('cp_min',None);args.pop('cp_max',None);args.pop('keepalives_idle',None);args.pop('keepalives_interval',None);args.pop('keepalives_count',None)
 assert args.get('database',args.get('dbname'))=='csm_synapse'
 c=psycopg2.connect(**args,connect_timeout=5);c.set_session(readonly=True,autocommit=False)
 return c,cfg
def pending_deactivation():
 c,_=database()
 try:
  with c.cursor() as q:
   q.execute("SET LOCAL statement_timeout='5s'")
   q.execute('SELECT count(*) FROM users_pending_deactivation WHERE user_id=%s',(controller,));n=q.fetchone()[0]
  c.rollback();return n
 finally:c.close()
try:
 mode=p['mode']
 if mode=='absence':
  status,data=api('GET',path)
  result={'absent':status==404 and data.get('errcode')=='M_NOT_FOUND'}
 elif mode=='create':
  # GET is informative, NOT a concurrency guarantee. Shared-secret POST goes
  # directly to register_user: duplicate localpart fails; it never updates.
  status,data=api('GET',path)
  if status!=404 or data.get('errcode')!='M_NOT_FOUND':raise ValueError()
  import yaml
  with open(os.environ.get('SYNAPSE_CONFIG_PATH','/data/homeserver.yaml')) as f:cfg=yaml.safe_load(f)
  secret=cfg.get('registration_shared_secret');assert isinstance(secret,str) and secret
  status,nonce_result=api('GET','/_synapse/admin/v1/register');assert status==200
  nonce=nonce_result['nonce'];username='csm.vehicle.controller.v1'
  # Endpoint requires an initial password. It is random, never delivered or
  # logged, inhibits login and is removed by supported deactivation BEFORE
  # reactivation/custody/configuration. No user/device/crypto bootstrap occurs.
  password=secrets.token_urlsafe(64)
  fields=[nonce.encode(),username.encode(),password.encode(),b'notadmin',b'bot']
  mac=hmac.new(secret.encode(),b'\x00'.join(fields),hashlib.sha1).hexdigest()
  status,data=api('POST','/_synapse/admin/v1/register',{'nonce':nonce,'username':username,'password':password,'admin':False,'user_type':'bot','mac':mac,'inhibit_login':True})
  del password,secret,fields,mac
  if status!=200 or data.get('user_id')!=controller or any(k in data for k in ('access_token','refresh_token','device_id')):raise ValueError()
  # These updates are allowed ONLY following this invocation's create-only
  # success. On collision, timeout or lost response, do not adopt/update.
  status,data=api('PUT',path,{'deactivated':True});assert status==200 and data.get('deactivated') is True
  # Synapse removes this queue row only AFTER _part_user completes. Rejoining
  # an active controller before that could cause delayed room removal.
  deadline=time.monotonic()+10
  while pending_deactivation()!=0:
   if time.monotonic()>=deadline:raise ValueError()
   time.sleep(0.1)
  status,data=api('PUT',path,{'deactivated':False});assert status==200 and data.get('deactivated') is False
  result={'created':True}
 elif mode=='probe':
  until=int(time.time()*1000)+60000
  status,login=api('POST','/_synapse/admin/v1/users/'+urllib.parse.quote(controller,safe='')+'/login',{'valid_until_ms':until})
  assert status==200 and isinstance(login.get('access_token'),str) and login['access_token']
  control_token=login['access_token'];unexpected_device=bool(login.get('device_id'));del login
  identity=False;logout=False
  try:
   assert not unexpected_device
   status,who=api('GET','/_matrix/client/v3/account/whoami',token=control_token)
   identity=status==200 and who.get('user_id')==controller
  finally:
   status,_=api('POST','/_matrix/client/v3/logout',{},token=control_token)
   logout=status==200
   del control_token
  result={'identityProven':identity,'logoutProven':logout,'ttlBounded':True}
 elif mode in ('custody','prerequisites'):
  if mode=='custody':
   status,u=api('GET',path);assert status==200
   status,d=api('GET',path+'/devices');assert status==200
  c,cfg=database()
  try:
   c.set_session(readonly=True,autocommit=False)
   with c.cursor() as q:
    q.execute("SET LOCAL statement_timeout='5s'")
    q.execute('SELECT password_hash IS NULL FROM users WHERE name=%s',(controller,));passwordless=q.fetchone()==(True,)
    counts={}
    for table in ('devices','access_tokens','refresh_tokens','e2e_device_keys_json','e2e_one_time_keys_json','e2e_fallback_keys_json','e2e_cross_signing_keys','users_pending_deactivation'):
     q.execute('SELECT count(*) FROM '+table+' WHERE user_id=%s',(controller,));counts[table]=q.fetchone()[0]
    q.execute('SELECT count(*) FROM e2e_cross_signing_signatures WHERE user_id=%s OR target_user_id=%s',(controller,controller));counts['signatures']=q.fetchone()[0]
    q.execute("SELECT count(*) FROM room_memberships WHERE user_id=%s AND membership IN ('join','invite')",(controller,));counts['memberships']=q.fetchone()[0]
   c.rollback()
  finally:c.close()
  if mode=='prerequisites':
   result={'databaseReadbackAvailable':True,'registrationAvailable':isinstance(cfg.get('registration_shared_secret'),str) and bool(cfg['registration_shared_secret'])}
  else:result={'exactUser':u.get('name')==controller,'nonAdmin':u.get('admin') is False,'bot':u.get('user_type')=='bot','active':u.get('deactivated') is False,'notLocked':u.get('locked') is False,'notGuest':u.get('is_guest') is False,'noAppservice':u.get('appservice_id') is None,'noExternalIds':u.get('external_ids')==[],'noThreepids':u.get('threepids')==[],'emptyApiDevices':d.get('devices')==[],'passwordless':passwordless,'emptyCredentialsAndCryptoAndRooms':all(n==0 for n in counts.values())}
 else:raise ValueError()
 print(json.dumps({'ok':True,'result':result}))
except Exception:
 print(json.dumps({'ok':False,'code':'CONTROLLER_PROVIDER_UNPROVEN'}))
'''

def assert_custody(value):
 keys={'exactUser','nonAdmin','bot','active','notLocked','notGuest','noAppservice','noExternalIds','noThreepids','emptyApiDevices','passwordless','emptyCredentialsAndCryptoAndRooms'}
 need(set(value)==keys and all(v is True for v in value.values()),'CONTROLLER_CUSTODY_UNPROVEN')

class Live:
 def run(self,args,body=None,timeout=90):
  r=subprocess.run(args,input=body,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=ENV,timeout=timeout)
  need(r.returncode==0,'CONTROLLER_CHILD_FAILED');return r.stdout
 def docker(self,*args,body=None):return self.run(['/usr/bin/docker','--host','unix:///var/run/docker.sock',*args],body)
 def inspect(self):return json.loads(self.docker('inspect',CONTAINER))[0]
 def peers(self):
  ids=self.docker('ps','-aq','--filter','label=com.docker.compose.project=csm-messaging').decode().split()
  return {v['Name']:v['Id'] for v in json.loads(self.docker('inspect',*ids)) if v['Name']!='/'+CONTAINER}
 def read(self,p):
  fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
  try:
   st=os.fstat(fd);need(stat.S_ISREG(st.st_mode) and st.st_nlink==1 and ((str(p)==FILES[0] and (st.st_uid,st.st_gid,stat.S_IMODE(st.st_mode))==(1000,1000,0o664)) or (str(p)!=FILES[0] and st.st_uid in (0,1000) and not st.st_mode&0o022)) and st.st_size<1048576,'INPUT_CUSTODY')
   if str(p)==str(PIN):need(st.st_uid==0 and stat.S_IMODE(st.st_mode)==0o444,'PIN_CUSTODY')
   raw=os.read(fd,1048576);end=os.fstat(fd)
   need(len(raw)==st.st_size and (st.st_ino,st.st_mtime_ns,st.st_ctime_ns)==(end.st_ino,end.st_mtime_ns,end.st_ctime_ns),'INPUT_CHANGED');return raw
  finally:os.close(fd)
 def inputs(self):return {p:sha(self.read(p)) for p in FILES+[str(ENVFILE)]}
 def compose(self):return ['/usr/bin/docker','--host','unix:///var/run/docker.sock','compose','--project-name','csm-messaging','--project-directory','/srv/csm-messaging','--env-file',str(ENVFILE),*[v for p in FILES for v in ('-f',p)]]
 def render(self):return json.loads(self.run(self.compose()+['config','--format','json']))
 def provider(self,mode):
  env=envmap(self.inspect()['Config']['Env'])
  need(env.get('CSM_MATRIX_SERVER_NAME')=='docker.home.cz','SERVER_CHANGED')
  payload=encoded({'mode':mode,'controller':CONTROLLER,'token':env['CSM_MATRIX_ADMIN_TOKEN']})
  value=json.loads(self.docker('exec','-i','csm-matrix-synapse','python3','-c',SYNAPSE_CODE,body=payload))
  need(value.get('ok') is True,'CONTROLLER_PROVIDER_UNPROVEN');return value['result']
 def journal(self,name,value):
  fd=os.open(CASE/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  try:write_all(fd,encoded(value)+b'\n');os.fsync(fd)
  finally:os.close(fd)
  sync_dir(CASE)
 def begin(self,before,raw,render):
  parent=CASE.parent.stat();need(parent.st_uid==0 and not parent.st_mode&0o022 and not CASE.parent.is_symlink(),'CASE_PARENT_CUSTODY')
  CASE.mkdir(mode=0o700);sync_dir(CASE.parent);self.journal('started.json',{'identity':CONTROLLER,'baseline':BASELINE,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'admissionEnabled':False})
  # Full runtime/render contain existing tokens: retain only their digests.
  # The protected pin is a production config backup, never a resolved render.
  self.journal('original-digests.json',{'runtimeSha256':sha(encoded(runtime_spec(before))),'renderSha256':sha(encoded(render)),'pinSha256':sha(raw)})
  for name,data in [('original-pin.json',raw)]:
   fd=os.open(CASE/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
   try:write_all(fd,data);os.fsync(fd)
   finally:os.close(fd)
  sync_dir(CASE)
 def publish_pin(self,raw):
  original=self.read(PIN);st=PIN.stat();temporary=PIN.parent/'.controller-only-v1.tmp'
  fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
  try:os.fchown(fd,st.st_uid,st.st_gid);write_all(fd,raw);os.fsync(fd);os.fchmod(fd,stat.S_IMODE(st.st_mode))
  finally:os.close(fd)
  need(self.read(PIN)==original,'PIN_WRITE_CAS');os.replace(temporary,PIN)
  fd=os.open(PIN.parent,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
 def restart(self):self.run(self.compose()+['up','-d','--no-build','--pull','never','--no-deps','api'])
 def wait(self):
  until=time.monotonic()+120
  while True:
   v=self.inspect();need(v['Image']==IMAGE and v['RestartCount']==0 and v['State']['Running'],'TARGET_NOT_HEALTHY')
   if v['State'].get('Health',{}).get('Status')=='healthy':return v
   need(time.monotonic()<until,'TARGET_HEALTH_TIMEOUT');time.sleep(1)
 def case_exists(self):return CASE.exists() or CASE.is_symlink()

def snapshot(ops):
 before=ops.inspect();validate_live(before)
 return {'containerId':before['Id'],'imageId':before['Image'],'startedAt':before['State']['StartedAt'],'pid':before['State']['Pid'],'runtimeSha256':sha(encoded(runtime_spec(before))),'inputSha256':ops.inputs(),'peers':ops.peers()}

def execute(ops,apply=False):
 need(bool(BASELINE),'REVIEW_BASELINE_NOT_SEALED')
 need(not ops.case_exists(),'CONTROLLER_CASE_ALREADY_EXISTS')
 need(snapshot(ops)==BASELINE,'CONTROLLER_BASELINE_CHANGED')
 need(ops.provider('absence')=={'absent':True},'CONTROLLER_ALREADY_EXISTS_OR_UNPROVEN')
 need(ops.provider('prerequisites')=={'databaseReadbackAvailable':True,'registrationAvailable':True},'CONTROLLER_PREREQUISITES_UNPROVEN')
 before=ops.inspect();raw=ops.read(PIN);render=ops.render();target=proposed_pin(raw)
 need(render['services']['api']['image']==IMAGE,'RENDER_IMAGE_CHANGED')
 need(envmap(before['Config']['Env']).get(ADMISSION,'false')=='false','ADMISSION_NOT_OFF')
 # Initial declaration/runtime parity must hold, not merely two new renders.
 desired=dict(render['services']['api']['environment']);image=json.loads(ops.docker('image','inspect',IMAGE))[0]
 image_env=envmap(image['Config'].get('Env') or []);image_env.update({k:v.replace('$$','$') if isinstance(v,str) else str(v) for k,v in desired.items()})
 need(envmap(before['Config']['Env'])==image_env,'DECLARED_ENVIRONMENT_MISMATCH')
 need(snapshot(ops)==BASELINE,'CONTROLLER_FINAL_PREFLIGHT_CAS')
 if not apply:return {'preflightPassed':True,'controllerAbsent':True,'admissionEnabled':False,'productionChanged':False,'targetPinSha256':sha(target)}
 ops.begin(before,raw,render) # Exclusive journal exists before any provider write.
 need(snapshot(ops)==BASELINE,'CONTROLLER_PRECREATE_CAS')
 need(ops.provider('create')=={'created':True},'CONTROLLER_CREATION_UNPROVEN')
 ops.journal('created.json',{'created':True,'controller':CONTROLLER})
 custody=ops.provider('custody');assert_custody(custody)
 probe=ops.provider('probe');need(probe=={'identityProven':True,'logoutProven':True,'ttlBounded':True},'CONTROLLER_DYNAMIC_PROBE_UNPROVEN')
 assert_custody(ops.provider('custody')) # token/device/queue readback after logout
 ops.journal('custody.json',{'static':custody,'dynamic':probe,'postLogoutReadback':True})
 need(snapshot(ops)==BASELINE,'CONTROLLER_PRECONFIG_CAS')
 ops.publish_pin(target)
 assert_render_delta(render,ops.render())
 # Once creation or configuration begins, failure never auto-adopts or retries.
 ops.restart();after=ops.wait();post_runtime(before,after)
 need(ops.peers()==BASELINE['peers'],'PEER_CONTAINERS_CHANGED')
 expected_inputs=dict(BASELINE['inputSha256']);expected_inputs[str(PIN)]=sha(target)
 need(ops.inputs()==expected_inputs,'OTHER_INPUT_CHANGED')
 assert_custody(ops.provider('custody'))
 result={'controller':CONTROLLER,'created':True,'custodyVerified':True,'controllerConfigured':True,'admissionEnabled':False,'containerId':after['Id'],'imageId':IMAGE,'restartCount':0,'runtimeParityVerified':True,'productionChanged':True,'featureActivated':False,'automaticRollback':False}
 ops.journal('receipt.json',result);return result

def main():
 p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');p.add_argument('--snapshot',action='store_true');a=p.parse_args();need(not(a.apply and a.snapshot),'ARGUMENT_SCOPE')
 need(os.geteuid()==0 and socket.gethostname().split('.')[0]=='comm','ROOT_COMM_REQUIRED');os.umask(0o077)
 fd=os.open('/run/cop-messaging-owned-release.lock',os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600)
 try:
  st=os.fstat(fd);need(stat.S_ISREG(st.st_mode) and st.st_uid==0 and st.st_nlink==1 and stat.S_IMODE(st.st_mode)==0o600,'LOCK_CUSTODY')
  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  ops=Live();result=snapshot(ops) if a.snapshot else execute(ops,a.apply);print(json.dumps(result))
 finally:os.close(fd)
if __name__=='__main__':
 try:main()
 except Exception as e:
  print(json.dumps({'complete':False,'code':str(e) if isinstance(e,Stop) else 'CONTROLLER_EXECUTION_UNPROVEN','admissionEnableAttempted':False,'automaticRollback':False,'mayHavePartialControllerOrConfig':CASE.exists(),'retryPermitted':False}));raise SystemExit(2)
