# Source-only follow-up to the rejected planning canary

Status: proposal only. No runtime code, image, environment, producer binding,
diagnostic flag or additional HTTP/native test is changed by this document.
No maintenance hold remains. The [actual canary record](cop-planning-origin-20261029.md)
remains a failed acceptance, with planning disabled.

Subsequent direct human instruction in the Jízda thread on 2026-10-29 authorizes
targeted diagnosis, the necessary verified repair and later installation on the
owner's iPhone, with no TestFlight upload and preserved vehicle safety limits.
This instruction was independently read from user message
`01a188c5-7f91-7013-ba40-bdfbf69f1429`. COP, SIM and the Root operator resumed
selection of a method that can distinguish the actual multipass trigger; logging
the already-known warning alone is insufficient. Root remains the sole host
executor. No new diagnostic deployment or probe is claimed in this record.

## What is known and what is missing

Both previews returned 422 because the deployed SIM guard rejects native warning
401 after geometry and closure validation. Valhalla's second pass changes several
search/access settings together. The warning does not identify which change
enabled a path. Existing retained evidence lacks native bodies, internal branch
facts, the selected candidate coordinate/ID and the closure revision. The original
public origin must not be substituted for the selected snapped point.

SIM inspected deployed revision `41ddfaf329b52fc9ca4b821fe270ea25b4bf4e49`.
The existing `BoundedRoutingDiagnostics` in
`apps/situation-data-api/src/routing-diagnostics.ts` can retain allowlisted
stage/outcome, numeric warning codes and bounded warning counts/facts. It cannot
report the actual internal algorithm or multipass condition; these remain
`not_reported`. Additional metadata alone does not promise a route fix.

## Variant A: pass the existing validated correlation context through preview

The minimal internal change is in two SIM runtime files, not COP's public API:

1. In `planning-origin.ts`, add optional `RoutingRequestContext` to the preview
   port and service method. Forward only the already validated unique UUID
   `X-Correlation-ID` from the preview HTTP handler. Keep candidates unchanged;
   do not accept a new body, query or header field.
2. In `routing-service.ts`, pass that context from `planningPreview` to
   `knownClosureRoute(request, context, true)` instead of `undefined`. Preserve
   the exact query, native calls, guards, response and no-retry behavior.

Reuse the existing reporter and serializer. No request/response body, actor or
user identifier, URL, coordinates, geometry, provider text, header or secret may
enter the diagnostic record. Reporter failures must remain non-interfering.
No OpenAPI change is needed for internal context forwarding.

This would require a new reviewed SIM image and production provenance before
deployment. It is not authorized by this source-only proposal; do not mutate the
current frozen image/configuration cases or producer bindings.

## Variant B: limited new ordinary-route diagnostic reproduction

The ordinary endpoint already forwards `RoutingRequestContext` into the reporter.
Source inspection establishes that the same canonical query uses the same
normalization and closure-routing computation: car/mapped-auto profile, complete
vehicle declaration, empty via/avoid, alternatives 1 (native alternates 0), and
all planning include flags false. Preview's third `true` argument only bypasses
in-flight coalescing; it does not change costing or safety checks. The ordinary
closure-enabled branch leaves before the legacy result cache, but may coalesce
identical concurrent native computations. The client cannot disable this.

This is **not equivalent preview acceptance**:

- Dataset, closure snapshot and traffic lease are read anew. Native date-time
  and speed types derive from the current live-speed state; `includeTraffic:false`
  does not disable that state. Revisions need not match the earlier canary.
- Ordinary requests lack preview discovery, actor/purpose/context-age/dataset/
  selection binding and final preview assessment.
- Planning-specific bearer/actor/allowlist/header/rate checks are not the ordinary
  handler's checks. Root must separately establish actual endpoint authorization.
  The existing frozen canary runner allows only the two planning paths; do not
  route an ordinary request through it as an unreviewed extension.
- The original selected coordinate was not retained. New public discovery would
  produce a new limited reproduction, not a retrospective replay or silent retry.
- Ordinary routing also follows the common tracing path, while planning-origin
  is excluded. Source tracing adds method/path, full URL, client address and
  correlation/request/trace metadata, though not bodies or Authorization. Actual
  exporter and retention therefore need separate verification; an ordinary probe
  must not introduce query data or user identifiers. The diagnostic serializer's
  privacy bounds alone do not establish equivalent overall observability.

This saves an image build, but not necessarily a configuration/restart/provenance
transition. Diagnostic expiry is loaded once at process construction. Activating
the existing flag changes runtime identity and invalidates the current producer
receipt; the existing SIM healthy-off guard rejects diagnostic-until keys.
Do not create a second in-process service or use `docker exec` as a workaround.

## Shared diagnostic scope: unresolved approval/design boundary

The existing `SITUATION_DATA_ROUTING_DIAGNOSTICS_UNTIL` is off by default. Missing,
invalid, elapsed or more-than-ten-minute expiry disables recording. Wall and
monotonic expiry both apply. The cap is 16 error records **per process/reporter**,
shared across ordinary routes, alternatives and any newly connected previews;
restart renews that cap. It is neither a global cap nor planning-only collection.
Warning counts are capped at 64 per scope, codes at 16 unique integers 0–9999,
variants at three and alternate inspection at 16, with truncation indicators.

Neither variant may silently enable that shared collection as though it were
isolated public-preview diagnostics. A future explicit decision must either cover
the actual shared scope or separately review narrower admission. No new reporter,
permission mechanism or Root deployment framework is proposed here.

## Verification evidence and missing tests

SIM reran existing tests against frozen source: 15 diagnostics tests passed,
and three selected ordinary route/alternatives/singleflight tests passed
(100 other tests filtered). They cover disabled/expired/bounded recording,
clock behavior, safe serialization, emit/formatter faults, separate correlation
records for a shared computation and retained 422/no-retry behavior. The earlier
six selected closure/planning tests also passed (125 filtered). These are local
synthetic tests, not production reproduction or tests of an implemented CID wire.

Before variant A could be delivered, new tests must prove handler-to-port CID
forwarding; missing/invalid/duplicate CID and auth/rate denial before native work;
unchanged preview 422 and one native computation for warning 401; no sensitive
sentinel leakage; off/expiry/cap behavior through preview; no diagnostic on success;
non-interfering emit failure; and unchanged malformed-warning/geometry failures,
payload/bindings, ordinary behavior and shared cap. These tests are **not yet
implemented or passed**. Type-check/build and contract checks remain required.

After the new instruction, COP's HTTP/transport regression run passed 21 tests.
The added synthetic OIDC discovery-to-preview rejection test verifies unchanged
422/code, the same correlation ID through COP and its upstream header, exactly
one preview call, unmodified request body, no direct fallback and no upstream
provider text or credential in the user response. It also confirms that internal
diagnostic fields are absent from that response. The existing BFF-session test
now uses the session store's wall-clock expiry rather than an already elapsed
routing-fixture timestamp; production expiry behavior is unchanged. These tests
do not test SIM's proposed internal CID wire or native multipass instrumentation.

## Possible bounded public scenario: not admitted or executed

After a separately accepted diagnostic scope and operational plan, use only the
same declared public control origin/destination/profile as the failed canary.
Permit one new discovery and one explicitly selected request: preview for A, or
ordinary diagnostic reproduction for B. Bound the whole window to two API calls,
180 seconds and at most 36 global native calls including background and both
markers, with stable engine/daemon/dataset/log identity and no retries, alternate
candidate, profile/target change or restriction waiver. Stop on unknown/incomplete
counting or any state drift. Only allowlisted metadata may be retained.

A diagnostic result is not preview acceptance, permission to enable planning, or
physical COP/Jízda acceptance. Those decisions require their own actual evidence.
