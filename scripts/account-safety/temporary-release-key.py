"""Approved one-release COMM + storage identity, Root RAM only.
Separate peer authorization contract; COMM-only v1 keeps its original scope.
"""
import datetime,hashlib,json,os,socket,stat,subprocess,types,shlex
from pathlib import Path
HOSTS=['comm.home.cz','storage.home.cz']
PEER_DIRECTORY=Path('/run/cop-clean-reset-peers')
PEER_FILE=PEER_DIRECTORY/'peer-authorizations.json'
PUBLIC=Path('/home/voldzi/cop-clean-release-peers-public.json')
KEY_HELPER=Path('/home/voldzi/cop-clean-release-temporary-comm-key.py')
KEY_SHA='87ea81867ac8bdb3605b7b186c550710b7b9ac268da7667b1b6ce60b22dd852a'
AUTHORIZE=Path('/home/voldzi/temporary-release-authorize.py')
AUTHORIZE_SHA='a4d02c630731daf72cba098b8d9aae513601f4aa626696dda29aeedaeb1b9e15'
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/root','LANG':'C'}
def need(v):
 if not v:raise RuntimeError('ROOT_RELEASE_PEER_IDENTITY_UNPROVEN')
def sha(v):return hashlib.sha256(v).hexdigest()
def context():need(os.geteuid()==0 and socket.gethostname().split('.')[0]=='docker')
def read(path,mode=None,root=True,limit=65536):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_size<limit and(not root or s.st_uid==0)and(mode is None or stat.S_IMODE(s.st_mode)==mode))
  raw=os.read(fd,limit);t=os.fstat(fd);need(len(raw)==s.st_size and(s.st_ino,s.st_mtime_ns,s.st_ctime_ns)==(t.st_ino,t.st_mtime_ns,t.st_ctime_ns));return raw
 finally:os.close(fd)
def module(path,digest):
 raw=read(path,root=False);need(sha(raw)==digest);m=types.ModuleType('pinned_release_peer');m.__file__=str(path);exec(compile(raw,str(path),'exec'),m.__dict__);return m
def key_helper():return module(KEY_HELPER,KEY_SHA)
def public_identity(private):
 v={k:v for k,v in private.items()if k!='privateSha256'};v['contractVersion']='cop-temporary-comm-public-v1';return v
def validate_binding(receipt,private):
 need(set(receipt)=={'contractVersion','purpose','hosts','identity'}and receipt['contractVersion']=='cop-release-peer-identity-v1'and receipt['purpose']=='cop-sim-clean-release'and receipt['hosts']==HOSTS and receipt['identity']==public_identity(private))
def identity():
 context();d=PEER_DIRECTORY.lstat();need(stat.S_ISDIR(d.st_mode)and not PEER_DIRECTORY.is_symlink()and d.st_uid==0 and stat.S_IMODE(d.st_mode)==0o700)
 r=subprocess.run(['/usr/bin/findmnt','-n','-o','FSTYPE','-T',str(PEER_DIRECTORY)],capture_output=True,env=ENV,timeout=8);need(r.returncode==0 and r.stdout.strip()==b'tmpfs')
 need(set(p.name for p in PEER_DIRECTORY.iterdir())=={'peer-authorizations.json'})
 v=json.loads(read(PEER_FILE,0o600));validate_binding(v,key_helper().identity());return v
def identity_for_peer(host,check_expiry=True):
 need(host in HOSTS);v=identity();m=v['identity'];expires=datetime.datetime.fromisoformat(m['expiresAt']);now=datetime.datetime.now(datetime.timezone.utc)
 need(expires.tzinfo is not None and expires.utcoffset()==datetime.timedelta(0))
 if check_expiry:need(now<expires<=now+datetime.timedelta(hours=2,minutes=1))
 key=Path('/run/cop-clean-reset-comm/id_ed25519')
 p=subprocess.run(['/usr/bin/ssh-keygen','-y','-f',str(key)],capture_output=True,env=ENV,timeout=8);need(p.returncode==0)
 fields=p.stdout.decode().split();expected=m['publicKey'].split();need(len(expected)==3 and expected[2]==m['marker']and len(fields)in[2,3]and fields[:2]==expected[:2]and(len(fields)==2 or fields[2]==m['marker']))
 return {'identityFile':str(key),'fingerprint':m['fingerprint'],'authorizedLineSha256':m['authorizedLineSha256'],'expiresAt':m['expiresAt'],'host':host}
def prepare():
 context();need(not PEER_DIRECTORY.exists()and not PUBLIC.exists())
 k=key_helper();result=k.prepare();m=k.identity();os.umask(0o077);PEER_DIRECTORY.mkdir(mode=0o700)
 v={'contractVersion':'cop-release-peer-identity-v1','purpose':'cop-sim-clean-release','hosts':HOSTS,'identity':public_identity(m)}
 for path,mode in [(PEER_FILE,0o600),(PUBLIC,0o644)]:
  fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode);os.fchmod(fd,mode)
  with os.fdopen(fd,'wb')as f:f.write((json.dumps(v)+'\n').encode());f.flush();os.fsync(f.fileno())
 identity();return {'phase':'temporary_release_peer_identity_prepared','publicReceipt':str(PUBLIC),'hosts':HOSTS,'fingerprint':result['fingerprint'],'expiresAt':result['expiresAt'],'privateKeyPrintedOrTransferred':False,'applicationChanged':False}
def remove_peer(host,public,program):
 binding=identity_for_peer(host,check_expiry=False)
 args=['/usr/bin/ssh','-F','/dev/null','-o','BatchMode=yes','-o','PasswordAuthentication=no','-o','KbdInteractiveAuthentication=no','-o','PubkeyAuthentication=yes','-o','PreferredAuthentications=publickey','-o','IdentityAgent=none','-o','IdentitiesOnly=yes','-i',binding['identityFile'],'-o','ForwardAgent=no','-o','ForwardX11=no','-o','StrictHostKeyChecking=yes','-o','UpdateHostKeys=no','-o','UserKnownHostsFile=/home/voldzi/.ssh/known_hosts','-o','GlobalKnownHostsFile=/dev/null','-o','ConnectTimeout=8','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','voldzi@'+host,shlex.join(['/usr/bin/sudo','-n','/usr/bin/python3','-I','-c',program,host,'remove'])]
 r=subprocess.run(args,input=json.dumps(public).encode(),capture_output=True,env=ENV,timeout=30)
 need(r.returncode==0);v=json.loads(r.stdout);need(v.get('exactAuthorizationAbsent')is True and v.get('existingOtherKeysChanged')is False);return True
def remove_both(public,program,remove):
 result={}
 for host in HOSTS:
  try:result[host]=remove(host,public,program)is True
  except BaseException:result[host]=False
 return result
def close_control(host,path):
 if not os.path.lexists(path):return True
 d=path.parent.lstat();sock=path.lstat()
 need(stat.S_ISDIR(d.st_mode)and not path.parent.is_symlink()and d.st_uid==0 and stat.S_IMODE(d.st_mode)==0o700)
 need(stat.S_ISSOCK(sock.st_mode)and sock.st_uid==0 and not stat.S_IMODE(sock.st_mode)&0o077)
 base=['/usr/bin/ssh','-F','/dev/null','-S',str(path),'-o','BatchMode=yes','-o','ProxyCommand=/usr/bin/false']
 exited=subprocess.run(base+['-O','exit','voldzi@'+host],stdin=subprocess.DEVNULL,capture_output=True,env=ENV,timeout=8)
 need(exited.returncode==0)
 checked=subprocess.run(base+['-O','check','voldzi@'+host],stdin=subprocess.DEVNULL,capture_output=True,env=ENV,timeout=8)
 need(checked.returncode!=0)
 if os.path.lexists(path):
  current=path.lstat();need((current.st_dev,current.st_ino,current.st_uid)==(sock.st_dev,sock.st_ino,0)and stat.S_ISSOCK(current.st_mode));path.unlink()
 return True
def close_controls():
 result={}
 for host,path in [('comm.home.cz',Path('/run/cop-clean-reset-comm/master.sock')),('storage.home.cz',Path('/run/cop-clean-reset-storage/master.sock'))]:
  try:result[host]=close_control(host,path)is True
  except BaseException:result[host]=False
 return result
def wipe_local(v):
 k=key_helper();private=k.identity();validate_binding(v,private)
 need(set(p.name for p in k.DIRECTORY.iterdir())<=k.FILES|{'master.sock'})
 # Check every removable file before deleting any private authority.
 need(json.loads(read(k.PUBLIC,0o644))==v['identity'])
 need(json.loads(read(PUBLIC,0o644))==v)
 need(json.loads(read(PEER_FILE,0o600))==v)
 for name in k.FILES:(k.DIRECTORY/name).unlink()
 if not list(k.DIRECTORY.iterdir()):k.DIRECTORY.rmdir()
 k.PUBLIC.unlink();PEER_FILE.unlink();PEER_DIRECTORY.rmdir();PUBLIC.unlink()
 return True
def cleanup_release_identity():
 v=identity();peers={host:False for host in HOSTS};controls={host:False for host in HOSTS};wiped=False
 try:
  authorizer=module(AUTHORIZE,AUTHORIZE_SHA)
  peers=remove_both(v['identity'],authorizer.REMOTE_PROGRAM,remove_peer)
 finally:
  try:controls=close_controls()
  finally:wiped=wipe_local(v)
 return {'peers':peers,'controlPeers':controls,'controlSessionsClosed':all(controls.values()),'temporaryPrivateIdentityRemoved':wiped,'exactAuthorizationsAbsent':all(peers.values())}
if __name__=='__main__':
 try:print(json.dumps(prepare()))
 except BaseException:
  print(json.dumps({'code':'ROOT_RELEASE_PEER_PREPARATION_FAILED','applicationChanged':False}));raise SystemExit(2)
