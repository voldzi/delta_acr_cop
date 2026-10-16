import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateProfileProbe,validateX5Probe} from './image-profile-probe.mjs';
import {IMAGE_ATTESTATION_PROGRAM} from './install-production-erasure.mjs';
const values=()=>({COP_DATABASE_POOL_MODE:'transaction',COP_DATABASE_URL:'postgresql://synthetic:secret@%2Frun%2Fvcode-cop-pgbouncer:6432/cop?sslmode=disable',COP_LEASE_DATABASE_URL:'postgresql://synthetic:secret@haproxy.home.cz:5000/cop?sslmode=verify-full&sslrootcert=%2Fetc%2Fvcode-cop-pgbouncer%2Fpostgres-ca.crt',COP_STREAM_BUS_DATABASE_URL:''});
test('keeps actual approved Unix main and verify-full session routes, allows explicitly unused memory-stream URI',()=>{assert.equal(validateProfileProbe(values()).COP_STREAM_BUS_DATABASE_URL,'');const v=values();v.COP_STREAM_BUS_DATABASE_URL=v.COP_LEASE_DATABASE_URL;assert.equal(validateProfileProbe(v),v);});
test('rejects socket TLS, wrong endpoint, lease fallback and CA downgrade before any connection',()=>{for(const edit of [v=>{v.COP_DATABASE_URL=v.COP_DATABASE_URL.replace('disable','require');},v=>{v.COP_LEASE_DATABASE_URL=v.COP_DATABASE_URL;},v=>{v.COP_LEASE_DATABASE_URL=v.COP_LEASE_DATABASE_URL.replace('verify-full','require');},v=>{v.COP_LEASE_DATABASE_URL=v.COP_LEASE_DATABASE_URL.replace('haproxy.home.cz','foreign.invalid');},v=>{delete v.COP_STREAM_BUS_DATABASE_URL;}]){const v=values();edit(v);assert.throws(()=>validateProfileProbe(v));}});
test('X5 probe only accepts the actual fixed work path and reviewed UUID/device',()=>{const input={workDir:'/data/cop-media-conversions',expectedStorageUuid:'2f93f595-b61b-4eea-9054-7afa9b275b5b',expectedDeviceId:'2049',expectedPresent:true};assert.equal(validateX5Probe(input),input);for(const edit of [v=>{v.workDir='/tmp/fallback';},v=>{v.expectedStorageUuid='other';},v=>{v.expectedDeviceId='0';},v=>{v.expectedPresent='true';}]){const v={...input};edit(v);assert.throws(()=>validateX5Probe(v));}});
test('image producer parses without executing any Root action',()=>{const r=spawnSync('python3',['-I','-c',"import sys;compile(sys.stdin.read(),'image-attestation','exec')"],{input:IMAGE_ATTESTATION_PROGRAM,encoding:'utf8'});assert.equal(r.status,0,'Private diagnostics suppressed');});
test('actual existing schema writer rejects CAS races, preserves foreign replacement and verifies root-style custody',()=>{
 const prefix=IMAGE_ATTESTATION_PROGRAM.split('# Production entry remains')[0];
 const code=prefix+String.raw`
import importlib.util
from unittest import mock
spec=importlib.util.spec_from_file_location('fixture',sys.argv[1]);f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
case=f.RuntimeTests();case.setUp()
try:
 st=case.store;st.docker_require=f.m.require;st.encode=f.m.encoded;generation,contract=case.transaction
 target={'kind':'candidate','imageId':f.NEW,'sourceRevision':f.REV,'profileGeneration':generation}
 value={'contractVersion':'cop-api-runtime-attestation-v1','application':'cop','service':'cop-api','profileGeneration':generation,'imageId':f.NEW,'sourceRevision':f.REV,'kind':'candidate','ownerAcceptance':True,'driverContract':contract,'checks':{'x5RuntimeGuard':True,'sharpConversion':True,'databaseRouting':True,'acceptedBaselineRollback':False},'legacyContainerId':None,'legacyEnvPresence':None}
 path=st.protected_root/generation/('attestation-'+f.NEW[7:]+'.json')
 assert publish_image_attestation(st,path,value,target,lambda:None) is True
 assert stat.S_IMODE(path.stat().st_mode)==0o640 and path.stat().st_uid==st.protected_uid
 assert publish_image_attestation(st,path,value,target,lambda:None) is False
 original=path.read_bytes();bad={**value,'sourceRevision':'c'*40}
 try:publish_image_attestation(st,path,bad,target,lambda:None);raise AssertionError('overwrite accepted')
 except f.m.RuntimeError:pass
 assert path.read_bytes()==original
 path.unlink();calls=[0]
 def raced():
  calls[0]+=1
  if calls[0]==2:raise f.m.RuntimeError('CAS changed')
 try:publish_image_attestation(st,path,value,target,raced);raise AssertionError('race accepted')
 except f.m.RuntimeError:pass
 assert not path.exists()
 foreign=path.parent/'foreign-proof';foreign.write_bytes(b'other');foreign.chmod(0o640);calls[0]=0
 def replaced():
  calls[0]+=1
  if calls[0]==2:os.replace(foreign,path);raise f.m.RuntimeError('CAS changed')
 try:publish_image_attestation(st,path,value,target,replaced);raise AssertionError('replacement accepted')
 except f.m.RuntimeError:pass
 assert path.read_bytes()==b'other'
 path.unlink();foreign.write_bytes(b'never replace');path.symlink_to(foreign)
 try:publish_image_attestation(st,path,value,target,lambda:None);raise AssertionError('symlink accepted')
 except f.m.RuntimeError:pass
 assert foreign.read_bytes()==b'never replace' and path.is_symlink()
finally:case.doCleanups()
`;
 const path=fileURLToPath(new URL('../tests/test-cop-api-runtime.py',import.meta.url));const r=spawnSync('python3',['-I','-c',code,path],{encoding:'utf8'});assert.equal(r.status,0,'Private fixture diagnostics suppressed');
});
