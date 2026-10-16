import{test}from'node:test';import assert from'node:assert/strict';import{profileOperatorEnvironment,parseOperatorHostEnvironment,operatorProfileDirectory,OPERATOR_PROFILE_HOST_CHECK}from'./operator-profile-environment.mjs';
const ca='/etc/vcode-cop-pgbouncer/postgres-ca.crt';
const values=()=>({COP_API_RUNTIME_DATABASE_URL:'postgresql://cop:opaque@%2Frun%2Fvcode-cop-pgbouncer:6432/cop?sslmode=disable',COP_API_RUNTIME_LEASE_DATABASE_URL:'postgresql://cop:opaque@haproxy.home.cz:5000/cop?sslmode=verify-full&sslrootcert='+ca,COP_API_RUNTIME_STREAM_BUS_DATABASE_URL:'postgresql://cop:opaque@haproxy.home.cz:5000/cop?sslmode=verify-full&sslrootcert='+ca});
test('missing host session DSNs use only the actual protected profile values without modifying host environment',()=>{const host={COP_DATABASE_URL:'postgresql://different:unused@haproxy.home.cz:5000/cop',UNCHANGED:'keep'},profile=values(),result=profileOperatorEnvironment(host,profile);assert.equal(result.COP_DATABASE_URL,profile.COP_API_RUNTIME_DATABASE_URL);assert.equal(result.COP_LEASE_DATABASE_URL,profile.COP_API_RUNTIME_LEASE_DATABASE_URL);assert.equal(result.COP_STREAM_BUS_DATABASE_URL,profile.COP_API_RUNTIME_STREAM_BUS_DATABASE_URL);assert.equal(result.COP_DATABASE_POOL_MODE,'transaction');assert.equal(result.UNCHANGED,'keep');assert.equal(host.COP_LEASE_DATABASE_URL,undefined);assert.equal(host.COP_DATABASE_URL,'postgresql://different:unused@haproxy.home.cz:5000/cop');});
test('profile cannot introduce other settings, routes or weaken TLS',()=>{for(const edit of [v=>{v.OTHER='injected';},v=>{delete v.COP_API_RUNTIME_LEASE_DATABASE_URL;},v=>{v.COP_API_RUNTIME_LEASE_DATABASE_URL=v.COP_API_RUNTIME_LEASE_DATABASE_URL.replace('verify-full','require');},v=>{v.COP_API_RUNTIME_STREAM_BUS_DATABASE_URL=v.COP_API_RUNTIME_STREAM_BUS_DATABASE_URL.replace('haproxy.home.cz','foreign');},v=>{v.COP_API_RUNTIME_DATABASE_URL=v.COP_API_RUNTIME_DATABASE_URL.replace('sslmode=disable','sslmode=require');}]){const value=values();edit(value);assert.throws(()=>profileOperatorEnvironment({},value));}});

test('known duplicate host keys preserve exactly the reviewed last-wins semantics without changing input',()=>{const text="COP_DEPLOY_DOMAIN=old\r\nCOP_LAB_TOKEN=earlier\nOTHER=preserve exactly  \nCOP_DEPLOY_DOMAIN=new\r\nCOP_LAB_TOKEN=last=quoted-$value\n";assert.deepEqual(parseOperatorHostEnvironment(text),{OTHER:'preserve exactly  ',COP_DEPLOY_DOMAIN:'new',COP_LAB_TOKEN:'last=quoted-$value'});for(const bad of ['OTHER=a\nOTHER=b\n','COP_LAB_TOKEN=a\nCOP_LAB_TOKEN=b\nCOP_LAB_TOKEN=c\n','export COP_LAB_TOKEN=a\n','lower=a\n','COP_LAB_TOKEN=a\0b\n'])assert.throws(()=>parseOperatorHostEnvironment(bad));});
test('actual active pointer generation is distinct from its protected profile UUID',()=>{const a={contractVersion:'cop-api-runtime-active-v1',generation:'7a351c5cb66e45cdbb845a76206fc282',profileId:'206c4507-5e00-458e-b0ee-4061309aa7a8',profileGeneration:'206c4507-5e00-458e-b0ee-4061309aa7a8',containerId:'b4e1c9d7bf45efdab931d0c24bed056f4a65341ed7fc77348d6735a940503ddc',imageId:'sha256:'+'a'.repeat(64),releaseId:'release-'+'a'.repeat(32)};assert.equal(operatorProfileDirectory(a),'/etc/vcode-cop-api-runtime/'+a.profileGeneration);assert.throws(()=>operatorProfileDirectory({...a,profileGeneration:a.generation}));assert.throws(()=>operatorProfileDirectory({...a,generation:a.profileGeneration}));});

test('host witness rejects profile, actual runtime and container drift',async()=>{const{spawnSync}=await import('node:child_process');const code="from pathlib import Path\nfrom types import SimpleNamespace\n"+OPERATOR_PROFILE_HOST_CHECK+String.raw`
import tempfile
def require(v,c):
 if not v:raise RuntimeError(c)
with tempfile.TemporaryDirectory() as name:
 directory=Path(name);(directory/'runtime.env').write_text('synthetic only')
 values={'COP_DATABASE_URL':'opaque','COP_LEASE_DATABASE_URL':'opaque','COP_STREAM_BUS_DATABASE_URL':'opaque','COP_DATABASE_POOL_MODE':'transaction'}
 profile={'driverContract':{},'directory':directory,'generation':'uuid','values':values}
 current={'profileId':'uuid','profileGeneration':'uuid','containerId':'cid','imageId':'image'}
 actual={'Id':'cid','Image':'image','Config':{'Env':[k+'='+v for k,v in values.items()]}}
 st=SimpleNamespace(profile=lambda *_:profile,docker=SimpleNamespace(current=lambda *_:actual))
 first=operator_profile_witness(st,current,directory,profile,require)
 assert first==operator_profile_witness(st,current,directory,profile,require)
 for change in ('route','container','profile'):
  saved=dict(actual['Config']);saved_id=actual['Id'];saved_gen=current['profileGeneration']
  if change=='route':actual['Config']={'Env':['COP_DATABASE_URL=foreign']}
  if change=='container':actual['Id']='foreign'
  if change=='profile':current['profileGeneration']='foreign'
  try:operator_profile_witness(st,current,directory,profile,require);raise AssertionError('drift accepted')
  except RuntimeError:pass
  actual['Config']=saved;actual['Id']=saved_id;current['profileGeneration']=saved_gen
`;const result=spawnSync('python3',['-B','-c',code],{encoding:'utf8'});assert.equal(result.status,0,'Private fixture diagnostics suppressed');});
