# 33. Jízda mobility: runtime recheck and exact client boundaries

Verified: 2026-10-05 13:07:12 CEST. Read-only production diagnosis; no new restart, real accounts/vehicles, GPS activation or server rollout.

## Current runtime, not the original release identity in handoff 29

- API source `6583cb5ab659044cc681294ee291f9b08135a4bc`; image `sha256:d4f9b1f6ee9121f85640e6445a0926928a0c07271a77b617256ec1b9e200e5b8`.
- Same container `e6542a22796a0b1cd827c3038547ae78b70300c6f1804c0cbb0c1c2ec19cfc47`, started 08:08:49 CEST by the separately approved one-time restart.
- Mobility/Dispatch enabled; driver measurements disabled.
- PostgreSQL reachable and primary. Granted advisory lease `(731031,1)` is again **zero**. The earlier restart recovered one lease for at least five minutes, but it has subsequently been lost. Do not call Dispatch production acceptance complete.
- `/health/live`, `/health/ready`, `/health/dependencies`: 200 despite the missing lease. Generic health is insufficient for Dispatch readiness.
- Binding fragment SHA256 `2e705a1291864ea69af03ec6d2ca16b8dd8d458049c915fd0bb718798bc1927f`, identical to the released contract.
- Public SDK remote branch `codex/shared-mobility-sdk`: `1f2e9f72d0b12c788c407411e003d00aad3a7861`, including shared OIDC refresh and same-account restoration. Handoff 29 remains valid for wire/encryption semantics; its original runtime/SDK table is historical.

Anonymous account/capabilities/vehicles/invitations returned 401 UNAUTHORIZED. This confirms the authentication gate, not authenticated endpoint success. No affected-user error/correlation was available. Thirty-minute sanitized logs contained no correlated mobility completion/error evidence; route logging is silent. Neither the user's failure nor the process-local lease flag is directly confirmed by this check. The lock loss is independently confirmed; its original TCP/failover cause remains unknown.

## Paths and authorization boundaries

| Purpose | Exact endpoint | Boundary |
| --- | --- | --- |
| Account | GET `/api/v1/mobility/v1/account` | Verified OIDC issuer/subject; server account UUID. GET provisions/updates account. |
| Feature capabilities | GET `/api/v1/mobility/v1/capabilities` | Signed OIDC; database check. Enabled Dispatch with process-local unavailable lease causes whole response 503 DISPATCH_UNAVAILABLE. |
| Vehicles | GET `/api/v1/shared-vehicles/v1/vehicles` | Current account membership/ACL; independent of the private Dispatch gate. |
| Invitation inbox | GET `/api/v1/mobility/v1/invitations` | Requires signed email + emailVerified; otherwise403 EMAIL_VERIFICATION_REQUIRED. It is not a logout or necessarily a vehicle failure. |
| Group readiness | GET `/api/v1/private-dispatch/v1/groups/{groupId}/readiness` | Current group member and functioning Dispatch lease; exact audience/key directory. |
| Snapshot | GET `/api/v1/private-dispatch/v1/groups/{groupId}/snapshot?deviceId={uuid}` | Current member and registered recipient device owned by that account. |
| Own-share discovery | GET `/api/v1/private-dispatch/v1/shares` | Supplements recovery; empty results do not confirm cancellation. |
| Confirmed stop | POST `/api/v1/private-dispatch/v1/shares/{shareId}/stop` | Own share + same registered sender device, even after removal/group deletion, while service available. |
| Timed-out start cancellation | POST `/api/v1/private-dispatch/v1/shares/cancel-start` | Account-scoped durable barrier against that start operation. |

Except capabilities, authenticated mobility GETs run `service.account` and can write account metadata. Snapshot also persists expiry changes. They were not fabricated as read-only production probes.

Capabilities v1 fields are contractVersion, sharedVehiclesEnabled, dispatchEnabled, maxVehicleMembers=5, maxGroupMembers=200, registration, dispatchTransport, currencies, serverTimestamp, invitationDelivery. Current implementation returns registration=unverified, invitationDelivery=verified_account_inbox, dispatchTransport=recipient_encrypted_latest_only, currencies CZK/EUR/USD. Feature flags are not group permission, explicit consent or evidence of healthy encryption/readiness. Separate account, vehicles, invitations and Dispatch errors in the UI; do not discard a valid account because another service failed.

## Private Dispatch readiness and encrypted snapshots

Readiness contains groupId, membershipRevision, state, audienceHash, devices and serverTimestamp. Implementation returns ready only when each current group member has at least one registered device, otherwise missing_device_keys. Schema also permits unavailable, but actual lease failure is HTTP503 before this operation, not a fabricated ready/unavailable directory. The directory is COP authenticated, not independent manual identity verification.

A start requires exact current membershipRevision/audienceHash, the account's registered sender device and fresh explicit user consent. Durations are 900/3600/28800 seconds; ride_end remains bounded to eight hours. Membership/device-key change invalidates existing shares and requires renewed consent.

Snapshot contains group, readiness, activeShares, points and serverTimestamp. Only the requested recipient's encrypted box is returned. Sender, recipient, group, share, audience, membership revision, sequence and observedAt are authenticated encryption bindings. Use only SDK `CSMDispatchEncryption.openPoint(_:in:now:)`, never loose decryption against a cached roster. SDK requires snapshot timestamp within15 seconds, own device/current group membership, current active share/audience and matching sequence/expiry. Server points are latest-only, observed-age bounded180 seconds and never persisted as GPS in SQL/SIM. UI fresh<=60sec, stale60..180sec, hide after180sec or share expiry. Clear old markers on share/roster changes and confirmed stop; polling time is not observation time.

## Stop versus cancelStart

Stop body: `{operationId, deviceId, reason}`. Reasons: user/privacy_zone/ride_end/logout/account_change/membership_change/keys_unavailable/background_unavailable. Reuse the exact operation UUID/body on retry. Receipt requires confirmed=true, exact operationId/share and inactive share state. It clears latest RAM ciphertext and marks durable share stopped. The global Dispatch availability gate still applies: 503 is not confirmation of stop.

Timed-out start: persist original startOperationId and use a NEW cancellation operationId. Body `{operationId,startOperationId}`; receipt `{operationId,startOperationId,confirmed:true,serverTimestamp}` must match both identifiers. Durable account-scoped cancellation serializes against start both before/after commit. An empty ownedShares GET is insufficient; keep a durable pending cancellation/stop barrier until exact acknowledgment. Block new start and stop local GPS immediately while recovery is pending. Never replay GPS positions. A stopped/restarted start retry cannot reactivate a share; no reconnect/login should restore consent.

## Invitations

Invites are authenticated account inbox items for matching normalized verified email, expire after seven days and are filtered by current inviter permission/entity state. No SMTP delivery is implemented. An empty verified inbox is valid200; unverified email is403, wrong entity/account404, expired/revoked/used invitation410 as appropriate. Acceptance uses invitationId+persisted operationId and server-assigned receipt UUID/revisions. Invite problems must not silently clear unrelated valid account/vehicle state or start an OIDC renewal.

## Evidence and remaining acceptance

Fresh local isolated run: **17 tests passed, three suites** (mobility-service, mobility-http, mobility-participant): synthetic identities/ACL, inbox, operations/replay, recipient binding, TTL/restart, publish-stop/cancel-late-start and dependency failures. No real user/vehicle/location data were used. Original isolated PostgreSQL and packaged-image evidence remains recorded in handoff29; it was not repeated here.

Today's separately completed SDK regression:103 passed, one private road replay skipped, including13 new OIDC/restoration tests. Physical two-account invitation/ACL/outbox, same-account browser renewal, encrypted sender/receiver device flow, private zones, real GPS foreground/background, logout/account switch, offline pending stop/cancel, battery and network acceptance remain open. No client gate should be enabled solely from these synthetic tests.

## Required server stage before claiming reliable Dispatch

Recurring lease loss plus absent automatic recovery/readiness is an unresolved server blocker. The proposed bounded single-owner generation-aware recovery, lease heartbeat, stale-share invalidation and health semantics are in [document32](32_COP_DISPATCH_LEASE_RECOVERY.md). Implement/test as a separate narrow release; do not widen network access or automatically resume sharing. This diagnosis does not authorize another restart or rollout. Repeating the previous restart alone would again be temporary and interrupt active shares.
