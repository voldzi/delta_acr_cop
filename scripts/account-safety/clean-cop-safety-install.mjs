/** Fixed host Root first enrollment. No Docker mounts/capabilities, listener
 * or application-accessible bridge. Admin password arrives on the private pipe.
 */
import {constants,openSync,fstatSync,readFileSync,closeSync,writeFileSync,fsyncSync,fchmodSync,fchownSync,renameSync,unlinkSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import {provision,validateManifest} from './provision-database-v2.mjs';
import {parseOperatorHostEnvironment} from './operator-profile-environment.mjs';
const need=(v,c)=>{if(!v)throw Error(c)},base='/srv/cop',manifestPath=base+'/runtime/clean-reset/database-enrollment.json';
function read(path,uid){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const s=fstatSync(fd);need(s.isFile()&&s.nlink===1&&s.uid===uid&&(s.mode&0o777)===0o600&&s.size<=1048576,'CLEAN_COP_INSTALL_FILE_CUSTODY');const raw=readFileSync(fd),a=fstatSync(fd);need(s.ino===a.ino&&s.mtimeMs===a.mtimeMs&&s.ctimeMs===a.ctimeMs&&raw.length===s.size,'CLEAN_COP_INSTALL_FILE_CHANGED');return {raw,s};}finally{closeSync(fd)}
}
async function normalizeEnvironment(admission){
 const path=base+'/.env',before=read(path,1000),lines=before.raw.toString('utf8').split(/\r?\n/u);
 parseOperatorHostEnvironment(before.raw.toString('utf8'));
 const seen=new Map(),drop=new Set();for(const[i,line]of lines.entries()){
  const m=/^([A-Z][A-Z0-9_]*)=/u.exec(line);if(!m)continue;
  if(seen.has(m[1])){need(['COP_DEPLOY_DOMAIN','COP_LAB_TOKEN'].includes(m[1])&&!drop.has(seen.get(m[1])),'CLEAN_COP_INSTALL_ENV_DUPLICATE');drop.add(seen.get(m[1]));}seen.set(m[1],i);
 }
 if(!drop.size)return;
 const after=Buffer.from(lines.filter((_,i)=>!drop.has(i)).join('\n'));parseOperatorHostEnvironment(after.toString('utf8'));
 const temporary=path+'.clean-normalize-'+randomUUID();let fd;
 try{
  await admission.assertCurrent();need(read(path,1000).raw.equals(before.raw),'CLEAN_COP_INSTALL_ENV_CHANGED');
  fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  fchownSync(fd,before.s.uid,before.s.gid);fchmodSync(fd,0o600);writeFileSync(fd,after);fsyncSync(fd);closeSync(fd);fd=undefined;
  await admission.assertCurrent();need(read(path,1000).raw.equals(before.raw),'CLEAN_COP_INSTALL_ENV_CHANGED');renameSync(temporary,path);
  const dir=openSync(base,constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(dir)}finally{closeSync(dir)}
  need(read(path,1000).raw.equals(after),'CLEAN_COP_INSTALL_ENV_CHANGED');await admission.assertCurrent();
 }finally{if(fd!==undefined)closeSync(fd);try{unlinkSync(temporary)}catch(e){if(e.code!=='ENOENT')throw e}}
}
export async function installCleanCopSafety(config,{rootGate}){
 need(process.getuid?.()===0&&hostname().split('.')[0]==='docker'&&process.versions.node.split('.')[0]==='24'&&!process.env.NODE_PATH&&!process.env.NODE_OPTIONS,'CLEAN_COP_INSTALL_CONTEXT');
 need(config.phase==='cop_safety_install'&&config.copSafetyInstall?.mode==='apply'&&typeof rootGate?.withResetAdmission==='function','CLEAN_COP_INSTALL_SCOPE');
 const raw=read(manifestPath,0).raw,manifest=validateManifest(JSON.parse(raw)),digest=createHash('sha256').update(raw).digest('hex');
 need(manifest.contractVersion==='cop-database-safety-provision-clean-v1'&&manifest.resetEpoch===config.resetEpoch&&manifest.tokensNotBefore===config.tokensNotBefore&&digest===config.reviewedPlanDigests.cop_safety_install,'CLEAN_COP_INSTALL_MANIFEST');
 return rootGate.withResetAdmission({phase:'cop_safety_install',planDigest:digest,resetEpoch:config.resetEpoch,tokensNotBefore:config.tokensNotBefore},async admission=>{
  await normalizeEnvironment(admission);
  const result=await provision({mode:'apply',manifestPath,admin:{user:'postgres',password:config.copSafetyInstall.password},rootAdmission:admission});
  await admission.assertCurrent();need(read(manifestPath,0).raw.equals(raw),'CLEAN_COP_INSTALL_MANIFEST_CHANGED');
  return {contractVersion:'cop-clean-safety-install-result-v1',resetEpoch:config.resetEpoch,result,erasureEnabled:false,wholeAccountComplete:false};
 });
}
