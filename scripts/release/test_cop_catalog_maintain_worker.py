import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch
from unittest.mock import MagicMock
import stat

spec = importlib.util.spec_from_file_location('worker', Path(__file__).with_name('cop-catalog-maintain-worker.py'))
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)


class WorkerTests(unittest.TestCase):
    def pointer(self):
        return dict(contractVersion='cop-api-runtime-active-v1', generation='a'*32,
                    releaseId='release-'+'b'*32, profileId=w.PROFILE,
                    profileGeneration=w.PROFILE, imageId=w.OLD_API, containerId='c'*64)

    def test_partial_cli_validation_requires_full_pointer_match(self):
        p = self.pointer()
        cli = {k:p[k] for k in ('releaseId','profileId','profileGeneration','imageId','generation')}
        with patch.object(w, 'runtime', return_value=cli), patch.object(w, 'read', return_value=json.dumps(p).encode()):
            self.assertEqual(w.active_pointer(), p)
            cli['generation'] = 'd'*32
            with self.assertRaisesRegex(w.Stop, 'ACTIVE_VALIDATION_CHANGED'):
                w.active_pointer()

    def web_fixture(self):
        config = {'Env':['NODE_ENV=production'], 'Labels':{'org.opencontainers.image.revision':'8afa082415a67e55f61fb9fb661d953b57fec8c8'}}
        target = {'Config':config, 'Os':'linux', 'Architecture':'amd64'}
        live = {'Config':{'Env':['NODE_ENV=production','PUBLIC_SETTING=true']}, 'NetworkSettings':{'Networks':{'cop_default':{'NetworkID':'net1'}}}}
        resolved = {'services':{'cop-web':{'image':w.WEB,'environment':{'PUBLIC_SETTING':'true'}, 'networks':{'default':{}}}}, 'networks':{'default':{'name':'cop_default'}}}
        return target,live,resolved

    def validate_fixture(self, target, live, resolved):
        module = types.SimpleNamespace(runtime_parity=lambda *args: None)
        def inspected(name):
            return target if name == w.WEB else live if name == 'cop-cop-web-1' else {'Id':'net1'}
        with patch.object(w,'command',return_value=json.dumps(resolved).encode()), patch.object(w,'inspect',side_effect=inspected):
            return w.validate_web(module,'release-'+'b'*32)

    def test_web_unchanged_environment_and_network_pass(self):
        args=self.validate_fixture(*self.web_fixture())
        self.assertEqual(args[-1],str(w.WEB_OVERRIDE))
        self.assertNotIn('up',args)

    def test_web_environment_change_denied(self):
        target,live,resolved=self.web_fixture()
        live['Config']['Env'].append('UNREVIEWED=value')
        with self.assertRaisesRegex(w.Stop,'WEB_ENV_PARITY'):
            self.validate_fixture(target,live,resolved)

    def test_duplicate_environment_denied(self):
        target,live,resolved=self.web_fixture()
        live['Config']['Env'].append('NODE_ENV=development')
        with self.assertRaisesRegex(w.Stop,'WEB_ENV_DUPLICATE'):
            self.validate_fixture(target,live,resolved)

    def test_foreign_network_denied(self):
        target,live,resolved=self.web_fixture()
        live['NetworkSettings']['Networks']['foreign']={'NetworkID':'net2'}
        with self.assertRaisesRegex(w.Stop,'WEB_NETWORK_PARITY'):
            self.validate_fixture(target,live,resolved)

    def test_network_recreated_under_same_name_denied(self):
        target,live,resolved=self.web_fixture()
        live['NetworkSettings']['Networks']['cop_default']['NetworkID']='replacement'
        with self.assertRaisesRegex(w.Stop,'WEB_NETWORK_ID'):
            self.validate_fixture(target,live,resolved)

    def test_foreign_image_denied(self):
        target,live,resolved=self.web_fixture()
        resolved['services']['cop-web']['image']='unreviewed:latest'
        with self.assertRaisesRegex(w.Stop,'WEB_TARGET_CHANGED'):
            self.validate_fixture(target,live,resolved)

    def test_foreign_source_denied(self):
        target,live,resolved=self.web_fixture()
        target['Config']['Labels']['org.opencontainers.image.revision']='e'*40
        with self.assertRaisesRegex(w.Stop,'WEB_SOURCE'):
            self.validate_fixture(target,live,resolved)

    def test_web_not_started_when_api_activation_fails(self):
        events=[]
        def runtime(stage,*args):
            events.append(stage)
            if stage=='prepare':return {'releaseId':'release-'+'d'*32}
            raise w.Stop('API_FAILED')
        with patch.object(w,'preflight'),patch.object(w,'runtime',side_effect=runtime),patch.object(w,'command') as command:
            with self.assertRaisesRegex(w.Stop,'API_FAILED'):
                w.activate({}, {'expectedActive':self.pointer(), 'attestationPath':'/fixed/attestation', 'configProofPath':'/fixed/proof'})
            command.assert_not_called()
        self.assertEqual(events,['prepare','activate'])

    def test_preflight_failure_has_no_mutation(self):
        with patch.object(w,'preflight',side_effect=w.Stop('DENIED')),patch.object(w,'runtime') as runtime,patch.object(w,'command') as command:
            with self.assertRaises(w.Stop):w.activate({}, {})
            runtime.assert_not_called()
            command.assert_not_called()

    def test_release_path_cannot_escape(self):
        for value in ('../other','release-../../etc','release-'+'a'*31,'release-'+'A'*32):
            with self.assertRaisesRegex(w.Stop,'API_RELEASE_ID'):w.web_command(value)

    def authorized_fixture(self,expiry='2026-10-25T12:15:00Z',tamper=False):
        a={'contractVersion':'cop-catalog-maintain-authorization-v1','expectedActive':self.pointer(),
           'attestationPath':'/etc/vcode-cop-api-runtime/'+w.PROFILE+'/attestation-'+w.API[7:]+'.json',
           'configProofPath':'/etc/vcode-cop-api-runtime/'+w.PROFILE+'/account-erasure-11111111-1111-4111-8111-111111111111.json',
           'webOverrideSha256':'a'*64}
        evidence={k:json.dumps(a if k=='authorization' else {'public':k}).encode()
                  for k in ('candidate','parity','provider','historical','authorization')}
        m={'contractVersion':'cop-root-reviewed-release-v1','releaseId':'a'*32,
           'previousImages':{'api':w.OLD_API,'web':w.OLD_WEB},'targetImages':{'api':w.API,'web':w.WEB},
           'sourceRevisions':{'api':w.REV,'web':'8afa082415a67e55f61fb9fb661d953b57fec8c8'},
           'profileGeneration':w.PROFILE,'guardSha256':w.GUARD_SHA,'checkedAt':'2026-10-25T12:00:00Z',
           'expiresAt':expiry,'workerSha256':w.sha(b'worker'),'reviewRecordSha256':w.sha(b'review'),
           'evidenceSha256':{k:w.sha(v) for k,v in evidence.items()},'failedPendingRiskAccepted':True}
        raw=json.dumps(m).encode()
        files={'manifest.json':raw,'approved.json':json.dumps({'releaseId':m['releaseId'],'manifestSha256':w.sha(raw)}).encode(),
               'seal-commit.json':json.dumps({'contractVersion':'cop-root-reviewed-seal-commit-v1','releaseId':m['releaseId'],'manifestSha256':w.sha(raw)}).encode(),
               'worker.py':b'worker','review-record.json':b'review',**{k+'-evidence.json':v for k,v in evidence.items()}}
        if tamper:files['provider-evidence.json']=b'changed'
        folder=MagicMock();folder.parents=[]
        folder.lstat.return_value=types.SimpleNamespace(st_mode=stat.S_IFDIR|0o755,st_uid=0)
        folder.__truediv__.side_effect=lambda name:Path('/sealed')/name
        root=MagicMock();root.__truediv__.side_effect=lambda name:folder if name==m['releaseId'] else Path('/sealed')/name
        return raw,files,root

    def fixture_authorization(self,**kwargs):
        raw,files,root=self.authorized_fixture(**kwargs)
        now=w.datetime.fromisoformat('2026-10-25T12:05:00+00:00').timestamp()
        with patch.object(w,'ROOT',root),patch.object(w,'read',side_effect=lambda p,*args:files[p.name]),patch.object(w.time,'time',return_value=now):
            return w.authorization(raw)

    def test_direct_worker_requires_valid_root_sealed_review(self):
        m,a=self.fixture_authorization()
        self.assertEqual(m['releaseId'],'a'*32)

    def test_expired_direct_worker_denied(self):
        with self.assertRaisesRegex(w.Stop,'REVIEW_EXPIRED'):
            self.fixture_authorization(expiry='2026-10-25T12:04:00Z')

    def test_tampered_provider_evidence_denied(self):
        with self.assertRaisesRegex(w.Stop,'EVIDENCE_INTEGRITY'):
            self.fixture_authorization(tamper=True)


if __name__ == '__main__':
    unittest.main()
