"""Finite orchestration core, not a host adapter or grant. Not installed.
Root must supply reviewed concrete operations and arm the independent closer
BEFORE admission. Missing native/server runners must reject preflight.
"""
import re
CASES=('stable-binding','explicit-join','outsider','source-pending','pending-restart','revoke-joined','revoke-invited','stale-context','history-and-keys','notifications','vehicle-close','lifecycle','privacy-boundaries')
ERRORS=frozenset({'WINDOW_RUNNER_NOT_READY','WINDOW_START_UNPROVEN','WINDOW_DEADLINE_REACHED','WINDOW_STOP_OR_DEADLINE','WINDOW_INVALID_CASE_OUTCOME','WINDOW_CASE_UNPROVEN','WINDOW_UNHEALTHY_OR_PENDING'})
def fixed_error(error):
 return str(error) if str(error) in ERRORS else 'WINDOW_STEP_FAILED'

def run(deadline,ops):
 results=[];opened=[];errors=[];close_result={};attempted=False
 try:
  ops.preflight() # Actual grant, hashes, identities, runners, both gates OFF.
  ops.arm_independent_deadline_closer(deadline)
  for service in ('messaging','cop'):
   if ops.stop_requested() or ops.now()>=deadline:raise RuntimeError('WINDOW_DEADLINE_REACHED')
   attempted=True;ops.open(service);opened.append(service)
  for name in CASES:
   if ops.stop_requested() or ops.now()>=deadline:raise RuntimeError('WINDOW_STOP_OR_DEADLINE')
   value=ops.run_case(name)
   if value not in ('pass','fail','not_observed','not_run'):raise RuntimeError('WINDOW_INVALID_CASE_OUTCOME')
   results.append({'id':name,'status':value})
   if value!='pass':raise RuntimeError('WINDOW_CASE_UNPROVEN')
 except Exception as error:errors.append(fixed_error(error))
 finally:
  # Preflight rejection is not permission to mutate configuration. Once even an
  # open attempt starts, its response may be uncertain: close both, never retry.
  if attempted:
   for service in ('cop','messaging'):
    try:ops.close(service);close_result[service]='closed'
    except Exception as error:
     errors.append(fixed_error(error));close_result[service]='unproven'
     if service=='cop':
      try:ops.contain_bound_cop_intake();close_result['copContainment']='intake_stopped_not_config_acceptance'
      except Exception as containment:errors.append(fixed_error(containment));close_result['copContainment']='unproven'
   ops.retain_cleanup_state()
  ops.record_sanitized_outcome(results,errors,close_result)
 return {'caseResults':results,'errors':errors,'closure':close_result,'allThirteenPassed':len(results)==13 and all(x['status']=='pass' for x in results),'windowComplete':len(results)==13 and all(x['status']=='pass' for x in results) and not errors and close_result=={'cop':'closed','messaging':'closed'},'oldImageFallback':False}
