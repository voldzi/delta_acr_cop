#!/usr/bin/env python3
"""Actual owned loopback PostgreSQL only; precise cleanup, no production routes."""
import json,os,pathlib,subprocess,time,uuid
ROOT=pathlib.Path(__file__).resolve().parents[2];NAME='cop-business-schema-test-'+uuid.uuid4().hex[:12];CREATED=None
def run(*args):return subprocess.run(args,check=True,capture_output=True,text=True).stdout.strip()
try:
 CREATED=run('docker','run','-d','--name',NAME,'--label','cop.test.owner=business-erasure-schema','--memory=256m','--cpus=1','--tmpfs','/var/lib/postgresql:rw,size=256m','-e','POSTGRES_USER=cop_business_schema_test_admin','-e','POSTGRES_HOST_AUTH_METHOD=trust','-p','127.0.0.1::5432','postgres:18','postgres','-c','cluster_name=cop_business_erasure_schema_test')
 for _ in range(80):
  if subprocess.run(['docker','exec',NAME,'pg_isready','-h','127.0.0.1','-d','postgres','-U','cop_business_schema_test_admin'],capture_output=True).returncode==0:break
  time.sleep(.1)
 else:raise RuntimeError('OWNED_PG_START_FAILED')
 run('docker','exec',NAME,'psql','-d','postgres','-U','cop_business_schema_test_admin','-c','CREATE ROLE cop_business_schema_test_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS')
 for db in ['cop_business_schema_test','cop_business_schema_guard_test']:run('docker','exec',NAME,'createdb','-U','cop_business_schema_test_admin','-O','cop_business_schema_test_app',db)
 port=run('docker','port',NAME,'5432/tcp').split(':')[-1];env=os.environ.copy();env['COP_BUSINESS_SCHEMA_TEST_URL']='postgresql://cop_business_schema_test_admin@127.0.0.1:'+port+'/cop_business_schema_test'
 env['PATH']='/Users/voldzi/.local/share/mise/installs/node/24.21.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
 result=subprocess.run(['node','--test','scripts/account-safety/prepare-business-erasure-schema.test.mjs'],cwd=ROOT,env=env,text=True,capture_output=True);print(result.stdout)
 if result.returncode:print(result.stderr);raise RuntimeError('BUSINESS_SCHEMA_TEST_FAILED')
 print(json.dumps({'contractVersion':'cop-business-erasure-schema-pg-probe-v1','postgresVersion':run('docker','exec',NAME,'psql','-d','postgres','-U','cop_business_schema_test_admin','-Atc','SHOW server_version'),'passed':True,'productionChanged':False,'wholeFixturesChanged':False}))
finally:
 if CREATED:
  actual=json.loads(run('docker','inspect',CREATED))[0]
  if actual['Id']!=CREATED or actual['Config']['Labels'].get('cop.test.owner')!='business-erasure-schema':raise RuntimeError('OWNED_CLEANUP_CUSTODY_FAILED')
  run('docker','rm','-f',CREATED)
