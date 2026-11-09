import subprocess,time,importlib.util,json
name='cop-push-summary-isolated-20261109'
from pathlib import Path
spec=importlib.util.spec_from_file_location('repair',Path(__file__).with_name('repair.py'));r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
def run(args,body=None):return subprocess.run(args,input=body,capture_output=True,text=True,timeout=20)
absent=run(['docker','inspect',name]);assert absent.returncode!=0,'TEST_CONTAINER_EXISTS'
p=run(['docker','run','-d','--rm','--name',name,'--label','cop.helper.isolated=20261109','--network','none','--read-only','--user','postgres','--cap-drop','ALL','--pids-limit','128','--cpus','1','--memory','512m','--tmpfs','/tmp:rw,nosuid,nodev,size=536870912,mode=1777','--tmpfs','/var/run/postgresql:rw,nosuid,nodev,size=16777216,uid=70,gid=70','-e','PGDATA=/tmp/pgdata','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine']);assert p.returncode==0,'ISOLATED_START_FAILED'
try:
 for _ in range(40):
  if run(['docker','exec',name,'pg_isready','-U','postgres']).returncode==0:break
  time.sleep(.25)
 else:raise RuntimeError('ISOLATED_PG_NOT_READY')
 def sql(body,ok=True):
  p=run(['docker','exec','-i',name,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-At'],body)
  assert (p.returncode==0)==ok,'ISOLATED_SQL_UNEXPECTED';return p.stdout
 sql("CREATE TABLE event_push_summary_stream_ordering(lock char(1) NOT NULL DEFAULT 'X' UNIQUE CHECK(lock='X'),stream_ordering bigint NOT NULL); CREATE TABLE preserved_fixture(kind text PRIMARY KEY,value text); INSERT INTO preserved_fixture VALUES('event','synthetic encrypted event'),('identity','synthetic'),('key','synthetic');")
 before=sql('SELECT md5(string_agg(kind||value,\'|\' ORDER BY kind)) FROM preserved_fixture;')
 assert sql('SELECT count(*) FROM event_push_summary_stream_ordering;').strip()=='0'
 result=sql('BEGIN; LOCK TABLE event_push_summary_stream_ordering IN ACCESS EXCLUSIVE MODE; '+r.SQL+'; COMMIT;');assert 'X|0'in result
 assert sql('SELECT lock,stream_ordering FROM event_push_summary_stream_ordering;').strip()=='X|0'
 sql(r.SQL+';',False)
 after=sql('SELECT md5(string_agg(kind||value,\'|\' ORDER BY kind)) FROM preserved_fixture;');assert after==before
 print(json.dumps({'isolatedPostgres':17,'nativeHelperMissingBefore':True,'exactInsertReadback':['X',0],'duplicateInsertRejected':True,'syntheticEventIdentityKeyDigestUnchanged':True,'publicPorts':False,'productionChanged':False}))
finally:
 p=run(['docker','inspect',name])
 if p.returncode==0:
  x=json.loads(p.stdout)[0];assert x['Config']['Labels'].get('cop.helper.isolated')=='20261109';assert run(['docker','rm','-f',name]).returncode==0
 print(json.dumps({'isolatedContainerRemoved':True}))
