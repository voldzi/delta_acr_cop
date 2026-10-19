"""Single image-only repair on the accepted OIDC-only runtime.

Old contracts delegate to their immutable source. No I/O occurs on import.
"""
import json,types
from pathlib import Path
PREPARE='cop-api-post-edge-promotion-v1'
ENABLE='cop-api-post-edge-enable-v1'
ENABLE_AUTH='cop-api-post-edge-enable-oidc-v1'
REPAIR='cop-api-continuity-image-repair-v1'
BASE_HELPER='b55a67b226a95327ce8a0734ca64d213cdba04dabadae1031b439049d4073e2b'
PROFILE='206c4507-5e00-458e-b0ee-4061309aa7a8'
BASELINE='0d80ff6b78f046ddfcb5ca4b8865ae72aabcc0c8c7f5d76daa9b7cf46d0d7ef2'
EDGE_SHA='fee2a1c872eacdd43ece0c9cb44e7bb661f9d3f3663020cada1471d82af5762e'
PENDING='8ccb27a02f32da9d3dc85b9a4e0e3748647b1f7a41fef3add34648e301816a2b'
IMAGE='sha256:251374f1b612dec0b0f0335250f91bb44f9e420d0d92bc2a2a3f9bf459b02a0c'
REVISION='c1ca66ff49c8e250ec260bd199f0d41502d8d600'
SOURCE_POINTER={
    'contractVersion':'cop-api-runtime-active-v1',
    'generation':'fe936127c4424fde9f652ca9a64cb8f5',
    'containerId':'33f02e8037e09f7f4fd65200c453abc49de95c96ce7276c2349e83ba09024ccb',
    'profileGeneration':PROFILE,'profileId':PROFILE,
    'imageId':'sha256:7a77ff158165048ff4bbed69cb69548c76260f8bc4e7e385b888ee36a3aa4551',
    'releaseId':'release-39515cdd6741471cbff34b18eed65428'}
PARENT_PATH='/etc/vcode-cop-api-runtime/'+PROFILE+'/account-erasure-2b6be818-38bd-4789-a8c7-4d2d3dab2b66.json'
PARENT_SHA='f5887f33ef2f0f2eca1f8b6c93612d70f02341fe75c350e19f95072234e2949e'

def base(r):
    path=r.PROFILES/PROFILE/('post-edge-promotion-helper-'+BASE_HELPER+'.py')
    raw=r.private_read(path,0,mode=0o640,gid=1000)
    r.require(r.sha(raw)==BASE_HELPER,'continuity_parent_helper_changed')
    mod=types.ModuleType('immutable_post_edge_auth_contract');exec(compile(raw,str(path),'exec'),mod.__dict__)
    return mod

def schema(r,p):
    if p.get('contractVersion')!=REPAIR:return base(r).schema(r,p)
    fields={'contractVersion','transitionId','operation','previous','target','changedKeys','environmentMetadata',
        'composeHashes','ownerAcceptance','checks','cleanReset','postEdgeRepair','publicFlowObservation'}
    r.require(set(p)==fields and p['operation']=='maintain' and p['changedKeys']==[]
        and r.PROFILE_UUID.fullmatch(p['transitionId']) and p['ownerAcceptance'] is True
        and p['previous']==SOURCE_POINTER and bool(SOURCE_POINTER)
        and p['target']=={'imageId':IMAGE,'sourceRevision':REVISION,'profileGeneration':PROFILE},'continuity_repair_scope')
    r.require(r.IMAGE.fullmatch(IMAGE) and r.REVISION.fullmatch(REVISION),'continuity_repair_unpinned')
    checks=base(r).CHECKS|{'imageOnlyContinuityRepairApproved'}
    r.require(isinstance(p['checks'],dict) and set(p['checks'])==checks and all(v is True for v in p['checks'].values()),
        'continuity_repair_checks')
    a=p['postEdgeRepair'];digests={'sourceSpecSha256','authorizationRecordSha256','actualProviderReadinessSha256','actualProducerInventorySha256'}
    fixed={'contractVersion':'cop-continuity-image-repair-authority-v1',
        'parentAuthProof':{'path':PARENT_PATH,'sha256':PARENT_SHA},
        'sourceContainerId':SOURCE_POINTER['containerId'],'sourceReleaseId':SOURCE_POINTER['releaseId']}
    r.require(isinstance(a,dict) and set(a)==set(fixed)|digests|{'checkedAt','expiresAt'}
        and all(a[k]==v for k,v in fixed.items()) and all(base(r).digest(r,a[k]) for k in digests)
        and 0<r.fenced_timestamp(a['expiresAt'])-r.fenced_timestamp(a['checkedAt'])<=600,'continuity_repair_authority')
    f=p['publicFlowObservation']
    r.require(isinstance(f,dict) and set(f)=={'path','sha256'} and base(r).digest(r,f['sha256'])
        and f['path']==str(r.PROFILES/PROFILE/('continuity-repair-flight-'+p['transitionId']+'.json')),
        'continuity_repair_flow_ref')
    return a

def read_proof(r,store,path,raw,binding):
    p=json.loads(raw)
    if p.get('contractVersion')!=REPAIR:return base(r).read_proof(r,store,path,raw,binding)
    a=schema(r,p);store.protected_directory(store.protected_root);store.protected_directory(r.PROFILES/PROFILE)
    r.require(Path(path)==r.PROFILES/PROFILE/('account-erasure-'+p['transitionId']+'.json')
        and all(p['target'][k]==binding[k] for k in p['target'])
        and binding['previousReleaseId']==SOURCE_POINTER['releaseId'] and binding['profileId']==SOURCE_POINTER['profileId']
        and ('composeHashes' not in binding or p['composeHashes']==binding['composeHashes']),'continuity_repair_binding')
    parent=base(r).root_json(r,PARENT_PATH,PARENT_SHA)
    old_binding=json.loads(r.private_read(store.root/'releases'/SOURCE_POINTER['releaseId']/'release.json',store.uid))
    r.require(old_binding['accountErasureConfig']['path']==PARENT_PATH
        and old_binding['accountErasureConfig']['sha256']==PARENT_SHA
        and old_binding['accountErasureConfig']['authScope']=='oidc_no_lab_v1'
        and old_binding['imageId']==SOURCE_POINTER['imageId'] and parent['contractVersion']==ENABLE_AUTH,
        'continuity_repair_parent_binding')
    store.erasure_config_proof(Path(PARENT_PATH),old_binding,PARENT_SHA)
    r.require(all(p[k]==parent[k] for k in ('environmentMetadata','composeHashes','cleanReset')),
        'continuity_repair_common_changed')
    evidence(r,p,fresh=False)
    return r.sha(raw),p

def evidence(r,p,fresh=True):
    if p.get('contractVersion')!=REPAIR:return base(r).evidence(r,p,fresh)
    a=schema(r,p);v=base(r).root_json(r,p['publicFlowObservation']['path'],p['publicFlowObservation']['sha256'])
    request={'origin':'http://docker.home.cz:5020','path':'/flight-data/api/v1/cop/tracks',
        'limit':500,'includeStale':True,'source':None,'bbox':None}
    fixed={'contractVersion':'cop-continuity-image-repair-observation-v1','operationId':p['transitionId'],
        'targetImageId':IMAGE,'targetSourceRevision':REVISION,'sourceContainerId':SOURCE_POINTER['containerId'],
        'currentActivePointerSha256':r.sha(r.encoded(SOURCE_POINTER)),
        'observedSourceSpecSha256':a['sourceSpecSha256'],'request':request,
        **{k:a[k] for k in ('authorizationRecordSha256','actualProviderReadinessSha256','actualProducerInventorySha256','checkedAt','expiresAt')}}
    ok={'httpStatus':200,'responseContractMatches':True,'enabledSources':['adsb_lol'],'simServiceAlive':True,'simServiceReady':True}
    limited={'httpStatus':502,'errorCode':'SOURCE_UNAVAILABLE','jsonProblem':True,'allEnabledSourcesFailed':True,
        'onlyUpstream429':True,'upstreamHttpCodes':[429],'enabledSources':['adsb_lol'],'simServiceAlive':True,'simServiceReady':True}
    r.require(isinstance(v,dict) and set(v)==set(fixed)|{'observation'}
        and all(r.encoded(v[k])==r.encoded(x) for k,x in fixed.items())
        and r.encoded(v['observation']) in {r.encoded(ok),r.encoded(limited)},'continuity_repair_observation')
    if fresh:r.require(r.fenced_timestamp(a['checkedAt'])<=r.datetime.now(r.timezone.utc).timestamp()<=r.fenced_timestamp(a['expiresAt']),
        'continuity_repair_expired')
    return v

def comparison(r,before,after):return base(r).comparison(r,before,after)

def validate_health(r,store,binding,verified):
    ref=binding['accountErasureConfig'];_,p=store.erasure_config_proof(Path(ref['path']),binding,ref['sha256'])
    if p.get('contractVersion')!=REPAIR:return base(r).validate_health(r,store,binding,verified)
    obs=evidence(r,p,True);r.public_flight_auth_boundary();v=json.loads(verified)
    keys={'contractVersion','criticalHealthAndDemoPreserved','authorityProofSha256','edgeReceiptSha256',
        'externalEvidenceSha256','operationId','baselineSha256','statuses','publicFlightStatus','unauthorizedRequestsRejected'}
    r.require(set(v)==keys and v['contractVersion']=='cop-post-edge-critical-health-v1'
        and v['criticalHealthAndDemoPreserved'] is True and v['unauthorizedRequestsRejected'] is True
        and v['authorityProofSha256']==ref['sha256'] and v['edgeReceiptSha256']==EDGE_SHA
        and v['externalEvidenceSha256']==p['publicFlowObservation']['sha256']
        and v['operationId']==p['transitionId'] and v['baselineSha256']==BASELINE,'continuity_repair_health')
    raw=r.private_read(r.CLEAN_RESET_DIRECTORY/'pre-stop-health.json',0,mode=0o640,gid=1000)
    r.require(r.sha(raw)==BASELINE,'continuity_repair_baseline_changed')
    status=comparison(r,json.loads(raw)['statuses'],v['statuses'])
    r.require(status==v['publicFlightStatus'] and (obs['observation']['httpStatus']==502 or status=='ok'),
        'continuity_repair_health_observation')
    return v
