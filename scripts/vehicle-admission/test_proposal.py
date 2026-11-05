import copy,datetime,importlib.util,os,re,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
HERE=Path(__file__).parent
def load(name):
 spec=importlib.util.spec_from_file_location('test_'+name,HERE/(name+'.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
p,k,c=load('proposal'),load('kernel'),load('contract')
class Proposal(unittest.TestCase):
 def setUp(self):
  self.uid=1000;self.docs={};self.source=Path('/srv/cop');self.directory=Path('/state/releases/release-'+'a'*32);self.base=b'services:\n  cop-api:\n    environment:\n'+c.ANCHOR;self.metadata={'device':1,'inode':2,'size':40,'mtimeNs':3,'ctimeNs':4};self.env={'COP_AUTH_MODE':'oidc','COP_ALLOW_LAB_TOKEN':'false','COP_ACCOUNT_ERASURE_ENABLED':'true','COP_ACCOUNT_SAFETY_GUARD_REQUIRED':'true','SECRET':'synthetic-private'};self.actual={'Id':'a'*64,'Image':k.IMAGE,'Config':{'Env':[x+'='+v for x,v in self.env.items()]},'State':{'Pid':123,'StartedAt':'fixed-start','Running':True,'Health':{'Status':'healthy'}},'RestartCount':0};self.active={'generation':p.BASE_GENERATION,'containerId':'a'*64,'imageId':k.IMAGE,'releaseId':self.directory.name};self.now=int(datetime.datetime.now(datetime.timezone.utc).timestamp());self.window_id='12345678-1234-4234-8234-123456789abc';self.wpath=Path('/protected')/k.PROFILE/('vehicle-window-'+self.window_id+'.json');w={'contractVersion':'cop-root-vehicle-window-v1','windowId':self.window_id,'approvedManifestSha256':'a'*64,'scope':'global_not_isolated','actorIds':['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'],'vehicleBudget':1,'durationSeconds':1800,'notBefore':self.now-1,'openBefore':self.now+600,'deadline':self.now+1799,'containment':'close_cop_then_messaging_keep_cleanup_writers','clientGateRemainsOff':True};self.docs[self.wpath]=k.encode(w);self.ref={'path':str(self.wpath),'sha256':k.sha(self.docs[self.wpath])}
  self.docs[self.source/'.env']=b'SECRET=synthetic-private\n';self.docs[self.source/'docker-compose.yml']=self.base;self.docs[self.source/'docker-compose.x5.yml']=b'unchanged\n';parent={'contractVersion':k.VERSION,'environmentMetadata':self.metadata,'composeHashes':{x:k.sha(self.docs[self.source/x]) for x in ('docker-compose.yml','docker-compose.x5.yml')},'checks':{'existing':True},'cleanReset':{'preserved':True}};pp=Path('/protected')/k.PROFILE/('account-erasure-'+self.window_id+'.json');self.docs[pp]=k.encode(parent);self.binding={'sourceRevision':k.SOURCE,'profileGeneration':k.PROFILE,'accountErasureConfig':{'path':str(pp),'sha256':k.sha(self.docs[pp]),'cleanScope':'cop_sim_shared_identity_v1'},'attestationPath':'/protected/existing-image-attestation.json'};self.docs[self.directory/'release.json']=k.encode({**self.binding,'imageId':k.IMAGE});self.r=SimpleNamespace(PROFILES=Path('/protected'),PROFILE_UUID=c.UUID,FILES=('docker-compose.yml','docker-compose.x5.yml'),datetime=datetime.datetime,timezone=datetime.timezone,encoded=k.encode,private_read=lambda path,*args,**kw:self.docs[Path(path)],environment_metadata=lambda *a:copy.deepcopy(self.metadata),fenced_public_source_spec=lambda v:{'Id':v['Id'],'Image':v['Image']},fenced_timestamp=lambda s:datetime.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp(),health_statuses=lambda value:value)
  self.store=SimpleNamespace(source=self.source,uid=1000,active=lambda:(copy.deepcopy(self.active),self.directory,copy.deepcopy(self.binding),{}),pointer=lambda:copy.deepcopy(self.active),docker=SimpleNamespace(current=lambda _:copy.deepcopy(self.actual),peers=lambda _:{'edge':'b'*64}),post_edge_runtime=lambda:self.r)
 def propose(self):
  with patch.object(os,'geteuid',return_value=0),patch.object(c,'BASE_COMPOSE_SHA',c.sha(self.base)):return p.propose(self.r,self.store,k,c,'open',self.ref,b'{}')
 def test_no_write_or_authority_on_proposal_and_redacted_repr(self):
  before=copy.deepcopy(self.docs);proposal=self.propose();self.assertEqual(self.docs,before);self.assertNotIn('synthetic-private',repr(proposal));self.assertFalse(proposal.public['goIssued']);self.assertFalse(proposal.public['productionChanged'])
 def test_only_one_flag_and_mapping_and_actual_finalize(self):
  proposal=self.propose();writes=proposal.consume_source_writes();self.assertEqual(set(writes),{'.env','docker-compose.yml'});self.assertEqual(writes['.env'],self.docs[self.source/'.env']+c.COP_FLAG.encode()+b'=true\n');hashes={'docker-compose.yml':k.sha(writes['docker-compose.yml']),'docker-compose.x5.yml':k.sha(self.docs[self.source/'docker-compose.x5.yml'])};built=proposal.finalize({**self.metadata,'inode':9},hashes)
  for name,raw in built['documents'].items():self.docs[self.r.PROFILES/k.PROFILE/name]=raw
  proof=k.parse(self.docs[Path(built['proofPath'])]);self.assertTrue(proof['checkedAt'].endswith('Z'));k.schema(self.r,proof);self.assertFalse(built['productionActivated'])
 def test_single_consumption_and_no_finalize_before_commit(self):
  proposal=self.propose()
  with self.assertRaises(ValueError):proposal.finalize({}, {})
  proposal.consume_source_writes()
  with self.assertRaises(ValueError):proposal.consume_source_writes()
 def test_stale_generation_or_ambiguous_env_refuses(self):
  self.active['generation']='b'*32
  with self.assertRaises(ValueError):self.propose()
  self.active['generation']=p.BASE_GENERATION;self.actual['Config']['Env'].append('SECRET=other')
  with self.assertRaises(ValueError):self.propose()
 def test_original_file_drift_not_adopted(self):
  self.docs[self.source/'docker-compose.x5.yml']=b'unreviewed\n'
  with self.assertRaises(ValueError):self.propose()
if __name__=='__main__':unittest.main()
