import importlib.util
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('server_steps', Path(__file__).with_name('server_steps.py'))
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
RUN = '11111111-1111-4111-8111-111111111111'
OP = '22222222-2222-4222-8222-222222222222'
VEHICLE = '33333333-3333-4333-8333-333333333333'
INVITE = '44444444-4444-4444-8444-444444444444'
ACCOUNT = {a: f'{n}' * 8 + '-' + f'{n}' * 4 + '-4' + f'{n}' * 3 + '-8' + f'{n}' * 3 + '-' + f'{n}' * 12
           for a, n in zip(('a', 'b', 'c'), (5, 6, 7))}


class Steps(unittest.TestCase):
    def lease(self, actor='a', **changes):
        value = {'contractVersion': 'jizda-vehicle-cop-access-lease-v1', 'runId': RUN,
                 'commandId': OP, 'actor': actor, 'issuer': s.ISSUER, 'copOrigin': s.ORIGIN,
                 'accessToken': 'synthetic-secret', 'expiresAt': '1970-01-01T00:02:00Z', **changes}
        return s.Lease(json.dumps(value).encode(), RUN, OP, actor, 130, 100)

    def receipt(self):
        return {'operationId': OP, 'confirmed': True, 'vehicle': {'vehicleId': VEHICLE,
                'details': {'name': 'Owned vehicle acceptance ' + RUN.upper()},
                'members': [{'accountId': ACCOUNT['a'], 'role': 'owner'}]}}

    def driver(self, directory, transport=None, window=True):
        return s.Driver(RUN, {a: {'mobilityAccountId': ACCOUNT[a], 'invitationAddress': a + '@owned.test'}
                            for a in ACCOUNT}, OP, 130, self.lease, s.Journal(directory), lambda: window,
                        transport=transport or (lambda *args: (200, self.receipt())), now=lambda: 100)

    def test_lease_rejects_foreign_origin_refresh_field_expiry_and_header_injection(self):
        self.assertNotIn('synthetic-secret', repr(self.lease()))
        for changes in ({'copOrigin': 'https://other.test'}, {'runId': VEHICLE},
                        {'refreshToken': 'forbidden'}, {'expiresAt': '1970-01-01T00:01:40Z'},
                        {'accessToken': 'bad\r\nheader'}):
            with self.subTest(changes=tuple(changes)), self.assertRaises(ValueError):
                self.lease(**changes)

    def test_private_custody_rejects_symlink_and_hardlink(self):
        with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as tmp:
            path = Path(tmp) / 'lease.json'
            path.write_bytes(b'private')
            path.chmod(0o600)
            self.assertEqual(s.private_read(path), b'private')
            link = Path(tmp) / 'link'
            link.symlink_to(path)
            with self.assertRaises(ValueError): s.private_read(link)
            link.unlink()
            os.link(path, link)
            with self.assertRaises(ValueError): s.private_read(path)

    def test_uncertain_create_retains_claim_and_never_retries_or_creates_second_vehicle(self):
        calls = []
        def uncertain(*args):
            calls.append(args[:3])
            raise s.Rejected('STEPS_TRANSPORT_UNPROVEN')
        with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as tmp:
            driver = self.driver(tmp, uncertain)
            with self.assertRaises(ValueError): driver.create()
            with self.assertRaises(FileExistsError): driver.create()
            self.assertEqual(len(calls), 1)
            self.assertEqual(len(list(Path(tmp).glob('*attempt.json'))), 1)
            self.assertFalse((Path(tmp) / 'vehicle-created.json').exists())

    def test_creation_handoff_preserves_wire_receipt_and_single_vehicle_binding(self):
        with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as tmp:
            driver = self.driver(tmp)
            value = driver.create()
            self.assertEqual(s.parse(s.private_read(Path(tmp) / 'vehicle-created.json')), value)
            self.assertEqual(driver.vehicle_id, VEHICLE)
            with self.assertRaises(ValueError): driver.create()
            with self.assertRaises(ValueError): driver.accept('b', INVITE, VEHICLE)

    def test_closed_window_and_wrong_actor_lease_cannot_issue_or_claim_mutation(self):
        with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as tmp:
            driver = self.driver(tmp, window=False)
            with self.assertRaises(ValueError): driver.create()
            self.assertEqual(list(Path(tmp).iterdir()), [])

            driver.window_open = lambda: True
            driver.lease = lambda actor: self.lease('b')
            with self.assertRaises(ValueError): driver.create()
            self.assertEqual(list(Path(tmp).iterdir()), [])

    def test_closure_during_native_lease_wait_prevents_even_mutation_claim(self):
        with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as tmp:
            driver = self.driver(tmp)
            calls = iter((True, False))
            driver.window_open = lambda: next(calls)
            with self.assertRaises(ValueError): driver.create()
            self.assertEqual(list(Path(tmp).iterdir()), [])

    def test_queued_own_invitation_cannot_be_accepted_by_other_actor(self):
        with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as tmp:
            driver = self.driver(tmp)
            driver.create()
            driver.transport = lambda *args: (200, {'operationId': INVITE,
                'invitationId': VEHICLE, 'status': 'queued'})
            driver.invite('b', INVITE, 1)
            with self.assertRaises(ValueError): driver.accept('c', RUN, VEHICLE)

    def test_202_pending_is_preserved_and_never_automatically_polled_or_replayed(self):
        calls = []
        with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as tmp:
            driver = self.driver(tmp)
            driver.create()
            def pending(*args):
                calls.append(args[:3])
                return 202, {'confirmed': False, 'communicationState': 'pending'}
            driver.transport = pending
            status, result = driver.remove('b', INVITE, 2)
            self.assertEqual((status, result['confirmed']), (202, False))
            with self.assertRaises(FileExistsError): driver.remove('b', INVITE, 2)
            self.assertEqual(len(calls), 1)

    def test_no_arbitrary_origin_or_route_or_redirect(self):
        for path in ('https://evil.test', '/api/v1/account/erase',
                     s.VEHICLES + '/' + VEHICLE + '?accountId=other'):
            with self.assertRaises(ValueError): s.wire('POST', path, {}, self.lease(), now=lambda: 100)
        self.assertIsNone(s.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.test'))

    def test_spool_lease_binds_actual_command_bytes_and_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as tmp:
            private = Path(tmp) / 'private'
            private.mkdir(mode=0o700)
            command = {'contractVersion': 'jizda-vehicle-native-command-v1', 'runId': RUN,
                       'sequence': 1, 'id': OP, 'caseID': 'stable-binding',
                       'actor': 'a', 'action': 'lease_cop_access'}
            raw = s.canonical(command)
            result = {'contractVersion': 'jizda-vehicle-native-result-v1', 'runId': RUN,
                      'sequence': 1, 'commandId': OP, 'commandSHA256': hashlib.sha256(raw).hexdigest(),
                      'caseID': 'stable-binding', 'action': 'lease_cop_access', 'status': 'passed',
                      'reasonCode': 'STAGE_OBSERVED', 'processId': 123,
                      'leaseReference': 'private/access-' + OP.upper() + '.json'}
            lease = {'contractVersion': 'jizda-vehicle-cop-access-lease-v1', 'runId': RUN,
                     'commandId': OP, 'actor': 'a', 'issuer': s.ISSUER, 'copOrigin': s.ORIGIN,
                     'accessToken': 'synthetic-secret', 'expiresAt': '1970-01-01T00:02:00Z'}
            s.Journal(private).save('access-' + OP.upper() + '.json', lease)
            actual = s.Lease.from_spool(tmp, raw, s.canonical(result), 130, 100)
            self.assertEqual(actual.actor, 'a')
            self.assertNotIn(lease['accessToken'], repr(actual))
            with self.assertRaises(ValueError):
                s.Lease.from_spool(tmp, raw + b' ', s.canonical(result), 130, 100)
            result['leaseReference'] = '../elsewhere.json'
            with self.assertRaises(ValueError):
                s.Lease.from_spool(tmp, raw, s.canonical(result), 130, 100)


if __name__ == '__main__':
    unittest.main()
