#!/usr/bin/python3
"""One exact Messaging image only; all existing recovery booleans preserved; defaults to read-only preflight.
No token/role/schema/network/mount change and no automatic retry or rollback.
"""
import argparse,copy,fcntl,hashlib,json,os,re,socket,stat,subprocess,time,urllib.request,uuid
from pathlib import Path
OLD='sha256:c498b7d8a9b410e2de7d6d9760ba0d8a6e419d0ced3a79cfc828520a2947969a'
BUILT='sha256:c91c26ffa966dfc8a29c795109ddf5125063a34f75580281b01724005231754d'
NEW='sha256:16de758aeb4e1e467dfe1bd8eda8f3462769a3df07f5c419ae044025f06ca810'
CONFIG_SHA='51d188fa021d6fa692211c0f1552ba1f2da0707e0b753538a361ef9197dcbf5d'
LAYERS=['sha256:75f1d9657d880da5f75298e8f40e9928bb6e260c50d26f97af196845307e3064', 'sha256:23acdb10d9209891f5f961fa115d7f9bd9970ca17f22947d37941478a82eaf9b', 'sha256:81484bbf8c40d65f4671b97938858f6aeba599904efcc26ee8e39c0de62a164d', 'sha256:46f20c4360143af7ee3bcc8debb03c087a05882231ce1879eef8ce4677703157']
REV='b8595d98d090bd8b7fedf74d3d9f64f1c8ea646e'
FLAGS={}
PIN=Path('/srv/csm-messaging/account-safety/disabled-runtime-portable.compose.json')
PIN_SHA='4e1bbc93839af435b3cb4f6666c1dea7148313985110a48ed1caa333cf2c9ccd'
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

def main(apply):
 need(os.geteuid()==0 and socket.gethostname().split('.')[0]=='comm','ROOT_COMM_REQUIRED')
 os.umask(0o077)
 lock=os.open('/run/cop-messaging-owned-release.lock',os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600)
 try:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  before=inspect(CONTAINER);need(before['Id']=='d717666c080e77450af3921cb2223f16872108d13133f9c77e8d862cf2d4dbf8' and before['Image']==OLD and before['State']['Running'] and before['State'].get('Health',{}).get('Status')=='healthy','MESSAGING_SOURCE_UNHEALTHY_OR_CHANGED')
  labels=before['Config']['Labels'];need(labels['com.docker.compose.project']==PROJECT and labels['com.docker.compose.project.config_files'].split(',')==FILES,'MESSAGING_TOPOLOGY_SOURCE_CHANGED')
  image=json.loads(docker('image','inspect',NEW))[0];need(image['Id']==NEW and image['Config']['Labels']['org.opencontainers.image.revision']==REV,'MESSAGING_TARGET_IDENTITY')
  need(sha(encoded(image['Config']))==CONFIG_SHA and image['RootFS']=={'Type':'layers','Layers':LAYERS} and image['Architecture']=='amd64' and image['Os']=='linux','MESSAGING_TRANSPORT_CONTENT_MISMATCH')
  raw,meta=read_pin();old=json.loads(raw);need(old['services']['api']['image']==OLD and raw.count(OLD.encode())==1,'MESSAGING_PIN_SCOPE')
  expected=copy.deepcopy(old);expected['services']['api']['image']=NEW
  need(all(k not in expected['services']['api']['environment'] for k in FLAGS),'MESSAGING_FLAG_SOURCE_CHANGED')
  expected['services']['api']['environment'].update(FLAGS);after_raw=encoded(expected);after=json.loads(after_raw)
  need(after==expected,'MESSAGING_PIN_SCOPE')
  baseline_config=config();desired=copy.deepcopy(baseline_config['services']['api']);desired['image']=NEW
  need(all(k not in envmap(before['Config']['Env']) for k in FLAGS),'MESSAGING_RUNTIME_FLAG_SOURCE_CHANGED')
  assert_config_environment(before,desired,image)
  host_parity(before,desired,image['Config'])
  baseline_health=health();need(all(v['httpStatus']==200 for v in baseline_health.values()),'MESSAGING_BASELINE_HEALTH')
  peer_ids=peers();file_hashes={p:sha(Path(p).read_bytes()) for p in FILES}
  public={'preflightPassed':True,'oldImage':OLD,'newImage':NEW,'builtArtifactImage':BUILT,'transportConfigAndRootFsVerified':True,'sourceRevision':REV,'otherEnvironmentUnchanged':True,'composeDelta':'services.api.image only','recoveryFlags':FLAGS,'productionChanged':False}
  if not apply:print(json.dumps(public));return
  case=PIN.parent/('native-relogin-release-'+uuid.uuid4().hex);case.mkdir(mode=0o700)
  original=case/'original.compose.json';original.write_bytes(raw);original.chmod(0o400)
  (case/'preflight.json').write_bytes(encoded(public));(case/'preflight.json').chmod(0o600)
  need(inspect(CONTAINER)['Id']==before['Id'] and peers()==peer_ids and all(sha(Path(p).read_bytes())==h for p,h in file_hashes.items()),'MESSAGING_RELEASE_CAS')
  parent=os.open(PIN.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);tmp='.vehicle-image-'+uuid.uuid4().hex
  try:
   fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400,dir_fd=parent)
   try:os.fchown(fd,meta.st_uid,meta.st_gid);os.write(fd,after_raw);os.fchmod(fd,0o444);os.fsync(fd)
   finally:os.close(fd)
   need(sha(PIN.read_bytes())==PIN_SHA,'MESSAGING_PIN_CAS')
   os.replace(tmp,PIN.name,src_dir_fd=parent,dst_dir_fd=parent);os.fsync(parent)
  finally:os.close(parent)
  new_config=config();compare=copy.deepcopy(new_config);compare['services']['api']['image']=OLD
  for k in FLAGS:need(compare['services']['api']['environment'].pop(k)==FLAGS[k],'MESSAGING_FLAG_RENDER_CHANGED')
  need(compare==baseline_config,'MESSAGING_RENDER_CHANGED')
  run(compose()+['up','-d','--no-build','--pull','never','--no-deps','api'])
  deadline=time.monotonic()+120
  while True:
   live=inspect(CONTAINER)
   need(live['Image']==NEW and live['RestartCount']==0,'MESSAGING_TARGET_CHANGED_OR_RESTARTED')
   if live['State'].get('Health',{}).get('Status')=='healthy':break
   need(live['State']['Running'] and time.monotonic()<deadline,'MESSAGING_TARGET_NOT_HEALTHY');time.sleep(1)
  need(live['HostConfig']==before['HostConfig'] and sorted(live['Mounts'],key=lambda x:x['Destination'])==sorted(before['Mounts'],key=lambda x:x['Destination']),'MESSAGING_HOST_CONFIG_CHANGED')
  need({n:v['NetworkID'] for n,v in live['NetworkSettings']['Networks'].items()}=={n:v['NetworkID'] for n,v in before['NetworkSettings']['Networks'].items()},'MESSAGING_NETWORK_CHANGED')
  need(envmap(live['Config']['Env'])=={**envmap(before['Config']['Env']),**FLAGS} and peers()==peer_ids,'MESSAGING_ENVIRONMENT_OR_PEER_CHANGED')
  ready=health();need(ready==baseline_health,'MESSAGING_HEALTH_CHANGED')
  receipt={**public,'productionChanged':True,'deployed':True,'healthy':True,'containerId':live['Id'],'peerContainersPreserved':True,'hostConfigAndMountsPreserved':True,'networkIdsPreserved':True,'pinSha256':sha(after_raw),'case':str(case),'vehicleAdmissionEnabled':envmap(live['Config']['Env']).get('CSM_SHARED_VEHICLE_COMMUNICATION_ADMISSION_ENABLED','false')=='true'}
  (case/'receipt.json').write_bytes(encoded(receipt));(case/'receipt.json').chmod(0o600);print(json.dumps(receipt))
 finally:os.close(lock)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');a=p.parse_args()
 try:main(a.apply)
 except Exception as e:
  code=str(e) if isinstance(e,RuntimeError) and str(e).startswith('MESSAGING_') else 'MESSAGING_RELEASE_NOT_COMPLETE'
  print(json.dumps({'deployed':False,'code':code,'automaticRollback':False}));raise SystemExit(2)
