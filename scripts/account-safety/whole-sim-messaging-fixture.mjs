/** Read-only adapter for the genuine, separately owned SIM/Messaging fixtures.
 * Each endpoint calls its owner's actual database/provider readback. No provider
 * adapter, seed or account-delete response is replaced by this test module. */
import assert from 'node:assert/strict';
const owners = ['sim_measurements', 'ai_router', 'messaging_matrix'];
const ports = [4321, 4322, 4323];
async function readOwner(context, index) {
  const binding = context.manifest.integration.providerReadbacks?.[owners[index]];
  assert.equal(binding?.url, 'http://127.0.0.1:' + ports[index] + '/readback', 'WHOLE_ACTUAL_READBACK_BINDING_MISSING');
  assert.equal(typeof binding.token, 'string');
  assert.ok(binding.token.length >= 32);
  const response = await context.nativeFetch(binding.url, { method: 'GET', redirect: 'error',
    headers: { authorization: 'Bearer ' + binding.token }, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, 'WHOLE_ACTUAL_READBACK_UNAVAILABLE_' + owners[index]);
  const value = await response.json();
  assert.equal(value.contractVersion, 'cop-whole-erasure-readback-v1');
  assert.deepEqual(Object.keys(value.owners ?? {}), [owners[index]]);
  const actual = value.owners[owners[index]];
  assert.ok(Number.isSafeInteger(actual.removableA) && actual.removableA >= 0);
  assert.ok(Number.isSafeInteger(actual.removableB) && actual.removableB >= 0);
  assert.match(actual.preservedBFingerprint, /^[a-f0-9]{64}$/u);
  if (index === 1) assert.equal(value.simPreserved?.syntheticKeyIntact, true, 'WHOLE_SIM_PAYER_DAMAGED');
  return value.owners;
}
export async function readWholeErasureFixture(context) {
  return { owners: Object.assign({}, ...(await Promise.all(owners.map((_owner, index) => readOwner(context, index))))) };
}
export async function seedWholeErasureFixture(context) {
  // Owner-specific bootstraps already created actual A/B data using the same
  // verified Keycloak subjects. Verify those nonempty seeds; do not reseed them.
  const value = await readWholeErasureFixture(context);
  for (const owner of owners) {
    assert.ok(value.owners[owner].removableA > 0, 'WHOLE_OWNER_A_ACTUAL_SEED_MISSING_' + owner);
    assert.ok(value.owners[owner].removableB > 0, 'WHOLE_OWNER_B_ACTUAL_SEED_MISSING_' + owner);
  }
  return { verifiedOwnerNames: owners };
}
