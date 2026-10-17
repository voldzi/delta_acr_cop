import importlib.util
from pathlib import Path
import json
import unittest

spec=importlib.util.spec_from_file_location('recovery',Path(__file__).parents[1]/'recover-cop-builder.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def fixture():
 return {'Name':'cop-x5','Driver':'docker-container','Dynamic':False,'Nodes':[{'Name':'cop-x50','Endpoint':'unix:///var/run/docker.sock','Platforms':None,'DriverOpts':{'image':'moby/buildkit:buildx-stable-1'},'Flags':['--oci-worker-gc','--oci-worker-gc-keepstorage','1000,10000,10000','--allow-insecure-entitlement=network.host'],'Files':None}]}


class BuilderRecoveryTest(unittest.TestCase):
 def test_existing_and_exact_pinned_configuration_are_accepted(self):
  v=fixture();self.assertEqual(m.configuration(json.dumps(v)),v)
  v['Nodes'][0]['DriverOpts']={'image':m.REFERENCE,'restart-policy':'no'}
  self.assertEqual(m.configuration(json.dumps(v)),v)
  v['Nodes'][0]['Flags'].append(m.FLAGS[-1]);self.assertEqual(m.configuration(json.dumps(v)),v)
 def test_other_builder_daemon_node_and_unknown_driver_options_are_rejected(self):
  for mutate in [lambda v:v.update(Name='shared'),lambda v:v.update(Driver='docker'),lambda v:v['Nodes'].append(v['Nodes'][0]),lambda v:v['Nodes'][0].update(Endpoint='tcp://foreign:2375'),lambda v:v['Nodes'][0]['DriverOpts'].update(network='host'),lambda v:v['Nodes'][0]['DriverOpts'].update(image='foreign:latest'),lambda v:v['Nodes'][0]['DriverOpts'].update({'restart-policy':'always'})]:
   v=fixture();mutate(v)
   with self.assertRaises(RuntimeError):m.configuration(json.dumps(v))
 def test_gc_flags_and_embedded_files_are_not_silently_replaced(self):
  for key,value in [('Flags',[]),('Files',{'config':'unreviewed'}),('Platforms',['foreign'])]:
   v=fixture();v['Nodes'][0][key]=value
   with self.assertRaises(RuntimeError):m.configuration(json.dumps(v))


if __name__=='__main__':unittest.main()
