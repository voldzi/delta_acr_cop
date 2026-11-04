import copy,datetime,hashlib,json,re,runpy,time
from pathlib import Path
p=Path('/srv/csm-messaging/account-safety/controller-only-executor-v1.py');assert hashlib.sha256(p.read_bytes()).hexdigest()=='f476afad20da3c877bcd1a5d8a98ba0a54c12659830a41f8d51e989492bffbc3';n=runpy.run_path(str(p),run_name='readonly_contract_observation');o=n['Live']();need=n['need'];sha=n['sha'];enc=n['encoded'];case=p.parent/'startup-image-19c9b39-v1';start=json.loads((case/'started.json').read_text());v=o.inspect();i=json.loads(o.docker('image','inspect',start['newImage']))[0];render=o.render();service=render['services']['api'];cfg=v['Config'];host=v['HostConfig'];checks={}
checks['identity']=v['Id']=='d75a44cd259ececd4627fd8a06cf9cfdf3a2e96ce237dd461798d4e6bf95c811' and v['Image']==start['newImage'] and cfg['Image']==start['newImage'] and service['image']==start['newImage']
checks['source']=i['Config']['Labels'].get('org.opencontainers.image.revision')=='19c9b39669877dfeacbe1bd996e9c8da7c4cd1ec'
checks['healthyZeroRestarts']=v['RestartCount']==0 and v['State']['Running'] and v['State'].get('Health',{}).get('Status')=='healthy'
old_render=copy.deepcopy(render);old_render['services']['api']['image']=start['oldImage'];checks['oldDeclarationUnchangedExceptImage']=sha(enc(old_render))==start['oldRenderDigest']
oldpin=json.loads((case/'original-pin.json').read_text());expectedpin=copy.deepcopy(oldpin);expectedpin['services']['api']['image']=start['newImage'];checks['pinImageOnly']=json.loads(o.read(n['PIN']))==expectedpin
expectedinputs=dict(start['inputHashes']);expectedinputs[str(n['PIN'])]=sha(o.read(n['PIN']));checks['inputFilesUnchangedExceptImage']=o.inputs()==expectedinputs
imageenv=n['envmap'](i['Config'].get('Env') or []);imageenv.update({k:x.replace('$$','$') if isinstance(x,str) else str(x) for k,x in service['environment'].items()});runtimeenv=n['envmap'](cfg['Env']);checks['environmentExactMapRejectDuplicates']=runtimeenv==imageenv
checks['gatesOffControllerUnset']=runtimeenv.get(n['ADMISSION'],'false')=='false' and not runtimeenv.get('CSM_VEHICLE_CONTROLLER_MATRIX_USER_ID') and runtimeenv.get('CSM_VEHICLE_CONTROLLER_CUSTODY_REVIEWED','false')=='false'
expectedcfg=copy.deepcopy(i['Config'])
for sk,ck in [('user','User'),('working_dir','WorkingDir'),('entrypoint','Entrypoint'),('command','Cmd')]:
 if sk in service:expectedcfg[ck]=str(service[sk]) if sk=='user' else service[sk]
if 'healthcheck' in service:
 h=dict(expectedcfg.get('Healthcheck') or {})
 for sk,ck in [('test','Test'),('interval','Interval'),('timeout','Timeout'),('retries','Retries'),('start_period','StartPeriod'),('start_interval','StartInterval')]:
  if sk in service['healthcheck']:
   val=service['healthcheck'][sk]
   if sk not in ('test','retries'):
    parts=re.findall(r'(\d+(?:\.\d+)?)(ns|us|ms|s|m|h)',str(val));need(''.join(x+y for x,y in parts)==str(val),'HEALTHCHECK_DURATION_FORMAT')
    val=int(sum(float(x)*{'ns':1,'us':1000,'ms':1000000,'s':1000000000,'m':60000000000,'h':3600000000000}[y] for x,y in parts))
   h[ck]=val
 if service['healthcheck'].get('disable'):h['Test']=['NONE']
 expectedcfg['Healthcheck']=h
expectedcfg['User']=expectedcfg.get('User') or ''
checks['resolvedProcessAndHealthcheck']=all(cfg.get(k)==expectedcfg.get(k) for k in ('User','WorkingDir','Entrypoint','Cmd','Healthcheck','ExposedPorts','Volumes'))
checks['processDefaults']=cfg['Hostname']==v['Id'][:12] and cfg.get('Domainname','')=='' and not any(cfg.get(k,False) for k in ('AttachStdin','Tty','OpenStdin','StdinOnce'))
labels=dict(i['Config'].get('Labels') or {});labels.update(service.get('labels',{}));checks['declaredLabels']=all(cfg['Labels'].get(k)==x for k,x in labels.items())
checks['composeFiles']=cfg['Labels']['com.docker.compose.project.config_files'].split(',')==n['FILES'];checks['composeImage']=cfg['Labels']['com.docker.compose.image']==start['newImage']
checks['security']=host.get('Privileged',False)==service.get('privileged',False)==False and host.get('ReadonlyRootfs',False)==service.get('read_only',False) and set(host.get('CapAdd') or [])==set(service.get('cap_add') or []) and set(host.get('CapDrop') or [])==set(service.get('cap_drop') or []) and sorted(host.get('SecurityOpt') or [])==sorted(service.get('security_opt') or [])
checks['restartPolicy']=host['RestartPolicy']=={'Name':service.get('restart','no'),'MaximumRetryCount':0}
ports={}
for x in service.get('ports',[]):ports.setdefault(str(x['target'])+'/'+x.get('protocol','tcp'),[]).append({'HostIp':x.get('host_ip',''),'HostPort':str(x.get('published',''))})
checks['portBindings']=host.get('PortBindings',{})==ports
expected_networks={render['networks'][k]['name'] for k in service.get('networks',{})};checks['networks']=set(v['NetworkSettings']['Networks'])==expected_networks
expected=[]
for m in service.get('volumes',[]):
 t=m['type'];source=m['source']
 if t=='volume':source=render['volumes'][source]['name']
 expected.append((t,source,m['target'],not m.get('read_only',False),m.get('bind',{}).get('propagation','rprivate') if t=='bind' else ''))
actual=[(m['Type'],m.get('Name') if m['Type']=='volume' else m['Source'],m['Destination'],m['RW'],m.get('Propagation','')) for m in v['Mounts']]
checks['allMountIdentityReadOnlyPropagation']=sorted(actual)==sorted(expected) and len({x[2] for x in actual})==len(actual) and len({x[2] for x in expected})==len(expected)
generated={'com.docker.compose.config-hash','com.docker.compose.container-number','com.docker.compose.depends_on','com.docker.compose.image','com.docker.compose.oneoff','com.docker.compose.project','com.docker.compose.project.config_files','com.docker.compose.project.environment_file','com.docker.compose.project.working_dir','com.docker.compose.replace','com.docker.compose.service','com.docker.compose.version'}
checks['labelKeysExact']=set(cfg['Labels'])==set(labels)|generated
checks['generatedLabelIdentity']=cfg['Labels']['com.docker.compose.project']=='csm-messaging' and cfg['Labels']['com.docker.compose.service']=='api' and cfg['Labels']['com.docker.compose.oneoff']=='False' and cfg['Labels']['com.docker.compose.container-number']=='1' and cfg['Labels']['com.docker.compose.project.working_dir']=='/srv/csm-messaging' and cfg['Labels']['com.docker.compose.project.environment_file']==str(n['ENVFILE']) and cfg['Labels']['com.docker.compose.replace']==n['CONTAINER'] and cfg['Labels']['com.docker.compose.depends_on']=='' and cfg['Labels']['com.docker.compose.config-hash']==o.run(o.compose()+['config','--hash','api']).decode().split()[-1]
namespace={'NetworkMode':'csm-messaging_default','PidMode':'','IpcMode':'private','UTSMode':'','UsernsMode':'','CgroupnsMode':'private'}
checks['namespaceModes']=all(host.get(k)==x for k,x in namespace.items()) and all(k not in service for k in ('network_mode','pid','ipc','uts','userns_mode','cgroup'))
checks['noUnexpectedDevicesOrVolumesFrom']=all(not host.get(k) for k in ('Devices','DeviceRequests','DeviceCgroupRules','VolumesFrom','ExtraHosts')) and all(not service.get(k) for k in ('devices','device_cgroup_rules','volumes_from','extra_hosts')) and not service.get('deploy',{}).get('resources',{}).get('reservations',{}).get('devices')
net=json.loads(o.docker('network','inspect','csm-messaging_default'))[0];fixed_network='7a0181a5ec6632c76960f7dc7d3c2e0d6568ebfd361decfafadb8f498c314313'
peervs=json.loads(o.docker('inspect',*n['BASELINE']['peers'].values()))
checks['currentNetworkObjectAndPeerAttachments']=net['Id']==fixed_network and v['NetworkSettings']['Networks']['csm-messaging_default']['NetworkID']==fixed_network and v['Id'] in net['Containers'] and all(x['NetworkSettings']['Networks'].get('csm-messaging_default',{}).get('NetworkID',fixed_network)==fixed_network for x in peervs) and n['BASELINE']['peers']['/csm-matrix-synapse'] in net['Containers']
# Finite known mount profile. Reject an unhandled declared option, rather than
# dropping it from comparison. Legacy create_host_path remains explicitly unproven.
checks['mountDeclarationsSupported']=all(set(m)<={'type','source','target','read_only','bind','volume','consistency'} and not m.get('consistency') and set(m.get('bind',{}))<={'create_host_path','propagation'} and not m.get('bind',{}).get('propagation') and not m.get('volume',{}) for m in service.get('volumes',[]))
expectedbinds=[];expectedstructured=[]
for m in service.get('volumes',[]):
 source=render['volumes'][m['source']]['name'] if m['type']=='volume' else m['source'];target=m['target'];ro=m.get('read_only',False)
 # This pre-existing livekit binding uses structured Docker Mounts; the three
 # other pre-existing mounts use Binds. No cross-form options are discarded.
 if target=='/run/csm-livekit-erasure':expectedstructured.append({'Type':'bind','Source':source,'Target':target,'ReadOnly':ro,'BindOptions':{}})
 else:expectedbinds.append(source+':'+target+(':'+'ro' if ro else ':'+'rw'))
checks['allExposedBindAndStructuredOptions']=sorted(host.get('Binds') or [])==sorted(expectedbinds) and sorted(host.get('Mounts') or [],key=lambda m:m['Target'])==sorted(expectedstructured,key=lambda m:m['Target'])
checks['peers']=o.peers()==n['BASELINE']['peers']
time.sleep(10);w=o.inspect();checks['stableProcess']=w['Id']==v['Id'] and w['State']['Pid']==v['State']['Pid'] and w['State']['StartedAt']==v['State']['StartedAt'] and w['RestartCount']==0 and w['State'].get('Health',{}).get('Status')=='healthy'
result={'contractVersion':'cop-messaging-current-runtime-observation-v6','observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':'19c9b39669877dfeacbe1bd996e9c8da7c4cd1ec','image':v['Image'],'container':v['Id'],'checks':checks,'allSelectedChecksPassed':all(checks.values()),'historicalRawParity':False,'originalFailureRetained':True,'mountCreationTimePolicyProven':False,'historicalNetworkIdsProven':False,'uncheckedRuntimeFieldsRemainOutOfScope':True,'observationOnly':True,'configurationChanged':False,'erasureOwnerCompleteClaimed':False,'admissionEnabled':False,'runtimeDigest':sha(enc(n['runtime_spec'](v))),'renderDigest':sha(enc(render)),'pinSha256':sha(o.read(n['PIN']))}
print(json.dumps(result))
if all(checks.values()):
 o.journal.__func__.__globals__['CASE']=case;o.journal('current-runtime-observation-v6.json',result)
