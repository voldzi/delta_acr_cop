#!/usr/bin/env python3
"""Exact-version SeaweedFS fixture. Stops only its own labelled test container."""
import json, os, pathlib, socket, subprocess, tempfile, time, uuid
ROOT=pathlib.Path(__file__).resolve().parents[2]
NAME='cop-media-provider-test-'+uuid.uuid4().hex[:12]
IMAGE='chrislusf/seaweedfs@sha256:fc9f76fa993ad69966ffeb2f65d0318fcae39c6f8e20cf68ef7b3a5cb97769e5'
def command(*args): return subprocess.run(args,check=True,text=True,capture_output=True).stdout.strip()
with tempfile.TemporaryDirectory(prefix='cop-media-provider-test-',dir='/private/tmp') as directory:
    root=pathlib.Path(directory); (root/'data').mkdir()
    config={'identities':[{'name':'cop-production','credentials':[{'accessKey':'synthetic-old','secretKey':'synthetic-old-secret-more-than16'}],
        'actions':['Admin','Read','Write']},{'name':'other-application','credentials':[{'accessKey':'synthetic-other','secretKey':'synthetic-other-secret-more-than16'}],
        'actions':['Admin','Read','Write']}]}
    config_path=root/'s3.json'; config_path.write_text(json.dumps(config)); config_path.chmod(0o600)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1',0)); fixed_port=listener.getsockname()[1]
    try:
        command('docker','run','-d','--platform','linux/amd64','--name',NAME,'--label','cop.test.owner=media-provider-drain',
                '--memory=512m','--cpus=1','-p','127.0.0.1:'+str(fixed_port)+':8333','-v',str(config_path)+':/etc/seaweedfs/s3.json:ro',
                '-v',str(root/'data')+':/data',IMAGE,'server','-dir=/data','-ip=127.0.0.1','-ip.bind=0.0.0.0',
                '-s3','-s3.port=8333','-s3.config=/etc/seaweedfs/s3.json','-master.telemetry=false',
                '-master.volumeSizeLimitMB=16','-volume.max=16','-volume.preStopSeconds=0')
        port=command('docker','port',NAME,'8333/tcp').split(':')[-1]
        env=os.environ.copy(); env.update({'COP_MEDIA_PROVIDER_TEST_CONTAINER':NAME,'COP_MEDIA_PROVIDER_TEST_ENDPOINT':'http://127.0.0.1:'+port,
            'COP_MEDIA_PROVIDER_TEST_CONFIG':str(config_path),'PATH':'/Users/voldzi/.local/share/mise/installs/node/24.21.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'})
        result=subprocess.run(['/opt/homebrew/bin/pnpm','exec','tsx','scripts/account-safety/media-provider-drain-probe.mts'],cwd=ROOT,env=env,text=True,capture_output=True)
        print(result.stdout)
        if result.returncode:
            print(result.stderr); print(subprocess.run(['docker','logs','--tail','60',NAME],capture_output=True,text=True).stderr); raise RuntimeError('provider_verification_failed')
    finally:
        subprocess.run(['docker','rm','-f',NAME],capture_output=True,check=False)
