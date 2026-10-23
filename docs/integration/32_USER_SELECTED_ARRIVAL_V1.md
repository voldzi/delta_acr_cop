# Explicit user-selected arrival: compatible candidate

Status: source and isolated candidate verification, not production activation.
Jízda owns integration into its current vendor SDK and physical-device acceptance.
No TestFlight upload is authorized for this candidate.

## Diagnosis

SIM traced the original Penny POI request to Valhalla HTTP 200 containing warning
401 (relaxed restrictions). The selected road-access control returned without that
warning. This proves neither a 25 m snap failure nor a particular forbidden edge,
legal entrance, walking route, or production engine outage. Warning 401 is returned
as HTTP 422 `ROUTING_RESTRICTIONS_RELAXATION_REQUIRED`, without a usable route.
Unknown/mixed warnings and other safety errors remain fail closed.

## Contract

The binding JSON-first OpenAPI includes the shared schema from
[exact shared definitions](../api/schemas/user-selected-arrival-v1.schemas.json).
SHA256: `210b06c0cd3f093d91529721b21b7ffed26e28be5d625a15a6d62a67c7f36e8c`.

Existing route endpoints and legacy requests are unchanged. The opt-in request
uses `arrival.version=sim-user-selected-arrival-v1`, `selection=user_selected`, and
`arrival.target` for the original POI. Existing `to` holds only the explicitly
selected road access. COP does not choose or silently substitute that access.
Only ordinary `car`, steps included, 1–3 variants are supported. Vehicle profiles,
strict trips, stops, departure times and implicit fallbacks are not admitted.

The advertised `userSelectedArrival` capability must be explicitly accepted by
the host. It is `requires_runtime_validation` or `disabled`, not a guarantee that
any particular point is accessible. Both access→POI and endpoint→POI distances
are <=250 m. Access→actual final geometry vertex snap remains <=25 m. Distances
use spherical Haversine R=6371000 m, with 0.01 m consistency tolerance, which does
not widen either upper bound. Points are latitude/longitude degrees; distances
are metres; validity is UTC ISO 8601.

Every variant and its sole paired feature must contain exactly equal `arrival`
evidence bound to the normalized full request, geometry, route ID, routing graph
version/build, accepted known-closure revision, engine/costing and expiry.
COP verifies all variants before selection. Missing, altered or unsolicited
route/feature metadata fails closed. No connecting segment, walking ETA, legal
access claim or routing fallback is introduced. Opt-in responses are not cached.

Errors: malformed input 400 `VALIDATION_ERROR`; unsupported combination 422
`ROUTING_ARRIVAL_UNSUPPORTED`; too distant 422 `ROUTING_ARRIVAL_TOO_DISTANT`;
invalid returned proof 502 `ROUTING_ARRIVAL_INVALID`. Existing authentication and
error envelope are preserved. Never retry a restriction error by weakening rules.

## SDK handoff

[Six-file patch and integration instructions](sdk/user-selected-arrival-v1/README.md)
include exact source hashes. Preserve Jízda's newer `prepareRoutingAuthentication()`;
do not synchronize an older complete vendor directory. Jízda has integrated the
reviewed snapshot into its candidate and is running its own Debug/SDK checks.

The [example](../api/examples/user-selected-arrival-v1.fixture.json) is synthetic,
not a live route or legal access proof. Its fixed validation time is intentional.
`build-fresh-synthetic-fixture.mjs <new-output.json>` in the SDK handoff directory
creates a five-minute synthetic fixture for simulator integration. It accepts no
production/joint proof as input and never extends a genuine evidence timestamp.

## Verification and limits

- COP six routing suites: 136 passed (ordinary, closure, profile, strict trip,
  endpoints and new arrival contract).
- Additional OIDC + arrival suites: 39 passed.
- Isolated joint HTTP: 2 passed using actual COP Fastify, ephemeral RS256/JWKS,
  actual SIM RoutingService and mocked Valhalla/synthetic closures. Anonymous,
  lab and invalid identities fail before routing; warning 401 remains 422.
- Swift proof harness: 30 passed, including 0.01 m inconsistency and feature-only
  unsolicited metadata for ordinary, mapped and strict routes. Fresh synthetic
  fixture also passes. This harness is not full SDK XCTest or a phone test.
- API build/typecheck and scoped ESLint passed; schema validation, OpenAPI and
  skeleton passed. OpenAPI reports 25 warnings, not zero warnings.
- SIM candidate `dd3a75b` reports 751 passing tests, 6 skipped; not deployed.

Production OIDC→COP→SIM→Valhalla→iPhone acceptance, physical Penny access and full
Jízda build results remain separate gates. No production arrival activation,
permissions, credentials or existing snap limits were changed. Rollback for this
candidate is to omit the opt-in and retain the existing published SDK/runtime;
never reuse an arrival proof for another request or route.

## Production preparation (23 October)

The exact eight-file image-only COP candidate is built as
`sha256:3f0054cb10e7c563c47cb010a7ea7cfbf4ff5a738e1261d77434be283baab430`,
from the running `251374f1...` image. Its image configuration is identical except
for the source revision label. The build receipt and offline OCI source are on
X5 under `/srv/x5-production/staging/cop/work/job-fa4230c846b54cd188c3ac75da93ff26`.
The dedicated COP X5 builder was restored with the existing bounded recovery
script; no cache prune, shared builder, volume or Docker data-root change occurred.

Production is still unchanged. The current protected release contract is pinned
to the previous image and does not permit an arbitrary image-only update.
[Exact operator review](../account-safety/user-selected-arrival-release.review.json)
and its adjacent patch are prepared only; the protected helper/runtime were not
modified. Eight isolated contract tests pass. This is not full installer/root
acceptance. The human must approve this specific review and authenticate as
Root before installation can proceed. No erase/reset or erasure-config change
is needed. Existing fences, accounts, roles, credentials and database settings
are preserved. A fresh owner attestation is an exact-image operator statement,
not a substitute for the required tests or actual SIM engine acceptance.
