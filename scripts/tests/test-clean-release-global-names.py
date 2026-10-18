"""Reject unresolved Python globals in the actual account-release modules.
Exercise this beside behavioral transport tests; module compilation alone does
not detect a missing name inside a function that has not yet run.
"""
import builtins
from pathlib import Path
import symtable
import unittest

class ReleaseGlobalNames(unittest.TestCase):
 def test_all_release_modules_resolve_global_names(self):
  failures=[]
  for path in sorted((Path(__file__).parents[1]/'account-safety').glob('*.py')):
   table=symtable.symtable(path.read_text(),str(path),'exec')
   defined={s.get_name()for s in table.get_symbols()if s.is_assigned()or s.is_imported()or s.is_namespace()}|set(dir(builtins))|{'__file__','__name__'}
   def scan(scope):
    for symbol in scope.get_symbols():
     if symbol.is_global()and symbol.is_referenced()and symbol.get_name()not in defined:failures.append(f'{path.name}:{scope.get_lineno()}:{symbol.get_name()}')
    for child in scope.get_children():scan(child)
   scan(table)
  self.assertEqual(failures,[], '\n'.join(failures))

if __name__=='__main__':unittest.main()
