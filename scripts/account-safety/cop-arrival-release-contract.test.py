import copy, datetime, importlib.util, json, re, types, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('arrival_contract',Path(__file__).with_name('cop-arrival-release-contract-v1.py'));c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
def need(ok,code):
 if not ok:raise ValueError(code)
r=types.SimpleNamespace(require=need,re=re,PROFILE_UUID=re.compile('[0-9a-f-]{36}'),fenced_timestamp=lambda x:datetime.datetime.fromisoformat(x).timestamp(),datetime=datetime.datetime,timezone=datetime.timezone)
class ContractTests(unittest.TestCase):
 def setUp(self):
  now=datetime.datetime.now(datetime.timezone.utc);self.p={'contractVersion':c.VERSION,'transitionId':'11111111-1111-4111-8111-111111111111','operation':'maintain','previous':c.SOURCE,'target':{'imageId':c.IMAGE,'sourceRevision':c.REVISION,'profileGeneration':c.PROFILE},'changedKeys':[],'environmentMetadata':{},'composeHashes':{},'ownerAcceptance':True,'checks':{k:True for k in c.CHECKS},'cleanReset':{},'parentProof':{'path':c.PARENT,'sha256':c.PARENT_SHA},'checkedAt':now.isoformat(),'expiresAt':(now+datetime.timedelta(minutes=10)).isoformat(),'sourceSpecSha256':'a'*64,'patchFiles':c.PATCH_FILES,'simAcceptance':{'imageId':'sha256:9f0a6d789116cad19d363e79e9c8e5963861106e10ecd9c281e9f864c1d2c124','schemaSha256':'210b06c0cd3f093d91529721b21b7ffed26e28be5d625a15a6d62a67c7f36e8c','actualEngineAccepted':True}}
 def test_exact_candidate_only(self):self.assertEqual(c.schema(r,self.p),self.p)
 def test_no_implicit_owner_acceptance(self):
  self.p['ownerAcceptance']=False
  with self.assertRaises(ValueError):c.schema(r,self.p)
 def test_changed_image_or_pointer_rejected(self):
  for field in ['imageId','sourceRevision']:
   p=copy.deepcopy(self.p);p['target'][field]='wrong'
   with self.assertRaises(ValueError):c.schema(r,p)
 def test_no_config_or_auth_changes(self):
  self.p['changedKeys']=['COP_AUTH_MODE']
  with self.assertRaises(ValueError):c.schema(r,self.p)
 def test_no_foreign_patch_or_sim(self):
  for field in ['patchFiles','simAcceptance']:
   p=copy.deepcopy(self.p);p[field]={}
   with self.assertRaises(ValueError):c.schema(r,p)
 def test_environment_exact_equality(self):
  env={'COP_AUTH_MODE':'oidc','COP_ALLOW_LAB_TOKEN':'false','COP_ACCOUNT_ERASURE_ENABLED':'true','PRIVATE_VALUE':'synthetic'};c.environment(r,env,env,self.p)
  with self.assertRaises(ValueError):c.environment(r,env,{**env,'PRIVATE_VALUE':'changed'},self.p)
 def test_expired_release_cannot_activate(self):
  now=datetime.datetime.now(datetime.timezone.utc);self.p['checkedAt']=(now-datetime.timedelta(minutes=20)).isoformat();self.p['expiresAt']=(now-datetime.timedelta(minutes=10)).isoformat()
  with self.assertRaises(ValueError):c.evidence(r,self.p)
 def test_historical_dispatch_unchanged(self):
  old=c.base;c.base=lambda _:types.SimpleNamespace(schema=lambda _r,p:('historical',p))
  try:self.assertEqual(c.schema(r,{'contractVersion':'historical'}),('historical',{'contractVersion':'historical'}))
  finally:c.base=old
if __name__=='__main__':unittest.main()
