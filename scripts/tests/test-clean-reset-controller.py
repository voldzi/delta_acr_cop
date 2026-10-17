"""Protocol checks only; synthetic admission is never production Root evidence."""
import importlib.util
from pathlib import Path
import unittest
import uuid

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

    def test_a_named_fake_admission_does_not_pass_the_production_factory(self):
        fake = type('RootResetAdmission', (), {'assert_current': lambda _: None})()
        with self.assertRaisesRegex(RuntimeError, 'ROOT_OWNER_REQUIRED'):
            m.PrivateWorkerDispatch(fake, 'cop')
        with self.assertRaisesRegex(RuntimeError, 'ROOT_OWNER_REQUIRED'):
            m.run_private_worker(fake, {})


if __name__ == '__main__':
    unittest.main()
