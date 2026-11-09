#!/usr/bin/env python3
"""Pure review planner. No database, network, subprocess or mutation entrypoint.
The input is aggregate preflight metadata, never credentials or user content.
"""
import json,sys
IMAGE='sha256:b2a34f5a1b963e50446e0ea389e214d196e72a2536faca090209b15d5a5a4888'
DIRECTORY_JOBS=[
 ('populate_user_directory_createtables',None),
 ('populate_user_directory_process_rooms','populate_user_directory_createtables'),
 ('populate_user_directory_process_users','populate_user_directory_process_rooms'),
 ('populate_user_directory_cleanup','populate_user_directory_process_users')]
STATS_JOBS=[('populate_stats_process_rooms',None),('populate_stats_process_users','populate_stats_process_rooms')]
def require(value,code):
 if not value:raise ValueError(code)
def plan(s):
 require(s['image']==IMAGE,'PINNED_SOURCE_REQUIRED')
 for key in ['event_boundary','state_delta_boundary','receipt_rows','summary_rows','summary_position','summary_max_position']:
  require(type(s[key]) is int and s[key]>=0,'AGGREGATE_SHAPE_INVALID')
 require(s['state_delta_boundary']<=s['event_boundary'],'STATE_BOUNDARY_AHEAD_OF_EVENTS')
 for key in ['rebuild_jobs_present','rebuild_staging_present']:
  require(type(s[key]) is bool,'REBUILD_STATUS_UNPROVEN')
 require(s.get('forget_on_leave') is None or type(s['forget_on_leave']) is bool,'FORGET_POLICY_UNPROVEN')
 require(s.get('retained_local_leave_candidates') is None or (type(s['retained_local_leave_candidates']) is int and s['retained_local_leave_candidates']>=0),'LEAVE_SCAN_UNPROVEN')
 for key in ['receipt_helper_rows','stats_helper_rows','directory_helper_rows','forgetter_helper_rows']:
  require(type(s[key]) is int and s[key] in [0,1],'HELPER_CARDINALITY_UNPROVEN')
 require(type(s['summary_helper_rows']) is int and s['summary_helper_rows']==1 and s['summary_position']>=s['summary_max_position'],'SUMMARY_BASELINE_UNPROVEN')
 stages=[]
 if s['receipt_helper_rows']==0:
  if s['receipt_rows']==0:
   stages.append({'name':'receipt','disposition':'candidate','insert':{'table':'event_push_summary_last_receipt_stream_id','lock':'X','stream_id':0},'needs':['fresh empty-receipt CAS','preserve existing summary and push actions','normal native receipt/rotation processing only']})
  else:
   stages.append({'name':'receipt','disposition':'hold','reason':'NONEMPTY_RECEIPTS_NEED_SEPARATE_THREADED_REPLAY_REVIEW','forbidden':'seed MAX(receipts) and silently skip existing receipts'})
 if s['stats_helper_rows']==0:
  if s['rebuild_jobs_present'] or s['rebuild_staging_present']:
   stages.append({'name':'stats','disposition':'hold','reason':'EXISTING_REBUILD_MUST_NOT_BE_REPLACED'})
  else:
   stages.append({'name':'stats','disposition':'native-rebuild-review','insert':{'table':'stats_incremental_position','lock':'X','stream_id':s['event_boundary']},'jobs':[{'name':n,'depends_on':d,'progress':{}} for n,d in STATS_JOBS],'coverageBoundary':s['state_delta_boundary'],'needs':['atomic boundary and job enqueue under stopped writers','native absolute recalculation for every existing room and user','verify per-entity completion covers state delta boundary','review native processor/job concurrency in actual-image fixture before apply'],'forbidden':'standalone MAX seed without baseline rebuild'})
 if s['directory_helper_rows']==0:
  if s['rebuild_jobs_present'] or s['rebuild_staging_present']:
   stages.append({'name':'directory','disposition':'hold','reason':'EXISTING_REBUILD_MUST_NOT_BE_REPLACED'})
  else:
   stages.append({'name':'directory','disposition':'native-rebuild-review','insert':{'table':'user_directory_stream_pos','lock':'X','stream_id':None},'jobs':[{'name':n,'depends_on':d,'progress':{}} for n,d in DIRECTORY_JOBS],'needs':['explicit review of derived-directory rebuild','native delete_all_from_user_dir clears derived search/visibility entries','native staging captures state delta boundary; cleanup publishes it','preserve search_all_users and local-profile rules','verify deltas arriving during staging are caught up after cleanup'],'forbidden':'NULL seed without complete native job chain'})
 if s['forgetter_helper_rows']==0:
  flag=s.get('forget_on_leave');candidates=s.get('retained_local_leave_candidates')
  if flag is False:
   stages.append({'name':'forgetter','disposition':'candidate-after-config-proof','insert':{'table':'room_forgetter_stream_pos','lock':'X','stream_id':s['event_boundary']},'needs':['effective forget_on_leave=false proof and config CAS','native disabled handler advances to current event token without forgetting']})
  elif flag is True and type(candidates) is int and candidates==0:
   stages.append({'name':'forgetter','disposition':'candidate-after-delta-proof','insert':{'table':'room_forgetter_stream_pos','lock':'X','stream_id':0},'needs':['complete retained-delta scan proves no eligible local join-to-leave transitions','fresh no-candidate CAS; no retroactive forgetting','normal processor handles future transitions']})
  else:
   stages.append({'name':'forgetter','disposition':'hold','reason':'RETROACTIVE_FORGETTING_SCOPE_UNPROVEN','forbidden':'guess zero or MAX with unknown flag/leave candidates'})
 return {'contractVersion':'cop-synapse-remaining-helper-review-v1','reviewOnly':True,'liveApplyReady':False,'productionChanged':False,'stages':stages,'sharedGuards':['exact image/container/config/network/writer inventory CAS','zero other database writers after coordinated stop','native table shape/constraint/trigger proof','no helper UPDATE/overwrite or global table reset','preserve accounts/devices/E2EE keys/rooms/events; no token handling','separate per-stage receipt and rollback/resume decision']}
if __name__=='__main__':print(json.dumps(plan(json.load(sys.stdin)),indent=2))
