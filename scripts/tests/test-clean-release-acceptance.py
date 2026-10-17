"""Parser rejection checks only. Synthetic reports are never production proof."""
import copy
import datetime
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('clean_gate',Path(__file__).parents[1]/'account-safety/clean-release-acceptance.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
NOW=1792224000
OP='10000000-0000-4000-8000-000000000001'

def example():
 images={k:'sha256:'+'a'*64 for k in m.IMAGE_KEYS}
 r={'contractVersion':'cop-sim-whole-clean-acceptance-v2','kind':'isolated_whole_provider','deletionScope':'cop_sim_shared_identity_v1',
 'productionTouched':False,'externalProviderCalls':0,'actorCount':2,'candidateImages':images,
 'checkedAt':datetime.datetime.fromtimestamp(NOW,datetime.timezone.utc).isoformat().replace('+00:00','Z'),
 'operation':{'operationId':OP,'initialHttpStatus':202,'initialStatus':'deleting','initialAccountDeleted':False,'finalHttpStatus':200,'finalStatus':'deleted','finalAccountDeleted':True,'finalContractVersion':'cop-account-erasure-v2','requiredOwners':sorted(m.OWNERS)},
 'providerReadbacks':{k:{'operationId':OP,'status':'completed','userARemaining':0,'userBStateBefore':'b'*64,'userBStateAfter':'b'*64,'readbackDigest':'c'*64} for k in m.OWNERS},
 'identityReadback':{'userAGetStatus':404,'userARefreshStatus':400,'userALoginStatus':400,'userBProfileStatus':200,'userBRefreshStatus':200,'deletedAfterProviderProofs':True},
 'recoveryReadbacks':{k:{'operationId':OP,'finalUserARemaining':0,'userBPreserved':True,'readbackDigest':'d'*64,'dependencyHttpStatus':503,'operationStatus':'deleting','httpStatus':503,'rowsRecreated':0,'restoredRows':1} for k in ['router_outage','messaging_outage','worker_restart','restored_user_data','late_write']},
 'testedSourceDigests':{k:'e'*64 for k in ['cop','sim','messaging','producer']}}
 return r,images

EPOCH='10000000-0000-4000-8000-000000000099'
def example_v3():
 r,i=example();r['contractVersion']='cop-sim-whole-clean-acceptance-v3'
 r['resetEpoch']=EPOCH;r['operation']['resetEpoch']=EPOCH;r['testedRuntimeImages']=copy.deepcopy(i);r['imageEquivalence']={}
 for x in r['providerReadbacks'].values():x['resetEpoch']=EPOCH
 for x in r['recoveryReadbacks'].values():x['resetEpoch']=EPOCH
 for n in ['router_outage','messaging_outage']:
  x=r['recoveryReadbacks'][n]
  x.update(phase='completed_operation_replay',operationStatus='deleted',operationCompletedBeforeOutage=True,dependencyHttpSequence=[200,503,200],
   databaseBindingReadbacks={p:{'operationId':OP,'resetEpoch':EPOCH,'operationState':'deleted','terminalBindingDigest':'f'*64} for p in ['before','during','after']},
   finalReadback={'operationId':OP,'resetEpoch':EPOCH,'status':'completed','userARemaining':0,'readbackDigest':'e'*64})
 return r,i

class AcceptanceTest(unittest.TestCase):
 def test_v3_is_separate_completed_contract(self):
  r,i=example_v3();x=m.validate_clean_whole_report_v3(r,i,NOW);self.assertEqual(x['resetEpoch'],EPOCH);self.assertEqual(x['outageSemantics'],'completed_operation_replay');self.assertNotIn('reportSha256',x)
  with self.assertRaises(RuntimeError):m.validate_clean_whole_report(r,i,NOW)
  old,i=example()
  with self.assertRaises(RuntimeError):m.validate_clean_whole_report_v3(old,i,NOW)
 def test_v2_still_rejects_completed_outage(self):
  r,i=example();r['recoveryReadbacks']['router_outage']['operationStatus']='deleted'
  with self.assertRaises(RuntimeError):m.validate_clean_whole_report(r,i,NOW)
 def test_v3_requires_bound_epoch_everywhere(self):
  for section,key in [('operation',None),('providerReadbacks','sim_user_data'),('recoveryReadbacks','router_outage')]:
   r,i=example_v3();x=r[section] if key is None else r[section][key];x['resetEpoch']='10000000-0000-4000-8000-000000000098'
   with self.assertRaises(RuntimeError):m.validate_clean_whole_report_v3(r,i,NOW)
 def test_v3_requires_actual_sequence_and_completed_state(self):
  for field,v in [('dependencyHttpSequence',[200,403,200]),('dependencyHttpSequence',[503,200]),('operationStatus','deleting'),('phase','pending'),('operationCompletedBeforeOutage',False)]:
   r,i=example_v3();r['recoveryReadbacks']['router_outage'][field]=v
   with self.assertRaises(RuntimeError):m.validate_clean_whole_report_v3(r,i,NOW)
 def test_v3_rejects_changed_or_missing_during_binding(self):
  for field,v in [('operationId','different'),('resetEpoch','different'),('operationState','deleting'),('terminalBindingDigest','a'*64)]:
   r,i=example_v3();r['recoveryReadbacks']['messaging_outage']['databaseBindingReadbacks']['during'][field]=v
   with self.assertRaises(RuntimeError):m.validate_clean_whole_report_v3(r,i,NOW)
  r,i=example_v3();del r['recoveryReadbacks']['router_outage']['databaseBindingReadbacks']['during']
  with self.assertRaises(RuntimeError):m.validate_clean_whole_report_v3(r,i,NOW)
 def test_v3_requires_zero_final_bound_readback(self):
  for field,v in [('operationId','other'),('resetEpoch','other'),('status','deleting'),('userARemaining',1),('readbackDigest','missing')]:
   r,i=example_v3();r['recoveryReadbacks']['router_outage']['finalReadback'][field]=v
   with self.assertRaises(RuntimeError):m.validate_clean_whole_report_v3(r,i,NOW)
 def test_v3_keeps_all_other_owner_identity_restore_guards(self):
  for mutate in [lambda r:r['providerReadbacks'].pop('sim_user_data'),lambda r:r['providerReadbacks']['keycloak'].update(userARemaining=1),lambda r:r['identityReadback'].update(userAGetStatus=200),lambda r:r['recoveryReadbacks']['restored_user_data'].update(restoredRows=0),lambda r:r['recoveryReadbacks']['late_write'].update(rowsRecreated=1)]:
   r,i=example_v3();mutate(r)
   with self.assertRaises(RuntimeError):m.validate_clean_whole_report_v3(r,i,NOW)
 def voice_example(self):
  r,i=example_v3();r['testedRuntimeImages']['voice_proxy']='sha256:'+'b'*64
  launch={'entrypoint':['/usr/local/bin/livekit-erasure-proxy'],'cmd':None,'workingDir':'/','user':'1000:1000','envSha256':'c'*64}
  r['imageEquivalence']={'voice_proxy':{'kind':'identical_rootfs_and_launch','testedImageId':r['testedRuntimeImages']['voice_proxy'],'candidateImageId':i['voice_proxy'],'testedRootFsDiffIds':['sha256:'+'d'*64],'candidateRootFsDiffIds':['sha256:'+'d'*64],'testedLaunch':launch,'candidateLaunch':copy.deepcopy(launch)}}
  return r,i
 def test_v3_voice_exact_equivalence_only(self):
  r,i=self.voice_example();m.validate_clean_whole_report_v3(r,i,NOW)
  for mutate in [lambda r:r['testedRuntimeImages'].update(cop_api='sha256:'+'b'*64),lambda r:r['imageEquivalence']['voice_proxy'].update(candidateRootFsDiffIds=['sha256:'+'e'*64]),lambda r:r['imageEquivalence']['voice_proxy']['candidateLaunch'].update(envSha256='e'*64),lambda r:r['imageEquivalence']['voice_proxy']['candidateLaunch'].update(user='0:0'),lambda r:r['imageEquivalence'].update(cop_api={})]:
   r,i=self.voice_example();mutate(r)
   with self.assertRaises(RuntimeError):m.validate_clean_whole_report_v3(r,i,NOW)
 def test_v3_rejects_unproven_voice_mismatch(self):
  r,i=example_v3();r['testedRuntimeImages']['voice_proxy']='sha256:'+'f'*64
  with self.assertRaises(RuntimeError):m.validate_clean_whole_report_v3(r,i,NOW)
 def test_actual_public_status_and_account_deleted_fields_are_required(self):
  for key,value in [('initialStatus','pending'),('finalStatus','completed'),('initialAccountDeleted',True),('finalAccountDeleted',False)]:
   r,i=example();r['operation'][key]=value
   with self.assertRaises(RuntimeError):m.validate_clean_whole_report(r,i,NOW)
 def test_structured_parser_does_not_grant_root_custody(self):
  r,i=example();self.assertEqual(m.validate_clean_whole_report(r,i,NOW)['operationId'],OP)
  self.assertNotIn('reportSha256',m.validate_clean_whole_report(r,i,NOW))
 def test_component_and_old_scope_receipts_cannot_admit_a_stop(self):
  r,i=example()
  for patch in [{'contractVersion':'cop-whole-erasure-acceptance-v1'},{'deletionScope':'cop_jizda_preserve_shared_identity_sim'},{'kind':'component'},{'wholeAccountAccepted':True,'providerReadbacks':{}}]:
   with self.assertRaises(RuntimeError):m.validate_clean_whole_report({**r,**patch},i,NOW)
 def test_all_twelve_fresh_provider_readbacks_are_required(self):
  r,i=example();del r['providerReadbacks']['sim_user_data']
  with self.assertRaises(RuntimeError):m.validate_clean_whole_report(r,i,NOW)
  r,i=example();r['providerReadbacks']['messaging_matrix']['userARemaining']=1
  with self.assertRaises(RuntimeError):m.validate_clean_whole_report(r,i,NOW)
 def test_other_user_change_or_different_operation_is_rejected(self):
  for key,value in [('userBStateAfter','f'*64),('operationId','10000000-0000-4000-8000-000000000002')]:
   r,i=example();r['providerReadbacks']['cop_content_media'][key]=value
   with self.assertRaises(RuntimeError):m.validate_clean_whole_report(r,i,NOW)
 def test_missing_identity_delete_or_user_b_login_is_rejected(self):
  for key,value in [('userAGetStatus',200),('userBRefreshStatus',400),('deletedAfterProviderProofs',False)]:
   r,i=example();r['identityReadback'][key]=value
   with self.assertRaises(RuntimeError):m.validate_clean_whole_report(r,i,NOW)
 def test_keycloak_browser_error_page_is_denial_only_with_explicit_error_and_no_code(self):
  r,i=example();r['identityReadback'].update(userALoginStatus=200,userALoginDenied=True,userALoginKnownError=True)
  m.validate_clean_whole_report(r,i,NOW)
  for name in ['userALoginDenied','userALoginKnownError']:
   bad=copy.deepcopy(r);del bad['identityReadback'][name]
   with self.assertRaises(RuntimeError):m.validate_clean_whole_report(bad,i,NOW)
  r['identityReadback']['userALoginDenied']=False
  with self.assertRaises(RuntimeError):m.validate_clean_whole_report(r,i,NOW)
 def test_outage_is_not_a_user_denial_and_restore_must_have_real_rows(self):
  r,i=example();r['recoveryReadbacks']['router_outage']['dependencyHttpStatus']=403
  with self.assertRaises(RuntimeError):m.validate_clean_whole_report(r,i,NOW)
  r,i=example();r['recoveryReadbacks']['restored_user_data']['restoredRows']=0
  with self.assertRaises(RuntimeError):m.validate_clean_whole_report(r,i,NOW)
 def test_stale_future_and_other_image_are_rejected(self):
  r,i=example()
  for now in [NOW-1,NOW+86401]:
   with self.assertRaises(RuntimeError):m.validate_clean_whole_report(r,i,now)
  changed=copy.deepcopy(i);changed['cop_api']='sha256:'+'f'*64
  with self.assertRaises(RuntimeError):m.validate_clean_whole_report(r,changed,NOW)

if __name__=='__main__':unittest.main()
