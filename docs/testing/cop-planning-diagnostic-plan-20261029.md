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

## Selected first diagnostic step and actual attempts

Root, COP and SIM selected a smaller first step after the new human instruction:
an isolated **native-only** comparison of `thor.extended_search=false` and `true`
using the existing pinned Valhalla image and read-only resolved graph. This does
not activate either shared diagnostic variant above, call the TEC provider or
construct an empty closure snapshot. Full SIM guards are not executed in this
step, so it cannot establish production, preview or legal-access acceptance.

The new fixture deliberately fixes a common departure time, static speed types
and `prioritize_bidirectional=true` in both phases. These are explicit differences
from the historical production requests. Its baseline/variant difference is only
`thor.extended_search`. Geometry and raw engine logs remain in Root RAM. The
frozen source helper/fixture tests passed 14 synthetic tests, independently
repeated by COP.

Root first read only the original 6f log window, finding two numeric reverse-search
exhaustion messages. This was a global-window observation, not per-request
attribution. Its receipt SHA-256 is
`fdddeead44e93c06db5d8a71d1e465a2afd3da7c31bfa8d298266812410f796a`.

| Root operation | Actual result | Native requests | Extended-search variant |
| --- | --- | --- | --- |
| `2f04ce68-1b56-45ad-9d38-7e8cad586ea5` | Startup metadata waiter inspected only IPv4, while the engine listens via IPv6; owned container cleaned up, production unchanged | 0 | Not executed |
| `d54bef4a-6ab4-468f-8aec-f6393cb1b91b` | Both **baseline** public cases returned native HTTP 200, a trip and warning 401; old parser did not recognize colored error prefixes | 4: two status, two route | Not executed |
| `30f80992-b1c3-4865-9cde-a708da38cfbf` | Actual paired comparison: both baseline and both extended-search cases returned native HTTP 200, a trip, warning 401 and one recognized reverse-exhaustion message each | 8: four status, four route | Executed; did not remove warning 401 |

The respective receipt SHA-256 values are
`bbae38d27d2c212e5e06155839767ee7e800bf5f8dc124fcca775254767fba04`
and `b0f7c428fad6715be5d72b681ebb84a27af4d1d160b5fdcc0664898917efb6a4`.
Neither operation is a completed A/B comparison. Zero parsed exhaustion messages
in the second operation are not evidence that such messages were absent.

Root demonstrated the formatter mismatch: the configured logger inserts ANSI
color/reset sequences between `[ERROR]` and the message. SIM supplied a separate
bounded SGR-aware parser v2, preserving the original parser and receipts. Seven
new pure parser tests passed and were independently repeated by COP. Unknown
controls, unrecognized exhaustion format, truncated counts or incomplete streams
must prevent variant admission. Root then executed the manually admitted eight-
request frame without changing fixture/profile/time. Its receipt SHA-256 is
`5957e8395426845f89b9715eab1ea025e186b2ba8ee106b54ede6077b64c052b`.
The corrected parser recognized ten SGR sequences per route observation, with
no unsupported controls, unknown exhaustion format, truncation or stream overflow.
Each A/B payload hash matched. The same binary, graph and common isolated config
were used; only `extended_search` differed between the two phases.

The actual cumulative native count is 12, with zero provider or production API
calls. Independent Root readback confirmed all three operations' containers
removed and the production process/configuration unchanged. The durable aggregate
audit SHA-256 is
`3a24a670abeeff56e0501d906295e135e258858249ca78821338d7dffea68ddf`.

**Negative result:** setting `extended_search=true` alone did not resolve warning
401 in either new public native fixture. Do not deploy that setting as a proven
fix, enable planning or proceed to phone acceptance. The next source investigation
must distinguish the conditional origin/destination pruning gate from another
algorithm or an empty/failed `FormPath` result. Additional parameter trials without
such a discriminator are not an accepted continuation of these closed cases.

## Isolated observation build review

SIM prepared `deploy/valhalla/search-incremental-build-v1/manifest.json`
(SHA-256 `c1f54d120c94461c035793ba30c21f052dcc8c9c9edc890cea67535dc5ade106`).
COP independently reviewed its offline bootstrap, build entry point, actor runner
and image recipes, and repeated all ten pure lock/archive tests successfully.
The public pinned upstream actor header matches the installed runtime header
(`4db3eea725bdd01131320edf0b9571bd891a396ff903377b6b13efc6fff4d5b9`).
This establishes header identity, not the original translation unit or compiler
flags.

The proposed build reuses the actual static archive and replaces only the one
search object in control and observation variants. All other 189 object payloads
and their order must remain identical. An original-archive runner, rebuilt-source
control and observation runner must then agree on the full native JSON digest
for the fixed public route. The actor CLI is a new execution surface, not the
original HTTP service. No result from it establishes SIM guard or COP preview
acceptance. Missing package pins stop compilation; dependencies are resolved
and installed only inside a separately admitted disposable environment. Root
remains the sole operator. Compilation, linking and route execution were **not
performed by COP** during this source review.

### Build correction after actual compiler evidence

Root's first actual build (`b7b5690f-a44c-4e4b-86ab-88c4530d72de`)
failed before native execution. Its compiler log
`0df496ebdba9ef0913e2e6c746d8465ca4d683593b40c5c6a6fd1dba94177298`
showed that the installed headers require C++20 (`format_string`, ranges and
span). The pinned upstream CMake configuration also explicitly requires C++20.
The initial recipe's C++17 choice was incorrect; this failure does not establish
header/source divergence.

The separate corrected package `search-incremental-build-v2/manifest.json`
(SHA-256 `7e9bb105fcb85b934be2e31cc73d6f9027f7e74a0419a3794e69888d2606aefa`)
changes only the common language-standard token to C++20 in the driver and lock
template. COP independently checked these exact diffs and repeated all 13 pure
tests successfully. The original package and failed receipt remain preserved.
This is source/build preparation evidence, not a completed native comparison or
production route acceptance.

Root's corrected C++20 build (`d2b22526-72b1-4ed5-9c1a-d67a15dba37d`)
successfully compiled the actor, control search and observation search objects.
It then failed at the first link because the transitive pkg-config output uses
bare `libprotokit.a` filenames. The failed link log SHA-256 is
`40083ba2378615b4f059ee228ca45927837b33a8d7e7a6e38409efe048edf27a`.
Root subsequently verified that the archive exists at
`/usr/lib/x86_64-linux-gnu/libprotokit.a` (1,248,008 bytes; SHA-256
`3472cb3ddf9a26056b371c0ebd566b4cd825c1b3e4cb76a55434aeecb5166307`).
The proposed next correction binds the two exact bare tokens to this verified
path and reuses the preserved objects and archives. It does not remove a
library, change compilation, download packages or establish native acceptance.

### Actual link completion and observed search branch

Root completed the separately reviewed C6 link-only operation
`1369ac0b-66bf-4cb2-83b7-ea80445a1224` (result SHA-256
`f19b9f2500e6eb78ae96794ce1e992783d59d58d87daa85e7ab6c33b9fc47898`).
The corrections bind existing runtime library files and append the proven
GeoTIFF dependency missing from pkg-config. No dependency was dropped, no object
was recompiled, and the other 189 archive members remain unchanged. The earlier
failed build/link receipts remain failures.

Root then executed the bounded public mechanism frame
`998b7d32-8417-40ec-b1d8-1a035cdb5aef` (receipt SHA-256
`9f6b97631f102da3e53115bd6bfd22650d27b650079aa208f13e66907b4ccf1e`).
The actual original service, original-archive actor, rebuilt control and observed
actor produced the same complete route JSON: 6,341 bytes, SHA-256
`6487f8e3f0418caa3ce76e4be6de95ff4b5a57302ad08521d739320a3a983299`.
Each returned a trip and warning 401 on dataset `1792897718`.

The two actual observation records distinguish the previously unresolved branch:

- Pass 0: five origin and two destination seeds; extended search enabled;
  pruning disabled at the origin false and at the destination true;
  `reverse_gate_empty`; no connection, no FormPath call, no recost failure,
  empty result.
- Pass 1: the same seed counts and pruning flags; two best connections;
  `reverse_connection_formpath`; one completed FormPath call, one returned path,
  no unwind or recost failure.

This confirms reverse-frontier termination in the strict pass, rather than a
FormPath/recost failure. It does not identify which of the multiple pass-1
relaxations was necessary or prove that the route is legally accessible. The
frame used the explicitly different fixed-time, forced-bidirectional mechanism
fixture; it is not a reconstruction of the historical 6f planning payload.

Eight new native actions completed (four status, four route), bringing the
mechanism total to twenty. Raw output stayed in RAM, production remained
unchanged, and this result grants no permission to enable COP planning. The
next targeted comparison must use a new public source-equivalent 41dd payload:
normal speed types, no usable live overlay and no forced prioritization, changing
only absent departure time to explicit current departure time.

### Actual source-equivalent current-departure comparison

Root subsequently completed public frame
`85e5b616-0c69-4cba-a362-8f8e5b91c8ef`, receipt SHA-256
`30543105e33c5dcf7678bd622713d752d620b6280d0d25c613df5cfeffbea546`.
Both source-equivalent baseline cases returned warning 401 and reverse-frontier
exhaustion. Changing only native `date_time` to `{type:0}` produced a trip with
no warnings in both cases. Six native actions completed (two status, four route),
bringing the separately defined mechanism count to twenty-six. This is native
mechanism evidence, not full SIM, COP HTTP or owner-phone acceptance.

SIM published the shared accepted-road correction at
`84b85cd94051095eb6038f8501ca8f411e1cc37e`. The earlier preview-only `3c27fbc6`
was superseded before any build or deployment. The final correction sets a
private current-departure option inside `knownClosureRoute`, **after** its
existing rejection of non-current departures. It covers ordinary route,
alternatives and assisted preview while leaving the public query/hash and
explicit departure/arrival parsing unchanged. Current traffic speed use still
requires its independent matching usable lease. Warning 401, vehicle/access,
snap, closure, graph and proof validation remain mandatory; no fallback or
automatic change of origin is added.

SIM reported 817 passing tests and six skips. COP independently ran the two
affected known-closure/live-traffic suites: 121 passing tests. Source review,
these tests and the native comparison do not by themselves establish deployment.
Root owns the fresh image-only transition, rollback and bounded live acceptance.
An off-road location error 171 still requires an explicitly selected and
confirmed road origin; the timing correction does not turn the original point
into a routable location.

## Ordinary COP adapter acceptance boundary

The installed COP `RoutingSourceAdapter.route` forwards `/routing/route` to SIM
`/routing/alternatives`. Its source hash is identical in overlay `7c43b690` and
this checkout (`5d23dd26fd41e8645d89ac82abcfdb17f1389f1a3138513745674c3543ea8d66`).
It preserves explicitly supplied ISO departure, arrival, trip and mapped profile
fields; an omitted departure remains omitted. Ordinary transport sends no bearer
credential in this revision. Planning transport separately uses its service
credential; do not inject that credential into an ordinary canary.

`scripts/cop-ordinary-routing-canary.mjs` is a Root-operated, read-only integration
harness for the **installed** compiled adapter. It does not bootstrap the API,
create accounts, issue tokens, change environment or modify the running image.
Root pins the actual compiled module at `/app/apps/cop-api/dist/routing-source.js`
and current routing base URL by SHA-256, along with the outer container/image
identity. Its input manifest contains only `schema: cop-ordinary-adapter-canary-v1`,
a fresh UUID `admissionId`, `moduleSha256` and `baseUrlSha256`. It accepts two fixed
public mapped-car cases with one and three requested alternatives, matching the
client's ordinary field shape (steps and road attributes enabled, no fabricated
`departureTime` or arrival).

The exported `executeReviewedManifest` can be loaded from a separately hash-pinned
`data:` module in a standalone `docker exec` Node process; this avoids copying a
file into the application container. Root supplies the non-secret manifest via
stdin, preserves existing environment and writes only the safe receipt outside
the container. The helper pins the actual outbound URL, method and body, caps
adapter requests at two, disallows retries and credential injection, and relies
on the installed adapter's complete mapped/closure verification. It exports only
counts, booleans and failure codes, never raw routes, coordinates, provider text,
credentials or environment. Eight pure synthetic harness tests passed; those
are not actual integration acceptance.

A successful result explicitly has `publicHttpUserAuthenticationVerified:false`
and `accountGuardExecuted:false`. It proves real installed-adapter-to-SIM
integration, not an authenticated public COP HTTP request. Public unauthenticated
401 and SQL-control 403 probes establish only negative boundaries. Positive
public OIDC/account/BFF acceptance requires a legitimate current user session
through the application, normally the owner's iPhone flow, without extracting or
fabricating credentials.

For an accepted known-closure ordinary request, source code makes one native
route call and two status checks, plus one trace and one status check per returned
road-attribute variant. Thus the two ordinary cases have a structural upper bound
of fourteen native calls (five for one variant, nine for three); concurrent
background traffic checks and the independently pinned planning kernel's probes
must be counted separately by Root's native envelope. No penalty-alternative
calls are made on this guarded branch. Unknown/native overflow, expired proofs,
wrong dataset, failed auth or a changed graph remains a failure, never a retry
with weaker routing.

For the owner's separate, explicitly authorized phone flow, at most one ordinary
request is allowed. A native or waypoint-snap 171 stops after the initial status
and route calls (two actions). Only after explicit user action may one candidates
request follow (two dataset-status calls and one locate), then one confirmed
preview (two outer dataset-status calls, two inner status calls and one route).
The preview query has road attributes disabled. Thus that specific three-request
flow has at most ten native HTTP actions; an ordinary success with three variants
has at most nine. This excludes independent startup, health and background
traffic checks, which Root must account for separately. No private coordinate or
route body is exported as evidence. A row selection alone is not confirmation,
and neither a retry nor another destination may be silently substituted.
