# COP API pressure correction — 7 November 2026

## Observed failure and scope

Jízda88 completed explicit chat issuance, but subsequent mobile bootstrap
requests intermittently returned503 `FST_UNDER_PRESSURE`. COP itself emitted
the error; healthy liveness/readiness and OIDC discovery did not establish
bootstrap availability. The original26-hour process used96.68% CPU and3.974GiB
RSS. The same image after restart used0.73% CPU and381.6MiB. These observations
show an accumulated-work/state problem; they do not alone prove its entire cause.

One bounded function-only cold CPU sample identified the flight update path:
track-history snapshot/admission accounted for598ms of a12.4s window. No heap,
scope, request body, identity or token was exported. See `cold-profile.sanitized.json`.
Inclusive times overlap and must not be summed. This was not a capture of the
original hot process.

## Minimal correction

The guarded state owner may reuse an unchanged contiguous prefix only from its
own detached, frozen history array with a matching durable epoch and local fence
generation. The real lease and explicit owner are still checked. A suffix is
validated normally, including stable-ID ownership inheritance; a changed epoch,
fence or expired lease forces complete current validation before publication.
Each new point is detached once; ownership lookup uses that actual normalized
point ID and the real guard validates its published contents in both versioned
and unversioned modes. Stable epochs avoid a redundant whole-array scan after
all individual points passed. Without an epoch, no reusable admission is created.
Mutable, shallow-frozen or equal-looking replacement inputs do not borrow it.

Flight ingestion yields to the real event loop after8ms or32 records. After each
yield it checks cancellation and re-reads the actual durable frontier before
processing another record. Event order, contents, single-flight execution and
close fencing remain intact. No load-protection threshold, pool, network,
credential, authentication or erasure policy is changed. No history or audit data
is deleted and the established5000-point history capacity is retained.

The same synthetic5000-point/100-update fixture improved258ms→32ms, with the
same5116 guard callbacks. See `history-scale.sanitized.json`; these are local
timings, not a sustained production-capacity claim. Tests cover real timer
progress, order/content, cancellation and changed admission between chunks,
history replacement, stable-ID ownership, lease/epoch/local fences and altered
serialization. Two pre-existing optional-warmup tests were corrected to test
actual failed admission and unpublished index, rather than API startup rejection;
the failure was independently reproduced on the unmodified source. See
`baseline-tests.sanitized.json`.

## Diagnostic incident and limitations

The first profiler cleanup incorrectly used dynamic import from an inspector VM.
`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` caused the old API to exit1 at13:58:26UTC.
This diagnostic mistake is separate from the original overload. The same
container/image/configuration was explicitly restarted at14:01:55UTC. No user
operation was replayed. The corrected sampler was reviewed and tested in eight
isolated success/failure fixtures, then used exactly once. Kernel socket absence,
same target PID and subsequent live/ready200 were checked; no inspector port was
published. Original failed evidence is not overwritten by subsequent success.

`state.events` still has unbounded cumulative growth. This patch does not claim
to bound long-running memory, introduce retention, or prove the full26-hour
failure resolved. Any later bounded event cache must preserve classification,
history provenance, duplicate/conflict checks and account-erasure behavior;
silently evicting security evidence or deleting history is not an acceptable fix.

## Release and acceptance

Source, immutable patch review, broker-built image, actual activation and native
acceptance are recorded separately as completed. Until that record exists this
document describes a tested candidate, not a deployed correction. Read-only
production probes must not mint user tokens, log in for the owner or create
registrations. Actual cold bootstrap/profile and vehicle metadata acceptance
must use the existing authorized native session through Jízda.
