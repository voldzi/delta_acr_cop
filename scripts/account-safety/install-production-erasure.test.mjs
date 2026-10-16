import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {REQUIRED_FILES,RUNTIME_RESOURCES,compiledApiClosure,compiledRuntimeClosures,validatePlan,validateReceipts,ENVIRONMENT_NORMALIZATION_PROGRAM,DATABASE_HOST_STAGE_PROGRAM,DATABASE_READBACK_HOST_PROGRAM,FINAL_CONFIGURATION_PROGRAM,AUTHORITY_PREPARATION_PROGRAM,RUNTIME_INSPECTION_PROGRAM,INTAKE_TRANSITION_PROGRAM,LEGACY_HOST_STAGE_PROGRAM,LEGACY_FRESH_HOST_STAGE_PROGRAM,LEGACY_PAUSED_STATUS_PROGRAM,validateCompletionManifest,verifiedOwnerReadiness,runCompleteRelease,PENDING_QUARANTINE_PROGRAM,validateMediaPlanTransition,validateForwardRuntime,recoverableLegacySeal,EXPECTED_MESSAGING_SOURCE,validateControlPlanTransition} from './install-production-erasure.mjs';
const root='/srv/cop/runtime/account-erasure-install/';
const plan=()=>({contractVersion:'cop-production-erasure-install-v1',sourceRevision:'a'.repeat(40),imageId:'sha256:'+'b'.repeat(64),
 expectedActive:{contractVersion:'cop-api-runtime-active-v1',generation:'c'.repeat(32),releaseId:'release-'+'d'.repeat(32),profileId:'11111111-2222-4333-8444-555555555555',profileGeneration:'11111111-2222-4333-8444-555555555555',imageId:'sha256:'+'e'.repeat(64),containerId:'f'.repeat(64)},fileSha256:Object.fromEntries(REQUIRED_FILES.map(k=>[k,'0'.repeat(64)])),wholeAcceptancePath:root+'whole-acceptance.json',wholeAcceptanceSha256:'1'.repeat(64),mediaClosureEvidencePath:root+'media-closure.json',mediaClosureEvidenceSha256:'2'.repeat(64),databaseEnrollmentManifestPath:root+'database-enrollment.json',operation:'prepare'});
const whole=()=>({initialNormal202Verified:true,controlledMainCrashVerified:true,retryNormal202Verified:true,messagingSource:{...EXPECTED_MESSAGING_SOURCE},contractVersion:'cop-whole-erasure-acceptance-v1',phase:'whole_account_acceptance_complete',sourceRevision:'a'.repeat(40),sourceWorkingTreeDirty:false,compiledApiClosureSha256:'6'.repeat(64),runtimeResourceClosureSha256:'8'.repeat(64),compiledWorkspaceClosureSha256:'9'.repeat(64),nodeBaseImageId:'sha256:'+'7'.repeat(64),wholeAccountAccepted:true,productionChanged:false,twoRealKeycloakActors:true,actualOwners:['keycloak','cop_sessions_profiles','cop_devices','messaging_matrix','voice_livekit','cop_content_media','mobility_dispatch','sim_measurements','ai_router','moderation_audit','backup_restore'],providerCallMetadataDigest:'3'.repeat(64)});
const actual=()=>({compiledApiClosureSha256:'6'.repeat(64),runtimeResourceClosureSha256:'8'.repeat(64),compiledWorkspaceClosureSha256:'9'.repeat(64)});
const media=()=>({contractVersion:'cop-media-upload-closure-evidence-v1',production:true,endpoint:'http://storage.home.cz:8333',bucket:'cop-community-media',providerImageId:'sha256:'+'4'.repeat(64),providerStoppedAt:'2026-10-16T00:00:00.000Z',providerRestartedAt:'2026-10-16T00:01:00.000Z',oldCredentialDeniedAt:'2026-10-16T00:02:00.000Z',legacySlowBodyTerminated:true,oldSignatureDenied:true,newCredentialWorks:true,otherIdentityAndBucketPreserved:true});
test('checks only the fixed source files and exact public plan shape',()=>{assert.equal(validatePlan(plan()).operation,'prepare');const p=plan();p.arbitraryCommand='true';assert.throws(()=>validatePlan(p),/INSTALL_PLAN_SCHEMA/);});
test('rejects missing source pins and another image source',()=>{const p=plan();delete p.fileSha256[REQUIRED_FILES[0]];assert.throws(()=>validatePlan(p),/INSTALL_SOURCE_PINS/);const q=plan();q.sourceRevision='main';assert.throws(()=>validatePlan(q),/INSTALL_PLAN_IDENTITY/);});
test('rejects foreign receipt/DB paths and profile mismatch',()=>{for(const key of ['wholeAcceptancePath','mediaClosureEvidencePath','databaseEnrollmentManifestPath']){const p=plan();p[key]='/tmp/unreviewed.json';assert.throws(()=>validatePlan(p));}const p=plan();p.expectedActive.profileId='22222222-2222-4333-8444-555555555555';assert.throws(()=>validatePlan(p),/INSTALL_ACTIVE_BINDING/);});
test('requires the actual whole-provider and actual production media receipts',()=>{assert.equal(validateReceipts(plan(),whole(),media(),actual()),true);assert.throws(()=>validateReceipts(plan(),undefined,media(),actual()),/ACTUAL_FULL_MESSAGING_ACCEPTANCE_MISSING/);assert.throws(()=>validateReceipts(plan(),whole(),undefined,actual()),/ACTUAL_MEDIA_CLOSURE_MISSING/);});
test('does not accept online-only, stale source, missing owner or fixture media evidence',()=>{for(const edit of [w=>{w.phase='actual_online_whole_deletion_verified';},w=>{w.compiledApiClosureSha256='b'.repeat(64);},w=>{w.actualOwners.pop();},w=>{w.wholeAccountAccepted=false;}]){const w=whole();edit(w);assert.throws(()=>validateReceipts(plan(),w,media(),actual()),/ACTUAL_WHOLE_ACCEPTANCE_MISSING/);}const m=media();m.production=false;assert.throws(()=>validateReceipts(plan(),whole(),m,actual()),/ACTUAL_MEDIA_CLOSURE_MISSING/);});
test('requires all old-writer closure facts and actual provider time order',()=>{for(const key of ['oldSignatureDenied','legacySlowBodyTerminated','newCredentialWorks','otherIdentityAndBucketPreserved']){const m=media();m[key]=false;assert.throws(()=>validateReceipts(plan(),whole(),m,actual()),/ACTUAL_MEDIA_CLOSURE_MISSING/);}const m=media();m.providerStoppedAt=m.oldCredentialDeniedAt;assert.throws(()=>validateReceipts(plan(),whole(),m,actual()),/MEDIA_CLOSURE_ORDER/);});

test('embedded host producer is valid Python without executing host effects',()=>{const source=readFileSync(new URL('./install-production-erasure.mjs',import.meta.url),'utf8');const body=source.split('const pythonProof=String.raw`')[1].split('`;')[0];const run=spawnSync('python3',['-B','-c',"import sys;compile(sys.stdin.read(),'root-proof-producer','exec')"],{input:body,encoding:'utf8'});assert.equal(run.status,0,'Embedded producer must parse; private diagnostics suppressed');});

test('matches the actually tested compiled closure even when source basis differs or helpers were dirty',()=>{const w=whole();w.sourceRevision='b'.repeat(40);w.sourceWorkingTreeDirty=true;assert.equal(validateReceipts(plan(),w,media(),actual()),true);assert.throws(()=>validateReceipts(plan(),w,media(),{...actual(),compiledApiClosureSha256:'8'.repeat(64)}),/ACTUAL_WHOLE_ACCEPTANCE_MISSING/);assert.throws(()=>validateReceipts(plan(),w,media()),/ACTUAL_WHOLE_ACCEPTANCE_MISSING/);});
test('canonical compiled closure matches Python harness algorithm, excludes declarations and orders paths',()=>{const dir=mkdtempSync(join(tmpdir(),'cop-compiled-closure-'));const digest=v=>createHash('sha256').update(v).digest('hex');try{mkdirSync(join(dir,'nested'));writeFileSync(join(dir,'z.js'),'last');writeFileSync(join(dir,'a.js'),'first');writeFileSync(join(dir,'nested','a.json'),'{}');writeFileSync(join(dir,'a.d.ts'),'ignored');const expected=digest([['apps/cop-api/dist/a.js','first'],['apps/cop-api/dist/nested/a.json','{}'],['apps/cop-api/dist/z.js','last']].map(([name,value])=>name+'\0'+digest(value)).join('\n'));assert.equal(compiledApiClosure(dir),expected);writeFileSync(join(dir,'a.js'),'different');assert.notEqual(compiledApiClosure(dir),expected);}finally{rmSync(dir,{recursive:true});}});

test('runtime resources and every transitive compiled workspace package are part of independent exact closures',()=>{const dir=mkdtempSync(join(tmpdir(),'cop-runtime-closures-'));try{const put=(name,value)=>{mkdirSync(join(dir,name.slice(0,name.lastIndexOf('/'))),{recursive:true});writeFileSync(join(dir,name),value);};put('apps/cop-api/package.json',JSON.stringify({dependencies:{'@cop/a':'workspace:*'}}));put('apps/cop-api/dist/server.js','server');put('packages/a/package.json',JSON.stringify({name:'@cop/a',dependencies:{'@cop/b':'workspace:*'}}));put('packages/a/dist/a.js','A');put('packages/b/package.json',JSON.stringify({name:'@cop/b'}));put('packages/b/dist/b.json','{}');for(const name of RUNTIME_RESOURCES)put(name,'{}');const first=compiledRuntimeClosures(dir);put('packages/b/dist/b.json','{"changed":true}');const second=compiledRuntimeClosures(dir);assert.notEqual(first.compiledWorkspaceClosureSha256,second.compiledWorkspaceClosureSha256);assert.equal(first.compiledApiClosureSha256,second.compiledApiClosureSha256);put(RUNTIME_RESOURCES[0],'{"changed":true}');assert.notEqual(second.runtimeResourceClosureSha256,compiledRuntimeClosures(dir).runtimeResourceClosureSha256);}finally{rmSync(dir,{recursive:true});}});
test('a resource or workspace mismatch cannot be replaced by a matching API-only hash',()=>{for(const key of ['runtimeResourceClosureSha256','compiledWorkspaceClosureSha256'])assert.throws(()=>validateReceipts(plan(),whole(),media(),{...actual(),[key]:'f'.repeat(64)}),/ACTUAL_WHOLE_ACCEPTANCE_MISSING/);});


test('normalizer parses without executing a production action',()=>{const r=spawnSync('python3',['-I','-c',"import sys;compile(sys.stdin.read(),'environment-normalization','exec')"],{input:ENVIRONMENT_NORMALIZATION_PROGRAM,encoding:'utf8'});assert.equal(r.status,0,'Private diagnostics suppressed');});
test('normalization preserves last-wins bytes and rejects any unreviewed duplicate or syntax',()=>{
 const code=ENVIRONMENT_NORMALIZATION_PROGRAM.split('# Production entry follows')[0]+String.raw`
raw=b'# preserve\r\nCOP_DEPLOY_DOMAIN=old\r\nCOP_LAB_TOKEN=earlier\nOTHER=preserve exactly  \nCOP_DEPLOY_DOMAIN=new\r\nCOP_LAB_TOKEN=last=quoted-$value\n\n'
expected=b'# preserve\r\nOTHER=preserve exactly  \nCOP_DEPLOY_DOMAIN=new\r\nCOP_LAB_TOKEN=last=quoted-$value\n\n'
actual,keys=normalized_legacy_environment(raw)
assert actual==expected and keys==['COP_DEPLOY_DOMAIN','COP_LAB_TOKEN']
assert normalized_legacy_environment(actual)==(actual,[])
for invalid in [b'OTHER=a\nOTHER=b\n',b'COP_LAB_TOKEN=a\nCOP_LAB_TOKEN=b\nCOP_LAB_TOKEN=c\n',b'export COP_LAB_TOKEN=a\n',b'lower=a\n',b'COP_LAB_TOKEN=a\0b\n',b'A='+b'x'*1048576]:
 try:normalized_legacy_environment(invalid);raise AssertionError('invalid accepted')
 except RuntimeError:pass
`;
 const r=spawnSync('python3',['-I','-c',code],{encoding:'utf8'});assert.equal(r.status,0,'Private fixture diagnostics suppressed');
});
test('private atomic normalization checks metadata and bytes, preserves owner and can rollback only its own unchanged result',()=>{
 const code=ENVIRONMENT_NORMALIZATION_PROGRAM.split('# Production entry follows')[0]+String.raw`
import tempfile
from unittest import mock
class Runtime:
 @staticmethod
 def require(value,code):
  if not value:raise RuntimeError(code)
 @staticmethod
 def environment_metadata(path,uid):
  value=os.lstat(path);Runtime.require(stat.S_ISREG(value.st_mode) and value.st_nlink==1 and value.st_uid==uid and stat.S_IMODE(value.st_mode)==0o600,'custody')
  return (value.st_dev,value.st_ino,value.st_size,value.st_mtime_ns,value.st_ctime_ns)
 @staticmethod
 def private_read(path,uid,limit):
  Runtime.environment_metadata(path,uid);fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
  try:return os.read(fd,limit+1)
  finally:os.close(fd)
 @staticmethod
 def sha(value):return hashlib.sha256(value).hexdigest()
 class Store:
  @staticmethod
  def sync(path):
   fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
   try:os.fsync(fd)
   finally:os.close(fd)
r=Runtime
with tempfile.TemporaryDirectory() as name:
 directory=pathlib.Path(name);path=directory/'.env';original=b'COP_LAB_TOKEN=old\nCOP_LAB_TOKEN=last\n';proposed=normalized_legacy_environment(original)[0]
 path.write_bytes(original);path.chmod(0o600);uid=os.getuid();gid=os.getgid();metadata=r.environment_metadata(path,uid)
 after=atomic_private_environment(r,path,metadata,r.sha(original),proposed,uid,gid)
 assert path.read_bytes()==proposed and stat.S_IMODE(path.stat().st_mode)==0o600 and path.stat().st_uid==uid and path.stat().st_gid==gid
 atomic_private_environment(r,path,after,r.sha(proposed),original,uid,gid)
 assert path.read_bytes()==original
 metadata=r.environment_metadata(path,uid)
 try:atomic_private_environment(r,path,metadata,'0'*64,proposed,uid,gid);raise AssertionError('hash mismatch accepted')
 except RuntimeError:pass
 actual_sync=os.fsync;called=[False]
 def raced_sync(fd):
  actual_sync(fd)
  if not called[0]:called[0]=True;path.write_bytes(b'CONCURRENT=preserved\n');path.chmod(0o600)
 with mock.patch.object(os,'fsync',raced_sync):
  try:atomic_private_environment(r,path,metadata,r.sha(original),proposed,uid,gid);raise AssertionError('CAS race accepted')
  except RuntimeError:pass
 assert path.read_bytes()==b'CONCURRENT=preserved\n' and list(directory.glob('.env.normalize-*'))==[]
 try:atomic_private_environment(r,path,after,r.sha(proposed),original,uid,gid);raise AssertionError('foreign edit overwritten')
 except RuntimeError:pass
 assert path.read_bytes()==b'CONCURRENT=preserved\n'
 path.unlink();target=directory/'target';target.write_bytes(b'never overwrite');path.symlink_to(target)
 try:atomic_private_environment(r,path,metadata,r.sha(original),proposed,uid,gid);raise AssertionError('symlink accepted')
 except RuntimeError:pass
 assert target.read_bytes()==b'never overwrite' and path.is_symlink()
`;
 const r=spawnSync('python3',['-I','-c',code],{encoding:'utf8'});assert.equal(r.status,0,'Private fixture diagnostics suppressed');
});


test('host database wrapper is valid Python and requires the unchanged active tuple under the actual storage lock',()=>{
 const parse=spawnSync('python3',['-I','-c',"import sys;compile(sys.stdin.read(),'database-host-stage','exec')"],{input:DATABASE_HOST_STAGE_PROGRAM,encoding:'utf8'});assert.equal(parse.status,0);
 const code=DATABASE_HOST_STAGE_PROGRAM.split('# Production entry follows')[0]+String.raw`
from contextlib import contextmanager
import copy
p={'expectedActive':{'generation':'a'*32,'containerId':'b'*64,'imageId':'sha256:'+'c'*64}}
class Storage:
 held=False
 @classmethod
 @contextmanager
 def operation_lock(cls):
  assert not cls.held;cls.held=True
  try:yield
  finally:cls.held=False
class Store:
 def __init__(self):
  self.active_value=copy.deepcopy(p['expectedActive']);self.container={'Id':'b'*64,'Image':'sha256:'+'c'*64,'State':{'Running':True,'Paused':False,'Pid':100,'StartedAt':'fixed'}};self.docker=self
 def active(self):assert Storage.held;return self.active_value,None,None,None
 def pointer(self):assert Storage.held;return self.active_value
 def current(self,directory):assert Storage.held;return copy.deepcopy(self.container)
 def unchanged(self,directory,before):require(self.container==before,'container_changed')
def require(v,code):
 if not v:raise RuntimeError(code)
def run(change=None,before=None):
 st=Store();calls=[]
 if before:before(st)
 def verify():assert Storage.held;calls.append('pins')
 def launch():
  assert Storage.held;calls.append('launch')
  if change:change(st)
  return 'complete'
 try:return coordinate_database_stage(p,Storage,lambda:st,launch,verify,require),calls
 finally:assert not Storage.held
result,calls=run();assert result=='complete' and calls.count('launch')==1 and calls.count('pins')==4
for change in [lambda st:st.active_value.update(generation='d'*32),lambda st:st.container.update(Id='d'*64),lambda st:st.container['State'].update(Pid=101),lambda st:st.container['State'].update(Paused=True)]:
 try:run(change);raise AssertionError('post-apply race accepted')
 except RuntimeError:pass
for before in [lambda st:st.active_value.update(generation='d'*32),lambda st:st.container.update(Id='d'*64)]:
 try:run(before=before);raise AssertionError('stale tuple accepted')
 except RuntimeError:pass
st=Store();called=[]
def wrong_pins():assert Storage.held;raise RuntimeError('pins_changed')
try:coordinate_database_stage(p,Storage,lambda:st,lambda:called.append('launched'),wrong_pins,require);raise AssertionError('pin mismatch accepted')
except RuntimeError:pass
assert not called and not Storage.held
`;
 const r=spawnSync('python3',['-I','-c',code],{encoding:'utf8'});assert.equal(r.status,0,'Private fixture diagnostics suppressed');
});


test('Keycloak preparation rejects unrelated environment drift before invoking its fixed worker',()=>{
 const code=DATABASE_HOST_STAGE_PROGRAM.split('# Production entry follows')[0]+String.raw`
from contextlib import contextmanager
class Storage:
 @staticmethod
 @contextmanager
 def operation_lock():yield
def require(v,code):
 if not v:raise RuntimeError(code)
p={'expectedActive':{'containerId':'a','imageId':'b','generation':'c'}}
class Store:
 docker=None
 def __init__(self):self.docker=self
 def active(self):return p['expectedActive'],None,None,None
 def current(self,directory):return {'Id':'a','Image':'b','State':{'Running':True,'Pid':1}}
called=[]
def drift(*args):preparation_environment_changes({'UNRELATED':'old'},{'UNRELATED':'new'},require)
try:coordinate_database_stage(p,Storage,Store,lambda:called.append('keycloak mutation'),lambda:None,require,drift);raise AssertionError('configuration drift accepted')
except RuntimeError:pass
assert not called
`;
 const r=spawnSync('python3',['-I','-c',code],{encoding:'utf8'});assert.equal(r.status,0,'Private fixture diagnostics suppressed');
});
test('preparation accepts only generated guard/worker fields and never an enabled intake or scope claim',()=>{
 const code=DATABASE_HOST_STAGE_PROGRAM.split('# Production entry follows')[0]+String.raw`
def require(v,code):
 if not v:raise RuntimeError(code)
before={'UNRELATED':'preserved'};after={**before,'COP_ACCOUNT_ERASURE_SECRET':'synthetic','COP_KEYCLOAK_ERASURE_CLIENT_ID':'cop-account-erasure-worker','COP_KEYCLOAK_COP_SCOPE_AUTHORITY_ACCEPTED':'false'}
assert preparation_environment_changes(before,after,require)==set(after)-set(before)
for key in ('COP_ACCOUNT_ERASURE_ENABLED','COP_ACCOUNT_SAFETY_GUARD_REQUIRED','COP_KEYCLOAK_COP_SCOPE_AUTHORITY_ACCEPTED'):
 try:preparation_environment_changes(before,{**after,key:'true'},require);raise AssertionError('enabled accepted')
 except RuntimeError:pass
try:preparation_environment_changes(before,{**after,'COP_SIM_ERASURE_ROUTER_TOKEN':'not allowed here'},require);raise AssertionError('unrelated preparation credential accepted')
except RuntimeError:pass
`;
 const r=spawnSync('python3',['-I','-c',code],{encoding:'utf8'});assert.equal(r.status,0,'Private fixture diagnostics suppressed');
});


test('finite final configuration copies only the two exact SIM secrets and preserves every unrelated/actor value',()=>{
 const syntax=spawnSync('python3',['-I','-c',"import sys;compile(sys.stdin.read(),'final-configuration','exec')"],{input:FINAL_CONFIGURATION_PROGRAM,encoding:'utf8'});assert.equal(syntax.status,0);
 const code=FINAL_CONFIGURATION_PROGRAM.split('# Production final-configuration entry follows')[0]+String.raw`
uuid='11111111-2222-4333-8444-555555555555';env={'COP_ACCOUNT_ERASURE_ENABLED':'false','COP_OIDC_ISSUER':'https://login.zeleznalady.cz/realms/cop','COP_ACCOUNT_ERASURE_SECRET':'a'*48,'COP_SIM_ERASURE_ACTOR_SECRET':'b'*48,'COP_AI_CHAT_ROUTER_USER_ID_SECRET':'c'*48,'COP_KEYCLOAK_ERASURE_CLIENT_ID':'cop-account-erasure-worker','COP_KEYCLOAK_ERASURE_CLIENT_SECRET':'d'*48,'COP_MEDIA_S3_ACCESS_KEY_ID':'e'*48,'COP_MEDIA_S3_SECRET_ACCESS_KEY':'f'*48,'COP_EDGE_ADMIN_TOKEN':'g'*48,'COP_ACCOUNT_SAFETY_GUARD_STORE_ID':uuid,'COP_ACCOUNT_SAFETY_INCARNATION_ID':uuid,'COP_ACCOUNT_SAFETY_STORE_ID':uuid,'COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL':'postgresql://cop_safety_v2_runtime:synthetic@haproxy.home.cz:5000/cop_account_safety_guard','COP_MEDIA_UPLOAD_TRANSPORT':'cop_api','COP_CSM_MESSAGING_PUBLIC_URL':'https://msg.zeleznalady.cz','UNRELATED':'preserve $literal exactly'}
raw=('# keep comment\n'+''.join(key+'='+value+'\n' for key,value in env.items())).encode();sim=b'AI_ROUTER_COP_TOKEN='+b'r'*48+b'\nDRIVER_MEASUREMENTS_COP_TOKEN='+b't'*48+b'\nOTHER_SECRET=never copy\n';edge={'COP_EDGE_ADMIN_TOKEN':'g'*48,'COP_EDGE_NODE_ID':'node_edge_pilot_01'}
actual,keys=finite_final_environment(raw,sim,edge);value=finite_env_parse(actual)
assert value['COP_SIM_ERASURE_ROUTER_TOKEN']=='r'*48 and value['COP_SIM_ERASURE_DRIVER_TOKEN']=='t'*48
assert value['COP_SIM_ERASURE_ROUTER_URL']=='http://ai-router-api:4050' and value['COP_SIM_ERASURE_DRIVER_URL']=='http://sim-driver-measurements:4020'
assert value['COP_ACCOUNT_ERASURE_ENABLED']=='false' and value['COP_ACCOUNT_SAFETY_GUARD_REQUIRED']=='true' and value['COP_LIVEKIT_ADMIN_URL']==''
assert set(keys)<=FINAL_KEYS and len(FINAL_KEYS)==24 and 'OTHER_SECRET' not in value
for key in ('COP_SIM_ERASURE_ACTOR_SECRET','COP_AI_CHAT_ROUTER_USER_ID_SECRET','COP_ACCOUNT_ERASURE_SECRET','COP_KEYCLOAK_ERASURE_CLIENT_SECRET','UNRELATED'):assert value[key]==env[key]
assert actual.startswith(b'# keep comment\n') and b'UNRELATED=preserve $literal exactly\n' in actual
assert finite_final_environment(actual,sim,edge)==(actual,[])
for badraw,badsim,badedge in [(raw.replace(b'COP_ACCOUNT_ERASURE_ENABLED=false',b'COP_ACCOUNT_ERASURE_ENABLED=true'),sim,edge),(raw,b'AI_ROUTER_COP_TOKEN='+b'r'*48+b'\n',edge),(raw,sim,{**edge,'COP_EDGE_ADMIN_TOKEN':'other'*10}),(raw+b'COP_ACCOUNT_ERASURE_SECRET=duplicate\n',sim,edge),(raw.replace(b'https://msg.zeleznalady.cz',b'https://foreign.invalid'),sim,edge)]:
 try:finite_final_environment(badraw,badsim,badedge);raise AssertionError('unverified input accepted')
 except RuntimeError:pass
`;
 const r=spawnSync('python3',['-I','-c',code],{encoding:'utf8'});assert.equal(r.status,0,'Private fixture diagnostics suppressed');
});


test('accepted finite-stage programs parse without executing any Root or provider operation',()=>{for(const program of [AUTHORITY_PREPARATION_PROGRAM,RUNTIME_INSPECTION_PROGRAM,INTAKE_TRANSITION_PROGRAM]){const r=spawnSync('python3',['-I','-c',"import sys;compile(sys.stdin.read(),'finite-root-stage','exec')"],{input:program,encoding:'utf8'});assert.equal(r.status,0,'Private diagnostics suppressed');}});


const completion=()=>({contractVersion:'cop-production-erasure-completion-v2',phase:'initial',releasePlanSha256:'a'.repeat(64),finalConfigurationSha256:'b'.repeat(64),legacyProvenancePolicySha256:'e'.repeat(64),legacyProvenancePlanSha256:'c'.repeat(64),ownerReadinessReceiptSha256:null});
const runtime=()=>({active:plan().expectedActive,sourceRevision:'a'.repeat(40),startedAt:'2026-10-16T00:00:00.000Z',guarded:true,guardRequired:true,intakeEnabled:false});
const ownerHealth=()=>({dependencies:[{name:'cop-account-erasure-owners',status:'ok',checkedAt:'2026-10-16T01:00:00.000Z'}]});
test('completion manifest accepts only fixed metadata, missing provenance is explicit and no commands/secrets fit',()=>{assert.equal(validateCompletionManifest(completion()).phase,'initial');for(const edit of [v=>{v.command='true';},v=>{v.password='never';},v=>{v.phase='complete';},v=>{v.releasePlanSha256='main';}]){const v=completion();edit(v);assert.throws(()=>validateCompletionManifest(v),/COMPLETION_MANIFEST_INVALID/);}const v=completion();v.legacyProvenancePlanSha256=null;assert.equal(validateCompletionManifest(v).legacyProvenancePlanSha256,null);});
test('owner readiness requires a real no-store health response and exact unchanged guarded runtime',()=>{const before=runtime();const response={status:200,cacheControl:'no-store',imageId:before.active.imageId};const now=Date.parse('2026-10-16T01:00:01.000Z');assert.equal(verifiedOwnerReadiness(ownerHealth(),response,before,structuredClone(before),now).httpStatus,200);for(const change of [v=>{v.active.containerId='a'.repeat(64);},v=>{v.active.generation='b'.repeat(32);},v=>{v.startedAt='changed';}]){const after=runtime();change(after);assert.throws(()=>verifiedOwnerReadiness(ownerHealth(),response,before,after,now));}assert.throws(()=>verifiedOwnerReadiness(ownerHealth(),{...response,status:503},before,before,now));assert.throws(()=>verifiedOwnerReadiness(ownerHealth(),{...response,cacheControl:'public,max-age=30'},before,before,now));});
test('missing, stale, future, duplicate or unavailable owner status cannot enable erasure',()=>{const before=runtime(),response={status:200,cacheControl:'no-store',imageId:before.active.imageId},now=Date.parse('2026-10-16T01:00:01.000Z');for(const edit of [v=>{v.dependencies=[];},v=>{v.dependencies.push({...v.dependencies[0]});},v=>{v.dependencies[0].status='unavailable';},v=>{v.dependencies[0].checkedAt='2026-10-16T00:59:00.000Z';},v=>{v.dependencies[0].checkedAt='2026-10-16T01:01:00.000Z';}]){const h=ownerHealth();edit(h);assert.throws(()=>verifiedOwnerReadiness(h,response,before,before,now));}});
function orchestration(overrides={}){const calls=[];const step=name=>async()=>{calls.push(name);};return {calls,d:{preflight:async()=>{calls.push('preflight');return {ready:true,stage:'initial'};},...Object.fromEntries(['normalize','prepareAuthority','database','keycloak','finalConfiguration','media','imageAttestation','prepareProof','deployPrepare','recordPrepared','enable','postcheck','recordComplete'].map(name=>[name,step(name)])),provenance:async()=>{calls.push('provenance');return {ready:true};},readiness:async()=>{calls.push('readiness');return {ready:true};},pauseOnFailure:async()=>{calls.push('pause');return {erasureEnabled:false};},recordCheckpoint:async next=>{calls.push('checkpoint:'+next);},...overrides}};}
test('fixed complete-release orders actual preparation, closure, guarded off deployment and readiness before enable',async()=>{const f=orchestration();const result=await runCompleteRelease(f.d);assert.equal(result.releaseComplete,true);assert.equal(result.accountDeletionPerformed,false);assert.deepEqual(f.calls,['preflight','normalize','prepareAuthority','database','keycloak','checkpoint:configuration','finalConfiguration','checkpoint:provenance','provenance','checkpoint:media','imageAttestation','media','checkpoint:media_closed','imageAttestation','prepareProof','deployPrepare','recordPrepared','readiness','enable','postcheck','recordComplete']);});
test('missing staged provenance, owner failure and failed provider closure never call enable or claim complete',async()=>{for(const overrides of [{preflight:async()=>({ready:false,code:'LEGACY_PROVENANCE_INPUT_MISSING'})},{provenance:async()=>({ready:false,code:'LEGACY_SESSION_PROVENANCE_REQUIRED'})},{readiness:async()=>({ready:false,code:'OWNER_READINESS_NOT_READY'})},{media:async()=>{throw Error('MEDIA_CLOSURE_UNPROVEN');}}]){const f=orchestration(overrides),result=await runCompleteRelease(f.d);assert.equal(result.wholeAccountComplete,false);assert(!f.calls.includes('enable'));assert(!f.calls.includes('recordComplete'));}});
test('enable or postcheck failure requires confirmed pause, failed pause reports unknown intake instead of false',async()=>{for(const step of ['enable','postcheck']){const f=orchestration({[step]:async()=>{throw Error('ACTUAL_CHECK_FAILED');}}),result=await runCompleteRelease(f.d);assert.equal(result.wholeAccountComplete,false);assert.equal(result.erasureEnabled,false);assert(f.calls.includes('pause'));}const f=orchestration({enable:async()=>{throw Error('ACTUAL_CHECK_FAILED');},pauseOnFailure:async()=>{throw Error('PAUSE_UNPROVEN');}});assert.equal((await runCompleteRelease(f.d)).erasureEnabled,null);});
test('guarded prepared resume repeats actual readiness and enabled resume pauses on a fresh owner failure',async()=>{const f=orchestration({preflight:async()=>({ready:true,stage:'prepared'})});assert.equal((await runCompleteRelease(f.d)).releaseComplete,true);assert(!f.calls.includes('database'));assert(!f.calls.includes('media'));assert.deepEqual(f.calls,['readiness','enable','postcheck','recordComplete']);const g=orchestration({preflight:async()=>({ready:true,stage:'enabled'}),readiness:async()=>({ready:false,code:'OWNER_READINESS_NOT_READY'})});const result=await runCompleteRelease(g.d);assert.equal(result.erasureEnabled,false);assert(g.calls.includes('pause'));});
test('actual legacy host bridge parses without executing pause, SQL or provider calls',()=>{const r=spawnSync('python3',['-I','-c',"import sys;compile(sys.stdin.read(),'legacy-host-stage','exec')"],{input:LEGACY_HOST_STAGE_PROGRAM,encoding:'utf8'});assert.equal(r.status,0,'Private diagnostics suppressed');});


test('failed activation can suspend only its exact guard-capable journaled candidate and preserves uncertainty',async()=>{
 const syntax=spawnSync('python3',['-I','-c',"import sys;compile(sys.stdin.read(),'pending-quarantine','exec')"],{input:PENDING_QUARANTINE_PROGRAM,encoding:'utf8'});assert.equal(syntax.status,0);
 const code=PENDING_QUARANTINE_PROGRAM.split('# Production quarantine')[0]+String.raw`
import copy
def require(v,code):
 if not v:raise RuntimeError(code)
p={'expectedActive':{'generation':'old'},'imageId':'sha256:new','sourceRevision':'reviewed'};pointer=p['expectedActive'];pending={'previous':pointer,'targetReleaseId':'target','targetContainerId':'owned'};binding={'releaseId':'target','imageId':'sha256:new','sourceRevision':'reviewed','accountErasureConfig':{'path':'protected'},'profileGeneration':'profile'}
actual={'Id':'owned','Image':'sha256:new','Config':{'Labels':{'com.docker.compose.project':'cop','com.docker.compose.service':'cop-api','com.cop.runtime.release':'target','com.cop.runtime.profile-generation':'profile'},'Env':['COP_ACCOUNT_SAFETY_GUARD_REQUIRED=true','COP_ACCOUNT_ERASURE_ENABLED=true']},'State':{'Running':True,'Pid':100}}
assert owned_pending_target(p,pointer,pending,binding,actual,require)=='owned'
for edit in [lambda v:v.update(Image='old-image'),lambda v:v.update(Id='foreign'),lambda v:v['Config']['Labels'].update({'com.docker.compose.service':'foreign'}),lambda v:v['Config'].update(Env=['COP_ACCOUNT_ERASURE_ENABLED=true']),lambda v:v['State'].update(Running=False)]:
 changed=copy.deepcopy(actual);edit(changed)
 try:owned_pending_target(p,pointer,pending,binding,changed,require);raise AssertionError('unowned target accepted')
 except RuntimeError:pass
`;
 const r=spawnSync('python3',['-I','-c',code],{encoding:'utf8'});assert.equal(r.status,0,'Private fixture diagnostics suppressed');
 const f=orchestration({enable:async()=>{throw Error('INSTALL_GUARDED_DEPLOY_FAILED');},pauseOnFailure:async()=>({erasureEnabled:null,intakeSuspended:true})});const result=await runCompleteRelease(f.d);assert.equal(result.erasureEnabled,null);assert.equal(result.intakeSuspended,true);assert.equal(result.releaseComplete,false);
});


test('legacy template seal fills only the actual configuration fingerprint and refuses changed rows, binding or prior fingerprint',()=>{
 const code=DATABASE_HOST_STAGE_PROGRAM.split('# Production entry follows')[0]+String.raw`
import copy
def require(v,code):
 if not v:raise RuntimeError(code)
actual={'guardStoreId':'guard','applicationStoreId':'app','incarnationId':'incarnation','restoreGeneration':1,'configurationFingerprint':'a'*64}
value={'contractVersion':'cop-legacy-erasure-provenance-policy-v1','binding':{**actual,'configurationFingerprint':None},'writer':{'containerId':'fixed'},'evidence':[{'id':'reviewed'}]}
digest=hashlib.sha256(json.dumps(value,separators=(',',':')).encode()).hexdigest()
sealed=sealed_legacy_template(value,digest,actual,require)
assert sealed['binding']['configurationFingerprint']=='a'*64 and value['binding']['configurationFingerprint'] is None
assert {k:v for k,v in sealed.items() if k!='binding'}=={k:v for k,v in value.items() if k!='binding'}
for edit in [lambda v:v['writer'].update(containerId='changed'),lambda v:v['binding'].update(applicationStoreId='other'),lambda v:v['binding'].update(configurationFingerprint='b'*64)]:
 changed=copy.deepcopy(value);edit(changed)
 try:sealed_legacy_template(changed,digest,actual,require);raise AssertionError('changed reviewed template accepted')
 except RuntimeError:pass
wrong=copy.deepcopy(value);wrong['binding']['configurationFingerprint']='b'*64
wrong_digest=hashlib.sha256(json.dumps(wrong,separators=(',',':')).encode()).hexdigest()
try:sealed_legacy_template(wrong,wrong_digest,actual,require);raise AssertionError('wrong existing fingerprint accepted')
except RuntimeError:pass
`;
 const r=spawnSync('python3',['-I','-c',code],{encoding:'utf8'});assert.equal(r.status,0,'Private fixture diagnostics suppressed');
});


test('media plan transition can reconcile only exact old/new plan bytes and the actual owned receipt digest',()=>{
 const before=plan(),after={...before,mediaClosureEvidenceSha256:'f'.repeat(64)},bytes=Buffer.from(JSON.stringify(before)+'\n'),nextBytes=Buffer.from(JSON.stringify(after)+'\n');
 const digest=v=>createHash('sha256').update(v).digest('hex');
 const transition={contractVersion:'cop-production-media-plan-transition-v1',previousReleasePlanSha256:digest(bytes),nextReleasePlanSha256:digest(nextBytes),nextPlan:after,sourceRevision:after.sourceRevision,imageId:after.imageId,expectedActive:after.expectedActive,receiptSha256:after.mediaClosureEvidenceSha256};
 const c={...completion(),phase:'media',releasePlanSha256:digest(bytes)};
 assert.deepEqual(validateMediaPlanTransition(transition,c,bytes),after);assert.deepEqual(validateMediaPlanTransition(transition,c,nextBytes),after);
 for(const edit of [v=>{v.nextPlan.sourceRevision='d'.repeat(40);},v=>{v.receiptSha256='d'.repeat(64);},v=>{v.expectedActive.containerId='d'.repeat(64);},v=>{v.command='true';}]){const bad=structuredClone(transition);edit(bad);assert.throws(()=>validateMediaPlanTransition(bad,c,bytes));}
 assert.throws(()=>validateMediaPlanTransition(transition,{...c,phase:'initial'},bytes));
 assert.throws(()=>validateMediaPlanTransition(transition,c,Buffer.from(JSON.stringify({...before,operation:'enable'})+'\n')));
});

test('a successful deployment before checkpoint is accepted only through its exact protected predecessor tuple',()=>{
 const p=plan(),v={...runtime(),active:{...p.expectedActive,imageId:p.imageId,containerId:'d'.repeat(64)},sourceRevision:p.sourceRevision,previousReleaseId:p.expectedActive.releaseId,configPrevious:p.expectedActive};
 assert.equal(validateForwardRuntime(v,p,{...completion(),phase:'media_closed'}),true);
 for(const edit of [v=>{v.configPrevious.containerId='e'.repeat(64);},v=>{v.active.imageId='sha256:'+'e'.repeat(64);},v=>{v.previousReleaseId='release-'+'e'.repeat(32);},v=>{v.guarded=false;}]){const bad=structuredClone(v);edit(bad);assert.throws(()=>validateForwardRuntime(bad,p,{...completion(),phase:'media_closed'}));}
 assert.throws(()=>validateForwardRuntime(v,p,completion()));
});

test('durable checkpoints resume after configuration, provenance, media, proof and deploy failures without repeating closed stages',async()=>{
 for(const failed of ['finalConfiguration','provenance','media','prepareProof','deployPrepare']){
  let checkpoint='initial',first=true,rotations=0,provenanceApplies=0,mediaDone=false,provenanceDone=false;const f=orchestration();
  f.d.preflight=async()=>({ready:true,stage:checkpoint});
  f.d.recordCheckpoint=async next=>{checkpoint=next;};
  for(const name of ['finalConfiguration','provenance','media','prepareProof','deployPrepare']){f.d[name]=async()=>{
   if(name==='provenance'&&!provenanceDone){provenanceDone=true;provenanceApplies++;}
   if(name==='media'&&!mediaDone){mediaDone=true;rotations++;}
   if(name===failed&&first){first=false;throw Error('FIXTURE_STAGE_INTERRUPTED');}
   return name==='provenance'?{ready:true}:undefined;
  };}
  const interrupted=await runCompleteRelease(f.d);assert.equal(interrupted.releaseComplete,false);
  if(['media','prepareProof','deployPrepare'].includes(failed))assert.equal(interrupted.temporaryMediaUnavailable,true);
  assert.equal((await runCompleteRelease(f.d)).releaseComplete,true);assert.equal(provenanceApplies,1);assert.equal(rotations,1);
 }
});


test('a crash between sealed legacy file and completion hash can recover only the exact original null template',()=>{
 const value={contractVersion:'cop-legacy-erasure-provenance-enrollment-v1',binding:{configurationFingerprint:null,guardStoreId:'guard'},rows:[{key:'original'}],evidence:[{digest:'reviewed'}]};
 const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),reviewed=digest(value),sealed={...value,binding:{...value.binding,configurationFingerprint:'a'.repeat(64)}};
 assert.equal(recoverableLegacySeal(sealed,reviewed,'a'.repeat(64)),digest(sealed));
 for(const edit of [v=>{v.rows[0].key='changed';},v=>{v.evidence[0].digest='changed';},v=>{v.binding.guardStoreId='other';}]){const changed=structuredClone(sealed);edit(changed);assert.throws(()=>recoverableLegacySeal(changed,reviewed,'a'.repeat(64)));}
 assert.throws(()=>recoverableLegacySeal(sealed,reviewed,'b'.repeat(64)));
});


test('full whole acceptance requires all actual normal/crash/retry witnesses and the exact reviewed seven-field Messaging source',()=>{
 for(const field of ['initialNormal202Verified','controlledMainCrashVerified','retryNormal202Verified']){const w=whole();w[field]=false;assert.throws(()=>validateReceipts(plan(),w,media(),actual()),/ACTUAL_FULL_MESSAGING_ACCEPTANCE_MISSING/);}
 for(const edit of [w=>{w.messagingSource.profileSha256='0'.repeat(64);},w=>{delete w.messagingSource.helperSha256;},w=>{w.messagingSource.extra=true;}]){const w=whole();edit(w);assert.throws(()=>validateReceipts(plan(),w,media(),actual()),/ACTUAL_FULL_MESSAGING_ACCEPTANCE_MISSING/);}
});

test('control-plan transition reconciles only the fixed active/operation change under the actual guarded tuple',()=>{
 const before=plan(),after={...before,operation:'maintain',expectedActive:{...before.expectedActive,imageId:before.imageId,containerId:'a'.repeat(64),generation:'b'.repeat(32)}},bytes=Buffer.from(JSON.stringify(before)+'\n'),next=Buffer.from(JSON.stringify(after)+'\n'),digest=v=>createHash('sha256').update(v).digest('hex');
 const t={contractVersion:'cop-production-control-plan-transition-v1',previousReleasePlanSha256:digest(bytes),nextReleasePlanSha256:digest(next),nextPlan:after},c={...completion(),phase:'media_closed',releasePlanSha256:digest(bytes)},actualRuntime={...runtime(),active:after.expectedActive,sourceRevision:after.sourceRevision};
 assert.deepEqual(validateControlPlanTransition(t,c,bytes,actualRuntime),after);assert.deepEqual(validateControlPlanTransition(t,c,next,actualRuntime),after);
 for(const edit of [v=>{v.nextPlan.mediaClosureEvidenceSha256='a'.repeat(64);},v=>{v.nextPlan.sourceRevision='b'.repeat(40);},v=>{v.nextPlan.operation='prepare';},v=>{v.command='true';}]){const bad=structuredClone(t);edit(bad);assert.throws(()=>validateControlPlanTransition(bad,c,bytes,actualRuntime));}
 assert.throws(()=>validateControlPlanTransition(t,c,bytes,{...actualRuntime,guardRequired:false}));assert.throws(()=>validateControlPlanTransition(t,c,bytes,{...actualRuntime,active:{...after.expectedActive,containerId:'b'.repeat(64)}}));
});

test('profile-aware fixed readback wrapper parses, locks and mounts only the reviewed existing profile read-only',()=>{const r=spawnSync('python3',['-B','-c',"import sys;compile(sys.stdin.read(),'profile-readback','exec')"],{input:DATABASE_READBACK_HOST_PROGRAM,encoding:'utf8'});assert.equal(r.status,0,'Private diagnostics suppressed');assert.match(DATABASE_READBACK_HOST_PROGRAM,/with storage\.operation_lock\(\)/u);assert.equal((DATABASE_READBACK_HOST_PROGRAM.match(/operator_profile_witness\(st,current,directory,profile,r\.require\)/gu)??[]).length,2);assert.match(DATABASE_READBACK_HOST_PROGRAM,/src='\+witness\['directory'\]\+',dst='\+witness\['directory'\]\+',readonly/u);assert.doesNotMatch(DATABASE_READBACK_HOST_PROGRAM,/src=\/var\/run\/docker\.sock/u);});

test('legacy reuse passes the unchanged original SQL receipt rather than rewritten host completion fields',()=>{const code=LEGACY_HOST_STAGE_PROGRAM.split('# Production entry follows the isolated exact-receipt custody function.')[0]+String.raw`
def require(v,c):
 if not v:raise RuntimeError(c)
raw={'contractVersion':'cop-legacy-erasure-provenance-enrollment-v1','mode':'apply','provenanceComplete':False,'hostPostReadbackRequired':True,'postState':[{'opaque':'original'}]}
wrapper={**raw,'provenanceComplete':True,'hostCustodyConfirmed':True,'servicesChanged':False,'schemaPreparation':{'done':True},'sqlEnrollmentReceipt':raw}
assert sql_enrollment_receipt(wrapper,require) is raw
assert raw['provenanceComplete'] is False and raw['postState']==[{'opaque':'original'}]
for invalid in [raw,{}, {**wrapper,'sqlEnrollmentReceipt':{**raw,'provenanceComplete':True}}]:
 try:sql_enrollment_receipt(invalid,require);raise AssertionError('rewritten receipt accepted')
 except RuntimeError:pass
`;const r=spawnSync('python3',['-B','-c',code],{encoding:'utf8'});assert.equal(r.status,0,'Private diagnostics suppressed');assert.match(LEGACY_HOST_STAGE_PROGRAM,/sqlEnrollmentReceipt:enrolled/u);});

test('fresh paused-host stage parses without any production action and has no alternate unpaused enrollment path',()=>{const run=spawnSync('python3',['-B','-c',"import sys;compile(sys.stdin.read(),'fresh-provenance','exec')"],{input:LEGACY_FRESH_HOST_STAGE_PROGRAM,encoding:'utf8'});assert.equal(run.status,0,'Private diagnostics suppressed');assert.match(LEGACY_FRESH_HOST_STAGE_PROGRAM,/with storage\.operation_lock\(\)/u);assert.match(LEGACY_FRESH_HOST_STAGE_PROGRAM,/confirm_candidate\(summary,terminal,r\.require\)/u);assert.match(LEGACY_FRESH_HOST_STAGE_PROGRAM,/worker\('verify'/u);});
test('fresh candidate requires exact fixed policy, source, binding, paused witness and actual zero unresolved',()=>{const code=LEGACY_FRESH_HOST_STAGE_PROGRAM.split('# Production entry follows the isolated candidate/custody checks.')[0]+String.raw`
import copy
def require(v,c):
 if not v:raise RuntimeError(c)
def hash(v):return hashlib.sha256(json.dumps(v,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
policy={'planId':'fixed','binding':{'guard':'fixed'},'writer':{'containerId':'fixed'},'evidence':[{'id':'fixed'}],'issuer':'https://issuer.invalid/realms/cop'}
witness={'sourceHelperSha256':'a'*64,'reviewedPolicySha256':hash(policy)}
candidate={'contractVersion':'cop-legacy-erasure-provenance-enrollment-v1',**policy,'rows':[{'fullRowSha256':'b'*64}]}
summary={'contractVersion':'cop-legacy-erasure-candidate-summary-v1','candidateSha256':hash(candidate),'policySha256':hash(policy),'sourceHelperSha256':witness['sourceHelperSha256'],'bindingSha256':'d'*64,'hostWriterWitnessSha256':hash(witness),'totalRows':1,'countsByKind':{'session':1},'oidcRows':1,'nonAccountRows':0,'sessionRows':1,'unresolved':0}
result={'candidatePlan':candidate,'summary':summary}
assert candidate_review(result,policy,hash(policy),witness,'d'*64,require)==(candidate,summary)
for change in ('rows','policy','source','binding','witness','unresolved','bool','counts'):
 bad=copy.deepcopy(result)
 if change=='rows':bad['candidatePlan']['rows'][0]['fullRowSha256']='c'*64
 elif change=='policy':bad['candidatePlan']['writer']['containerId']='foreign'
 elif change=='unresolved':bad['summary']['unresolved']=1
 elif change=='bool':bad['summary']['unresolved']=False
 elif change=='counts':bad['summary']['totalRows']=2
 else:bad['summary'][{'source':'sourceHelperSha256','binding':'bindingSha256','witness':'hostWriterWitnessSha256'}[change]]='c'*64
 try:candidate_review(bad,policy,hash(policy),witness,'d'*64,require);raise AssertionError('unproven candidate accepted')
 except RuntimeError:pass
`;const run=spawnSync('python3',['-B','-c',code],{encoding:'utf8'});assert.equal(run.status,0,'Private diagnostics suppressed');});
test('Root terminal approval requires exactly the displayed candidate digest and never prints row data',()=>{const code=LEGACY_FRESH_HOST_STAGE_PROGRAM.split('# Production entry follows the isolated candidate/custody checks.')[0]+String.raw`
def require(v,c):
 if not v:raise RuntimeError(c)
class Terminal:
 def __init__(self,response):self.response=response;self.output=''
 def write(self,value):self.output+=value
 def flush(self):pass
 def readline(self,limit):return self.response[:limit]
summary={'candidateSha256':'a'*64,'totalRows':182,'oidcRows':176,'nonAccountRows':6,'sessionRows':8}
t=Terminal('APPLY '+'a'*64+'\n');confirm_candidate(summary,t,require);assert '182' in t.output and 'a'*64 in t.output and '\nCandidate SHA256:' in t.output and 'subject' not in t.output
for response in ('yes\n','APPLY '+'b'*64+'\n','APPLY '+'a'*64+' extra\n',''):
 try:confirm_candidate(summary,Terminal(response),require);raise AssertionError('wrong review accepted')
 except RuntimeError:pass
`;const run=spawnSync('python3',['-B','-c',code],{encoding:'utf8'});assert.equal(run.status,0,'Private diagnostics suppressed');});

test('pending original SQL receipt survives an interrupted verifier and completion can replace only its exact private bytes',()=>{const code=LEGACY_HOST_STAGE_PROGRAM.split('# Production entry follows the isolated exact-receipt custody function.')[0]+String.raw`
import tempfile
from unittest import mock
from types import SimpleNamespace
class Root:
 @staticmethod
 def require(v,c):
  if not v:raise RuntimeError(c)
 @staticmethod
 def private_read(path,uid,limit):
  fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
  try:
   info=os.fstat(fd);Root.require(stat.S_ISREG(info.st_mode) and info.st_nlink==1 and stat.S_IMODE(info.st_mode)==0o600,'custody');return os.read(fd,limit+1)
  finally:os.close(fd)
 class Store:
  @staticmethod
  def sync(path):
   fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
   try:os.fsync(fd)
   finally:os.close(fd)
with tempfile.TemporaryDirectory() as name:
 private=pathlib.Path(name);private.chmod(0o700);actual_lstat=pathlib.Path.lstat
 def reviewed_root_lstat(path):
  info=actual_lstat(path)
  return SimpleNamespace(st_uid=0,st_mode=info.st_mode) if path==private else info
 raw={'contractVersion':'cop-legacy-erasure-provenance-enrollment-v1','mode':'apply','provenanceComplete':False,'hostPostReadbackRequired':True,'postState':[{'nonceDependentCiphertextSha256':'a'*64}]}
 pending={'state':'pending_readback','sqlEnrollmentReceipt':raw,'provenanceComplete':False}
 with mock.patch.object(pathlib.Path,'lstat',reviewed_root_lstat),mock.patch.object(os,'fchown',lambda *_:None):
  before=write_legacy_receipt(Root,private,pending)
  # A verifier outage leaves exact raw proof; recovery never calls apply.
  recovered=json.loads(Root.private_read(private/'legacy-provenance-receipt.json',0,1048576));assert recovered['provenanceComplete'] is False and sql_enrollment_receipt(recovered,Root.require)==raw
  complete={**pending,'provenanceComplete':True,'verified':True};after=write_legacy_receipt(Root,private,complete,before);assert json.loads(after)['sqlEnrollmentReceipt']==raw
  foreign=b'{"foreign":"preserved"}';(private/'legacy-provenance-receipt.json').write_bytes(foreign)
  try:write_legacy_receipt(Root,private,complete,after);raise AssertionError('changed receipt overwritten')
  except RuntimeError:pass
  assert (private/'legacy-provenance-receipt.json').read_bytes()==foreign
  assert not list(private.glob('.legacy-provenance-receipt.json.readback-*'))
`;const run=spawnSync('python3',['-B','-c',code],{encoding:'utf8'});assert.equal(run.status,0,'Private diagnostics suppressed');});

test('paused recovery permits only the exact original raw receipt, reviewed process and profile and never authorizes apply',()=>{const syntax=spawnSync('python3',['-B','-c',"import sys;compile(sys.stdin.read(),'paused-status','exec')"],{input:LEGACY_PAUSED_STATUS_PROGRAM,encoding:'utf8'});assert.equal(syntax.status,0,'Private diagnostics suppressed');const code=LEGACY_PAUSED_STATUS_PROGRAM.split('# Production entry follows the isolated paused-proof checks.')[0]+String.raw`
import copy
def require(v,c):
 if not v:raise RuntimeError(c)
def digest(v):return hashlib.sha256(json.dumps(v,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
current={'containerId':'cid','imageId':'old','generation':'cas','profileId':'profile','profileGeneration':'profile'};plan={'rows':['frozen']};policy={'writer':'fixed'};w={'plan':{'containerId':'cid','pid':100,'startedAt':'fixed','profile':'profile'},'policy':{'containerId':'cid','pid':100,'startedAt':'fixed','profile':'profile'}}
p={'expectedActive':copy.deepcopy(current),'_legacySha256':digest(plan),'_legacyPolicySha256':digest(policy),'sourceRevision':'source','imageId':'candidate','fileSha256':{'scripts/account-safety/enroll-legacy-erasure-provenance.mjs':'a'*64}}
c={'contractVersion':'cop-production-erasure-completion-v2','phase':'provenance','legacyProvenancePlanSha256':p['_legacySha256'],'legacyProvenancePolicySha256':p['_legacyPolicySha256']}
raw={'contractVersion':'cop-legacy-erasure-provenance-enrollment-v1','mode':'apply','provenanceComplete':False,'hostPostReadbackRequired':True,'planSha256':p['_legacySha256'],'sourceHelperSha256':'a'*64,'bindingSha256':'b'*64,'hostWriterWitnessSha256':digest(w['plan'])}
review={'contractVersion':'cop-legacy-provenance-root-review-v1','policySha256':p['_legacyPolicySha256'],'candidateSha256':p['_legacySha256'],'sourceRevision':p['sourceRevision'],'imageId':p['imageId'],'expectedActive':copy.deepcopy(current),'policyWriterWitnessSha256':digest(w['policy']),'bindingSha256':raw['bindingSha256']}
wrapper={'contractVersion':'cop-legacy-provenance-host-receipt-v1','state':'pending_readback','provenanceComplete':False,'hostCustodyConfirmed':False,'sqlEnrollmentReceipt':raw,'rootReview':review}
args=[p,current,{},c,plan,policy,wrapper,review,w]
assert paused_legacy_proof(*args,require) is True
for change in ('cid','profile','pid','rootreview','unknown','raw','source','guard','plan'):
 a=copy.deepcopy(args)
 if change=='cid':a[1]['containerId']='foreign'
 elif change=='profile':a[1]['profileGeneration']='foreign'
 elif change=='pid':a[8]['plan']['pid']=101
 elif change=='rootreview':a[7]['candidateSha256']='c'*64
 elif change=='unknown':a[6]['state']='unknown'
 elif change=='raw':a[6].pop('sqlEnrollmentReceipt')
 elif change=='source':a[0]['fileSha256']['scripts/account-safety/enroll-legacy-erasure-provenance.mjs']='c'*64
 elif change=='guard':a[2]['COP_ACCOUNT_SAFETY_GUARD_REQUIRED']='true'
 elif change=='plan':a[4]['rows']=['changed']
 try:paused_legacy_proof(*a,require);raise AssertionError('unowned paused recovery accepted')
 except (RuntimeError,KeyError):pass
`;const run=spawnSync('python3',['-B','-c',code],{encoding:'utf8'});assert.equal(run.status,0,'Private diagnostics suppressed');assert.doesNotMatch(LEGACY_PAUSED_STATUS_PROGRAM,/docker','unpause|worker\('apply'/u);});
test('an unresolved paused legacy verifier reports actual API downtime and never enables or claims completion',async()=>{const error=Object.assign(Error('LEGACY_READBACK_PENDING'),{temporaryApiUnavailable:true});const f=orchestration({provenance:async()=>{throw error;}});const result=await runCompleteRelease(f.d);assert.equal(result.releaseComplete,false);assert.equal(result.temporaryApiUnavailable,true);assert.equal(result.erasureEnabled,false);assert(!f.calls.includes('enable'));const g=orchestration({preflight:async()=>({ready:false,code:'LEGACY_PENDING_PROOF_UNPROVEN',temporaryApiUnavailable:true})});assert.equal((await runCompleteRelease(g.d)).temporaryApiUnavailable,true);});
