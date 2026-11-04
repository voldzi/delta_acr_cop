#!/usr/bin/python3
"""Read-only verification of the declared Messaging contract after known cutover.
Record mode only records current facts and explicit unknowns; it never recreates a container,
rewrites a pin, hides the prior failed raw comparison or claims missing evidence.
"""
import argparse,copy,datetime,hashlib,json,os,re,subprocess,traceback,urllib.request
from pathlib import Path
CASE=Path('/srv/csm-messaging/account-safety/vehicle-image-release-dfce87e544d54c83a1e771f054af1275')
CID='2aca47ebb9140f0c75e27fc580054545c30acf5415b7742fb0789f2e55d3e5b5'
IMAGE='sha256:e9c50077e596718f267b65422e5c95169ea6e3f88d55ce734c5d5939183b9907'
OLD='sha256:531a5282d086300df960f270e5e17d4aa928abc3180af4d14a23d3edc18d9d25'
PIN=Path('/srv/csm-messaging/account-safety/disabled-runtime-portable.compose.json')
PIN_OLD_SHA='c08941fb56c74884dbbebf5f15ad762f278f7afeaa77dc7d2a87a9f34959122f'
def require(ok,code):
 if not ok:raise RuntimeError(code)
def run(args):
 p=subprocess.run(args,capture_output=True,timeout=60);require(p.returncode==0,'VERIFY_COMMAND_FAILED');return p.stdout
def docker(*args):return run(['docker','--host','unix:///var/run/docker.sock',*args])
def sha(raw):return hashlib.sha256(raw).hexdigest()
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
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

def host_pairs(value):
    """Only delimiter spelling differs; names, addresses and counts stay exact."""
    require(isinstance(value, (dict, list)), 'extra_hosts_invalid')
    if isinstance(value, dict):
        pairs = list(value.items())
    else:
        pairs = []
        for item in value:
            require(isinstance(item, str), 'extra_hosts_invalid')
            separator = '=' if '=' in item else ':'
            name, delimiter, address = item.partition(separator)
            require(bool(delimiter), 'extra_hosts_invalid')
            pairs.append((name, address))
    require(all(isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9_.-]+', name)
                and isinstance(address, str) and address and not any(char.isspace() for char in address)
                for name, address in pairs), 'extra_hosts_invalid')
    require(len(set(pairs)) == len(pairs) and len({name for name, _ in pairs}) == len(pairs), 'extra_hosts_duplicate')
    return sorted(pairs)

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
            options = mount.get('bind') or {}
            require(set(options) <= {'create_host_path', 'propagation'}, 'unsupported_bind_options')
            actual_options = host_mounts.get(mount['target'], {}).get('BindOptions', {})
            legacy=[v for v in (host.get('Binds') or []) if v.rsplit(':',2)[:2]==[mount['source'],mount['target']]]
            if legacy:
                # Binds has no CreateMountpoint field. Preserve this as unknown,
                # not as a passed creation-policy check or simulated metadata.
                require(len(legacy)==1 and mount['target'] not in host_mounts and Path(mount['source']).exists(), 'legacy_bind_identity_unproven')
                require(legacy[0].rsplit(':',1)[1]==('ro' if mount.get('read_only',False) else 'rw'),'legacy_bind_mode_mismatch')
            else:
                require(actual_options.get('CreateMountpoint',False)==options.get('create_host_path',False),'live_bind_creation_policy_mismatch')
            require(actual_mount_details[mount['target']].get('Propagation','rprivate')==options.get('propagation','rprivate'),'live_bind_propagation_mismatch')
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
    require(host_pairs(host.get('ExtraHosts') or []) == host_pairs(desired.get('extra_hosts', {})),
            'live_extra_hosts_parity_mismatch')
    wanted_restart = desired.get('restart', 'no').split(':', 1)
    require(host.get('RestartPolicy', {}).get('Name', 'no') == wanted_restart[0]
            and host.get('RestartPolicy', {}).get('MaximumRetryCount', 0) ==
            (int(wanted_restart[1]) if len(wanted_restart) == 2 else 0), 'live_restart_parity_mismatch')
    for field, key in (('User', 'user'), ('Cmd', 'command'), ('Entrypoint', 'entrypoint'), ('WorkingDir', 'working_dir')):
        actual, expected = current['Config'].get(field), desired.get(key, image_config.get(field))
        if key in {'command', 'entrypoint'} and expected is None:
            expected = image_config.get(field)  # Compose null inherits; []/'' do not.
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
    # The single approved derivative carries one image-owned provenance label.
    # Only the stopped, pinned failed candidate may lack it before replacement;
    # post-start live validation compares the complete target labels normally.
    provenance = 'cop.continuity.refresh.base'
    if (transition and current.get('Id') == '1f50bd766d3865933d4ea1fcd5cebc27728185f47798855dc4c716d79e76cc45'
            and current.get('Image') == NODE_METADATA_TO_IMAGE
            and desired.get('image') == REPLACEMENT_IMAGE
            and image_config.get('Labels', {}).get('org.opencontainers.image.revision') == REPLACEMENT_REVISION
            and image_config.get('Labels', {}).get(provenance) == NODE_METADATA_TO_IMAGE
            and provenance not in (desired.get('labels') or {})
            and provenance not in actual_public
            and current.get('State', {}).get('Running') is False
            and current.get('State', {}).get('Restarting') is False
            and current.get('State', {}).get('Pid') == 0):
        expected_public.pop(provenance, None)
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

def volume_owned(metadata,volume,source,target):
 # User explicitly approved this exact legacy exception on 4 November2026.
 # It neither mutates ownership nor applies to any other volume/installation.
 return ((metadata.get('Labels') or {}).get('com.docker.compose.project')=='csm-messaging'
         or (volume==metadata.get('Name')=='csm-messaging_messaging-data'
             and source=='messaging-data' and target=='/data'
             and metadata.get('CreatedAt')=='2026-07-08T17:26:43Z'
             and metadata.get('Labels') is None))

def main(accept):
 require(os.geteuid()==0 and os.uname().nodename.split('.')[0]=='comm','ROOT_COMM_REQUIRED')
 original=CASE/'original.compose.json';old_raw=original.read_bytes();boundary=original.stat().st_ctime_ns
 require(sha(old_raw)==PIN_OLD_SHA and PIN.read_bytes()==old_raw.replace(OLD.encode(),IMAGE.encode(),1),'VERIFY_EXACT_KNOWN_PIN')
 current=json.loads(docker('inspect','csm-messaging-api'))[0]
 require(current['Id']==CID and current['Image']==IMAGE and current['State']['Running'] and current['RestartCount']==0 and current['State']['Health']['Status']=='healthy','VERIFY_KNOWN_RUNTIME')
 labels=current['Config']['Labels'];files=labels['com.docker.compose.project.config_files'].split(',')
 require(labels['com.docker.compose.project']=='csm-messaging','VERIFY_PROJECT')
 for file in files:
  if file!=str(PIN):require(Path(file).stat().st_ctime_ns<boundary,'VERIFY_SOURCE_FILE_CHANGED_AFTER_PREFLIGHT')
 require(Path('/srv/csm-messaging/.env').stat().st_ctime_ns<boundary,'VERIFY_ENV_FILE_CHANGED_AFTER_PREFLIGHT')
 args=['docker','--host','unix:///var/run/docker.sock','compose','--project-name','csm-messaging','--project-directory','/srv/csm-messaging','--env-file','/srv/csm-messaging/.env',*[part for file in files for part in ('-f',file)],'config','--format','json']
 config=json.loads(run(args));desired=copy.deepcopy(config['services']['api']);image=json.loads(docker('image','inspect',IMAGE))[0];old_image=json.loads(docker('image','inspect',OLD))[0]
 require(image['Config'].get('Volumes')==old_image['Config'].get('Volumes'),'VERIFY_IMAGE_VOLUME_CONTRACT_CHANGED')
 # Normalize declared named volumes through the Docker API; never access data.
 for mount in desired.get('volumes',[]):
  if mount['type']=='volume':
   volume=config['volumes'][mount['source']]['name'];metadata=json.loads(docker('volume','inspect',volume))[0]
   require(metadata['Name']==volume and volume_owned(metadata,volume,mount['source'],mount['target']),'VERIFY_VOLUME_OWNERSHIP')
   actual=next(v for v in current['Mounts'] if v['Destination']==mount['target'])
   require(actual.get('Name')==volume,'VERIFY_VOLUME_BINDING');mount['source']=metadata['Mountpoint']
 normalized=copy.deepcopy(current);host=normalized['HostConfig']
 runtime_parity(normalized,desired,image['Config'],transition=False)
 # Verify old-image defaults plus unchanged declared environment, in RAM only.
 actual_env=dict(v.split('=',1) for v in current['Config']['Env'] if '=' in v)
 expected=dict(v.split('=',1) for v in old_image['Config'].get('Env',[]) if '=' in v)
 expected.update({k:v.replace('$$','$') if isinstance(v,str) else v for k,v in desired['environment'].items()})
 require(actual_env==expected,'VERIFY_EFFECTIVE_ENVIRONMENT')
 names={config['networks'][n]['name'] for n in desired['networks']}
 require(set(current['NetworkSettings']['Networks'])==names and host['NetworkMode'] in names,'VERIFY_NETWORK_CONTRACT')
 for name in names:
  network=json.loads(docker('network','inspect',name))[0];require(network['Id']==current['NetworkSettings']['Networks'][name]['NetworkID'],'VERIFY_NETWORK_ID')
 require(host.get('CgroupnsMode')=='private' and host.get('LogConfig')=={'Type':'json-file','Config':{}},'VERIFY_DEFAULT_ISOLATION_OR_LOGGING')
 require({'/proc/kcore','/proc/keys','/proc/timer_list','/sys/firmware'}<=set(host.get('MaskedPaths',[])) and {'/proc/sys','/proc/sysrq-trigger'}<=set(host.get('ReadonlyPaths',[])),'VERIFY_KERNEL_PATH_PROTECTION')
 peers=json.loads(docker('inspect',*docker('ps','-aq','--filter','label=com.docker.compose.project=csm-messaging').decode().split()))
 for peer in peers:
  if peer['Id']==CID:continue
  created=datetime.datetime.fromisoformat(peer['Created'].replace('Z','+00:00')).timestamp()
  require(created*1e9<boundary,'VERIFY_PEER_RECREATED_AFTER_PREFLIGHT')
  if peer['State']['Running']:
   started=datetime.datetime.fromisoformat(peer['State']['StartedAt'].replace('Z','+00:00')).timestamp();require(started*1e9<boundary,'VERIFY_PEER_RESTARTED_AFTER_PREFLIGHT')
 for path in ('/health/live','/health/ready'):
  with urllib.request.urlopen('http://127.0.0.1:4050'+path,timeout=8) as response:
   value=json.loads(response.read(65536));require(response.status==200 and value.get('status')=='ok','VERIFY_LIVE_HEALTH')
 result={'contractVersion':'cop-messaging-current-contract-verification-v1','imageId':IMAGE,'sourceRevision':'50e590c1078eb86ed1857cf336196c4bbf1c0fdc','containerId':CID,'healthy':True,'declaredRuntimeContractVerified':False,'currentRuntimeSecurityAndIdentityChecksVerified':True,'legacyBindCreationPolicyVerified':False,'environmentUnchangedAgainstOldImageAndSource':True,'sourceFilesUnchangedAfterPreflight':True,'oldImageVolumeContractPreserved':True,'knownPeersPredateCutover':True,'rawBeforeAfterEqualityPassed':False,'legacyVolumeException':'User-approved exact csm-messaging_messaging-data created2026-07-08T17:26:43Z without labels, source messaging-data target /data; no volume modification','limitation':'The initial raw HostConfig/Mounts comparison failed and the old raw object was not retained. Current security and identity checks are independent observations. Legacy Binds does not expose CreateMountpoint, so creation-time policy remains unverified. This observation does not accept the release or claim complete/raw equality.','actualEnvironmentSha256':sha(canonical(actual_env)),'productionRuntimeChangedByThisVerification':False,'vehicleAdmissionEnabled':actual_env.get('CSM_SHARED_VEHICLE_COMMUNICATION_ADMISSION_ENABLED','false')=='true'}
 if accept:
  path=CASE/'current-runtime-observation.json';fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  try:os.write(fd,canonical(result));os.fsync(fd)
  finally:os.close(fd)
 print(json.dumps(result))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--record-known-current',action='store_true');a=p.parse_args()
 try:main(a.record_known_current)
 except Exception as e:
  code=str(e) if isinstance(e,RuntimeError) else type(e).__name__;print(json.dumps({'verified':False,'code':code,'runtimeChanged':False,'failureLine':traceback.extract_tb(e.__traceback__)[-1].lineno}));raise SystemExit(2)
