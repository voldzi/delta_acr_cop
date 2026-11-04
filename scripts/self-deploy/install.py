#!/usr/bin/python3
"""One-time attended installation of the fixed COP code-only release broker.
Requires an exact external payload hash. No application container is restarted.
"""
import argparse,base64,hashlib,json,os,socket,stat,subprocess,sys,types
from pathlib import Path
LIB=Path('/usr/local/lib/cop-self-release')
PROFILE=Path('/etc/vcode-cop-api-runtime/206c4507-5e00-458e-b0ee-4061309aa7a8')
OLD='593874714db6b35537ffe733a8f266483685f37a0d5e6c73abb4159f9503f9d2'
def need(ok,code):
 if not ok:raise RuntimeError(code)
def digest(b):return hashlib.sha256(b).hexdigest()
def safe_read(p):
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_size<4*1024*1024,'INSTALL_FILE_SCOPE');raw=os.read(fd,4*1024*1024);need(len(raw)==s.st_size,'INSTALL_FILE_CHANGED');return raw
 finally:os.close(fd)
def write(p,raw,mode=0o640,uid=0,gid=1000):
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
 try:os.fchown(fd,uid,gid);os.fchmod(fd,mode);os.write(fd,raw);os.fsync(fd)
 finally:os.close(fd)
def main():
 p=argparse.ArgumentParser();p.add_argument('--payload',required=True);p.add_argument('--sha256',required=True);p.add_argument('--apply',action='store_true');a=p.parse_args()
 need(os.geteuid()==0 and socket.gethostname().split('.')[0]=='docker','ROOT_DOCKER_REQUIRED');os.umask(0o077)
 os.environ.clear();os.environ.update(PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME='/root',LANG='C',DOCKER_HOST='unix:///var/run/docker.sock')
 raw=safe_read(a.payload);need(digest(raw)==a.sha256,'INSTALL_PAYLOAD_HASH');data=json.loads(raw);files={n:base64.b64decode(b,validate=True) for n,b in data.items()}
 for n in files:need(not Path(n).is_absolute() and '..' not in Path(n).parts,'INSTALL_PATH')
 policy=json.loads(files['policy.json']);need(policy['contractVersion']=='cop-self-release-policy-v1' and set(policy['assets'])==set(files)-{'policy.json'},'INSTALL_POLICY')
 for n,h in policy['assets'].items():need(digest(files[n])==h,'INSTALL_ASSET_HASH')
 guard=Path('/srv/cop/scripts/cop-api-runtime.py');original=safe_read(guard);meta=guard.lstat();need(digest(original)==OLD and meta.st_uid==1000 and stat.S_ISREG(meta.st_mode),'INSTALL_EXACT_PARENT')
 # Publish a new unreferenced kernel; preserve every historical proof unchanged.
 k=files['scripts/self-deploy/kernel.py'];kp=PROFILE/('planning-config-v3-kernel-'+digest(k)+'.py')
 if kp.exists():need(safe_read(kp)==k and kp.lstat().st_uid==0,'INSTALL_EXISTING_KERNEL')
 else:write(kp,k)
 m=types.ModuleType('cop_install_preview');m.__file__=str(guard);sys.modules[m.__name__]=m;exec(compile(files['scripts/cop-api-runtime.py'],str(guard),'exec'),m.__dict__)
 store=m.Store(uid=1000);active,directory,binding,profile=store.active();store.docker.live(directory,binding,profile)
 candidate=policy['initialCandidate'];store.docker.image(candidate['imageId'],revision=candidate['sourceRevision']);store.docker.mounts(candidate['imageId'],binding['driverContract']['caSha256'])
 desired=store.docker.config(directory,profile['directory'])['services']['cop-api'];desired['image']=candidate['imageId'];target=json.loads(store.docker.run(['docker','image','inspect',candidate['imageId']]))[0];m.runtime_parity(store.docker.current(directory),desired,target['Config'],transition=True)
 launcher=b'#!/bin/sh\nexec /usr/bin/python3 -I /usr/local/lib/cop-self-release/scripts/self-deploy/broker.py "$@"\n'
 sudo=b'voldzi ALL=(root) NOPASSWD: NOSETENV: /usr/local/sbin/cop-self-release status, /usr/local/sbin/cop-self-release prepare, /usr/local/sbin/cop-self-release activate\n'
 test=Path('/run/cop-self-release-sudoers-test');need(not test.exists(),'INSTALL_TEST_EXISTS');write(test,sudo,0o440,0,0)
 try:subprocess.run(['/usr/sbin/visudo','-cf',str(test)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 finally:test.unlink()
 print(json.dumps({'previewVerified':True,'existingRuntimePreserved':True,'candidateRuntimeParityVerified':True,'sudoersValidated':True,'productionActivated':False}),flush=True)
 if not a.apply:return
 need(not LIB.exists() and not Path('/usr/local/sbin/cop-self-release').exists() and not Path('/etc/sudoers.d/cop-self-release').exists(),'INSTALL_DESTINATION_EXISTS')
 LIB.mkdir(mode=0o750);os.chown(LIB,0,1000);LIB.chmod(0o750)
 for name,body in files.items():
  target=LIB/name
  for parent in reversed(target.parent.relative_to(LIB).parents):
   path=LIB/parent
   if not path.exists():path.mkdir(mode=0o750);os.chown(path,0,1000);path.chmod(0o750)
  if not target.parent.exists():target.parent.mkdir(mode=0o750);os.chown(target.parent,0,1000);target.parent.chmod(0o750)
  write(target,body)
 write(LIB/'original-runtime-5938.py',original)
 replacement=guard.with_name('cop-api-runtime.self-release.tmp');write(replacement,files['scripts/cop-api-runtime.py'],stat.S_IMODE(meta.st_mode),meta.st_uid,meta.st_gid)
 need(safe_read(guard)==original,'INSTALL_PARENT_CHANGED');os.replace(replacement,guard)
 write(Path('/usr/local/sbin/cop-self-release'),launcher,0o755,0,0);write(Path('/etc/sudoers.d/cop-self-release'),sudo,0o440,0,0)
 print(json.dumps({'brokerInstalled':True,'actions':['status','prepare','activate'],'application':'cop-api','configurationChangesAllowed':False,'generalSudoAllowed':False,'productionActivated':False}),flush=True)
if __name__=='__main__':
 try:main()
 except Exception as e:
  import traceback
  f=traceback.extract_tb(e.__traceback__)[-1];print(json.dumps({'installed':False,'code':str(e) if isinstance(e,RuntimeError) else type(e).__name__,'failureLine':f.lineno}));raise SystemExit(2)
