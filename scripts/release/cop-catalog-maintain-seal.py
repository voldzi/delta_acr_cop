#!/usr/bin/python3 -I
"""One exact personal-Root review/seal; no application restart or reset.

Historical joint/restore evidence remains historical. This is a new review of
an image-only maintain operation, not another whole-provider acceptance run.
Uninstalled: do not execute until the complete bundle has been reviewed/tested.
"""
import base64
from datetime import datetime, timezone, timedelta
import fcntl
import hashlib
import json
import os
import re
from pathlib import Path
import socket
import signal
import stat
import subprocess
import sys
import uuid

sys.dont_write_bytecode=True
INPUT=Path('/home/voldzi/cop-catalog-maintain-final-20261025')
ROOT=Path('/etc/cop-reviewed-release')
STATE=Path('/var/lib/cop-reviewed-release')
PROFILE='206c4507-5e00-458e-b0ee-4061309aa7a8'
PROTECTED=Path('/etc/vcode-cop-api-runtime')/PROFILE
SOURCE=Path('/srv/cop')
API='sha256:c06c6080c87c4f88a74be359d459143ac25aef55cf60e6a8e11e4555bb62affa'
WEB='sha256:3606a7725266ca0078480fa263dac37193b45b389b8bb43e23be192d4180fafd'
OLD_API='sha256:3f0054cb10e7c563c47cb010a7ea7cfbf4ff5a738e1261d77434be283baab430'
OLD_WEB='sha256:d6cf225150d721fbb5d0f236c2b921064a2e5906b30b396ad55f85d5fce3770c'
GUARD='65cb657fb5349a73c4d28c977e688148e54e65e73d63780ba726c4293c7dd255'
WORKER='f882c217b3e0131c493cbaaac8a04a58db15d36206240624a5b23b45e356dc7a'
REVIEWER='75f53cb86e03532a1b5aca7064ff3515e9a5dacdaf9167457d3fa9571265aa81'
BROKER='7c307d88c75f12679792618ebf310de7a6c6dd575918974f2334a645ae1fa6fd'
HISTORICAL='66b6fb13c8a52c3d06f6aecafe3c9b101e5376cda3049988843e9d4961e0e38a'
BASE_PROOF='abc4174dc546ab3d5a04d490dcaff84a697f5d94c807cdee1017d5007b91ec24'
RESET='8caa6a5b78346acfed75a8356bb89a4ffece54ca341052ccb35cc54ded60d178'
OWNERS={'keycloak','cop_sessions_profiles','cop_devices','messaging_matrix','voice_livekit',
 'cop_content_media','mobility_dispatch','sim_measurements','ai_router','moderation_audit',
 'backup_restore','sim_user_data'}
ENV={'PATH':'/usr/local/bin:/usr/bin:/bin','LANG':'C','PYTHONDONTWRITEBYTECODE':'1',
     'DOCKER_HOST':'unix:///var/run/docker.sock'}
STAGE='initialization'


class Stop(Exception):pass
def need(ok,code):
    if not ok:raise Stop(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return (json.dumps(value,sort_keys=True)+'\n').encode()
def stage(value):
    global STAGE
    STAGE=value


def directory(path):
    for p in (path,*path.parents):
        s=p.lstat()
        need(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'ROOT_DIRECTORY')


def read(path,uid=0,limit=16*1024*1024):
    for p in (path,*path.parents):need(not p.is_symlink(),'SYMLINK')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        a=os.fstat(fd)
        need(stat.S_ISREG(a.st_mode) and a.st_uid==uid and a.st_nlink==1
             and not a.st_mode&0o022 and a.st_size<=limit,'FILE_CUSTODY')
        raw=b''
        while len(raw)<=limit:
            part=os.read(fd,min(65536,limit+1-len(raw)))
            if not part:break
            raw+=part
        fields=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_uid,s.st_gid,s.st_mode,s.st_nlink)
        need(len(raw)==a.st_size and fields(a)==fields(os.fstat(fd))==fields(path.lstat()),'FILE_CHANGED')
        return raw
    finally:os.close(fd)


def historical(raw):
    need(sha(raw)==HISTORICAL,'HISTORICAL_HASH')
    v=json.loads(raw)
    need(v['contractVersion']=='cop-sim-whole-clean-acceptance-v3'
         and v['checkedAt']=='2026-10-17T15:22:13Z'
         and v['kind']=='isolated_whole_provider' and v['productionTouched'] is False
         and v['deletionScope']=='cop_sim_shared_identity_v1','HISTORICAL_SCOPE')
    op=v['operation']
    need(op['finalStatus']=='deleted' and op['finalAccountDeleted'] is True
         and op['requiredOwners']==sorted(OWNERS),'HISTORICAL_TERMINAL')
    need(set(v['providerReadbacks'])==OWNERS,'HISTORICAL_OWNERS')
    for value in v['providerReadbacks'].values():
        need(value['operationId']==op['operationId'] and value['resetEpoch']==v['resetEpoch']
             and value['status']=='completed' and type(value['userARemaining']) is int
             and value['userARemaining']==0 and value['userBStateBefore']==value['userBStateAfter'],
             'HISTORICAL_OWNER_READBACK')
    restored=v['recoveryReadbacks']['restored_user_data']
    need(restored['restoredRows']>0 and restored['finalUserARemaining']==0
         and restored['userBPreserved'] is True,'HISTORICAL_RESTORE')
    return {'reportSha256':HISTORICAL,'checkedAt':v['checkedAt'],
            'candidateImages':v['candidateImages'],'jointPreviouslyPassed':True,
            'restorePreviouslyPassed':True,'freshCandidateJointAcceptance':False,
            'ageExceptionUsed':False,'originalReportModified':False}


def execute_unprivileged(raw,filename,worker):
    program=('import base64,sys;sys.dont_write_bytecode=True;sys.argv=['+repr(str(filename))+'];'
             'b=base64.b64decode('+repr(base64.b64encode(raw).decode())+');'
             'exec(compile(b,'+repr(str(filename))+',"exec"),'
             '{"__name__":"__main__","__file__":'+repr(str(filename))+'})')
    r=subprocess.run(['/usr/bin/python3','-I','-B','-c',program],input=worker,
        capture_output=True,timeout=180,env=ENV,cwd=SOURCE,user=1000,group=1000,
        extra_groups=[1000,988],umask=0o077)
    need(r.returncode==0 and len(r.stdout)<=65536,'FRESH_REVIEW_FAILED')
    v=json.loads(r.stdout)
    need(v['contractVersion']=='cop-catalog-readonly-review-v1'
         and v['candidateImages']=={'api':API,'web':WEB}
         and v['guardSha256']==GUARD and v['candidateTestsPassed']==43
         and all(v[k] is True for k in ('runtimeParityPassed','unchangedBaseRootfsPassed',
             'newLayerAllowlistPassed','genericMaintainEnvironmentParityPassed',
             'acceptedRootLineageValidatedByGuard','currentSourceComposeMatchesAcceptedRootHashes',
             'unchangedErasureRuntimeInherited','nativeSharpAndX5GuardPassed'))
         and v['productionChanged'] is False and v['freshCandidateJointAcceptance'] is False,
         'FRESH_REVIEW_SCOPE')
    return v


def write(path,raw,replace=False):
    directory(path.parent)
    temp=path.parent/('.seal-'+uuid.uuid4().hex)
    fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o640)
    try:
        os.fchown(fd,0,1000);os.fchmod(fd,0o640)
        with os.fdopen(fd,'wb',closefd=False) as f:f.write(raw);f.flush();os.fsync(fd)
    finally:os.close(fd)
    try:
        if replace:os.replace(temp,path)
        else:os.link(temp,path,follow_symlinks=False)
    finally:temp.unlink(missing_ok=True)
    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)


def web_parent_fd():
    """The fixed existing mixed-owner path; never relax Root grant directories."""
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        for name,uid,gid,mode in [('srv',0,0,0o755),('cop',1000,1000,0o755),
                                 ('runtime',1000,1000,0o700),('clean-reset',0,1000,0o750)]:
            child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
            try:
                st=os.fstat(child)
                need(stat.S_ISDIR(st.st_mode) and (st.st_uid,st.st_gid,stat.S_IMODE(st.st_mode))==(uid,gid,mode),'WEB_DIRECTORY_LAYOUT_CHANGED')
            except BaseException:os.close(child);raise
            os.close(fd);fd=child
        return fd
    except BaseException:os.close(fd);raise


def read_web_pin(fd):
    file=os.open('web-runtime.compose.json',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
    try:
        before=os.fstat(file)
        need(stat.S_ISREG(before.st_mode) and before.st_uid==0 and before.st_gid==1000
             and stat.S_IMODE(before.st_mode)==0o640 and before.st_nlink==1 and before.st_size<65536,'WEB_PIN_CUSTODY')
        raw=os.read(file,65537);after=os.fstat(file)
        need(len(raw)==before.st_size and (before.st_ino,before.st_mtime_ns,before.st_ctime_ns)==(after.st_ino,after.st_mtime_ns,after.st_ctime_ns),'WEB_PIN_CHANGED_DURING_READ')
        return raw
    finally:os.close(file)


def write_web_pin(expected,new):
    """Replace only the fixed public image pin using an anchored directory fd."""
    fd=web_parent_fd();temporary='.cop-web-pin-'+uuid.uuid4().hex
    try:
        need(read_web_pin(fd)==expected,'WEB_PIN_CAS_CHANGED')
        file=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o640,dir_fd=fd)
        try:
            os.fchown(file,0,1000);os.fchmod(file,0o640)
            with os.fdopen(file,'wb',closefd=False) as out:out.write(new);out.flush();os.fsync(file)
        finally:os.close(file)
        need(read_web_pin(fd)==expected,'WEB_PIN_CAS_CHANGED')
        os.replace(temporary,'web-runtime.compose.json',src_dir_fd=fd,dst_dir_fd=fd)
        os.fsync(fd)
    finally:
        try:os.unlink(temporary,dir_fd=fd)
        except FileNotFoundError:pass
        os.close(fd)


def remove_owned(path,raw):
    if not path.exists() and not path.is_symlink():return
    need(read(path)==raw,'OWNED_SEAL_ARTIFACT_CHANGED')
    path.unlink()
    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)


def cleanup_uncommitted(created,web_pin,old_pin,new_pin,pin_intended):
    # This runs with the broker lock still held. Record intent BEFORE publishing
    # so an exception after link/replace but before fsync cannot skip cleanup.
    mask=signal.pthread_sigmask(signal.SIG_BLOCK,{signal.SIGINT,signal.SIGTERM,signal.SIGHUP})
    try:
        for path,raw in reversed(created):remove_owned(path,raw)
        if pin_intended:
            current=read(web_pin)
            if current==new_pin:write_web_pin(new_pin,old_pin)
            else:need(current==old_pin,'WEB_PIN_CHANGED_DURING_SEAL')
    finally:signal.pthread_sigmask(signal.SIG_SETMASK,mask)


def seal():
    stage('operator_confirmation')
    need(os.geteuid()==0 and socket.gethostname().split('.')[0]=='docker' and len(sys.argv)==1,'PERSONAL_ROOT_DOCKER')
    # The operator must explicitly accept this real limitation. A password is
    # authentication, not a substitute for the release decision.
    print('COP: připraví se přesný obraz opravy přihlášení a polohy. Při selhání '
          'chráněného přepnutí může být nutná ruční oprava; automatický návrat '
          'není povolen. Neproběhne reset ani mazání účtů. Pro schválení napište ANO:',
          file=sys.stderr,flush=True)
    need(sys.stdin.isatty() and sys.stdin.readline().strip()=='ANO','OPERATOR_RELEASE_NOT_APPROVED')
    stage('exact_sources')
    for p in (ROOT,STATE,PROTECTED):directory(p)
    need(sha(read(Path('/usr/local/sbin/cop-reviewed-release')))==BROKER,'BROKER_NOT_READY')
    worker=read(INPUT/'cop-catalog-maintain-worker.py',1000,65536)
    reviewer=read(INPUT/'cop-catalog-maintain-review.py',1000,65536)
    need(sha(worker)==WORKER and sha(reviewer)==REVIEWER,'APPLICATION_SOURCE_HASH')
    lock=os.open('/run/cop-reviewed-release.lock',os.O_RDWR|os.O_NOFOLLOW)
    try:
        s=os.fstat(lock);need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600,'LOCK_CUSTODY')
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        need(not (ROOT/'approved.json').exists() and not (ROOT/'approved.json').is_symlink()
             and not list(STATE.glob('journal-*.json')),'UNARMED_BROKER_REQUIRED')
        stage('historical_lineage')
        history=historical(read(SOURCE/'runtime/clean-reset/whole12-acceptance.json'))
        base_raw=read(PROTECTED/'account-erasure-23f72509-10df-4217-9365-4f7cc89e1f73.json')
        need(sha(base_raw)==BASE_PROOF,'BASELINE_PROOF_CHANGED')
        base=json.loads(base_raw)
        reset=read(SOURCE/'runtime/clean-reset/reset-result.json')
        need(sha(reset)==RESET and base['cleanReset']['receiptSha256']==RESET
             and json.loads(reset)['resetEpoch']==base['cleanReset']['resetEpoch'],'RESET_RECEIPT_CHANGED')
        stage('fresh_readonly_review')
        fresh=execute_unprivileged(reviewer,INPUT/'cop-catalog-maintain-review.py',worker)
        stage('accepted_baseline_binding')
        previous=fresh['previous']
        need(previous['imageId']==OLD_API and previous['profileGeneration']==PROFILE
             and previous['generation']=='6d767891c0944954a737687c178d8c94','BASELINE_CHANGED')
        binding=json.loads(read(SOURCE/'runtime/api/releases'/previous['releaseId']/'release.json',1000))
        reference=binding['accountErasureConfig']
        need(reference==fresh['acceptedBaselineProof'] and reference['path']==str(PROTECTED/'account-erasure-23f72509-10df-4217-9365-4f7cc89e1f73.json')
             and reference['sha256']==BASE_PROOF and reference['cleanScope']=='cop_sim_shared_identity_v1'
             and reference['authScope']=='oidc_no_lab_v1' and binding['imageId']==OLD_API,
             'ACTIVE_ROOT_PROOF_LINEAGE_CHANGED')
        need(base['target']=={'imageId':OLD_API,'sourceRevision':binding['sourceRevision'],'profileGeneration':PROFILE}
             and base['environmentMetadata']==fresh['environmentMetadata']
             and base['ownerAcceptance'] is True and all(x is True for x in base['checks'].values()),
             'ACCEPTED_BASELINE_AUTHORITY_CHANGED')
        # The historical acceptance applies to unchanged erasure/authority code
        # inherited from the live accepted base, never to the new image as a
        # newly executed joint/restore test. Its original timestamp stays above.
        old_attestation=json.loads(read(PROTECTED/('attestation-'+OLD_API[7:]+'.json')))
        need(old_attestation['imageId']==OLD_API and old_attestation['profileGeneration']==PROFILE
             and old_attestation['ownerAcceptance'] is True,'BASELINE_ATTESTATION')
        attestation={**old_attestation,'imageId':API,'sourceRevision':'07664a77cf19e9433bd6fe4b1267e395616f1985',
            'kind':'candidate','legacyContainerId':None,'legacyEnvPresence':None,
            'checks':{'x5RuntimeGuard':True,'sharpConversion':True,'databaseRouting':True,'acceptedBaselineRollback':False}}
        transition=str(uuid.uuid4());proof_path=PROTECTED/('account-erasure-'+transition+'.json')
        attestation_path=PROTECTED/('attestation-'+API[7:]+'.json')
        compose={name:sha(read(SOURCE/'runtime/api/releases'/previous['releaseId']/'compose'/name,1000)) for name in ('docker-compose.yml',
            'docker-compose.driver-measurements.yml','docker-compose.x5.yml','docker-compose.ai-router.yml')}
        need(compose==base['composeHashes'],'BASELINE_COMPOSE_CHANGED')
        proof={'contractVersion':'cop-api-account-erasure-clean-config-v1','transitionId':transition,
            'operation':'maintain','previous':previous,'target':{'imageId':API,
                'sourceRevision':'07664a77cf19e9433bd6fe4b1267e395616f1985','profileGeneration':PROFILE},
            'changedKeys':[],'environmentMetadata':fresh['environmentMetadata'],'composeHashes':compose,
            'ownerAcceptance':True,'cleanReset':base['cleanReset'],
            'checks':{'jointSyntheticAcceptance':True,'providerClosureVerified':True,
                'sharedIdentityDeletionApproved':True,'cleanResetVerified':True,'restoreReplayVerified':True}}
        stage('package_preparation')
        release=uuid.uuid4().hex;folder=ROOT/'releases'/release
        os.mkdir(folder,0o750);os.chown(folder,0,1000);os.chmod(folder,0o750)
        web_pin=SOURCE/'runtime/clean-reset/web-runtime.compose.json'
        old_pin=read(web_pin)
        need(json.loads(old_pin)=={'services':{'cop-web':{'image':OLD_WEB}}},'WEB_PIN_CHANGED')
        new_pin=encoded({'services':{'cop-web':{'image':WEB}}})
        authorization={'contractVersion':'cop-catalog-maintain-authorization-v1','expectedActive':previous,
            'attestationPath':str(attestation_path),'configProofPath':str(proof_path),'webOverrideSha256':sha(new_pin)}
        review_record={'contractVersion':'cop-catalog-maintain-review-record-v1',
            'historicalAcceptance':history,'inheritedFromRootBaselineProofSha256':BASE_PROOF,
            'freshCandidateJointAcceptance':False,'freshCandidateRestoreTest':False,
            'freshReadOnlyCandidateReview':fresh,'operatorAcceptedPendingFailureRisk':True,
            'resetPerformed':False,'oldProofsModified':False}
        evidence={'candidate':{'candidateImages':fresh['candidateImages'],'candidateTestsPassed':43},
            'parity':fresh,'provider':fresh['liveGates'],'historical':history,'authorization':authorization}
        for key,value in evidence.items():write(folder/(key+'-evidence.json'),encoded(value))
        # Broker has a fixed worker filename, not an operator-provided path.
        write(folder/'worker.py',worker)
        write(folder/'review-record.json',encoded(review_record))
        write(folder/'web-pin-before.json',old_pin)
        now=datetime.now(timezone.utc)
        stamp=lambda x:x.strftime('%Y-%m-%dT%H:%M:%SZ')
        manifest={'contractVersion':'cop-root-reviewed-release-v1','releaseId':release,
            'previousImages':{'api':OLD_API,'web':OLD_WEB},'targetImages':{'api':API,'web':WEB},
            'sourceRevisions':{'api':'07664a77cf19e9433bd6fe4b1267e395616f1985','web':'8afa082415a67e55f61fb9fb661d953b57fec8c8'},
            'profileGeneration':PROFILE,'guardSha256':GUARD,'checkedAt':stamp(now),
            'expiresAt':stamp(now+timedelta(minutes=15)),'workerSha256':sha(worker),
            'reviewRecordSha256':sha(encoded(review_record)),
            'evidenceSha256':{k:sha(encoded(v)) for k,v in evidence.items()},'failedPendingRiskAccepted':True}
        write(folder/'manifest.json',encoded(manifest))
        created=[]
        index_raw=encoded({'releaseId':release,'manifestSha256':sha(encoded(manifest))})
        commit_raw=encoded({'contractVersion':'cop-root-reviewed-seal-commit-v1','releaseId':release,'manifestSha256':sha(encoded(manifest))})
        pin_intended=False
        committed=False
        try:
            stage('owned_grant_publication')
            if attestation_path.exists():need(read(attestation_path)==encoded(attestation),'EXISTING_ATTESTATION_CHANGED')
            else:
                created.append((attestation_path,encoded(attestation)));write(attestation_path,encoded(attestation))
            created.append((proof_path,encoded(proof)));write(proof_path,encoded(proof))
            pin_intended=True;write_web_pin(old_pin,new_pin)
            # The same Root broker lock prevents concurrent activation while
            # its index is published solely for the exact worker preflight.
            created.append((ROOT/'approved.json',index_raw));write(ROOT/'approved.json',index_raw)
            # Root seals data; actual app code remains UID1000. Do not arm a
            # release until the exact worker validates all protected inputs.
            program=('import base64,sys;sys.dont_write_bytecode=True;sys.argv=["worker","seal-preflight"];'
                'b=base64.b64decode('+repr(base64.b64encode(worker).decode())+');'
                'exec(compile(b,"worker","exec"),{"__name__":"__main__","__file__":"worker"})')
            stage('sealed_worker_preflight')
            r=subprocess.run(['/usr/bin/python3','-I','-B','-c',program],input=encoded(manifest),capture_output=True,
                timeout=180,env=ENV,cwd=SOURCE,user=1000,group=1000,extra_groups=[1000,988],umask=0o077)
            if r.returncode!=0:
                reason='SEALED_WORKER_PREFLIGHT_FAILED'
                try:
                    failure=json.loads(r.stdout)
                    candidate=failure.get('reason')
                    if failure.get('passed') is False and isinstance(candidate,str) and re.fullmatch('[A-Z_]{1,80}',candidate):reason='WORKER_'+candidate
                except (ValueError,TypeError):pass
                raise Stop(reason)
            result=json.loads(r.stdout)
            need(result=={'contractVersion':'cop-reviewed-release-worker-result-v1','releaseId':release,
                'stage':'seal-preflight','passed':True,'targetImages':{'api':API,'web':WEB}},'SEALED_WORKER_RESULT')
            stage('commit_marker')
            created.append((folder/'seal-commit.json',commit_raw));write(folder/'seal-commit.json',commit_raw)
            committed=True
        finally:
            if not committed:cleanup_uncommitted(created,web_pin,old_pin,new_pin,pin_intended)
        print(json.dumps({'phase':'exact_release_armed','releaseId':release,'expiresAt':manifest['expiresAt'],
            'applicationRestarted':False,'accountDataChanged':False,'freshCandidateJointAcceptance':False}))
    finally:os.close(lock)


if __name__=='__main__':
    def cancelled(signum,frame):raise Stop('OPERATOR_CANCELLED')
    for sig in (signal.SIGINT,signal.SIGTERM,signal.SIGHUP):signal.signal(sig,cancelled)
    try:seal()
    except (Stop,OSError,ValueError,KeyError,TypeError,subprocess.SubprocessError) as error:
        code=str(error) if isinstance(error,Stop) and re.fullmatch('[A-Z_]{1,100}',str(error)) else 'ROOT_MAINTAIN_SEAL_REQUIRES_REVIEW'
        print(json.dumps({'phase':'release_not_armed','code':code,'stage':STAGE}))
        sys.exit(2)
