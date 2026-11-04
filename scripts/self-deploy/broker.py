#!/usr/bin/python3
"""Root-owned COP API release broker: fixed status/prepare/activate, no shell API.
Code-only; environment, topology, database roles and runtime profile cannot change.
"""
import copy,datetime,fcntl,hashlib,importlib.util,json,os,re,socket,stat,subprocess,sys,time,types,uuid
from pathlib import Path
LIB=Path(__file__).resolve().parents[2]
STATE=Path('/var/lib/cop-self-release')
REQUEST=Path('/srv/cop/runtime/self-deploy-request.json')
X5=Path('/srv/x5-production/staging/cop')
PROFILE='206c4507-5e00-458e-b0ee-4061309aa7a8'
ROOTENV={'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/root','LANG':'C','DOCKER_HOST':'unix:///var/run/docker.sock','DOCKER_CONFIG':str(LIB/'docker')}
USERENV={'PATH':ROOTENV['PATH'],'HOME':'/home/voldzi','LANG':'C','DOCKER_HOST':'unix:///var/run/docker.sock','GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_NOSYSTEM':'1'}
def need(ok,code):
 if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encode(value):return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def read(path,uid,mode=None,bound=1048576):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode) and s.st_uid==uid and s.st_nlink==1 and s.st_size<=bound and not s.st_mode&0o022,'APP_FILE_CUSTODY')
  if mode is not None:need(stat.S_IMODE(s.st_mode)==mode,'APP_FILE_MODE')
  raw=os.read(fd,bound+1);need(len(raw)==s.st_size,'APP_FILE_CHANGED');return raw
 finally:os.close(fd)
def root_write(path,raw,gid=0,mode=0o600):
 need(not path.exists() and not path.is_symlink(),'APP_EVIDENCE_EXISTS')
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
 try:
  os.fchown(fd,0,gid);os.fchmod(fd,mode);view=memoryview(raw)
  while view:view=view[os.write(fd,view):]
  os.fsync(fd)
 finally:os.close(fd)
def load(path,name):
 raw=read(path,0);m=types.ModuleType(name);m.__file__=str(path);sys.modules[name]=m;exec(compile(raw,str(path),'exec'),m.__dict__);return m

def command(args,*,body=None,user=False,log=None,timeout=600):
 argv=(['/usr/sbin/runuser','-u','voldzi','--','/usr/bin/env','-i',*[k+'='+v for k,v in USERENV.items()]] if user else [])+list(map(str,args))
 p=subprocess.run(argv,input=body,stdout=log if log else subprocess.PIPE,stderr=log if log else subprocess.PIPE,env=ROOTENV,timeout=timeout)
 need(p.returncode==0,'APP_CHILD_COMMAND_FAILED');return p.stdout if not log else b''
def docker(*args):return command(['/usr/bin/docker','--host','unix:///var/run/docker.sock',*args])
def inspect_image(image):return json.loads(docker('image','inspect',image))[0]
def protected_json(path,value):root_write(path,encode(value)+b'\n',1000,0o640)
def request():
 value=json.loads(read(REQUEST,1000,0o600,4096))
 need(set(value)=={'revision','expectedGeneration'} and re.fullmatch('[a-f0-9]{40}',value['revision']) and re.fullmatch('[a-f0-9]{32}',value['expectedGeneration']),'APP_REQUEST_SCOPE');return value

def source_context(policy,revision,validator,copy_module):
 initial=policy['initialCandidate']
 if revision==initial['sourceRevision']:
  context=Path(initial['context']);proof=validator.inspect_context(str(context),revision)
  need(proof['inputDigest']==initial['sourceContextDigest'],'APP_INITIAL_CONTEXT_CHANGED');return context,proof
 remote=command(['/usr/bin/git','-c','core.sshCommand=ssh -o BatchMode=yes -o StrictHostKeyChecking=yes','ls-remote',policy['sourceRepository'],'refs/heads/main','refs/heads/codex/cop-pg-disconnect-recovery'],user=True,timeout=30).decode()
 need(revision in [line.split()[0] for line in remote.splitlines() if len(line.split())==2],'APP_SOURCE_NOT_PUBLISHED_HEAD')
 source=X5/'work'/('cop-source-'+revision);context=X5/('cop-source-'+revision+'-sealed')
 if context.exists():return context,validator.inspect_context(str(context),revision)
 fd=os.open(source,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:
  need(os.fstat(fd).st_uid==1000 and os.fstat(fd).st_dev==X5.stat().st_dev,'APP_SOURCE_SCOPE')
  context.mkdir(mode=0o700);out=os.open(context,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
  try:copy_module.copy_fd_tree(fd,out,1000,[0]);os.fchmod(out,0o500)
  finally:os.close(out)
 finally:os.close(fd)
 for parent,dirs,files in os.walk(context):
  for name in files:
   p=Path(parent)/name;p.chmod(0o555 if p.stat().st_mode&0o111 else 0o444)
  Path(parent).chmod(0o555)
 proof=validator.inspect_context(str(context),revision)
 return context,proof

def shared_build_directory(path,uid=0,gid=1000):
 path.mkdir(mode=0o750);os.chown(path,uid,gid);path.chmod(0o750)

def build(policy,revision,context,case):
 if revision==policy['initialCandidate']['sourceRevision']:
  image=policy['initialCandidate']['imageId'];need(inspect_image(image)['Id']==image,'APP_INITIAL_IMAGE_MISSING');need(sha(read(Path(policy['initialCandidate']['buildReceipt']),1000,0o600))==policy['initialCandidate']['buildReceiptSha256'],'APP_INITIAL_BUILD_RECEIPT_CHANGED');return image,policy['initialCandidate']['buildReceiptSha256']
 recipe=(context/'Dockerfile.api').read_bytes();need(sha(recipe)==policy['sourceDockerfileSha256'] and recipe.count(b'FROM node:24-alpine AS ')==2,'APP_BUILD_RECIPE_CHANGED')
 pinned=recipe.replace(b'FROM node:24-alpine AS ',('FROM '+policy['nodeBase']+' AS ').encode())
 work=X5/('application-build-'+case);shared_build_directory(work);recipepath=work/'Dockerfile.api';root_write(recipepath,pinned,1000,0o440)
 tag='cop-self-release:'+revision
 args=['/usr/bin/docker','--host','unix:///var/run/docker.sock','buildx','build','--builder','cop-x5','--platform','linux/amd64','--load','--progress','plain','--label','org.opencontainers.image.revision='+revision,'--tag',tag,'--file',recipepath,context]
 with (work/'build.log').open('xb') as log:
  os.fchmod(log.fileno(),0o600);command(args,user=True,log=log,timeout=1800)
 image=inspect_image(tag);need(image['Config']['Labels']['org.opencontainers.image.revision']==revision,'APP_BUILT_SOURCE_MISMATCH')
 receipt={'imageId':image['Id'],'revision':revision,'base':policy['nodeBase'],'recipeSha256':sha(pinned)};root_write(work/'receipt.json',encode(receipt))
 return image['Id'],sha(encode(receipt))

def image_tests(image,path):
 tests=['apps/cop-api/src/vehicle-conversation-coordinator.test.ts','apps/cop-api/src/vehicle-conversation-projection.test.ts','apps/cop-api/src/vehicle-conversation-provider.test.ts','apps/cop-api/src/mobility-http.test.ts','apps/cop-api/src/mobility-service.test.ts','apps/cop-api/src/shared-vehicle-erasure.test.ts','apps/cop-api/src/ai-context-startup.test.ts','apps/cop-api/src/provider-copies-erasure.test.ts','apps/cop-api/src/account-erasure-owner-readiness.test.ts']
 wrapper="const fs=require('fs'),cp=require('child_process');const tests="+json.dumps(tests)+";if(!tests.every(n=>fs.statSync(n).isFile()))process.exit(2);const p=cp.spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--reporter=json','--outputFile=/tmp/cop-vitest-report.json',...tests],{encoding:'utf8',maxBuffer:8388608});if(p.status!==0){process.stdout.write(p.stdout||'');process.stderr.write(p.stderr||'');process.exit(p.status||1)}process.stdout.write(fs.readFileSync('/tmp/cop-vitest-report.json','utf8'));"
 args=['/usr/bin/docker','--host','unix:///var/run/docker.sock','run','--rm','--pull','never','--network','none','--read-only','--cap-drop','ALL','--pids-limit','256','--cpus','2','--memory','1536m','--tmpfs','/tmp:rw,nosuid,nodev,size=268435456','-e','HOME=/tmp','-e','XDG_DATA_HOME=/tmp/vitest-data','--entrypoint','node',image,'-e',wrapper]
 with path.open('xb') as log:
  os.fchmod(log.fileno(),0o600);command(args,log=log,timeout=180)
 report=json.loads(path.read_bytes())
 need(report.get('success') is True and report.get('numTotalTestSuites',0)>=9 and report.get('numPassedTests',0)>=109 and report.get('numFailedTests')==0 and report.get('numPendingTests')==0,'APP_ACTUAL_TESTS_INCOMPLETE')

def compatibility(image,case):
 checker=LIB/'scripts/self-deploy/check-image-compatibility.py'
 for mode in ('database','guard'):
  output=command(['/usr/bin/python3','-I',checker,mode,'--image',image,'--local-host'],timeout=120)
  records=[json.loads(line) for line in output.splitlines() if line.startswith(b'{')]
  need(len(records)==1,'APP_COMPATIBILITY_RESPONSE');v=records[0]
  need(v.get('nodeBaseImageId')==image and v.get('productionChanged') is False,'APP_COMPATIBILITY_TARGET')
  if mode=='database':need(v.get('databaseRoutingVerified') is True and v.get('startupDdl') is False and v.get('readOnlySelects') in (3,4),'APP_DATABASE_ROUTING_UNPROVEN')
  else:need(all(v.get(k) is True for k in ('actualX5GuardVerified','wrongUuidRejected','wrongDeviceRejected','missingMountRejected')) and v.get('x5Written') is False,'APP_X5_GUARD_UNPROVEN')
  root_write(case/('actual-'+mode+'-compatibility.json'),encode(v))

def worker(value):
 output=command(['/usr/bin/python3','-I',LIB/'scripts/self-deploy/worker.py'],body=encode(value),user=True,timeout=240)
 lines=[json.loads(line) for line in output.splitlines() if line.startswith(b'{')];need(len(lines)==1,'APP_WORKER_RESPONSE');return lines[0]

def prepare(policy,r,storage):
 req=request();store=r.Store(uid=1000,guard=storage.preflight);store.clean();active,old_dir,binding,profile=store.active()
 need(active['generation']==req['expectedGeneration'],'APP_SOURCE_GENERATION_CHANGED');store.docker.live(old_dir,binding,profile)
 if binding['sourceRevision']==req['revision']:
  print(json.dumps({'alreadyActive':True,'imageId':active['imageId'],'generation':active['generation']}));return
 case_id=str(uuid.uuid4());case=STATE/('case-'+case_id);case.mkdir(mode=0o700)
 validator=load(LIB/'scripts/cop-api-build-context.py','app_context_validator');copy_module=load(LIB/'scripts/self-deploy/prepare-vehicle-context.py','app_copy_context')
 lock=os.open('/srv/cop/.storage.lock',os.O_WRONLY|os.O_APPEND|os.O_NOFOLLOW)
 try:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);storage.preflight()
  verify=load(LIB/'scripts/verify-cop-builder.py','app_builder_verify');verify.verify(False)
  context,context_proof=source_context(policy,req['revision'],validator,copy_module)
  image,build_sha=build(policy,req['revision'],context,case_id)
 finally:os.close(lock)
 rejected=STATE/'rejected-images.json'
 if rejected.exists():
  blocked=json.loads(read(rejected,0,0o600));need(blocked.get('contractVersion')=='cop-self-release-rejected-images-v1' and isinstance(blocked.get('images'),list) and all(isinstance(v,str) and re.fullmatch('sha256:[a-f0-9]{64}',v) for v in blocked['images']),'APP_QUARANTINE_RECORD_INVALID');need(image not in blocked['images'],'APP_CANDIDATE_QUARANTINED')
 image_tests(image,case/'image-tests.log');compatibility(image,case)
 need(store.pointer()==active,'APP_SOURCE_CHANGED_DURING_BUILD')
 current=store.docker.current(old_dir);need(current['Id']==active['containerId'],'APP_SOURCE_CONTAINER_CHANGED')
 target_image=inspect_image(image);store.docker.image(image,revision=req['revision']);store.docker.mounts(image,binding['driverContract']['caSha256'])
 desired=store.docker.config(old_dir,profile['directory'])['services']['cop-api'];desired['image']=image;r.runtime_parity(current,desired,target_image['Config'],transition=True)
 expected=dict(x.split('=',1) for x in target_image['Config'].get('Env',[]) if '=' in x);expected.update(desired['environment'])
 actual=dict(x.split('=',1) for x in current['Config'].get('Env',[]) if '=' in x)
 need(expected==actual,'APP_EFFECTIVE_ENVIRONMENT_CHANGED')
 health=load(LIB/'scripts/cop-health-gate.py','app_health_capture');baseline=health.capture(time.monotonic()+45);r.health_statuses(baseline);need(health.no_regression(baseline,baseline),'APP_SOURCE_HEALTH_UNACCEPTABLE');baseline_raw=r.encoded(baseline)
 # Re-read the complete accepted predecessor after all external awaits.
 need(store.pointer()==active and store.docker.current(old_dir)['Id']==active['containerId'],'APP_FINAL_SOURCE_CAS')
 parent_ref=copy.deepcopy(binding['accountErasureConfig']);_,parent=store.erasure_config_proof(Path(parent_ref['path']),binding,parent_ref['sha256'])
 stamp=lambda value:value.isoformat().replace('+00:00','Z');now=r.datetime.now(r.timezone.utc)
 target={'imageId':image,'sourceRevision':req['revision'],'profileGeneration':PROFILE}
 prefix=r.PROFILES/PROFILE
 proof={'contractVersion':'cop-application-owned-image-v1','transitionId':case_id,'operation':'maintain','previous':active,'target':target,'changedKeys':[],'ownerAcceptance':True,'checks':copy.deepcopy(parent['checks']),'cleanReset':copy.deepcopy(parent['cleanReset']),'parentProof':parent_ref,'environmentMetadata':r.environment_metadata(store.source/'.env',1000),'composeHashes':copy.deepcopy(binding['composeHashes']),'checkedAt':stamp(now),'expiresAt':stamp(now+datetime.timedelta(seconds=900)),'sourceSpecSha256':sha(r.encoded(r.fenced_public_source_spec(current))),'baselineSha256':sha(baseline_raw)}
 compatibility_record={'contractVersion':'cop-application-image-compatibility-v1','target':target,'checks':dict.fromkeys(('x5RuntimeGuard','sharpConversion','databaseRouting','actualImageTests','sameRuntimeEnvironment','sameTopology'),True),'sourceContextDigest':context_proof['inputDigest'],'buildReceiptSha256':build_sha}
 comp_path=prefix/('application-image-compatibility-'+case_id+'.json');protected_json(comp_path,compatibility_record)
 release_raw=r.private_read(old_dir/'release.json',1000)
 case_record={'contractVersion':'cop-application-image-case-v1','caseId':case_id,'approvalRef':'cop-application-self-release-policy-v1',**{k:proof[k] for k in ('previous','target','parentProof','environmentMetadata','composeHashes','sourceSpecSha256','baselineSha256','checkedAt','expiresAt')},'sourceEnvironmentSha256':sha(r.encoded(actual)),'parentReleaseSha256':sha(release_raw),'sourceProcess':{'pid':current['State']['Pid'],'restartCount':current['RestartCount'],'startedAt':current['State']['StartedAt'],'running':current['State']['Running']},'compatibilityReference':{'path':str(comp_path),'sha256':sha(read(comp_path,0,0o640))}}
 case_path=prefix/('application-image-case-'+case_id+'.json');protected_json(case_path,case_record);proof['caseReference']={'path':str(case_path),'sha256':sha(read(case_path,0,0o640))}
 protected_json(prefix/('planning-config-v3-source-health-'+case_id+'.json'),baseline)
 proof_path=prefix/('account-erasure-'+case_id+'.json');protected_json(proof_path,proof)
 attestation={'contractVersion':'cop-api-runtime-attestation-v1','application':'cop','service':'cop-api',**target,'kind':'candidate','ownerAcceptance':True,'driverContract':copy.deepcopy(binding['driverContract']),'checks':{'x5RuntimeGuard':True,'sharpConversion':True,'databaseRouting':True,'acceptedBaselineRollback':False},'legacyContainerId':None,'legacyEnvPresence':None}
 attestation_path=prefix/('attestation-'+image[7:]+'.json')
 if attestation_path.exists():need(json.loads(read(attestation_path,0,0o640))==attestation,'APP_EXISTING_ATTESTATION_DIFFERENT')
 else:protected_json(attestation_path,attestation)
 result=worker({'action':'prepare','proof':str(proof_path),'attestation':str(attestation_path)})
 staged={'contractVersion':'cop-self-release-staged-v1','caseId':case_id,'releaseId':result['releaseId'],'target':target,'previous':active,'proofPath':str(proof_path)}
 temp=STATE/('staged-'+case_id+'.json');root_write(temp,encode(staged));os.replace(temp,STATE/'staged.json')
 print(json.dumps({'prepared':True,'releaseId':result['releaseId'],'imageId':image,'sourceRevision':req['revision'],'productionActivated':False}))

def runtime_status(r,storage):
 store=r.Store(uid=1000,guard=storage.preflight);store.clean();active,directory,binding,profile=store.active();store.docker.live(directory,binding,profile)
 observed=store.docker.current(directory);need(observed['Id']==active['containerId'] and observed['State']['Running'] is True and type(observed['RestartCount']) is int and observed['RestartCount']>=0 and observed['State'].get('Health',{}).get('Status')=='healthy','APP_RUNTIME_NOT_HEALTHY')
 return {'healthyRuntimeVerified':True,'imageId':active['imageId'],'sourceRevision':binding['sourceRevision'],'generation':active['generation'],'canPrepareCodeOnly':True,'canChangeConfiguration':False,'restartCount':observed['RestartCount']}

def main():
 need(os.geteuid()==0 and socket.gethostname().split('.')[0]=='docker','APP_ROOT_DOCKER_REQUIRED')
 need(len(sys.argv)==2 and sys.argv[1] in ('status','prepare','activate'),'APP_FIXED_ACTION_REQUIRED')
 os.environ.clear();os.environ.update(ROOTENV);os.umask(0o077)
 policy=json.loads(read(LIB/'policy.json',0,0o640));need(policy['contractVersion']=='cop-self-release-policy-v1','APP_POLICY_VERSION')
 for name,digest in policy['assets'].items():
  need(not Path(name).is_absolute() and '..' not in Path(name).parts,'APP_ASSET_PATH')
  parent=(LIB/name).parent
  while parent!=LIB.parent:
   meta=parent.lstat();need(stat.S_ISDIR(meta.st_mode) and meta.st_uid==0 and not meta.st_mode&0o022,'APP_ASSET_DIRECTORY');parent=parent.parent
  need(sha(read(LIB/name,0))==digest,'APP_TRUSTED_ASSET_CHANGED')
 r=load(LIB/'scripts/cop-api-runtime.py','app_runtime');storage=load(LIB/'scripts/cop-storage.py','app_storage')
 need(sha(read(Path('/srv/cop/scripts/cop-api-runtime.py'),1000))==policy['guardSha256'],'APP_OPERATIONAL_GUARD_CHANGED')
 STATE.mkdir(mode=0o700,exist_ok=True);s=STATE.lstat();need(s.st_uid==0 and stat.S_ISDIR(s.st_mode) and stat.S_IMODE(s.st_mode)==0o700,'APP_STATE_CUSTODY')
 lock=os.open('/run/cop-self-release.lock',os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600)
 try:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  if sys.argv[1]=='prepare':prepare(policy,r,storage)
  elif sys.argv[1]=='status':
   print(json.dumps(runtime_status(r,storage)))
  else:
   staged=json.loads(read(STATE/'staged.json',0,0o600));need(staged['contractVersion']=='cop-self-release-staged-v1','APP_STAGE_VERSION')
   result=worker({'action':'activate','releaseId':staged['releaseId'],'expected':staged['previous']['generation']})
   root_write(STATE/('accepted-'+staged['caseId']+'.json'),encode(result));print(json.dumps({'deployed':True,**result}))
 finally:os.close(lock)
if __name__=='__main__':
 try:main()
 except Exception as e:
  code=str(e) if isinstance(e,RuntimeError) and str(e).startswith('APP_') else 'APP_RELEASE_NOT_COMPLETE'
  import traceback
  frame=traceback.extract_tb(e.__traceback__)[-1]
  print(json.dumps({'ok':False,'code':code,'exceptionType':type(e).__name__,'failureFile':Path(frame.filename).name,'failureLine':frame.lineno,'automaticRollback':False}));raise SystemExit(2)
