# ADR-0016: Native-First Matrix Group Voice Calls

## Status

Superseded by ADR-0019

## Context

COP Mobile needs a FaceTime-like flow in which a user can start a voice call
from a group conversation and invite further members while the call is already
running. The web messaging runtime already owns Matrix encryption, signalling
and WebRTC media, while the native iOS layer owns CallKit and the active-call
presentation. Moving SDP, ICE candidates or Matrix credentials across the
Device Bridge would create a second media owner and enlarge the trusted surface.

The pinned Matrix JavaScript SDK provides the legacy encrypted `GroupCall`
media implementation. Its newer MatrixRTC API manages membership but does not
itself provide media transport in this client architecture.

## Decision

- Direct calls keep the existing one-to-one Matrix VoIP path.
- Group conversations use Matrix `GroupCall` with type `m.voice`, intent
  `m.ring` and the SDK's end-to-end encrypted peer mesh.
- A group call is limited to six connected participants. The native call view
  may progressively invite at most five other active room members.
- COP API remains a metadata-only wake service. An optional
  `participantUserIds` subset is accepted only for `action=invite`, is bounded
  to five unique values and is checked against the authenticated actor's
  accessible conversation before CSM Messaging is called.
- The native bridge transports only bounded presentation data and opaque
  actions (`start` and `addParticipants`). Matrix membership is authoritative;
  SDP, ICE, media, room keys and credentials never cross the bridge.
- Every targeted invitation has a recipient-aware idempotency key, allowing
  additional people to be invited later without replaying an earlier wake.

## Consequences

- The iOS UI can start and extend a group call while the established hidden web
  runtime continues to own encrypted media.
- A user outside the room cannot be selected by the client or injected into a
  wake request. A connected participant is not rung again.
- Peer-mesh bandwidth and CPU grow with participant count, so six participants
  is a deliberate pilot limit. Larger conferences require a separately
  reviewed SFU/MatrixRTC media architecture and a new ADR.
- TURN remains necessary for restrictive NAT. The relay sees encrypted
  DTLS-SRTP traffic but no plaintext media.

## Alternatives Considered

- Sending Matrix/WebRTC signalling through the native bridge was rejected
  because it duplicates media ownership and expands the secret-bearing surface.
- Unbounded peer mesh was rejected because mobile bandwidth and thermal cost
  become unpredictable.
- A new SFU was deferred because the current operational requirement is a small
  trusted team call and the existing Matrix SDK already supplies the required
  encrypted media path.
