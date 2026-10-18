"""Finite Root recovery of the exact unexecuted v13 preparation.
No standalone apply CLI, reset, identity mutation, database write or secret file.
The outer reviewed release owns SSH lifetime and explicit operator confirmation.
"""
import ctypes
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import types

sys.dont_write_bytecode = True

TARGET = Path('/srv/x5-production/staging/cop/clean-operator-shared-v3')
BASE = Path('/srv/cop/runtime/clean-reset')
ARCHIVE = BASE.with_name('clean-reset-prepared-v13-8405e8e7')
PROOF_SHA = '66b6fb13c8a52c3d06f6aecafe3c9b101e5376cda3049988843e9d4961e0e38a'
EPOCH_SHA = '8405e8e7bf74259847efa2316bab99c97ccd254e174462c94bc9474821349472'
MANIFEST_SHA = '9fd458db4285e833571caa1447ff5ea5374867954c9626da5d5b911fe7e6b08e'
REVISION = 'ca3dc8bca6aa8c6b2257d7c929859d5461f5dafb'
FILES = {'whole12-acceptance.json': (0o600, 0), 'plan.json': (0o600, 0),
         'database-enrollment.json': (0o600, 0), 'web-source.json': (0o640, 1000),
         'operator-source.json': (0o640, 1000), 'pre-stop-health.json': (0o640, 1000)}
DIGESTS = {
 'sim_user_install': '180163ed93893bb4b93f88d45996d8568aa78f9f82565841cab5ee2f05659cfc',
 'cop': 'f8583d2b0b5d9f103d8dc5ca7611781104d88e249f9a2962198122c3b43e7439',
 'ai': '65123679a317be4d94821105f879c8eefbde363151fb6af6c64f927fcf03c0a1',
 'driver': '489a68f4bcaafaf676aca3de30c405d8cc91a0be9690e5e0e66e5b4886173f1a',
 'files': 'ca3bb5648d859819b4e092c4563866bafe8a786ca627a2c44c3a4707d2722352',
 'sim_app_files': 'ef39329d3b5ea1ab68447156f4dee346c602ff2aebbe2ed84814317ca4d07d0b',
 'keycloak': 'bff632550a931373461461eb69ffaf6150576bc1f075b2f6263a357c1186f45b',
 'cop_safety_install': '5a02fdc7ad4e939f153cb0d948ffa5e7846881365c0b1f419e6e1892aa414851',
 'messaging': '5477a09f2f16fc4f2cea774b3a651227ef2dbc7452f2d0af77ab7f159ffee499',
 'media': '589f41de317f2b88f0771ed1167db17176f4381be07c41b3d6f3f0150dd9c769',
 'edge': '73d048373aed7e908f38c1d0d029c296fb2c4d78fd9cf23065e62932f1ed15f1',
 'messaging_install': '25de55272f3981f03a2eaf7978b5fcc58fd1ec9c7a43fcc6c87a3866011c3316',
}
SOURCE_PINS = {
 'scripts/account-safety/clean-reset-root.py': '26f59d7f557d829cdde3abac4e0c79096b1032eddecf726dcf467bebe57310af',
 'scripts/cop-api-runtime.py': 'ef033dbeb103ba630f4613f90922198b71be72b93ad878ae707de5342364f6c9',
}
NODE = 'import fs from \'node:fs\';\nimport {createHash} from \'node:crypto\';\nconst input=JSON.parse(fs.readFileSync(0,\'utf8\'));\nconst root=\'/srv/x5-production/staging/cop/clean-operator-shared-v3\';\nconst need=(v)=>{if(!v)throw Error(\'KC_READONLY_DIAG_UNPROVEN\');};\nfunction read(path,owners,modes,max=1048576){const f=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const s=fs.fstatSync(f);need(s.isFile()&&s.nlink===1&&owners.includes(s.uid)&&modes.includes(s.mode&0o777)&&s.size<=max);const b=fs.readFileSync(f);const t=fs.fstatSync(f);need(b.length===s.size&&s.ino===t.ino&&s.mtimeMs===t.mtimeMs&&s.ctimeMs===t.ctimeMs);return b;}finally{fs.closeSync(f);}}\nlet phase=\'source_custody\';\ntry{\n const bootstrap=JSON.parse(read(root+\'/bootstrap-public.json\',[0],[0o444]));need(bootstrap.manifestSha256===\'9fd458db4285e833571caa1447ff5ea5374867954c9626da5d5b911fe7e6b08e\'&&bootstrap.sources.cop.revision===\'ca3dc8bca6aa8c6b2257d7c929859d5461f5dafb\');\n const relative=\'scripts/account-safety/operator-profile-environment.mjs\';const code=read(root+\'/app/\'+relative,[0],[0o444,0o555]);need(createHash(\'sha256\').update(code).digest(\'hex\')===bootstrap.sources.cop.files[relative]);\n const {parseOperatorHostEnvironment}=await import(root+\'/app/\'+relative);\n const e=parseOperatorHostEnvironment(read(\'/srv/cop/.env\',[0,1000],[0o600]).toString());need(e.COP_OIDC_ISSUER===\'https://login.zeleznalady.cz/realms/cop\'&&e.COP_KEYCLOAK_ERASURE_CLIENT_ID===\'cop-account-erasure-worker\'&&e.COP_KEYCLOAK_ERASURE_CLIENT_SECRET?.length>=32);\n async function json(r){const reader=r.body?.getReader();need(reader);let n=0;const chunks=[];try{for(;;){const x=await reader.read();if(x.done)break;n+=x.value.byteLength;need(n<=1048576);chunks.push(x.value);}}finally{reader.releaseLock();}return JSON.parse(Buffer.concat(chunks).toString());}\n const tokenResponse=await fetch(e.COP_OIDC_ISSUER+\'/protocol/openid-connect/token\',{method:\'POST\',redirect:\'error\',signal:AbortSignal.timeout(15000),headers:{\'content-type\':\'application/x-www-form-urlencoded\',\'cache-control\':\'no-store\'},body:new URLSearchParams({grant_type:\'client_credentials\',client_id:e.COP_KEYCLOAK_ERASURE_CLIENT_ID,client_secret:e.COP_KEYCLOAK_ERASURE_CLIENT_SECRET})});\n need(tokenResponse.status===200);const token=await json(tokenResponse);need(typeof token.access_token===\'string\');\n const result={readOnly:true,credentialsPrinted:false,productionChanged:false,tokenStatus:200,clientCount:0,serviceCount:0,listedUserCount:0,pages:0,serviceStatuses:[],userStatuses:[],missingServiceCount:null,duplicateUserCount:0,allUserBindingsValid:true,allServiceBindingsValid:true,ordinaryUsersWithServiceMarker:0,disabledHumanCount:0};\n async function get(path){const r=await fetch(\'https://login.zeleznalady.cz/admin/realms/cop/\'+path,{redirect:\'error\',signal:AbortSignal.timeout(15000),headers:{authorization:\'Bearer \'+token.access_token,\'cache-control\':\'no-store\'}});if(r.status!==200){await r.body?.cancel();return {status:r.status,value:null};}return {status:r.status,value:await json(r)};}\n const clients=await get(\'clients?first=0&max=1024\');result.clientStatus=clients.status;need(Array.isArray(clients.value)&&clients.value.length<1024);result.clientCount=clients.value.length;\n const services=new Set();\n for(const c of clients.value)if(c.serviceAccountsEnabled===true){const s=await get(\'clients/\'+c.id+\'/service-account-user\');result.serviceStatuses.push(s.status);need(s.status===200);result.allServiceBindingsValid&&=typeof s.value.id===\'string\'&&Number.isSafeInteger(s.value.createdTimestamp)&&s.value.createdTimestamp>=0&&(!Object.hasOwn(s.value,\'serviceAccountClientId\')||s.value.serviceAccountClientId===c.clientId);need(!services.has(s.value.id));services.add(s.value.id);}\n result.serviceCount=services.size;const users=[];let closed=false;\n for(let first=0;first<5000;first+=100){const r=await get(\'users?first=\'+first+\'&max=100&briefRepresentation=false\');result.userStatuses.push(r.status);result.pages++;if(r.status!==200||!Array.isArray(r.value)||r.value.length>100)break;for(const u of r.value){if(!services.has(u.id)&&u.enabled!==true)result.disabledHumanCount++;if(Object.hasOwn(u,\'serviceAccountClientId\')&&!services.has(u.id))result.ordinaryUsersWithServiceMarker++;result.allUserBindingsValid&&=typeof u.id===\'string\'&&Number.isSafeInteger(u.createdTimestamp)&&u.createdTimestamp>=0;users.push(u.id);}if(r.value.length<100){closed=true;break;}}\n result.pagesClosed=closed;result.listedUserCount=users.length;result.duplicateUserCount=users.length-new Set(users).size;result.missingServiceCount=[...services].filter(id=>!users.includes(id)).length;result.servicesAlsoListed=services.size-result.missingServiceCount;\n const rel=\'scripts/account-safety/clean-keycloak-reset.mjs\';need(createHash(\'sha256\').update(read(root+\'/app/\'+rel,[0],[0o444,0o555])).digest(\'hex\')===bootstrap.sources.cop.files[rel]);const {createCleanKeycloakReset}=await import(root+\'/app/\'+rel);const plan=await createCleanKeycloakReset({issuer:e.COP_OIDC_ISSUER,clientId:e.COP_KEYCLOAK_ERASURE_CLIENT_ID,clientSecret:e.COP_KEYCLOAK_ERASURE_CLIENT_SECRET}).inspect();result.originalIdentityInventoryMatches=plan.inventoryDigest===\'bff632550a931373461461eb69ffaf6150576bc1f075b2f6263a357c1186f45b\';const u=new URL(input.databaseUrl);need([\'postgres:\',\'postgresql:\'].includes(u.protocol)&&u.hostname===\'haproxy.home.cz\'&&u.port===\'5000\'&&u.pathname===\'/cop\'&&u.searchParams.get(\'sslmode\')===\'verify-full\');phase=\'ca_custody\';const ca=read(\'/etc/vcode-cop-pgbouncer/postgres-ca.crt\',[0],[0o400,0o440,0o444,0o600,0o640,0o644],65536);phase=\'ca_fingerprint\';need(input.caSha256===\'7a3f9d9373cd63361148230e6c2804c6fb76dc204e18d5039aad7c7838d7a14a\'&&createHash(\'sha256\').update(ca).digest(\'hex\')===input.caSha256);phase=\'database_module\';const pg=await import(root+\'/app/apps/cop-api/node_modules/pg/lib/index.js\');const Pool=pg.Pool??pg.default.Pool;const pool=new Pool({host:\'haproxy.home.cz\',port:5000,database:\'cop\',user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:{ca:ca.toString(),rejectUnauthorized:true,servername:\'haproxy.home.cz\'},max:1,connectionTimeoutMillis:5000,query_timeout:5000,application_name:\'cop-v13-prepared-readback\'});pool.on(\'error\',()=>{});let c;try{phase=\'database_connect\';c=await pool.connect();phase=\'database_readonly\';await c.query(\'BEGIN READ ONLY\');const row=(await c.query("SELECT current_database() AS db,current_setting(\'transaction_read_only\') AS ro,to_regclass(\'public.cop_clean_reset_epoch\') IS NULL AS absent")).rows;need(row.length===1&&row[0].db===\'cop\'&&row[0].ro===\'on\');result.copResetMarkerAbsent=row[0].absent;await c.query(\'ROLLBACK\');}finally{c?.release();await pool.end();}console.log(JSON.stringify(result));\n}catch{console.log(JSON.stringify({phase,code:\'KC_READONLY_DIAG_UNPROVEN\',credentialsPrinted:false,productionChanged:false}));process.exitCode=1;}\n'

def need(value, code):
    if not value:
        raise RuntimeError('RELEASE_PREPARED_V13_' + code)

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def context():
    need(os.getuid() == 0 and os.geteuid() == 0 and sys.flags.isolated
         and socket.gethostname().split('.')[0] == 'docker', 'ROOT_REQUIRED')

def identity(s):
    return (s.st_dev, s.st_ino, s.st_uid, s.st_gid, s.st_mode, s.st_nlink,
            s.st_size, s.st_mtime_ns, s.st_ctime_ns)

def read(path, mode, gid=None, limit=1048576):
    need(path.resolve() == path, 'PATH')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        s = os.fstat(fd)
        need(stat.S_ISREG(s.st_mode) and s.st_uid == 0 and s.st_nlink == 1
             and stat.S_IMODE(s.st_mode) in ((mode,) if isinstance(mode, int) else mode)
             and (gid is None or s.st_gid == gid) and s.st_size <= limit, 'FILE_CUSTODY')
        raw = os.read(fd, limit + 1)
        need(len(raw) == s.st_size and identity(s) == identity(os.fstat(fd))
             == identity(path.lstat()), 'FILE_CHANGED')
        return raw, identity(s)
    finally:
        os.close(fd)

def load(relative):
    path = TARGET / 'app' / relative
    raw, _ = read(path, (0o444, 0o555))
    need(digest(raw) == SOURCE_PINS[relative], 'SOURCE')
    m = types.ModuleType('v13_readonly_' + path.stem.replace('-', '_'))
    m.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), m.__dict__)
    return m

def inventory():
    context()
    s = BASE.lstat()
    need(stat.S_ISDIR(s.st_mode) and (s.st_uid, s.st_gid, stat.S_IMODE(s.st_mode))
         == (0, 1000, 0o750) and BASE.resolve() == BASE, 'DIRECTORY')
    need(set(os.listdir(BASE)) == set(FILES), 'CONTROL_INVENTORY')
    rows = {name: read(BASE / name, mode, gid) for name, (mode, gid) in FILES.items()}
    bootstrap = json.loads(read(TARGET / 'bootstrap-public.json', 0o444)[0])
    need(bootstrap['manifestSha256'] == MANIFEST_SHA
         and bootstrap['sources']['cop']['revision'] == REVISION
         and bootstrap['sources']['sim']['revision'] == 'e5b8128c4087f078117815fe12e2e110096f15dc'
         and bootstrap['sources']['messaging']['revision'] == '969a75164a0dd2cf34dac4f426be40702dfc8311',
         'OLD_BOOTSTRAP')
    host = load('scripts/account-safety/clean-reset-root.py')
    plan = host.validate_plan(json.loads(rows['plan.json'][0]))
    need(plan['sources'] == bootstrap['sources'] and plan['reviewedPlanDigests'] == DIGESTS
         and digest(plan['resetEpoch'].encode()) == EPOCH_SHA, 'EXACT_PLAN')
    baseline = json.loads(rows['pre-stop-health.json'][0])
    need(baseline['resetEpoch'] == plan['resetEpoch']
         and baseline['checkedAt'] == '2026-10-18T19:43:02Z'
         and baseline['containerId'] == plan['runtimeBinding']['containerId']
         and baseline['imageId'] == plan['runtimeBinding']['imageId']
         and baseline['preStopReportSha256'] == PROOF_SHA
         and digest(rows['whole12-acceptance.json'][0]) == PROOF_SHA, 'BASELINE')
    need(host._acceptance_module().verified_pre_stop_acceptance(plan['candidateImages'])['reportSha256']
         == PROOF_SHA, 'ACCEPTANCE')
    need(not os.path.lexists(ARCHIVE), 'ARCHIVE_EXISTS')
    return host, plan, rows, identity(s)

def writers(host, run, names, expected):
    fmt = '{{json .Name}}\t{{json .Id}}\t{{json .Image}}\t{{json .State.Running}}\t{{json .State.Paused}}\t{{json .State.Restarting}}\t{{json .State.Status}}\t{{json .State.Pid}}\t{{json .State.StartedAt}}'
    lines = run(['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock',
                 'inspect', '--format', fmt, *names]).decode().splitlines()
    need(len(lines) == len(names), 'WRITERS')
    result = {}
    for name, line in zip(names, lines):
        v = [json.loads(x) for x in line.split('\t')]
        need(len(v) == 9 and v[0] == '/' + name
             and v[1] == expected[name]['id'] and v[2] == expected[name]['image']
             and v[3] is True and v[4] is False and v[5] is False
             and v[6] == 'running' and type(v[7]) is int and v[7] > 0, 'WRITERS_CHANGED')
        need(isinstance(v[8], str) and v[8].endswith('Z')
             and datetime.datetime.fromisoformat(v[8].replace('Z', '+00:00'))
             <= datetime.datetime.fromisoformat('2026-10-18T19:43:02+00:00'),
             'WRITER_RESTARTED_AFTER_BASELINE')
        result[name] = v
    return result

def producers_clear(producer):
    _, _, value = producer._inventory()
    need(value.get('profile') == 'known-retired-v1' and value.get('paused') is True
         and value.get('activeProducerCount') == 0, 'PRODUCERS_NOT_CLEAR')
    return value

def private_workers_clear():
    workers = {os.fsencode(TARGET / 'app/scripts/account-safety' / leaf)
               for leaf in ('clean-reset-worker.mjs', 'clean-files-host-worker.mjs')}
    for path in Path('/proc').glob('[0-9]*/cmdline'):
        try:
            args = path.read_bytes().split(b'\0')
        except (FileNotFoundError, ProcessLookupError):
            continue
        need(not workers.intersection(args), 'PRIVATE_WORKER_ACTIVE')

def preserve_unapplied_v13():
    """Called only after the outer Root CLI's explicit retirement confirmation."""
    host, plan, before, directory = inventory()
    lock = os.open('/srv/cop/.storage.lock', os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
    remote = host.CommunicationResetTransport()
    try:
        s = os.fstat(lock)
        need({'device': s.st_dev, 'inode': s.st_ino, 'uid': s.st_uid,
              'gid': s.st_gid, 'mode': stat.S_IMODE(s.st_mode)}
             == plan['operationLockMetadata'], 'LOCK_CHANGED')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        private_workers_clear()
        remote.open()
        producer = host.DriverReportProducerCustody()
        producer_before = producers_clear(producer)
        local = writers(host, host.command, host.LOCAL_WRITERS, plan['localWriters'])
        distant = writers(host, remote.run, host.REMOTE_WRITERS, plan['remoteWriters'])
        r = load('scripts/cop-api-runtime.py')
        # Pure binding read; this grants no reset admission or mount-probe bypass.
        current, _, _, profile = r.Store(uid=1000).active(probe_mounts=False)
        need(current == plan['runtimeBinding'], 'RUNTIME_CHANGED')
        b = TARGET / 'runtime'
        args = [str(b / 'lib/ld-musl-x86_64.so.1'), '--library-path',
                str(b / 'lib') + ':' + str(b / 'usr/lib'),
                str(b / 'usr/local/bin/node'), '--input-type=module', '-e', NODE]
        data = {'databaseUrl': profile['values']['COP_LEASE_DATABASE_URL'],
                'caSha256': profile['driverContract']['caSha256']}
        # Only this fixed read-only probe may report one of these public stages.
        # Do not forward stderr, exception messages, connection values or SQL.
        probe = subprocess.run(args, input=json.dumps(data).encode(), timeout=90,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               env=host.ENV, check=False)
        need(len(probe.stdout) <= 16384, 'NODE_OUTPUT')
        try:
            observed = json.loads(probe.stdout)
        except (ValueError, TypeError):
            need(False, 'NODE_JSON')
        need(isinstance(observed, dict), 'NODE_JSON')
        if probe.returncode != 0:
            stages = {'source_custody', 'ca_custody', 'ca_fingerprint',
                      'database_module', 'database_connect', 'database_readonly'}
            phase = observed.get('phase')
            need(observed.get('code') == 'KC_READONLY_DIAG_UNPROVEN'
                 and phase in stages, 'NODE_FAILED')
            need(False, 'NODE_' + phase.upper())
        need(observed.get('readOnly') is True and observed.get('originalIdentityInventoryMatches') is True
             and observed.get('disabledHumanCount') == 0 and observed.get('listedUserCount') == 11
             and observed.get('serviceCount') == 3 and observed.get('pagesClosed') is True
             and observed.get('copResetMarkerAbsent') is True, 'UNAPPLIED_STATE_UNPROVEN')
        need(local == writers(host, host.command, host.LOCAL_WRITERS, plan['localWriters'])
             and distant == writers(host, remote.run, host.REMOTE_WRITERS, plan['remoteWriters']),
             'WRITERS_CHANGED')
        need(producers_clear(producer) == producer_before, 'PRODUCERS_CHANGED')
        private_workers_clear()
        _, repeated, after, same_directory = inventory()
        need(repeated == plan and after == before and same_directory == directory, 'INVENTORY_CHANGED')
        parent = BASE.parent
        need(parent.resolve() == parent, 'PARENT')
        parent_info = parent.lstat()
        need((parent_info.st_uid, parent_info.st_gid, stat.S_IMODE(parent_info.st_mode))
             == (1000, 1000, 0o700), 'PARENT')
        fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            need(identity(os.fstat(fd)) == identity(parent_info) == identity(parent.lstat()), 'PARENT_CHANGED')
            need(identity(os.stat(BASE.name, dir_fd=fd, follow_symlinks=False)) == directory
                 and not os.path.lexists(ARCHIVE), 'INVENTORY_CHANGED')
            libc = ctypes.CDLL(None, use_errno=True)
            need(libc.renameat2(fd, os.fsencode(BASE.name), fd, os.fsencode(ARCHIVE.name), 1) == 0,
                 'ARCHIVE_RENAME')
            os.fsync(fd)
            os.mkdir(BASE.name, mode=0o700, dir_fd=fd)
            d = os.open(BASE.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            try:
                os.fchown(d, 0, 0); os.fchmod(d, 0o700)
                proof_fd = os.open('whole12-acceptance.json',
                                   os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                   0o600, dir_fd=d)
                with os.fdopen(proof_fd, 'wb') as f:
                    os.fchown(f.fileno(), 0, 0); os.fchmod(f.fileno(), 0o600)
                    f.write(before['whole12-acceptance.json'][0]); f.flush(); os.fsync(f.fileno())
                os.fsync(d)
            finally:
                os.close(d)
            os.fsync(fd)
            need(identity(os.fstat(fd)) == identity(parent.lstat())
                 and identity(os.fstat(fd))[:5] == identity(parent_info)[:5], 'PARENT_CHANGED')
            need(set(os.listdir(BASE)) == {'whole12-acceptance.json'}
                 and read(BASE / 'whole12-acceptance.json', 0o600, 0)[0] == before['whole12-acceptance.json'][0],
                 'NEW_CONTROL')
            for name, (raw, meta) in before.items():
                need(read(ARCHIVE / name, FILES[name][0], FILES[name][1]) == (raw, meta),
                     'ARCHIVE_READBACK')
            need(set(os.listdir(ARCHIVE)) == set(FILES), 'ARCHIVE_READBACK')
        finally:
            os.close(fd)
        return {'contractVersion': 'cop-v13-preparation-preserved-v1',
                'archive': str(ARCHIVE), 'preservedPlanCount': 12,
                'originalFilesPreserved': True, 'oldOperationAdopted': False,
                'identityInventoryUnchanged': True, 'allHumansEnabled': True,
                'writersStartedBeforeBaseline': True, 'producersClear': True,
                'copResetMarkerAbsent': True, 'userDataChanged': False,
                'databaseWritten': False, 'productionActivated': False}
    finally:
        try:
            remote.close()
        finally:
            os.close(lock)

def provision_work_child():
    """Provision only the private COP work child, preserving the sealed parent."""
    context()
    host = load('scripts/account-safety/clean-reset-root.py')
    need(host.command(['/usr/bin/findmnt', '-n', '-o', 'UUID', '--mountpoint',
                       '/srv/x5-production']).decode().strip()
         == '2f93f595-b61b-4eea-9054-7afa9b275b5b', 'WORK_UUID')
    parent = Path('/srv/x5-production/staging/cop')
    s = parent.lstat()
    need(parent.resolve() == parent and stat.S_ISDIR(s.st_mode)
         and (s.st_uid, s.st_gid, stat.S_IMODE(s.st_mode)) == (0, 0, 0o755)
         and s.st_dev == Path('/srv/x5-production').stat().st_dev
         and s.st_dev != Path('/').stat().st_dev, 'WORK_PARENT')
    fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    path = parent / 'work'
    created = False
    try:
        need(identity(os.fstat(fd)) == identity(s) == identity(parent.lstat()), 'WORK_PARENT_CHANGED')
        if not os.path.lexists(path):
            os.mkdir('work', mode=0o700, dir_fd=fd)
            created = True
        child = os.open('work', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
        try:
            if created:
                os.fchown(child, 1000, 1000); os.fchmod(child, 0o700)
            info = os.fstat(child)
            need(identity(info) == identity(path.lstat()) and path.resolve() == path
                 and stat.S_ISDIR(info.st_mode)
                 and (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (1000, 1000, 0o700)
                 and info.st_dev == s.st_dev, 'WORK_CHILD')
            os.fsync(child)
        finally:
            os.close(child)
        os.fsync(fd)
        need(identity(os.fstat(fd)) == identity(parent.lstat())
             and identity(os.fstat(fd))[:5] == identity(s)[:5], 'WORK_PARENT_CHANGED')
        need(host.command(['/usr/bin/findmnt', '-n', '-o', 'UUID', '--mountpoint',
                           '/srv/x5-production']).decode().strip()
             == '2f93f595-b61b-4eea-9054-7afa9b275b5b', 'WORK_UUID')
    finally:
        os.close(fd)
    return {'workDirectory': str(path), 'created': created, 'parentPermissionsChanged': False}

