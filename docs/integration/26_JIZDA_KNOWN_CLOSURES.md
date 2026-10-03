# 26. Ordinary navigation with reviewed known closures

Status: COP validator prepared and tested, pinned to published SIM revision
`3506663a70a32ecdab9ab2921656385dc998ea26`. COP implementation `d6fc3ba` is not yet
a deployed joint release. Exact immutable schema and serialized fixture equality
passed; fixture-through-adapter and expiry rejection passed. Joint production
activation and physical acceptance remain pending. Strict profiles stay disabled.

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
or authenticated physical navigation acceptance. Candidate-image source/geometry
verification and exact deployed image checks must precede joint activation. Authenticated real-session and physical iPhone checks
remain pending; previous production and rollback evidence is in record25.

Local verification on 2026-10-03: 70 targeted tests passed, including the exact
serialized SIM draft fixture and canonical vectors; full suite before the final
feature-evidence binding additions
1169 passed / one skipped. Lint/typecheck and API build passed; full workspace
build passed before the final error-code/elapsed-time additions (web unchanged).
Skeleton and ten JSON schemas passed. OpenAPI valid with 19 warnings, including
one additional composition warning in the exact transferred SIM schema.
No production flag or mobile package was changed during these tests.

The [serialized SIM synthetic fixture](../api/examples/known-closures-v1.sim-fixture.json)
contains normalized query, distinct GeoJSON variants and expected SHA-256 values.
It is a contract fixture, not a live bridge or production acceptance record.
