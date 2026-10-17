"""Synthetic storage transport only. No SSH, keys, database or production."""
import hashlib,importlib.util,json,pathlib,subprocess,tempfile,types,unittest
from unittest.mock import patch,MagicMock
p=pathlib.Path(__file__).parents[1]/'account-safety/clean-reset-s3.py'
s=importlib.util.spec_from_file_location('peer_s3',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
PEER={'identityFile':'/run/cop-clean-reset-comm/id_ed25519','fingerprint':'SHA256:synthetic','authorizedLineSha256':'a'*64,'expiresAt':'2099-01-01T00:00:00+00:00','host':'storage.home.cz'}
REVIEW={'containerId':'b'*64,'providerImageId':'sha256:'+'c'*64}
def value():
 v=m.ProductionStorage.__new__(m.ProductionStorage);v.peer_binding=None;v.connected=False;v.owner=None;v.reviewed=None;return v
class PeerTransport(unittest.TestCase):
 def test_default_args_do_not_add_identity(self):
  v=value();v._peer_identity=lambda **kw:None
  a=v.args();self.assertNotIn('-i',a);self.assertIn('ForwardAgent=no',a);self.assertIn('StrictHostKeyChecking=yes',a)
 def test_approved_args_fixed_identity_no_agent(self):
  v=value();v._peer_identity=lambda **kw:PEER
  a=v.args();self.assertEqual(a[a.index('-i')+1],PEER['identityFile']);self.assertIn('IdentitiesOnly=yes',a);self.assertIn('IdentityAgent=none',a)
 def test_real_pinned_source_binding_and_change_refusal(self):
  with tempfile.TemporaryDirectory(dir='/private/tmp')as d:
   root=pathlib.Path(d);file=root/'scripts/account-safety/temporary-release-key.py';file.parent.mkdir(parents=True)
   raw=('def identity_for_peer(host,check_expiry=True):\n return '+repr(PEER)+'\n').encode();file.write_bytes(raw)
   v=value();v.plan={'sources':{'cop':{'root':str(root),'files':{'scripts/account-safety/temporary-release-key.py':hashlib.sha256(raw).hexdigest()}}}}
   with patch.object(m.os.path,'lexists',return_value=True):self.assertEqual(v._peer_identity(),PEER)
   with patch.object(m.os.path,'lexists',return_value=False):
    with self.assertRaisesRegex(RuntimeError,'IDENTITY_LOST'):v._peer_identity()
   file.write_bytes(raw+b'\n# drift\n')
   with patch.object(m.os.path,'lexists',return_value=True):
    with self.assertRaisesRegex(RuntimeError,'SOURCE_CHANGED'):v._peer_identity()
 def test_peer_open_noninteractive_and_never_password_fallback(self):
  for rc in [0,1]:
   with tempfile.TemporaryDirectory(dir='/private/tmp')as d:
    v=value();v.directory=pathlib.Path(d)/'control';v._peer_identity=lambda **kw:PEER;v.custody=lambda:None
    with patch.object(m.subprocess,'run',return_value=types.SimpleNamespace(returncode=rc,stdout=b'0\n'))as run,patch('builtins.open',side_effect=AssertionError('NO_TTY')),patch.object(v,'close')as close:
     if rc:
      with self.assertRaisesRegex(RuntimeError,'STORAGE_AUTH_REQUIRED'):v.open(REVIEW)
      close.assert_called_once()
     else:v.open(REVIEW);self.assertTrue(v.connected)
    args=run.call_args.args[0];self.assertIn('BatchMode=yes',args);self.assertIn('PreferredAuthentications=publickey',args);self.assertIn('PasswordAuthentication=no',args);self.assertEqual(run.call_args.kwargs['stdin'],subprocess.DEVNULL);self.assertEqual(run.call_count,1)
 def test_legacy_password_tty_semantics_remain(self):
  with tempfile.TemporaryDirectory(dir='/private/tmp')as d:
   v=value();v.directory=pathlib.Path(d)/'control';v._peer_identity=lambda **kw:None;v.custody=lambda:None;tty=MagicMock()
   with patch('builtins.open')as opened,patch.object(m.subprocess,'run',return_value=types.SimpleNamespace(returncode=0,stdout=b'0\n'))as run:
    opened.return_value.__enter__.return_value=tty;v.open(REVIEW)
   opened.assert_called_once_with('/dev/tty','r+b',buffering=0);args=run.call_args.args[0];self.assertIn('PubkeyAuthentication=no',args);self.assertIn('PreferredAuthentications=password',args);self.assertIs(run.call_args.kwargs['stdin'],tty)
 def test_close_only_control_socket_not_shared_private_identity(self):
  with tempfile.TemporaryDirectory(dir='/private/tmp')as d:
   v=value();v.directory=pathlib.Path(d)/'control';v.directory.mkdir();v.owner=(1,2);v.connected=True;(v.directory/'master.sock').write_bytes(b'synthetic socket placeholder');v.custody=lambda:None;v.args=lambda:['/usr/bin/ssh']
   with patch.object(m.subprocess,'run',side_effect=[types.SimpleNamespace(returncode=0),types.SimpleNamespace(returncode=255)])as run:v.close()
   self.assertFalse(v.directory.exists());self.assertFalse(v.connected);self.assertIsNone(v.owner);self.assertEqual(run.call_args_list[0].args[0],['/usr/bin/ssh','-O','exit','voldzi@storage.home.cz']);self.assertEqual(run.call_args_list[1].args[0],['/usr/bin/ssh','-O','check','voldzi@storage.home.cz'])
 def test_failed_storage_control_close_keeps_socket_for_outer_cleanup(self):
  for replies in [[1],[0,0]]:
   with tempfile.TemporaryDirectory(dir='/private/tmp')as d:
    v=value();v.directory=pathlib.Path(d)/'control';v.directory.mkdir();v.owner=(1,2);v.connected=True;control=v.directory/'master.sock';control.write_bytes(b'synthetic');v.custody=lambda:None;v.args=lambda:['/usr/bin/ssh']
    with patch.object(m.subprocess,'run',side_effect=[types.SimpleNamespace(returncode=x)for x in replies]):
     with self.assertRaisesRegex(RuntimeError,'CONTROL_'):v.close()
    self.assertTrue(control.exists());self.assertIsNone(v.owner)
 def test_failed_comm_control_close_keeps_socket_for_outer_cleanup(self):
  p=pathlib.Path(__file__).parents[1]/'account-safety/clean-reset-root.py';s=importlib.util.spec_from_file_location('comm_close',p);comm=importlib.util.module_from_spec(s);s.loader.exec_module(comm)
  for replies in [[1],[0,0]]:
   with tempfile.TemporaryDirectory(dir='/private/tmp')as d:
    v=comm.CommunicationResetTransport.__new__(comm.CommunicationResetTransport);v.identity=(1,2);v.temporary_key='synthetic';v.directory=pathlib.Path(d)/'control';v.directory.mkdir();v.control=v.directory/'master.sock';v.control.write_bytes(b'synthetic');v._custody=lambda:None;v._args=lambda:['/usr/bin/ssh']
    with patch.object(comm.subprocess,'run',side_effect=[types.SimpleNamespace(returncode=x)for x in replies]):v.close()
    self.assertTrue(v.control.exists());self.assertIsNone(v.identity)
if __name__=='__main__':unittest.main()
