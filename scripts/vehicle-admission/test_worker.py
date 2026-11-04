import contextlib,copy,importlib.util,unittest
from pathlib import Path
from types import SimpleNamespace
HERE=Path(__file__).parent
def load(file,name):
 spec=importlib.util.spec_from_file_location(name,HERE/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
w=load('worker.py','window_worker_test_subject');fixtures=load('test_kernel.py','window_kernel_fixture');k=fixtures.k
class Worker(unittest.TestCase):
 def setUp(self):
  f=fixtures.WindowKernel();f.setUp();self.f=f;self.calls=[];v={'Id':f.p['previous']['containerId'],'Image':k.IMAGE,'Config':{'Env':[x+'='+y for x,y in f.env.items()]},'State':{'Pid':123,'StartedAt':'fixed-start','Running':True,'Health':{'Status':'healthy'}},'RestartCount':0};f.r.fenced_public_source_spec=lambda value:{'Id':value['Id'],'Image':value['Image']};f.p['sourceSpecSha256']=k.sha(k.encode(f.r.fenced_public_source_spec(v)));f.c['sourceSpecSha256']=f.p['sourceSpecSha256'];f.freeze();self.path=f.profile/('account-erasure-'+f.id+'.json');f.docs[self.path]=k.encode(f.p)
  store=SimpleNamespace(pointer=lambda:copy.deepcopy(f.p['previous']),binding=lambda _:('source',{},{}),docker=SimpleNamespace(current=lambda _:v,peers=lambda _:f.c['sourcePeers']),post_edge_runtime=lambda:f.r,prepare=lambda *args,**kwargs:self.calls.append((args,kwargs)) or {'releaseId':'prepared','imageId':k.IMAGE})
  f.r.Store=lambda **kw:store;self.storage=SimpleNamespace(operation_lock=lambda:contextlib.nullcontext(),preflight=lambda:None);self.approval={'windowId':f.id,'approvedManifestSha256':f.w['approvedManifestSha256']};self.payload={'action':'prepare','proof':str(self.path),'attestation':'/protected/existing-attestation.json'}
 def test_only_exact_root_window_prepares_unchanged_image(self):
  value=w.execute(self.f.r,k,self.storage,self.approval,self.payload);self.assertEqual(value['imageId'],k.IMAGE);self.assertEqual(self.calls[0][0][:2],(k.IMAGE,k.SOURCE))
 def test_caller_cannot_add_image_or_config_option(self):
  with self.assertRaises(RuntimeError):w.execute(self.f.r,k,self.storage,self.approval,{**self.payload,'image':'other'})
  self.assertEqual(self.calls,[])
 def test_other_approval_window_or_manifest_rejected(self):
  for approval in [{**self.approval,'windowId':'different'},{**self.approval,'approvedManifestSha256':'f'*64}]:
   with self.assertRaises(RuntimeError):w.execute(self.f.r,k,self.storage,approval,self.payload)
  self.assertEqual(self.calls,[])
 def test_no_generic_action_or_erasure_operation(self):
  for action in ['erase_account','shell','change_environment']:
   with self.assertRaises(RuntimeError):w.execute(self.f.r,k,self.storage,self.approval,{'action':action})
  self.assertEqual(self.calls,[])
if __name__=='__main__':unittest.main()
