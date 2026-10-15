/** NEW source-only Root common integration harness. Main alone executes it.
 * No external target, image pull/build, host bind, public port, secret import
 * or production enrollment. Previous runners/receipts are immutable inputs.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile as readLocalFile, realpath, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
assert.equal(process.argv.length, 5);
assert.equal(process.argv[2], '--run');
assert.equal(process.argv[3], '--sim-source');
const cop = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), repo = resolve(process.argv[4]);
const frozenSIMCommit='6c6d9f22470891227a1a00fb83012c60cfce429c';
// Read the exact accepted SIM deploy source from immutable Git objects so its
// owner can continue a separate policy change without mutating these inputs.
// Only .mjs/.sql below deploy are eligible; no env, key or app data is read.
async function readFile(path,encoding){
  if(typeof path==='string'&&path.startsWith(join(repo,'deploy')+'/')){
    const rel=relative(repo,path);assert.match(rel,/^deploy\/[a-z0-9-]+\/[a-z0-9_-]+\.(?:mjs|sql)$/);
    const result=await promisify(execFile)('/usr/bin/git',['-C',repo,'show',frozenSIMCommit+':'+rel],
      {env:{PATH:'/usr/bin:/bin',LANG:'C'},encoding:'buffer',maxBuffer:3*1024*1024});
    return encoding?result.stdout.toString(encoding):result.stdout;
  }return readLocalFile(path,encoding);
}
const receiptPath = join(cop, 'docs/testing/account-safety-root-driver-mutation-intent-deadline-20261015.json');
assert.ok(!existsSync(receiptPath), 'Never overwrite previous evidence.');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const selfPath = fileURLToPath(import.meta.url), selfPin = hash(await readFile(selfPath));
const fixturePath = join(cop, 'scripts/account-safety/fixtures/root-driver-mutation-intent/harness.mjs');
const sourcePins = {}, packages = {};
const nodeImage = 'sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf';
const postgresImage = 'sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const metadataSource = '/Users/voldzi/Documents/Codex/2026-07-19/upgrade-proxmox-clusteru-c-lem-je-2/reports/cop-account-safety-20261014/isolated-continuity/001-guard-metadata.sql';
const metadataPin = 'a29369e48a1380bb12ce3b40b9254d924e0d98a3b90f7cdcdc0fb7e9ba27aaba';
assert.equal(hash(await readFile(metadataSource)), metadataPin);
const readerMetadataSource = join(cop, 'scripts/account-safety/002-root-reader.sql');
const readerMetadataPin = '9a08e4174f25a64cf9c1897d5df1c9b772d7ab072c5bb8cffc5a8f0e7939476a';
assert.equal(hash(await readFile(readerMetadataSource)), readerMetadataPin);
const frozen = 'scripts/fixtures/driver-read-keyring/harness.mjs';
const frozenPin = '8992fdd14310ed9fece233ba0a3a8eea7272c4740550f9a863bede8a1a5c0c85';
assert.equal(hash(await readFile(join(repo, frozen))), frozenPin);
const helperPin = 'ad203b1a1858bea7f8f799a6147720d1d0d6df790bfc1d4c866a12c45d6bb7fd';
assert.equal(hash(await readFile(join(cop, 'scripts/account-safety/root-records.mjs'))), helperPin);
const nativeSource = '/private/tmp/cop-root-seqpacket-arm64-20261015.node';
const nativePin = '283f528f6ffce67c46e180a8a7ddcf215c1588dd579cbf36ca507b8896802d20';
assert.equal(hash(await readFile(nativeSource)), nativePin);
// Only actual fixed Root source files enter this closure. No .env, credentials,
// arbitrary native addon, entire checkout or application node_modules tree is
// copied. The one separately pinned actual addon provides kernel SELF identity.
const candidates = new Map();
for (const entry of await readdir(join(cop, 'scripts/account-safety'), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.mjs') || entry.name.endsWith('.test.mjs') || /^(?:test-|run-)/.test(entry.name))
        continue;
    candidates.set(entry.name, join(cop, 'scripts/account-safety', entry.name));
}
for (const entry of await readdir(join(repo, 'deploy/account-safety'), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.mjs') && !entry.name.endsWith('.test.mjs'))
        candidates.set(entry.name, join(repo, 'deploy/account-safety', entry.name));
}
for (const [directory, names] of Object.entries({
    'driver-measurements': ['read-admission-facts.mjs', 'root-read-admission.mjs'],
    'ai-router': ['checkpoint-facts.mjs', 'root-checkpoint-read.mjs'],
}))
    for (const name of names)
        candidates.set(name, join(repo, 'deploy', directory, name));
for (const [name, pin] of Object.entries({
    'driver-account-erasure.js': 'd184e31dda5484d4d8d2382208834197247ff47a1a37437f4f0550fdd95ea999',
    'driver-revocation-actor.js': '43116e10d8616f1320593b32a76dfdb7c15f6718f8b17e1f3b84bfc40efbe7fa',
})) {
    const path = join(repo, 'apps/situation-data-api/dist', name);
    assert.equal(hash(await readFile(path)), pin);
    candidates.set(name, path);
}
// Traverse the actual fixed import closure only. Unused COP producer/watch
// files are not copied merely because they happen to share this directory.
const inputs = new Map(), pending = ['root-driver-mutation-intent.mjs', 'root-owner-authority.mjs', 'root-owner-read.mjs', 'driver-root-channel.mjs', 'driver-root-publication.mjs'];
while (pending.length) {
    const name = pending.pop();
    if (inputs.has(name))
        continue;
    assert.match(name, /^[a-z][a-z0-9-]*\.(?:mjs|js)$/);
    const path = candidates.get(name);
    assert.ok(path, 'Fixed dependency missing: ' + name);
    inputs.set(name, path);
    const text = await readFile(path, 'utf8');
    for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"]\.\/([^'"]+)['"]|['"]\/opt\/cop-account-safety\/([a-z][a-z0-9-]*\.(?:mjs|js))['"]/g))
        pending.push(match[1] ?? match[2]);
}
for (const name of ['root-owner-authority.mjs', 'root-owner-authority-protocol.mjs', 'root-owner-read.mjs', 'root-jws.mjs', 'root-record-issuer.mjs'])
    assert.ok(inputs.has(name));
for (const [name, pin] of Object.entries({
    'root-cop-actor.mjs':'9a2773dd34adf00c76b5f7d734389ec88119b20d885c870c66fd1247752f75f9',
    'root-driver-mutation-intent.mjs':'f474bb845bc833c82d954b387f12c917b35f8537e201e58e59f22bafaa5ecdf2',
    'root-driver-retention-producer.mjs':'a9d4744f1c12473ad261dfbb576416cbf3fca33e32d263ff1a5a4019b32666bc',
    'root-driver-retention-delivery.mjs':'473b6005b5940d10fe3b62e10950e0d93573208766d6fb4d15ce20ed43c3d05d',
    'root-driver-runtime.mjs':'843a1755c4b8f821faf320e167e8bb44ff5a1b37244b6dbe524b693f367b400a',
    'driver-root-channel.mjs':'94bc7b4b03caaacb9e9778dca1dfefd1f198735106ddb02adf18f1a21f37767e',
    'driver-origin-producer.mjs':'d5d4ded08966d9f41941f110dffdb743cb340397bc58e2e2290cddf845df04ee',
    'root-owner-authority.mjs': 'b592e1e26768d70c8fca1d699caba6007e5b40a071fe8326beccf51df8a0b7ca',
    'root-owner-authority-protocol.mjs': '0fab874389fdc5660241f7b26ead63a7b9003b06915a78dcbec4b744614632a3',
}))
    assert.equal(hash(await readFile(inputs.get(name))), pin);
const sql = new Map([['metadata/001-guard-metadata.sql', metadataSource], ['metadata/002-root-reader.sql', readerMetadataSource],['cop/003-cop-consent-reader.sql',join(cop,'scripts/account-safety/003-cop-consent-reader.sql')]]);
assert.equal(hash(await readFile(sql.get('cop/003-cop-consent-reader.sql'))),'36dd2a4219416fcc76255e5ce063107f36cf1d30ee6d1024b2c603aa43a2a5b3');
for (const [directory, names] of Object.entries({
    driver: ['schema.sql', '002_account_erasure.sql', '003_guarded_operations.sql', '004_read_admission_facts.sql', '005_root_checkpoint.sql', '006_inventory_candidates.sql'],
    ai: ['001_schema.sql', '002_separate_billing.sql', '003_account_erasure.sql', '004_root_checkpoint_facts.sql', '005_root_checkpoint.sql'],
}))
    for (const name of names)
        sql.set(directory + '/' + name, join(repo, 'deploy', directory === 'driver' ? 'driver-measurements' : 'ai-router', name));
for (const path of new Set([...inputs.values(), ...sql.values(), nativeSource, fixturePath, join(cop, 'scripts/account-safety/fixtures/root-driver-mutation-intent/actor-client.mjs'), join(repo, frozen)]))
    sourcePins[path] = hash(await readFile(path));
const execute = promisify(execFile);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'TMPDIR'].includes(key)));
const docker = async (args, timeout = 30_000) => execute('docker', ['--host', 'unix:///Users/voldzi/.docker/run/docker.sock', ...args], { env, timeout, maxBuffer: 3 * 1024 * 1024 });
for (const id of [nodeImage, postgresImage]) {
    const info = JSON.parse((await docker(['image', 'inspect', id])).stdout)[0];
    assert.equal(info.Id, id);
    assert.equal(info.Os, 'linux');
    assert.equal(info.Architecture, 'arm64');
}
const previousUmask = process.umask(0o077), tmp = await mkdtemp('/private/tmp/cop-root-driver-mutation-intent-');
assert.equal(dirname(await realpath(tmp)), '/private/tmp');
const suffix = randomBytes(6).toString('hex'), containers = [], startedAt = new Date().toISOString();
let success = false, cleanupComplete = true, receipt;
try {
    const tree = join(tmp, 'root-tree');
    await mkdir(join(tree, 'node_modules'), { recursive: true, mode: 0o700 });
    await writeFile(join(tree, 'package.json'), '{"private":true,"type":"module"}\n', { mode: 0o600 });
    for (const [name, path] of inputs)
        await writeFile(join(tree,name),await readFile(path),{mode:0o600});
    await mkdir(join(tree, 'native'), { mode: 0o700 });
    await cp(nativeSource, join(tree, 'native/root-seqpacket.node'));
    // Same nearest-package/dereferenced dependency mechanics as the reviewed new
    // layout runner. pg is real and unpatched; no registry/provider callback.
    const queue = [{ name: 'pg', from: join(repo, 'apps/situation-data-api/package.json'), optional: false, parent: tree }];
    while (queue.length) {
        const item = queue.shift();
        let directory, data;
        for (const parent of createRequire(item.from).resolve.paths(item.name) ?? []) {
            const candidate = join(parent, item.name, 'package.json');
            if (!existsSync(candidate))
                continue;
            directory = await realpath(dirname(candidate));
            data = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
            assert.equal(data.name, item.name);
            break;
        }
        if (!directory) {
            if (item.optional)
                continue;
            throw new Error('Installed dependency metadata is missing.');
        }
        let foundVersion;
        for (let parent = item.parent;; parent = dirname(parent)) {
            const candidate = join(parent, 'node_modules', item.name, 'package.json');
            if (existsSync(candidate)) {
                foundVersion = JSON.parse(await readFile(candidate, 'utf8')).version;
                break;
            }
            if (parent === tree)
                break;
            assert.ok(parent.startsWith(tree + '/'));
        }
        if (foundVersion === data.version)
            continue;
        const target = join(item.parent, 'node_modules', item.name);
        assert.ok(!existsSync(target));
        packages[relative(tree, target)] = data.version;
        await cp(directory, target, { recursive: true, dereference: true,
            filter: path => !path.split('/').slice(directory.split('/').length).some(part => part === 'node_modules' || part === '.git' || part.startsWith('.env')) });
        for (const name of Object.keys(data.dependencies ?? {}))
            queue.push({ name, from: join(directory, 'package.json'), optional: false, parent: target });
        for (const name of Object.keys(data.optionalDependencies ?? {}))
            queue.push({ name, from: join(directory, 'package.json'), optional: true, parent: target });
    }
    const fixture = join(tmp, 'fixture');
    await mkdir(join(fixture, 'sql'), { recursive: true, mode: 0o700 });
    for (const [name, path] of sql) {
        await mkdir(dirname(join(fixture, 'sql', name)), { recursive: true, mode: 0o700 });
        await writeFile(join(fixture,'sql',name),await readFile(path),{mode:0o600});
    }
    await cp(fixturePath, join(fixture, 'harness.mjs'));
    await cp(join(cop, 'scripts/account-safety/fixtures/root-driver-mutation-intent/actor-client.mjs'), join(fixture, 'actor-client.mjs'));
    // Reuse ONLY the frozen actual X.509 DER implementation, never its bootstrap,
    // minimal synthetic registry DDL, old run(), cases or receipt interpretation.
    const frozenSource = await readFile(join(repo, frozen), 'utf8');
    const start = frozenSource.indexOf('const der = (tag, ...parts) => {'), end = frozenSource.indexOf('async function privateFile(', start);
    assert.ok(start > 0 && end > start);
    assert.equal(frozenSource.indexOf('const der = (tag, ...parts) => {', start + 1), -1);
    const certificateSource = "import assert from 'node:assert/strict';\nimport {generateKeyPairSync,randomBytes,sign,X509Certificate} from 'node:crypto';\n" + frozenSource.slice(start, end) + '\nexport {certificates};\n';
    await writeFile(join(fixture, 'certificates.mjs'), certificateSource, { mode: 0o600 });
    const manifest = Object.fromEntries([...inputs].map(([name, path]) => ['/opt/cop-account-safety/' + name, sourcePins[path]]));
    manifest['/opt/cop-account-safety/native/root-seqpacket.node'] = nativePin;
    for (const [name, path] of sql)
        manifest['/fixture/sql/' + name] = sourcePins[path];
    manifest['/fixture/actor-client.mjs'] = sourcePins[join(cop, 'scripts/account-safety/fixtures/root-driver-mutation-intent/actor-client.mjs')];
    manifest['/fixture/harness.mjs'] = sourcePins[fixturePath];
    manifest['/fixture/certificates.mjs'] = hash(certificateSource);
    await writeFile(join(fixture, 'source-pins.json'), JSON.stringify(manifest) + '\n', { mode: 0o600 });
    const create = async (name, args) => {
        const id = (await docker(['create', '--pull', 'never', '--name', name, '--label', 'csm.sim.test=root-driver-mutation-intent-20261015', ...args])).stdout.trim();
        assert.match(id, /^[0-9a-f]{64}$/);
        containers.push(id);
        return id;
    };
    const node = await create('cop-actor-node-source-' + suffix, ['--network', 'none', '--entrypoint', '/usr/local/bin/node', nodeImage, '--version']);
    const target = await create('cop-actor-' + suffix, ['--network', 'none', '--memory', '896m', '--cpus', '2', '--pids-limit', '256',
        '--tmpfs', '/var/lib/postgresql:rw,nosuid,nodev,size=536870912', '--tmpfs', '/tmp:rw,nosuid,nodev,size=67108864',
        '--tmpfs', '/run/cop-account-safety/private:rw,nosuid,nodev,mode=0700,size=33554432',
        '--entrypoint', '/bin/sh', postgresImage, '-c', 'exec sleep 1200']);
    for (const [source, name, destination] of [
        ['/usr/local/bin/node', 'node', '/usr/local/bin/node'], ['/usr/lib/libstdc++.so.6', 'libstdc++.so.6', '/usr/lib/libstdc++.so.6'],
        ['/usr/lib/libgcc_s.so.1', 'libgcc_s.so.1', '/usr/lib/libgcc_s.so.1'],
    ]) {
        await docker(['cp', '-L', node + ':' + source, join(tmp, name)]);
        await docker(['cp', join(tmp, name), target + ':' + destination]);
    }
    await docker(['start', target]);
    await docker(['exec', target, 'mkdir', '-p', '/opt/cop-account-safety', '/fixture']);
    await docker(['cp', tree + '/.', target + ':/opt/cop-account-safety']);
    await docker(['cp', fixture + '/.', target + ':/fixture']);
    await docker(['exec', target, 'chown', '-R', '0:0', '/opt/cop-account-safety', '/fixture']);
    await docker(['exec', target, 'chmod', '-R', 'go-w', '/opt/cop-account-safety', '/fixture']);
    const inspection = JSON.parse((await docker(['inspect', target])).stdout)[0];
    assert.equal(inspection.HostConfig.NetworkMode, 'none');
    assert.equal(inspection.HostConfig.Privileged, false);
    assert.equal((inspection.Mounts ?? []).filter((m) => m.Type === 'bind' || m.Type === 'volume').length, 0);
    assert.equal(Object.keys(inspection.HostConfig.PortBindings ?? {}).length, 0);
    const result = JSON.parse((await docker(['exec', target, '/usr/local/bin/node', '/fixture/harness.mjs', '--run'], 300_000)).stdout.trim().split('\n').at(-1));
    assert.equal(result.contractVersion, 'cop-root-mutation-intent-isolated-linux-v1');
    assert.equal(result.passed, 14);
    assert.equal(result.cases.length, 14);
    assert.ok(result.cases.every((item) => item.passed === true));
    assert.equal(result.hostObservationSynthetic, true);
    assert.equal(result.actualHostObserverExecuted, false);
    assert.equal(result.providerCalls, 0);
    assert.equal(result.actualPidfdSelf, true);
    assert.equal(result.actualKernelReceiverPeer, false);
    assert.equal(result.actualNativeTransport, false);
    assert.equal(result.actualRootActorHelpers,true);assert.equal(result.actualHeldAdvisoryBarrier,true);assert.equal(result.actualTwoSyntheticUsers,true);assert.equal(result.actualCopReadSurface,true);
    assert.equal(result.productionEnrollment, false);
    for (const [path, pin] of Object.entries(sourcePins))
        assert.equal(hash(await readFile(path)), pin, 'Selected source bytes changed during fixture.');
    assert.equal(hash(await readFile(selfPath)), selfPin);
    receipt = { status: 'SOURCE_ROOT_MUTATION_INTENT_LINUX_ONLY', startedAt, completedAt: new Date().toISOString(), result,
        executingRunnerSha256: selfPin, sourceSelection:{simDeployGitCommit:frozenSIMCommit,currentSIMDeployWorktreeUsed:false}, sourcePins, stagedSourcePins: manifest, certificateDerivation: { frozenSource: frozen, frozenSha256: frozenPin, generatedSha256: hash(certificateSource) },
        nativeSelfArtifact: { path: nativeSource, sha256: nativePin, abi: 'Node24.20.0-linux-arm64-musl', kernelSelfOnly: true, packetTransportTested: false },
        images: { node: nodeImage, postgres: postgresImage }, packageVersions: packages,
        isolation: { externalNetwork: false, hostBindMounts: false, volumes: false, publicPorts: false, privateTmpfs: true, imagePull: false, imageBuild: false, sourceContainersStarted: false },
        actual: { productionChanged: false, acceptedOwnerEvidence: false, nativeTransport: false, nativeHostDeployment: false, restoreAccepted: false,
            realAccounts: false, externalProviderCalls: false, hostObservationSynthetic: true, actualHostObserverExecuted: false,
            actualPidfdProcObserver: true, actualPidfdSelf: true, actualBrokerStartTicks: true, actualBrokerExecutableDigest: true,
            singleRootProcess: false, appPeerSynthetic: false, nativePeerTransport: false } };
    success = true;
}
finally {
    for (const id of containers.reverse())
        await docker(['rm', '-f', '-v', id]).catch(() => { cleanupComplete = false; });
    process.umask(previousUmask);
    if (success && cleanupComplete) {
        assert.equal((await stat(tmp)).uid, process.getuid());
        await rm(tmp, { recursive: true });
    }
    else
        console.error('Private Root COP actor fixture retained: ' + tmp);
}
assert.ok(success && cleanupComplete, 'Owned containers/context must be removed before PASS evidence.');
receipt.cleanup = { ownedContainersRemoved: true, ownedVolumesRemoved: true, privateContextRemoved: true, globalPrune: false };
await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ receiptPath, passed: receipt.result.passed, productionChanged: false }));
