import copy,runpy,unittest
from pathlib import Path
ROOT=Path(__file__).parent
module=runpy.run_path(str(ROOT/'configure-owned-controller.py'),run_name='test_subject')
utilities=runpy.run_path(str(ROOT/'controller-only-off.py'),run_name='test_utilities')
canonical=lambda v:module['canonical_runtime'](v,utilities['envmap'])
def fixture():
 return {'State':{'Pid':123,'StartedAt':'fixed-start','Running':True,'Health':{'Status':'healthy'}},'RestartCount':0,'Id':'a'*64,'Image':'fixed-image','Config':{'Hostname':'a'*12,'Env':['A=1','B=2'],'Labels':{'com.docker.compose.config-hash':'old','source':'fixed'}},'HostConfig':{'Binds':['/one:/one:ro,z','/two:/two:rw'],'Mounts':[{'Type':'bind','Source':'/three','Target':'/three','ReadOnly':True,'BindOptions':{'NonRecursive':True}}],'PidMode':''},'Mounts':[{'Destination':'/three','Source':'/three','RW':False,'Propagation':'rprivate'},{'Destination':'/one','Source':'/one','RW':False,'Propagation':'rprivate'}],'NetworkSettings':{'Networks':{'fixed-network':{'NetworkID':'fixed-id','IPAddress':'10.0.0.1'}}}}
class RuntimeComparison(unittest.TestCase):
 def test_only_order_and_generated_metadata_normalize(self):
  a=fixture();b=copy.deepcopy(a);b['Id']='b'*64;b['Config']['Hostname']='b'*12;b['Config']['Env'].reverse();b['HostConfig']['Binds'].reverse();b['Mounts'].reverse();b['Config']['Labels']['com.docker.compose.config-hash']='new';self.assertEqual(canonical(a),canonical(b))
 def test_duplicate_environment_is_rejected(self):
  a=fixture();a['Config']['Env'].append('A=other')
  with self.assertRaises(utilities['Stop']):canonical(a)
 def test_bind_option_cannot_disappear(self):
  a=fixture();b=copy.deepcopy(a);b['HostConfig']['Binds'][0]='/one:/one:ro';self.assertNotEqual(canonical(a),canonical(b))
 def test_structured_bind_option_cannot_disappear(self):
  a=fixture();b=copy.deepcopy(a);b['HostConfig']['Mounts'][0]['BindOptions']={};self.assertNotEqual(canonical(a),canonical(b))
 def test_host_namespace_is_preserved(self):
  a=fixture();b=copy.deepcopy(a);b['HostConfig']['PidMode']='host';self.assertNotEqual(canonical(a),canonical(b))
 def test_network_identity_is_preserved(self):
  a=fixture();b=copy.deepcopy(a);b['NetworkSettings']['Networks']['fixed-network']['NetworkID']='other-id';self.assertNotEqual(canonical(a),canonical(b))
 def test_unknown_label_is_preserved(self):
  a=fixture();b=copy.deepcopy(a);b['Config']['Labels']['unexpected']='new';self.assertNotEqual(canonical(a),canonical(b))
 def test_duplicate_mount_target_is_rejected(self):
  a=fixture();a['HostConfig']['Mounts'].append(copy.deepcopy(a['HostConfig']['Mounts'][0]))
  with self.assertRaises(ValueError):canonical(a)
class PrepublicationBoundary(unittest.TestCase):
 def matches(self,before,fresh,inputs=None,peers=None):
  return module['prepublication_matches'](before,fresh,utilities['envmap'],{'pin':'fixed'},inputs if inputs is not None else {'pin':'fixed'},{'synapse':'fixed'},peers if peers is not None else {'synapse':'fixed'})
 def test_same_healthy_process_is_allowed(self):
  a=fixture();self.assertTrue(self.matches(a,copy.deepcopy(a)))
 def test_same_cid_process_restart_is_denied(self):
  a=fixture()
  for key,value in [('Pid',999),('StartedAt','later-start')]:
   b=copy.deepcopy(a);b['State'][key]=value;self.assertFalse(self.matches(a,b))
  b=copy.deepcopy(a);b['RestartCount']=1;self.assertFalse(self.matches(a,b))
 def test_stopped_or_unhealthy_source_is_denied(self):
  a=fixture();b=copy.deepcopy(a);b['State']['Running']=False;self.assertFalse(self.matches(a,b))
  b=copy.deepcopy(a);b['State']['Health']['Status']='unhealthy';self.assertFalse(self.matches(a,b))
 def test_peer_or_input_change_is_denied(self):
  a=fixture();self.assertFalse(self.matches(a,copy.deepcopy(a),peers={'synapse':'replaced'}));self.assertFalse(self.matches(a,copy.deepcopy(a),inputs={'pin':'changed'}))
if __name__=='__main__':unittest.main()
