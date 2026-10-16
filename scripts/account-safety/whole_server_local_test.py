import importlib.util
import json
import pathlib
import tempfile
import unittest
import subprocess
from types import SimpleNamespace
from unittest import mock

HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('whole_server_local',HERE/'whole_server_local.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
coordinator_spec=importlib.util.spec_from_file_location('whole_coordinator',HERE.parent/'test-account-erasure-whole-joint.py')
coordinator=importlib.util.module_from_spec(coordinator_spec);coordinator_spec.loader.exec_module(coordinator)

class ServerLocalTests(unittest.TestCase):
 def test_transport_only_changes_explicit_server_local_mode(self):
  with mock.patch.object(coordinator,'SERVER_LOCAL',False): self.assertEqual(coordinator.remote_argv('docker inspect owned'),coordinator.SSH+['docker inspect owned'])
  with mock.patch.object(coordinator,'SERVER_LOCAL',True): self.assertEqual(coordinator.remote_argv('docker inspect owned'),['/usr/bin/env','-u','DOCKER_CONTEXT','DOCKER_HOST=unix:///var/run/docker.sock','/bin/sh','-c','docker inspect owned'])
 def test_private_manifest_cannot_retarget_a_frozen_case(self):
  with mock.patch.object(m,'ensure_private_root'):
   for bad in ['/private/tmp/cop-account-erasure-whole-full-20261016.json',str(m.PRIVATE_ROOT/'other.json'),str(m.PRIVATE_ROOT/'../cop-account-erasure-whole-full-server-20261016.json')]:
    with self.assertRaisesRegex(RuntimeError,'MANIFEST_PATH_REJECTED'): m.validate_server_manifest_path(bad)
 def test_fault_injection_cannot_touch_non_server_or_old_cases(self):
  with mock.patch.object(coordinator,'SERVER_LOCAL',False),mock.patch.object(coordinator,'remote') as remote:
   with self.assertRaisesRegex(RuntimeError,'NEW_OWNED_OUTAGE_SCOPE_REQUIRED'):coordinator.pause_actual_messaging_outage({},'a'*36)
   remote.assert_not_called()
  with mock.patch.object(coordinator,'SERVER_LOCAL',True),mock.patch.object(coordinator,'remote') as remote:
   with self.assertRaisesRegex(RuntimeError,'NEW_OWNED_OUTAGE_SCOPE_REQUIRED'):coordinator.pause_actual_messaging_outage({'ownerLabel':'cop-erasure-whole-e70f147c5b2f'},'a'*36)
   remote.assert_not_called()
 def test_failed_inspect_after_pause_undoes_only_original_owned_container(self):
  cid='1'*64;owner=m.HOLDER_OWNER;cop=m.CASE_OWNER
  manifest={'ownerLabel':cop,'sharedHolderOwner':owner,'sharedHolderId':'2'*64,'keycloak':{'probeContainer':cop+'-node'},'integration':{'expectedInitialOutage503':True}}
  current={'Id':cid,'State':{'Running':True,'Paused':False},'HostConfig':{'NetworkMode':'container:'+'2'*64,'PortBindings':{},'Binds':None}}
  results=[SimpleNamespace(stdout=owner),SimpleNamespace(stdout=json.dumps([current])),SimpleNamespace(stdout=cop),SimpleNamespace(returncode=0,stdout=json.dumps({'requestedAt':'2026-10-16T16:00:00.000Z'})),SimpleNamespace(returncode=0,stdout=''),subprocess.TimeoutExpired('docker inspect',1),SimpleNamespace(returncode=0,stdout='')]
  with mock.patch.object(coordinator,'SERVER_LOCAL',True),mock.patch.object(coordinator,'remote',side_effect=results) as remote:
   with self.assertRaises(subprocess.TimeoutExpired):coordinator.pause_actual_messaging_outage(manifest,'a'*36)
   self.assertEqual(remote.call_args.args[0],'docker unpause '+cid)
   self.assertEqual(remote.call_args.kwargs,{'check':False,'timeout':10})
 def test_linux_and_voldzi_are_required_before_any_private_write(self):
  with mock.patch.object(m.sys,'platform','darwin'):
   with self.assertRaisesRegex(RuntimeError,'LINUX_VOLDZI_REQUIRED'): m.ensure_private_root(create=True)
 def test_source_proof_requires_actual_clean_revision_and_exact_bytes(self):
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory).resolve();path=root/'source-proof.json'
   proof={key:'0'*64 for key in m.PROOF_KEYS};proof.update(contractVersion='cop-whole-public-source-proof-v1',sourceRevision='1'*40,sourceWorkingTreeDirty=False,sourceFilesSha256={})
   base=dict(proof);proof['messagingSource']={}
   path.write_text(json.dumps(proof));sha=m.digest_file(path)
   with mock.patch.object(m,'build_source_proof',return_value=base),mock.patch.object(m,'verify_messaging_source_paths'): self.assertEqual(m.verify_source_proof(root,path,sha),proof)
   with self.assertRaisesRegex(RuntimeError,'HASH_CHANGED'): m.verify_source_proof(root,path,'a'*64)
   changed={**proof,'compiledApiClosureSha256':'2'*64}
   with mock.patch.object(m,'build_source_proof',return_value=changed):
    with self.assertRaisesRegex(RuntimeError,'COMPILED_CLOSURE_CHANGED'):m.verify_source_proof(root,path,sha)
   proof['sourceWorkingTreeDirty']=True;path.write_text(json.dumps(proof))
   with self.assertRaisesRegex(RuntimeError,'PUBLISHED_PUBLIC_SOURCE_REQUIRED'):m.verify_source_proof(root,path,m.digest_file(path))
 def test_source_proof_cannot_follow_symlink_or_leave_public_source_root(self):
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory).resolve();(root/'real').write_text('{}');(root/'link').symlink_to(root/'real')
   with self.assertRaisesRegex(RuntimeError,'PATH_REJECTED'):m.verify_source_proof(root,root/'link','0'*64)
   with self.assertRaisesRegex(RuntimeError,'PATH_REJECTED'):m.verify_source_proof(root,root/'../elsewhere','0'*64)
 def test_closure_exact_sorted_nul_lines_no_trailing_newline(self):
  import hashlib
  self.assertEqual(m.closure({'b':'2','a':'1'}),hashlib.sha256(b'a\x001\nb\x002').hexdigest())
 def test_seed_source_secrets_never_enter_docker_config_or_arguments(self):
  source=(HERE.parent/'test-account-erasure-whole-joint.py').read_text()
  body=source.split('def prepare_server_local_keycloak(',1)[1].split('def export_server_private_bootstraps(',1)[0]
  self.assertNotIn('--env KC_BOOTSTRAP_ADMIN_PASSWORD',body)
  self.assertIn('cop-fixture-admin.password',body)
  self.assertIn("credentials.pop('adminPassword')",body)
  self.assertIn('serverOnly',body)
 def test_no_old_case_source_bypass_in_server_mode(self):
  source=(HERE.parent/'test-account-erasure-whole-joint.py').read_text()
  self.assertIn("manifest.get('ownerLabel')!=server_local.CASE_OWNER",source)
  self.assertIn("manifest.get('serverLocal',{}).get('sourceProof')!=PUBLIC_SOURCE_PROOF",source)

 def test_server_four_actor_private_version_cannot_overwrite_whole_manifest_contract(self):
  source=(HERE.parent/'test-account-erasure-whole-joint.py').read_text()
  body=source.split('def prepare_server_local_keycloak(',1)[1].split('def export_server_private_bootstraps(',1)[0]
  self.assertIn("manifest.update({key:value for key,value in seeded.items() if key!='contractVersion'})",body)
  self.assertIn("set(seeded.get('actors',{}))!={'a','b','c','d'}",body)
  self.assertIn("observed.get('actorCount')!=4",body)
 def v4_profile(self):
  import hashlib
  paths=m.expected_v4_runtime_source_paths()
  sources={value['sourcePath']:hashlib.sha256(value['sourcePath'].encode()).hexdigest() for value in paths.values()}
  return {**m.NEW_MESSAGING_PROFILE,'images':{'pg':m.PG_IMAGE,'synapse':'sha256:'+'1'*64,'messaging':'sha256:'+'2'*64},'runtimeSourcePaths':paths,'sourceSha256':sources}
 def test_v4_profile_accepts_only_exact_normative_discriminator_module_and_21_fixture_paths(self):
  import copy
  profile=self.v4_profile();self.assertEqual(len(profile['runtimeSourcePaths']),21);self.assertEqual(m.verify_v4_messaging_profile(profile),profile)
  edits=[lambda p:p.update(contractVersion='messaging-joint-credential-first-use-profile-v1'),lambda p:p.update(contractVersion='messaging-approved-joint-full-v2-freeze-v1'),
   lambda p:p.update(profileDiscriminator='full-v2-credential-first-creation-v1'),lambda p:p.update(providerModuleEntrypoint='cop_account_erasure_full_v2.AccountErasure'),
   lambda p:p['runtimeSourcePaths']['provider'].update(runtimePath='/opt/cop-private/cop_account_erasure_full_v2_credential_candidate.py'),
   lambda p:p['runtimeSourcePaths']['policyApi'].update(component='synapse'),lambda p:p['runtimeSourcePaths'].pop('sql008'),
   lambda p:p['runtimeSourcePaths'].update(unreviewed={'component':'synapse','sourcePath':'secret','runtimePath':'/data/secret'}),lambda p:p['sourceSha256'].pop('deploy/synapse/cop_unused_native_creation.py')]
  for edit in edits:
   changed=copy.deepcopy(profile);edit(changed)
   with self.assertRaisesRegex(RuntimeError,'SOURCE_PROFILE_REJECTED|RUNTIME_MAP_REJECTED|SOURCE_INCOMPLETE'):m.verify_v4_messaging_profile(changed)
 def test_v4_public_archive_verifies_all_actual_member_bytes_before_runtime_use(self):
  import hashlib,io,tarfile
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory).resolve();public=root/'public-fixture';public.mkdir();profile=self.v4_profile()
   archive=public/'source.tar.gz'
   with tarfile.open(archive,'w:gz') as tar:
    for name in profile['sourceSha256']:
     raw=name.encode();info=tarfile.TarInfo(name);info.size=len(raw);tar.addfile(info,io.BytesIO(raw))
   path=public/'profile.json';path.write_text(json.dumps(profile))
   proof={'profilePath':'public-fixture/profile.json','profileSha256':m.digest_file(path),'archivePath':'public-fixture/source.tar.gz','archiveSha256':m.digest_file(archive),'ownerLabel':m.HOLDER_OWNER}
   self.assertEqual(m.verify_messaging_source_paths(root,proof),profile)
   archive.write_bytes(b'changed')
   with self.assertRaisesRegex(RuntimeError,'SOURCE_BYTES_CHANGED'):m.verify_messaging_source_paths(root,proof)
 def test_v4_actual_runtime_checks_both_canonical_copies_and_exact_data_aliases_without_touching_providers(self):
  import copy,shlex
  profile=self.v4_profile();holder='3'*64
  manifest={'sharedHolder':m.HOLDER_NAME,'sharedHolderId':holder,'sharedHolderOwner':m.HOLDER_OWNER}
  def container(component):
   return {'Id':holder if component=='pg' else ('4' if component=='synapse' else '5')*64,'Image':profile['images'][component],
    'Config':{'Labels':{'cop.test.owner':m.HOLDER_OWNER}},'State':{'Running':True,'Paused':False},
    'HostConfig':{'NetworkMode':'none' if component=='pg' else 'container:'+holder,'PortBindings':{},'Binds':None,'LogConfig':{'Type':'none'},'ReadonlyRootfs':True}}
  def execute(command,**_kwargs):
   args=shlex.split(command)
   component=args[2].removeprefix(m.HOLDER_OWNER+'-')
   if args[:2]==['docker','inspect']:return SimpleNamespace(stdout=json.dumps([container(component)]),returncode=0)
   files={('/data/source' if component=='synapse' else '/fixture/project')+'/'+path:digest for path,digest in profile['sourceSha256'].items()}
   files.update({value['runtimePath']:profile['sourceSha256'][value['sourcePath']] for value in profile['runtimeSourcePaths'].values() if value['component']==component})
   self.assertNotIn('/opt/cop-private/',command)
   self.assertTrue(all(shlex.quote(path) in command for path in files))
   return SimpleNamespace(stdout='\n'.join(digest+'  '+path for path,digest in files.items()),returncode=0)
  proof={'messagingSource':{'profileSha256':'a'*64,'archiveSha256':'b'*64}}
  with mock.patch.object(coordinator,'SERVER_LOCAL',True),mock.patch.object(coordinator,'PUBLIC_SOURCE_PROOF',proof),mock.patch.object(coordinator.server_local,'verify_messaging_source_paths',return_value=profile),mock.patch.object(coordinator,'remote',side_effect=execute):
   result=coordinator.verify_full_messaging_source(manifest)
  self.assertEqual(result['messagingProfile'],m.NEW_MESSAGING_PROFILE);self.assertEqual(result['messagingSource']['providerSha256'],profile['sourceSha256']['deploy/synapse/cop_account_erasure_full_v2_credential_candidate.py'])
  self.assertEqual(set(result['components']),{'synapse','messaging'})
  source=(HERE.parent/'test-account-erasure-whole-joint.py').read_text()
  self.assertIn("profile_sha = '1cbeaad91663bf740a58bd8bbce54d15d9e592f30dd3d3b37d3dfa602cb1ae6b'",source)
  self.assertIn("archive_sha = '0aed0b1bfa86777c68e092910fa2b71b636467e7a7e8f4accc5c8545c31fe189'",source)

if __name__=='__main__':unittest.main()
