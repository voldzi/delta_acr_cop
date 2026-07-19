# ADR-0015: Matrix VoIP ICE Resilience

## Status

Superseded by ADR-0019

## Context

Matrix call signalling can complete even when no WebRTC media path exists. In
the pilot deployment, clients exchanged `m.call.invite`, `m.call.answer` and ICE
candidates successfully, but the public TURN listener was unreachable through
the upstream NAT. Both clients consequently produced only host candidates and
`matrix-js-sdk` repeated ICE restarts without a terminal deadline.

## Decision

COP Chat appends an operations-configurable STUN fallback to the ICE servers
returned by Matrix. The pilot default is `stun:stun.l.google.com:19302`; set
`COP_CHAT_ICE_FALLBACK_URLS=none` to disable it or provide a comma-separated
replacement. This can establish a direct peer path when NAT traversal permits,
but it does not replace a reachable TURN relay.

A call that remains in the connecting phase for 45 seconds is ended with an
explicit ICE/TURN error instead of restarting forever. The encrypted signalling
preflight is bounded independently of a stalled Matrix send, and the answering
device performs the same check before its asynchronously generated answer is
sent.

## Consequences

- Calls can use a server-reflexive direct path while the self-hosted relay is
  temporarily unavailable.
- The configured STUN operator can observe a client's public IP and STUN binding
  traffic. It cannot decrypt Matrix signalling or DTLS-SRTP call media.
- Restrictive or symmetric NAT still requires working TURN. Production must
  publish TURN UDP/TCP 3478 and the configured relay range end to end.
- Failed calls now terminate predictably and surface an actionable error.

## Alternatives Considered

- Infinite ICE restart was rejected because it leaves both users in a false
  connecting state.
- A third-party public TURN relay was rejected because it would require external
  credentials and route encrypted media through an unmanaged provider.
- STUN-only operation was rejected as the primary design because it cannot
  traverse every NAT policy.
