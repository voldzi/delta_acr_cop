#!/usr/bin/python3 -I
"""Read-only candidate review as UID1000, never a Root proof issuer."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import stat
import sys
import types
import uuid
import tarfile

sys.dont_write_bytecode = True
HERE = Path(__file__).parent
STAGING = Path('/srv/x5-production/staging/cop/work')
LAYER_SHA='79bbd0d904aced2ce17654c6888bbad7ac34e583da19af20a3343f50489e336a'
FILES={'app/apps/cop-api/dist/server.js':'9c8c1c61acb051a08d5d1f053374cbae52917262e641a14b0f3af68bbd9ff8be',
       'app/apps/cop-api/dist/map-catalog-routes.test.js':'7544f933e19b96b83a1c040847c7512c1b2c1d2f5ed6009eb1d669b73be89945'}
DIRECTORIES={'app','app/apps','app/apps/cop-api','app/apps/cop-api/dist'}


def validate_layer(raw):
    assert hashlib.sha256(raw).hexdigest()==LAYER_SHA
    with tarfile.open(fileobj=io.BytesIO(raw)) as layer:
        members=layer.getmembers()
        assert len(members)==len(FILES)+len(DIRECTORIES)
        assert {m.name for m in members}==set(FILES)|DIRECTORIES
        for m in members:
            assert m.uid==m.gid==0 and not m.linkname
            if m.name in DIRECTORIES:
                assert m.isdir() and m.mode==0o755 and m.size==0
            else:
                assert m.isfile() and m.mode==0o644 and 0<m.size<1048576
                assert hashlib.sha256(layer.extractfile(m).read()).hexdigest()==FILES[m.name]


def review(worker_raw):
    assert os.geteuid() == 1000
    w = types.ModuleType('cop_catalog_review_worker')
    w.__file__ = str(HERE/'cop-catalog-maintain-worker.py')
    exec(compile(worker_raw, w.__file__, 'exec'), w.__dict__)
    assert os.stat(STAGING).st_dev == os.stat('/srv/x5-production').st_dev
    overlay = STAGING/('review-'+uuid.uuid4().hex+'.compose.json')
    generic = overlay.with_suffix('.runtime.json')
    fd = os.open(overlay, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump({'services':{'cop-api':{'image':w.API}, 'cop-web':{'image':w.WEB}}}, f)
        w.WEB_OVERRIDE = overlay
        g = w.load_guard()
        active = w.active_pointer()
        accepted,release_dir,binding,profile=g.Store(uid=1000).active()
        assert accepted==active
        reference=binding['accountErasureConfig']
        assert reference['path']=='/etc/vcode-cop-api-runtime/'+w.PROFILE+'/account-erasure-23f72509-10df-4217-9365-4f7cc89e1f73.json'
        assert reference['sha256']=='abc4174dc546ab3d5a04d490dcaff84a697f5d94c807cdee1017d5007b91ec24'
        for name,expected in binding['composeHashes'].items():
            assert name in g.FILES
            fd=os.open(w.SOURCE/name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
            try:
                info=os.fstat(fd)
                # Existing public source Compose may be group-writable; its
                # bytes must still match the protected accepted hash exactly.
                assert stat.S_ISREG(info.st_mode) and info.st_uid==1000 and info.st_nlink==1 and not info.st_mode&0o002 and info.st_size<1048576
                raw=os.read(fd,1048576)
                assert len(raw)==info.st_size and hashlib.sha256(raw).hexdigest()==expected
                after=os.fstat(fd)
                assert (info.st_ino,info.st_mtime_ns,info.st_ctime_ns)==(after.st_ino,after.st_mtime_ns,after.st_ctime_ns)
            finally:os.close(fd)
        # Store.active() validates the actual protected proof and its immutable
        # delegated parent-chain readers, not just two unrelated report files.
        reviewed_binding={**binding,'imageId':w.API,'releaseId':'release-'+'0'*32,
            'accountErasureConfig':{'cleanScope':'cop_sim_shared_identity_v1'}}
        generic_fd=os.open(generic,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(generic_fd,'w') as f:json.dump(g.overlay(reviewed_binding,profile['mode']),f)
        assert active['imageId'] == w.OLD_API and active['profileGeneration'] == w.PROFILE
        source = w.inspect(w.OLD_API)
        target = w.inspect(w.API)
        assert target['Os'] == source['Os'] == 'linux'
        assert target['Architecture'] == source['Architecture'] == 'amd64'
        layers = source['RootFS']['Layers']
        assert target['RootFS']['Layers'][:-1] == layers
        assert target['RootFS']['Layers'][-1]=='sha256:'+LAYER_SHA
        fd=os.open(STAGING/'catalog-minimal-20261025/last-layer.tar',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        try:
            info=os.fstat(fd)
            assert info.st_size<2*1024**2
            raw=os.read(fd,2*1024**2)
            assert len(raw)==info.st_size
            validate_layer(raw)
        finally:os.close(fd)
        program='const fs=require("node:fs");console.log(JSON.stringify('+json.dumps(sorted('/'+x for x in DIRECTORIES))+'.map(p=>{const s=fs.statSync(p);return {uid:s.uid,gid:s.gid,mode:s.mode&4095}})))'
        directories=json.loads(w.docker('run','--rm','--pull','never','--network','none','--read-only','--cap-drop','ALL',w.OLD_API,'node','-e',program))
        assert len(directories)==len(DIRECTORIES) and all(v=={'uid':0,'gid':0,'mode':0o755} for v in directories)
        changed = {k for k in source['Config'].keys()|target['Config'].keys()
                   if source['Config'].get(k) != target['Config'].get(k)}
        assert changed == {'Labels'}
        before, after = source['Config']['Labels'], target['Config']['Labels']
        assert {k for k in before.keys()|after.keys() if before.get(k)!=after.get(k)} == {'org.opencontainers.image.revision'}
        assert after['org.opencontainers.image.revision'] == w.REV
        args=w.web_command(active['releaseId'])
        args[args.index(str(release_dir/'compose.runtime.yml'))]=str(generic)
        config = json.loads(w.command(args+['config','--format','json']))
        g.runtime_parity(w.inspect('cop-cop-api-1'), config['services']['cop-api'], target['Config'])
        inherited=dict(x.split('=',1) for x in target['Config'].get('Env',[]))
        expected={**inherited,**config['services']['cop-api'].get('environment',{})}
        actual=dict(x.split('=',1) for x in w.inspect('cop-cop-api-1')['Config'].get('Env',[]))
        assert actual==expected
        w.validate_web(g, active['releaseId'])
        g.Docker().image(w.API, revision=w.REV)
        # No secret or production mount enters this container. Vitest's token
        # and cache are ephemeral, not COP credentials or persistent storage.
        config = {'root':'/app', 'cacheDir':'/tmp/cop-vite-cache', 'test':{
            'include':['apps/cop-api/dist/map-catalog-routes.test.js','apps/cop-api/dist/web-session-bff.test.js'],
            'exclude':[], 'maxWorkers':1, 'fileParallelism':False}}
        program = ('const fs=require("node:fs");fs.writeFileSync("/tmp/cop-vitest.config.mjs",'
                   +json.dumps('export default '+json.dumps(config))+');'
                   'const r=require("node:child_process").spawnSync("/app/node_modules/.bin/vitest",'
                   '["run","--config","/tmp/cop-vitest.config.mjs"],{stdio:"inherit"});process.exit(r.status??2);')
        result = subprocess.run(['/usr/bin/docker','run','--rm','--pull','never','--network','none',
            '--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
            '--tmpfs','/tmp:rw,noexec,nosuid,size=64m','-e','XDG_DATA_HOME=/tmp/cop-vitest-data',
            w.API,'node','-e',program], capture_output=True, timeout=90, env=w.ENV)
        output = re.sub(rb'\x1b\[[0-9;]*m', b'', result.stdout)
        assert result.returncode == 0 and re.search(rb'Tests\s+43 passed \(43\)', output)
        live = w.check_live()
        assert w.active_pointer() == active
        st = (w.SOURCE/'.env').stat()
        return {'contractVersion':'cop-catalog-readonly-review-v1', 'previous':active,
            'candidateImages':{'api':w.API,'web':w.WEB}, 'guardSha256':w.GUARD_SHA,
            'runtimeParityPassed':True, 'unchangedBaseRootfsPassed':True,
            'newLayerAllowlistPassed':True,'genericMaintainEnvironmentParityPassed':True,
            'acceptedBaselineProof':reference,'acceptedRootLineageValidatedByGuard':True,
            'currentSourceComposeMatchesAcceptedRootHashes':True,
            'unchangedErasureRuntimeInherited':True, 'nativeSharpAndX5GuardPassed':True,
            'candidateTestsPassed':43, 'liveGates':live,
            'environmentMetadata':{'device':st.st_dev,'inode':st.st_ino,'size':st.st_size,
                                   'mtimeNs':st.st_mtime_ns,'ctimeNs':st.st_ctime_ns},
            'productionChanged':False, 'freshCandidateJointAcceptance':False}
    finally:
        overlay.unlink()
        generic.unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        # The operator/controller supplies the hash-pinned worker bytes over
        # stdin. They execute only as the existing unprivileged deployment UID.
        raw = sys.stdin.buffer.read(65537)
        assert len(raw)<=65536
        print(json.dumps(review(raw), sort_keys=True))
    except (AssertionError, OSError, ValueError, KeyError, TypeError, RuntimeError, subprocess.SubprocessError):
        print(json.dumps({'passed':False,'code':'READONLY_CANDIDATE_REVIEW_FAILED','productionChanged':False}))
        sys.exit(2)
