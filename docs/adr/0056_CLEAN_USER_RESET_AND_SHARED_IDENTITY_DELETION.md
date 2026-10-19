# ADR 0056 — Clean test-user reset and shared identity deletion

Status: accepted for implementation by the application owner on 2026-10-17; production self-deletion verified for two synthetic accounts on 2026-10-19 (see the lifecycle release evidence).

Supersedes ADR0053 only for the explicitly configured v2 scope. Existing v1 operations retain their original meaning.

The owner approved deletion of all COP/SIM test-user data without creating a new backup of that data. This is not authority to reset other applications, official provider/map/routing data, service identities, secrets or shared infrastructure. Existing infrastructure backups are not changed by this release.

The web is the account deletion entry point. Scope `cop_sim_shared_identity_v1` uses `cop-account-erasure-v2` and `cop-account-erasure-preflight-v2`. The service stores and checks its exact scope; an existing accepted v1 store cannot be reinterpreted as v2. A clean baseline must be enrolled after verified reset.

The user authenticates freshly, reviews the account, and confirms. A durable fence and encrypted worker principal are committed before HTTP202. HTTP202 means pending, never completion. The server worker resumes without another login and retries after downstream outages. Ordinary requests and stale JWTs are fenced. Keycloak shared identity deletion happens last, after all required COP/SIM cleanup proofs. It removes SIM access as approved by the owner. Data of other applications is outside this cleanup.

The Keycloak adapter additionally requires `COP_KEYCLOAK_SHARED_IDENTITY_DELETE_ACCEPTED=true`. The previous COP-only authority flag does not authorize this operation. GET binds the exact verified issuer/subject and identity creation timestamp; service identities are rejected. DELETE is complete only after GET404. A lost DELETE reply is recovered from the original durable checkpoint. Another user's identity is unaffected.

Test data reset and provider cleanup are irreversible. Code rollback must retain the new fence/epoch and must not restore test-user data. Do not automatically recreate an unknown or missing reset epoch after restoring an old database.

Verification and production progress are recorded in `docs/account-safety/clean-lifecycle-release.md`.


## Recovery after the shared login was removed

The new scope publishes only `cop-erasure-fence-entry-v2` to the independent journal. It adds an encrypted minimal worker principal (issuer, subject, original signed iat), bound to the same account MAC and immutable operation. No OAuth token, API key, name, email or message is retained there. V1 entries still forbid this field. This necessary technical binding allows a restored application DB to replay cleanup without a login which no longer exists. The entry remains until every referring backup has expired under the already approved technical erasure-ledger retention. Restore quarantine and independent journal preservation remain required; a copied reset epoch alone is not proof of safe restoration.

The v2 independent fence also retains the original server-verified Keycloak preflight fingerprint. It binds cleanup to the identity authorized at confirmation, rejects an identity recreated with another creation timestamp, and allows verified provider absence after restoring a local database that lost its checkpoint. A first404 without that accepted witness remains pending. The fingerprint is technical pseudonymous recovery evidence, not user content.

## SIM application-data boundary

The production v2 scope requires twelve independent domains, including `sim_user_data`.
The original v1 list of eleven domains is unchanged. SIM application data is not
covered by the COP Router or driver measurement receipts. The twelfth adapter
requires a combined readback for owned application stores, audit/publisher data
and SIM AI history. A missing adapter blocks confirmation; a missing or pending
subcomponent blocks completion and the final Keycloak DELETE.
