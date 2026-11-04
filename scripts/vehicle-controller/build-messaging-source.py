#!/usr/bin/python3
"""Unprivileged finite Messaging build on the existing product X5 builder.
No runtime replacement, builder reconfiguration, prune, env files or credentials.
"""
import argparse,fcntl,hashlib,json,os,re,socket,stat,subprocess,tarfile
from pathlib import Path
UUID='2f93f595-b61b-4eea-9054-7afa9b275b5b'
BUILDER='cop-x5';BUILDER_CID='c29dbdadfc98c99b6435dc6d3831867aebd52e8c2cc8322e2b77b598c79fe966'
BUILDER_IMAGE='sha256:27933730df224df80c41f4e5a9b33fa78831a79fd31903df3bb7deb49363422f'
BASE='hexpm/elixir@sha256:62ae81995bbb198bd72d721deb8e81c49f9718984d8764f6dc061a6e2545cc85'
RUNNER='alpine@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a'
X5=Path('/srv/x5-production');WORK=X5/'staging/cop/work'
def need(ok,code):
 if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def run(args,log=None,timeout=60):
 p=subprocess.run(args,stdout=log if log else subprocess.PIPE,stderr=log if log else subprocess.PIPE,timeout=timeout)
 need(p.returncode==0,'MESSAGING_BUILD_COMMAND_FAILED');return p.stdout

def verify():
 mount=run(['findmnt','-n','-o','UUID,FSTYPE,TARGET','--target',str(X5)]).decode().split()
 need(mount==[UUID,'ext4',str(X5)] and X5.stat().st_dev!=Path('/').stat().st_dev,'MESSAGING_X5_UNAVAILABLE')
 need(WORK.stat().st_uid==1000 and not WORK.is_symlink(),'MESSAGING_WORK_CUSTODY')
 v=json.loads(run(['docker','inspect','buildx_buildkit_cop-x50']))[0]
 need(v['Id']==BUILDER_CID and v['Image']==BUILDER_IMAGE and v['State']['Running'],'MESSAGING_BUILDER_CHANGED')
 m=[x for x in v['Mounts'] if x['Destination']=='/var/lib/buildkit'];need(len(m)==1 and m[0]['Name']=='buildx_buildkit_cop-x50_state','MESSAGING_BUILDER_STATE')
 volume=json.loads(run(['docker','volume','inspect',m[0]['Name']]))[0]
 need(volume['Options']=={'device':'/srv/x5-production/cache/cop/buildkit','o':'bind','type':'none'},'MESSAGING_BUILDER_CACHE_NOT_X5')
 need(Path(volume['Options']['device']).stat().st_dev==X5.stat().st_dev,'MESSAGING_CACHE_FILESYSTEM')

def main():
 p=argparse.ArgumentParser();p.add_argument('--revision',required=True);p.add_argument('--archive-sha256',required=True);a=p.parse_args()
 need(os.geteuid()==1000 and socket.gethostname().split('.')[0]=='docker','MESSAGING_BUILD_HOST_USER')
 need(re.fullmatch('[a-f0-9]{40}',a.revision) and re.fullmatch('[a-f0-9]{64}',a.archive_sha256),'MESSAGING_BUILD_ARGUMENTS')
 verify();directory=WORK/('messaging-startup-'+a.revision);need(directory.is_dir() and not directory.is_symlink() and directory.stat().st_uid==1000,'MESSAGING_BUILD_DIRECTORY')
 archive=directory/'source.tar';fd=os.open(archive,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode) and s.st_uid==1000 and s.st_nlink==1 and s.st_size<20*1024*1024,'MESSAGING_ARCHIVE_CUSTODY')
  raw=os.read(fd,20*1024*1024);need(len(raw)==s.st_size and sha(raw)==a.archive_sha256,'MESSAGING_ARCHIVE_CHANGED')
 finally:os.close(fd)
 lock=os.open(directory/'build.lock',os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600);fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 try:
  context=directory/'source';context.mkdir(mode=0o700)
  with tarfile.open(archive) as t:
   need(t.pax_headers.get('comment')==a.revision,'MESSAGING_GIT_ARCHIVE_REVISION')
   for m in t.getmembers():
    parts=Path(m.name).parts
    need(not m.name.startswith('/') and '..' not in parts and (m.isfile() or m.isdir()) and not any(x in ('.git','.env','deps','_build') for x in parts),'MESSAGING_ARCHIVE_SCOPE')
   t.extractall(context,filter='data')
  recipe=(context/'Dockerfile').read_bytes();derived=recipe+b'\nFROM erasure-test AS startup-verified-test\nRUN mix test --seed 0\n'
  dockerfile=directory/'Dockerfile.verification';dockerfile.write_bytes(derived);dockerfile.chmod(0o400)
  for parent,dirs,files in os.walk(context):
   for name in files:
    path=Path(parent)/name;path.chmod(0o555 if path.stat().st_mode&0o111 else 0o444)
   Path(parent).chmod(0o555)
  common=['docker','buildx','build','--builder',BUILDER,'--platform','linux/amd64','--provenance=false','--file',str(dockerfile),'--build-arg','ELIXIR_IMAGE='+BASE,'--build-arg','RUNNER_IMAGE='+RUNNER,'--label','org.opencontainers.image.revision='+a.revision,'--progress','plain']
  with (directory/'test-build.log').open('xb') as log:run(common+['--target','startup-verified-test','--output','type=cacheonly','--metadata-file',str(directory/'test.metadata.json'),str(context)],log,1800)
  text=(directory/'test-build.log').read_text(errors='replace');matches=re.findall(r'Result: ([0-9]+) passed(?:, ([0-9]+) skipped)?',text)
  need(bool(matches) and 'Failed:' not in text,'MESSAGING_ACTUAL_TEST_STAGE_UNPROVEN');passed,skipped=matches[-1];need(int(passed)>=264,'MESSAGING_TEST_COUNT')
  verify();tag='cop-messaging-startup:'+a.revision
  with (directory/'runtime-build.log').open('xb') as log:run(common+['--target','runtime','--load','--tag',tag,'--metadata-file',str(directory/'runtime.metadata.json'),str(context)],log,1800)
  image=json.loads(run(['docker','image','inspect',tag]))[0]
  need(image['Os']=='linux' and image['Architecture']=='amd64' and image['Config']['Labels']['org.opencontainers.image.revision']==a.revision,'MESSAGING_BUILT_IDENTITY')
  keys={x.split('=',1)[0] for x in image['Config'].get('Env',[])};need(keys<= {'PATH','MIX_ENV','PHX_SERVER'},'MESSAGING_UNEXPECTED_IMAGE_ENV')
  verify();need(sha(archive.read_bytes())==a.archive_sha256,'MESSAGING_FINAL_SOURCE_CAS')
  result={'sourceRevision':a.revision,'sourceArchiveSha256':a.archive_sha256,'dockerfileSha256':sha(recipe),'derivedDockerfileSha256':sha(derived),'base':BASE,'runner':RUNNER,'builder':BUILDER,'builderContainerId':BUILDER_CID,'builderReconfigured':False,'x5Uuid':UUID,'actualTestStagePassed':int(passed),'actualTestStageSkipped':int(skipped or '0'),'runtimeImageId':image['Id'],'configSha256':sha(canonical(image['Config'])),'rootFs':image['RootFS'],'runtimeChanged':False,'case':str(directory)}
  (directory/'build-receipt.json').write_bytes(canonical(result)+b'\n');(directory/'build-receipt.json').chmod(0o600);print(json.dumps(result))
 finally:os.close(lock)
if __name__=='__main__':
 try:main()
 except Exception as e:print(json.dumps({'built':False,'code':str(e) if isinstance(e,RuntimeError) and str(e).startswith('MESSAGING_') else 'MESSAGING_BUILD_UNPROVEN','runtimeChanged':False}));raise SystemExit(2)
