import argparse,importlib.util,pathlib,json,shlex,hashlib
ROOT=pathlib.Path(__file__).resolve().parents[2];spec=importlib.util.spec_from_file_location('whole',ROOT/'scripts/test-account-erasure-whole-joint.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
parser=argparse.ArgumentParser();parser.add_argument('--manifest',required=True);parser.add_argument('--server-local',action='store_true');parser.add_argument('--source-proof');parser.add_argument('--source-proof-sha256');args=parser.parse_args();m.configure_server_local(args);p=m.safe_manifest(args.manifest,True);f=json.loads(p.read_text());ref=f['providerFixtures']['edge'];m.check_owned(ref['container'],f['sharedHolderOwner']);auth=f['edge']['centralAuth'];holder=json.loads(m.remote('docker inspect '+shlex.quote(f['sharedHolder'])).stdout)[0];holder_id=holder['Id']
if auth.get('issuer')!=f['issuer'] or auth.get('clientId')!='cop-edge-whole-sync' or auth.get('mode')!='oidc':raise RuntimeError('NEW_EDGE_OIDC_BINDING_REJECTED')
boot="""import {readFileSync,writeFileSync} from 'node:fs';
import {readEdgeConfig,startEdgeServer} from './edge/index.js';
const m=JSON.parse(readFileSync('/fixture/cop-edge.json','utf8'));
if(m.centralAuth?.mode!=='oidc'||m.centralAuth.issuer!=='https://cop-erasure-keycloak.invalid/realms/cop-erasure-whole'||m.centralAuth.clientId!=='cop-edge-whole-sync')throw Error('ACTUAL_EDGE_OIDC_REQUIRED');
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{const url=new URL(String(input));if(url.origin==='https://cop-erasure-keycloak.invalid'&&url.pathname.startsWith('/realms/cop-erasure-whole/'))return originalFetch('http://127.0.0.1:8080'+url.pathname+url.search,options);if(url.origin==='http://127.0.0.1:4310')return originalFetch(input,options);throw Error('OWNED_EDGE_TRANSPORT_SCOPE_REJECTED');};
writeFileSync('/fixture/edge-process.pid',String(process.pid),{mode:0o600});
await startEdgeServer(readEdgeConfig({COP_EDGE_DATA_DIR:'/data/edge',COP_EDGE_HOST:'127.0.0.1',COP_EDGE_PORT:'4313',COP_EDGE_NODE_ID:m.nodeId,COP_EDGE_ADMIN_TOKEN:m.adminToken,COP_EDGE_AUTO_SYNC:'false',COP_EDGE_CENTRAL_API_URL:'http://127.0.0.1:4310',COP_EDGE_CENTRAL_AUTH_MODE:'oidc',COP_EDGE_CENTRAL_OIDC_ISSUER:m.centralAuth.issuer,COP_EDGE_CENTRAL_OIDC_CLIENT_ID:m.centralAuth.clientId,COP_EDGE_CENTRAL_OIDC_CLIENT_SECRET:m.centralAuth.clientSecret,COP_EDGE_CLASSIFICATION_MAX:'INTERNAL'}));
"""
source=r"""
import{readFileSync,writeFileSync,renameSync,existsSync}from'node:fs';import{createHash,randomBytes}from'node:crypto';const{auth,boot,holderId,owner}=JSON.parse(readFileSync(0,'utf8')),path='/fixture/cop-edge.json',before=readFileSync(path),m=JSON.parse(before);if(m.holderId!==holderId||m.fixtureOwner!==owner||m.centralAuth)throw Error('EDGE_NEW_BINDING_CONFLICT');
const pid=Number(readFileSync('/fixture/edge-process.pid','utf8')),cmd=readFileSync('/proc/'+pid+'/cmdline').toString().split('\0').filter(Boolean);if(pid<=1||pid===process.pid||cmd.length!==2||cmd[0]!=='node'||cmd[1]!=='/probe/boot.mjs')throw Error('EDGE_CHILD_PROCESS_UNPROVEN');
const state=JSON.parse(readFileSync('/data/edge/state.json','utf8'));if((state.inboundEvents??[]).length||(state.outbox??[]).length||(state.deadLetters??[]).length)throw Error('EDGE_NOT_EMPTY_BEFORE_BINDING');
process.kill(pid,'SIGTERM');const deadline=Date.now()+10000;while(existsSync('/proc/'+pid)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));if(existsSync('/proc/'+pid))throw Error('EDGE_CHILD_NOT_STOPPED');
m.centralAuth=auth;m.fixtureBootSha256=createHash('sha256').update(boot).digest('hex');const tmp=path+'.'+randomBytes(8).toString('hex');writeFileSync(tmp,JSON.stringify(m),{mode:384,flag:'wx'});if(!readFileSync(path).equals(before))throw Error('EDGE_PRIVATE_BINDING_CAS_FAILED');renameSync(tmp,path);writeFileSync('/probe/boot.mjs',boot,{mode:384});console.log(JSON.stringify({exactEmptyChildRebound:true,bootSha256:m.fixtureBootSha256}));
"""
r=m.remote('docker exec --user 0:0 -i '+ref['container']+' node --input-type=module -e '+shlex.quote(source),json.dumps({'auth':auth,'boot':boot,'holderId':holder_id,'owner':f['sharedHolderOwner']}),check=False,timeout=25)
if r.returncode:
 import re
 codes=re.findall(r'Error: ([A-Z0-9_]+)',r.stderr);print(json.dumps({'phase':'new_edge_oidc_prepare_failed','code':codes[-1] if codes else 'OWNED_EDGE_PREPARE_FAILED'}));raise SystemExit(2)
m.remote('docker exec --user 0:0 -d '+ref['container']+' node /probe/boot.mjs',timeout=15)
proof=r"""import{readFileSync}from'node:fs';const m=JSON.parse(readFileSync('/fixture/cop-edge.json','utf8'));for(let n=0;n<50;n++){try{const r=await fetch(m.endpoint+'/edge/internal/account-erasure/capabilities',{headers:{authorization:'Bearer '+m.adminToken},signal:AbortSignal.timeout(1000)}),v=await r.json();if(r.status!==200||v.writerFenceInstalled!==true||v.stateReadbackVerified!==true||v.nodeId!==m.nodeId||Object.keys(v).sort().join()!=='contractVersion,nodeId,stateReadbackVerified,writerFenceInstalled')throw Error();console.log(JSON.stringify({actualCapabilitiesVerified:true,fixtureBootSha256:m.fixtureBootSha256,oidcConfigured:true}));break;}catch{if(n===49)throw Error('EDGE_ACTUAL_CAPABILITIES_UNAVAILABLE');await new Promise(r=>setTimeout(r,100));}}"""
r=m.remote('docker exec --user 0:0 '+ref['container']+' node --input-type=module -e '+shlex.quote(proof),check=False,timeout=25)
if r.returncode:raise RuntimeError('EDGE_ACTUAL_POSTBINDING_PROBE_FAILED')
v=json.loads(r.stdout.strip());latest=json.loads(p.read_text());latest['edge']['fixtureBootSha256']=v['fixtureBootSha256'];m.replace_private(p,latest);print(json.dumps({'phase':'new_edge_actual_oidc_configured','container':ref['container'],**v,'actualCentralSyncVerified':False,'productionChanged':False}))
