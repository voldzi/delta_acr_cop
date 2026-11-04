"""Owned synthetic COP steps for the future paired runner. NOT RUN LIVE.

No CLI, account provisioning, token refresh, Matrix operation or admission grant.
The coordinator must supply the real native lease and one already authorized
window. Every mutation is journaled before transport and is attempted once.
An uncertain write is deliberately not replayed by this module.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time
import urllib.error
import urllib.request
import uuid

ORIGIN = 'https://cop.zeleznalady.cz'
ISSUER = 'https://login.zeleznalady.cz/realms/cop'
VEHICLES = '/api/v1/shared-vehicles/v1/vehicles'


class Rejected(ValueError):
    pass


def need(value, code):
    if not value:
        raise Rejected(code)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def parse(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            need(key not in result, 'STEPS_DUPLICATE_JSON')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs,
                      parse_constant=lambda _: need(False, 'STEPS_NONFINITE_JSON'))


def identifier(value):
    need(isinstance(value, str), 'STEPS_UUID')
    try:
        result = str(uuid.UUID(value))
    except ValueError:
        raise Rejected('STEPS_UUID') from None
    need(result == value.lower(), 'STEPS_UUID')
    return result


def private_read(path, bound=65536):
    path = Path(path)
    need(path.is_absolute() and not any(p.is_symlink() for p in (path, *path.parents)),
         'STEPS_PRIVATE_PATH')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and
             before.st_nlink == 1 and stat.S_IMODE(before.st_mode) in (0o400, 0o600) and
             before.st_size <= bound, 'STEPS_PRIVATE_CUSTODY')
        raw = os.read(fd, bound + 1)
        after = os.fstat(fd)
        need(len(raw) == before.st_size and
             (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns) ==
             (after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns),
             'STEPS_PRIVATE_CHANGED')
        return raw
    finally:
        os.close(fd)


class Lease:
    def __init__(self, raw, run_id, command_id, actor, deadline, now):
        value = parse(raw)
        need(set(value) == {'contractVersion', 'runId', 'commandId', 'actor', 'issuer',
                            'copOrigin', 'accessToken', 'expiresAt'}, 'STEPS_LEASE_FIELDS')
        need(value['contractVersion'] == 'jizda-vehicle-cop-access-lease-v1' and
             identifier(value['runId']) == identifier(run_id) and
             identifier(value['commandId']) == identifier(command_id) and
             actor in ('a', 'b', 'c') and value['actor'] == actor and
             value['issuer'] == ISSUER and value['copOrigin'] == ORIGIN,
             'STEPS_LEASE_BINDING')
        end = datetime.datetime.fromisoformat(value['expiresAt'].replace('Z', '+00:00'))
        need(end.tzinfo is not None, 'STEPS_LEASE_TIMEZONE')
        self.expires = end.timestamp()
        need(now < self.expires <= min(now + 60, deadline), 'STEPS_LEASE_EXPIRED')
        token = value['accessToken']
        need(isinstance(token, str) and 0 < len(token) <= 16384 and
             not any(c.isspace() or ord(c) < 32 or ord(c) > 126 for c in token),
             'STEPS_LEASE_TOKEN')
        self.token = token
        self.actor, self.run_id = actor, identifier(run_id)

    def __repr__(self):
        return '<native COP access lease; secret redacted>'

    @classmethod
    def from_spool(cls, spool_root, command_raw, result_raw, deadline, now):
        """Match the exact outstanding command before reading any lease path."""
        command, result = parse(command_raw), parse(result_raw)
        command_fields = {'contractVersion', 'runId', 'sequence', 'id', 'caseID', 'actor', 'action'}
        result_fields = {'contractVersion', 'runId', 'sequence', 'commandId', 'commandSHA256',
                         'caseID', 'action', 'status', 'reasonCode', 'processId', 'leaseReference'}
        need(set(command) == command_fields and set(result) == result_fields and
             command['contractVersion'] == 'jizda-vehicle-native-command-v1' and
             result['contractVersion'] == 'jizda-vehicle-native-result-v1' and
             command['action'] == result['action'] == 'lease_cop_access' and
             result['status'] == 'passed' and result['reasonCode'] == 'STAGE_OBSERVED' and
             type(command['sequence']) is int and 1 <= command['sequence'] <= 128 and
             type(result['sequence']) is int and result['sequence'] == command['sequence'] and
             type(result['processId']) is int and result['processId'] > 0 and
             result['caseID'] == command['caseID'] and
             identifier(result['runId']) == identifier(command['runId']) and
             identifier(result['commandId']) == identifier(command['id']) and
             result['commandSHA256'] == hashlib.sha256(command_raw).hexdigest(),
             'STEPS_LEASE_RESULT_UNPROVEN')
        expected = 'private/access-' + identifier(command['id']).upper() + '.json'
        need(result['leaseReference'] == expected, 'STEPS_LEASE_REFERENCE')
        # The private spool must already exist with the same ownership as the
        # native test process; this validates custody, not production authority.
        root = Path(spool_root)
        Journal(root)
        Journal(root / 'private')
        return cls(private_read(root / expected), command['runId'], command['id'],
                   command['actor'], deadline, now)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


class Journal:
    """Existing owned private spool only; append once, never overwrite/replay."""
    def __init__(self, private_directory):
        self.root = Path(private_directory)
        need(self.root.is_absolute() and not any(p.is_symlink() for p in (self.root, *self.root.parents)),
             'STEPS_JOURNAL_PATH')
        s = self.root.stat()
        need(stat.S_ISDIR(s.st_mode) and s.st_uid == os.getuid() and
             stat.S_IMODE(s.st_mode) == 0o700, 'STEPS_JOURNAL_CUSTODY')

    def save(self, name, value):
        need('/' not in name and name not in ('.', '..'), 'STEPS_JOURNAL_NAME')
        fd = os.open(self.root / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            raw = canonical(value) + b'\n'
            with os.fdopen(fd, 'wb', closefd=False) as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
        finally:
            os.close(fd)
        directory_fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)

    def claim(self, operation, intent):
        self.save('cop-' + identifier(operation) + '-attempt.json', {
            'intent': intent, 'sha256': hashlib.sha256(canonical(intent)).hexdigest()})

    def complete(self, operation, status, receipt):
        self.save('cop-' + identifier(operation) + '-response.json', {
            'httpStatus': status, 'response': receipt})

    def bind_vehicle(self, vehicle_id, receipt):
        need(identifier(receipt['vehicle']['vehicleId']) == vehicle_id, 'STEPS_BINDING_CHANGED')
        self.save('vehicle-created.json', receipt)


def wire(method, path, body, lease, *, now=time.time):
    """Fixed TLS origin, no cookies/proxy/redirect/retry; response stays private."""
    vehicle = r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
    allowed = (path == VEHICLES or path == '/api/v1/shared-vehicles/v1/invitations/accept' or
               re.fullmatch(re.escape(VEHICLES) + '/' + vehicle + r'(?:/members|/invitations|/delete)?', path))
    need(method in ('GET', 'POST') and allowed and
         ((method == 'GET' and body is None and re.fullmatch(re.escape(VEHICLES) + '/' + vehicle, path)) or
          (method == 'POST' and isinstance(body, dict))), 'STEPS_FIXED_ROUTE')
    remaining = lease.expires - now()
    need(remaining > 0, 'STEPS_LEASE_EXPIRED')
    request = urllib.request.Request(ORIGIN + path, method=method,
        data=None if body is None else canonical(body), headers={
            'Authorization': 'Bearer ' + lease.token, 'Accept': 'application/json',
            'Content-Type': 'application/json'})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        try:
            response = opener.open(request, timeout=min(10, remaining))
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read(1048577)
            need(len(raw) <= 1048576 and response.headers.get_content_type() ==
                 'application/json', 'STEPS_RESPONSE_UNPROVEN')
            need(now() < lease.expires, 'STEPS_RESPONSE_AFTER_LEASE')
            return response.code, parse(raw)
    except Rejected:
        raise
    except Exception:
        raise Rejected('STEPS_TRANSPORT_UNPROVEN') from None


class Driver:
    """Finite public-COP steps; coordinator supplies custody and durable journal.

    `lease(actor)` requests a fresh lease from the sole native refresh owner.
    `journal.claim` must exclusively persist exact intent before returning and
    refuse any already-attempted operation, including an uncertain completion.
    Neither a 202 nor a transport exception is an invitation to retry here.
    """
    def __init__(self, run_id, actors, creation_operation, deadline, lease,
                 journal, window_open, transport=wire, now=time.time):
        self.run_id = identifier(run_id)
        need(set(actors) == {'a', 'b', 'c'}, 'STEPS_ACTORS')
        need(len({identifier(a['mobilityAccountId']) for a in actors.values()}) == 3,
             'STEPS_ACTOR_ISOLATION')
        self.actors = actors
        self.creation = identifier(creation_operation)
        self.deadline, self.lease, self.journal = deadline, lease, journal
        self.window_open, self.transport, self.now = window_open, transport, now
        self.vehicle_id = None
        self.invitations = {}

    def _request(self, actor, method, path, body=None):
        need(actor in self.actors and self.now() < self.deadline and self.window_open(),
             'STEPS_WINDOW_NOT_OPEN')
        lease = self.lease(actor)
        need(lease.actor == actor and lease.run_id == self.run_id, 'STEPS_LEASE_BINDING')
        need(self.now() < min(lease.expires, self.deadline), 'STEPS_LEASE_EXPIRED')
        need(self.window_open(), 'STEPS_WINDOW_CLOSED_DURING_LEASE')
        if method == 'POST':
            operation = identifier(body['operationId'])
            self.journal.claim(operation, {'actor': actor, 'method': method,
                'path': path, 'body': body})
        # A failure after claim retains uncertainty; no refresh-and-replay.
        status, result = self.transport(method, path, body, lease)
        if method == 'POST':
            self.journal.complete(operation, status, result)
        return status, result

    def create(self):
        need(self.vehicle_id is None, 'STEPS_ONE_VEHICLE_ONLY')
        body = {'operationId': self.creation,
                'details': {'name': 'Owned vehicle acceptance ' + self.run_id.upper()}}
        status, receipt = self._request('a', 'POST', VEHICLES, body)
        need(status == 200 and receipt.get('confirmed') is True and
             identifier(receipt['operationId']) == self.creation, 'STEPS_CREATE_UNPROVEN')
        vehicle = receipt['vehicle']
        need(vehicle['details']['name'] == body['details']['name'] and
             any(identifier(m['accountId']) == identifier(self.actors['a']['mobilityAccountId'])
                 and m['role'] == 'owner' for m in vehicle['members']),
             'STEPS_OWNER_UNPROVEN')
        self.vehicle_id = identifier(vehicle['vehicleId'])
        self.journal.bind_vehicle(self.vehicle_id, receipt)
        return receipt  # Save only to private/vehicle-created.json, never stdout.

    def _path(self, suffix=''):
        need(self.vehicle_id is not None, 'STEPS_VEHICLE_NOT_BOUND')
        return VEHICLES + '/' + self.vehicle_id + suffix

    def read(self, actor):
        return self._request(actor, 'GET', self._path())

    def invite(self, actor, operation, revision):
        need(actor in ('b', 'c'), 'STEPS_INVITEE')
        status, result = self._request('a', 'POST', self._path('/invitations'), {
            'operationId': identifier(operation), 'expectedMembershipRevision': revision,
            'email': self.actors[actor]['invitationAddress'], 'capabilities': ['readVehicle']})
        if status == 200:
            need(identifier(result['operationId']) == identifier(operation) and
                 result['status'] == 'queued', 'STEPS_INVITATION_UNPROVEN')
            self.invitations[identifier(result['invitationId'])] = actor
        return status, result

    def accept(self, actor, operation, invitation):
        need(actor in ('b', 'c'), 'STEPS_INVITEE')
        need(self.invitations.get(identifier(invitation)) == actor, 'STEPS_FOREIGN_INVITATION')
        return self._request(actor, 'POST', '/api/v1/shared-vehicles/v1/invitations/accept', {
            'operationId': identifier(operation), 'invitationId': identifier(invitation)})

    def remove(self, actor, operation, revision):
        need(actor in ('b', 'c'), 'STEPS_REMOVED_ACTOR')
        return self._request('a', 'POST', self._path('/members'), {
            'operationId': identifier(operation), 'expectedMembershipRevision': revision,
            'accountId': self.actors[actor]['mobilityAccountId'], 'action': 'remove'})

    def close_vehicle(self, operation, data_revision, membership_revision):
        return self._request('a', 'POST', self._path('/delete'), {
            'operationId': identifier(operation), 'expectedDataRevision': data_revision,
            'expectedMembershipRevision': membership_revision,
            'reason': 'Owned synthetic acceptance completed'})
