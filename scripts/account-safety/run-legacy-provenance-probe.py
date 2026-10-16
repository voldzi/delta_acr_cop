#!/usr/bin/env python3
"""Own labelled local PostGIS fixture + actually paused synthetic writer only."""
import json,os,pathlib,subprocess,time,uuid
ROOT=pathlib.Path(__file__).resolve().parents[2];OWNER='legacy-erasure-provenance';PREFIX='cop-legacy-provenance-'+uuid.uuid4().hex[:12];CREATED=[]
def run(*args):return subprocess.run(args,check=True,capture_output=True,text=True).stdout.strip()
try:
 pg=run('docker','run','-d','--name',PREFIX+'-pg','--label','cop.test.owner='+OWNER,'--memory=512m','--cpus=1','--tmpfs','/var/lib/postgresql/data:rw,size=256m','-e','POSTGRES_USER=cop_legacy_provenance_test_admin','-e','POSTGRES_HOST_AUTH_METHOD=trust','-p','127.0.0.1::5432','postgis/postgis:17-3.5','postgres','-c','cluster_name=cop_legacy_erasure_provenance_test');CREATED.append(pg)
 for _ in range(100):
  if subprocess.run(['docker','exec',pg,'pg_isready','-h','127.0.0.1','-d','postgres','-U','cop_legacy_provenance_test_admin'],capture_output=True).returncode==0:break
  time.sleep(.1)
 else:raise RuntimeError('OWNED_POSTGIS_START_FAILED')
 run('docker','exec',pg,'psql','-d','postgres','-U','cop_legacy_provenance_test_admin','-c','CREATE ROLE cop_legacy_provenance_test_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS')
 for db in ['cop_legacy_provenance_test','cop_legacy_provenance_guard_test']:run('docker','exec',pg,'createdb','-U','cop_legacy_provenance_test_admin','-O','cop_legacy_provenance_test_app',db)
 writer=run('docker','run','-d','--name',PREFIX+'-writer','--label','cop.test.owner='+OWNER,'--network','none','--memory=32m','--cpus=.1','--entrypoint','sleep','postgres:18','infinity');CREATED.append(writer);image=run('docker','inspect','--format','{{.Image}}',writer);run('docker','pause',writer)
 port=run('docker','port',pg,'5432/tcp').split(':')[-1];env=os.environ.copy();env.update(COP_LEGACY_PROVENANCE_TEST_URL='postgresql://cop_legacy_provenance_test_admin@127.0.0.1:'+port+'/cop_legacy_provenance_test',COP_LEGACY_PROVENANCE_WRITER_ID=writer,COP_LEGACY_PROVENANCE_IMAGE_ID=image,PATH='/Users/voldzi/.local/share/mise/installs/node/24.21.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin')
 for cmd in [['node','--test','scripts/account-safety/enroll-legacy-erasure-provenance.test.mjs'],['pnpm','exec','vitest','run','apps/cop-api/src/legacy-nonaccount-provenance.postgres.test.ts','apps/cop-api/src/community-erasure.test.ts','apps/cop-api/src/legacy-erasure-schema.test.ts','apps/cop-api/src/legacy-signed-session-runtime.postgres.test.ts']]:
  result=subprocess.run(cmd,cwd=ROOT,env=env,text=True,capture_output=True);print(result.stdout)
  if result.returncode:print(result.stderr);raise RuntimeError('LEGACY_PROVENANCE_TEST_FAILED')
 print(json.dumps({'contractVersion':'cop-legacy-provenance-owned-pg-probe-v1','postgresVersion':run('docker','exec',pg,'psql','-d','postgres','-U','cop_legacy_provenance_test_admin','-Atc','SHOW server_version'),'passed':True,'productionChanged':False,'wholeFixturesChanged':False,'distRebuilt':False}))
finally:
 for cid in reversed(CREATED):
  actual=json.loads(run('docker','inspect',cid))[0]
  if actual['Id']!=cid or actual['Config']['Labels'].get('cop.test.owner')!=OWNER:raise RuntimeError('OWNED_FIXTURE_CLEANUP_CUSTODY')
  run('docker','rm','-f',cid)
