# Mobility invitation notifications v1 —2026-10-05

## Contract and behavior

The binding OpenAPI extension `x-cop-mobility-invitation-notifications` specifies
`cop-mobility-invitation-notification-v1`. Existing invitation receipts remain
queued and non-enumerating; queued means durable invitation, never confirmed
Apple/device delivery. Existing verified-account inbox remains authoritative.

COP atomically creates a per-recipient outbox record with the invitation and
operation receipt. Only already-known, verified accounts matching the normalized
invited email at creation are bound (maximum20). Unknown/unverified emails get the
same receipt and no push job. A later registration can read the verified inbox,
but does not retroactively receive an automatic push. Idempotent invite retries
create no duplicate jobs. Outbox stores only opaque invitation/account IDs,
expiry, state, attempts and retry/claim metadata; no added email, names, raw GPS,
keys or APNs tokens. Domain30-day-after-expiry cleanup also removes outbox jobs.

A worker serializes durable claims, performs network calls outside SQL and uses
an invitation+recipient idempotency key at Messaging. Claims expire after60s;
retry backoff is bounded2s–5min until expiry, with a single flight per worker.
Before emission it rechecks verified recipient/email, pending invitation,
expiry and current inviter management permissions. Revoke during the network
call may still leave a generic alert; the alert cannot grant membership.
Provider intake acceptance finishes a job; subsequent Apple delivery is best
effort. Device registration, notification permission/preferences and valid APNs
credentials remain prerequisites. Zero devices or Apple failure is not success
on the phone; the authoritative inbox is the recovery path.

## Wire

Use existing Messaging `system.account`, severity info, priority normal,
userIds resolved only on the server. Send fixed generic text, no entity/inviter
names or email. This uses ordinary APNs alert, never VoIP. Example synthetic link:

`csm://mobility/invitations/v1/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/vehicle/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`

The first UUID is recipient COP account ID; the second is invitation ID. Entity
type is vehicle or group. Source provider is cop.mobility/layer mobility-invitations.
APNs carries the supported deepLink/type/source envelope; metadata contractVersion
is only Messaging intake metadata, not an assumed APNs field. No free context.

Only a user tap may navigate. SDK restores the existing session, loads current
COP account and verified pending inbox, checks exact recipient/ID/type/expiry,
and rechecks session scope after every await. Revoked/missing/wrong-account links
produce no navigation. Explicit acceptance and separate GPS consent remain
mandatory. Passive/background notification delivery does not navigate.

## Public SDK / host integration

Host remains UNUserNotificationCenterDelegate and forwards existing callbacks to
CSMCommunicationNotifications, then awaits processPendingNotifications. Observe:

- .csmMobilityInvitationRequested: userInfo["navigation"] is
  CSMMobilityInvitationNavigation(invitation:CSMMobilityPendingInvitation,
  sessionScope:String), containing only the freshly verified inbox item.
- .csmMobilityInvitationVerificationFailed: the same neutral result for nil and errors;
  offer manual inbox retry, reveal no missing/revoked/wrong-account reason.

Clear UI navigation on account switch; verify the supplied sessionScope before
presentation. URL target parser CSMMobilityInvitationNotificationTarget is public;
its parse success is not authorization. Runtime method
mobilityInvitationForNotification(url:expectedScope:) performs the server checks.
Initial signed-out notifications stay in the existing bounded16-item volatile
queue until session readiness. No persistent decrypted content or new tokens.

## APNs prerequisites found

Both COP issuer and deployed Messaging validator originally admitted only
cz.voldzi.copmobile. Fix exactly the two-bundle allowlist to also admit
cz.voldzi.jizda. HMAC, subject, instance, expiry and one-time use are unchanged.
The deployed APNs configuration is live/configured and allows both topics;
default environment is production, device apnsEnvironment selects sandbox or
production. This configuration is not evidence of successful Apple authorization
or phone delivery in either environment. Client signing must include the matching
aps-environment; Debug uses sandbox, distribution production.

## Verification / rollout status

Prepared, production rollout pending. Server targeted tests passed29, ticket/
COP state regressions30; new outbox cases cover both types, concurrent workers,
retry/restart, privacy payload, atomic rollback, unknown/unverified email,
revocation, expiry, acceptance and email/verification change. SDK110 XCTest
(109 passed,1 private replay skipped) plus2 SwiftTesting passed. Three new SDK
cases cover strict parsing and account/expiry/revocation/session-race resolution.
Full Mobile check, full server checks, exact published pins and isolated packaged
runtime/deployment evidence follow below when complete. No real account, invite,
GPS or user device push is used as synthetic acceptance. Physical delivery to
both phones, background/cold-start and actual sandbox/production delivery remain
joint acceptance gates. Jízda separately owns ride-start local reminders;
COP has no ride-start signal and does not infer one. SIM measurements remainfalse.

## Rollback

Capture both API image IDs and canonical configuration/per-field hashes before
recreation. Retag previous images and recreate only COP API and Messaging API
using unchanged Compose/env/mounts/networks. Keep durable outbox records for
subsequent retries/expiry; do not delete user invitations or automatically grant
membership/consent. No database schema changes or new secrets are required.
