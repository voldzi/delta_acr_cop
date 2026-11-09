#!/usr/bin/python3
"""One exact Messaging image only; all existing recovery booleans preserved; defaults to read-only preflight.
No token/role/schema/network/mount change and no automatic retry or rollback.
"""
import argparse,copy,fcntl,hashlib,json,os,re,socket,stat,subprocess,time,urllib.request,uuid
from pathlib import Path
OLD='sha256:c498b7d8a9b410e2de7d6d9760ba0d8a6e419d0ced3a79cfc828520a2947969a'
BUILT='sha256:833e811399027b5f157ae851a995c19394308764d8f3bd542b42656dc9f3b2d6'
NEW='sha256:78addd837fa62ea3c95f0209ab88acb7e0cb97c96eb965045b794f7f90bfce7b'
CONFIG_SHA='6cc2e6fd4680526045872902dc286c49541e67a8bafda58ae33f8078e51833df'
LAYERS=['sha256:75c137aedfb2760f88629236cb7b797630aed0c3d91d626d1d1bb694878fc2ba', 'sha256:0bfee4189cfab1a56e135b9a9a38b7ad0baecdcfb5702135d5be2c6e88d91797', 'sha256:6b187f29703021305ca9c7e0b9157aa8a7584fde054f0bb4c2d6df45d65e30c6', 'sha256:f8df10ead31c17dbb6d0a70b38b2f6da3535854ed36276763ece161af94ea1a1']
REV='d75124733fab8d3c2e575ee24d955104f9c1b07b'
FLAGS={}
PIN=Path('/srv/csm-messaging/account-safety/disabled-runtime-portable.compose.json')
PIN_SHA='fe8745194c6d158b656cb006a2f53bd0c777d91c5cc761e5e62d3eaf71015529'
CONTAINER='csm-messaging-api';PROJECT='csm-messaging'
FILES=['/srv/csm-messaging/docker-compose.yml','/srv/csm-messaging/docker-compose.pool-budget-20261012.json','/srv/csm-messaging/docker-compose.cop-erasure-candidate-20261015.json','/srv/csm-messaging/docker-compose.livekit-erasure-unix-cc26a20.json','/srv/csm-messaging/docker-compose.messaging-private-client-8012490.json',str(PIN)]
ENV={'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/root','LANG':'C','DOCKER_HOST':'unix:///var/run/docker.sock'}
def need(ok,code):
 if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
# Unchanged functions from accepted guard5938747; no new host defaults allowed.
require=need
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

def run(args):
 p=subprocess.run(args,capture_output=True,env=ENV,timeout=180);need(p.returncode==0,'MESSAGING_COMMAND_FAILED_'+str(args[3] if len(args)>3 and args[0]=='docker' else args[0]).replace('/','_').upper());return p.stdout
def docker(*args):return run(['docker','--host','unix:///var/run/docker.sock',*args])
def inspect(name):return json.loads(docker('inspect',name))[0]
def envmap(values):return dict(x.split('=',1) for x in values if '=' in x)
def compose():return ['docker','--host','unix:///var/run/docker.sock','compose','--project-name',PROJECT,'--project-directory','/srv/csm-messaging','--env-file','/srv/csm-messaging/.env',*[part for f in FILES for part in ('-f',f)]]
def config():return json.loads(run(compose()+['config','--format','json']))
def peers():
 ids=docker('ps','-aq','--filter','label=com.docker.compose.project='+PROJECT).decode().split()
 return {v['Name']:v['Id'] for v in (json.loads(docker('inspect',*ids)) if ids else []) if v['Name']!='/'+CONTAINER}
def health():
 result={}
 for path in ['/health/live','/health/ready']:
  with urllib.request.urlopen('http://127.0.0.1:4050'+path,timeout=8) as r:
   body=json.loads(r.read(65536));result[path]={'httpStatus':r.status,'status':body.get('status')}
 return result
def read_pin():
 fd=os.open(PIN,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and s.st_size<1048576 and stat.S_IMODE(s.st_mode)==0o444,'MESSAGING_PIN_CUSTODY')
  raw=os.read(fd,1048576);need(len(raw)==s.st_size and sha(raw)==PIN_SHA,'MESSAGING_PIN_CHANGED');return raw,s
 finally:os.close(fd)
def assert_config_environment(current,desired,image):
 expected=envmap(image['Config'].get('Env') or [])
 # Compose JSON escapes literal dollars; resolve exactly once in memory.
 expected.update({k:v.replace('$$','$') if isinstance(v,str) else str(v) for k,v in desired['environment'].items()})
 need(expected==envmap(current['Config']['Env']),'MESSAGING_ENVIRONMENT_DELTA')
 for field,key in [('Cmd','command'),('Entrypoint','entrypoint'),('User','user'),('WorkingDir','working_dir')]:
  wanted=desired.get(key,image['Config'].get(field))
  if wanted is None:wanted=image['Config'].get(field)
  actual=current['Config'].get(field)
  if key in {'user','working_dir'} and key not in desired and wanted in (None,''):
   need(actual in (None,''),'MESSAGING_COMMAND_DELTA_'+field.upper())
  else:need(actual==wanted,'MESSAGING_COMMAND_DELTA_'+field.upper())


need(os.geteuid()==0 and socket.gethostname().split('.')[0]=='comm','MESSAGING_READONLY_ROOT_COMM_REQUIRED')
current=inspect(CONTAINER)
need(current['Id']=='9cbb644a5651e4d9e40b461265262c2ca64f26ccc692f2ed3d12bef422ce0eea','MESSAGING_CURRENT_CID_CHANGED')
need(current['Image']==NEW and current['State']['Running'] and current['RestartCount']==0 and current['State'].get('Health',{}).get('Status')=='healthy','MESSAGING_CURRENT_NOT_READY')
cases=[p for p in PIN.parent.glob('vehicle-image-release-*') if (p/'preflight.json').is_file() and json.loads((p/'preflight.json').read_text()).get('newImage')==NEW]
need(len(cases)==1,'MESSAGING_RELEASE_CASE_AMBIGUOUS')
case=cases[0]
need(json.loads((case/'preflight.json').read_text()).get('oldImage')=='sha256:16de758aeb4e1e467dfe1bd8eda8f3462769a3df07f5c419ae044025f06ca810','MESSAGING_DEPLOYMENT_OLD_IMAGE_CHANGED')
original=case/'original.compose.json'
need(sha(original.read_bytes())==PIN_SHA,'MESSAGING_ORIGINAL_PIN_CHANGED')
need(json.loads(original.read_bytes())['services']['api']['image']=='sha256:16de758aeb4e1e467dfe1bd8eda8f3462769a3df07f5c419ae044025f06ca810','MESSAGING_ORIGINAL_IMAGE_CHANGED')
original_files=[str(original) if f==str(PIN) else f for f in FILES]
args=['docker','--host','unix:///var/run/docker.sock','compose','--project-name',PROJECT,'--project-directory','/srv/csm-messaging','--env-file','/srv/csm-messaging/.env',*[part for f in original_files for part in ('-f',f)],'config','--format','json']
old_config=json.loads(run(args));new_config=config();expected=copy.deepcopy(old_config);expected['services']['api']['image']=NEW
need(new_config==expected,'MESSAGING_RENDER_DELTA')
image=json.loads(docker('image','inspect',NEW))[0]
need(sha(encoded(image['Config']))==CONFIG_SHA and image['RootFS']=={'Type':'layers','Layers':LAYERS} and image['Config']['Labels']['org.opencontainers.image.revision']==REV,'MESSAGING_IMAGE_CONTENT_CHANGED')
assert_config_environment(current,new_config['services']['api'],image)
host_parity(current,new_config['services']['api'],image['Config'])
basepath=PIN.parent/'owned-controller-config-19c9b39-v1/raw-before.json'
need(sha(basepath.read_bytes())=='3cbb7542e97dde2ad9945c6f2561a04c4a4ee9ac7846c37bc1f36ec05c18bd2d','MESSAGING_HISTORICAL_BASELINE_CHANGED')
baseline=json.loads(basepath.read_bytes())
diff=[k for k in sorted(set(baseline['HostConfig'])|set(current['HostConfig'])) if baseline['HostConfig'].get(k)!=current['HostConfig'].get(k)]
need(diff in ([],['Binds']),'MESSAGING_UNEXPECTED_HOST_DELTA')
a=copy.deepcopy(baseline['HostConfig']);b=copy.deepcopy(current['HostConfig'])
for v in [a,b]:
 values=v['Binds'];need(len(values)==len(set(values))==3,'MESSAGING_BIND_MULTIPLICITY')
 targets=[x.split(':')[1] for x in values];need(len(set(targets))==len(targets),'MESSAGING_BIND_TARGET_OVERLAP')
 v['Binds']=sorted(values)
need(a==b,'MESSAGING_EFFECTIVE_HOST_DELTA')
need(sorted(baseline['Mounts'],key=lambda x:x['Destination'])==sorted(current['Mounts'],key=lambda x:x['Destination']),'MESSAGING_MOUNTS_DELTA')
need({n:v['NetworkID'] for n,v in baseline['NetworkSettings']['Networks'].items()}=={n:v['NetworkID'] for n,v in current['NetworkSettings']['Networks'].items()},'MESSAGING_NETWORK_DELTA')
oldcase=PIN.parent/'native-relogin-release-e46739b884dd4fbe8b1cf05ab3bc56fc'
need(sha((oldcase/'receipt.json').read_bytes())=='7c981d8d4fbba305d4ab393b45995e5d1c263b2dfd509119c0212157cfea7902','MESSAGING_PRIOR_RECEIPT_CHANGED')
prior=json.loads((oldcase/'receipt.json').read_text())
need(prior['deployed'] and prior['hostConfigAndMountsPreserved'] and prior['newImage']==OLD and prior['oldImage']==baseline['Image'],'MESSAGING_BASELINE_CHAIN_NOT_PROVEN')
ids=docker('ps','-aq','--filter','label=com.docker.compose.project='+PROJECT).decode().split()
ps=[v for v in json.loads(docker('inspect',*ids)) if v['Name']!='/'+CONTAINER]
need(len(ps)==4 and all(v['Created']<current['Created'] and (not v['State']['Running'] or v['State']['StartedAt']<current['Created']) for v in ps) and sum(v['State']['Running'] for v in ps)==2,'MESSAGING_PEERS_CHANGED')
observed_health=health()
need(observed_health=={'/health/live':{'httpStatus':200,'status':'ok'},'/health/ready':{'httpStatus':200,'status':'ok'}},'MESSAGING_HEALTH_NOT_READY')
result={'historicalParityAnchorImage':OLD,'deploymentOldImage':'sha256:16de758aeb4e1e467dfe1bd8eda8f3462769a3df07f5c419ae044025f06ca810','case':str(case),'rootCommHostBound':True,'explicitHealthStatusChecked':True,'contractVersion':'messaging-lookup-readonly-completion-v1','readOnly':True,'productionChangedByThisVerification':False,'imageId':NEW,'sourceRevision':REV,'containerId':current['Id'],'healthy':True,'restartCount':current['RestartCount'],'renderDelta':'services.api.image only','environmentMatchesApprovedRender':True,'originalPinSha256':PIN_SHA,'currentPinSha256':sha(PIN.read_bytes()),'historicalHostBaselineSha256':sha(basepath.read_bytes()),'historicalBaselineImage':baseline['Image'],'historicalPriorSuccessfulReceiptSha256':sha((oldcase/'receipt.json').read_bytes()),'immediateBeforeInspectRetained':False,'hostDifferenceKeysAgainstHistoricalBaseline':diff,'exactBindValuesUnchanged':True,'currentHostRawEqualHistoricalBaseline':diff==[],'otherHostConfigRawEqualAgainstHistoricalBaseline':True,'mountsRawEqualAfterSortingByDestination':True,'networkIdsEqualToHistoricalBaseline':True,'peerCount':len(ps),'activePeerCount':2,'historicalStoppedPeerCount':2,'peersPredateCandidate':True,'health':observed_health,'originalFailurePreserved':True,'ownerOperationPerformed':False,'limitation':'Immediate pre-switch HostConfig existed only in installer memory. Historical root-held baseline plus prior successful image-only raw-parity receipt and current exact declared render were checked independently; not claimed as fresh before/after raw equality.'}
print(json.dumps(result))
