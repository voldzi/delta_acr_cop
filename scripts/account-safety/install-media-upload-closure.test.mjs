import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {PROVIDER_REFERENCE,STORAGE_PROGRAM,MEDIA_PROFILE_STAGE_PROGRAM,runMediaClosure,exactCanaryVersions,replaceMediaEnvironment,validateClosurePlan,checkWriter,validateStorageInspection,validateRuntimeMediaProbe,storageTransportArguments,storageTransportLifecycle} from './install-media-upload-closure.mjs';
const providerImageId='sha256:'+'9'.repeat(64);
const release={expectedActive:{containerId:'a'.repeat(64)}};
const plan=()=>({contractVersion:'cop-production-media-closure-v1',providerContainerId:'b'.repeat(64),providerImageId,otherIdentity:'existing-other-app',otherBucket:'existing-other-bucket',writerContainerIds:['a'.repeat(64)]});
const facts=()=>({calls:[],stopped:false,rotated:false,published:false});
function dependencies(state,overrides={}){
 const operation=(name,result)=>async()=>{state.calls.push(name);return result;};
 return {providerImageId,...Object.fromEntries(['preflight','seed','pause','assertPaused','persistCredential','rotate','enroll','unpause','safeUnpause','actualOldHealth'].map(name=>[name,operation(name)])),
  slow:async()=>{state.calls.push('slow');return {admitted:Promise.resolve(),ended:Promise.resolve(true),isOpen:()=>true,cancel:()=>state.calls.push('cancel')};},
  stop:async()=>{state.calls.push('stop');state.stopped=true;return {pid:0,sameSpec:true,stoppedAt:'2026-10-16T00:00:00.000Z'};},
  start:async()=>{state.calls.push('start');state.rotated=true;return {sameSpec:true,imageId:providerImageId,startedAt:'2026-10-16T00:00:01.000Z'};},
  verify:operation('verify',{actual:true}),publish:async()=>{state.calls.push('publish');state.published=true;return {complete:true};},...overrides};
}
test('fixed plan rejects arbitrary path, foreign writer and other COP identity/bucket',()=>{
 assert.equal(validateClosurePlan(plan(),release).otherBucket,'existing-other-bucket');
 for(const edit of [p=>{p.command='true';},p=>{p.writerContainerIds.push('c'.repeat(64));},p=>{p.otherIdentity='cop-production';},p=>{p.otherBucket='cop-community-media';},p=>{p.providerContainerId='seaweedfs';}]){const p=plan();edit(p);assert.throws(()=>validateClosurePlan(p,release));}
});
test('secret replacement preserves every unrelated field/comment and leaves intake disabled',()=>{
 const before=Buffer.from('# existing production comments\nCOP_ACCOUNT_ERASURE_ENABLED=false\nCOP_MEDIA_S3_ACCESS_KEY_ID=old\nCOP_MEDIA_S3_SECRET_ACCESS_KEY=old-secret\nUNCHANGED="keep $ literally"\n');
 const changed=replaceMediaEnvironment(before,{accessKeyId:'a'.repeat(40),secretAccessKey:'b'.repeat(64)}).toString();
 assert(changed.includes('COP_ACCOUNT_ERASURE_ENABLED=false\n'));assert(changed.includes('UNCHANGED="keep $ literally"\n'));assert(changed.startsWith('# existing production comments\n'));assert(changed.includes('COP_MEDIA_UPLOAD_TRANSPORT=cop_api\n'));assert(!changed.includes('old-secret'));
 assert.throws(()=>replaceMediaEnvironment(Buffer.from('COP_ACCOUNT_ERASURE_ENABLED=true\n'),{accessKeyId:'a'.repeat(40),secretAccessKey:'b'.repeat(64)}),/MEDIA_INTAKE_NOT_DISABLED/);
});
test('actual closure orders pause, admitted request, provider PID0, scoped rotation and actual readback',async()=>{
 const s=facts();assert.deepEqual(await runMediaClosure(dependencies(s)),{complete:true});
 assert.deepEqual(s.calls,['preflight','seed','pause','assertPaused','slow','stop','persistCredential','rotate','start','verify','assertPaused','enroll','unpause','actualOldHealth','publish','cancel']);
});
test('preflight failure cannot pause service or seed data',async()=>{
 const s=facts();await assert.rejects(runMediaClosure(dependencies(s,{preflight:async()=>{throw Error('preflight');}})),/preflight/);assert.deepEqual(s.calls,[]);
});
test('unadmitted or already completed slow request cannot stop provider or rotate',async()=>{
 const s=facts();await assert.rejects(runMediaClosure(dependencies(s,{slow:async()=>({admitted:Promise.resolve(),ended:Promise.resolve(true),isOpen:()=>false,cancel:()=>{}})})),/MEDIA_SLOW_UPLOAD_NOT_OPEN/);
 assert(!s.stopped);assert(!s.calls.includes('persistCredential'));assert(s.calls.includes('safeUnpause'));assert(!s.published);
});
test('failed provider PID0 evidence preserves paused writers and forbids credential persistence',async()=>{
 const s=facts();await assert.rejects(runMediaClosure(dependencies(s,{stop:async()=>({pid:42,sameSpec:true})})),/MEDIA_PROVIDER_NOT_STOPPED/);
 assert(!s.calls.includes('persistCredential'));assert(!s.calls.includes('safeUnpause'));assert(!s.published);
});
test('slow upload not terminated forbids rotation and enrollment',async()=>{
 const s=facts();await assert.rejects(runMediaClosure(dependencies(s,{slow:async()=>({admitted:Promise.resolve(),ended:Promise.resolve(false),isOpen:()=>true,cancel:()=>{}})})),/MEDIA_LEGACY_BODY_NOT_TERMINATED/);
 assert(!s.calls.includes('rotate'));assert(!s.calls.includes('enroll'));assert(!s.calls.includes('safeUnpause'));
});
test('failed secret transfer never starts provider and never writes a complete receipt',async()=>{
 const s=facts();await assert.rejects(runMediaClosure(dependencies(s,{persistCredential:async()=>{throw Error('CAS');}})),/CAS/);
 assert(!s.calls.includes('rotate'));assert(!s.calls.includes('start'));assert(!s.published);assert(!s.calls.includes('safeUnpause'));
});
test('changed provider image or start time forbids verification and DB enrollment',async()=>{
 for(const change of [v=>{v.imageId='sha256:'+'f'.repeat(64);},v=>{v.startedAt='2026-10-15T23:59:59.000Z';}]){
  const s=facts();const started={sameSpec:true,imageId:providerImageId,startedAt:'2026-10-16T00:00:01.000Z'};change(started);
  await assert.rejects(runMediaClosure(dependencies(s,{start:async()=>started})),/MEDIA_PROVIDER_RESTART_CHANGED/);assert(!s.calls.includes('verify'));assert(!s.calls.includes('enroll'));assert(!s.calls.includes('safeUnpause'));assert(!s.published);
 }
});
test('old signature/preservation failure cannot enroll or publish',async()=>{
 const s=facts();await assert.rejects(runMediaClosure(dependencies(s,{verify:async()=>{throw Error('actual-old-signature-not-403');}})),/actual-old-signature/);assert(!s.calls.includes('enroll'));assert(!s.published);
});
test('guard refusal cannot publish and ordinary unpause does not bypass old API health',async()=>{
 const s=facts();await assert.rejects(runMediaClosure(dependencies(s,{enroll:async()=>{throw Error('guard-current-generation');}})),/guard-current/);assert(!s.calls.includes('unpause'));assert(!s.published);
 const t=facts();await assert.rejects(runMediaClosure(dependencies(t,{actualOldHealth:async()=>{throw Error('old-health');}})),/old-health/);assert(!t.published);
});
test('storage rotation changes only exact cop-production credential and rejects wrong previous secret',()=>{
 const functions=STORAGE_PROGRAM.split('def main():')[0];
 const fixture={identities:[{name:'cop-production',credentials:[{accessKey:'old',secretKey:'old-secret'}],actions:['Read','Write']},{name:'other',credentials:[{accessKey:'other',secretKey:'other-secret'}],actions:['Read:other-bucket']}],otherConfiguration:{x:42}};
 const code=functions+"\np=json.loads(sys.stdin.read());raw=json.dumps(p).encode();changed=json.loads(rotate(raw,{'accessKeyId':'old','secretAccessKey':'old-secret'},{'accessKeyId':'new','secretAccessKey':'new-secret'}));require(changed['identities'][1]==p['identities'][1] and changed['otherConfiguration']==p['otherConfiguration']);require(changed['identities'][0]['actions']==p['identities'][0]['actions']);\ntry:rotate(raw,{'accessKeyId':'wrong','secretAccessKey':'wrong'},{'accessKeyId':'new','secretAccessKey':'new-secret'});sys.exit(9)\nexcept RuntimeError:pass\n";
 const run=spawnSync('python3',['-I','-c',code],{input:JSON.stringify(fixture),encoding:'utf8'});assert.equal(run.status,0,'Private fixture diagnostics suppressed');
});
test('remote storage program parses without running any production operation',()=>{
 const run=spawnSync('python3',['-I','-c',"import sys;compile(sys.stdin.read(),'storage-closure','exec')"],{input:STORAGE_PROGRAM,encoding:'utf8'});assert.equal(run.status,0,'Private diagnostics suppressed');
});

const canary='community-reports/11111111-2222-4333-8444-555555555555/22222222-2222-4333-8444-555555555555/closure-a.txt';
const listing=(rows='',extra='')=>'<?xml version="1.0"?><ListVersionsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>cop-community-media</Name><Prefix>'+canary+'</Prefix><IsTruncated>false</IsTruncated>'+rows+extra+'</ListVersionsResult>';
const version=(kind,id,key=canary)=>'<'+kind+'><Key>'+key+'</Key><VersionId>'+id+'</VersionId><IsLatest>true</IsLatest></'+kind+'>';
test('enumerates only exact current, previous and delete-marker versions including null',()=>{assert.deepEqual(exactCanaryVersions(listing(version('Version','null')+version('Version','old-id')+version('DeleteMarker','marker-id')),canary),[{versionId:'null'},{versionId:'old-id'},{versionId:'marker-id'}]);assert.deepEqual(exactCanaryVersions(listing(),canary),[]);});
test('a prefix neighbour invalidates the complete inventory before any delete can start',()=>{assert.throws(()=>exactCanaryVersions(listing(version('Version','ours')+version('Version','foreign',canary+'-other')),canary),/MEDIA_VERSION_PREFIX_NEIGHBOUR/);});
test('pagination and wrong bucket or response prefix cannot claim complete canary deletion',()=>{for(const xml of [listing().replace('false','true'),listing().replace('<Name>cop-community-media','<Name>other-bucket'),listing().replace('<Prefix>'+canary,'<Prefix>foreign')])assert.throws(()=>exactCanaryVersions(xml,canary));});
test('duplicate version IDs, missing ID and malformed XML remain unproven',()=>{for(const xml of [listing(version('Version','same')+version('DeleteMarker','same')),listing('<Version><Key>'+canary+'</Key></Version>'),listing().replace('</Prefix>','</Name>'),listing('', '<IsTruncated>false</IsTruncated>')])assert.throws(()=>exactCanaryVersions(xml,canary));});
test('DTD/entity expansion, unsupported roots and oversized inventory fail closed',()=>{for(const xml of ['<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+listing(),listing().replace(canary,'&unknown;'),'<Error/>',listing().replace('</ListVersionsResult>','x'.repeat(262144)+'</ListVersionsResult>')])assert.throws(()=>exactCanaryVersions(xml,canary));});

test('provider reference is separate from the actual Docker image ID',()=>{assert.match(PROVIDER_REFERENCE,/^chrislusf\/seaweedfs@sha256:/u);assert.notEqual(PROVIDER_REFERENCE,providerImageId);const p=plan();p.providerImageId=PROVIDER_REFERENCE;assert.throws(()=>validateClosurePlan(p,release),/MEDIA_PLAN_SCOPE/);});

test('an unknown stop outcome cannot resume writers even when the provider command throws',async()=>{const s=facts();await assert.rejects(runMediaClosure(dependencies(s,{stop:async()=>{throw Error('unknown-provider-stop');}})),/unknown-provider-stop/);assert(!s.calls.includes('safeUnpause'));assert(!s.published);});

test('standard numeric XML references decode once, invalid controls/surrogates/entities stay rejected',()=>{const row=version('Version','null').replace('</Version>','<ETag>&#34;safe&#x22;</ETag></Version>');assert.deepEqual(exactCanaryVersions(listing(row),canary),[{versionId:'null'}]);for(const entity of ['&#0;','&#xD800;','&#1114112;','&#x1F;','&#999999999999;','&external;'])assert.throws(()=>exactCanaryVersions(listing(row.replace('&#34;',entity)),canary));});


test('actual writer validator binds the explicit release argument, CID/image/service/PID and approved sole-writer scope',()=>{
 const p=plan(),r={expectedActive:{containerId:'a'.repeat(64),imageId:'sha256:'+'b'.repeat(64)}};
 const c={Id:r.expectedActive.containerId,Image:r.expectedActive.imageId,Config:{Labels:{'com.docker.compose.project':'cop','com.docker.compose.service':'cop-api'}},State:{Running:true,Paused:false,Pid:100}};
 assert.doesNotThrow(()=>checkWriter(c,p,r));
 for(const edit of [v=>{v.Id='e'.repeat(64);},v=>{v.Image='sha256:'+'e'.repeat(64);},v=>{v.State.Pid=0;},v=>{v.State.Pid=1.5;},v=>{v.State.Running=false;},v=>{v.Config.Labels['com.docker.compose.service']='cop-web';}]){const v=structuredClone(c);edit(v);assert.throws(()=>checkWriter(v,p,r),/MEDIA_WRITER_CHANGED/);}
 assert.throws(()=>checkWriter(c,{...p,writerContainerIds:['e'.repeat(64)]},r),/MEDIA_FOREIGN_WRITER/);
 assert.throws(()=>checkWriter(c,p),/MEDIA_WRITER_CHANGED/);
 assert.throws(()=>checkWriter(c,p,r,r),/MEDIA_WRITER_CHANGED/);
});
test('transport preflight checks actual read-only inspection identity/image/configuration, without treating Root id alone as proof',()=>{
 const p=plan(),old={accessKeyId:'legacy-short-access-id',secretAccessKey:'synthetic-legacy-secret'};
 const provider={spec:{Id:p.providerContainerId,Image:p.providerImageId},state:{Running:true,Paused:false,Pid:100},configuration:{identities:[{name:'cop-production',credentials:[{accessKey:old.accessKeyId,secretKey:old.secretAccessKey}]},{name:p.otherIdentity,credentials:[{accessKey:'other',secretKey:'other-secret'}]}]}};
 assert.equal(validateStorageInspection(provider,p,old),true);
 for(const edit of [v=>{v.spec.Image='other';},v=>{v.spec.Id='other';},v=>{v.state.Paused=true;},v=>{v.configuration.identities[0].credentials[0].secretKey='changed';},v=>{v.configuration.identities.pop();}]){const v=structuredClone(provider);edit(v);assert.throws(()=>validateStorageInspection(v,p,old));}
 assert.throws(()=>validateStorageInspection({uid:0},p,old),/MEDIA_STORAGE_INSPECTION_UNPROVEN/);
});


test('post-deploy media canary is restricted to the guarded COP runtime and exact owned synthetic path',()=>{
 const env={COP_ACCOUNT_SAFETY_GUARD_REQUIRED:'true',COP_MEDIA_UPLOAD_TRANSPORT:'cop_api',COP_MEDIA_S3_ENDPOINT:'http://storage.home.cz:8333',COP_MEDIA_S3_BUCKET:'cop-community-media'};
 const key='community-reports/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/release-check.txt';assert.equal(validateRuntimeMediaProbe(env,key),true);
 for(const edit of [v=>{v.COP_ACCOUNT_SAFETY_GUARD_REQUIRED='false';},v=>{v.COP_MEDIA_UPLOAD_TRANSPORT='presigned';},v=>{v.COP_MEDIA_S3_BUCKET='other';},v=>{v.COP_MEDIA_S3_ENDPOINT='https://public.invalid';}]){const bad={...env};edit(bad);assert.throws(()=>validateRuntimeMediaProbe(bad,key));}
 for(const bad of ['../foreign','community-reports/user/private-message.txt',key+'-neighbour'])assert.throws(()=>validateRuntimeMediaProbe(env,bad));
});


test('storage password master and command argv are fixed same-host, strict-key and cannot fall back to a new login',()=>{
 const master=storageTransportArguments('master'),command=storageTransportArguments('command'),exit=storageTransportArguments('exit');
 assert(master.includes('ControlPersist=15m'));assert(master.includes('PubkeyAuthentication=no'));assert(master.includes('PreferredAuthentications=password'));assert(master.includes('NumberOfPasswordPrompts=1'));assert(master.includes('BatchMode=no'));
 for(const args of [master,command,exit]){assert(args.includes('StrictHostKeyChecking=yes'));assert(args.includes('ForwardAgent=no'));assert(args.includes('ClearAllForwardings=yes'));assert(args.includes('voldzi@storage.home.cz'));assert(args.includes('/run/cop-storage-transport/master.sock'));assert(!args.includes('-A'));}
 assert(command.includes('ProxyCommand=/usr/bin/false'));assert(command.includes('ControlMaster=no'));assert(command.includes('BatchMode=yes'));assert(exit.includes('exit'));assert.throws(()=>storageTransportArguments('custom'));
});

test('storage transport cleanup is idempotent on success and failure, with no operation on a foreign replaced socket',()=>{
 const fixture=(result,foreign=false)=>{const calls=[],owner={id:'owned'};let removed=false;return {calls,d:{create:()=>{calls.push('create');return owner;},authenticate:args=>{calls.push(['auth',args]);return result;},capture:()=>{calls.push('capture');},owned:()=>!foreign,exit:args=>{calls.push(['exit',args]);},remove:()=>{if(!foreign){removed=true;calls.push('remove');}}},removed:()=>removed};};
 const good=fixture({status:0,stdout:'0\n'}),session=storageTransportLifecycle(good.d);session.cleanup();session.cleanup();assert(good.removed());assert.equal(good.calls.filter(v=>Array.isArray(v)&&v[0]==='exit').length,1);
 for(const result of [{status:1,stdout:''},{status:0,stdout:'1000\n'},{status:0,stdout:'banner\n0\n'}]){const f=fixture(result);assert.throws(()=>storageTransportLifecycle(f.d));assert(f.removed());}
 const foreign=fixture({status:0,stdout:'0\n'},true);assert.throws(()=>storageTransportLifecycle(foreign.d));assert(!foreign.removed());assert(!foreign.calls.some(v=>Array.isArray(v)&&v[0]==='exit'));
});

test('media carrier inherits the existing held lock and checks the actual profile before and after its fixed worker',()=>{const r=spawnSync('python3',['-B','-c',"import sys;compile(sys.stdin.read(),'media-profile-stage','exec')"],{input:MEDIA_PROFILE_STAGE_PROGRAM,encoding:'utf8'});assert.equal(r.status,0,'Private diagnostics suppressed');assert.match(MEDIA_PROFILE_STAGE_PROGRAM,/fcntl\.flock\(3,fcntl\.LOCK_EX\|fcntl\.LOCK_NB\)/u);assert.equal((MEDIA_PROFILE_STAGE_PROGRAM.match(/operator_profile_witness\(st,current,directory,profile,r\.require\)/gu)??[]).length,2);assert.match(MEDIA_PROFILE_STAGE_PROGRAM,/src='\+witness\['directory'\]\+',dst='\+witness\['directory'\]\+',readonly/u);assert.doesNotMatch(MEDIA_PROFILE_STAGE_PROGRAM,/src=\/var\/run\/docker\.sock/u);});
