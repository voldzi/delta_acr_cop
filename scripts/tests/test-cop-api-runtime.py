#!/usr/bin/env python3
"""Offline fault tests. No Docker, server, secrets or application requests."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
import uuid
from unittest import mock

spec = importlib.util.spec_from_file_location('runtime', Path(__file__).parents[1] / 'cop-api-runtime.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
OLD = 'sha256:' + '1' * 64
NEW = 'sha256:' + '2' * 64
LATER = 'sha256:' + '3' * 64
REV = 'b' * 40
CID = 'a' * 64
HEALTH = {url: {'httpStatus': 200, 'status': 'ok', 'dependencies': {'database': 'ok'}}
          if url != m.HEALTH_URLS[-1] else {'httpStatus': 200} for url in m.HEALTH_URLS}


def write(path, value, mode=0o600):
    path.write_bytes(value if isinstance(value, bytes) else m.encoded(value)); path.chmod(mode)


def contract(mode):
    transaction = mode == 'transaction'
    return {'poolMode': mode, 'streamMode': 'memory', 'mainEnvAndMigrations': 'direct',
            'frontend': 'unix' if transaction else mode,
            'socketPath': str(m.SOCKET) if transaction else None, 'socketPort': 6432 if transaction else None,
            'supplementaryGid': 982 if transaction else None, 'caPath': str(m.CA) if transaction else None,
            'caSha256': 'f' * 64 if transaction else None, 'leasePath': 'direct_verify_full' if transaction else 'direct',
            'backendBudget': 10 if transaction else None, 'clientBudget': 80 if transaction else None}


class FakeDocker:
    def __init__(self):
        self.base = {'name': 'cop', 'networks': {k: {'name': k} for k in m.NETWORKS}, 'services': {
            'cop-api': {'image': 'delta-acr-cop-api:local', 'environment': {'COP_DATABASE_URL': 'direct-placeholder',
                        'COP_DATABASE_POOL_MODE': 'direct', 'COP_LEASE_DATABASE_URL': '',
                        'COP_STREAM_BUS_DATABASE_URL': '', 'COP_DATABASE_SSL': 'false', 'COP_STREAM_BUS': 'memory'},
                        'volumes': [{'type': 'bind', 'source': '/srv/x5-production/staging/cop/media-conversions',
                                     'target': '/data/cop-media-conversions', 'bind': {'create_host_path': False}}],
                        'networks': list(m.NETWORKS)},
            **{s: {'image': s + ':existing'} for s in ('cop-web', 'cop-chat', 'cop-edge', 'cop-mcp')}}}
        self.live_container = None; self.images = []; self.up_calls = []; self.interrupt = False
        self.created = 0
        self.release_overrides = {}
        self.interrupt_health = False
        self.image_configs = {}
        self.health_calls = []
        self.health_unobservable = False
        self.verified_baselines = []
        self.health_verify_failure = False
        self.edge_token = 'synthetic-stable-edge-token-' + '9' * 32

    def config(self, directory, profile=None, raw=False):
        value = copy.deepcopy(self.base)
        value['services']['cop-api'].update(self.release_overrides.get(directory.name, {}))
        if raw:
            value['services']['cop-api']['environment'].update({key: '${' + key + '}' for key in m.ENV})
            for key in getattr(self, 'raw_variable_keys', set()):
                if key in value['services']['cop-api']['environment']:
                    value['services']['cop-api']['environment'][key] = '${' + key + '}'
        if profile:
            data = json.loads((directory / 'release.json').read_text()) if (directory / 'release.json').exists() else None
            image_env = dict(line.removesuffix("'").split("='", 1) for line in (directory / 'image.env').read_text().splitlines())
            api = value['services']['cop-api']
            api['image'] = image_env['COP_API_RUNTIME_IMAGE_ID']
            api['environment'].update(m.env_values((profile / 'runtime.env').read_bytes()))
            api['environment']['COP_DATABASE_POOL_MODE'] = image_env[m.MODE_ENV]
            text = (directory / 'compose.runtime.yml').read_text()
            if text.startswith('services:'):
                override = {line.strip().split(': ', 1)[0]: json.loads(line.strip().split(': ', 1)[1].removeprefix('!override '))
                            for line in text.splitlines()[2:]}
                api['environment'] = {k: v for k, v in api['environment'].items() if k in override['environment']}
            else:
                override = json.loads(text)['services']['cop-api']
            api['labels'] = {**api.get('labels', {}), **override['labels']}
            if 'volumes' in override: api['volumes'] += override['volumes']
            if 'group_add' in override: api['group_add'] = override['group_add']
        return value

    def image(self, image, baseline=False, revision=None):
        self.images.append((image, baseline, revision))

    def source_config(self):
        return self.config(Path('synthetic-source'), raw=True)

    def peers(self, directory):
        return {s: ('e' * 64 if s == 'cop-edge' else s + '-stable') for s in ('cop-web', 'cop-chat', 'cop-edge', 'cop-mcp')}

    def current(self, directory):
        return copy.deepcopy(self.live_container)  # docker inspect is a snapshot.

    def live(self, directory, binding, profile, require_label=True):
        # Exercise the real inspection checks against a fake immutable container.
        real = m.Docker()
        real.current = self.current; real.config = self.config; real.run = self.run
        real.account_erasure_scope = getattr(self, 'account_erasure_scope', None)
        real.live(directory, binding, profile, require_label)

    def non_profile(self, directory, profile, current=None):
        real = m.Docker(); real.current = self.current; real.config = self.config; real.run = self.run
        real.account_erasure_scope = getattr(self, 'account_erasure_scope', None)
        real.non_profile(directory, profile, current)

    def preserve(self, directory, profile, current):
        real = m.Docker(); real.current = self.current; real.config = self.config; real.run = self.run
        real.account_erasure_scope = getattr(self, 'account_erasure_scope', None)
        real.preserve(directory, profile, current)

    def unchanged(self, directory, witnessed):
        real = m.Docker(); real.current = self.current
        real.unchanged(directory, witnessed)

    def run(self, argv):
        if argv[:3] == ['docker', 'image', 'inspect']:
            return json.dumps([{'Config': self.image_configs.get(argv[3], {})}]).encode()
        if argv[:2] == ['docker', 'inspect'] and argv[2] == 'e' * 64:
            return json.dumps([{'Id': argv[2], 'State': {'Running': True}, 'Config': {
                'Labels': {'com.docker.compose.project': 'cop', 'com.docker.compose.service': 'cop-edge'},
                'Env': ['COP_EDGE_ADMIN_TOKEN=' + self.edge_token, 'COP_EDGE_NODE_ID=node_edge_pilot_01']}}]).encode()
        raise AssertionError('Unexpected fake command; never call real Docker')

    def erasure_edge_credential(self, directory, target):
        real = m.Docker(); real.peers = self.peers; real.run = self.run
        return real.erasure_edge_credential(directory, target)

    def up(self, directory, profile):
        self.up_calls.append(directory.name)
        self.container(self.config(directory, profile)['services']['cop-api'])
        if self.interrupt:
            self.interrupt = False
            raise KeyboardInterrupt('synthetic interrupted activation')

    def container(self, api, legacy=False):
        self.created += 1
        self.health_unobservable = False
        env = dict(api['environment'])
        if legacy:
            env.pop('COP_DATABASE_POOL_MODE', None); env.pop('COP_LEASE_DATABASE_URL', None)
        self.live_container = {'Id': CID if legacy else format(self.created, '064x'), 'Image': api['image'],
            'State': {'Running': True, 'Status': 'running'},
            'Config': {'Env': [key + '=' + value for key, value in env.items()], 'Labels': api.get('labels', {})},
            'NetworkSettings': {'Networks': {name: {'NetworkID': value} for name, value in m.NETWORKS.items()}},
            'HostConfig': {'GroupAdd': api.get('group_add', []), 'Mounts': [
                {'Type': v['type'], 'Target': v['target'], 'BindOptions': {
                    'CreateMountpoint': v.get('bind', {}).get('create_host_path', False)}} for v in api.get('volumes', [])]},
            'Mounts': [{'Type': v['type'], 'Source': v['source'], 'Destination': v['target'], 'RW': not v.get('read_only', False)}
                       for v in api.get('volumes', [])]}

    def health(self, action, path):
        self.health_calls.append((action, path))
        if self.health_unobservable:
            raise m.RuntimeError('synthetic_api_unobservable')
        if action == 'verify' and self.interrupt_health:
            self.interrupt_health = False
            raise KeyboardInterrupt('synthetic post-start interruption')
        if action == 'verify' and self.health_verify_failure:
            raise m.RuntimeError('synthetic_post_restore_verify_failed')
        if action == 'capture':
            return m.encoded(HEALTH)
        baseline = m.health_statuses(json.loads(path.read_bytes()))
        self.verified_baselines.append(baseline)
        return m.encoded({'healthAndPublicDemoPreserved': True, 'statuses': HEALTH})


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve(); self.source = self.home / 'cop'; self.source.mkdir()
        self.root = self.source / 'runtime-api'; self.root.mkdir(mode=0o700)
        self.protected = self.home / 'protected'; self.protected.mkdir(mode=0o750)
        for name in m.FILES: (self.source / name).write_text('# unresolved approved compose\n')
        (self.source / '.env').write_text('COP_DATABASE_URL=synthetic-direct-sentinel\n')
        self.docker = FakeDocker()
        self.store = m.Store(self.root, self.source, docker=self.docker, protected_root=self.protected,
            protected_uid=os.geteuid(), protected_gid=os.getegid(), mount_guard=lambda fingerprint: None)
        self.direct = self.profile('direct'); self.transaction = self.profile('transaction')

    def profile(self, mode):
        generation = str(uuid.uuid4()); directory = self.protected / generation; directory.mkdir(mode=0o750)
        values = {key: ('postgresql://fixture:literal$${preserved}@db.fixture.invalid:5432/cop'
                         if key == 'COP_DATABASE_URL' else '') for key in m.ENV}
        if mode == 'transaction':
            values['COP_DATABASE_URL'] = 'postgresql://fixture:literal$${preserved}@%2Frun%2Fvcode-cop-pgbouncer:6432/cop?sslmode=disable'
            values['COP_LEASE_DATABASE_URL'] = 'postgresql://fixture@db.fixture.invalid:5432/cop?sslmode=verify-full'
        raw = ''.join(m.ENV[key] + "='" + value + "'\n" for key, value in values.items()).encode()
        write(directory / 'runtime.env', raw, 0o640)
        return generation, contract(mode)

    def receipt(self, profile, image, baseline=False, revision=REV):
        generation, driver = profile
        value = {'contractVersion': 'cop-api-runtime-attestation-v1', 'application': 'cop', 'service': 'cop-api',
                 'profileGeneration': generation, 'imageId': image, 'sourceRevision': None if baseline else revision,
                 'kind': 'accepted-baseline' if baseline else 'candidate', 'ownerAcceptance': True,
                 'driverContract': driver, 'legacyContainerId': CID if baseline else None,
                 'legacyEnvPresence': {'COP_DATABASE_URL': True, 'COP_DATABASE_POOL_MODE': False,
                    'COP_LEASE_DATABASE_URL': False, 'COP_STREAM_BUS_DATABASE_URL': True} if baseline else None,
                 'checks': {'x5RuntimeGuard': not baseline, 'sharpConversion': not baseline,
                            'databaseRouting': not baseline, 'acceptedBaselineRollback': baseline}}
        path = self.protected / generation / ('attestation-' + image[7:] + '.json')
        write(path, value, 0o640); return path

    def baseline(self):
        receipt = self.receipt(self.direct, OLD, True)
        binding = self.store.prepare(OLD, None, receipt, 'absent', self.direct[0], baseline=True)
        directory, _, profile = self.store.binding(binding['releaseId'])
        api = self.docker.config(directory, profile['directory'])['services']['cop-api']
        api['labels'] = {}; self.docker.container(api, legacy=True)
        return self.store.activate(binding['releaseId'], 'absent', adopt=True)

    def candidate(self, current, image=NEW, profile=None):
        chosen = profile or (current['profileId'], self.store.active()[2]['driverContract'])
        receipt = self.receipt(chosen, image)
        return self.store.prepare(image, REV, receipt, current['generation'], None if profile is None else profile[0])

    def compatible_direct(self):
        original = self.baseline()
        binding = self.candidate(original)
        return self.store.activate(binding['releaseId'], original['generation'])

    def test_legacy_adoption_needs_no_recreate_and_keeps_source_unknown(self):
        current = self.baseline()
        self.assertEqual(self.docker.up_calls, [])
        self.assertIsNone(self.store.active()[2]['sourceRevision'])
        self.assertEqual(current['imageId'], OLD)
        self.assertEqual(self.docker.live_container['Id'], CID)

    def test_next_release_reuses_profile_but_binds_the_new_image(self):
        initial = self.compatible_direct()
        first = self.candidate(initial, profile=self.transaction)
        current = self.store.activate(first['releaseId'], initial['generation'])
        later = self.candidate(current, LATER)
        self.assertEqual(later['profileGeneration'], self.transaction[0])
        self.assertEqual(later['imageId'], LATER)
        self.assertNotEqual(later['releaseId'], first['releaseId'])
        self.store.activate(later['releaseId'], current['generation'])
        self.assertEqual(self.docker.live_container['Image'], LATER)
        self.assertEqual((self.source / '.env').read_text(), 'COP_DATABASE_URL=synthetic-direct-sentinel\n')
        for path in (self.root / 'releases').rglob('*'):
            if path.is_file(): self.assertNotIn('literal$${preserved}', path.read_text())

    def test_stale_cas_does_not_change_api(self):
        current = self.baseline(); binding = self.candidate(current, profile=self.transaction)
        with self.assertRaisesRegex(m.RuntimeError, 'active_pointer_changed'):
            self.store.activate(binding['releaseId'], '0' * 32)
        self.assertEqual(self.docker.up_calls, [])

    def test_interruption_blocks_deploy_and_whole_pair_can_roll_back(self):
        original = self.compatible_direct(); binding = self.candidate(original, profile=self.transaction)
        self.docker.interrupt = True
        with self.assertRaises(KeyboardInterrupt): self.store.activate(binding['releaseId'], original['generation'])
        self.assertEqual(self.store.pointer(), original)
        with self.assertRaisesRegex(m.RuntimeError, 'runtime_activation_pending'):
            self.store.active()
        restored = self.store.recover(original['generation'], rollback=True)
        self.assertEqual(restored['releaseId'], original['releaseId'])
        self.assertEqual(restored['profileGeneration'], self.direct[0])
        self.assertEqual(self.docker.live_container['Image'], NEW)
        self.assertNotIn(str(m.SOCKET), [v['Destination'] for v in self.docker.live_container['Mounts']])
        self.assertEqual(self.docker.live_container['HostConfig']['GroupAdd'], [])

    def test_interrupted_success_can_complete_without_second_recreate(self):
        original = self.compatible_direct(); binding = self.candidate(original, profile=self.transaction)
        self.docker.interrupt = True
        with self.assertRaises(KeyboardInterrupt): self.store.activate(binding['releaseId'], original['generation'])
        completed = self.store.recover(original['generation'])
        self.assertEqual(completed['imageId'], NEW)
        self.assertEqual(len(self.docker.up_calls), 2)

    def test_missing_profile_or_foreign_generation_stops_before_image(self):
        with self.assertRaises(OSError): self.store.profile(str(uuid.uuid4()), contract('direct'))
        with self.assertRaisesRegex(m.RuntimeError, 'profile_generation_invalid'):
            self.store.profile('../foreign', contract('direct'))
        self.assertEqual(self.docker.images, [])

    def test_root_attestation_unknown_fields_and_wrong_image_are_rejected(self):
        path = self.receipt(self.direct, NEW)
        value = json.loads(path.read_text()); value['secretEnvDigest'] = 'forbidden'
        write(path, value, 0o640)
        with self.assertRaisesRegex(m.RuntimeError, 'attestation_binding_mismatch'):
            self.store.prepare(NEW, REV, path, 'absent', self.direct[0])
        self.assertEqual(self.docker.images, [])

    def test_symlink_hardlink_and_writable_protected_env_are_rejected(self):
        path = self.protected / self.direct[0] / 'runtime.env'
        os.link(path, path.with_name('foreign-hardlink'))
        with self.assertRaisesRegex(m.RuntimeError, 'private_file_permissions'): self.store.profile(*self.direct)
        path.with_name('foreign-hardlink').unlink(); path.chmod(0o660)
        with self.assertRaisesRegex(m.RuntimeError, 'private_file_permissions'): self.store.profile(*self.direct)
        path.chmod(0o640); path.rename(path.with_name('actual-env')); path.symlink_to('actual-env')
        with self.assertRaisesRegex(m.RuntimeError, 'private_path_symlink'): self.store.profile(*self.direct)

    def test_unavailable_mount_and_unaccepted_receipt_stop(self):
        self.store.mount_guard = lambda fingerprint: (_ for _ in ()).throw(m.RuntimeError('missing_socket'))
        transaction_receipt = self.receipt(self.transaction, NEW)
        with self.assertRaisesRegex(m.RuntimeError, 'missing_socket'):
            self.store.prepare(NEW, REV, transaction_receipt, 'absent', self.transaction[0])
        path = self.receipt(self.direct, NEW); value = json.loads(path.read_text())
        value['checks']['sharpConversion'] = False; write(path, value, 0o640)
        with self.assertRaisesRegex(m.RuntimeError, 'compatibility_not_accepted'):
            self.store.prepare(NEW, REV, path, 'absent', self.direct[0])

    def test_only_api_changes_and_literal_dollar_survives_render(self):
        initial = self.baseline(); binding = self.candidate(initial, profile=self.transaction)
        directory, _, profile = self.store.binding(binding['releaseId'])
        base = self.docker.config(directory); desired = self.docker.config(directory, profile['directory'])
        m.verify_api_diff(base, desired, profile['values'], 'transaction', NEW)
        desired['services']['cop-api']['environment']['COP_DATABASE_URL'] = 'silently-interpolated'
        with self.assertRaisesRegex(m.RuntimeError, 'runtime_interpolation_mismatch'):
            m.verify_api_diff(base, desired, profile['values'], 'transaction', NEW)
        desired = self.docker.config(directory, profile['directory']); desired['services']['cop-web']['image'] = 'foreign'
        with self.assertRaisesRegex(m.RuntimeError, 'non_api_service_changed'):
            m.verify_api_diff(base, desired, profile['values'], 'transaction', NEW)

    def test_activation_cli_is_no_build_no_pull_api_only(self):
        args = []
        docker = m.Docker(self.source); docker.run = lambda argv: args.append(argv) or b''
        docker.up(self.root / 'release', self.protected / self.direct[0])
        self.assertEqual(args[0][-7:], ['up', '-d', '--no-build', '--pull', 'never', '--no-deps', 'cop-api'])
        self.assertNotIn('create', args[0]); self.assertNotIn('build', args[0])

    def test_target_runtime_drift_stops_before_up_even_when_two_new_renders_agree(self):
        original = self.compatible_direct()
        faults = ({'privileged': True}, {'read_only': True}, {'security_opt': ['no-new-privileges:true']},
                  {'mem_limit': 12345}, {'pids_limit': 100},
                  {'ports': [{'target': 4310, 'published': '54321'}]},
                  {'healthcheck': {'test': ['CMD', 'false']}}, {'command': ['foreign-command']},
                  {'extra_hosts': {'foreign.invalid': '127.0.0.1'}},
                  {'labels': {'foreign.label': 'foreign'}},
                  {'volumes': [{'type': 'bind', 'source': '/foreign', 'target': '/data/cop-media-conversions'}]})
        calls = len(self.docker.up_calls)
        for fault in faults:
            with self.subTest(field=next(iter(fault))):
                candidate = self.candidate(original, LATER)
                self.docker.release_overrides[candidate['releaseId']] = fault
                # config(base) and config(target) both include the fault, so the
                # inspected original runtime is the only effective drift gate.
                with self.assertRaises(m.RuntimeError): self.store.activate(candidate['releaseId'], original['generation'])
                self.assertEqual(len(self.docker.up_calls), calls)
                self.assertFalse((self.root / 'pending.json').exists())

    def test_actual_non_profile_env_and_resource_drift_stop_activation(self):
        original = self.compatible_direct(); candidate = self.candidate(original, profile=self.transaction)
        for mutation in ('environment', 'memory', 'port', 'security'):
            previous = copy.deepcopy(self.docker.live_container)
            if mutation == 'environment': self.docker.live_container['Config']['Env'].append('COP_WEB_BFF_SESSION_ENABLED=drift')
            if mutation == 'memory': self.docker.live_container['HostConfig']['Memory'] = 999
            if mutation == 'port': self.docker.live_container['HostConfig']['PortBindings'] = {'4310/tcp': [{'HostIp': '', 'HostPort': '12345'}]}
            if mutation == 'security': self.docker.live_container['HostConfig']['Privileged'] = True
            with self.subTest(mutation=mutation), self.assertRaises(m.RuntimeError):
                self.store.activate(candidate['releaseId'], original['generation'])
            self.docker.live_container = previous
        self.assertEqual(len(self.docker.up_calls), 1)

    def test_first_transaction_flip_requires_same_accepted_image(self):
        original = self.compatible_direct(); binding = self.candidate(original, LATER, self.transaction)
        with self.assertRaisesRegex(m.RuntimeError, 'route_change_requires_same_accepted_image'):
            self.store.activate(binding['releaseId'], original['generation'])
        self.assertEqual(len(self.docker.up_calls), 1)

    def test_recovery_foreign_instance_and_runtime_drift_cannot_be_overwritten(self):
        original = self.compatible_direct(); binding = self.candidate(original, profile=self.transaction)
        self.docker.interrupt_health = True
        with self.assertRaises(KeyboardInterrupt): self.store.activate(binding['releaseId'], original['generation'])
        owned = copy.deepcopy(self.docker.live_container)
        for field in ('cid', 'image', 'release', 'profile', 'environment', 'memory', 'port', 'security'):
            self.docker.live_container = copy.deepcopy(owned)
            if field == 'cid': self.docker.live_container['Id'] = 'f' * 64
            if field == 'image': self.docker.live_container['Image'] = LATER
            if field == 'release': self.docker.live_container['Config']['Labels']['com.cop.runtime.release'] = 'foreign'
            if field == 'profile': self.docker.live_container['Config']['Labels']['com.cop.runtime.profile-generation'] = str(uuid.uuid4())
            if field == 'environment': self.docker.live_container['Config']['Env'].append('COP_AUTH_MODE=foreign')
            if field == 'memory': self.docker.live_container['HostConfig']['Memory'] = 999
            if field == 'port': self.docker.live_container['HostConfig']['PortBindings'] = {'4310/tcp': [{'HostIp': '', 'HostPort': '1'}]}
            if field == 'security': self.docker.live_container['HostConfig']['SecurityOpt'] = ['foreign']
            with self.subTest(field=field), self.assertRaises(m.RuntimeError):
                self.store.recover(original['generation'], rollback=True)
            self.assertEqual(len(self.docker.up_calls), 2)
        self.docker.live_container = owned
        self.store.recover(original['generation'], rollback=True)
        self.assertEqual(len(self.docker.up_calls), 3)

    def test_legacy_rollback_preserves_absent_keys_and_updates_container_witness(self):
        original = self.baseline(); binding = self.candidate(original)
        self.docker.interrupt_health = True
        with self.assertRaises(KeyboardInterrupt): self.store.activate(binding['releaseId'], original['generation'])
        restored = self.store.recover(original['generation'], rollback=True)
        values = dict(item.split('=', 1) for item in self.docker.live_container['Config']['Env'])
        self.assertNotIn('COP_DATABASE_POOL_MODE', values); self.assertNotIn('COP_LEASE_DATABASE_URL', values)
        self.assertIn('COP_STREAM_BUS_DATABASE_URL', values)
        self.assertEqual(restored['imageId'], OLD); self.assertNotEqual(restored['containerId'], CID)
        self.store.active()
        candidate = self.candidate(restored)
        self.store.activate(candidate['releaseId'], restored['generation'])

    def test_interruption_after_pointer_publish_can_finish_without_second_up(self):
        original = self.compatible_direct(); binding = self.candidate(original, profile=self.transaction)
        real_finish = self.store.finish_pending
        self.store.finish_pending = lambda: (_ for _ in ()).throw(KeyboardInterrupt())
        with self.assertRaises(KeyboardInterrupt): self.store.activate(binding['releaseId'], original['generation'])
        published = self.store.pointer(); self.assertEqual(published['releaseId'], binding['releaseId'])
        self.store.finish_pending = real_finish
        result = self.store.recover(published['generation'])
        self.assertEqual(result['releaseId'], binding['releaseId']); self.assertEqual(len(self.docker.up_calls), 2)

    def test_docker_context_cannot_override_local_target(self):
        with mock.patch.dict(os.environ, {'DOCKER_CONTEXT': 'foreign'}, clear=True), mock.patch.object(m.subprocess, 'run') as run:
            with self.assertRaisesRegex(m.RuntimeError, 'foreign_docker_host'): m.Docker().run(['docker', 'info'])
            run.assert_not_called()
        with mock.patch.dict(os.environ, {'DOCKER_HOST': 'ssh://foreign.invalid'}, clear=True), mock.patch.object(m.subprocess, 'run') as run:
            with self.assertRaisesRegex(m.RuntimeError, 'foreign_docker_host'): m.Docker().run(['docker', 'info'])
            run.assert_not_called()
        with mock.patch.dict(os.environ, {'DOCKER_CONTEXT': 'default', 'DOCKER_TLS_VERIFY': '1'}, clear=True), mock.patch.object(m.subprocess, 'run') as run:
            run.return_value = mock.Mock(returncode=0, stdout=b'public', stderr=b'')
            self.assertEqual(m.Docker().run(['docker', 'image', 'inspect', NEW]), b'public')
            self.assertEqual(run.call_args.args[0][:3], ['docker', '--host', 'unix:///var/run/docker.sock'])
            self.assertNotIn('DOCKER_CONTEXT', run.call_args.kwargs['env'])
            self.assertNotIn('DOCKER_TLS_VERIFY', run.call_args.kwargs['env'])

    def test_metadata_mount_probe_is_pinned_offline_and_strict(self):
        docker = m.Docker(); commands = []
        response = {'contractVersion': 'cop-api-runtime-mount-probe-v1', 'socketDirectoryApproved': True,
                    'socketApproved': True, 'caApproved': True, 'caSha256': 'f' * 64}
        docker.run = lambda command: commands.append(command) or m.encoded(response)
        docker.mounts(NEW, 'f' * 64)
        command = commands[0]
        self.assertIn(NEW, command); self.assertIn('--mount', command); self.assertNotIn('-v', command)
        self.assertEqual(command[command.index('--network') + 1], 'none')
        self.assertEqual(command[command.index('--group-add') + 1], '982')
        self.assertNotIn('--env', command); self.assertNotIn('--env-file', command)
        self.assertIn('--read-only', command); self.assertIn('--cap-drop', command)
        self.assertNotIn('connect', command[-1]); self.assertNotIn('/app/', command[-1])
        for key, value in (('caApproved', False), ('socketApproved', 1), ('caSha256', '0' * 64), ('unknown', True)):
            with self.subTest(key=key):
                previous = dict(response); response[key] = value
                with self.assertRaisesRegex(m.RuntimeError, 'mount_probe_rejected'): docker.mounts(NEW, 'f' * 64)
                response = previous

    def test_current_includes_stopped_owned_candidate(self):
        docker = m.Docker(self.source); args = []
        docker.run = lambda command: args.append(command) or (b'[{}]' if command[:2] == ['docker', 'inspect'] else CID.encode())
        docker.current(self.root)
        self.assertEqual(args[0][-4:], ['ps', '--all', '-q', 'cop-api'])

    def test_approved_base_provenance_change_is_transition_only(self):
        self.compatible_direct()
        desired = copy.deepcopy(self.docker.base['services']['cop-api'])
        current = copy.deepcopy(self.docker.live_container)
        approved = {'Labels': {m.BASE_NAME_LABEL: m.APPROVED_BASE_NAME}}
        m.runtime_parity(current, desired, approved, transition=True)
        with self.assertRaisesRegex(m.RuntimeError, 'live_label_parity_mismatch'):
            m.runtime_parity(current, desired, approved)
        current['Config']['Labels'][m.BASE_NAME_LABEL] = m.APPROVED_BASE_NAME
        m.runtime_parity(current, desired, approved)
        m.runtime_parity(current, desired, {}, transition=True)
        with self.assertRaisesRegex(m.RuntimeError, 'live_label_parity_mismatch'):
            m.runtime_parity(current, desired, {})

    def test_other_base_provenance_drift_and_compose_override_stop(self):
        self.compatible_direct()
        desired = copy.deepcopy(self.docker.base['services']['cop-api'])
        current = copy.deepcopy(self.docker.live_container)
        foreign = 'node@sha256:' + 'f' * 64
        for actual, expected in ((None, foreign), (foreign, None), (foreign, m.APPROVED_BASE_NAME)):
            with self.subTest(actual=actual, expected=expected):
                current['Config']['Labels'].pop(m.BASE_NAME_LABEL, None)
                if actual is not None: current['Config']['Labels'][m.BASE_NAME_LABEL] = actual
                image_config = {'Labels': {m.BASE_NAME_LABEL: expected}} if expected is not None else {}
                with self.assertRaisesRegex(m.RuntimeError, 'live_label_parity_mismatch'):
                    m.runtime_parity(current, desired, image_config, transition=True)
        current['Config']['Labels'].pop(m.BASE_NAME_LABEL, None)
        desired['labels'] = {m.BASE_NAME_LABEL: m.APPROVED_BASE_NAME}
        with self.assertRaisesRegex(m.RuntimeError, 'live_label_parity_mismatch'):
            m.runtime_parity(current, desired, {}, transition=True)

    def test_wrapper_pins_daemon_before_its_direct_docker_actions(self):
        wrapper = (Path(__file__).parents[1] / 'deploy-production.sh').read_text()
        prefix = wrapper[wrapper.index('case "${DOCKER_HOST'):wrapper.index('python3 scripts/cop-storage.py preflight')]
        binary = self.home / 'bin'; binary.mkdir()
        fake = binary / 'docker'; fake.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n'); fake.chmod(0o700)
        environment = {'PATH': str(binary) + ':' + os.environ['PATH']}
        result = m.subprocess.run(['bash', '-c', prefix + '\ndocker image inspect synthetic-fixture'],
                                  capture_output=True, env=environment)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.decode().splitlines()[:2], ['--host', 'unix:///var/run/docker.sock'])
        result = m.subprocess.run(['bash', '-c', prefix + '\ndocker image inspect synthetic-fixture'],
                                  capture_output=True, env={**environment, 'DOCKER_CONTEXT': 'foreign'})
        self.assertNotEqual(result.returncode, 0); self.assertEqual(result.stdout, b'')

    def test_completed_pair_rollback_restores_accepted_legacy_without_global_fallback(self):
        original = self.baseline(); direct = self.candidate(original)
        current = self.store.activate(direct['releaseId'], original['generation'])
        transaction = self.candidate(current, profile=self.transaction)
        current = self.store.activate(transaction['releaseId'], current['generation'])
        restored = self.store.activate(original['releaseId'], current['generation'], rollback=True)
        self.assertEqual(restored['imageId'], OLD); self.assertEqual(restored['profileId'], self.direct[0])
        values = dict(item.split('=', 1) for item in self.docker.live_container['Config']['Env'])
        self.assertNotIn('COP_DATABASE_POOL_MODE', values); self.assertNotIn('COP_LEASE_DATABASE_URL', values)
        self.assertNotIn(str(m.SOCKET), [v['Destination'] for v in self.docker.live_container['Mounts']])

    def test_unaccepted_prepared_pair_is_not_a_rollback_target(self):
        current = self.compatible_direct()
        unaccepted = self.candidate(current, LATER)
        with self.assertRaisesRegex(m.RuntimeError, 'rollback_pair_not_previously_accepted'):
            self.store.activate(unaccepted['releaseId'], current['generation'], rollback=True)
        self.assertEqual(len(self.docker.up_calls), 1)

    def test_interrupted_rollback_health_can_finish_without_recreating_previous(self):
        original = self.compatible_direct(); candidate = self.candidate(original, profile=self.transaction)
        self.docker.interrupt_health = True
        with self.assertRaises(KeyboardInterrupt): self.store.activate(candidate['releaseId'], original['generation'])
        self.docker.interrupt_health = True
        with self.assertRaises(KeyboardInterrupt): self.store.recover(original['generation'], rollback=True)
        restored_id = self.docker.live_container['Id']; calls = len(self.docker.up_calls)
        result = self.store.recover(original['generation'], rollback=True)
        self.assertEqual(result['containerId'], restored_id); self.assertEqual(len(self.docker.up_calls), calls)

    def test_interrupted_rollback_cleanup_can_finish_after_pointer_publish(self):
        original = self.baseline(); candidate = self.candidate(original)
        self.docker.interrupt_health = True
        with self.assertRaises(KeyboardInterrupt): self.store.activate(candidate['releaseId'], original['generation'])
        real_finish = self.store.finish_pending
        self.store.finish_pending = lambda: (_ for _ in ()).throw(KeyboardInterrupt())
        with self.assertRaises(KeyboardInterrupt): self.store.recover(original['generation'], rollback=True)
        published = self.store.pointer(); calls = len(self.docker.up_calls)
        self.store.finish_pending = real_finish
        self.store.recover(published['generation'], rollback=True)
        self.assertEqual(len(self.docker.up_calls), calls)

    def test_invalid_inline_secret_is_rejected_before_writing_release_copy(self):
        raw_source = self.docker.source_config()
        raw_source['services']['cop-api']['environment']['COP_LAB_TOKEN'] = 'synthetic-forbidden-inline'
        self.docker.source_config = lambda: raw_source
        receipt = self.receipt(self.direct, NEW)
        with self.assertRaisesRegex(m.RuntimeError, 'inline_secret_in_compose'):
            self.store.prepare(NEW, REV, receipt, 'absent', self.direct[0])
        self.assertFalse((self.root / 'releases').exists())

    def test_empty_user_and_workdir_image_defaults_do_not_change_actual_identity(self):
        original = self.baseline()
        self.docker.live_container['Config'].update(User='', WorkingDir='')
        self.docker.image_configs[OLD] = {'User': None, 'WorkingDir': None, 'Labels': None}
        candidate = self.candidate(original)
        self.store.activate(candidate['releaseId'], original['generation'])

    def test_nondefault_container_user_is_not_normalized_to_root(self):
        original = self.baseline()
        self.docker.live_container['Config']['User'] = '1001'
        candidate = self.candidate(original)
        with self.assertRaisesRegex(m.RuntimeError, 'live_command_parity_mismatch'):
            self.store.activate(candidate['releaseId'], original['generation'])
        self.assertEqual(self.docker.up_calls, [])

    def test_target_bind_create_or_propagation_drift_stops_before_up(self):
        original = self.compatible_direct()
        for options in ({'create_host_path': True}, {'create_host_path': False, 'propagation': 'shared'}):
            candidate = self.candidate(original, LATER)
            mount = copy.deepcopy(self.docker.base['services']['cop-api']['volumes'][0]); mount['bind'] = options
            self.docker.release_overrides[candidate['releaseId']] = {'volumes': [mount]}
            with self.assertRaisesRegex(m.RuntimeError, 'live_bind_options_parity_mismatch'):
                self.store.activate(candidate['releaseId'], original['generation'])
        self.assertEqual(len(self.docker.up_calls), 1)

    def test_target_network_name_drift_stops_before_mutation(self):
        original = self.compatible_direct(); candidate = self.candidate(original, LATER)
        before = self.docker.config
        def altered(directory, profile=None, raw=False):
            result = before(directory, profile, raw)
            if directory.name == candidate['releaseId']:
                result['networks'][next(iter(m.NETWORKS))]['name'] = 'foreign-new-network'
            return result
        self.docker.config = altered
        with self.assertRaisesRegex(m.RuntimeError, 'target_network_scope_changed'):
            self.store.activate(candidate['releaseId'], original['generation'])
        self.assertEqual(len(self.docker.up_calls), 1); self.assertFalse((self.root / 'pending.json').exists())

    def unavailable_broker(self):
        probes = []
        def reject(fingerprint):
            probes.append(fingerprint)
            raise m.RuntimeError('synthetic_broker_unavailable')
        self.store.mount_guard = reject
        return probes

    def test_unavailable_broker_allows_completed_owned_direct_rollback(self):
        direct = self.compatible_direct(); target = self.candidate(direct, profile=self.transaction)
        current = self.store.activate(target['releaseId'], direct['generation'])
        probes = self.unavailable_broker()
        restored = self.store.activate(direct['releaseId'], current['generation'], rollback=True)
        self.assertEqual(probes, [])
        self.assertEqual(restored['releaseId'], direct['releaseId'])
        self.assertEqual(restored['imageId'], NEW); self.assertEqual(restored['profileId'], self.direct[0])
        self.assertNotIn(str(m.SOCKET), [v['Destination'] for v in self.docker.live_container['Mounts']])
        self.assertEqual(len(self.docker.up_calls), 3)

    def test_unavailable_broker_allows_pending_owned_direct_rollback(self):
        direct = self.compatible_direct(); target = self.candidate(direct, profile=self.transaction)
        self.docker.interrupt_health = True
        with self.assertRaises(KeyboardInterrupt): self.store.activate(target['releaseId'], direct['generation'])
        probes = self.unavailable_broker()
        restored = self.store.recover(direct['generation'], rollback=True)
        self.assertEqual(probes, [])
        self.assertEqual(restored['releaseId'], direct['releaseId'])
        self.assertFalse((self.root / 'pending.json').exists())
        self.assertEqual(len(self.docker.up_calls), 3)

    def assert_broken_source_keeps_foreign_actor_guards(self, restore):
        owned = copy.deepcopy(self.docker.live_container); calls = len(self.docker.up_calls)
        for field in ('cid', 'image', 'release', 'profile', 'environment', 'memory'):
            self.docker.live_container = copy.deepcopy(owned)
            if field == 'cid': self.docker.live_container['Id'] = 'f' * 64
            if field == 'image': self.docker.live_container['Image'] = LATER
            if field == 'release': self.docker.live_container['Config']['Labels']['com.cop.runtime.release'] = 'foreign'
            if field == 'profile': self.docker.live_container['Config']['Labels']['com.cop.runtime.profile-generation'] = str(uuid.uuid4())
            if field == 'environment': self.docker.live_container['Config']['Env'].append('COP_AUTH_MODE=foreign')
            if field == 'memory': self.docker.live_container['HostConfig']['Memory'] = 999
            with self.subTest(field=field), self.assertRaises(m.RuntimeError): restore()
            self.assertEqual(len(self.docker.up_calls), calls)
        self.docker.live_container = owned

    def test_broken_tx_completed_rollback_does_not_overwrite_foreign_actor(self):
        direct = self.compatible_direct(); target = self.candidate(direct, profile=self.transaction)
        current = self.store.activate(target['releaseId'], direct['generation'])
        probes = self.unavailable_broker()
        self.assert_broken_source_keeps_foreign_actor_guards(
            lambda: self.store.activate(direct['releaseId'], current['generation'], rollback=True))
        self.assertEqual(probes, [])

    def test_broken_tx_pending_rollback_does_not_overwrite_foreign_actor(self):
        direct = self.compatible_direct(); target = self.candidate(direct, profile=self.transaction)
        self.docker.interrupt_health = True
        with self.assertRaises(KeyboardInterrupt): self.store.activate(target['releaseId'], direct['generation'])
        probes = self.unavailable_broker()
        self.assert_broken_source_keeps_foreign_actor_guards(
            lambda: self.store.recover(direct['generation'], rollback=True))
        self.assertEqual(probes, [])

    def test_unavailable_tx_target_still_blocks_activation_and_completion(self):
        direct = self.compatible_direct(); target = self.candidate(direct, profile=self.transaction)
        probes = self.unavailable_broker()
        with self.assertRaisesRegex(m.RuntimeError, 'synthetic_broker_unavailable'):
            self.store.activate(target['releaseId'], direct['generation'])
        self.assertEqual(len(self.docker.up_calls), 1); self.assertEqual(len(probes), 1)
        self.store.mount_guard = lambda fingerprint: None
        self.docker.interrupt_health = True
        with self.assertRaises(KeyboardInterrupt): self.store.activate(target['releaseId'], direct['generation'])
        probes = self.unavailable_broker()
        with self.assertRaisesRegex(m.RuntimeError, 'synthetic_broker_unavailable'):
            self.store.recover(direct['generation'])
        self.assertEqual(len(self.docker.up_calls), 2); self.assertEqual(len(probes), 1)
        self.assertTrue((self.root / 'pending.json').exists())

    def test_broken_tx_rollback_still_requires_protected_source_integrity(self):
        direct = self.compatible_direct(); target = self.candidate(direct, profile=self.transaction)
        current = self.store.activate(target['releaseId'], direct['generation'])
        probes = self.unavailable_broker()
        profile_env = self.protected / self.transaction[0] / 'runtime.env'
        profile_env.chmod(0o660)
        with self.assertRaisesRegex(m.RuntimeError, 'private_file_permissions'):
            self.store.activate(direct['releaseId'], current['generation'], rollback=True)
        profile_env.chmod(0o640)
        attestation = Path(target['attestationPath']); original = attestation.read_bytes()
        write(attestation, original + b'\n', 0o640)
        with self.assertRaisesRegex(m.RuntimeError, 'attestation_changed'):
            self.store.activate(direct['releaseId'], current['generation'], rollback=True)
        self.assertEqual(probes, []); self.assertEqual(len(self.docker.up_calls), 2)

    def test_owned_direct_restore_completion_does_not_depend_on_failed_source_tx(self):
        direct = self.compatible_direct(); target = self.candidate(direct, profile=self.transaction)
        current = self.store.activate(target['releaseId'], direct['generation'])
        probes = self.unavailable_broker()
        self.docker.interrupt_health = True
        with self.assertRaises(KeyboardInterrupt):
            self.store.activate(direct['releaseId'], current['generation'], rollback=True)
        calls = len(self.docker.up_calls)
        completed = self.store.recover(current['generation'])
        self.assertEqual(completed['releaseId'], direct['releaseId'])
        self.assertEqual(probes, []); self.assertEqual(len(self.docker.up_calls), calls)
        self.assertFalse((self.root / 'pending.json').exists())

    def unobservable_api(self):
        self.docker.health_unobservable = True
        self.docker.live_container['State'] = {'Running': False, 'Status': 'exited'}

    def test_accepted_direct_health_witness_restores_unobservable_owned_api(self):
        direct = self.compatible_direct()
        directory, binding, _ = self.store.binding(direct['releaseId'])
        raw = (directory / 'accepted-health.json').read_bytes(); witness = json.loads(raw)
        self.assertEqual(binding['acceptedHealthSha256'], m.sha(raw))
        self.assertEqual(witness['containerId'], direct['containerId'])
        for key in ('releaseId', 'imageId', 'sourceRevision', 'profileId', 'profileGeneration'):
            self.assertEqual(witness[key], binding[key])
        self.assertEqual(witness['statuses'], HEALTH)
        self.assertEqual((directory / 'accepted-health.json').stat().st_mode & 0o777, 0o600)
        self.assertNotIn('literal$${preserved}', raw.decode())
        target = self.candidate(direct, profile=self.transaction)
        current = self.store.activate(target['releaseId'], direct['generation'])
        self.unobservable_api(); probes = self.unavailable_broker()
        before = len(self.docker.health_calls)
        restored = self.store.activate(direct['releaseId'], current['generation'], rollback=True)
        self.assertEqual(restored['releaseId'], direct['releaseId']); self.assertEqual(probes, [])
        self.assertEqual([action for action, _ in self.docker.health_calls[before:]], ['verify'])
        self.assertEqual(self.docker.verified_baselines[-1], witness['statuses'])
        self.assertEqual((directory / 'accepted-health.json').read_bytes(), raw)
        self.assertNotEqual(restored['containerId'], witness['containerId'])

    def test_health_witness_tamper_scope_and_permissions_stop_unobservable_restore(self):
        direct = self.compatible_direct(); directory, binding, _ = self.store.binding(direct['releaseId'])
        target = self.candidate(direct, profile=self.transaction)
        current = self.store.activate(target['releaseId'], direct['generation'])
        self.unobservable_api(); self.unavailable_broker()
        path = directory / 'accepted-health.json'; original = path.read_bytes()
        manifest_path = directory / 'release.json'; manifest = manifest_path.read_bytes()
        for mutation in ('bytes', 'scope', 'permissions'):
            write(path, original); write(manifest_path, manifest)
            if mutation == 'bytes': write(path, original + b'\n')
            if mutation == 'permissions': path.chmod(0o640)
            if mutation == 'scope':
                value = json.loads(original); value['profileGeneration'] = str(uuid.uuid4())
                altered = m.encoded(value); write(path, altered)
                changed = json.loads(manifest); changed['acceptedHealthSha256'] = m.sha(altered); write(manifest_path, changed)
            calls = len(self.docker.health_calls)
            with self.subTest(mutation=mutation), self.assertRaises(m.RuntimeError):
                self.store.activate(direct['releaseId'], current['generation'], rollback=True)
            self.assertEqual(len(self.docker.up_calls), 2); self.assertEqual(len(self.docker.health_calls), calls)

    def test_missing_health_witness_cannot_be_backfilled_from_unobservable_source(self):
        direct = self.compatible_direct(); directory, binding, _ = self.store.binding(direct['releaseId'])
        target = self.candidate(direct, profile=self.transaction)
        current = self.store.activate(target['releaseId'], direct['generation'])
        self.unobservable_api(); self.unavailable_broker()
        binding['acceptedHealthSha256'] = None; write(directory / 'release.json', binding)
        (directory / 'accepted-health.json').unlink()
        calls = len(self.docker.health_calls)
        with self.assertRaisesRegex(m.RuntimeError, 'accepted_health_witness_missing'):
            self.store.activate(direct['releaseId'], current['generation'], rollback=True)
        self.assertEqual(len(self.docker.up_calls), 2); self.assertEqual(len(self.docker.health_calls), calls)

    def test_unobservable_source_does_not_weaken_foreign_actor_guards(self):
        direct = self.compatible_direct(); target = self.candidate(direct, profile=self.transaction)
        current = self.store.activate(target['releaseId'], direct['generation'])
        self.unobservable_api(); self.unavailable_broker()
        calls = len(self.docker.health_calls)
        self.assert_broken_source_keeps_foreign_actor_guards(
            lambda: self.store.activate(direct['releaseId'], current['generation'], rollback=True))
        self.assertEqual(len(self.docker.health_calls), calls)

    def test_post_restore_verify_failure_keeps_pending_and_original_witness(self):
        direct = self.compatible_direct(); directory, _, _ = self.store.binding(direct['releaseId'])
        witness = (directory / 'accepted-health.json').read_bytes()
        target = self.candidate(direct, profile=self.transaction)
        current = self.store.activate(target['releaseId'], direct['generation'])
        self.unobservable_api(); self.unavailable_broker(); self.docker.health_verify_failure = True
        with self.assertRaisesRegex(m.RuntimeError, 'synthetic_post_restore_verify_failed'):
            self.store.activate(direct['releaseId'], current['generation'], rollback=True)
        self.assertEqual(self.store.pointer(), current)
        self.assertTrue((self.root / 'pending.json').exists())
        self.assertEqual((directory / 'accepted-health.json').read_bytes(), witness)

    def prepare_origin_adoption(self):
        receipt = self.receipt(self.direct, OLD, True)
        binding = self.store.prepare(OLD, None, receipt, 'absent', self.direct[0], baseline=True)
        directory, _, profile = self.store.binding(binding['releaseId'])
        api = self.docker.config(directory, profile['directory'])['services']['cop-api']
        api['labels'] = {}; self.docker.container(api, legacy=True)
        return directory, binding

    def test_legacy_adoption_cannot_invent_unobservable_health(self):
        directory, binding = self.prepare_origin_adoption(); self.unobservable_api()
        with self.assertRaisesRegex(m.RuntimeError, 'synthetic_api_unobservable'):
            self.store.activate(binding['releaseId'], 'absent', adopt=True)
        self.assertIsNone(self.store.pointer()); self.assertEqual(self.docker.up_calls, [])
        self.assertFalse((directory / 'accepted-health.json').exists())

    def test_legacy_adoption_health_witness_requires_same_post_verify_cid(self):
        directory, binding = self.prepare_origin_adoption(); original_health = self.docker.health
        def switched(action, path):
            result = original_health(action, path)
            if action == 'verify': self.docker.live_container['Id'] = 'f' * 64
            return result
        self.docker.health = switched
        with self.assertRaisesRegex(m.RuntimeError, 'api_runtime_changed_before_mutation'):
            self.store.activate(binding['releaseId'], 'absent', adopt=True)
        self.assertIsNone(self.store.pointer()); self.assertEqual(self.docker.up_calls, [])
        self.assertFalse((directory / 'accepted-health.json').exists())

    def test_interrupted_direct_restore_rejects_tampered_health_copy(self):
        direct = self.compatible_direct(); target = self.candidate(direct, profile=self.transaction)
        current = self.store.activate(target['releaseId'], direct['generation'])
        self.unobservable_api(); self.unavailable_broker(); self.docker.interrupt_health = True
        with self.assertRaises(KeyboardInterrupt):
            self.store.activate(direct['releaseId'], current['generation'], rollback=True)
        altered = copy.deepcopy(HEALTH); altered[m.HEALTH_URLS[1]]['status'] = 'degraded'
        write(self.root / 'pending-health.json', altered)
        calls = len(self.docker.health_calls)
        with self.assertRaisesRegex(m.RuntimeError, 'recovery_health_witness_changed'):
            self.store.recover(current['generation'])
        self.assertEqual(len(self.docker.up_calls), 3); self.assertEqual(len(self.docker.health_calls), calls)

    def test_raw_source_and_release_environment_lists_preserve_unresolved_values(self):
        raw = {'services': {'cop-api': {'environment': [
            'KEY=alpha=beta=$$${KEEP}', 'EXPRESSION=${VALUE:-a=b}', 'EMPTY=']},
            'cop-web': {'environment': {'MAP_VALUE': '${UNCHANGED}', 'EXISTING_MAP_NONE': None}}, 'cop-edge': {'image': 'fixture'}}}
        commands = []; docker = m.Docker(self.source)
        docker.run = lambda argv: commands.append(argv) or m.encoded(raw)
        with mock.patch.object(m, 'normalized_config', side_effect=AssertionError('Do not decode unresolved data')):
            for result in (docker.source_config(), docker.config(self.root, raw=True)):
                self.assertEqual(result['services']['cop-api']['environment'], {
                    'KEY': 'alpha=beta=$$${KEEP}', 'EXPRESSION': '${VALUE:-a=b}', 'EMPTY': ''})
                self.assertEqual(result['services']['cop-web']['environment'], {'MAP_VALUE': '${UNCHANGED}', 'EXISTING_MAP_NONE': None})
                self.assertNotIn('environment', result['services']['cop-edge'])
        self.assertTrue(all('--no-interpolate' in command and '--no-env-resolution' in command for command in commands))

    def test_malformed_or_duplicate_raw_environment_stops_before_release_writes(self):
        receipt = self.receipt(self.direct, OLD, True)
        for environment in (['KEY=x', 'KEY=y'], ['KEY'], ['KEY', 'KEY=x'], [None], [123],
                            ['=value'], ['BAD KEY=value'], 'KEY=value', {'KEY': True}):
            real = m.Docker(self.source)
            real.run = lambda argv: m.encoded({'services': {'cop-api': {'environment': environment}}})
            self.docker.source_config = real.source_config
            with self.subTest(environment_type=type(environment).__name__), self.assertRaisesRegex(m.RuntimeError, 'unresolved_environment_invalid'):
                self.store.prepare(OLD, None, receipt, 'absent', self.direct[0], baseline=True)
            self.assertFalse((self.root / 'releases').exists()); self.assertEqual(self.docker.up_calls, [])

    def test_legacy_prepare_and_adopt_accept_actual_raw_list_shape(self):
        literal = 'before=after=$$${UNCHANGED}'
        self.docker.base['services']['cop-api']['environment']['COP_PUBLIC_FIXTURE'] = literal
        raw = self.docker.source_config()
        environment = raw['services']['cop-api']['environment']
        raw['services']['cop-api']['environment'] = [key + '=' + item for key, item in environment.items()]
        real = m.Docker(self.source); real.run = lambda argv: m.encoded(raw)
        self.docker.source_config = real.source_config
        current = self.baseline()
        _, binding, _ = self.store.binding(current['releaseId'])
        self.assertEqual(binding['legacyEnvironment']['COP_PUBLIC_FIXTURE'], literal)
        self.assertNotIn('COP_DATABASE_POOL_MODE', binding['legacyEnvironment'])
        self.assertNotIn('COP_LEASE_DATABASE_URL', binding['legacyEnvironment'])
        self.assertEqual(self.docker.up_calls, []); self.assertEqual(current['containerId'], CID)

    def test_extra_host_delimiters_preserve_exact_pairs_and_reject_drift(self):
        current = {'Config': {}, 'HostConfig': {'ExtraHosts': ['api.fixture.invalid:host-gateway']}, 'Mounts': []}
        for expected in (['api.fixture.invalid=host-gateway'], ['api.fixture.invalid:host-gateway'],
                         {'api.fixture.invalid': 'host-gateway'}):
            m.runtime_parity(current, {'extra_hosts': expected}, {})
        self.assertEqual(m.host_pairs(['fixture=2001:db8::1']), m.host_pairs(['fixture:2001:db8::1']))
        for expected in (['api.fixture.invalid=127.0.0.2'], [],
                         ['api.fixture.invalid=host-gateway', 'other.fixture.invalid=host-gateway'],
                         ['api.fixture.invalid=host-gateway', 'api.fixture.invalid:host-gateway'],
                         ['api.fixture.invalid=host-gateway', 'api.fixture.invalid=127.0.0.2'],
                         ['bare'], ['=address'], ['name='], [None]):
            with self.subTest(shape=type(expected).__name__), self.assertRaises(m.RuntimeError):
                m.runtime_parity(current, {'extra_hosts': expected}, {})

    def test_null_command_and_entrypoint_use_only_exact_image_defaults(self):
        defaults = {'Cmd': ['fixture-command', '--unchanged'], 'Entrypoint': ['fixture-entrypoint']}
        current = {'Config': copy.deepcopy(defaults), 'HostConfig': {}, 'Mounts': []}
        m.runtime_parity(current, {'command': None, 'entrypoint': None}, defaults)
        m.runtime_parity(current, {}, defaults)
        for key in ('command', 'entrypoint'):
            for value in ([], '', ['changed-command']):
                with self.subTest(key=key, value=value), self.assertRaisesRegex(m.RuntimeError, 'live_command_parity_mismatch'):
                    m.runtime_parity(current, {key: value}, defaults)
        explicit_empty = {'Config': {'Cmd': [], 'Entrypoint': []}, 'HostConfig': {}, 'Mounts': []}
        m.runtime_parity(explicit_empty, {'command': [], 'entrypoint': []}, defaults)

    def test_legacy_adoption_accepts_proven_equivalent_host_and_image_default_serialization(self):
        defaults = {'Cmd': ['fixture-command', '--unchanged'], 'Entrypoint': ['fixture-entrypoint']}
        self.docker.image_configs[OLD] = defaults
        self.docker.base['services']['cop-api'].update(extra_hosts=['api.fixture.invalid=host-gateway'],
                                                     command=None, entrypoint=None)
        directory, binding = self.prepare_origin_adoption()
        self.docker.live_container['HostConfig']['ExtraHosts'] = ['api.fixture.invalid:host-gateway']
        self.docker.live_container['Config'].update(defaults)
        current = self.store.activate(binding['releaseId'], 'absent', adopt=True)
        self.assertEqual(current['containerId'], CID); self.assertEqual(self.docker.up_calls, [])
        self.assertEqual(self.docker.live_container['Config']['Cmd'], defaults['Cmd'])
        self.assertEqual(self.docker.live_container['Config']['Entrypoint'], defaults['Entrypoint'])



    def erasure_initial(self):
        self.docker.raw_variable_keys = set(m.ERASURE_CONFIG_KEYS) | {'COP_SIM_ERASURE_ACTOR_SECRET', 'COP_AI_CHAT_ROUTER_USER_ID_SECRET'}
        base = self.docker.base['services']['cop-api']['environment']
        base['COP_SIM_ERASURE_ACTOR_SECRET'] = 'synthetic-stable-actor-secret-' + 'a' * 32
        base['COP_AI_CHAT_ROUTER_USER_ID_SECRET'] = 'synthetic-stable-router-secret-' + 'b' * 32
        base['COP_MEDIA_S3_ACCESS_KEY_ID'] = 'synthetic-old-media'
        base['COP_MEDIA_S3_SECRET_ACCESS_KEY'] = 'synthetic-old-media-secret'
        current = self.compatible_direct()
        base.update({**m.ERASURE_FIXED, 'COP_ACCOUNT_ERASURE_ENABLED': 'false',
            'COP_ACCOUNT_ERASURE_SECRET': 'synthetic-new-erasure-secret-' + 'c' * 32,
            'COP_ACCOUNT_SAFETY_GUARD_DATABASE_URL': 'postgresql://synthetic.invalid/cop_account_safety_guard',
            'COP_ACCOUNT_SAFETY_GUARD_STORE_ID': str(uuid.uuid4()),
            'COP_ACCOUNT_SAFETY_INCARNATION_ID': str(uuid.uuid4()),
            'COP_ACCOUNT_SAFETY_STORE_ID': str(uuid.uuid4()),
            'COP_KEYCLOAK_ERASURE_CLIENT_SECRET': 'synthetic-new-keycloak-secret-' + 'd' * 32,
            'COP_SIM_ERASURE_ROUTER_TOKEN': 'synthetic-new-router-token-' + 'e' * 32,
            'COP_SIM_ERASURE_DRIVER_TOKEN': 'synthetic-new-driver-token-' + 'f' * 32,
            'COP_SIM_ERASURE_ROUTER_URL': 'http://synthetic-router.invalid/account-erasure',
            'COP_SIM_ERASURE_DRIVER_URL': 'http://synthetic-driver.invalid/account-erasure',
            'COP_LIVEKIT_ADMIN_URL': '', 'COP_LIVEKIT_ERASURE_RELAY_URL': 'https://synthetic-messaging.invalid/erasure',
            'COP_MEDIA_S3_ACCESS_KEY_ID': 'synthetic-new-media',
            'COP_MEDIA_S3_SECRET_ACCESS_KEY': 'synthetic-new-media-secret',
            'COP_EDGE_ADMIN_TOKEN': self.docker.edge_token})
        (self.source / '.env').write_text('SYNTHETIC_CONFIG=prepared-only-no-production-data\n')
        (self.source / '.env').chmod(0o600)
        return current

    def erasure_proof(self, current, operation='prepare', image=LATER):
        directory, _, profile = self.store.binding(current['releaseId'])
        target = self.docker.config(directory, profile['directory'])['services']['cop-api']['environment']
        actual = dict(item.split('=', 1) for item in self.docker.live_container['Config']['Env'])
        changed = sorted(k for k in set(actual) | set(target)
                         if (k in actual) != (k in target) or actual.get(k) != target.get(k))
        transition = str(uuid.uuid4())
        value = {'contractVersion': 'cop-api-account-erasure-config-v1', 'transitionId': transition,
            'operation': operation, 'previous': current,
            'target': {'imageId': image, 'sourceRevision': REV, 'profileGeneration': current['profileGeneration']},
            'changedKeys': changed, 'environmentMetadata': m.environment_metadata(self.source / '.env', os.geteuid()),
            'composeHashes': {name: m.sha((self.source / name).read_bytes()) for name in m.FILES},
            'ownerAcceptance': True, 'checks': {name: True for name in m.ERASURE_PROOF_CHECKS}}
        path = self.protected / current['profileGeneration'] / ('account-erasure-' + transition + '.json')
        write(path, value, 0o640)
        return path, value

    def erasure_candidate(self, current, path, image=LATER):
        profile = (current['profileGeneration'], self.store.active()[2]['driverContract'])
        return self.store.prepare(image, REV, self.receipt(profile, image), current['generation'], erasure_config=path)

    def test_erasure_root_reviewed_prepare_preserves_profile_and_other_services(self):
        current = self.erasure_initial(); path, proof = self.erasure_proof(current)
        binding = self.erasure_candidate(current, path)
        accepted = self.store.activate(binding['releaseId'], current['generation'])
        self.assertEqual(accepted['profileId'], current['profileId'])
        env = dict(item.split('=', 1) for item in self.docker.live_container['Config']['Env'])
        self.assertEqual(env['COP_ACCOUNT_ERASURE_ENABLED'], 'false')
        self.assertEqual(env['COP_ACCOUNT_SAFETY_GUARD_REQUIRED'], 'true')
        self.assertEqual(self.store.active()[2]['accountErasureConfig']['sha256'], m.sha(path.read_bytes()))
        for file in (self.root / 'releases').rglob('*'):
            if file.is_file():
                self.assertNotIn('synthetic-new-erasure-secret-', file.read_text())
                self.assertNotIn('synthetic-new-keycloak-secret-', file.read_text())
        self.assertNotIn('COP_SIM_ERASURE_ACTOR_SECRET', proof['changedKeys'])

    def test_erasure_config_cannot_be_activated_as_ordinary_image_swap(self):
        current = self.erasure_initial()
        binding = self.candidate(current, LATER)
        count = len(self.docker.up_calls)
        with self.assertRaisesRegex(m.RuntimeError, 'non_profile_environment_drift'):
            self.store.activate(binding['releaseId'], current['generation'])
        self.assertEqual(len(self.docker.up_calls), count)

    def test_erasure_enable_pause_and_maintain_require_fresh_exact_root_review(self):
        current = self.erasure_initial(); path, _ = self.erasure_proof(current)
        binding = self.erasure_candidate(current, path)
        current = self.store.activate(binding['releaseId'], current['generation'])
        with self.assertRaisesRegex(m.RuntimeError, 'guarded_release_requires_root_config_review'):
            self.candidate(current, 'sha256:' + '4' * 64)
        for operation, enabled in [('enable', 'true'), ('pause', 'false'), ('maintain', 'false')]:
            self.docker.base['services']['cop-api']['environment']['COP_ACCOUNT_ERASURE_ENABLED'] = enabled
            (self.source / '.env').write_text('SYNTHETIC_CONFIG=' + operation + '\n')
            path, proof = self.erasure_proof(current, operation)
            self.assertEqual(proof['changedKeys'], [] if operation == 'maintain' else ['COP_ACCOUNT_ERASURE_ENABLED'])
            binding = self.erasure_candidate(current, path)
            current = self.store.activate(binding['releaseId'], current['generation'])
        with self.assertRaisesRegex(m.RuntimeError, 'guarded_rollback_requires_intake_pause'):
            self.store.activate(binding['previousReleaseId'], current['generation'], rollback=True)

    def test_erasure_authentication_or_existing_actor_identity_change_is_never_allowed(self):
        for forbidden in ['COP_AUTH_MODE', 'COP_SIM_ERASURE_ACTOR_SECRET', 'COP_AI_CHAT_ROUTER_USER_ID_SECRET']:
            with self.subTest(forbidden=forbidden):
                current = self.erasure_initial()
                self.docker.base['services']['cop-api']['environment'][forbidden] = 'synthetic-unapproved-change'
                path, value = self.erasure_proof(current)
                with self.assertRaisesRegex(m.RuntimeError, 'erasure_proof_keys'):
                    self.erasure_candidate(current, path)
                self.setUp()

    def test_erasure_unlisted_historical_configuration_drift_is_rejected(self):
        current = self.erasure_initial(); path, _ = self.erasure_proof(current)
        self.docker.base['services']['cop-api']['environment']['COP_AUTH_MODE'] = 'lab'
        binding = self.erasure_candidate(current, path)
        with self.assertRaisesRegex(m.RuntimeError, 'erasure_configuration_delta_mismatch'):
            self.store.activate(binding['releaseId'], current['generation'])

    def test_erasure_manifest_cannot_expand_allowlist_or_skip_owner_acceptance(self):
        current = self.erasure_initial(); path, value = self.erasure_proof(current)
        value['changedKeys'].append('COP_DATABASE_URL'); value['changedKeys'].sort(); write(path, value, 0o640)
        with self.assertRaisesRegex(m.RuntimeError, 'erasure_proof_keys'):
            self.erasure_candidate(current, path)
        value['changedKeys'].remove('COP_DATABASE_URL'); value['checks']['providerClosureVerified'] = False; write(path, value, 0o640)
        with self.assertRaisesRegex(m.RuntimeError, 'erasure_proof_acceptance_missing'):
            self.erasure_candidate(current, path)

    def test_erasure_root_review_is_bound_to_exact_container_image_source_and_profile(self):
        current = self.erasure_initial(); path, value = self.erasure_proof(current)
        for field, replacement in [('imageId', NEW), ('sourceRevision', 'c' * 40), ('profileGeneration', self.transaction[0])]:
            wrong = copy.deepcopy(value); wrong['target'][field] = replacement; write(path, wrong, 0o640)
            with self.subTest(field=field), self.assertRaisesRegex(m.RuntimeError, 'erasure_proof_target'):
                self.erasure_candidate(current, path)
        value['previous']['containerId'] = '0' * 64; write(path, value, 0o640)
        with self.assertRaisesRegex(m.RuntimeError, 'erasure_previous_cas_changed'):
            self.erasure_candidate(current, path)

    def test_erasure_env_metadata_change_stops_before_recreation(self):
        current = self.erasure_initial(); path, _ = self.erasure_proof(current)
        binding = self.erasure_candidate(current, path); count = len(self.docker.up_calls)
        (self.source / '.env').write_text('SYNTHETIC_CONFIG=changed-after-root-review\n')
        with self.assertRaisesRegex(m.RuntimeError, 'erasure_env_cas_changed'):
            self.store.activate(binding['releaseId'], current['generation'])
        self.assertEqual(len(self.docker.up_calls), count)

    def test_erasure_compose_change_requires_new_root_review(self):
        current = self.erasure_initial(); path, _ = self.erasure_proof(current)
        (self.source / m.FILES[0]).write_text('# changed after Root review\n')
        with self.assertRaisesRegex(m.RuntimeError, 'erasure_proof_compose_changed'):
            self.erasure_candidate(current, path)

    def test_erasure_shell_cannot_override_root_reviewed_secrets_file(self):
        current = self.erasure_initial(); path, _ = self.erasure_proof(current)
        with mock.patch.dict(os.environ, {'COP_ACCOUNT_ERASURE_ENABLED': 'true'}):
            with self.assertRaisesRegex(m.RuntimeError, 'erasure_shell_override_forbidden'):
                self.erasure_candidate(current, path)

    def test_erasure_proof_tampering_and_non_root_file_mode_stop_before_recreation(self):
        current = self.erasure_initial(); path, value = self.erasure_proof(current)
        path.chmod(0o600)
        with self.assertRaisesRegex(m.RuntimeError, 'private_file_permissions'):
            self.erasure_candidate(current, path)
        write(path, value, 0o640); binding = self.erasure_candidate(current, path)
        value['operation'] = 'enable'; write(path, value, 0o640)
        with self.assertRaisesRegex(m.RuntimeError, 'erasure_proof_changed'):
            self.store.activate(binding['releaseId'], current['generation'])

    def test_erasure_missing_credential_or_unsafe_fixed_mode_fails_closed(self):
        current = self.erasure_initial(); base = self.docker.base['services']['cop-api']['environment']
        base['COP_SIM_ERASURE_ROUTER_TOKEN'] = ''; path, _ = self.erasure_proof(current)
        binding = self.erasure_candidate(current, path)
        with self.assertRaisesRegex(m.RuntimeError, 'erasure_target_credential_missing'):
            self.store.activate(binding['releaseId'], current['generation'])
        base['COP_SIM_ERASURE_ROUTER_TOKEN'] = 'synthetic-router-token-' + 'e' * 32
        base['COP_ACCOUNT_SAFETY_GUARD_REQUIRED'] = 'false'; path, _ = self.erasure_proof(current)
        binding = self.erasure_candidate(current, path)
        with self.assertRaisesRegex(m.RuntimeError, 'erasure_target_fixed_config'):
            self.store.activate(binding['releaseId'], current['generation'])

    def test_erasure_network_or_mount_change_is_not_a_configuration_permission(self):
        current = self.erasure_initial(); path, _ = self.erasure_proof(current)
        binding = self.erasure_candidate(current, path)
        self.docker.release_overrides[binding['releaseId']] = {'volumes': [
            {'type': 'bind', 'source': '/synthetic/foreign', 'target': '/foreign'}]}
        with self.assertRaisesRegex(m.RuntimeError, 'live_mount_parity_mismatch'):
            self.store.activate(binding['releaseId'], current['generation'])

    def test_erasure_interrupted_target_recovers_once_without_legacy_rollback(self):
        current = self.erasure_initial(); path, _ = self.erasure_proof(current)
        binding = self.erasure_candidate(current, path); self.docker.interrupt = True
        with self.assertRaises(KeyboardInterrupt): self.store.activate(binding['releaseId'], current['generation'])
        count = len(self.docker.up_calls)
        with self.assertRaisesRegex(m.RuntimeError, 'guarded_rollback_requires_intake_pause'):
            self.store.recover(current['generation'], rollback=True)
        accepted = self.store.recover(current['generation'])
        self.assertEqual(accepted['releaseId'], binding['releaseId'])
        self.assertEqual(len(self.docker.up_calls), count)
        self.assertFalse((self.root / 'pending.json').exists())

    def test_erasure_env_change_during_acceptance_never_publishes_new_active_pointer(self):
        current = self.erasure_initial(); path, _ = self.erasure_proof(current)
        binding = self.erasure_candidate(current, path); health = self.docker.health
        def changed(action, file):
            result = health(action, file)
            if action == 'verify': (self.source / '.env').write_text('SYNTHETIC_CONFIG=changed-during-acceptance\n')
            return result
        self.docker.health = changed
        with self.assertRaisesRegex(m.RuntimeError, 'erasure_env_cas_changed'):
            self.store.activate(binding['releaseId'], current['generation'])
        self.assertEqual(self.store.pointer(), current)
        self.assertTrue((self.root / 'pending.json').exists())


    def test_erasure_edge_forwarding_cannot_rotate_the_existing_peer_credential(self):
        current = self.erasure_initial()
        self.docker.base['services']['cop-api']['environment']['COP_EDGE_ADMIN_TOKEN'] = 'synthetic-wrong-edge-token-' + '8' * 32
        path, _ = self.erasure_proof(current); binding = self.erasure_candidate(current, path)
        count = len(self.docker.up_calls)
        with self.assertRaisesRegex(m.RuntimeError, 'erasure_existing_edge_credential_changed'):
            self.store.activate(binding['releaseId'], current['generation'])
        self.assertEqual(len(self.docker.up_calls), count)

    def test_erasure_edge_origin_and_node_are_fixed_not_caller_selected(self):
        for key, value in [('COP_ACCOUNT_ERASURE_EDGE_URL', 'https://foreign.invalid'), ('COP_EDGE_NODE_ID', 'another-node')]:
            current = self.erasure_initial(); self.docker.base['services']['cop-api']['environment'][key] = value
            path, _ = self.erasure_proof(current); binding = self.erasure_candidate(current, path)
            with self.assertRaisesRegex(m.RuntimeError, 'erasure_target_fixed_config'):
                self.store.activate(binding['releaseId'], current['generation'])
            self.setUp()

    def test_erasure_pause_does_not_require_a_fresh_edge_probe_when_provider_is_down(self):
        current = self.erasure_initial(); path, _ = self.erasure_proof(current)
        binding = self.erasure_candidate(current, path); current = self.store.activate(binding['releaseId'], current['generation'])
        self.docker.base['services']['cop-api']['environment']['COP_ACCOUNT_ERASURE_ENABLED'] = 'true'
        path, _ = self.erasure_proof(current, 'enable'); binding = self.erasure_candidate(current, path)
        current = self.store.activate(binding['releaseId'], current['generation'])
        self.docker.erasure_edge_credential = lambda *_: (_ for _ in ()).throw(AssertionError('No probe needed for unchanged credential'))
        self.docker.base['services']['cop-api']['environment']['COP_ACCOUNT_ERASURE_ENABLED'] = 'false'
        path, _ = self.erasure_proof(current, 'pause'); binding = self.erasure_candidate(current, path)
        self.assertEqual(self.store.activate(binding['releaseId'], current['generation'])['releaseId'], binding['releaseId'])


    def test_erasure_prepare_pins_the_same_edge_peer_until_api_activation(self):
        current = self.erasure_initial(); path, _ = self.erasure_proof(current)
        binding = self.erasure_candidate(current, path); original = self.docker.erasure_edge_credential
        peers = self.docker.peers
        def replaced(directory, target):
            edge_id = original(directory, target)
            self.docker.peers = lambda selected: {**peers(selected), 'cop-edge': 'f' * 64}
            return edge_id
        self.docker.erasure_edge_credential = replaced
        count = len(self.docker.up_calls)
        with self.assertRaisesRegex(m.RuntimeError, 'erasure_edge_peer_changed'):
            self.store.activate(binding['releaseId'], current['generation'])
        self.assertEqual(len(self.docker.up_calls), count)

    def clean_erasure_proof(self, current):
        self.docker.raw_variable_keys |= m.CLEAN_ERASURE_CONFIG_KEYS
        reset = {'resetEpoch': str(uuid.uuid4()), 'tokensNotBefore': 1792195200, 'receiptSha256': '9' * 64}
        self.docker.base['services']['cop-api']['environment'].update({
            'COP_ACCOUNT_ERASURE_SCOPE': 'cop_sim_shared_identity_v1',
            'COP_KEYCLOAK_SHARED_IDENTITY_DELETE_ACCEPTED': 'true',
            'COP_USER_RESET_EPOCH': reset['resetEpoch'],
            'COP_USER_RESET_TOKENS_NOT_BEFORE': str(reset['tokensNotBefore']),
            'COP_SIM_USER_DATA_ERASURE_URL': 'http://sim-main.synthetic.invalid:4310',
            'COP_SIM_USER_DATA_ERASURE_TOKEN': 'synthetic-app-service-token-' + 'x' * 32,
            'COP_SIM_USER_DATA_ERASURE_ACTOR_SECRET': 'synthetic-app-actor-secret-' + 'y' * 32})
        path, proof = self.erasure_proof(current)
        proof.update(contractVersion=m.CLEAN_ERASURE_PROOF_VERSION, cleanReset=reset,
                     checks={key: True for key in m.CLEAN_ERASURE_PROOF_CHECKS})
        write(path, proof, 0o640)
        return path, proof

    def test_clean_reset_requires_separate_root_proof_and_preserves_the_runtime_profile(self):
        current = self.erasure_initial(); path, proof = self.clean_erasure_proof(current)
        before = len(self.docker.up_calls)
        candidate = self.erasure_candidate(current, path)
        accepted = self.store.activate(candidate['releaseId'], current['generation'])
        env = dict(item.split('=', 1) for item in self.docker.live_container['Config']['Env'])
        self.assertEqual(accepted['profileId'], current['profileId'])
        self.assertEqual(env['COP_ACCOUNT_ERASURE_SCOPE'], 'cop_sim_shared_identity_v1')
        self.assertEqual(env['COP_ACCOUNT_ERASURE_ENABLED'], 'false')
        self.assertEqual(env['COP_USER_RESET_EPOCH'], proof['cleanReset']['resetEpoch'])

    def test_clean_reset_cannot_activate_without_sim_application_erasure_credentials(self):
        current = self.erasure_initial()
        for key in ('COP_SIM_USER_DATA_ERASURE_TOKEN', 'COP_SIM_USER_DATA_ERASURE_ACTOR_SECRET', 'COP_SIM_USER_DATA_ERASURE_URL'):
            path, proof = self.clean_erasure_proof(current)
            self.docker.base['services']['cop-api']['environment'][key] = ''
            # Bind the actual intended delta, then exercise the production target validator.
            proof['changedKeys'] = sorted(set(proof['changedKeys']) | {key}); write(path, proof, 0o640)
            count = len(self.docker.up_calls)
            with self.assertRaises(m.RuntimeError):
                candidate = self.erasure_candidate(current, path)
                self.store.activate(candidate['releaseId'], current['generation'])
            self.assertEqual(len(self.docker.up_calls), count)

    def test_old_identity_preserving_proof_cannot_authorize_clean_reset_flags(self):
        current = self.erasure_initial(); path, proof = self.clean_erasure_proof(current)
        before = len(self.docker.up_calls)
        proof.pop('cleanReset'); proof['contractVersion'] = 'cop-api-account-erasure-config-v1'
        proof['checks'] = {key: True for key in m.ERASURE_PROOF_CHECKS}; write(path, proof, 0o640)
        with self.assertRaisesRegex(m.RuntimeError, 'erasure_proof_keys'):
            self.erasure_candidate(current, path)
        self.assertEqual(len(self.docker.up_calls), before)

    def test_clean_reset_epoch_must_match_the_exact_root_confirmed_receipt(self):
        current = self.erasure_initial(); path, proof = self.clean_erasure_proof(current)
        before = len(self.docker.up_calls)
        proof['cleanReset']['resetEpoch'] = str(uuid.uuid4()); write(path, proof, 0o640)
        candidate = self.erasure_candidate(current, path)
        with self.assertRaisesRegex(m.RuntimeError, 'clean_erasure_target_binding'):
            self.store.activate(candidate['releaseId'], current['generation'])
        self.assertEqual(len(self.docker.up_calls), before)

    def test_clean_reset_still_rejects_missing_joint_acceptance_and_actor_key_rotation(self):
        current = self.erasure_initial(); path, proof = self.clean_erasure_proof(current)
        before = len(self.docker.up_calls)
        proof['checks']['jointSyntheticAcceptance'] = False; write(path, proof, 0o640)
        with self.assertRaisesRegex(m.RuntimeError, 'erasure_proof_acceptance_missing'):
            self.erasure_candidate(current, path)
        proof['checks']['jointSyntheticAcceptance'] = True
        proof['changedKeys'] = sorted(proof['changedKeys'] + ['COP_SIM_ERASURE_ACTOR_SECRET']); write(path, proof, 0o640)
        with self.assertRaisesRegex(m.RuntimeError, 'erasure_proof_keys'):
            self.erasure_candidate(current, path)
        self.assertEqual(len(self.docker.up_calls), before)

if __name__ == '__main__': unittest.main()
