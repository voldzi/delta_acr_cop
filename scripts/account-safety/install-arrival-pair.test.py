"""Installer ordering and immutable bundle checks; no Root/Docker/server calls."""
import importlib.util,pathlib,tempfile,types,unittest
from unittest import mock
p=pathlib.Path(__file__).with_name('install-arrival-pair.py');s=importlib.util.spec_from_file_location('installer',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class InstallerTests(unittest.TestCase):
 def test_payload_tamper_is_rejected_before_any_action(self):
  with tempfile.TemporaryDirectory()as d:
   root=pathlib.Path(d).resolve();(root/'payload').write_bytes(b'changed')
   with mock.patch.object(m,'STAGE',root),mock.patch.object(m,'PAYLOADS',{'payload':m.digest(b'approved')}),self.assertRaisesRegex(RuntimeError,'PUBLIC_BUNDLE_HASH_MISMATCH'):m.load_bundle()
 def test_bundle_exact_bytes_are_loaded(self):
  with tempfile.TemporaryDirectory()as d:
   root=pathlib.Path(d).resolve();(root/'payload').write_bytes(b'approved')
   with mock.patch.object(m,'STAGE',root),mock.patch.object(m,'PAYLOADS',{'payload':m.digest(b'approved')}):self.assertEqual(m.load_bundle(),{'payload':b'approved'})
 def test_non_root_apply_never_calls_docker_or_writes(self):
  with mock.patch.object(m.os,'geteuid',return_value=1000),mock.patch.object(m,'docker')as docker,mock.patch.object(m,'atomic')as atomic,self.assertRaisesRegex(RuntimeError,'ROOT_DOCKER_OPERATOR_REQUIRED'):m.apply({})
  docker.assert_not_called();atomic.assert_not_called()
 def test_unaccepted_sim_prevents_guard_installation(self):
  with mock.patch.object(m.os,'geteuid',return_value=0),mock.patch.object(m.socket,'gethostname',return_value='docker'),mock.patch.object(m.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=1000)),mock.patch.object(m,'run'),mock.patch.object(m,'read',return_value=b'guard'),mock.patch.object(m,'ORIGINAL_GUARD',m.digest(b'guard')),mock.patch.object(m,'current',return_value={'Image':m.OLD}),mock.patch.object(m,'verify_images'),mock.patch.object(m,'verify_sim',side_effect=RuntimeError('SIM_NOT_ACCEPTED_OR_HEALTHY')),mock.patch.object(m,'install_guard')as install,self.assertRaisesRegex(RuntimeError,'SIM_NOT_ACCEPTED_OR_HEALTHY'):m.apply({'cop-api-runtime.py':b'newguard'})
  install.assert_not_called()
 def test_guard_mutation_before_reviewer_stops_before_images(self):
  with mock.patch.object(m.os,'geteuid',return_value=0),mock.patch.object(m.socket,'gethostname',return_value='docker'),mock.patch.object(m.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=1000)),mock.patch.object(m,'run'),mock.patch.object(m,'read',return_value=b'foreign'),mock.patch.object(m,'verify_images')as images,self.assertRaisesRegex(RuntimeError,'LIVE_GUARD_CHANGED'):m.apply({'cop-api-runtime.py':b'newguard'})
  images.assert_not_called()
if __name__=='__main__':unittest.main()
