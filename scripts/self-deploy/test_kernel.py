import copy,datetime,importlib.util,json,re,unittest
from pathlib import Path
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('app_kernel',Path(__file__).with_name('kernel.py'));k=importlib.util.module_from_spec(spec);spec.loader.exec_module(k)
enc=lambda x:json.dumps(x,sort_keys=True,separators=(',',':')).encode()
class ReleaseBoundary(unittest.TestCase):
 def setUp(self):
  self.docs={};self.profile=Path('/protected')/k.PROFILE;self.id='00000000-0000-4000-8000-000000000001'
  self.r=SimpleNamespace(PROFILES=Path('/protected'),PROFILE_UUID=re.compile('[a-f0-9-]{36}'),IMAGE=re.compile('sha256:[a-f0-9]{64}'),REVISION=re.compile('[a-f0-9]{40}'),encoded=enc,datetime=datetime.datetime,timezone=datetime.timezone,fenced_timestamp=lambda v:datetime.datetime.fromisoformat(v.replace('Z','+00:00')).timestamp(),private_read=lambda p,*a,**kw:self.docs[Path(p)])
  self.env={'COP_AUTH_MODE':'oidc','COP_ALLOW_LAB_TOKEN':'false','COP_ACCOUNT_ERASURE_ENABLED':'true'}
  self.parent={'checks':{'existing':True},'cleanReset':{'existing':'retained'},'environmentMetadata':{'sha256':'a'*64},'composeHashes':{'same':'b'*64}}
  parentpath=self.profile/('account-erasure-'+self.id+'.json');self.docs[parentpath]=enc(self.parent)
  ref={'path':str(parentpath),'sha256':k.sha(self.docs[parentpath]),'cleanScope':'cop_sim_shared_identity_v1'}
  self.p={'contractVersion':k.VERSION,'transitionId':self.id,'operation':'maintain','previous':{'releaseId':'release-'+'a'*32,'imageId':'sha256:'+'a'*64,'generation':'a'*32},'target':{'imageId':'sha256:'+'b'*64,'sourceRevision':'c'*40,'profileGeneration':k.PROFILE},'changedKeys':[],'ownerAcceptance':True,**self.parent,'parentProof':ref,'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'expiresAt':(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=10)).isoformat(),'sourceSpecSha256':'d'*64,'baselineSha256':'e'*64}
  old={'imageId':self.p['previous']['imageId'],'accountErasureConfig':ref}
  self.oldpath=Path('/state/releases')/self.p['previous']['releaseId']/'release.json';self.docs[self.oldpath]=enc(old)
  self.compat={'contractVersion':'cop-application-image-compatibility-v1','target':self.p['target'],'checks':dict.fromkeys(['x5RuntimeGuard','sharpConversion','databaseRouting','actualImageTests','sameRuntimeEnvironment','sameTopology'],True),'sourceContextDigest':'f'*64,'buildReceiptSha256':'1'*64}
  self.case={'contractVersion':'cop-application-image-case-v1','caseId':self.id,'approvalRef':'cop-application-self-release-policy-v1',**{v:self.p[v] for v in ['previous','target','parentProof','environmentMetadata','composeHashes','sourceSpecSha256','baselineSha256','checkedAt','expiresAt']},'sourceEnvironmentSha256':k.sha(enc(self.env)),'parentReleaseSha256':k.sha(self.docs[self.oldpath]),'sourceProcess':{'pid':1,'restartCount':0,'startedAt':'2026-11-04T00:00:00Z','running':True}}
  self.freeze()
 def freeze(self):
  path=self.profile/('application-image-compatibility-'+self.id+'.json');self.docs[path]=enc(self.compat);self.case['compatibilityReference']={'path':str(path),'sha256':k.sha(self.docs[path])}
  path=self.profile/('application-image-case-'+self.id+'.json');self.docs[path]=enc(self.case);self.p['caseReference']={'path':str(path),'sha256':k.sha(self.docs[path])}
 def test_exact_image_only_case_and_parent_bytes(self):
  k.schema(self.r,self.p)
  binding={**self.p['target'],'previousReleaseId':self.p['previous']['releaseId'],'profileId':k.PROFILE}
  store=SimpleNamespace(root=Path('/state'),uid=1000)
  self.assertEqual(k.read_proof(self.r,store,self.profile/('account-erasure-'+self.id+'.json'),enc(self.p),binding)[1],self.p)
 def test_no_configuration_change_or_unsealed_target(self):
  for mutate in [lambda p:p.update(changedKeys=['COP_AUTH_MODE']),lambda p:p['target'].update(imageId='sha256:'+'f'*64),lambda p:p.update(ownerAcceptance=False),lambda p:p.update(expiresAt='2026-11-05T00:00:00Z')]:
   p=copy.deepcopy(self.p);mutate(p)
   with self.assertRaises(ValueError):k.schema(self.r,p)
 def test_integer_one_is_not_test_evidence(self):
  self.compat['checks']['databaseRouting']=1;self.freeze()
  with self.assertRaisesRegex(ValueError,'UNPROVEN'):k.schema(self.r,self.p)
 def test_expired_authority_does_not_activate(self):
  future=datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=1)
  self.r.datetime=SimpleNamespace(now=lambda tz:future)
  with self.assertRaisesRegex(ValueError,'EXPIRED'):k.evidence(self.r,self.p,True)
  k.evidence(self.r,self.p,False)
 def test_parent_binding_change_cannot_hide_in_history(self):
  self.docs[self.oldpath]=enc({'imageId':self.p['previous']['imageId'],'accountErasureConfig':self.p['parentProof'],'tampered':True})
  with self.assertRaisesRegex(ValueError,'PARENT_RELEASE_CHANGED'):k.read_proof(self.r,SimpleNamespace(root=Path('/state'),uid=1000),self.profile/('account-erasure-'+self.id+'.json'),enc(self.p),{**self.p['target'],'previousReleaseId':self.p['previous']['releaseId'],'profileId':k.PROFILE})
 def test_duplicate_keys_and_nonfinite_are_rejected(self):
  for raw in [b'{"a":1,"a":2}',b'{"a":NaN}']:
   with self.assertRaises(ValueError):k.parse(raw)
 def test_full_environment_equality_rejects_new_flags_or_auth_changes(self):
  k.environment(self.r,self.env,self.env,self.p)
  for change in [{'COP_AUTH_MODE':'lab'},{'COP_SHARED_VEHICLE_COMMUNICATION_ENABLED':'true'}]:
   with self.assertRaisesRegex(ValueError,'ENVIRONMENT_CHANGED'):k.environment(self.r,self.env,{**self.env,**change},self.p)
 def test_root_case_content_hash_is_required(self):
  self.docs[Path(self.p['caseReference']['path'])]+=b' '
  with self.assertRaisesRegex(ValueError,'DOCUMENT_CHANGED'):k.schema(self.r,self.p)
 def test_inherited_checks_cannot_be_rewritten(self):
  p=copy.deepcopy(self.p);p['checks']={'pretend':True}
  with self.assertRaisesRegex(ValueError,'PROTECTION_CHANGED'):k.read_proof(self.r,SimpleNamespace(root=Path('/state'),uid=1000),self.profile/('account-erasure-'+self.id+'.json'),enc(p),{**p['target'],'previousReleaseId':p['previous']['releaseId'],'profileId':k.PROFILE})
 def test_fresh_source_pointer_spec_and_full_environment_are_required(self):
  current={'Id':'f'*64,'State':{'Pid':1,'StartedAt':'2026-11-04T00:00:00Z','Running':True},'RestartCount':0,'HostConfig':{'Memory':64},'Config':{'Env':[k+'='+v for k,v in self.env.items()]}}
  self.p['previous']['containerId']=current['Id']
  self.r.fenced_public_source_spec=lambda v:{'Id':v['Id'],'HostConfig':v['HostConfig']}
  self.p['sourceSpecSha256']=k.sha(enc(self.r.fenced_public_source_spec(current)));self.case['sourceSpecSha256']=self.p['sourceSpecSha256'];self.freeze()
  store=SimpleNamespace(pointer=lambda:copy.deepcopy(self.p['previous']),binding=lambda _:('source',None,None),docker=SimpleNamespace(current=lambda _:current))
  self.assertEqual(k.assert_source(self.r,store,self.p),current)
  current['State']['Pid']=2
  with self.assertRaisesRegex(ValueError,'PROCESS_CHANGED'):k.assert_source(self.r,store,self.p)
  current['State']['Pid']=1
  current['HostConfig']['Memory']=128
  with self.assertRaisesRegex(ValueError,'SPEC_CHANGED'):k.assert_source(self.r,store,self.p)
  current['HostConfig']['Memory']=64;current['Config']['Env'].append('UNAPPROVED=present')
  with self.assertRaisesRegex(ValueError,'ENVIRONMENT_CHANGED'):k.assert_source(self.r,store,self.p)
 def test_legacy_dispatch_uses_unchanged_parent_pin(self):
  calls=[];old=k.historical
  m=SimpleNamespace(evidence=lambda r,p,f:(calls.append((r,p,f)) or p))
  try:
   k.historical=lambda r:(m,'original-parent-proxy')
   self.assertEqual(k.evidence(self.r,{'contractVersion':'old'},False),{'contractVersion':'old'})
   self.assertEqual(calls,[('original-parent-proxy',{'contractVersion':'old'},False)])
  finally:k.historical=old
if __name__=='__main__':unittest.main()
