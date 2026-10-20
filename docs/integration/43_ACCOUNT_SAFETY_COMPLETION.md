# 43. Account removal — current implementation and deployment status

## Decision of 17 October 2026

The owner approved removing the shared Keycloak identity, including SIM access, and a one-time reset of all COP/SIM test-user data without creating a backup of those data. The new scope is `cop_sim_shared_identity_v1`; web contracts are `cop-account-erasure-v2` and `cop-account-erasure-preflight-v2`. Other applications manage their own data. Service identities, configuration, official map/provider data and infrastructure are preserved.

Production deletion intake is enabled. The 2026-10-19 release completed actual deletion of two synthetic accounts, including old-session denial, Keycloak identity absence and preservation of B after deleting A. A read-only recheck on 2026-10-20 confirmed the same healthy API image and finished/accepted release state. No real account was deleted for acceptance.

The web is the only entry point being changed in this stage. It identifies the actual authenticated account, requires fresh login and confirmation, commits a durable fence, logs the user out locally, and lets the server finish/retry cleanup. HTTP202 is pending. Shared identity removal requires its new explicit server authority flag. V1 stores/proofs are not silently reinterpreted as v2.

## Implemented and verified components

See [the clean lifecycle release record](../account-safety/clean-lifecycle-release.md) for exact source, transport, reset and recovery verification. The release record separates historical isolated recovery tests from actual production self-deletion. Both synthetic accounts passed the complete terminal all-domain gate and actual Keycloak absence verification. No new restore exercise is claimed by the 2026-10-20 read-only recheck.

## Remaining release work

Account deletion has no remaining activation gate in this release. On 2026-10-20 communication safety was activated using the same API image and a finite five-variable configuration contract. API health and the ordinary fresh health/public-demo gate passed; authentication and erasure remain enabled unchanged. Forty targeted report/block/retention tests passed, plus activation-scope negative tests. Actual authenticated end-user reporting/block delivery acceptance remains separate from configuration activation; final client privacy declarations and reviewer access likewise require their own truthful acceptance.

## Previous evidence

The earlier failed acceptance cases retain their original operations, scopes and receipts. Their status is unchanged. The pre-reset completion record is archived at [2026-10-17 account safety before clean reset](../archive/2026-10-17_ACCOUNT_SAFETY_BEFORE_CLEAN_RESET.md). ADR0053 remains the historical v1 decision; [ADR0056](../adr/0056_CLEAN_USER_RESET_AND_SHARED_IDENTITY_DELETION.md) defines the new explicit scope.


## Communication activation (2026-10-20)

Active release: `release-92a29dffbc0743d995f1fd6f47c114ff`. API container:
`2cd12dea0e291fc1a8356b38bf9c5718db74cdcf2a28bffa4d367f1bf067b482`.
Image unchanged: `sha256:251374f1b612dec0b0f0335250f91bb44f9e420d0d92bc2a2a3f9bf459b02a0c`.

The owner-approved `voldzi` account now has `cop_admin`, `cop_moderator`,
`cop_operator` and `csm-sim-admin`; no Keycloak admin role was granted. SIM
confirmed that the last role includes SIM/AI administration. A fresh token is
required after assignment. Moderator access covers explicitly submitted reports
and selected evidence, not automatic access to private chat history.

The finite `cop-api-communication-safety-activation-v1` contract permits only five
communication-safety environment keys. Immutable historical helpers remain
installed and delegated to. The key is generated only on the server in
`/srv/cop/.env.communication-safety` (0600, deployment account). The original
`/srv/cop/.env` is unchanged. Never copy this file into source or logs. Production
Compose adds it only to `cop-api`; the complete resolved configuration comparison
found only those five environment changes. Networks, mounts, ports, image and
other services are unchanged. Preserve this selected deployment delta on future
releases; copying a different Compose file is not an accepted migration.

Contact: `podpora@zeleznalady.cz`. Evidence expires at the earlier of 90 days
from receipt and 30 days from first closure; text-free audit expires by 180 days.
Blocking lasts until unblock or account deletion. Keep the evidence key for
existing reports. Disabling new intake must not disable retention or canonical
block enforcement; rollback requires a separate finite reviewed transition.

Sanitized production receipt: `/srv/cop/runtime/communication-safety/activation-20261020.json`
SHA-256 `479cf9b5b6d0b2c9d4cf4de67aafaa4f9749bf0585bfee184d4cacbc35f69c15`.
Unauthenticated safety capability and moderation queue requests both returned
401. The receipt explicitly records `authenticatedEndUserDeliveryVerified=false`
until a legitimate fresh authenticated session is available; no bypass token is
created for that verification.


Authenticated readback on 2026-10-20: the owner's fresh BFF session was accepted
as `voldzi`; safety capabilities returned reporting=true and blocking=true with
the approved contact. The moderator queue returned a valid empty item list.
This verifies authenticated availability and moderator authorization, not an
actual report submission or message/call blocking delivery test. No report,
block, identity, vehicle or user-content mutation was made for this readback.
Sanitized local receipt SHA-256:
`be8926490d6319bad9cc26b7d8216595ec08887d405687ed5d2ed6582c849bec`.
