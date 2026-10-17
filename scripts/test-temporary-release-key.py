import importlib.util,unittest,types,datetime,stat
from pathlib import Path
from unittest.mock import patch,MagicMock
ROOT=Path(__file__).parent/'account-safety'
def load(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
k=load('release_key','temporary-release-key.py')
a=load('release_auth','temporary-release-authorize.py')
class PeerIdentityTests(unittest.TestCase):
 def fixture(self):
  private={'contractVersion':'cop-temporary-comm-identity-v1','marker':'cop-clean-release-123','publicKey':'ssh-ed25519 synthetic cop-clean-release-123','privateSha256':'private-hash','fingerprint':'fp','expiresAt':(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=1)).isoformat(),'authorizedLine':'restricted synthetic','authorizedLineSha256':'sha'}
  receipt={'contractVersion':'cop-release-peer-identity-v1','purpose':'cop-sim-clean-release','hosts':['comm.home.cz','storage.home.cz'],'identity':k.public_identity(private)}
  return private,receipt
 def test_exact_peer_binding_rejects_host_scope_or_identity_expansion(self):
  private,v=self.fixture();k.validate_binding(v,private)
  for change in [{'hosts':['storage.home.cz']},{'hosts':['comm.home.cz','storage.home.cz','other.home.cz']},{'purpose':'unrelated'},{'extra':True},{'identity':{**v['identity'],'fingerprint':'different'}}]:
   with self.subTest(change=list(change)),self.assertRaises(RuntimeError):k.validate_binding({**v,**change},private)
 def test_no_password_fallback_or_arbitrary_peer(self):
  with self.assertRaises(RuntimeError):k.identity_for_peer('other.home.cz')
  _,v=self.fixture()
  with patch.object(k,'identity',return_value=v),patch.object(k.subprocess,'run',return_value=types.SimpleNamespace(returncode=0,stdout=b'ssh-ed25519 synthetic cop-clean-release-123\n')):
   b=k.identity_for_peer('storage.home.cz');self.assertEqual(b['identityFile'],'/run/cop-clean-reset-comm/id_ed25519')
   self.assertNotIn('privateSha256',b)
 def test_derived_key_comment_validation(self):
  _,v=self.fixture()
  for derived,valid in [(b'ssh-ed25519 synthetic',True),(b'ssh-ed25519 synthetic cop-clean-release-123',True),(b'ssh-ed25519 synthetic wrong',False),(b'ssh-ed25519 different',False),(b'ssh-ed25519 synthetic cop-clean-release-123 extra',False)]:
   with self.subTest(derived=derived),patch.object(k,'identity',return_value=v),patch.object(k.subprocess,'run',return_value=types.SimpleNamespace(returncode=0,stdout=derived)):
    if valid:self.assertEqual(k.identity_for_peer('storage.home.cz')['host'],'storage.home.cz')
    else:
     with self.assertRaises(RuntimeError):k.identity_for_peer('storage.home.cz')
 def test_expiry_blocks_new_auth_but_allows_cleanup_validation(self):
  _,v=self.fixture();v['identity']['expiresAt']='2020-01-01T00:00:00+00:00'
  with patch.object(k,'identity',return_value=v),patch.object(k.subprocess,'run',return_value=types.SimpleNamespace(returncode=0,stdout=b'ssh-ed25519 synthetic')):
   with self.assertRaises(RuntimeError):k.identity_for_peer('storage.home.cz')
   self.assertEqual(k.identity_for_peer('storage.home.cz',False)['host'],'storage.home.cz')
 def test_both_removals_attempted_before_wipe_when_first_peer_fails(self):
  _,v=self.fixture();events=[]
  def remove(host,public,program):
   events.append(host)
   if host=='comm.home.cz':raise OSError('synthetic failure')
   return True
  def wipe(value):events.append('wipe');self.assertEqual(value,v);return True
  with patch.object(k,'identity',return_value=v),patch.object(k,'close_controls',return_value={h:True for h in k.HOSTS}),patch.object(k,'module',return_value=types.SimpleNamespace(REMOTE_PROGRAM='public-code')),patch.object(k,'remove_peer',side_effect=remove),patch.object(k,'wipe_local',side_effect=wipe):
   r=k.cleanup_release_identity()
  self.assertEqual(events,['comm.home.cz','storage.home.cz','wipe']);self.assertFalse(r['exactAuthorizationsAbsent']);self.assertTrue(r['temporaryPrivateIdentityRemoved']);self.assertTrue(r['peers']['storage.home.cz'])
 def test_success_requires_both_peers_and_wipe(self):
  _,v=self.fixture()
  with patch.object(k,'identity',return_value=v),patch.object(k,'close_controls',return_value={h:True for h in k.HOSTS}),patch.object(k,'module',return_value=types.SimpleNamespace(REMOTE_PROGRAM='public-code')),patch.object(k,'remove_peer',return_value=True),patch.object(k,'wipe_local',return_value=True):r=k.cleanup_release_identity()
  self.assertTrue(r['exactAuthorizationsAbsent']);self.assertTrue(r['temporaryPrivateIdentityRemoved'])
 def test_helper_failure_still_wipes_private_authority(self):
  _,v=self.fixture()
  with patch.object(k,'identity',return_value=v),patch.object(k,'close_controls',return_value={h:True for h in k.HOSTS}),patch.object(k,'module',side_effect=RuntimeError('invalid helper')),patch.object(k,'wipe_local',return_value=True)as wipe:
   with self.assertRaises(RuntimeError):k.cleanup_release_identity()
   wipe.assert_called_once_with(v)
 def test_authorizer_rejects_wrong_actual_peer_before_reading_payload(self):
  namespace={};exec(compile(a.REMOTE_PROGRAM.split('\ntry:main()',1)[0],'<public-authorizer>','exec'),namespace)
  with patch.object(namespace['os'],'geteuid',return_value=0),patch.object(namespace['socket'],'gethostname',return_value='comm'),patch.object(namespace['sys'],'argv',['authorizer','storage.home.cz','install']):
   with self.assertRaises(RuntimeError):namespace['main']()
 def test_control_socket_removed_only_after_exit_and_negative_check(self):
  path=MagicMock();path.parent.is_symlink.return_value=False;path.parent.lstat.return_value=types.SimpleNamespace(st_mode=stat.S_IFDIR|0o700,st_uid=0)
  path.lstat.return_value=types.SimpleNamespace(st_mode=stat.S_IFSOCK|0o600,st_uid=0,st_dev=1,st_ino=2)
  with patch.object(k.os.path,'lexists',return_value=True),patch.object(k.subprocess,'run',side_effect=[types.SimpleNamespace(returncode=0),types.SimpleNamespace(returncode=255)])as run:
   self.assertTrue(k.close_control('storage.home.cz',path))
  path.unlink.assert_called_once();self.assertEqual([call.args[0][-3:]for call in run.call_args_list],[['-O','exit','voldzi@storage.home.cz'],['-O','check','voldzi@storage.home.cz']])
 def test_failed_control_exit_leaves_socket_for_explicit_recovery(self):
  path=MagicMock();path.parent.is_symlink.return_value=False;path.parent.lstat.return_value=types.SimpleNamespace(st_mode=stat.S_IFDIR|0o700,st_uid=0)
  path.lstat.return_value=types.SimpleNamespace(st_mode=stat.S_IFSOCK|0o600,st_uid=0)
  with patch.object(k.os.path,'lexists',return_value=True),patch.object(k.subprocess,'run',return_value=types.SimpleNamespace(returncode=255)):
   with self.assertRaises(RuntimeError):k.close_control('storage.home.cz',path)
  path.unlink.assert_not_called()
 def test_failed_control_shutdown_is_not_reported_as_complete(self):
  _,v=self.fixture()
  with patch.object(k,'identity',return_value=v),patch.object(k,'module',return_value=types.SimpleNamespace(REMOTE_PROGRAM='public-code')),patch.object(k,'remove_peer',return_value=True),patch.object(k,'close_controls',return_value={'comm.home.cz':False,'storage.home.cz':True}),patch.object(k,'wipe_local',return_value=True):r=k.cleanup_release_identity()
  self.assertTrue(r['temporaryPrivateIdentityRemoved']);self.assertTrue(r['exactAuthorizationsAbsent']);self.assertFalse(r['controlSessionsClosed'])
 def test_exact_line_edit_preserves_existing_other_keys(self):
  namespace={};exec(compile(a.REMOTE_PROGRAM.split('\ntry:main()',1)[0],'<public-authorizer>','exec'),namespace)
  old=b'# existing\r\nssh-ed25519 unrelated old\n';line='restrict,from="192.168.10.116" ssh-ed25519 synthetic marker'
  add=namespace['edit_lines'](old,line,'marker','synthetic','install')
  self.assertTrue(add.startswith(old));self.assertEqual(namespace['edit_lines'](add,line,'marker','synthetic','remove'),old)
if __name__=='__main__':unittest.main()
