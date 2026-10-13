# ADR 0050: account safety and coordinated account erasure

Status: source integration prepared for coordinated acceptance; no production
activation. Preserves existing ADR 0046 service credentials and its controls.
Date: 2026-10-13. Original candidate: 2026-10-11, immutable COP `6b6d80ce`.

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

The human selected Jízda-only unlink and the COP administrator as moderation
owner on 11 October. A separately confirmed whole-account management/removal
function does not expand unlink. `accountDeletion=false`, deletion URL null;
there is no real completed erasure flow yet. See integration plans 41 and 42.

The current host decision is one existing `csm-mobile` account and one login
entry in Já, with the published SDK's `explicit_host_consent` activation policy.
Local disable preserves authentication, E2EE history and SwiftData and must not
be described as server revocation. Dedicated Jízda OAuth provisioning is not
authorized; the old disabled unlink source is historical compatibility only.
Future common-client installation revocation needs an accepted key-bound PoP
grant and provider readback. Raw bundle/header, IDFV or UUID is not authority.
Unknown legacy/Matrix/live cleanup stays pending; 202 is not completion. Other
apps/accounts/shared records remain protected. No global logout/delete occurs.

Reporting uses the proposed dedicated cop_communication_moderator realm role
assigned to the actual COP administrator team after approval. The human approved
public contact podpora@zeleznalady.cz and the retention policy below. The actual
moderation/filter operating process and evidence-key lifecycle still need
acceptance. The SDK rejects invalid evidence on decode and again before HTTP;
target one-of/length/UUID checks are also performed before transport.

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

## Source completion, 11 October

A separate whole-account workflow now has durable HMAC fence/checkpoints and
AES-GCM sealed minimal principal for trusted worker recovery without OAuth
credentials. Signed auth_time within300seconds is required; refreshed iat is
not reauthentication. Actual session/profile storage enforces issuer-bound late
write fences, verified in isolated PostgreSQL. All11 provider-domain proofs
are still required; production capability remains false.

The historical dedicated-client proposal and its no-cache link mechanism are
archived. Current SDK `5b346c5` separates authentication/routing from optional
producers with account/epoch checks and local host consent. Its protected
cleanup material does not establish server grant revocation. Messaging source
can record immutable app/device ownership, but its old dedicated-client path
is not provisioned here. Common-client PoP grants and unknown legacy ownership
remain open. Intake flags must not disable accepted fences.

The human approved evidence retention max90days from creation and max30days
after first closure, audit withouttext180days and block until unblock/deletion.
Exact implementation policy: cop-communication-retention-90d-30d-180d-v1. Public
contact is podpora@zeleznalady.cz; neither approval activates production flags.
LiveKit shared identity and self-hosted token rejoin behavior remain explicit
revocation blockers, as documented in integration43.

Communication safety maintenance/enforcement is independent of new intake.
Disabling intake preserves retention and accepted blocks, own receipts, retries
and unblock; new report/blocking is unavailable. Durable policy/key fingerprint
and accepted-state startup checks prevent configuration rollback from silently
turning these obligations off.
