"""Finite Synapse media payload reset inside its existing application volume.
No /var/lib/docker access, volume deletion, path argument or secret read.
The Root host must hold actual stopped native/metadata writer admission.
"""
import hashlib
import json
import os
from pathlib import Path
import stat

ROOT=Path('/native-data/media_store')
PREFIXES=('local_content','local_thumbnails','remote_content','remote_thumbnail','url_cache','url_cache_thumbnails')

def need(x,code):
 if not x:raise RuntimeError(code)

def scan(root=ROOT,synthetic=False):
 if synthetic:
  need(root.parent==Path('/private/tmp') and root.name.startswith('cop-native-media-test-') and root.lstat().st_uid==os.getuid() and stat.S_IMODE(root.lstat().st_mode)==0o700,'RESET_MEDIA_OWNED_FIXTURE_REQUIRED')
 else:need(root==ROOT and os.getuid()==0,'RESET_MEDIA_ROOT_CONTEXT')
 need(root.resolve()==root and root.is_dir() and not root.is_symlink(),'RESET_MEDIA_DIRECTORY_UNSAFE')
 info=root.lstat();files=[];dirs=[]
 for prefix in root.iterdir():
  need(prefix.name in PREFIXES and prefix.is_dir() and not prefix.is_symlink(),'RESET_MEDIA_UNKNOWN_PREFIX')
  for directory,children,names in os.walk(prefix,followlinks=False):
   d=Path(directory);s=d.lstat();need(stat.S_ISDIR(s.st_mode) and not stat.S_ISLNK(s.st_mode) and s.st_dev==info.st_dev,'RESET_MEDIA_DIRECTORY_UNSAFE');dirs.append(d)
   for child in children:
    c=(d/child).lstat();need(stat.S_ISDIR(c.st_mode) and not stat.S_ISLNK(c.st_mode) and c.st_dev==info.st_dev,'RESET_MEDIA_DIRECTORY_UNSAFE')
   for name in names:
    p=d/name;s=p.lstat();need(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_dev==info.st_dev,'RESET_MEDIA_FILE_UNSAFE')
    h=hashlib.sha256()
    with p.open('rb') as f:
     while True:
      chunk=f.read(1024*1024)
      if not chunk:break
      h.update(chunk)
    after=p.lstat();need((s.st_ino,s.st_size,s.st_mtime_ns)==(after.st_ino,after.st_size,after.st_mtime_ns),'RESET_MEDIA_FILE_CHANGED')
    files.append({'path':str(p.relative_to(root)),'inode':s.st_ino,'size':s.st_size,'mtime':s.st_mtime_ns,'digest':h.hexdigest()})
 need(len(files)<=100000,'RESET_MEDIA_INVENTORY_LIMIT')
 value={'contractVersion':'cop-native-media-reset-plan-v1','rootDevice':info.st_dev,'rootInode':info.st_ino,
        'fileCount':len(files),'bytes':sum(x['size'] for x in files),
        'inventoryDigest':hashlib.sha256(json.dumps(sorted(files,key=lambda x:x['path']),sort_keys=True,separators=(',',':')).encode()).hexdigest()}
 return value,files,dirs

def inspect_media_reset(root=ROOT,synthetic=False):return scan(root,synthetic)[0]

def apply_media_reset(reviewed_plan,admission,root=ROOT,synthetic=False):
 admission.assert_current()
 before,files,dirs=scan(root,synthetic);need(before==reviewed_plan,'RESET_MEDIA_PLAN_DRIFT')
 for item in files:
  admission.assert_current()
  path=root/item['path'];s=path.lstat();need(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_dev==before['rootDevice'] and (s.st_ino,s.st_size,s.st_mtime_ns)==(item['inode'],item['size'],item['mtime']),'RESET_MEDIA_FILE_CHANGED')
  path.unlink()
 for d in sorted(dirs,key=lambda x:len(x.parts),reverse=True):
  if d.parent!=root:
   need(d.is_dir() and not d.is_symlink(),'RESET_MEDIA_DIRECTORY_CHANGED');d.rmdir()
 for p in [root,*[root/n for n in PREFIXES if (root/n).exists()]]:
  fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
  try:os.fsync(fd)
  finally:os.close(fd)
 admission.assert_current();after=inspect_media_reset(root,synthetic);need(after['fileCount']==0,'RESET_MEDIA_READBACK_FAILED')
 return {'contractVersion':'cop-native-media-reset-result-v1','removedFiles':before['fileCount'],'removedBytes':before['bytes'],'configurationTouched':False,'oldDataBackupCreated':False,'wholeAccountComplete':False}
