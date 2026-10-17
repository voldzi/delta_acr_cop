"""Explicitly approved one-release SSH identity. Private key stays in Root tmpfs.
Public authorization is IP-bound, forwarding/PTY-disabled and expires in 2h.
No application, database, existing key or network configuration is changed.
"""
import base64,datetime,hashlib,json,os,re,socket,stat,subprocess,uuid,types
from pathlib import Path
DIRECTORY=Path('/run/cop-clean-reset-comm')
PUBLIC=Path('/home/voldzi/cop-clean-release-comm-public.json')
FILES={'id_ed25519','id_ed25519.pub','temporary-identity.json'}
AUTHORIZE_SHA='70a0f585254c7f3e0cce91c4c5e8a4d90d761c4db4c401473641002bbba5562a'
def need(v):
 if not v:raise RuntimeError('TEMPORARY_COMM_IDENTITY_UNPROVEN')
def sha(x):return hashlib.sha256(x).hexdigest()
def context():need(os.geteuid()==0 and socket.gethostname().split('.')[0]=='docker')
def read(path,mode):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode)and s.st_uid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==mode and s.st_size<16384)
  raw=os.read(fd,16384);t=os.fstat(fd);need(len(raw)==s.st_size and(s.st_ino,s.st_mtime_ns,s.st_ctime_ns)==(t.st_ino,t.st_mtime_ns,t.st_ctime_ns));return raw
 finally:os.close(fd)
def identity():
 context();d=DIRECTORY.lstat();need(stat.S_ISDIR(d.st_mode)and not DIRECTORY.is_symlink()and d.st_uid==0 and stat.S_IMODE(d.st_mode)==0o700)
 m=json.loads(read(DIRECTORY/'temporary-identity.json',0o600));need(m['contractVersion']=='cop-temporary-comm-identity-v1'and sha(read(DIRECTORY/'id_ed25519',0o600))==m['privateSha256']and read(DIRECTORY/'id_ed25519.pub',0o644).decode().strip()==m['publicKey'])
 need(set(p.name for p in DIRECTORY.iterdir())<=FILES|{'master.sock'})
 return m

def prepare():
 context();need(not DIRECTORY.exists()and not PUBLIC.exists())
 p=subprocess.run(['/usr/bin/findmnt','-n','-o','FSTYPE','-T','/run'],capture_output=True,check=False);need(p.returncode==0 and p.stdout.strip()==b'tmpfs')
 os.umask(0o077);DIRECTORY.mkdir(mode=0o700)
 marker='cop-clean-release-'+str(uuid.uuid4());expires=datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=2)
 r=subprocess.run(['/usr/bin/ssh-keygen','-q','-t','ed25519','-N','','-C',marker,'-f',str(DIRECTORY/'id_ed25519')],capture_output=True,check=False);need(r.returncode==0)
 os.chmod(DIRECTORY/'id_ed25519.pub',0o644)
 key=read(DIRECTORY/'id_ed25519.pub',0o644).decode().strip();parts=key.split();need(len(parts)==3 and parts[0]=='ssh-ed25519'and parts[2]==marker)
 fingerprint='SHA256:'+base64.b64encode(hashlib.sha256(base64.b64decode(parts[1],validate=True)).digest()).decode().rstrip('=')
 line='restrict,from="192.168.10.116",expiry-time="'+expires.strftime('%Y%m%d%H%M%SZ')+'" '+key
 public={'contractVersion':'cop-temporary-comm-public-v1','marker':marker,'publicKey':key,'authorizedLine':line,'authorizedLineSha256':sha(line.encode()),'fingerprint':fingerprint,'expiresAt':expires.isoformat()}
 private={**public,'contractVersion':'cop-temporary-comm-identity-v1','privateSha256':sha(read(DIRECTORY/'id_ed25519',0o600))}
 for path,value,mode in [(DIRECTORY/'temporary-identity.json',private,0o600),(PUBLIC,public,0o644)]:
  fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
  os.fchmod(fd,mode)
  with os.fdopen(fd,'wb')as f:f.write((json.dumps(value)+'\n').encode());f.flush();os.fsync(f.fileno())
 identity();return {'phase':'temporary_comm_identity_prepared','publicReceipt':str(PUBLIC),'fingerprint':fingerprint,'expiresAt':public['expiresAt'],'privateKeyPrintedOrTransferred':False,'applicationChanged':False}

def cleanup_temporary_comm_key(host):
 """Outer release finally only; inner transport.close preserves the identity."""
 m=identity();remote=host.CommunicationResetTransport();removed=False
 try:
  remote.open()
  p=Path(__file__).with_name('temporary-comm-authorize.py');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
  try:
   st=os.fstat(fd);need(stat.S_ISREG(st.st_mode)and st.st_nlink==1 and st.st_size<65536);source=os.read(fd,65536);need(len(source)==st.st_size and sha(source)==AUTHORIZE_SHA)
  finally:os.close(fd)
  a=types.ModuleType('exact_temp_auth');a.__file__=str(p);exec(compile(source,str(p),'exec'),a.__dict__)
  public={k:v for k,v in m.items()if k!='privateSha256'};public['contractVersion']='cop-temporary-comm-public-v1'
  v=json.loads(remote.run(['/usr/bin/python3','-I','-c',a.REMOTE_PROGRAM,'remove'],input=json.dumps(public).encode()))
  need(v.get('exactAuthorizationAbsent')is True);removed=True
 finally:
  remote.close()
  # Delete even if COMM is unreachable; an expiring public line cannot be
  # used once the only private key is removed. Report incomplete cleanup.
  identity()
  for name in FILES:(DIRECTORY/name).unlink()
  need(not list(DIRECTORY.iterdir()));DIRECTORY.rmdir()
  if PUBLIC.exists():
   v=json.loads(read(PUBLIC,0o644));need(v['authorizedLineSha256']==m['authorizedLineSha256']);PUBLIC.unlink()
 if not removed:raise RuntimeError('TEMPORARY_COMM_AUTHORIZATION_CLEANUP_INCOMPLETE')
 return {'temporaryPrivateIdentityRemoved':True,'exactAuthorizationAbsent':True}

if __name__=='__main__':
 try:print(json.dumps(prepare()))
 except Exception:
  print(json.dumps({'code':'TEMPORARY_COMM_IDENTITY_PREPARATION_FAILED','applicationChanged':False}));raise SystemExit(2)
