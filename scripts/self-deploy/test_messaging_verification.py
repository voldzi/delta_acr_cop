import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('messaging_verify',Path(__file__).with_name('verify-messaging-current-contract.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class LegacyVolumeBoundary(unittest.TestCase):
 def test_only_exact_approved_volume(self):
  value={'Name':'csm-messaging_messaging-data','CreatedAt':'2026-07-08T17:26:43Z','Labels':None}
  self.assertTrue(m.volume_owned(value,value['Name'],'messaging-data','/data'))
  for v,name,source,target in [({**value,'CreatedAt':'2026-11-04T17:00:00Z'},value['Name'],'messaging-data','/data'),(value,'other','messaging-data','/data'),(value,value['Name'],'other','/data'),(value,value['Name'],'messaging-data','/other'),({**value,'Labels':{'com.docker.compose.project':'other'}},value['Name'],'messaging-data','/data')]:
   self.assertFalse(m.volume_owned(v,name,source,target))
if __name__=='__main__':unittest.main()
