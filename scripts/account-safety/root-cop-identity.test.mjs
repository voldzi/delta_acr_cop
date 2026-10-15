import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { copAccountMac, copRouterAlias, driverDailyIdentity, driverContributorHash, deriveDriverCandidateInventory } from './root-cop-identity.mjs';
const key = 'synthetic-owned-key-'.repeat(3), other = 'different-owned-key-'.repeat(3), hashKey = 'synthetic-sim-hash-'.repeat(3);
test('identity derivations preserve COP wire formulas and isolate issuer, user, day and purpose', () => {
  const subject = 'owned-fixture-user-a', issuer = 'https://fixture.invalid/realm/cop';
  assert.equal(copAccountMac(key, issuer, subject), createHmac('sha256', key).update('cop-account-erasure-identity-v1\0').update(JSON.stringify([issuer, subject])).digest('hex'));
  assert.notEqual(copAccountMac(key, issuer, subject), copAccountMac(key, issuer + '/other', subject));
  assert.notEqual(copRouterAlias(key, subject), copRouterAlias(key, subject + '-b'));
  const id = driverDailyIdentity(key, subject, '2026-10-15');
  assert.equal(id, createHmac('sha256', key).update('cop-driver-contributor-v1\0' + subject + '\0' + '2026-10-15').digest('base64url'));
  assert.notEqual(id, driverDailyIdentity(key, subject, '2026-10-14'));
  assert.equal(driverContributorHash(hashKey, id), createHmac('sha256', hashKey).update('cop:' + id).digest('hex'));
  assert.notEqual(driverContributorHash(hashKey, id), createHmac('sha256', hashKey).update('cop\0' + id).digest('hex'));
});
test('historical candidates cover each accepted key issuance day without persisting raw daily identifiers', () => {
  const rows = [{ version: 'a', secret: key, firstDay: '2026-10-10', lastDay: '2026-10-12' },
    { version: 'b', secret: other, firstDay: '2026-10-12', lastDay: '2026-10-15' }];
  const candidates = deriveDriverCandidateInventory(rows, 'fixture-a', hashKey); assert.equal(candidates.size, 7);
  assert.equal(candidates.get(driverContributorHash(hashKey, driverDailyIdentity(key, 'fixture-a', '2026-10-11'))), '2026-10-11');
  assert.equal(candidates.has(driverContributorHash(hashKey, driverDailyIdentity(key, 'fixture-b', '2026-10-11'))), false);
  assert.ok([...candidates.keys()].every(v => /^[0-9a-f]{64}$/.test(v)));
});
test('unknown or excessive history is denied before an unbounded derivation loop', () => {
  const row = { version: 'a', secret: key, firstDay: '2026-10-10', lastDay: '2026-10-15' };
  for (const keys of [[], [{ ...row, firstDay: '2000-01-01' }], [row, row], [row, { ...row, version: 'b' }],
    [{ ...row, firstDay: '2026-02-30' }], [{ ...row, firstDay: '2026-10-16' }], [{ ...row, extra: true }]])
    assert.throws(() => deriveDriverCandidateInventory(keys, 'fixture', hashKey), /GUARD_DRIVER_/);
  assert.throws(() => driverDailyIdentity(key, 'fixture\0other', '2026-10-15'), /GUARD_IDENTITY_DERIVATION/);
  assert.throws(() => copRouterAlias('short', 'fixture'), /GUARD_IDENTITY_DERIVATION/);
});
