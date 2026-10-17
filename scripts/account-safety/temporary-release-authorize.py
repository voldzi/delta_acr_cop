"""Explicitly approved fixed COMM/storage temporary authorization editor.
Original COMM-only contract remains unchanged.
"""
REMOTE_PROGRAM=r'''
import base64,datetime,fcntl,hashlib,json,os,re,socket,stat,sys
from pathlib import Path
def need(v):
 if not v:raise RuntimeError('TEMPORARY_COMM_AUTHORIZATION_REJECTED')
def sha(v):return hashlib.sha256(v).hexdigest()
def edit_lines(old,expected,marker,encoded_key,action):
 need(action in ['install','remove'])
 lines=old.splitlines(keepends=True);wanted=expected.encode();matched=[v for v in lines if v.rstrip(b'\r\n')==wanted];need(len(matched)<=1)
 need(all(v.rstrip(b'\r\n')==wanted for v in lines if marker.encode()in v or encoded_key.encode()in v))
 if action=='install':return old if matched else old+(b''if not old or old.endswith(b'\n')else b'\n')+wanted+b'\n'
 return b''.join(v for v in lines if v.rstrip(b'\r\n')!=wanted)
def main():
 need(os.geteuid()==0 and len(sys.argv)==3 and sys.argv[1]in['comm.home.cz','storage.home.cz']and sys.argv[2]in['install','remove'])
 peer=sys.argv[1];need(socket.gethostname().split('.')[0]==peer.split('.')[0])
 action=sys.argv[2];m=json.load(sys.stdin)
 need(set(m)=={'contractVersion','marker','publicKey','authorizedLine','authorizedLineSha256','fingerprint','expiresAt'}and m['contractVersion']=='cop-temporary-comm-public-v1')
 need(re.fullmatch(r'cop-clean-release-[a-f0-9-]{36}',m['marker'])is not None)
 parts=m['publicKey'].split();need(len(parts)==3 and parts[0]=='ssh-ed25519'and parts[2]==m['marker'])
 raw=base64.b64decode(parts[1],validate=True);need(len(raw)==51 and raw.startswith(bytes.fromhex('0000000b')+b'ssh-ed25519'+bytes.fromhex('00000020')))
 fp='SHA256:'+base64.b64encode(hashlib.sha256(raw).digest()).decode().rstrip('=');need(fp==m['fingerprint'])
 expiry=datetime.datetime.fromisoformat(m['expiresAt']);need(expiry.utcoffset()==datetime.timedelta(0))
 if action=='install':need(datetime.datetime.now(datetime.timezone.utc)<expiry<=datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=2,minutes=1))
 expected='restrict,from="192.168.10.116",expiry-time="'+expiry.strftime('%Y%m%d%H%M%SZ')+'" '+m['publicKey']
 need(m['authorizedLine']==expected and sha(expected.encode())==m['authorizedLineSha256'])
 directory=Path('/home/voldzi/.ssh');d=directory.lstat();need(stat.S_ISDIR(d.st_mode)and not directory.is_symlink()and d.st_uid==1000 and stat.S_IMODE(d.st_mode)==0o700)
 path=directory/'authorized_keys';fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  meta=os.fstat(fd);need(stat.S_ISREG(meta.st_mode)and meta.st_uid==1000 and meta.st_nlink==1 and stat.S_IMODE(meta.st_mode)in[0o600,0o644]and meta.st_size<=1048576)
  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);old=os.read(fd,1048577);need(len(old)==meta.st_size)
  new=edit_lines(old,expected,m['marker'],parts[1],action);changed=new!=old
  if changed:
   temp=directory/('.authorized_keys.'+m['marker']);out=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,stat.S_IMODE(meta.st_mode))
   try:
    with os.fdopen(out,'wb')as f:f.write(new);f.flush();os.fchown(f.fileno(),meta.st_uid,meta.st_gid);os.fsync(f.fileno())
    now=path.lstat();need((now.st_dev,now.st_ino,now.st_mtime_ns,now.st_ctime_ns,now.st_size)==(meta.st_dev,meta.st_ino,meta.st_mtime_ns,meta.st_ctime_ns,meta.st_size)and path.read_bytes()==old)
    os.replace(temp,path);dd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(dd)
    finally:os.close(dd)
   finally:
    if temp.exists():temp.unlink()
  print(json.dumps({'contractVersion':'cop-temporary-comm-authorization-result-v1','action':action,'exactAuthorizationAbsent':action=='remove','exactAuthorizationPresent':action=='install','changed':bool(changed),'authorizedLineSha256':m['authorizedLineSha256'],'existingOtherKeysChanged':False,'privateKeyReceived':False}),flush=True)
 finally:os.close(fd)
try:main()
except BaseException:
 print(json.dumps({'code':'TEMPORARY_COMM_AUTHORIZATION_FAILED'}),flush=True);raise SystemExit(2)
'''
