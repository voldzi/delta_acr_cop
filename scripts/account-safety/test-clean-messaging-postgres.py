#!/usr/bin/env python3
"""Owned SQL-only reset acceptance. No production endpoint or credential input."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path

parser=argparse.ArgumentParser();parser.add_argument('--messaging-source',required=True);parser.add_argument('--schema-only',required=True)
a=parser.parse_args();source=Path(a.messaging_source).resolve();schema=Path(a.schema_only).resolve()
assert hashlib.sha256(schema.read_bytes()).hexdigest()=='00bd048810b06cc8224242fb8289021472f8b4bf37352fe512e66d8fc99b656f'
os.environ['CSM_NATIVE_SOURCE_ROOT']=str(source);os.environ['CSM_NATIVE_SCHEMA_FILE']=str(schema)
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
helper=module('owned_fixture',source/'test/operator/communication_usage_enrollment_test.py')
reset=module('clean_messaging',Path(__file__).with_name('clean-reset-messaging.py'))
f=helper.Native();f.start();connections=[];checks=0
class Admission:
 def __init__(self,fail=None):self.calls=0;self.fail=fail
 def assert_current(self):
  self.calls+=1
  if self.calls==self.fail:raise RuntimeError('SYNTHETIC_ADMISSION_LOST')
def check(value):
 global checks
 assert value;checks+=1
def rejects(fn,code):
 try:fn()
 except RuntimeError as e:check(code in str(e));return
 raise AssertionError('expected finite reset refusal')
try:
 f.sql('postgres','CREATE DATABASE csm_synapse; CREATE DATABASE csm_messaging')
 text=schema.read_text();epoch='CREATE TRIGGER immutable_writer_epoch_insert '
 assert text.count(epoch)==1
 f.sql('csm_synapse',text.replace(epoch,'INSERT INTO cop_account_erasure_v2.writer_epoch VALUES(true,0);\n'+epoch))
 f.sql('csm_synapse',"INSERT INTO schema_version(lock,version,upgraded) VALUES('X',94,true)")
 f.sql('csm_messaging','CREATE TABLE csm_messaging_stores(store_name text PRIMARY KEY,payload jsonb,updated_at timestamptz DEFAULT now())')
 native=f.connect('csm_synapse');meta=f.connect('csm_messaging');connections += [native,meta]
 native.autocommit=False;meta.autocommit=False
 token='synthetic-admin-token-20261017-only';server='fixture.synthetic.invalid';admin='@admin:'+server;bot=reset.canonical_principal(server);human='@cop_synthetic_test:'+server
 q=native.cursor();q.execute('INSERT INTO users(name,password_hash,admin) VALUES(%s,%s,1),(%s,%s,0),(%s,%s,0)',(admin,'synthetic-admin-hash',bot,'synthetic-service-hash',human,'synthetic-human-hash'))
 q.execute('INSERT INTO access_tokens(id,user_id,token) VALUES(1,%s,%s),(2,%s,%s)',(admin,token,human,'synthetic-human-token'))
 q.execute("INSERT INTO devices(user_id,device_id,ip,user_agent,last_seen,display_name) VALUES(%s,'ADMIN','192.0.2.1','synthetic',123,'synthetic')",(admin,))
 q.execute('INSERT INTO event_json(event_id,room_id,internal_metadata,json) VALUES(%s,%s,%s,%s)',('$synthetic','!synthetic:'+server,'{}','{"body":"synthetic removed text"}'));native.commit()
 plan=reset.inspect_native_reset(native,token,server);check(plan['humanCount']==1 and plan['counts']['event_json']==1)
 rejects(lambda:reset.inspect_native_reset(native,'synthetic-invalid-token-20261017',server),'ADMIN_CREDENTIAL_UNPROVEN')
 rejects(lambda:reset.apply_native_reset(native,plan,token,server,Admission(fail=2)),'SYNTHETIC_ADMISSION_LOST')
 q=native.cursor();q.execute('SELECT count(*) FROM event_json');check(q.fetchone()[0]==1);native.rollback()
 q=native.cursor();q.execute('INSERT INTO users(name) VALUES(%s)',('@foreign.other:'+server,));native.commit()
 rejects(lambda:reset.inspect_native_reset(native,token,server),'FOREIGN_NATIVE_ACCOUNT')
 q=native.cursor();q.execute('DELETE FROM users WHERE name=%s',('@foreign.other:'+server,));native.commit()
 result=reset.apply_native_reset(native,plan,token,server,Admission());check(result['remainingHumanCount']==0 and not result['oldDataBackupCreated'])
 after=reset.inspect_native_reset(native,token,server);check(after['configuration']==plan['configuration']);check(after['preservedServiceFingerprint']==plan['preservedServiceFingerprint'])
 q=native.cursor();q.execute('SELECT ip,user_agent,last_seen,display_name FROM devices');check(q.fetchall()==[(None,None,None,None)]);native.rollback()
 for t,n in after['counts'].items():
  if t not in ['users','devices','access_tokens','refresh_tokens']:check(n==0)
 service={'csmUserId':'cop.ai.agent','matrixUserId':bot,'serverName':server,'password':{'ciphertext':'synthetic-only'}}
 payloads={'matrix_identities':{'version':1,'identities':{'service':service,'human':{'csmUserId':'synthetic-human'}}},'account_safety':{'version':1,'fences':{},'jizdaFences':{},'bindings':{}},'notifications':{'version':1,'items':[{'body':'synthetic removed'}]},'account_erasure_jobs':{'version':1,'jobs':{}}}
 q=meta.cursor()
 for name,payload in payloads.items():q.execute('INSERT INTO csm_messaging_stores(store_name,payload) VALUES(%s,%s::jsonb)',(name,json.dumps(payload)))
 meta.commit();mp=reset.inspect_metadata_reset(meta,server)
 rejects(lambda:reset.apply_metadata_reset(meta,mp,server,Admission(fail=2)),'SYNTHETIC_ADMISSION_LOST')
 check(reset.inspect_metadata_reset(meta,server)==mp)
 mr=reset.apply_metadata_reset(meta,mp,server,Admission());check(mr['originalServiceMappingPreserved'])
 q=meta.cursor();q.execute("SELECT payload FROM csm_messaging_stores WHERE store_name='matrix_identities'");check(q.fetchone()[0]=={'version':1,'identities':{'service':service}});meta.rollback()
 q=meta.cursor();q.execute("INSERT INTO csm_messaging_stores VALUES('unknown', '{}'::jsonb,now())");meta.commit()
 rejects(lambda:reset.inspect_metadata_reset(meta,server),'UNKNOWN_MESSAGING_STORE')
 print(json.dumps({'contractVersion':'cop-clean-messaging-postgres-test-v1','checks':checks,'actualOwnedPostgres':True,'productionTouched':False,'realRootAdmission':False,'nativeHttpAcceptance':False}))
finally:
 for c in connections:c.close()
 f.close()
