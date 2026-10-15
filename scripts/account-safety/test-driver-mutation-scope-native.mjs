/** One owned offline native CLIENT fixture. No SQL, actual Root owner signer,
 * app enrollment, provider call, production credentials or host bind mounts. */
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {cp,mkdir,mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
assert.deepEqual(process.argv.slice(2),['--run']);
const cop=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const receiptPath=join(cop,'docs/testing/account-safety-mutation-scope-native-client-snapshot-20261015.json');
assert.equal(existsSync(receiptPath),false,'Never replace prior evidence.');
const hash=b=>createHash('sha256').update(b).digest('hex'),self=fileURLToPath(import.meta.url),selfPin=hash(await readFile(self));
const image='sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf';
const addon='/private/tmp/cop-root-seqpacket-arm64-20261015.node',addonPin='283f528f6ffce67c46e180a8a7ddcf215c1588dd579cbf36ca507b8896802d20';
assert.equal(hash(await readFile(addon)),addonPin);
const names=['root-records.mjs','root-native.mjs','driver-root-context.mjs','driver-mutation-message.mjs','driver-mutation-scope-client.mjs','driver-mutation-scope-client.test.mjs'];
const sourcePins=Object.fromEntries(await Promise.all(names.map(async name=>[name,hash(await readFile(join(cop,'scripts/account-safety',name)))])));
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','HOME','USER','LOGNAME','LANG','TMPDIR'].includes(k)));
const execute=promisify(execFile),docker=(args,timeout=30000)=>execute('docker',['--host','unix:///Users/voldzi/.docker/run/docker.sock',...args],{env,timeout,maxBuffer:1024*1024});
const found=JSON.parse((await docker(['image','inspect',image])).stdout)[0];assert.equal(found.Id,image);assert.equal(found.Architecture,'arm64');assert.equal(found.Os,'linux');
const suffix=randomBytes(6).toString('hex'),tmp=await mkdtemp('/private/tmp/cop-mutation-client-');
const tree=join(tmp,'tree');await mkdir(join(tree,'native'),{recursive:true,mode:0o700});
let container,success=false,clean=true,receipt;
const startedAt=new Date().toISOString();
try{
  for(const name of names)await cp(join(cop,'scripts/account-safety',name),join(tree,name));
  await cp(addon,join(tree,'native/root-seqpacket.node'));await writeFile(join(tree,'package.json'),' {"type":"module"}\n',{mode:0o600});
  container=(await docker(['create','--pull','never','--name','cop-mutation-client-'+suffix,'--label','cop.owned-test=mutation-scope-client-20261015',
    '--network','none','--memory','256m','--cpus','1','--pids-limit','96','--tmpfs','/run/cop-account-safety/private:rw,nosuid,nodev,mode=0700,size=8388608',
    '--entrypoint','/bin/sh',image,'-c','exec sleep 600'])).stdout.trim();assert.match(container,/^[0-9a-f]{64}$/);
  await docker(['start',container]);await docker(['exec',container,'mkdir','-p','/opt/cop-account-safety']);
  await docker(['cp',tree+'/.',container+':/opt/cop-account-safety']);
  await docker(['exec',container,'chown','-R','0:0','/opt/cop-account-safety']);await docker(['exec',container,'chmod','-R','go-w','/opt/cop-account-safety']);
  const actual=JSON.parse((await docker(['inspect',container])).stdout)[0];
  assert.equal(actual.HostConfig.NetworkMode,'none');assert.equal(actual.HostConfig.Privileged,false);
  assert.equal(actual.Mounts.filter(m=>m.Type==='bind'||m.Type==='volume').length,0);assert.equal(Object.keys(actual.HostConfig.PortBindings??{}).length,0);
  const output=(await docker(['exec','-e','COP_OWNED_NATIVE_FIXTURE=1','-w','/tmp',container,'/usr/local/bin/node','--test','--test-reporter=tap',
    '/opt/cop-account-safety/driver-mutation-scope-client.test.mjs'],90000)).stdout;
  assert.match(output,/# pass 7\b/);assert.match(output,/# fail 0\b/);assert.doesNotMatch(output,/not ok/);
  for(const name of names)assert.equal(hash(await readFile(join(cop,'scripts/account-safety',name))),sourcePins[name]);
  assert.equal(hash(await readFile(self)),selfPin);
  receipt={status:'NATIVE_CLIENT_SYNTHETIC_ROOT_REPLIES_ONLY',startedAt,completedAt:new Date().toISOString(),passed:7,executingRunnerSha256:selfPin,
    sourcePins,nativeAddonSha256:addonPin,image,architecture:'linux-arm64-musl',testOutput:output,
    actual:{nativePackets:true,kernelPeer:true,pidfs:true,ed25519:true,httpSettledSignal:true,twoConcurrentScopes:true,ownerAuthority:false,
      rootMutationSigner:false,sql:false,enrollment:false,productionChanged:false,restore:false,realAccounts:false,externalProviderCalls:false},
    isolation:{externalNetwork:false,hostBindMounts:false,volumes:false,publicPorts:false,imagePull:false,imageBuild:false}};success=true;
}finally{
  if(container)await docker(['rm','-f',container]).catch(()=>{clean=false;});
  if(success&&clean){assert.equal((await stat(tmp)).uid,process.getuid());await rm(tmp,{recursive:true});}
  else console.error('Owned client fixture retained: '+tmp);
}
assert.ok(success&&clean,'Owned test must complete and clean up before publishing evidence.');
receipt.cleanup={ownedContainerRemoved:true,privateContextRemoved:true,globalPrune:false};
await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({receiptPath,passed:7,productionChanged:false}));
