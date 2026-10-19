"""Fixed clean-release COP bridge. Root reviews; UID1000 guarded Store deploys.
No plain Compose API start, old API fallback, secret output or shared-identity v1.
"""
import copy,contextlib,datetime,hashlib,json,os,re,socket,stat,subprocess,tempfile,types,uuid
from pathlib import Path
BASE=Path('/srv/cop');CONTROL=BASE/'runtime/clean-reset'
PHASES=['identity','cop','ai','driver','files','sim_app_files','sim_user_install','cop_safety_install','remaining','messaging_install','readback','sim_config']
ENV={'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/home/voldzi','LANG':'C','DOCKER_HOST':'unix:///var/run/docker.sock'}
def need(v,c='CLEAN_COP_ACTIVATION_UNPROVEN'):
 if not v:raise RuntimeError(c)
def digest(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def context():need(os.geteuid()==0 and socket.gethostname().split('.')[0]=='docker')
def source(host,plan,relative):
 s=plan['sources']['cop'];p=Path(s['root'])/relative;raw=host.protected(p,mode=(0o444,0o555),max_bytes=1048576);need(digest(raw)==s['files'][relative]);return raw

def modules(host,plan):
 out=[]
 for n,leaf in [('runtime','scripts/cop-api-runtime.py'),('storage','scripts/cop-storage.py')]:
  m=types.ModuleType('clean_cop_'+n);m.__file__=str(Path(plan['sources']['cop']['root'])/leaf);exec(compile(source(host,plan,leaf),m.__file__,'exec'),m.__dict__);out.append(m)
 health_source=source(host,plan,'scripts/cop-health-gate.py').decode()
 class SealedHealthDocker(out[0].Docker):
  def health(self,action,path):
   return self.run(['/usr/bin/python3','-I','-c',health_source,action,*([str(path),'--allow-added-dependency','safety-notification-worker','--allow-added-dependency','cop-account-erasure-owners']if action=='verify'else[])])
 out[0].Docker=SealedHealthDocker
 return out

def programs(host,plan):
 # Import only already sealed/pinned public modules through the actual Node24
 # dependency runtime; do not parse String.raw with ad-hoc text decoding.
 path=str(Path(plan['sources']['cop']['root'])/'scripts/account-safety/install-production-erasure.mjs')
 source(host,plan,'scripts/account-safety/install-production-erasure.mjs')
 code="const m=await import("+json.dumps(path)+");process.stdout.write(JSON.stringify({attest:m.IMAGE_ATTESTATION_PROGRAM,finite:m.FINAL_CONFIGURATION_PROGRAM.split('# Production final-configuration entry follows')[0]}));"
 b=Path(plan['operatorRuntime']['root'])/'runtime';args=[str(b/'lib/ld-musl-x86_64.so.1'),'--library-path',str(b/'lib')+':'+str(b/'usr/lib'),str(b/'usr/local/bin/node'),'--input-type=module','-e',code]
 v=host.command(args,timeout=60);need(len(v)<1048576);return json.loads(v)

def root_file(path,raw):
 d=path.parent.lstat();need(stat.S_ISDIR(d.st_mode)and d.st_uid==0 and not path.parent.is_symlink()and not d.st_mode&0o022)
 if path.exists():
  fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW);s=os.fstat(fd)
  try:need(s.st_uid==0 and s.st_gid==1000 and stat.S_IMODE(s.st_mode)==0o640 and s.st_nlink==1 and os.read(fd,len(raw)+1)==raw)
  finally:os.close(fd)
  return
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o640)
 with os.fdopen(fd,'wb')as f:os.fchown(f.fileno(),0,1000);os.fchmod(f.fileno(),0o640);f.write(raw);f.flush();os.fsync(f.fileno())
 dd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(dd)
 finally:os.close(dd)

def plan_current(host):
 context();return host.validate_plan(json.loads(host.protected(host.PLAN)))

def validate_evidence(plan,result,evidence,enable=False):
 need(result.get('contractVersion')=='cop-sim-common-reset-fenced-v1'and result.get('resetEpoch')==plan['resetEpoch']and result.get('completedPhases')==PHASES and result.get('servicesRestarted')is False and result.get('runtimeFlagsEnabled')is False)
 need(set(evidence)==({'messagingDisabled','sim','messaging','copPrepared'}if enable else{'messagingDisabled','sim','messaging'}))
 s=evidence['sim'];need(s.get('contractVersion')=='sim-composition-activation-v1'and s.get('stage')=='guard-ready-awaiting-cop-canary'and s.get('resetEpoch')==plan['resetEpoch']and s.get('preStopReportSha256')==result['preStopReportSha256']and s.get('globalCopFlagsChanged')is False)
 g=s['guardReadiness'];need(g['resetEpoch']==plan['resetEpoch']and g['privateWeb404']is True and g['operatorUnauthorized401']is True and len(g['checks'])==5 and all(v['ready']is True and v['unauthorizedStatus']==401 for v in g['checks']))
 a=evidence['messaging'];d=evidence['messagingDisabled'];need(d.get('contractVersion')=='cop-messaging-disabled-runtime-result-v1'and d.get('runtimeReady')is True and d.get('erasureEnabled')is False)
 need(a.get('contractVersion')=='cop-messaging-enabled-runtime-result-v1'and a.get('runtimeReady')is True and a.get('accountErasureAcceptanceVerified')is True and a.get('authorityMode')=='database_v2'and a.get('fourFlagsEnabled')is True and a.get('nonErasureEnvironmentPreserved')is True and a.get('nativeContainerPreserved')is True and a.get('oldImageFallback')is False)
 need(a['containerBindings']['csm-matrix-synapse']==d['containerBindings']['csm-matrix-synapse'])
 for n,k in [('csm-messaging-api','messaging_api'),('csm-matrix-synapse','synapse')]:need(a['containerBindings'][n]['image']==plan['candidateImages'][k]and re.fullmatch('[a-f0-9]{64}',a['containerBindings'][n]['id']))
 if enable:need(evidence['copPrepared'].get('contractVersion')=='cop-clean-guarded-runtime-v1'and evidence['copPrepared'].get('erasureEnabled')is False and evidence['copPrepared'].get('resetEpoch')==plan['resetEpoch'])


def capture_cop_pre_stop_health(host,plan):
 need(plan==plan_current(host));r,storage=modules(host,plan);p=programs(host,plan)
 image=plan['candidateImages']['cop_api'];revision=json.loads(host.command(['/usr/bin/docker','image','inspect',image]))[0]['Config']['Labels']['org.opencontainers.image.revision'];need(re.fullmatch('[a-f0-9]{40}',revision))
 # Reuse the existing actual sharp/X5 positive+negative and read-only DB probes.
 script=p['attest'].replace("raw=(base/relative).read_bytes()","raw=(pathlib.Path("+repr(plan['sources']['cop']['root'])+")/relative).read_bytes()").replace("m.__file__=str(base/relative)","m.__file__=str(pathlib.Path("+repr(plan['sources']['cop']['root'])+")/relative)")
 payload={'expectedActive':plan['runtimeBinding'],'imageId':image,'sourceRevision':revision,'fileSha256':{k:plan['sources']['cop']['files'][k]for k in ['scripts/cop-api-runtime.py','scripts/cop-storage.py']}}
 att=json.loads(host.command(['/usr/bin/python3','-I','-c',script],input=json.dumps(payload).encode(),timeout=300));need(att['phase']=='image_profile_attestation_written'and att['imageId']==image)
 remote=host.CommunicationResetTransport();gate=host.RootResetAdmission(remote,host.DriverReportProducerCustody())
 try:
  gate._acquire();gate._assert_files();st=r.Store(uid=1000,guard=storage.preflight);current,directory,binding,profile=st.active();need(current==plan['runtimeBinding']);actual=st.docker.current(directory);need(actual['Id']==current['containerId']and actual['State']['Running']is True)
  health=r.health_statuses(json.loads(st.docker.health('capture',None)));need(health[r.HEALTH_URLS[0]]['httpStatus']==200 and health[r.HEALTH_URLS[1]]['httpStatus']==200)
  proof=host._acceptance_module().validate_for_plan(plan)
  info=CONTROL.lstat();need(info.st_uid==0 and stat.S_IMODE(info.st_mode)in[0o700,0o750]);os.chown(CONTROL,0,1000);os.chmod(CONTROL,0o750)
  value={'contractVersion':'cop-clean-pre-stop-health-v1','resetEpoch':plan['resetEpoch'],'containerId':current['containerId'],'imageId':current['imageId'],'preStopReportSha256':proof['reportSha256'],'checkedAt':datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),'statuses':health}
  web=json.loads(host.command(['/usr/bin/docker','inspect','cop-cop-web-1']))[0];need(web['State']['Running']is True and web['Config']['Labels'].get('com.docker.compose.service')=='cop-web'and web['Config']['Labels'].get('com.docker.compose.project')=='cop')
  root_file(CONTROL/'web-source.json',encoded({'id':web['Id'],'image':web['Image'],'specSha256':digest(encoded({'Config':web['Config'],'HostConfig':web['HostConfig']}))}))
  operators={}
  for leaf in ['scripts/cop-api-runtime.py','scripts/cop-health-gate.py','scripts/cop-storage.py','scripts/deploy-production.sh']:
   f=BASE/leaf;info=f.lstat();need(stat.S_ISREG(info.st_mode)and not f.is_symlink()and info.st_uid==1000);operators[leaf]={'sha256':digest(f.read_bytes()),'uid':info.st_uid,'gid':info.st_gid,'mode':stat.S_IMODE(info.st_mode)}
  root_file(CONTROL/'operator-source.json',encoded(operators))
  root_file(CONTROL/'pre-stop-health.json',encoded(value));return{'contractVersion':'cop-clean-pre-stop-result-v1','resetEpoch':plan['resetEpoch'],'baselineSha256':digest(encoded(value)),'attestationPath':att['attestationPath'],'actualImageProbes':True}
 finally:gate.__exit__(None,None,None)

CHILD=r'''
import json,os,sys,types
from pathlib import Path
assert os.geteuid()==1000 and os.getegid()==1000 and __import__('pwd').getpwuid(1000).pw_dir=='/home/voldzi'
os.environ['HOME']='/home/voldzi'
os.umask(0o077);p=json.load(sys.stdin);mods=[]
for name in ['runtime','storage']:
 m=types.ModuleType('sealed_'+name);m.__file__=p[name+'Path'];exec(compile(p[name+'Source'],m.__file__,'exec'),m.__dict__);mods.append(m)
r,s=mods
class SealedHealthDocker(r.Docker):
 def health(self,action,path):
  return self.run(['/usr/bin/python3','-I','-c',p['healthSource'],action,*([str(path),'--allow-added-dependency','safety-notification-worker','--allow-added-dependency','cop-account-erasure-owners']if action=='verify'else[])])
r.Docker=SealedHealthDocker
with s.operation_lock():
 st=r.Store(guard=s.preflight);need= r.require
 need(st.pointer()==p['expectedActive'],'clean_runtime_active_changed')
 b=st.prepare(p['imageId'],p['sourceRevision'],Path(p['attestationPath']),p['expectedActive']['generation'],erasure_config=Path(p['proofPath']))
 value=st.activate(b['releaseId'],p['expectedActive']['generation'])
 print(json.dumps(value))
'''
def guarded_store(host,plan,r,proof,attestation,revision,current):
 payload={'runtimePath':str(Path(plan['sources']['cop']['root'])/'scripts/cop-api-runtime.py'),'storagePath':str(Path(plan['sources']['cop']['root'])/'scripts/cop-storage.py'),'healthSource':source(host,plan,'scripts/cop-health-gate.py').decode(),'runtimeSource':source(host,plan,'scripts/cop-api-runtime.py').decode(),'storageSource':source(host,plan,'scripts/cop-storage.py').decode(),'expectedActive':current,'imageId':plan['candidateImages']['cop_api'],'sourceRevision':revision,'attestationPath':str(attestation),'proofPath':str(proof)}
 # Public reviewed code travels through stdin. Private Compose resolution and
 # runtime files stay on the server, owned by the existing deployment UID.
 args=['/usr/bin/setpriv','--reuid=1000','--regid=1000','--init-groups','/usr/bin/python3','-I','-c',CHILD]
 return json.loads(host.command(args,input=json.dumps(payload).encode(),timeout=300))

def finite_scope(host,plan):
 p=programs(host,plan);m={'__name__':'clean_finite'};exec(compile(p['finite'],'sealed_finite_configuration','exec'),m);return m

def update_keys(raw,updates,parse):
 before=parse(raw);need(all(isinstance(v,str)and not any(c in v for c in '\0\r\n\"\'$')for v in updates.values()));lines=raw.splitlines(keepends=True)
 for k,v in updates.items():
  found=[i for i,x in enumerate(lines)if x.startswith((k+'=').encode())];need(len(found)<=1)
  line=(k+'='+v).encode()+b'\n'
  if found:lines[found[0]]=line
  else:
   if lines and not lines[-1].endswith(b'\n'):lines[-1]+=b'\n'
   lines.append(line)
 out=b''.join(lines);after=parse(out);need(all(after.get(k)==v for k,v in before.items()if k not in updates));return out


def transition(host,result,private,evidence,operation):
 plan=plan_current(host);validate_evidence(plan,result,evidence,operation=='enable');r,storage=modules(host,plan);scope=finite_scope(host,plan);parse=scope['finite_env_parse'];st=r.Store(uid=1000,guard=storage.preflight)
 report=host._acceptance_module().validate_for_plan(plan);need(report['reportSha256']==result['preStopReportSha256'])
 with storage.operation_lock():
  current,directory,binding,profile=st.active();actual=st.docker.current(directory)
  need(current==(plan['runtimeBinding']if operation=='prepare'else evidence['copPrepared']['active']))
  need(actual['Id']==current['containerId']and actual['Image']==current['imageId'])
  if operation=='prepare':need(actual['State']['Running']is False and actual['State']['Pid']==0)
  else:need(actual['State']['Running']is True and current['imageId']==plan['candidateImages']['cop_api'])
  # Exact reset output is exposed only as a Root:GID1000 non-secret proof.
  root_file(CONTROL/'reset-result.json',encoded(result))
  if operation=='enable':
   statuses=r.health_statuses(json.loads(st.docker.health('capture',None)))
   need(statuses[r.HEALTH_URLS[2]].get('dependencies',{}).get('cop-account-erasure-owners')=='ok','CLEAN_COP_OWNERS_NOT_READY')
  path=BASE/'.env';metadata=r.environment_metadata(path,1000);raw=r.private_read(path,1000,1048576);before=parse(raw)
  if operation=='prepare':
   sim_path=Path('/srv/sim/.env');sim_info=sim_path.lstat();need(sim_info.st_uid in[0,1000]);sim_raw=r.private_read(sim_path,sim_info.st_uid,1048576);sim=parse(sim_raw)
   edge=json.loads(host.command(['/usr/bin/docker','inspect',plan['localWriters']['cop-cop-edge-1']['id']]))[0];need(edge['Image']==plan['localWriters']['cop-cop-edge-1']['image']);edge_env=dict(x.split('=',1)for x in edge['Config']['Env']if'='in x)
   proposed,_=scope['finite_final_environment'](raw,sim_raw,edge_env)
   need(sim['SIM_USER_DATA_COP_TOKEN']==private['simUserInstall']['serviceToken']and sim['SIM_USER_DATA_COP_ACTOR_SECRET']==private['simUserInstall']['identities']['sim_user_data']['actorSecret'])
   proposed=update_keys(proposed,{'COP_ACCOUNT_ERASURE_SCOPE':'cop_sim_shared_identity_v1','COP_KEYCLOAK_SHARED_IDENTITY_DELETE_ACCEPTED':'true','COP_USER_RESET_EPOCH':plan['resetEpoch'],'COP_USER_RESET_TOKENS_NOT_BEFORE':str(plan['tokensNotBefore']),'COP_SIM_USER_DATA_ERASURE_URL':'http://sim-driver-measurements:4020','COP_SIM_USER_DATA_ERASURE_TOKEN':sim['SIM_USER_DATA_COP_TOKEN'],'COP_SIM_USER_DATA_ERASURE_ACTOR_SECRET':sim['SIM_USER_DATA_COP_ACTOR_SECRET']},parse)
  else:
   need(before['COP_ACCOUNT_ERASURE_ENABLED']=='false');proposed=update_keys(raw,{'COP_ACCOUNT_ERASURE_ENABLED':'true'},parse)
  changed={k for k in set(before)|set(parse(proposed))if before.get(k)!=parse(proposed).get(k)};need(changed<=r.CLEAN_ERASURE_CONFIG_KEYS)
  scope['atomic_private_environment'](r,path,metadata,r.sha(raw),proposed,1000,path.stat().st_gid)
  image=plan['candidateImages']['cop_api'];revision=json.loads(host.command(['/usr/bin/docker','image','inspect',image]))[0]['Config']['Labels']['org.opencontainers.image.revision']
  target={'kind':'candidate','releaseId':'release-'+uuid.uuid4().hex,'imageId':image,'sourceRevision':revision,'profileId':current['profileId'],'profileGeneration':current['profileGeneration'],'previousReleaseId':current['releaseId'],'accountErasureConfig':{'cleanScope':'cop_sim_shared_identity_v1'}}
  with tempfile.TemporaryDirectory(prefix='cop-clean-render-',dir='/srv/x5-production/staging/cop')as name:
   d=Path(name);(d/'compose').mkdir();hashes={}
   for leaf in r.FILES:
    public=(BASE/leaf).read_bytes();hashes[leaf]=r.sha(public);(d/'compose'/leaf).write_bytes(public)
   (d/'image.env').write_bytes(st.image_env(target,profile['mode']));(d/'compose.runtime.yml').write_bytes(r.overlay_bytes(target,profile['mode']))
   api=st.docker.config(d,profile['directory'])['services']['cop-api'];image_env=json.loads(host.command(['/usr/bin/docker','image','inspect',image]))[0]['Config'].get('Env',[])
   old=dict(x.split('=',1)for x in actual['Config']['Env']if'='in x);new=dict(x.split('=',1)for x in image_env if'='in x);new.update(api.get('environment',{}))
   keys=sorted(k for k in set(old)|set(new)if(k in old)!=(k in new)or old.get(k)!=new.get(k));need(set(keys)<=r.CLEAN_ERASURE_CONFIG_KEYS)
   reset={'resetEpoch':plan['resetEpoch'],'tokensNotBefore':plan['tokensNotBefore'],'receiptSha256':digest(encoded(result))}
   proof={'contractVersion':r.CLEAN_ERASURE_PROOF_VERSION,'transitionId':str(uuid.uuid4()),'operation':operation,'previous':current,'target':{k:target[k]for k in['imageId','sourceRevision','profileGeneration']},'changedKeys':keys,'environmentMetadata':r.environment_metadata(path,1000),'composeHashes':hashes,'ownerAcceptance':True,'checks':{'jointSyntheticAcceptance':report['contractVersion']=='cop-sim-whole-clean-acceptance-v3','providerClosureVerified':evidence['messaging']['accountErasureAcceptanceVerified'] and all(x['ready'] for x in evidence['sim']['guardReadiness']['checks']),'sharedIdentityDeletionApproved':plan['scope']=='cop_sim_shared_identity_v1','cleanResetVerified':result['completedPhases']==PHASES and result['runtimeFlagsEnabled']is False,'restoreReplayVerified':json.loads(host.protected(host._acceptance_module().REPORT))['recoveryReadbacks']['restored_user_data']['restoredRows']>0},'cleanReset':reset}
   # These checks are backed by the actual pinned whole report, exact reset,
   # completed SIM/Message chain and (for enable) a fresh live COP owner probe.
   r.erasure_environment_changes(old,new,proof)
  proof_path=st.protected_root/current['profileGeneration']/('account-erasure-'+proof['transitionId']+'.json');root_file(proof_path,r.encoded(proof));st.erasure_config_proof(proof_path,target)
  att=st.protected_root/current['profileGeneration']/('attestation-'+image[7:]+'.json');st.attestation(att,target)
 # The reviewed UID1000 Store owns its lock/activation/recovery journal.
 active=guarded_store(host,plan,r,proof_path,att,revision,current)
 fresh=st.docker.current(st.active()[1]);need(fresh['Id']==active['containerId']and fresh['Image']==image and fresh['State']['Running']is True)
 env=dict(x.split('=',1)for x in fresh['Config']['Env']if'='in x);need(env['COP_ACCOUNT_ERASURE_ENABLED']==('true'if operation=='enable'else'false')and env['COP_ACCOUNT_SAFETY_GUARD_REQUIRED']=='true')
 return {'contractVersion':'cop-clean-guarded-runtime-v1','resetEpoch':plan['resetEpoch'],'active':active,'imageId':image,'sourceRevision':revision,'erasureEnabled':operation=='enable','guardRequired':True,'healthAndPublicDemoPreserved':True,'oldImageFallback':False}

def prepare_cop_guarded_runtime(host,result,private,evidence):
 plan=plan_current(host);validate_evidence(plan,result,evidence)
 persist_operator_runtime(host,plan)
 # Resume only the two unchanged, explicitly reset COP sidecars. Never start
 # the old API or any SIM/COMM writer here.
 for name in['cop-cop-edge-1','cop-cop-mcp-1']:
  expected=plan['localWriters'][name];v=json.loads(host.command(['/usr/bin/docker','inspect',expected['id']]))[0];need(v['Image']==expected['image']and v['State']['Running']is False and v['State']['Pid']==0);host.command(['/usr/bin/docker','start',expected['id']])
 result=transition(host,result,private,evidence,'prepare')
 result['web']=publish_web_runtime(host,plan)
 return result

def enable_cop_guarded_runtime(host,result,private,evidence):
 return transition(host,result,private,evidence,'enable')



def persist_operator_runtime(host,plan):
    # Future ordinary deployments/recovery must understand the new guarded
    # binding. Preserve the user's deploy script and every other checkout file.
    before=json.loads(host.protected(CONTROL/'operator-source.json',mode=0o640))
    for leaf in ['scripts/cop-api-runtime.py','scripts/cop-health-gate.py','scripts/cop-storage.py']:
        path=BASE/leaf;old=before[leaf];current=path.lstat();need(stat.S_ISREG(current.st_mode)and not path.is_symlink()and current.st_uid==old['uid']and current.st_gid==old['gid']and stat.S_IMODE(current.st_mode)==old['mode'])
        raw=source(host,plan,leaf);existing=path.read_bytes();need(digest(existing)in[old['sha256'],digest(raw)])
        if existing!=raw:
            temporary=path.with_name('.'+path.name+'.clean-'+str(uuid.uuid4()));fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,old['mode'])
            try:
                with os.fdopen(fd,'wb')as f:os.fchown(f.fileno(),old['uid'],old['gid']);os.fchmod(f.fileno(),old['mode']);f.write(raw);f.flush();os.fsync(f.fileno())
                need(path.read_bytes()==existing and path.lstat().st_ino==current.st_ino);os.replace(temporary,path)
            finally:
                if temporary.exists():temporary.unlink()
            dd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
            try:os.fsync(dd)
            finally:os.close(dd)
    need(digest((BASE/'scripts/deploy-production.sh').read_bytes())==before['scripts/deploy-production.sh']['sha256'],'USER_DEPLOY_SCRIPT_CHANGED')

def publish_web_runtime(host,plan):
 r,storage=modules(host,plan);st=r.Store(uid=1000,guard=storage.preflight)
 with storage.operation_lock():
  baseline=json.loads(host.protected(CONTROL/'web-source.json',mode=0o640));old=json.loads(host.command(['/usr/bin/docker','inspect','cop-cop-web-1']))[0]
  need(old['Id']==baseline['id']and old['Image']==baseline['image']and old['State']['Running']is True and digest(encoded({'Config':old['Config'],'HostConfig':old['HostConfig']}))==baseline['specSha256'])
  image=plan['candidateImages']['cop_web'];image_config=json.loads(host.command(['/usr/bin/docker','image','inspect',image]))[0]
  probe="const f=require('fs');const p='/app/apps/cop-web/dist/assets';if(!f.readdirSync(p).filter(x=>x.endsWith('.js')).some(x=>f.readFileSync(p+'/'+x,'utf8').includes('cop-account-erasure-v2')))process.exit(1)"
  host.command(['/usr/bin/docker','run','--rm','--pull','never','--network','none','--read-only','--cap-drop','ALL','--entrypoint','node',image,'-e',probe])
  active,directory,binding,profile=st.active();args=st.docker.compose(directory,profile['directory']);before=st.docker.config(directory,profile['directory']);peers=st.docker.peers(directory)
  old_base_env=json.loads(host.command(['/usr/bin/docker','image','inspect',old['Image']]))[0]['Config'].get('Env',[]);expected_old=dict(x.split('=',1)for x in old_base_env if'='in x);expected_old.update(before['services']['cop-web'].get('environment',{}));need(dict(x.split('=',1)for x in old['Config']['Env']if'='in x)==expected_old,'CLEAN_WEB_UNREVIEWED_ENVIRONMENT')
  overlay=CONTROL/'web-runtime.compose.json';root_file(overlay,encoded({'services':{'cop-web':{'image':image}}}))
  desired=r.normalized_config(json.loads(st.docker.run(args+['-f',str(overlay),'config','--format','json'])));expected=copy.deepcopy(before);expected['services']['cop-web']['image']=image;need(desired==expected)
  st.docker.run(args+['-f',str(overlay),'up','-d','--no-deps','--no-build','--pull','never','cop-web'])
  new=json.loads(host.command(['/usr/bin/docker','inspect','cop-cop-web-1']))[0];need(new['Image']==image and new['State']['Running']is True and new['Id']!=old['Id'])
  need(set(new['NetworkSettings']['Networks'])==set(old['NetworkSettings']['Networks'])and new['Mounts']==old['Mounts'])
  for key in ['PortBindings','NetworkMode','ReadonlyRootfs','Privileged','CapAdd','CapDrop','SecurityOpt','ExtraHosts']:need(new['HostConfig'].get(key)==old['HostConfig'].get(key))
  need(new['Config']['User']==desired['services']['cop-web'].get('user',image_config['Config'].get('User','')))
  after_peers=st.docker.peers(directory);need(all(after_peers[k]==v for k,v in peers.items()if k!='cop-web')and st.pointer()==active)
  health=types.ModuleType('sealed_web_health');exec(compile(source(host,plan,'scripts/cop-health-gate.py'),'sealed_web_health','exec'),health.__dict__)
  original=json.loads(host.protected(CONTROL/'pre-stop-health.json',mode=0o640))['statuses'];observed=json.loads(st.docker.health('capture',None))
  need(health.no_regression(original,observed,('safety-notification-worker','cop-account-erasure-owners')),'CLEAN_WEB_HEALTH_REGRESSION')
  return {'imageId':image,'containerId':new['Id'],'onlyWebImageChanged':True,'apiContainerPreserved':True,'healthAndPublicDemoPreserved':True}

def pause_failed_candidate(host):
 """No rollback of reset data/credentials and no old unprotected API restart."""
 plan=plan_current(host);r,storage=modules(host,plan);scope=finite_scope(host,plan)
 try:
  with storage.operation_lock():
   path=BASE/'.env';raw=r.private_read(path,1000,1048576);meta=r.environment_metadata(path,1000)
   out=update_keys(raw,{'COP_ACCOUNT_ERASURE_ENABLED':'false'},scope['finite_env_parse'])
   if out!=raw:scope['atomic_private_environment'](r,path,meta,r.sha(raw),out,1000,path.stat().st_gid)
 finally:
  try:
   v=json.loads(host.command(['/usr/bin/docker','inspect','cop-cop-api-1']))[0]
   if v['Image']==plan['candidateImages']['cop_api']and v['Config']['Labels'].get('com.docker.compose.project')=='cop'and v['Config']['Labels'].get('com.docker.compose.service')=='cop-api':host.command(['/usr/bin/docker','stop','--time','20',v['Id']],timeout=40)
  except Exception:raise RuntimeError('CLEAN_COP_FAILURE_PAUSE_UNPROVEN')

# Keep failure handling around the complete transition, including health gates.
_prepare=prepare_cop_guarded_runtime
_enable=enable_cop_guarded_runtime
def prepare_cop_guarded_runtime(host,result,private,evidence):
 try:return _prepare(host,result,private,evidence)
 except BaseException:
  pause_failed_candidate(host);raise

def enable_cop_guarded_runtime(host,result,private,evidence):
 try:return _enable(host,result,private,evidence)
 except BaseException:
  pause_failed_candidate(host);raise
