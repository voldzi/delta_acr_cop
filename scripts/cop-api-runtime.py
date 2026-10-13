#!/usr/bin/env python3
"""Fixed COP API image/profile bindings. Never prints resolved config or secrets."""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import uuid

sys.dont_write_bytecode = True
SOURCE = Path('/srv/cop')
ROOT = SOURCE / 'runtime/api'
PROFILES = Path('/etc/vcode-cop-api-runtime')
FILES = ('docker-compose.yml', 'docker-compose.driver-measurements.yml',
         'docker-compose.x5.yml', 'docker-compose.ai-router.yml')
NETWORKS = {
    'cop_default': 'c0718b9d5b24d006c5b16bc74e2582032ac1b9e1c632a0fcfc31d767b4df9b91',
    'cop_sim_ai_router_internal': '58b669ceb047fa6dd127bb189dc1ce5fba49cd6bdc39db8bff055546534171e9',
    'cop_sim_driver_measurements_internal': 'b0dba318afe538b7abd8593623611f393dfdbf0c3c8923598176625e3ff3f946'}
SOCKET = Path('/run/vcode-cop-pgbouncer')
CA = Path('/etc/vcode-cop-pgbouncer/postgres-ca.crt')
BASE_NAME_LABEL = 'org.opencontainers.image.base.name'
APPROVED_BASE_NAME = 'node@sha256:83f1c388c31fb2e51f7cbd4dea949b96260798c98f206e8e4696bc93bd964e3a'
ENV = {name: 'COP_API_RUNTIME_' + name.removeprefix('COP_') for name in (
    'COP_DATABASE_URL', 'COP_LEASE_DATABASE_URL',
    'COP_STREAM_BUS_DATABASE_URL')}
ID = re.compile(r'[a-z0-9][a-z0-9-]{0,63}')
IMAGE = re.compile(r'sha256:[0-9a-f]{64}')
REVISION = re.compile(r'[0-9a-f]{40}')
GENERATION = re.compile(r'[0-9a-f]{32}')
PROFILE_UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
MODE_ENV = 'COP_API_RUNTIME_DATABASE_POOL_MODE'
HEALTH_URLS = ('http://127.0.0.1:4310/health/live', 'http://127.0.0.1:4310/health/ready',
               'http://127.0.0.1:4310/health/dependencies',
               'https://cop.zeleznalady.cz/demo/flood-central-bohemia')
HEALTH_STATES = {'ok', 'online', 'degraded', 'unavailable', 'offline', 'disabled', 'skipped'}


class RuntimeError(Exception):
    pass


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def private_read(path, uid, limit=65536, mode=0o600, gid=None):
    """Owner-private regular files only; no symlink at any component."""
    require(not any(p.is_symlink() for p in (path, *path.parents)), 'private_path_symlink')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == uid
                and stat.S_IMODE(info.st_mode) == mode and info.st_nlink == 1
                and (gid is None or info.st_gid == gid), 'private_file_permissions')
        raw = os.read(fd, limit + 1)
        require(len(raw) <= limit, 'private_file_too_large')
        return raw
    finally:
        os.close(fd)


def private_json(path, uid):
    try:
        return json.loads(private_read(path, uid))
    except (ValueError, UnicodeError):
        raise RuntimeError('private_json_invalid') from None


def env_values(raw):
    # Compose single quotes preserve literal $ and ${...}; never source this file.
    values = {}
    for line in raw.decode().splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        match = re.fullmatch(r"(COP_API_RUNTIME_[A-Z_]+)='([^'\r\n]*)'", line)
        require(match is not None, 'runtime_env_syntax')
        key, value = match.groups()
        require(key in ENV.values() and key not in values, 'runtime_env_scope')
        values[key] = value
    require(set(values) == set(ENV.values()), 'runtime_env_incomplete')
    return {name: values[key] for name, key in ENV.items()}


def driver_contract(value):
    keys = {'poolMode', 'streamMode', 'mainEnvAndMigrations', 'frontend', 'socketPath',
            'socketPort', 'supplementaryGid', 'caPath', 'caSha256', 'leasePath',
            'backendBudget', 'clientBudget'}
    require(isinstance(value, dict) and set(value) == keys
            and value['poolMode'] in {'direct', 'session', 'transaction'}
            and value['streamMode'] == 'memory' and value['mainEnvAndMigrations'] == 'direct',
            'driver_contract_invalid')
    if value['poolMode'] == 'transaction':
        require(value['frontend'] == 'unix' and value['socketPath'] == str(SOCKET)
                and value['socketPort'] == 6432 and value['supplementaryGid'] == 982
                and value['caPath'] == str(CA) and re.fullmatch(r'[0-9a-f]{64}', value['caSha256'])
                and value['leasePath'] == 'direct_verify_full'
                and value['backendBudget'] == 10 and value['clientBudget'] == 80,
                'transaction_contract_invalid')
    else:
        require(value['frontend'] == value['poolMode'] and value['leasePath'] == 'direct'
                and all(value[key] is None for key in ('socketPath', 'socketPort', 'supplementaryGid',
                    'caPath', 'caSha256', 'backendBudget', 'clientBudget')), 'direct_contract_invalid')
    return value


def unresolved_config(value):
    """Normalize raw Compose environment shapes without interpolation/decoding."""
    require(isinstance(value, dict) and isinstance(value.get('services'), dict), 'unresolved_compose_invalid')
    for service in value['services'].values():
        require(isinstance(service, dict), 'unresolved_compose_invalid')
        if 'environment' not in service:
            continue
        environment = service['environment']
        require(isinstance(environment, (dict, list)), 'unresolved_environment_invalid')
        if isinstance(environment, list):
            mapping = {}
            for entry in environment:
                require(isinstance(entry, str), 'unresolved_environment_invalid')
                key, separator, item = entry.partition('=')
                require(separator == '=' and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key) and key not in mapping,
                        'unresolved_environment_invalid')
                mapping[key] = item
            environment = mapping
        require(all(isinstance(key, str) and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key)
                    and (item is None or isinstance(item, str)) for key, item in environment.items()),
                'unresolved_environment_invalid')
        service['environment'] = environment
    return value


def normalized_config(value):
    # Compose's reusable config serializer doubles literal dollars. Decode its
    # environment serialization once in RAM; never write/pass resolved config.
    for service in value.get('services', {}).values():
        service['environment'] = {key: item.replace('$$', '$') if isinstance(item, str) else item
                                  for key, item in service.get('environment', {}).items()}
    return value


def health_statuses(value):
    """Closed public status metadata only; never retain raw health responses."""
    require(isinstance(value, dict) and set(value) == set(HEALTH_URLS), 'health_witness_status_invalid')
    for url, item in value.items():
        require(isinstance(item, dict) and type(item.get('httpStatus')) is int
                and 100 <= item['httpStatus'] <= 599, 'health_witness_status_invalid')
        if url == HEALTH_URLS[-1]:
            require(set(item) == {'httpStatus'} and item['httpStatus'] == 200, 'health_witness_status_invalid')
        else:
            require(set(item) in ({'httpStatus', 'status'}, {'httpStatus', 'status', 'dependencies'})
                    and item['status'] in HEALTH_STATES, 'health_witness_status_invalid')
            dependencies = item.get('dependencies', {})
            require(isinstance(dependencies, dict) and len(dependencies) <= 256
                    and all(re.fullmatch(r'[a-z0-9_-]{1,80}', key) and state in HEALTH_STATES
                            for key, state in dependencies.items()), 'health_witness_status_invalid')
    require(value[HEALTH_URLS[0]]['httpStatus'] == 200, 'health_witness_status_invalid')
    return value


def overlay(binding, mode):
    service = {
        'image': '${COP_API_RUNTIME_IMAGE_ID:?Immutable API image is required}',
        'environment': ({**{name: '${' + key + '?Runtime profile value is required}' for name, key in ENV.items()},
                         'COP_DATABASE_POOL_MODE': '${' + MODE_ENV + ':?Runtime pool mode is required}'}
                        if binding['kind'] != 'accepted-baseline' else binding['legacyEnvironment']),
        'labels': {'com.cop.runtime.release': binding['releaseId'],
                   'com.cop.runtime.profile-generation': binding['profileGeneration']}}
    if mode == 'transaction':
        service['group_add'] = ['982']
        service['volumes'] = [
            {'type': 'bind', 'source': str(path), 'target': str(path), 'read_only': True,
             'bind': {'create_host_path': False}} for path in (SOCKET, CA)]
    return {'services': {'cop-api': service}}


def overlay_bytes(binding, mode):
    value = overlay(binding, mode)
    if binding['kind'] != 'accepted-baseline':
        return encoded(value)
    api = value['services']['cop-api']
    # !override replaces the complete environment map, omitting legacy-absent
    # keys even when base Compose or the shell would otherwise supply them.
    return ('services:\n  cop-api:\n' + ''.join(
        '    ' + key + (': !override ' if key == 'environment' else ': ') +
        json.dumps(item, sort_keys=True) + '\n' for key, item in api.items())).encode()


def verify_api_diff(base, desired, values, mode, image, presence=None):
    """Compare resolved values in RAM; all non-API services/topology stay equal."""
    require(set(base) == set(desired), 'compose_topology_changed')
    for key in base:
        if key != 'services':
            require(base[key] == desired[key], 'compose_topology_changed')
    require(set(base['services']) == set(desired['services']), 'compose_services_changed')
    for name in base['services']:
        if name != 'cop-api':
            require(base['services'][name] == desired['services'][name], 'non_api_service_changed')
    old, new = base['services']['cop-api'], desired['services']['cop-api']
    for key in set(old) | set(new):
        if key not in {'image', 'environment', 'labels', 'volumes', 'group_add'}:
            require(old.get(key) == new.get(key), 'api_non_profile_field_changed')
    require(old.get('environment', {}).get('COP_STREAM_BUS', 'memory') == 'memory', 'stream_contract_not_approved')
    expected_env = {**old.get('environment', {}), **values}
    if presence is not None:
        for key, included in presence.items():
            if not included:
                expected_env.pop(key, None)
    require(new.get('environment') == expected_env and new.get('image') == image,
            'runtime_interpolation_mismatch')
    old_volumes = {v['target']: v for v in old.get('volumes', [])}
    new_volumes = {v['target']: v for v in new.get('volumes', [])}
    for target, mount in old_volumes.items():
        require(new_volumes.get(target) == mount, 'existing_mount_changed')
    additions = set(new_volumes) - set(old_volumes)
    require(additions == ({str(SOCKET), str(CA)} if mode == 'transaction' else set()), 'runtime_mount_scope')
    for target in additions:
        mount = new_volumes[target]
        require(mount.get('type') == 'bind' and mount.get('source') == target
                and mount.get('read_only') is True
                and mount.get('bind', {}).get('create_host_path') is False, 'unsafe_runtime_mount')
    groups = list(old.get('group_add', []))
    require('982' not in groups, 'base_runtime_group_forbidden')
    require(new.get('group_add', []) == groups + (['982'] if mode == 'transaction' else []), 'runtime_group_scope')
    labels = {**old.get('labels', {}), **{k: v for k, v in new.get('labels', {}).items()
              if k in {'com.cop.runtime.release', 'com.cop.runtime.profile-generation'}}}
    require(new.get('labels', {}) == labels, 'runtime_label_scope')


def duration(value):
    if value is None:
        return 0
    units = {'h': 3600000000000, 'm': 60000000000, 's': 1000000000,
             'ms': 1000000, 'us': 1000, 'ns': 1}
    pieces = re.findall(r'([0-9]+(?:\.[0-9]+)?)(ns|us|ms|s|m|h)', str(value))
    require(pieces and ''.join(number + unit for number, unit in pieces) == str(value), 'health_duration_invalid')
    return int(sum(float(number) * units[unit] for number, unit in pieces))


def host_parity(current, desired, image_config):
    host = current['HostConfig']
    def number(value):
        if value is None: return 0
        return int(value)
    limits = desired.get('deploy', {}).get('resources', {}).get('limits', {})
    expected = {'Memory': number(desired.get('mem_limit', limits.get('memory'))),
                'MemoryReservation': number(desired.get('mem_reservation')),
                'MemorySwap': number(desired.get('memswap_limit')),
                'NanoCpus': int(float(desired.get('cpus', limits.get('cpus', 0))) * 1_000_000_000),
                'CpuShares': number(desired.get('cpu_shares')), 'CpuPeriod': number(desired.get('cpu_period')),
                'CpuQuota': number(desired.get('cpu_quota')), 'CpusetCpus': desired.get('cpuset', ''),
                'OomKillDisable': desired.get('oom_kill_disable', False),
                'PidsLimit': number(desired.get('pids_limit'))}
    for key, expected_value in expected.items():
        actual = host.get(key)
        if actual is None: actual = '' if isinstance(expected_value, str) else False if isinstance(expected_value, bool) else 0
        require(actual == expected_value, 'live_resource_parity_mismatch')
    expected_ports = {}
    for port in desired.get('ports', []):
        require(port.get('mode', 'ingress') == 'ingress', 'port_contract_unsupported')
        key = str(port['target']) + '/' + port.get('protocol', 'tcp')
        expected_ports.setdefault(key, []).append({'HostIp': port.get('host_ip', '0.0.0.0'),
                                                 'HostPort': str(port['published'])})
    actual_ports = {key: [{**item, 'HostIp': item.get('HostIp') or '0.0.0.0'} for item in values]
                    for key, values in (host.get('PortBindings') or {}).items()}
    require(actual_ports == expected_ports, 'live_port_parity_mismatch')
    check = desired.get('healthcheck')
    expected_health = image_config.get('Healthcheck')
    if check is not None:
        expected_health = {'Test': ['NONE']} if check.get('disable') else {'Test': check['test']}
        for key, field in (('interval', 'Interval'), ('timeout', 'Timeout'), ('start_period', 'StartPeriod'), ('start_interval', 'StartInterval')):
            if key in check: expected_health[field] = duration(check[key])
        if 'retries' in check: expected_health['Retries'] = check['retries']
    actual_health = current['Config'].get('Healthcheck')
    # Docker may serialize optional zero durations omitted by Compose.
    normalize = lambda value: {k: v for k, v in (value or {}).items() if v not in (0, None)}
    require(normalize(actual_health) == normalize(expected_health), 'live_healthcheck_parity_mismatch')


def runtime_parity(current, desired, image_config, transition=False):
    """Compare desired runtime with inspected API, never a second new render.

    During an approved profile transition only the two profile mounts and GID
    982 may differ. This is deliberately limited to the fixed COP deployment.
    """
    host_parity(current, desired, image_config)
    expected_mounts = {v['target']: (v['source'], not v.get('read_only', False), v['type'])
                       for v in desired.get('volumes', [])}
    actual_mounts = {v['Destination']: (v['Source'], v['RW'], v['Type']) for v in current.get('Mounts', [])}
    if transition:
        for key in (str(SOCKET), str(CA)):
            expected_mounts.pop(key, None); actual_mounts.pop(key, None)
    require(actual_mounts == expected_mounts, 'live_mount_parity_mismatch')
    host = current['HostConfig']
    host_mounts = {v['Target']: v for v in host.get('Mounts', [])}
    actual_mount_details = {v['Destination']: v for v in current.get('Mounts', [])}
    for mount in desired.get('volumes', []):
        if transition and mount['target'] in {str(SOCKET), str(CA)}: continue
        if mount['type'] == 'bind':
            options = mount.get('bind', {})
            require(set(options) <= {'create_host_path', 'propagation'}, 'unsupported_bind_options')
            actual_options = host_mounts.get(mount['target'], {}).get('BindOptions', {})
            require(actual_options.get('CreateMountpoint', False) == options.get('create_host_path', False)
                    and actual_mount_details[mount['target']].get('Propagation', 'rprivate') ==
                    options.get('propagation', 'rprivate'), 'live_bind_options_parity_mismatch')
    groups, wanted_groups = host.get('GroupAdd') or [], desired.get('group_add', [])
    if transition:
        groups, wanted_groups = [v for v in groups if v != '982'], [v for v in wanted_groups if v != '982']
    require(groups == wanted_groups, 'live_runtime_group_mismatch')
    for field, key, default in (
        ('Privileged', 'privileged', False), ('ReadonlyRootfs', 'read_only', False),
        ('CapAdd', 'cap_add', []), ('CapDrop', 'cap_drop', []), ('SecurityOpt', 'security_opt', []),
        ('PidMode', 'pid', ''), ('IpcMode', 'ipc', 'private'), ('UTSMode', 'uts', ''),
        ('UsernsMode', 'userns_mode', ''), ('Isolation', 'isolation', ''), ('Runtime', 'runtime', 'runc'),
        ('Init', 'init', None), ('Dns', 'dns', []), ('DnsOptions', 'dns_opt', []), ('DnsSearch', 'dns_search', [])):
        require((host.get(field) if host.get(field) is not None else default) == desired.get(key, default),
                'live_host_parity_mismatch')
    hosts = desired.get('extra_hosts', {})
    expected_hosts = sorted(k + ':' + v for k, v in hosts.items()) if isinstance(hosts, dict) else sorted(hosts)
    require(sorted(host.get('ExtraHosts') or []) == expected_hosts, 'live_extra_hosts_parity_mismatch')
    wanted_restart = desired.get('restart', 'no').split(':', 1)
    require(host.get('RestartPolicy', {}).get('Name', 'no') == wanted_restart[0]
            and host.get('RestartPolicy', {}).get('MaximumRetryCount', 0) ==
            (int(wanted_restart[1]) if len(wanted_restart) == 2 else 0), 'live_restart_parity_mismatch')
    for field, key in (('User', 'user'), ('Cmd', 'command'), ('Entrypoint', 'entrypoint'), ('WorkingDir', 'working_dir')):
        actual, expected = current['Config'].get(field), desired.get(key, image_config.get(field))
        if key in {'user', 'working_dir'} and key not in desired and expected in (None, ''):
            require(actual in (None, ''), 'live_command_parity_mismatch')
        else:
            require(actual == expected, 'live_command_parity_mismatch')
    ignored_labels = {'com.cop.runtime.release', 'com.cop.runtime.profile-generation', 'org.opencontainers.image.revision'}
    expected_labels = {**(image_config.get('Labels') or {}), **(desired.get('labels') or {})}
    public_labels = lambda labels: {k: v for k, v in labels.items()
                                    if k not in ignored_labels and not k.startswith('com.docker.compose.')}
    actual_public = public_labels(current['Config'].get('Labels') or {})
    expected_public = public_labels(expected_labels)
    # The reviewed replacement image adds this exact base provenance label.
    # Permit only its image-owned addition/removal during the transition;
    # post-start validation still compares the complete target label strictly.
    if transition and BASE_NAME_LABEL not in (desired.get('labels') or {}):
        approved_change = (
            BASE_NAME_LABEL not in actual_public and expected_public.get(BASE_NAME_LABEL) == APPROVED_BASE_NAME
            or BASE_NAME_LABEL not in expected_public and actual_public.get(BASE_NAME_LABEL) == APPROVED_BASE_NAME)
        if approved_change:
            actual_public.pop(BASE_NAME_LABEL, None)
            expected_public.pop(BASE_NAME_LABEL, None)
    require(actual_public == expected_public,
            'live_label_parity_mismatch')
    # Fixed COP does not use these escape hatches. Refuse an out-of-band setting
    # instead of letting recreation silently remove it.
    for field, default in (('Devices', []), ('DeviceRequests', []), ('Ulimits', []),
                           ('VolumesFrom', []), ('Links', []), ('ContainerIDFile', ''),
                           ('AutoRemove', False), ('PublishAllPorts', False)):
        require((host.get(field) if host.get(field) is not None else default) == default, 'unsupported_live_runtime')


def network_scope(config):
    api = config['services']['cop-api']
    require({config['networks'][key]['name'] for key in api.get('networks', {})} == set(NETWORKS),
            'target_network_scope_changed')


class Docker:
    def __init__(self, source=SOURCE):
        self.source = source

    def run(self, args):
        require(os.environ.get('DOCKER_HOST', 'unix:///var/run/docker.sock') in (
            'unix:///var/run/docker.sock', 'unix:///run/docker.sock')
            and os.environ.get('DOCKER_CONTEXT', 'default') == 'default', 'foreign_docker_host')
        env = {k: v for k, v in os.environ.items() if not k.startswith('COP_API_RUNTIME_')
               and k not in {'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'}}
        # Existing health/storage child scripts also use the local daemon.
        env['DOCKER_HOST'] = 'unix:///var/run/docker.sock'
        if args[0] == 'docker':
            args = ['docker', '--host', 'unix:///var/run/docker.sock', *args[1:]]
        result = subprocess.run(args, capture_output=True, env=env, check=False)
        require(result.returncode == 0, 'runtime_command_failed')  # Never emit stdout/stderr.
        return result.stdout

    def compose(self, directory, profile=None):
        args = ['docker', 'compose', '--project-name', 'cop', '--project-directory', str(self.source),
                '--env-file', str(self.source / '.env')]
        if profile:
            args += ['--env-file', str(profile / 'runtime.env'), '--env-file', str(directory / 'image.env')]
        args += [part for name in FILES for part in ('-f', str(directory / 'compose' / name))]
        if profile:
            args += ['-f', str(directory / 'compose.runtime.yml')]
        return args

    def config(self, directory, profile=None, raw=False):
        args = self.compose(directory, profile) + ['config', '--format', 'json']
        if raw:
            args += ['--no-interpolate', '--no-env-resolution']
        value = json.loads(self.run(args))
        return unresolved_config(value) if raw else normalized_config(value)

    def source_config(self):
        args = ['docker', 'compose', '--project-name', 'cop', '--project-directory', str(self.source),
                '--env-file', str(self.source / '.env')]
        args += [part for name in FILES for part in ('-f', str(self.source / name))]
        return unresolved_config(json.loads(self.run(args + ['config', '--format', 'json', '--no-interpolate', '--no-env-resolution'])))

    def mounts(self, image, fingerprint):
        # UID1000 has no host traversal grant. Root attestation owns parent/path
        # integrity; this fixed offline container checks mounted metadata only.
        require(IMAGE.fullmatch(image) is not None, 'mount_probe_image_unpinned')
        probe = (
            'const fs=require("fs"),crypto=require("crypto");try{'
            'const d=fs.lstatSync("/run/vcode-cop-pgbouncer"),'
            's=fs.lstatSync("/run/vcode-cop-pgbouncer/.s.PGSQL.6432"),'
            'c=fs.lstatSync("/etc/vcode-cop-pgbouncer/postgres-ca.crt");'
            'if(!c.isFile()||c.size>65536)process.exit(1);'
            'const v={contractVersion:"cop-api-runtime-mount-probe-v1",'
            'socketDirectoryApproved:d.isDirectory()&&d.gid===982&&!(d.mode&7),'
            'socketApproved:s.isSocket()&&s.gid===982&&!(s.mode&7),'
            'caApproved:c.isFile()&&!(c.mode&18)&&c.nlink===1&&c.size<=65536,'
            'caSha256:crypto.createHash("sha256").update(fs.readFileSync("/etc/vcode-cop-pgbouncer/postgres-ca.crt")).digest("hex")};'
            'process.stdout.write(JSON.stringify(v));}catch{process.exit(1)}')
        raw = self.run(['docker', 'run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                        '--group-add', '982', '--mount', 'type=bind,src=' + str(SOCKET) + ',dst=' + str(SOCKET) + ',readonly',
                        '--mount', 'type=bind,src=' + str(CA) + ',dst=' + str(CA) + ',readonly',
                        '--entrypoint', 'node', image, '-e', probe])
        require(len(raw) <= 4096, 'mount_probe_invalid')
        value = json.loads(raw)
        require(isinstance(value, dict) and all(type(value.get(k)) is bool for k in
                ('socketDirectoryApproved', 'socketApproved', 'caApproved'))
                and value == {'contractVersion': 'cop-api-runtime-mount-probe-v1',
                         'socketDirectoryApproved': True, 'socketApproved': True,
                         'caApproved': True, 'caSha256': fingerprint}, 'mount_probe_rejected')

    def image(self, image, baseline=False, revision=None):
        inspected = json.loads(self.run(['docker', 'image', 'inspect', image]))[0]
        require(inspected['Id'] == image, 'image_identity_mismatch')
        if baseline:
            return
        require(inspected['Config'].get('Labels', {}).get('org.opencontainers.image.revision') == revision,
                'image_source_revision_mismatch')
        guard = ('const fs=require("fs");const s=fs.readFileSync("/app/apps/cop-api/dist/media-conversion.js","utf8");'
                 'if(!s.includes("verifyConversionStorage")||!s.includes("expectedStorageUuid")||'
                 '!s.includes("expectedDeviceId"))process.exit(1);'
                 'const sharp=require("/app/apps/cop-api/node_modules/sharp");'
                 'sharp({create:{width:1,height:1,channels:3,background:{r:0,g:0,b:0}}}).png().toBuffer()'
                 '.then(b=>{if(!b.length)process.exitCode=1}).catch(()=>{process.exitCode=1})')
        self.run(['docker', 'run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                  '--entrypoint', 'node', image, '-e', guard])

    def peers(self, directory):
        result = {}
        for service in ('cop-web', 'cop-chat', 'cop-edge', 'cop-mcp'):
            result[service] = self.run(self.compose(directory) + ['ps', '-q', service]).decode().strip()
        return result

    def current(self, directory):
        ids = self.run(self.compose(directory) + ['ps', '--all', '-q', 'cop-api']).decode().split()
        require(len(ids) == 1, 'api_container_ambiguous')
        return json.loads(self.run(['docker', 'inspect', ids[0]]))[0]

    def live(self, directory, binding, profile, require_label=True):
        current = self.current(directory)
        require(current['Image'] == binding['imageId'], 'live_image_mismatch')
        values = dict(item.split('=', 1) for item in current['Config'].get('Env', []) if '=' in item)
        presence = binding['legacyEnvPresence']
        if presence is not None:
            require(all((key in values) == included for key, included in presence.items()), 'legacy_presence_mismatch')
        require(all(values.get(key) == value for key, value in profile['values'].items()
                    if presence is None or presence[key]), 'live_profile_mismatch')
        self.non_profile(directory, profile['directory'], current)
        require({key: value['NetworkID'] for key, value in current['NetworkSettings']['Networks'].items()}
                == NETWORKS, 'live_network_mismatch')
        if require_label:
            require(current['Config'].get('Labels', {}).get('com.cop.runtime.release') == binding['releaseId'],
                    'live_binding_mismatch')
            require(current['Config'].get('Labels', {}).get('com.cop.runtime.profile-generation') == binding['profileGeneration'],
                    'live_profile_label_mismatch')
        resolved = self.config(directory, profile['directory']); network_scope(resolved)
        desired = resolved['services']['cop-api']
        image_config = json.loads(self.run(['docker', 'image', 'inspect', binding['imageId']]))[0]['Config']
        runtime_parity(current, desired, image_config)

    def preserve(self, directory, profile, current):
        """Pre-mutation gate: target image/profile may not change other runtime."""
        resolved = self.config(directory, profile); network_scope(resolved)
        desired = resolved['services']['cop-api']
        image_config = json.loads(self.run(['docker', 'image', 'inspect', desired['image']]))[0]['Config']
        self.non_profile(directory, profile, current)
        runtime_parity(current, desired, image_config, transition=True)
        require({key: value['NetworkID'] for key, value in current['NetworkSettings']['Networks'].items()}
                == NETWORKS, 'live_network_mismatch')

    def unchanged(self, directory, witnessed):
        actual = self.current(directory)
        require(all(actual.get(key) == witnessed.get(key) for key in
                ('Id', 'Image', 'Config', 'HostConfig', 'Mounts'))
                and actual['NetworkSettings']['Networks'] == witnessed['NetworkSettings']['Networks'],
                'api_runtime_changed_before_mutation')

    def non_profile(self, directory, profile, current=None):
        current = current or self.current(directory)
        actual = dict(item.split('=', 1) for item in current['Config'].get('Env', []) if '=' in item)
        api = self.config(directory, profile)['services']['cop-api']
        image_config = json.loads(self.run(['docker', 'image', 'inspect', api['image']]))[0]['Config']
        inherited = dict(item.split('=', 1) for item in image_config.get('Env', []) if '=' in item)
        desired = {**inherited, **api.get('environment', {})}
        excluded = set(ENV) | {'COP_DATABASE_POOL_MODE'}
        expected = {key: value for key, value in desired.items() if key not in excluded}
        relevant = {key: value for key, value in actual.items() if key not in excluded}
        require(relevant == expected, 'non_profile_environment_drift')

    def up(self, directory, profile):
        self.run(self.compose(directory, profile) + ['up', '-d', '--no-build', '--pull', 'never', '--no-deps', 'cop-api'])

    def health(self, action, path):
        return self.run(['python3', str(self.source / 'scripts/cop-health-gate.py'), action,
                         *([str(path), '--allow-added-dependency', 'safety-notification-worker'] if action == 'verify' else [])])


class Store:
    def __init__(self, root=ROOT, source=SOURCE, guard=lambda: None, docker=None,
                 uid=None, protected_uid=0, protected_gid=1000, protected_root=PROFILES,
                 mount_guard=None):
        self.root, self.source, self.guard = root, source, guard
        self.uid = os.geteuid() if uid is None else uid
        self.protected_uid, self.protected_gid, self.protected_root = protected_uid, protected_gid, protected_root
        self.docker = docker or Docker(source)
        self.mount_guard = mount_guard

    def directory(self, path, create=False):
        self.guard()
        require(not any(p.is_symlink() for p in (path, *path.parents)), 'runtime_directory_symlink')
        if create and not path.exists():
            path.mkdir(mode=0o700)
        info = path.stat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == self.uid
                and stat.S_IMODE(info.st_mode) == 0o700, 'runtime_directory_permissions')
        return path

    def write(self, path, raw):
        self.directory(path.parent)
        temporary = path.with_name('.' + path.name + '-' + uuid.uuid4().hex)
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(fd, 'wb') as handle:
                handle.write(raw); handle.flush(); os.fsync(handle.fileno())
            self.guard()
            os.replace(temporary, path)
            self.sync(path.parent)
        finally:
            if temporary.exists():
                temporary.unlink()

    @staticmethod
    def sync(path):
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def protected_directory(self, directory):
        require(not any(p.is_symlink() for p in (directory, *directory.parents)), 'protected_path_symlink')
        info = directory.stat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == self.protected_uid
                and info.st_gid == self.protected_gid and stat.S_IMODE(info.st_mode) == 0o750,
                'protected_directory_permissions')
        return directory

    def profile(self, identifier, contract):
        require(PROFILE_UUID.fullmatch(identifier) is not None, 'profile_generation_invalid')
        driver_contract(contract)
        self.directory(self.root); self.protected_directory(self.protected_root)
        directory = self.protected_directory(self.protected_root / identifier)
        raw = private_read(directory / 'runtime.env', self.protected_uid, 16384,
                           mode=0o640, gid=self.protected_gid)
        values = env_values(raw) | {'COP_DATABASE_POOL_MODE': contract['poolMode']}
        require(values['COP_DATABASE_URL'].startswith(('postgresql://', 'postgres://')), 'profile_route_invalid')
        if contract['poolMode'] == 'transaction':
            require(bool(values['COP_LEASE_DATABASE_URL']), 'profile_session_route_missing')
        return {'profileId': identifier, 'generation': identifier, 'mode': contract['poolMode'],
                'driverContract': contract, 'directory': directory, 'values': values}

    def check_mounts(self, binding, profile):
        if profile['mode'] == 'transaction':
            if self.mount_guard is not None:
                self.mount_guard(profile['driverContract']['caSha256'])
            else:
                self.docker.mounts(binding['imageId'], profile['driverContract']['caSha256'])

    def pointer(self):
        path = self.root / 'active.json'
        if not path.exists():
            require(not path.is_symlink(), 'active_pointer_symlink')
            return None
        value = private_json(path, self.uid)
        require(set(value) == {'contractVersion', 'generation', 'releaseId', 'profileId', 'profileGeneration', 'imageId', 'containerId'}
                and value['contractVersion'] == 'cop-api-runtime-active-v1'
                and GENERATION.fullmatch(value['generation']) and ID.fullmatch(value['releaseId'])
                and IMAGE.fullmatch(value['imageId'])
                and re.fullmatch(r'[0-9a-f]{64}', value['containerId']), 'active_pointer_invalid')
        return value

    def check_cas(self, expected):
        current = self.pointer()
        require((current['generation'] if current else 'absent') == expected, 'active_pointer_changed')
        return current

    def clean(self):
        self.directory(self.root)
        require(not (self.root / 'pending.json').exists() and not (self.root / 'pending.json').is_symlink(),
                'runtime_activation_pending')

    def attestation(self, path, binding):
        require(path.parent == self.protected_root / binding['profileGeneration']
                and path.name == 'attestation-' + binding['imageId'].removeprefix('sha256:') + '.json',
                'attestation_scope_invalid')
        self.protected_directory(self.protected_root); self.protected_directory(path.parent)
        raw = private_read(path, self.protected_uid, mode=0o640, gid=self.protected_gid)
        value = json.loads(raw)
        keys = {'contractVersion', 'application', 'service', 'profileGeneration', 'imageId',
                'sourceRevision', 'kind', 'ownerAcceptance', 'driverContract', 'checks', 'legacyContainerId', 'legacyEnvPresence'}
        require(isinstance(value, dict) and set(value) == keys
                and value['contractVersion'] == 'cop-api-runtime-attestation-v1'
                and value['application'] == 'cop' and value['service'] == 'cop-api'
                and value['ownerAcceptance'] is True
                and all(value[key] == binding[key] for key in (
                    'imageId', 'sourceRevision', 'profileGeneration', 'kind')), 'attestation_binding_mismatch')
        contract = driver_contract(value['driverContract'])
        if 'driverContract' in binding:
            require(binding['driverContract'] == contract, 'driver_contract_changed')
        require(isinstance(value['checks'], dict) and set(value['checks']) == {
            'x5RuntimeGuard', 'sharpConversion', 'databaseRouting', 'acceptedBaselineRollback'}
            and all(type(item) is bool for item in value['checks'].values()), 'attestation_checks_invalid')
        baseline = binding['kind'] == 'accepted-baseline'
        if baseline:
            require(value['sourceRevision'] is None and contract['poolMode'] == 'direct'
                    and re.fullmatch(r'[0-9a-f]{64}', value['legacyContainerId'])
                    and value['checks']['acceptedBaselineRollback'] is True
                    and isinstance(value['legacyEnvPresence'], dict)
                    and set(value['legacyEnvPresence']) == set(ENV) | {'COP_DATABASE_POOL_MODE'}
                    and all(type(v) is bool for v in value['legacyEnvPresence'].values())
                    and value['legacyEnvPresence']['COP_DATABASE_URL'] is True, 'legacy_witness_invalid')
        else:
            require(value['legacyContainerId'] is None and value['legacyEnvPresence'] is None
                    and value['checks']['acceptedBaselineRollback'] is False
                    and all(value['checks'][key] for key in ('x5RuntimeGuard', 'sharpConversion', 'databaseRouting')),
                    'compatibility_not_accepted')
        return sha(raw), contract, value['legacyContainerId'], value['legacyEnvPresence']

    def binding(self, identifier, probe_mounts=True):
        require(ID.fullmatch(identifier) is not None, 'release_id_invalid')
        directory = self.directory(self.root / 'releases' / identifier)
        binding = private_json(directory / 'release.json', self.uid)
        require(set(binding) == {'contractVersion', 'releaseId', 'imageId', 'sourceRevision', 'profileId',
                'profileGeneration', 'kind', 'attestationPath', 'previousReleaseId', 'attestationSha256',
                'driverContract', 'legacyContainerId', 'legacyEnvPresence', 'legacyEnvironment', 'composeHashes',
                'acceptedHealthSha256'}, 'release_schema_invalid')
        require(set(binding['composeHashes']) == set(FILES), 'release_compose_scope')
        require(binding.get('contractVersion') == 'cop-api-runtime-release-v1'
                and binding.get('releaseId') == identifier and IMAGE.fullmatch(binding.get('imageId', ''))
                and (binding.get('sourceRevision') is None if binding.get('kind') == 'accepted-baseline'
                     else REVISION.fullmatch(binding.get('sourceRevision', '')))
                and binding.get('kind') in {'candidate', 'accepted-baseline'}, 'release_binding_invalid')
        profile = self.profile(binding['profileId'], binding['driverContract'])
        require(binding['profileGeneration'] == profile['generation'], 'profile_generation_changed')
        attestation_sha, _, witness, presence = self.attestation(Path(binding['attestationPath']), binding)
        require(binding['legacyEnvPresence'] == presence, 'legacy_presence_changed')
        require(binding['legacyContainerId'] == witness, 'legacy_witness_changed')
        require(binding['attestationSha256'] == attestation_sha,
                'attestation_changed')
        if probe_mounts:
            self.check_mounts(binding, profile)
        self.directory(directory / 'compose')
        for name in FILES:
            require(sha(private_read(directory / 'compose' / name, self.uid)) == binding['composeHashes'][name],
                    'release_compose_changed')
        require(private_read(directory / 'compose.runtime.yml', self.uid) == overlay_bytes(binding, profile['mode']),
                'runtime_overlay_changed')
        require(private_read(directory / 'image.env', self.uid) == self.image_env(binding, profile['mode']),
                'runtime_image_file_changed')
        if binding['acceptedHealthSha256'] is not None:
            self.accepted_health(directory, binding)
        return directory, binding, profile

    def active(self, probe_mounts=True):
        self.clean()
        pointer = self.pointer()
        require(pointer is not None, 'active_runtime_profile_missing')
        directory, binding, profile = self.binding(pointer['releaseId'], probe_mounts=probe_mounts)
        require(all(pointer[key] == binding[key] for key in ('profileId', 'profileGeneration', 'imageId')),
                'active_pair_mismatch')
        if profile['mode'] == 'direct':
            self.accepted_health(directory, binding)
        return pointer, directory, binding, profile

    def prepare(self, image, revision, attestation, expected, profile_id=None, baseline=False):
        self.clean(); pointer = self.check_cas(expected)
        require(IMAGE.fullmatch(image) and (revision is None if baseline else isinstance(revision, str)
                and REVISION.fullmatch(revision)), 'candidate_identity_invalid')
        if profile_id is None:
            require(pointer is not None, 'active_runtime_profile_missing')
            self.active(); profile_id = pointer['profileId']
        require(PROFILE_UUID.fullmatch(profile_id) and (not baseline or pointer is None), 'profile_scope_invalid')
        binding = {'contractVersion': 'cop-api-runtime-release-v1', 'releaseId': 'release-' + uuid.uuid4().hex,
                   'imageId': image, 'sourceRevision': revision, 'profileId': profile_id,
                   'profileGeneration': profile_id,
                   'kind': 'accepted-baseline' if baseline else 'candidate',
                   'attestationPath': str(attestation), 'previousReleaseId': pointer['releaseId'] if pointer else None}
        receipt_sha, contract, witness, presence = self.attestation(attestation, binding)
        profile = self.profile(profile_id, contract)
        if pointer and profile_id == pointer['profileId']:
            _, _, active_binding, _ = self.active()
            require(active_binding['driverContract'] == contract, 'active_profile_contract_changed')
        binding.update(attestationSha256=receipt_sha, driverContract=contract, legacyContainerId=witness,
                       legacyEnvPresence=presence, legacyEnvironment=None, acceptedHealthSha256=None)
        self.docker.image(image, baseline=baseline, revision=revision)
        self.check_mounts(binding, profile)
        # Validate unresolved source in RAM before any release artifact is
        # written. Invalid inline secrets must not survive in a failed release.
        sources = {}
        for name in FILES:
            path = self.source / name
            require(not path.is_symlink() and path.is_file(), 'approved_compose_missing')
            sources[name] = path.read_bytes()
            require(len(sources[name]) <= 65536, 'approved_compose_too_large')
        raw_config = self.docker.source_config()
        require(all((self.source / name).read_bytes() == raw for name, raw in sources.items()), 'compose_source_changed')
        for service in raw_config['services'].values():
            for key, value in service.get('environment', {}).items():
                if re.search(r'(TOKEN|SECRET|PASSWORD|API_KEY|DATABASE_URL)$', key):
                    require(not value or str(value).startswith('${'), 'inline_secret_in_compose')
        releases = self.directory(self.root / 'releases', create=True)
        directory = self.directory(releases / binding['releaseId'], create=True)
        compose = self.directory(directory / 'compose', create=True)
        binding['composeHashes'] = {}
        for name, raw in sources.items():
            self.write(compose / name, raw); binding['composeHashes'][name] = sha(raw)
        if baseline:
            raw_env = dict(raw_config['services']['cop-api'].get('environment', {}))
            for key, included in presence.items():
                if not included:
                    raw_env.pop(key, None)
                else:
                    variable = ENV[key] if key in ENV else MODE_ENV
                    raw_env[key] = '${' + variable + '?Legacy runtime value is required}'
            binding['legacyEnvironment'] = raw_env
        self.write(directory / 'compose.runtime.yml', overlay_bytes(binding, profile['mode']))
        self.write(directory / 'image.env', self.image_env(binding, profile['mode']))
        verify_api_diff(self.docker.config(directory), self.docker.config(directory, profile['directory']),
                        profile['values'], profile['mode'], image, presence)
        self.write(directory / 'release.json', encoded(binding))
        self.check_cas(expected)
        return binding

    @staticmethod
    def image_env(binding, mode):
        return ("COP_API_RUNTIME_IMAGE_ID='" + binding['imageId'] + "'\n" + MODE_ENV + "='" + mode + "'\n").encode()

    def commit_pointer(self, binding, expected, container_id):
        self.check_cas(expected)
        pointer = {'contractVersion': 'cop-api-runtime-active-v1', 'generation': uuid.uuid4().hex,
                   'containerId': container_id,
                   **{key: binding[key] for key in ('releaseId', 'profileId', 'profileGeneration', 'imageId')}}
        self.write(self.root / 'active.json', encoded(pointer))
        return pointer

    def accepted_ancestor(self, binding, release, probe_mounts=True):
        ancestor = binding['previousReleaseId']
        for _ in range(128):
            if ancestor == release:
                return True
            if ancestor is None:
                break
            ancestor = self.binding(ancestor, probe_mounts=probe_mounts)[1]['previousReleaseId']
        return False

    def accepted_health(self, directory, binding):
        digest = binding['acceptedHealthSha256']
        require(binding['driverContract']['poolMode'] == 'direct' and isinstance(digest, str)
                and re.fullmatch(r'[0-9a-f]{64}', digest), 'accepted_health_witness_missing')
        raw = private_read(directory / 'accepted-health.json', self.uid)
        require(sha(raw) == digest, 'accepted_health_witness_changed')
        value = json.loads(raw)
        scope = ('releaseId', 'imageId', 'sourceRevision', 'profileId', 'profileGeneration')
        require(set(value) == {'contractVersion', 'containerId', 'acceptedAtUtc', 'statuses', *scope}
                and value['contractVersion'] == 'cop-api-runtime-health-witness-v1'
                and all(value[key] == binding[key] for key in scope)
                and re.fullmatch(r'[0-9a-f]{64}', value['containerId'])
                and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', value['acceptedAtUtc']),
                'accepted_health_witness_scope_changed')
        return encoded(health_statuses(value['statuses']))

    def record_accepted_health(self, directory, binding, current, verified):
        if binding['driverContract']['poolMode'] != 'direct':
            return
        if binding['acceptedHealthSha256'] is not None:
            self.accepted_health(directory, binding)
            return  # Preserve the original accepted observation, including CID.
        value = json.loads(verified)
        require(set(value) == {'healthAndPublicDemoPreserved', 'statuses'}
                and value['healthAndPublicDemoPreserved'] is True
                and current.get('State', {}).get('Running') is True
                and current['Image'] == binding['imageId'], 'accepted_health_verification_invalid')
        witness = {'contractVersion': 'cop-api-runtime-health-witness-v1',
                   'containerId': current['Id'],
                   'acceptedAtUtc': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                   'statuses': health_statuses(value['statuses']),
                   **{key: binding[key] for key in ('releaseId', 'imageId', 'sourceRevision', 'profileId', 'profileGeneration')}}
        raw = encoded(witness)
        require(len(raw) <= 65536, 'health_witness_too_large')
        self.write(directory / 'accepted-health.json', raw)
        binding['acceptedHealthSha256'] = sha(raw)
        self.write(directory / 'release.json', encoded(binding))

    def activate(self, release, expected, adopt=False, rollback=False):
        self.clean(); previous = self.check_cas(expected)
        directory, binding, profile = self.binding(release)
        require(adopt == (binding['kind'] == 'accepted-baseline' and previous is None), 'activation_kind_invalid')
        require(not rollback or previous is not None and not adopt, 'rollback_kind_invalid')
        # A failed source TX endpoint must not prevent explicit restoration of
        # an accepted DIRECT pair. Its protected identity/parity still applies;
        # availability probes remain mandatory for every TX target.
        restore_direct = rollback and profile['mode'] == 'direct'
        if previous:
            _, old_dir, old_binding, old_profile = self.active(probe_mounts=not restore_direct)
            self.docker.live(old_dir, old_binding, old_profile,
                             require_label=old_binding['kind'] != 'accepted-baseline')
            require(self.docker.current(old_dir)['Id'] == previous['containerId'], 'live_container_changed')
            if rollback:
                require(self.accepted_ancestor(old_binding, release, probe_mounts=not restore_direct),
                        'rollback_pair_not_previously_accepted')
            else:
                require(binding['previousReleaseId'] == previous['releaseId'], 'prepared_pair_stale')
            if old_profile['mode'] != profile['mode'] and not rollback:
                require(old_binding['imageId'] == binding['imageId'], 'route_change_requires_same_accepted_image')
        self.docker.image(binding['imageId'], baseline=binding['kind'] == 'accepted-baseline',
                          revision=binding['sourceRevision'])
        verify_api_diff(self.docker.config(directory), self.docker.config(directory, profile['directory']),
                        profile['values'], profile['mode'], binding['imageId'], binding['legacyEnvPresence'])
        if adopt:
            actual = self.docker.current(directory)
            require(actual['Id'] == binding['legacyContainerId'], 'legacy_container_witness_mismatch')
            self.docker.live(directory, binding, profile, require_label=False)
            self.write(directory / 'adoption-health.json', self.docker.health('capture', None))
            self.docker.unchanged(directory, actual)
            verified = self.docker.health('verify', directory / 'adoption-health.json')
            self.docker.live(directory, binding, profile, require_label=False)
            self.docker.unchanged(directory, actual)
            self.record_accepted_health(directory, binding, actual, verified)
            return self.commit_pointer(binding, expected, binding['legacyContainerId'])
        require(previous is not None, 'accepted_baseline_pair_required')
        self.docker.preserve(directory, profile['directory'], self.docker.current(old_dir))
        baseline = (self.accepted_health(directory, binding) if restore_direct
                    else self.docker.health('capture', None))
        self.write(self.root / 'pending-health.json', baseline)
        pending = {'contractVersion': 'cop-api-runtime-pending-v1', 'previous': previous,
                   'targetReleaseId': release, 'targetContainerId': None,
                   'restoredContainerId': None, 'peers': self.docker.peers(directory)}
        self.write(self.root / 'pending.json', encoded(pending))
        actual = self.docker.current(old_dir)
        require(actual['Id'] == previous['containerId'], 'live_container_changed')
        self.docker.preserve(directory, profile['directory'], actual)
        self.docker.unchanged(old_dir, actual)
        self.docker.up(directory, profile['directory'])
        self.docker.live(directory, binding, profile)
        pending['targetContainerId'] = self.docker.current(directory)['Id']
        self.write(self.root / 'pending.json', encoded(pending))
        require(self.docker.peers(directory) == pending['peers'], 'peer_container_changed')
        verified = self.docker.health('verify', self.root / 'pending-health.json')
        actual = self.docker.current(directory)
        require(actual['Id'] == pending['targetContainerId'], 'live_container_changed')
        self.docker.live(directory, binding, profile)
        self.docker.unchanged(directory, actual)
        self.record_accepted_health(directory, binding, actual, verified)
        self.docker.unchanged(directory, actual)
        pointer = self.commit_pointer(binding, expected, pending['targetContainerId'])
        self.finish_pending()
        return pointer

    def finish_pending(self):
        self.guard()
        for name in ('pending.json', 'pending-health.json'):
            (self.root / name).unlink(missing_ok=True)
        self.sync(self.root)

    def recover(self, expected, rollback=False):
        self.directory(self.root); current = self.check_cas(expected)
        pending = private_json(self.root / 'pending.json', self.uid)
        require(set(pending) == {'contractVersion', 'previous', 'targetReleaseId', 'targetContainerId',
                'restoredContainerId', 'peers'}
                and pending['contractVersion'] == 'cop-api-runtime-pending-v1'
                and all(value is None or re.fullmatch(r'[0-9a-f]{64}', value)
                        for value in (pending['targetContainerId'], pending['restoredContainerId'])), 'pending_invalid')
        previous = pending['previous']
        require(current is not None and (current == previous or current['releaseId'] == pending['targetReleaseId']
                or current['releaseId'] == previous['releaseId']
                and current['containerId'] == pending['restoredContainerId']),
                'recovery_pointer_changed')
        old_dir, old_binding, old_profile = self.binding(previous['releaseId'], probe_mounts=False)
        new_dir, new_binding, new_profile = self.binding(pending['targetReleaseId'], probe_mounts=False)
        restore_direct = (rollback and old_profile['mode'] == 'direct' or not rollback
                          and new_profile['mode'] == 'direct'
                          and self.accepted_ancestor(old_binding, new_binding['releaseId'], probe_mounts=False))
        if not restore_direct:
            self.check_mounts(old_binding, old_profile)
            self.check_mounts(new_binding, new_profile)
        elif not rollback:
            require(private_read(self.root / 'pending-health.json', self.uid) ==
                    self.accepted_health(new_dir, new_binding), 'recovery_health_witness_changed')
        actual = self.docker.current(new_dir)
        if actual['Image'] == new_binding['imageId'] and actual['Config'].get('Labels', {}).get('com.cop.runtime.release') == new_binding['releaseId']:
            self.docker.live(new_dir, new_binding, new_profile)
            if pending['targetContainerId'] is not None:
                require(actual['Id'] == pending['targetContainerId'], 'recovery_container_changed')
            target_running = True
        else:
            self.docker.live(old_dir, old_binding, old_profile,
                             require_label=old_binding['kind'] != 'accepted-baseline')
            require(actual['Id'] == (pending['restoredContainerId'] or previous['containerId']), 'recovery_container_changed')
            target_running = False
        directory, binding, profile = ((old_dir, old_binding, old_profile) if rollback
                                       else (new_dir, new_binding, new_profile))
        self.docker.image(binding['imageId'], baseline=binding['kind'] == 'accepted-baseline',
                          revision=binding['sourceRevision'])
        verify_api_diff(self.docker.config(directory), self.docker.config(directory, profile['directory']),
                        profile['values'], profile['mode'], binding['imageId'], binding['legacyEnvPresence'])
        self.docker.preserve(directory, profile['directory'], actual)
        self.docker.unchanged(directory, actual)
        if rollback and target_running:
            self.docker.up(directory, profile['directory'])
        require(rollback or target_running, 'activation_did_not_start')
        self.docker.live(directory, binding, profile,
                         require_label=not (binding['kind'] == 'accepted-baseline' and not target_running))
        owned_id = self.docker.current(directory)['Id']
        if rollback and target_running:
            pending['restoredContainerId'] = owned_id
            self.write(self.root / 'pending.json', encoded(pending))
        require(self.docker.peers(directory) == pending['peers'], 'peer_container_changed')
        verified = self.docker.health('verify', self.root / 'pending-health.json')
        actual = self.docker.current(directory)
        require(actual['Id'] == owned_id, 'recovery_container_changed')
        self.docker.live(directory, binding, profile,
                         require_label=not (binding['kind'] == 'accepted-baseline' and not target_running))
        self.docker.unchanged(directory, actual)
        self.record_accepted_health(directory, binding, actual, verified)
        self.docker.unchanged(directory, actual)
        pointer = self.commit_pointer(binding, expected, owned_id)
        self.finish_pending()
        return pointer


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    commands.add_parser('validate')
    prepare = commands.add_parser('prepare')
    for name in ('image', 'attestation', 'expect-active'):
        prepare.add_argument('--' + name, required=True)
    prepare.add_argument('--revision')
    prepare.add_argument('--profile'); prepare.add_argument('--baseline', action='store_true')
    activate = commands.add_parser('activate')
    activate.add_argument('--release', required=True); activate.add_argument('--expect-active', required=True)
    activate.add_argument('--adopt', action='store_true')
    activate.add_argument('--rollback', action='store_true')
    recover = commands.add_parser('recover')
    recover.add_argument('--expect-active', required=True); recover.add_argument('--rollback', action='store_true')
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('cop_storage', Path(__file__).with_name('cop-storage.py'))
    storage = importlib.util.module_from_spec(spec); spec.loader.exec_module(storage)
    try:
        with storage.operation_lock():
            store = Store(guard=storage.preflight)
            if args.action == 'validate':
                pointer, directory, binding, profile = store.active()
                store.docker.live(directory, binding, profile, require_label=binding['kind'] != 'accepted-baseline')
                require(store.docker.current(directory)['Id'] == pointer['containerId'], 'live_container_changed')
                result = pointer
            elif args.action == 'prepare':
                result = store.prepare(args.image, args.revision, Path(args.attestation), args.expect_active,
                                       args.profile, args.baseline)
            elif args.action == 'activate':
                result = store.activate(args.release, args.expect_active, args.adopt, args.rollback)
            else:
                result = store.recover(args.expect_active, args.rollback)
            print(json.dumps({key: result[key] for key in (
                'releaseId', 'profileId', 'profileGeneration', 'imageId') } |
                ({'generation': result['generation']} if 'generation' in result else {}), sort_keys=True))
        return 0
    except (RuntimeError, OSError, ValueError, KeyError, TypeError, storage.StorageError):
        print(json.dumps({'ok': False, 'error': 'cop_api_runtime_rejected'}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
