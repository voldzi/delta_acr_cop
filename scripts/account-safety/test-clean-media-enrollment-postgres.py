#!/usr/bin/env python3
"""Owned PostgreSQL acceptance of closure enrollment and rollback only.
No production host, storage credential or success report is accepted as input.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
from unittest.mock import patch
from datetime import datetime, timedelta, timezone

ROOT = Path(__file__).parent
MESSAGING = Path('/Users/voldzi/.codex/worktrees/cop-messaging-erasure-finish/05 Messaging')
SCHEMA = Path('/private/tmp/cop-native-schema-d2630fa78b21-20261016.sql')
assert hashlib.sha256(SCHEMA.read_bytes()).hexdigest() == '00bd048810b06cc8224242fb8289021472f8b4bf37352fe512e66d8fc99b656f'
os.environ['CSM_NATIVE_SOURCE_ROOT'] = str(MESSAGING)
os.environ['CSM_NATIVE_SCHEMA_FILE'] = str(SCHEMA)


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


helper = module('owned_media_pg', MESSAGING/'test/operator/communication_usage_enrollment_test.py')
remaining = module('remaining_media_pg', ROOT/'clean-remaining-reset.py')
s3 = module('s3_media_pg', ROOT/'clean-reset-s3.py')
fixture = helper.Native()
fixture.start()
connections, checks = {}, 0


def check(value):
    global checks
    assert value
    checks += 1


class Admission:
    def __init__(self, fail=None): self.calls, self.fail = 0, fail
    def assert_current(self):
        self.calls += 1
        if self.calls == self.fail: raise RuntimeError('SYNTHETIC_ROOT_ADMISSION_LOST')


try:
    fixture.sql('postgres', 'CREATE DATABASE cop; CREATE DATABASE cop_account_safety_guard; CREATE ROLE cop_safety_v2_owner NOLOGIN; CREATE ROLE cop_safety_v2_runtime NOLOGIN; GRANT CREATE ON DATABASE cop_account_safety_guard TO cop_safety_v2_owner')
    fixture.sql('cop_account_safety_guard', 'SET ROLE cop_safety_v2_owner;'+(ROOT/'010_database_safety_v2.sql').read_text())
    fixture.sql('cop_account_safety_guard', 'GRANT USAGE ON SCHEMA cop_safety_v2 TO cop_safety_v2_runtime')
    fixture.sql('cop', 'CREATE TABLE public.cop_mobility_v1(key text PRIMARY KEY,value jsonb NOT NULL)')
    store, incarnation = '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'
    config_fingerprint = 'a'*64
    marker = {'storeId':store, 'incarnationId':incarnation}
    config = {'version':4, 'storeId':store, 'fingerprint':config_fingerprint,
              'datasetBinding':{'incarnationId':incarnation, 'restoreGeneration':1}}
    for key, db in [('cop','cop'), ('guard','cop_account_safety_guard')]:
        connections[key] = fixture.connect(db); connections[key].autocommit = False
    c = connections['cop'].cursor()
    for key, value in [('account-safety:store-identity-v1',marker), ('account-erasure:configuration-v1',config)]:
        c.execute('INSERT INTO cop_mobility_v1 VALUES(%s,%s::jsonb)', (key,json.dumps(value)))
    connections['cop'].commit()
    g = connections['guard'].cursor()
    g.execute("INSERT INTO cop_safety_v2.configuration VALUES(true,'cop-database-safety-v2',%s,%s,%s,%s,NULL)",
              ('10000000-0000-4000-8000-000000000003',store,config_fingerprint,'0'*64))
    g.execute("INSERT INTO cop_safety_v2.dataset_replays VALUES('cop',%s,%s,1,0,%s,clock_timestamp())", (store,incarnation,'0'*64))
    connections['guard'].commit()
    relative = 'scripts/account-safety/011_media_upload_closure.sql'
    plan = {'sources':{'cop':{'root':str(ROOT.parents[1]), 'files':{relative:hashlib.sha256((ROOT/'011_media_upload_closure.sql').read_bytes()).hexdigest()}}}}
    credential = {'accessKeyId':'synthetic-new-key-only', 'secretAccessKey':'synthetic-new-secret-only'}
    now = datetime.now(timezone.utc)
    e = {'contractVersion':'cop-clean-s3-closure-evidence-v1', 'bucket':s3.BUCKET, 'endpoint':s3.ENDPOINT,
         'legacyAdmittedBodiesTerminated':True, 'oldCredentialDenied':True, 'remainingObjects':0,
         'credentialFingerprint':s3.credential_fingerprint(credential), 'previousCredentialFingerprint':'b'*64,
         'providerImageId':'sha256:'+'c'*64, 'providerStoppedAt':(now-timedelta(seconds=3)).isoformat(),
         'providerRestartedAt':(now-timedelta(seconds=2)).isoformat(), 'oldCredentialDeniedAt':now.isoformat()}
    result = {'contractVersion':'cop-clean-s3-reset-result-v1','evidence':e,'evidenceDigest':s3.digest(e)}
    with patch.object(s3, 'read_env', return_value=(None,None,credential)):
        try: remaining.enroll_media_closure(plan, connections, result, s3, Admission(fail=2))
        except RuntimeError as error: check(str(error) == 'SYNTHETIC_ROOT_ADMISSION_LOST')
        else: raise AssertionError('lost Root admission committed')
        g.execute("SELECT to_regclass('cop_safety_v2.media_upload_closures') IS NULL")
        check(g.fetchone() == (True,)); connections['guard'].rollback()
        c.execute("UPDATE cop_mobility_v1 SET value=jsonb_set(value,'{incarnationId}','\"10000000-0000-4000-8000-000000000099\"') WHERE key='account-safety:store-identity-v1'")
        connections['cop'].commit()
        try: remaining.enroll_media_closure(plan, connections, result, s3, Admission())
        except RuntimeError as error: check(str(error) == 'RESET_MEDIA_TARGET_BINDING')
        else: raise AssertionError('wrong target binding accepted')
        c.execute("UPDATE cop_mobility_v1 SET value=%s::jsonb WHERE key='account-safety:store-identity-v1'",(json.dumps(marker),))
        connections['cop'].commit()
        receipt = remaining.enroll_media_closure(plan, connections, result, s3, Admission())
        check(receipt['enrolled'] and receipt['runtimeWriteGranted'] is False)
    g.execute('SELECT count(*) FROM cop_safety_v2.media_upload_closures'); check(g.fetchone() == (1,))
    g.execute('SET LOCAL ROLE cop_safety_v2_runtime')
    g.execute('SELECT evidence_digest FROM cop_safety_v2.media_upload_closures'); check(g.fetchone() == (result['evidenceDigest'],))
    try: g.execute('DELETE FROM cop_safety_v2.media_upload_closures')
    except Exception as error: check(error.sqlstate == '42501'); connections['guard'].rollback()
    else: raise AssertionError('runtime could remove closure evidence')
    try: g.execute('UPDATE cop_safety_v2.media_upload_closures SET evidence_digest=%s',('d'*64,))
    except Exception as error: check(getattr(error, 'sqlstate', None) == '55000')
    else: raise AssertionError('immutable receipt could be overwritten')
    print(json.dumps({'phase':'owned_media_enrollment_acceptance','checks':checks,
                      'productionTouched':False,'actualStorageTest':False,'wholeAccountComplete':False}))
finally:
    for connection in connections.values(): connection.close()
    fixture.close()
