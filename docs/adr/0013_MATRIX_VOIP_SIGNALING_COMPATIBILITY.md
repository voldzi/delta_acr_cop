# ADR-0013: Matrix VoIP Signaling Compatibility

## Status

Superseded by ADR-0019

## Context

COP uses `matrix-js-sdk` legacy one-to-one WebRTC calls in encrypted direct
rooms. With the Rust crypto backend, some web/PWA device combinations can send
an encrypted `m.call.*` event that the peer cannot decrypt. The Matrix call
handler then never sees the clear event type, the call does not connect, and the
timeline exposes repeated undecryptable-event diagnostics.

An earlier unconditional plaintext signaling bypass made calls operational but
also exposed SDP and ICE signaling metadata to the self-hosted homeserver even
when both active clients could use room E2EE.

## Decision

Before starting a call, COP discards the current outbound Megolm session and
sends an encrypted, metadata-only preflight event. A peer that decrypts it sends
an encrypted acknowledgement. COP keeps all `m.call.*` signaling on the Matrix
SDK E2EE path when that acknowledgement arrives.

If no peer acknowledgement arrives within 1.2 seconds, COP sends only the
events for that call id through the authenticated HTTPS Matrix room-event API.
This compatibility path is scoped to `m.call.*` and `org.matrix.call.*` events.
Chat messages, attachments, locations and recovery material remain E2EE. WebRTC
media remains protected by DTLS-SRTP and never traverses COP API or CSM
Messaging.

The failed encrypted preflight and acknowledgement can otherwise appear as
undecryptable chat bubbles before the plaintext compatibility events arrive.
COP suppresses only undecrypted events from the same sender that immediately
precede a visible Matrix call-control event within a bounded five-second
correlation window. Undecryptable events outside that call window remain
visible so an actual missing user message is not silently hidden.

## Consequences

- Active compatible peers retain end-to-end encrypted call signaling.
- A suspended PWA or a peer with broken room-key delivery can still receive and
  answer a call.
- In compatibility mode, the self-hosted Synapse service can observe call
  control metadata, SDP and ICE candidates. It still cannot decrypt WebRTC
  media or chat content.
- The timeline collapses ordinary short runs of undecryptable events and does
  not expose correlated VoIP preflight artifacts as user messages.

## Alternatives Considered

- Unconditional plaintext signaling was rejected because it weakens metadata
  confidentiality even when E2EE works.
- Blocking every call until manual recovery was rejected because key backup is
  for history recovery and does not reliably repair live legacy VoIP signaling.
- Matrix encrypted to-device calling is not used because the installed Rust
  crypto integration reports that path as unimplemented.

## Follow-up Actions

- Replace the compatibility path when a production-ready MatrixRTC or encrypted
  to-device one-to-one calling implementation is available.
- Add call-signaling mode telemetry that contains no SDP, ICE, room key or
  message content.
