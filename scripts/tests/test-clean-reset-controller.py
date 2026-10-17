"""Protocol checks only; synthetic admission is never production Root evidence."""
import importlib.util
from pathlib import Path
import unittest
import uuid
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('controller', Path(__file__).parents[1] / 'account-safety/clean-reset-controller.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ControllerProtocolTest(unittest.TestCase):
    def setUp(self):
        # Explicitly synthetic state to exercise the protocol, not the factory.
        self.admission = object.__new__(m.host.RootResetAdmission)
        self.calls = 0
        def current():
            self.calls += 1
        self.admission.assert_current = current
        self.admission.plan = {'reviewedPlanDigests': {'cop': 'a' * 64, 'ai': 'b' * 64},
                               'resetEpoch': str(uuid.uuid4()), 'tokensNotBefore': 123}
        self.dispatch = m.PrivateWorkerDispatch(self.admission, 'cop')

    def frame(self, operation, payload):
        return {'contractVersion': 'cop-clean-reset-root-rpc-v1', 'requestId': str(uuid.uuid4()),
                'operation': operation, 'payload': payload}

    def begin(self):
        return self.frame('begin', {'phase': 'cop', 'context': {'phase': 'cop', 'planDigest': 'a' * 64}})

    def test_lease_binds_each_assertion_and_cannot_be_reused_after_end(self):
        lease = self.dispatch.dispatch(self.begin())['value']['leaseId']
        self.dispatch.dispatch(self.frame('assert', {'leaseId': lease}))
        self.dispatch.dispatch(self.frame('end', {'leaseId': lease}))
        with self.assertRaisesRegex(RuntimeError, 'LEASE_INVALID'):
            self.dispatch.dispatch(self.frame('assert', {'leaseId': lease}))
        self.dispatch.finish()
        self.assertGreaterEqual(self.calls, 5)

    def test_duplicate_rpc_and_forged_lease_cannot_authorize_work(self):
        frame = self.begin()
        self.dispatch.dispatch(frame)
        with self.assertRaisesRegex(RuntimeError, 'REPLAY_INVALID'):
            self.dispatch.dispatch(frame)
        with self.assertRaisesRegex(RuntimeError, 'LEASE_INVALID'):
            self.dispatch.dispatch(self.frame('assert', {'leaseId': str(uuid.uuid4())}))
        with self.assertRaisesRegex(RuntimeError, 'LEASE_LEFT_OPEN'):
            self.dispatch.finish()

    def test_other_phase_or_plan_cannot_obtain_an_admission(self):
        for payload in [{'phase': 'ai', 'context': {'planDigest': 'a' * 64}},
                        {'phase': 'cop', 'context': {'planDigest': 'b' * 64}},
                        {'phase': 'cop', 'context': {'planDigest': 'a' * 64, 'lane': 'driver'}}]:
            with self.assertRaises(RuntimeError):
                self.dispatch.dispatch(self.frame('begin', payload))
        self.assertIsNone(self.dispatch.lease)

    def test_no_generic_command_or_arbitrary_container_operation_exists(self):
        for operation, payload in [('exec', {'command': 'synthetic'}), ('inspectWriter', {'name': 'other-app'}),
                                   ('producers', {'leaseId': str(uuid.uuid4())})]:
            with self.assertRaises(RuntimeError):
                self.dispatch.dispatch(self.frame(operation, payload))

    def test_sim_app_reset_has_a_separate_review_and_only_exact_stopped_main(self):
        self.admission.plan['reviewedPlanDigests']['sim_app_files'] = 'c' * 64
        expected = {'id': 'd' * 64, 'image': 'sha256:' + 'e' * 64}
        self.admission.plan['localWriters'] = {'csm-sim-api': expected}
        dispatch = m.PrivateWorkerDispatch(self.admission, 'sim_app_files')
        for context in [{'planDigest': 'a' * 64}, {'planDigest': 'c' * 64, 'lane': 'ai'}]:
            with self.assertRaises(RuntimeError):
                dispatch.dispatch(self.frame('begin', {'phase': 'sim_app_files', 'context': context}))
        with self.assertRaisesRegex(RuntimeError, 'WRITER_SCOPE'):
            dispatch.dispatch(self.frame('inspectWriter', {'name': 'csm-sim-api'}))
        lease = dispatch.dispatch(self.frame('begin', {'phase': 'sim_app_files', 'context': {'planDigest': 'c' * 64}}))['value']['leaseId']
        stopped = {**expected, 'running': False, 'restarting': False, 'status': 'exited', 'pid': 0}
        with patch.object(m.host, 'inspect_writers', return_value={'csm-sim-api': stopped}):
            proof = dispatch.dispatch(self.frame('inspectWriter', {'name': 'csm-sim-api'}))['value']
            self.assertEqual(proof['Id'], expected['id'])
        for field, bad in [('id', 'f' * 64), ('image', 'sha256:' + 'f' * 64), ('running', True), ('pid', 12)]:
            changed = {**stopped, field: bad}
            with patch.object(m.host, 'inspect_writers', return_value={'csm-sim-api': changed}):
                with self.assertRaisesRegex(RuntimeError, 'WRITER_NOT_STOPPED'):
                    dispatch.dispatch(self.frame('inspectWriter', {'name': 'csm-sim-api'}))
        for name in ['csm-sim-ai-router-api', 'cop-cop-api-1', 'other-app']:
            with self.assertRaisesRegex(RuntimeError, 'WRITER_SCOPE'):
                dispatch.dispatch(self.frame('inspectWriter', {'name': name}))
        dispatch.dispatch(self.frame('end', {'leaseId': lease}))
        dispatch.finish()

    def test_sim_install_lease_binds_epoch_and_each_original_sim_instance(self):
        self.admission.plan['reviewedPlanDigests']['sim_user_install'] = 'c' * 64
        names = ['csm-sim-api', 'csm-sim-ai-router-api', 'csm-sim-situation-data-api']
        expected = {'id': 'd' * 64, 'image': 'sha256:' + 'e' * 64}
        self.admission.plan['localWriters'] = {n: dict(expected) for n in names}
        dispatch = m.PrivateWorkerDispatch(self.admission, 'sim_user_install')
        context = {'planDigest': 'c' * 64, 'resetEpoch': self.admission.plan['resetEpoch'], 'tokensNotBefore': 123}
        for field, value in [('resetEpoch', str(uuid.uuid4())), ('tokensNotBefore', 124), ('planDigest', 'f' * 64)]:
            with self.assertRaises(RuntimeError):
                dispatch.dispatch(self.frame('begin', {'phase': 'sim_user_install', 'context': {**context, field: value}}))
        lease = dispatch.dispatch(self.frame('begin', {'phase': 'sim_user_install', 'context': context}))['value']['leaseId']
        for name in names:
            stopped = {**expected, 'running': False, 'restarting': False, 'status': 'exited', 'pid': 0}
            with patch.object(m.host, 'inspect_writers', return_value={name: stopped}):
                self.assertEqual(dispatch.dispatch(self.frame('inspectWriter', {'name': name}))['value']['Id'], expected['id'])
            with patch.object(m.host, 'inspect_writers', return_value={name: {**stopped, 'pid': 5}}):
                with self.assertRaisesRegex(RuntimeError, 'WRITER_NOT_STOPPED'):
                    dispatch.dispatch(self.frame('inspectWriter', {'name': name}))
        with self.assertRaisesRegex(RuntimeError, 'WRITER_SCOPE'):
            dispatch.dispatch(self.frame('inspectWriter', {'name': 'other-app'}))
        dispatch.dispatch(self.frame('end', {'leaseId': lease}))
        dispatch.finish()

    def test_a_named_fake_admission_does_not_pass_the_production_factory(self):
        fake = type('RootResetAdmission', (), {'assert_current': lambda _: None})()
        with self.assertRaisesRegex(RuntimeError, 'ROOT_OWNER_REQUIRED'):
            m.PrivateWorkerDispatch(fake, 'cop')
        with self.assertRaisesRegex(RuntimeError, 'ROOT_OWNER_REQUIRED'):
            m.run_private_worker(fake, {})


if __name__ == '__main__':
    unittest.main()
