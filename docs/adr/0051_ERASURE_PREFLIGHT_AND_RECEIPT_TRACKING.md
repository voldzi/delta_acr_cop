# ADR 0051: Actor-specific erasure preflight and independent receipt tracking

Status: source candidate; production activation blocked. Date: 2026-10-13.

## Decision

A full-account deletion requires a fresh verified actor, a read-only assessment
of every actual domain and an unexpired server plan before the permanent fence.
The strict v1 confirmation body and receipt body remain unchanged. New preflight
and capability receipt routes are additive. Custom adapters without actor-specific
preflight cannot advertise deletion readiness. Unknown ownership and required
choices block acceptance; they are never guessed from decoded historical JWTs.

A positive preflight issues a random 256-bit read capability before confirmation,
only as a Secure/HttpOnly/SameSite=Strict scoped cookie and a redacted native
header. Only its HMAC hash and opaque operation binding are stored. It appears in
neither JSON, URLs, logs nor analytics. Initial confirmation requires possession
of that capability together with the current server plan and fresh OIDC actor.

BFF guard outages preserve the healthy server session/cookie and return a
correlation-aware 503. Only a confirmed account fence revokes that session.
After a successful refresh, signature-verified tokens must have the same issuer
and subject as the existing session. The store atomically checks ownership and
fences and updates only an existing row before the guard probe, so a guard 503
does not discard a rotated refresh token or recreate a purged session. Ordinary
API access remains closed until the guard succeeds. Authorization callbacks
check the guard before creating a session: a guard 503 preserves any existing
session, consumes the one-use transaction and requires a fresh interactive
sign-in attempt after recovery; it is not converted into a login rejection.

Only the exact GET `/api/v1/me/account-deletion/receipts/<UUID>` authenticates the
capability independently of BFF/OIDC. It returns the unchanged content-free v1
receipt and grants no account, retry or deletion authority. A deleted/fenced BFF
session therefore cannot prevent this read. Legacy actor-authenticated read and
existing own idempotent retry retain their behavior.

Technical validity is 300 seconds for a plan and 30 days for a read capability;
neither is a personal-data retention policy. Expired unconfirmed plans and their
capability hashes are removed by the worker. Accepted expired capability hashes
are also removed. No principal copy is added to preflight. The existing single
sealed worker principal is removed after every required domain proof completes.
Long-pending principal handling and retained audit/tombstone policy require
explicit owner acceptance before production activation.

Repeated preflight replaces the previous unconfirmed plan and invalidates its
capability. Ownership changes detected by the later actual cleanup readback
remain pending; no legacy provenance is inferred or adopted.

The identity adapter is last and cannot run while any other durable checkpoint
is incomplete. Intake OFF prohibits new plans but does not stop accepted worker
jobs or their permanent fences. Fair selection uses last-attempt time, including
failed attempts, instead of always taking the same key-prefix jobs. A timeout
bounds waiting, not a provider ignoring cancellation; each actual adapter must
prove operation-id idempotence and late-completion safety.

## Stable guard and rollback

Guard loading is independent of the mobility intake flag. Existing mobility
uses its original store/pools; a guard-only loader has one registered pool with
max=1 and no Dispatch lease. This alternate future profile needs an explicit
pool-budget review; it is not evidence for the current production main=53 pair.

Activation requires a pre-provisioned durable `account-safety:store-identity-v1`,
matching protected runtime store ID, issuer/key configuration and supported
`account-safety-guard-v1` infrastructure attestation. The application never
adopts an empty replacement DB by writing the expected store identity. Guard
configuration removal, secret/issuer changes and unsupported stored versions
fail closed when the required store is consulted.

The current native helper `49ca96be...` does not validate this new binding.
Application environment labels alone do not prove a trusted runtime attestation,
nor can this source detect deletion of all configuration or an arbitrary old
image. The required protected binding and old-image rejection are a separate
infrastructure activation blocker. See the proposal in
[runbook 25](../runbooks/25_ACCOUNT_SAFETY_GUARD_BINDING_PROPOSAL.md).

No production secrets, SQL permissions, actual accounts, provider credentials
or environment flags are changed. Ten real owner adapters are still absent.
Source tests, production deployment and physical client acceptance are separate.

## Source verification

165 controlled/regression tests passed; four opt-in real PostgreSQL tests were
skipped. Typecheck, binding JSON OpenAPI (24 pre-existing warnings), generated
YAML, JSON schemas, scoped ESLint, skeleton and diff checks passed. The final gate includes
account/preflight/capability/late-reply/worker tests plus actual BFF outage,
security/JWKS/service-auth, web sessions, guard-only pool and mobility-off
retention regression. A real local loopback HTTP OIDC fixture verifies expired
token refresh, preserved rotation during 503 and subsequent recovery, changed
issuer/subject rejection, purge during refresh, confirmed fence and callback
503. It uses only synthetic credentials; no live provider, database or
production test was run.
