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

class AcceptanceTest(unittest.TestCase):
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
