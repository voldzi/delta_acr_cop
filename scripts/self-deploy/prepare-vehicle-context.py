#!/usr/bin/python3
"""Pinned COP source custody preparation only; never changes a running service."""
import fcntl,hashlib,json,os,socket,stat,sys
from pathlib import Path
REVISION='dd545c2060e0996385122bc0cec9269a5b1af9f2'
SOURCE=Path('/srv/x5-production/staging/cop/work/vehicle-source-dd545c2')
TARGET=Path('/srv/x5-production/staging/cop/vehicle-source-dd545c2-sealed')
VALIDATOR=Path('/srv/cop/scripts/cop-api-build-context.py')
VALIDATOR_SHA='c67d19ee3f26cf7afa6ae428bf9af60b422bb08ed376f2eaf72a9b23d744e7f6'

def need(value,code):
 if not value:raise RuntimeError(code)

def copy_fd_tree(source_fd,target_fd,source_uid,budget):
 """Open every source component relative to a pinned fd, never follow links."""
 for name in os.listdir(source_fd):
  meta=os.stat(name,dir_fd=source_fd,follow_symlinks=False)
  need(meta.st_uid==source_uid,'SOURCE_OWNER_CHANGED')
  if stat.S_ISDIR(meta.st_mode):
   child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=source_fd)
   try:
    os.mkdir(name,0o700,dir_fd=target_fd)
    out=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=target_fd)
    try:copy_fd_tree(child,out,source_uid,budget);os.fchmod(out,0o500)
    finally:os.close(out)
   finally:os.close(child)
  else:
   need(stat.S_ISREG(meta.st_mode) and meta.st_nlink==1 and meta.st_size<=256*1024*1024,'SOURCE_FILE_TYPE_OR_BOUND')
   child=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=source_fd)
   try:
    actual=os.fstat(child)
    need((actual.st_ino,actual.st_dev,actual.st_size)==(meta.st_ino,meta.st_dev,meta.st_size),'SOURCE_FILE_CHANGED')
    out=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=target_fd)
    try:
     size=0
     while True:
      part=os.read(child,1024*1024)
      if not part:break
      size+=len(part);budget[0]+=len(part)
      need(size<=meta.st_size and budget[0]<=1024**3,'SOURCE_TOTAL_BOUND')
      view=memoryview(part)
      while view: view=view[os.write(out,view):]
     after=os.fstat(child)
     need(size==meta.st_size and (after.st_mtime_ns,after.st_ctime_ns)==(actual.st_mtime_ns,actual.st_ctime_ns),'SOURCE_FILE_CHANGED')
     os.fchmod(out,0o555 if meta.st_mode&0o111 else 0o444)
    finally:os.close(out)
   finally:os.close(child)

def main():
 need(os.geteuid()==0 and socket.gethostname().split('.')[0]=='docker','ROOT_DOCKER_REQUIRED')
 os.umask(0o077)
 fd=os.open(VALIDATOR,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:raw=os.read(fd,1024*1024)
 finally:os.close(fd)
 need(hashlib.sha256(raw).hexdigest()==VALIDATOR_SHA,'VALIDATOR_CHANGED')
 namespace={'__name__':'cop_source_validator','__file__':str(VALIDATOR)}
 exec(compile(raw,str(VALIDATOR),'exec'),namespace)
 # Verify actual X5 before creating even the source custody directory.
 storage_raw=Path('/srv/cop/scripts/cop-storage.py').read_bytes()
 need(hashlib.sha256(storage_raw).hexdigest()=='801538d3d6f511b74608bec4ed1d00badbe1c73efd9c877e32670a1c49ddb36c','STORAGE_READER_CHANGED')
 storage={'__name__':'cop_storage','__file__':'/srv/cop/scripts/cop-storage.py'}
 exec(compile(storage_raw,storage['__file__'],'exec'),storage);storage['preflight']()
 lock=os.open('/srv/cop/.storage.lock',os.O_WRONLY|os.O_APPEND|os.O_NOFOLLOW)
 try:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  need(not TARGET.exists() and not TARGET.is_symlink(),'TARGET_ALREADY_EXISTS')
  source=os.open(SOURCE,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
  try:
   need(os.fstat(source).st_uid==1000 and os.fstat(source).st_dev==TARGET.parent.stat().st_dev,'SOURCE_OWNER_OR_FILESYSTEM')
   TARGET.mkdir(mode=0o700)
   target=os.open(TARGET,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
   try:copy_fd_tree(source,target,1000,[0]);os.fchmod(target,0o500)
   finally:os.close(target)
  finally:os.close(source)
  proof=namespace['inspect_context'](str(TARGET),REVISION)
  # Publish only the validated exact source for the unprivileged build client.
  for directory,dirs,files in os.walk(TARGET):
   for name in files:
    p=Path(directory)/name;p.chmod(0o555 if p.stat().st_mode&0o111 else 0o444)
   Path(directory).chmod(0o555)
  print(json.dumps({'sourceCustodyPrepared':True,'revision':REVISION,'context':str(TARGET),'proof':proof,'productionChanged':False},default=str))
 finally:os.close(lock)

if __name__=='__main__':main()
