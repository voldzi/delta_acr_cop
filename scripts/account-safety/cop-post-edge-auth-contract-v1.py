"""Closed post-Edge authority and health contract; no work on import.

Historical receipts establish lineage only. Fresh readiness is a separate
Root-owned observation with its own bounded lifetime. No deployment API here.
"""
import json
from pathlib import Path

PREPARE='cop-api-post-edge-promotion-v1'
ENABLE='cop-api-post-edge-enable-v1'
ENABLE_AUTH='cop-api-post-edge-enable-oidc-v1'
PROFILE='206c4507-5e00-458e-b0ee-4061309aa7a8'
ORIGINAL_SHA='2604fef958e6d11e93eea95b3d059249a362f3c9efd6137a288bb7e333fb77ae'
ORIGINAL_BINDING='a357dbce7986d120db679fa2f5fccb5a591493eb9445a9e5f2dca20bcf4eac06'
PENDING='8ccb27a02f32da9d3dc85b9a4e0e3748647b1f7a41fef3add34648e301816a2b'
EDGE_SHA='fee2a1c872eacdd43ece0c9cb44e7bb661f9d3f3663020cada1471d82af5762e'
EDGE_ID='a0399ef09e80c68c6799cbed0ae680ecc8c53d3323b2459cb0f1ffdbf0249506'
EDGE_IMAGE='sha256:45ee4c54707ae00fbafbe6d60406096111b50400fab2843ab791c5765c795275'
BASELINE='0d80ff6b78f046ddfcb5ca4b8865ae72aabcc0c8c7f5d76daa9b7cf46d0d7ef2'
CHECKS={'criticalOwnerHealthPolicyReviewed','currentProviderReadinessVerified',
        'currentProducerInventoryVerified','historicalLineagePreserved',
        'edgePeerTransitionVerified','noResetReplay','noOldNineImageAcceptanceReused'}

def digest(r,x):
    return isinstance(x,str) and r.re.fullmatch('[0-9a-f]{64}',x) is not None

def root_json(r,path,expected):
    path=Path(path)
    r.require(path.parent==r.PROFILES/PROFILE,'post_edge_evidence_parent')
    raw=r.private_read(path,0,mode=0o640,gid=1000)
    r.require(r.sha(raw)==expected,'post_edge_evidence_hash')
    return json.loads(raw)

def schema(r,p):
    fields={'contractVersion','transitionId','operation','previous','target','changedKeys',
            'environmentMetadata','composeHashes','ownerAcceptance','checks','cleanReset',
            'postEdgeAuthority','publicFlowObservation'}
    r.require(isinstance(p,dict) and set(p)==fields and p['contractVersion'] in {PREPARE,ENABLE,ENABLE_AUTH}
        and r.PROFILE_UUID.fullmatch(p['transitionId']) and p['ownerAcceptance'] is True,
        'post_edge_proof_schema')
    preparing=p['contractVersion']==PREPARE
    expected_keys=([] if preparing else sorted(['COP_ACCOUNT_ERASURE_ENABLED','COP_AUTH_MODE','COP_ALLOW_LAB_TOKEN'])
        if p['contractVersion']==ENABLE_AUTH else ['COP_ACCOUNT_ERASURE_ENABLED'])
    r.require(p['operation']==('prepare' if preparing else 'enable')
        and p['changedKeys']==expected_keys, 'post_edge_operation')
    r.require(p['target']=={'imageId':r.PUBLIC_FLIGHT_REPAIR_IMAGE,
        'sourceRevision':r.PUBLIC_FLIGHT_REPAIR_REVISION,'profileGeneration':PROFILE},'post_edge_target')
    prev=p['previous']
    r.require(isinstance(prev,dict) and set(prev)=={'contractVersion','generation','releaseId',
        'profileId','profileGeneration','imageId','containerId'}
        and prev['contractVersion']=='cop-api-runtime-active-v1'
        and r.GENERATION.fullmatch(prev['generation']) and r.ID.fullmatch(prev['releaseId'])
        and r.ID.fullmatch(prev['profileId']) and prev['profileGeneration']==PROFILE
        and r.IMAGE.fullmatch(prev['imageId']) and digest(r,prev['containerId']), 'post_edge_previous')
    r.require(isinstance(p['composeHashes'],dict) and set(p['composeHashes'])==set(r.FILES)
        and all(digest(r,v) for v in p['composeHashes'].values()),'post_edge_compose')
    meta=p['environmentMetadata']
    r.require(isinstance(meta,dict) and set(meta)=={'device','inode','size','mtimeNs','ctimeNs'}
        and all(type(v) is int and v>=0 for v in meta.values()),'post_edge_env_metadata')
    required_checks=CHECKS|({'oidcOnlyLabDisabledTransitionApproved'} if p['contractVersion']==ENABLE_AUTH else set())
    r.require(isinstance(p['checks'],dict) and set(p['checks'])==required_checks
        and all(v is True for v in p['checks'].values()),'post_edge_checks')
    a=p['postEdgeAuthority']
    fixed={'contractVersion':'cop-post-edge-authority-v1',
        'originalProofPath':str(r.PROFILES/PROFILE/'account-erasure-a4bac76f-fac1-443c-a744-e7025c8d3a68.json'),
        'originalProofSha256':ORIGINAL_SHA,'originalBindingSha256':ORIGINAL_BINDING,
        'edgeReceiptPath':str(r.PROFILES/PROFILE/'edge-peer-transition-eeadf6d4-1d33-41c2-80a9-ef5d4900ddea.json'),
        'edgeReceiptSha256':EDGE_SHA,'pendingSha256':PENDING}
    hashes={'authorizationRecordSha256','actualProviderReadinessSha256','actualProducerInventorySha256'}
    r.require(isinstance(a,dict) and set(a)==set(fixed)|hashes|{'checkedAt','expiresAt','acceptedPromotionProof'}
        and all(a[k]==v for k,v in fixed.items()) and all(digest(r,a[k]) for k in hashes)
        and 0<r.fenced_timestamp(a['expiresAt'])-r.fenced_timestamp(a['checkedAt'])<=600,'post_edge_authority')
    ref=a['acceptedPromotionProof']
    r.require(ref is None if preparing else isinstance(ref,dict) and set(ref)=={'path','sha256'}
        and digest(r,ref['sha256']) and Path(ref['path']).parent==r.PROFILES/PROFILE
        and r.re.fullmatch('account-erasure-[0-9a-f-]{36}\\.json',Path(ref['path']).name), 'post_edge_prepare_lineage')
    f=p['publicFlowObservation']
    r.require(isinstance(f,dict) and set(f)=={'path','sha256'} and digest(r,f['sha256'])
        and f['path']==str(r.PROFILES/PROFILE/('post-edge-flight-'+p['transitionId']+'.json')), 'post_edge_flow_reference')
    return a

def read_proof(r,store,path,raw,binding):
    store.protected_directory(store.protected_root)
    store.protected_directory(r.PROFILES/PROFILE)
    p=json.loads(raw);a=schema(r,p)
    r.require(Path(path)==r.PROFILES/PROFILE/('account-erasure-'+p['transitionId']+'.json')
        and all(p['target'][k]==binding[k] for k in p['target'])
        and p['previous']['profileId']==binding['profileId']
        and p['previous']['releaseId']==binding['previousReleaseId']
        and ('composeHashes' not in binding or p['composeHashes']==binding['composeHashes']),'post_edge_binding')
    historical=root_json(r,a['originalProofPath'],ORIGINAL_SHA)
    hb={**binding,**historical['target'],'previousReleaseId':historical['previous']['releaseId'],
        'profileId':historical['previous']['profileId'],'composeHashes':historical['composeHashes']}
    # Existing closed historical validator runs without asserting old freshness.
    store.erasure_config_proof(Path(a['originalProofPath']),hb,ORIGINAL_SHA)
    r.require(p['cleanReset']==historical['cleanReset'] and p['composeHashes']==historical['composeHashes'],
        'post_edge_historical_common')
    if p['operation']=='prepare':
        r.require(all(p[k]==historical[k] for k in ('previous','target','environmentMetadata')),
            'post_edge_prepare_common')
    else:
        ref=a['acceptedPromotionProof'];accepted=root_json(r,ref['path'],ref['sha256'])
        r.require(accepted.get('contractVersion')==PREPARE and accepted['transitionId']!=p['transitionId'],
            'post_edge_accepted_prepare')
        ab={**binding,**accepted['target'],'previousReleaseId':accepted['previous']['releaseId'],
            'profileId':accepted['previous']['profileId'],'composeHashes':accepted['composeHashes']}
        read_proof(r,store,Path(ref['path']),r.encoded(accepted),ab)
        r.require(p['previous']['imageId']==r.PUBLIC_FLIGHT_REPAIR_IMAGE
            and p['previous']['releaseId']==r.PREPARED_CONTINUATION_RELEASE
            and p['previous']['containerId']==r.PREPARED_CONTINUATION_CID,'post_edge_enable_source')
        accepted_dir=store.root/'releases'/p['previous']['releaseId']
        accepted_binding=json.loads(r.private_read(accepted_dir/'release.json',store.uid))
        accepted_health=json.loads(r.private_read(accepted_dir/'accepted-public-flight-health.json',store.uid))
        r.require(accepted_binding.get('accountErasureConfig',{}).get('path')==ref['path']
            and accepted_binding['accountErasureConfig'].get('sha256')==ref['sha256']
            and accepted_health.get('contractVersion')=='cop-post-edge-critical-health-v1'
            and accepted_health.get('authorityProofSha256')==ref['sha256']
            and accepted_health.get('operationId')==accepted['transitionId']
            and accepted_health.get('criticalHealthAndDemoPreserved') is True
            and accepted_health.get('unauthorizedRequestsRejected') is True,'post_edge_prepare_not_accepted')
    edge=root_json(r,a['edgeReceiptPath'],EDGE_SHA)
    r.require(edge.get('contractVersion')=='cop-prepared-edge-peer-transition-v1'
        and edge['newPendingSha256']==PENDING and edge['newEdge']['containerId']==EDGE_ID
        and edge['newEdge']['imageId']==EDGE_IMAGE and edge['preservation']['hostConfigUnchanged'] is True,
        'post_edge_peer_lineage')
    evidence(r,p,fresh=False)
    return r.sha(raw),p

def evidence(r,p,fresh=True):
    a=schema(r,p);v=root_json(r,p['publicFlowObservation']['path'],p['publicFlowObservation']['sha256'])
    request={'origin':'http://docker.home.cz:5020','path':'/flight-data/api/v1/cop/tracks',
        'limit':500,'includeStale':True,'source':None,'bbox':None}
    recovered={'httpStatus':200,'responseContractMatches':True,'enabledSources':['adsb_lol'],
        'simServiceAlive':True,'simServiceReady':True}
    limited={'httpStatus':502,'errorCode':'SOURCE_UNAVAILABLE','jsonProblem':True,'allEnabledSourcesFailed':True,
        'onlyUpstream429':True,'upstreamHttpCodes':[429],'enabledSources':['adsb_lol'],
        'simServiceAlive':True,'simServiceReady':True}
    fixed={'contractVersion':'cop-post-edge-observation-v1','operationId':p['transitionId'],
        'edgeReceiptSha256':EDGE_SHA,'preparedPendingSha256':PENDING,
        'targetImageId':r.PUBLIC_FLIGHT_REPAIR_IMAGE,'targetSourceRevision':r.PUBLIC_FLIGHT_REPAIR_REVISION,
        'request':request,'checkedAt':a['checkedAt'],'expiresAt':a['expiresAt'],
        **{k:a[k] for k in ('authorizationRecordSha256','actualProviderReadinessSha256','actualProducerInventorySha256')}}
    r.require(isinstance(v,dict) and set(v)==set(fixed)|{'observation','currentActivePointerSha256','observedSourceSpecSha256'}
        and all(r.encoded(v[k])==r.encoded(x) for k,x in fixed.items())
        and all(digest(r,v[k]) for k in ('currentActivePointerSha256','observedSourceSpecSha256'))
        and r.encoded(v['observation']) in {r.encoded(recovered),r.encoded(limited)},'post_edge_observation')
    if p['operation']=='prepare':
        r.require(v['currentActivePointerSha256']=='b987a423f28f4715d353010d94ced745e479f3d6f41574151d7a8a8df092c70b',
            'post_edge_observation_pointer')
    else:
        r.require(v['currentActivePointerSha256']==r.sha(r.encoded(p['previous'])),'post_edge_enable_pointer')
    if fresh:
        r.require(r.fenced_timestamp(a['checkedAt'])<=r.datetime.now(r.timezone.utc).timestamp()<=r.fenced_timestamp(a['expiresAt']),
            'post_edge_authority_expired')
    return v

def comparison(r,before,after):
    for values in (before,after):r.health_statuses(values)
    ranks={'ok':0,'online':0,'degraded':1,'unavailable':2,'offline':2}
    for url in r.HEALTH_URLS:
        old,new=before[url],after[url]
        r.require(new['httpStatus']==200 and (old['httpStatus']==200 or old['httpStatus']==503),
            'post_edge_health_http')
        if url==r.HEALTH_URLS[-1]:continue
        a={'self':old.get('status'),**old.get('dependencies',{})}
        b={'self':new.get('status'),**new.get('dependencies',{})}
        added=b.keys()-a.keys()
        r.require(not a.keys()-b.keys() and added<={'safety-notification-worker','cop-account-erasure-owners'}
            and all(b[k] in {'ok','online','disabled'} for k in added),'post_edge_health_dependency_set')
        for name,previous in a.items():
            current=b[name]
            if url==r.HEALTH_URLS[2] and name=='flight-data-source':
                r.require(previous in {'ok','degraded'} and current in {'ok','degraded'},'post_edge_flight_status')
            else:
                r.require(current!='unknown' and previous!='unknown' and (current==previous or
                    previous in ranks and current in ranks and ranks[current]<=ranks[previous]),'post_edge_health_regression')
    deps=after[r.HEALTH_URLS[2]].get('dependencies',{})
    critical={'cop-account-erasure-owners','csm-messaging-provider','situation-data-source','safety-data-source',
        'cop-stream-bus','federation-runtime-store','track-history-store','user-profile-store',
        'community-report-store','incident-store','sketch-drawing-store','mobile-device-store','media-storage'}
    r.require(all(deps.get(name)=='ok' for name in critical),'post_edge_critical_dependency')
    old=before[r.HEALTH_URLS[2]]['dependencies'].get('sim-search-data-source')
    new=deps.get('sim-search-data-source')
    r.require(new=='ok' or old==new=='degraded','post_edge_search_regression')
    r.require(deps.get('flight-data-source') in {'ok','degraded'},'post_edge_flight_missing')
    return deps['flight-data-source']

def validate_health(r,store,binding,verified):
    ref=binding['accountErasureConfig'];_,p=store.erasure_config_proof(Path(ref['path']),binding,ref['sha256'])
    obs=evidence(r,p,fresh=True)
    r.public_flight_auth_boundary()
    value=json.loads(verified)
    keys={'contractVersion','criticalHealthAndDemoPreserved','authorityProofSha256','edgeReceiptSha256',
        'externalEvidenceSha256','operationId','baselineSha256','statuses','publicFlightStatus','unauthorizedRequestsRejected'}
    r.require(isinstance(value,dict) and set(value)==keys
        and value['contractVersion']=='cop-post-edge-critical-health-v1'
        and value['criticalHealthAndDemoPreserved'] is True and value['unauthorizedRequestsRejected'] is True
        and value['authorityProofSha256']==ref['sha256'] and value['edgeReceiptSha256']==EDGE_SHA
        and value['externalEvidenceSha256']==p['publicFlowObservation']['sha256']
        and value['operationId']==p['transitionId'] and value['baselineSha256']==BASELINE,'post_edge_health_result')
    raw=r.private_read(r.CLEAN_RESET_DIRECTORY/'pre-stop-health.json',0,mode=0o640,gid=1000)
    r.require(r.sha(raw)==BASELINE,'post_edge_baseline_changed')
    status=comparison(r,json.loads(raw)['statuses'],value['statuses'])
    r.require(status==value['publicFlightStatus'] and (obs['observation']['httpStatus']==502 or status=='ok'),
        'post_edge_health_observation')
    return value
