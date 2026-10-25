import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('seal',Path(__file__).with_name('cop-catalog-maintain-seal.py'))
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)


class SealTests(unittest.TestCase):
    def report(self):
        return {'contractVersion':'cop-sim-whole-clean-acceptance-v3',
            'checkedAt':'2026-10-17T15:22:13Z','kind':'isolated_whole_provider',
            'productionTouched':False,'deletionScope':'cop_sim_shared_identity_v1',
            'operation':{'operationId':'synthetic-operation','finalStatus':'deleted',
                'finalAccountDeleted':True,'requiredOwners':sorted(s.OWNERS)},
            'resetEpoch':'synthetic-epoch','providerReadbacks':{name:{
                'operationId':'synthetic-operation','resetEpoch':'synthetic-epoch',
                'status':'completed','userARemaining':0,'userBStateBefore':'before',
                'userBStateAfter':'before'} for name in s.OWNERS},
            'recoveryReadbacks':{'restored_user_data':{'restoredRows':1,
                'finalUserARemaining':0,'userBPreserved':True}},
            'candidateImages':{'cop_api':'historical-image'}}

    def validate_report(self,v):
        raw=s.encoded(v)
        with patch.object(s,'HISTORICAL',s.sha(raw)):
            return s.historical(raw)

    def test_historical_timestamp_never_renewed(self):
        v=self.report();result=self.validate_report(v)
        self.assertEqual(result['checkedAt'],v['checkedAt'])
        self.assertFalse(result['freshCandidateJointAcceptance'])
        self.assertFalse(result['ageExceptionUsed'])
        self.assertEqual(result['candidateImages'],v['candidateImages'])

    def test_renamed_timestamp_rejected(self):
        v=self.report();v['checkedAt']='2026-10-25T13:00:00Z'
        with self.assertRaisesRegex(s.Stop,'HISTORICAL_SCOPE'):self.validate_report(v)

    def test_pending_owner_rejected(self):
        v=self.report();v['providerReadbacks']['ai_router']['status']='pending'
        with self.assertRaisesRegex(s.Stop,'HISTORICAL_OWNER_READBACK'):self.validate_report(v)

    def test_other_account_not_preserved_rejected(self):
        v=self.report();v['providerReadbacks']['cop_devices']['userBStateAfter']='changed'
        with self.assertRaisesRegex(s.Stop,'HISTORICAL_OWNER_READBACK'):self.validate_report(v)

    def test_missing_owner_rejected(self):
        v=self.report();del v['providerReadbacks']['sim_user_data']
        with self.assertRaisesRegex(s.Stop,'HISTORICAL_OWNERS'):self.validate_report(v)

    def test_no_actual_restored_rows_rejected(self):
        v=self.report();v['recoveryReadbacks']['restored_user_data']['restoredRows']=0
        with self.assertRaisesRegex(s.Stop,'HISTORICAL_RESTORE'):self.validate_report(v)

    def test_different_bytes_rejected_before_json(self):
        with self.assertRaisesRegex(s.Stop,'HISTORICAL_HASH'):s.historical(b'{}')

    def test_symlink_and_multiple_links_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            folder=Path(folder).resolve()
            p=folder/'original';p.write_bytes(b'public')
            link=folder/'symlink';link.symlink_to(p)
            with self.assertRaisesRegex(s.Stop,'SYMLINK'):s.read(link,os.geteuid())
            os.link(p,folder/'hardlink')
            with self.assertRaisesRegex(s.Stop,'FILE_CUSTODY'):s.read(p,os.geteuid())

    def test_oversized_file_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder).resolve()/'data';p.write_bytes(b'12345')
            with self.assertRaisesRegex(s.Stop,'FILE_CUSTODY'):s.read(p,os.geteuid(),limit=4)

    def test_failed_readonly_review_cannot_write_root_files(self):
        result=type('Result',(),{'returncode':2,'stdout':b'{"passed":false}'})()
        with patch.object(s.subprocess,'run',return_value=result),patch.object(s,'write') as write:
            with self.assertRaisesRegex(s.Stop,'FRESH_REVIEW_FAILED'):
                s.execute_unprivileged(b'public-source',Path('/fixed/reviewer.py'),b'worker')
            write.assert_not_called()

    def test_readonly_reviewer_always_drops_root(self):
        result=type('Result',(),{'returncode':2,'stdout':b'{}'})()
        with patch.object(s.subprocess,'run',return_value=result) as run:
            with self.assertRaises(s.Stop):s.execute_unprivileged(b'public',Path('/fixed/reviewer.py'),b'worker')
            args=run.call_args.kwargs
            self.assertEqual((args['user'],args['group'],args['extra_groups']),(1000,1000,[1000,988]))
            self.assertNotIn('shell',args)

    def test_nonroot_never_reaches_confirmation_or_writes(self):
        with patch.object(s.os,'geteuid',return_value=1000),patch.object(s,'write') as write:
            with self.assertRaisesRegex(s.Stop,'PERSONAL_ROOT_DOCKER'):s.seal()
            write.assert_not_called()

    def publication_failure(self,replace):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder).resolve();path=root/('pin' if replace else 'proof')
            if replace:path.write_bytes(b'old')
            calls=0
            real_sync=os.fsync
            def sync(fd):
                nonlocal calls
                calls+=1
                if calls==2:raise OSError('injected after publication before directory fsync')
                return real_sync(fd)
            with patch.object(s,'directory'),patch.object(s.os,'fchown'),patch.object(s.os,'fsync',side_effect=sync):
                with self.assertRaises(OSError):s.write(path,b'new',replace=replace)
            self.assertEqual(path.read_bytes(),b'new')
            with patch.object(s,'read',side_effect=lambda p,*args:p.read_bytes()),patch.object(s,'directory'),patch.object(s.os,'fchown'):
                s.cleanup_uncommitted([] if replace else [(path,b'new')],path,b'old',b'new',replace)
            if replace:self.assertEqual(path.read_bytes(),b'old')
            else:self.assertFalse(path.exists())

    def test_after_link_before_directory_sync_failure_removes_owned_grant(self):
        self.publication_failure(False)

    def test_after_replace_before_directory_sync_failure_restores_pin(self):
        self.publication_failure(True)

    def test_cleanup_never_removes_different_existing_grant(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder).resolve()/'proof';p.write_bytes(b'other')
            with patch.object(s,'read',side_effect=lambda p,*args:p.read_bytes()):
                with self.assertRaisesRegex(s.Stop,'OWNED_SEAL_ARTIFACT_CHANGED'):
                    s.cleanup_uncommitted([(p,b'expected')],p,b'old',b'new',False)
            self.assertEqual(p.read_bytes(),b'other')

    def test_cancellation_finally_removes_index_proof_and_commit_marker(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder).resolve();created=[]
            for name in ['proof','index','commit']:
                p=root/name;p.write_bytes(name.encode());created.append((p,name.encode()))
            pin=root/'pin';pin.write_bytes(b'new')
            with patch.object(s,'read',side_effect=lambda p,*args:p.read_bytes()),patch.object(s,'directory'),patch.object(s.os,'fchown'):
                try:raise KeyboardInterrupt()
                except KeyboardInterrupt:
                    s.cleanup_uncommitted(created,pin,b'old',b'new',True)
            self.assertTrue(all(not p.exists() for p,_ in created))
            self.assertEqual(pin.read_bytes(),b'old')


if __name__=='__main__':unittest.main()
