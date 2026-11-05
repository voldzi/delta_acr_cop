"""Finite local native-stage pump. No simulator, Root, provisioning or CLI.

The caller supplies Jizda's frozen SpoolClient and an already authorized window.
One result proves one observation only, never an entire acceptance case.
Any uncertain publication/completion stops this instance without replay.
"""
from pathlib import Path
import hashlib
import re
import time
import uuid

NATIVE_WIRE_BOUND = 262144
# JSON ensure_ascii can turn one native wire byte (DEL) into six bytes, or a
# four-byte UTF-8 scalar into two six-byte surrogate escapes. Structural
# canonicalization adds no spaces; Journal.save adds exactly one newline.
OWN_CANONICAL_BOUND = 6 * NATIVE_WIRE_BOUND + 1

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
        self.checkpoint_command = None
        self.expected_process_id = None
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
                process_id = result.get('processId')
                need(type(process_id) is int and process_id > 0 and
                     (self.expected_process_id is None or process_id == self.expected_process_id),
                     'PUMP_UNEXPECTED_NATIVE_PROCESS')
                self.expected_process_id = process_id
                allowed = {'caseID', 'action', 'status', 'reasonCode', 'commandSHA256', 'httpStatus'}
                self.observations.append({key: value for key, value in public.items() if key in allowed})
                self.sequence += 1
                self.checkpointed = action == 'checkpoint_exit'
                self.checkpoint_command = dict(command) if self.checkpointed else None
                self.blocked = action == 'finish'
                return command, result
            self.sleep(min(0.1, max(0, bound - self.monotonic())))
        raise Unproven('PUMP_RESULT_NOT_OBSERVED')

    def _prefix_read(self, path):
        root = Path(self.spool.root)
        need(path.parent in (root / 'private', root / 'commands', root / 'results'),
             'PUMP_PREFIX_PATH')
        bound = OWN_CANONICAL_BOUND if path.parent == root / 'private' else NATIVE_WIRE_BOUND
        return self.steps.private_read(path, bound=bound)

    def _own_checkpoint_prefix(self, checkpoint):
        boundary = checkpoint['sequence']
        need(type(boundary) is int and 1 <= boundary < 128 and
             self.sequence == boundary + 1 and checkpoint == self.checkpoint_command,
             'PUMP_CHECKPOINT_CURSOR_CHANGED')
        root = Path(self.spool.root)
        expected = {f'coordinator-{i:04d}-{suffix}.json'
                    for i in range(1, boundary + 1) for suffix in ('intent', 'observation')}
        need({p.name for p in (root / 'private').iterdir()
              if p.name.startswith('coordinator-')} == expected, 'PUMP_OWN_JOURNAL_PREFIX')
        raw_files = {}
        last_result = None
        for sequence in range(1, boundary + 1):
            stem = f'{sequence:04d}.json'
            paths = [root / 'private' / f'coordinator-{sequence:04d}-{kind}.json'
                     for kind in ('intent', 'observation')]
            paths += [root / 'commands' / stem, root / 'results' / stem]
            for path in paths:
                raw_files[path] = self._prefix_read(path)
            intent, own_result, command, result = [self.steps.parse(raw_files[path]) for path in paths]
            need(raw_files[paths[0]] == self.steps.canonical(intent) + b'\n' and
                 raw_files[paths[1]] == self.steps.canonical(own_result) + b'\n' and
                 intent == command and own_result == result and result['status'] == 'passed' and
                 command['sequence'] == sequence and
                 self.steps.identifier(command['runId']) == self.steps.identifier(self.spool.run_id),
                 'PUMP_OWN_JOURNAL_CHANGED')
            # This invokes the frozen native helper's complete wire/result
            # validation, not just comparisons to caller-supplied metadata.
            checked = self.spool.result(command)
            need(checked is not None and checked[0] == result, 'PUMP_PREFIX_RESULT_UNPROVEN')
            if sequence == boundary:
                need(command == checkpoint, 'PUMP_CHECKPOINT_COMMAND_CHANGED')
                last_result = result
            else:
                need(command['action'] != 'finish', 'PUMP_TERMINAL_PREFIX')
        return raw_files, last_result

    def resume(self, checkpoint_command):
        """Observe an explicitly restarted native host; never start it here.

        Resume is for this existing coordinator only. Its own complete immutable
        journal must agree with native evidence. No caller PID, cursor or exit
        boolean is accepted. An unproven read leaves checkpoint blocking intact.
        """
        need(self.checkpointed and not self.blocked and
             self.now() < self.deadline and self.window_open(), 'PUMP_RESUME_NOT_ALLOWED')
        need(checkpoint_command.get('action') == 'checkpoint_exit', 'PUMP_CHECKPOINT_REQUIRED')
        files, previous = self._own_checkpoint_prefix(checkpoint_command)
        observation = self.spool.observe_resume(checkpoint_command)
        proof = vars(observation)
        fields = {'run_id', 'checkpoint_id', 'next_sequence', 'old_process_id', 'new_process_id',
                  'old_launch_id', 'new_launch_id', 'fixture_sha256', 'receipt_sha256'}
        need(set(proof) == fields and
             self.steps.identifier(proof['run_id']) == self.steps.identifier(self.spool.run_id) and
             self.steps.identifier(proof['checkpoint_id']) == self.steps.identifier(checkpoint_command['id']) and
             type(proof['next_sequence']) is int and proof['next_sequence'] == self.sequence and
             type(proof['old_process_id']) is int and type(proof['new_process_id']) is int and
             0 < proof['old_process_id'] != proof['new_process_id'] > 0 and
             proof['old_process_id'] == previous['processId'] == self.expected_process_id and
             self.steps.identifier(proof['old_launch_id']) != self.steps.identifier(proof['new_launch_id']) and
             proof['fixture_sha256'] == hashlib.sha256(
                 self.steps.private_read(Path(self.spool.root) / 'fixture.json', bound=262144)).hexdigest() and
             isinstance(proof['receipt_sha256'], str) and re.fullmatch('[a-f0-9]{64}', proof['receipt_sha256']),
             'PUMP_RESUME_OBSERVATION_UNPROVEN')
        need(all(self._prefix_read(path) == raw for path, raw in files.items()) and
             self.now() < self.deadline and self.window_open(), 'PUMP_RESUME_DRIFT')
        # From here an uncertain receipt write must also remain a hard stop.
        self.blocked = True
        self.journal.save('native-resume-' + self.steps.identifier(checkpoint_command['id']) + '.json', proof)
        self.checkpointed, self.blocked, self.checkpoint_command = False, False, None
        self.expected_process_id = proof['new_process_id']
        # Keep the existing verified sequence. Never assign a cursor from input.
        return None  # Private receipt/process/launch values never become public.

    def lease(self, case, actor):
        command, _ = self.request(case, actor, 'lease_cop_access')
        stem = f'{command["sequence"]:04d}.json'
        raw = self._prefix_read(Path(self.spool.root) / 'commands' / stem)
        result = self._prefix_read(Path(self.spool.root) / 'results' / stem)
        try:
            return self.steps.Lease.from_spool(self.spool.root, raw, result, self.deadline, self.now())
        except Exception:
            self.blocked = True
            raise Unproven('PUMP_LEASE_UNPROVEN') from None

    def public_observations(self):
        # No raw result, identity, event, room or lease is returned here. This
        # is explicitly not a full case result or a notification handoff proof.
        return {'nativeStages': [dict(value) for value in self.observations], 'aggregatePass': False}
