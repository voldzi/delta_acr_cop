import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createRequire } from 'node:module';
import { fork, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

assert.equal(process.env.COP_OWNED_NATIVE_FIXTURE, '1');
assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 0);
assert.ok(existsSync('/.dockerenv')); assert.equal(process.cwd(), '/tmp');
const require = createRequire(import.meta.url), native = require('/tmp/cop-root-seqpacket.node');
mkdirSync('/run/cop-account-safety/public', { recursive: true, mode: 0o755 });
const listener = native.listen();
const child = fork(new URL('root-seqpacket-child.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
assert.deepEqual((await once(child, 'message'))[0], { ready: true });
const childIdentity = native.inspectProcess(child.pid);
const request = async bytes => {
  const answer = once(child, 'message'); child.send({ hex: bytes.toString('hex') }); return (await answer)[0];
};
const descriptors = () => readdirSync('/proc/self/fd').length;
test('actual SEQPACKET peer messages match the actual client pidfs identity', async () => {
  assert.deepEqual(native.selfIdentity(), native.inspectProcess(process.pid));
  assert.throws(() => native.selfIdentity(1), /COP_ROOT_NATIVE_ARGUMENT/);
  const incoming = native.receive(listener), promise = request(Buffer.from('{"fixture":1}\n'));
  const item = await incoming;
  assert.equal(item.peer.device, childIdentity.device); assert.equal(item.peer.inode, childIdentity.inode);
  assert.equal(item.peer.uid, 0); assert.equal(item.peer.gid, 0);
  assert.equal(item.packet.toString(), '{"fixture":1}\n');
  await native.reply(item.connection, Buffer.from('{"ok":true}\n'));
  assert.deepEqual(await promise, { ok: true, hex: Buffer.from('{"ok":true}\n').toString('hex') });
  assert.throws(() => native.reply(item.connection, Buffer.from('x')), /COP_ROOT_NATIVE_ARGUMENT/);
});
test('another listener and forged JavaScript connection objects are rejected', () => {
  assert.throws(() => native.listen(), /COP_ROOT_NATIVE_UNAVAILABLE/);
  for (const value of [{}, Buffer.from('x'), null, 1]) {
    assert.throws(() => native.receive(value), /COP_ROOT_NATIVE_ARGUMENT/);
    assert.throws(() => native.close(value), /COP_ROOT_NATIVE_ARGUMENT/);
  }
  for (const value of [0, 1.5, '1', -1]) assert.throws(() => native.inspectProcess(value), /COP_ROOT_NATIVE_ARGUMENT/);
});
test('non-Root process can obtain only its own pidfs identity', async () => {
  const probe = spawn(process.execPath, ['--input-type=commonjs', '-e', `
    const n=require('/tmp/cop-root-seqpacket.node');
    const p=n.selfIdentity();
    if(!/^[0-9]+$/.test(p.device)||!/^[0-9]+$/.test(p.inode)||Object.keys(p).sort().join(',')!=='device,inode') process.exit(2);
    try{n.inspectProcess(process.pid);process.exit(3)}catch(e){if(e.code!=='COP_ROOT_NATIVE_ARGUMENT')process.exit(4)}
  `], { uid: 1000, gid: 1000, stdio: ['ignore', 'ignore', 'inherit'] });
  const [code] = await once(probe, 'exit'); assert.equal(code, 0);
});
test('empty or oversized application packets never enter the server', async () => {
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(16385)])
    assert.deepEqual(await request(bytes), { ok: false, error: 'COP_ROOT_NATIVE_ARGUMENT' });
});
test('client verifies the Root greeting before disclosing its request', async () => {
  const path = '/run/cop-account-safety/public/server-peer-v1.bin', saved = readFileSync(path), changed = Buffer.from(saved);
  changed.writeBigUInt64LE(changed.readBigUInt64LE(16) + 1n, 16); writeFileSync(path, changed);
  const incoming = native.receive(listener);
  const rejected = assert.rejects(incoming, /COP_ROOT_NATIVE_UNAVAILABLE/);
  const result = await request(Buffer.from('{"must_not_reach_server":true}\n'));
  assert.deepEqual(result, { ok: false, error: 'COP_ROOT_NATIVE_UNAVAILABLE' });
  await rejected; writeFileSync(path, saved);
});
test('unexpected SCM_RIGHTS and oversized wire packets are closed without descriptor leaks', async () => {
  const before = descriptors();
  for (const mode of ['rights', 'oversized']) {
    for (let i = 0; i < 8; i++) {
      const incoming = native.receive(listener);
      const rejected = assert.rejects(incoming, /COP_ROOT_NATIVE_UNAVAILABLE/);
      const python = spawn('python3', ['-c', `import socket,os,array
s=socket.socket(socket.AF_UNIX,socket.SOCK_SEQPACKET)
s.connect('/run/cop-account-safety/driver.sock')
s.recv(16384)
f=os.open('/dev/null',os.O_RDONLY)
s.sendmsg([b'x' if '${mode}'=='rights' else b'x'*16385],[(socket.SOL_SOCKET,socket.SCM_RIGHTS,array.array('i',[f]))] if '${mode}'=='rights' else [])
os.close(f)
s.close()
`], { stdio: ['ignore', 'ignore', 'inherit'] });
      const [code] = await once(python, 'exit'); assert.equal(code, 0); await rejected;
    }
  }
  assert.equal(descriptors(), before);
});
test('repeated valid exchanges release both per-message pidfds and connection handles', async () => {
  const before = descriptors();
  for (let i = 0; i < 32; i++) {
    const incoming = native.receive(listener), answer = request(Buffer.from('x'));
    const item = await incoming;
    assert.equal(item.peer.inode, childIdentity.inode);
    await native.reply(item.connection, Buffer.from('y'));
    assert.equal((await answer).ok, true);
  }
  assert.equal(descriptors(), before);
});
test('a retained kernel peer survives reply and reports actual process exit', async () => {
  const before = descriptors();
  const peerChild = fork(new URL('root-seqpacket-child.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  await once(peerChild, 'message');
  let retained;
  try {
    const incoming = native.receive(listener), answer = once(peerChild, 'message');
    peerChild.send({ hex: Buffer.from('lease').toString('hex') });
    const item = await incoming;
    retained = native.retainPeer(item.connection);
    assert.equal(native.peerAlive(retained), true);
    await native.reply(item.connection, Buffer.from('held'));
    assert.equal((await answer)[0].ok, true);
    assert.equal(native.peerAlive(retained), true);
    assert.throws(() => native.retainPeer(item.connection), /COP_ROOT_NATIVE_ARGUMENT/);
    assert.throws(() => native.peerAlive(item.connection), /COP_ROOT_NATIVE_ARGUMENT/);
    const exited = once(peerChild, 'exit'); peerChild.kill('SIGTERM'); await exited;
    assert.equal(native.peerAlive(retained), false);
  } finally {
    if (retained) native.close(retained);
    if (peerChild.exitCode === null && peerChild.signalCode === null) { const exited = once(peerChild, 'exit'); peerChild.kill(); await exited; }
  }
  assert.equal(descriptors(), before);
});
after(async () => {
  native.close(listener);
  const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
});
