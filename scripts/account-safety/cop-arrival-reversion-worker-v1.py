"""Guarded reversion coordinator for the two approved images; never deletes evidence."""
import copy,json,os,uuid
from pathlib import Path

def revert(r,store,proof_path,attestation,expected):
    authority=store.post_edge_module()
    raw=r.private_read(proof_path,store.protected_uid,mode=0o640,gid=store.protected_gid)
    proof=json.loads(raw);authority.schema(r,proof)
    r.require(proof['contractVersion']==authority.REVERSE,'arrival_reversion_contract_required')
    previous=proof['previous'];witness=proof['reversion']
    journal_path=store.root/'arrival-reversion-pending.json'
    journal=r.private_json(journal_path,store.uid) if journal_path.exists() else None
    pointer=store.check_cas(expected)
    profile=store.profile(authority.PROFILE,json.loads(r.private_read(store.root/'releases'/witness['sourceReleaseId']/'release.json',store.uid))['driverContract'])
    source_dir,source_binding,_=store.binding(witness['sourceReleaseId'])
    r.require(source_binding['imageId']==authority.NEW and source_binding['sourceRevision']==authority.NEW_REVISION,'arrival_reversion_forward_release')
    history=store.root/'arrival-reversion-history'
    store.directory(history,create=True)
    archive=history/proof['transitionId'];store.directory(archive,create=True)
    def pending_bytes(name,digest):
        path=store.root/name
        if path.exists():raw_value=r.private_read(path,store.uid)
        else:raw_value=r.private_read(archive/('superseded-'+name),store.uid)
        r.require(r.sha(raw_value)==digest,'arrival_reversion_pending_changed')
        return raw_value
    original_pending=None
    if witness['mode']=='pending':
        original_pending=json.loads(pending_bytes('pending.json',witness['pendingForwardSha256']))
        r.require(original_pending['contractVersion']=='cop-api-runtime-pending-v1' and original_pending['previous']==previous and original_pending['targetReleaseId']==witness['sourceReleaseId'] and original_pending['restoredContainerId'] is None,'arrival_reversion_pending_scope')
        baseline=pending_bytes('pending-health.json',witness['pendingHealthSha256'])
        peers=original_pending['peers']
    else:
        r.require(not(store.root/'pending.json').exists(),'arrival_reversion_unexpected_pending')
        peers=store.docker.peers(source_dir)
        parent=json.loads(r.private_read(Path(proof['parentProof']['path']),store.protected_uid,mode=0o640,gid=store.protected_gid))
        baseline=r.private_read(store.protected_root/authority.PROFILE/('arrival-source-health-'+parent['transitionId']+'.json'),store.protected_uid,mode=0o640,gid=store.protected_gid)
        r.require(r.sha(baseline)==witness['baselineSha256'],'arrival_reversion_baseline_changed')
    if journal is None:
        r.require(pointer==previous,'arrival_reversion_stale_pointer')
        authority.evidence(r,proof,True)
        actual=store.docker.current(source_dir)
        r.require(actual['Id']==witness['sourceContainerId'] and actual['Image']==witness['sourceImage'] and r.sha(r.encoded(r.fenced_public_source_spec(actual)))==proof['sourceSpecSha256'],'arrival_reversion_source_changed')
        if actual['Image']==authority.NEW:
            store.docker.live(source_dir,source_binding,profile)
            r.require(original_pending is None or original_pending['targetContainerId'] in (None,actual['Id']),'arrival_reversion_target_cid')
        else:
            r.require(witness['mode']=='pending' and actual['Image']==authority.OLD and actual['Id']==previous['containerId'],'arrival_reversion_not_started_scope')
            old_dir,old_binding,old_profile=store.binding(previous['releaseId'])
            store.docker.live(old_dir,old_binding,old_profile)
        r.require(store.docker.peers(source_dir)==peers,'arrival_reversion_peer_changed')
        r.require(r.sha(baseline)==witness['baselineSha256'],'arrival_reversion_baseline_changed')
        r.health_statuses(json.loads(baseline))
        binding=copy.deepcopy(source_binding)
        binding.update(releaseId='release-'+uuid.uuid4().hex,imageId=authority.OLD,sourceRevision=authority.OLD_REVISION,previousReleaseId=previous['releaseId'],attestationPath=str(attestation),acceptedHealthSha256=None)
        attestation_sha,contract,legacy_cid,legacy_presence=store.attestation(attestation,binding)
        r.require(contract==source_binding['driverContract'] and legacy_cid is None and legacy_presence is None,'arrival_reversion_profile_changed')
        binding.update(attestationSha256=attestation_sha,accountErasureConfig={'path':str(proof_path),'sha256':r.sha(raw),'cleanScope':'cop_sim_shared_identity_v1','authScope':r.POST_EDGE_AUTH_SCOPE})
        store.erasure_config_proof(proof_path,binding,r.sha(raw))
        store.check_mounts(binding,profile);store.docker.image(binding['imageId'],revision=binding['sourceRevision'])
        directory=store.directory(store.root/'releases'/binding['releaseId'],create=True)
        compose=store.directory(directory/'compose',create=True)
        for name,digest in binding['composeHashes'].items():
            data=r.private_read(source_dir/'compose'/name,store.uid);r.require(r.sha(data)==digest,'arrival_reversion_compose_changed');store.write(compose/name,data)
        store.write(directory/'compose.runtime.yml',r.overlay_bytes(binding,profile['mode']))
        store.write(directory/'image.env',store.image_env(binding,profile['mode']))
        store.write(directory/'release.json',r.encoded(binding))
        store.write(directory/'reversion-baseline-health.json',baseline)
        # This repeats the ordinary release schema, profile, mount and overlay gates.
        store.binding(binding['releaseId'])
        config=store.docker.config(directory,profile['directory'])
        r.verify_api_diff(store.docker.config(directory),config,profile['values'],profile['mode'],binding['imageId'],binding['legacyEnvPresence'],store.clean_runtime_values(binding,config),auth_scope=True)
        store.docker.preserve(directory,profile['directory'],actual)
        desired=dict(line.split('=',1)for line in json.loads(store.docker.run(['docker','image','inspect',binding['imageId']]))[0]['Config'].get('Env',[])if '='in line)
        desired.update(config['services']['cop-api'].get('environment',{}))
        authority.environment(r,dict(line.split('=',1)for line in actual['Config']['Env']),desired,proof)
        store.check_cas(expected);store.docker.unchanged(directory,actual)
        journal={'contractVersion':'cop-arrival-reversion-journal-v1','operationId':proof['transitionId'],'proofPath':str(proof_path),'proofSha256':r.sha(raw),'previous':previous,'targetReleaseId':binding['releaseId'],'targetContainerId':None,'peers':peers,'baselineSha256':r.sha(baseline),'mutationStartedAt':None}
        store.write(journal_path,r.encoded(journal))
        if original_pending is not None:
            store.write(archive/'witness-pending.json',pending_bytes('pending.json',witness['pendingForwardSha256']))
            store.write(archive/'witness-pending-health.json',baseline)
    else:
        r.require(set(journal)=={'contractVersion','operationId','proofPath','proofSha256','previous','targetReleaseId','targetContainerId','peers','baselineSha256','mutationStartedAt'} and journal['contractVersion']=='cop-arrival-reversion-journal-v1' and journal['operationId']==proof['transitionId'] and journal['proofPath']==str(proof_path) and journal['proofSha256']==r.sha(raw) and journal['previous']==previous and journal['peers']==peers,'arrival_reversion_journal_changed')
        directory,binding,profile=store.binding(journal['targetReleaseId'])
        r.require(binding['accountErasureConfig']['sha256']==r.sha(raw) and binding['imageId']==authority.OLD,'arrival_reversion_journal_target')
        baseline=r.private_read(directory/'reversion-baseline-health.json',store.uid)
        r.require(r.sha(baseline)==journal['baselineSha256'],'arrival_reversion_baseline_changed')
        r.require(pointer==previous or (pointer['releaseId']==binding['releaseId'] and pointer['imageId']==authority.OLD and pointer['containerId']==journal['targetContainerId']),'arrival_reversion_pointer_changed')
    actual=store.docker.current(directory)
    owned_target=(actual['Image']==authority.OLD and actual['Config'].get('Labels',{}).get('com.cop.runtime.release')==binding['releaseId'])
    if not owned_target:
        r.require(pointer==previous and actual['Id']==witness['sourceContainerId'] and actual['Image']==witness['sourceImage'] and r.sha(r.encoded(r.fenced_public_source_spec(actual)))==proof['sourceSpecSha256'],'arrival_reversion_source_changed')
        authority.evidence(r,proof,True);store.assert_erasure_environment(binding)
        store.docker.preserve(directory,profile['directory'],actual);store.check_cas(expected)
        r.require(store.docker.peers(directory)==peers,'arrival_reversion_peer_changed')
        journal['mutationStartedAt']=r.datetime.now(r.timezone.utc).isoformat().replace("+00:00","Z");store.write(journal_path,r.encoded(journal))
        store.docker.up(directory,profile['directory'])
        actual=store.docker.current(directory)
    r.require(journal['mutationStartedAt'] is not None and r.fenced_timestamp(proof['checkedAt'])<=r.fenced_timestamp(journal['mutationStartedAt'])<=r.fenced_timestamp(proof['expiresAt']),'arrival_reversion_mutation_not_authorized')
    r.require(journal['targetContainerId'] in(None,actual['Id']),'arrival_reversion_unexpected_target_cid')
    journal['targetContainerId']=actual['Id'];store.write(journal_path,r.encoded(journal))
    store.docker.live(directory,binding,profile)
    r.require(actual.get('State',{}).get('Running')is True,'arrival_reversion_target_stopped')
    r.require(store.docker.peers(directory)==peers,'arrival_reversion_peer_changed')
    verified=store.docker.health('verify',directory/'reversion-baseline-health.json')
    store.docker.unchanged(directory,actual);store.assert_erasure_environment(binding)
    value=json.loads(verified);r.require(value.get('healthAndPublicDemoPreserved')is True,'arrival_reversion_health_unproven');r.health_statuses(value['statuses'])
    store.write(directory/'accepted-arrival-reversion-health.json',verified)
    store.record_accepted_health(directory,binding,actual,verified)
    if pointer==previous:pointer=store.commit_pointer(binding,expected,actual['Id'])
    else:r.require(store.pointer()==pointer,'arrival_reversion_commit_changed')
    # Supersede only after successful fresh health and CAS commit. Original bytes
    # are retained, not unlinked/edited, including across a crash during completion.
    if original_pending is not None:
        for name,digest in [('pending.json',witness['pendingForwardSha256']),('pending-health.json',witness['pendingHealthSha256'])]:
            pending_bytes(name,digest)
            if(store.root/name).exists():os.replace(store.root/name,archive/('superseded-'+name));store.sync(store.root);store.sync(archive)
    store.write(archive/'result.json',r.encoded({'contractVersion':'cop-arrival-reversion-result-v1','mode':witness['mode'],'previousImage':witness['sourceImage'],'imageId':binding['imageId'],'releaseId':binding['releaseId'],'containerId':actual['Id'],'configurationUnchanged':True,'freshHealthVerified':True,'pendingEvidenceRetained':True,'pointer':pointer}))
    os.replace(journal_path,archive/'completed-reversion-journal.json');store.sync(store.root);store.sync(archive)
    return pointer
