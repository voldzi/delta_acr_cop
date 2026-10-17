"""Exact two-service disabled start after the finite test-data reset.
Root-only, private server-to-server input; never an app endpoint or old fallback.
Preserves the old Compose chains and all non-erasure environment/network/mounts.
"""
import base64
import fcntl
import hashlib
import json
import os
import re
import socket

PHASES=['identity','cop','ai','driver','files','sim_app_files','sim_user_install','cop_safety_install','remaining','messaging_install','readback','sim_config']
FLAGS=['CSM_ACCOUNT_ERASURE_ENABLED','CSM_ACCOUNT_ERASURE_OWNER_V2_ENABLED','CSM_ACCOUNT_ERASURE_LOCAL_CONTENT_ENABLED','CSM_COP_MOBILITY_EFFECTS_ERASURE_ENABLED']

def need(v,code='MESSAGING_DISABLED_START_REJECTED'):
 if not v:raise RuntimeError(code)

def validate_reset(result,plan):
 need(result.get('contractVersion')=='cop-sim-common-reset-fenced-v1' and result.get('resetEpoch')==plan['resetEpoch'] and result.get('completedPhases')==PHASES and result.get('servicesRestarted')is False and result.get('runtimeFlagsEnabled')is False)

def disabled_environment(binding,ca_sha):
 need(binding.get('issuer')=='https://login.zeleznalady.cz/realms/cop' and binding.get('serverName')=='docker.home.cz' and isinstance(ca_sha,str) and re.fullmatch('[a-f0-9]{64}',ca_sha))
 need(binding.get('clientIds')==['cop-web','csm-mobile'] and isinstance(binding.get('providerOrigin'),str) and re.fullmatch(r'https://[a-z0-9][a-z0-9.:-]*',binding['providerOrigin']))
 return {**{k:'false' for k in FLAGS},'CSM_ACCOUNT_ERASURE_AUTHORITY_MODE':'database_v2','CSM_SYNAPSE_ACCOUNT_ERASURE_PROFILE':'full_v2_credential_reviewed','CSM_COP_OIDC_ISSUER':binding['issuer'],'CSM_COP_OIDC_CLIENT_IDS':','.join(binding['clientIds']),'CSM_ACCOUNT_SAFETY_PROVIDER_ORIGIN':binding['providerOrigin'],'CSM_ACCOUNT_SAFETY_GUARD_CA_FILE':'/run/csm-postgresql-ca.pem','CSM_ACCOUNT_SAFETY_GUARD_CA_SHA256':ca_sha}

REMOTE_PROGRAM = r"""
import base64,fcntl,hashlib,ipaddress,json,os,re,socket,stat,subprocess,sys,time
from pathlib import Path
from urllib.parse import urlsplit,quote,unquote
BASE=Path('/srv/csm-messaging');N='csm-matrix-synapse';A='csm-messaging-api'
def need(v):
 if not v:raise RuntimeError('MESSAGING_RUNTIME_TRANSITION_UNPROVEN')
def run(a,b=None,t=60):
 p=subprocess.run(a,input=b,capture_output=True,timeout=t)
 need(p.returncode==0);return p.stdout
def inspect(n):return json.loads(run(['/usr/bin/docker','inspect',n]))[0]
def public_file(p,raw):
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o444)
 with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
def main():
 need(os.getuid()==0 and socket.gethostname().split('.')[0]=='comm')
 x=json.load(sys.stdin);need(x['contractVersion']=='cop-messaging-disabled-start-private-v1' and set(x['expectedOld'])=={N,A})
 fd=os.open(BASE/'.account-erasure-release.lock',os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600);v=os.fstat(fd);need(v.st_uid==0 and v.st_nlink==1 and stat.S_IMODE(v.st_mode)==0o600);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
 old={n:inspect(n)for n in [N,A]}
 for n,v in old.items():need(v['Id']==x['expectedOld'][n]['id'] and v['Image']==x['expectedOld'][n]['image'] and v['State']['Running']is False and v['State']['Pid']==0 and not v['State']['Restarting'])
 for v in old.values():need(v['Config']['Labels']['com.docker.compose.project']=='csm-messaging' and v['Config']['Labels']['com.docker.compose.project.working_dir']==str(BASE))
 need(old[N]['Config']['Labels']['com.docker.compose.service']=='synapse' and old[A]['Config']['Labels']['com.docker.compose.service']=='api')
 need(old[N]['Config']['Entrypoint']==['/start.py'] and old[N]['Config']['Cmd']==['run','--config-path','/data/homeserver.yaml','--config-path','/opt/cop-private/modules.yaml'])
 env=dict(i.split('=',1)for i in old[A]['Config']['Env']if'='in i)
 rawkey=base64.b64decode(env['CSM_MESSAGING_SECRET_ENCRYPTION_KEY_BASE64'],validate=True);need(len(rawkey)==32)
 import hmac
 key=hmac.digest(rawkey,b'messaging-erasure-owner-mac-key-v1\0','sha256');need(hashlib.sha256(b'messaging-erasure-owner-key-fingerprint-v1\0'+key).hexdigest()==x['ownerKeyFingerprint'])
 uri=urlsplit(env['DATABASE_URL'].replace('ecto://','postgresql://',1));need(uri.username=='csm_messaging' and uri.password and uri.path=='/csm_messaging')
 updates=x['environment'];need(set(updates)==set(['CSM_ACCOUNT_ERASURE_ENABLED','CSM_ACCOUNT_ERASURE_OWNER_V2_ENABLED','CSM_ACCOUNT_ERASURE_LOCAL_CONTENT_ENABLED','CSM_COP_MOBILITY_EFFECTS_ERASURE_ENABLED','CSM_ACCOUNT_ERASURE_AUTHORITY_MODE','CSM_SYNAPSE_ACCOUNT_ERASURE_PROFILE','CSM_COP_OIDC_ISSUER','CSM_COP_OIDC_CLIENT_IDS','CSM_ACCOUNT_SAFETY_PROVIDER_ORIGIN','CSM_ACCOUNT_SAFETY_GUARD_CA_FILE','CSM_ACCOUNT_SAFETY_GUARD_CA_SHA256']));need(all(updates.get(k)=='false'for k in ['CSM_ACCOUNT_ERASURE_ENABLED','CSM_ACCOUNT_ERASURE_OWNER_V2_ENABLED','CSM_ACCOUNT_ERASURE_LOCAL_CONTENT_ENABLED','CSM_COP_MOBILITY_EFFECTS_ERASURE_ENABLED']))
 need('CSM_COMMUNICATION_SAFETY_ENABLED'not in updates and 'CSM_APP_DEVICE_LEDGER_ENABLED'not in updates)
 updates['CSM_ACCOUNT_SAFETY_GUARD_DATABASE_URL']='postgresql://csm_messaging:'+quote(unquote(uri.password),safe='')+'@haproxy.home.cz:5000/cop_account_safety_guard?sslmode=verify-full'
 ca=base64.b64decode(x['caBase64'],validate=True);need(hashlib.sha256(ca).hexdigest()==updates['CSM_ACCOUNT_SAFETY_GUARD_CA_SHA256'] and b'PRIVATE KEY'not in ca and b'BEGIN CERTIFICATE'in ca)
 directory=BASE/'account-safety';need(not directory.exists());directory.mkdir(mode=0o750);public_file(directory/'postgres-ca.pem',ca)
 path=BASE/'.env';need(not path.is_symlink());f=os.open(path,os.O_RDONLY|os.O_NOFOLLOW);meta=os.fstat(f);need(meta.st_uid in [0,1000] and stat.S_IMODE(meta.st_mode)==0o600 and meta.st_nlink==1 and meta.st_size<=1048576);raw=os.read(f,1048577);os.close(f);need(len(raw)==meta.st_size)
 kept=[]
 for line in raw.decode().splitlines():
  match=re.match(r'^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=',line)
  if not match or match[1]not in updates:kept.append(line)
 for k,v in updates.items():need(re.fullmatch('[A-Z][A-Z0-9_]+',k) and isinstance(v,str)and not any(c in v for c in "\0\r\n'\"$"))
 new=('\n'.join(kept)+'\n'+''.join(k+'='+v+'\n'for k,v in sorted(updates.items()))).encode();temp=BASE/'.env.erasure-disabled-new'
 out=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(out,'wb')as f:f.write(new);f.flush();os.fsync(f.fileno());os.fchown(f.fileno(),meta.st_uid,meta.st_gid)
 now=path.lstat();need((now.st_ino,now.st_mtime_ns,now.st_ctime_ns,now.st_size)==(meta.st_ino,meta.st_mtime_ns,meta.st_ctime_ns,meta.st_size) and path.read_bytes()==raw);os.replace(temp,path)
 overlay={'services':{'api':{'image':x['candidateImages']['messaging_api'],'environment':{k:'${'+k+':?}'for k in updates},'volumes':[{'type':'bind','source':str(directory/'postgres-ca.pem'),'target':'/run/csm-postgresql-ca.pem','read_only':True}]},'synapse':{'image':x['candidateImages']['synapse'],'command':['run','--config-path','/data/homeserver.yaml','--config-path','/opt/cop-private/modules.credential-reviewed.yaml']}}}
 overlay_path=directory/'disabled-runtime.compose.json';public_file(overlay_path,(json.dumps(overlay,indent=2)+'\n').encode())
 original_files={};commands={}
 for name,service in [(N,'synapse'),(A,'api')]:
  files=old[name]['Config']['Labels']['com.docker.compose.project.config_files'].split(',');need(files and len(files)<=12)
  args=['/usr/bin/docker','compose','--project-name','csm-messaging','--project-directory',str(BASE),'--env-file',str(path),'--profile','matrix']
  for filename in files:
   p=Path(filename);need(p.parent==BASE and not p.is_symlink() and p.is_file());original_files[filename]=p.read_bytes();args+=['-f',filename]
  args+=['-f',str(overlay_path),'up','-d','--no-deps','--pull','never',service];commands[name]=args
 for name in [N,A]:
  need(inspect(name)['Id']==old[name]['Id']);run(commands[name],t=180)
 current={n:inspect(n)for n in [N,A]}
 for n,image in [(N,x['candidateImages']['synapse']),(A,x['candidateImages']['messaging_api'])]:
  v=current[n];need(v['Image']==image and v['Id']!=old[n]['Id'] and v['State']['Running']is True)
  need(set(v['NetworkSettings']['Networks'])==set(old[n]['NetworkSettings']['Networks']) and v['HostConfig']['PortBindings']==old[n]['HostConfig']['PortBindings'])
  oe=dict(i.split('=',1)for i in old[n]['Config']['Env']if'='in i);ne=dict(i.split('=',1)for i in v['Config']['Env']if'='in i);allowed=set(updates)if n==A else set();need({k:z for k,z in oe.items()if k not in allowed}=={k:z for k,z in ne.items()if k not in allowed})
  if n==A:need(all(ne.get(k)==z for k,z in updates.items()))
 for filename,raw in original_files.items():need(Path(filename).read_bytes()==raw)
 common=set(current[N]['NetworkSettings']['Networks'])&set(current[A]['NetworkSettings']['Networks']);need(common=={'csm-messaging_default'});api_ip=current[A]['NetworkSettings']['Networks']['csm-messaging_default']['IPAddress'];need(ipaddress.ip_address(api_ip).is_private);api_env=dict(i.split('=',1)for i in current[A]['Config']['Env']if'='in i);port=int(api_env.get('PORT','4050'));need(1<=port<=65535)
 probe="import json,sys,urllib.request,urllib.error\nu=json.load(sys.stdin)['url']\ntry:\n with urllib.request.urlopen(u,timeout=10)as r:status=r.status;v=json.load(r)\nexcept urllib.error.HTTPError as r:status=r.code;v=json.load(r)\nprint(json.dumps({'status':status,'ready':v.get('status')=='ok'}))"
 ready=False
 for _ in range(40):
  try:
   observed=json.loads(run(['/usr/bin/docker','exec','-i',N,'python','-c',probe],json.dumps({'url':'http://'+api_ip+':'+str(port)+'/health/ready'}).encode(),t=15));ready=observed=={'status':200,'ready':True}
   if ready:break
  except Exception:pass
  time.sleep(1)
 need(ready)
 print(json.dumps({'contractVersion':'cop-messaging-disabled-runtime-result-v1','runtimeReady':True,'erasureEnabled':False,'oldImageFallback':False,'containerBindings':{n:{'id':v['Id'],'image':v['Image']}for n,v in current.items()},'networksAndPortsPreserved':True,'originalComposeFilesPreserved':True,'secretsStayedOnServer':True}),flush=True)
if __name__=='__main__':
 try:main()
 except BaseException:
  print(json.dumps({'code':'MESSAGING_DISABLED_RUNTIME_FAILED','erasureEnabled':False,'oldImageFallback':False}),flush=True);raise SystemExit(2)
"""

def start_messaging_disabled(host,remote,reset_result,private_config):
 need(os.getuid()==0 and socket.gethostname().split('.')[0]=='docker')
 need(type(remote)is host.CommunicationResetTransport)
 owner=host.RootResetAdmission(remote,host.DriverReportProducerCustody());validate_reset(reset_result,owner.plan)
 ca=host.protected('/etc/vcode-cop-pgbouncer/postgres-ca.crt',mode=(0o444,0o644,0o640,0o600),max_bytes=262144)
 need(b'PRIVATE KEY'not in ca and b'BEGIN CERTIFICATE'in ca)
 envelope=private_config['messagingInstall']['reviewedPlan'];need(hashlib.sha256(json.dumps(envelope,sort_keys=True,separators=(',',':')).encode()).hexdigest()==owner.plan['reviewedPlanDigests']['messaging_install'])
 packet={'contractVersion':'cop-messaging-disabled-start-private-v1','expectedOld':owner.plan['remoteWriters'],'candidateImages':{k:owner.plan['candidateImages'][k]for k in ['messaging_api','synapse']},'ownerKeyFingerprint':envelope['configuration']['binding']['ownerKeyFingerprint'],'caBase64':base64.b64encode(ca).decode(),'environment':disabled_environment(envelope['configuration']['binding'],hashlib.sha256(ca).hexdigest())}
 try:
  owner._acquire();owner._assert_files();host.assert_stopped(host.inspect_writers(host.command,host.LOCAL_WRITERS),owner.plan['localWriters']);remote.assert_stopped(owner.plan['remoteWriters'])
  need(reset_result['preStopReportSha256']==host._acceptance_module().verified_pre_stop_acceptance(owner.plan['candidateImages'])['reportSha256'])
  for image in packet['candidateImages'].values():
   need(re.fullmatch('sha256:[a-f0-9]{64}',image));raw=host.command(['/usr/bin/docker','image','save',image],timeout=180);need(len(raw)<=1073741824);remote.run(['/usr/bin/docker','image','load'],input=raw,timeout=300)
  result=json.loads(remote.run(['/usr/bin/python3','-I','-c',REMOTE_PROGRAM],input=json.dumps(packet,separators=(',',':')).encode(),timeout=600));need(result.get('runtimeReady')is True and result.get('erasureEnabled')is False and result.get('oldImageFallback')is False)
  owner._assert_files();host.assert_stopped(host.inspect_writers(host.command,host.LOCAL_WRITERS),owner.plan['localWriters']);return result
 finally:owner.__exit__(None,None,None)
