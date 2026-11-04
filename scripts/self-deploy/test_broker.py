import copy,importlib.util,json,os,tempfile,unittest
from types import SimpleNamespace
from pathlib import Path
spec=importlib.util.spec_from_file_location('broker',Path(__file__).with_name('broker.py'));b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
class BrokerBoundary(unittest.TestCase):
 def test_private_regular_file_only(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'request';p.write_bytes(b'{}');p.chmod(0o600)
   self.assertEqual(b.read(p,os.getuid(),0o600),b'{}')
   link=Path(tmp)/'link';link.symlink_to(p)
   with self.assertRaises(OSError):b.read(link,os.getuid())
   p.chmod(0o666)
   with self.assertRaisesRegex(RuntimeError,'CUSTODY'):b.read(p,os.getuid())
 def test_no_command_or_path_in_request(self):
  saved=b.read
  try:
   for request in [{'revision':'a'*40,'expectedGeneration':'b'*32,'command':'id'},{'revision':'../x','expectedGeneration':'b'*32},{'revision':'a'*40,'expectedGeneration':'x'}]:
    b.read=lambda *a:json.dumps(request).encode()
    with self.assertRaises(RuntimeError):b.request()
   b.read=lambda *a:json.dumps({'revision':'a'*40,'expectedGeneration':'b'*32}).encode()
   self.assertEqual(b.request()['revision'],'a'*40)
  finally:b.read=saved
 def test_shared_build_directory_preserves_group_read_under_private_umask(self):
  with tempfile.TemporaryDirectory() as tmp:
   previous=os.umask(0o077)
   try:
    path=Path(tmp)/'build';b.shared_build_directory(path,os.getuid(),os.getgid())
    self.assertEqual(path.stat().st_mode&0o777,0o750)
    self.assertEqual(path.stat().st_uid,os.getuid())
   finally:os.umask(previous)
 def test_existing_evidence_cannot_be_overwritten(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'evidence';p.write_text('original')
   with self.assertRaisesRegex(RuntimeError,'EXISTS'):b.root_write(p,b'new')
   self.assertEqual(p.read_text(),'original')
 def test_status_requires_healthy_exact_instance_and_no_pending_operation(self):
  current={'Id':'exact','RestartCount':0,'State':{'Running':True,'Health':{'Status':'healthy'}}}
  pointer={'containerId':'exact','imageId':'image','generation':'generation'}
  state={'pending':False};called=[]
  def clean():
   if state['pending']:raise RuntimeError('APP_PENDING')
  store=SimpleNamespace(clean=clean,active=lambda:(pointer,'dir',{'sourceRevision':'source'},'profile'),docker=SimpleNamespace(live=lambda *a:called.append('live'),current=lambda _:current))
  runtime=SimpleNamespace(Store=lambda **kw:store);storage=SimpleNamespace(preflight=lambda:None)
  self.assertTrue(b.runtime_status(runtime,storage)['healthyRuntimeVerified'])
  for changed in [{'Id':'different'},{'State':{'Running':False,'Health':{'Status':'healthy'}}},{'State':{'Running':True,'Health':{'Status':'starting'}}}]:
   saved=copy.deepcopy(current);current.update(changed)
   with self.assertRaisesRegex(RuntimeError,'NOT_HEALTHY'):b.runtime_status(runtime,storage)
   current.clear();current.update(saved)
  current['RestartCount']=4;self.assertEqual(b.runtime_status(runtime,storage)['restartCount'],4)
  state['pending']=True;called.clear()
  with self.assertRaisesRegex(RuntimeError,'PENDING'):b.runtime_status(runtime,storage)
  self.assertEqual(called,[])
if __name__=='__main__':unittest.main()
