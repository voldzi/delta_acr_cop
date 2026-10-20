import importlib.util,types,re,copy,datetime
from pathlib import Path
s=importlib.util.spec_from_file_location('c',str(Path(__file__).with_name('cop-communication-safety-contract-v1.py')));c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
def require(v,code):
 if not v:raise ValueError(code)
r=types.SimpleNamespace(require=require,PROFILE_UUID=re.compile('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'),re=re,datetime=datetime.datetime,timezone=datetime.timezone,fenced_timestamp=lambda v:datetime.datetime.fromisoformat(v).timestamp())
now=datetime.datetime.now(datetime.timezone.utc);p={'contractVersion':c.VERSION,'transitionId':'11111111-1111-4111-8111-111111111111','operation':'maintain','previous':c.SOURCE,'target':{'imageId':c.IMAGE,'sourceRevision':c.REVISION,'profileGeneration':c.PROFILE},'changedKeys':sorted(c.KEYS),'environmentMetadata':{},'composeHashes':{},'ownerAcceptance':True,'checks':{k:True for k in ['sameImage','sameAuthentication','sameErasureFence','sameTopology','targetedTests','moderatorAssigned']},'cleanReset':{},'parentProof':{'path':c.PARENT,'sha256':c.PARENT_SHA},'checkedAt':now.isoformat(),'expiresAt':(now+datetime.timedelta(minutes=10)).isoformat(),'sourceSpecSha256':'a'*64,'evidenceSecretFile':{'path':'/srv/cop/.env.communication-safety','metadata':{}}}
c.schema(r,p)
for key,value in [('previous',{}),('operation','prepare'),('changedKeys',[]),('target',{}),('ownerAcceptance',False),('parentProof',{}),('sourceSpecSha256','x'),('checks',{})]:
 q=copy.deepcopy(p);q[key]=value
 try:c.schema(r,q)
 except (ValueError,KeyError):pass
 else:raise AssertionError(key)
before={'COP_AUTH_MODE':'oidc','COP_ALLOW_LAB_TOKEN':'false','COP_ACCOUNT_ERASURE_ENABLED':'true'};after={**before,**c.FIXED,'COP_COMMUNICATION_EVIDENCE_SECRET':'x'*43};c.environment(r,before,after,p)
for key,value in [('COP_AUTH_MODE','hybrid'),('COP_ALLOW_LAB_TOKEN','true'),('COP_ACCOUNT_ERASURE_ENABLED','false'),('OTHER','changed'),('COP_COMMUNICATION_MODERATOR_ROLE','realm-admin'),('COP_COMMUNICATION_CONTACT_EMAIL','other@example.test'),('COP_COMMUNICATION_EVIDENCE_SECRET','short')]:
 q=after.copy();q[key]=value
 try:c.environment(r,before,q,p)
 except ValueError:pass
 else:raise AssertionError(key)
q=copy.deepcopy(p);q['checkedAt']=(now-datetime.timedelta(hours=1)).isoformat();q['expiresAt']=(now-datetime.timedelta(minutes=50)).isoformat()
try:c.evidence(r,q)
except ValueError:pass
else:raise AssertionError('expiry')
print('PASS: same-image activation; 8 schema negatives, 7 environment/auth negatives, expired evidence rejected; no external I/O')
