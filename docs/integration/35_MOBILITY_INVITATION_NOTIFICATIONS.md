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

Server rollout completed 2026-10-05. SDK public code pin:
`b587438827fcd3db159a47df616745a4f26e2ef1` (`COP-Mobile`,
`codex/shared-mobility-sdk`). COP code source:
`5137c6bd8e77c7581b6ecb828d41c4b6b350865f`
(`codex/cop-mobility-invitation-push`). Messaging validator source:
`d311b2c85c15e8f00cd62c5d3fdf83198d665e3d`
(`codex/jizda-apns-ticket`). Documentation commits do not change these runtime
code revisions. Production checkouts remain COP6583cb5 and Messaging2246290;
the exact narrow immutable runtime overlays below are deployed.

Binding full OpenAPI SHA256:
`caac490de1dce7ff92194ddf7fe9b16faddf5d43740678baecf33ea2af6559d1`.
Mobility fragment SHA256:
`9207fb22d3c2c9eace5d9a76dc07185015dacd499c123f6290bf970714955e6e`.

### Tests actually performed

- COP full suite:1289 passed,3 skipped; final outbox suite12 passed, including
  actual HTTP provider serialization with synthetic authorization and exact
  invitation/recipient idempotency. Other targeted suites29 and30 passed;
  these counts overlap and must not be added as distinct coverage.
- Outbox tests cover both types, concurrent workers, retry/restart, privacy
  payload, atomic rollback, unknown/unverified email, revocation, expiry,
  acceptance and changed email/verification. Server lint/API build/schema11/
  skeleton passed; binding OpenAPI validation passed with26 existing warnings.
- Isolated prepared COP image29 checks passed; isolated prepared Messaging
  module9 signed-ticket/allowlist/expiry/replay/signature checks passed. These
  containers used only synthetic credentials and network none. Messaging full
  Mix suite was not run; the exact isolated compiled-module checks are the
  evidence for this one-module change.
- Mobile mandatory `scripts/check.sh` passed with approved Xcode27.1/27A9269:
  30 app unit tests,5 app UI tests,111 package XCTest cases (110 passed,
  1 private replay skipped),2 SwiftTesting cases and2 accessibility audits.
- Four new SDK tests passed independently in a clean archive of the public pin,
  excluding all other unpublished Mobile changes. They test strict URLs,
  current-account/inbox/expiry/revocation/session races and host-category merge.
- Initial signed-in UI audits failed because the test searched exact
  chat.workspace only as element type Other. The active Duo display proved
  the signed-in synthetic chat was visible. The corrected locator keeps the
  exact ID and all audit categories; complete Debug workflow then passed.
  Release preview authentication remains disabled. Separate Release simulator
  build passed. No physical-device delivery is inferred from these results.
- Category helper tests use real UNNotificationCategory values without
  instantiating UNUserNotificationCenter.current in a headless runner. Actual
  OS center registration/coexistence with RIDE_START_CATEGORY remains a device
  acceptance case; SDK preserves the host delegate and non-owned categories.

### Deployed runtime and preservation

| API | Immutable image | UTC start |
| --- | --- | --- |
| COP | sha256:3e860fb34dc68426f3dbc33bf24149f0c6ed8346fe1ff08116b0f4fec9467b19 | 2026-10-05T13:38:29.32702159Z |
| Messaging | sha256:556c7784a918150f553997c8197d91e4e2b2f08baf0fe3d4fe38e7e35f33eed0 | 2026-10-05T13:38:11.690436024Z |

Both are healthy with readiness200. Actual running hashes match all17 COP
compiled/contract artifacts and the single Messaging validator BEAM artifact.
Inherited base-image layers and settings were verified before replacement.
Only the two APIs were recreated; all132 other container IDs are unchanged.
Environment (sorted), commands, entrypoint, healthcheck, resource/security
HostConfig, mounts, ports, static network aliases, Compose labels and the existing
.env/Compose files were compared. No secret, network, consent or SIM measurement
configuration was changed.

The first Messaging attempt was automatically rolled back because its raw
HostConfig digest differed. Exact reconstruction proved that *only* Dns,
DnsOptions and DnsSearch changed representation from [] to null. Changing these
three empty values back reproduced the original raw digest exactly; no other
field was ignored. The second attempt normalizes precisely those three fields.
Final COP raw HostConfig equals the original without any changes; final Messaging
matches after that proven empty-value normalization. The original attempt,
rollback and comparison artifacts are retained, rather than overwritten.

At 2026-10-05T13:39:30.976Z, read-only production checks confirmed primary DB,
one exclusive dispatch lease and one dedicated lease connection, live/ready/
dependencies200, and four anonymous mobility/vehicle/dispatch requests401.
Measurements remain false, shared mobility and private dispatch true. Runtime
Messaging validator now includes Jizda; APNs status remains live/configured,
default production, both allowed topics. Device apnsEnvironment chooses the
appropriate endpoint; this status does not prove Apple delivery in either one.

Operational evidence lives under
`/home/voldzi/cop-deployments/mobility-invitations-20261005/` on docker.home.cz:
deployment-before-first-attempt.json, deployment-first-attempt.log,
deployment-before.json, deployment-after.json, deployment.log,
original-vs-final-config.json, runtime-check-first.json, COP artifact manifest and
isolated-image logs. These contain no printed token or invitation/GPS payload.

### Remaining joint acceptance

No real account, invitation, GPS or user-device push was created for tests.
No old invitations were backfilled. Actual Apple sandbox/production delivery,
permission denied, foreground/background/locked/cold-start handling, account
switch, revoked/expired link, host-category coexistence and return to a running
ride remain physical-device tests. Only iPhone16v is authorized for Jizda; do not
use Jirina's phone. Inbox remains available when delivery fails. Invitations
never automatically accept membership or authorize GPS. Jizda separately owns
ride-start local reminders; COP has no ride-start signal and does not infer one.
SIM measurements remain false.

## Rollback

Capture both API image IDs and canonical configuration/per-field hashes before
recreation. Retag previous images and recreate only COP API and Messaging API
using unchanged Compose/env/mounts/networks. Keep durable outbox records for
subsequent retries/expiry; do not delete user invitations or automatically grant
membership/consent. No database schema changes or new secrets are required.
