#!/usr/bin/python3
"""Stable bounded continuity probe; read-only unless separately approved once.
Secrets stay in server RAM and container stdin env-file, never command arguments.
"""
import argparse,hashlib,json,os,socket,stat,subprocess,sys,types
from pathlib import Path
IMAGE='sha256:51a10099616c4b2bbd2607391413de975fdf49ba0b2df403db6d3e9785eb9094'
GUARD='e3d31a74d1c9cf296ad2afb26382824dbbd1c5faec2fcc59d954950216c14fc3'
LIB=Path('/usr/local/lib/cop-self-release')
ENV_KEYS={'COP_DATABASE_URL','COP_STREAM_BUS_DATABASE_URL','COP_LEASE_DATABASE_URL','COP_DATABASE_POOL_MODE','COP_ACCOUNT_ERASURE_SECRET','COP_ACCOUNT_SAFETY_AUTHORITY_MODE','COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL','COP_ACCOUNT_SAFETY_GUARD_STORE_ID','COP_ACCOUNT_SAFETY_STORE_ID','COP_ACCOUNT_SAFETY_INCARNATION_ID'}
SCRIPT=r'''
const {loadAccountErasureContinuity}=await import('/app/apps/cop-api/dist/account-erasure-continuity-production.js');
let owner;const failures=[],stages=[];let assertionInvoked=false;
import {createRequire} from 'node:module';const pg=createRequire('/app/apps/cop-api/package.json')('pg');const originalQuery=pg.Client.prototype.query;
function note(client,args,error){const text=typeof args[0]==='string'?args[0]:args[0]?.text;const keyword=typeof text==='string'?text.split(/\s/)[0].toUpperCase():'other';failures.push({pool:client.connectionParameters?.database==='cop_account_safety_guard'?'guard':'target',sqlState:/^[0-9A-Z]{5}$/.test(error?.code)?error.code:'unknown',queryKind:['SELECT','BEGIN','UPDATE','COMMIT','ROLLBACK'].includes(keyword)?keyword:'other'});}
pg.Client.prototype.query=function(...args){const cb=args.at(-1);if(typeof cb==='function'){args[args.length-1]=(error,result)=>{if(error)note(this,args,error);cb(error,result)};return originalQuery.apply(this,args);}try{const value=originalQuery.apply(this,args);return value&&typeof value.catch==='function'?value.catch(error=>{note(this,args,error);throw error}):value;}catch(error){note(this,args,error);throw error}};
try {owner=await loadAccountErasureContinuity();
const replay=await owner.snapshot();stages.push('snapshot');const before=await owner.guard.query("SELECT replay_sequence::integer n,replay_digest=$1 same FROM cop_safety_v2.dataset_replays WHERE owner='cop'",[replay.frontier.digest]);if(before.rows[0]?.n!==replay.frontier.sequence||before.rows[0]?.same!==true)throw new Error('CURRENT_REPLAY_NOT_IDENTICAL');stages.push('identical_watermark');
let validForMilliseconds=null;
if(process.argv[1]==='assert-once'){assertionInvoked=true;const result=await owner.assertCurrent(replay.frontier);validForMilliseconds=Date.parse(result.validUntil)-Date.now();stages.push('normal_assertion_completed');}
console.log(JSON.stringify({probeCompleted:true,readOnly:!assertionInvoked,assertionInvoked,validForMilliseconds,existingReplayWatermarkUnchanged:true,fenceCount:replay.entries.length,sqlFailures:failures,stages}));
} catch(e){console.log(JSON.stringify({probeCompleted:false,assertionInvoked,stages,sqlFailures:failures,code:['ERASURE_CONTINUITY_UNAVAILABLE','ERASURE_REPLAY_UNPROVEN'].includes(e?.code)?e.code:'PROBE_UNPROVEN'}));process.exitCode=2;}
finally{await owner?.close?.();}
'''
def need(ok,code):
 if not ok:raise RuntimeError(code)
def main():
 a=argparse.ArgumentParser();a.add_argument('--assert-once',action='store_true');args=a.parse_args()
 need(os.geteuid()==0 and socket.gethostname().split('.')[0]=='docker','PROBE_ROOT_DOCKER_REQUIRED')
 os.environ.clear();os.environ.update(PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME='/root',LANG='C',DOCKER_CONFIG=str(LIB/'docker'),DOCKER_HOST='unix:///var/run/docker.sock')
 p=LIB/'scripts/cop-api-runtime.py';raw=p.read_bytes();need(hashlib.sha256(raw).hexdigest()==GUARD,'PROBE_GUARD_CHANGED');r=types.ModuleType('continuity_probe_runtime');r.__file__=str(p);exec(compile(raw,str(p),'exec'),r.__dict__)
 s=r.Store(uid=1000);pending=r.private_json(s.root/'pending.json',1000);old_dir,binding,profile=s.binding(pending['previous']['releaseId']);current=s.docker.current(old_dir)
 need(current['Image']==IMAGE and current['Config']['Labels'].get('com.cop.runtime.release')==binding['releaseId'],'PROBE_EXACT_CURRENT_IMAGE')
 s.docker.live(old_dir,binding,profile);s.docker.mounts(IMAGE,binding['driverContract']['caSha256'])
 actual=dict(v.split('=',1) for v in current['Config']['Env'] if '=' in v);env={k:v for k,v in actual.items() if k in ENV_KEYS};need(all('\n' not in v and '\r' not in v for v in env.values()),'PROBE_ENV_ENCODING')
 name='cop-continuity-stable-20261104'+('-assert' if args.assert_once else '-readonly');case=Path('/var/lib/cop-self-release');case.mkdir(exist_ok=True,mode=0o700)
 if args.assert_once:
  marker=case/'stable-continuity-assert-once-invoked';fd=os.open(marker,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.write(fd,b'One separately approved stable diagnostic assertion. Never automatically replay.\n');os.fsync(fd);os.close(fd)
 args_cli=['docker','--host','unix:///var/run/docker.sock','run','--rm','--name',name,'--label','cop.test.owner='+name,'--network','cop_default','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','256m','--cpus','1','--pids-limit','64','--env-file','/dev/stdin','--mount','type=bind,src=/etc/vcode-cop-pgbouncer/postgres-ca.crt,dst=/etc/vcode-cop-pgbouncer/postgres-ca.crt,readonly','--entrypoint','node',IMAGE,'--input-type=module','-e',SCRIPT,'assert-once' if args.assert_once else 'readonly']
 need(subprocess.run(['docker','inspect',name],capture_output=True).returncode!=0,'PROBE_FIXTURE_EXISTS')
 try:
  result=subprocess.run(args_cli,input=''.join(k+'='+v+'\n' for k,v in env.items()).encode(),capture_output=True,timeout=45)
 finally:
  remaining=subprocess.run(['docker','inspect',name],capture_output=True)
  if remaining.returncode==0:
   fixture=json.loads(remaining.stdout)[0];need(fixture['Image']==IMAGE and fixture['Config']['Labels'].get('cop.test.owner')==name,'PROBE_CLEANUP_OWNER_CHANGED');subprocess.run(['docker','rm','-f',fixture['Id']],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)

 records=[]
 for line in result.stdout.splitlines():
  if line.startswith(b'{'):
   try:record=json.loads(line)
   except ValueError:continue
   if type(record.get('probeCompleted')) is bool:records.append(record)
 need(len(records)==1,'PROBE_RESULT_UNPROVEN');record=records[0];output=json.dumps(record,sort_keys=True).encode();path=case/(name+'-result.json');fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:os.write(fd,output);os.fsync(fd)
 finally:os.close(fd)
 print(output.decode(),flush=True);need(result.returncode==0 and record['probeCompleted'] is True,'PROBE_FAILED')
if __name__=='__main__':
 try:main()
 except Exception as e:
  import traceback
  f=traceback.extract_tb(e.__traceback__)[-1];print(json.dumps({'probeCompleted':False,'code':str(e) if isinstance(e,RuntimeError) and str(e).startswith('PROBE_') else type(e).__name__,'failureLine':f.lineno}),flush=True);raise SystemExit(2)
