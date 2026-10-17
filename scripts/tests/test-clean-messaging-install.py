import importlib.util
from pathlib import Path
import unittest
import uuid
import hashlib
import json
import copy

spec=importlib.util.spec_from_file_location('initial',Path(__file__).parents[1]/'account-safety/clean-messaging-install.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class InitialInstallTest(unittest.TestCase):
 def configuration(self):
  b={k:str(uuid.uuid4()) for k in ['guardStoreId','metadataStoreId','metadataIncarnationId','providerStoreId','providerIncarnationId']}
  b.update(issuer='https://login.zeleznalady.cz/realms/cop',serverName='docker.home.cz',metadataRestoreGeneration=1,providerRestoreGeneration=1,retentionPolicyDigest=m.POLICY,providerScopeDigest=m.SCOPE,clientIds=['cop-web','csm-mobile'],providerOrigin='https://matrix.example.invalid',ownerKeyFingerprint='a'*64)
  b['identityBindingDigest']=hashlib.sha256(json.dumps([b['issuer'],b['clientIds']],separators=(',',':')).encode()).hexdigest()
  return dict(contractVersion='cop-messaging-production-initial-v1',binding=b,baselineId=str(uuid.uuid4()),guardRuntimeRole='csm_messaging',sourcePins={k:'b'*64 for k in m.REQUIRED},writerInventorySha256='c'*64,reviewedRetention=True)
 def test_exact_initial_production_configuration_is_required(self):
  c=self.configuration();self.assertIs(m.validate(c),c)
  for key,val in [('issuer','https://unreviewed.invalid'),('serverName','other.invalid'),('providerRestoreGeneration',2),('retentionPolicyDigest','d'*64),('clientIds',['cop-web','foreign-client']),('metadataStoreId','not-uuid'),('providerOrigin','http://unreviewed.invalid')]:
   bad=copy.deepcopy(c);bad['binding'][key]=val
   with self.assertRaises((RuntimeError,ValueError)):m.validate(bad)
  for key,val in [('guardRuntimeRole','postgres'),('reviewedRetention',False),('baselineId','invalid')]:
   bad=copy.deepcopy(c);bad[key]=val
   with self.assertRaises((RuntimeError,ValueError)):m.validate(bad)
  bad=copy.deepcopy(c);bad['sourcePins'].pop(next(iter(m.REQUIRED)))
  with self.assertRaises(RuntimeError):m.validate(bad)
 def test_no_cli_or_automatic_activation_or_credentials_creation(self):
  text=Path(m.__file__).read_text();self.assertNotIn('if __name__',text);self.assertNotIn('CREATE ROLE',text);self.assertNotIn('ALTER ROLE',text);self.assertNotIn('subprocess',text);self.assertNotIn('PreparedEnrollment(',text)
  self.assertIn("'erasureEnabled':False",text);self.assertIn('admission.assert_current()',text)
 def test_migration_preserves_inner_plpgsql_and_one_transaction(self):
  class Q:
   def execute(self,s):self.value=s
  q=Q();m.migration(q,"-- public\nBEGIN;\nDO $$ BEGIN NULL; END $$;\nCOMMIT;\n");self.assertEqual(q.value,"-- public\nDO $$ BEGIN NULL; END $$;\n")
  for bad in ['SELECT 1','BEGIN;\nBEGIN;\nCOMMIT;\n','BEGIN;\nCOMMIT;\nDROP TABLE x;']:
   with self.assertRaises(RuntimeError):m.migration(q,bad)
 def test_source_scope_cannot_read_secret_or_escape_root(self):
  for path in ['/etc/shadow','../secret','deploy/unknown.sql']:
   with self.assertRaises(RuntimeError):m.source('/tmp',{},path)
if __name__=='__main__':unittest.main()
