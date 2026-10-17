import copy,importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
p=Path(__file__).parents[1]/'account-safety/activate-clean-cop.py'
s=importlib.util.spec_from_file_location('cop_activation',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def example():
 plan={'resetEpoch':'synthetic-epoch','candidateImages':{'messaging_api':'sha256:'+'a'*64,'synapse':'sha256:'+'b'*64}}
 result={'contractVersion':'cop-sim-common-reset-fenced-v1','resetEpoch':plan['resetEpoch'],'completedPhases':m.PHASES.copy(),'servicesRestarted':False,'runtimeFlagsEnabled':False,'preStopReportSha256':'c'*64}
 native={'id':'d'*64,'image':plan['candidateImages']['synapse']}
 evidence={'messagingDisabled':{'contractVersion':'cop-messaging-disabled-runtime-result-v1','runtimeReady':True,'erasureEnabled':False,'containerBindings':{'csm-matrix-synapse':native}},'sim':{'contractVersion':'sim-composition-activation-v1','stage':'guard-ready-awaiting-cop-canary','resetEpoch':plan['resetEpoch'],'preStopReportSha256':result['preStopReportSha256'],'globalCopFlagsChanged':False,'guardReadiness':{'resetEpoch':plan['resetEpoch'],'privateWeb404':True,'operatorUnauthorized401':True,'checks':[{'ready':True,'unauthorizedStatus':401}for _ in range(5)]}},'messaging':{'contractVersion':'cop-messaging-enabled-runtime-result-v1','runtimeReady':True,'accountErasureAcceptanceVerified':True,'authorityMode':'database_v2','fourFlagsEnabled':True,'nonErasureEnvironmentPreserved':True,'nativeContainerPreserved':True,'oldImageFallback':False,'containerBindings':{'csm-matrix-synapse':native,'csm-messaging-api':{'id':'e'*64,'image':plan['candidateImages']['messaging_api']}}}}
 return plan,result,evidence
class ActivationTest(unittest.TestCase):
 def test_exact_completed_chain(self):
  m.validate_evidence(*example())
 def test_no_incomplete_or_other_epoch_reset(self):
  for key,value in [('resetEpoch','other'),('runtimeFlagsEnabled',True),('completedPhases',m.PHASES[:-1])]:
   p,r,e=example();r[key]=value
   with self.assertRaises(RuntimeError):m.validate_evidence(p,r,e)
 def test_no_false_acceptance_or_old_image_fallback(self):
  for key,value in [('accountErasureAcceptanceVerified',False),('fourFlagsEnabled',False),('oldImageFallback',True),('nativeContainerPreserved',False)]:
   p,r,e=example();e['messaging'][key]=value
   with self.assertRaises(RuntimeError):m.validate_evidence(p,r,e)
 def test_sim_requires_real_ready_and_unauthorized_checks(self):
  p,r,e=example();e['sim']['guardReadiness']['checks'][0]['unauthorizedStatus']=200
  with self.assertRaises(RuntimeError):m.validate_evidence(p,r,e)
 def test_enable_requires_exact_prepared_cop_receipt(self):
  p,r,e=example()
  with self.assertRaises(RuntimeError):m.validate_evidence(p,r,e,True)
  e['copPrepared']={'contractVersion':'cop-clean-guarded-runtime-v1','erasureEnabled':False,'resetEpoch':p['resetEpoch']};m.validate_evidence(p,r,e,True)
  e['copPrepared']['erasureEnabled']=True
  with self.assertRaises(RuntimeError):m.validate_evidence(p,r,e,True)
 def test_byte_editor_preserves_other_values_and_rejects_unsafe_input(self):
  def parse(raw):return dict(x.split('=',1)for x in raw.decode().splitlines())
  self.assertEqual(m.update_keys(b'KEEP=stable\nFLAG=false\n',{'FLAG':'true'},parse),b'KEEP=stable\nFLAG=true\n')
  with self.assertRaises(RuntimeError):m.update_keys(b'KEEP=stable\n',{'FLAG':'bad\nline'},parse)
 def test_failed_prepare_and_enable_use_only_fail_closed_path(self):
  for fn,inner in [(m.prepare_cop_guarded_runtime,'_prepare'),(m.enable_cop_guarded_runtime,'_enable')]:
   with patch.object(m,inner,side_effect=RuntimeError('synthetic failure')),patch.object(m,'pause_failed_candidate')as pause:
    with self.assertRaisesRegex(RuntimeError,'synthetic failure'):fn(object(),{}, {},{})
    pause.assert_called_once()
 def test_import_does_not_start_any_runtime(self):
  compile(p.read_text(),str(p),'exec');compile(m.CHILD,'guarded_child','exec')
if __name__=='__main__':unittest.main()
