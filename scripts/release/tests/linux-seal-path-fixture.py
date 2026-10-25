import base64,hashlib,json,os,pty,shutil,subprocess,sys
from pathlib import Path
assert os.geteuid()==0 and Path('/fixture/isolated-marker').read_text()=='synthetic-only-no-host-mounts\n'
SOURCE=Path('/fixture/source')
seal_source=(SOURCE/'cop-catalog-maintain-seal.py').read_bytes()
worker_source=(SOURCE/'cop-catalog-maintain-worker.py').read_bytes()
# This fixture substitutes provider I/O only. Real package authorization, full
# paths, Root publication and UID/GID drop execute unchanged inside the container.
worker_source=worker_source.replace(b"if __name__=='__main__':",b"preflight=lambda m,a: None\nif __name__=='__main__':")
assert b'preflight=lambda m,a: None' in worker_source
counter=0

def sha(raw):return hashlib.sha256(raw).hexdigest()
def enc(v):return (json.dumps(v,sort_keys=True)+'\n').encode()
def put(path,raw,uid=0,gid=0,mode=0o640):
 p=Path(path);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw);p.chmod(mode);os.chown(p,uid,gid)

def run_case(old_path=False,wrong_layout=False):
 global counter
 for path in ['/etc/cop-reviewed-release','/var/lib/cop-reviewed-release','/etc/vcode-cop-api-runtime','/srv/cop','/home/voldzi/cop-catalog-maintain-final-20261025']:
  if Path(path).exists():shutil.rmtree(path)
 ns={'__name__':'fixture_sealer','__file__':'/fixture/source/cop-catalog-maintain-seal.py'}
 exec(compile(seal_source,ns['__file__'],'exec'),ns)
 profile=ns['PROFILE'];root=ns['ROOT'];protected=ns['PROTECTED'];state=ns['STATE'];source=ns['SOURCE'];inp=ns['INPUT']
 for p in [root/'releases',state,protected,source,inp]:p.mkdir(parents=True,exist_ok=True)
 state.chmod(0o700)
 put('/run/cop-reviewed-release.lock',b'',mode=0o600)
 broker=b'public isolated broker sentinel\n';put('/usr/local/sbin/cop-reviewed-release',broker,mode=0o755)
 previous={'contractVersion':'cop-api-runtime-active-v1','generation':'6d767891c0944954a737687c178d8c94','releaseId':'release-'+'a'*32,'profileId':profile,'profileGeneration':profile,'imageId':ns['OLD_API'],'containerId':'b'*64}
 reset={'resetEpoch':'11111111-1111-4111-8111-111111111111'};reset_raw=enc(reset)
 put(source/'runtime/clean-reset/reset-result.json',reset_raw)
 metadata={k:1 for k in ['device','inode','size','mtimeNs','ctimeNs']}
 compose={}
 for name in ['docker-compose.yml','docker-compose.driver-measurements.yml','docker-compose.x5.yml','docker-compose.ai-router.yml']:
  raw=b'public fixture compose\n';compose[name]=sha(raw);put(source/'runtime/api/releases'/previous['releaseId']/'compose'/name,raw,1000,1000,0o600)
 ref={'path':str(protected/'account-erasure-23f72509-10df-4217-9365-4f7cc89e1f73.json'),'sha256':'pending','cleanScope':'cop_sim_shared_identity_v1','authScope':'oidc_no_lab_v1'}
 base={'target':{'imageId':ns['OLD_API'],'sourceRevision':'c'*40,'profileGeneration':profile},'environmentMetadata':metadata,'ownerAcceptance':True,'checks':{'historicalLineagePreserved':True},'cleanReset':{'resetEpoch':reset['resetEpoch'],'tokensNotBefore':1,'receiptSha256':sha(reset_raw)},'composeHashes':compose}
 base_raw=enc(base);ref['sha256']=sha(base_raw);put(ref['path'],base_raw)
 put(source/'runtime/api/releases'/previous['releaseId']/'release.json',enc({'accountErasureConfig':ref,'imageId':ns['OLD_API'],'sourceRevision':'c'*40}),1000,1000,0o600)
 att={'imageId':ns['OLD_API'],'profileGeneration':profile,'ownerAcceptance':True,'sourceRevision':'c'*40,'kind':'candidate'}
 put(protected/('attestation-'+ns['OLD_API'][7:]+'.json'),enc(att))
 old_pin=enc({'services':{'cop-web':{'image':ns['OLD_WEB']}}});put(source/'runtime/clean-reset/web-runtime.compose.json',old_pin,gid=1000)
 source.chmod(0o755);os.chown(source,0 if wrong_layout else 1000,0 if wrong_layout else 1000)
 (source/'runtime').chmod(0o700);os.chown(source/'runtime',1000,1000)
 (source/'runtime/clean-reset').chmod(0o750);os.chown(source/'runtime/clean-reset',0,1000)
 historical={'contractVersion':'cop-sim-whole-clean-acceptance-v3','checkedAt':'2026-10-17T15:22:13Z','kind':'isolated_whole_provider','productionTouched':False,'deletionScope':'cop_sim_shared_identity_v1','operation':{'operationId':'synthetic','finalStatus':'deleted','finalAccountDeleted':True,'requiredOwners':sorted(ns['OWNERS'])},'resetEpoch':'synthetic','providerReadbacks':{name:{'operationId':'synthetic','resetEpoch':'synthetic','status':'completed','userARemaining':0,'userBStateBefore':'unchanged','userBStateAfter':'unchanged'} for name in ns['OWNERS']},'recoveryReadbacks':{'restored_user_data':{'restoredRows':1,'finalUserARemaining':0,'userBPreserved':True}},'candidateImages':{'cop_api':'historical-synthetic'}}
 historical_raw=enc(historical);put(source/'runtime/clean-reset/whole12-acceptance.json',historical_raw,mode=0o600)
 fresh={'contractVersion':'cop-catalog-readonly-review-v1','previous':previous,'candidateImages':{'api':ns['API'],'web':ns['WEB']},'guardSha256':ns['GUARD'],'candidateTestsPassed':43,'productionChanged':False,'freshCandidateJointAcceptance':False,'environmentMetadata':metadata,'acceptedBaselineProof':ref,'liveGates':{'ownerStatus':'ok'}}
 for key in ['runtimeParityPassed','unchangedBaseRootfsPassed','newLayerAllowlistPassed','genericMaintainEnvironmentParityPassed','acceptedRootLineageValidatedByGuard','currentSourceComposeMatchesAcceptedRootHashes','unchangedErasureRuntimeInherited','nativeSharpAndX5GuardPassed']:fresh[key]=True
 reviewer=('import json,os,sys\nassert os.geteuid()==1000\nsys.stdin.buffer.read()\nprint('+repr(json.dumps(fresh))+')\n').encode()
 worker=worker_source if not old_path else worker_source.replace(b"read(ROOT.parent/'approved.json'",b"read(ROOT/'approved.json'")
 assert old_path or b"read(ROOT.parent/'approved.json'" in worker
 put(inp/'cop-catalog-maintain-worker.py',worker,1000,1000,0o600);put(inp/'cop-catalog-maintain-review.py',reviewer,1000,1000,0o600)
 # Fixture-only exact digests; no production receipts/data enter this image.
 for key,value in [('BROKER',sha(broker)),('WORKER',sha(worker)),('REVIEWER',sha(reviewer)),('BASE_PROOF',sha(base_raw)),('RESET',sha(reset_raw)),('HISTORICAL',sha(historical_raw))]:ns[key]=value
 # The fixed production reference SHA is likewise replaced only in this isolated
 # sealer copy so it binds the synthetic immutable baseline instead of real data.
 program=seal_source.decode().replace("reference['sha256']==BASE_PROOF", "reference['sha256']==BASE_PROOF")
 overrides={key:ns[key] for key in ['BROKER','WORKER','REVIEWER','BASE_PROOF','RESET','HISTORICAL']}
 command='import json,os,sys;sys.path.insert(0,"/fixture");from run_fixture_sealer import run;run()'
 # Write a deterministic runner containing public fixture overrides.
 runner='import sys,signal\ndef run():\n ns={"__name__":"fixture_sealer","__file__":"/fixture/source/cop-catalog-maintain-seal.py"}\n exec(compile(open("/fixture/source/cop-catalog-maintain-seal.py","rb").read(),ns["__file__"],"exec"),ns)\n ns.update('+repr(overrides)+')\n try:ns["seal"]()\n except BaseException as error:\n  print(ns["json"].dumps({"phase":"fixture_seal_failed","stage":ns["STAGE"],"code":str(error) if isinstance(error,ns["Stop"]) else type(error).__name__}))\n  sys.exit(2)\n'
 Path('/fixture/run_fixture_sealer.py').write_text(runner)
 master,slave=pty.openpty()
 p=subprocess.Popen(['/usr/bin/python3','-I','-c',command],stdin=slave,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 os.close(slave);os.write(master,b'ANO\n');stdout,stderr=p.communicate(timeout=30);os.close(master)
 rows=[json.loads(line) for line in stdout.splitlines()]
 if old_path or wrong_layout:
  assert p.returncode==2,(rows,stderr.decode())
  assert not (root/'approved.json').exists()
  assert not (protected/('attestation-'+ns['API'][7:]+'.json')).exists()
  assert not list(protected.glob('account-erasure-*.json')) or list(protected.glob('account-erasure-*.json'))==[Path(ref['path'])]
  assert (source/'runtime/clean-reset/web-runtime.compose.json').read_bytes()==old_pin
  counter+=4
 else:
  assert p.returncode==0,(rows,stderr.decode())
  index=json.loads((root/'approved.json').read_text());package=root/'releases'/index['releaseId'];manifest=(package/'manifest.json').read_bytes()
  assert sha(manifest)==index['manifestSha256'];counter+=1
  assert (package/'seal-commit.json').exists();counter+=1
  assert (root/'approved.json').stat().st_uid==0;counter+=1
  code='import base64,sys;sys.argv=["worker","preflight"];b=base64.b64decode('+repr(base64.b64encode(worker).decode())+');exec(compile(b,"worker","exec"),{"__name__":"__main__","__file__":"worker"})'
  r=subprocess.run(['/usr/bin/python3','-I','-c',code],input=manifest,capture_output=True,user=1000,group=1000,extra_groups=[1000,988],timeout=10)
  assert r.returncode==0,r.stdout.decode();assert json.loads(r.stdout)['passed'] is True;counter+=1
  (package/'seal-commit.json').unlink()
  r=subprocess.run(['/usr/bin/python3','-I','-c',code],input=manifest,capture_output=True,user=1000,group=1000,extra_groups=[1000,988],timeout=10)
  assert r.returncode!=0;counter+=1
 return rows[-1]

negative=run_case(old_path=True)
layout_negative=run_case(wrong_layout=True)
positive=run_case(old_path=False)
print(json.dumps({'contractVersion':'cop-seal-path-integration-fixture-v1','checksPassed':counter,'originalWrongPathDeniedAndCleaned':True,'fixedPathRootSealAndUid1000AuthorizationPassed':True,'exactProductionMixedOwnerLayoutPassed':True,'wrongOwnerLayoutDeniedAndCleaned':True,'missingCommitDenied':True,'productionTouched':False}))
