import ast
import importlib.util
from pathlib import Path
import unittest
p=Path(__file__).parents[1]/'account-safety/temporary-comm-authorize.py'
spec=importlib.util.spec_from_file_location('auth',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
# Execute exactly the production pure byte editor, with no filesystem or main.
tree=ast.parse(m.REMOTE_PROGRAM);nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name in ['need','edit_lines']]
ctx={};exec(compile(ast.Module(body=nodes,type_ignores=[]),'actual_line_editor','exec'),ctx)
edit=ctx['edit_lines'];line='restrict,from="192.168.10.116" ssh-ed25519 SYNTHETICKEY cop-clean-release-synthetic'
class AuthorizationTest(unittest.TestCase):
 def test_only_exact_new_line_added_and_removed_with_original_bytes_preserved(self):
  original=b'# preserved comment\r\nssh-ed25519 EXISTINGKEY existing\r\n'
  new=edit(original,line,'cop-clean-release-synthetic','SYNTHETICKEY','install')
  self.assertEqual(new,original+line.encode()+b'\n')
  self.assertEqual(edit(new,line,'cop-clean-release-synthetic','SYNTHETICKEY','remove'),original)
 def test_install_and_remove_are_idempotent(self):
  new=edit(b'',line,'cop-clean-release-synthetic','SYNTHETICKEY','install')
  self.assertEqual(edit(new,line,'cop-clean-release-synthetic','SYNTHETICKEY','install'),new)
  self.assertEqual(edit(b'',line,'cop-clean-release-synthetic','SYNTHETICKEY','remove'),b'')
 def test_duplicate_or_changed_matching_key_is_rejected(self):
  for bad in [(line+'\n'+line+'\n').encode(),b'ssh-ed25519 SYNTHETICKEY unexpected\n']:
   with self.assertRaises(RuntimeError):edit(bad,line,'cop-clean-release-synthetic','SYNTHETICKEY','remove')
 def test_unrelated_binary_comment_and_later_keys_are_preserved(self):
  before=b'# unrelated \xff\n';after=b'ssh-ed25519 LATERKEY later\n'
  self.assertEqual(edit(before+line.encode()+b'\n'+after,line,'cop-clean-release-synthetic','SYNTHETICKEY','remove'),before+after)
 def test_unknown_action_rejected(self):
  with self.assertRaises(RuntimeError):edit(b'',line,'cop-clean-release-synthetic','SYNTHETICKEY','replace_all')
if __name__=='__main__':unittest.main()
