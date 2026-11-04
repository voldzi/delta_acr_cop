#!/usr/bin/python3
"""One startup observation of the approved prior image, never two app writers.
Temporary process logging only; guards retain exact decisions. No public port.
"""
import argparse,copy,hashlib,http.client,json,os,re,socket,subprocess,sys,types,urllib.parse
from pathlib import Path
IMAGE='sha256:51a10099616c4b2bbd2607391413de975fdf49ba0b2df403db6d3e9785eb9094'
GUARD='e3d31a74d1c9cf296ad2afb26382824dbbd1c5faec2fcc59d954950216c14fc3'
NAME='cop-startup-observer-20261104-long'
SCRIPT=r'''
const send=process.stdout.write.bind(process.stdout);let count=0,refreshCount=0;const emit=v=>{if(count++<100)send('COP_STARTUP_DIAG '+JSON.stringify(v)+'\n')};
const discard=(chunk,encoding,callback)=>{if(typeof encoding==='function')encoding();if(typeof callback==='function')callback();return true};process.stdout.write=discard;process.stderr.write=discard;
const {AccountErasureService}=await import('/app/apps/cop-api/dist/account-erasure.js');
const {ProviderCopiesBoundary}=await import('/app/apps/cop-api/dist/provider-copies-erasure.js');
const errorCode=e=>['ERASURE_CONTINUITY_UNAVAILABLE','ERASURE_STORE_UNAVAILABLE','ERASURE_REPLAY_UNPROVEN','PROVIDER_COPY_ERASURE_PENDING'].includes(e?.code)?e.code:'other';
const ready=AccountErasureService.prototype.cachedGuardReady;AccountErasureService.prototype.cachedGuardReady=function(...args){const result=ready.apply(this,args);if(!result)emit({kind:'cached_guard_not_ready',cacheLoaded:this.cacheLoaded,validForMs:this.continuityVerifiedUntil-Date.now(),accountClockOffsetMs:this.now().getTime()-Date.now()});return result};
const refresh=AccountErasureService.prototype.refreshCachedGuard;AccountErasureService.prototype.refreshCachedGuard=async function(...args){const t=Date.now();try{const value=await refresh.apply(this,args);refreshCount++;if(refreshCount<=3||refreshCount%100===0)emit({kind:'account_refresh_ok',refreshCount,cacheLoaded:this.cacheLoaded,validForMs:this.continuityVerifiedUntil-Date.now(),durationMs:Date.now()-t});return value}catch(e){emit({kind:'account_refresh_failed',code:errorCode(e),cacheLoaded:this.cacheLoaded,durationMs:Date.now()-t});throw e}};
const families=new Set();const run=ProviderCopiesBoundary.prototype.run;ProviderCopiesBoundary.prototype.run=async function(...args){const family=['SituationDataSource','SafetyDataSource','TakGatewaySource','SimSearchDataSource'].includes(this.options?.family)?this.options.family:'other';if(!families.has(family)){families.add(family);emit({kind:'provider_run_start',family,fenceLoaded:this.guard?.loaded??null});}try{return await run.apply(this,args)}catch(e){emit({kind:'provider_run_failed',family,code:errorCode(e),fenceLoaded:this.guard?.loaded??null,innerGuardReady:this.guard?.guard.ready()??null});throw e}};
import {createRequire} from 'node:module';const pg=createRequire('/app/apps/cop-api/package.json')('pg');const originalQuery=pg.Client.prototype.query;
function note(client,args,error){const text=typeof args[0]==='string'?args[0]:args[0]?.text;const keyword=typeof text==='string'?text.split(/\s/)[0].toUpperCase():'other';emit({kind:'sql_failure',pool:client.connectionParameters?.database==='cop_account_safety_guard'?'guard':'target',sqlState:/^[0-9A-Z]{5}$/.test(error?.code)?error.code:'unknown',queryKind:['SELECT','BEGIN','UPDATE','COMMIT','ROLLBACK'].includes(keyword)?keyword:'other'});}
pg.Client.prototype.query=function(...args){const cb=args.at(-1);if(typeof cb==='function'){args[args.length-1]=(error,result)=>{if(error)note(this,args,error);cb(error,result)};return originalQuery.apply(this,args);}try{const value=originalQuery.apply(this,args);return value&&typeof value.catch==='function'?value.catch(error=>{note(this,args,error);throw error}):value;}catch(error){note(this,args,error);throw error}};

await import('/app/apps/cop-api/dist/index.js');
'''
class DockerSocket(http.client.HTTPConnection):
 def connect(self):self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.sock.settimeout(5);self.sock.connect('/var/run/docker.sock')
def api(method,path,body=None):
 c=DockerSocket('localhost',timeout=30)
 try:
  c.request(method,path,body=None if body is None else json.dumps(body).encode(),headers={} if body is None else {'Content-Type':'application/json'});response=c.getresponse();raw=response.read();need(200<=response.status<300 or response.status==304 and method=='POST' and ('/stop?' in path or path.endswith('/start')),'OBSERVE_DOCKER_API_FAILED');return json.loads(raw) if raw else None
 finally:c.close()
def need(ok,code):
 if not ok:raise RuntimeError(code)
def main():
 a=argparse.ArgumentParser();a.add_argument('--observe',action='store_true');args=a.parse_args();need(os.geteuid()==0 and socket.gethostname().split('.')[0]=='docker','OBSERVE_ROOT_DOCKER_REQUIRED')
 os.environ.clear();os.environ.update(PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME='/root',LANG='C',DOCKER_HOST='unix:///var/run/docker.sock',DOCKER_CONFIG='/usr/local/lib/cop-self-release/docker');os.umask(0o077)
 path=Path('/usr/local/lib/cop-self-release/scripts/cop-api-runtime.py');raw=path.read_bytes();need(hashlib.sha256(raw).hexdigest()==GUARD,'OBSERVE_GUARD_HASH');r=types.ModuleType('startup_observer_runtime');r.__file__=str(path);exec(compile(raw,str(path),'exec'),r.__dict__)
 s=r.Store(uid=1000);pending=r.private_json(s.root/'pending.json',1000);directory,binding,profile=s.binding(pending['previous']['releaseId']);current=s.docker.current(directory)
 need(current['Image']==IMAGE and current['Id']==pending['restoredContainerId'] and current['Config']['Labels'].get('com.cop.runtime.release')==binding['releaseId'],'OBSERVE_EXACT_RESTORED_TARGET');s.docker.live(directory,binding,profile)
 need(current['State'].get('Health',{}).get('Status')!='healthy' and current['RestartCount']>0,'OBSERVE_ONLY_FAILED_STARTUP')
 need(dict(v.split('=',1) for v in current['Config']['Env'] if '=' in v).get('COP_SHARED_VEHICLE_COMMUNICATION_ENABLED') in (None,'false'),'OBSERVE_ADMISSION_OFF')
 print(json.dumps({'observationPreflight':True,'imageId':IMAGE,'productionChanged':False,'publicPorts':False,'guardDecisionsModified':False}),flush=True)
 if not args.observe:return
 case=Path('/var/lib/cop-self-release/startup-observer-20261104-long');need(not case.exists(),'OBSERVE_ALREADY_ATTEMPTED');case.mkdir(mode=0o700)
 # Exact existing Config/HostConfig/mounts/networks; diagnostic has no aliases,
 # published ports, restart loop or persistent log sink. Env stays in server RAM.
 config=copy.deepcopy(current['Config']);config.update(Image=IMAGE,Cmd=['--input-type=module','-e',SCRIPT],Entrypoint=['node'],Labels={'cop.test.owner':NAME},ExposedPorts={},Tty=False,OpenStdin=False,AttachStdout=True,AttachStderr=True)
 host=copy.deepcopy(current['HostConfig']);host.update(PortBindings={},PublishAllPorts=False,RestartPolicy={'Name':'no','MaximumRetryCount':0},AutoRemove=False,LogConfig={'Type':'none','Config':{}})
 body={**config,'HostConfig':host,'NetworkingConfig':{'EndpointsConfig':{n:{'NetworkID':v['NetworkID']} for n,v in current['NetworkSettings']['Networks'].items()}}}
 created=api('POST','/containers/create?name='+NAME,body);cid=created['Id'];paused=False
 try:
  fresh=s.docker.current(directory);need(all(fresh.get(k)==current.get(k) for k in ('Id','Image','Config','HostConfig','Mounts')) and {n:v['NetworkID'] for n,v in fresh['NetworkSettings']['Networks'].items()}==r.NETWORKS,'OBSERVE_STATIC_RUNTIME_CHANGED');s.docker.live(directory,binding,profile);api('POST','/containers/'+current['Id']+'/stop?t=3');paused=True;stopped=s.docker.current(directory);need(stopped['Id']==current['Id'] and not stopped['State']['Running'],'OBSERVE_ORIGINAL_NOT_PAUSED')
  try:result=subprocess.run(['docker','start','--attach',cid],capture_output=True,timeout=105)
  except subprocess.TimeoutExpired as timeout:result=types.SimpleNamespace(returncode=124,stdout=timeout.stdout or b'')
  records=[]
  for line in result.stdout.splitlines():
   if line.startswith(b'COP_STARTUP_DIAG '):records.append(json.loads(line[17:]))
  output={'startupObservationOnly':True,'imageId':IMAGE,'exitCode':result.returncode,'records':records,'guardDecisionsModified':False,'publicPorts':False}
  fd=os.open(case/'observations.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  try:os.write(fd,json.dumps(output).encode());os.fsync(fd)
  finally:os.close(fd)
  print(json.dumps(output),flush=True)
 finally:
  fixture=api('GET','/containers/'+cid+'/json');need(fixture['Id']==cid and fixture['Image']==IMAGE and fixture['Config']['Labels'].get('cop.test.owner')==NAME,'OBSERVE_CLEANUP_OWNERSHIP')
  api('DELETE','/containers/'+cid+'?force=true')
  if paused:
   unchanged=s.docker.current(directory);need(unchanged['Id']==current['Id'] and unchanged['Image']==IMAGE,'OBSERVE_ORIGINAL_CHANGED');api('POST','/containers/'+current['Id']+'/start')
  print(json.dumps({'observerRemoved':True,'originalContainerRestarted':paused,'configurationChanged':False}),flush=True)
if __name__=='__main__':
 try:main()
 except Exception as e:
  import traceback
  frame=traceback.extract_tb(e.__traceback__)[-1];print(json.dumps({'observationComplete':False,'code':str(e) if isinstance(e,RuntimeError) and str(e).startswith('OBSERVE_') or type(e).__module__=='startup_observer_runtime' and re.fullmatch('[a-z][a-z0-9_]{1,100}',str(e)) else type(e).__name__,'failureLine':frame.lineno}),flush=True);raise SystemExit(2)
