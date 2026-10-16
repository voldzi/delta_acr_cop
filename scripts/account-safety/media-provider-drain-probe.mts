import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { S3PresignedMediaStorage } from "../../apps/cop-api/src/media-storage.ts";

const container = process.env.COP_MEDIA_PROVIDER_TEST_CONTAINER ?? "";
const endpoint = process.env.COP_MEDIA_PROVIDER_TEST_ENDPOINT ?? "";
const configPath = process.env.COP_MEDIA_PROVIDER_TEST_CONFIG ?? "";
assert.match(container,/^cop-media-provider-test-[a-f0-9]{12}$/u);
assert.match(configPath,/^\/private\/tmp\/cop-media-provider-test-[a-zA-Z0-9_-]+\/s3.json$/u);
assert.equal(new URL(endpoint).hostname,"127.0.0.1");
const docker=(...args:string[])=>execFileSync("docker",args,{encoding:"utf8",maxBuffer:1024*1024}).trim();
const inspect=()=>JSON.parse(docker("inspect",container))[0];
const before=inspect();
assert.equal(before.Config.Labels["cop.test.owner"],"media-provider-drain");
const expectedDigest="sha256:fc9f76fa993ad69966ffeb2f65d0318fcae39c6f8e20cf68ef7b3a5cb97769e5";
assert.equal(before.Config.Image,"chrislusf/seaweedfs@"+expectedDigest);
const make=(key:string,secret:string,bucket="cop-community-media")=>new S3PresignedMediaStorage({accessKeyId:key,secretAccessKey:secret,bucket,endpoint,publicEndpoint:endpoint,region:"us-east-1",uploadExpiresSeconds:900,uploadTransport:"presigned"});
const old=make("synthetic-old","synthetic-old-secret-more-than16"), replacement=make("synthetic-new","synthetic-new-secret-more-than16");
const other=make("synthetic-other","synthetic-other-secret-more-than16","other-fixture-bucket");
for(let attempt=0;;attempt++) {
  try { await old.init(); await other.init(); break; }
  catch { if(attempt>=80) throw new Error("provider_start_failed"); await new Promise(resolve=>setTimeout(resolve,250)); }
}
const keyA="community-reports/fixture-a/attachment-a/synthetic-a.txt", keyB="community-reports/fixture-b/attachment-b/synthetic-b.txt";
await old.putObject({body:Buffer.from("SYNTHETIC_A"),contentType:"text/plain",objectKey:keyA},new Date());
await old.putObject({body:Buffer.from("SYNTHETIC_B"),contentType:"text/plain",objectKey:keyB},new Date());
await other.putObject({body:Buffer.from("SYNTHETIC_OTHER_APP"),contentType:"text/plain",objectKey:keyB},new Date());
const legacy=await old.createUploadSlot({reportId:"fixture-a",attachmentId:"attachment-a",fileName:"synthetic-a.txt",contentType:"text/plain",byteSize:1024*1024},new Date());
let admitted!:()=>void, failed!:()=>void;
const started=new Promise<void>(resolve=>{admitted=resolve;}); const ended=new Promise<void>(resolve=>{failed=resolve;});
const pending=httpRequest(legacy.uploadUrl,{method:"PUT",headers:{"content-type":"text/plain","content-length":1024*1024,Expect:"100-continue"}},response=>{response.resume(); response.once("end",failed);});
pending.on("continue",()=>{pending.write(Buffer.alloc(65536,65)); admitted();}); pending.on("error",failed); pending.flushHeaders();
await Promise.race([started,new Promise((_,reject)=>setTimeout(()=>reject(new Error("slow_upload_not_admitted")),5000))]);
const stoppedAt=new Date(); docker("stop","-t","3",container);
const stopped=inspect(); assert.equal(stopped.State.Running,false); assert.equal(stopped.State.Pid,0);
await Promise.race([ended,new Promise((_,reject)=>setTimeout(()=>reject(new Error("slow_upload_did_not_end")),5000))]); pending.destroy();
const config=JSON.parse(readFileSync(configPath,"utf8"));
const unchanged=JSON.stringify(config.identities.filter((value:{name:string})=>value.name!=="cop-production"));
const selected=config.identities.filter((value:{name:string})=>value.name==="cop-production"); assert.equal(selected.length,1);
selected[0].credentials=[{accessKey:"synthetic-new",secretKey:"synthetic-new-secret-more-than16"}];
assert.equal(JSON.stringify(config.identities.filter((value:{name:string})=>value.name!=="cop-production")),unchanged);
writeFileSync(configPath,JSON.stringify(config),{mode:0o600}); docker("start",container);
for(let attempt=0;;attempt++) {
  try { await replacement.init(); break; }
  catch(error) { if(attempt>=80) throw error; await new Promise(resolve=>setTimeout(resolve,250)); }
}
const after=inspect(); assert.equal(after.Image,before.Image); assert.equal(after.Id,before.Id); assert.notEqual(after.State.StartedAt,before.State.StartedAt);
const denied=await fetch(legacy.uploadUrl,{method:"PUT",headers:{"content-type":"text/plain"},body:"SYNTHETIC_LATE_OLD_WRITE",redirect:"error"});
assert.equal(denied.status,403); await denied.body?.cancel();
assert.equal((await replacement.getObject({objectKey:keyB},new Date())).body.toString(),"SYNTHETIC_B");
assert.equal((await other.getObject({objectKey:keyB},new Date())).body.toString(),"SYNTHETIC_OTHER_APP");
await replacement.putObject({body:Buffer.from("SYNTHETIC_NEW_WRITE"),contentType:"text/plain",objectKey:keyA},new Date());
assert.equal((await replacement.getObject({objectKey:keyA},new Date())).body.toString(),"SYNTHETIC_NEW_WRITE");
const evidence={contractVersion:"cop-media-provider-drain-probe-v1",providerDigest:expectedDigest,providerImageId:after.Image,
  providerStoppedAt:stoppedAt.toISOString(),providerRestartedAt:after.State.StartedAt,oldCredentialDeniedAt:new Date().toISOString(),
  legacySlowBodyTerminated:true,legacySignatureDeniedAfterRestart:true,secondAccountPreserved:true,otherIdentityAndBucketPreserved:true,
  newCredentialWorks:true,productionChanged:false,finalMetadataFaultInjection:false};
console.log(JSON.stringify({...evidence,evidenceDigest:createHash("sha256").update(JSON.stringify(evidence)).digest("hex")}));
