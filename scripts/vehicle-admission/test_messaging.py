import importlib.util,json,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('window_messaging',Path(__file__).with_name('messaging.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Messaging(unittest.TestCase):
 def pin(self):return json.dumps({'services':{'api':{'image':m.IMAGE,'environment':{'CSM_VEHICLE_CONTROLLER_MATRIX_USER_ID':'@csm.vehicle.controller.v1:docker.home.cz','CSM_VEHICLE_CONTROLLER_CUSTODY_REVIEWED':'true','OTHER_SECRET_REF':'${EXISTING_SECRET}'}}}}).encode()
 def test_open_and_close_change_only_one_field(self):
  before=json.loads(self.pin());opened=json.loads(m.pin_delta(self.pin(),'open'));self.assertEqual(opened['services']['api']['environment'].pop(m.FLAG),'true');self.assertEqual(opened,before);closed=json.loads(m.pin_delta(m.pin_delta(self.pin(),'open'),'close'));self.assertEqual(closed['services']['api']['environment'].pop(m.FLAG),'false');self.assertEqual(closed,before)
 def test_different_image_or_controller_refused(self):
  for key,value in [('image','other'),('controller','@wrong:example.invalid')]:
   pin=json.loads(self.pin())
   if key=='image':pin['services']['api']['image']=value
   else:pin['services']['api']['environment']['CSM_VEHICLE_CONTROLLER_MATRIX_USER_ID']=value
   with self.assertRaises(RuntimeError):m.pin_delta(json.dumps(pin).encode(),'open')
 def test_close_before_any_recreation_after_failed_open(self):
  self.assertEqual(m.close_source_kind('false','original','original','target','base-pin','base-pin','target-pin'),'no_open_observed')
  self.assertEqual(m.close_source_kind('false','original','original','target','target-pin','base-pin','target-pin'),'pin_only')
 def test_close_restarted_or_unhealthy_open_config_is_semantically_allowed(self):
  self.assertEqual(m.close_source_kind('true','target','original','target','target-pin','base-pin','target-pin'),'recreate_off')
 def test_unknown_runtime_or_persistent_pin_never_adopted(self):
  for actual,pin in [('unknown','target-pin'),('target','unknown-pin')]:
   with self.assertRaises(RuntimeError):m.close_source_kind('true',actual,'original','target',pin,'base-pin','target-pin')
if __name__=='__main__':unittest.main()
