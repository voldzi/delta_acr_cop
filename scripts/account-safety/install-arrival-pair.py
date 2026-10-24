#!/usr/bin/env python3
"""User-operated Root installer for the exact approved COP image pair. No secrets output."""
import argparse,contextlib,datetime,fcntl,hashlib,importlib.util,json,os,pwd,re,socket,stat,subprocess,sys,tempfile,uuid
from pathlib import Path
sys.dont_write_bytecode=True
STAGE=Path('/srv/x5-production/staging/cop/work/job-fa4230c846b54cd188c3ac75da93ff26/arrival-pair-20261024')
SOURCE=Path('/srv/cop');PROFILE='206c4507-5e00-458e-b0ee-4061309aa7a8';PROTECTED=Path('/etc/vcode-cop-api-runtime')/PROFILE
OLD='sha256:251374f1b612dec0b0f0335250f91bb44f9e420d0d92bc2a2a3f9bf459b02a0c';NEW='sha256:3f0054cb10e7c563c47cb010a7ea7cfbf4ff5a738e1261d77434be283baab430'
OLD_REV='c1ca66ff49c8e250ec260bd199f0d41502d8d600';NEW_REV='333352a79cba641393e407e32d0a175867ca32c2'
ORIGINAL_GUARD='ca17f451487b53018eaf8628547dbf838fab3e01f28ccd472a1331bfce525a0f'
ENV={'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/home/voldzi','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1','DOCKER_HOST':'unix:///var/run/docker.sock'}
# Filled from the tested public bundle, not from mutable host configuration.
PAYLOADS={'cop-api-runtime.py': '65cb657fb5349a73c4d28c977e688148e54e65e73d63780ba726c4293c7dd255', 'cop-arrival-release-contract-v1.py': '6f0f6f8d8ad6f33fd57c1adbd6b0829c32f595da57e0df3287373792cfdaa0ad', 'cop-arrival-reversion-contract-v1.py': '3844d42977343fe934b097ce87e9ff416817b88b66d2e94e1b8aecf0d1b744f5', 'cop-arrival-reversion-worker-v1.py': '7a29b158cddcc7883a851367dc5352aee7c8f77200e2baa75f1fdc078cdb4b10', 'accept-arrival-production.mjs': '1d3cb8cffe63d3d1e3ff55a492f2c1d2b11237b5a0ca6c65aa8e925aa44a8780', 'accept-sim-arrival-fresh.mjs': '9b24a6594a706ca12bdc428afdb3b4eb69a6d778bbdf3ee18af6ef1ff31a0a89', 'patch-files.json': '4cc104886ec4f6f63e8dfaa8b59dbd370c1b4c2dd48769fdce317aeeae8269f1'}

def need(ok,code):
 if not ok:raise RuntimeError(code)
def digest(raw):return hashlib.sha256(raw).hexdigest()
def read(path,maximum=2000000):
 need(not any(p.is_symlink()for p in(path,*path.parents)),'INSTALL_PATH_SYMLINK')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_size<=maximum,'INSTALL_FILE_SCOPE');raw=os.read(fd,maximum+1);t=os.fstat(fd);need(len(raw)==s.st_size and(s.st_dev,s.st_ino,s.st_mtime_ns,s.st_ctime_ns)==(t.st_dev,t.st_ino,t.st_mtime_ns,t.st_ctime_ns),'INSTALL_FILE_CHANGED');return raw
 finally:os.close(fd)
def run(args,user=False,timeout=240,check=True):
 command=(['/usr/sbin/runuser','-u','voldzi','--']if user and os.geteuid()==0 else[])+args
 result=subprocess.run(command,cwd=SOURCE,env=ENV,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
 if check:need(result.returncode==0,'COMMAND_FAILED_OUTPUT_WITHHELD')
 return result

def docker(*args):return run(['docker','--host','unix:///var/run/docker.sock',*args]).stdout
def current():return json.loads(docker('inspect','cop-cop-api-1'))[0]
def runtime(*args,check=True):return run(['/usr/bin/python3','-I',str(SOURCE/'scripts/cop-api-runtime.py'),*args],user=True,check=check)
def atomic(path,raw,mode,uid,gid):
 fd,name=tempfile.mkstemp(prefix='.arrival-pair-',dir=path.parent)
 try:
  os.fchmod(fd,mode);os.fchown(fd,uid,gid)
  with os.fdopen(fd,'wb')as out:out.write(raw);out.flush();os.fsync(out.fileno())
  os.replace(name,path)
  parent=os.open(path.parent,os.O_RDONLY);os.fsync(parent);os.close(parent)
 finally:
  if os.path.exists(name):os.unlink(name)
def immutable(path,raw,json_semantic=False):
 if path.exists():
  old=read(path);s=path.stat();need(s.st_uid==0 and s.st_gid==1000 and stat.S_IMODE(s.st_mode)==0o640,'ROOT_IMMUTABLE_PERMISSIONS');need(json.loads(old)==json.loads(raw)if json_semantic else old==raw,'ROOT_IMMUTABLE_CHANGED');return
 atomic(path,raw,0o640,0,1000)
def module(name,raw,path):
 m=type(sys)(name);m.__file__=str(path);exec(compile(raw,str(path),'exec'),m.__dict__);return m

def load_bundle():
 values={}
 for name,sha in PAYLOADS.items():
  raw=read(STAGE/name);need(digest(raw)==sha,'PUBLIC_BUNDLE_HASH_MISMATCH');values[name]=raw
 return values

def verify_images(bundle):
 old,new=[json.loads(docker('image','inspect',i))[0]for i in(OLD,NEW)]
 expected=json.loads(json.dumps(old['Config']));expected['Labels']['org.opencontainers.image.revision']=NEW_REV
 need(new['Id']==NEW and old['Id']==OLD and new['Config']==expected,'IMAGE_CONFIGURATION_CHANGED')
 layers=old['RootFS']['Layers'];need(new['RootFS']['Layers'][:len(layers)]==layers and len(new['RootFS']['Layers'])==len(layers)+8,'IMAGE_LAYER_SCOPE_CHANGED')
 files=json.loads(bundle['patch-files.json'])
 for p,sha in files.items():need(docker('run','--rm','--pull','never','--network','none','--read-only','--cap-drop','ALL','--entrypoint','sha256sum',NEW,'/app/'+p).decode().split()[0]==sha,'IMAGE_PATCH_CONTENT_CHANGED')
 for image in(OLD,NEW):
  # Uses precisely the ordinary runtime image/native Sharp/X5-code check.
  r=module('image_guard',bundle['cop-api-runtime.py'],STAGE/'cop-api-runtime.py');r.Docker(SOURCE).image(image,revision=NEW_REV if image==NEW else OLD_REV)
 docker('run','--rm','--pull','never','--network','none','--read-only','--cap-drop','ALL','--entrypoint','node',NEW,'--input-type=module','-e','await import("/app/apps/cop-api/dist/routing-source.js");console.log("IMPORT_OK")')

def verify_sim(bundle):
 image='sha256:9f0a6d789116cad19d363e79e9c8e5963861106e10ecd9c281e9f864c1d2c124'
 live=json.loads(docker('inspect','csm-sim-situation-data-api'))[0];need(live['Image']==image and live['State'].get('Health',{}).get('Status')=='healthy','SIM_NOT_ACCEPTED_OR_HEALTHY')
 receipt=json.loads(read(Path('/srv/sim/.arrival-20261023/result.json')));need(receipt.get('committed')is True and receipt.get('phase')=='complete' and receipt.get('candidate')==image and receipt.get('realData',{}).get('verified')is True,'SIM_ACCEPTANCE_MISSING')
 raw=bundle['accept-sim-arrival-fresh.mjs']
 fresh=json.loads(docker('exec','csm-sim-situation-data-api','node','--input-type=module','-e',raw.decode()))
 failure=fresh.get('failureCode');safe=failure if isinstance(failure,str)and re.fullmatch('[A-Z0-9_]{1,64}',failure)else'UNKNOWN'
 need(fresh.get('verified')is True,'FRESH_SIM_ENGINE_ACCEPTANCE_FAILED_'+safe)
 return {'imageId':image,'schemaSha256':'210b06c0cd3f093d91529721b21b7ffed26e28be5d625a15a6d62a67c7f36e8c','actualEngineAccepted':True}

def install_guard(bundle):
 path=SOURCE/'scripts/cop-api-runtime.py';raw=read(path);desired=bundle['cop-api-runtime.py']
 need(digest(raw)in{ORIGINAL_GUARD,digest(desired)},'LIVE_GUARD_CHANGED')
 for name in['cop-arrival-release-contract-v1.py','cop-arrival-reversion-contract-v1.py','cop-arrival-reversion-worker-v1.py']:
  target=('arrival-reversion-worker-'if 'worker' in name else'post-edge-promotion-helper-')+digest(bundle[name])+'.py';immutable(PROTECTED/target,bundle[name])
 immutable(PROTECTED/('arrival-guard-baseline-'+ORIGINAL_GUARD+'.py'),raw if digest(raw)==ORIGINAL_GUARD else read(PROTECTED/('arrival-guard-baseline-'+ORIGINAL_GUARD+'.py')))
 if raw!=desired:
  s=path.stat();need(s.st_uid==1000 and not s.st_mode&0o022,'LIVE_GUARD_PERMISSIONS');atomic(path,desired,stat.S_IMODE(s.st_mode),s.st_uid,s.st_gid)

def review_proof(bundle,r,reverse=False):
 pointer=json.loads(read(SOURCE/'runtime/api/active.json'));actual=current();pending_path=SOURCE/'runtime/api/pending.json'
 if reverse and pending_path.exists():
  pending=json.loads(read(pending_path));source_release=pending['targetReleaseId'];mode='pending'
 else:source_release=pointer['releaseId'];mode='accepted'
 origin=json.loads(read(SOURCE/'runtime/api/releases'/source_release/'release.json'));ref=origin['accountErasureConfig'];parent_raw=r.private_read(Path(ref['path']),0,mode=0o640,gid=1000);need(digest(parent_raw)==ref['sha256'],'PARENT_PROOF_CHANGED');parent=json.loads(parent_raw)
 need(origin['imageId']==(NEW if reverse else OLD),'REVIEW_SOURCE_IMAGE_CHANGED')
 need(all(digest(read(SOURCE/n))==sha for n,sha in parent['composeHashes'].items()),'OPERATIONAL_COMPOSE_CHANGED')
 need(r.environment_metadata(SOURCE/'.env',1000)==parent['environmentMetadata'],'ENVIRONMENT_CHANGED')
 profile=origin['profileGeneration'];need(profile==PROFILE,'DATABASE_PROFILE_CHANGED')
 env=dict(v.split('=',1)for v in actual['Config']['Env']);need(env.get('COP_AUTH_MODE')=='oidc' and env.get('COP_ALLOW_LAB_TOKEN')=='false' and env.get('COP_ACCOUNT_ERASURE_ENABLED')=='true','AUTH_OR_INTAKE_CHANGED')
 old_attest=json.loads(r.private_read(Path(origin['attestationPath']),0,mode=0o640,gid=1000))
 image,revision=(OLD,OLD_REV)if reverse else(NEW,NEW_REV)
 attest={**old_attest,'imageId':image,'sourceRevision':revision,'ownerAcceptance':True,'kind':'candidate','legacyContainerId':None,'legacyEnvPresence':None,'checks':{'x5RuntimeGuard':True,'sharpConversion':True,'databaseRouting':True,'acceptedBaselineRollback':False}}
 attest_path=PROTECTED/('attestation-'+image[7:]+'.json');immutable(attest_path,r.encoded(attest),True)
 now=datetime.datetime.now(datetime.timezone.utc);iso=lambda d:d.isoformat().replace('+00:00','Z');tid=str(uuid.uuid4())
 authority=module('pair_authority',bundle['cop-arrival-reversion-contract-v1.py'],STAGE/'cop-arrival-reversion-contract-v1.py')
 forward=module('forward_authority',bundle['cop-arrival-release-contract-v1.py'],STAGE/'cop-arrival-release-contract-v1.py')
 proof={'contractVersion':authority.REVERSE if reverse else authority.FORWARD,'transitionId':tid,'operation':'maintain','previous':pointer,'target':{'imageId':image,'sourceRevision':revision,'profileGeneration':PROFILE},'changedKeys':[],'environmentMetadata':parent['environmentMetadata'],'composeHashes':parent['composeHashes'],'ownerAcceptance':True,'checks':{k:True for k in forward.CHECKS|({'noSchemaDowngrade','retainedPendingHistory'}if reverse else set())},'cleanReset':parent['cleanReset'],'parentProof':{'path':ref['path'],'sha256':ref['sha256']},'checkedAt':iso(now),'expiresAt':iso(now+datetime.timedelta(minutes=15)),'sourceSpecSha256':r.sha(r.encoded(r.fenced_public_source_spec(actual))),'patchFiles':json.loads(bundle['patch-files.json']),'simAcceptance':parent.get('simAcceptance')if reverse else verify_sim(bundle)}
 if reverse:
  baseline=read(SOURCE/'runtime/api/pending-health.json')if mode=='pending'else r.private_read(PROTECTED/('arrival-source-health-'+parent['transitionId']+'.json'),0,mode=0o640,gid=1000)
  r.health_statuses(json.loads(baseline))
  proof['reversion']={'mode':mode,'sourceReleaseId':source_release,'sourceContainerId':actual['Id'],'sourceImage':actual['Image'],'pendingForwardSha256':digest(read(pending_path))if mode=='pending'else None,'pendingHealthSha256':digest(baseline)if mode=='pending'else None,'baselineSha256':digest(baseline)}
 else:
  baseline=run(['/usr/bin/python3','-I',str(SOURCE/'scripts/cop-health-gate.py'),'capture'],user=True).stdout
  r.health_statuses(json.loads(baseline));immutable(PROTECTED/('arrival-source-health-'+tid+'.json'),baseline)
 authority.schema(r,proof)
 path=PROTECTED/('account-erasure-'+tid+'.json');immutable(path,r.encoded(proof));return path,attest_path,proof

def finish_reversion(bundle,r,existing=False):
 if existing:
  journal=json.loads(read(SOURCE/'runtime/api/arrival-reversion-pending.json'));path=Path(journal['proofPath']);raw=r.private_read(path,0,mode=0o640,gid=1000);need(digest(raw)==journal['proofSha256'],'REVERSION_PROOF_CHANGED');proof=json.loads(raw);attest=PROTECTED/('attestation-'+OLD[7:]+'.json')
 else:path,attest,proof=review_proof(bundle,r,True)
 pointer=json.loads(read(SOURCE/'runtime/api/active.json'))
 restored=json.loads(runtime('arrival-revert','--proof',str(path),'--attestation',str(attest),'--expect-active',pointer['generation']).stdout)
 need(restored['imageId']==OLD and current()['Image']==OLD,'REVERSION_TARGET_UNPROVEN');need(runtime('validate').returncode==0,'REVERSION_RUNTIME_UNPROVEN')
 return {'phase':'reversion_complete','productionActivated':False,'reversionVerified':True,'reversionPointer':restored,'pendingEvidenceRetained':True,'configurationChanged':False,'erasureOperationPerformed':False}

def apply(bundle,revert_only=False):
 need(os.geteuid()==0 and socket.gethostname().split('.')[0]=='docker','ROOT_DOCKER_OPERATOR_REQUIRED');need(pwd.getpwnam('voldzi').pw_uid==1000,'OPERATOR_IDENTITY_CHANGED')
 run(['/usr/bin/python3','-I',str(SOURCE/'scripts/cop-storage.py'),'preflight'],user=True)
 current_guard=read(SOURCE/'scripts/cop-api-runtime.py');need(digest(current_guard)in{ORIGINAL_GUARD,digest(bundle['cop-api-runtime.py'])},'LIVE_GUARD_CHANGED')
 live=current();need(live['Image']in{OLD,NEW},'UNREVIEWED_LIVE_IMAGE')
 verify_images(bundle)
 if (SOURCE/'runtime/api/arrival-reversion-pending.json').exists()or revert_only:
  need(digest(current_guard)==digest(bundle['cop-api-runtime.py']),'REVERSION_GUARD_NOT_INSTALLED')
  r=module('installed_arrival_runtime',bundle['cop-api-runtime.py'],SOURCE/'scripts/cop-api-runtime.py')
  return finish_reversion(bundle,r,(SOURCE/'runtime/api/arrival-reversion-pending.json').exists())
 verify_sim(bundle)
 if live['Image']==NEW and not(SOURCE/'runtime/api/pending.json').exists():
  need(runtime('validate').returncode==0,'ACTIVE_TARGET_INVALID');accepted=json.loads(docker('exec','cop-cop-api-1','node','--input-type=module','-e',bundle['accept-arrival-production.mjs'].decode()));need(accepted.get('verified')is True,'COP_LIVE_ACCEPTANCE_FAILED');return {'phase':'already_complete','imageId':NEW,'realData':accepted,'productionActivated':True}
 need(live['Image']==OLD and not(SOURCE/'runtime/api/pending.json').exists(),'PRIOR_PENDING_REQUIRES_REVIEW')
 need(runtime('validate').returncode==0,'BASELINE_RUNTIME_UNPROVEN')
 need(live['State'].get('Health',{}).get('Status')=='healthy','BASELINE_UNHEALTHY')
 install_guard(bundle);r=module('installed_arrival_runtime',bundle['cop-api-runtime.py'],SOURCE/'scripts/cop-api-runtime.py')
 path,attest,proof=review_proof(bundle,r)
 receipt={'phase':'prepare','imageId':NEW,'sourceRevision':NEW_REV,'configurationChanged':False,'erasureOperationPerformed':False,'productionActivated':False}
 try:
  prepared=json.loads(runtime('prepare','--image',NEW,'--revision',NEW_REV,'--attestation',str(attest),'--expect-active',proof['previous']['generation'],'--account-erasure-config',str(path)).stdout)
  receipt['phase']='activate'
  activated=json.loads(runtime('activate','--release',prepared['releaseId'],'--expect-active',proof['previous']['generation']).stdout)
  receipt['phase']='actual-cop-adapter-acceptance'
  accepted=json.loads(docker('exec','cop-cop-api-1','node','--input-type=module','-e',bundle['accept-arrival-production.mjs'].decode()));need(accepted.get('verified')is True,'COP_LIVE_ACCEPTANCE_FAILED')
  need(json.loads(runtime('validate').stdout)['imageId']==NEW,'FINAL_RUNTIME_UNPROVEN')
  receipt.update(phase='complete',productionActivated=True,pointer=activated,realData=accepted,reversionSafeguardInstalled=True);return receipt
 except Exception:
  receipt.update(phase='forward_failed',productionActivated=False)
  actual=current()
  if actual['Image']==NEW or(SOURCE/'runtime/api/pending.json').exists():
   try:
    reverse_path,old_attest,reverse=review_proof(bundle,r,True)
    restored=json.loads(runtime('arrival-revert','--proof',str(reverse_path),'--attestation',str(old_attest),'--expect-active',reverse['previous']['generation']).stdout)
    need(restored['imageId']==OLD and current()['Image']==OLD,'REVERSION_TARGET_UNPROVEN')
    need(runtime('validate').returncode==0,'REVERSION_RUNTIME_UNPROVEN')
    receipt.update(phase='forward_failed_reversion_verified',reversionVerified=True,reversionPointer=restored,pendingEvidenceRetained=True)
   except Exception:receipt.update(phase='reversion_pending_operator_review',reversionVerified=False,checkpointRetained=True)
  else:receipt.update(phase='pre_activation_failure_original_unchanged',reversionVerified=True)
  return receipt

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply-approved-arrival-pair',action='store_true');parser.add_argument('--check',action='store_true');parser.add_argument('--revert-approved-arrival-pair',action='store_true');args=parser.parse_args();need(sum([args.apply_approved_arrival_pair,args.check,args.revert_approved_arrival_pair])==1,'SELECT_ONE_ACTION')
 bundle=load_bundle()
 if args.check:
  verify_images(bundle);verify_sim(bundle);need(digest(read(SOURCE/'scripts/cop-api-runtime.py'))in{ORIGINAL_GUARD,digest(bundle['cop-api-runtime.py'])},'LIVE_GUARD_CHANGED');print(json.dumps({'phase':'read_only_preflight_passed','imageId':NEW,'simAcceptedFresh':True,'productionActivated':False}));return
 result=apply(bundle,args.revert_approved_arrival_pair)
 path=STAGE/('operator-result-'+uuid.uuid4().hex+'.json');atomic(path,(json.dumps(result,indent=2)+'\n').encode(),0o644,0,1000);print(json.dumps(result));sys.exit(0 if result.get('productionActivated')or result.get('phase')=='reversion_complete'else 2)
if __name__=='__main__':
 try:main()
 except Exception as error:
  code=str(error)if isinstance(error,RuntimeError)and re.fullmatch('[A-Z0-9_]{1,100}',str(error))else'INSTALL_FAILED_OUTPUT_WITHHELD'
  print(json.dumps({'phase':'not_complete','code':code,'productionActivated':False}));sys.exit(2)
