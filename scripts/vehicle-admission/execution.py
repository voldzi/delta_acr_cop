"""Finite process/containment helpers for the NOT-INSTALLED window proposal.
No command is run on import. No arbitrary host, image, command or user option.
"""
import fcntl,json,os,pwd,stat,subprocess
from contextlib import contextmanager
from pathlib import Path
IMAGE='sha256:1338179f0f66abf904aad04da82fc87f82f9676d758842bd00eec4b9e0662d7d'
PROFILE='206c4507-5e00-458e-b0ee-4061309aa7a8'
WORKER=Path('/usr/local/lib/cop-vehicle-window/worker.py')
def need(v,code):
 if not v:raise RuntimeError(code)
def worker_plan(value,storage_fd,*,identity=None):
 need(type(storage_fd) is int and storage_fd>=3,'WINDOW_STORAGE_FD')
 user=identity or pwd.getpwnam('voldzi');need(user.pw_uid==1000 and user.pw_gid==1000,'WINDOW_FIXED_WORKER_IDENTITY')
 env={'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/home/voldzi','LANG':'C','DOCKER_HOST':'unix:///var/run/docker.sock','COP_STORAGE_LOCK_FD':str(storage_fd)}
 return {'argv':['/usr/bin/python3','-I',str(WORKER)],'env':env,'pass_fds':(storage_fd,),'identity':user,'body':json.dumps(value,separators=(',',':')).encode()}
@contextmanager
def owned_storage_lock(storage):
 need(os.geteuid()==0,'WINDOW_ROOT_STORAGE_LOCK')
 storage.preflight()
 path=Path('/srv/cop/.storage.lock');fd=os.open(path,os.O_RDWR|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  info=os.fstat(fd);need(stat.S_ISREG(info.st_mode) and info.st_uid==1000 and stat.S_IMODE(info.st_mode)==0o600 and info.st_nlink==1,'WINDOW_STORAGE_LOCK_CUSTODY');fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);storage.preflight();yield fd
 finally:os.close(fd)

def run_worker(value,storage_fd):
 need(os.geteuid()==0,'WINDOW_ROOT_WORKER_DISPATCH')
 plan=worker_plan(value,storage_fd);fdstat=os.fstat(storage_fd);pathstat=Path('/srv/cop/.storage.lock').lstat();need(stat.S_ISREG(fdstat.st_mode) and (fdstat.st_dev,fdstat.st_ino)==(pathstat.st_dev,pathstat.st_ino),'WINDOW_STORAGE_FD_IDENTITY')
 def drop():
  os.initgroups('voldzi',1000);os.setgid(1000);os.setuid(1000)
 proc=subprocess.run(plan['argv'],input=plan['body'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=plan['env'],pass_fds=plan['pass_fds'],preexec_fn=drop,timeout=180)
 need(proc.returncode==0,'WINDOW_GUARDED_WORKER_FAILED');return json.loads(proc.stdout)
def stop_candidate(inspected,binding):
 """Caller must first validate binding via the unchanged runtime/profile guard.
 It may be the active approved window release or its own pending target. This
 never authorizes another release or an image rollback; health is not required
 merely to stop an already-bound intake process.
 """
 need(isinstance(binding,dict) and set(binding)=={'containerId','releaseId','imageId','profileGeneration'},'WINDOW_CONTAINMENT_BINDING')
 labels=inspected['Config']['Labels'];need(binding['imageId']==IMAGE and binding['profileGeneration']==PROFILE and inspected['Id']==binding['containerId'] and inspected['Image']==IMAGE and labels.get('com.cop.runtime.release')==binding['releaseId'] and labels.get('com.cop.runtime.profile-generation')==PROFILE,'WINDOW_CONTAINMENT_SCOPE')
 return binding['containerId']
def contain_owned_intake(binding):
 need(os.geteuid()==0,'WINDOW_ROOT_CONTAINMENT')
 def inspect():
  p=subprocess.run(['/usr/bin/docker','--host','unix:///var/run/docker.sock','inspect',binding['containerId']],capture_output=True,timeout=15);need(p.returncode==0,'WINDOW_CONTAINMENT_INSPECTION_FAILED');return json.loads(p.stdout)[0]
 before=inspect();cid=stop_candidate(before,binding)
 if before['State']['Running']:
  p=subprocess.run(['/usr/bin/docker','--host','unix:///var/run/docker.sock','stop','--time','20',cid],capture_output=True,timeout=45);need(p.returncode==0,'WINDOW_INTAKE_STOP_UNPROVEN')
 after=inspect();stop_candidate(after,binding);need(after['State']['Running'] is False,'WINDOW_INTAKE_STILL_RUNNING')
 return {'intakeContained':True,'containerId':cid,'apiStopped':True,'configurationCloseAccepted':False,'messagingStopped':False,'durableCleanupStateDeleted':False,'oldWriterStarted':False,'rootReconciliationRequired':True}
