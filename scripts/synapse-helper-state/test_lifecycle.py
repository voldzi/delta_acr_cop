import base64,contextlib,importlib.util,io,json,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('repair',Path(__file__).with_name('repair.py'));r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class Lifecycle(unittest.TestCase):
 def run_case(self,outcome):
  running=True;calls=[];actions=[]
  x={'Id':'exact','Image':r.IMAGE,'NetworkSettings':{'Networks':{'existing':{'NetworkID':'network'}}},'State':{'Running':True}}
  snap={'helperRows':[],'otherSessions':4,'source':{'preserved':1}}
  inventory=[{'id':'exact','name':'/'+r.NAME,'image':r.IMAGE,'running':True,'restartPolicy':'unless-stopped'}]
  plan={'contractVersion':'cop-synapse-missing-push-summary-position-v1','containerId':'exact','imageId':r.IMAGE,'runtimeSpecSha256':'spec','writerInventory':inventory,'databaseSnapshot':snap,'target':[['X',0]],'networkBindings':{'existing':'network'},'sqlSha256':r.hashlib.sha256(r.SQL.encode()).hexdigest()}
  def inspect(_):return {**x,'State':{'Running':running}}
  def writers():return [{**inventory[0],'running':running}]
  def command(args,**kwargs):
   nonlocal running
   if args[:3]==['docker','network','inspect']:return b'[{"Id":"network"}]'
   if args[:2]==['docker','stop']:running=False;calls.append('stop');return b''
   if args[:2]==['docker','start']:running=True;calls.append('start');return b''
   raise AssertionError('unexpected command')
  def client(body,network):
   actions.append(body['action'])
   if body['action']=='apply':
    if outcome=='success':return {'applied':True}
    raise RuntimeError('HELPER_TEST_TRANSPORT_UNCERTAIN')
   rows=[] if outcome=='old' else [['X',99]] if outcome=='unproven' else [['X',0]]
   return {'snapshot':{**snap,'helperRows':rows,'otherSessions':0}}
  with tempfile.TemporaryDirectory() as d,patch.object(r,'ATTEMPT',str(Path(d)/'attempt')),patch.object(r,'inspect',inspect),patch.object(r,'spec',lambda _: 'spec'),patch.object(r,'writers',writers),patch.object(r,'inputs',lambda:{}),patch.object(r,'run',command),patch.object(r,'client',client),patch.object(r,'clean_client',lambda:None),patch.object(sys,'argv',['repair','--apply-plan-base64',base64.b64encode(json.dumps(plan).encode()).decode()]),contextlib.redirect_stdout(io.StringIO()):
   error=None
   try:r.main()
   except RuntimeError as e:error=str(e)
  return running,calls,actions,error
 def test_success_same_container_restart(self):
  running,calls,actions,error=self.run_case('success');self.assertTrue(running);self.assertEqual(actions,['apply']);self.assertEqual(calls,['stop','start']);self.assertIsNone(error)
 def test_uncertain_commit_readback_no_second_insert(self):
  running,calls,actions,error=self.run_case('committed');self.assertTrue(running);self.assertEqual(actions,['apply','readback']);self.assertEqual(calls,['stop','start']);self.assertIsNotNone(error)
 def test_uncertain_rollback_readback_no_second_insert(self):
  running,calls,actions,error=self.run_case('old');self.assertTrue(running);self.assertEqual(actions,['apply','readback']);self.assertIsNotNone(error)
 def test_unknown_readback_leaves_stopped(self):
  running,calls,actions,error=self.run_case('unproven');self.assertFalse(running);self.assertEqual(calls,['stop']);self.assertEqual(actions,['apply','readback']);self.assertIsNotNone(error)
 def test_optimized_client_refuses_before_connection(self):
  code="import sys,types;sys.modules['psycopg2']=types.SimpleNamespace(connect=lambda **kw: (_ for _ in ()).throw(Exception('CONNECT_MUST_NOT_RUN')));exec("+repr(r.CLIENT)+")"
  p=subprocess.run([sys.executable,'-O','-c',code],input=json.dumps({'ca':'synthetic','args':{},'action':'apply'}),text=True,capture_output=True)
  self.assertEqual(p.returncode,2);self.assertIn('HELPER_OPTIMIZED_PYTHON_REJECTED',p.stdout);self.assertNotIn('CONNECT_MUST_NOT_RUN',p.stdout)
if __name__=='__main__':unittest.main()
