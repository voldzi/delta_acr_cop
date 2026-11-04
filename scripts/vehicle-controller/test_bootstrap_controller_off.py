import importlib.util,unittest
from pathlib import Path
s=importlib.util.spec_from_file_location('bootstrap_off',Path(__file__).with_name('bootstrap-controller-off.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def status():return {'healthyRuntimeVerified':True,'imageId':m.COP_IMAGE,'sourceRevision':m.COP_REVISION,'generation':m.COP_GENERATION,'restartCount':0,'canChangeConfiguration':False}
class Boundary(unittest.TestCase):
 def test_default_has_no_installer_or_apply(self):
  calls=[]
  def call(argv,raw=None):
   calls.append((argv,raw))
   return status() if raw is None else {'preflightPassed':True,'productionChanged':False,'admissionEnabled':False}
  result=m.execute(False,call,lambda:b'pinned')
  self.assertFalse(result['copModified']);self.assertEqual(len(calls),3);self.assertNotIn('os.execve',calls[1][0][-1]);self.assertNotIn('O_CREAT',calls[1][0][-1])
 def test_wrong_cop_generation_never_calls_privileged_comm(self):
  calls=[]
  def call(argv,raw=None):calls.append(argv);return {**status(),'generation':'changed'}
  with self.assertRaisesRegex(m.Stop,'BASELINE_CHANGED'):m.execute(True,call,lambda:b'pinned')
  self.assertEqual(len(calls),1)
 def test_apply_can_only_execute_exact_fixed_action(self):
  calls=[]
  def call(argv,raw=None):
   calls.append(argv)
   return status() if raw is None else {'created':True,'custodyVerified':True,'controllerConfigured':True,'admissionEnabled':False,'featureActivated':False}
  m.execute(True,call,lambda:b'pinned')
  command=calls[1][-1];self.assertIn(m.EXECUTOR_SHA,command);self.assertIn('controller-only-executor-v1.py',command);self.assertIn('os.execve',command);self.assertNotIn('NOPASSWD',command)
 def test_root_loader_compiles_for_both_fixed_modes(self):
  compile(m.ROOT_LOADER+m.CHECK,'<read-only-root>','exec');compile(m.ROOT_LOADER+m.INSTALL,'<one-shot-root>','exec')
 def test_artifact_digest_is_checked(self):self.assertGreater(len(m.artifact()),1000)
 def test_post_cop_drift_cannot_report_success(self):
  n=0
  def call(argv,raw=None):
   nonlocal n
   n+=1
   return {**status(),'generation':'changed'} if n==3 else status() if raw is None else {'preflightPassed':True,'productionChanged':False,'admissionEnabled':False}
  with self.assertRaisesRegex(m.Stop,'BASELINE_CHANGED'):m.execute(False,call,lambda:b'pinned')
if __name__=='__main__':unittest.main()
