#!/usr/bin/env python3
"""One fixed Root build-only preparation. Never restarts an application,
changes .env/database, deletes user data or enables account deletion.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import tempfile
sys.dont_write_bytecode = True

SOURCE=Path('/srv/x5-production/staging/cop/clean-lifecycle-6c5c985')
REV='6c5c9855b29644cdc6e86b5b66166c861226cdba'
OLD_DEPLOY='7edf500f5e4eaf788a4c21ee78097c01bad59344faee09aa534c988fa11d271e'
NEW_DEPLOY='4d428f56225ead88867cbb2c9cce3cfa188f95b553b3e96c645dec96833bc9d9'
HELPER='c67d19ee3f26cf7afa6ae428bf9af60b422bb08ed376f2eaf72a9b23d744e7f6'
UUID='2f93f595-b61b-4eea-9054-7afa9b275b5b'
OPERATIONAL=Path('/srv/cop')
ENV={'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/root','LANG':'C','GIT_OPTIONAL_LOCKS':'0','PYTHONDONTWRITEBYTECODE':'1','DOCKER_HOST':'unix:///var/run/docker.sock'}

def need(value,code):
 if not value:raise RuntimeError(code)
def run(args):
 r=subprocess.run(args,capture_output=True,env=ENV,timeout=60,check=False)
 need(r.returncode==0,'CLEAN_BUILD_READBACK_FAILED');return r.stdout

def sha(path):
 s=path.lstat();need(stat.S_ISREG(s.st_mode) and not path.is_symlink() and s.st_nlink==1,'CLEAN_BUILD_UNSAFE_FILE');return hashlib.sha256(path.read_bytes()).hexdigest()
def current():
 return run(['/usr/bin/docker','--host','unix:///var/run/docker.sock','inspect','--format','{{.Id}} {{.Image}} {{.State.StartedAt}} {{.State.Running}}','cop-cop-api-1']).decode().strip()
def install(path,raw,owner=1000,group=1000,mode=0o755):
 fd,name=tempfile.mkstemp(prefix='.clean-build-public-',dir=path.parent)
 try:
  os.fchown(fd,owner,group);os.fchmod(fd,mode)
  with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
  os.replace(name,path);name=None
  d=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(d)
  finally:os.close(d)
 finally:
  if name:os.unlink(name)
def main():
 need(len(sys.argv)==1,'CLEAN_BUILD_FIXED_OPERATION')
 need(os.getuid()==0 and socket.gethostname().split('.')[0]=='docker' and not os.environ.get('PYTHONPATH') and not os.environ.get('PYTHONHOME'),'CLEAN_BUILD_ROOT_REQUIRED')
 need(run(['/usr/bin/findmnt','-n','-o','UUID','-T',str(SOURCE)]).decode().strip()==UUID,'CLEAN_BUILD_X5_REQUIRED')
 need(SOURCE.resolve()==SOURCE and (SOURCE/'.git').is_dir(),'CLEAN_BUILD_FIXED_GIT_CHECKOUT')
 need(run(['/usr/bin/git','-c','safe.directory='+str(SOURCE),'-C',str(SOURCE),'rev-parse','HEAD']).decode().strip()==REV,'CLEAN_BUILD_SOURCE_REVISION')
 need(sha(SOURCE/'scripts/deploy-production.sh')==NEW_DEPLOY and sha(SOURCE/'scripts/cop-api-build-context.py')==HELPER,'CLEAN_BUILD_SOURCE_BYTES')
 paths=[]
 for directory,dirs,files in os.walk(SOURCE,followlinks=False):
  for p in [Path(directory),*[Path(directory)/n for n in dirs+files]]:
   s=p.lstat();need((stat.S_ISREG(s.st_mode) or stat.S_ISDIR(s.st_mode)) and not stat.S_ISLNK(s.st_mode) and s.st_uid in (0,1000) and (not stat.S_ISREG(s.st_mode) or s.st_nlink==1),'CLEAN_BUILD_SOURCE_CUSTODY');paths.append(p)
 # Only this new public source checkout is sealed; no application/secret path.
 for p in paths:
  mode=stat.S_IMODE(p.lstat().st_mode);os.chown(p,0,0);os.chmod(p,mode&~0o222)
 spec=importlib.util.spec_from_file_location('reviewed_build_context',SOURCE/'scripts/cop-api-build-context.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 m.inspect_context(str(SOURCE),REV)
 before=current();need(before.endswith(' true'),'CLEAN_BUILD_CURRENT_API_UNAVAILABLE')
 target=OPERATIONAL/'scripts/deploy-production.sh';old=target.read_bytes();need(hashlib.sha256(old).hexdigest() in (OLD_DEPLOY,NEW_DEPLOY),'CLEAN_BUILD_OPERATIONAL_SCRIPT_DRIFT')
 helper=OPERATIONAL/'scripts/cop-api-build-context.py';need(not helper.exists() or sha(helper)==HELPER,'CLEAN_BUILD_HELPER_DRIFT')
 install(helper,(SOURCE/'scripts/cop-api-build-context.py').read_bytes());install(target,(SOURCE/'scripts/deploy-production.sh').read_bytes())
 need(current()==before,'CLEAN_BUILD_API_CHANGED_BEFORE_BUILD')
 print(json.dumps({'phase':'public_build_preparation_ready','sourceRevision':REV,'apiUnchanged':True,'accountDeletionEnabled':False}),flush=True)
 # The existing deployment path enforces the dedicated X5 builder, unchanged
 # runtime/profile, source pin before/after build, image probes and health gate.
 r=subprocess.run(['/usr/sbin/runuser','-u','voldzi','--','/bin/bash',str(target),'--build-only','--api-source',REV,'--api-build-context',str(SOURCE),'cop-api'],env={**ENV,'HOME':'/home/voldzi'},check=False)
 need(current()==before,'CLEAN_BUILD_API_CHANGED')
 need(r.returncode==0,'CLEAN_BUILD_ONLY_FAILED')
 print(json.dumps({'phase':'candidate_image_built_only','sourceRevision':REV,'servicesRestarted':False,'productionDataChanged':False,'accountDeletionEnabled':False}),flush=True)

if __name__=='__main__':
 try:main()
 except Exception as e:
  code=str(e) if isinstance(e,RuntimeError) and str(e).startswith('CLEAN_BUILD_') else 'CLEAN_BUILD_PREPARATION_FAILED'
  print(json.dumps({'phase':'build_only_not_complete','code':code,'accountDeletionEnabled':False}));raise SystemExit(2)
