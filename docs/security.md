# Security

This is the standard security entry point for COP. Detailed security
documentation remains in:

- [Security index](security/00_INDEX.md)
- [Security architecture](security/01_SECURITY_ARCHITECTURE.md)
- [RBAC/ABAC](security/02_RBAC_ABAC.md)
- [Identity and access](security/03_IDENTITY_AND_ACCESS.md)
- [Source and device identity](security/04_SOURCE_AND_DEVICE_IDENTITY.md)
- [Audit](security/05_AUDIT.md)
- [MDM/MAM endpoint trust](security/06_MDM_MAM_ENDPOINT_TRUST.md)
- [Continuous ATO](security/07_CONTINUOUS_ATO.md)
- [Threat model](security/08_THREAT_MODEL.md)
- [Integration risk register](security/09_INTEGRATION_RISK_REGISTER.md)

Operational rule: do not commit secrets. `.env.example` contains placeholders
only; real secrets are configured outside the repository.

Client-side chat rule: COP Chat may keep a per-device, per-room last-known
readable Matrix timeline cache in browser storage so the PWA does not degrade
already displayed E2EE messages to undecryptable placeholders after restart or
sync refresh. This plaintext cache stays on the user's device/browser origin and
is not sent to COP API; Matrix access tokens, recovery keys and room keys remain
out of logs, commits and server-side COP storage.

Pending encrypted room events stay in the Matrix SDK timeline until decryption
succeeds. They are excluded from message bubbles, chat previews and local
readable-history storage so a crypto diagnostic is never attributed to a human
sender. An active device crypto session may send new E2EE messages while key
backup recovery is pending; the recovery warning remains visible because older
history may still be unavailable.

Voice-call rule: COP verifies the room-E2EE signaling path before a one-to-one
call. If the peer cannot acknowledge that preflight, only that call's Matrix
VoIP control events may use the authenticated HTTPS compatibility path described
in ADR-0013. Chat content remains E2EE and WebRTC media remains DTLS-SRTP.
Native CallKit commands use a bounded opaque `actionId` and an identity-bound
chat-to-host-to-native acknowledgement. Retries with the same action ID are
idempotent; a command is not acknowledged before its Matrix operation settles,
and a missing/negative acknowledgement fails the CallKit action instead of
pretending the call state changed.
The native host also invalidates and reloads the web media owner on that failure,
so an unacknowledged command cannot leave a hidden microphone track running.

Matrix credential renewal for the same user and device updates only the active
client access token. It does not recreate or clear the Rust crypto store. Full
session replacement is generation-guarded and limited to identity/device change,
logout or explicit account-store recovery as recorded in ADR-0014.

A targeted browser-device repair rotates only that browser's Matrix device id
and creates a separate Rust crypto store. It preserves the previous store and
does not reset account-wide recovery metadata or other devices. The sealed
recovery key remains scoped to Matrix user and homeserver; direct database
deletion of Matrix one-time/fallback keys is not an approved repair path.

Voice-call ICE discovery may contact the operations-configured STUN fallback
from ADR-0015. The STUN operator can observe the client's public IP and binding
traffic, but receives no Matrix room keys, chat content or DTLS-SRTP media.
