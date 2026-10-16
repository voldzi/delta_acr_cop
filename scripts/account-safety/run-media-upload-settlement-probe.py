#!/usr/bin/env python3
"""Owned loopback-only PostgreSQL test. No production connection or credentials."""
import json, os, pathlib, subprocess, time, uuid

ROOT = pathlib.Path(__file__).resolve().parents[2]
NAME = 'cop-media-settlement-test-' + uuid.uuid4().hex[:12]

def command(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs).stdout.strip()

try:
    command('docker','run','-d','--name',NAME,'--label','cop.test.owner=media-settlement',
            '--memory=256m','--cpus=1','--tmpfs','/var/lib/postgresql:rw,size=256m',
            '-e','POSTGRES_USER=cop_media_test_admin','-e','POSTGRES_HOST_AUTH_METHOD=trust',
            '-p','127.0.0.1::5432','postgres:18','postgres','-c','cluster_name=cop_media_settlement_owned_test')
    for attempt in range(60):
        ready = subprocess.run(['docker','exec',NAME,'pg_isready','-h','127.0.0.1','-U','cop_media_test_admin'],capture_output=True)
        if ready.returncode == 0: break
        time.sleep(.25)
    else: raise RuntimeError('fixture_not_ready')
    port = command('docker','port',NAME,'5432/tcp').split(':')[-1]
    for database in ['cop_account_safety_guard','cop_erasure_test']:
        command('docker','exec',NAME,'createdb','-U','cop_media_test_admin',database)
    version = command('docker','exec',NAME,'psql','-U','cop_media_test_admin','-Atc','SHOW server_version')
    env = os.environ.copy()
    env['COP_MEDIA_SETTLEMENT_TEST_DATABASE_URL'] = 'postgresql://cop_media_test_admin@127.0.0.1:' + port + '/cop_account_safety_guard'
    env['PATH'] = '/Users/voldzi/.local/share/mise/installs/node/24.21.0/bin:/opt/homebrew/bin:/usr/bin:/bin'
    result = subprocess.run(['/opt/homebrew/bin/pnpm','exec','vitest','run',
                             'apps/cop-api/src/media-upload-settlement.postgres.test.ts',
                             'apps/cop-api/src/media-storage.test.ts'],cwd=ROOT,env=env,text=True,capture_output=True)
    print(result.stdout)
    if result.returncode:
        print(result.stderr)
        raise RuntimeError('verification_failed')
    print(json.dumps({'contractVersion':'cop-media-upload-settlement-postgres-probe-v1','postgresVersion':version,
                      'productionChanged':False,'fixtureOwner':NAME,'result':'passed'}))
finally:
    subprocess.run(['docker','rm','-f',NAME],check=False,capture_output=True)
