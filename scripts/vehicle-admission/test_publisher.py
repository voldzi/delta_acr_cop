import copy,importlib.util,unittest
from pathlib import Path
from types import SimpleNamespace
HERE=Path(__file__).parent
def load(file,name):
 spec=importlib.util.spec_from_file_location(name,HERE/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
p=load('publisher.py','window_publisher_subject');k=load('kernel.py','window_publisher_kernel')
class Publisher(unittest.TestCase):
 def setUp(self):
  self.actual={'Id':'a'*64,'Image':k.IMAGE,'Config':{'Env':['SECRET=synthetic-private']},'State':{'Pid':10,'StartedAt':'fixed-start','Running':True,'Health':{'Status':'healthy'}},'RestartCount':0};self.r=SimpleNamespace(encoded=k.encode,fenced_public_source_spec=lambda v:{'Id':v['Id'],'Image':v['Image']});self.metadata={'device':1,'inode':2,'size':30,'mtimeNs':3,'ctimeNs':4};self.pointer={'generation':'b'*32,'containerId':'a'*64};self.peers={'edge':'c'*64};self.public={'sourceContainer':'a'*64,'sourceProcess':{'pid':10,'startedAt':'fixed-start','restartCount':0,'running':True,'health':'healthy'},'sourceGeneration':'b'*32,'sourcePeers':self.peers,'sourceSpecSha256':k.sha(k.encode(self.r.fenced_public_source_spec(self.actual))),'sourceEnvironmentSha256':k.sha(k.encode({'SECRET':'synthetic-private'})),'sourceEnvironmentMetadata':self.metadata}
 def check(self,actual=None,pointer=None,metadata=None,peers=None):return p.prewrite_matches(self.r,k,self.public,actual or self.actual,pointer or self.pointer,peers or self.peers,metadata or self.metadata)
 def test_exact_fresh_proposed_snapshot_allowed(self):self.assertTrue(self.check())
 def test_restart_between_proposal_and_raw_capture_cannot_hide(self):
  actual=copy.deepcopy(self.actual);actual['State']['Pid']=11;self.assertFalse(self.check(actual=actual));actual['State']['Pid']=10;actual['State']['StartedAt']='later';self.assertFalse(self.check(actual=actual))
 def test_pointer_peer_or_secrets_file_drift_denied(self):
  self.assertFalse(self.check(pointer={**self.pointer,'generation':'d'*32}));self.assertFalse(self.check(peers={'edge':'d'*64}));self.assertFalse(self.check(metadata={**self.metadata,'inode':99}))
 def test_duplicate_or_changed_effective_env_denied(self):
  actual=copy.deepcopy(self.actual);actual['Config']['Env'].append('SECRET=other');self.assertFalse(self.check(actual=actual));actual['Config']['Env']=['SECRET=other'];self.assertFalse(self.check(actual=actual))
if __name__=='__main__':unittest.main()
