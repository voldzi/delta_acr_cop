"""Finite local native-stage pump. No simulator, Root, provisioning or CLI.

The caller supplies Jizda's frozen SpoolClient and an already authorized window.
One result proves one observation only, never an entire acceptance case.
Any uncertain publication/completion stops this instance without replay.
"""
from pathlib import Path
import time
import uuid

CASES = frozenset(('stable-binding', 'explicit-join', 'outsider', 'source-pending',
    'pending-restart', 'revoke-joined', 'revoke-invited', 'stale-context',
    'history-and-keys', 'notifications', 'vehicle-close', 'lifecycle', 'privacy-boundaries'))
ACTIONS = {
    'preflight_actor': set(), 'lease_cop_access': set(), 'bootstrap_actor': set(),
    'resolve_conversation': {'operationId', 'membershipRevision', 'expectedResolution'},
    'accept_invitation': {'conversation'}, 'assert_joined': {'conversation'},
    'assert_not_joined': {'conversation'}, 'assert_invitation_revoked': {'conversation'},
    'assert_native_send_denied': {'conversation'}, 'encrypted_send': {'conversation'},
    'assert_decrypted': {'conversation', 'message'}, 'assert_event_denied': {'conversation', 'message'},
    'assert_session_rotated': {'conversation', 'message', 'otherMessage'},
    'assert_stale_audience_denied': {'conversation'}, 'suspend_and_reopen': set(),
    'checkpoint_exit': set(), 'finish': set(),
}


class Unproven(ValueError):
    pass


def need(value, code):
    if not value:
        raise Unproven(code)


class Pump:
    def __init__(self, spool, journal, steps, deadline, window_open, *, now=time.time,
                 monotonic=time.monotonic, sleep=time.sleep):
        self.spool, self.journal, self.steps = spool, journal, steps
        self.deadline, self.window_open = deadline, window_open
        self.now, self.monotonic, self.sleep = now, monotonic, sleep
        self.sequence, self.blocked, self.checkpointed = 1, False, False
        self.observations = []
        # Resume needs separate reconciliation of the native persisted cursor,
        # inFlight and process exit. Never infer it from a constructor argument.
        need(not list((Path(spool.root) / 'commands').iterdir()) and
             not list((Path(spool.root) / 'results').iterdir()), 'PUMP_PRIOR_RUN_REQUIRES_RECONCILIATION')

    def _current(self):
        need(not self.blocked and not self.checkpointed, 'PUMP_STOPPED')
        need(self.now() < self.deadline and self.window_open(), 'PUMP_WINDOW_CLOSED')

    def request(self, case, actor, action, **fields):
        self._current()
        need(case in CASES and actor in ('a', 'b', 'c') and action in ACTIONS and
             set(fields) == ACTIONS[action] and self.sequence <= 128, 'PUMP_FINITE_COMMAND')
        command = {'contractVersion': 'jizda-vehicle-native-command-v1',
            'runId': self.spool.run_id, 'sequence': self.sequence, 'id': str(uuid.uuid4()),
            'caseID': case, 'actor': actor, 'action': action, **fields}
        name = f'coordinator-{self.sequence:04d}'
        # The attempt stays durable even if publication or result custody fails.
        self.journal.save(name + '-intent.json', command)
        self.blocked = True
        need(self.now() < self.deadline and self.window_open(), 'PUMP_WINDOW_CLOSED')
        expected_digest = self.spool.publish(command)
        bound = min(self.monotonic() + 60, self.monotonic() + self.deadline - self.now())
        while self.monotonic() < bound:
            need(self.now() < self.deadline and self.window_open(), 'PUMP_WINDOW_CLOSED')
            observed = self.spool.result(command)
            if observed is not None:
                result, public = observed
                # SpoolClient verifies the actual immutable wire bytes. Check
                # its digest again before retaining any observation/lease.
                need(result['commandSHA256'] == expected_digest, 'PUMP_RESULT_CHANGED')
                self.journal.save(name + '-observation.json', result)
                need(result['status'] == 'passed', 'PUMP_NATIVE_STAGE_UNPROVEN')
                allowed = {'caseID', 'action', 'status', 'reasonCode', 'commandSHA256', 'httpStatus'}
                self.observations.append({key: value for key, value in public.items() if key in allowed})
                self.sequence += 1
                self.checkpointed = action == 'checkpoint_exit'
                self.blocked = action == 'finish'
                return command, result
            self.sleep(min(0.1, max(0, bound - self.monotonic())))
        raise Unproven('PUMP_RESULT_NOT_OBSERVED')

    def lease(self, case, actor):
        command, _ = self.request(case, actor, 'lease_cop_access')
        stem = f'{command["sequence"]:04d}.json'
        raw = self.steps.private_read(Path(self.spool.root) / 'commands' / stem)
        result = self.steps.private_read(Path(self.spool.root) / 'results' / stem)
        try:
            return self.steps.Lease.from_spool(self.spool.root, raw, result, self.deadline, self.now())
        except Exception:
            self.blocked = True
            raise Unproven('PUMP_LEASE_UNPROVEN') from None

    def public_observations(self):
        # No raw result, identity, event, room or lease is returned here. This
        # is explicitly not a full case result or a notification handoff proof.
        return {'nativeStages': [dict(value) for value in self.observations], 'aggregatePass': False}
