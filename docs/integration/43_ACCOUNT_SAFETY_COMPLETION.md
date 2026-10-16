# 43. Whole COP account removal — current completion evidence

## Current status — 16 October 2026

The simplified `database_v2` implementation is under actual joint acceptance.
Production account-deletion intake remains disabled. No production account has
been deleted for testing. Deployment is authorized, but a whole-provider and
restore acceptance result has not yet been obtained.

The first actual case used two synthetic Keycloak accounts, actual
PostgreSQL/PostGIS, SIM measurement and Router services, Messaging/Synapse,
LiveKit, SeaweedFS4.45 and COP Edge. All eleven owners passed capability and actor
preflight. Genuine Keycloak authorization-code login supplied fresh signed
`auth_time`; a password-grant token without it was rejected.

That case is now a **negative acceptance case**. One original operation was
persisted with its original sealed principal and request time; its initial
confirmation did not return202. Eight owners completed actual cleanup. Matrix
retained explicitly unreviewed presence/device-stream rows and unsupported
state payloads under its original immutable scope. Voice was also blocked by a
completion-receipt dependency in the relay. No positive whole result is inferred
from these partial proofs or from token expiry.

A controlled crash terminated only the exact test Node PID/start/source after a
private checkpoint. Actual database connections closed; the independent journal,
original operation/date and eight completed owner checkpoints survived. A fresh
B Keycloak login/userinfo succeeded. A new complete B data fingerprint and restore
acceptance were not obtained. See [the negative receipt](../testing/account-erasure-whole-negative-20261016.json).

Before that confirmation, five actual business databases were dumped and their
checksums/archive catalogs verified; the independent journal was excluded.
Those snapshots are evidence for the failed case, not a completed restore test.
A separate namespace and two new real synthetic Keycloak identities are prepared
for the new reviewed full scope. Its actual SIM Driver and Router capabilities
return200/ready, and29 real HTTP isolation/readback checks passed. Messaging full-v2 assembled successfully with the reviewed separate contract;
its actual native preflight returned200/ready. The old operation/scope was not
relabeled or reseeded.

The new case's first actual COP confirmation returned503, not202. The original
operation, sealed principal, request time and five fresh pre-deletion database
snapshots were preserved. Six owners completed; the Matrix owner remains
pending. Actual provider readback returned202/pending with26 unclassified
stream-cache records:24 native cache records need exact typed classification,
and two credential invalidations lack established current ownership. These are
two distinct issues; adding cache names alone cannot establish credential
ownership. User B's pre-deletion business fingerprint remains unchanged. No
controlled crash, whole completion or joint restore has yet passed for this new
case. The failed first confirmation remains in [the separate negative receipt](../testing/account-erasure-whole-full-v2-negative-20261016.json).

## Remaining novice-account boundary

Source review also found that COP login does not guarantee a Matrix mapping.
The current identity-based preflight can therefore reject an account which has
never opened chat. A missing mapping also occurs after data loss, so neither a
current login nor a provider404 is proof of non-use. Ordinary provisioning uses
an administrative PUT that can reset a password/reactivate a native account;
it must not be used as a deletion fallback.

The coordinated candidate adds a closed initial namespace inventory and an
independent first-use ledger before native identity effects. Only proven
never-used accounts may follow a create-only preparation; previously used or
reserved accounts with a missing mapping stay pending. This candidate and its
novice/restore/concurrency acceptance remain unfinished. The two fully seeded
negative cases do not establish coverage for novice accounts.

## Preserving first-contact chat during the guard migration

The first-use guard also covers normal peer provisioning. Existing callers send
peer identifiers; those identifiers do not attest another person's issuer.
Replacing that flow with existing-mapping-only lookup would prevent contacting
a COP account which had not yet initialized chat.

The coordinated source fix adds the private `cop-verified-peer-bindings-v1`
packet to the existing COP-to-Messaging transport in `database_v2` only. COP
uses only the ready canonical PostgreSQL profile, exact target subject and
signature-verified or explicitly enrolled issuer. It never uses the RAM fallback,
a browser-supplied packet, or the caller's issuer as evidence for a target.
Packets contain the actor binding, source, thirty-second validity and verified
peer subject/issuer pairs; no message content, display name or credential.
Messaging must validate the authenticated server transport, finite packet shape,
actor, target set and time before the first-use reservation/native create-only
path. Unknown peers remain unavailable; existing verified identities can still
be used. `native_v1` retains its current payload and behavior. This private
packet is neither a new public endpoint nor a new browser request field.

This component and its actual first-contact regression test must pass before
the final whole fixture and production activation. The previous `4618cf3` runtime
closure does not include this subsequent fix and will not be relabeled. The
subsequent full COP test run passed2526 tests (105 opt-in tests skipped); all16
projects built. The separate canonical Messaging test run passed228 tests with35
explicitly skipped. These results still do not establish whole acceptance.

## Implemented boundaries

- The API entrypoint binds actual database continuity, media settlement and the
  backup/restore owner. Missing original identity stays pending; there is no
  journal-based identity reconstruction.
- Content admission locks cover the actual global fence. Every configured
  persistent and RAM fallback store contributes its own proof. Unknown ownership
  and uncontrolled consumers prevent completion.
- Configured Edge copies remain required even if a restored registry omits the
  Edge row. The authenticated endpoint persists writer fences and verifies exact
  account, operation, dataset and monotonic resource manifests.
- An unconfigured moderation service is ready only for an actually empty
  namespace, with the same transaction impact check used by confirmation.
- Actual LiveKit testing found a sixty-second validation leeway. The candidate
  waits until every issued grant expires plus ninety seconds, and verifies real
  provider rejection. The whole fixture uses the actual one-hour grant lifetime.
- All three content-store factories explicitly disable TLS when configured off.
  This prevents an ambient `PGSSLMODE` or differing connection binding from
  making nested admission borrow a different transport. TLS verification remains
  enabled when configured on.
- A Root-owned release proof binds the exact old container, target image/source,
  profile, configuration and environment custody. Only the approved24-key
  transition is permitted. Pausing new intake retains the guarded image.

## Executed checks

| Check | Observed result | Limit |
| --- | --- | --- |
| COP unit/regression suite |2526 passed across246 files;105 skipped in25 files | Opt-in database/provider cases are not counted as executed. |
| Full type check, ESLint, skeleton,11 JSON schemas, public analytics guards | Passed after the current runtime fixes | Final release checks must include any subsequent installer changes. |
| Production build | Passed for all16 projects; current API closure frozen | Final immutable release build remains required. |
| Binding OpenAPI | Valid;24 existing warnings, no new warnings | Does not establish provider readiness. |
| Backup owner, actual PostgreSQL dump/restore |5 scenarios passed | Component acceptance, not the joint five-database restore. |
| Media settlement |7 actual PostgreSQL cases and23 storage regressions passed | Production drain/rotation has not run. |
| Actual old API pause + exact Seaweed restart/rotation | Passed; old API returned healthy, old credential403, new credential works, other identity preserved | Isolated provider and API only. |
| Actual LiveKit token expiry | Rejection observed after the real provider leeway | Whole operation still waits its full issued lifetime. |
| Edge implementation |29 component tests passed | Guarded production Edge not deployed. |
| Runtime configuration gate |72 offline faults and2 Compose-client tests passed | Root production proof still required. |
| Narrow business schema preparation |12 actual PostgreSQL cases passed | No production DDL or ownership backfill performed. |
| Legacy provenance and original signed BFF sessions |69 component checks passed, including actual PostgreSQL and production AES/HMAC interoperability | Production historical evidence and enrollment remain pending. |
| Read-only owner readiness |42 focused controller/route checks and4 aggregate-cache checks passed | Does not enable deletion intake. |

## Production observations and remaining gates

Read-only production checks found healthy COP and a real Edge cache. Existing
content, profiles, devices and voice records predate issuer/ownership ledgers.
They must receive a separately reviewed historical provenance enrollment before
whole-deletion readiness can be claimed. Current login, a matching username or
current Keycloak membership is insufficient. No legacy data has been relabeled
or removed by this work.

The production media-write lease and runtime-owner fence tables are absent. A
narrow first-enrollment helper creates only the reviewed tables/indexes and
verifies their catalog/ownership/locks. It performs no legacy backfill, grants,
application startup or data deletion. Unknown active leases remain pending.

The final sequence is:

1. Finish the reviewed provider credential lifecycle and novice-account boundary, then complete the separate new
   two-user operation, actual same-generation provider restart, B preservation
   and isolated restore/quarantine/replay acceptance.
2. Finish the concrete legacy provenance review and exact release inputs;
   publish the verified source revisions and compare the tested runtime closure
   with the immutable candidate image.
3. Execute the reviewed Root preparation, including approved Keycloak worker,
   database enrollment and the coordinated COP writer pause/Seaweed restart with
   rotation of only the COP credential. Secrets stay in production secret files.
4. Deploy guarded Edge and API with intake disabled, verify actual production
   bindings, then enable intake only after all required owners pass.
5. Verify the Jízda physical-device flow separately. A build or server fixture
   does not replace that acceptance.

The separate full-v2 Synapse contract and same-generation recovery changes
currently have only source and isolated-test authorization. Its production use requires explicit
approval after the concrete joint result is available. No automatic review
rejection has been bypassed through another actor, path or tool.

## Runbooks and evidence

- [Backup/restore and quarantine](../runbooks/26_ACCOUNT_ERASURE_BACKUP_RESTORE.md)
- [Exact runtime configuration transition](../runbooks/27_ACCOUNT_ERASURE_CONFIG_TRANSITION.md)
- [Final Root installation](../runbooks/28_ACCOUNT_ERASURE_ROOT_INSTALL.md)
- [COP Edge cleanup](../runbooks/29_COP_EDGE_ACCOUNT_ERASURE.md)
- [Whole two-user fixture](../runbooks/30_ACCOUNT_ERASURE_WHOLE_FIXTURE.md)
- [Current regression receipt](../testing/account-erasure-release-regression-20261016-r3.json)
- [Actual old API/media pause receipt](../testing/account-erasure-old-api-media-pause-20261016.json)
- [Actual LiveKit expiry receipt](../testing/account-erasure-livekit-token-expiry-20261016.json)
- [Superseded checkpoints and their original receipts](../archive/2026-10-16_ACCOUNT_SAFETY_COMPLETION_HISTORY.md)
