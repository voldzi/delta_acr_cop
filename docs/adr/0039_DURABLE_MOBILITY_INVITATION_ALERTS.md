# ADR0039: Durable metadata-only mobility invitation alerts

- Status: accepted
- Date:2026-10-05

Invitation creation and recipient-bound notification jobs commit atomically.
Snapshot already-known verified recipients; never enumerate unknown email or
retrospectively push after registration. Ordinary APNs uses existing system.account
and a versioned link, fixed generic text and provider idempotency. SDK fetches
fresh account/inbox before explicit-tap navigation and checks session scope again.
A push is neither acceptance nor GPS permission. Queued receipt remains unchanged;
intake/device delivery are separate evidence. No new network or secrets.
COP and Messaging ticket validators use the same fixed two-bundle allowlist.
