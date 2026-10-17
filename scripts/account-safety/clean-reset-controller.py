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
PHASE_PLAN = {'identity': 'keycloak', 'cop': 'cop', 'ai': 'ai', 'driver': 'driver', 'files': 'files', 'sim_app_files': 'sim_app_files', 'sim_user_install': 'sim_user_install', 'cop_safety_install': 'cop_safety_install'}
READBACK_PHASES = {'readback', 'file_readback'}
HOST_FILE_PHASES = {'files', 'sim_app_files', 'file_readback'}


def need(value, code):
    if not value:
        raise RuntimeError(code)


class PrivateWorkerDispatch:
    def __init__(self, admission, phase):
        need(type(admission) is host.RootResetAdmission and phase in (set(PHASE_PLAN) | READBACK_PHASES), 'RESET_CONTROLLER_ROOT_OWNER_REQUIRED')
        admission.assert_current()
        self.admission, self.phase = admission, phase
        self.lease = None
        self.seen = set()
        self.closed = False
        self.file_readback_config = None

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
            if self.phase in READBACK_PHASES:
                need(context == {'phase': self.phase}, 'RESET_CONTROLLER_READBACK_INVALID')
            else:
                need(context.get('planDigest') == self.admission.plan['reviewedPlanDigests'][PHASE_PLAN[self.phase]],
                     'RESET_CONTROLLER_PLAN_MISMATCH')
                need('phase' not in context or context['phase'] == self.phase, 'RESET_CONTROLLER_PHASE_INVALID')
                need('lane' not in context or context['lane'] == self.phase, 'RESET_CONTROLLER_PHASE_INVALID')
                if self.phase in {'sim_user_install', 'cop_safety_install'}:
                    need(context.get('resetEpoch') == self.admission.plan['resetEpoch']
                         and context.get('tokensNotBefore') == self.admission.plan['tokensNotBefore'], 'RESET_CONTROLLER_EPOCH_MISMATCH')
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
        elif operation == 'fileReadback':
            need(self.phase == 'readback' and self.lease is not None and payload == {}
                 and self.file_readback_config is not None, 'RESET_CONTROLLER_FILE_READBACK_SCOPE')
            value = run_private_worker(self.admission, self.file_readback_config)
            self.admission.assert_current()
        elif operation == 'inspectWriter':
            legacy = (self.lease is None and self.phase in {'ai', 'driver', 'files'}
                      and payload.get('name') in {'csm-sim-ai-router-api', 'csm-sim-situation-data-api'})
            app_reset = (self.phase == 'sim_app_files' and self.lease is not None
                         and payload.get('name') == 'csm-sim-api')
            app_install = (self.phase == 'sim_user_install' and self.lease is not None
                           and payload.get('name') in {'csm-sim-api', 'csm-sim-ai-router-api', 'csm-sim-situation-data-api'})
            need(set(payload) == {'name'} and (legacy or app_reset or app_install), 'RESET_CONTROLLER_WRITER_SCOPE')
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
         and config.get('phase') in (set(PHASE_PLAN) | READBACK_PHASES) and config.get('resetEpoch') == plan['resetEpoch']
         and config.get('tokensNotBefore') == plan['tokensNotBefore'] and config.get('simSource') == '/reviewed/sim'
         and config.get('reviewedPlanDigests') == {k: plan['reviewedPlanDigests'][k] for k in ['cop', 'ai', 'driver', 'files', 'keycloak', 'sim_app_files', 'sim_user_install', 'cop_safety_install']},
         'RESET_CONTROLLER_CONFIG_BINDING')
    dispatch = PrivateWorkerDispatch(admission, config['phase'])
    if config['phase'] == 'readback':
        dispatch.file_readback_config = {**config, 'phase': 'file_readback'}
    host_files = config['phase'] in HOST_FILE_PHASES
    runtime = Path(plan['operatorRuntime']['root']) / 'runtime'
    args = [str(runtime / 'lib/ld-musl-x86_64.so.1'), '--library-path',
            str(runtime / 'lib') + ':' + str(runtime / 'usr/lib'), str(runtime / 'usr/local/bin/node'),
            plan['sources']['cop']['root'] + '/scripts/account-safety/' +
            ('clean-files-host-worker.mjs' if host_files else 'clean-reset-worker.mjs'), '--root-pipe']
    if host_files:
        config = {k: config[k] for k in ['contractVersion', 'phase', 'resetEpoch', 'tokensNotBefore',
                                        'reviewedPlanDigests', 'reviewedPlans', 'expectedImages', 'expectedMainImage']}
    config = {**config, 'simSource': plan['sources']['sim']['root']}
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
        # The worker is a direct child of this Root operator. No privileged
        # container, secret bind, additional capability or listener is created.
        # No automatic writer restart or unfreeze follows success or failure.
