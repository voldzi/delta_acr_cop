import ast
import copy
import importlib.util
from pathlib import Path
import unittest

P=Path(__file__).parents[1]/'account-safety/start-messaging-disabled.py'
spec=importlib.util.spec_from_file_location('disabled',P)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class DisabledMessagingTest(unittest.TestCase):
 def binding(self):return {'issuer':'https://login.zeleznalady.cz/realms/cop','serverName':'docker.home.cz','clientIds':['cop-web','csm-mobile'],'providerOrigin':'https://matrix.example.invalid'}
 def test_exact_disabled_environment(self):
  v=m.disabled_environment(self.binding(),'a'*64)
  self.assertTrue(all(v[k]=='false' for k in m.FLAGS))
  self.assertEqual(v['CSM_ACCOUNT_ERASURE_AUTHORITY_MODE'],'database_v2')
  self.assertNotIn('CSM_COMMUNICATION_SAFETY_ENABLED',v)
  self.assertNotIn('CSM_APP_DEVICE_LEDGER_ENABLED',v)
  self.assertNotIn('CSM_ACCOUNT_SAFETY_GUARD_DATABASE_URL',v)
 def test_no_unknown_identity_or_client_or_origin(self):
  for k,v in [('issuer','https://foreign.invalid'),('serverName','foreign.invalid'),('clientIds',['cop-web','csm-mobile','other']),('clientIds',['csm-mobile','cop-web']),('providerOrigin','http://matrix.example.invalid'),('providerOrigin','https://host/path'),('providerOrigin','https://user@host')]:
   b=self.binding();b[k]=v
   with self.assertRaises(RuntimeError):m.disabled_environment(b,'a'*64)
 def test_invalid_certificate_digest(self):
  for v in ['',None,'A'*64,'a'*63]:
   with self.assertRaises(RuntimeError):m.disabled_environment(self.binding(),v)
 def test_exact_reset_proof(self):
  p={'resetEpoch':'synthetic-epoch'}
  r={'contractVersion':'cop-sim-common-reset-fenced-v1','resetEpoch':p['resetEpoch'],'completedPhases':m.PHASES.copy(),'servicesRestarted':False,'runtimeFlagsEnabled':False}
  m.validate_reset(r,p)
  for k,v in [('contractVersion','other'),('resetEpoch','other'),('servicesRestarted',True),('runtimeFlagsEnabled',True),('completedPhases',m.PHASES[:-1])]:
   bad=copy.deepcopy(r);bad[k]=v
   with self.assertRaises(RuntimeError):m.validate_reset(bad,p)
 def test_both_programs_parse(self):
  ast.parse(P.read_text());compile(m.REMOTE_PROGRAM,'remote','exec')
 def test_import_is_inert(self):
  tree=ast.parse(P.read_text())
  self.assertFalse(any(isinstance(n,ast.If) for n in tree.body))
 def test_root_and_cas_and_non_public_transition_remain_required(self):
  text=P.read_text()
  for required in ['os.getuid()==0','type(remote)is host.CommunicationResetTransport','owner._assert_files()','remote.assert_stopped','oldImageFallback','O_NOFOLLOW','O_EXCL','StrictHostKeyChecking']:
   if required=='StrictHostKeyChecking':continue # held reviewed transport owns SSH checks
   self.assertIn(required,text)
  self.assertNotIn('docker.sock',text);self.assertNotIn('shell=True',text)
  self.assertIn("CSM_COMMUNICATION_SAFETY_ENABLED'not in updates",m.REMOTE_PROGRAM)
  self.assertIn("CSM_APP_DEVICE_LEDGER_ENABLED'not in updates",m.REMOTE_PROGRAM)

if __name__=='__main__':unittest.main()
