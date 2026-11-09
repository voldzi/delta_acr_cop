#!/usr/bin/env python3
"""One missing push-summary helper row, guarded and read-only by default.
No replay/pin, credential files, message deletion, sequence or image changes.
"""
import argparse,hashlib,io,json,os,subprocess,sys,tarfile,time
IMAGE='sha256:b2a34f5a1b963e50446e0ea389e214d196e72a2536faca090209b15d5a5a4888'
NAME='csm-matrix-synapse'
LABEL='cop.synapse.push-summary-repair=20261109'
CLIENT_NAME='cop-synapse-push-summary-repair-20261109'
ATTEMPT='/home/voldzi/.cop-synapse-push-summary-repair-20261109.attempt.json'
SQL="INSERT INTO public.event_push_summary_stream_ordering (lock,stream_ordering) VALUES ('X',0) RETURNING lock,stream_ordering"
def need(ok,code):
 if not ok:raise RuntimeError(code)
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def run(args,body=None,timeout=15):
 p=subprocess.run(args,input=body,capture_output=True,timeout=timeout)
 need(p.returncode==0,'SEQUENCE_CHILD_FAILED');return p.stdout
def inspect(name):return json.loads(run(['docker','inspect',name]))[0]
def spec(x):return hashlib.sha256(encoded({k:x[k] for k in ['Id','Image','Config','HostConfig','Mounts']})).hexdigest()
def writers():
 ids=set(run(['docker','ps','-aq','--filter','name=synapse']).decode().split())
 ids.update(run(['docker','ps','-aq','--filter','ancestor='+IMAGE]).decode().split())
 return sorted([{'id':v['Id'],'name':v['Name'],'image':v['Image'],'running':v['State']['Running'],'restartPolicy':v['HostConfig']['RestartPolicy']['Name']} for v in (inspect(i) for i in ids)],key=lambda v:v['id'])
CLIENT = 'import sys,json,psycopg2,tempfile,os,hashlib\nb=json.load(sys.stdin);fd,path=tempfile.mkstemp(prefix=\'cop-public-ca-\',suffix=\'.crt\');os.fchmod(fd,0o600);os.write(fd,b[\'ca\'].encode());os.close(fd);c=None\ntry:\n if not __debug__:raise RuntimeError(\'HELPER_OPTIMIZED_PYTHON_REJECTED\')\n args=b[\'args\'];args.update(sslmode=\'verify-full\',sslrootcert=path,connect_timeout=4,application_name=\'cop-reviewed-push-summary-repair\',options=\'-c statement_timeout=5000 -c lock_timeout=3000\')\n c=psycopg2.connect(**args);c.set_session(readonly=b[\'action\']!=\'apply\',autocommit=False)\n def need(v,code):\n  if not v:raise RuntimeError(code)\n def q(sql,args=None):\n  with c.cursor() as cur:\n   cur.execute(sql,args);return cur.fetchall() if cur.description is not None else []\n def snapshot():\n  helper=[list(v) for v in q(\'SELECT lock,stream_ordering FROM public.event_push_summary_stream_ordering ORDER BY lock\')]\n  source={}\n  for table,col in [(\'event_push_summary\',\'stream_ordering\'),(\'receipts_linearized\',\'stream_id\'),(\'event_push_actions\',\'stream_ordering\'),(\'events\',\'stream_ordering\')]:\n   count,maximum=q(\'SELECT count(*),max(\'+col+\') FROM public.\'+table)[0];source[table]={\'count\':count,\'max\':maximum}\n  counts={}\n  for table in [\'users\',\'devices\',\'room_memberships\',\'current_state_events\',\'e2e_device_keys_json\',\'e2e_room_keys\',\'account_data\',\'room_account_data\']:\n   counts[table]=q(\'SELECT count(*) FROM public.\'+table)[0][0]\n  shape=q("SELECT a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull FROM pg_attribute a WHERE a.attrelid=\'public.event_push_summary_stream_ordering\'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum")\n  constraints=q("SELECT contype,pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid=\'public.event_push_summary_stream_ordering\'::regclass ORDER BY contype,pg_get_constraintdef(oid)")\n  triggers=q("SELECT count(*) FROM pg_trigger WHERE tgrelid=\'public.event_push_summary_stream_ordering\'::regclass AND NOT tgisinternal")[0][0]\n  db,role,oid=q(\'SELECT current_database(),current_user,(SELECT oid FROM pg_database WHERE datname=current_database())\')[0]\n  q(\'SELECT pg_stat_clear_snapshot()\');sessions=q(\'SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()\')[0][0]\n  return {\'helperRows\':helper,\'source\':source,\'preservedCounts\':counts,\'shape\':[list(v) for v in shape],\'constraints\':[list(v) for v in constraints],\'userTriggers\':triggers,\'database\':db,\'role\':role,\'databaseOid\':oid,\'otherSessions\':sessions}\n def valid(s):\n  need(s[\'helperRows\']==[],\'HELPER_NOT_MISSING\')\n  need(s[\'source\'][\'event_push_summary\'][\'count\']==0 and s[\'source\'][\'receipts_linearized\'][\'count\']==0,\'HELPER_NONEMPTY_DERIVED_STATE\')\n  need(s[\'shape\']==[[\'lock\',\'character(1)\',True],[\'stream_ordering\',\'bigint\',True]],\'HELPER_SHAPE_UNPROVEN\')\n  need(s[\'userTriggers\']==0,\'HELPER_TRIGGERS_UNREVIEWED\')\n  need(any(v[0]==\'u\' and v[1]==\'UNIQUE (lock)\' for v in s[\'constraints\']) and any(v[0]==\'c\' and "lock = \'X\'" in v[1] for v in s[\'constraints\']),\'HELPER_CONSTRAINTS_UNPROVEN\')\n need(q(\'SHOW transaction_read_only\')==[(\'off\' if b[\'action\']==\'apply\' else \'on\',)],\'HELPER_TRANSACTION_MODE\')\n if b[\'action\']==\'apply\':\n  q("SELECT pg_advisory_xact_lock(hashtextextended(\'cop-missing-push-summary-position-v1\',0))")\n  q(\'LOCK TABLE public.event_push_summary_stream_ordering,public.event_push_summary,public.receipts_linearized,public.event_push_actions,public.events IN ACCESS EXCLUSIVE MODE\')\n before=snapshot()\n if b[\'action\']!=\'readback\':valid(before)\n if b[\'action\']==\'apply\':\n  expected=b[\'expected\'][\'databaseSnapshot\'];strip=lambda v:{k:x for k,x in v.items() if k!=\'otherSessions\'}\n  need(strip(before)==strip(expected),\'HELPER_DATABASE_CAS\');need(before[\'otherSessions\']==0,\'HELPER_WRITERS_PRESENT\')\n  need(q(b[\'sql\'])==[(\'X\',0)],\'HELPER_INSERT_UNPROVEN\');after=snapshot();need(after=={**before,\'helperRows\':[[\'X\',0]]},\'HELPER_READBACK_UNPROVEN\')\n  c.commit();need(q(\'SELECT lock,stream_ordering FROM public.event_push_summary_stream_ordering\')==[(\'X\',0)],\'HELPER_COMMIT_READBACK_UNPROVEN\')\n  print(\'COP_SEQUENCE_RECEIPT \'+json.dumps({\'applied\':True,\'before\':before,\'after\':after,\'onlyOneHelperRowInserted\':True,\'messagesIdentitiesKeysAndSequencesChanged\':False}))\n else:print(\'COP_SEQUENCE_RECEIPT \'+json.dumps({\'applied\':False,\'snapshot\':before,\'readOnly\':True}))\nexcept Exception as e:\n print(\'COP_SEQUENCE_RECEIPT \'+json.dumps({\'complete\':False,\'errorType\':type(e).__name__,\'code\':str(e) if isinstance(e,RuntimeError) and str(e).startswith(\'HELPER_\') else None,\'sqlState\':getattr(e,\'pgcode\',None),\'rawErrorsExcluded\':True}));sys.exit(2)\nfinally:\n if c:c.rollback();c.close()\n os.unlink(path)\n'
def inputs():
 # Parse existing effective source configuration inside its existing container;
 # no password is included in tool output, environment files or Docker config.
 capture="import yaml,json; a=yaml.safe_load(open('/data/homeserver.yaml'));b=yaml.safe_load(open('/opt/cop-private/modules.credential-reviewed.yaml'));v={**a,**b}['database']['args'];r={k:v[k] for k in ['host','port','dbname','user','password'] if k in v};r['dbname']=v.get('database',r.get('dbname'));print(json.dumps(r))"
 args=json.loads(run(['docker','exec',NAME,'python','-c',capture],timeout=8))
 env=dict(v.split('=',1) for v in inspect('csm-messaging-api')['Config']['Env'] if '='in v)
 raw=run(['docker','cp','csm-messaging-api:'+env['CSM_ACCOUNT_SAFETY_GUARD_CA_FILE'],'-'])
 with tarfile.open(fileobj=io.BytesIO(raw)) as t:
  files=t.getmembers();need(len(files)==1 and files[0].isfile() and files[0].size<32768,'SEQUENCE_CA_CUSTODY');ca=t.extractfile(files[0]).read()
 need(hashlib.sha256(ca).hexdigest()==env['CSM_ACCOUNT_SAFETY_GUARD_CA_SHA256'],'SEQUENCE_CA_PIN')
 return {'args':args,'ca':ca.decode()}
def clean_client():
 p=subprocess.run(['docker','inspect',CLIENT_NAME],capture_output=True)
 if p.returncode:
  need(p.stdout.strip() in (b'',b'[]') and (b'No such' in p.stderr or b'no such' in p.stderr),'SEQUENCE_CLIENT_ABSENCE_UNPROVEN')
  return
 value=json.loads(p.stdout)[0]
 need(value['Name']=='/'+CLIENT_NAME and value['Image']==IMAGE and value['Config']['Labels'].get('cop.synapse.push-summary-repair')=='20261109','SEQUENCE_CLIENT_OWNERSHIP')
 run(['docker','rm','-f',value['Id']])
 p=subprocess.run(['docker','inspect',CLIENT_NAME],capture_output=True)
 need(p.returncode!=0 and (b'No such' in p.stderr or b'no such' in p.stderr),'SEQUENCE_CLIENT_CLEANUP_UNPROVEN')
def client(body,network=None):
 if network is None:cmd=['docker','exec','-i',NAME,'python','-c',CLIENT]
 else:
  # A fixed, one-shot maintenance client, never another Synapse writer.
  absent=subprocess.run(['docker','inspect',CLIENT_NAME],capture_output=True)
  need(absent.returncode!=0 and (b'No such' in absent.stderr or b'no such' in absent.stderr),'SEQUENCE_CLIENT_ALREADY_EXISTS')
  cmd=['docker','run','--rm','--name',CLIENT_NAME,'--pull','never','-i','--network',network,'--read-only','--cap-drop','ALL','--pids-limit','128','--cpus','1','--memory','256m','--tmpfs','/tmp:rw,nosuid,nodev,size=16777216','--label',LABEL,'--entrypoint','python',IMAGE,'-c',CLIENT]
 try:
  p=subprocess.run(cmd,input=encoded(body),capture_output=True,timeout=25)
  receipts=[json.loads(l[21:]) for l in p.stdout.decode().splitlines() if l.startswith('COP_SEQUENCE_RECEIPT ')]
  need(len(receipts)==1,'SEQUENCE_RECEIPT_UNPROVEN')
  need(p.returncode==0 and receipts[0].get('applied')==(body['action']=='apply'),'SEQUENCE_CLIENT_RESULT_UNPROVEN')
  return receipts[0]
 finally:
  if network is not None:clean_client()

def main():
 p=argparse.ArgumentParser();p.add_argument('--apply-plan-base64');a=p.parse_args()
 x=inspect(NAME);need(x['Image']==IMAGE,'SEQUENCE_IMAGE_CHANGED');inventory=writers()
 need([v['id'] for v in inventory if v['running']]==[x['Id']],'SEQUENCE_UNKNOWN_WRITER')
 body=inputs()
 need(len(x['NetworkSettings']['Networks'])==1,'SEQUENCE_NETWORK_SCOPE')
 network=next(iter(x['NetworkSettings']['Networks']))
 if not a.apply_plan_base64:
  receipt=client({**body,'action':'read'},network)
  s=receipt['snapshot'];plan={'contractVersion':'cop-synapse-missing-push-summary-position-v1','containerId':x['Id'],'imageId':IMAGE,'runtimeSpecSha256':spec(x),'writerInventory':inventory,'databaseSnapshot':s,'target':[['X',0]],'networkBindings':{n:v['NetworkID'] for n,v in x['NetworkSettings']['Networks'].items()},'sqlSha256':hashlib.sha256(SQL.encode()).hexdigest()}
  print(json.dumps({'plan':plan,'planSha256':hashlib.sha256(encoded(plan)).hexdigest(),'productionChanged':False}));return
 import base64
 plan=json.loads(base64.b64decode(a.apply_plan_base64));need(set(plan)=={'contractVersion','containerId','imageId','runtimeSpecSha256','writerInventory','databaseSnapshot','target','networkBindings','sqlSha256'},'SEQUENCE_PLAN_SHAPE')
 need(plan['contractVersion']=='cop-synapse-missing-push-summary-position-v1' and plan['containerId']==x['Id'] and plan['imageId']==IMAGE and plan['runtimeSpecSha256']==spec(x) and plan['writerInventory']==inventory and plan['networkBindings']=={n:v['NetworkID'] for n,v in x['NetworkSettings']['Networks'].items()},'SEQUENCE_RUNTIME_CAS')
 need(plan['target']==[['X',0]] and plan['sqlSha256']==hashlib.sha256(SQL.encode()).hexdigest() and plan['databaseSnapshot']['helperRows']==[],'SEQUENCE_PLAN_BOUND')
 # Exactly the already attached, declared private network. No new interconnection.
 need(len(plan['networkBindings'])==1,'SEQUENCE_NETWORK_SCOPE')
 network=next(iter(plan['networkBindings']));net=json.loads(run(['docker','network','inspect',network]))[0]
 need(net['Id']==plan['networkBindings'][network],'SEQUENCE_NETWORK_CAS')
 need(all(v['running'] or v['restartPolicy'] in ['no','unless-stopped'] for v in inventory),'SEQUENCE_STOPPED_PEER_UNSAFE')
 fd=os.open(ATTEMPT,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  os.write(fd,encoded({'contractVersion':plan['contractVersion'],'planSha256':hashlib.sha256(encoded(plan)).hexdigest(),'singleAttempt':True}));os.fsync(fd)
 finally:os.close(fd)
 stopped=False;restart_safe=False
 try:
  stopped=True
  run(['docker','stop','--time','10',x['Id']],timeout=20)
  current=inspect(NAME);need(current['Id']==x['Id'] and spec(current)==plan['runtimeSpecSha256'] and not current['State']['Running'],'SEQUENCE_STOP_UNPROVEN')
  observed=writers();need(not any(v['running'] for v in observed) and [{**v,'running':v['id']==x['Id']} for v in observed]==inventory,'SEQUENCE_WRITER_STOP_UNPROVEN')
  try:
   result=client({**body,'action':'apply','expected':plan,'sql':SQL},network)
  except Exception:
   # Never issue INSERT a second time after uncertain transport/commit.
   fresh=client({**body,'action':'readback'},network)['snapshot']
   expected=plan['databaseSnapshot']
   invariant=lambda v:{k:x for k,x in v.items() if k not in ['helperRows','otherSessions']}
   need(invariant(fresh)==invariant(expected) and fresh['otherSessions']==0 and fresh['helperRows'] in [[],[['X',0]]], 'SEQUENCE_UNCERTAIN_OUTCOME')
   restart_safe=True
   print(json.dumps({'originalApplyFailed':True,'readOnlyOutcome':fresh,'secondInsertPerformed':False}))
   raise
  restart_safe=True
  print(json.dumps({'helperRepair':result,'sameImage':True,'newAccountOrDataset':False,'replayCalled':False,'pinPublished':False,'noRollbackDeletionOfHelper':True}))
 finally:
  if stopped:
   clean_client()
   current=inspect(NAME);need(current['Id']==x['Id'] and current['Image']==IMAGE and spec(current)==plan['runtimeSpecSha256'],'SEQUENCE_RESTART_CAS')
   need(restart_safe,'SEQUENCE_RESTART_BLOCKED_PENDING_READBACK')
   run(['docker','start',x['Id']],timeout=15);print(json.dumps({'sameSynapseContainerStarted':True,'imageChanged':False,'configurationChanged':False}))
if __name__=='__main__':
 try:main()
 except Exception as e:
  print(json.dumps({'repairComplete':False,'code':str(e) if isinstance(e,RuntimeError) and str(e).startswith('SEQUENCE_') else type(e).__name__,'rawErrorsExcluded':True}));raise SystemExit(2)
