# ADR-0014: Matrix Session Credential Renewal

## Status

Accepted

## Context

COP receives short-lived Matrix access tokens through the authenticated
messaging bootstrap. Replacing the complete `matrix-js-sdk` client whenever a
token was renewed stopped Rust crypto, active WebRTC calls and background
location sends. Work that still referenced the stopped client then failed with
`Cannot ensure Olm sessions: shutting down`.

OIDC refresh, Matrix token renewal and Matrix device replacement are different
lifecycle events. Treating all three as a new device also creates unnecessary
E2EE and call disruption.

## Decision

When homeserver, Matrix user, device id and E2EE policy are unchanged, COP
renews the Matrix access token in place through `MatrixClient.setAccessToken`.
The running sync loop, Rust crypto store and active call remain intact. Voice
call wake requests read the latest COP authentication token rather than the
token captured when the Matrix client started.

Session creation is single-flight and generation guarded. Explicit reset
invalidates an unfinished start, clears the published session before stopping
it and rejects a late result. A full client replacement remains permitted for
logout, identity/device changes and explicit account-store recovery.

Long-lived work such as live-location watches resolves the currently published
Matrix session for each send instead of retaining a session that may have been
replaced. Stopping a client is idempotent; final call hangup signaling uses the
existing authenticated HTTPS compatibility path before crypto shutdown.

## Consequences

- Ordinary OIDC and Matrix-token refresh no longer interrupts calls or E2EE.
- A stopped Matrix session is never left available through the public React
  state or session reference.
- Device rotation still causes a deliberate call/sync interruption and must be
  reserved for recovery or identity change.
- Frontend releases that change this lifecycle bump the PWA cache version so an
  installed web app receives the corrected runtime.
