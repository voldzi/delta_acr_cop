#!/usr/bin/env python3
"""Actual isolated LiveKit fixture. No production secret, mount or public port."""
import argparse, importlib.util, json, os, pathlib, re, secrets, shlex, stat, subprocess
SSH=['ssh','-4','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8','-o','HostName=192.168.10.116','-o','HostKeyAlias=docker.home.cz','docker.home.cz']
HOLDER='8b3f25a792bf75b58edfca4519c4671a2b1db165a8c0d22285505dc892c7b30e'
OWNER='cop-messaging-joint-d2630fa78b21'
NAME='cop-livekit-whole-20261016'
VOLUME=NAME+'-private'
CARRIER='cop-erasure-whole-a7d2df56a653-node'
IMAGE='sha256:66be6ead8451a76456025a7d47bcce1a767a4c33d2cd359afde5c1e7e2086d21'
NODE='sha256:a06c103764701e7debc6434e3dd98e9a6d5f218d30831cb62aad566265db392f'
SERVER_LOCAL=False
MANIFEST=pathlib.Path('/private/tmp/cop-account-erasure-whole-fixture-20261016.json')
def remote(args,data=None,timeout=40,optional=False):
 r=subprocess.run((['/usr/bin/env','-u','DOCKER_CONTEXT','DOCKER_HOST=unix:///var/run/docker.sock','/bin/sh','-c',shlex.join(args)] if SERVER_LOCAL else SSH+[shlex.join(args)]),input=data,capture_output=True,timeout=timeout)
 if r.returncode and not optional: raise RuntimeError('OWNED_LIVEKIT_OPERATION_FAILED')
 return r

def main():
 global HOLDER,OWNER,NAME,VOLUME,CARRIER,MANIFEST,SERVER_LOCAL
 parser=argparse.ArgumentParser()
 parser.add_argument('--manifest',default=str(MANIFEST));parser.add_argument('--holder',default=HOLDER)
 parser.add_argument('--owner',default=OWNER);parser.add_argument('--name',default=NAME);parser.add_argument('--carrier',default=CARRIER)
 parser.add_argument('--server-local',action='store_true');parser.add_argument('--source-proof');parser.add_argument('--source-proof-sha256')
 args=parser.parse_args()
 if args.server_local:
  root=pathlib.Path(__file__).resolve().parents[2];spec=importlib.util.spec_from_file_location('whole',root/'scripts/test-account-erasure-whole-joint.py');whole=importlib.util.module_from_spec(spec);spec.loader.exec_module(whole);whole.configure_server_local(args);SERVER_LOCAL=True
 elif args.source_proof or args.source_proof_sha256:raise RuntimeError('WHOLE_SERVER_SOURCE_PROOF_REQUIRES_EXPLICIT_MODE')
 HOLDER=args.holder;OWNER=args.owner;NAME=args.name;VOLUME=NAME+'-private';CARRIER=args.carrier;MANIFEST=pathlib.Path(args.manifest)
 assert re.fullmatch('[a-f0-9]{64}',HOLDER) and re.fullmatch('cop-messaging-joint-[a-f0-9]{12}',OWNER)
 assert re.fullmatch('cop-livekit-whole-(?:full-)?[a-zA-Z0-9-]+',NAME) and re.fullmatch('cop-erasure-whole-[a-f0-9]{12}-node',CARRIER)
 assert (SERVER_LOCAL and whole.safe_manifest(MANIFEST,True)==MANIFEST) or (not SERVER_LOCAL and MANIFEST.parent==pathlib.Path('/private/tmp') and re.fullmatch(r'cop-account-erasure-whole-(?:fixture|full)-[a-zA-Z0-9-]+\.json',MANIFEST.name))
 s=MANIFEST.lstat();assert stat.S_ISREG(s.st_mode) and stat.S_IMODE(s.st_mode)==0o600 and s.st_uid==os.getuid() and s.st_nlink==1
 manifest=json.loads(MANIFEST.read_bytes())
 assert manifest['contractVersion']=='cop-account-erasure-whole-fixture-v1'
 holder=json.loads(remote(['docker','inspect',HOLDER]).stdout)[0]
 assert holder['Id']==HOLDER and holder['Config']['Labels']['cop.test.owner']==OWNER and holder['HostConfig']['NetworkMode']=='none' and holder['State']['Running']
 assert not holder['HostConfig'].get('PortBindings') and not holder['Mounts']
 image=json.loads(remote(['docker','image','inspect',IMAGE]).stdout)[0];assert image['Id']==IMAGE and 'livekit/livekit-server@sha256:483b8b7b5b0654f91f1e8bdc7b46fcd37fd9911612ecf627f97e3185a89825bd' in image['RepoDigests']
 existing=remote(['docker','inspect',NAME],optional=True)
 if existing.returncode:
  assert remote(['docker','volume','inspect',VOLUME],optional=True).returncode!=0,'Unexpected pre-existing fixture volume'
  remote(['docker','volume','create','--label','cop.test.owner='+OWNER,'--label','cop.test.component=livekit-whole-private',VOLUME])
  initialize=r"""const{randomBytes}=require('node:crypto'),fs=require('node:fs');const apiKey='cop_whole_'+randomBytes(12).toString('hex'),apiSecret=randomBytes(48).toString('base64url');const value={contractVersion:'cop-livekit-whole-fixture-v1',apiKey,apiSecret};fs.writeFileSync('/fixture/livekit.json',JSON.stringify(value),{mode:384});fs.writeFileSync('/fixture/livekit.yaml','port: 7880\nrtc:\n  tcp_port: 7881\n  port_range_start: 50100\n  port_range_end: 50110\n  use_external_ip: false\n  node_ip: 127.0.0.1\nkeys:\n  '+apiKey+': '+apiSecret+'\nlogging:\n  level: error\n',{mode:384});"""
  remote(['docker','run','--rm','--log-driver','none','--pull','never','--network','none','--user','0:0','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--mount','type=volume,src='+VOLUME+',dst=/fixture','--entrypoint','node',NODE,'-e',initialize])
  remote(['docker','create','--log-driver','none','--name',NAME,'--pull','never','--label','cop.test.owner='+OWNER,'--label','cop.test.component=livekit-whole-v1','--network','container:'+HOLDER,'--read-only','--user','0:0','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','256m','--pids-limit','80','--tmpfs','/tmp:rw,nosuid,nodev,size=16777216','--mount','type=volume,src='+VOLUME+',dst=/fixture,readonly',IMAGE,'--config','/fixture/livekit.yaml','--bind','127.0.0.1','--node-ip','127.0.0.1'])
  remote(['docker','start',NAME])
 actual=json.loads(remote(['docker','inspect',NAME]).stdout)[0]
 assert actual['Image']==IMAGE and actual['Config']['Labels']['cop.test.owner']==OWNER and actual['HostConfig']['NetworkMode']=='container:'+HOLDER and not actual['HostConfig'].get('PortBindings') and actual['HostConfig']['ReadonlyRootfs']
 assert actual['HostConfig']['LogConfig']['Type']=='none'
 assert actual['State']['Running'] and len(actual['Mounts'])==1 and actual['Mounts'][0]['Name']==VOLUME and actual['Mounts'][0]['RW'] is False
 secret=json.loads(remote(['docker','run','--rm','--log-driver','none','--pull','never','--network','none','--user','0:0','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--mount','type=volume,src='+VOLUME+',dst=/fixture,readonly','--entrypoint','node',NODE,'-e',"process.stdout.write(require('fs').readFileSync('/fixture/livekit.json'))"]).stdout)
 assert secret['contractVersion']=='cop-livekit-whole-fixture-v1' and len(secret['apiSecret'])>=32
 verify=r"""const fs=require('node:fs'),{RoomServiceClient}=require('/app/apps/cop-api/node_modules/livekit-server-sdk');let b=[];process.stdin.on('data',x=>b.push(x));process.stdin.on('end',async()=>{try{const v=JSON.parse(Buffer.concat(b)),c=new RoomServiceClient('http://127.0.0.1:7880',v.apiKey,v.apiSecret,{requestTimeout:3,failover:false});let rooms;for(let n=0;;n++){try{rooms=await c.listRooms();break;}catch(e){if(n>100)throw e;await new Promise(r=>setTimeout(r,200));}}const name='cop-whole-provider-readiness-20261016';await c.createRoom({name,emptyTimeout:30});if(!(await c.listRooms([name])).some(r=>r.name===name))throw Error('NO_ACTUAL_ROOM');await c.deleteRoom(name);if((await c.listRooms([name])).length)throw Error('ROOM_REMAINS');fs.writeFileSync('/dev/shm/cop-livekit-whole.json',JSON.stringify(v),{mode:384});process.stdout.write(JSON.stringify({actualRoomLifecycleVerified:true}));}catch(e){process.stderr.write('ACTUAL_LIVEKIT_READBACK_FAILED');process.exitCode=1;}});"""
 proof=json.loads(remote(['docker','exec','--user','0:0','-i',CARRIER,'node','-e',verify],json.dumps(secret).encode(),timeout=40).stdout)
 assert proof['actualRoomLifecycleVerified'] is True
 # Merge only the new synthetic provider binding into the newest private lease.
 original=MANIFEST.read_bytes();current=json.loads(original);assert current['actors']==manifest['actors']
 current['livekit']={'contractVersion':secret['contractVersion'],'container':NAME,'imageId':IMAGE,'privateVolume':VOLUME,'privateRef':{'container':CARRIER,'path':'/dev/shm/cop-livekit-whole.json'},'actualRoomLifecycleVerified':True}
 current['integration']['environment'].update({'COP_LIVEKIT_API_KEY':secret['apiKey'],'COP_LIVEKIT_API_SECRET':secret['apiSecret']})
 current['integration']['environment'].setdefault('COP_VOICE_CALL_E2EE_SECRET',secrets.token_urlsafe(48))
 current['integration']['environment'].update({'COP_LIVEKIT_PUBLIC_URL':'ws://127.0.0.1:7880','COP_VOICE_CALLS_ENABLED':'true','COP_LIVEKIT_TOKEN_TTL_SECONDS':'3600'})
 temp=MANIFEST.with_suffix('.livekit.tmp');fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  pending=memoryview(json.dumps(current).encode())
  while pending: pending=pending[os.write(fd,pending):]
  os.fsync(fd)
 finally: os.close(fd)
 assert MANIFEST.read_bytes()==original,'Private fixture lease changed concurrently'
 os.replace(temp,MANIFEST)
 print(json.dumps({'phase':'actual_livekit_fixture_ready','container':NAME,'imageId':IMAGE,'port':7880,'publicPorts':False,'actualRoomLifecycleVerified':True,'productionChanged':False,'secretsPrinted':False}))
if __name__=='__main__':
 try: main()
 except Exception: print(json.dumps({'phase':'actual_livekit_fixture_failed','productionChanged':False,'secretsPrinted':False}));raise SystemExit(1)
