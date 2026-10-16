import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {request as httpRequest} from 'node:http';
import {S3PresignedMediaStorage} from './media-storage.js';
const path='/fixture/cop-media.json';
const manifest=JSON.parse(readFileSync(path,'utf8'));
assert.equal(manifest.contractVersion,'cop-media-whole-fixture-v1');
assert.equal(manifest.endpoint,'http://127.0.0.1:8333');
const save=()=>writeFileSync(path,JSON.stringify(manifest),{mode:0o600});
const make=(credential,bucket=manifest.bucket)=>new S3PresignedMediaStorage({accessKeyId:credential.accessKeyId,secretAccessKey:credential.secretAccessKey,
 bucket,endpoint:manifest.endpoint,publicEndpoint:manifest.endpoint,region:'us-east-1',uploadExpiresSeconds:900});
const old=make(manifest.legacy),current=make(manifest.current),other=make(manifest.other,'other-fixture-bucket');
const at=()=>new Date();
const keys={a:'community-reports/fixture-a/attachment-a/synthetic-a.txt',b:'community-reports/fixture-b/attachment-b/synthetic-b.txt'};
const wait=async storage=>{for(let n=0;;n++){try{await storage.init();return;}catch(error){if(n>120)throw error;await new Promise(r=>setTimeout(r,250));}}};
const waitRead=async(storage,key,expected)=>{for(let n=0;;n++){try{assert.equal((await storage.getObject({objectKey:key},at())).body.toString(),expected);return;}catch(error){if(n>100)throw error;await new Promise(r=>setTimeout(r,250));}}};
const phase=process.argv[2];
if(phase==='seed'){
 await wait(old);await other.init();
 await old.putObject({objectKey:keys.a,contentType:'text/plain',body:Buffer.from('SYNTHETIC_A')},at());
 await old.putObject({objectKey:keys.b,contentType:'text/plain',body:Buffer.from('SYNTHETIC_B')},at());
 await other.putObject({objectKey:keys.b,contentType:'text/plain',body:Buffer.from('SYNTHETIC_OTHER')},at());
 manifest.legacySlot=await old.createUploadSlot({reportId:'fixture-a',attachmentId:'attachment-a',fileName:'synthetic-a.txt',contentType:'text/plain',byteSize:1048576},at());save();
 console.log(JSON.stringify({phase,seeded:true}));
}else if(phase==='slow'){
 const result=await new Promise(resolve=>{
  const request=httpRequest(manifest.legacySlot.uploadUrl,{method:'PUT',headers:{'content-type':'text/plain','content-length':1048576,Expect:'100-continue'}},response=>{response.resume();response.once('end',()=>resolve(response.statusCode));});
  request.on('continue',()=>{request.write(Buffer.alloc(65536,65));writeFileSync('/fixture/admitted.json',JSON.stringify({at:at().toISOString()}),{mode:0o600});});
  request.once('error',()=>resolve('transport-ended'));request.flushHeaders();
 });
 writeFileSync('/fixture/slow-ended.json',JSON.stringify({result,at:at().toISOString()}),{mode:0o600});console.log(JSON.stringify({phase,ended:true}));
}else if(phase==='rotate'){
 const config=JSON.parse(readFileSync('/fixture/s3.json','utf8'));
 const before=JSON.stringify(config.identities.filter(v=>v.name!=='cop-production'));
 const selected=config.identities.filter(v=>v.name==='cop-production');assert.equal(selected.length,1);
 selected[0].credentials=[{accessKey:manifest.current.accessKeyId,secretKey:manifest.current.secretAccessKey}];
 assert.equal(JSON.stringify(config.identities.filter(v=>v.name!=='cop-production')),before);
 writeFileSync('/fixture/s3.json',JSON.stringify(config),{mode:0o600}); console.log(JSON.stringify({phase,scoped:true}));
}else if(phase==='verify'){
 await wait(current);
 const denied=await fetch(manifest.legacySlot.uploadUrl,{method:'PUT',headers:{'content-type':'text/plain'},body:'SYNTHETIC_LATE',redirect:'error'});
 assert.equal(denied.status,403);await denied.body?.cancel();
 await waitRead(current,keys.b,'SYNTHETIC_B');
 await waitRead(other,keys.b,'SYNTHETIC_OTHER');
 await current.putObject({objectKey:keys.a,contentType:'text/plain',body:Buffer.from('SYNTHETIC_NEW')},at());
 assert.equal((await current.getObject({objectKey:keys.a},at())).body.toString(),'SYNTHETIC_NEW');
 const fingerprint=v=>createHash('sha256').update('cop-media-server-credential-v1\0').update(JSON.stringify([v.accessKeyId,v.secretAccessKey])).digest('hex');
 manifest.credentialFingerprint=fingerprint(manifest.current);manifest.previousCredentialFingerprint=fingerprint(manifest.legacy);
 manifest.providerEvidence.oldCredentialDeniedAt=at().toISOString();
 manifest.providerEvidence.legacySlowBodyTerminated=true;manifest.providerEvidence.oldSignatureDenied=true;
 manifest.providerEvidence.newCredentialWorks=true;manifest.providerEvidence.secondAccountPreserved=true;manifest.providerEvidence.otherIdentityAndBucketPreserved=true;
 manifest.providerEvidence.evidenceDigest=createHash('sha256').update(JSON.stringify(manifest.providerEvidence)).digest('hex');save();
 console.log(JSON.stringify({phase,passed:true,evidenceDigest:manifest.providerEvidence.evidenceDigest}));
}else throw new Error('fixed_test_phase_required');
