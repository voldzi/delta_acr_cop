"""SOURCE ONLY. Fresh one-flag successor; historical V3 is read unchanged.

No host command, writer, credential reader, GO issuer or automatic retry exists
here. Root must separately authorize, prepare and execute the exact operation.
"""
import copy
import hashlib
import json
import re
import types
from contextlib import contextmanager
from pathlib import Path

PROFILE = '206c4507-5e00-458e-b0ee-4061309aa7a8'
IMAGE = 'sha256:6cdf302ea305e7fa58a11a1f9139deccd9f5b70cd0982a7ce87cd6b70d9d5c30'
SOURCE = '7c43b690edf687fefc04e17533894d118f457276'
SIM_IMAGE = 'sha256:d33daddc75101cf1e137545ca76613fc861497066197b39eed75e8c96ba7a489'
SIM_SOURCE = '84b85cd94051095eb6038f8501ca8f411e1cc37e'
VERSION = 'cop-planning-enable-v4'
LEGACY_VERSION = 'cop-planning-config-v3'
LEGACY_SHA = '78efa038f2f49893502c9d62d2724881c744d124d95aec915a7a0a0bb37f5acd'
HEALTH_MODULE_SHA = 'e7eb01a0b41dcbbcfda0652a4d322c5f0d5d0eb4b6c411e1e6db174d8a596066'
FLAG = 'COP_ROUTING_PLANNING_ENABLED'
TOKEN = 'COP_ROUTING_PLANNING_SERVICE_TOKEN'
KEYS = frozenset({FLAG, TOKEN})
STAGES = frozenset({'enable', 'disable'})


class Rejected(ValueError):
    pass


def need(ok, code):
    if not ok:
        raise Rejected(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def digest(value):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def parse(raw):
    need(isinstance(raw, bytes) and len(raw) <= 65536, 'ENABLE_DOCUMENT_BOUND')
    def pairs(items):
        out = {}
        for key, value in items:
            need(key not in out, 'ENABLE_DUPLICATE_KEY')
            out[key] = value
        return out
    return json.loads(raw, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(Rejected('ENABLE_NONFINITE')))


def legacy(r):
    path = r.PROFILES / PROFILE / ('planning-config-v3-kernel-' + LEGACY_SHA + '.py')
    raw = r.private_read(path, 0, mode=0o640, gid=1000)
    need(sha(raw) == LEGACY_SHA, 'ENABLE_LEGACY_SOURCE_CHANGED')
    module = types.ModuleType('unchanged_planning_v3')
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    return module


def protected_document(r, reference, prefix):
    if prefix == 'account-erasure-':
        parent_reference(r, reference)
    else:
        need(isinstance(reference, dict) and set(reference) == {'path', 'sha256'}, 'ENABLE_REFERENCE_FIELDS')
    need(isinstance(reference, dict)
         and digest(reference['sha256']) and isinstance(reference['path'], str), 'ENABLE_REFERENCE')
    path = Path(reference['path'])
    need(path.parent == r.PROFILES / PROFILE
         and re.fullmatch(re.escape(prefix) + r'[0-9a-f-]{36}\.json', path.name), 'ENABLE_REFERENCE_PATH')
    raw = r.private_read(path, 0, mode=0o640, gid=1000)
    need(sha(raw) == reference['sha256'], 'ENABLE_REFERENCE_CHANGED')
    return parse(raw)


def parent_reference(r, reference):
    """Keep the exact existing binding, including its known clean-scope fence.

    V3's two-field path validator is reused on an explicit projection only;
    neither the historical reference nor the live lineage is rewritten.
    """
    need(isinstance(reference, dict) and set(reference) in
         ({'path', 'sha256'}, {'path', 'sha256', 'cleanScope'}), 'ENABLE_PARENT_REFERENCE_FIELDS')
    if 'cleanScope' in reference:
        need(reference['cleanScope'] == 'cop_sim_shared_identity_v1', 'ENABLE_PARENT_CLEAN_SCOPE')
    legacy(r).reference(r, {key: reference[key] for key in ('path', 'sha256')})



def environment_keys(raw):
 need(isinstance(raw,bytes)and len(raw)<=1048576 and b'\0'not in raw,'ENV_BYTES')
 names=[]
 for line in raw.splitlines():
  if line.lstrip().startswith(b'#'):continue
  found=re.match(rb'^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=',line)
  if found:names.append(found[1].decode('ascii'))
 return names

def compose_plan(r,before,after,stage):
 need(isinstance(before,dict)and isinstance(after,dict)and set(before)==set(after)==set(r.FILES),'COMPOSE_FILES')
 for name in r.FILES:
  need(isinstance(before[name],bytes)and isinstance(after[name],bytes)and len(before[name])<=65536 and len(after[name])<=65536,'COMPOSE_BYTES')
  if name!='docker-compose.yml' or stage in{'enable','disable'}:
   need(before[name]==after[name],'OTHER_COMPOSE_CHANGED');continue
  a,b=(after[name],before[name])if stage=='remove'else(before[name],after[name])
  need(a.startswith(b'services:\n  cop-api:\n') and a.count(ANCHOR)==1 and FLAG.encode()not in a and TOKEN.encode()not in a,'COMPOSE_ANCHOR')
  # Require the insertion to occur inside cop-api, not another service.
  at=a.index(ANCHOR);next_service=re.search(rb'(?m)^  [a-zA-Z0-9_-]+:\s*$',a[len(b'services:\n  cop-api:\n'):])
  need(next_service is None or at<len(b'services:\n  cop-api:\n')+next_service.start(),'COMPOSE_WRONG_SERVICE')
  need(b==a.replace(ANCHOR,ANCHOR+COMPOSE_LINES,1),'COMPOSE_EXACT_TWO_LINES')
 return True

def toggle_flag(raw,stage):
 need(stage in{'enable','disable'},'TOGGLE_STAGE')
 old,new=(b'true',b'false')if stage=='disable'else(b'false',b'true')
 expression=re.compile(rb'(?m)^'+FLAG.encode()+b'='+old+b'\n')
 found=list(expression.finditer(raw));need(len(found)==1,'EXACT_FLAG_LINE')
 match=found[0]
 return raw[:match.start()]+FLAG.encode()+b'='+new+b'\n'+raw[match.end():]

def env_plan(before,after,stage,adapter):
 need(stage in STAGES,'STAGE')
 names_before=environment_keys(before);names_after=environment_keys(after)
 need(all(names_before.count(k)<=1 and names_after.count(k)<=1 for k in KEYS),'DUPLICATE_PLANNING_KEY')
 if stage in{'provision','remove'}:
  a,b=(after,before)if stage=='remove'else(before,after)
  need(not(KEYS&set(environment_keys(a))),'EXISTING_PLANNING_CONFIGURATION')
  line=token_line(adapter);separator=b''if not a or a.endswith(b'\n')else b'\n'
  need(b==a+separator+ENV_PREFIX+line+b'\n','ENV_EXACT_APPEND_OR_INVERSE')
 else:
  need(names_before.count(FLAG)==names_after.count(FLAG)==1 and names_before.count(TOKEN)==names_after.count(TOKEN)==1,'PROVISIONED_KEYS_REQUIRED')
  need(after==toggle_flag(before,stage),'ENV_EXACT_FLAG_TOGGLE')
 return True


def case_for(r, p):
    value = protected_document(r, p['caseReference'], 'planning-enable-v4-case-')
    fields = {'contractVersion', 'caseId', 'stage', 'approvalRef', 'kernelSha256',
              'previous', 'parentProof', 'sourceEnvironmentMetadata', 'sourceComposeHashes',
              'sourceEnvironmentSha256', 'sourceSpecSha256', 'acceptance', 'checkedAt', 'expiresAt'}
    need(isinstance(value, dict) and set(value) == fields
         and value['contractVersion'] == 'cop-planning-enable-case-v4'
         and r.PROFILE_UUID.fullmatch(value['caseId']) and value['stage'] in STAGES
         and isinstance(value['approvalRef'], str) and re.fullmatch(r'call_[A-Za-z0-9_-]{1,128}', value['approvalRef'])
         and value['kernelSha256'] == r.PLANNING_CONFIG_V3_KERNEL_SHA256, 'ENABLE_CASE_BINDING')
    need(Path(p['caseReference']['path']).name == 'planning-enable-v4-case-' + value['caseId'] + '.json',
         'ENABLE_CASE_PATH_IDENTITY')
    old = legacy(r)
    old.pointer(r, value['previous'])
    parent_reference(r, value['parentProof'])
    need(old.metadata(value['sourceEnvironmentMetadata'])
         and set(value['sourceComposeHashes']) == set(r.FILES)
         and all(digest(v) for v in value['sourceComposeHashes'].values())
         and digest(value['sourceEnvironmentSha256']) and digest(value['sourceSpecSha256']), 'ENABLE_CASE_METADATA')
    start, end = map(r.fenced_timestamp, (value['checkedAt'], value['expiresAt']))
    need(0 < end - start <= 3600, 'ENABLE_CASE_LIFETIME')
    return value


def acceptance(r, reference, case, p):
    if p['stage'] == 'disable':
        need(reference is None, 'ENABLE_REVERSE_UNEXPECTED_ACCEPTANCE')
        return
    value = protected_document(r, reference, 'planning-enable-v4-acceptance-')
    fields = {'contractVersion', 'copImageId', 'simImageId', 'simSourceRevision',
              'publicCaseIds', 'workflowResults', 'ordinaryAdapterResultSha256',
              'wafReceiptSha256', 'nativeCountReceiptSha256', 'checkedAt', 'expiresAt'}
    need(isinstance(value, dict) and set(value) == fields
         and value['contractVersion'] == 'cop-planning-enable-acceptance-v4'
         and value['copImageId'] == IMAGE and value['simImageId'] == SIM_IMAGE
         and value['simSourceRevision'] == SIM_SOURCE
         and value['publicCaseIds'] == ['public-mnichov-stop', 'previous-public-center-control']
         and value['workflowResults'] == ['PASS', 'PASS']
         and all(digest(value[k]) for k in ('ordinaryAdapterResultSha256', 'wafReceiptSha256', 'nativeCountReceiptSha256')),
         'ENABLE_ACTUAL_ACCEPTANCE_BINDING')
    a, b = map(r.fenced_timestamp, (value['checkedAt'], value['expiresAt']))
    need(0 < b - a <= 3600 and a <= r.fenced_timestamp(p['checkedAt'])
         < r.fenced_timestamp(p['expiresAt']) <= b, 'ENABLE_ACCEPTANCE_TIME')


def schema(r, p):
    if isinstance(p, dict) and p.get('contractVersion') == LEGACY_VERSION:
        return legacy(r).schema(r, p)
    fields = {'contractVersion', 'transitionId', 'operation', 'stage', 'previous', 'target',
              'changedKeys', 'environmentMetadata', 'sourceEnvironmentMetadata', 'composeHashes',
              'sourceComposeHashes', 'ownerAcceptance', 'checks', 'cleanReset', 'parentProof',
              'caseReference', 'checkedAt', 'expiresAt', 'sourceSpecSha256', 'baselineSha256', 'stageEvidence'}
    need(isinstance(p, dict) and set(p) == fields and p['contractVersion'] == VERSION
         and p['operation'] == 'maintain' and p['stage'] in STAGES
         and r.PROFILE_UUID.fullmatch(p['transitionId']) and p['ownerAcceptance'] is True,
         'ENABLE_PROOF_SHAPE')
    c = case_for(r, p)
    old = legacy(r)
    need(p['transitionId'] == c['caseId'] and p['stage'] == c['stage']
         and p['previous'] == c['previous'] and p['parentProof'] == c['parentProof']
         and p['sourceEnvironmentMetadata'] == c['sourceEnvironmentMetadata']
         and p['sourceComposeHashes'] == c['sourceComposeHashes']
         and p['sourceSpecSha256'] == c['sourceSpecSha256'], 'ENABLE_PROOF_CASE_CAS')
    need(p['target'] == {'imageId': IMAGE, 'sourceRevision': SOURCE, 'profileGeneration': PROFILE}
         and p['changedKeys'] == [FLAG] and old.metadata(p['environmentMetadata'])
         and p['composeHashes'] == p['sourceComposeHashes'] and digest(p['baselineSha256'])
         and isinstance(p['checks'], dict) and p['checks']
         and all(type(v) is bool and v for v in p['checks'].values()), 'ENABLE_PROOF_PROTECTIONS')
    a, b = map(r.fenced_timestamp, (p['checkedAt'], p['expiresAt']))
    need(r.fenced_timestamp(c['checkedAt']) <= a < b <= r.fenced_timestamp(c['expiresAt'])
         and b - a <= 900, 'ENABLE_PROOF_LIFETIME')
    need(p['stageEvidence'] == c['acceptance'], 'ENABLE_ACCEPTANCE_REFERENCE')
    acceptance(r, p['stageEvidence'], c, p)
    return p


def evidence(r, p, fresh=True):
    if p.get('contractVersion') == LEGACY_VERSION:
        return legacy(r).evidence(r, p, fresh)
    schema(r, p)
    if fresh:
        need(r.fenced_timestamp(p['checkedAt']) <= r.datetime.now(r.timezone.utc).timestamp()
             <= r.fenced_timestamp(p['expiresAt']), 'ENABLE_EXPIRED')
    return p


def read_proof(r, store, path, raw, binding):
    p = parse(raw)
    if p.get('contractVersion') == LEGACY_VERSION:
        return legacy(r).read_proof(r, store, path, raw, binding)
    schema(r, p)
    need(Path(path) == r.PROFILES / PROFILE / ('account-erasure-' + p['transitionId'] + '.json')
         and all(binding[k] == p['target'][k] for k in p['target'])
         and binding['profileId'] == PROFILE and binding['previousReleaseId'] == p['previous']['releaseId']
         and ('composeHashes' not in binding or binding['composeHashes'] == p['composeHashes']), 'ENABLE_BINDING')
    origin = r.private_json(store.root / 'releases' / p['previous']['releaseId'] / 'release.json', store.uid)
    need(origin['imageId'] == IMAGE and origin['sourceRevision'] == SOURCE
         and origin['profileId'] == PROFILE and origin['accountErasureConfig'] == p['parentProof'], 'ENABLE_PARENT_LINEAGE')
    _, parent = store.erasure_config_proof(Path(p['parentProof']['path']), origin, p['parentProof']['sha256'])
    expected = (LEGACY_VERSION, 'provision') if p['stage'] == 'enable' else (VERSION, 'enable')
    need((parent['contractVersion'], parent['stage']) == expected
         and parent['checks'] == p['checks'] and parent['cleanReset'] == p['cleanReset']
         and parent['environmentMetadata'] == p['sourceEnvironmentMetadata']
         and parent['composeHashes'] == p['sourceComposeHashes'], 'ENABLE_PARENT_PROTECTIONS')
    return sha(raw), p


def effective_delta(actual, desired, stage, adapter=None):
    need(stage in STAGES and isinstance(actual, dict) and isinstance(desired, dict), 'ENABLE_ENV_SHAPE')
    changed = {k for k in set(actual) | set(desired)
               if (k in actual) != (k in desired) or actual.get(k) != desired.get(k)}
    before, after = ('false', 'true') if stage == 'enable' else ('true', 'false')
    need(changed == {FLAG} and actual.get(FLAG) == before and desired.get(FLAG) == after
         and isinstance(actual.get(TOKEN), str) and actual[TOKEN]
         and actual[TOKEN] == desired.get(TOKEN), 'ENABLE_EXACT_FLAG_ONLY')
    need(desired.get('COP_AUTH_MODE') == 'oidc' and desired.get('COP_ALLOW_LAB_TOKEN') == 'false'
         and desired.get('COP_ACCOUNT_ERASURE_ENABLED') == 'true'
         and desired.get('COP_ACCOUNT_SAFETY_GUARD_REQUIRED') == 'true', 'ENABLE_AUTH_ERASURE_REQUIRED')
    return True


def protected_render(before, after, stage, adapter=None):
    a, b = copy.deepcopy(before), copy.deepcopy(after)
    need(isinstance(a, dict) and isinstance(b, dict) and set(a) == set(b)
         and set(a.get('services', {})) == set(b.get('services', {})) and 'cop-api' in a['services'], 'ENABLE_RENDER_SHAPE')
    old = a['services']['cop-api'].pop('environment', {})
    new = b['services']['cop-api'].pop('environment', {})
    need(a == b, 'ENABLE_NON_ENV_RENDER_CHANGED')
    return effective_delta(old, new, stage)


def environment(r, actual, desired, p):
    if p.get('contractVersion') == LEGACY_VERSION:
        return legacy(r).environment(r, actual, desired, p)
    evidence(r, p, True)
    need(sha(canonical(actual)) == case_for(r, p)['sourceEnvironmentSha256'], 'ENABLE_ACTUAL_ENV_CAS')
    effective_delta(actual, desired, p['stage'])
    if p['stage'] == 'disable':
        parent = protected_document(r, p['parentProof'], 'account-erasure-')
        need(parent.get('contractVersion') == VERSION and parent.get('stage') == 'enable',
             'ENABLE_REVERSE_PARENT')
        schema(r, parent)
        need(sha(canonical(desired)) == case_for(r, parent)['sourceEnvironmentSha256'],
             'ENABLE_REVERSE_NOT_ORIGINAL_ENV')
    return True


def health_scope(r, store, p):
    if p.get('contractVersion') == LEGACY_VERSION:
        return legacy(r).health_scope(r, store, p)
    return _fresh_health_scope(r, store, p)


@contextmanager
def _fresh_health_scope(r,store,p):
    """Only one finite forward uses original regression policy at a fixed budget.
    The Root-bound source snapshot remains byte-identical; fresh actual source
    verification precedes the recreation. No URL or health script is caller-set.
    """
    import types
    evidence(r,p,True)
    r.require(p['contractVersion']==VERSION and p['stage']in STAGES and getattr(store.docker,'planning_config_v3_health_scope',None)is None,'planning_config_v3_health_scope')
    baseline_path=r.PROFILES/PROFILE/('planning-config-v3-source-health-'+p['transitionId']+'.json')
    baseline=r.private_read(baseline_path,0,mode=0o640,gid=1000);r.require(r.sha(baseline)==p['baselineSha256'],'planning_config_v3_health_baseline_changed');r.health_statuses(json.loads(baseline))
    health_path=r.PROFILES/PROFILE/('planning-config-v3-health-'+HEALTH_MODULE_SHA+'.py');raw=r.private_read(health_path,0,mode=0o640,gid=1000);r.require(r.sha(raw)==HEALTH_MODULE_SHA,'planning_config_v3_health_source_changed')
    health=types.ModuleType('fixed_planning_v3_health');exec(compile(raw,str(health_path),'exec'),health.__dict__)
    original=store.docker.health;prior=store.docker.__dict__.get('health');had='health'in store.docker.__dict__;calls=[]
    def scoped(action,path):
        r.require((action=='capture'and path is None and calls==[])or(action=='verify'and Path(path)==store.root/'pending-health.json'and calls==['capture']),'planning_config_v3_health_call_order')
        if action=='verify':r.require(r.sha(r.private_read(path,store.uid))==p['baselineSha256'],'planning_config_v3_pending_baseline_changed')
        started=__import__('time').monotonic();verified,observation=health.verify(r,baseline)
        if action=='verify':
            pending=r.private_json(store.root/'pending.json',store.uid)
            r.require(pending['previous']==p['previous'],'planning_config_v3_health_pending_cas')
            directory,binding,profile=store.binding(pending['targetReleaseId'])
            actual=store.docker.current(directory)
            # HTTP readiness can precede Docker's first healthcheck. Wait only
            # by observing this exact non-restarting target, within the SAME
            # 120s total budget; never recreate/restart or accept an unhealthy one.
            while actual['State'].get('Health',{}).get('Status')=='starting':
                r.require(actual['Id']==pending['targetContainerId']and actual['Image']==IMAGE and actual['RestartCount']==0 and actual['State']['Running']is True and __import__('time').monotonic()<started+120,'planning_config_v3_cold_target_wait_failed')
                __import__('time').sleep(min(1,max(0,started+120-__import__('time').monotonic())));actual=store.docker.current(directory)
            r.require(binding['imageId']==IMAGE and binding['sourceRevision']==SOURCE and actual['Id']==pending['targetContainerId']and actual['Image']==IMAGE and actual['RestartCount']==0 and actual['State']['Running']is True and actual['State'].get('Health',{}).get('Status')=='healthy','planning_config_v3_actual_cold_start_unproven')
        store.write(store.root/('planning-config-v3-'+p['transitionId']+'-'+action+'-health-observation.json'),r.encoded(observation));calls.append(action)
        return baseline if action=='capture'else verified
    store.docker.planning_config_v3_health_scope=p;store.docker.health=scoped
    try:yield
    finally:
        if had:store.docker.health=prior
        else:del store.docker.health
        store.docker.planning_config_v3_health_scope=None
