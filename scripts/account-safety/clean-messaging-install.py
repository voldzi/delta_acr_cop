"""Initial production Messaging enrollment under the existing finite reset lease.
No CLI, network discovery, new credentials, fixture seed or automatic activation.
The caller owns the three existing administrator connections and sealed sources.
Partial failure leaves writers paused and erasure disabled; never drop evidence.
"""
import base64
import hmac
import uuid
import hashlib
import json
import re
from pathlib import Path

POLICY = '0a6fc9bdcbbff0c5f31f46326974cf92f2ba7558ac72067f2f1af86d3675149d'
SCOPE = 'f6f4cb171dad4211adb2eb4a8e3b1cbba29d87c2a4a54642bdced47ebb8cf85e'
SQL = {
 'metadata': ['deploy/account-safety/'+n for n in ['001_metadata_writer_fences.sql','003_metadata_dataset.sql','005_metadata_restore_transition.sql']],
 'guard': ['deploy/account-safety/'+n for n in ['002_independent_guard.sql','004_independent_restore_transition.credential-candidate.sql','006_communication_usage.sql']],
 'native': ['deploy/synapse/'+n for n in ['002_account_state_fences.sql','003_approved_provider_binding.sql','004_approved_owner_payload_fences.sql','005_reviewed_owner_stream_cleanup.sql','006_credential_stream_origin_witness.sql','007_credential_stream_restore_lineage.sql','008_native_first_creation.sql']]}
REQUIRED = set(sum(SQL.values(), [])) | {'deploy/account-safety/communication_usage_enrollment.py','deploy/synapse/first_use_native_inventory.py','deploy/synapse/cop_account_erasure_full_v2_credential_candidate.py','deploy/synapse/001_private_metadata_fences.sql','deploy/synapse/approved-account-scope-full-v2-credential-candidate.json','deploy/account-safety/proposed-retention-policy-full-v2-credential-v1.json'}
NAMES = {'metadata':['messaging_erasure_v2'], 'guard':['messaging_safety_v2','messaging_usage_v1'], 'native':['cop_account_erasure_v2','cop_account_erasure_binding','cop_account_erasure_approved']}

def need(v, code='MESSAGING_INITIAL_ENROLLMENT_UNPROVEN'):
 if not v: raise RuntimeError(code)

def digest(v):
 return hashlib.sha256(json.dumps(v, sort_keys=True, separators=(',',':')).encode()).hexdigest()

def one(q, sql, args=None):
 q.execute(sql) if args is None else q.execute(sql,args)
 rows=q.fetchall();need(len(rows)==1);return rows[0]

def source(root, pins, name):
 p=Path(root)/name;need(name in REQUIRED and name in pins and not p.is_symlink() and p.resolve().is_relative_to(Path(root).resolve()))
 raw=p.read_bytes();need(hashlib.sha256(raw).hexdigest()==pins[name], 'MESSAGING_INITIAL_SOURCE_CHANGED');return raw.decode()

def validate(config):
 need(set(config)=={'contractVersion','binding','baselineId','guardRuntimeRole','sourcePins','writerInventorySha256','reviewedRetention'})
 need(config['contractVersion']=='cop-messaging-production-initial-v1' and config['guardRuntimeRole']=='csm_messaging' and config['reviewedRetention'] is True)
 need(REQUIRED<=set(config['sourcePins']) and all(re.fullmatch('[a-f0-9]{64}',v) for v in config['sourcePins'].values()))
 b=config['binding'];need(b['issuer']=='https://login.zeleznalady.cz/realms/cop' and b['serverName']=='docker.home.cz' and b['metadataRestoreGeneration']==b['providerRestoreGeneration']==1)
 need(b['retentionPolicyDigest']==POLICY and b['providerScopeDigest']==SCOPE)
 for k in ['guardStoreId','metadataStoreId','metadataIncarnationId','providerStoreId','providerIncarnationId']:
  need(str(uuid.UUID(b[k]))==b[k])
 need(str(uuid.UUID(config['baselineId']))==config['baselineId'])
 need(b['clientIds']==sorted(set(b['clientIds'])) and set(b['clientIds'])=={'cop-web','csm-mobile'})
 need(re.fullmatch(r'https://[a-z0-9][a-z0-9.:-]*',b['providerOrigin']) is not None)
 need(b['identityBindingDigest']==hashlib.sha256(json.dumps([b['issuer'],b['clientIds']],separators=(',',':')).encode()).hexdigest())
 need(re.fullmatch('[a-f0-9]{64}',b['ownerKeyFingerprint']) is not None)
 need(re.fullmatch('[a-f0-9]{64}',config['writerInventorySha256']))
 return config

def inspect_initial(connections, root, config):
 validate(config)
 for name in REQUIRED: source(root,config['sourcePins'],name)
 need(hashlib.sha256(source(root,config['sourcePins'],'deploy/account-safety/proposed-retention-policy-full-v2-credential-v1.json').encode()).hexdigest()==POLICY)
 need(hashlib.sha256(source(root,config['sourcePins'],'deploy/synapse/approved-account-scope-full-v2-credential-candidate.json').encode()).hexdigest()==SCOPE)
 facts={}
 try:
  for lane,db in [('metadata','csm_messaging'),('guard','cop_account_safety_guard'),('native','csm_synapse')]:
   c=connections[lane];q=c.cursor();q.execute('BEGIN READ ONLY');q.execute("SET LOCAL statement_timeout='10s'")
   need(one(q,"SELECT current_database(),current_user,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),pg_is_in_recovery()")==(db,'postgres',True,False))
   need(one(q,'SELECT count(*) FROM pg_namespace WHERE nspname=ANY(%s)',(NAMES[lane],))==(0,), 'MESSAGING_INITIAL_EXISTING_SCHEMA_REQUIRES_REVIEW')
   q.execute("SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=ANY(%s) ORDER BY rolname",(['csm_messaging','csm_synapse'],))
   need(q.fetchall()==[(n,True,False,False,False,False,False) for n in ['csm_messaging','csm_synapse']])
   facts[lane]={'database':db,'namespaceAbsent':True,'restrictedRoles':True}
  q=connections['native'].cursor();need(one(q,'SELECT version FROM schema_version')==(94,))
  need(one(q,'SELECT server_name FROM cop_private_erasure.configuration WHERE singleton')==('docker.home.cz',))
  text=source(root,config['sourcePins'],'deploy/synapse/001_private_metadata_fences.sql');expected={n:body for n,body in re.findall(r'CREATE FUNCTION cop_private_erasure\.(\w+)\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$(.*?)\$\$;',text,re.S)}
  q.execute("SELECT proname,prosrc FROM pg_proc WHERE pronamespace='cop_private_erasure'::regnamespace ORDER BY proname")
  need(dict(q.fetchall())==expected and set(expected)=={'immutable_operation','admit_metadata'})
  q=connections['metadata'].cursor();need(one(q,"SELECT to_regclass('public.csm_messaging_stores') IS NOT NULL")== (True,))
  public={'contractVersion':'cop-messaging-production-initial-plan-v1','configurationDigest':digest(config),'facts':facts}
  return {**public,'planDigest':digest(public)}
 finally:
  for c in connections.values(): c.rollback()

def migration(q,text):
 # Keep each DB's complete installation atomic; source files have their own
 # outer transaction. Do not strip or alter any inner PL/pgSQL transaction text.
 need(len(re.findall(r'^BEGIN;$',text,re.M))==1 and text.endswith('COMMIT;\n'))
 q.execute(re.sub(r'^BEGIN;\n','',text,count=1,flags=re.M).removesuffix('COMMIT;\n'))

def install_initial_schema_and_bindings(connections, root, config, reviewed, root_base64, admission):
 admission.assert_current();need(inspect_initial(connections,root,config)==reviewed,'MESSAGING_INITIAL_PLAN_DRIFT')
 b=config['binding'];pins=config['sourcePins'];role='csm_messaging'
 key=base64.b64decode(root_base64,validate=True);need(len(key)==32)
 ownerkey=hmac.digest(key,b'messaging-erasure-owner-mac-key-v1\0','sha256')
 need(hmac.compare_digest(hashlib.sha256(b'messaging-erasure-owner-key-fingerprint-v1\0'+ownerkey).hexdigest(),b['ownerKeyFingerprint']))
 try:
  # Data was removed by the reviewed reset before this stage. Prove the fixed
  # service is the only managed native/metadata identity; never reconstruct it.
  n=connections['native'].cursor();n.execute('BEGIN');need(one(n,"SELECT count(*) FROM users WHERE left(name,5)='@cop_' AND name<>%s",('@cop_cop.ai.agent_a83479e9281a:docker.home.cz',))==(0,))
  need(one(n,'SELECT count(*) FROM cop_private_erasure.operations')==(0,))
  m=connections['metadata'].cursor();m.execute('BEGIN READ ONLY')
  payload=one(m,"SELECT payload FROM public.csm_messaging_stores WHERE store_name='matrix_identities'")[0]
  identities=payload.get('identities',{});need(payload.get('version')==1 and len(identities)==1)
  fixed=next(iter(identities.values()));need(fixed.get('csmUserId')=='cop.ai.agent' and fixed.get('matrixUserId')=='@cop_cop.ai.agent_a83479e9281a:docker.home.cz' and fixed.get('serverName')=='docker.home.cz' and 'password' in fixed)
  connections['metadata'].rollback()
  n.execute('SET LOCAL ROLE csm_synapse');n.execute("SELECT set_config('cop_account_erasure_v2.local_server','docker.home.cz',true)")
  migration(n,source(root,pins,SQL['native'][0]));n.execute('RESET ROLE')
  for name in SQL['native'][1:]: migration(n,source(root,pins,name))
  n.execute("INSERT INTO cop_account_erasure_binding.dataset_binding VALUES(%s,%s,1,%s,%s,%s,'1.156.0')",(b['providerStoreId'],b['providerIncarnationId'],POLICY,SCOPE,b['serverName']))
  admission.assert_current();connections['native'].commit()
  m=connections['metadata'].cursor();m.execute('BEGIN')
  need(one(m,"SELECT count(*) FROM public.csm_messaging_stores WHERE store_name='matrix_identities' AND payload->>'version'='1' AND (SELECT count(*) FROM jsonb_object_keys(payload->'identities'))=1")== (1,))
  for name in SQL['metadata']: migration(m,source(root,pins,name))
  m.execute("INSERT INTO messaging_erasure_v2.dataset VALUES(true,'messaging-local-dataset-v2',%s,%s,%s,1,%s,%s,%s,%s,%s,%s,%s,%s)",(b['guardStoreId'],b['metadataStoreId'],b['metadataIncarnationId'],b['providerStoreId'],b['providerOrigin'],b['serverName'],b['issuer'],b['clientIds'],b['ownerKeyFingerprint'],b['identityBindingDigest'],POLICY))
  m.execute('ALTER TABLE public.csm_messaging_stores OWNER TO postgres')
  m.execute('GRANT SELECT,INSERT,UPDATE ON public.csm_messaging_stores TO csm_messaging;GRANT USAGE ON SCHEMA messaging_erasure_v2 TO csm_messaging;GRANT SELECT ON ALL TABLES IN SCHEMA messaging_erasure_v2 TO csm_messaging;GRANT INSERT ON messaging_erasure_v2.fences,messaging_erasure_v2.journal_mirror TO csm_messaging;GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA messaging_erasure_v2 TO csm_messaging;REVOKE EXECUTE ON FUNCTION messaging_erasure_v2.dataset_root_transition() FROM csm_messaging')
  admission.assert_current();connections['metadata'].commit()
  g=connections['guard'].cursor();g.execute('BEGIN')
  for name in SQL['guard']: migration(g,source(root,pins,name))
  g.execute("INSERT INTO messaging_safety_v2.configuration VALUES(true,'messaging-independent-guard-v1',%s,%s,%s,%s,%s,'cop_','messaging-erasure-owner-mac-v1',%s,%s,%s,%s,%s,%s)",(b['guardStoreId'],b['metadataStoreId'],b['providerStoreId'],b['providerOrigin'],b['serverName'],b['ownerKeyFingerprint'],b['issuer'],b['clientIds'],b['identityBindingDigest'],POLICY,'0'*64))
  for lane in ['metadata','provider']:g.execute('INSERT INTO messaging_safety_v2.dataset_replays VALUES(%s,%s,%s,1,0,%s)',('messaging_metadata' if lane=='metadata' else 'synapse_provider',b[lane+'StoreId'],b[lane+'IncarnationId'],'0'*64))
  g.execute('GRANT CONNECT ON DATABASE cop_account_safety_guard TO csm_messaging;GRANT USAGE ON SCHEMA messaging_safety_v2 TO csm_messaging;GRANT SELECT ON ALL TABLES IN SCHEMA messaging_safety_v2 TO csm_messaging;GRANT INSERT ON messaging_safety_v2.journal TO csm_messaging;GRANT UPDATE(replay_sequence,replay_digest) ON messaging_safety_v2.dataset_replays TO csm_messaging;GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA messaging_safety_v2 TO csm_messaging;REVOKE EXECUTE ON FUNCTION messaging_safety_v2.begin_dataset_restore(text,uuid,uuid,bigint,uuid,bigint) FROM csm_messaging;GRANT USAGE ON SCHEMA messaging_usage_v1 TO csm_messaging;GRANT SELECT ON ALL TABLES IN SCHEMA messaging_usage_v1 TO csm_messaging;GRANT EXECUTE ON FUNCTION messaging_usage_v1.reserve(uuid,text,text,text,uuid,text,uuid) TO csm_messaging')
  admission.assert_current();connections['guard'].commit()
  return {'contractVersion':'cop-messaging-production-initial-schema-result-v1','schemaAndBindingInstalled':True,'baselineEnrolled':False,'erasureEnabled':False,'runtimeRestarted':False,'wholeAccountComplete':False}
 except BaseException:
  for c in connections.values():c.rollback()
  raise
