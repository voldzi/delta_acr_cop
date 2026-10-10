# ADR 0046: account safety and coordinated account erasure

Status: proposed for coordinated acceptance; implementation candidate for reports
and canonical peer blocking only. Production activation is not approved.
Date: 2026-10-10.

## Decision

COP derives the actor from verified OIDC/BFF authentication. New public endpoints
are documented in JSON OpenAPI, return no-store and preserve the COP error
and correlation envelope. No actor, moderator role or Matrix credential is
chosen by the client. Reports are idempotent per issuer/subject and operation.
Only an explicitly selected/confirmed excerpt may cross the E2EE boundary.
Reports, identity and audit are encrypted with a dedicated evidence key; the key
has its own lifecycle and must not reuse the web session secret.

Matrix account data is the source of block state. There is no cached allow
result or a separate COP shadow list. COP gates new direct calls, accepts and
media refreshes; Messaging gates APNs/VoIP/WebPush. Matrix filters subsequent
non-state events and room invites. State events and other group members remain
unchanged. Old client history is handled explicitly by the host. No automatic
moderation keyword filter is introduced into crisis messages.

## Release boundary

The candidate has `accountDeletion=false`. It does not represent sign-out,
deactivation or HTTP 202 as account erasure. The human must determine whether
Jízda removes a shared COP identity or only Jízda data/access, and name a real
moderation owner/contact. Actual owner adapters, bounded revocation, own UGC
redaction/media removal, ownership choices and restore replay must then be
implemented and accepted. Account erasure is not currently a public API.

App Review 1.2 still requires an accepted filtering/moderation process and
published contact; a report queue or a passing build alone is insufficient.
App Review 5.1.1 requires actual deletion, including own shared UGC, with only
specific justified retention. Pending requirements are release gates, not
permissions to retain all shared records or invent legal retention periods.

## Risks and acceptance

A Matrix block is not remote deletion of content already copied by recipients.
An APNs notification already handed off cannot be recalled. Previously issued
LiveKit tokens and a running call require separate revocation/termination
acceptance; this candidate does not claim to revoke them. Distributed check and
delivery races must be tested before activation. Rollback after a real block or
delete must retain enforcement and revocation state; disabling all guards would
break the promise made to users.

Prepared endpoints are excluded from the closed MCP tool list and are marked
`x-cop-ai-exposure=forbidden`. Report excerpts are never implicit AI context.
The production chat/SIM AI Router flags are not changed by this candidate.
