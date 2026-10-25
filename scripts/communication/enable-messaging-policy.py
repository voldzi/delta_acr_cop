#!/usr/bin/env python3
"""Enable the existing canonical communication policy in the same Messaging image.
Runs on COMM with its existing administrator permission. No secrets leave COMM.
Only the fixed final Compose overlay flag and stale image pin may change.
The image pin is aligned to the already running accepted image, not a new build.
"""
import argparse, hashlib, json, os, socket, stat, subprocess, sys, fcntl, time
from pathlib import Path
BASE=Path('/srv/csm-messaging')
OVERLAY=BASE/'account-safety/disabled-runtime-portable.compose.json'
FLAG='CSM_COMMUNICATION_SAFETY_ENABLED'
IMAGE='sha256:531a5282d086300df960f270e5e17d4aa928abc3180af4d14a23d3edc18d9d25'
CONFIGURED_IMAGE='sha256:e0ac7f6efb33ce1c0daa7d0a7a076a9241d778ecfc999e37f9848d79a242d35f'
SOURCE='94a89c2304e95693fe5f4d00ad96172aff86bfc500f4bc083947ac8b49d945b0'
def need(value,code):
    if not value: raise RuntimeError(code)
def run(args,timeout=60):
    p=subprocess.run(args,capture_output=True,timeout=timeout)
    need(p.returncode==0,'COMMAND_FAILED')
    return p.stdout
def inspect(name):return json.loads(run(['docker','inspect',name]))[0]
def config(args):return json.loads(run(args+['config','--format','json']))
def changed_overlay(raw):
    value=json.loads(raw)
    env=value['services']['api'].setdefault('environment',{})
    need(isinstance(env,dict) and env.get(FLAG) in (None,'false'),'FLAG_SCOPE')
    env[FLAG]='true'
    value['services']['api']['image']=IMAGE
    return (json.dumps(value,indent=2)+'\n').encode()
def check_effective(before,after):
    expected=json.loads(json.dumps(before))
    expected['services']['api'].setdefault('environment',{})[FLAG]='true'
    expected['services']['api']['image']=IMAGE
    need(expected==after,'EFFECTIVE_CONFIG_DRIFT')
def check_runtime(old,new):
    need(new['Image']==old['Image']==IMAGE,'IMAGE_CHANGED')
    a=json.loads(json.dumps(old['Config']));b=json.loads(json.dumps(new['Config']))
    ae=dict(x.split('=',1) for x in a.pop('Env') if '=' in x)
    be=dict(x.split('=',1) for x in b.pop('Env') if '=' in x)
    ae[FLAG]='true'
    need(ae==be,'RUNTIME_ENV_DRIFT')
    # Container-specific Compose hashes/replacement labels are expected metadata.
    for obj in (a,b):
        labels=obj.get('Labels',{})
        for k in ['com.docker.compose.config-hash','com.docker.compose.replace','com.docker.compose.image']:
            labels.pop(k,None)
        obj.pop('Hostname',None)
    need(a==b,'RUNTIME_CONFIG_DRIFT')
    need(old['HostConfig']==new['HostConfig'],'HOST_CONFIG_DRIFT')
    need(set(old['NetworkSettings']['Networks'])==set(new['NetworkSettings']['Networks']),'NETWORK_DRIFT')
    need(new['State']['Running'],'NOT_RUNNING')
def protected(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as f:
        s=os.fstat(f.fileno())
        need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and s.st_size<1048576 and not s.st_mode&0o022,'FILE_CUSTODY')
        return f.read(),s

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--apply',action='store_true');ap.add_argument('--overlay-sha256');args=ap.parse_args()
    need(os.geteuid()==0 and socket.gethostname().split('.')[0]=='comm','COMM_ROOT_REQUIRED')
    lock=os.open(BASE/'.account-erasure-release.lock',os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        ls=os.fstat(lock)
        need(stat.S_ISREG(ls.st_mode) and ls.st_uid==0 and ls.st_nlink==1 and stat.S_IMODE(ls.st_mode)==0o600,'LOCK_CUSTODY')
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        old=inspect('csm-messaging-api');need(old['Id']==SOURCE and old['Image']==IMAGE and old['State']['Running'],'SOURCE_CHANGED')
        labels=old['Config']['Labels'];need(labels['com.docker.compose.project']=='csm-messaging' and labels['com.docker.compose.service']=='api' and labels['com.docker.compose.project.working_dir']==str(BASE),'PROJECT_SCOPE')
        files=labels['com.docker.compose.project.config_files'].split(',');need(files[-1]==str(OVERLAY),'OVERLAY_SCOPE')
        need(all(Path(p).is_relative_to(BASE) and not Path(p).is_symlink() for p in files),'COMPOSE_PATH_SCOPE')
        cmd=['docker','compose','--project-name','csm-messaging','--project-directory',str(BASE),'--env-file',str(BASE/'.env')]
        for p in files:cmd+=['-f',p]
        raw,meta=protected(OVERLAY);digest=hashlib.sha256(raw).hexdigest();before=config(cmd)
        configured_image=before['services']['api']['image']
        need(json.loads(run(['docker','image','inspect',configured_image]))[0]['Id']==CONFIGURED_IMAGE,'COMPOSE_IMAGE_DRIFT')
        need(before['services']['api'].get('environment',{}).get(FLAG) in (None,'false'),'SOURCE_FLAG_CHANGED')
        desired=changed_overlay(raw)
        peers={name:inspect(name)['Id'] for name in ['csm-matrix-synapse','csm-livekit','csm-livekit-erasure-proxy']}
        if not args.apply:
            print(json.dumps({'mode':'plan','sourceContainer':SOURCE,'image':IMAGE,'overlaySha256':digest,'changedKeys':[FLAG,'services.api.image'],'secretsChanged':False,'peerRestarts':False}));return
        need(args.overlay_sha256==digest,'OVERLAY_CHANGED')
        temp=OVERLAY.with_name(OVERLAY.name+'.communication-policy-new')
        fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,stat.S_IMODE(meta.st_mode))
        with os.fdopen(fd,'wb') as f:
            f.write(desired);f.flush();os.fchown(f.fileno(),meta.st_uid,meta.st_gid);os.fsync(f.fileno())
        need(protected(OVERLAY)[0]==raw and inspect('csm-messaging-api')['Id']==SOURCE,'SOURCE_CHANGED_BEFORE_WRITE')
        os.replace(temp,OVERLAY)
        # Config check precedes container mutation. Revert only these exact public bytes if it fails.
        try:check_effective(before,config(cmd))
        except BaseException:
            need(protected(OVERLAY)[0]==desired,'OVERLAY_CHANGED_AFTER_WRITE')
            fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,stat.S_IMODE(meta.st_mode))
            with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fchown(f.fileno(),meta.st_uid,meta.st_gid);os.fsync(f.fileno())
            os.replace(temp,OVERLAY);raise
        run(cmd+['up','-d','--no-deps','--no-build','--pull','never','api'],timeout=120)
        new=inspect('csm-messaging-api');check_runtime(old,new)
        need(all(inspect(n)['Id']==cid for n,cid in peers.items()),'PEER_CHANGED')
        print(json.dumps({'mode':'applied','containerId':new['Id'],'image':new['Image'],'changedKeys':[FLAG,'services.api.image'],'sameImage':True,'runtimeParity':True,'peersUnchanged':True,'secretsChanged':False,'overlaySha256':hashlib.sha256(desired).hexdigest()}))
    finally:os.close(lock)
if __name__=='__main__':
    try:main()
    except BaseException as exc:
        code=str(exc) if isinstance(exc,RuntimeError) and str(exc).replace('_','').isalnum() else 'POLICY_DEPLOY_FAILED'
        print(json.dumps({'ok':False,'code':code,'policySuccessNotClaimed':True}));sys.exit(2)
