# ADR 0054 — Independent pseudonymous erasure journal

Status: implemented source and isolated tests; production enrollment and complete
owner composition are not accepted. Date: 2026-10-15.

The production completion candidate now uses the explicit database alternative
in [ADR0055](0055_DATABASE_ACCOUNT_ERASURE_RECOVERY.md). The native mode below is
preserved but is not the implementation path for that candidate.

## Decision

Commit the independent Root journal before committing a new local COP fence.
Keep that local fence in the actual `cop_mobility_v1` transaction used by domain
writers. Never use the independent metadata database as the application store.

Root durably signs and fsyncs an immutable manifest before inserting its digest
reference into `cop_guard.fence_journal`. Publication requires outer COMMIT and
a fresh locked readback. Lost acknowledgement remains unresolved until that
original journal operation is observed; no replacement operation is minted.

The permanent manifest contains only the application store UUID, configuration
fingerprint, account MAC, operation UUID, original request time and mandatory
owner list. **It contains no recoverable principal, including no
`sealedPrincipal`.** The MAC and technical linkage are pseudonymous security
records, not anonymized data. This ADR introduces no automatic expiry policy.

Replay installs missing local jobs/fences before admitting account operations.
It preserves completed local checkpoints and rejects conflicts, foreign store
or configuration, duplicate accounts and local jobs absent from the independent
journal. Configuration version4 cannot silently open under the legacy version3
path. Migration of existing configuration requires an explicit verified step.

If a pending local job and its sealed principal are lost, replay restores the
fence and a pending job. A background worker cannot guess its identity. Recovery
may attach a new locally encrypted principal only from a fresh verified actor
whose account MAC matches that exact original operation. A restore with no such
actor needs independently verified owner inventory/replay before exposure; it
cannot be declared complete. Existing sealed principals stay only in the local
pending job and are removed when all mandatory owners complete.

## Current authority and transport

The fixed private native channel authenticates each message using kernel pidfs
identity and Root-controlled verification material. The application does not
choose a socket, credential, SQL, Root UUID or verifier. Each signed reply binds
its request digest, store/configuration, guard and continuity epoch. Snapshot
pages must share one frontier. A current assertion expires within five seconds;
the synchronous RAM barrier also expires and cannot remain available indefinitely
when Root is unavailable. The accepted runtime must be a single writer.

Root validates the journal chain and protected anchor against actual database
cluster/timeline and machine boot. A rollback, fork, missing manifest, changed
signature, unknown boot or unavailable metadata denies admission. It does not
silently re-enroll or reset the frontier. Unchanged ordinary assertions read the
head rather than scanning all manifests and refresh the signed anchor at most
once per approximately20seconds, rather than fsyncing on every account request.

The driver read client separately verifies the actual signed SIM admission and
its request, checkpoint, policy, facts, runtime and process bindings. Root reads
the internal delivery/permit from private files; ordinary HTTP cannot select a
Root permit. A no-argument native `selfIdentity()` allows an unprivileged client
to check its own pidfs identity; arbitrary-process inspection remains Root-only.
UID values are authenticated in Root's namespace, not compared across namespaces.

## Activation and recovery

`COP_ACCOUNT_ERASURE_ENABLED=true` or retained
`COP_ACCOUNT_SAFETY_GUARD_REQUIRED=true` loads the fixed protected implementation;
absence fails closed. Turning new intake off does not remove an accepted guard.
No direct provider fallback or legacy DML fallback is introduced.

This journal alone does not establish current provider ownership, an owner-wide
drain, target replay/publication, backup completion or safe image rollback.
Actual Root enrollment, per-request operation/retention delivery, the remaining
owner entry points and the native deployment latch must all be composed and
accepted before production activation. Tests use synthetic enrollment/accounts;
they do not authorize a real account deletion or claim production readiness.

## Evidence

- COP controller/HTTP regression:54cases across five files, including six new
  continuity cases; synthetic owners, real loopback authentication boundary.
- Independent journal:8cases with actual Linux Root files, Ed25519 and
  PostgreSQL18.6 narrow roles; synthetic enrollment, no native transport.
- Native muslNode24.20:7kernel cases,4original-operation client cases,
  3driver-read client cases and4COP-continuity client cases. SQL facts in these
  channel tests are synthetic; no production/cross-host acceptance is inferred.
- Codec/consumer cases use actual signatures but synthetic facts. Counts overlap
  prior suites and must not be added to historical full-suite results.
