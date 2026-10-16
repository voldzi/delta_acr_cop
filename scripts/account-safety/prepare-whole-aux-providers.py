#!/usr/bin/env python3
"""Stage reviewed public fixture source into a fresh owned namespace only."""
import argparse,base64,hashlib,importlib.util,json,pathlib,re,shlex
ROOT=pathlib.Path(__file__).resolve().parents[2];spec=importlib.util.spec_from_file_location('whole',ROOT/'scripts/test-account-erasure-whole-joint.py');whole=importlib.util.module_from_spec(spec);spec.loader.exec_module(whole)
parser=argparse.ArgumentParser();parser.add_argument('--manifest',required=True);parser.add_argument('--component',choices=['media','edge'],required=True);parser.add_argument('--server-local',action='store_true');parser.add_argument('--source-proof');parser.add_argument('--source-proof-sha256');args=parser.parse_args();whole.configure_server_local(args)
path=whole.safe_manifest(args.manifest,True);manifest=json.loads(path.read_text());owner=manifest['sharedHolderOwner'];whole.check_owned(manifest['sharedHolder'],owner)
holder=json.loads(whole.remote('docker inspect '+shlex.quote(manifest['sharedHolder'])).stdout)[0];holder_id=holder['Id']
if holder['HostConfig']['NetworkMode']!='none' or holder['HostConfig'].get('PortBindings') or holder['Mounts']:raise RuntimeError('OWNED_NAMESPACE_REQUIRED')
component=args.component
source=(ROOT/f'scripts/account-safety/prepare-{component}-whole-fixture.py').read_text()
if component=='media':
 old="command('docker','pull',IMAGE)";assert source.count(old)==1;source=source.replace(old,"command('docker','image','inspect',IMAGE)",1)
 source=source.replace("command('docker','run','--rm','--entrypoint'","command('docker','run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--entrypoint'")
 files={'prepare.py':source.encode(),'media-storage.js':(ROOT/'apps/cop-api/dist/media-storage.js').read_bytes(),'bounded-upstream.js':(ROOT/'apps/cop-api/dist/bounded-upstream.js').read_bytes(),'media-whole-probe.mjs':(ROOT/'scripts/account-safety/media-whole-probe.mjs').read_bytes()}
else:
 files={'prepare.py':source.encode(),'edge-index.js':(ROOT/'apps/cop-edge-node/dist/index.js').read_bytes(),'edge-account-erasure.js':(ROOT/'apps/cop-edge-node/dist/account-erasure.js').read_bytes(),'service-token.js':(ROOT/'packages/core/dist/service-token.js').read_bytes(),'core-package.json':(ROOT/'packages/core/package.json').read_bytes()}
stage_prefix=str(whole.server_local.PRIVATE_ROOT)+'/aux-' if whole.SERVER_LOCAL else '/tmp/cop-full-'
stage=whole.remote('mktemp -d '+stage_prefix+component+'-XXXXXXXX',timeout=20).stdout.strip()
if not re.fullmatch(re.escape(stage_prefix)+component+'-[a-zA-Z0-9]{8}',stage):raise RuntimeError('OWNED_STAGE_PATH_REJECTED')
installer="import sys,json,base64,pathlib,os;root=pathlib.Path(sys.argv[1]);assert root.is_dir() and not root.is_symlink() and root.stat().st_uid==os.getuid();files=json.load(sys.stdin);[(root/name).write_bytes(base64.b64decode(body)) for name,body in files.items() if name in ['prepare.py','media-storage.js','bounded-upstream.js','media-whole-probe.mjs','edge-index.js','edge-account-erasure.js','service-token.js','core-package.json']];[(root/name).chmod(0o600) for name in files]"
whole.remote('python3 -c '+shlex.quote(installer)+' '+shlex.quote(stage),json.dumps({k:base64.b64encode(v).decode() for k,v in files.items()}),timeout=30)
result=whole.remote('python3 '+shlex.quote(stage+'/prepare.py')+' '+holder_id+' '+owner,check=False,timeout=240)
if result.returncode:
 print(json.dumps({'phase':'new_aux_fixture_prepare_failed','component':component,'privateStage':stage,'productionChanged':False}));raise SystemExit(2)
record=json.loads(result.stdout.strip().splitlines()[-1]);expected='cop-'+component+'-whole-fixture-ready-v1'
if record.get('contractVersion')!=expected or record.get('holderId')!=holder_id or record.get('fixtureOwner')!=owner or record.get('productionChanged') is not False:raise RuntimeError('OWNED_PROVIDER_READY_BINDING_MISMATCH')
container=record['probeContainer'] if component=='media' else record['container'];whole.check_owned(container,owner)
original=path.read_bytes();latest=json.loads(original)
if latest['actors']!=manifest['actors'] or latest['sharedHolder']!=manifest['sharedHolder']:raise RuntimeError('NEW_AUX_MANIFEST_BINDING_CHANGED')
refs=latest.setdefault('providerFixtures',{});assert component not in refs
refs[component]={'container':container,'path':record['privateManifest'],'owner':owner}
latest.setdefault('providerFixturePreparation',{})[component]={'privateStage':stage,'publicSourceSha256':{name:hashlib.sha256(value).hexdigest() for name,value in files.items()},'evidence':record}
if path.read_bytes()!=original:raise RuntimeError('NEW_AUX_MANIFEST_CAS_FAILED')
whole.replace_private(path,latest)
print(json.dumps({'phase':'new_aux_fixture_prepared','component':component,'holderId':holder_id,'providerReferences':refs[component],'actualProviderEvidence':record,'productionChanged':False}))
