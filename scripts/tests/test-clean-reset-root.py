import copy
import importlib.util
import json
from pathlib import Path
import time
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('clean_reset_root',Path(__file__).parents[1]/'account-safety/clean-reset-root.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def plan():
 return {'contractVersion':'cop-sim-clean-reset-root-plan-v1','resetEpoch':'10000000-0000-4000-8000-000000000001','tokensNotBefore':int(time.time())-1,
 'scope':'cop_sim_shared_identity_v1','runtimeBinding':{'contractVersion':'cop-api-runtime-active-v1','generation':'a'*32,'containerId':'a'*64,'imageId':'sha256:'+'b'*64,'profileId':'10000000-0000-4000-8000-000000000002','profileGeneration':'10000000-0000-4000-8000-000000000002','releaseId':'release-'+'c'*32},'localWriters':{n:{'id':'a'*64,'image':'sha256:'+'b'*64} for n in m.LOCAL_WRITERS},
 'remoteWriters':{n:{'id':'c'*64,'image':'sha256:'+'d'*64} for n in m.REMOTE_WRITERS},
 'sources':{n:{'revision':'e'*40,'root':'/srv/x5-production/staging/cop/root-reviewed-'+n,'files':{'reviewed.mjs':'f'*64}} for n in ['cop','sim','messaging']},
 'reviewedPlanDigests':{n:'a'*64 for n in ['cop','ai','driver','files','keycloak','messaging','media','edge']},
 'producerInventorySha256':'b'*64,'operationLockMetadata':{'device':1,'inode':2,'uid':1000,'gid':1000,'mode':0o664}}

class RootAdmissionTest(unittest.TestCase):
 def test_fixed_complete_plan_is_validated_without_granting_admission(self):
  p=plan();self.assertIs(m.validate_plan(p),p)
  with self.assertRaisesRegex(RuntimeError,'RESET_ROOT_CONTEXT'):m.RootResetAdmission(object(),object())
 def test_unknown_scope_future_cutoff_and_arbitrary_writer_are_rejected(self):
  for key,value in [('scope','old_scope'),('tokensNotBefore',int(time.time())+10000),('resetEpoch','not-an-epoch')]:
   p=plan();p[key]=value
   with self.assertRaises((RuntimeError,ValueError)):m.validate_plan(p)
  p=plan();p['localWriters']['other-app']={'id':'a'*64,'image':'sha256:'+'b'*64}
  with self.assertRaisesRegex(RuntimeError,'PLAN_WRITERS'):m.validate_plan(p)
 def test_missing_provider_review_and_external_source_paths_are_rejected(self):
  p=plan();del p['reviewedPlanDigests']['messaging']
  with self.assertRaisesRegex(RuntimeError,'REVIEWED_SCOPE'):m.validate_plan(p)
  for path in ['/srv/cop','/tmp/reviewed','/srv/x5-production/staging/cop/../reviewed']:
   p=plan();p['sources']['cop']['root']=path
   with self.assertRaisesRegex(RuntimeError,'SOURCE_PATH'):m.validate_plan(p)
 def test_runtime_profile_must_belong_to_the_same_reviewed_cop_instance(self):
  p=plan();p['runtimeBinding']['containerId']='f'*64
  with self.assertRaisesRegex(RuntimeError,'RUNTIME_BINDING'):m.validate_plan(p)
 def test_stopped_witness_requires_exact_containers_images_and_zero_processes(self):
  expected=plan()['localWriters'];actual={n:{**x,'running':False,'restarting':False,'status':'exited','pid':0} for n,x in expected.items()}
  m.assert_stopped(actual,expected)
  for field,value in [('running',True),('pid',42),('status','paused'),('id','0'*64),('image','sha256:'+'0'*64),('restarting',True)]:
   bad=copy.deepcopy(actual);bad[m.LOCAL_WRITERS[0]][field]=value
   with self.assertRaisesRegex(RuntimeError,'WRITER_NOT_STOPPED'):m.assert_stopped(bad,expected)
 def test_freeze_admits_only_the_exact_reviewed_running_or_already_stopped_instances(self):
  expected=plan()['localWriters'];actual={n:{**x,'running':True,'restarting':False,'status':'running','pid':42} for n,x in expected.items()}
  m.assert_freeze_targets(actual,expected)
  for field,value in [('id','0'*64),('image','sha256:'+'0'*64),('status','paused'),('restarting',True),('pid',0)]:
   changed=copy.deepcopy(actual);changed[m.LOCAL_WRITERS[0]][field]=value
   with self.assertRaisesRegex(RuntimeError,'FREEZE_TARGET_CHANGED'):m.assert_freeze_targets(changed,expected)
 def test_container_reader_never_requests_environment_or_accepts_missing_containers(self):
  args=[]
  def run(command):
   args.extend(command);return b'"/cop-cop-api-1"\t"'+b'a'*64+b'"\t"sha256:'+b'b'*64+b'"\t{"Running":false,"Status":"exited","Pid":0,"Restarting":false}\n'
  self.assertEqual(m.inspect_writers(run,['cop-cop-api-1'])['cop-cop-api-1']['pid'],0)
  self.assertNotIn('Env',' '.join(args))
  with self.assertRaisesRegex(RuntimeError,'INVENTORY_INCOMPLETE'):m.inspect_writers(lambda _:b'',m.LOCAL_WRITERS)
 def test_named_fake_authority_is_not_a_production_owner(self):
  Fake=type('CommunicationResetTransport',(),{})
  with patch.object(m.os,'getuid',return_value=0),patch.object(m.socket,'gethostname',return_value='docker'):
   with self.assertRaisesRegex(RuntimeError,'HOST_OWNER_REQUIRED'):m.RootResetAdmission(Fake(),object())
 def test_closed_root_admission_cannot_be_reused(self):
  value=object.__new__(m.RootResetAdmission);value.open=False;value.fd=None
  with self.assertRaisesRegex(RuntimeError,'ADMISSION_CLOSED'):value.assert_current()
 def test_other_source_files_cannot_escape_the_reviewed_tree(self):
  for path in ['../other.mjs','/etc/shadow']:
   p=plan();p['sources']['cop']['files']={path:'f'*64}
   with self.assertRaisesRegex(RuntimeError,'SOURCE_FILE'):m.validate_plan(p)

if __name__=='__main__':unittest.main()
