# ADR 0053: COP/Jizda erasure preserves shared identity and SIM

Status: human scope approved; source implementation and local verification;
production activation requires independent provider and restore acceptance.
Date: 2026-10-14.

## Decision

The human explicitly selected removal of COP/Jizda while preserving the shared
account and access to SIM. The scope is `cop_jizda_preserve_shared_identity_sim`.
It covers COP/Jizda data, grants and application access, including COP Mobile.
It excludes the realm identity, SIM profile, SIM/IZS keys and usage, SIM roles
and sessions.

The controller binds this scope to configuration version 3. It rejects older
configuration and does not reinterpret an old completed Keycloak deletion as a
scoped preservation proof. Migration of an existing guard needs an independently
reviewed history/restore plan; automatic adoption or reset is not provided.
Preflight and receipt add `deletionScope`. The new browser requires this exact
value before confirmation or completion. Existing native capabilities retain
false/null unless explicitly requesting `canonical-web-v1`.

Keycloak runs last, after actual nonidentity proofs and permanent COP access
revocation. It revokes only exact `cop-web`/`csm-mobile` consents/offline grants
and enumerated direct, noncomposite roles. Public client IDs and immutable UUIDs
have separate uses. It never deletes/disables the user, globally logs out SSO,
or mutates SIM, realm or group roles. Unknown generations and inherited roles
remain unresolved. Old COP tokens and later SIM SSO cannot bypass the COP fence
or silently recreate erased application data.

`COP_KEYCLOAK_COP_SCOPE_AUTHORITY_ACCEPTED` is new and defaults false. The old
identity-delete authority flag is not reused. Environment acceptance does not
prove limited provider rights. Current consent APIs can require manage-user
authority: actual FGAP/scoped-broker rights and provider tests remain gates.
This source change provisions no broader grants.

## Writer admission and copies

Content reassessment and first global fence share actual store admission locks.
Local mobility impact is compared in the exact durable transaction. The RAM
frontier advances synchronously after commit while admission remains held.
Its monotonic generation invalidates memoized checks. This single-writer cache
is not independent restore continuity or a replacement for persistent guards.

Actual RAM collections, SQL projections, queues, AI documents and worker copies
consult their bound controller/frontier. Ownership is an immutable private
witness, never a current login or JSON claim. Hydration suppresses ownership
promotion while retaining fence checks. Cleanup verifies absence and actual
asynchronous settlement. Abort, URL expiry, HTTP 202, missing rows and mock
receipts are not completion evidence.

Missing provider-cache, stream, Messaging, SIM, S3 upload-settlement or native
restore owners keep capability false. Restore replay includes completed erasures
and pending jobs before exposure. Independent continuity and guarded rollback
remain infrastructure gates.

## Verification

Tests cover scoped calls, identity/client generations, false acknowledgements,
A/B isolation, signed HTTP admission, real PostgreSQL projections, late writes,
private browser transport and pending receipts. Current results and release
status are in [integration 43](../integration/43_ACCOUNT_SAFETY_COMPLETION.md).

Fixture-preserved SIM roles/sessions do not prove production SIM access. Shared
login/refresh and a protected SIM endpoint require separately approved synthetic
account acceptance. No human account is deleted to test this policy.

Messaging whole-owner or targeted global fences are permitted only after a
native actor-specific witness proves the complete canonical namespace is
`cop_jizda_exclusive` (matrix, notifications, conversations, devices and
policy metadata). Shared or unknown bindings block before provider mutation.
The witness scopeVersion is pinned at the first durable fence and rechecked
through cleanup. A changed binding remains pending; scoped COP deletion cannot
be approximated by deactivating a shared SIM MXID.
