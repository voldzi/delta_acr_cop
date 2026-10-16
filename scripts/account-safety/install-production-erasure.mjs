#!/usr/bin/env node
/** Fixed COP Root preflight/proof producer. No HTTP endpoint or privileged daemon.
 * Credential preparation uses the existing bounded provisioner in a pinned
 * Node24 container; passwords are read only from its terminal into RAM. */
import {createHash,randomBytes,randomUUID as cryptoUuid} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,readFileSync,readdirSync,lstatSync,writeFileSync,fsyncSync,fchownSync,fchmodSync,renameSync,unlinkSync,existsSync} from 'node:fs';
import {hostname} from 'node:os';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import {loadOperatorEnvironment,OPERATOR_PROFILE_HOST_CHECK} from './operator-profile-environment.mjs';
import {verifyConfirmationRecovery,publicConfirmationRecoveryEvidence} from './whole-confirmation-evidence.mjs';
import {validateAdditionalActorsEvidence} from './whole-additional-actors.mjs';
const ROOT='/srv/cop', DIR=ROOT+'/runtime/account-erasure-install', PLAN=DIR+'/release-plan.json',SELF=ROOT+'/scripts/account-safety/install-production-erasure.mjs',COMPLETION=DIR+'/completion-plan.json',CONFIGURATION=DIR+'/final-configuration.json',LEGACY=DIR+'/legacy-provenance-plan.json',POLICY=DIR+'/legacy-provenance-policy.json',READINESS=DIR+'/production-owner-readiness.json';
export const REQUIRED_FILES=Object.freeze(['scripts/account-safety/install-production-erasure.mjs','scripts/account-safety/install-media-upload-closure.mjs','scripts/account-safety/image-profile-probe.mjs','scripts/account-safety/operator-profile-environment.mjs','scripts/account-safety/enroll-legacy-erasure-provenance.mjs','scripts/account-safety/legacy-enrollment-receipt.mjs','scripts/account-safety/whole-confirmation-evidence.mjs','scripts/account-safety/whole-additional-actors.mjs','scripts/account-safety/prepare-business-erasure-schema.mjs','scripts/account-safety/provision-database-v2.mjs',
 'scripts/account-safety/010_database_safety_v2.sql','scripts/account-safety/011_media_upload_closure.sql',
 'apps/cop-api/src/legacy-erasure-schema.ts','apps/cop-api/src/legacy-nonaccount-provenance.ts',
 'scripts/keycloak/install-erasure-client.mjs','scripts/keycloak/provision-erasure-client.mjs','scripts/cop-api-runtime.py','scripts/cop-storage.py','scripts/cop-edge-release.py','scripts/deploy-production.sh']);
export const EXPECTED_MESSAGING_SOURCE=Object.freeze({scopeSha256:'a5591d5c4258f0eec194b50e1a56d203f7360a469dcc556c46201ed77fc9d271',profileSha256:'1cbeaad91663bf740a58bd8bbce54d15d9e592f30dd3d3b37d3dfa602cb1ae6b',sourceArchiveSha256:'0aed0b1bfa86777c68e092910fa2b71b636467e7a7e8f4accc5c8545c31fe189',providerSha256:'8f3e6bc6437f34b4271c02a654d25c1af52e6ff080ab7a061288104d11b925b7',clientSha256:'20046af0e252a177f35a1389eabf5cb703bc31ccfd04027d6f95462bd1d85159',helperSha256:'ffcc7b24eba088f16bb71b5f8b68258a151b440f2cd76d9616bfd11bdffd188a',sql005Sha256:'f129aad7e31cbd53dfe948c5b7a9a9432a600fe6535988de5214805b8f32913b'});
const OWNERS=['keycloak','cop_sessions_profiles','cop_devices','messaging_matrix','voice_livekit','cop_content_media','mobility_dispatch','sim_measurements','ai_router','moderation_audit','backup_restore'].sort();
const hex=/^[a-f0-9]{64}$/u, image=/^sha256:[a-f0-9]{64}$/u, revision=/^[a-f0-9]{40}$/u;
const need=(v,code='PRODUCTION_ERASURE_UNPROVEN')=>{if(!v)throw Error(code);};
const sha=v=>createHash('sha256').update(v).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function validatePlan(p){
 need(p&&typeof p==='object'&&!Array.isArray(p)&&same(Object.keys(p).sort(),['contractVersion','sourceRevision','imageId','expectedActive','fileSha256','wholeAcceptancePath','wholeAcceptanceSha256','mediaClosureEvidencePath','mediaClosureEvidenceSha256','databaseEnrollmentManifestPath','operation'].sort()),'INSTALL_PLAN_SCHEMA');
 need(p.contractVersion==='cop-production-erasure-install-v1'&&revision.test(p.sourceRevision)&&image.test(p.imageId)&&['prepare','enable','pause','maintain'].includes(p.operation),'INSTALL_PLAN_IDENTITY');
 need(p.fileSha256&&same(Object.keys(p.fileSha256).sort(),[...REQUIRED_FILES].sort())&&Object.values(p.fileSha256).every(v=>typeof v==='string'&&hex.test(v)),'INSTALL_SOURCE_PINS');
 const a=p.expectedActive;
 need(a&&same(Object.keys(a).sort(),['contractVersion','generation','releaseId','profileId','profileGeneration','imageId','containerId'].sort())&&a.contractVersion==='cop-api-runtime-active-v1'&&/^[a-f0-9]{32}$/u.test(a.generation)&&hex.test(a.containerId)&&image.test(a.imageId)&&a.profileId===a.profileGeneration&&/^[a-f0-9-]{36}$/u.test(a.profileGeneration)&&/^release-[a-f0-9]{32}$/u.test(a.releaseId),'INSTALL_ACTIVE_BINDING');
 for(const key of ['wholeAcceptance','mediaClosureEvidence'])need(new RegExp('^'+ROOT+'/runtime/account-erasure-install/[a-z0-9-]+\\.json$','u').test(p[key+'Path'])&&hex.test(p[key+'Sha256']),'INSTALL_RECEIPT_REFERENCE');
 need(p.databaseEnrollmentManifestPath===ROOT+'/runtime/account-erasure-install/database-enrollment.json','INSTALL_DATABASE_MANIFEST');
 return p;
}
export function compiledApiClosure(directory){
 const files=[];
 const visit=(path,prefix='')=>{for(const entry of readdirSync(path,{withFileTypes:true})){const relative=prefix+entry.name,absolute=path+'/'+entry.name;need(!entry.isSymbolicLink(),'INSTALL_COMPILED_SYMLINK');if(entry.isDirectory())visit(absolute,relative+'/');else if(entry.isFile()&&/\.(?:js|json)$/u.test(entry.name)){need(lstatSync(absolute).isFile(),'INSTALL_COMPILED_CHANGED');files.push(['apps/cop-api/dist/'+relative,sha(readFileSync(absolute))]);}}};
 visit(directory);need(files.length>0,'INSTALL_COMPILED_CLOSURE_MISSING');files.sort(([a],[b])=>a<b?-1:a>b?1:0);return sha(files.map(([name,digest])=>name+'\0'+digest).join('\n'));
}
export const RUNTIME_RESOURCES=Object.freeze(['docs/api/shared-mobility-v1.openapi.json','docs/api/schemas/mapped-road-profile-v1.schemas.json','docs/api/schemas/road-trip-v1.schemas.json','docs/api/schemas/known-road-closures-v1.schema.json']);
export function compiledRuntimeClosures(root){
 const digest=files=>sha([...files].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,value])=>name+'\0'+value).join('\n'));
 const resources=RUNTIME_RESOURCES.map(name=>{const path=root+'/'+name;need(lstatSync(path).isFile()&&!lstatSync(path).isSymbolicLink(),'INSTALL_RUNTIME_RESOURCE_INVALID');return [name,sha(readFileSync(path))];});
 const packages=new Map();for(const entry of readdirSync(root+'/packages',{withFileTypes:true})){if(!entry.isDirectory())continue;const path='packages/'+entry.name+'/package.json';const value=JSON.parse(readFileSync(root+'/'+path));need(typeof value.name==='string'&&!packages.has(value.name),'INSTALL_WORKSPACE_NAME_INVALID');packages.set(value.name,{path,value,directory:'packages/'+entry.name});}
 const api=JSON.parse(readFileSync(root+'/apps/cop-api/package.json')),queue=Object.keys(api.dependencies??{}).filter(name=>name.startsWith('@cop/')),seen=new Set(),files=new Map();
 const visit=(path,name)=>{for(const entry of readdirSync(path,{withFileTypes:true})){need(!entry.isSymbolicLink(),'INSTALL_WORKSPACE_SYMLINK');if(entry.isDirectory())visit(path+'/'+entry.name,name+'/'+entry.name);else if(entry.isFile()&&/\.(?:js|json)$/u.test(entry.name))files.set(name+'/'+entry.name,sha(readFileSync(path+'/'+entry.name)));}};
 while(queue.length){const name=queue.pop();if(seen.has(name))continue;seen.add(name);const selected=packages.get(name);need(selected,'INSTALL_WORKSPACE_DEPENDENCY_MISSING');files.set(selected.path,sha(readFileSync(root+'/'+selected.path)));visit(root+'/'+selected.directory+'/dist',selected.directory+'/dist');queue.push(...Object.keys(selected.value.dependencies??{}).filter(name=>name.startsWith('@cop/')));}
 need(files.size>0,'INSTALL_WORKSPACE_CLOSURE_MISSING');return {compiledApiClosureSha256:compiledApiClosure(root+'/apps/cop-api/dist'),runtimeResourceClosureSha256:digest(resources),compiledWorkspaceClosureSha256:digest(files)};
}
const candidateClosureCode="const fs=require('fs'),c=require('crypto');const p=JSON.parse(fs.readFileSync(0,'utf8'));if(Number(process.versions.node.split('.')[0])!==24)process.exit(1);for(const[k,h]of Object.entries(p.fileSha256)){if(k==='scripts/deploy-production.sh'||k==='scripts/cop-storage.py')continue;if(c.createHash('sha256').update(fs.readFileSync('/app/'+k)).digest('hex')!==h)process.exit(1)}if(require('/app/apps/cop-api/node_modules/pg/package.json').version!=='8.23.1')process.exit(1);import('/app/scripts/account-safety/install-production-erasure.mjs').then(m=>process.stdout.write(JSON.stringify(m.compiledRuntimeClosures('/app')))).catch(()=>process.exit(1))";
export function checkedCandidateClosure(plan){
 return JSON.parse(command(['docker','--host','unix:///var/run/docker.sock','run','--rm','--pull','never','-i','--network','none','--read-only','--cap-drop','ALL','--entrypoint','node',plan.imageId,'-e',candidateClosureCode],JSON.stringify(plan)).trim());
}
export function validateWholeReceipt(plan,whole,actualCompiledClosure){
 need(whole&&whole.messagingSource&&same(Object.keys(whole.messagingSource).sort(),Object.keys(EXPECTED_MESSAGING_SOURCE).sort())&&Object.entries(EXPECTED_MESSAGING_SOURCE).every(([k,v])=>whole.messagingSource[k]===v),'ACTUAL_FULL_MESSAGING_ACCEPTANCE_MISSING');
 const evidence=whole.confirmationEvidence;need(evidence&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(evidence.operationId??'')&&typeof evidence.requestedAt==='string'&&Number.isFinite(Date.parse(evidence.requestedAt))&&new Date(evidence.requestedAt).toISOString()===evidence.requestedAt,'ACTUAL_WHOLE_CONFIRMATION_SCOPE_MISSING');
 const confirmation=verifyConfirmationRecovery(evidence);need(same(publicConfirmationRecoveryEvidence(evidence),evidence)&&sha(JSON.stringify(evidence.initial))===evidence.initialAttemptSha256&&['initialHttpStatus','initialNormal202Verified','recoveryAccepted202Verified','controlledMainCrashVerified','retryNormal202Verified'].every(k=>whole[k]===confirmation[k])&&confirmation.controlledMainCrashVerified===true&&confirmation.retryNormal202Verified===true&&Date.parse(evidence.requestedAt)<=Date.parse(evidence.initial.checkedAt),'ACTUAL_WHOLE_CONFIRMATION_CHAIN_MISMATCH');
 const source=evidence.initial.testedSource;need(source&&['sourceRevision','sourceWorkingTreeDirty','compiledApiClosureSha256','runtimeResourceClosureSha256','compiledWorkspaceClosureSha256','nodeBaseImageId'].every(k=>source[k]===whole[k]),'ACTUAL_WHOLE_CONFIRMATION_SOURCE_MISMATCH');
 need(whole?.contractVersion==='cop-whole-erasure-acceptance-v1'&&whole.phase==='whole_account_acceptance_complete'&&whole.wholeAccountAccepted===true&&whole.productionChanged===false&&whole.twoRealKeycloakActors===true&&revision.test(whole.sourceRevision)&&typeof whole.sourceWorkingTreeDirty==='boolean'&&image.test(whole.nodeBaseImageId)&&actualCompiledClosure&&same(Object.keys(actualCompiledClosure).sort(),['compiledApiClosureSha256','compiledWorkspaceClosureSha256','runtimeResourceClosureSha256'])&&['compiledApiClosureSha256','compiledWorkspaceClosureSha256','runtimeResourceClosureSha256'].every(key=>hex.test(whole[key])&&whole[key]===actualCompiledClosure[key])&&Array.isArray(whole.actualOwners)&&same([...whole.actualOwners].sort(),OWNERS)&&hex.test(whole.providerCallMetadataDigest)&&revision.test(plan.sourceRevision),'ACTUAL_WHOLE_ACCEPTANCE_MISSING');
 validateAdditionalActorsEvidence(whole.additionalActorsEvidence,{whole,expectedOwners:OWNERS,helperSha256:plan.fileSha256?.['scripts/account-safety/whole-additional-actors.mjs']});
 return true;
}
export function validateReceipts(plan,whole,media,actualCompiledClosure){
 validateWholeReceipt(plan,whole,actualCompiledClosure);
 need(media?.contractVersion==='cop-media-upload-closure-evidence-v1'&&media.production===true&&media.endpoint==='http://storage.home.cz:8333'&&media.bucket==='cop-community-media'&&image.test(media.providerImageId)&&['legacySlowBodyTerminated','oldSignatureDenied','newCredentialWorks','otherIdentityAndBucketPreserved'].every(k=>media[k]===true),'ACTUAL_MEDIA_CLOSURE_MISSING');
 const dates=['providerStoppedAt','providerRestartedAt','oldCredentialDeniedAt'].map(k=>Date.parse(media[k]));
 need(dates.every(Number.isFinite)&&dates[1]>dates[0]&&dates[2]>=dates[1],'MEDIA_CLOSURE_ORDER');
 return true;
}
function file(path,root=false){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const s=fstatSync(fd);need(s.isFile()&&s.nlink===1&&s.size<=1048576&&(!root||(s.uid===0&&(s.mode&0o777)===0o600)),'INSTALL_FILE_CUSTODY');const b=readFileSync(fd);const t=fstatSync(fd);need(s.ino===t.ino&&s.size===t.size&&s.mtimeMs===t.mtimeMs&&s.ctimeMs===t.ctimeMs,'INSTALL_FILE_CHANGED');return b;}finally{closeSync(fd);}
}
function command(args,input){
 const r=spawnSync(args[0],args.slice(1),{input,encoding:'utf8',maxBuffer:1048576,timeout:60000,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C',PYTHONDONTWRITEBYTECODE:'1'}});
 need(r.status===0&&!r.error,'INSTALL_READBACK_FAILED');return r.stdout;
}
function checkedPlan(path){need(path===PLAN,'INSTALL_FIXED_PLAN_PATH');const plan=validatePlan(JSON.parse(file(path,true)));for(const[k,v]of Object.entries(plan.fileSha256))need(sha(file(ROOT+'/'+k))===v,'INSTALL_SOURCE_CHANGED');return plan;}
const pythonProof=String.raw`
import hashlib,json,os,pathlib,sys,tempfile,types,uuid
sys.dont_write_bytecode=True
p=json.loads(sys.stdin.read()); base=pathlib.Path('/srv/cop')
def load_checked(name,relative):
 raw=(base/relative).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=p['fileSha256'][relative]:raise RuntimeError('install_source_changed')
 module=types.ModuleType(name);module.__file__=str(base/relative)
 exec(compile(raw,str(base/relative),'exec'),module.__dict__)
 return module
r=load_checked('r','scripts/cop-api-runtime.py');storage=load_checked('s','scripts/cop-storage.py')
with storage.operation_lock():
 r.require(r.environment_metadata(base/'.env',1000)=={k:int(v) for k,v in p['_environmentMetadata'].items()},'install_env_changed_since_readback')
 st=r.Store(uid=1000,guard=storage.preflight); current,old_dir,old,profile=st.active()
 r.require(current==p['expectedActive'],'install_active_changed')
 target={'kind':'candidate','releaseId':'release-'+uuid.uuid4().hex,'imageId':p['imageId'],'sourceRevision':p['sourceRevision'],'profileId':current['profileId'],'profileGeneration':current['profileGeneration'],'previousReleaseId':current['releaseId']}
 att=st.protected_root/current['profileId']/('attestation-'+p['imageId'][7:]+'.json')
 _,contract,_,_=st.attestation(att,target);r.require(contract==profile['driverContract'],'install_profile_changed')
 st.docker.image(p['imageId'],revision=p['sourceRevision']);st.check_mounts(target,profile)
 with tempfile.TemporaryDirectory(prefix='erasure-config-review-',dir='/srv/x5-production/staging/cop') as name:
  d=pathlib.Path(name);(d/'compose').mkdir()
  hashes={}
  for leaf in r.FILES:
   raw=(base/leaf).read_bytes();hashes[leaf]=r.sha(raw);(d/'compose'/leaf).write_bytes(raw)
  (d/'image.env').write_bytes(st.image_env(target,profile['mode']));(d/'compose.runtime.yml').write_bytes(r.overlay_bytes(target,profile['mode']))
  api=st.docker.config(d,profile['directory'])['services']['cop-api']; actual=st.docker.current(old_dir)
  r.require(actual['Id']==current['containerId'] and actual['Image']==current['imageId'],'install_container_changed')
  image_config=json.loads(st.docker.run(['docker','image','inspect',p['imageId']]))[0]['Config']
  before=dict(v.split('=',1) for v in actual['Config'].get('Env',[]) if '=' in v)
  after=dict(v.split('=',1) for v in image_config.get('Env',[]) if '=' in v);after.update(api.get('environment',{}))
  changed=sorted(k for k in set(before)|set(after) if (k in before)!=(k in after) or before.get(k)!=after.get(k))
  r.require(set(changed)<=r.ERASURE_CONFIG_KEYS,'install_non_erasure_config_changed')
  transition=str(uuid.uuid4());proof={'contractVersion':'cop-api-account-erasure-config-v1','transitionId':transition,'operation':p['operation'],'previous':current,'target':{k:target[k] for k in ('imageId','sourceRevision','profileGeneration')},'changedKeys':changed,'environmentMetadata':r.environment_metadata(base/'.env',1000),'composeHashes':hashes,'ownerAcceptance':True,'checks':{k:True for k in r.ERASURE_PROOF_CHECKS}}
  r.erasure_environment_changes(before,after,proof)
  edge=st.docker.erasure_edge_credential(d,after) if p['operation']=='prepare' else None
  st.docker.account_erasure_scope={'containerId':current['containerId'],'changedKeys':changed,'edgeContainerId':edge}
  try:st.docker.live(old_dir,old,profile,require_label=old['kind']!='accepted-baseline');st.docker.preserve(d,profile['directory'],actual);st.docker.unchanged(old_dir,actual)
  finally:st.docker.account_erasure_scope=None
  r.require(r.environment_metadata(base/'.env',1000)==proof['environmentMetadata'],'install_env_changed')
  if edge:r.require(st.docker.peers(d)['cop-edge']==edge,'install_edge_changed')
  if p['_write']:
   path=st.protected_root/current['profileId']/('account-erasure-'+transition+'.json')
   fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o640)
   try:
    os.fchown(fd,0,1000);os.fchmod(fd,0o640);view=memoryview(r.encoded(proof))
    while view:view=view[os.write(fd,view):]
    os.fsync(fd)
   finally:os.close(fd)
   st.sync(path.parent);st.erasure_config_proof(path,target)
   print(json.dumps({'phase':'root_config_proof_written','proofPath':str(path),'sourceRevision':p['sourceRevision'],'imageId':p['imageId'],'erasureEnabled':p['operation']=='enable','servicesChanged':False}))
  else:print(json.dumps({'phase':'production_plan_checked','sourceRevision':p['sourceRevision'],'imageId':p['imageId'],'servicesChanged':False,'proofWritten':False}))
`;
export const DATABASE_HOST_STAGE_PROGRAM=String.raw`${OPERATOR_PROFILE_HOST_CHECK}
import hashlib,json,os,pathlib,re,stat,subprocess,sys,types,uuid
sys.dont_write_bytecode=True

PREPARATION_ENV_KEYS=frozenset({'COP_ACCOUNT_ERASURE_SECRET','COP_ACCOUNT_SAFETY_AUTHORITY_MODE','COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL','COP_ACCOUNT_SAFETY_GUARD_STORE_ID','COP_ACCOUNT_SAFETY_INCARNATION_ID','COP_ACCOUNT_SAFETY_STORE_ID','COP_KEYCLOAK_ERASURE_CLIENT_ID','COP_KEYCLOAK_ERASURE_CLIENT_SECRET','COP_KEYCLOAK_COP_SCOPE_AUTHORITY_ACCEPTED'})
def preparation_environment_changes(actual,desired,require):
 changed={key for key in set(actual)|set(desired) if (key in actual)!=(key in desired) or actual.get(key)!=desired.get(key)}
 require(changed<=PREPARATION_ENV_KEYS,'preparation_environment_drift')
 require(all(actual.get(key,'false')=='false' and desired.get(key,'false')=='false' for key in ('COP_ACCOUNT_ERASURE_ENABLED','COP_ACCOUNT_SAFETY_GUARD_REQUIRED','COP_KEYCLOAK_COP_SCOPE_AUTHORITY_ACCEPTED')),'preparation_intake_must_remain_disabled')
 return changed

def sealed_legacy_template(template,expected_digest,actual_binding,require):
 require(hashlib.sha256(json.dumps(template,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()==expected_digest,'legacy_template_changed')
 require(template.get('contractVersion')=='cop-legacy-erasure-provenance-policy-v1' and 'rows' not in template and isinstance(template.get('evidence'),list) and bool(template['evidence']),'legacy_template_scope_invalid')
 binding=template.get('binding',{});require(set(binding)==set(actual_binding) and all(binding.get(k)==v for k,v in actual_binding.items() if k!='configurationFingerprint'),'legacy_template_binding_changed')
 require(re.fullmatch(r'[a-f0-9]{64}',actual_binding.get('configurationFingerprint','')) is not None and binding.get('configurationFingerprint') in (None,actual_binding['configurationFingerprint']),'legacy_template_fingerprint_changed')
 return {**template,'binding':{**binding,'configurationFingerprint':actual_binding['configurationFingerprint']}}

def coordinate_database_stage(p,storage,make_store,launch,verify_pins,require,verify_runtime=lambda *args:None,finish=lambda result:result):
 with storage.operation_lock():
  verify_pins();st=make_store();current,old_dir,old,profile=st.active()
  require(current==p['expectedActive'],'database_stage_active_changed')
  witnessed=st.docker.current(old_dir)
  require(witnessed['Id']==current['containerId'] and witnessed['Image']==current['imageId'] and witnessed['State']['Running'] and not witnessed['State'].get('Paused') and witnessed['State'].get('Pid',0)>0,'database_stage_container_changed')
  verify_runtime(st,old_dir,profile,witnessed)
  def unchanged():
   verify_pins();require(st.pointer()==p['expectedActive'],'database_stage_active_changed');st.docker.unchanged(old_dir,witnessed)
   actual=st.docker.current(old_dir)
   require(actual['State']['Running'] and not actual['State'].get('Paused') and actual['State'].get('Pid',0)==witnessed['State']['Pid'] and actual['State']['StartedAt']==witnessed['State']['StartedAt'],'database_stage_container_restarted')
   verify_runtime(st,old_dir,profile,witnessed)
  unchanged()
  try:
   result=launch();unchanged();return finish(result)
  finally:unchanged()

# Production entry follows the isolated host-CAS test function.
p=json.loads(sys.stdin.read());base=pathlib.Path('/srv/cop');plan=base/'runtime/account-erasure-install/release-plan.json'
def verify_pins():
 if hashlib.sha256(plan.read_bytes()).hexdigest()!=p['_planSha256']:raise RuntimeError('database_stage_plan_changed')
 for relative,digest in p['fileSha256'].items():
  if hashlib.sha256((base/relative).read_bytes()).hexdigest()!=digest:raise RuntimeError('database_stage_source_changed')
def load_checked(name,relative):
 raw=(base/relative).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=p['fileSha256'][relative]:raise RuntimeError('install_source_changed')
 m=types.ModuleType(name);m.__file__=str(base/relative);exec(compile(raw,m.__file__,'exec'),m.__dict__);return m
r=load_checked('runtime','scripts/cop-api-runtime.py');storage=load_checked('storage','scripts/cop-storage.py')
profile_witnesses={}
def verify_runtime(st,directory,profile,current):
 witness=operator_profile_witness(st,p['expectedActive'],directory,profile,r.require)
 r.require(profile_witnesses.setdefault('active',witness)==witness,'operator_profile_metadata_changed')
 resolved=st.docker.config(directory,profile['directory']);r.network_scope(resolved);desired=resolved['services']['cop-api']
 image_config=json.loads(st.docker.run(['docker','image','inspect',current['Image']]))[0]['Config']
 before=dict(v.split('=',1) for v in current['Config'].get('Env',[]) if '=' in v)
 after=dict(v.split('=',1) for v in image_config.get('Env',[]) if '=' in v);after.update(desired.get('environment',{}))
 preparation_environment_changes(before,after,r.require);r.runtime_parity(current,desired,image_config)
 r.require({key:value['NetworkID'] for key,value in current['NetworkSettings']['Networks'].items()}==r.NETWORKS,'preparation_network_drift')
def launch():
 r.require(p['_workerMode'] in ('--database-worker-check','--database-worker-apply','--keycloak-apply'),'preparation_fixed_worker')
 args=['docker','--host','unix:///var/run/docker.sock','run','--rm','--pull','never','--log-driver','none','-it','--hostname','docker','--network','host','--read-only','--user','0:0','--cap-drop','ALL','--cap-add','DAC_OVERRIDE','--cap-add','CHOWN','--cap-add','FOWNER','--security-opt','no-new-privileges','--pids-limit','64','--memory','256m','--mount','type=bind,src=/srv/cop,dst=/srv/cop','--mount','type=bind,src=/etc/vcode-cop-pgbouncer/postgres-ca.crt,dst=/etc/vcode-cop-pgbouncer/postgres-ca.crt,readonly','--mount','type=bind,src=/etc/vcode-cop-api-runtime/'+p['expectedActive']['profileGeneration']+',dst=/etc/vcode-cop-api-runtime/'+p['expectedActive']['profileGeneration']+',readonly','--entrypoint','node',p['imageId']]
 args+=['/app/scripts/keycloak/install-erasure-client.mjs','--apply'] if p['_workerMode']=='--keycloak-apply' else ['/app/scripts/account-safety/install-production-erasure.mjs',p['_workerMode'],str(plan)]
 # Only this process's controlling terminal carries the interactive password.
 # No password or generic command is accepted through the public plan or argv.
 if '_password' in p:
  r.require(p['_workerMode'] in ('--database-worker-check','--database-worker-apply') and isinstance(p['_password'],str) and 0<len(p['_password'])<=4096,'database_private_input_scope')
  args[args.index('-it')]='-i';args[-2]=p['_workerMode'].replace('--database-worker-','--database-worker-input-')
  result=subprocess.run(args,input=json.dumps({'contractVersion':'cop-root-database-credential-v1','password':p['_password']}).encode(),capture_output=True,env={'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C'})
 else:
  with open('/dev/tty','r+b',buffering=0) as tty:
   result=subprocess.run(args,stdin=tty,stdout=tty,stderr=tty,env={'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C'})
 r.require(result.returncode==0,'database_stage_worker_failed')
 return True
def finish(result):
 if not p.get('_sealLegacyTemplate'):return result
 r.require(p['_workerMode']=='--database-worker-apply' and isinstance(p.get('_legacyPolicySha256'),str),'legacy_seal_fixed_stage')
 directory=base/'runtime/account-erasure-install';info=directory.lstat();r.require(stat.S_ISDIR(info.st_mode) and info.st_uid==0 and stat.S_IMODE(info.st_mode)==0o700 and not directory.is_symlink(),'legacy_seal_directory_custody')
 legacy=directory/'legacy-provenance-policy.json';completion=directory/'completion-plan.json';enrollment=directory/'database-enrollment.json'
 original=r.private_read(legacy,0,1048576);completion_raw=r.private_read(completion,0,1048576);manifest=json.loads(r.private_read(enrollment,0,1048576));c=json.loads(completion_raw)
 r.require(c['contractVersion']=='cop-production-erasure-completion-v2' and c['phase']=='initial' and c['legacyProvenancePolicySha256']==p['_legacyPolicySha256'] and c['releasePlanSha256']==p['_planSha256'],'legacy_seal_completion_changed')
 metadata=r.environment_metadata(base/'.env',1000);raw=r.private_read(base/'.env',1000,1048576);env={}
 for line in raw.decode().splitlines():
  if not line.strip() or line.lstrip().startswith('#'):continue
  found=re.fullmatch(r'([A-Z][A-Z0-9_]*)=(.*)',line);r.require(found is not None and found[1] not in env,'legacy_seal_environment_invalid');value=found[2];env[found[1]]=value[1:-1] if len(value)>=2 and value[0] in ("'",'"') and value[-1]==value[0] else value
 r.require(len(env.get('COP_ACCOUNT_ERASURE_SECRET',''))>=32,'legacy_seal_secret_missing')
 binding={'guardStoreId':env.get('COP_ACCOUNT_SAFETY_GUARD_STORE_ID'),'applicationStoreId':env.get('COP_ACCOUNT_SAFETY_STORE_ID'),'incarnationId':env.get('COP_ACCOUNT_SAFETY_INCARNATION_ID'),'restoreGeneration':1,'configurationFingerprint':hashlib.sha256(('cop-account-erasure-config-v1\0'+env['COP_ACCOUNT_ERASURE_SECRET']).encode()).hexdigest()}
 r.require(manifest['guardStoreId']==binding['guardStoreId'] and manifest['applicationStoreId']==binding['applicationStoreId'] and manifest['incarnationId']==binding['incarnationId'] and manifest['restoreGeneration']==1,'legacy_seal_enrollment_changed')
 value=sealed_legacy_template(json.loads(original),p['_legacyPolicySha256'],binding,r.require);sealed=json.dumps(value,separators=(',',':'),ensure_ascii=False).encode();updated={**c,'legacyProvenancePolicySha256':hashlib.sha256(sealed).hexdigest()}
 def atomic(path,before,after):
  r.require(r.private_read(path,0,1048576)==before,'legacy_seal_file_changed');temporary=path.with_name('.'+path.name+'.seal-'+uuid.uuid4().hex);fd=None
  try:
   fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.fchmod(fd,0o600);os.fchown(fd,0,0);view=memoryview(after)
   while view:view=view[os.write(fd,view):]
   os.fsync(fd);os.close(fd);fd=None;r.require(r.private_read(path,0,1048576)==before,'legacy_seal_file_changed');os.replace(temporary,path);d=os.open(directory,os.O_RDONLY)
   try:os.fsync(d)
   finally:os.close(d)
  finally:
   if fd is not None:os.close(fd)
   try:temporary.unlink()
   except FileNotFoundError:pass
  r.require(r.private_read(path,0,1048576)==after,'legacy_seal_readback_changed')
 r.require(r.environment_metadata(base/'.env',1000)==metadata and r.private_read(base/'.env',1000,1048576)==raw,'legacy_seal_environment_changed');verify_pins()
 atomic(legacy,original,sealed+b'\n');atomic(completion,completion_raw,(json.dumps(updated,separators=(',',':'))+'\n').encode())
 r.require(r.environment_metadata(base/'.env',1000)==metadata and r.private_read(base/'.env',1000,1048576)==raw,'legacy_seal_environment_changed')
 return result
coordinate_database_stage(p,storage,lambda:r.Store(uid=1000,guard=storage.preflight),launch,verify_pins,r.require,verify_runtime,finish)
print(json.dumps({'phase':'root_preparation_stage_verified','mode':p['_workerMode'],'runtimeUnchanged':True,'storageLockHeld':True,'servicesChanged':False}))
`;
export const ENVIRONMENT_NORMALIZATION_PROGRAM=String.raw`
import hashlib,json,os,pathlib,re,stat,sys,types,uuid
sys.dont_write_bytecode=True

def normalized_legacy_environment(raw):
 require=lambda v: (_ for _ in ()).throw(RuntimeError('legacy_env_scope_invalid')) if not v else None
 require(len(raw)<=1048576 and b'\0' not in raw);lines=raw.splitlines(keepends=True);positions={}
 for index,line in enumerate(lines):
  text=line.rstrip(b'\r\n')
  if not text.strip() or text.lstrip().startswith(b'#'):continue
  found=re.fullmatch(rb'([A-Z][A-Z0-9_]*)=(.*)',text);require(found is not None);positions.setdefault(found[1].decode(),[]).append(index)
 duplicate={key:values for key,values in positions.items() if len(values)>1}
 require(set(duplicate)<= {'COP_DEPLOY_DOMAIN','COP_LAB_TOKEN'} and all(len(values)==2 for values in duplicate.values()))
 removed={values[0] for values in duplicate.values()}
 return b''.join(line for index,line in enumerate(lines) if index not in removed),sorted(duplicate)

def atomic_private_environment(r,path,expected,old_sha,raw,uid,gid):
 r.require(r.environment_metadata(path,uid)==expected and r.sha(r.private_read(path,uid,1048576))==old_sha,'legacy_env_cas_changed')
 temp=path.with_name('.env.normalize-'+uuid.uuid4().hex);fd=None
 try:
  fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.fchown(fd,uid,gid);os.fchmod(fd,0o600);view=memoryview(raw)
  while view:view=view[os.write(fd,view):]
  os.fsync(fd);os.close(fd);fd=None
  r.require(r.environment_metadata(path,uid)==expected and r.sha(r.private_read(path,uid,1048576))==old_sha,'legacy_env_cas_changed')
  os.replace(temp,path);r.Store.sync(path.parent)
  r.require(r.private_read(path,uid,1048576)==raw,'legacy_env_atomic_readback_failed');return r.environment_metadata(path,uid)
 finally:
  if fd is not None:os.close(fd)
  try:temp.unlink()
  except FileNotFoundError:pass

# Production entry follows isolated pure/CAS fault-test functions.
p=json.loads(sys.stdin.read());base=pathlib.Path('/srv/cop')
def load_checked(name,relative):
 raw=(base/relative).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=p['fileSha256'][relative]:raise RuntimeError('install_source_changed')
 m=types.ModuleType(name);m.__file__=str(base/relative);exec(compile(raw,m.__file__,'exec'),m.__dict__);return m
r=load_checked('runtime','scripts/cop-api-runtime.py');storage=load_checked('storage','scripts/cop-storage.py')
with storage.operation_lock():
 st=r.Store(uid=1000,guard=storage.preflight);current,old_dir,old,profile=st.active();r.require(current==p['expectedActive'],'legacy_env_active_changed')
 path=base/'.env';metadata=r.environment_metadata(path,1000);original=r.private_read(path,1000,1048576);gid=path.stat().st_gid;proposed,keys=normalized_legacy_environment(original)
 st.docker.live(old_dir,old,profile,require_label=old['kind']!='accepted-baseline');actual=st.docker.current(old_dir)
 r.require(actual['Id']==current['containerId'] and actual['Image']==current['imageId'] and actual['State']['Running'] and not actual['State'].get('Paused'),'legacy_env_runtime_changed')
 before=st.docker.config(old_dir,profile['directory'])
 if keys:
  temp=base/('.env.normalize-review-'+uuid.uuid4().hex);fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  try:
   os.fchown(fd,1000,gid);os.fchmod(fd,0o600);view=memoryview(proposed)
   while view:view=view[os.write(fd,view):]
   os.fsync(fd);os.close(fd);fd=None
   args=st.docker.compose(old_dir,profile['directory']);index=args.index('--env-file')+1;r.require(args[index]==str(path),'legacy_env_compose_scope');args[index]=str(temp)
   after=r.normalized_config(json.loads(st.docker.run(args+['config','--format','json'])))
   r.require(after==before,'legacy_env_effective_values_changed');st.docker.unchanged(old_dir,actual);r.require(st.pointer()==p['expectedActive'],'legacy_env_active_changed')
  finally:
   if fd is not None:os.close(fd)
   temp.unlink()
  replaced=None
  try:
   replaced=atomic_private_environment(r,path,metadata,r.sha(original),proposed,1000,gid)
   r.require(st.pointer()==p['expectedActive'] and st.docker.config(old_dir,profile['directory'])==before,'legacy_env_readback_changed');st.docker.unchanged(old_dir,actual)
  except BaseException:
   if replaced is not None:atomic_private_environment(r,path,replaced,r.sha(proposed),original,1000,gid)
   raise
 else:r.require(r.environment_metadata(path,1000)==metadata,'legacy_env_cas_changed')
 print(json.dumps({'phase':'legacy_environment_normalized','removedDuplicateKeys':keys,'effectiveValuesChanged':False,'secretsRotated':False,'rollbackHeldInRamOnly':True,'servicesChanged':False}))
`;
export const FINAL_CONFIGURATION_PROGRAM=ENVIRONMENT_NORMALIZATION_PROGRAM.split('# Production entry follows')[0]+String.raw`
FINAL_KEYS=frozenset({'COP_ACCOUNT_ERASURE_ENABLED','COP_ACCOUNT_ERASURE_SECRET','COP_ACCOUNT_SAFETY_GUARD_REQUIRED','COP_ACCOUNT_SAFETY_AUTHORITY_MODE','COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL','COP_ACCOUNT_SAFETY_GUARD_STORE_ID','COP_ACCOUNT_SAFETY_INCARNATION_ID','COP_ACCOUNT_SAFETY_STORE_ID','COP_ACCOUNT_SAFETY_RUNTIME_ATTESTATION','COP_KEYCLOAK_ERASURE_CLIENT_ID','COP_KEYCLOAK_ERASURE_CLIENT_SECRET','COP_KEYCLOAK_COP_SCOPE_AUTHORITY_ACCEPTED','COP_SIM_ERASURE_ROUTER_URL','COP_SIM_ERASURE_ROUTER_TOKEN','COP_SIM_ERASURE_DRIVER_URL','COP_SIM_ERASURE_DRIVER_TOKEN','COP_LIVEKIT_ADMIN_URL','COP_LIVEKIT_ERASURE_RELAY_URL','COP_MEDIA_UPLOAD_TRANSPORT','COP_MEDIA_S3_ACCESS_KEY_ID','COP_MEDIA_S3_SECRET_ACCESS_KEY','COP_ACCOUNT_ERASURE_EDGE_URL','COP_EDGE_ADMIN_TOKEN','COP_EDGE_NODE_ID'})
def finite_env_parse(raw):
 require=lambda v: (_ for _ in ()).throw(RuntimeError('final_configuration_invalid')) if not v else None
 require(len(raw)<=1048576 and b'\0' not in raw);result={}
 for line in raw.decode('utf8').splitlines():
  if not line.strip() or line.lstrip().startswith('#'):continue
  match=re.fullmatch(r'([A-Z][A-Z0-9_]*)=(.*)',line);require(match is not None and match[1] not in result);value=match[2]
  if len(value)>=2 and value[0]==value[-1] and value[0] in ('"',"'"):value=value[1:-1]
  result[match[1]]=value
 return result

def finite_final_environment(raw,sim_raw,edge):
 env=finite_env_parse(raw);sim=finite_env_parse(sim_raw)
 def require(v):
  if not v:raise RuntimeError('final_configuration_unproven')
 def token(v):require(isinstance(v,str) and re.fullmatch(r'[A-Za-z0-9_./+=:@%~-]{32,16384}',v))
 require(env.get('COP_ACCOUNT_ERASURE_ENABLED','false')=='false' and env.get('COP_OIDC_ISSUER')=='https://login.zeleznalady.cz/realms/cop')
 for key in ('COP_ACCOUNT_ERASURE_SECRET','COP_SIM_ERASURE_ACTOR_SECRET','COP_AI_CHAT_ROUTER_USER_ID_SECRET','COP_KEYCLOAK_ERASURE_CLIENT_SECRET'):token(env.get(key))
 for key in ('COP_MEDIA_S3_ACCESS_KEY_ID','COP_MEDIA_S3_SECRET_ACCESS_KEY','COP_EDGE_ADMIN_TOKEN'):require(isinstance(env.get(key),str) and 0<len(env[key])<=16384 and not any(ord(c)<32 for c in env[key]))
 for key in ('COP_ACCOUNT_SAFETY_GUARD_STORE_ID','COP_ACCOUNT_SAFETY_INCARNATION_ID','COP_ACCOUNT_SAFETY_STORE_ID'):require(isinstance(env.get(key),str) and re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}',env[key]))
 require(env.get('COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL','').startswith('postgresql://cop_safety_v2_runtime:') and env.get('COP_KEYCLOAK_ERASURE_CLIENT_ID')=='cop-account-erasure-worker')
 require(env.get('COP_MEDIA_UPLOAD_TRANSPORT','presigned') in ('presigned','cop_api') and env.get('COP_CSM_MESSAGING_PUBLIC_URL')=='https://msg.zeleznalady.cz')
 require(env.get('COP_EDGE_ADMIN_TOKEN')==edge.get('COP_EDGE_ADMIN_TOKEN') and edge.get('COP_EDGE_NODE_ID','node_edge_pilot_01')=='node_edge_pilot_01')
 for key in ('AI_ROUTER_COP_TOKEN','DRIVER_MEASUREMENTS_COP_TOKEN'):token(sim.get(key))
 updates={'COP_ACCOUNT_ERASURE_ENABLED':'false','COP_ACCOUNT_SAFETY_GUARD_REQUIRED':'true','COP_ACCOUNT_SAFETY_AUTHORITY_MODE':'database_v2','COP_ACCOUNT_SAFETY_RUNTIME_ATTESTATION':'account-safety-guard-v1','COP_KEYCLOAK_COP_SCOPE_AUTHORITY_ACCEPTED':'true','COP_SIM_ERASURE_ROUTER_URL':'http://ai-router-api:4050','COP_SIM_ERASURE_ROUTER_TOKEN':sim['AI_ROUTER_COP_TOKEN'],'COP_SIM_ERASURE_DRIVER_URL':'http://sim-driver-measurements:4020','COP_SIM_ERASURE_DRIVER_TOKEN':sim['DRIVER_MEASUREMENTS_COP_TOKEN'],'COP_LIVEKIT_ADMIN_URL':'','COP_LIVEKIT_ERASURE_RELAY_URL':'https://msg.zeleznalady.cz','COP_MEDIA_UPLOAD_TRANSPORT':'cop_api','COP_ACCOUNT_ERASURE_EDGE_URL':'http://cop-edge:4312','COP_EDGE_NODE_ID':'node_edge_pilot_01'}
 require(set(updates)<=FINAL_KEYS);lines=raw.splitlines(keepends=True)
 for key,value in updates.items():
  encoded=(key+'='+value).encode();found=[i for i,line in enumerate(lines) if line.startswith((key+'=').encode())]
  require(len(found)<=1)
  if found:
   old=lines[found[0]];ending=b'\r\n' if old.endswith(b'\r\n') else b'\n' if old.endswith(b'\n') else b'';lines[found[0]]=encoded+ending
  else:
   if lines and not lines[-1].endswith(b'\n'):lines[-1]+=b'\n'
   lines.append(encoded+b'\n')
 proposed=b''.join(lines);after=finite_env_parse(proposed)
 require(all(after.get(key)==value for key,value in updates.items()) and all(after.get(key)==value for key,value in env.items() if key not in updates))
 changed={key for key in set(env)|set(after) if (key in env)!=(key in after) or env.get(key)!=after.get(key)};require(changed<=FINAL_KEYS)
 return proposed,sorted(changed)

# Production final-configuration entry follows isolated finite transformation tests.
p=json.loads(sys.stdin.read());base=pathlib.Path('/srv/cop');plan=base/'runtime/account-erasure-install/release-plan.json';configuration=base/'runtime/account-erasure-install/final-configuration.json'
def load_checked(name,relative):
 raw=(base/relative).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=p['fileSha256'][relative]:raise RuntimeError('install_source_changed')
 m=types.ModuleType(name);m.__file__=str(base/relative);exec(compile(raw,m.__file__,'exec'),m.__dict__);return m
r=load_checked('runtime','scripts/cop-api-runtime.py');storage=load_checked('storage','scripts/cop-storage.py')
with storage.operation_lock():
 r.require(hashlib.sha256(plan.read_bytes()).hexdigest()==p['_planSha256'] and hashlib.sha256(r.private_read(configuration,0,1048576,mode=0o600)).hexdigest()==p['_configurationSha256'],'final_configuration_plan_changed')
 reviewed=json.loads(r.private_read(configuration,0,1048576,mode=0o600));r.require(set(reviewed)=={'contractVersion','sourceRevision','imageId','expectedActive','edgeContainerId'} and reviewed['contractVersion']=='cop-production-erasure-final-configuration-v1' and all(reviewed[k]==p[k] for k in ('sourceRevision','imageId','expectedActive')),'final_configuration_source_binding')
 st=r.Store(uid=1000,guard=storage.preflight);current,old_dir,old,profile=st.active();r.require(current==p['expectedActive'],'final_configuration_active_changed')
 actual=st.docker.current(old_dir);r.require(actual['Id']==current['containerId'] and actual['Image']==current['imageId'] and actual['State']['Running'] and not actual['State'].get('Paused'),'final_configuration_runtime_changed')
 edge_id=st.docker.peers(old_dir)['cop-edge'];r.require(edge_id==reviewed['edgeContainerId'],'final_configuration_edge_changed');edge=json.loads(st.docker.run(['docker','inspect',edge_id]))[0]
 labels=edge['Config'].get('Labels',{});r.require(edge['Id']==edge_id and edge['State']['Running'] and labels.get('com.docker.compose.project')=='cop' and labels.get('com.docker.compose.service')=='cop-edge','final_configuration_edge_unproven')
 edge_env=dict(v.split('=',1) for v in edge['Config'].get('Env',[]) if '=' in v)
 target=base/'.env';metadata=r.environment_metadata(target,1000);raw=r.private_read(target,1000,1048576);gid=target.stat().st_gid
 sim_path=pathlib.Path('/srv/sim/.env');sim_info=sim_path.lstat();r.require(sim_info.st_uid in (0,1000),'final_configuration_sim_custody');sim_metadata=r.environment_metadata(sim_path,sim_info.st_uid);sim_raw=r.private_read(sim_path,sim_info.st_uid,1048576)
 proposed,keys=finite_final_environment(raw,sim_raw,edge_env);r.require(FINAL_KEYS==r.ERASURE_CONFIG_KEYS,'final_configuration_scope_changed')
 r.require(r.environment_metadata(sim_path,sim_info.st_uid)==sim_metadata,'final_configuration_sim_changed');st.docker.unchanged(old_dir,actual);r.require(st.pointer()==p['expectedActive'] and st.docker.peers(old_dir)['cop-edge']==edge_id,'final_configuration_runtime_changed')
 if proposed!=raw:atomic_private_environment(r,target,metadata,r.sha(raw),proposed,1000,gid)
 r.require(r.private_read(target,1000,1048576)==proposed and r.environment_metadata(sim_path,sim_info.st_uid)==sim_metadata,'final_configuration_readback_changed');st.docker.unchanged(old_dir,actual)
 print(json.dumps({'phase':'final_configuration_prepared','changedKeys':keys,'erasureEnabled':False,'actorAndUserIdSecretsPreserved':True,'servicesChanged':False,'secretsPrinted':False}))
`;
export const AUTHORITY_PREPARATION_PROGRAM=FINAL_CONFIGURATION_PROGRAM.split('# Production final-configuration entry follows')[0]+String.raw`
# Fixed initial authority selection; actual guard/intake stay disabled.
p=json.loads(sys.stdin.read());base=pathlib.Path('/srv/cop')
def load_checked(name,relative):
 raw=(base/relative).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=p['fileSha256'][relative]:raise RuntimeError('install_source_changed')
 m=types.ModuleType(name);m.__file__=str(base/relative);exec(compile(raw,m.__file__,'exec'),m.__dict__);return m
r=load_checked('runtime','scripts/cop-api-runtime.py');storage=load_checked('storage','scripts/cop-storage.py')
with storage.operation_lock():
 st=r.Store(uid=1000,guard=storage.preflight);current,directory,old,profile=st.active();r.require(current==p['expectedActive'],'authority_preparation_active_changed')
 actual=st.docker.current(directory);r.require(actual['Id']==current['containerId'] and actual['Image']==current['imageId'] and actual['State']['Running'] and not actual['State'].get('Paused'),'authority_preparation_runtime_changed')
 path=base/'.env';metadata=r.environment_metadata(path,1000);raw=r.private_read(path,1000,1048576);env=finite_env_parse(raw)
 r.require(all(env.get(key,'false')=='false' for key in ('COP_ACCOUNT_ERASURE_ENABLED','COP_ACCOUNT_SAFETY_GUARD_REQUIRED','COP_KEYCLOAK_COP_SCOPE_AUTHORITY_ACCEPTED')) and env.get('COP_ACCOUNT_SAFETY_AUTHORITY_MODE','database_v2')=='database_v2','authority_preparation_not_initial')
 if 'COP_ACCOUNT_SAFETY_AUTHORITY_MODE' not in env:
  proposed=raw+(b'' if not raw or raw.endswith(b'\n') else b'\n')+b'COP_ACCOUNT_SAFETY_AUTHORITY_MODE=database_v2\n';atomic_private_environment(r,path,metadata,r.sha(raw),proposed,1000,path.stat().st_gid)
 st.docker.unchanged(directory,actual);r.require(st.pointer()==p['expectedActive'],'authority_preparation_active_changed')
 print(json.dumps({'phase':'database_authority_prepared','erasureEnabled':False,'guardRequired':False,'servicesChanged':False}))
`;
export const RUNTIME_INSPECTION_PROGRAM=String.raw`
import hashlib,json,pathlib,sys,types
p=json.loads(sys.stdin.read());base=pathlib.Path('/srv/cop')
def load_checked(name,relative):
 raw=(base/relative).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=p['fileSha256'][relative]:raise RuntimeError('install_source_changed')
 m=types.ModuleType(name);m.__file__=str(base/relative);exec(compile(raw,m.__file__,'exec'),m.__dict__);return m
r=load_checked('runtime','scripts/cop-api-runtime.py');storage=load_checked('storage','scripts/cop-storage.py')
with storage.operation_lock():
 st=r.Store(uid=1000,guard=storage.preflight);r.require(not (st.root/'pending.json').exists(),'activation_recovery_required');current,directory,binding,profile=st.active();actual=st.docker.current(directory)
 r.require(actual['Id']==current['containerId'] and actual['Image']==current['imageId'] and actual['State']['Running'] and not actual['State'].get('Paused'),'completion_runtime_changed')
 env=dict(v.split('=',1) for v in actual['Config'].get('Env',[]) if '=' in v)
 guarded=bool(binding.get('accountErasureConfig'))
 previous=None
 if guarded:
  if current==p['expectedActive'] and p['operation'] in ('enable','pause'):st.docker.account_erasure_scope={'containerId':current['containerId'],'changedKeys':['COP_ACCOUNT_ERASURE_ENABLED'],'edgeContainerId':None}
  try:st.docker.live(directory,binding,profile)
  finally:st.docker.account_erasure_scope=None
  reference=binding['accountErasureConfig'];_,proof=st.erasure_config_proof(pathlib.Path(reference['path']),binding,reference['sha256']);previous=proof['previous']
 print(json.dumps({'configPrevious':previous,'previousReleaseId':binding['previousReleaseId'],'active':current,'sourceRevision':binding['sourceRevision'],'startedAt':actual['State']['StartedAt'],'guarded':guarded,'intakeEnabled':env.get('COP_ACCOUNT_ERASURE_ENABLED','false')=='true','guardRequired':env.get('COP_ACCOUNT_SAFETY_GUARD_REQUIRED','false')=='true'}))
`;
export const INTAKE_TRANSITION_PROGRAM=FINAL_CONFIGURATION_PROGRAM.split('# Production final-configuration entry follows')[0]+String.raw`
p=json.loads(sys.stdin.read());base=pathlib.Path('/srv/cop')
def load_checked(name,relative):
 raw=(base/relative).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=p['fileSha256'][relative]:raise RuntimeError('install_source_changed')
 m=types.ModuleType(name);m.__file__=str(base/relative);exec(compile(raw,m.__file__,'exec'),m.__dict__);return m
r=load_checked('runtime','scripts/cop-api-runtime.py');storage=load_checked('storage','scripts/cop-storage.py')
with storage.operation_lock():
 st=r.Store(uid=1000,guard=storage.preflight);r.require(not (st.root/'pending.json').exists(),'intake_transition_pending_activation');current,directory,binding,profile=st.active();r.require(current==p['expectedActive'] and bool(binding.get('accountErasureConfig')),'intake_transition_binding_changed');actual=st.docker.current(directory)
 r.require(actual['Id']==current['containerId'] and actual['Image']==p['imageId'] and actual['State']['Running'] and not actual['State'].get('Paused'),'intake_transition_runtime_changed')
 operation=p['_intakeOperation'];r.require(operation in ('enable','pause','maintain'),'intake_transition_scope')
 path=base/'.env';metadata=r.environment_metadata(path,1000);raw=r.private_read(path,1000,1048576);env=finite_env_parse(raw);r.require(env.get('COP_ACCOUNT_SAFETY_GUARD_REQUIRED')=='true','intake_transition_guard_missing')
 if operation=='enable':
  import datetime
  receipt_path=base/'runtime/account-erasure-install/production-owner-readiness.json';receipt_raw=r.private_read(receipt_path,0,1048576,mode=0o600);receipt=json.loads(receipt_raw)
  r.require(hashlib.sha256(receipt_raw).hexdigest()==p['_readinessSha256'] and receipt['active']==current and receipt['imageId']==p['imageId'] and receipt['dependency']['name']=='cop-account-erasure-owners' and receipt['dependency']['status']=='ok','intake_owner_readiness_unbound')
  age=datetime.datetime.now(datetime.timezone.utc).timestamp()-datetime.datetime.fromisoformat(receipt['dependency']['checkedAt'].replace('Z','+00:00')).timestamp();r.require(0<=age<=30 and env.get('COP_ACCOUNT_ERASURE_ENABLED') in ('false','true'),'intake_owner_readiness_stale')
 wanted='true' if operation=='enable' else 'false';lines=raw.splitlines(keepends=True);matches=[i for i,line in enumerate(lines) if line.startswith(b'COP_ACCOUNT_ERASURE_ENABLED=')];r.require(len(matches)==1,'intake_transition_config_invalid')
 oldline=lines[matches[0]];ending=b'\r\n' if oldline.endswith(b'\r\n') else b'\n' if oldline.endswith(b'\n') else b'';lines[matches[0]]=b'COP_ACCOUNT_ERASURE_ENABLED='+wanted.encode()+ending;proposed=b''.join(lines)
 before=finite_env_parse(raw);after=finite_env_parse(proposed);r.require(all(after.get(k)==v for k,v in before.items() if k!='COP_ACCOUNT_ERASURE_ENABLED'),'intake_transition_scope')
 if proposed!=raw:atomic_private_environment(r,path,metadata,r.sha(raw),proposed,1000,path.stat().st_gid)
 st.docker.unchanged(directory,actual);r.require(st.pointer()==p['expectedActive'],'intake_transition_active_changed')
 print(json.dumps({'phase':'intake_configuration_prepared','operation':operation,'servicesChanged':False}))
`;
export const IMAGE_ATTESTATION_PROGRAM=String.raw`
import hashlib,json,os,pathlib,stat,subprocess,sys,types
sys.dont_write_bytecode=True

def publish_image_attestation(st,path,value,target,verify):
 st.protected_directory(st.protected_root);st.protected_directory(path.parent)
 require=st.docker_require
 require(path.parent==st.protected_root/target['profileGeneration'] and path.name=='attestation-'+target['imageId'][7:]+'.json','image_attestation_path')
 verify();raw=st.encode(value)
 if path.exists() or path.is_symlink():
  st.attestation(path,target);require(path.read_bytes()==raw,'image_attestation_existing_conflict');verify();return False
 fd=None;created_inode=None
 try:
  fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o640);created_inode=os.fstat(fd).st_ino
  os.fchown(fd,st.protected_uid,st.protected_gid);os.fchmod(fd,0o640);view=memoryview(raw)
  while view:view=view[os.write(fd,view):]
  os.fsync(fd);os.close(fd);fd=None;verify();st.attestation(path,target);st.sync(path.parent);return True
 except BaseException:
  if fd is not None:os.close(fd)
  if created_inode is not None:
   try:
    info=path.lstat()
    if stat.S_ISREG(info.st_mode) and info.st_ino==created_inode:os.unlink(path);st.sync(path.parent)
   except FileNotFoundError:pass
  raise

# Production entry remains outside the reusable offline fault-test function.
p=json.loads(sys.stdin.read());base=pathlib.Path('/srv/cop')
def load_checked(name,relative):
 raw=(base/relative).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=p['fileSha256'][relative]:raise RuntimeError('install_source_changed')
 m=types.ModuleType(name);m.__file__=str(base/relative);exec(compile(raw,m.__file__,'exec'),m.__dict__);return m
r=load_checked('runtime','scripts/cop-api-runtime.py');storage=load_checked('storage','scripts/cop-storage.py')
def node_probe(image,mode,payload,mounts,network='none',groups=False):
 args=['docker','--host','unix:///var/run/docker.sock','run','--rm','--pull','never','--log-driver','none','-i','--hostname','docker','--network',network,'--read-only','--user','0:0','--cap-drop','ALL','--cap-add','DAC_OVERRIDE','--security-opt','no-new-privileges','--pids-limit','64','--memory','256m']
 if groups:args+=['--group-add','982']
 for mount in mounts:args+=['--mount',mount]
 args+=['--entrypoint','node',image,'/app/scripts/account-safety/image-profile-probe.mjs',mode]
 result=subprocess.run(args,input=json.dumps(payload).encode(),capture_output=True,timeout=60,env={'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C'})
 r.require(result.returncode==0 and len(result.stdout)<=4096,'image_profile_actual_probe_failed');return json.loads(result.stdout)
with storage.operation_lock():
 st=r.Store(uid=1000,guard=storage.preflight);st.docker_require=r.require;st.encode=r.encoded
 current,old_dir,old,profile=st.active();r.require(current==p['expectedActive'] and profile['mode']=='transaction','image_active_profile_changed')
 actual=st.docker.current(old_dir);r.require(actual['Id']==current['containerId'] and actual['Image']==current['imageId'] and actual['State']['Running'] and not actual['State'].get('Paused') and actual['State'].get('Pid',0)>0,'image_old_runtime_changed')
 env_before=r.environment_metadata(base/'.env',1000)
 target={'kind':'candidate','imageId':p['imageId'],'sourceRevision':p['sourceRevision'],'profileGeneration':current['profileGeneration']}
 st.docker.image(p['imageId'],revision=p['sourceRevision']);st.check_mounts(target,profile)
 live_env=dict(item.split('=',1) for item in actual['Config'].get('Env',[]) if '=' in item)
 host_dir=pathlib.Path('/srv/x5-production/staging/cop/media-conversions');marker=host_dir/'.cop-storage.json';host_info=host_dir.lstat()
 r.require(host_info.st_dev==os.stat('/srv/x5-production').st_dev and host_dir.is_dir() and not host_dir.is_symlink() and host_dir.resolve()==host_dir,'image_x5_path_changed')
 r.require(live_env.get('COP_MEDIA_SPATIAL_CONVERSION_WORKDIR')=='/data/cop-media-conversions' and live_env.get('COP_MEDIA_SPATIAL_CONVERSION_EXPECTED_STORAGE_UUID')==storage.EXPECTED_UUID and live_env.get('COP_MEDIA_SPATIAL_CONVERSION_EXPECTED_DEVICE_ID')==str(host_info.st_dev),'image_x5_runtime_configuration_changed')
 for source,dest,rw in [(str(host_dir),'/data/cop-media-conversions',True),(str(marker),'/data/cop-media-conversions/.cop-storage.json',False)]:
  matches=[m for m in actual['Mounts'] if m.get('Destination')==dest]
  r.require(len(matches)==1 and matches[0].get('Type')=='bind' and matches[0].get('Source')==source and matches[0].get('RW') is rw,'image_x5_runtime_mount_changed')
 x5={'workDir':'/data/cop-media-conversions','expectedStorageUuid':storage.EXPECTED_UUID,'expectedDeviceId':str(host_info.st_dev),'expectedPresent':True}
 positive=node_probe(p['imageId'],'--x5-guard',x5,['type=bind,src='+str(host_dir)+',dst=/data/cop-media-conversions,readonly'])
 r.require(positive=={'actualX5GuardVerified':True,'wrongUuidRejected':True,'wrongDeviceRejected':True,'x5Written':False},'image_x5_actual_guard_failed')
 negative=node_probe(p['imageId'],'--x5-guard',{**x5,'expectedPresent':False},[])
 r.require(negative=={'missingMountRejected':True},'image_x5_missing_mount_accepted')
 ca=profile['driverContract']['caSha256'];db=node_probe(p['imageId'],'--database',{'values':profile['values'],'caSha256':ca},['type=bind,src=/srv/cop,dst=/srv/cop,readonly','type=bind,src=/run/vcode-cop-pgbouncer,dst=/run/vcode-cop-pgbouncer,readonly','type=bind,src=/etc/vcode-cop-pgbouncer/postgres-ca.crt,dst=/etc/vcode-cop-pgbouncer/postgres-ca.crt,readonly'],network='host',groups=True)
 r.require(db=={'databaseRoutingVerified':True,'readOnlySelects':4 if profile['values'].get('COP_STREAM_BUS_DATABASE_URL') else 3,'startupDdl':False},'image_database_routing_unproven')
 value={'contractVersion':'cop-api-runtime-attestation-v1','application':'cop','service':'cop-api','profileGeneration':current['profileGeneration'],'imageId':p['imageId'],'sourceRevision':p['sourceRevision'],'kind':'candidate','ownerAcceptance':True,'driverContract':profile['driverContract'],'checks':{'x5RuntimeGuard':True,'sharpConversion':True,'databaseRouting':True,'acceptedBaselineRollback':False},'legacyContainerId':None,'legacyEnvPresence':None}
 def verify():
  r.require(st.pointer()==p['expectedActive'] and r.environment_metadata(base/'.env',1000)==env_before,'image_attestation_cas_changed')
  fresh=st.profile(current['profileId'],profile['driverContract']);r.require(fresh['values']==profile['values'],'image_profile_credentials_changed')
  st.docker.unchanged(old_dir,actual);live=st.docker.current(old_dir);r.require(live['State']['Running'] and not live['State'].get('Paused') and live['State']['StartedAt']==actual['State']['StartedAt'],'image_old_runtime_restarted')
 path=st.protected_root/current['profileGeneration']/('attestation-'+p['imageId'][7:]+'.json')
 created=publish_image_attestation(st,path,value,target,verify)
 print(json.dumps({'phase':'image_profile_attestation_written','attestationPath':str(path),'created':created,'sourceRevision':p['sourceRevision'],'imageId':p['imageId'],'servicesChanged':False,'startupDdl':False}))
`;
export const LEGACY_HOST_STAGE_PROGRAM=String.raw`${OPERATOR_PROFILE_HOST_CHECK}
import hashlib,json,os,pathlib,stat,subprocess,sys,types,uuid
def sql_enrollment_receipt(wrapper,require):
 require(isinstance(wrapper,dict) and isinstance(wrapper.get('sqlEnrollmentReceipt'),dict),'legacy_original_sql_receipt_missing')
 raw=wrapper['sqlEnrollmentReceipt'];require(raw.get('contractVersion')=='cop-legacy-erasure-provenance-enrollment-v1' and raw.get('mode')=='apply' and raw.get('provenanceComplete') is False and raw.get('hostPostReadbackRequired') is True,'legacy_original_sql_receipt_unproven')
 return raw

def completed_readback_result(wrapper,readback,require):
 require(isinstance(wrapper,dict) and wrapper.get('provenanceComplete') is True and wrapper.get('hostCustodyConfirmed') is True,'legacy_completed_host_custody_missing')
 raw=sql_enrollment_receipt(wrapper,require);transfer=wrapper.get('durableReceiptTransfer',{})
 require(transfer.get('contractVersion')=='cop-legacy-durable-receipt-transfer-v1' and transfer.get('verified') is True and transfer.get('purged') is True and transfer.get('userRowsChanged') is False and transfer.get('receiptSha256')==hashlib.sha256(json.dumps(raw,separators=(',',':'),ensure_ascii=False).encode()).hexdigest(),'legacy_completed_transfer_unproven')
 require(readback.get('contractVersion')=='cop-legacy-completed-provenance-readback-v1' and readback.get('verified') is True and readback.get('readOnly') is True and readback.get('currentStableOwnershipVerified') is True and readback.get('fullPostStateCasUsed') is False and readback.get('requiresCurrentOwnerReadiness') is True and readback.get('legacySessions',{}).get('activeCount')==0,'legacy_completed_stable_readback_unproven')
 # A completed historical wrapper is never rewritten or relabelled. This is
 # only the current read-only observation returned to the fixed orchestrator.
 return {**wrapper,'stableOwnershipReadback':readback,'verified':True}

def write_legacy_receipt(r,private,value,before=None):
 path=private/'legacy-provenance-receipt.json';info=private.lstat();r.require(stat.S_ISDIR(info.st_mode) and not private.is_symlink() and info.st_uid==0 and stat.S_IMODE(info.st_mode)==0o700,'legacy_receipt_directory_custody')
 raw=json.dumps(value,separators=(',',':'),ensure_ascii=False).encode()
 if before is None:r.require(not path.exists() and not path.is_symlink(),'legacy_receipt_already_exists')
 else:r.require(r.private_read(path,0,1048576)==before,'legacy_receipt_changed')
 temporary=path.with_name('.'+path.name+'.readback-'+uuid.uuid4().hex);fd=None
 try:
  fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.fchown(fd,0,0);os.fchmod(fd,0o600);view=memoryview(raw)
  while view:view=view[os.write(fd,view):]
  os.fsync(fd);os.close(fd);fd=None
  if before is None:r.require(not path.exists() and not path.is_symlink(),'legacy_receipt_already_exists')
  else:r.require(r.private_read(path,0,1048576)==before,'legacy_receipt_changed')
  os.replace(temporary,path);r.Store.sync(private)
 finally:
  if fd is not None:os.close(fd)
  try:temporary.unlink()
  except FileNotFoundError:pass
 r.require(r.private_read(path,0,1048576)==raw,'legacy_receipt_write_unproven');return raw

# Production entry follows the isolated exact-receipt custody function.
p=json.loads(sys.stdin.read());base=pathlib.Path('/srv/cop')
def load_checked(name,relative):
 raw=(base/relative).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=p['fileSha256'][relative]:raise RuntimeError('install_source_changed')
 m=types.ModuleType(name);m.__file__=str(base/relative);exec(compile(raw,m.__file__,'exec'),m.__dict__);return m
r=load_checked('runtime','scripts/cop-api-runtime.py');storage=load_checked('storage','scripts/cop-storage.py')
def witness():
 code="const fs=require('fs');const p=JSON.parse(fs.readFileSync(0,'utf8'));import('/srv/cop/scripts/account-safety/enroll-legacy-erasure-provenance.mjs').then(m=>process.stdout.write(JSON.stringify(m.inspectLegacyProvenanceWriter(p)))).catch(()=>process.exit(1))"
 result=subprocess.run(['/usr/bin/node','-e',code],input=json.dumps({'reviewedPlanSha256':p['_legacySha256']}).encode(),capture_output=True,env={'PATH':'/usr/bin:/bin','LANG':'C'});r.require(result.returncode==0 and len(result.stdout)<=8192,'legacy_host_actual_inspection_failed');return json.loads(result.stdout)
with storage.operation_lock():
 st=r.Store(uid=1000,guard=storage.preflight);current,directory,binding,profile=st.active();r.require(current==p['expectedActive'],'legacy_host_active_changed');before=st.docker.current(directory)
 r.require(before['Id']==current['containerId'] and before['Image']==current['imageId'] and before['State']['Running'] and (not before['State'].get('Paused') or p.get('_legacyVerify') is True or p.get('_legacyRecoverDurable') is True),'legacy_host_writer_changed')
 profile_witness=operator_profile_witness(st,current,directory,profile,r.require)
 if not before['State'].get('Paused'):st.docker.run(['docker','pause',current['containerId']])
 success=False;apply_attempted=bool(p.get('_legacyVerify') or p.get('_legacyRecoverDurable'))
 try:
  first=witness();r.require(first['containerId']==current['containerId'] and first['imageId']==current['imageId'],'legacy_host_witness_changed')
  policy_code="const fs=require('fs');const p=JSON.parse(fs.readFileSync(0,'utf8'));import('/srv/cop/scripts/account-safety/enroll-legacy-erasure-provenance.mjs').then(m=>process.stdout.write(JSON.stringify(m.inspectLegacyProvenancePolicyWriter(p)))).catch(()=>process.exit(1))"
  policy_result=subprocess.run(['/usr/bin/node','-e',policy_code],input=json.dumps({'reviewedPolicySha256':p['_legacyPolicySha256']}).encode(),capture_output=True,env={'PATH':'/usr/bin:/bin','LANG':'C'});r.require(policy_result.returncode==0 and len(policy_result.stdout)<=8192,'legacy_review_writer_unproven');policy_witness=json.loads(policy_result.stdout)
  review=json.loads(r.private_read(base/'runtime/account-erasure-install/legacy-provenance-review.json',0,1048576));r.require(review=={'contractVersion':'cop-legacy-provenance-root-review-v1','policySha256':p['_legacyPolicySha256'],'candidateSha256':p['_legacySha256'],'sourceRevision':p['sourceRevision'],'imageId':p['imageId'],'expectedActive':current,'policyWriterWitnessSha256':hashlib.sha256(json.dumps(policy_witness,separators=(',',':'),ensure_ascii=False).encode()).hexdigest(),'bindingSha256':review.get('bindingSha256')},'legacy_review_binding_changed');r.require(isinstance(review.get('bindingSha256'),str) and len(review['bindingSha256'])==64 and all(c in 'abcdef0123456789' for c in review['bindingSha256']),'legacy_review_binding_invalid')
  code="const fs=require('fs'),c=require('crypto');const p=JSON.parse(fs.readFileSync(0,'utf8'));if(Number(process.versions.node.split('.')[0])!==24)process.exit(1);for(const[k,h]of Object.entries(p.release.fileSha256)){if(k==='scripts/cop-storage.py'||k==='scripts/deploy-production.sh')continue;if(c.createHash('sha256').update(fs.readFileSync('/app/'+k)).digest('hex')!==h)process.exit(1)}import('/app/scripts/account-safety/enroll-legacy-erasure-provenance.mjs').then(async m=>{const options={mode:'apply',password:p.password,reviewedPlanSha256:p.reviewedPlanSha256,hostWriterWitness:p.hostWriterWitness};if(p.completed)return m.verifyCompletedLegacyErasureProvenance(options);if(p.recover)return m.recoverDurableLegacyErasureReceipt(options);if(p.acknowledge)return m.acknowledgeDurableLegacyErasureReceipt(options);if(p.verify){return m.verifyLegacyErasureProvenanceReceipt({...options,receipt:p.receipt})}const schema=await m.prepareLegacyErasureSchema(options);const enrolled=await m.enrollLegacyErasureProvenance(options);return {...enrolled,sqlEnrollmentReceipt:enrolled,schemaPreparation:schema}}).then(v=>process.stdout.write(JSON.stringify(v))).catch(()=>process.exit(1))"
  args=['docker','--host','unix:///var/run/docker.sock','run','--rm','--pull','never','--log-driver','none','-i','--hostname','docker','--network','host','--read-only','--user','0:0','--cap-drop','ALL','--cap-add','DAC_OVERRIDE','--security-opt','no-new-privileges','--pids-limit','64','--memory','256m','--mount','type=bind,src=/srv/cop,dst=/srv/cop,readonly','--mount','type=bind,src=/etc/vcode-cop-pgbouncer/postgres-ca.crt,dst=/etc/vcode-cop-pgbouncer/postgres-ca.crt,readonly','--mount','type=bind,src='+profile_witness['directory']+',dst='+profile_witness['directory']+',readonly','--entrypoint','node',p['imageId'],'-e',code]
  private=base/'runtime/account-erasure-install';receipt_path=private/'legacy-provenance-receipt.json';prior_receipt=r.private_read(receipt_path,0,1048576) if p.get('_legacyVerify') and not p.get('_legacyRecoverDurable') else None
  wrapper=json.loads(prior_receipt) if prior_receipt is not None else None
  if wrapper is not None:r.require(wrapper.get('rootReview')==review and (wrapper.get('state')=='pending_readback' and wrapper.get('contractVersion')=='cop-legacy-provenance-host-receipt-v1' and wrapper.get('provenanceComplete') is False and wrapper.get('hostCustodyConfirmed') is False or wrapper.get('provenanceComplete') is True and wrapper.get('hostCustodyConfirmed') is True and wrapper.get('postReadback',{}).get('verified') is True),'legacy_unknown_pending_receipt')
  raw_receipt=sql_enrollment_receipt(wrapper,r.require) if wrapper is not None else None
  def run_sql(verify,receipt,recover=False,acknowledge=False,completed=False):
   result=subprocess.run(args,input=json.dumps({'release':{k:v for k,v in p.items() if not k.startswith('_')},'password':p['_password'],'reviewedPlanSha256':p['_legacySha256'],'hostWriterWitness':first,'verify':verify,'receipt':receipt,'recover':recover,'acknowledge':acknowledge,'completed':completed}).encode(),capture_output=True,env={'PATH':'/usr/bin:/bin','LANG':'C'});r.require(result.returncode==0 and len(result.stdout)<=1048576,'legacy_sql_worker_failed');return json.loads(result.stdout)
  apply_attempted=True
  completed=bool(p.get('_legacyCompleted'));value=run_sql(bool(p.get('_legacyVerify')),raw_receipt,recover=bool(p.get('_legacyRecoverDurable')),completed=completed)
  if p.get('_legacyRecoverDurable'):
   r.require(value.get('contractVersion')=='cop-legacy-durable-receipt-recovery-v1' and value.get('readOnly') is True and value.get('reapplied') is False and value.get('readback',{}).get('verified') is True,'legacy_durable_readonly_recovery_unproven');raw_receipt=value['receipt'];r.require(raw_receipt.get('bindingSha256')==review['bindingSha256'],'legacy_durable_recovery_binding_changed');pending={'contractVersion':'cop-legacy-provenance-host-receipt-v1','state':'pending_readback','sqlEnrollmentReceipt':raw_receipt,'rootReview':review,'hostCustodyConfirmed':False,'provenanceComplete':False,'servicesChanged':False};prior_receipt=write_legacy_receipt(r,private,pending);value=run_sql(True,raw_receipt)
  elif not p.get('_legacyVerify'):

   raw_receipt=sql_enrollment_receipt(value,r.require);r.require(raw_receipt.get('bindingSha256')==review['bindingSha256'],'legacy_apply_binding_changed')
   pending={'contractVersion':'cop-legacy-provenance-host-receipt-v1','state':'pending_readback','sqlEnrollmentReceipt':raw_receipt,'rootReview':review,'hostCustodyConfirmed':False,'provenanceComplete':False,'servicesChanged':False};prior_receipt=write_legacy_receipt(r,private,pending);value=run_sql(True,raw_receipt)
  r.require(value.get('verified') is True and value.get('readOnly') is True and value.get('bindingSha256')==review['bindingSha256'],'legacy_actual_readback_unproven')
  r.require(operator_profile_witness(st,current,directory,profile,r.require)==profile_witness,'legacy_operator_profile_changed')
  second=witness();digest=hashlib.sha256(json.dumps(first,separators=(',',':')).encode()).hexdigest();r.require(first==second and value['hostWriterWitnessSha256']==digest and value['hostPostReadbackRequired'] is True and st.pointer()==p['expectedActive'],'legacy_post_readback_changed');st.docker.unchanged(directory,before)
  if completed:
   value=completed_readback_result(wrapper,value,r.require)
  else:
   value={**raw_receipt,'sqlEnrollmentReceipt':raw_receipt,'postReadback':value,'rootReview':review,'verified':True,'hostCustodyConfirmed':True,'provenanceComplete':True,'servicesChanged':False};prior_receipt=write_legacy_receipt(r,private,value,prior_receipt);transfer=run_sql(False,None,acknowledge=True);r.require(transfer.get('verified') is True and transfer.get('purged') is True and transfer.get('userRowsChanged') is False,'legacy_durable_transfer_not_complete');value['durableReceiptTransfer']=transfer;write_legacy_receipt(r,private,value,prior_receipt)
  success=True
 finally:
  r.require(operator_profile_witness(st,current,directory,profile,r.require)==profile_witness,'legacy_operator_profile_changed')
  actual=st.docker.current(directory);r.require(st.pointer()==p['expectedActive'] and actual['Id']==before['Id'] and actual['Image']==before['Image'] and actual['State']['Pid']==before['State']['Pid'] and actual['State']['StartedAt']==before['State']['StartedAt'],'legacy_resume_writer_changed');st.docker.unchanged(directory,before)
  if actual['State'].get('Paused') and (success or not apply_attempted):st.docker.run(['docker','unpause',before['Id']])
 r.require(success,'legacy_host_not_complete');value.update({'hostCustodyConfirmed':True,'provenanceComplete':True,'servicesChanged':False});print(json.dumps(value))
`;
export const LEGACY_FRESH_HOST_STAGE_PROGRAM=String.raw`${OPERATOR_PROFILE_HOST_CHECK}
import datetime,hashlib,json,os,pathlib,stat,subprocess,sys,types,uuid

def candidate_review(result,policy,policy_sha,witness,actual_binding_sha,require):
 require(isinstance(result,dict) and set(result)=={'candidatePlan','summary'},'legacy_candidate_result_invalid')
 candidate=result['candidatePlan'];summary=result['summary'];keys={'contractVersion','candidateSha256','policySha256','sourceHelperSha256','bindingSha256','hostWriterWitnessSha256','totalRows','countsByKind','oidcRows','nonAccountRows','sessionRows','unresolved'}
 require(isinstance(candidate,dict) and isinstance(summary,dict) and set(summary)==keys and summary['contractVersion']=='cop-legacy-erasure-candidate-summary-v1' and type(summary['unresolved']) is int and summary['unresolved']==0,'legacy_candidate_unresolved')
 compact=lambda v:json.dumps(v,separators=(',',':'),ensure_ascii=False).encode()
 digest=lambda v:hashlib.sha256(compact(v)).hexdigest()
 require(candidate.get('contractVersion')=='cop-legacy-erasure-provenance-enrollment-v1' and candidate.get('planId')==policy.get('planId') and all(candidate.get(k)==policy.get(k) for k in ('binding','writer','evidence','issuer')),'legacy_candidate_policy_changed')
 require(candidate.get('signedSessionPolicy')==policy.get('signedSessionPolicy'),'legacy_candidate_session_policy_changed')
 require(summary['candidateSha256']==digest(candidate) and summary['policySha256']==policy_sha and summary['sourceHelperSha256']==witness['sourceHelperSha256'] and isinstance(actual_binding_sha,str) and len(actual_binding_sha)==64 and all(c in 'abcdef0123456789' for c in actual_binding_sha) and summary['bindingSha256']==actual_binding_sha and summary['hostWriterWitnessSha256']==digest(witness),'legacy_candidate_digest_changed')
 require(all(isinstance(summary[k],int) and not isinstance(summary[k],bool) and 0<=summary[k]<=10000 for k in ('totalRows','oidcRows','nonAccountRows','sessionRows')) and isinstance(summary['countsByKind'],dict) and all(isinstance(k,str) and bool(k) and all(c in 'abcdefghijklmnopqrstuvwxyz_' for c in k) and len(k)<=40 and isinstance(v,int) and not isinstance(v,bool) and 0<=v<=10000 for k,v in summary['countsByKind'].items()),'legacy_candidate_counts_invalid')
 require(sum(summary['countsByKind'].values())==summary['totalRows'] and isinstance(candidate.get('rows'),list) and len(candidate['rows'])==summary['oidcRows']+summary['nonAccountRows'] and len(candidate['rows'])<=summary['totalRows'] and summary['sessionRows']<=summary['oidcRows'],'legacy_candidate_counts_changed')
 return candidate,summary

def confirm_candidate(summary,terminal,require):
 digest=summary['candidateSha256'];terminal.write('Legacy provenance: total='+str(summary['totalRows'])+', OIDC='+str(summary['oidcRows'])+', lab='+str(summary['nonAccountRows'])+', sessions='+str(summary['sessionRows'])+', unresolved=0\nCandidate SHA256: '+digest+'\nType APPLY '+digest+' to approve exactly these rows: ');terminal.flush()
 require(terminal.readline(128).rstrip('\r\n')=='APPLY '+digest,'legacy_candidate_root_review_not_confirmed')

# Production entry follows the isolated candidate/custody checks.
p=json.loads(sys.stdin.read());base=pathlib.Path('/srv/cop');private=base/'runtime/account-erasure-install';plan_path=private/'legacy-provenance-plan.json';candidate_path=private/'legacy-provenance-candidate.json';review_path=private/'legacy-provenance-review.json';completion_path=private/'completion-plan.json';policy_path=private/'legacy-provenance-policy.json'
def compact(v):return json.dumps(v,separators=(',',':'),ensure_ascii=False).encode()
def digest(v):return hashlib.sha256(compact(v)).hexdigest()
def load_checked(name,relative):
 raw=(base/relative).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=p['fileSha256'][relative]:raise RuntimeError('install_source_changed')
 m=types.ModuleType(name);m.__file__=str(base/relative);exec(compile(raw,m.__file__,'exec'),m.__dict__);return m
r=load_checked('runtime','scripts/cop-api-runtime.py');storage=load_checked('storage','scripts/cop-storage.py')
def source_pins():
 for relative,value in p['fileSha256'].items():r.require(hashlib.sha256((base/relative).read_bytes()).hexdigest()==value,'legacy_fresh_source_changed')
def atomic(path,value,before=None):
 r.require(path in (plan_path,candidate_path,review_path,completion_path,private/'legacy-provenance-receipt.json'),'legacy_fresh_output_scope')
 info=private.lstat();r.require(stat.S_ISDIR(info.st_mode) and not private.is_symlink() and info.st_uid==0 and stat.S_IMODE(info.st_mode)==0o700,'legacy_fresh_directory_custody')
 raw=compact(value)
 if before is None:r.require(not path.exists() and not path.is_symlink(),'legacy_fresh_output_exists')
 else:r.require(r.private_read(path,0,1048576)==before,'legacy_fresh_output_changed')
 temporary=path.with_name('.'+path.name+'.fresh-'+uuid.uuid4().hex);fd=None
 try:
  fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.fchown(fd,0,0);os.fchmod(fd,0o600);view=memoryview(raw)
  while view:view=view[os.write(fd,view):]
  os.fsync(fd);os.close(fd);fd=None
  if before is None:r.require(not path.exists() and not path.is_symlink(),'legacy_fresh_output_exists')
  else:r.require(r.private_read(path,0,1048576)==before,'legacy_fresh_output_changed')
  os.replace(temporary,path);r.Store.sync(private)
 finally:
  if fd is not None:os.close(fd)
  try:temporary.unlink()
  except FileNotFoundError:pass
 r.require(r.private_read(path,0,1048576)==raw,'legacy_fresh_output_readback_changed');return raw

def public_helper(operation,reviewed_sha):
 code="const fs=require('fs');const p=JSON.parse(fs.readFileSync(0,'utf8'));import('/srv/cop/scripts/account-safety/enroll-legacy-erasure-provenance.mjs').then(m=>{if(p.operation==='ddl')return {exportedDdlSha256:m.legacyErasureSchemaDdlSha256()};if(p.operation==='policy-writer')return m.inspectLegacyProvenancePolicyWriter({reviewedPolicySha256:p.reviewedSha256});if(p.operation==='plan-writer')return m.inspectLegacyProvenanceWriter({reviewedPlanSha256:p.reviewedSha256});process.exit(1)}).then(v=>process.stdout.write(JSON.stringify(v))).catch(()=>process.exit(1))"
 result=subprocess.run(['/usr/bin/node','-e',code],input=compact({'operation':operation,'reviewedSha256':reviewed_sha}),capture_output=True,env={'PATH':'/usr/bin:/bin','LANG':'C'});r.require(result.returncode==0 and len(result.stdout)<=8192,'legacy_fresh_host_inspection_failed');return json.loads(result.stdout)

with storage.operation_lock():
 source_pins();st=r.Store(uid=1000,guard=storage.preflight);current,directory,binding,profile=st.active();r.require(current==p['expectedActive'],'legacy_fresh_active_changed');before=st.docker.current(directory)
 r.require(before['Id']==current['containerId'] and before['Image']==current['imageId'] and before['State']['Running'] and not before['State'].get('Paused'),'legacy_fresh_writer_changed')
 old_environment=dict(v.split('=',1) for v in before['Config'].get('Env',[]) if '=' in v);r.require(old_environment.get('COP_ACCOUNT_SAFETY_GUARD_REQUIRED','false')=='false' and old_environment.get('COP_ACCOUNT_ERASURE_ENABLED','false')=='false','legacy_fresh_startup_guard_must_be_disabled')
 profile_witness=operator_profile_witness(st,current,directory,profile,r.require);environment=r.environment_metadata(base/'.env',1000);policy_raw=r.private_read(policy_path,0,1048576);policy=json.loads(policy_raw)
 r.require(digest(policy)==p['_legacyPolicySha256'] and policy.get('contractVersion')=='cop-legacy-erasure-provenance-policy-v1' and 'rows' not in policy,'legacy_fresh_policy_changed')
 completion_raw=r.private_read(completion_path,0,1048576);completion=json.loads(completion_raw)
 r.require(completion['contractVersion']=='cop-production-erasure-completion-v2' and completion['phase']=='provenance' and completion['legacyProvenancePolicySha256']==p['_legacyPolicySha256'] and completion['legacyProvenancePlanSha256'] is None,'legacy_fresh_checkpoint_changed')
 st.docker.run(['docker','pause',current['containerId']]);success=False;apply_attempted=False
 try:
  def unchanged():
   source_pins();actual=st.docker.current(directory);r.require(st.pointer()==current and actual['Id']==before['Id'] and actual['Image']==before['Image'] and actual['State']['Running'] and actual['State'].get('Paused') and actual['State']['Pid']==before['State']['Pid'] and actual['State']['StartedAt']==before['State']['StartedAt'],'legacy_fresh_paused_writer_changed');st.docker.unchanged(directory,before)
   r.require(operator_profile_witness(st,current,directory,profile,r.require)==profile_witness and r.environment_metadata(base/'.env',1000)==environment and r.private_read(policy_path,0,1048576)==policy_raw,'legacy_fresh_inputs_changed')
  def worker(operation,payload):
   unchanged()
   code="const fs=require('fs'),c=require('crypto');const p=JSON.parse(fs.readFileSync(0,'utf8'));if(Number(process.versions.node.split('.')[0])!==24)process.exit(1);for(const[k,h]of Object.entries(p.release.fileSha256)){if(k==='scripts/cop-storage.py'||k==='scripts/deploy-production.sh')continue;if(c.createHash('sha256').update(fs.readFileSync('/app/'+k)).digest('hex')!==h)process.exit(1)}import('/app/scripts/account-safety/enroll-legacy-erasure-provenance.mjs').then(async m=>{const o={mode:'apply',password:p.password,hostWriterWitness:p.hostWriterWitness};if(p.operation==='acknowledge')return m.acknowledgeDurableLegacyErasureReceipt({...o,reviewedPlanSha256:p.reviewedSha256});if(p.operation==='schema')return m.prepareLegacyErasureSchema({...o,reviewedPlanSha256:p.reviewedSha256});if(p.operation==='candidate')return m.generateLegacyErasureProvenanceCandidate({...o,reviewedPolicySha256:p.reviewedSha256});if(p.operation==='apply')return m.enrollLegacyErasureProvenance({...o,reviewedPlanSha256:p.reviewedSha256});if(p.operation==='verify')return m.verifyLegacyErasureProvenanceReceipt({...o,reviewedPlanSha256:p.reviewedSha256,receipt:p.receipt});process.exit(1)}).then(v=>process.stdout.write(JSON.stringify(v))).catch(()=>process.exit(1))"
   args=['docker','--host','unix:///var/run/docker.sock','run','--rm','--pull','never','--log-driver','none','-i','--hostname','docker','--network','host','--read-only','--user','0:0','--cap-drop','ALL','--cap-add','DAC_OVERRIDE','--security-opt','no-new-privileges','--pids-limit','64','--memory','256m','--mount','type=bind,src=/srv/cop,dst=/srv/cop,readonly','--mount','type=bind,src=/etc/vcode-cop-pgbouncer/postgres-ca.crt,dst=/etc/vcode-cop-pgbouncer/postgres-ca.crt,readonly','--mount','type=bind,src='+profile_witness['directory']+',dst='+profile_witness['directory']+',readonly','--entrypoint','node',p['imageId'],'-e',code]
   result=subprocess.run(args,input=compact({'release':{k:v for k,v in p.items() if not k.startswith('_')},'password':p['_password'],'operation':operation,**payload}),capture_output=True,env={'PATH':'/usr/bin:/bin','LANG':'C'});unchanged();r.require(result.returncode==0 and len(result.stdout)<=1048576,'legacy_fresh_sql_worker_failed');return json.loads(result.stdout)
  unchanged();ddl=public_helper('ddl',p['_legacyPolicySha256'])['exportedDdlSha256'];schema_plan={'contractVersion':'cop-legacy-erasure-schema-preparation-plan-v1','planId':policy['planId'],'binding':policy['binding'],'writer':policy['writer'],'exportedDdlSha256':ddl}
  if review_path.exists():
   review=json.loads(r.private_read(review_path,0,1048576));candidate=json.loads(r.private_read(candidate_path,0,1048576));r.require(review=={'contractVersion':'cop-legacy-provenance-root-review-v1','policySha256':p['_legacyPolicySha256'],'candidateSha256':digest(candidate),'sourceRevision':p['sourceRevision'],'imageId':p['imageId'],'expectedActive':current,'policyWriterWitnessSha256':digest(public_helper('policy-writer',p['_legacyPolicySha256'])),'bindingSha256':review.get('bindingSha256')},'legacy_fresh_prior_review_changed');r.require(isinstance(review.get('bindingSha256'),str) and len(review['bindingSha256'])==64 and all(c in 'abcdef0123456789' for c in review['bindingSha256']),'legacy_fresh_prior_binding_invalid')
  else:
   original=r.private_read(plan_path,0,1048576) if plan_path.exists() else None;r.require(original is None or json.loads(original)==schema_plan,'legacy_fresh_existing_plan_unreviewed');atomic(plan_path,schema_plan,original);schema_sha=digest(schema_plan);schema_witness=public_helper('plan-writer',schema_sha);schema=worker('schema',{'reviewedSha256':schema_sha,'hostWriterWitness':schema_witness});r.require(schema.get('schemaReady') is True and schema.get('hostPostReadbackRequired') is True,'legacy_fresh_schema_unproven');r.require(public_helper('plan-writer',schema_sha)==schema_witness,'legacy_fresh_schema_writer_changed')
   policy_witness=public_helper('policy-writer',p['_legacyPolicySha256']);candidate,summary=candidate_review(worker('candidate',{'reviewedSha256':p['_legacyPolicySha256'],'hostWriterWitness':policy_witness}),policy,p['_legacyPolicySha256'],policy_witness,schema['bindingSha256'],r.require)
   r.require(public_helper('policy-writer',p['_legacyPolicySha256'])==policy_witness,'legacy_fresh_candidate_writer_changed');atomic(candidate_path,candidate,r.private_read(candidate_path,0,1048576) if candidate_path.exists() else None);unchanged()
   with open('/dev/tty','r+',buffering=1) as terminal:confirm_candidate(summary,terminal,r.require)
   unchanged();r.require(json.loads(r.private_read(candidate_path,0,1048576))==candidate,'legacy_fresh_candidate_changed_after_review');review={'contractVersion':'cop-legacy-provenance-root-review-v1','policySha256':p['_legacyPolicySha256'],'candidateSha256':digest(candidate),'sourceRevision':p['sourceRevision'],'imageId':p['imageId'],'expectedActive':current,'policyWriterWitnessSha256':digest(policy_witness),'bindingSha256':summary['bindingSha256']};atomic(review_path,review)
  unchanged();old_plan=r.private_read(plan_path,0,1048576);r.require(json.loads(old_plan) in (schema_plan,candidate),'legacy_fresh_plan_transition_unowned');atomic(plan_path,candidate,old_plan);reviewed_sha=digest(candidate);completion_raw=r.private_read(completion_path,0,1048576);completion=json.loads(completion_raw);r.require(completion['phase']=='provenance' and completion['legacyProvenancePolicySha256']==p['_legacyPolicySha256'] and completion['legacyProvenancePlanSha256'] is None,'legacy_fresh_completion_changed');atomic(completion_path,{**completion,'legacyProvenancePlanSha256':reviewed_sha},completion_raw)
  first=public_helper('plan-writer',reviewed_sha);apply_attempted=True;enrolled=worker('apply',{'reviewedSha256':reviewed_sha,'hostWriterWitness':first});r.require(enrolled.get('hostPostReadbackRequired') is True and enrolled.get('provenanceComplete') is False and enrolled.get('bindingSha256')==review['bindingSha256'],'legacy_fresh_apply_unproven');pending={'contractVersion':'cop-legacy-provenance-host-receipt-v1','state':'pending_readback','sqlEnrollmentReceipt':enrolled,'rootReview':review,'hostCustodyConfirmed':False,'provenanceComplete':False,'servicesChanged':False};pending_raw=atomic(private/'legacy-provenance-receipt.json',pending);verified=worker('verify',{'reviewedSha256':reviewed_sha,'hostWriterWitness':first,'receipt':enrolled});r.require(verified.get('verified') is True and verified.get('readOnly') is True and public_helper('plan-writer',reviewed_sha)==first,'legacy_fresh_post_readback_unproven')
  unchanged();value={**enrolled,'sqlEnrollmentReceipt':enrolled,'postReadback':verified,'rootReview':review,'hostCustodyConfirmed':True,'provenanceComplete':True,'servicesChanged':False};completed_raw=atomic(private/'legacy-provenance-receipt.json',value,pending_raw);transfer=worker('acknowledge',{'reviewedSha256':reviewed_sha,'hostWriterWitness':first});r.require(transfer.get('verified') is True and transfer.get('purged') is True and transfer.get('userRowsChanged') is False,'legacy_fresh_durable_transfer_not_complete');value['durableReceiptTransfer']=transfer;atomic(private/'legacy-provenance-receipt.json',value,completed_raw);success=True
 finally:
  actual=st.docker.current(directory);r.require(st.pointer()==current and actual['Id']==before['Id'] and actual['Image']==before['Image'] and actual['State']['Pid']==before['State']['Pid'] and actual['State']['StartedAt']==before['State']['StartedAt'],'legacy_fresh_resume_writer_changed');st.docker.unchanged(directory,before)
  if actual['State'].get('Paused') and (success or not apply_attempted):st.docker.run(['docker','unpause',before['Id']])
 r.require(success,'legacy_fresh_not_complete');print(json.dumps(value))
`;
export const LEGACY_PAUSED_STATUS_PROGRAM=String.raw`${OPERATOR_PROFILE_HOST_CHECK}
import hashlib,json,pathlib,subprocess,sys,types
def paused_legacy_proof(p,current,env,c,plan,policy,wrapper,review,w,require):
 compact=lambda v:json.dumps(v,separators=(',',':'),ensure_ascii=False).encode()
 digest=lambda v:hashlib.sha256(compact(v)).hexdigest()
 require(current==p['expectedActive'] and env.get('COP_ACCOUNT_SAFETY_GUARD_REQUIRED','false')=='false' and env.get('COP_ACCOUNT_ERASURE_ENABLED','false')=='false','legacy_status_not_owned_legacy')
 require(c['contractVersion']=='cop-production-erasure-completion-v2' and c['phase'] in ('provenance','media','media_closed') and c['legacyProvenancePlanSha256']==p['_legacySha256'] and c['legacyProvenancePolicySha256']==p['_legacyPolicySha256'],'legacy_status_checkpoint_changed')
 require(digest(plan)==p['_legacySha256'] and digest(policy)==p['_legacyPolicySha256'],'legacy_status_plan_changed')
 raw=wrapper.get('sqlEnrollmentReceipt');require(isinstance(raw,dict) and raw.get('contractVersion')=='cop-legacy-erasure-provenance-enrollment-v1' and raw.get('mode')=='apply' and raw.get('provenanceComplete') is False and raw.get('hostPostReadbackRequired') is True and raw.get('planSha256')==p['_legacySha256'] and raw.get('sourceHelperSha256')==p['fileSha256']['scripts/account-safety/enroll-legacy-erasure-provenance.mjs'],'legacy_status_original_receipt_unproven')
 require(wrapper.get('state')=='pending_readback' and wrapper.get('contractVersion')=='cop-legacy-provenance-host-receipt-v1' and wrapper.get('provenanceComplete') is False and wrapper.get('hostCustodyConfirmed') is False or wrapper.get('provenanceComplete') is True and wrapper.get('hostCustodyConfirmed') is True and wrapper.get('postReadback',{}).get('verified') is True,'legacy_status_unknown_receipt_state')
 require(review=={'contractVersion':'cop-legacy-provenance-root-review-v1','policySha256':p['_legacyPolicySha256'],'candidateSha256':p['_legacySha256'],'sourceRevision':p['sourceRevision'],'imageId':p['imageId'],'expectedActive':current,'policyWriterWitnessSha256':digest(w['policy']),'bindingSha256':raw.get('bindingSha256')} and raw.get('hostWriterWitnessSha256')==digest(w['plan']) and wrapper.get('rootReview')==review,'legacy_status_review_changed')
 return True

# Production entry follows the isolated paused-proof checks.
p=json.loads(sys.stdin.read());base=pathlib.Path('/srv/cop');private=base/'runtime/account-erasure-install'
def compact(v):return json.dumps(v,separators=(',',':'),ensure_ascii=False).encode()
def digest(v):return hashlib.sha256(compact(v)).hexdigest()
def load_checked(name,relative):
 raw=(base/relative).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=p['fileSha256'][relative]:raise RuntimeError('install_source_changed')
 m=types.ModuleType(name);m.__file__=str(base/relative);exec(compile(raw,m.__file__,'exec'),m.__dict__);return m
r=load_checked('runtime','scripts/cop-api-runtime.py');storage=load_checked('storage','scripts/cop-storage.py')
with storage.operation_lock():
 for relative,value in p['fileSha256'].items():r.require(hashlib.sha256((base/relative).read_bytes()).hexdigest()==value,'legacy_status_source_changed')
 st=r.Store(uid=1000,guard=storage.preflight);current,directory,binding,profile=st.active();actual=st.docker.current(directory);profile_witness=operator_profile_witness(st,current,directory,profile,r.require)
 r.require(actual['Id']==current['containerId'] and actual['Image']==current['imageId'] and actual['State']['Running'] and actual['State'].get('Pid',0)>0,'legacy_status_runtime_changed')
 paused=actual['State'].get('Paused') is True;recoverable=False;durable_required=False;completed_reuse=False;code='LEGACY_WRITER_NOT_PAUSED'
 if paused:
  code='LEGACY_PENDING_PROOF_UNPROVEN'
  try:
   env=dict(v.split('=',1) for v in actual['Config'].get('Env',[]) if '=' in v)
   c=json.loads(r.private_read(private/'completion-plan.json',0,1048576));plan=json.loads(r.private_read(private/'legacy-provenance-plan.json',0,1048576));policy=json.loads(r.private_read(private/'legacy-provenance-policy.json',0,1048576));wrapper=json.loads(r.private_read(private/'legacy-provenance-receipt.json',0,1048576)) if (private/'legacy-provenance-receipt.json').exists() else None
   code_node="const fs=require('fs');const p=JSON.parse(fs.readFileSync(0,'utf8'));import('/srv/cop/scripts/account-safety/enroll-legacy-erasure-provenance.mjs').then(m=>({plan:m.inspectLegacyProvenanceWriter({reviewedPlanSha256:p.planSha256}),policy:m.inspectLegacyProvenancePolicyWriter({reviewedPolicySha256:p.policySha256})})).then(v=>process.stdout.write(JSON.stringify(v))).catch(()=>process.exit(1))"
   result=subprocess.run(['/usr/bin/node','-e',code_node],input=compact({'planSha256':p['_legacySha256'],'policySha256':p['_legacyPolicySha256']}),capture_output=True,env={'PATH':'/usr/bin:/bin','LANG':'C'});r.require(result.returncode==0 and len(result.stdout)<=16384,'legacy_status_paused_witness_unproven');w=json.loads(result.stdout)
   review=json.loads(r.private_read(private/'legacy-provenance-review.json',0,1048576))
   if wrapper is None:
    r.require(current==p['expectedActive'] and env.get('COP_ACCOUNT_SAFETY_GUARD_REQUIRED','false')=='false' and env.get('COP_ACCOUNT_ERASURE_ENABLED','false')=='false' and c['contractVersion']=='cop-production-erasure-completion-v2' and c['phase']=='provenance' and c['legacyProvenancePlanSha256']==p['_legacySha256'] and c['legacyProvenancePolicySha256']==p['_legacyPolicySha256'] and digest(plan)==p['_legacySha256'] and digest(policy)==p['_legacyPolicySha256'],'legacy_missing_receipt_checkpoint_changed')
    r.require(isinstance(review.get('bindingSha256'),str) and len(review['bindingSha256'])==64 and all(ch in 'abcdef0123456789' for ch in review['bindingSha256']) and review=={'contractVersion':'cop-legacy-provenance-root-review-v1','policySha256':p['_legacyPolicySha256'],'candidateSha256':p['_legacySha256'],'sourceRevision':p['sourceRevision'],'imageId':p['imageId'],'expectedActive':current,'policyWriterWitnessSha256':digest(w['policy']),'bindingSha256':review.get('bindingSha256')},'legacy_missing_receipt_review_changed');durable_required=True;code='LEGACY_DURABLE_SQL_READBACK_REQUIRED'
   else:
    paused_legacy_proof(p,current,env,c,plan,policy,wrapper,review,w,r.require);recoverable=True;transfer=wrapper.get('durableReceiptTransfer',{});completed_reuse=wrapper.get('provenanceComplete') is True and wrapper.get('hostCustodyConfirmed') is True and transfer.get('verified') is True and transfer.get('purged') is True and transfer.get('userRowsChanged') is False and transfer.get('receiptSha256')==digest(wrapper['sqlEnrollmentReceipt']);code='LEGACY_COMPLETED_STABLE_READBACK_REQUIRED' if completed_reuse else 'LEGACY_PENDING_READONLY_VERIFIER_REQUIRED'
  except Exception:pass
 r.require(st.pointer()==current and operator_profile_witness(st,current,directory,profile,r.require)==profile_witness,'legacy_status_profile_changed');st.docker.unchanged(directory,actual);now=st.docker.current(directory);r.require(now['State'].get('Paused') is paused and now['State']['Pid']==actual['State']['Pid'] and now['State']['StartedAt']==actual['State']['StartedAt'],'legacy_status_process_changed')
 print(json.dumps({'paused':paused,'recoverable':recoverable,'durableReadbackRequired':durable_required,'completedReuseRequired':completed_reuse,'code':code,'readOnly':True,'mutated':False}))
`;
export const PENDING_QUARANTINE_PROGRAM=String.raw`
import hashlib,json,pathlib,sys,types

def owned_pending_target(p,pointer,pending,binding,actual,require):
 require(pointer==p['expectedActive'] and pending.get('previous')==pointer and pending.get('targetReleaseId')==binding.get('releaseId'),'pending_quarantine_cas_changed')
 require(binding.get('imageId')==p['imageId'] and binding.get('sourceRevision')==p['sourceRevision'] and bool(binding.get('accountErasureConfig')),'pending_quarantine_source_unowned')
 labels=actual['Config'].get('Labels',{});env=dict(v.split('=',1) for v in actual['Config'].get('Env',[]) if '=' in v)
 require(actual['Image']==p['imageId'] and labels.get('com.docker.compose.project')=='cop' and labels.get('com.docker.compose.service')=='cop-api' and labels.get('com.cop.runtime.release')==binding['releaseId'] and labels.get('com.cop.runtime.profile-generation')==binding['profileGeneration'],'pending_quarantine_container_unowned')
 require(pending.get('targetContainerId') in (None,actual['Id']) and actual['State']['Running'] and actual['State'].get('Pid',0)>0 and env.get('COP_ACCOUNT_SAFETY_GUARD_REQUIRED')=='true' and env.get('COP_ACCOUNT_ERASURE_ENABLED')=='true','pending_quarantine_intake_unproven')
 return actual['Id']

# Production quarantine is limited to the exact owned, journaled target.
p=json.loads(sys.stdin.read());base=pathlib.Path('/srv/cop')
def load_checked(name,relative):
 raw=(base/relative).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=p['fileSha256'][relative]:raise RuntimeError('install_source_changed')
 m=types.ModuleType(name);m.__file__=str(base/relative);exec(compile(raw,m.__file__,'exec'),m.__dict__);return m
r=load_checked('runtime','scripts/cop-api-runtime.py');storage=load_checked('storage','scripts/cop-storage.py')
with storage.operation_lock():
 st=r.Store(uid=1000,guard=storage.preflight);pointer=st.pointer();pending=json.loads(r.private_read(st.root/'pending.json',1000));directory,binding,profile=st.binding(pending['targetReleaseId'],probe_mounts=False);actual=st.docker.current(directory)
 target=owned_pending_target(p,pointer,pending,binding,actual,r.require)
 if not actual['State'].get('Paused'):st.docker.run(['docker','pause',target])
 after=st.docker.current(directory);r.require(after['Id']==target and after['Image']==actual['Image'] and after['State']['Running'] and after['State']['Paused'] and after['State']['Pid']==actual['State']['Pid'] and after['State']['StartedAt']==actual['State']['StartedAt'],'pending_quarantine_pause_unproven');st.docker.unchanged(directory,actual)
 print(json.dumps({'phase':'owned_pending_intake_suspended','intakeSuspended':True,'erasureEnabled':None,'pendingJournalPreserved':True,'imageId':p['imageId'],'containerId':target}))
`;
export function validateCompletionManifest(v){
 need(v&&same(Object.keys(v).sort(),['contractVersion','phase','releasePlanSha256','finalConfigurationSha256','legacyProvenancePolicySha256','legacyProvenancePlanSha256','ownerReadinessReceiptSha256'].sort())&&v.contractVersion==='cop-production-erasure-completion-v2'&&['initial','configuration','provenance','media','media_closed','prepared','enabled'].includes(v.phase)&&hex.test(v.releasePlanSha256)&&hex.test(v.finalConfigurationSha256)&&hex.test(v.legacyProvenancePolicySha256)&&(v.legacyProvenancePlanSha256===null||hex.test(v.legacyProvenancePlanSha256))&&(v.ownerReadinessReceiptSha256===null||hex.test(v.ownerReadinessReceiptSha256)),'COMPLETION_MANIFEST_INVALID');return v;
}
function rootJsonWrite(path,value,previous){
 need([PLAN,COMPLETION,READINESS,DIR+'/legacy-provenance-receipt.json',DIR+'/media-runtime-canary.json',DIR+'/control-plan-transition.json'].includes(path),'INSTALL_PUBLIC_OUTPUT_SCOPE');
 const directory=lstatSync(DIR);need(directory.isDirectory()&&!directory.isSymbolicLink()&&directory.uid===0&&(directory.mode&0o777)===0o700,'INSTALL_ROOT_DIRECTORY_CUSTODY');
 if(previous===undefined)need(!existsSync(path),'INSTALL_OUTPUT_EXISTS');else need(file(path,true).equals(previous),'INSTALL_PUBLIC_CAS_CHANGED');
 const temporary=path+'.atomic-'+randomBytes(12).toString('hex'),bytes=Buffer.from(JSON.stringify(value)+'\n');let fd;
 try{fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);fchownSync(fd,0,0);fchmodSync(fd,0o600);writeFileSync(fd,bytes);fsyncSync(fd);closeSync(fd);fd=undefined;if(previous===undefined)need(!existsSync(path),'INSTALL_OUTPUT_EXISTS');else need(file(path,true).equals(previous),'INSTALL_PUBLIC_CAS_CHANGED');renameSync(temporary,path);const parent=openSync(dirname(path),constants.O_RDONLY);try{fsyncSync(parent);}finally{closeSync(parent);}}finally{if(fd!==undefined)closeSync(fd);try{unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
 need(file(path,true).equals(bytes),'INSTALL_PUBLIC_READBACK_CHANGED');return bytes;
}
export function validateMediaPlanTransition(transition,completion,currentBytes){
 need(transition&&same(Object.keys(transition).sort(),['contractVersion','previousReleasePlanSha256','nextReleasePlanSha256','nextPlan','sourceRevision','imageId','expectedActive','receiptSha256'].sort())&&transition.contractVersion==='cop-production-media-plan-transition-v1'&&['previousReleasePlanSha256','nextReleasePlanSha256','receiptSha256'].every(k=>hex.test(transition[k])),'MEDIA_PLAN_TRANSITION_INVALID');
 const next=validatePlan(transition.nextPlan),current=validatePlan(JSON.parse(currentBytes));need(next.operation==='prepare'&&next.sourceRevision===transition.sourceRevision&&next.imageId===transition.imageId&&same(next.expectedActive,transition.expectedActive)&&next.mediaClosureEvidenceSha256===transition.receiptSha256&&sha(Buffer.from(JSON.stringify(next)+'\n'))===transition.nextReleasePlanSha256,'MEDIA_PLAN_TRANSITION_TARGET_CHANGED');
 need(['media','media_closed'].includes(completion.phase)&&[transition.previousReleasePlanSha256,transition.nextReleasePlanSha256].includes(completion.releasePlanSha256)&&[transition.previousReleasePlanSha256,transition.nextReleasePlanSha256].includes(sha(currentBytes))&&same({...current,mediaClosureEvidenceSha256:next.mediaClosureEvidenceSha256},next),'MEDIA_PLAN_TRANSITION_UNOWNED');return next;
}
export function recoverableLegacySeal(value,reviewedSha256,actualFingerprint){
 need(value?.binding&&hex.test(actualFingerprint)&&value.binding.configurationFingerprint===actualFingerprint&&sha(JSON.stringify({...value,binding:{...value.binding,configurationFingerprint:null}}))===reviewedSha256,'LEGACY_SEAL_RECOVERY_UNPROVEN');return sha(JSON.stringify(value));
}
export const DATABASE_READBACK_HOST_PROGRAM=String.raw`${OPERATOR_PROFILE_HOST_CHECK}
import hashlib,json,pathlib,subprocess,sys,types
p=json.loads(sys.stdin.read());base=pathlib.Path('/srv/cop')
def load_checked(name,relative):
 raw=(base/relative).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=p['fileSha256'][relative]:raise RuntimeError('install_source_changed')
 m=types.ModuleType(name);m.__file__=str(base/relative);exec(compile(raw,m.__file__,'exec'),m.__dict__);return m
r=load_checked('runtime','scripts/cop-api-runtime.py');storage=load_checked('storage','scripts/cop-storage.py')
with storage.operation_lock():
 for relative,digest in p['fileSha256'].items():r.require(hashlib.sha256((base/relative).read_bytes()).hexdigest()==digest,'readback_source_changed')
 st=r.Store(uid=1000,guard=storage.preflight);current,directory,binding,profile=st.active();r.require(current==p['expectedActive'],'readback_active_changed')
 metadata=r.environment_metadata(base/'.env',1000);actual=st.docker.current(directory);witness=operator_profile_witness(st,current,directory,profile,r.require)
 r.require(isinstance(p.get('_requireMedia'),bool),'readback_fixed_operation')
 args=['docker','--host','unix:///var/run/docker.sock','run','--rm','--pull','never','--log-driver','none','--network','host','--hostname','docker','--read-only','--user','0:0','--cap-drop','ALL','--cap-add','DAC_OVERRIDE','--security-opt','no-new-privileges','--mount','type=bind,src=/srv/cop,dst=/srv/cop,readonly','--mount','type=bind,src=/etc/vcode-cop-pgbouncer/postgres-ca.crt,dst=/etc/vcode-cop-pgbouncer/postgres-ca.crt,readonly','--mount','type=bind,src='+witness['directory']+',dst='+witness['directory']+',readonly','--entrypoint','node',p['imageId'],'/app/scripts/account-safety/install-production-erasure.mjs','--database-readback' if p['_requireMedia'] else '--preparation-readback','/srv/cop/runtime/account-erasure-install/release-plan.json']
 result=subprocess.run(args,capture_output=True,env={'PATH':'/usr/bin:/bin','LANG':'C'})
 r.require(st.pointer()==current and r.environment_metadata(base/'.env',1000)==metadata and operator_profile_witness(st,current,directory,profile,r.require)==witness,'readback_profile_changed');st.docker.unchanged(directory,actual)
 r.require(result.returncode==0 and len(result.stdout)<=1048576,'readback_worker_failed');print(result.stdout.decode().strip())
`;
export function hostDatabaseReadback(plan,requireMedia=false){
 const value=runPinnedPython(DATABASE_READBACK_HOST_PROGRAM,{...plan,_requireMedia:requireMedia});
 need(value.databaseReadback===true&&value.mutated===false&&(!requireMedia||value.mediaReadback===true),'INSTALL_RESUME_DATABASE_UNPROVEN');return value;
}
async function recoverLegacyTemplateSeal(){
 const before=file(COMPLETION,true),completion=validateCompletionManifest(JSON.parse(before));if(completion.phase!=='initial')return;
 const raw=file(POLICY,true),legacy=JSON.parse(raw),actualDigest=sha(JSON.stringify(legacy));if(actualDigest===completion.legacyProvenancePolicySha256)return;
 const plan=checkedPlan(PLAN);need(sha(file(PLAN,true))===completion.releasePlanSha256,'LEGACY_SEAL_RECOVERY_PLAN_CHANGED');validateWholeReceipt(plan,JSON.parse(file(plan.wholeAcceptancePath,true)),checkedCandidateClosure(plan));
 const {inspectProductionStorageTransport}=await import('./install-media-upload-closure.mjs');need(inspectProductionStorageTransport().storageTransportVerified===true,'INSTALL_STORAGE_ROOT_TRANSPORT_UNAVAILABLE');
 hostDatabaseReadback(plan,false);const envBefore=file(ROOT+'/.env'),env=(await import('./provision-database-v2.mjs')).parseEnvironment(envBefore.toString());
 const fingerprint=sha('cop-account-erasure-config-v1\0'+env.get('COP_ACCOUNT_ERASURE_SECRET'));recoverableLegacySeal(legacy,completion.legacyProvenancePolicySha256,fingerprint);
 need(legacy.binding.guardStoreId===env.get('COP_ACCOUNT_SAFETY_GUARD_STORE_ID')&&legacy.binding.applicationStoreId===env.get('COP_ACCOUNT_SAFETY_STORE_ID')&&legacy.binding.incarnationId===env.get('COP_ACCOUNT_SAFETY_INCARNATION_ID')&&legacy.binding.restoreGeneration===1&&file(POLICY,true).equals(raw)&&file(ROOT+'/.env').equals(envBefore),'LEGACY_SEAL_RECOVERY_BINDING_CHANGED');
 rootJsonWrite(COMPLETION,{...completion,legacyProvenancePolicySha256:actualDigest},before);
}
export function validateControlPlanTransition(t,completion,currentBytes,actual){
 need(t&&same(Object.keys(t).sort(),['contractVersion','previousReleasePlanSha256','nextReleasePlanSha256','nextPlan'].sort())&&t.contractVersion==='cop-production-control-plan-transition-v1'&&hex.test(t.previousReleasePlanSha256)&&hex.test(t.nextReleasePlanSha256),'CONTROL_PLAN_TRANSITION_INVALID');
 const next=validatePlan(t.nextPlan),current=validatePlan(JSON.parse(currentBytes));need(['maintain','enable','pause'].includes(next.operation)&&sha(JSON.stringify(next)+'\n')===t.nextReleasePlanSha256&&same({...current,expectedActive:next.expectedActive,operation:next.operation},next)&&[t.previousReleasePlanSha256,t.nextReleasePlanSha256].includes(sha(currentBytes))&&[t.previousReleasePlanSha256,t.nextReleasePlanSha256].includes(completion.releasePlanSha256),'CONTROL_PLAN_TRANSITION_SCOPE');
 need(actual.guarded&&actual.guardRequired&&actual.active.imageId===next.imageId&&actual.sourceRevision===next.sourceRevision&&same(actual.active,next.expectedActive),'CONTROL_PLAN_TRANSITION_RUNTIME_UNPROVEN');return next;
}
async function recoverControlPlanTransition(){
 const path=DIR+'/control-plan-transition.json';if(!existsSync(path))return;
 const before=file(COMPLETION,true),completion=validateCompletionManifest(JSON.parse(before)),current=file(PLAN,true),t=JSON.parse(file(path,true));
 if(completion.releasePlanSha256===sha(current)&&sha(current)!==t.previousReleasePlanSha256)return;
 const candidate=validatePlan(t.nextPlan);for(const[k,h]of Object.entries(candidate.fileSha256))need(sha(file(ROOT+'/'+k))===h,'INSTALL_SOURCE_CHANGED');
 const actual=runPinnedPython(RUNTIME_INSPECTION_PROGRAM,candidate),next=validateControlPlanTransition(t,completion,current,actual);hostDatabaseReadback(next,true);
 need(same(actual,runPinnedPython(RUNTIME_INSPECTION_PROGRAM,next)),'CONTROL_PLAN_TRANSITION_RUNTIME_CHANGED');
 const bytes=sha(current)===t.nextReleasePlanSha256?current:rootJsonWrite(PLAN,next,current);need(sha(bytes)===t.nextReleasePlanSha256,'CONTROL_PLAN_TRANSITION_WRITE_CHANGED');rootJsonWrite(COMPLETION,{...completion,releasePlanSha256:sha(bytes)},before);
}
async function recoverMediaPlanTransition(){
 if(!existsSync(DIR+'/media-plan-transition.json'))return;
 const before=file(COMPLETION,true),completion=validateCompletionManifest(JSON.parse(before)),planBytes=file(PLAN,true);
 const transition=JSON.parse(file(DIR+'/media-plan-transition.json',true));if(completion.releasePlanSha256===sha(planBytes)&&sha(planBytes)!==transition.previousReleasePlanSha256)return;
 const next=validateMediaPlanTransition(transition,completion,planBytes);
 for(const[k,h]of Object.entries(next.fileSha256))need(sha(file(ROOT+'/'+k))===h,'INSTALL_SOURCE_CHANGED');
 need(sha(file(next.mediaClosureEvidencePath,true))===transition.receiptSha256,'MEDIA_PLAN_TRANSITION_RECEIPT_CHANGED');
 const {verifyProductionMediaClosure}=await import('./install-media-upload-closure.mjs');need(verifyProductionMediaClosure(transition.receiptSha256).verified===true,'MEDIA_PLAN_TRANSITION_READBACK_UNPROVEN');
 const written=sha(planBytes)===transition.nextReleasePlanSha256?planBytes:rootJsonWrite(PLAN,next,planBytes);need(sha(written)===transition.nextReleasePlanSha256,'MEDIA_PLAN_TRANSITION_WRITE_CHANGED');
 rootJsonWrite(COMPLETION,{...completion,releasePlanSha256:sha(written)},before);
}
function checkedCompletion(path){
 need(path===COMPLETION,'COMPLETION_FIXED_PATH');const value=validateCompletionManifest(JSON.parse(file(path,true)));need(sha(file(PLAN,true))===value.releasePlanSha256&&sha(file(CONFIGURATION,true))===value.finalConfigurationSha256,'COMPLETION_INPUT_CHANGED');
 const p=checkedPlan(PLAN),configuration=JSON.parse(file(CONFIGURATION,true));need(configuration.contractVersion==='cop-production-erasure-final-configuration-v1'&&configuration.sourceRevision===p.sourceRevision&&configuration.imageId===p.imageId&&hex.test(configuration.edgeContainerId),'COMPLETION_CONFIGURATION_BINDING');
 need(sha(JSON.stringify(JSON.parse(file(POLICY,true))))===value.legacyProvenancePolicySha256,'COMPLETION_LEGACY_POLICY_CHANGED');
 if(value.legacyProvenancePlanSha256!==null)need(sha(JSON.stringify(JSON.parse(file(LEGACY,true))))===value.legacyProvenancePlanSha256,'COMPLETION_LEGACY_PLAN_CHANGED');
 return value;
}
export function verifiedOwnerReadiness(body,response,before,after,now=Date.now()){
 need(response.status===200&&typeof response.cacheControl==='string'&&response.cacheControl.toLowerCase().split(',').map(v=>v.trim()).includes('no-store'),'OWNER_READINESS_HTTP_UNPROVEN');
 need(before.guarded&&before.guardRequired&&same(before,after)&&before.active.imageId===response.imageId&&Array.isArray(body.dependencies),'OWNER_READINESS_RUNTIME_CHANGED');
 const matches=body.dependencies.filter(v=>v?.name==='cop-account-erasure-owners');need(matches.length===1&&matches[0].status==='ok'&&typeof matches[0].checkedAt==='string','OWNER_READINESS_NOT_READY');
 const age=now-Date.parse(matches[0].checkedAt);need(Number.isFinite(age)&&age>=0&&age<=30000,'OWNER_READINESS_STALE');
 return {contractVersion:'cop-production-erasure-owner-readiness-v1',active:before.active,imageId:response.imageId,sourceRevision:before.sourceRevision,containerStartedAt:before.startedAt,observedAt:new Date(now).toISOString(),dependency:{name:matches[0].name,status:'ok',checkedAt:matches[0].checkedAt},endpoint:'/health/dependencies',httpStatus:200};
}
export function validateForwardRuntime(actual,plan,completion){
 need(['media_closed','prepared','enabled'].includes(completion.phase)&&actual.guarded&&actual.guardRequired&&actual.active.imageId===plan.imageId&&actual.sourceRevision===plan.sourceRevision&&same(actual.configPrevious,plan.expectedActive)&&actual.previousReleaseId===plan.expectedActive.releaseId,'INSTALL_FORWARD_RUNTIME_UNOWNED');return true;
}
export async function runCompleteRelease(d){
 let phase='preflight',enableAttempted=false,intake=null,intakeSuspended=false,mediaUnavailable=false,apiUnavailable=false;
 const pending=(code)=>({phase:'production_release_pending',stage:phase,code,releaseComplete:false,wholeAccountComplete:false,erasureEnabled:intake,...(apiUnavailable?{temporaryApiUnavailable:true}:{}),...(mediaUnavailable?{temporaryMediaUnavailable:true}:{}),...(intakeSuspended?{intakeSuspended:true}:{})});
 const pause=async()=>{try{const result=await d.pauseOnFailure();intake=result?.erasureEnabled===false?false:null;intakeSuspended=result?.intakeSuspended===true;}catch{intake=null;}};
 try{
  const state=await d.preflight();if(!state.ready){apiUnavailable=state.temporaryApiUnavailable===true;return pending(state.code);}intake=state.stage==='enabled';let stage=state.stage;
  need(['initial','configuration','provenance','media','media_closed','prepared','enabled'].includes(stage),'INSTALL_CHECKPOINT_INVALID');
  mediaUnavailable=stage==='media_closed';
  const checkpoint=async next=>{need(typeof d.recordCheckpoint==='function','INSTALL_DURABLE_CHECKPOINT_MISSING');await d.recordCheckpoint(next);stage=next;};
  if(stage==='initial'){
   phase='authority_preparation';await d.normalize();await d.prepareAuthority();
   phase='database_and_keycloak';await d.database();await d.keycloak();await checkpoint('configuration');
  }
  if(stage==='configuration'){phase='final_configuration';await d.finalConfiguration();await checkpoint('provenance');}
  if(stage==='provenance'){phase='legacy_provenance';const provenance=await d.provenance();if(!provenance.ready)return pending(provenance.code);await checkpoint('media');}
  if(stage==='media'){
   phase='candidate_prevalidation';await d.imageAttestation();
   phase='media_closure';mediaUnavailable=true;await d.media();await checkpoint('media_closed');
  }
  if(stage==='media_closed'){
   phase='guarded_prepare';await d.imageAttestation();await d.prepareProof();await d.deployPrepare();await d.recordPrepared();stage='prepared';mediaUnavailable=false;
  }
  phase='owner_readiness';const ready=await d.readiness();if(!ready.ready){if(intake)await pause();return pending(ready.code);}
  if(stage!=='enabled'){phase='enable';enableAttempted=true;intake=null;await d.enable();intake=true;}
  phase='production_postcheck';await d.postcheck();await d.recordComplete();
  return {phase:'production_release_complete',releaseComplete:true,wholeAccountComplete:false,accountDeletionPerformed:false,erasureEnabled:true};
 }catch(error){apiUnavailable=error?.temporaryApiUnavailable===true;if(enableAttempted||intake)await pause();const code=typeof error?.message==='string'&&/^[A-Z_]{5,80}$/u.test(error.message)?error.message:'PRODUCTION_RELEASE_FAILED';return pending(code);}
}
async function privatePrompt(label){
 need(process.stdin.isTTY&&process.stdout.isTTY,'INSTALL_TTY_REQUIRED');process.stdout.write(label);process.stdin.setEncoding('utf8');process.stdin.setRawMode(true);process.stdin.resume();
 return new Promise((resolve,reject)=>{let value='';const done=()=>{process.stdin.off('data',data);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');};const data=chunk=>{for(const c of chunk.toString()){if(c==='\u0003'){done();reject(Error('INSTALL_CANCELLED'));return;}if(c==='\n'||c==='\r'){done();resolve(value);return;}if(c==='\b'||c==='\u007f')value=value.slice(0,-1);else if(c>=' '&&value.length<4096)value+=c;}};process.stdin.on('data',data);});
}
function runPinnedPython(program,payload,interactive=false){
 const result=spawnSync('python3',['-B','-c',program],{input:JSON.stringify(payload),encoding:'utf8',maxBuffer:1048576,...(interactive?{}:{timeout:120000}),env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C',PYTHONDONTWRITEBYTECODE:'1'}});need(result.status===0&&!result.error,'INSTALL_FIXED_STAGE_FAILED');return JSON.parse(result.stdout);
}
async function completeHostRelease(path){
 need(path===COMPLETION,'COMPLETION_FIXED_PATH');const plan=checkedPlan(PLAN),whole=file(plan.wholeAcceptancePath,true);need(sha(whole)===plan.wholeAcceptanceSha256,'INSTALL_WHOLE_CHANGED');validateWholeReceipt(plan,JSON.parse(whole),checkedCandidateClosure(plan));
 const {prepareProductionStorageTransport,inspectProductionStorageProviderTransport}=await import('./install-media-upload-closure.mjs');const stopTransport=prepareProductionStorageTransport();let result;
 try{need(inspectProductionStorageProviderTransport().storageTransportVerified===true,'INSTALL_STORAGE_ROOT_TRANSPORT_UNAVAILABLE');result=await completeHostReleaseWithStorage(path);}finally{stopTransport();}
 console.log(JSON.stringify(result));if(result.releaseComplete!==true)process.exitCode=2;
}
async function completeHostReleaseWithStorage(path){
 need(path===COMPLETION,'COMPLETION_FIXED_PATH');await recoverControlPlanTransition();await recoverLegacyTemplateSeal();await recoverMediaPlanTransition();
 let completion=checkedCompletion(path);let plan=checkedPlan(PLAN),password='',attestation,proof;
 const updateCompletion=patch=>{const before=file(COMPLETION,true),current=validateCompletionManifest(JSON.parse(before));rootJsonWrite(COMPLETION,validateCompletionManifest({...current,...patch}),before);};
 const inspect=()=>runPinnedPython(RUNTIME_INSPECTION_PROGRAM,plan);
 const step=mode=>JSON.parse(command(['/usr/bin/node',SELF,mode,PLAN]));
 const runtimeMedia=async()=>{
  const before=inspect();need(before.guarded&&before.guardRequired&&before.active.imageId===plan.imageId&&before.sourceRevision===plan.sourceRevision,'INSTALL_MEDIA_RUNTIME_UNPROVEN');
  const path=DIR+'/media-runtime-canary.json',existing=existsSync(path)?file(path,true):undefined;
  const prior=existing?JSON.parse(existing):undefined;need(!prior||prior.contractVersion==='cop-production-runtime-media-canary-v1'&&prior.imageId===plan.imageId,'INSTALL_MEDIA_CANARY_SCOPE_CHANGED');
  const key=prior?.state==='pending'?prior.objectKey:'community-reports/'+cryptoUuid()+'/'+cryptoUuid()+'/release-check.txt';
  const input={contractVersion:'cop-production-runtime-media-canary-v1',imageId:plan.imageId,objectKey:key,state:'pending',resume:prior?.state==='pending'};rootJsonWrite(path,input,existing);
  const code="import{verifyRuntimeMediaRoundTrip}from'/app/scripts/account-safety/install-media-upload-closure.mjs';let raw='';for await(const c of process.stdin){raw+=c;if(raw.length>8192)process.exit(1)}try{const v=JSON.parse(raw);await verifyRuntimeMediaRoundTrip(v.objectKey,v.resume);console.log(JSON.stringify({verified:true,canaryRemoved:true}))}catch{process.exit(1)}";
  const value=JSON.parse(command(['docker','--host','unix:///var/run/docker.sock','exec','-i',before.active.containerId,'node','--input-type=module','-e',code],JSON.stringify(input)));
  need(value.verified===true&&value.canaryRemoved===true&&same(before,inspect()),'INSTALL_RUNTIME_MEDIA_READ_WRITE_FAILED');rootJsonWrite(path,{...input,state:'verified'},file(path,true));
 };
 const ensurePassword=async()=>{if(!password){password=await privatePrompt('PostgreSQL administrator password (not echoed): ');need(password.length>0,'INSTALL_POSTGRES_PASSWORD_MISSING');}};
 const readback=(requireMedia=false)=>hostDatabaseReadback(plan,requireMedia);
 const legacyStatus=()=>runPinnedPython(LEGACY_PAUSED_STATUS_PROGRAM,{...plan,_legacySha256:completion.legacyProvenancePlanSha256,_legacyPolicySha256:completion.legacyProvenancePolicySha256});
 const legacy=async(verify,recoverDurable=false,completed=false)=>{await ensurePassword();try{const fresh=!verify&&completion.legacyProvenancePlanSha256===null;const result=runPinnedPython(fresh?LEGACY_FRESH_HOST_STAGE_PROGRAM:LEGACY_HOST_STAGE_PROGRAM,{...plan,_legacySha256:completion.legacyProvenancePlanSha256,_legacyPolicySha256:completion.legacyProvenancePolicySha256,_password:password,_legacyVerify:verify,_legacyRecoverDurable:recoverDurable,_legacyCompleted:completed},true);need(result.hostCustodyConfirmed&&result.provenanceComplete&&(!verify||result.verified===true),'INSTALL_LEGACY_READBACK_UNPROVEN');completion=checkedCompletion(path);return result;}catch(error){try{error.temporaryApiUnavailable=legacyStatus().paused===true;}catch{}throw error;}};

 const changePlan=(active,operation)=>{
  const before=file(PLAN,true),cBytes=file(COMPLETION,true),c=validateCompletionManifest(JSON.parse(cBytes));need(c.releasePlanSha256===sha(before),'CONTROL_PLAN_TRANSITION_PRIOR_PENDING');
  const next=validatePlan({...JSON.parse(before),expectedActive:active,operation}),nextBytes=Buffer.from(JSON.stringify(next)+'\n'),transition={contractVersion:'cop-production-control-plan-transition-v1',previousReleasePlanSha256:sha(before),nextReleasePlanSha256:sha(nextBytes),nextPlan:next};
  const actual=inspect();validateControlPlanTransition(transition,c,before,actual);
  const path=DIR+'/control-plan-transition.json';rootJsonWrite(path,transition,existsSync(path)?file(path,true):undefined);need(same(actual,inspect()),'CONTROL_PLAN_TRANSITION_RUNTIME_CHANGED');
  const bytes=rootJsonWrite(PLAN,next,before);rootJsonWrite(COMPLETION,{...c,releasePlanSha256:sha(bytes)},cBytes);plan=next;
 };
 const deploy=()=>{
  need(attestation?.attestationPath&&proof?.proofPath,'INSTALL_DEPLOY_PROOFS_MISSING');
  const args=['-u','voldzi','--','/usr/bin/env','PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','/srv/cop/scripts/deploy-production.sh','--api-image',plan.imageId,'--api-source',plan.sourceRevision,'--api-attestation',attestation.attestationPath,'--api-erasure-config',proof.proofPath];
  const result=spawnSync('/usr/sbin/runuser',args,{encoding:'utf8',maxBuffer:1048576,timeout:240000,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C'}});need(result.status===0&&!result.error,'INSTALL_GUARDED_DEPLOY_FAILED');
 };
 const readiness=async()=>{
  const before=inspect(),response=await fetch('http://127.0.0.1:4310/health/dependencies',{method:'GET',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'cache-control':'no-cache',DNT:'1','Sec-GPC':'1'}});
  need(response.body,'OWNER_READINESS_BODY_MISSING');const reader=response.body.getReader(),chunks=[];let size=0;try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;need(size<=262144,'OWNER_READINESS_TOO_LARGE');chunks.push(item.value);}}finally{reader.releaseLock();}
  const value=verifiedOwnerReadiness(JSON.parse(Buffer.concat(chunks).toString()),{status:response.status,cacheControl:response.headers.get('cache-control'),imageId:plan.imageId},before,inspect());
  const bytes=rootJsonWrite(READINESS,value,existsSync(READINESS)?file(READINESS,true):undefined);updateCompletion({ownerReadinessReceiptSha256:sha(bytes)});return value;
 };
 const prepareIntake=async(operation)=>{
  const current=inspect();need(current.active.imageId===plan.imageId&&current.guarded&&current.guardRequired,'INSTALL_GUARDED_RUNTIME_MISSING');changePlan(current.active,operation);
  runPinnedPython(INTAKE_TRANSITION_PROGRAM,{...plan,_intakeOperation:operation,_readinessSha256:operation==='enable'?sha(file(READINESS,true)):undefined});attestation=step('--write-image-attestation');proof=step('--write-proof');deploy();
 };
 try{
  const result=await runCompleteRelease({
   preflight:async()=>{
    const paused=legacyStatus();if(paused.paused){if(!paused.recoverable&&!paused.durableReadbackRequired)return {ready:false,code:paused.code,temporaryApiUnavailable:true};await legacy(true,paused.durableReadbackRequired===true,paused.completedReuseRequired===true);need(legacyStatus().paused===false,'LEGACY_VERIFIED_UNPAUSE_FAILED');}
    const whole=file(plan.wholeAcceptancePath,true);need(sha(whole)===plan.wholeAcceptanceSha256,'INSTALL_WHOLE_CHANGED');validateWholeReceipt(plan,JSON.parse(whole),checkedCandidateClosure(plan));
    need(hex.test(completion.legacyProvenancePolicySha256),'LEGACY_PROVENANCE_POLICY_MISSING');
    const actual=inspect();
    if(actual.guarded&&actual.guardRequired&&actual.active.imageId===plan.imageId&&actual.sourceRevision===plan.sourceRevision){
     if(!same(actual.active,plan.expectedActive)){validateForwardRuntime(actual,plan,completion);changePlan(actual.active,'maintain');updateCompletion({phase:actual.intakeEnabled?'enabled':'prepared'});completion=checkedCompletion(path);}
     need(['prepared','enabled','media_closed'].includes(completion.phase),'INSTALL_GUARDED_CHECKPOINT_UNPROVEN');step('--check');await runtimeMedia();return {ready:true,stage:actual.intakeEnabled?'enabled':'prepared'};
    }
    need(same(actual.active,plan.expectedActive)&&!actual.guardRequired&&!actual.intakeEnabled,'INSTALL_INITIAL_RUNTIME_CHANGED');
    const {inspectProductionStorageTransport,verifyProductionMediaClosure}=await import('./install-media-upload-closure.mjs');need(inspectProductionStorageTransport().storageTransportVerified===true,'INSTALL_STORAGE_ROOT_TRANSPORT_UNAVAILABLE');
    if(completion.phase==='initial')return {ready:true,stage:'initial'};
    need(['configuration','provenance','media','media_closed'].includes(completion.phase),'INSTALL_RESUME_RUNTIME_UNPROVEN');readback(completion.phase==='media_closed');
    if(['media','media_closed'].includes(completion.phase))await legacy(true,false,true);
    if(completion.phase==='media_closed')need(verifyProductionMediaClosure().verified===true,'INSTALL_MEDIA_READBACK_UNPROVEN');
    return {ready:true,stage:completion.phase};
   },
   normalize:async()=>step('--normalize-legacy-environment'),prepareAuthority:async()=>step('--prepare-authority'),
   database:async()=>{await ensurePassword();runPinnedPython(DATABASE_HOST_STAGE_PROGRAM,{...plan,_planSha256:sha(file(PLAN,true)),_workerMode:'--database-worker-check',_password:password},true);runPinnedPython(DATABASE_HOST_STAGE_PROGRAM,{...plan,_planSha256:sha(file(PLAN,true)),_workerMode:'--database-worker-apply',_password:password,_sealLegacyTemplate:true,_legacyPolicySha256:completion.legacyProvenancePolicySha256},true);completion=checkedCompletion(path);},
   keycloak:async()=>{const result=spawnSync('/usr/bin/node',[SELF,'--keycloak-apply',PLAN],{stdio:'inherit',env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C'}});need(result.status===0&&!result.error,'INSTALL_KEYCLOAK_FAILED');},
   finalConfiguration:async()=>step('--finalize-configuration'),
   provenance:async()=>{const receiptPath=DIR+'/legacy-provenance-receipt.json';if(existsSync(receiptPath)){const actual=await legacy(true,false,true);return actual.verified===true?{ready:true}:{ready:false,code:'LEGACY_PROVENANCE_READBACK_UNPROVEN'};}await step('--write-image-attestation');const {preflightProductionMediaClosure}=await import('./install-media-upload-closure.mjs');await preflightProductionMediaClosure();const result=await legacy(false);if(existsSync(receiptPath))need(same(JSON.parse(file(receiptPath,true)),result),'LEGACY_FRESH_RECEIPT_CHANGED');else rootJsonWrite(receiptPath,result);return result.legacySessions?.activeCount===0?{ready:true}:{ready:false,code:'LEGACY_SESSION_PROVENANCE_REQUIRED'};},
   media:async()=>{const {executeProductionMediaClosure,verifyProductionMediaClosure}=await import('./install-media-upload-closure.mjs');if(existsSync(plan.mediaClosureEvidencePath)){need(verifyProductionMediaClosure().verified===true,'INSTALL_MEDIA_READBACK_UNPROVEN');}else{await ensurePassword();await executeProductionMediaClosure(password);}plan=checkedPlan(PLAN);updateCompletion({releasePlanSha256:sha(file(PLAN,true))});},
   recordCheckpoint:async phase=>{readback(phase==='media_closed');updateCompletion({phase});completion=checkedCompletion(path);},
   imageAttestation:async()=>{attestation=step('--write-image-attestation');},prepareProof:async()=>{proof=step('--write-proof');},deployPrepare:async()=>deploy(),
   recordPrepared:async()=>{const actual=inspect();await runtimeMedia();need(actual.active.imageId===plan.imageId&&actual.guarded&&actual.guardRequired&&!actual.intakeEnabled,'INSTALL_PREPARED_RUNTIME_UNPROVEN');changePlan(actual.active,'maintain');updateCompletion({phase:'prepared'});},
   readiness:async()=>{try{await readiness();return {ready:true};}catch(error){return {ready:false,code:typeof error?.message==='string'&&/^[A-Z_]{5,80}$/u.test(error.message)?error.message:'OWNER_READINESS_UNAVAILABLE'};}},
   enable:async()=>{await readiness();await prepareIntake('enable');},
   postcheck:async()=>{const actual=inspect();await runtimeMedia();need(actual.active.imageId===plan.imageId&&actual.guarded&&actual.guardRequired&&actual.intakeEnabled,'INSTALL_ENABLED_RUNTIME_UNPROVEN');await readiness();},
   recordComplete:async()=>{changePlan(inspect().active,'maintain');updateCompletion({phase:'enabled'});},
   pauseOnFailure:async()=>{let actual;try{actual=inspect();}catch{return runPinnedPython(PENDING_QUARANTINE_PROGRAM,plan);}if(actual.intakeEnabled)await prepareIntake('pause');const current=inspect();need(!current.intakeEnabled&&current.guarded&&current.guardRequired,'INSTALL_PAUSE_UNPROVEN');changePlan(current.active,'maintain');updateCompletion({phase:'prepared'});return {erasureEnabled:false};}
  });
  return {...result,sourceRevision:plan.sourceRevision,imageId:plan.imageId,secretsPrinted:false};
 }finally{password='';}
}

async function databaseReadback(plan,requireMedia=true){
 need(Number(process.versions.node.split('.')[0])===24,'INSTALL_NODE24_REQUIRED');
 const env=new Map(Object.entries(loadOperatorEnvironment()));
 const {createRequire}=await import('node:module');const {Pool}=createRequire('/app/apps/cop-api/package.json')('pg');
 const ca=file('/etc/vcode-cop-pgbouncer/postgres-ca.crt').toString();
 const pool=(value,database,user)=>{const u=new URL(value);need(['postgres:','postgresql:'].includes(u.protocol)&&u.hostname==='haproxy.home.cz'&&u.port==='5000'&&u.pathname==='/'+database&&!u.hash&&(!user||decodeURIComponent(u.username)===user),'INSTALL_FIXED_DATABASE');return new Pool({host:'haproxy.home.cz',port:5000,database,user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),max:1,connectionTimeoutMillis:3000,query_timeout:5000,ssl:{ca,rejectUnauthorized:true,servername:'haproxy.home.cz'},application_name:'cop-root-erasure-readback'});};
 const {databaseContinuityEndpoints}=await import('/app/apps/cop-api/dist/account-erasure-continuity-production.js');
 const routes=databaseContinuityEndpoints(Object.fromEntries(env));
 const guard=pool(routes.guardUrl,'cop_account_safety_guard','cop_safety_v2_runtime'),target=pool(routes.targetUrl,'cop');
 guard.on('error',()=>{});target.on('error',()=>{});
 try{
  const {PostgresAccountErasureContinuity}=await import('/app/apps/cop-api/dist/account-erasure-continuity-postgres.js');
  const {PostgresMediaUploadSettlement,mediaCredentialFingerprint}=await import('/app/apps/cop-api/dist/media-upload-settlement.js');
  const {createMediaStorageFromEnv}=await import('/app/apps/cop-api/dist/media-storage.js');
  const expected={guardStoreId:env.get('COP_ACCOUNT_SAFETY_GUARD_STORE_ID'),applicationStoreId:env.get('COP_ACCOUNT_SAFETY_STORE_ID'),incarnationId:env.get('COP_ACCOUNT_SAFETY_INCARNATION_ID'),configurationFingerprint:createHash('sha256').update('cop-account-erasure-config-v1\0').update(env.get('COP_ACCOUNT_ERASURE_SECRET')??'').digest('hex')};
  const c=new PostgresAccountErasureContinuity(guard,target,expected),snapshot=await c.snapshot();
  const replay=(await guard.query("SELECT replay_sequence,replay_digest FROM cop_safety_v2.dataset_replays WHERE owner='cop'")).rows[0];
  need(Number(replay?.replay_sequence)===snapshot.frontier.sequence&&replay.replay_digest===snapshot.frontier.digest,'INSTALL_REPLAY_NOT_CURRENT');
  const cfg=(await target.query("SELECT value FROM cop_mobility_v1 WHERE key='account-erasure:configuration-v1'")).rows[0]?.value;
  need(cfg?.version===4&&cfg.storeId===expected.applicationStoreId&&cfg.fingerprint===expected.configurationFingerprint&&cfg.datasetBinding?.incarnationId===snapshot.datasetBinding?.incarnationId&&cfg.datasetBinding?.restoreGeneration===snapshot.datasetBinding?.restoreGeneration,'INSTALL_LOCAL_BINDING_UNPROVEN');
  const jobs=(await target.query("SELECT key,value FROM cop_mobility_v1 WHERE left(key,20)='account-erasure:job:'")).rows;
  need(jobs.length===snapshot.entries.length&&snapshot.entries.every(e=>jobs.some(j=>j.key==='account-erasure:job:'+e.accountKey&&j.value.operationId===e.job.operationId&&j.value.requestedAt===e.job.requestedAt&&same(j.value.required,e.job.required))),'INSTALL_REPLAY_JOBS_UNPROVEN');
  need((await target.query('SELECT count(*)::int n FROM cop_community_media_write_leases')).rows[0]?.n===0,'INSTALL_UNKNOWN_MEDIA_WRITE_LEASE');
  if(!requireMedia){need(snapshot.entries.length===0&&jobs.length===0,'INSTALL_PREPARATION_ALREADY_ACCEPTED');console.log(JSON.stringify({databaseReadback:true,mediaReadback:false,firstEnrollmentConfirmed:true,mutated:false}));return;}
  const mediaEvidence=JSON.parse(file(plan.mediaClosureEvidencePath,true));
  const actualClosure=(await guard.query('SELECT provider_image_id,provider_stopped_at,provider_restarted_at,old_credential_denied_at,evidence_digest FROM cop_safety_v2.media_upload_closures WHERE bucket=$1 AND application_store_id=$2 AND incarnation_id=$3 AND restore_generation=$4 AND credential_fingerprint=$5',[env.get('COP_MEDIA_S3_BUCKET'),expected.applicationStoreId,expected.incarnationId,snapshot.datasetBinding.restoreGeneration,mediaCredentialFingerprint(env.get('COP_MEDIA_S3_ACCESS_KEY_ID')??'',env.get('COP_MEDIA_S3_SECRET_ACCESS_KEY')??'')])).rows;
  need(actualClosure.length===1&&actualClosure[0].provider_image_id===mediaEvidence.providerImageId&&actualClosure[0].evidence_digest===sha(file(plan.mediaClosureEvidencePath,true))&&['provider_stopped_at','provider_restarted_at','old_credential_denied_at'].every((key,index)=>actualClosure[0][key].toISOString()===new Date(mediaEvidence[['providerStoppedAt','providerRestartedAt','oldCredentialDeniedAt'][index]]).toISOString()),'INSTALL_MEDIA_RECEIPT_BINDING');
  const settlement=new PostgresMediaUploadSettlement(guard,target,{bucket:env.get('COP_MEDIA_S3_BUCKET'),endpoint:env.get('COP_MEDIA_S3_ENDPOINT'),credentialFingerprint:mediaCredentialFingerprint(env.get('COP_MEDIA_S3_ACCESS_KEY_ID')??'',env.get('COP_MEDIA_S3_SECRET_ACCESS_KEY')??''),applicationStoreId:expected.applicationStoreId,incarnationId:expected.incarnationId});
  const media=createMediaStorageFromEnv(Object.fromEntries(env),{uploadSettlement:settlement});need(media&&await media.verifiedErasureReady(),'INSTALL_ACTUAL_MEDIA_CLOSURE_UNPROVEN');
  console.log(JSON.stringify({databaseReadback:true,mediaReadback:true,mutated:false}));
 }finally{await Promise.all([guard.end(),target.end()]);}
}
async function main(){
 need(process.getuid?.()===0&&hostname().split('.')[0]==='docker'&&!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'INSTALL_ROOT_CONTEXT');
 const [mode,path]=process.argv.slice(2);need(process.argv.length===4&&['--check','--write-proof','--normalize-legacy-environment','--prepare-authority','--finalize-configuration','--write-image-attestation','--complete-release','--database-check','--database-apply','--database-worker-check','--database-worker-apply','--database-worker-input-check','--database-worker-input-apply','--database-readback','--preparation-readback','--keycloak-apply'].includes(mode),'INSTALL_FIXED_OPERATION');
 if(mode==='--complete-release'){await completeHostRelease(path);return;}
 const plan=checkedPlan(path);
 const wholeBytes=file(plan.wholeAcceptancePath,true);need(sha(wholeBytes)===plan.wholeAcceptanceSha256,'INSTALL_RECEIPT_CHANGED');const wholeReceipt=JSON.parse(wholeBytes);
 let actualCompiledClosure;
 if(mode.startsWith('--database-worker-')||['--database-readback','--preparation-readback'].includes(mode)){need(process.argv[1]==='/app/scripts/account-safety/install-production-erasure.mjs','INSTALL_DATABASE_WORKER_CONTEXT');for(const[k,h]of Object.entries(plan.fileSha256)){if(k==='scripts/deploy-production.sh'||k==='scripts/cop-storage.py')continue;need(sha(readFileSync('/app/'+k))===h,'INSTALL_IMAGE_SOURCE_FILE_CHANGED');}actualCompiledClosure=compiledRuntimeClosures('/app');}
 else actualCompiledClosure=checkedCandidateClosure(plan);
 validateWholeReceipt(plan,wholeReceipt,actualCompiledClosure);
 if(mode==='--prepare-authority'){console.log(command(['python3','-B','-c',AUTHORITY_PREPARATION_PROGRAM],JSON.stringify(plan)).trim());return;}
 if(mode==='--finalize-configuration'){const completion=checkedCompletion(COMPLETION);console.log(command(['python3','-B','-c',FINAL_CONFIGURATION_PROGRAM],JSON.stringify({...plan,_planSha256:sha(file(PLAN,true)),_configurationSha256:completion.finalConfigurationSha256})).trim());return;}
 if(mode==='--normalize-legacy-environment'){console.log(command(['python3','-B','-c',ENVIRONMENT_NORMALIZATION_PROGRAM],JSON.stringify(plan)).trim());return;}
 if(mode==='--write-image-attestation'){console.log(command(['python3','-B','-c',IMAGE_ATTESTATION_PROGRAM],JSON.stringify(plan)).trim());return;}
 if(mode==='--database-readback'||mode==='--preparation-readback'){await databaseReadback(plan,mode==='--database-readback');return;}
 if(mode==='--database-check'||mode==='--database-apply'||mode==='--keycloak-apply'){
  const result=spawnSync('python3',['-B','-c',DATABASE_HOST_STAGE_PROGRAM],{input:JSON.stringify({...plan,_planSha256:sha(file(path,true)),_workerMode:mode==='--keycloak-apply'?'--keycloak-apply':mode==='--database-apply'?'--database-worker-apply':'--database-worker-check'}),encoding:'utf8',maxBuffer:1048576,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C',PYTHONDONTWRITEBYTECODE:'1'}});
  need(result.status===0&&!result.error,'INSTALL_DATABASE_HOST_STAGE_FAILED');console.log(result.stdout.trim());return;
 }
 if(mode.startsWith('--database-worker-')){
  const whole=file(plan.wholeAcceptancePath,true);need(sha(whole)===plan.wholeAcceptanceSha256,'INSTALL_RECEIPT_CHANGED');validateWholeReceipt(plan,JSON.parse(whole),actualCompiledClosure);
  need(Number(process.versions.node.split('.')[0])===24&&(mode.includes('-input-')||process.stdin.isTTY&&process.stdout.isTTY),'INSTALL_NODE24_TTY_REQUIRED');
  const {provision}=await import('./provision-database-v2.mjs');
  let password;
  if(mode.includes('-input-')){const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;need(size<=16384,'INSTALL_PRIVATE_INPUT_BOUND');chunks.push(chunk);}const input=JSON.parse(Buffer.concat(chunks).toString());need(same(Object.keys(input).sort(),['contractVersion','password'])&&input.contractVersion==='cop-root-database-credential-v1'&&typeof input.password==='string'&&input.password.length>0&&input.password.length<=4096,'INSTALL_PRIVATE_INPUT_SCHEMA');password=input.password;input.password='';}
  else{
  process.stdout.write('PostgreSQL administrator password (not echoed): ');process.stdin.setEncoding('utf8');process.stdin.setRawMode(true);process.stdin.resume();
  password=await new Promise((resolve,reject)=>{let value='';const done=()=>{process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');};const onData=chunk=>{for(const c of chunk.toString()){if(c==='\u0003'){done();reject(Error('INSTALL_CANCELLED'));return;}if(c==='\n'||c==='\r'){done();resolve(value);return;}if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else if(c>=' '&&value.length<4096)value+=c;}};process.stdin.on('data',onData);});
  }
  try{const result=await provision({mode:mode.endsWith('-check')?'check':'apply',manifestPath:plan.databaseEnrollmentManifestPath,admin:{user:'postgres',password}});let businessSchema;if(mode.endsWith('-apply')){const {prepareBusinessErasureSchema}=await import('./prepare-business-erasure-schema.mjs');businessSchema=await prepareBusinessErasureSchema({mode:'apply',password});}console.log(JSON.stringify({...result,...(businessSchema?{businessSchema}:{})}));}finally{password='';}return;
 }
 const whole=file(plan.wholeAcceptancePath,true),media=file(plan.mediaClosureEvidencePath,true);
 need(sha(whole)===plan.wholeAcceptanceSha256&&sha(media)===plan.mediaClosureEvidenceSha256,'INSTALL_RECEIPT_CHANGED');validateReceipts(plan,JSON.parse(whole),JSON.parse(media),actualCompiledClosure);
 const inspect=JSON.parse(command(['docker','--host','unix:///var/run/docker.sock','image','inspect',plan.imageId]))[0];need(inspect.Id===plan.imageId&&inspect.Config?.Labels?.['org.opencontainers.image.revision']===plan.sourceRevision,'INSTALL_IMAGE_SOURCE');
 const fd=openSync(ROOT+'/.env',constants.O_RDONLY|constants.O_NOFOLLOW);let envMetadata;
 try{const st=fstatSync(fd,{bigint:true});need(st.isFile()&&st.nlink===1n&&st.uid===1000n&&(st.mode&0o777n)===0o600n,'INSTALL_ENV_CUSTODY');envMetadata={device:String(st.dev),inode:String(st.ino),size:String(st.size),mtimeNs:String(st.mtimeNs),ctimeNs:String(st.ctimeNs)};}finally{closeSync(fd);}
 const actual=hostDatabaseReadback(plan,true);
 need(actual.databaseReadback===true&&actual.mediaReadback===true&&actual.mutated===false,'INSTALL_ACTUAL_READBACK_MISSING');
 console.log(command(['python3','-B','-c',pythonProof],JSON.stringify({...plan,_write:mode==='--write-proof',_environmentMetadata:envMetadata})).trim());
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{const code=typeof error?.message==='string'&&/^[A-Z_]{5,80}$/u.test(error.message)?error.message:'PRODUCTION_ERASURE_INSTALL_UNPROVEN';console.error(JSON.stringify({phase:'not_complete',code,wholeAccountComplete:false,servicesChanged:false}));process.exitCode=1;});
