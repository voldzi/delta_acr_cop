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
- keeps community report/media ACL in COP groups;
- never stores APNs tokens and never sends push directly to APNs.

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

## Community Reports

When an owned community report is submitted, COP creates a
`community.report` notification decision. The report is dispatched only when:

- report status is `submitted` or `published`;
- report validity has not expired;
- report severity is `advisory`, `warning` or `critical`;
- a concrete audience exists, typically the COP group attached to the report.

The push text is intentionally minimal. It points users to the app and group
context but does not include protected media URLs. Media access remains governed
by COP group ACL and signed media tokens.

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

## Security Rules

- COP never sends push directly to APNs.
- COP never stores APNs device tokens.
- COP never passes CSM Messaging service token to browser or iOS clients.
- COP never proxies plaintext Matrix/E2EE messages.
- SIM remains server-to-server and is not called directly by mobile clients.
- Delivery audit belongs to CSM Messaging. COP audit records only decision and
  dispatch metadata.
