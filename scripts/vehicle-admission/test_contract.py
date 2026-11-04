import copy,importlib.util,sys,unittest
from pathlib import Path
HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('vehicle_contract',HERE/'contract.py');c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
def window():
 return {'contractVersion':'cop-global-vehicle-admission-window-v1','windowId':'12345678-1234-4234-8234-123456789abc','approvedManifestSha256':'a'*64,'scope':'global_not_isolated','identityBudget':3,'vehicleBudget':1,'durationSeconds':1800,'notBefore':1000,'openBefore':1100,'deadline':2800,'actorIds':['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'],'cases':list(c.CASES),'clientGateRemainsOff':True,'containment':'close_cop_then_messaging_keep_cleanup_writers'}
def env():return {'COP_AUTH_MODE':'oidc','COP_ALLOW_LAB_TOKEN':'false','COP_ACCOUNT_ERASURE_ENABLED':'true','COP_ACCOUNT_SAFETY_GUARD_REQUIRED':'true','UNCHANGED_SECRET':'synthetic-unchanged'}
class Contract(unittest.TestCase):
 def test_effective_missing_flag_only_addition_and_close(self):
  before=env();after={**before,c.COP_FLAG:'true'};self.assertTrue(c.effective_delta(before,after,'open'));self.assertTrue(c.effective_delta(after,{**before,c.COP_FLAG:'false'},'close'))
 def test_other_flag_secret_or_auth_change_rejected(self):
  a=env()
  for k,v in [('UNCHANGED_SECRET','changed'),('COP_AUTH_MODE','lab'),(c.MESSAGING_FLAG,'true')]:
   with self.subTest(key=k),self.assertRaises(c.Rejected):c.effective_delta(a,{**a,c.COP_FLAG:'true',k:v},'open')
 def test_preserves_every_unrelated_env_byte(self):
  a=b'# comment\nTOKEN="synthetic-private"\nOTHER=a=b\n';b=c.env_delta(a,'open');self.assertEqual(b,a+c.COP_FLAG.encode()+b'=true\n');self.assertEqual(c.env_delta(b,'close'),a+c.COP_FLAG.encode()+b'=false\n')
 def test_ambiguous_flag_not_repaired(self):
  for raw in [(c.COP_FLAG+'=false\n'+c.COP_FLAG+'=false\n').encode(),(c.COP_FLAG+'="false"\n').encode(),(c.COP_FLAG+'=true\n').encode()]:
   with self.subTest(raw=raw),self.assertRaises(c.Rejected):c.env_delta(raw,'open')
 def test_exact_compose_insertion_only(self):
  raw=b'services:\n  cop-api:\n    environment:\n'+c.ANCHOR+b'  other:\n    image: unchanged\n';old=c.BASE_COMPOSE_SHA;c.BASE_COMPOSE_SHA=c.sha(raw)
  try:
   target=c.compose_delta(raw,'open');self.assertEqual(target.replace(c.MAPPING,b''),raw);self.assertEqual(c.compose_delta(target,'close'),target)
   with self.assertRaises(c.Rejected):c.compose_delta(raw+b'# changed\n','open')
  finally:c.BASE_COMPOSE_SHA=old
 def test_global_window_requires_exact_limits_and_all_cases(self):
  self.assertEqual(c.validate_window(window(),1001,opening=True),window())
  for change in [{'scope':'isolated_pilot'},{'identityBudget':4},{'vehicleBudget':True},{'durationSeconds':1801},{'clientGateRemainsOff':False},{'cases':list(c.CASES)[:-1]}]:
   with self.subTest(change=change),self.assertRaises(c.Rejected):c.validate_window({**window(),**change},1001,opening=True)
 def test_expiry_blocks_open_not_containment(self):
  with self.assertRaises(c.Rejected):c.validate_window(window(),2800,opening=True)
  self.assertEqual(c.validate_window(window(),2900,opening=False),window())
 def test_duplicate_or_email_actor_cannot_be_authority(self):
  for ids in [['email@example.invalid',*window()['actorIds'][1:]],[window()['actorIds'][0]]*3]:
   with self.subTest(ids=ids),self.assertRaises(c.Rejected):c.validate_window({**window(),'actorIds':ids},1001,opening=True)
 def test_duplicate_and_nonfinite_json_rejected(self):
  for raw in [b'{"x":1,"x":2}',b'{"x":NaN}']:
   with self.assertRaises(c.Rejected):c.parse(raw)
 def test_process_restart_or_health_loss_denies_mutation(self):
  before={'Id':'fixed','Image':'fixed','State':{'Pid':1,'StartedAt':'fixed','Running':True,'Health':{'Status':'healthy'}},'RestartCount':0};self.assertTrue(c.process_cas(before,copy.deepcopy(before)))
  for mutate in [lambda x:x['State'].update(Pid=2),lambda x:x['State'].update(StartedAt='later'),lambda x:x['State']['Health'].update(Status='unhealthy'),lambda x:x.update(RestartCount=1)]:
   x=copy.deepcopy(before);mutate(x);self.assertFalse(c.process_cas(before,x))
if __name__=='__main__':unittest.main()
