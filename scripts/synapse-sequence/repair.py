#!/usr/bin/env python3
"""One reviewed forward-only to_device sequence repair. Defaults to read-only.
No erasure replay/pin, credentials on disk, table mutations or image changes.
"""
import argparse,hashlib,io,json,os,subprocess,sys,tarfile,time
IMAGE='sha256:b2a34f5a1b963e50446e0ea389e214d196e72a2536faca090209b15d5a5a4888'
NAME='csm-matrix-synapse'
LABEL='cop.synapse.sequence-repair=20261109'
CLIENT_NAME='cop-synapse-sequence-repair-20261109'
ATTEMPT='/home/voldzi/.cop-synapse-sequence-repair-20261109.attempt.json'
SQL="""SELECT setval('device_inbox_sequence', GREATEST(
 (SELECT last_value FROM device_inbox_sequence),
 COALESCE((SELECT MAX(stream_id) FROM stream_positions WHERE stream_name='to_device'),0),
 COALESCE((SELECT MAX(stream_id) FROM device_inbox),0),
 COALESCE((SELECT MAX(stream_id) FROM device_federation_outbox),0)
), true)"""
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
def target(s):
 need(s['increment']==1 and s['cache']==1 and type(s['lastValue']) is int and s['lastValue']>=1,'SEQUENCE_SHAPE_CHANGED')
 values=[s['lastValue'],*[v or 0 for v in s['maxima'].values()],*[v[1] for v in s['positions']]]
 need(all(type(v)is int and v>=0 for v in values),'SEQUENCE_VALUES_INVALID')
 t=max(values);need(t<s['sequenceMax'],'SEQUENCE_EXHAUSTED');return t
# The client prints only aggregate receipts. Input stays in server RAM/stdin.
CLIENT=r'''
import sys,json,psycopg2,tempfile,os
b=json.load(sys.stdin); fd,path=tempfile.mkstemp(prefix='cop-public-ca-',suffix='.crt');os.fchmod(fd,0o600);os.write(fd,b['ca'].encode());os.close(fd)
c=None
try:
 if not __debug__:raise RuntimeError('SEQUENCE_OPTIMIZED_PYTHON_REJECTED')
 a=b['args'];a.update(sslmode='verify-full',sslrootcert=path,connect_timeout=4,application_name='cop-reviewed-sequence-repair',options='-c statement_timeout=5000 -c lock_timeout=3000')
 c=psycopg2.connect(**a);c.set_session(readonly=b['action']!='apply',autocommit=False)
 def q(sql,args=None):
  with c.cursor() as cur:
   cur.execute(sql,args)
   return cur.fetchall() if cur.description is not None else []
 def snapshot():
  last,called=q('SELECT last_value,is_called FROM device_inbox_sequence')[0]
  inc,cache,maximum=q("SELECT seqincrement,seqcache,seqmax FROM pg_sequence WHERE seqrelid='device_inbox_sequence'::regclass")[0]
  positions=[list(v) for v in q("SELECT instance_name,stream_id FROM stream_positions WHERE stream_name='to_device' ORDER BY instance_name")]
  maxima={};counts={}
  for table in ['device_inbox','device_federation_outbox']:
   value,count=q('SELECT max(stream_id),count(*) FROM '+table)[0];maxima[table]=value;counts[table]=count
  db,role,oid=q('SELECT current_database(),current_user,(SELECT oid FROM pg_database WHERE datname=current_database())')[0]
  q('SELECT pg_stat_clear_snapshot()')
  sessions=q('SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()')[0][0]
  return {'lastValue':last,'isCalled':called,'increment':inc,'cache':cache,'sequenceMax':maximum,'positions':positions,'maxima':maxima,'rowCounts':counts,'database':db,'role':role,'databaseOid':oid,'otherSessions':sessions}
 assert q('SHOW transaction_read_only')==[('off' if b['action']=='apply' else 'on',)],'SEQUENCE_TRANSACTION_MODE'
 if b['action']=='apply':
  q("SELECT pg_advisory_xact_lock(hashtextextended('cop-reviewed-to-device-sequence-repair-v1',0))")
  q('LOCK TABLE device_inbox,device_federation_outbox,stream_positions IN ACCESS EXCLUSIVE MODE')
 before=snapshot()
 if b['action']=='apply':
  expected=b['expected'];assert before==expected['databaseSnapshot'],'SEQUENCE_DATABASE_CAS'
  assert before['otherSessions']==0,'SEQUENCE_WRITERS_PRESENT'
  target=expected['target'];assert target>=before['lastValue'] and target<before['sequenceMax'],'SEQUENCE_TARGET_BOUND'
  assert q(b['sql'])==[(target,)],'SEQUENCE_SETVAL_UNPROVEN'
  after=snapshot();assert after=={**before,'lastValue':target,'isCalled':True},'SEQUENCE_READBACK_UNPROVEN'
  c.commit()
  assert q('SELECT last_value,is_called FROM device_inbox_sequence')==[(target,True)],'SEQUENCE_COMMIT_READBACK_UNPROVEN'
  print('COP_SEQUENCE_RECEIPT '+json.dumps({'applied':True,'before':before,'after':after,'counterRewindAllowed':False,'tableRowsChanged':False}))
 else:print('COP_SEQUENCE_RECEIPT '+json.dumps({'applied':False,'snapshot':before,'readOnly':True}))
except Exception as e:
 print('COP_SEQUENCE_RECEIPT '+json.dumps({'complete':False,'errorType':type(e).__name__,'code':str(e) if isinstance(e,AssertionError) else None,'sqlState':getattr(e,'pgcode',None),'counterOutcomeRequiresReadback':b['action']=='apply'}));sys.exit(2)
finally:
 if c:c.rollback();c.close()
 os.unlink(path)
'''
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
 need(value['Name']=='/'+CLIENT_NAME and value['Image']==IMAGE and value['Config']['Labels'].get('cop.synapse.sequence-repair')=='20261109','SEQUENCE_CLIENT_OWNERSHIP')
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
  s=receipt['snapshot'];plan={'contractVersion':'cop-synapse-forward-sequence-repair-v1','containerId':x['Id'],'imageId':IMAGE,'runtimeSpecSha256':spec(x),'writerInventory':inventory,'databaseSnapshot':s,'target':target(s),'networkBindings':{n:v['NetworkID'] for n,v in x['NetworkSettings']['Networks'].items()},'sqlSha256':hashlib.sha256(SQL.encode()).hexdigest()}
  print(json.dumps({'plan':plan,'planSha256':hashlib.sha256(encoded(plan)).hexdigest(),'productionChanged':False}));return
 import base64
 plan=json.loads(base64.b64decode(a.apply_plan_base64));need(set(plan)=={'contractVersion','containerId','imageId','runtimeSpecSha256','writerInventory','databaseSnapshot','target','networkBindings','sqlSha256'},'SEQUENCE_PLAN_SHAPE')
 need(plan['contractVersion']=='cop-synapse-forward-sequence-repair-v1' and plan['containerId']==x['Id'] and plan['imageId']==IMAGE and plan['runtimeSpecSha256']==spec(x) and plan['writerInventory']==inventory and plan['networkBindings']=={n:v['NetworkID'] for n,v in x['NetworkSettings']['Networks'].items()},'SEQUENCE_RUNTIME_CAS')
 need(plan['target']==target(plan['databaseSnapshot']) and plan['sqlSha256']==hashlib.sha256(SQL.encode()).hexdigest() and plan['databaseSnapshot']['otherSessions']==0,'SEQUENCE_PLAN_BOUND')
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
   # setval is non-transactional. Never issue it a second time, even if the
   # transport died after commit. A fresh read alone establishes the outcome.
   fresh=client({**body,'action':'read'},network)['snapshot']
   expected=plan['databaseSnapshot']
   invariant={k:v for k,v in fresh.items() if k not in ['lastValue','isCalled']}
   need(invariant=={k:v for k,v in expected.items() if k not in ['lastValue','isCalled']} and
        ((fresh['lastValue'],fresh['isCalled'])==(expected['lastValue'],expected['isCalled']) or
         (fresh['lastValue'],fresh['isCalled'])==(plan['target'],True)), 'SEQUENCE_UNCERTAIN_OUTCOME')
   restart_safe=True
   print(json.dumps({'originalApplyFailed':True,'readOnlyOutcome':fresh,'secondSetvalPerformed':False}))
   raise
  restart_safe=True
  print(json.dumps({'sequenceRepair':result,'sameImage':True,'newAccountOrDataset':False,'replayCalled':False,'pinPublished':False,'rollbackMustPreserveHigherCounter':True}))
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
