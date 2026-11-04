import copy,fcntl,importlib.util,json,os,subprocess,sys,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('window_execution',Path(__file__).with_name('execution.py'));e=importlib.util.module_from_spec(spec);spec.loader.exec_module(e)
class Execution(unittest.TestCase):
 def binding(self):return {'containerId':'a'*64,'releaseId':'release-'+'b'*32,'imageId':e.IMAGE,'profileGeneration':e.PROFILE}
 def actual(self):return {'Id':'a'*64,'Image':e.IMAGE,'Config':{'Labels':{'com.cop.runtime.release':'release-'+'b'*32,'com.cop.runtime.profile-generation':e.PROFILE}},'RestartCount':9,'State':{'Running':True,'Health':{'Status':'unhealthy'}}}
 def test_storage_fd_forwarded_to_same_unprivileged_worker(self):
  p=e.worker_plan({'action':'prepare'},9,identity=SimpleNamespace(pw_uid=1000,pw_gid=1000));self.assertEqual(p['pass_fds'],(9,));self.assertEqual(p['env']['COP_STORAGE_LOCK_FD'],'9');self.assertEqual(p['argv'],['/usr/bin/python3','-I',str(e.WORKER)]);self.assertEqual(set(p['env']),{'PATH','HOME','LANG','DOCKER_HOST','COP_STORAGE_LOCK_FD'})
 def test_actual_child_inherits_same_open_file_description_lock(self):
  with tempfile.TemporaryFile() as f:
   fcntl.flock(f.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
   code="import fcntl,json,os;f=int(os.environ['COP_STORAGE_LOCK_FD']);d=os.dup(f);fcntl.flock(d,fcntl.LOCK_EX|fcntl.LOCK_NB);print(json.dumps({'inheritedLockHeld':True}));os.close(d)"
   result=subprocess.run([sys.executable,'-I','-c',code],env={'COP_STORAGE_LOCK_FD':str(f.fileno())},pass_fds=(f.fileno(),),capture_output=True,check=True)
   self.assertEqual(json.loads(result.stdout),{'inheritedLockHeld':True})
 def test_wrong_fd_or_identity_not_allowed(self):
  for fd in [0,2,True,'9']:
   with self.assertRaises(RuntimeError):e.worker_plan({},fd,identity=SimpleNamespace(pw_uid=1000,pw_gid=1000))
  with self.assertRaises(RuntimeError):e.worker_plan({},9,identity=SimpleNamespace(pw_uid=0,pw_gid=0))
 def test_known_unhealthy_restarted_bound_intake_can_be_contained(self):self.assertEqual(e.stop_candidate(self.actual(),self.binding()),'a'*64)
 def test_other_cid_image_profile_or_release_never_stopped(self):
  for mutate in [lambda a:a.update(Id='c'*64),lambda a:a.update(Image='sha256:'+'f'*64),lambda a:a['Config']['Labels'].update({'com.cop.runtime.release':'other'}),lambda a:a['Config']['Labels'].update({'com.cop.runtime.profile-generation':'other'})]:
   a=copy.deepcopy(self.actual());mutate(a)
   with self.assertRaises(RuntimeError):e.stop_candidate(a,self.binding())
if __name__=='__main__':unittest.main()
