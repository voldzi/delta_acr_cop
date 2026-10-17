from pathlib import Path
import json,os,socket,subprocess,hashlib,uuid,tarfile,shutil,stat
BASE=Path('/srv/x5-production/staging/cop/clean-operator-2e61857')
IMAGE='sha256:2e61857d00f7fe0326a7b50a8f96f0cb4563d4d9028645dc08efe51b84e800df'
ENV={'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/home/voldzi','LANG':'C','DOCKER_HOST':'unix:///var/run/docker.sock'}
def need(x,c):
 if not x:raise RuntimeError(c)
def run(args):
 r=subprocess.run(args,env=ENV,capture_output=True,timeout=300,check=False);need(r.returncode==0,'PUBLIC_OPERATOR_PREPARATION_FAILED');return r.stdout
need(os.getuid()==1000 and socket.gethostname().split('.')[0]=='docker','PUBLIC_OPERATOR_HOST')
need(run(['/usr/bin/findmnt','-n','-o','UUID','--mountpoint','/srv/x5-production']).decode().strip()=='2f93f595-b61b-4eea-9054-7afa9b275b5b','PUBLIC_OPERATOR_X5')
if BASE.exists():
 need(BASE.resolve()==BASE and BASE.stat().st_uid==1000 and (BASE.stat().st_mode&0o777)==0o700 and not (BASE/'public-runtime-receipt.json').exists(),'PUBLIC_OPERATOR_DESTINATION_EXISTS')
 for directory,dirs,files in os.walk(BASE,followlinks=False):
  for path in [Path(directory),*[Path(directory)/x for x in dirs+files]]:
   need(path.lstat().st_uid==1000 and path.lstat().st_dev==BASE.stat().st_dev,'PUBLIC_OPERATOR_PARTIAL_NOT_OWNED')
  os.chmod(directory,0o700)
 shutil.rmtree(BASE)

need(json.loads(run(['/usr/bin/docker','image','inspect',IMAGE]))[0]['Config']['Labels']['org.opencontainers.image.revision']=='6c5c9855b29644cdc6e86b5b66166c861226cdba','PUBLIC_OPERATOR_IMAGE')
os.umask(0o077);BASE.mkdir(mode=0o700)
name='cop-clean-operator-export-'+uuid.uuid4().hex
cid=run(['/usr/bin/docker','create','--name',name,'--network','none','--label','cop.clean.operator.image='+IMAGE,'--entrypoint','node',IMAGE]).decode().strip()
try:
 for src,dest in [('/app',BASE/'app'),('/usr/local/bin/node',BASE/'runtime/usr/local/bin/node'),('/lib/ld-musl-x86_64.so.1',BASE/'runtime/lib/ld-musl-x86_64.so.1'),('/usr/lib/libstdc++.so.6.0.34',BASE/'runtime/usr/lib/libstdc++.so.6.0.34'),('/usr/lib/libgcc_s.so.1',BASE/'runtime/usr/lib/libgcc_s.so.1')]:
  dest.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  copy=subprocess.Popen(['/usr/bin/docker','cp',cid+':'+src,'-'],env=ENV,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
  try:
   with tarfile.open(fileobj=copy.stdout,mode='r|') as archive: archive.extractall(dest.parent,filter='data')
   need(copy.wait(timeout=300)==0,'PUBLIC_OPERATOR_COPY_FAILED')
  finally:
   if copy.poll() is None:copy.kill();copy.wait()

finally:
 need(run(['/usr/bin/docker','inspect','--format','{{.Image}} {{.State.Status}}',cid]).decode().strip()==IMAGE+' created','PUBLIC_OPERATOR_EXPORT_CHANGED')
 run(['/usr/bin/docker','rm',cid])
(BASE/'runtime/usr/lib/libstdc++.so.6').symlink_to('libstdc++.so.6.0.34')
(BASE/'runtime/lib/libc.musl-x86_64.so.1').symlink_to('ld-musl-x86_64.so.1')
loader=str(BASE/'runtime/lib/ld-musl-x86_64.so.1');node=str(BASE/'runtime/usr/local/bin/node');libraries=str(BASE/'runtime/lib')+':'+str(BASE/'runtime/usr/lib')
code="const{createRequire}=require('node:module');const q=createRequire("+json.dumps(str(BASE/'app/apps/cop-api/package.json'))+");if(process.versions.node.split('.')[0]!=='24'||q('pg/package.json').version!=='8.23.1'||typeof q('pg').Pool!=='function')process.exit(1);console.log(JSON.stringify({node:process.versions.node,pg:q('pg/package.json').version,uid:process.getuid(),hostExecution:true}));"
proof=json.loads(run([loader,'--library-path',libraries,node,'-e',code]))
receipt={'contractVersion':'cop-public-operator-runtime-v1','imageId':IMAGE,'sourceRevision':'6c5c9855b29644cdc6e86b5b66166c861226cdba','root':str(BASE),'loaderSha256':hashlib.sha256(Path(loader).read_bytes()).hexdigest(),'nodeSha256':hashlib.sha256(Path(node).read_bytes()).hexdigest(),'probe':proof,'rootSealed':False,'productionConfigurationRead':False,'applicationChanged':False}
(BASE/'public-runtime-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
