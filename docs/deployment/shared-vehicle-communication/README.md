# Shared vehicle communication release

Updated4November2026. Source, image build, deployment and native acceptance are
separate states. This document does not authorize a configuration/identity change.

## Current production state

- COP is deployed and accepted on1338179f… / source00c854d, generation
  55190b1dc87f4bf59dec02d3396c41a3, release4daef7fb… . Zero restarts and no pending
  operation. HTTPS live/ready200, login302 to login.zeleznalady.cz, unauthenticated
  session/vehicle requests401. Actual AI index and completed erasure-owner
  readiness are ok. An earlier owner aggregate timed out as pending; it was not
  treated as a completed negative or relabeled as success.
- Messaging is healthy on e9c50077… / source50e590c after a manual return to
  the exact original protected configuration. Current CIDc20c4a64… has12
  historical restarts, retained explicitly; live/ready200 and stable same-process
  observation passed. Admission remains off. This is not zero-restart acceptance
  of the controller configuration.
- The first COP candidatee4a94bb3… / dd545c2 failed guarded cold startup. It is
  quarantined; its stage and all failed proof/health artifacts are preserved.
- COP vehicle conversation and Jízda gates remain off. No TestFlight publication,
  APNs/physical-phone or paired production acceptance is claimed.

The original image also initially failed cold startup before stabilizing. Guard
snapshot/local jobs/configuration/dataset and the separately approved normal
assertCurrent check passed. The captured startup error was in guarded AI index
warmup. The deployed repair makes this optional warmup asynchronous while
retaining every mandatory owner/fence initialization, publication check and
readiness dependency. It does not change provider/erasure decisions, financial
limits, Router model routing or external context. The empty index stays degraded
until a guarded refresh actually succeeds. One early retry is bounded; shutdown
prevents late retry scheduling. Arbitrary exception text is not logged.

## Limited application-owned releases

ADR0061 defines the installed Root-owned code-only broker. The application
executor can use only fixed status/prepare/activate commands without a password.
No general sudo, arbitrary path/image/environment argument or other-service
operation was added. A private request supplies a published source revision and
expected generation. Root freezes/verifies Git bytes, pins the existing Dockerfile
and Node24.22.2 base, verifies the dedicated X5 builder and runs actual image tests
plus database/X5/Sharp/runtime/health checks. Activation still requires a fresh
Root case, exact source process/CAS, full environment/topology parity and a target
with zero restarts. Configuration changes require a separate bounded decision.

Current status must match the accepted CID, have no pending operation, and report
actual healthy/running state; historical restart counts are exposed, not hidden.
The bad image is rejected before testing or activation. Actual-image acceptance
now requires all9 named test files, at least109 successes, no failures/pending,
and the unchanged compatibility probes. Root policy/source changes are not
performed by ordinary application releases.

The dedicated cop-x5 builder was recovered with its existing pinned definition
and X5 bind cache; no prune, global data-root change or shared builder change
occurred. X5 UUID/filesystem and own storage lock remain mandatory. Full build
contexts/artifacts live on X5; small protected operation cases remain Root-owned.

## Messaging evidence limitation

Docker save/load normalized its manifest ID from60a8959c… toe9c50077… . Both hosts
verified identical full Config and all4 RootFS layers. Only services.api.image
changed in the protected pin; original bytes and preflight are preserved.

The first raw HostConfig/Mounts comparison failed and the old raw object was not
retained. Do not claim complete historical raw parity. A supplemental observation
verified current environment, declared runtime security/identity, network IDs,
mount identities/read-only/propagation, peers and health. Legacy Binds does not
expose CreateMountpoint, so creation-time policy remains unproven. The user
approved only the exact existing csm-messaging_messaging-data volume(created
8July2026) without Compose labels; it was not changed, deleted or relabeled.
The observation explicitly keeps complete/raw parity false and is not paired
acceptance. Its Root receipt is in the original vehicle-image-release directory.

## Accepted evidence

Local9-file109-test set, actual-image109 tests,18 operator-boundary tests,
TypeScript API build, targeted ESLint and skeleton validation passed. The first
local HTTP fixture attempt hit environment EPERM on127.0.0.1; rerun with only
required test-loopback permission passed. No check was disabled to obtain success.
Source00c854d is published and is the deployed payload; later documentation
commits do not change that image identity. No real account was deleted.

The application executor completed the actual new-source build, prepare and
activate using the limited broker, without another password or infrastructure
handoff. The temporary attended Root terminal is closed; its socket/ready marker
are absent. The prior image/manual-return evidence and quarantined failed image
remain available. Final source/current-state metadata are in release.review.json.

## Next acceptance boundary

Keep both features disabled. Dedicated controller account creation and custody
are now proven, but its configuration cutover was not accepted. The two-key
change exposed guarded cold-start replay failure in AccountSafety; restoring
the same image/original inputs also initially failed before stabilizing. Read-only
diagnostics verified catalog/bindings/prefixes and later provider capability,
but did not establish the exact transient failure cause. No guard was weakened.
The unused passwordless controller is retained; source intents and managed
records were not removed. Original controller apply is consumed and cannot be
replayed. Resolve cold-start reliability before a fresh configuration-only case
and the separate general-admission/paired acceptance window with Jízda.
See [actual execution and recovery](controller-only-outcome.json). Never reuse an
administrator or cop.ai.agent as room controller. Verify exact ready/join-required,
revocation/kick/invite readback, pending202/exact retry/restart, wrong actor,
notification/native delivery denial and lifecycle cleanup. No real account is
needed for a destructive test. Do not infer phone/APNs acceptance from source
or server checks.

Before any enrollment, return requires actual proof of absent COP projections
and Messaging managed records, paused intake and a specifically approved bound
transition. After enrollment, contain by disabling admission while retaining
cleanup-capable writers and every durable pending intent; do not return to an
older writer or replace operation identities. No automatic rollback is installed.
The historical manual-return scripts are one-operation tools, not generic release
commands. Preserved evidence: /var/lib/cop-self-release/manual-return-20261104;
new completion permit and health observation are separately retained.

See release.review.json for exact image/source pins, the integration contract
at docs/integration/36_SHARED_VEHICLE_COMMUNICATION.md, and
[archived working notes](../../archive/2026-11-04_SHARED_VEHICLE_RELEASE_WORKING_NOTES.md).

Concrete next-step review: [controller identity, bounded configuration and acceptance](controller-review.md).
The review now contains the exact executor/bootstrap and32tests; execution proved account custody but failed runtime acceptance. Admission was never enabled. The actual outcome and original-config recovery are recorded separately.
