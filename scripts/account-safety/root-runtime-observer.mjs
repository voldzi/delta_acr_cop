/** Host Root observer. No application callback, arbitrary container, exec API,
 * environment-selected socket, image adoption or accepted policy is supplied.
 * Collection is factual only; enrollment must independently accept its pins. */
import { request as httpRequest } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, lstatSync } from 'node:fs';
import { canonical, exact, hex, sha256, requireGuard, requireRootCodeTree } from './root-records.mjs';

const execute = promisify(execFile);
const CONTAINERS = Object.freeze({ cop_api: 'cop-cop-api-1', sim_driver_measurements: 'csm-sim-situation-data-api',
  sim_ai_router: 'csm-sim-ai-router-api', broker: 'cop-account-safety-root' });
const ENTRIES = Object.freeze({ cop_api: '/app/apps/cop-api/dist/index.js', sim_driver_measurements: '/app/apps/situation-data-api/dist/index.js',
  sim_ai_router: '/app/apps/ai-router-api/dist/index.js', broker: '/opt/cop-account-safety/driver-root-channel.mjs' });

export function runtimeConfigurationDigest(info) {
  requireGuard(info?.State && typeof info.State.Running === 'boolean' && Number.isSafeInteger(info.State.Pid) && info.State.Pid >= 0, 'GUARD_RUNTIME_FACTS');
  requireGuard(info.Config && Array.isArray(info.Config.Env) && info.HostConfig && Array.isArray(info.Mounts), 'GUARD_RUNTIME_FACTS');
  // Secrets are transient only; return a digest, never resolved environment.
  return sha256(canonical({ environment: [...info.Config.Env].sort(), entrypoint: info.Config.Entrypoint ?? null,
    command: info.Config.Cmd ?? null, user: info.Config.User ?? '', labels: info.Config.Labels ?? {}, image: info.Image,
    readOnly: info.HostConfig.ReadonlyRootfs, network: info.HostConfig.NetworkMode, pidMode: info.HostConfig.PidMode,
    security: info.HostConfig.SecurityOpt ?? [], capabilitiesAdded: info.HostConfig.CapAdd ?? [], capabilitiesDropped: info.HostConfig.CapDrop ?? [],
    groups: info.HostConfig.GroupAdd ?? [], mounts: info.Mounts.map(m => ({ type: m.Type, source: m.Source, target: m.Destination,
      writable: m.RW, propagation: m.Propagation ?? '' })).sort((a, b) => a.target.localeCompare(b.target)) }));
}
async function dockerFacts(owner) {
  requireGuard(Object.hasOwn(CONTAINERS, owner), 'GUARD_RUNTIME_OWNER');
  const socket = '/run/docker.sock', s = lstatSync(socket);
  requireGuard(s.isSocket() && s.uid === 0 && s.nlink === 1 && (s.mode & 0o002) === 0, 'GUARD_DOCKER_SOCKET');
  return new Promise((resolve, reject) => {
    const req = httpRequest({ socketPath: socket, method: 'GET', path: '/v1.47/containers/' + CONTAINERS[owner] + '/json' }, res => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('GUARD_RUNTIME_UNAVAILABLE')); return; }
      const chunks = []; let total = 0;
      res.on('data', bytes => { total += bytes.length; if (total > 2_097_152) { req.destroy(); reject(new Error('GUARD_RUNTIME_SIZE')); } else chunks.push(bytes); });
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('GUARD_RUNTIME_FACTS')); } });
      res.on('error', () => reject(new Error('GUARD_RUNTIME_UNAVAILABLE')));
    });
    req.setTimeout(3000, () => req.destroy()); req.on('error', () => reject(new Error('GUARD_RUNTIME_UNAVAILABLE'))); req.end();
  });
}
export const ROOT_PROCESS_OBSERVER = String.raw`
import os,sys,json,hashlib,re
root=int(sys.argv[1]); entry=sys.argv[2]
assert root>0 and entry.startswith('/')
queue=[root]; seen=set(); found=[]
base=open('/proc/%d/cgroup'%root,'rb').read()
while queue:
 p=queue.pop(0)
 if p in seen: continue
 seen.add(p); assert len(seen)<=256
 try:
  assert open('/proc/%d/cgroup'%p,'rb').read()==base
  argv=[v.decode('utf8','strict') for v in open('/proc/%d/cmdline'%p,'rb').read().split(b'\0') if v]
  cwd=os.readlink('/proc/%d/cwd'%p)
  # The script is the first non-option Node argument, never an arbitrary
  # trailing argument to --eval/--print or a different executable script.
  matches=False
  if os.path.basename(os.readlink('/proc/%d/exe'%p))=='node':
   args=argv[1:]
   while args and args[0].startswith('-'):
    flag=args.pop(0)
    assert flag in ('--enable-source-maps','--no-warnings','--unhandled-rejections=strict') or re.fullmatch(r'--max-old-space-size=[1-9][0-9]{1,5}',flag)
   matches=len(args)==1 and os.path.normpath(args[0] if args[0].startswith('/') else cwd+'/'+args[0])==entry
  if matches:
   environment=open('/proc/%d/environ'%p,'rb').read().split(b'\0')
   assert not any(v.startswith((b'NODE_OPTIONS=',b'NODE_PATH=')) and v.split(b'=',1)[1] for v in environment)
   fd=os.pidfd_open(p,0)
   try:
    st=os.fstat(fd)
    status=open('/proc/%d/status'%p).read().splitlines()
    uid=int(next(l for l in status if l.startswith('Uid:')).split()[1]); gid=int(next(l for l in status if l.startswith('Gid:')).split()[1])
    raw=open('/proc/%d/stat'%p).read(); ticks=raw[raw.rfind(')')+2:].split()[19]
    with open('/proc/%d/exe'%p,'rb') as exe: exe_digest=hashlib.file_digest(exe,'sha256').hexdigest()
    found.append({'peer':{'device':str(st.st_dev),'inode':str(st.st_ino),'uid':uid,'gid':gid},'startTicks':ticks,'executableDigest':exe_digest})
   finally: os.close(fd)
  children=open('/proc/%d/task/%d/children'%(p,p)).read()
  assert len(children)<=16384
  queue.extend(int(v) for v in children.split())
 except FileNotFoundError: pass
assert len(found)==1
print(json.dumps(found[0],sort_keys=True,separators=(',',':')))
`;
async function actualNodeProcess(info, owner) {
  requireGuard(info.State?.Running === true && Number.isSafeInteger(info.State.Pid) && info.State.Pid > 0, 'GUARD_RUNTIME_NOT_RUNNING');
  let data;
  try {
    const result = await execute('/usr/bin/python3', ['-I', '-S', '-c', ROOT_PROCESS_OBSERVER, String(info.State.Pid), ENTRIES[owner]],
      { cwd: '/', timeout: 3000, maxBuffer: 16384, env: { PATH: '/usr/bin:/bin', LANG: 'C', PYTHONNOUSERSITE: '1', PYTHONSAFEPATH: '1' } });
    data = JSON.parse(result.stdout);
  } catch { throw new Error('GUARD_PROCESS_UNAVAILABLE'); }
  requireGuard(exact(data, ['peer', 'startTicks', 'executableDigest']) && exact(data.peer, ['device', 'inode', 'uid', 'gid']) &&
    /^[0-9]{1,20}$/.test(data.peer.device) && /^[0-9]{1,20}$/.test(data.peer.inode) && data.peer.inode !== '0' &&
    Number.isSafeInteger(data.peer.uid) && data.peer.uid >= 0 && Number.isSafeInteger(data.peer.gid) && data.peer.gid >= 0 &&
    /^[0-9]{1,20}$/.test(data.startTicks) && hex(data.executableDigest), 'GUARD_PROCESS_FACTS'); return data;
}
export async function collectRuntimeObservation(owner) {
  requireGuard(process.getuid?.() === 0 && process.geteuid?.() === 0 && Object.hasOwn(ENTRIES, owner) && owner !== 'broker', 'ROOT_EXECUTION_REQUIRED');
  requireRootCodeTree('/opt/cop-account-safety');
  const [app, broker] = await Promise.all([dockerFacts(owner), dockerFacts('broker')]);
  requireGuard(app.HostConfig.ReadonlyRootfs === true && broker.HostConfig.ReadonlyRootfs === true, 'GUARD_MUTABLE_RUNTIME');
  const revision = app.Config.Labels?.['org.opencontainers.image.revision'];
  requireGuard(/^sha256:[0-9a-f]{64}$/.test(app.Image) && /^[0-9a-f]{64}$/.test(app.Id) && /^[0-9a-f]{40}$/.test(revision), 'GUARD_RUNTIME_SOURCE');
  const [appProcess, brokerProcess] = await Promise.all([actualNodeProcess(app, owner), actualNodeProcess(broker, 'broker')]);
  requireGuard(BigInt(appProcess.startTicks) > BigInt(brokerProcess.startTicks), 'GUARD_RUNTIME_COHORT_UNPROVEN');
  const [lastApp, lastBroker] = await Promise.all([dockerFacts(owner), dockerFacts('broker')]);
  requireGuard(app.Id === lastApp.Id && broker.Id === lastBroker.Id && app.State.Pid === lastApp.State.Pid && broker.State.Pid === lastBroker.State.Pid &&
    runtimeConfigurationDigest(app) === runtimeConfigurationDigest(lastApp) && runtimeConfigurationDigest(broker) === runtimeConfigurationDigest(lastBroker), 'GUARD_RUNTIME_CHANGED');
  return Object.freeze({ contractVersion: 'cop-root-host-observation-v1', owner, observedAtUTC: new Date().toISOString(),
    machineBootId: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), dockerContainerId: app.Id, imageId: app.Image,
    sourceRevision: revision, configurationDigest: runtimeConfigurationDigest(app), readOnlyRootfs: true, ...appProcess,
    broker: { dockerContainerId: broker.Id, imageId: broker.Image, configurationDigest: runtimeConfigurationDigest(broker), ...brokerProcess } });
}
