import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { canonical, canonicalJson, sha256 } from './root-records.mjs';
import { issueRootRecord } from './root-record-issuer.mjs';
import { createProductionAccountErasureContinuity } from './cop-root-continuity.mjs';

assert.equal(process.env.COP_OWNED_NATIVE_FIXTURE, '1'); assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 0);
assert.ok(existsSync('/.dockerenv')); assert.equal(process.cwd(), '/tmp');
const require = createRequire(import.meta.url), native = require('/opt/cop-account-safety/native/root-seqpacket.node');
const etc = '/etc/cop-account-safety/public', state = '/var/lib/cop-account-safety';
mkdirSync(etc, { recursive: true, mode: 0o755 }); mkdirSync(state + '/authority', { recursive: true, mode: 0o700 });
mkdirSync('/run/cop-account-safety/public', { recursive: true, mode: 0o755 });
assert.equal(existsSync(etc + '/verification-keys.json'), false);
const pair = generateKeyPairSync('ed25519'), keys = { contractVersion: 'cop-root-verification-keys-v1',
  keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'owned-continuity-channel-fixture' }] };
writeFileSync(etc + '/verification-keys.json', canonical(keys) + '\n', { mode: 0o644, flag: 'wx' });
writeFileSync(state + '/authority/signing-key.pkcs8', pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
const listener = native.listen(), applicationStoreId = randomUUID(), guardStoreId = randomUUID(), continuityEpoch = randomUUID();
const configurationFingerprint = 'a'.repeat(64), frontier = { sequence: 2, digest: 'b'.repeat(64) };
const entry = accountKey => ({ contractVersion: 'cop-erasure-fence-entry-v1', applicationStoreId, configurationFingerprint, accountKey,
  job: { operationId: randomUUID(), requestedAt: new Date().toISOString(), checkpoints: {}, required: ['keycloak', 'cop_sessions_profiles',
    'cop_devices', 'messaging_matrix', 'voice_livekit', 'cop_content_media', 'mobility_dispatch', 'sim_measurements', 'ai_router', 'moderation_audit', 'backup_restore'] } });
const entries = [entry('1'.repeat(64)), entry('2'.repeat(64))];
async function serve(result, mutate = bytes => bytes) {
  const item = await native.receive(listener), request = canonicalJson(item.packet);
  const record = issueRootRecord('cop-continuity-reply', { requestId: request.requestId, action: request.action,
    inputDigest: sha256(canonical(request.input)), applicationStoreId, configurationFingerprint, guardStoreId, continuityEpoch,
    result: result(request) }, { lifetimeMs: 5000 });
  await native.reply(item.connection, mutate(record.bytes)); return request;
}
test('actual native and signed paginated snapshot carries only bounded pseudonymous metadata', async () => {
  const port = createProductionAccountErasureContinuity();
  const server = (async () => {
    for (let i = 0; i < 3; i++) await serve(request => {
      assert.equal(request.input.cursor, i);
      return { applicationStoreId, configurationFingerprint, frontier, entry: entries[i] ?? null, nextCursor: i < 2 ? i + 1 : null };
    });
  })();
  const replay = await port.snapshot(); await server;
  assert.deepEqual(replay.entries, entries); assert.deepEqual(replay.frontier, frontier);
  assert.equal(JSON.stringify(replay).includes('sealedPrincipal'), false);
});
test('publish and current assertion consume actual signatures and preserve original metadata', async () => {
  const port = createProductionAccountErasureContinuity();
  let server = serve(() => ({ frontier, entry: entries[0] }));
  assert.deepEqual(await port.publishFence(entries[0]), { frontier, entry: entries[0] }); await server;
  server = serve(() => ({ frontier }));
  const observation = await port.assertCurrent(frontier); await server;
  assert.ok(Date.parse(observation.validUntil) > Date.now());
});
test('tampered signature and mismatched Root request cannot acknowledge a fence', async () => {
  const port = createProductionAccountErasureContinuity();
  for (const mutate of [bytes => { const r = JSON.parse(bytes); r.payload.result.frontier.sequence++; return Buffer.from(canonical(r) + '\n'); },
    bytes => { const r = JSON.parse(bytes); r.payload.requestId = randomUUID(); return Buffer.from(canonical(r) + '\n'); }]) {
    const server = serve(() => ({ frontier }), mutate);
    await assert.rejects(port.assertCurrent(frontier)); await server;
  }
});
test('frontier change between actual pages aborts the complete snapshot', async () => {
  const port = createProductionAccountErasureContinuity();
  const server = (async () => {
    await serve(() => ({ applicationStoreId, configurationFingerprint, frontier, entry: entries[0], nextCursor: 1 }));
    await serve(() => ({ applicationStoreId, configurationFingerprint, frontier: { ...frontier, sequence: 3 }, entry: null, nextCursor: null }));
  })();
  await assert.rejects(port.snapshot(), /GUARD_CONTINUITY_PAGE/); await server;
});
after(() => { native.close(listener); unlinkSync(etc + '/verification-keys.json'); unlinkSync(state + '/authority/signing-key.pkcs8'); });
