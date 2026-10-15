/** Pure necessary clock checks; not a signer, owner verifier or admission. */
export function mutationIntentDeadline(payload, claimExpiryMs, now) {
  const issued=Date.parse(payload?.issuedAt),expires=Date.parse(payload?.expiresAt);
  if(!Number.isSafeInteger(claimExpiryMs)||!Number.isSafeInteger(now)||
    !Number.isSafeInteger(issued)||!Number.isSafeInteger(expires)||
    new Date(issued).toISOString()!==payload.issuedAt||new Date(expires).toISOString()!==payload.expiresAt||
    issued>now||now>=expires||issued>=claimExpiryMs||expires>claimExpiryMs||expires<=issued||expires-issued>5000)
    throw new Error('GUARD_MUTATION_INTENT_EXPIRED');
}
