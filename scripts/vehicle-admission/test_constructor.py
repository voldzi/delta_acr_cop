import hashlib,importlib.util,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('window_constructor',Path(__file__).with_name('constructor.py'));c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
class Constructor(unittest.TestCase):
 def guard(self):
  suffix='PLANNING_CONFIG_V3_VERSION, PLANNING_ENABLE_V4_VERSION, ADMISSION_IMAGE_VERSION, APPLICATION_IMAGE_VERSION}'
  return ("PLANNING_CONFIG_V3_KERNEL_SHA256 = '"+c.PARENT+"'\n"+'\n'.join('x'+str(i)+' = {'+suffix for i in range(8))+'\n').encode()
 def test_only_exact_known_dispatch_expands(self):
  raw=self.guard()
  with patch.object(c,'BASE',c.sha(raw)):
   new=c.construct(raw,b"VERSION='cop-application-owned-image-v1'\n")
   self.assertEqual(new.count(b'VEHICLE_WINDOW_VERSION'),9)
   with self.assertRaises(ValueError):c.construct(raw+b'# drift\n',b'pass\n')
 def test_missing_anchor_or_extra_dispatch_refuses(self):
  raw=self.guard().replace(b'x0 =',b'# x0 =')+b'x9={PLANNING_CONFIG_V3_VERSION, PLANNING_ENABLE_V4_VERSION, ADMISSION_IMAGE_VERSION, APPLICATION_IMAGE_VERSION}\n'
  with patch.object(c,'BASE',c.sha(raw)),self.assertRaises(ValueError):c.construct(raw,b'pass\n')
 def test_policy_only_repins_guard_no_new_broker_capability(self):
  import json
  raw=json.dumps({'contractVersion':'cop-self-release-policy-v1','guardSha256':c.BASE,'assets':{'scripts/cop-api-runtime.py':c.BASE,'scripts/self-deploy/broker.py':c.BROKER},'existingCapability':'code_only'}).encode()
  with patch.object(c,'POLICY',c.sha(raw)):
   target=json.loads(c.repin_policy(raw,b'new reviewed guard'))
   self.assertEqual(target['assets']['scripts/self-deploy/broker.py'],c.BROKER);self.assertEqual(target['existingCapability'],'code_only');self.assertEqual(set(target),set(json.loads(raw)))
   with self.assertRaises(ValueError):c.repin_policy(raw+b' ',b'new reviewed guard')
if __name__=='__main__':unittest.main()
