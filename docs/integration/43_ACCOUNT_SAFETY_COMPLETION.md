# 43. Account removal — current implementation and deployment status

## Decision of 17 October 2026

The owner approved removing the shared Keycloak identity, including SIM access, and a one-time reset of all COP/SIM test-user data without creating a backup of those data. The new scope is `cop_sim_shared_identity_v1`; web contracts are `cop-account-erasure-v2` and `cop-account-erasure-preflight-v2`. Other applications manage their own data. Service identities, configuration, official map/provider data and infrastructure are preserved.

Production deletion intake is still disabled. The reset and new deployment have not run. No current production user was deleted during these tests.

The web is the only entry point being changed in this stage. It identifies the actual authenticated account, requires fresh login and confirmation, commits a durable fence, logs the user out locally, and lets the server finish/retry cleanup. HTTP202 is pending. Shared identity removal requires its new explicit server authority flag. V1 stores/proofs are not silently reinterpreted as v2.

## Implemented and verified components

See [the clean lifecycle release record](../account-safety/clean-lifecycle-release.md) for exact source, transport, reset and recovery verification. The new COP adapter has been exercised against real SIM HTTP and owned PostgreSQL. Reset and independent-journal recovery have actual local PG tests; Keycloak reset/individual erasure currently have HTTP-mock evidence. These checks do not constitute whole-provider or production acceptance.

## Remaining release work

Complete the authorized human/service identity separation in Messaging, assemble the fresh whole-service acceptance with actual providers, then perform the finite coordinated reset, Root-bound enrollment and deployment. Actual source/epoch/closure, A/B isolation, failures and recovery must be proven before enabling intake. No test endpoint or old negative case is a positive production receipt.

## Previous evidence

The earlier failed acceptance cases retain their original operations, scopes and receipts. Their status is unchanged. The pre-reset completion record is archived at [2026-10-17 account safety before clean reset](../archive/2026-10-17_ACCOUNT_SAFETY_BEFORE_CLEAN_RESET.md). ADR0053 remains the historical v1 decision; [ADR0056](../adr/0056_CLEAN_USER_RESET_AND_SHARED_IDENTITY_DELETION.md) defines the new explicit scope.
