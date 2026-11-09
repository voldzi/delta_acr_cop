"""Apply-path DB-API fixture: no-result LOCK, CAS, uncertainty, optimization.
No network, production database, or runtime credentials.
"""
import importlib.util, json, os, subprocess, sys, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('repair',Path(__file__).with_name('repair.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
FIXTURE=r'''
import sys,types,json
state={'counter':630,'sets':0,'locks':0,'connects':0}
class Cursor:
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def execute(self,sql,args):
  self.description=[('value',)];self.rows=[]
  if sql.startswith('LOCK TABLE'):
   state['locks']+=1;self.description=None
  elif sql=='SHOW transaction_read_only':self.rows=[('off',)]
  elif sql.startswith('SELECT last_value'):self.rows=[(state['counter'],True)]
  elif sql.startswith('SELECT seqincrement'):self.rows=[(1,1,9223372036854775807)]
  elif sql.startswith('SELECT instance_name'):self.rows=[('master',660)]
  elif sql.startswith('SELECT max(stream_id)'):self.rows=[(None,0)]
  elif sql.startswith('SELECT current_database'):self.rows=[('fixture','fixture',42)]
  elif sql.startswith('SELECT count(*) FROM pg_stat_activity'):self.rows=[(0,)]
  elif sql.startswith("SELECT setval"):
   state['sets']+=1;state['counter']=660;self.rows=[(660,)]
  elif sql.startswith('SELECT pg_advisory') or sql.startswith('SELECT pg_stat_clear'):self.rows=[(None,)]
  else:raise RuntimeError('unexpected query')
 def fetchall(self):
  if self.description is None:raise RuntimeError('fetchall without resultset')
  return self.rows
class Connection:
 def set_session(self,**args):assert args['readonly'] is False
 def cursor(self):return Cursor()
 def commit(self):pass
 def rollback(self):pass
 def close(self):pass
def connect(**args):state['connects']+=1;return Connection()
sys.modules['psycopg2']=types.SimpleNamespace(connect=connect)
'''
class ClientBoundary(unittest.TestCase):
 def body(self):
  return {'args':{},'ca':'synthetic public CA','action':'apply','sql':r.SQL,
          'expected':{'target':660,'databaseSnapshot':{'lastValue':630,'isCalled':True,'increment':1,'cache':1,'sequenceMax':9223372036854775807,'positions':[['master',660]],'maxima':{'device_inbox':None,'device_federation_outbox':None},'rowCounts':{'device_inbox':0,'device_federation_outbox':0},'database':'fixture','role':'fixture','databaseOid':42,'otherSessions':0}}}
 def run_client(self,body,optimized=False):
  code=FIXTURE+'\ntry:\n exec('+repr(r.CLIENT)+')\nfinally:\n print("FIXTURE "+json.dumps(state))\n'
  p=subprocess.run([sys.executable,*(['-O'] if optimized else []),'-c',code],input=json.dumps(body),text=True,capture_output=True)
  records=[json.loads(v.split(' ',1)[1]) for v in p.stdout.splitlines() if v.startswith('FIXTURE ')]
  return p,records[0]
 def test_apply_lock_has_no_result_and_commits_exact_forward_counter(self):
  p,s=self.run_client(self.body());self.assertEqual(p.returncode,0,p.stderr);self.assertEqual(s,{'counter':660,'sets':1,'locks':1,'connects':1});self.assertIn('"applied": true',p.stdout)
 def test_stale_database_snapshot_never_calls_setval(self):
  b=self.body();b['expected']['databaseSnapshot']['positions']=[['master',661]]
  p,s=self.run_client(b);self.assertEqual(p.returncode,2);self.assertEqual(s['sets'],0);self.assertIn('SEQUENCE_DATABASE_CAS',p.stdout)
 def test_optimized_python_refuses_before_database_connection(self):
  p,s=self.run_client(self.body(),True);self.assertEqual(p.returncode,2);self.assertEqual(s['connects'],0);self.assertEqual(s['sets'],0)
if __name__=='__main__':unittest.main()
