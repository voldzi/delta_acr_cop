# 12 COP Notification Decision And Push

## Status and ownership

The new automatic safety worker and ČT24 context are implemented as an additive
release candidate. Production deployment, activation and physical delivery with
the application closed are separate acceptance gates; see
[runbook 21](../runbooks/21_COP_CRISIS_NOTIFICATIONS.md) and
[ADR 0040](../adr/0040_VERIFIED_CRISIS_NOTIFICATIONS_AND_MEDIA_CONTEXT.md).
A working map feed or accepted Messaging request is not evidence of a delivered
phone notification or complete national crisis coverage.

```text
SIM verified candidates -> COP recipient decision -> CSM Messaging -> APNs / Web Push
SIM ČT24 context -> COP informational panel (no crisis notification)
```

- **SIM** owns source provenance, normalized safety candidates and input
  readiness. It does not know COP users or devices.
- **COP** owns explicit account consent, stored watched areas, severity,
  recipient relevance and a durable recipient deduplication ledger. The worker
  does not need an open browser, foreground refresh or a manufactured user token.
- **CSM Messaging** owns APNs/Web Push credentials, device delivery and delivery
  audit. COP sends requests server-to-server using the existing service
  credential; no service credential reaches a client.
- **Clients** register their device, choose watched areas and explicitly enable
  automatic safety notifications. Notification permission or a push subscription
  alone is not this consent.

## Explicit consent and device preconditions

The existing authenticated profile contains `alertPreferences.aoiRules` and
`minimumSeverity`. A new optional `safetyNotificationsEnabled` is **false when
missing**. Generic `PUT /api/v1/me/preferences` cannot set this protected consent
field; it preserves the current server value.

Enable or revoke consent through the authenticated endpoint:

```http
PUT /api/v1/me/notifications/safety
Content-Type: application/json

{"enabled": true}
```

Only `enabled: boolean` is accepted. The subject comes from the verified COP
session, never a body field. The response is
`cop-safety-notification-consent-v1` with `enabled` and `updatedAt`.

Enabling requires the configured worker, primary profile and notification
stores, at least one enabled watched area, and an eligible device. Missing user
preconditions return `409 SAFETY_NOTIFICATION_PRECONDITION`; unavailable
infrastructure returns `503`, not an assertion that the user refused permission.
Revocation uses `{"enabled":false}` and does not require a working SIM or
Messaging connection. The primary profile store must still be reachable.

Native eligibility is an account-owned paired COP mobile device with
`pushTokenRegistered=true`. Web eligibility is recorded only after Messaging
accepts registration, subject to the device's `enabled` and `safetyAlerts`
preferences; accepted deletion removes that eligibility. COP stores the minimum
account/device capability reference, not APNs tokens or Web Push secrets.
Messaging remains authoritative for actual delivery and stale-token rejection.

The worker rereads the primary profile under the same subject lock used by
consent/profile updates immediately before dispatch. A completed revocation
precedes any subsequent dispatch. A request already accepted by Messaging may
still arrive after revocation; COP cannot retract that notification.

## Verified SIM candidate boundary

Both automatic work and authenticated manual evaluation use only:

```http
GET /safety-data/api/v1/notifications/candidates
```

Required contract: `sim-safety-notification-candidates-v1` with
`policy.eligibilityPolicy=verified_alert_and_non_fallback_location_required`,
`technicalWarningsPolicy=never_push_to_public_users`, and
`inputReadiness.status=ready`. The input snapshot must have valid, fresh
`snapshotGeneratedAt` and `snapshotAgeSeconds`; unavailable/incomplete input is
not a known healthy empty area. COP checks the echoed query, timestamps, source,
geometry and candidate structure. Redirects are forbidden; response size and
whole-response time are bounded. There is no fallback to `/features`, map
warning text, a stale map cache or technical diagnostics.

SIM v1 has no documented paging cursor. A saturated feature query is
`possibly_truncated` and cannot be dispatched as a complete result. The worker
queries individual saved areas rather than claiming a nationwide scan. A ready
result below the known limit confirms only the requested snapshot, not complete
upstream coverage. SIM technical warnings and unrecovered cache errors block
readiness. Source outages are operational degradation, never public crisis
alerts.

For every candidate COP independently rejects:

- missing/malformed/future validity, expiry, stale or inactive events;
- media, informational items and explicit `notificationEligible=false` /
  `eligible=false` policy;
- reference layers and unsupported/unverified sources;
- fallback/centroid/representative points, unknown location, invalid geometry;
- severity below `warning`, or below the recipient's `critical` threshold.

Municipal alerts additionally require explicit event expiry. Generic municipal
RSS bulletins do not qualify simply because they contain alarming words. The
collection's SIM provenance attestation does not let COP verify the original
publisher independently; COP does not invent a replacement attestation.

## Relevance and automatic worker

Saved circles and Polygon AOIs use actual geometric intersection. Official
Polygon/MultiPolygon areas include their boundaries and exclude hole interiors;
separate islands do not create an imaginary affected region between them.
Bounding boxes are query envelopes only. A polygon centroid or a municipality /
region fallback point is not evidence that an event is near a person.

The worker selects only persisted opt-in profiles and then checks current
consent, enabled areas, severity and device capability. It sends
`audience.userIds=[authenticated persisted subject]` only. Matched area IDs are
relevance evidence; they are not additional broadcast recipients. It sends no
continuous/current GPS or plaintext private message context to SIM or Messaging.

Defaults and bounds for the server poller are in the runbook. Paging is by
persisted subject, with bounded pages, recipients, dispatches, concurrency and
run time; one durable worker lease prevents concurrent pollers. Ready candidate
results may be reused briefly for identical area queries. Failed/incomplete
results are not reused as safety evidence. Failures produce bounded backoff.
Restart preserves accepted deduplication keys in PostgreSQL.

## Manual evaluation compatibility

```http
POST /api/v1/notifications/safety/evaluate
Content-Type: application/json

{"bbox":[13.9,49.9,14.1,50.1],"layers":["weather_alerts","warnings"],"dryRun":true}
```

`dryRun` still defaults to `true` and sends nothing. Relevance is evaluated only
against the current user's **stored** watched areas; legacy `currentLocation`
does not select delivery recipients. An explicit audience naming another user,
any group or an area returns `403 NOTIFICATION_AUDIENCE_FORBIDDEN`. This endpoint
is no longer a group/broadcast dispatch interface.

`dryRun=false` also requires explicit consent and the running worker/durable
ledger and uses the same recipient claim path. Responses preserve
`cop-notification-evaluation-v1`, decisions and summary fields; `dispatch` is an
empty compatibility array, with aggregate `dispatchSummary` and `inputReadiness`
as additive fields. `dispatchedCount` / `acceptedCount` describe Messaging
intake acceptance, not physical delivery. Missing/expired source input returns
`503 SAFETY_CANDIDATES_NOT_READY` or `SAFETY_EVALUATION_UNAVAILABLE`.

## Recipient identity, deduplication and intake

The stable incident identity hashes the provider, source, explicit canonical
`incidentId` when provided (otherwise `featureId`), `validFrom` and
`validUntil`. Rendering layer and locale are excluded. Generic `sourceIncident`
is retained as source metadata but is not a unique incident ID: for example,
`CHMI_CAP_FIRE_DANGER` can be a common label for independent events.

The Messaging header is an opaque per-recipient key:

```http
POST /api/v1/notifications
Authorization: Bearer <server-only Messaging credential>
Idempotency-Key: cop.safety:<SHA-256 recipient and incident digest>
```

Two users receive independent delivery claims. The same incident copied into
multiple layers cannot suppress another user or duplicate a relevant delivery
for the same user. CHMI hydro additionally scopes the key by severity and uses a
persistent per-user/station-feature/severity cooldown (default one hour), so
routine measurement timestamps do not repeatedly notify while severity
escalation can notify separately.

COP persists opaque keys, attempt/lease/expiry/acceptance timestamps and a
Messaging notification reference. It does not persist the source candidate
body, geometry or user GPS in this ledger. Profile areas remain existing,
authenticated account preferences. There is no automatic deletion of delivery,
cooldown or audit evidence in this release; retention requires an explicit
separate policy.

A claim is considered accepted only when Messaging reports `online`, a
`notificationId`, and at least one targeted device. This does **not** establish
APNs/Web Push success, a visible banner, user receipt or acknowledgement. After
successful intake COP does not resubmit that key. Messaging owns downstream
redelivery and invalid-token handling. COP retry is capped at five attempted
intakes, bounded by expiry, and requires the candidate to appear in a subsequent
valid SIM result; COP stores no full notification payload queue.

## ČT24 informational context

COP adds `GET /api/v1/safety/context/news`, proxying SIM
`GET /safety-data/api/v1/context/news` with
`contractVersion=sim-crisis-media-context-v1`. The separate panel shows only
bounded headlines, original links, publication time and attribution
**Česká televize / ČT24**. It is not an official IZS alert, an automatically
localized incident, a full article or a video proxy.

Every item must remain `informationalOnly=true`,
`notificationEligible=false`, `location=null`, `locationStatus=unresolved` and
`eventAt=null`. `regionCode` with `regionScope=feed` denotes the editorial feed
area, **not the location of the reported event**. It must not create a map pin,
nearby-distance promise or crisis push. COP validates fixed ČT24 feed/link
origins, uses bounded server fetching and keeps the informational cache separate
from notification candidate processing. No ČT24 content enters the worker.

## Community reports

Existing `community.report` lifecycle notifications remain separate and
unchanged. Submit/update use the report's authorized discussion group; resolve
and withdrawal produce bounded lifecycle notices. Media access remains governed
by attachment ACL and signed content tokens. Report text/media do not become
SIM safety candidates or an implicit public broadcast.

```text
cop.community-report:<reportId>:<event>:<version>:<updatedAt>
csm://map/report/<reportId>
```

## iOS Contract

Thin-host COP Mobile obtains a 120-second, one-time registration credential via
`POST /api/v1/mobile/device-registration-tickets`. The request is authenticated
with the current COP web session and binds the ticket to the subject, iOS
platform, approved bundle ID and native app-instance UUID. Web passes only this
ticket to the native bridge; the APNs token remains native-only and is sent
directly to CSM Messaging `POST /api/v1/devices`.

COP and CSM Messaging share
`COP_DEVICE_REGISTRATION_TICKET_SECRET`/`CSM_DEVICE_REGISTRATION_TICKET_SECRET`
as server-only configuration. CSM Messaging validates and consumes `jti` once.
Neither service logs the ticket or APNs token.

The iOS CSM Messenger app must register APNs devices directly with CSM
Messaging:

```http
POST /api/v1/devices
Authorization: Bearer <user access token>
```

The COP mobile endpoint `/api/v1/mobile/devices` is not a push registry. It is
only a COP session/capability audit endpoint for native COP clients and ignores
raw APNs token storage. APNs keys and token delivery state belong only to CSM
Messaging.

## Browser Web Push Registration

COP web/PWA clients register browser push subscriptions through COP, not
directly against CSM Messaging:

```http
GET /api/v1/push/web/config
POST /api/v1/push/web/devices
DELETE /api/v1/push/web/devices/{deviceId}
Authorization: Bearer <COP user access token>
```

The configuration endpoint is public and returns only public data: whether
browser notifications are enabled and the VAPID public key. The authenticated
registration endpoint accepts a browser `PushSubscription`, validates the
device id and HTTPS endpoint, and forwards the subscription server-side to CSM
Messaging device registry with `platform=web` and `pushProvider=webpush`.

CSM Messaging remains the only owner of delivery state. COP does not keep Web
Push endpoint credentials beyond the forwarded request and never sends a push
payload directly to a browser push service.

The COP PWA service worker is registered at `/cop-service-worker.js` with root
scope `/`. The web client treats a browser as truly registered only after COP
receives `registered=true` from the CSM Messaging device registry. A local
browser `PushSubscription` by itself is only a browser-side subscription; if the
server registration is missing, degraded or was created by an older client, the
PWA shows a limited state and prompts for a fresh registration. Notification
clicks are handled in the service worker: chat deep links prefer an existing
`/chat/...` window, while map alert/report links prefer the map shell.

The SwiftUI thin host injects `__COP_DEVICE_NATIVE_TRANSPORT__` at document
start. When that transport is present, COP web does not register the browser
PWA service worker: COP Mobile owns APNs/PushKit and persistent WebKit startup
recovery itself. This prevents a browser service-worker navigation from
deadlocking the embedded `WKWebView`, while ordinary Safari/installed-PWA
clients retain browser push and offline caching.

The integrated chat uses the same Web Push registration helper as the main COP
map shell. Its notification bell must represent real server registration state:
browser support, `Notification.permission`, service-worker subscription and COP
web device id. After a registration change, the chat updates the Matrix pusher
on the live session so sync and E2EE state are not restarted.

For iOS/iPadOS PWA use, the chat must treat `pagehide`, `pageshow`,
`visibilitychange`, `focus` and `online` as lifecycle boundaries. When the app
returns from the background, an existing healthy Matrix session remains active.
The client restarts only a stopped session or an error that remains unresolved
for five minutes; ordinary background pauses do not churn the Matrix device,
sync store or crypto. Matrix member profiles and avatars may be hydrated from a
bounded browser cache while missing profiles are fetched with limited
concurrency.

For chat/message notifications, CSM Messaging should include either COP
`conversationId` or Matrix `roomId` in the push metadata/deep link. iOS then
loads COP conversation metadata through:

```http
GET /api/v1/messaging/conversations/{conversationId}
GET /api/v1/messaging/conversations/resolve?roomId=<encodedRoomId>
```

COP does not resolve a bare Matrix `messageId`, because it does not read Matrix
timelines and must not become a plaintext or Matrix-message proxy. If a deep
link contains `messageId`, it should also contain `roomId` or `conversationId`.

## Security Rules

- COP never sends push directly to APNs.
- COP never stores APNs device tokens.
- COP never passes CSM Messaging service token to browser or iOS clients.
- COP never proxies plaintext Matrix/E2EE messages.
- SIM remains server-to-server and is not called directly by mobile clients.
- Delivery audit belongs to CSM Messaging. COP audit records only decision and
  dispatch metadata.
