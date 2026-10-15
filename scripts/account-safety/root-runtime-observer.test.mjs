import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { fork, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { ROOT_PROCESS_OBSERVER, runtimeConfigurationDigest } from './root-runtime-observer.mjs';
assert.equal(process.env.COP_OWNED_NATIVE_FIXTURE, '1'); assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 0);
assert.ok(existsSync('/.dockerenv')); assert.equal(process.cwd(), '/tmp');
const execute = promisify(execFile), path = '/tmp/owned-root-observer-entry.mjs';
assert.equal(existsSync(path), false);
writeFileSync(path, 'process.send({ready:true});setInterval(()=>{},1000);\n', { mode: 0o600, flag: 'wx' });
const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([k]) => !['NODE_OPTIONS', 'NODE_PATH'].includes(k)));
const observe = pid => execute('/usr/bin/python3', ['-I', '-S', '-c', ROOT_PROCESS_OBSERVER, String(pid), path], { timeout: 3000, maxBuffer: 16384 });
async function fixture(execArgv, args = [], env = cleanEnvironment, work) {
  const child = fork(path, args, { execArgv, env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  try { await once(child, 'message'); return await work(child); }
  finally { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; }
}
test('actual /proc observer binds the one executed script and real pidfs/executable facts', async () => {
  await fixture(['--no-warnings'], [], cleanEnvironment, async child => {
    const result = JSON.parse((await observe(child.pid)).stdout);
    assert.deepEqual(Object.keys(result).sort(), ['executableDigest', 'peer', 'startTicks']);
    assert.match(result.executableDigest, /^[0-9a-f]{64}$/); assert.match(result.peer.inode, /^[1-9][0-9]*$/);
    assert.ok(BigInt(result.startTicks) > 0n);
  });
});
test('eval advertising the expected script as an argument is not that executed script', async () => {
  await fixture(['--eval', 'process.send({ready:true});setInterval(()=>{},1000)'], [path], cleanEnvironment,
    async child => { await assert.rejects(observe(child.pid)); });
});
test('extra script arguments or an unreviewed NODE_OPTIONS preload remain unknown', async () => {
  await fixture([], ['unexpected'], cleanEnvironment, async child => { await assert.rejects(observe(child.pid)); });
  await fixture([], [], { ...cleanEnvironment, NODE_OPTIONS: '--no-warnings' }, async child => { await assert.rejects(observe(child.pid)); });
});
test('runtime digest binds actual mounts, source, flags and secret configuration without returning secrets', () => {
  const facts = { State: { Running: true, Pid: 1 }, Config: { Env: ['SECRET=owned-fixture'], Labels: { source: 'fixture' }, Cmd: ['node', 'entry.js'] },
    HostConfig: { ReadonlyRootfs: true, NetworkMode: 'fixture', PidMode: '' }, Image: 'sha256:' + 'a'.repeat(64), Mounts: [] };
  const digest = runtimeConfigurationDigest(facts); assert.match(digest, /^[0-9a-f]{64}$/);
  assert.notEqual(digest, runtimeConfigurationDigest({ ...facts, Config: { ...facts.Config, Env: ['SECRET=other-fixture'] } }));
  assert.notEqual(digest, runtimeConfigurationDigest({ ...facts, Mounts: [{ Type: 'bind', Source: '/tmp/fixture', Destination: '/app', RW: true }] }));
});
after(() => unlinkSync(path));
