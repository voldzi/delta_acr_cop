import importlib.util,json,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('policy',Path(__file__).with_name('enable-messaging-policy.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
class Tests(unittest.TestCase):
 def test_only_one_overlay_change(self):
  old={'services':{'api':{'image':'fixed','environment':{'SECRET':'unchanged'},'volumes':['same']},'synapse':{'image':'other'}}}
  new=json.loads(p.changed_overlay(json.dumps(old).encode()));old['services']['api']['environment'][p.FLAG]='true';old['services']['api']['image']=p.IMAGE;self.assertEqual(old,new)
 def test_no_known_enabled_source_adoption(self):
  with self.assertRaises(RuntimeError):p.changed_overlay(json.dumps({'services':{'api':{'environment':{p.FLAG:'true'}}}}).encode())
 def test_effective_secret_drift_rejected(self):
  a={'services':{'api':{'environment':{'SECRET':'a'}}}};b=json.loads(json.dumps(a));b['services']['api']['environment'].update({p.FLAG:'true','SECRET':'b'})
  with self.assertRaisesRegex(RuntimeError,'EFFECTIVE_CONFIG_DRIFT'):p.check_effective(a,b)
 def test_effective_peer_drift_rejected(self):
  a={'services':{'api':{'environment':{}},'synapse':{'image':'a'}}};b=json.loads(json.dumps(a));b['services']['api']['environment'][p.FLAG]='true';b['services']['synapse']['image']='b'
  with self.assertRaisesRegex(RuntimeError,'EFFECTIVE_CONFIG_DRIFT'):p.check_effective(a,b)
 def runtime_pair(self):
  from copy import deepcopy
  old={'Image':p.IMAGE,'Config':{'Env':['SECRET=preserved'],'Labels':{},'Hostname':'old'},'HostConfig':{'Privileged':False,'PortBindings':{'4050/tcp':[{'HostPort':'4050'}]}},'NetworkSettings':{'Networks':{'internal':{}}},'State':{'Running':True}}
  new=deepcopy(old);new['Config']['Env']+= [p.FLAG+'=true'];new['Config']['Hostname']='new';return old,new
 def test_valid_runtime_does_not_need_secret_output(self):
  old,new=self.runtime_pair();p.check_runtime(old,new)
 def test_image_drift_is_rejected(self):
  old,new=self.runtime_pair();new['Image']='different'
  with self.assertRaisesRegex(RuntimeError,'IMAGE_CHANGED'):p.check_runtime(old,new)
 def test_runtime_secret_drift_is_rejected(self):
  old,new=self.runtime_pair();new['Config']['Env'][0]='SECRET=changed'
  with self.assertRaisesRegex(RuntimeError,'RUNTIME_ENV_DRIFT'):p.check_runtime(old,new)
 def test_host_security_or_port_drift_is_not_silenced(self):
  for key,value in [('Privileged',True),('PortBindings',{})]:
   old,new=self.runtime_pair();new['HostConfig'][key]=value
   with self.assertRaisesRegex(RuntimeError,'HOST_CONFIG_DRIFT'):p.check_runtime(old,new)
if __name__=='__main__':unittest.main()
