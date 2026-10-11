# 26. Ordinary navigation with reviewed known closures

Status checked on 2026-10-11: ordinary reviewed known-closure routing is deployed
and enabled. COP API runs `e99401213efbf9d6a7685443adc318eeeb422c15`; SIM runs
`03b842e005f103bb02d622bb4fc95f27fbea9572`. The location-error refinement
described below passed the joint server transport acceptance. Strict routing and
voluntary driver measurements have separate
activation and acceptance gates; see [measurement handoff](22_JIZDA_DRIVER_MEASUREMENTS_COP_HANDOFF.md).
Actual authenticated-user routing and physical-phone acceptance are pending.
Coverage remains incomplete; one closure is individually reviewed.

## Compatible additive response

Each ordinary route variant may contain `knownClosures` with version
`sim-known-road-closures-v1`. The exact schema is
[known-road-closures-v1.schema.json](../api/schemas/known-road-closures-v1.schema.json)
and `RoutingKnownClosures` in the binding COP OpenAPI. No new request parameter,
endpoint or direct mobile SIM access is introduced.

- `state=applied` means SIM enforced the individually reviewed current exclusion
  set in Valhalla. `coverage=incomplete` is mandatory. It does not establish
  complete national closure coverage, legal access or physical passability.
- `geometryHash` is SHA-256 of that variant's GeoJSON geometry; `requestHash` is
  SHA-256 of normalized `response.query`. Canonical JSON recursively sorts object
  keys, preserves array order and numeric values, and omits undefined properties.
- COP returns the verified normalized `query` when this evidence exists. SIM adds
  absent `via=[]`, `avoid=[]`, and alternatives defaults (route=1, alternatives=2).
  COP sends its primary route to SIM alternatives with explicit alternatives=1.
  Legacy ordinary 0..5 values remain accepted; SIM clamps their effective maximum
  returned route count to 1..3, which COP independently verifies. Strict trips
  retain their separate 1..3 bounds; no safety field is dropped or normalized.
  COP checks the requested identity separately from the hash; a self-consistent
  hash of a different request is rejected. Other options/vehicle fields must match.
- Exact `routingDataset.version` and `builtAt` must match response coverage.
  The source snapshot `revision`, engine build and exclusion set must match across
  every variant. No variant may use a substitute engine or fallback.
- `observedAt` means latest successful full TEC snapshot confirmation, not the
  physical time of observation or the event's original onset. `validUntil` must be
  in the future and at most ten minutes after this confirmation, bounded also by
  the closure/source/graph deadlines. Graph age must stay within ten days.
- `appliedClosureCount` counts the engine exclusion set, including closures outside
  a particular route. It equals the exclusions length; closure IDs are unique.
  It is not a count of incidents encountered along the selected route.
- `sourceDirection=both` only pairs with `source_both_direction`.
  `sourceDirection=unknown` only pairs with `conservative_whole_structure_avoidance`.
  `enforcedDirection=both` describes actual conservative engine exclusion. Unknown
  source direction never becomes a verified both-direction claim. Whole-structure
  avoidance requires individual official-statement and exact-geometry review in
  SIM; fuzzy event geolines alone are insufficient. This may lengthen a detour.
- Absence is unknown/not requested, never successful enforcement. The metadata
  cannot satisfy mandatory `sim-road-trip-v1` requirements or permit strict downgrade.

When `includeSteps=true`, every variant must additionally have complete ordered
maneuver indices covering the exact route geometry, with matching step geometry
and finite nonnegative distance/time. Consecutive duplicate vertices and the
duplicated arrival point are normalized only for this equality check; the original
wire geometry is preserved. Summary-only unindexed steps cannot establish mobile
navigation acceptance.

COP validates every raw variant before discarding unavailable results. Changed
request/hash/geometry/dataset, expired metadata, differing snapshots, invalid
scope/reason pairs, missing variants and rendered-geometry mismatch reject the
whole response. Verification time includes elapsed upstream latency so evidence
that expires during calculation or transport is rejected. Correlation-aware COP error handling is preserved; no direct
provider, alternative engine or retry that discards exclusions is added.

## SDK handoff (do not overwrite the local Jízda package)

Add optional `knownClosures` to the existing route DTO and optional `query` to the
response DTO; use the above exact schema. Preserve current voice, measurement,
tunnel and strict fields. Validate all variants, request identity, geometry hash,
shared source/graph/engine revision and validity before interpreting `applied`.
Hash primitives must match ECMAScript `JSON.stringify`, including negative zero
as `0`, integer-valued doubles without `.0`, shortest IEEE-754 decimal output and
its exponent thresholds/signs. Object keys use UTF-16 code-unit sorting; strings
use JSON escaping and hashes use UTF-8 bytes. Do not assume native Swift sorted-key
JSON serialization matches. Verify the [canonical interoperability vectors](../api/examples/known-closures-v1.canonical-vectors.json), including numeric exponent/precision and Unicode/escaping cases.
Missing metadata retains an unknown closure state. Expired metadata requires a
new route request; never keep displaying a current enforced-closure claim after
expiry. Selection, stop insertion, restoration and recalculation must invalidate
or revalidate evidence against the exact geometry and request.

COP verification failures return 502 `ROUTING_KNOWN_CLOSURES_INVALID`; SIM
`ROUTING_KNOWN_CLOSURES_*` codes remain preserved with their HTTP status. Do not
silently retry these failures through Apple/legacy routing that drops the exclusions.
Keep the last route only with its actual expiry and explicit failure state.

SIM location-error refinement is deployed on 2026-10-11. Only an accepted engine route or
alternatives response with HTTP 400 and a numeric JSON `error_code=171` maps to
422 `ROUTING_LOCATION_NOT_ROUTABLE`. COP preserves this status and code in its
existing error envelope with the COP request correlation ID. The code means that
at least one input location could not be correlated with a routable road; it
does not identify the origin, destination, waypoint or location index. Do not
blindly snap or change coordinates, discard requirements, or retry through
another provider. HTTP 5xx, timeout, a non-route 171 response, invalid geometry
and reviewed-closure intersections do not acquire this meaning.

The older 502 `ROUTING_KNOWN_CLOSURES_ENGINE_FAILED` remains a mixed engine and
verification failure, including a route intersecting a reviewed closure. It is
not an availability-only code and does not authorize a new Apple/legacy fallback
or automatic acceptance of a pending Apple result. Presence of `vehicleProfile`
or `trip` in the canonical request requires its corresponding verification;
an acknowledged ordinary-car profile does not waive it. An already explicitly
chosen independent ordinary Apple route may remain only when its request has
no `vehicleProfile`, `trip`, mandatory requirements or SIM proof, with an
explicit COP failure state and unverified COP closure status. This adds no new
provider-selection mode or fallback consent flow.

COP local acceptance on 2026-10-11 passed 26 targeted tests, including 16 new
adapter-to-handler cases for both endpoints: ordinary, mapped and strict requests;
exact 422/code and COP correlation; sanitized error without route/proof; anonymous
401 before any provider call; preserved protective 502/503 and no COP translation
of raw Valhalla 171. Every authenticated fixture made exactly one mocked SIM call.
API type-check, test-file ESLint, skeleton and OpenAPI validation passed (24 existing
OpenAPI warnings). These are synthetic lab-auth tests; actual native-user acceptance
remains pending. COP runtime code is unchanged.

Joint live transport acceptance at 2026-10-11T11:09:44.417Z used exactly one
agreed public synthetic fixture through the deployed compiled COP adapter:
HTTP 422 `ROUTING_LOCATION_NOT_ROUTABLE`, 213 ms, one upstream fetch, no retry or
accepted substitute route. Both API images were healthy: COP
`sha256:8c61839a458ca82cfc79725b4763759c90d66ffcd31e1e24e2ff5defe9724741`
and SIM `sha256:2f3aa1659d03c5eaf014353071e38f6abc1d2da1419a9ac2205a05b5873a5965`.
The same captured error separately passed the compiled COP error-envelope helpers,
with a matching own correlation and no route, proof or endpoint claim. No second
fetch, authentication change or production store instance was used. This pure
envelope check and the local actual-handler tests are separate evidence; the
live probe is not an authenticated public native-user or physical iPhone test.
It does not establish the cause of the user's earlier screenshot.

Show incomplete coverage and conservative avoidance in the existing route UI.
Do not promise an open road, complete legal passability or guaranteed bridge
safety. There is no live measurement/ETA promotion in this change.

## Acceptance boundaries

COP synthetic tests cover valid distinct variants, preservation, changed query
with recomputed hash, option loss, malformed/extra variants, missing evidence,
geometry/render binding, source revision, expiry, engine fallback, graph changes,
direction/reason mismatch, count/ID mismatch and strict separation. Signed OIDC
and BFF boundary tests remain included in the targeted run.

These tests do not prove actual closure truth or Valhalla enforcement. SIM published the pinned immutable binding schema/fixture revision and reports
actual source/engine acceptance for one individually reviewed closed structure
in both directions. COP reviewed that private evidence; it is not national coverage
or authenticated physical navigation acceptance. Candidate-image source/geometry verification and exact deployed image checks passed
before joint activation. Authenticated real-session and physical iPhone checks
remain pending; previous production and rollback evidence is in record25.

Local verification on 2026-10-03: 74 targeted tests passed, including mobile-step
boundaries, exact serialized SIM fixture, canonical vectors and legacy ordinary
alternatives normalization. Current full suite: 1176 passed / one skipped.
Final lint/typecheck, API build and OpenAPI validation passed. Full workspace build
passed before the final API-only additions (web unchanged). Skeleton and ten JSON
schemas passed. OpenAPI valid with 19 warnings, including one additional composition
warning in the exact transferred SIM schema. These local tests do not activate
production flags or change the mobile package.

The [serialized SIM synthetic fixture](../api/examples/known-closures-v1.sim-fixture.json)
contains normalized query, distinct GeoJSON variants and expected SHA-256 values.
It is a contract fixture, not a live bridge or production acceptance record.

## Joint production acceptance on 2026-10-03

- Immutable SIM schema and serialized fixture exactly match COP's transferred
  copies; packaged COP image validated distinct variants, canonical vectors,
  expiry rejection and changed-request rejection in an isolated test.
- Actual source-bound candidate with mobile flags `alternatives=3`,
  `includeSteps=true`, `includeRoadAttributes=true` passed through COP in both
  directions, including complete indexed maneuvers and map-feature binding.
- COP API image identity and health/readiness were verified after deployment.
  Existing runtime environment, networks, ports and secret-file checksums were
  preserved. Anonymous and malformed identities returned 401.
- After SIM activated ordinary reviewed closures, the running configured COP
  adapter contacted actual production SIM in both directions: 3726 m / 3682 m,
  one actual native variant and nine complete indexed steps each, one enforced
  reviewed closure, incomplete coverage and current expiry. No variant was
  fabricated to reach the requested alternative count.
- Ordinary routing away from the reviewed closure returned an `ok` Valhalla
  route with ten indexed steps and verified known-closure evidence.
- Strict capabilities remain disabled; a fresh strict request returned 422
  `ROUTING_SAFETY_UNSUPPORTED`, without an unassessed substitute route.
- Jízda reports 20 SDK tests passed, including temporary private replay of these
  exact actual COP-transformed responses on iOS27.1. App Debug/Release/domain and
  simulator acceptance passed; installation was reported, but launch was blocked
  by the locked physical phone. Neither installation nor fixture replay proves
  physical navigation or real OIDC acceptance.

The subsequent SIM patch `91bbfa049a73cf2dd86f3430578ed9e9d571ea77` fixes
only an exact duplicated origin pair in edge-walk geometry. Interior/nearby repeated
points remain rejected; forward index checks preserve loops. COP reviewed the narrow
diff and verified actual post-patch image identity and healthy runtime. Running COP
then independently verified both directions again: unchanged 3726/3682 m and nine
indexed steps, roadAttributes `ok`, tunnels `known` with zero intervals on these
particular routes. This establishes neither a real tunnel-driving test nor complete
speed/legal/vehicle-limit coverage. Vehicle restrictions remain not evaluated.
SIM reports 246 tests passed, including six isolated database tests.

Previous COP image and exact configuration selection are retained for rollback;
a live rollback roundtrip was not performed. Live outage injection was not done;
source/engine/revocation/graph-race and no-fallback failures were tested in isolated
SIM/COP suites. A future graph update needs reviewed re-binding; an unreviewed new
graph fails closed rather than silently reusing the old exclusion template.

Chroma retrieval was available for the managed primary repository. Reindexing this
release worktree was rejected because it is not a managed MCP root; no successful
release-index update is claimed. Selected current files were verified directly.

### Graph-release operational gate

Activating a different graph invalidates the reviewed binding. Ordinary road
requests then fail with 503 until the new graph passes reviewed re-binding, including
source/geometry/engine verification. This affects routing beyond the vicinity of
the reviewed closure. It must not silently retry without the exclusions. The current
release does not provide an automatic nationwide publisher or automatic graph-review
promotion. A scoped verified re-binding step in the existing graph-release workflow
is deployed in SIM, with the current-graph mechanical canary passed. Every future
graph must pass the same checks before use; its activation is not yet verified. Exact private scheduler
and operator details belong in the private operational handoff, not this public file.

COP compatibility release `b505289` and SIM `51613f4` were independently checked
against the actual running images. The current configured COP-to-SIM mobile query
still passed in both directions: 3726/3682 m, nine indexed steps, one reviewed
closure, incomplete coverage, road attributes `ok` and zero known tunnel intervals.
SIM's new mechanical re-binding is bounded to the same individually reviewed
structure and source semantics, checks each constrained native variant's actual
edge trace, and keeps the original approval file unchanged. Its 263 tests include
rejection of the closed way outside the old polygon, source/graph/file races and
in-flight deduplication. The initial separate-process live probe failed before
geometric verification because the cold process had no source snapshot and the
shared provider quota delayed a permitted refresh. Ordinary API routing remained
healthy. After the permitted refresh, the independent live mechanical probe passed on
`sim-routing-2026-09-29-1790679143`: exact bridge anchor matching, baseline bridge
presence and constrained bridge absence in both directions, indexed maneuvers,
unchanged final source and graph identity. COP reviewed the complete sanitized
probe output. No future graph activation or automatic national coverage acceptance
is claimed. The in-service re-binding uses the same existing warm source instance;
its cache stores only the derived graph binding, and source evidence is validated
again for each published route.
