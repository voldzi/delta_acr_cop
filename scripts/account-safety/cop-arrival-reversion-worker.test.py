"""Real Store/schema/parity/CAS engine, isolated Docker fault adapter; no production data."""
import copy,datetime,importlib.util,json,os,types,unittest,uuid
from pathlib import Path
from unittest import mock
HERE=Path(__file__).resolve().parent
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
suite=load('runtime_fixtures',HERE.parent/'tests/test-cop-api-runtime.py');r=suite.m
worker=load('reversion_worker',HERE/'cop-arrival-reversion-worker-v1.py')
class ReversionTests(suite.RuntimeTests):
 def setUp(self):
  super().setUp();self.old=suite.LATER;self.new='sha256:'+'4'*64
  self.docker.base['services']['cop-api']['environment'].update(COP_AUTH_MODE='oidc',COP_ALLOW_LAB_TOKEN='false')
  raw_config=self.docker.source_config
  def source_config():
   value=raw_config();value['services']['cop-api']['environment']['COP_ALLOW_LAB_TOKEN']='${COP_ALLOW_LAB_TOKEN}';return value
  self.docker.source_config=source_config
  first=self.erasure_initial();path,p=self.clean_erasure_proof(first);b=self.erasure_candidate(first,path);old=self.store.activate(b['releaseId'],first['generation'])
  self.reset=p['cleanReset'];self.docker.base['services']['cop-api']['environment']['COP_ACCOUNT_ERASURE_ENABLED']='true'
  path,p=self.erasure_proof(old,'enable',self.old);p.update(contractVersion=r.CLEAN_ERASURE_PROOF_VERSION,cleanReset=self.reset,checks={k:True for k in r.CLEAN_ERASURE_PROOF_CHECKS});suite.write(path,p,0o640)
  b=self.erasure_candidate(old,path,self.old);self.initial=self.store.activate(b['releaseId'],old['generation'])
  self.authority=types.SimpleNamespace(OLD=self.old,NEW=self.new,NEW_REVISION=suite.REV,OLD_REVISION=suite.REV,PROFILE=self.initial['profileId'],REVERSE=r.ARRIVAL_REVERSION_VERSION,KEYS=set())
  def schema(_r,p):
   r.require(p['contractVersion']in{r.ARRIVAL_RELEASE_VERSION,r.ARRIVAL_REVERSION_VERSION} and p['ownerAcceptance']is True and p['changedKeys']==[],'isolated_authority_scope')
  def evidence(_r,p,fresh=True):
   schema(r,p)
   if fresh:r.require(r.fenced_timestamp(p['checkedAt'])<=datetime.datetime.now(datetime.timezone.utc).timestamp()<=r.fenced_timestamp(p['expiresAt']),'arrival_mutation_authority_expired')
  def read_proof(_r,store,path,raw,binding):
   p=json.loads(raw);schema(r,p);r.require(all(binding[k]==v for k,v in p['target'].items())and binding['previousReleaseId']==p['previous']['releaseId'],'isolated_target_binding');return r.sha(raw),p
  def environment(_r,actual,desired,p):evidence(r,p);r.require(actual==desired and desired['COP_ACCOUNT_ERASURE_ENABLED']=='true'and desired['COP_AUTH_MODE']=='oidc'and desired['COP_ALLOW_LAB_TOKEN']=='false','arrival_environment_changed')
  self.authority.schema=schema;self.authority.evidence=evidence;self.authority.read_proof=read_proof;self.authority.environment=environment
  patch=mock.patch.object(r.Store,'post_edge_module',lambda _self:self.authority);patch.start();self.addCleanup(patch.stop)
  self.ledger=self.source/'durable-fences-and-pending-job.json';self.ledger.write_text('{"fence":"keep","job":"pending","intake":true}')
  self.saved_env=(self.source/'.env').read_bytes();self.saved_ledger=self.ledger.read_bytes()
 def proof(self,previous,image,version):
  now=datetime.datetime.now(datetime.timezone.utc);tid=str(uuid.uuid4())
  p={'contractVersion':version,'transitionId':tid,'operation':'maintain','previous':previous,'target':{'imageId':image,'sourceRevision':suite.REV,'profileGeneration':previous['profileId']},'changedKeys':[],'environmentMetadata':r.environment_metadata(self.source/'.env',os.geteuid()),'composeHashes':{n:r.sha((self.source/n).read_bytes())for n in r.FILES},'cleanReset':self.reset,'ownerAcceptance':True,'checkedAt':now.isoformat().replace("+00:00","Z"),'expiresAt':(now+datetime.timedelta(minutes=10)).isoformat().replace("+00:00","Z")}
  path=self.protected/previous['profileId']/('account-erasure-'+tid+'.json');return path,p
 def forward(self,pending=False,before_start=False):
  path,p=self.proof(self.initial,self.new,r.ARRIVAL_RELEASE_VERSION);suite.write(path,p,0o640)
  suite.write(self.protected/self.initial['profileId']/('arrival-source-health-'+p['transitionId']+'.json'),r.encoded(suite.HEALTH),0o640)
  self.forward_parent_path=path
  self.forward_binding=self.erasure_candidate(self.initial,path,self.new)
  self.forward_dir=self.root/'releases'/self.forward_binding['releaseId']
  if pending:
   self.docker.interrupt=before_start;self.docker.interrupt_health=not before_start
   with self.assertRaises(KeyboardInterrupt):self.store.activate(self.forward_binding['releaseId'],self.initial['generation'])
  else:self.store.activate(self.forward_binding['releaseId'],self.initial['generation'])
  self.reverse_path,p=self.proof(self.store.pointer(),self.old,r.ARRIVAL_REVERSION_VERSION)
  actual=self.docker.current(self.forward_dir)
  p['parentProof']={'path':str(self.forward_parent_path),'sha256':r.sha(self.forward_parent_path.read_bytes())}
  p['sourceSpecSha256']=r.sha(r.encoded(r.fenced_public_source_spec(actual)))
  p['reversion']={'mode':'pending'if pending else'accepted','sourceReleaseId':self.forward_binding['releaseId'],'sourceContainerId':actual['Id'],'sourceImage':actual['Image'],'pendingForwardSha256':r.sha((self.root/'pending.json').read_bytes())if pending else None,'pendingHealthSha256':r.sha((self.root/'pending-health.json').read_bytes())if pending else None,'baselineSha256':r.sha((self.root/'pending-health.json').read_bytes())if pending else r.sha(r.encoded(suite.HEALTH))}
  suite.write(self.reverse_path,p,0o640);self.reverse_proof=p
  self.reverse_attest=self.receipt((self.initial['profileId'],self.forward_binding['driverContract']),self.old)
  return p
 def run_reverse(self):return worker.revert(r,self.store,self.reverse_path,self.reverse_attest,self.store.pointer()['generation'])
 def assert_preserved(self,p):
  self.assertEqual(p['imageId'],self.old);self.assertEqual(self.docker.live_container['Image'],self.old)
  self.assertEqual((self.source/'.env').read_bytes(),self.saved_env);self.assertEqual(self.ledger.read_bytes(),self.saved_ledger)
  self.assertFalse((self.root/'arrival-reversion-pending.json').exists());self.assertFalse((self.root/'pending.json').exists())
  env=dict(x.split('=',1)for x in self.docker.live_container['Config']['Env']);self.assertEqual(env['COP_ACCOUNT_ERASURE_ENABLED'],'true');self.assertEqual(env['COP_AUTH_MODE'],'oidc');self.assertEqual(env['COP_ALLOW_LAB_TOKEN'],'false')
 def test_accepted_reverse_is_fresh_release_and_preserves_state(self):
  self.forward();p=self.run_reverse();self.assert_preserved(p);self.assertNotEqual(p['releaseId'],self.initial['releaseId']);self.store.active()
 def test_pending_reverse_retains_original_exact_evidence(self):
  self.forward(True);old=(self.root/'pending.json').read_bytes();p=self.run_reverse();self.assert_preserved(p)
  archive=self.root/'arrival-reversion-history'/self.reverse_proof['transitionId'];self.assertEqual((archive/'superseded-pending.json').read_bytes(),old);self.store.active()
 def test_before_start_pending_can_return_without_intake_pause(self):
  self.forward(True,True);self.assert_preserved(self.run_reverse())
 def test_reverse_failure_keeps_both_journals_and_can_resume(self):
  self.forward(True);old=(self.root/'pending.json').read_bytes();self.docker.health_verify_failure=True
  with self.assertRaises(r.RuntimeError):self.run_reverse()
  self.assertEqual((self.root/'pending.json').read_bytes(),old);self.assertTrue((self.root/'arrival-reversion-pending.json').exists())
  with self.assertRaisesRegex(r.RuntimeError,'pending'):self.store.clean()
  self.docker.health_verify_failure=False;self.assert_preserved(self.run_reverse())
 def test_commit_interruption_resumes_without_second_restart(self):
  self.forward(True);commit=self.store.commit_pointer
  def interrupted(*args):commit(*args);raise KeyboardInterrupt('after CAS before archiving')
  with mock.patch.object(self.store,'commit_pointer',side_effect=interrupted):
   with self.assertRaises(KeyboardInterrupt):self.run_reverse()
  count=len(self.docker.up_calls);self.assert_preserved(self.run_reverse());self.assertEqual(len(self.docker.up_calls),count)
 def test_expired_proof_never_recreates_source(self):
  self.forward(True);p=self.reverse_proof;p['checkedAt']='2020-01-01T00:00:00Z';p['expiresAt']='2020-01-01T00:10:00Z';suite.write(self.reverse_path,p,0o640);count=len(self.docker.up_calls)
  with self.assertRaisesRegex(r.RuntimeError,'expired'):self.run_reverse()
  self.assertEqual(len(self.docker.up_calls),count);self.assertEqual(self.docker.live_container['Image'],self.new)
 def test_pending_tamper_and_peer_drift_fail_before_recreate(self):
  self.forward(True);count=len(self.docker.up_calls);pending=json.loads((self.root/'pending.json').read_bytes());pending['peers']['cop-web']='foreign';suite.write(self.root/'pending.json',pending)
  with self.assertRaisesRegex(r.RuntimeError,'pending_changed'):self.run_reverse()
  self.assertEqual(len(self.docker.up_calls),count)
 def test_environment_drift_is_not_a_reversion_permission(self):
  self.forward();count=len(self.docker.up_calls);self.docker.base['services']['cop-api']['environment']['COP_AUTH_MODE']='lab'
  with self.assertRaises(r.RuntimeError):self.run_reverse()
  self.assertEqual(len(self.docker.up_calls),count)
 def test_crash_after_up_before_cid_record_resumes_without_restart(self):
  self.forward(True);up=self.docker.up
  def interrupted(*args):up(*args);raise KeyboardInterrupt('after up before CID receipt')
  with mock.patch.object(self.docker,'up',side_effect=interrupted):
   with self.assertRaises(KeyboardInterrupt):self.run_reverse()
  count=len(self.docker.up_calls);self.assert_preserved(self.run_reverse());self.assertEqual(len(self.docker.up_calls),count)
 def test_crash_during_archive_retains_proof_and_resumes(self):
  self.forward(True);replace=worker.os.replace
  def interrupted(src,dst):
   replace(src,dst)
   if Path(src)==self.root/'pending.json':raise KeyboardInterrupt('after retaining original pending')
  with mock.patch.object(worker.os,'replace',side_effect=interrupted):
   with self.assertRaises(KeyboardInterrupt):self.run_reverse()
  count=len(self.docker.up_calls);self.assert_preserved(self.run_reverse());self.assertEqual(len(self.docker.up_calls),count)
 def test_network_drift_rejects_before_restart(self):
  self.forward(True);count=len(self.docker.up_calls)
  first=next(iter(self.docker.live_container['NetworkSettings']['Networks'].values()));first['NetworkID']='foreign'
  with self.assertRaises(r.RuntimeError):self.run_reverse()
  self.assertEqual(len(self.docker.up_calls),count)
 def test_accepted_unhealthy_source_can_return_using_retained_baseline(self):
  self.forward();health=self.docker.health
  def source_down(action,path):
   if action=='capture':raise r.RuntimeError('source unavailable')
   return health(action,path)
  with mock.patch.object(self.docker,'health',side_effect=source_down):self.assert_preserved(self.run_reverse())
 def test_accepted_retained_baseline_tamper_stops_before_restart(self):
  self.forward();parent=json.loads(self.forward_parent_path.read_bytes());path=self.protected/self.initial['profileId']/('arrival-source-health-'+parent['transitionId']+'.json');suite.write(path,{},0o640);count=len(self.docker.up_calls)
  with self.assertRaisesRegex(r.RuntimeError,'baseline_changed'):self.run_reverse()
  self.assertEqual(len(self.docker.up_calls),count)
 def test_plain_guarded_rollback_remains_forbidden(self):
  self.forward(True)
  with self.assertRaisesRegex(r.RuntimeError,'guarded_rollback'):self.store.recover(self.initial['generation'],rollback=True)
def load_tests(loader,tests,pattern):
 names=[n for n in ReversionTests.__dict__ if n.startswith('test_')];return unittest.TestSuite(ReversionTests(n)for n in names)
if __name__=='__main__':unittest.main()
