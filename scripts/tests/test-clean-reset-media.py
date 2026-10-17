import importlib.util
from pathlib import Path
import os,tempfile,shutil,unittest
spec=importlib.util.spec_from_file_location('reset_media',Path(__file__).parents[1]/'account-safety/clean-reset-media.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Admission:
 def __init__(self,fail=False):self.fail=fail
 def assert_current(self):
  if self.fail:raise RuntimeError('SYNTHETIC_CLOSED')
class MediaTest(unittest.TestCase):
 def setUp(self):
  self.root=Path(tempfile.mkdtemp(prefix='cop-native-media-test-',dir='/private/tmp'));self.root.chmod(0o700);self.addCleanup(lambda:shutil.rmtree(self.root))
  (self.root/'local_content/aa/bb').mkdir(parents=True);(self.root/'local_content/aa/bb/payload').write_bytes(b'synthetic media')
 def test_removes_only_payload_and_keeps_config_outside_media_root(self):
  p=m.inspect_media_reset(self.root,True);self.assertEqual(p['fileCount'],1)
  r=m.apply_media_reset(p,Admission(),self.root,True);self.assertEqual(r['removedFiles'],1);self.assertFalse(r['configurationTouched']);self.assertTrue((self.root/'local_content').is_dir());self.assertEqual(m.inspect_media_reset(self.root,True)['fileCount'],0)
 def test_lost_admission_does_not_delete(self):
  p=m.inspect_media_reset(self.root,True)
  with self.assertRaisesRegex(RuntimeError,'SYNTHETIC_CLOSED'):m.apply_media_reset(p,Admission(True),self.root,True)
  self.assertEqual(m.inspect_media_reset(self.root,True)['fileCount'],1)
 def test_unknown_prefix_symlink_and_hardlink_are_rejected(self):
  (self.root/'configuration').mkdir()
  with self.assertRaisesRegex(RuntimeError,'UNKNOWN_PREFIX'):m.inspect_media_reset(self.root,True)
  (self.root/'configuration').rmdir();(self.root/'local_content/link').symlink_to('/etc/hosts')
  with self.assertRaisesRegex(RuntimeError,'FILE_UNSAFE'):m.inspect_media_reset(self.root,True)
  (self.root/'local_content/link').unlink();os.link(self.root/'local_content/aa/bb/payload',self.root/'local_content/alias')
  with self.assertRaisesRegex(RuntimeError,'FILE_UNSAFE'):m.inspect_media_reset(self.root,True)
 def test_drift_is_rejected_and_no_other_directory_can_be_selected(self):
  p=m.inspect_media_reset(self.root,True);(self.root/'local_content/aa/bb/new').write_bytes(b'new')
  with self.assertRaisesRegex(RuntimeError,'PLAN_DRIFT'):m.apply_media_reset(p,Admission(),self.root,True)
  with self.assertRaisesRegex(RuntimeError,'OWNED_FIXTURE'):m.inspect_media_reset(Path('/private/tmp'),True)
if __name__=='__main__':unittest.main()
