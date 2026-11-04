import copy,hashlib,hmac,importlib.util,io,json,sys,types,unittest,urllib.error
from pathlib import Path
from unittest.mock import patch
s=importlib.util.spec_from_file_location('controller_off',Path(__file__).with_name('controller-only-off.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

def initial():
 return {'Id':m.CID,'Image':m.IMAGE,'State':{'Running':True,'Health':{'Status':'healthy'},'StartedAt':'fixed','Pid':17},'RestartCount':0,'Config':{'Env':['BASE=fixed','CSM_MATRIX_SERVER_NAME=docker.home.cz'], 'Hostname':m.CID[:12],'Labels':{'com.docker.compose.project.config_files':','.join(m.FILES),'com.docker.compose.config-hash':'old'}},'HostConfig':{'Privileged':False,'Binds':['/x:/data:rw']},'Mounts':[{'Destination':'/data','Source':'/x','RW':True}],'NetworkSettings':{'Networks':{'private':{'NetworkID':'network-fixed'}}}}
class Fake:
 def __init__(self):
  self.v=initial();self.raw=m.encoded({'services':{'api':{'image':m.IMAGE}}});self.original_raw=self.raw;self.calls=[];self.exists=False;self.drift=None;self.bad_custody=False;self.collision=False;self.bad_render=False;self.bad_runtime=False;self.records={}
 def inspect(self):return copy.deepcopy(self.v)
 def inputs(self):return {str(m.PIN):m.sha(self.raw),'other':'fixed'}
 def peers(self):return {'synapse':'fixed'}
 def read(self,p):return self.raw
 def render(self):
  env={'BASE':'fixed','CSM_MATRIX_SERVER_NAME':'docker.home.cz'}
  env.update(json.loads(self.raw)['services']['api'].get('environment',{}))
  if self.bad_render and self.raw!=self.original_raw:env['UNRELATED']='changed'
  return {'services':{'api':{'image':m.IMAGE,'environment':env}}}
 def docker(self,*args):return m.encoded([{'Config':{'Env':[]}}])
 def provider(self,mode):
  self.calls.append(mode)
  if mode=='absence':return {'absent':not self.collision}
  if mode=='create':return {'created':not self.collision}
  if mode=='probe':return {'identityProven':True,'logoutProven':True,'ttlBounded':True}
  if mode=='prerequisites':return {'databaseReadbackAvailable':True,'registrationAvailable':True}
  value={k:True for k in ('exactUser','nonAdmin','bot','active','notLocked','notGuest','noAppservice','noExternalIds','noThreepids','emptyApiDevices','passwordless','emptyCredentialsAndCryptoAndRooms')}
  if self.bad_custody:value['passwordless']=False
  return value
 def case_exists(self):return self.exists
 def begin(self,*_):
  self.exists=True
  if self.drift:self.v[self.drift]='changed'
 def journal(self,name,value):self.records[name]=copy.deepcopy(value)
 def publish_pin(self,raw):self.calls.append('publish');self.raw=raw
 def restart(self):
  self.calls.append('restart');self.v['Id']='b'*64;self.v['Config']['Hostname']='b'*12
  env=m.envmap(self.v['Config']['Env']);env.update(m.DELTA);self.v['Config']['Env']=[k+'='+v for k,v in env.items()]
  if self.bad_runtime:self.v['Mounts'][0]['Source']='/other'
 def wait(self):return self.inspect()
class ExecutorBoundaries(unittest.TestCase):
 def setUp(self):
  self.ops=Fake();self.patch=patch.object(m,'BASELINE',m.snapshot(self.ops));self.patch.start();self.addCleanup(self.patch.stop)
 def test_readonly_check_has_no_creation_or_journal(self):
  r=m.execute(self.ops);self.assertFalse(r['productionChanged']);self.assertEqual(self.ops.calls,['absence','prerequisites']);self.assertFalse(self.ops.exists)
 def test_happy_path_keeps_admission_off_and_preserves_original(self):
  r=m.execute(self.ops,True);self.assertFalse(r['featureActivated']);self.assertFalse(r['admissionEnabled']);self.assertTrue(r['runtimeParityVerified']);self.assertIn('receipt.json',self.ops.records)
 def test_repeated_apply_is_not_automatic_adoption(self):
  m.execute(self.ops,True)
  before=list(self.ops.calls)
  with self.assertRaisesRegex(m.Stop,'CASE_ALREADY_EXISTS'):m.execute(self.ops,True)
  self.assertEqual(before,self.ops.calls)
 def test_wrong_runtime_stops_before_provider(self):
  self.ops.v['Image']='other'
  with self.assertRaisesRegex(m.Stop,'RUNTIME_IDENTITY_CHANGED'):m.execute(self.ops,True)
  self.assertEqual([],self.ops.calls)
 def test_existing_identity_never_updated(self):
  self.ops.collision=True
  with self.assertRaisesRegex(m.Stop,'ALREADY_EXISTS_OR_UNPROVEN'):m.execute(self.ops,True)
  self.assertNotIn('create',self.ops.calls);self.assertFalse(self.ops.exists)
 def test_process_or_inputs_changed_stops_before_creation(self):
  self.ops.v['State']['Pid']=18
  with self.assertRaisesRegex(m.Stop,'BASELINE_CHANGED'):m.execute(self.ops,True)
  self.assertNotIn('create',self.ops.calls)
 def test_drift_after_journal_stops_before_creation(self):
  self.ops.drift='Image'
  with self.assertRaises(m.Stop):m.execute(self.ops,True)
  self.assertNotIn('create',self.ops.calls)
 def test_creation_unproven_has_no_config_write(self):
  original=self.ops.provider
  def p(mode):return {'created':False} if mode=='create' else original(mode)
  self.ops.provider=p
  with self.assertRaisesRegex(m.Stop,'CREATION_UNPROVEN'):m.execute(self.ops,True)
  self.assertNotIn('publish',self.ops.calls)
 def test_custody_failure_keeps_flags_and_runtime_unchanged(self):
  self.ops.bad_custody=True
  with self.assertRaisesRegex(m.Stop,'CUSTODY_UNPROVEN'):m.execute(self.ops,True)
  self.assertNotIn('publish',self.ops.calls);self.assertNotIn('restart',self.ops.calls)
 def test_dynamic_probe_denial_does_not_configure_controller(self):
  original=self.ops.provider
  def p(mode):return {'identityProven':False,'logoutProven':True,'ttlBounded':True} if mode=='probe' else original(mode)
  self.ops.provider=p
  with self.assertRaisesRegex(m.Stop,'DYNAMIC_PROBE_UNPROVEN'):m.execute(self.ops,True)
  self.assertNotIn('publish',self.ops.calls)
 def test_unrelated_render_delta_stops_before_restart(self):
  self.ops.bad_render=True
  with self.assertRaisesRegex(m.Stop,'EXCEEDS_TWO'):m.execute(self.ops,True)
  self.assertNotIn('restart',self.ops.calls);self.assertNotIn('receipt.json',self.ops.records)
 def test_mount_drift_cannot_report_success(self):
  self.ops.bad_runtime=True
  with self.assertRaisesRegex(m.Stop,'RUNTIME_PARITY_FAILED'):m.execute(self.ops,True)
  self.assertNotIn('receipt.json',self.ops.records)
 def test_custody_rejects_missing_extra_false_or_truthy(self):
  good=self.ops.provider('custody')
  for key in good:
   for value in (False,1,'true',None):
    v={**good,key:value}
    with self.assertRaises(m.Stop):m.assert_custody(v)
  with self.assertRaises(m.Stop):m.assert_custody({**good,'unreviewed':True})
 def test_preexisting_true_flag_denied(self):
  self.ops.v['Config']['Env'].append(m.ADMISSION+'=true')
  with self.assertRaisesRegex(m.Stop,'ADMISSION_ALREADY_SET'):m.execute(self.ops,True)
  self.assertEqual([],self.ops.calls)
 def test_duplicate_env_key_denied(self):
  with self.assertRaisesRegex(m.Stop,'ENV_DUPLICATE'):m.envmap(['KEY=a','KEY=b'])
 def test_injected_pin_admission_denied(self):
  raw=m.encoded({'services':{'api':{'image':m.IMAGE,'environment':{m.ADMISSION:'true'}}}})
  with self.assertRaisesRegex(m.Stop,'PIN_ADMISSION_ENABLED'):m.proposed_pin(raw)

class Reply:
 def __init__(self,data,status=200):self.raw=m.encoded(data);self.status=status
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def read(self,*args):return self.raw
class ActualProviderProtocol(unittest.TestCase):
 def run_child(self,collision=False,mode="create",pending_forever=False,wrong_who=False,logout_failure=False):
  calls=[];registered={};uid=m.CONTROLLER
  def urlopen(req,timeout):
   path=req.full_url.split('8008')[1];body=json.loads(req.data) if req.data else None;method=req.get_method();calls.append((method,path,body))
   if method=='POST' and path.endswith('/login'):
    self.assertGreater(body['valid_until_ms'],0);return Reply({'access_token':'synthetic-control-token'})
   if method=='GET' and path.endswith('/whoami'):return Reply({'user_id':'@wrong:synthetic' if wrong_who else uid})
   if method=='POST' and path.endswith('/logout'):return Reply({},500 if logout_failure else 200)
   if method=='GET' and path.endswith('/register'):return Reply({'nonce':'synthetic-nonce'})
   if method=='GET':raise urllib.error.HTTPError(req.full_url,404,'missing',{},io.BytesIO(m.encoded({'errcode':'M_NOT_FOUND'})))
   if method=='POST' and path.endswith('/register'):
    expected=hmac.new(b'synthetic-registration-secret',b'\x00'.join([body['nonce'].encode(),body['username'].encode(),body['password'].encode(),b'notadmin',b'bot']),hashlib.sha1).hexdigest()
    self.assertEqual(body['mac'],expected)
    if collision:raise urllib.error.HTTPError(req.full_url,400,'collision',{},io.BytesIO(m.encoded({'errcode':'M_USER_IN_USE'})))
    registered.update(body);return Reply({'user_id':uid})
   if method=='PUT':return Reply({'name':uid,'deactivated':body['deactivated']})
   raise AssertionError('unexpected operation')
  out=io.StringIO();payload=m.encoded({'mode':mode,'controller':uid,'token':'synthetic-admin-token'}).decode()
  fake_yaml=types.SimpleNamespace(safe_load=lambda _: {'registration_shared_secret':'synthetic-registration-secret','database':{'args':{'database':'csm_synapse'}}})
  class Cursor:
   def __enter__(self):return self
   def __exit__(self,*args):pass
   def execute(self,*args):pass
   def fetchone(self):return (1 if pending_forever else 0,)
  class Connection:
   def set_session(self,**kwargs):pass
   def cursor(self):return Cursor()
   def rollback(self):pass
   def close(self):pass
  fake_pg=types.SimpleNamespace(connect=lambda **kwargs:Connection())
  ticks=iter(range(0,1000,2))
  with patch('urllib.request.urlopen',urlopen),patch('sys.stdin',io.StringIO(payload)),patch('sys.stdout',out),patch.dict(sys.modules,{'yaml':fake_yaml,'psycopg2':fake_pg}),patch('time.monotonic',side_effect=lambda:next(ticks)),patch('time.sleep'),patch('builtins.open',side_effect=lambda *args,**kwargs:io.StringIO('synthetic')):
   exec(compile(m.SYNAPSE_CODE,'<synapse-child>','exec'),{'__name__':'__main__'})
  return json.loads(out.getvalue()),calls,registered,out.getvalue()
 def test_actual_child_race_cannot_modify_competing_identity(self):
  r,calls,_,output=self.run_child(True)
  self.assertFalse(r['ok']);self.assertFalse(any(c[0]=='PUT' for c in calls));self.assertNotIn('synthetic-admin-token',output)
 def test_pending_deactivation_cannot_reactivate_or_return_created(self):
  r,calls,_,_=self.run_child(pending_forever=True)
  self.assertFalse(r['ok']);self.assertEqual([c[2] for c in calls if c[0]=='PUT'],[{'deactivated':True}])
 def test_probe_proves_identity_and_logs_out_without_exposing_token(self):
  r,calls,_,output=self.run_child(mode='probe')
  self.assertEqual(r['result'],{'identityProven':True,'logoutProven':True,'ttlBounded':True});self.assertNotIn('synthetic-control-token',output);self.assertTrue(any(c[1].endswith('/logout') for c in calls))
 def test_wrong_whoami_still_logs_out(self):
  r,calls,_,_=self.run_child(mode='probe',wrong_who=True)
  self.assertFalse(r['result']['identityProven']);self.assertTrue(r['result']['logoutProven']);self.assertTrue(any(c[1].endswith('/logout') for c in calls))
 def test_failed_logout_is_not_custody_proof(self):
  r,_,_,_=self.run_child(mode='probe',logout_failure=True)
  self.assertFalse(r['result']['logoutProven'])
 def test_create_only_no_login_password_removed_before_return(self):
  r,calls,body,output=self.run_child(False)
  self.assertTrue(r['result']['created']);self.assertTrue(body['inhibit_login']);self.assertFalse(body['admin']);self.assertEqual(body['user_type'],'bot');self.assertGreater(len(body['password']),64)
  self.assertEqual([c[2] for c in calls if c[0]=='PUT'],[{'deactivated':True},{'deactivated':False}])
  self.assertNotIn(body['password'],output);self.assertNotIn('synthetic-registration-secret',output)
if __name__=='__main__':unittest.main()
