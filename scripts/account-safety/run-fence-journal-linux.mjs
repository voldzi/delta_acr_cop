/** Sole runner for new owned containers, no host mounts, ports or image pulls. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { sha256 } from './root-records.mjs';

assert.deepEqual(process.argv.slice(2), ['--run']);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const foundation = '/Users/voldzi/Documents/Codex/2026-07-19/upgrade-proxmox-clusteru-c-lem-je-2/reports/cop-account-safety-20261014/isolated-continuity/001-guard-metadata.sql';
const foundationBytes = await readFile(foundation);
assert.equal(sha256(foundationBytes), 'a29369e48a1380bb12ce3b40b9254d924e0d98a3b90f7cdcdc0fb7e9ba27aaba');
const nodeImage = 'sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf';
const pgImage = 'sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const execute = promisify(execFile), env = Object.fromEntries(Object.entries(process.env).filter(([k]) => ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'TMPDIR'].includes(k)));
const docker = async (args, timeout = 30_000) => execute('docker', ['--host', 'unix:///Users/voldzi/.docker/run/docker.sock', ...args], { env, timeout, maxBuffer: 2 * 1024 * 1024 });
for (const id of [nodeImage, pgImage]) {
  const info = JSON.parse((await docker(['image', 'inspect', id])).stdout)[0];
  assert.equal(info.Id, id); assert.equal(info.Os, 'linux'); assert.equal(info.Architecture, 'arm64');
}
const oldMask = process.umask(0o077), tmp = await mkdtemp('/private/tmp/cop-fence-journal-');
assert.equal(dirname(await realpath(tmp)), '/private/tmp');
const suffix = randomBytes(6).toString('hex'), containers = [], pins = {}, packages = {}, startedAt = new Date().toISOString();
let success = false;
try {
  const tree = join(tmp, 'root-tree'); await mkdir(join(tree, 'node_modules'), { recursive: true });
  await writeFile(join(tree, 'package.json'), '{"private":true,"type":"module"}\n');
  for (const name of ['root-records.mjs', 'root-record-issuer.mjs', 'root-fence-journal.mjs']) {
    const path = join(repo, 'scripts/account-safety', name); pins[name] = sha256(await readFile(path)); await cp(path, join(tree, name));
  }
  const queue = [{ name: 'pg', from: join(repo, 'apps/cop-api/package.json'), optional: false }], copied = new Set();
  while (queue.length) {
    const item = queue.shift(); if (copied.has(item.name)) continue;
    let entry;
    try { entry = createRequire(item.from).resolve(item.name); } catch (error) { if (item.optional) continue; throw error; }
    let dir = dirname(await realpath(entry)), data;
    for (;;) {
      try { data = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')); } catch { data = undefined; }
      if (data?.name === item.name) break;
      assert.notEqual(dir, dirname(dir)); dir = dirname(dir);
    }
    copied.add(item.name); packages[item.name] = data.version;
    await cp(dir, join(tree, 'node_modules', item.name), { recursive: true, dereference: true });
    for (const name of Object.keys(data.dependencies ?? {})) queue.push({ name, from: join(dir, 'package.json'), optional: false });
    for (const name of Object.keys(data.optionalDependencies ?? {})) queue.push({ name, from: join(dir, 'package.json'), optional: true });
  }
  const harness = join(repo, 'scripts/account-safety/test-fence-journal-linux.mjs'); pins.harness = sha256(await readFile(harness));
  await cp(harness, join(tmp, 'harness.mjs')); await writeFile(join(tmp, 'foundation.sql'), foundationBytes);
  const create = async (name, args) => {
    const id = (await docker(['create', '--name', name, '--label', 'com.cop.fixture=fence-journal-20261015', ...args])).stdout.trim();
    assert.match(id, /^[0-9a-f]{64}$/); containers.push(id); return id;
  };
  const base = await create('cop-fence-node-' + suffix, ['--network', 'none', '--entrypoint', '/usr/local/bin/node', nodeImage, '--version']);
  const target = await create('cop-fence-pg-' + suffix, ['--network', 'none', '--memory', '512m', '--cpus', '1', '--pids-limit', '128',
    '--tmpfs', '/fixture/state:rw,nosuid,nodev,size=268435456,mode=0755', '--entrypoint', '/bin/sh', pgImage, '-c', 'exec sleep 900']);
  for (const [source, name] of [['/usr/local/bin/node', 'node'], ['/usr/lib/libstdc++.so.6', 'libstdc++.so.6'], ['/usr/lib/libgcc_s.so.1', 'libgcc_s.so.1']]) {
    await docker(['cp', '-L', base + ':' + source, join(tmp, name)]);
    await docker(['cp', join(tmp, name), target + ':' + (name === 'node' ? '/usr/local/bin/node' : '/usr/lib/' + name)]);
  }
  await docker(['start', target]); await docker(['exec', target, 'mkdir', '-p', '/opt/cop-account-safety', '/fixture']);
  await docker(['cp', tree + '/.', target + ':/opt/cop-account-safety']);
  for (const name of ['harness.mjs', 'foundation.sql']) await docker(['cp', join(tmp, name), target + ':/fixture/' + name]);
  const info = JSON.parse((await docker(['inspect', target])).stdout)[0];
  assert.equal(info.HostConfig.NetworkMode, 'none'); assert.equal(info.HostConfig.Privileged, false);
  assert.equal((info.Mounts ?? []).filter(m => m.Type === 'bind').length, 0);
  assert.equal(Object.keys(info.HostConfig.PortBindings ?? {}).length, 0);
  const output = await docker(['exec', '-e', 'COP_OWNED_FENCE_FIXTURE=1', target, '/usr/local/bin/node', '/fixture/harness.mjs'], 120_000);
  const result = JSON.parse(output.stdout.trim().split('\n').at(-1));
  assert.equal(result.checks.length, 8); assert.ok(result.checks.every(c => c.passed === true));
  for (const [name, pin] of Object.entries(pins)) assert.equal(sha256(await readFile(name === 'harness' ? harness : join(repo, 'scripts/account-safety', name))), pin);
  const receipt = { contractVersion: 'cop-fence-journal-linux-receipt-v1', startedAt, completedAt: new Date().toISOString(),
    sourcePins: pins, foundationSha256: sha256(foundationBytes), packages, result, images: { nodeImage, pgImage },
    isolation: { externalNetwork: false, hostMounts: false, publicPorts: false, imagePull: false, imageBuild: false },
    productionChanged: false, productionRootEnrollment: false, nativeChannelVerified: false, realAccountDeleted: false };
  const path = join(repo, 'docs/testing/account-safety-fence-journal-minimized-20261015.json');
  await writeFile(path, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ receipt: path, checks: 8, productionChanged: false })); success = true;
} finally {
  for (const id of containers.reverse()) await docker(['rm', '-f', '-v', id]).catch(() => {});
  process.umask(oldMask); if (success) await rm(tmp, { recursive: true }); else process.stderr.write('Owned fixture retained: ' + tmp + '\n');
}
