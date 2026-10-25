#!/usr/bin/python3 -I
"""Unprivileged application worker for the reviewed 25 October COP release.

Does not mint Root attestations/proofs. Requires the exact Root-sealed package
and uses the existing API runtime guard. No reset or automatic pending cleanup.
"""
import hashlib,json,os,re,stat,subprocess,sys,time
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path('/etc/cop-reviewed-release/releases')
SOURCE=Path('/srv/cop')
API='sha256:c06c6080c87c4f88a74be359d459143ac25aef55cf60e6a8e11e4555bb62affa'
WEB='sha256:3606a7725266ca0078480fa263dac37193b45b389b8bb43e23be192d4180fafd'
OLD_API='sha256:3f0054cb10e7c563c47cb010a7ea7cfbf4ff5a738e1261d77434be283baab430'
OLD_WEB='sha256:d6cf225150d721fbb5d0f236c2b921064a2e5906b30b396ad55f85d5fce3770c'
REV='07664a77cf19e9433bd6fe4b1267e395616f1985'
PROFILE='206c4507-5e00-458e-b0ee-4061309aa7a8'
GUARD_SHA='65cb657fb5349a73c4d28c977e688148e54e65e73d63780ba726c4293c7dd255'
ENV={'PATH':'/usr/local/bin:/usr/bin:/bin','LANG':'C','PYTHONDONTWRITEBYTECODE':'1','DOCKER_HOST':'unix:///var/run/docker.sock'}
class Stop(Exception):pass
def need(ok,code):
 if not ok:raise Stop(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def read(path,owner,limit=131072):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  a=os.fstat(fd);need(stat.S_ISREG(a.st_mode) and a.st_uid==owner and a.st_nlink==1 and not a.st_mode&0o022 and a.st_size<=limit,'FILE_CUSTODY')
  raw=os.read(fd,limit+1);b=os.fstat(fd)
  need(len(raw)==a.st_size and (a.st_dev,a.st_ino,a.st_mtime_ns,a.st_ctime_ns)==(b.st_dev,b.st_ino,b.st_mtime_ns,b.st_ctime_ns),'FILE_CHANGED')
  return raw
 finally:os.close(fd)
def command(args,timeout=240):
 r=subprocess.run(args,env=ENV,cwd=SOURCE,capture_output=True,timeout=timeout)
 need(r.returncode==0,'FIXED_COMMAND_FAILED')
 return r.stdout
def docker(*args):return command(['/usr/bin/docker','--host','unix:///var/run/docker.sock',*args])
def inspect(name):return json.loads(docker('inspect',name))[0]
def runtime(*args):return json.loads(command(['/usr/bin/python3','-I',str(SOURCE/'scripts/cop-api-runtime.py'),*args]))
def active_pointer():
 validated=runtime('validate')
 pointer=json.loads(read(SOURCE/'runtime/api/active.json',1000))
 need(validated=={k:pointer[k] for k in ('releaseId','profileId','profileGeneration','imageId','generation')},'ACTIVE_VALIDATION_CHANGED')
 return pointer
def authorization(raw,require_commit=True):
 m=json.loads(raw);need(isinstance(m,dict) and re.fullmatch(r'[0-9a-f]{32}',m.get('releaseId','')),'RELEASE_ID')
 need(set(m)=={'contractVersion','releaseId','previousImages','targetImages','sourceRevisions',
  'profileGeneration','guardSha256','checkedAt','expiresAt','workerSha256','reviewRecordSha256',
  'evidenceSha256','failedPendingRiskAccepted'} and m['contractVersion']=='cop-root-reviewed-release-v1','MANIFEST_SCHEMA')
 folder=ROOT/m['releaseId']
 for p in (folder,*folder.parents):
  s=p.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'PACKAGE_DIRECTORY')
 need(read(folder/'manifest.json',0)==raw,'SEALED_MANIFEST_CHANGED')
 index=json.loads(read(ROOT.parent/'approved.json',0))
 need(index=={'releaseId':m['releaseId'],'manifestSha256':sha(raw)},'APPROVED_INDEX_CHANGED')
 if require_commit:
  need(json.loads(read(folder/'seal-commit.json',0))=={'contractVersion':'cop-root-reviewed-seal-commit-v1','releaseId':m['releaseId'],'manifestSha256':sha(raw)},'SEAL_NOT_COMMITTED')
 def stamp(value):
  need(isinstance(value,str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z',value),'REVIEW_TIME_FORMAT')
  return datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()
 start,end=stamp(m['checkedAt']),stamp(m['expiresAt'])
 need(0<end-start<=900 and start<=time.time()<=end,'REVIEW_EXPIRED')
 need(m['previousImages']=={'api':OLD_API,'web':OLD_WEB},'PREVIOUS_IMAGES_CHANGED')
 need(sha(read(folder/'worker.py',0))==m['workerSha256'] and sha(read(folder/'review-record.json',0))==m['reviewRecordSha256'],'PACKAGE_INTEGRITY')
 need(set(m['evidenceSha256'])=={'candidate','parity','provider','historical','authorization'},'EVIDENCE_KEYS')
 for key,value in m['evidenceSha256'].items():
  need(sha(read(folder/(key+'-evidence.json'),0))==value,'EVIDENCE_INTEGRITY')
 need(m.get('targetImages')=={'api':API,'web':WEB} and m.get('sourceRevisions')=={'api':REV,'web':'8afa082415a67e55f61fb9fb661d953b57fec8c8'} and m.get('profileGeneration')==PROFILE and m.get('guardSha256')==GUARD_SHA and m.get('failedPendingRiskAccepted')is True,'RELEASE_SCOPE')
 auth_raw=read(folder/'authorization-evidence.json',0)
 need(sha(auth_raw)==m['evidenceSha256']['authorization'],'AUTHORIZATION_DIGEST')
 a=json.loads(auth_raw)
 need(set(a)=={'contractVersion','expectedActive','attestationPath','configProofPath','webOverrideSha256'} and a['contractVersion']=='cop-catalog-maintain-authorization-v1','AUTHORIZATION_SCHEMA')
 prefix='/etc/vcode-cop-api-runtime/'+PROFILE+'/'
 need(a['attestationPath']==prefix+'attestation-'+API[7:]+'.json' and re.fullmatch(re.escape(prefix)+r'account-erasure-[0-9a-f-]{36}\.json',a['configProofPath']) and re.fullmatch('[0-9a-f]{64}',a['webOverrideSha256']),'ROOT_PROOF_PATH')
 p=a['expectedActive'];need(p.get('imageId')==OLD_API and p.get('profileGeneration')==PROFILE and p.get('profileId')==PROFILE and re.fullmatch('[0-9a-f]{32}',p.get('generation','')),'SOURCE_POINTER')
 return m,a
HTTP_PROBE=r'''const r=await fetch("http://127.0.0.1:4310/health/dependencies",{signal:AbortSignal.timeout(15000)});const b=await r.json();const o=b.dependencies?.find(x=>x.name==="cop-account-erasure-owners");const anon=await fetch("http://127.0.0.1:4310/api/v1/me/profile");const lab=await fetch("http://127.0.0.1:4310/api/v1/me/profile",{headers:{authorization:"Bearer dev-lab-token"}});const login=await fetch("http://127.0.0.1:4310/api/v1/auth/login?returnTo=%2F&prompt=login",{redirect:"manual"});const u=new URL(login.headers.get("location")||"http://invalid.invalid");console.log(JSON.stringify({ownerStatus:o?.status,ownerCheckedAt:o?.checkedAt,anon:anon.status,lab:lab.status,login:login.status,loginOrigin:u.origin,loginPath:u.pathname}));'''
def check_live():
 v=json.loads(docker('exec','cop-cop-api-1','node','--input-type=module','-e',HTTP_PROBE))
 from datetime import datetime,timezone
 stamp=datetime.fromisoformat(v['ownerCheckedAt'].replace('Z','+00:00')).timestamp()
 need(v['ownerStatus']=='ok' and 0<=time.time()-stamp<=35 and v['anon']==401 and v['lab']==401 and v['login']==302 and v['loginOrigin']=='https://login.zeleznalady.cz' and v['loginPath']=='/realms/cop/protocol/openid-connect/auth','LIVE_GATES')
 return v
WEB_OVERRIDE=SOURCE/'runtime/clean-reset/web-runtime.compose.json'
def web_command(api_release):
 need(re.fullmatch('release-[0-9a-f]{32}',api_release),'API_RELEASE_ID')
 d=SOURCE/'runtime/api/releases'/api_release
 args=['/usr/bin/docker','--host','unix:///var/run/docker.sock','compose','--project-name','cop','--project-directory',str(SOURCE),'--env-file',str(SOURCE/'.env'),'--env-file','/etc/vcode-cop-api-runtime/'+PROFILE+'/runtime.env','--env-file',str(d/'image.env')]
 for n in ['docker-compose.yml','docker-compose.driver-measurements.yml','docker-compose.x5.yml','docker-compose.ai-router.yml']:args+=['-f',str(d/'compose'/n)]
 return args+['-f',str(d/'compose.runtime.yml'),'-f',str(WEB_OVERRIDE)]
def load_guard():
 raw=read(SOURCE/'scripts/cop-api-runtime.py',1000,1048576)
 need(sha(raw)==GUARD_SHA,'GUARD_SOURCE')
 import types
 module=types.ModuleType('cop_maintain_guard')
 module.__file__=str(SOURCE/'scripts/cop-api-runtime.py')
 exec(compile(raw,module.__file__,'exec'),module.__dict__)
 return module
def validate_root_review(a):
 module=load_guard()
 try:
  store=module.Store(uid=1000)
  pointer,_,_,_=store.active()
  need(pointer==a['expectedActive'],'ACTIVE_CHANGED')
  stub={'imageId':API,'sourceRevision':REV,'profileId':PROFILE,'profileGeneration':PROFILE,'kind':'candidate','previousReleaseId':pointer['releaseId']}
  _,contract,_,_=store.attestation(Path(a['attestationPath']),stub)
  stub['driverContract']=contract
  store.profile(PROFILE,contract)
  digest,proof=store.erasure_config_proof(Path(a['configProofPath']),stub)
  need(proof['contractVersion']=='cop-api-account-erasure-clean-config-v1' and proof['operation']=='maintain' and proof['changedKeys']==[] and proof['previous']==pointer,'MAINTAIN_REVIEW_SCOPE')
  stub['accountErasureConfig']={'path':a['configProofPath'],'sha256':digest,'cleanScope':'cop_sim_shared_identity_v1'}
  store.assert_erasure_environment(stub)
  store.docker.image(API,revision=REV)
  return module
 except Stop:raise
 except Exception:raise Stop('ROOT_REVIEW_VALIDATION_FAILED') from None

def validate_web(module,api_release):
 resolved=json.loads(command(web_command(api_release)+['config','--format','json']))
 desired=resolved['services']['cop-web']
 need(desired['image']==WEB,'WEB_TARGET_CHANGED')
 current=inspect('cop-cop-web-1')
 target=inspect(WEB)
 need(target['Os']=='linux' and target['Architecture']=='amd64','WEB_PLATFORM')
 need(target['Config'].get('Labels',{}).get('org.opencontainers.image.revision')=='8afa082415a67e55f61fb9fb661d953b57fec8c8','WEB_SOURCE')
 module.runtime_parity(current,desired,target['Config'])
 def env(values):
  pairs=[v.split('=',1) for v in values]
  need(all(len(v)==2 for v in pairs) and len({v[0] for v in pairs})==len(pairs),'WEB_ENV_DUPLICATE')
  return dict(pairs)
 expected=env(target['Config'].get('Env') or [])
 configured=desired.get('environment') or {}
 need(isinstance(configured,dict) and all(isinstance(k,str) and isinstance(v,str) for k,v in configured.items()),'WEB_ENV_SCHEMA')
 expected.update(configured)
 need(env(current['Config'].get('Env') or [])==expected,'WEB_ENV_PARITY')
 networks={resolved['networks'][k]['name'] for k in desired.get('networks',{})}
 actual=current['NetworkSettings']['Networks']
 need(set(actual)==networks,'WEB_NETWORK_PARITY')
 for name in networks:
  need(inspect(name)['Id']==actual[name]['NetworkID'],'WEB_NETWORK_ID')
 return web_command(api_release)

def preflight(m,a):
 need(sha(read(SOURCE/'scripts/cop-api-runtime.py',1000,1048576))==GUARD_SHA,'GUARD_SOURCE')
 need(active_pointer()==a['expectedActive'],'ACTIVE_CHANGED')
 need(inspect('cop-cop-web-1')['Image']==OLD_WEB,'WEB_SOURCE_CHANGED')
 need(sha(read(WEB_OVERRIDE,0))==a['webOverrideSha256'],'WEB_PIN_CHANGED')
 override=json.loads(read(WEB_OVERRIDE,0));need(override=={'services':{'cop-web':{'image':WEB}}},'WEB_NOT_REVIEWED')
 # Proof schema, source/CAS and complete effective environment are independently
 # checked again by prepare/activate. Never manufacture proof acceptance here.
 module=validate_root_review(a)
 validate_web(module,a['expectedActive']['releaseId'])
 check_live()
def activate(m,a):
 preflight(m,a)
 r=runtime('prepare','--image',API,'--revision',REV,'--attestation',a['attestationPath'],'--expect-active',a['expectedActive']['generation'],'--account-erasure-config',a['configProofPath'])
 accepted=runtime('activate','--release',r['releaseId'],'--expect-active',a['expectedActive']['generation'])
 pointer=active_pointer()
 need(pointer['imageId']==API and accepted=={k:pointer[k] for k in ('releaseId','profileId','profileGeneration','imageId','generation')},'API_ACTIVATION_UNPROVEN')
 check_live()
 # The API guard has fully committed before any web peer changes.
 module=load_guard()
 args=validate_web(module,pointer['releaseId'])
 command(args+['up','-d','--no-build','--pull','never','--no-deps','cop-web'])
 need(inspect('cop-cop-web-1')['Image']==WEB and inspect('cop-cop-api-1')['Image']==API,'FINAL_IMAGES')
 validate_web(module,pointer['releaseId'])
 check_live()
 command(['/usr/bin/python3','-I',str(SOURCE/'scripts/cop-health-gate.py'),'capture'])
def main():
 need(os.geteuid()==1000 and len(sys.argv)==2 and sys.argv[1] in {'preflight','activate','seal-preflight'},'WORKER_IDENTITY_OR_STAGE')
 raw=sys.stdin.buffer.read(65537);need(len(raw)<=65536,'MANIFEST_LIMIT')
 m,a=authorization(raw,require_commit=sys.argv[1]!='seal-preflight')
 (activate if sys.argv[1]=='activate' else preflight)(m,a)
 print(json.dumps({'contractVersion':'cop-reviewed-release-worker-result-v1','releaseId':m['releaseId'],'stage':sys.argv[1],'passed':True,'targetImages':{'api':API,'web':WEB}},sort_keys=True))
if __name__=='__main__':
 try:main()
 except (Stop,OSError,ValueError,KeyError,TypeError,subprocess.SubprocessError) as error:
  reason=str(error) if isinstance(error,Stop) and re.fullmatch('[A-Z_]{1,100}',str(error)) else 'UNCLASSIFIED_WORKER_CHECK_FAILED'
  print(json.dumps({'passed':False,'code':'COP_MAINTAIN_STOPPED_WITHOUT_BYPASS','reason':reason}));sys.exit(2)
