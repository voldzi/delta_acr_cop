"""Fixed source proposal, no writer or authority. Sensitive bytes stay in RAM.
The future attended Root publisher must atomically commit, then finalize with
actual filesystem metadata, freeze documents, and invoke the guarded worker.
"""
import copy,datetime,os,uuid
from pathlib import Path
BASE_GENERATION='55190b1dc87f4bf59dec02d3396c41a3'
class Proposal:
 __slots__=('_writes','_source','public','_finish')
 def __init__(self,writes,source,public,finish):self._writes,self._source,self.public,self._finish=writes,source,public,finish
 def __repr__(self):return '<COP bounded one-flag proposal; private bytes redacted>'
 def consume_originals(self):
  if self._source is None:raise ValueError('WINDOW_ORIGINALS_ALREADY_CONSUMED')
  value,self._source=self._source,None;return value
 def consume_source_writes(self):
  if self._writes is None:raise ValueError('WINDOW_PROPOSAL_ALREADY_CONSUMED')
  value,self._writes=self._writes,None;return value
 def finalize(self,target_metadata,target_hashes):
  if self._writes is not None:raise ValueError('WINDOW_SOURCE_COMMIT_REQUIRED')
  return self._finish(target_metadata,target_hashes)

def propose(r,store,k,contract,stage,window_reference,baseline_raw):
 k.need(os.geteuid()==0 and store.source==Path('/srv/cop') and stage in ('open','close'),'WINDOW_FIXED_ROOT_PROPOSAL')
 w=k.window(store.post_edge_runtime(),{'windowReference':window_reference,'stage':stage},True)
 active,directory,binding,profile=store.active();k.need(k.FLAG not in profile.get('values',{}),'WINDOW_PROFILE_OVERRIDES_FLAG');k.need(active['imageId']==k.IMAGE and binding['sourceRevision']==k.SOURCE and binding['profileGeneration']==k.PROFILE,'WINDOW_CURRENT_SOURCE')
 if stage=='open':k.need(active['generation']==BASE_GENERATION,'WINDOW_REVIEW_BASELINE_CHANGED')
 current=store.docker.current(directory);proc={'pid':current['State']['Pid'],'startedAt':current['State']['StartedAt'],'restartCount':current['RestartCount'],'running':current['State']['Running'],'health':current['State'].get('Health',{}).get('Status')}
 k.need(current['Id']==active['containerId'] and proc['restartCount']==0 and proc['running'] is True and proc['health']=='healthy','WINDOW_SOURCE_NOT_HEALTHY')
 rows=[s.split('=',1) for s in current['Config']['Env']];k.need(all(len(x)==2 for x in rows) and len({x[0] for x in rows})==len(rows),'WINDOW_SOURCE_ENV_AMBIGUOUS');actual=dict(rows)
 parentref=copy.deepcopy(binding['accountErasureConfig']);parent_raw=r.private_read(Path(parentref['path']),0,mode=0o640,gid=1000);k.need(k.sha(parent_raw)==parentref['sha256'],'WINDOW_PARENT_PROOF_CHANGED');parent=k.parse(parent_raw)
 if stage=='open':k.need(parent['contractVersion']==k.VERSION,'WINDOW_OPEN_PARENT')
 else:k.need(parent['contractVersion']==k.WINDOW_VERSION and parent['stage']=='open' and parent['windowReference']==window_reference,'WINDOW_CLOSE_PARENT')
 before_env=r.private_read(store.source/'.env',store.uid,limit=1048576);before_metadata=r.environment_metadata(store.source/'.env',store.uid);files={name:r.private_read(store.source/name,store.uid,limit=65536) for name in r.FILES};before_hashes={name:k.sha(raw) for name,raw in files.items()}
 k.need(before_metadata==parent['environmentMetadata'] and before_hashes==parent['composeHashes'],'WINDOW_SOURCE_FILES_CHANGED')
 after_env=contract.env_delta(before_env,stage);after_files=copy.deepcopy(files);after_files['docker-compose.yml']=contract.compose_delta(files['docker-compose.yml'],stage);after_hashes={name:k.sha(raw) for name,raw in after_files.items()};desired={**actual,k.FLAG:'true' if stage=='open' else 'false'};contract.effective_delta(actual,desired,stage)
 r.health_statuses(k.parse(baseline_raw));old_release=r.private_read(directory/'release.json',store.uid)
 transition=str(uuid.uuid5(uuid.UUID(w['windowId']),'cop-'+stage));stamp=lambda t:datetime.datetime.fromtimestamp(t,datetime.timezone.utc).isoformat().replace('+00:00','Z');now=int(r.datetime.now(r.timezone.utc).timestamp());end=min(now+900,w['deadline'],w['openBefore']) if stage=='open' else now+900;k.need(end>now,'WINDOW_PROPOSAL_EXPIRED')
 fields={'contractVersion':k.WINDOW_VERSION,'transitionId':transition,'operation':'maintain','stage':stage,'windowReference':copy.deepcopy(window_reference),'previous':copy.deepcopy(active),'target':{'imageId':k.IMAGE,'sourceRevision':k.SOURCE,'profileGeneration':k.PROFILE},'changedKeys':[k.FLAG],'ownerAcceptance':True,'checks':copy.deepcopy(parent['checks']),'cleanReset':copy.deepcopy(parent['cleanReset']),'parentProof':parentref,'sourceEnvironmentMetadata':before_metadata,'sourceComposeHashes':before_hashes,'sourceSpecSha256':k.sha(r.encoded(r.fenced_public_source_spec(current))),'baselineSha256':k.sha(baseline_raw),'checkedAt':stamp(now),'expiresAt':stamp(end)}
 peers=store.docker.peers(directory);k.need(store.pointer()==active,'WINDOW_PROPOSAL_CAS_CHANGED')
 public={'stage':stage,'transitionId':transition,'imageUnchanged':k.IMAGE,'sourceGeneration':active['generation'],'sourceProcess':proc,'sourceContainer':active['containerId'],'sourceSpecSha256':fields['sourceSpecSha256'],'sourceEnvironmentSha256':k.sha(k.encode(actual)),'sourceEnvironmentMetadata':before_metadata,'sourcePeers':copy.deepcopy(peers),'onlyFlag':k.FLAG,'changedFiles':['.env']+(['docker-compose.yml'] if stage=='open' else []),'goIssued':False,'productionChanged':False}
 def finish(target_metadata,target_hashes):
  k.need(target_hashes==after_hashes,'WINDOW_ACTUAL_TARGET_HASHES_CHANGED');p=copy.deepcopy(fields);p['environmentMetadata']=copy.deepcopy(target_metadata);p['composeHashes']=copy.deepcopy(target_hashes)
  c={'contractVersion':'cop-root-vehicle-window-case-v1','caseId':transition,**{key:copy.deepcopy(p[key]) for key in ('stage','windowReference','previous','target','parentProof','sourceEnvironmentMetadata','environmentMetadata','sourceComposeHashes','composeHashes','sourceSpecSha256','baselineSha256','checkedAt','expiresAt')},'sourceEnvironmentSha256':k.sha(k.encode(actual)),'targetEnvironmentSha256':k.sha(k.encode(desired)),'sourceProcess':copy.deepcopy(proc),'sourcePeers':copy.deepcopy(peers),'parentReleaseSha256':k.sha(old_release)}
  case_name='vehicle-window-case-'+transition+'.json';case_raw=k.encode(c)+b'\n';p['caseReference']={'path':str(r.PROFILES/k.PROFILE/case_name),'sha256':k.sha(case_raw)}
  return {'documents':{case_name:case_raw,'account-erasure-'+transition+'.json':k.encode(p)+b'\n','planning-config-v3-source-health-'+transition+'.json':baseline_raw},'proofPath':str(r.PROFILES/k.PROFILE/('account-erasure-'+transition+'.json')),'attestationPath':binding['attestationPath'],'expected':active['generation'],'sourceCanonical':r.fenced_public_source_spec(current),'sourceEnvironmentSha256':k.sha(k.encode(actual)),'sourceProcess':copy.deepcopy(proc),'sourcePeers':copy.deepcopy(peers),'goIssued':False,'productionActivated':False}
 return Proposal({'.env':after_env,**{name:after_files[name] for name in r.FILES if files[name]!=after_files[name]}},{'.env':before_env,**files},public,finish)
