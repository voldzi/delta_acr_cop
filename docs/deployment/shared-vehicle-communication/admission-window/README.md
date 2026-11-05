# Admission-window preparation — not installed

The startup repair and the separate existing-controller configuration are
already deployed. This directory records preparation for the next functional
acceptance stage; it is not a deployment approval or evidence that vehicle
communication is available to users.

Both general admission flags remain off. The proposed flags are global: three
synthetic actors are the test budget, not a server-enforced allowlist. Jízda's
production gate also remains off. Do not describe this as an isolated pilot.

## Source and evidence

The files under `scripts/vehicle-admission/` are an **incomplete, uninstalled
proposal**. They include pure contracts and tests, a byte-exact constructor,
proposed guarded publisher/worker, COMM adapter, orchestration core, timer
renderer and deadline containment. A concrete reviewed installer, approval
loader and supervisor integration are still missing. No proposed entry point
may be installed or executed as Root on the strength of this document.

The constructor observation was produced against locally copied public bytes
of the exact installed guard and policy. It does not install either output.
It preserves ordinary broker source and configuration authority, changing only
the two guard hash references in the proposed policy. Source unit tests do not
prove real host execution, timer arming, a production switch or native behavior.

The production COP Compose lacks the flag mapping. A future explicitly reviewed
transition therefore needs the single flag in `.env` **and** its one exact
mapping line in `docker-compose.yml`. A value-only switch is insufficient.
No other environment value, image, role, key, network or mount is in scope.

Normal closing must preserve the same protected release checks. The proposed
independent timer starts closure 180 seconds before the hard deadline. Rendering
units is not arming a timer. Emergency containment can persist only this flag
as off and stop a positively identified owned COP intake; it is not successful
configuration acceptance, release repair or permission to stop cleanup writers.
Unknown pending state remains unproven and needs reconciliation. No old-image
fallback, erased-data restoration or durable-intent deletion is proposed.

## Remaining prerequisites

1. Complete, review and freeze the concrete host installation and supervisor;
   verify inherited storage locking, actual timer arming/readback and closure
   after failure. Do not weaken the ordinary healthy-source check.
2. Obtain three dedicated real test identities through the actual `csm-mobile`
   PKCE flow; invitation actors A/B need genuinely verified owned email
   addresses. No accounts have been created. The human question for addresses
   is pending. A service credential, a fixture UUID or a fabricated verification
   claim cannot substitute for these sessions.
3. Finish the complete paired coordinator, runtime evidence and notification
   handoff. Jízda has now frozen and built a dedicated host with a finite native
   stage executor; the sixteen source hashes, copied Swift source, built Info
   and successful build log were independently checked. The source remains
   uncommitted in Jízda's shared worktree. All thirteen live cases are still
   `not_run`. Its old loopback harness cannot be promoted into production
   evidence. An owned simulator is separately pending; do not reuse another
   application's simulator or the user's shared session.
4. Obtain approval of the exact complete one-window configuration capability
   only after these prerequisites are reviewable. The installed code-only
   broker still cannot change configuration.

Only then consider one bounded window: at most three test actors, one synthetic
vehicle and thirty minutes. Preserve separate results for the thirteen server,
native/core, notification and lifecycle cases. An expired token is not proof of
revocation; queueing is not actual notification delivery; unobserved cases fail
acceptance. Phone, APNs and TestFlight acceptance remain separate.

A read-only configuration check found both APNs and Web Push modes already
`live`. This does not establish a registered dedicated test recipient or a
correlated handoff from the actual Matrix push gateway. Neither was proven;
do not replace that evidence with the mode setting or a dry-run stub. The
production push configuration was not changed.

## Paired server steps

`scripts/vehicle-admission/server_steps.py` implements the bounded COP HTTP steps
for the proposed native spool protocol. This is a library, not a complete
thirteen-case coordinator or a command to run production tests. It has not
performed any live mutation. The still-missing coordinator supplies the actual
window observation and requests each lease from the sole native refresh owner.
It must not treat a fixture boolean or a callback as production authorization.

`Lease.from_spool` matches the exact outstanding `lease_cop_access` command
bytes, digest, run, sequence and command ID against the native result before
reading its fixed `private/access-<UPPERCASE UUID>.json` path. The owned private
directories must be mode0700 and the single-link lease file0400/0600. The lease
is for the fixed COP origin and issuer, actor A/B/C and at most60seconds within
the window. No refresh token is accepted. Refresh remains exclusively in the
native actor lifecycle. Neither leases nor private receipts belong in Git,
stdout, environment variables, arguments or the public report.

The driver creates at most one vehicle with the exact name
`Owned vehicle acceptance <UPPERCASE RUN UUID>`, validates the returned A owner
and operation, and writes the original receipt to `private/vehicle-created.json`.
Further read, invitation, acceptance, member-removal and vehicle-close steps use
only that returned vehicle. Only an invitation obtained for the corresponding
test actor can be accepted. Existing user vehicles are never selected.

Each POST has an exclusive, fsynced private intent before its single transport
attempt. An uncertain response, failed receipt or HTTP202 is preserved; there
is no automatic refresh/retry, second vehicle, fallback or claim of completed
native removal. Restart reconciliation and deliberate same-operation pending
replay must still be implemented/reviewed in the coordinator; an existing
attempt is refused here. TLS calls have a fixed origin, finite routes and no
redirect, cookie or proxy reuse. These boundary tests are offline; they do not
prove production TLS, notification delivery or any native case.

`native_pump.py` supplies the finite seventeen-action local IPC pump for the
frozen Jízda `SpoolClient`. It records the exact attempt before publication,
matches the native result, enforces the window during waiting and blocks further
commands after uncertainty, failure, timeout, checkpoint or finish. Checkpoint
resume deliberately still requires explicit process/cursor reconciliation; a
constructor does not silently adopt an existing spool. The pump exports only
selected structural observations and always keeps aggregate acceptance false.
It does not launch, install or control a simulator or create an account.

An offline interoperation check exercised the actual frozen Jízda Python
`SpoolClient`, COP pump, lease reader, journal and vehicle receipt handoff. Native
results and HTTP were explicitly stubs; no iOS or network code executed. See
[interop observation](spool-interop-observation.json) and
[native source review](native-source-review.json). The actual native SDK stage
execution, full thirteen-case orchestration, checkpoint process reconciliation,
public runtime/host flows and notification handoff remain unproven. A denied
normal SDK send is distinct from a direct Matrix HTTP send denial.

## Explicit native checkpoint resume

The separate native resume freeze `8d81f92e…` descends from the preserved
`8e9e8a2c…` snapshot. All18 new source hashes, the copied Swift source, built
host Info and successful build log were independently checked. The native
Python suite passed41tests independently. These files are still uncommitted in
the shared Jízda checkout; the old snapshot is not rewritten as new evidence.

`Pump.resume(checkpoint_command)` now reconciles this existing coordinator's
complete canonical intent/observation journal with the native immutable command
and result prefix. It invokes the frozen `SpoolClient.observe_resume` only after
its own prefix agrees. That helper requires matching checkpoint state, fixture,
launch lineage, no uncertain in-flight command, complete pause receipt, real
Mac `ESRCH` for the old PID, a live different new PID and a held runtime lock.
`EPERM` is not exit. A JSON boolean or supplied cursor cannot replace probes.

The pump checks the observed old PID against its own accepted process, rechecks
its journal after observation, records a private exclusive resume receipt and
retains its existing verified sequence. Future results must come from the
observed new process. It does not start/restart a host, adopt another coordinator
instance or accept resume after `finish`. An unproven observation leaves the
checkpoint blocking; uncertainty writing the resume receipt is a hard stop.
No process/launch receipt is exported in public observations.

The COP suite now passes84 source tests. A separate offline interoperation check
used the real frozen Python resume helper plus COP's own journal, with the
native producer and all process/lock probes **explicitly stubbed**. This proves
protocol agreement, not a real process restart, held native lock or iOS test.
See [resume source review](native-resume-source-review.json) and
[offline resume interoperation](resume-interop-observation.json). Real checkpoint
restart acceptance, complete case coordination and the production window remain
pending; no runtime, account, simulator or production gate changed.

Jízda's narrow review then reproduced a read-size mismatch: a valid71008-byte
native result was accepted and journaled, but checkpoint prefix reconciliation
used the generic64KiB private-read default. The pump now uses explicit local
bounds on both initial prefix reads and the post-observation reread: native
wire remains at262144bytes, while its own canonical journal is bounded by
`6 * 262144 + 1`bytes. `ensure_ascii` may expand one native DEL byte into six
bytes (or one UTF-8 scalar into escaped code units); the journal adds one newline.
The generic64KiB reader, custody, canonical-byte equality, hash, prefix and CAS
checks are unchanged.

All88 COP source tests pass, including large ASCII, UTF-8 Unicode, DEL expansion
and rejection above the unchanged native wire limit. The independent Jízda
reproduction now reaches the separate process-proof gate instead of failing
the file-size check. Its native producer and process proof remain stubs; this
is not native runtime acceptance. See
[bounded-result regression](result-bound-regression.json).

See [preparation facts](preparation.json),
[offline constructor observation](constructor-observation.json),
[source snapshot](source-snapshot.json) and the
[deployed repair record](../README.md).
