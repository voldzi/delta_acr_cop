import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('window_supervisor',Path(__file__).with_name('supervisor.py'));s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
class Ops:
 def __init__(self):self.events=[];self.time=100;self.bad_preflight=False;self.fail_open=None;self.fail_close=None;self.outcome='pass'
 def preflight(self):
  self.events.append('preflight')
  if self.bad_preflight:raise RuntimeError('WINDOW_RUNNER_NOT_READY')
 def arm_independent_deadline_closer(self,deadline):self.events.append('timer_armed')
 def now(self):return self.time
 def stop_requested(self):return False
 def open(self,service):
  self.events.append('open_'+service)
  if self.fail_open==service:raise RuntimeError('WINDOW_START_UNPROVEN')
 def close(self,service):
  self.events.append('close_'+service)
  if self.fail_close==service:raise RuntimeError('WINDOW_UNHEALTHY_OR_PENDING')
 def run_case(self,name):self.events.append('case_'+name);return self.outcome
 def contain_bound_cop_intake(self):self.events.append('stop_bound_cop_only')
 def retain_cleanup_state(self):self.events.append('keep_cleanup_state')
 def record_sanitized_outcome(self,*args):self.events.append('record')
class Supervisor(unittest.TestCase):
 def test_actual_order_timer_before_any_global_open_and_cop_first_close(self):
  o=Ops();r=s.run(200,o);self.assertTrue(r['windowComplete']);self.assertEqual(o.events[:4],['preflight','timer_armed','open_messaging','open_cop']);self.assertLess(o.events.index('close_cop'),o.events.index('close_messaging'))
 def test_missing_runner_never_mutates(self):
  o=Ops();o.bad_preflight=True;r=s.run(200,o);self.assertFalse(r['windowComplete']);self.assertEqual(o.events,['preflight','record'])
 def test_uncertain_start_still_closes_both_no_retry(self):
  o=Ops();o.fail_open='cop';r=s.run(200,o);self.assertFalse(r['windowComplete']);self.assertEqual(o.events.count('open_cop'),1);self.assertIn('close_cop',o.events);self.assertIn('close_messaging',o.events)
 def test_bad_health_restart_or_pending_close_can_contain_without_claim(self):
  o=Ops();o.fail_close='cop';r=s.run(200,o);self.assertFalse(r['windowComplete']);self.assertIn('stop_bound_cop_only',o.events);self.assertEqual(r['closure']['cop'],'unproven');self.assertIn('close_messaging',o.events)
 def test_unobserved_case_never_promoted_to_pass(self):
  o=Ops();o.outcome='not_observed';r=s.run(200,o);self.assertFalse(r['allThirteenPassed']);self.assertEqual(len(r['caseResults']),1);self.assertIn('close_cop',o.events)
 def test_unknown_exception_payload_is_never_printed(self):
  self.assertEqual(s.fixed_error(RuntimeError('SYNTHETIC_SECRET_SHOULD_NOT_ESCAPE')),'WINDOW_STEP_FAILED')
 def test_deadline_never_opens(self):
  o=Ops();r=s.run(100,o);self.assertFalse(r['windowComplete']);self.assertFalse(any(x.startswith('open_') for x in o.events))
if __name__=='__main__':unittest.main()
