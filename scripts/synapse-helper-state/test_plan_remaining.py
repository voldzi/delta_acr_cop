import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('planner',Path(__file__).with_name('plan_remaining.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ReviewPlanTests(unittest.TestCase):
 def snapshot(self):return dict(image=m.IMAGE,event_boundary=32390,state_delta_boundary=32390,receipt_rows=0,summary_rows=0,summary_position=0,summary_max_position=0,summary_helper_rows=1,receipt_helper_rows=0,stats_helper_rows=0,directory_helper_rows=0,forgetter_helper_rows=0,rebuild_jobs_present=False,rebuild_staging_present=False,forget_on_leave=None,retained_local_leave_candidates=None)
 def stage(self,s,name):return next(v for v in m.plan(s)['stages'] if v['name']==name)
 def test_empty_receipts_zero_replays_nothing(self):self.assertEqual(self.stage(self.snapshot(),'receipt')['insert']['stream_id'],0)
 def test_nonempty_receipts_never_seed_to_max(self):
  s=self.snapshot();s['receipt_rows']=3;self.assertEqual(self.stage(s,'receipt')['disposition'],'hold')
 def test_summary_progress_preserved(self):
  s=self.snapshot();s.update(summary_rows=3,summary_position=50,summary_max_position=50);self.assertNotIn('summary_position',self.stage(s,'receipt')['insert'])
 def test_stats_cannot_skip_baseline_jobs(self):
  x=self.stage(self.snapshot(),'stats');self.assertEqual(len(x['jobs']),2);self.assertEqual(x['jobs'][1]['depends_on'],x['jobs'][0]['name']);self.assertEqual(x['coverageBoundary'],32390)
 def test_directory_null_requires_full_ordered_rebuild(self):
  x=self.stage(self.snapshot(),'directory');self.assertIsNone(x['insert']['stream_id']);self.assertEqual(len(x['jobs']),4)
  for before,after in zip(x['jobs'],x['jobs'][1:]):self.assertEqual(after['depends_on'],before['name'])
 def test_existing_jobs_or_staging_are_never_replaced(self):
  for key in ['rebuild_jobs_present','rebuild_staging_present']:
   s=self.snapshot();s[key]=True
   for name in ['stats','directory']:self.assertEqual(self.stage(s,name)['disposition'],'hold')
 def test_unknown_forgetting_state_blocks(self):self.assertEqual(self.stage(self.snapshot(),'forgetter')['disposition'],'hold')
 def test_enabled_forgetting_with_leave_candidates_blocks(self):
  s=self.snapshot();s.update(forget_on_leave=True,retained_local_leave_candidates=1);self.assertEqual(self.stage(s,'forgetter')['disposition'],'hold')
 def test_disabled_forgetting_uses_current_boundary(self):
  s=self.snapshot();s['forget_on_leave']=False;self.assertEqual(self.stage(s,'forgetter')['insert']['stream_id'],32390)
 def test_enabled_with_no_leave_transitions_covers_retained_deltas(self):
  s=self.snapshot();s.update(forget_on_leave=True,retained_local_leave_candidates=0);self.assertEqual(self.stage(s,'forgetter')['insert']['stream_id'],0)
 def test_existing_helpers_no_overwrite(self):
  s=self.snapshot()
  for k in ['receipt_helper_rows','stats_helper_rows','directory_helper_rows','forgetter_helper_rows']:s[k]=1
  self.assertEqual(m.plan(s)['stages'],[])
 def test_wrong_image_or_ambiguous_cardinality_refuses(self):
  for k,v in [('image','other'),('stats_helper_rows',2),('state_delta_boundary',40000),('summary_helper_rows',0),('summary_max_position',50),('rebuild_jobs_present',None),('forget_on_leave','false'),('retained_local_leave_candidates',-1)]:
   s=self.snapshot();s[k]=v
   with self.assertRaises(ValueError):m.plan(s)
 def test_planner_never_authorizes_live_apply(self):self.assertFalse(m.plan(self.snapshot())['liveApplyReady'])
if __name__=='__main__':unittest.main()
