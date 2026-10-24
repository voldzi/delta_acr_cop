"""Closed production pair schema tests; no production I/O or credentials."""
import copy,datetime,importlib.util,re,types,unittest
from pathlib import Path
from unittest import mock
HERE=Path(__file__).parent
def load(name,file):
 s=importlib.util.spec_from_file_location(name,HERE/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
c=load('reversion_authority','cop-arrival-reversion-contract-v1.py');f=load('forward_authority','cop-arrival-release-contract-v1.py')
def require(value,code):
 if not value:raise ValueError(code)
r=types.SimpleNamespace(require=require,re=re,PROFILE_UUID=re.compile('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'),GENERATION=re.compile('[0-9a-f]{32}'),ID=re.compile('[a-z0-9][a-z0-9-]{0,63}'),PROFILES=Path('/etc/vcode-cop-api-runtime'),fenced_timestamp=lambda v:datetime.datetime.fromisoformat(v).timestamp(),datetime=datetime.datetime,timezone=datetime.timezone)
class PairSchemaTests(unittest.TestCase):
 def setUp(self):
  patch=mock.patch.object(c,'module',return_value=f);patch.start();self.addCleanup(patch.stop)
  now=datetime.datetime.now(datetime.timezone.utc);self.p={'contractVersion':c.REVERSE,'transitionId':'11111111-1111-4111-8111-111111111111','operation':'maintain','previous':{**f.SOURCE,'imageId':c.NEW,'releaseId':'release-forward','generation':'a'*32,'containerId':'b'*64},'target':{'imageId':c.OLD,'sourceRevision':c.OLD_REVISION,'profileGeneration':c.PROFILE},'changedKeys':[],'environmentMetadata':{},'composeHashes':{},'ownerAcceptance':True,'checks':{k:True for k in f.CHECKS|{'noSchemaDowngrade','retainedPendingHistory'}},'cleanReset':{},'parentProof':{'path':str(r.PROFILES/c.PROFILE/'account-erasure-22222222-2222-4222-8222-222222222222.json'),'sha256':'c'*64},'checkedAt':now.isoformat().replace('+00:00','Z'),'expiresAt':(now+datetime.timedelta(minutes=10)).isoformat().replace('+00:00','Z'),'sourceSpecSha256':'d'*64,'patchFiles':f.PATCH_FILES,'simAcceptance':{'imageId':'sha256:9f0a6d789116cad19d363e79e9c8e5963861106e10ecd9c281e9f864c1d2c124','schemaSha256':'210b06c0cd3f093d91529721b21b7ffed26e28be5d625a15a6d62a67c7f36e8c','actualEngineAccepted':True},'reversion':{'mode':'accepted','sourceReleaseId':'release-forward','sourceContainerId':'b'*64,'sourceImage':c.NEW,'pendingForwardSha256':None,'pendingHealthSha256':None,'baselineSha256':'d'*64}}
 def test_exact_accepted_pair(self):c.schema(r,self.p)
 def test_exact_pending_started_and_unstarted(self):
  self.p['previous']=f.SOURCE;self.p['reversion'].update(mode='pending',pendingForwardSha256='e'*64,pendingHealthSha256='f'*64,baselineSha256='f'*64)
  for image in[c.OLD,c.NEW]:self.p['reversion']['sourceImage']=image;c.schema(r,self.p)
 def test_foreign_image_profile_and_auth_scope_rejected(self):
  for field,value in [('target',{}),('changedKeys',['COP_AUTH_MODE']),('ownerAcceptance',False),('parentProof',{}),('patchFiles',{}),('checks',{}),('simAcceptance',{})]:
   with self.subTest(field=field):
    p=copy.deepcopy(self.p);p[field]=value
    with self.assertRaises((ValueError,KeyError,TypeError)):c.schema(r,p)
 def test_pending_without_original_evidence_is_rejected(self):
  self.p['previous']=f.SOURCE;self.p['reversion'].update(mode='pending',pendingForwardSha256=None,pendingHealthSha256='f'*64,baselineSha256='f'*64)
  with self.assertRaises(ValueError):c.schema(r,self.p)
 def test_no_role_secret_network_or_intake_delta(self):
  env={'COP_AUTH_MODE':'oidc','COP_ALLOW_LAB_TOKEN':'false','COP_ACCOUNT_ERASURE_ENABLED':'true','COP_DATABASE_URL':'synthetic','ROLE':'same','KEY':'same'};c.environment(r,env,env,self.p)
  for key in env:
   with self.assertRaises(ValueError):c.environment(r,env,{**env,key:'changed'},self.p)
 def test_stale_authority_cannot_mutate(self):
  self.p['checkedAt']='2020-01-01T00:00:00Z';self.p['expiresAt']='2020-01-01T00:10:00Z'
  with self.assertRaises(ValueError):c.evidence(r,self.p)
 def test_forward_after_accepted_reversion_remains_same_pair_only(self):
  p=copy.deepcopy(self.p);p.pop('reversion');p['contractVersion']=c.FORWARD;p['previous']={**f.SOURCE,'releaseId':'release-returned','generation':'e'*32,'containerId':'f'*64};p['target']={'imageId':c.NEW,'sourceRevision':c.NEW_REVISION,'profileGeneration':c.PROFILE};p['checks']={k:True for k in f.CHECKS};c.schema(r,p)
  p['previous']['imageId']='sha256:'+'0'*64
  with self.assertRaises(ValueError):c.schema(r,p)
 def test_historical_contract_dispatch_is_preserved(self):
  with mock.patch.object(c,'module',return_value=types.SimpleNamespace(schema=lambda _r,p:('historical',p))):self.assertEqual(c.schema(r,{'contractVersion':'historical'}),('historical',{'contractVersion':'historical'}))
if __name__=='__main__':unittest.main()
