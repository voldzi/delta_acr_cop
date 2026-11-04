import copy,importlib.util,unittest
from pathlib import Path
from types import SimpleNamespace
HERE=Path(__file__).parent
def load(file,name):
 spec=importlib.util.spec_from_file_location(name,HERE/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
d=load('deadline.py','deadline_subject');k=load('kernel.py','deadline_kernel');c=load('contract.py','deadline_contract')
class Deadline(unittest.TestCase):
 def setUp(self):
  self.binding={'imageId':k.IMAGE,'profileGeneration':d.PROFILE,'releaseId':'release-'+'a'*32};self.actual={'Id':'a'*64,'Image':k.IMAGE,'Config':{'Env':[k.FLAG+'=true'],'Labels':{'com.cop.runtime.release':self.binding['releaseId'],'com.cop.runtime.profile-generation':d.PROFILE}},'State':{'Running':True,'Health':{'Status':'unhealthy'}},'RestartCount':8};self.approval={'baselineCop':{'releaseId':self.binding['releaseId'],'containerId':'a'*64},'windowId':'owned-window','approvedManifestSha256':'a'*64,'_runtime':None};self.proof={'contractVersion':k.VERSION}
 def test_unhealthy_restarted_owned_baseline_is_contained_not_accepted(self):
  p=d.stop_plan(self.actual,{},self.binding,self.proof,self.approval,k);self.assertTrue(p['mustStop']);self.assertFalse(p['intakeAlreadyOff'])
 def test_unopened_off_intake_is_observed_not_stopped(self):
  a=copy.deepcopy(self.actual);a['Config']['Env']=[];p=d.stop_plan(a,{},self.binding,self.proof,self.approval,k);self.assertFalse(p['mustStop']);self.assertTrue(p['intakeAlreadyOff'])
 def test_different_image_or_release_never_stopped(self):
  for mutate in [lambda a:a.update(Image='other'),lambda a:a['Config']['Labels'].update({'com.cop.runtime.release':'other'})]:
   a=copy.deepcopy(self.actual);mutate(a)
   with self.assertRaises(RuntimeError):d.stop_plan(a,{},self.binding,self.proof,self.approval,k)
 def test_own_pending_window_can_be_contained_without_healthy0(self):
  m=SimpleNamespace(IMAGE=k.IMAGE,WINDOW_VERSION=k.WINDOW_VERSION,FLAG=k.FLAG,window=lambda r,p:{'windowId':'owned-window','approvedManifestSha256':'a'*64});b={**self.binding,'releaseId':'release-'+'b'*32};a=copy.deepcopy(self.actual);a['Config']['Labels']['com.cop.runtime.release']=b['releaseId'];self.assertTrue(d.stop_plan(a,{},b,{'contractVersion':k.WINDOW_VERSION},self.approval,m)['mustStop'])
 def test_source_emergency_off_never_changes_other_secret_bytes(self):
  raw=b'# keep\nSECRET=synthetic-private\n'+c.COP_FLAG.encode()+b'=true\n';self.assertEqual(c.emergency_env_off(raw),raw.replace(c.COP_FLAG.encode()+b'=true',c.COP_FLAG.encode()+b'=false'));self.assertEqual(c.emergency_env_off(c.emergency_env_off(raw)),c.emergency_env_off(raw))
 def test_ambiguous_source_is_not_silently_repaired(self):
  with self.assertRaises(c.Rejected):c.emergency_env_off((c.COP_FLAG+'=true\n'+c.COP_FLAG+'=true\n').encode())
if __name__=='__main__':unittest.main()
