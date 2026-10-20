# 43. Account removal — current implementation and deployment status

## Decision of 17 October 2026

The owner approved removing the shared Keycloak identity, including SIM access, and a one-time reset of all COP/SIM test-user data without creating a backup of those data. The new scope is `cop_sim_shared_identity_v1`; web contracts are `cop-account-erasure-v2` and `cop-account-erasure-preflight-v2`. Other applications manage their own data. Service identities, configuration, official map/provider data and infrastructure are preserved.

Production deletion intake is enabled. The 2026-10-19 release completed actual deletion of two synthetic accounts, including old-session denial, Keycloak identity absence and preservation of B after deleting A. A read-only recheck on 2026-10-20 confirmed the same healthy API image and finished/accepted release state. No real account was deleted for acceptance.

The web is the only entry point being changed in this stage. It identifies the actual authenticated account, requires fresh login and confirmation, commits a durable fence, logs the user out locally, and lets the server finish/retry cleanup. HTTP202 is pending. Shared identity removal requires its new explicit server authority flag. V1 stores/proofs are not silently reinterpreted as v2.

## Implemented and verified components

See [the clean lifecycle release record](../account-safety/clean-lifecycle-release.md) for exact source, transport, reset and recovery verification. The release record separates historical isolated recovery tests from actual production self-deletion. Both synthetic accounts passed the complete terminal all-domain gate and actual Keycloak absence verification. No new restore exercise is claimed by the 2026-10-20 read-only recheck.

## Remaining release work

Account deletion has no remaining activation gate in this release. The separate communication-safety release remains incomplete: the 2026-10-20 production readback shows report/block intake disabled and no moderator/evidence-key configuration. Do not claim production reporting/blocking or whole Jízda App Review readiness from deletion acceptance alone. Final client privacy declarations and reviewer access require their own truthful acceptance.

## Previous evidence

The earlier failed acceptance cases retain their original operations, scopes and receipts. Their status is unchanged. The pre-reset completion record is archived at [2026-10-17 account safety before clean reset](../archive/2026-10-17_ACCOUNT_SAFETY_BEFORE_CLEAN_RESET.md). ADR0053 remains the historical v1 decision; [ADR0056](../adr/0056_CLEAN_USER_RESET_AND_SHARED_IDENTITY_DELETION.md) defines the new explicit scope.
