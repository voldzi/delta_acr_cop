#!/usr/bin/python3
"""One reviewed COMM action, using existing SSH/sudo; no new privilege grant.
Default: read-only preflight. --apply installs/executes only the pinned artifact.
COP generation is checked before and after; COP is never modified here.
"""
import argparse,hashlib,json,os,stat,subprocess,sys
from pathlib import Path
EXECUTOR_SHA='f476afad20da3c877bcd1a5d8a98ba0a54c12659830a41f8d51e989492bffbc3'
COP_IMAGE='sha256:1338179f0f66abf904aad04da82fc87f82f9676d758842bd00eec4b9e0662d7d'
COP_REVISION='00c854d56eb9fd4346e26dade622776c83bee9a5'
COP_GENERATION='55190b1dc87f4bf59dec02d3396c41a3'
ROOT_LOADER=r'''
import hashlib,json,os,socket,stat,sys
assert os.geteuid()==0 and socket.gethostname().split('.')[0]=='comm'
raw=sys.stdin.buffer.read(1048577)
assert 0<len(raw)<1048576 and hashlib.sha256(raw).hexdigest()=='f476afad20da3c877bcd1a5d8a98ba0a54c12659830a41f8d51e989492bffbc3'
path='/srv/csm-messaging/account-safety/controller-only-executor-v1.py'
'''
INSTALL=r'''
parent=os.path.dirname(path);s=os.lstat(parent)
assert stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022
try:
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
except FileNotFoundError:
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
 try:
  os.fchown(fd,0,0);os.fchmod(fd,0o400);v=memoryview(raw)
  while v:
   n=os.write(fd,v);assert n>0;v=v[n:]
  os.fsync(fd)
 finally:os.close(fd)
 dfd=os.open(parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(dfd)
 finally:os.close(dfd)
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
try:
 s=os.fstat(fd);assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o400
 frozen=os.read(fd,1048577);assert frozen==raw
finally:os.close(fd)
os.execve('/usr/bin/python3',['python3','-I',path,'--apply'],{'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/root','LANG':'C'})
'''
CHECK="sys.argv=[path];exec(compile(raw,path,'exec'),{'__name__':'__main__','__file__':path})\n"
class Stop(Exception):pass
def need(ok,code):
 if not ok:raise Stop(code)
def run(argv,body=None):
 p=subprocess.run(argv,input=body,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300)
 # Only JSON receipts are exposed; never dump SSH/child stderr or argv payloads.
 try:value=json.loads(p.stdout)
 except Exception:raise Stop('BOOTSTRAP_CHILD_UNPROVEN')
 need(p.returncode==0,'BOOTSTRAP_CHILD_FAILED');return value

def cop_status(call=run):
 v=call(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8','docker.home.cz','sudo','-n','/usr/local/sbin/cop-self-release','status'])
 need(v.get('healthyRuntimeVerified') is True and v.get('imageId')==COP_IMAGE and v.get('sourceRevision')==COP_REVISION and v.get('generation')==COP_GENERATION and v.get('restartCount')==0 and v.get('canChangeConfiguration') is False,'BOOTSTRAP_COP_BASELINE_CHANGED')
 return v

def artifact():
 p=Path(__file__).with_name('controller-only-off.py');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_size<1048576 and not s.st_mode&0o022,'BOOTSTRAP_ARTIFACT_CUSTODY')
  raw=os.read(fd,1048576);e=os.fstat(fd)
  need(len(raw)==s.st_size and (s.st_ino,s.st_mtime_ns,s.st_ctime_ns)==(e.st_ino,e.st_mtime_ns,e.st_ctime_ns) and hashlib.sha256(raw).hexdigest()==EXECUTOR_SHA,'BOOTSTRAP_ARTIFACT_CHANGED');return raw
 finally:os.close(fd)

def execute(apply=False,call=run,read=artifact):
 raw=read();cop_status(call)
 import shlex
 code=ROOT_LOADER+(INSTALL if apply else CHECK)
 command='sudo -n /usr/bin/python3 -I -c '+shlex.quote(code)
 result=call(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8','comm-codex',command],raw)
 cop_status(call)
 need(result.get('admissionEnabled') is False,'BOOTSTRAP_ADMISSION_UNPROVEN')
 if apply:need(result.get('created') is True and result.get('custodyVerified') is True and result.get('controllerConfigured') is True and result.get('featureActivated') is False,'BOOTSTRAP_COMPLETION_UNPROVEN')
 else:need(result.get('preflightPassed') is True and result.get('productionChanged') is False,'BOOTSTRAP_PREFLIGHT_UNPROVEN')
 return {'executorSha256':EXECUTOR_SHA,'copGenerationRechecked':True,'copModified':False,'newPrivilegeGranted':False,**result}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');a=p.parse_args()
 try:print(json.dumps(execute(a.apply)))
 except Exception as e:
  print(json.dumps({'complete':False,'code':str(e) if isinstance(e,Stop) else 'BOOTSTRAP_UNPROVEN','automaticRetry':False,'automaticRollback':False,'noAdmissionEnableAttempted':True}));raise SystemExit(2)
