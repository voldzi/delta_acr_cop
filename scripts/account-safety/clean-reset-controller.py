"""Root-owned private worker composition. No CLI, auto freeze/reset or listener.
The final release coordinator must supply the sealed plan, reviewed credentials
in RAM and one continuously held concrete RootResetAdmission instance.
"""
import importlib.util
import json
import os
from pathlib import Path
import select
import subprocess
import time
import uuid

_spec = importlib.util.spec_from_file_location('clean_reset_host', Path(__file__).with_name('clean-reset-root.py'))
host = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(host)
PHASE_PLAN = {'identity': 'keycloak', 'cop': 'cop', 'ai': 'ai', 'driver': 'driver', 'files': 'files'}


def need(value, code):
    if not value:
        raise RuntimeError(code)


class PrivateWorkerDispatch:
    def __init__(self, admission, phase):
        need(type(admission) is host.RootResetAdmission and phase in {*PHASE_PLAN, 'readback'}, 'RESET_CONTROLLER_ROOT_OWNER_REQUIRED')
        admission.assert_current()
        self.admission, self.phase = admission, phase
        self.lease = None
        self.seen = set()
        self.closed = False

    def dispatch(self, frame):
        need(not self.closed and isinstance(frame, dict) and set(frame) == {'contractVersion', 'requestId', 'operation', 'payload'}
             and frame['contractVersion'] == 'cop-clean-reset-root-rpc-v1', 'RESET_CONTROLLER_FRAME_INVALID')
        ident = frame['requestId']
        need(isinstance(ident, str) and str(uuid.UUID(ident)) == ident and ident not in self.seen
             and len(self.seen) < 10000, 'RESET_CONTROLLER_REPLAY_INVALID')
        self.seen.add(ident)
        operation, payload = frame['operation'], frame['payload']
        need(isinstance(payload, dict), 'RESET_CONTROLLER_PAYLOAD_INVALID')
        self.admission.assert_current()
        if operation == 'begin':
            need(self.lease is None and set(payload) == {'phase', 'context'} and payload['phase'] == self.phase
                 and isinstance(payload['context'], dict), 'RESET_CONTROLLER_PHASE_INVALID')
            context = payload['context']
            if self.phase == 'readback':
                need(context == {'phase': 'readback'}, 'RESET_CONTROLLER_READBACK_INVALID')
            else:
                need(context.get('planDigest') == self.admission.plan['reviewedPlanDigests'][PHASE_PLAN[self.phase]],
                     'RESET_CONTROLLER_PLAN_MISMATCH')
                need('phase' not in context or context['phase'] == self.phase, 'RESET_CONTROLLER_PHASE_INVALID')
                need('lane' not in context or context['lane'] == self.phase, 'RESET_CONTROLLER_PHASE_INVALID')
                if self.phase in {'ai', 'driver'}:
                    enrollment = context.get('enrollment', {})
                    need(enrollment.get('resetEpoch') == self.admission.plan['resetEpoch']
                         and enrollment.get('tokensNotBefore') == self.admission.plan['tokensNotBefore'], 'RESET_CONTROLLER_EPOCH_MISMATCH')
            self.lease = str(uuid.uuid4())
            value = {'leaseId': self.lease}
        elif operation in {'assert', 'producers', 'end'}:
            need(set(payload) == {'leaseId'} and self.lease is not None and payload['leaseId'] == self.lease,
                 'RESET_CONTROLLER_LEASE_INVALID')
            if operation == 'producers':
                need(self.phase == 'files', 'RESET_CONTROLLER_PRODUCER_SCOPE')
                self.admission.producers.assert_stopped(self.admission.plan['producerInventorySha256'])
            if operation == 'end':
                self.lease = None
            value = {'verified': True}
        elif operation == 'inspectWriter':
            need(self.lease is None and self.phase in {'ai', 'driver', 'files'} and set(payload) == {'name'}
                 and payload['name'] in {'csm-sim-ai-router-api', 'csm-sim-situation-data-api'}, 'RESET_CONTROLLER_WRITER_SCOPE')
            name = payload['name']
            item = host.inspect_writers(host.command, [name])[name]
            expected = {name: self.admission.plan['localWriters'][name]}
            host.assert_stopped({name: item}, expected)
            value = {'Name': '/' + name, 'Id': item['id'], 'Image': item['image'],
                     'State': {'Running': False, 'Restarting': False, 'Status': 'exited'}}
        else:
            raise RuntimeError('RESET_CONTROLLER_OPERATION_INVALID')
        return {'requestId': ident, 'ok': True, 'value': value}

    def finish(self):
        need(not self.closed and self.lease is None, 'RESET_CONTROLLER_LEASE_LEFT_OPEN')
        self.admission.assert_current()
        self.closed = True


def run_private_worker(admission, config):
    """Only called after Root acquired the complete stop/producer/source lock.
    Runtime connection values are passed over stdin, never Docker env/argv/files.
    """
    need(type(admission) is host.RootResetAdmission and os.getuid() == 0, 'RESET_CONTROLLER_ROOT_OWNER_REQUIRED')
    admission.assert_current()
    plan = admission.plan
    need(isinstance(config, dict) and config.get('contractVersion') == 'cop-sim-clean-reset-worker-v1'
         and config.get('phase') in {*PHASE_PLAN, 'readback'} and config.get('resetEpoch') == plan['resetEpoch']
         and config.get('tokensNotBefore') == plan['tokensNotBefore'] and config.get('simSource') == '/reviewed/sim'
         and config.get('reviewedPlanDigests') == {k: plan['reviewedPlanDigests'][k] for k in ['cop', 'ai', 'driver', 'files', 'keycloak']},
         'RESET_CONTROLLER_CONFIG_BINDING')
    dispatch = PrivateWorkerDispatch(admission, config['phase'])
    name = 'cop-clean-reset-worker-' + str(uuid.uuid4())
    image = plan['localWriters']['cop-cop-api-1']['image']
    args = ['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock', 'run', '--rm', '-i', '--name', name,
            '--log-driver', 'none', '--label', 'cop.clean.reset=' + plan['resetEpoch'],
            '--network', 'host', '--read-only', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges', '--memory', '256m', '--cpus', '1', '--pids-limit', '64',
            '--user', '0:0', '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=8m']
    for key in ['cop', 'sim']:
        args += ['--mount', 'type=bind,source=' + plan['sources'][key]['root'] + ',target=/reviewed/' + key + ',readonly']
    args += ['--mount', 'type=bind,source=/etc/vcode-cop-pgbouncer/postgres-ca.crt,target=/etc/vcode-cop-pgbouncer/postgres-ca.crt,readonly',
             '--entrypoint', 'node', image, '/reviewed/cop/scripts/account-safety/clean-reset-worker.mjs', '--root-pipe']
    child = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=host.ENV)
    deadline = time.monotonic() + 240
    try:
        child.stdin.write(json.dumps(config, separators=(',', ':')).encode() + b'\n')
        child.stdin.flush()
        result = None
        # Binary unbuffered per-byte frame reader avoids select/readline buffering
        # ambiguity and never sends unvalidated worker output to the terminal.
        frame = bytearray()
        while result is None:
            remaining = deadline - time.monotonic()
            need(remaining > 0, 'RESET_CONTROLLER_TIMEOUT')
            ready, _, _ = select.select([child.stdout], [], [], min(remaining, 15))
            if not ready:
                admission.assert_current()
                continue
            part = os.read(child.stdout.fileno(), 1)
            need(bool(part), 'RESET_CONTROLLER_PIPE_CLOSED')
            frame.extend(part)
            need(len(frame) <= 1048576, 'RESET_CONTROLLER_FRAME_LIMIT')
            if part != b'\n':
                continue
            value = json.loads(frame)
            frame.clear()
            if value.get('contractVersion') == 'cop-clean-reset-worker-result-v1':
                need(set(value) == {'contractVersion', 'ok', 'value'} and value['ok'] is True, 'RESET_CONTROLLER_WORKER_FAILED')
                result = value['value']
            else:
                reply = dispatch.dispatch(value)
                child.stdin.write(json.dumps(reply, separators=(',', ':')).encode() + b'\n')
                child.stdin.flush()
        child.stdin.close()
        need(child.wait(timeout=15) == 0, 'RESET_CONTROLLER_WORKER_EXIT')
        dispatch.finish()
        return result
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=10)
        probe = subprocess.run(['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock', 'inspect', '--format',
                                '{{.Image}} {{index .Config.Labels "cop.clean.reset"}}', name],
                               capture_output=True, env=host.ENV, timeout=15, check=False)
        if probe.returncode == 0 and probe.stdout.decode().strip() == image + ' ' + plan['resetEpoch']:
            subprocess.run(['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock', 'rm', '-f', name],
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           env=host.ENV, timeout=15, check=False)
        # No automatic restart or writer unfreeze on success or failure here.
