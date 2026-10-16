"""Linux-only transport and source gates for one new synthetic whole fixture.
No secret leaves the server. This module never starts or modifies a provider.
"""
import hashlib
import json
import os
import pathlib
import pwd
import re
import stat
import subprocess
import sys
import tarfile

PRIVATE_ROOT = pathlib.Path('/dev/shm/cop-whole-server-20261016')
MANIFEST_NAME = 'cop-account-erasure-whole-full-server-20261016.json'
CASE_OWNER = 'cop-erasure-whole-92f0a7d635c8'
HOLDER_OWNER = 'cop-messaging-joint-c8237f4e9a61'
HOLDER_NAME = HOLDER_OWNER + '-pg'
PG_IMAGE = 'sha256:b07129cc272f688c98f5b343138a0a52fa45b3d82f50d7a53ff441330624cd2e'
X5_ROOT = pathlib.Path('/srv/x5-production')
EXPECTED_X5_UUID = '2f93f595-b61b-4eea-9054-7afa9b275b5b'
NODE_IMAGE = 'sha256:a06c103764701e7debc6434e3dd98e9a6d5f218d30831cb62aad566265db392f'
RESOURCE_FILES = [
 'docs/api/shared-mobility-v1.openapi.json', 'docs/api/schemas/mapped-road-profile-v1.schemas.json',
 'docs/api/schemas/road-trip-v1.schemas.json', 'docs/api/schemas/known-road-closures-v1.schema.json']
SOURCE_FILES = [
 'scripts/test-account-erasure-whole-joint.py', 'scripts/account-safety/whole_server_local.py',
 'scripts/account-safety/prepare-whole-server-private.mjs', 'scripts/keycloak/erasure-provider-probe.mjs',
 'scripts/keycloak/provision-erasure-client.mjs', 'scripts/account-safety/whole-account-erasure-probe.mjs',
 'scripts/account-safety/whole-cop-local-fixture.mjs', 'scripts/account-safety/whole-sim-messaging-fixture.mjs',
 'scripts/account-safety/whole-media-edge-fixture.mjs', 'scripts/account-safety/whole-main-crash.mjs',
 'scripts/account-safety/whole-confirmation-retry.mjs', 'scripts/account-safety/whole-confirmation-evidence.mjs',
 'scripts/account-safety/prepare-whole-aux-providers.py','scripts/account-safety/configure-whole-edge-oidc.py',
 'scripts/account-safety/prepare-livekit-whole-fixture.py','scripts/account-safety/prepare-media-whole-fixture.py',
 'scripts/account-safety/prepare-edge-whole-fixture.py','scripts/account-safety/media-whole-probe.mjs',
 'scripts/account-safety/010_database_safety_v2.sql', 'scripts/account-safety/011_media_upload_closure.sql']
PROOF_KEYS = {'contractVersion','sourceRevision','sourceWorkingTreeDirty','compiledApiClosureSha256',
 'runtimeResourceClosureSha256','compiledWorkspaceClosureSha256','nodeBaseImageId','sourceFilesSha256'}

def need(condition, code):
 if not condition: raise RuntimeError(code)

def digest_file(path):
 need(path.is_file() and not path.is_symlink(), 'WHOLE_PUBLIC_SOURCE_REGULAR_FILE_REQUIRED')
 return hashlib.sha256(path.read_bytes()).hexdigest()

def closure(values):
 return hashlib.sha256('\n'.join(name+'\0'+digest for name,digest in sorted(values.items())).encode()).hexdigest()

def build_source_proof(root):
 root=pathlib.Path(root)
 revision=subprocess.run(['git','rev-parse','HEAD'],cwd=root,text=True,capture_output=True,check=True).stdout.strip()
 need(re.fullmatch('[0-9a-f]{40}',revision), 'WHOLE_ACTUAL_GIT_REVISION_REQUIRED')
 dirty=subprocess.run(['git','status','--porcelain','--untracked-files=all','--','apps/cop-api/src','packages',*RESOURCE_FILES,*SOURCE_FILES],cwd=root,text=True,capture_output=True,check=True).stdout.strip()
 api={p.relative_to(root).as_posix():digest_file(p) for p in (root/'apps/cop-api/dist').rglob('*') if p.is_file() and p.suffix in ['.js','.json']}
 need('apps/cop-api/dist/server.js' in api, 'WHOLE_CURRENT_API_BUILD_REQUIRED')
 packages={json.loads(p.read_text())['name']:p for p in (root/'packages').glob('*/package.json')}
 queue=[n for n in json.loads((root/'apps/cop-api/package.json').read_text())['dependencies'] if n.startswith('@cop/')]
 seen=set();workspace={}
 while queue:
  name=queue.pop()
  if name in seen: continue
  seen.add(name);package=packages[name]
  files=[package,*package.parent.joinpath('dist').rglob('*')]
  need(any(p.is_file() and p.suffix=='.js' for p in files), 'WHOLE_WORKSPACE_BUILD_REQUIRED')
  for path in files:
   if path.is_file() and (path==package or path.suffix in ['.js','.json']): workspace[path.relative_to(root).as_posix()]=digest_file(path)
  queue.extend(n for n in json.loads(package.read_text()).get('dependencies',{}) if n.startswith('@cop/'))
 return {'contractVersion':'cop-whole-public-source-proof-v1','sourceRevision':revision,'sourceWorkingTreeDirty':bool(dirty),
  'compiledApiClosureSha256':closure(api),'runtimeResourceClosureSha256':closure({p:digest_file(root/p) for p in RESOURCE_FILES}),
  'compiledWorkspaceClosureSha256':closure(workspace),'nodeBaseImageId':NODE_IMAGE,
  'sourceFilesSha256':{p:digest_file(root/p) for p in SOURCE_FILES}}

def verify_source_proof(root, path, expected_sha):
 root=pathlib.Path(root).resolve();path=pathlib.Path(path)
 need(re.fullmatch('[0-9a-f]{64}',str(expected_sha)), 'WHOLE_PUBLIC_SOURCE_PROOF_PIN_REQUIRED')
 need(path.is_absolute() and path.is_relative_to(root) and path.resolve()==path and not path.is_symlink(), 'WHOLE_PUBLIC_SOURCE_PROOF_PATH_REJECTED')
 need(digest_file(path)==expected_sha, 'WHOLE_PUBLIC_SOURCE_PROOF_HASH_CHANGED')
 proof=json.loads(path.read_text())
 need(set(proof)==PROOF_KEYS|{'messagingSource'} and proof['contractVersion']=='cop-whole-public-source-proof-v1' and proof['sourceWorkingTreeDirty'] is False,
  'WHOLE_PUBLISHED_PUBLIC_SOURCE_REQUIRED')
 need(not (root/'.env').exists() and not (root/'.env').is_symlink(), 'WHOLE_PUBLIC_SOURCE_PACK_MUST_NOT_CONTAIN_PRIVATE_ENV')
 actual=build_source_proof(root)
 need(actual=={key:value for key,value in proof.items() if key!='messagingSource'}, 'WHOLE_PUBLIC_SOURCE_OR_COMPILED_CLOSURE_CHANGED')
 verify_messaging_source_paths(root,proof['messagingSource'])
 return proof

def verify_messaging_source_paths(root, proof):
 root=pathlib.Path(root).resolve()
 need(isinstance(proof,dict) and set(proof)=={'profilePath','profileSha256','archivePath','archiveSha256','ownerLabel'} and proof['ownerLabel']==HOLDER_OWNER,
  'WHOLE_NEW_MESSAGING_SOURCE_PINS_REQUIRED')
 for name in ['profile','archive']:
  path=root/proof[name+'Path']
  need(path.is_relative_to(root/'public-fixture') and path.resolve()==path and not path.is_symlink() and
   re.fullmatch('[0-9a-f]{64}',str(proof[name+'Sha256'])) and digest_file(path)==proof[name+'Sha256'], 'WHOLE_NEW_MESSAGING_SOURCE_BYTES_CHANGED')
 profile=json.loads((root/proof['profilePath']).read_text())
 need(profile.get('contractVersion')=='messaging-approved-joint-full-v2-freeze-v1' and isinstance(profile.get('sourceSha256'),dict) and
  all(re.fullmatch('[0-9a-f]{64}',str(value)) for value in profile['sourceSha256'].values()) and
  profile.get('images',{}).get('pg')==PG_IMAGE, 'WHOLE_NEW_MESSAGING_SOURCE_PROFILE_REJECTED')
 for name in ['deploy/synapse/cop_account_erasure_full_v2.py','deploy/synapse/approved-account-scope-full-v2.json',
  'deploy/synapse/cop_owner_stream_erasure.py','deploy/synapse/005_reviewed_owner_stream_cleanup.sql','lib/csm_messaging/synapse_erasure_client.ex']:
  need(name in profile['sourceSha256'], 'WHOLE_NEW_MESSAGING_SOURCE_INCOMPLETE')
 with tarfile.open(root/proof['archivePath'],'r:gz') as archive:
  members=archive.getmembers();files=[value for value in members if value.isfile()]
  need(len(files)==len(profile['sourceSha256']) and len({value.name for value in files})==len(files) and all(value.isfile() or value.isdir() for value in members), 'WHOLE_NEW_PUBLIC_ARCHIVE_MEMBERS_REJECTED')
  for value in files:
   name=pathlib.PurePosixPath(value.name)
   need(not name.is_absolute() and '..' not in name.parts and value.name in profile['sourceSha256'] and value.size<=2_000_000, 'WHOLE_NEW_PUBLIC_ARCHIVE_PATH_REJECTED')
   stream=archive.extractfile(value);need(stream is not None and hashlib.sha256(stream.read()).hexdigest()==profile['sourceSha256'][value.name], 'WHOLE_NEW_PUBLIC_ARCHIVE_SOURCE_MISMATCH')
 return profile

def ensure_private_root(create=False):
 need(sys.platform=='linux' and pwd.getpwuid(os.getuid()).pw_name=='voldzi', 'WHOLE_SERVER_LOCAL_LINUX_VOLDZI_REQUIRED')
 need(PRIVATE_ROOT.parent.resolve()==pathlib.Path('/dev/shm'), 'WHOLE_SERVER_PRIVATE_PARENT_REJECTED')
 fs=subprocess.run(['findmnt','--target','/dev/shm','--noheadings','--output','FSTYPE'],text=True,capture_output=True,check=True).stdout.strip()
 need(fs=='tmpfs', 'WHOLE_SERVER_PRIVATE_TMPFS_REQUIRED')
 if create: PRIVATE_ROOT.mkdir(mode=0o700,exist_ok=True)
 st=PRIVATE_ROOT.lstat()
 need(stat.S_ISDIR(st.st_mode) and not PRIVATE_ROOT.is_symlink() and PRIVATE_ROOT.resolve()==PRIVATE_ROOT and st.st_uid==os.getuid() and stat.S_IMODE(st.st_mode)==0o700,
  'WHOLE_SERVER_PRIVATE_ROOT_CUSTODY_REJECTED')
 return PRIVATE_ROOT

def validate_server_manifest_path(path,required=False):
 ensure_private_root()
 value=pathlib.Path(path)
 need(value==PRIVATE_ROOT/MANIFEST_NAME, 'WHOLE_SERVER_MANIFEST_PATH_REJECTED')
 if value.exists() or value.is_symlink():
  st=value.lstat();need(stat.S_ISREG(st.st_mode) and st.st_nlink==1 and st.st_uid==os.getuid() and stat.S_IMODE(st.st_mode)==0o600,
   'WHOLE_SERVER_MANIFEST_CUSTODY_REJECTED')
 elif required: raise RuntimeError('WHOLE_FIXTURE_MANIFEST_REQUIRED')
 return value

def headroom():
 need(X5_ROOT.is_mount() and X5_ROOT.resolve()==X5_ROOT, 'WHOLE_X5_SEPARATE_MOUNT_REQUIRED')
 mount_uuid=subprocess.run(['findmnt','--target',str(X5_ROOT),'--noheadings','--output','UUID'],text=True,capture_output=True,check=True).stdout.strip()
 need(mount_uuid==EXPECTED_X5_UUID, 'WHOLE_X5_UUID_CHANGED')
 root_device=pathlib.Path('/').stat().st_dev
 need(X5_ROOT.stat().st_dev!=root_device, 'WHOLE_X5_SEPARATE_FILESYSTEM_REQUIRED')
 memory={parts[0].rstrip(':'):int(parts[1])*1024 for line in pathlib.Path('/proc/meminfo').read_text().splitlines() if (parts:=line.split()) and len(parts)>=2 and parts[1].isdigit()}
 x5=os.statvfs(X5_ROOT);tmpfs=os.statvfs(PRIVATE_ROOT)
 result={'memoryAvailableBytes':memory.get('MemAvailable',0),'cpuCount':os.cpu_count() or 0,
  'x5AvailableBytes':x5.f_bavail*x5.f_frsize,'tmpfsAvailableBytes':tmpfs.f_bavail*tmpfs.f_frsize}
 need(result['memoryAvailableBytes']>=5*1024**3 and result['cpuCount']>=2 and result['x5AvailableBytes']>=4*1024**3 and result['tmpfsAvailableBytes']>=256*1024**2,
  'WHOLE_NEW_FIXTURE_HEADROOM_INSUFFICIENT')
 return result
