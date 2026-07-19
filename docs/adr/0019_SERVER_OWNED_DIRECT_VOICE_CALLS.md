# ADR-0019: Server-Owned Direct Voice Calls

## Status

Accepted

## Context

The earlier call implementation split one user-visible call among Matrix VoIP,
an off-screen browser runtime, a Swift bridge, CallKit and CSM notification
wakes. Each component maintained its own phase and timeout. A recipient could
therefore ring without a media session, one client could report a connected call
while the peer remained on “Spojuji”, and a failed bridge could expose the web
chat inside COP Mobile.

COP Mobile is a new standalone application. It does not need to preserve the
former Matrix VoIP or group-call behavior.

## Decision

- COP API owns the single durable call record, revision and legal state
  transitions.
- Calls are available only in a canonical direct conversation with exactly one
  other active member.
- Clients create, list, read and transition calls through
  `/api/v1/messaging/calls`.
- LiveKit is the only media plane. COP API issues short-lived, call-scoped
  credentials; it never proxies audio.
- CSM Messaging carries only incoming, ended and missed call notifications.
  COP Mobile registers a PushKit token and presents incoming calls through
  CallKit.
- COP Mobile connects to LiveKit natively. It does not embed a web or Matrix
  media engine.
- COP Chat uses the same server state and LiveKit room as COP Mobile.
- Terminal server records are rendered as noninteractive call events in both
  timelines, including missed calls and connected-call duration.
- Call actions are idempotent revision-checked transitions. A client restores
  an active call after foregrounding by reading the server record and receiving
  fresh short-lived media credentials.

## Consequences

- One call id and one server phase are authoritative across web, iOS, push and
  CallKit.
- Matrix remains the encrypted message transport, but it is not part of call
  signaling or media.
- Direct calling no longer waits for Matrix sync, E2EE recovery or a hidden
  browser bridge.
- Group calling is intentionally unavailable. It requires a separate product
  and authorization design rather than a compatibility branch.
- Production calling is enabled only when LiveKit public WSS connectivity,
  credentials, CSM Messaging VoIP delivery and durable PostgreSQL call storage
  are all configured and verified.

## Superseded Decisions

This ADR supersedes ADR-0013, ADR-0015 and ADR-0016.
