"""Project unchanged real S3/Edge fixtures into the fresh whole12 namespace.
Only public source is transported. Synthetic keys stay in server-only fixtures.
"""
import base64
import json
from pathlib import Path
import shlex
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
OWNER = 'cop-clean-whole12-9aff26e65b74'
HOLDER = '10aa1a37797474fa8cdf16ee7581cfa1b7e3fcfef4abc2f99352bc7de414a44a'
SSH = ['ssh','-4','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8',
       '-o','HostName=192.168.10.116','-o','HostKeyAlias=docker.home.cz','docker.home.cz']


def remote(command, body=None, timeout=60):
    result = subprocess.run(SSH+[command], input=body, capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError('WHOLE12_AUX_OPERATION_FAILED')
    return result.stdout


def main():
    component = sys.argv[1]
    assert component in ['media','edge']
    source = (ROOT/f'scripts/account-safety/prepare-{component}-whole-fixture.py').read_text()
    old = "re.fullmatch('cop-messaging-joint-[a-f0-9]{12}',OWNER)"
    assert source.count(old) == 1
    source = source.replace(old, 'OWNER == '+repr(OWNER))
    source = source.replace('sha256:a06c103764701e7debc6434e3dd98e9a6d5f218d30831cb62aad566265db392f',
                            'sha256:2e61857d00f7fe0326a7b50a8f96f0cb4563d4d9028645dc08efe51b84e800df')
    files = {'prepare.py': source.encode()}
    if component == 'media':
        source = source.replace("command('docker','pull',IMAGE)", "command('docker','image','inspect',IMAGE)")
        files['prepare.py'] = source.encode()
        names = {'media-storage.js':'apps/cop-api/dist/media-storage.js',
                 'bounded-upstream.js':'apps/cop-api/dist/bounded-upstream.js',
                 'media-whole-probe.mjs':'scripts/account-safety/media-whole-probe.mjs'}
    else:
        names = {'edge-index.js':'apps/cop-edge-node/dist/index.js',
                 'edge-account-erasure.js':'apps/cop-edge-node/dist/account-erasure.js',
                 'service-token.js':'packages/core/dist/service-token.js',
                 'core-package.json':'packages/core/package.json'}
    files.update({name:(ROOT/path).read_bytes() for name,path in names.items()})
    stage = '/srv/x5-production/staging/cop/'+OWNER+'/aux-'+component
    writer = 'import base64,json,pathlib,sys; p=pathlib.Path(sys.argv[1]);p.mkdir(mode=448);v=json.load(sys.stdin);[(p/n).write_bytes(base64.b64decode(b)) for n,b in v.items()];[(p/n).chmod(384) for n in v]'
    remote('python3 -c '+shlex.quote(writer)+' '+shlex.quote(stage),
           json.dumps({n:base64.b64encode(b).decode() for n,b in files.items()}).encode())
    output = remote('python3 '+shlex.quote(stage+'/prepare.py')+' '+HOLDER+' '+OWNER, timeout=180)
    receipt = json.loads(output.strip().splitlines()[-1])
    assert receipt['fixtureOwner'] == OWNER and receipt['holderId'] == HOLDER and receipt['productionChanged'] is False
    print(json.dumps(receipt))


if __name__ == '__main__':
    main()
