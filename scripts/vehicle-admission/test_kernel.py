"""Synthetic proof boundary tests. No production/host execution."""
import copy,datetime,importlib.util,json,re,unittest
from pathlib import Path
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('vehicle_window_kernel',Path(__file__).with_name('kernel.py'));k=importlib.util.module_from_spec(spec);spec.loader.exec_module(k)
class WindowKernel(unittest.TestCase):
 def setUp(self):
  self.docs={};self.id='12345678-1234-4234-8234-123456789abc';self.profile=Path('/protected')/k.PROFILE;now=datetime.datetime.now(datetime.timezone.utc);self.now=int(now.timestamp());self.env={'COP_AUTH_MODE':'oidc','COP_ALLOW_LAB_TOKEN':'false','COP_ACCOUNT_ERASURE_ENABLED':'true','COP_ACCOUNT_SAFETY_GUARD_REQUIRED':'true','SECRET':'synthetic-unchanged'};self.target={**self.env,k.FLAG:'true'}
  self.r=SimpleNamespace(PROFILES=Path('/protected'),PROFILE_UUID=re.compile('[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}'),FILES=['docker-compose.yml','unchanged.yml'],encoded=k.encode,datetime=datetime.datetime,timezone=datetime.timezone,fenced_timestamp=lambda x:datetime.datetime.fromisoformat(x.replace('Z','+00:00')).timestamp(),private_read=lambda p,*a,**kw:self.docs[Path(p)])
  self.w={'contractVersion':'cop-root-vehicle-window-v1','windowId':self.id,'approvedManifestSha256':'a'*64,'scope':'global_not_isolated','actorIds':['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'],'vehicleBudget':1,'durationSeconds':1800,'notBefore':self.now-1,'openBefore':self.now+300,'deadline':self.now+1799,'containment':'close_cop_then_messaging_keep_cleanup_writers','clientGateRemainsOff':True}
  self.wpath=self.profile/('vehicle-window-'+self.id+'.json');self.docs[self.wpath]=k.encode(self.w);ref={'path':str(self.wpath),'sha256':k.sha(self.docs[self.wpath])}
  self.parent={'contractVersion':k.VERSION,'checks':{'existingGuard':True},'cleanReset':{'preserved':True},'environmentMetadata':{'digest':'b'*64},'composeHashes':{'docker-compose.yml':'c'*64,'unchanged.yml':'d'*64}}
  pp=self.profile/('account-erasure-'+self.id+'.json');self.docs[pp]=k.encode(self.parent);parentref={'path':str(pp),'sha256':k.sha(self.docs[pp]),'cleanScope':'cop_sim_shared_identity_v1'}
  before={'releaseId':'release-'+'a'*32,'imageId':k.IMAGE,'containerId':'a'*64,'generation':'a'*32};self.p={'contractVersion':k.WINDOW_VERSION,'transitionId':self.id,'operation':'maintain','stage':'open','windowReference':ref,'previous':before,'target':{'imageId':k.IMAGE,'sourceRevision':k.SOURCE,'profileGeneration':k.PROFILE},'changedKeys':[k.FLAG],'ownerAcceptance':True,'checks':self.parent['checks'],'cleanReset':self.parent['cleanReset'],'parentProof':parentref,'sourceEnvironmentMetadata':self.parent['environmentMetadata'],'environmentMetadata':{'digest':'e'*64},'sourceComposeHashes':self.parent['composeHashes'],'composeHashes':{'docker-compose.yml':'f'*64,'unchanged.yml':'d'*64},'sourceSpecSha256':'1'*64,'baselineSha256':'2'*64,'checkedAt':now.isoformat(),'expiresAt':(now+datetime.timedelta(minutes=5)).isoformat()}
  self.oldpath=Path('/state/releases')/before['releaseId']/'release.json';self.docs[self.oldpath]=k.encode({'imageId':k.IMAGE,'sourceRevision':k.SOURCE,'accountErasureConfig':parentref})
  self.c={'contractVersion':'cop-root-vehicle-window-case-v1','caseId':self.id,**{x:self.p[x] for x in ('stage','windowReference','previous','target','parentProof','sourceEnvironmentMetadata','environmentMetadata','sourceComposeHashes','composeHashes','sourceSpecSha256','baselineSha256','checkedAt','expiresAt')},'sourceEnvironmentSha256':k.sha(k.encode(self.env)),'targetEnvironmentSha256':k.sha(k.encode(self.target)),'sourceProcess':{'pid':123,'startedAt':'fixed-start','restartCount':0,'running':True,'health':'healthy'},'sourcePeers':{'edge':'b'*64},'parentReleaseSha256':k.sha(self.docs[self.oldpath])};self.freeze()
 def freeze(self):
  path=self.profile/('vehicle-window-case-'+self.id+'.json');self.docs[path]=k.encode(self.c);self.p['caseReference']={'path':str(path),'sha256':k.sha(self.docs[path])}
 def test_exact_fresh_one_flag_proof(self):
  k.evidence(self.r,self.p,True);k.environment(self.r,self.env,self.target,self.p)
  binding={**self.p['target'],'profileId':k.PROFILE,'previousReleaseId':self.p['previous']['releaseId']}
  self.assertEqual(k.read_proof(self.r,SimpleNamespace(root=Path('/state'),uid=1000),self.profile/('account-erasure-'+self.id+'.json'),k.encode(self.p),binding)[1],self.p)
 def test_root_record_bytes_and_path_mandatory(self):
  self.docs[self.wpath]+=b' '
  with self.assertRaisesRegex(ValueError,'ROOT_BYTES'):k.schema(self.r,self.p)
 def test_extra_flag_image_or_other_compose_denied(self):
  for change in [lambda p:p.update(changedKeys=[k.FLAG,'COP_AUTH_MODE']),lambda p:p['target'].update(imageId='sha256:'+'f'*64),lambda p:p['composeHashes'].update({'unchanged.yml':'f'*64})]:
   p=copy.deepcopy(self.p);change(p)
   with self.assertRaises(ValueError):k.schema(self.r,p)
 def test_wrong_stage_or_fake_actor_list_denied(self):
  p=copy.deepcopy(self.p);p['stage']='always-enabled'
  with self.assertRaises(ValueError):k.schema(self.r,p)
  self.w['actorIds']=['email@example.invalid']*3;self.docs[self.wpath]=k.encode(self.w);self.p['windowReference']['sha256']=k.sha(self.docs[self.wpath]);self.freeze()
  with self.assertRaises(ValueError):k.schema(self.r,self.p)
 def test_expired_window_cannot_open(self):
  self.r.datetime=SimpleNamespace(now=lambda tz:datetime.datetime.fromtimestamp(self.now+1800,tz))
  with self.assertRaises(ValueError):k.evidence(self.r,self.p,True)
  k.evidence(self.r,self.p,False)
 def test_other_environment_values_never_change(self):
  changed={**self.target,'SECRET':'changed'};self.c['targetEnvironmentSha256']=k.sha(k.encode(changed));self.freeze()
  with self.assertRaisesRegex(ValueError,'EXACT_ONE_FLAG'):k.environment(self.r,self.env,changed,self.p)
 def test_process_restart_health_peer_changes_stop(self):
  current={'Id':self.p['previous']['containerId'],'Image':k.IMAGE,'Config':{'Env':[x+'='+v for x,v in self.env.items()]},'State':{'Pid':123,'StartedAt':'fixed-start','Running':True,'Health':{'Status':'healthy'}},'RestartCount':0}
  self.r.fenced_public_source_spec=lambda v:{'Id':v['Id'],'Image':v['Image']};self.p['sourceSpecSha256']=k.sha(k.encode(self.r.fenced_public_source_spec(current)));self.c['sourceSpecSha256']=self.p['sourceSpecSha256'];self.freeze();peers=copy.deepcopy(self.c['sourcePeers']);store=SimpleNamespace(pointer=lambda:copy.deepcopy(self.p['previous']),binding=lambda _:('source',None,None),docker=SimpleNamespace(current=lambda _:current,peers=lambda _:peers))
  self.assertEqual(k.assert_source(self.r,store,self.p),current)
  current['State']['Pid']=124
  with self.assertRaises(ValueError):k.assert_source(self.r,store,self.p)
  current['State']['Pid']=123;peers['edge']='c'*64
  with self.assertRaises(ValueError):k.assert_source(self.r,store,self.p)
 def test_parent_protection_cannot_change(self):
  p=copy.deepcopy(self.p);p['checks']={'pretend':True};self.p=p;self.freeze();binding={**p['target'],'profileId':k.PROFILE,'previousReleaseId':p['previous']['releaseId']}
  with self.assertRaisesRegex(ValueError,'PARENT_PROTECTION'):k.read_proof(self.r,SimpleNamespace(root=Path('/state'),uid=1000),self.profile/('account-erasure-'+self.id+'.json'),k.encode(p),binding)
 def test_old_contracts_delegate_unchanged(self):
  calls=[];old=k.historical
  try:
   k.historical=lambda r:(SimpleNamespace(evidence=lambda proxy,p,f:calls.append((proxy,p,f)) or p),'unchanged-proxy')
   self.assertEqual(k.evidence(self.r,{'contractVersion':k.VERSION},False),{'contractVersion':k.VERSION});self.assertEqual(calls,[('unchanged-proxy',{'contractVersion':k.VERSION},False)])
  finally:k.historical=old
if __name__=='__main__':unittest.main()
