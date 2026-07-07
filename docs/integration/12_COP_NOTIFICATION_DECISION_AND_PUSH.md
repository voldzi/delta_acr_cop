# 12 COP Notification Decision And Push

## Purpose

COP is the decision layer between SIM data providers and CSM Messaging push
delivery. It evaluates which safety or community event is relevant to a user,
group or watched area, then sends a minimal notification request to CSM
Messaging. COP does not send APNs pushes directly and does not store APNs
tokens.

Runtime chain:

```text
SIM -> COP backend -> CSM Messaging -> APNs -> CSM Messenger iOS
SIM -> COP backend -> CSM Messaging -> Web Push service -> COP browser/PWA
```

## Ownership

CSM Messenger iOS:

- registers the device with CSM Messaging, including APNs token, locale,
  timezone and notification preferences;
- receives push notifications;
- opens deep links such as `csm://map/alert/<alertId>`,
  `csm://map/report/<reportId>`, `csm://chat/room/<roomId>` and
  `csm://message/<messageId>`;
- does not call SIM directly and does not decide map relevance.

CSM Messaging:

- owns device registry, APNs credentials, idempotency, audience expansion and
  delivery audit;
- receives notification intake from COP through server-to-server
  `POST /api/v1/notifications`;
- sends only minimized push payloads. E2E chat push payloads do not contain
  plaintext message content.

COP:

- reads SIM data server-side;
- evaluates user relevance using explicit audience, user watched areas and
  optional current location;
- submits notification metadata to CSM Messaging;
- keeps community report/media ACL on the report attachment metadata;
- never stores APNs tokens and never sends push directly to APNs.
- exposes a browser Web Push registration proxy for COP web/PWA clients, but
  does not own delivery state or provider credentials.

SIM:

- publishes safety/weather/flood/fire/mobile/traffic features and metadata;
- does not know users, devices or groups;
- does not send notifications.

## Safety Notification Evaluation

COP exposes an authenticated evaluation endpoint:

```http
POST /api/v1/notifications/safety/evaluate
Authorization: Bearer <COP user access token>
Content-Type: application/json
```

Example dry run:

```json
{
  "bbox": [11.8, 48.5, 19.2, 51.2],
  "layers": ["weather_alerts", "fire", "flood"],
  "dryRun": true,
  "currentLocation": {
    "lat": 50.075,
    "lon": 14.438,
    "radiusKm": 10
  }
}
```

`dryRun` defaults to `true`. With `dryRun=false`, COP dispatches eligible
decisions to CSM Messaging.

The endpoint is intended for server-side or operator-controlled evaluation,
not for a public client polling loop. A normal iOS user receives notification
delivery from CSM Messaging after COP has made the decision.

## Decision Rules

COP sends only citizen-relevant notifications:

- `weather_alerts`, `warnings`, `fire` and `flood` can become
  `safety.alert`;
- `boundary_admin` and other reference layers are never citizen safety push;
- stale features are never pushed;
- expired features are never pushed;
- `info` features are below push threshold;
- `warning` and `critical` features can be pushed when they have a concrete
  audience;
- technical SIM/COP warnings, cache errors, source degradation and health
  diagnostics are not citizen safety alerts.

Audience is resolved in this order:

1. explicit `audience.userIds`, `audience.groupIds` or `audience.areaIds`;
2. authenticated user's enabled watched areas from COP profile;
3. authenticated user's optional `currentLocation`.

No audience means no push request.

## Messaging Intake

For every eligible decision COP calls CSM Messaging server-side:

```http
POST /api/v1/notifications
Authorization: Bearer <COP_CSM_MESSAGING_TOKEN>
Idempotency-Key: sim.safety-data:public.safety.weather_alerts:<featureId>:<validFrom>:<validUntil>
Content-Type: application/json
```

Example body:

```json
{
  "type": "safety.alert",
  "severity": "warning",
  "priority": "time_sensitive",
  "audience": {
    "userIds": ["user-123"],
    "areaIds": ["watched-area-1"]
  },
  "title": {
    "cs": "Výstraha pro sledovanou oblast",
    "en": "Warning for watched area"
  },
  "body": {
    "cs": "Otevřete CSM pro aktuální detail výstrahy.",
    "en": "Open CSM for the current warning detail."
  },
  "source": {
    "providerId": "sim.safety-data",
    "layerId": "public.safety.weather_alerts",
    "featureId": "chmi-warning-123",
    "sourceName": "ČHMÚ CAP"
  },
  "expiresAt": "2026-05-29T18:00:00Z",
  "deepLink": "csm://map/alert/chmi-warning-123"
}
```

COP does not include APNs tokens, device identifiers, Matrix tokens, media URLs
or plaintext chat messages in notification intake.

For SIM safety-data features COP treats SIM normalized metadata as authoritative.
The notification title/body should prefer `localized.cs` and may use
`localized.en` for an English fallback. The notification metadata carries
`typeCode`, `sourceCode`, `sourceSystem`, `providerProperties.presentation.iconKey`
and `providerProperties.presentation.styleKey` when present. COP must not derive
the safety phenomenon from free text such as `headline`, `event` or legacy
`hazardType` when `typeCode`/taxonomy metadata is available. If
`providerProperties.notification.eligible=false`, COP must not dispatch a push
candidate for that feature, even when severity would otherwise meet the
threshold.

## Community Reports

When an owned community report is submitted, COP creates a
`community.report` notification decision. The report is dispatched only when:

- report status is `submitted` or `published`;
- report validity has not expired;
- report severity is `advisory`, `warning` or `critical`;
- a concrete audience exists through public visibility, explicit users or
  watched-area relevance.

The push text is intentionally minimal. It points users to the app and report
context but does not include protected media URLs. Media access remains governed
by attachment ACL and signed media tokens.

Community idempotency key:

```text
cop.community-report:<reportId>:<submittedAt-or-updatedAt>
```

Deep link:

```text
csm://map/report/<reportId>
```

## iOS Contract

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

The integrated chat uses the same Web Push registration helper as the main COP
map shell. Its notification bell must represent real server registration state:
browser support, `Notification.permission`, service-worker subscription and COP
web device id. After a successful browser registration, the chat restarts its
Matrix session so the Matrix pusher is bound to the current web device id.

For iOS/iPadOS PWA use, the chat must treat `pagehide`, `pageshow`,
`visibilitychange`, `focus` and `online` as lifecycle boundaries. When the app
returns from the background and Matrix sync is missing, stopped, errored or
stale, the client resets the local Matrix session and starts it again for the
currently selected chat. Matrix member profiles and avatars may be hydrated
from a short browser cache while the fresh Matrix profile lookup runs in the
background.

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
