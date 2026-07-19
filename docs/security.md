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

Voice-call rule: COP API authorizes a call only for a canonical direct
conversation containing the authenticated actor and exactly one other active
member. The durable call record and revision are authoritative. Clients cannot
choose an arbitrary recipient, transition another user's call or reuse a
credential for a different call.

LiveKit credentials are issued server-side, expire quickly and grant join,
publish and subscribe only in `cop-call-<callId>`. The LiveKit API secret,
PushKit tokens, Matrix credentials and chat content never enter the call
record. CSM Messaging receives only bounded lifecycle metadata for incoming,
ended and missed notifications.

CallKit actions map to revision-checked COP API transitions. After foreground
restore, clients fetch the server record rather than trusting local UI state.
There is no hidden web media process or Matrix VoIP compatibility path in COP
Mobile. Group calls and arbitrary participant invitations are not supported.
See ADR-0019.

Matrix credential renewal for the same user and device updates only the active
client access token. It does not recreate or clear the Rust crypto store. Full
session replacement is generation-guarded and limited to identity/device change,
logout or explicit account-store recovery as recorded in ADR-0014.

A targeted browser-device repair rotates only that browser's Matrix device id
and creates a separate Rust crypto store. It preserves the previous store and
does not reset account-wide recovery metadata or other devices. The sealed
recovery key remains scoped to Matrix user and homeserver; direct database
deletion of Matrix one-time/fallback keys is not an approved repair path.

The LiveKit deployment can observe call membership, timing, IP addressing and
encrypted media transport metadata. It receives no Matrix room keys or chat
content. Its public WSS and media ports, API keys and retention policy belong to
the audited production infrastructure boundary.
