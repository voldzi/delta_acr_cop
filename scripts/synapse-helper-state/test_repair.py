import ast,copy,importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('repair',Path(__file__).with_name('repair.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
# Execute only the exact guard functions from the embedded client, never its I/O.
tree=ast.parse(r.CLIENT);nodes=[n for n in ast.walk(tree) if isinstance(n,ast.FunctionDef) and n.name in ['need','valid']]
ns={};exec(compile(ast.Module(body=nodes,type_ignores=[]),'client-guards','exec'),ns)
class MissingHelperGuards(unittest.TestCase):
 def s(self):return {'helperRows':[],'source':{'event_push_summary':{'count':0},'receipts_linearized':{'count':0}},'shape':[['lock','character(1)',True],['stream_ordering','bigint',True]],'constraints':[['c',"CHECK ((lock = 'X'::bpchar))"],['u','UNIQUE (lock)']],'userTriggers':0}
 def test_native_empty_state_allowed(self):ns['valid'](self.s())
 def test_existing_row_never_overwritten(self):
  s=self.s();s['helperRows']=[['X',32000]]
  with self.assertRaisesRegex(RuntimeError,'HELPER_NOT_MISSING'):ns['valid'](s)
 def test_nonempty_summary_or_receipts_refused(self):
  for t in ['event_push_summary','receipts_linearized']:
   s=self.s();s['source'][t]['count']=1
   with self.assertRaisesRegex(RuntimeError,'HELPER_NONEMPTY_DERIVED_STATE'):ns['valid'](s)
 def test_unknown_trigger_refused(self):
  s=self.s();s['userTriggers']=1
  with self.assertRaisesRegex(RuntimeError,'HELPER_TRIGGERS_UNREVIEWED'):ns['valid'](s)
 def test_shape_and_constraints_refused(self):
  for field,value in [('shape',[]),('constraints',[])]:
   s=self.s();s[field]=value
   with self.assertRaises(RuntimeError):ns['valid'](s)
 def test_only_insert_statement(self):
  self.assertEqual(r.SQL,"INSERT INTO public.event_push_summary_stream_ordering (lock,stream_ordering) VALUES ('X',0) RETURNING lock,stream_ordering")
if __name__=='__main__':unittest.main()
