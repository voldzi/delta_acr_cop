# 27. Explicit ordinary vehicle profiles for Jízda

Date: 2026-10-04. Server release deployed after joint acceptance; authenticated end-user
and physical-device acceptance remain pending.

## Wire contract

Use the existing authenticated `POST /api/v1/routing/route` or `/alternatives`.
Jízda does not call SIM directly. Set `profileId: "car"` explicitly and add
`vehicleProfile`. Do not combine it with legacy `vehicle` or strict `trip`.
Typed profile requests accept alternatives 1..3 (legacy requests retain 0..5).
The exact shared [SIM schema](../api/schemas/mapped-road-profile-v1.schemas.json)
is transferred into binding COP OpenAPI under `RoutingMapped*` names.

```json
{
  "profileId": "car",
  "from": { "lat": 50.08, "lon": 14.42 },
  "to": { "lat": 50.1, "lon": 14.45 },
  "alternatives": 3,
  "includeSteps": true,
  "includeRoadAttributes": true,
  "vehicleProfile": {
    "version": "sim-mapped-road-profile-v1",
    "intent": "car_with_trailer",
    "coverageAcknowledged": "mapped_restrictions_incomplete",
    "vehicle": {
      "heightM": 2.1,
      "widthM": 2,
      "lengthM": 9,
      "loadedWeightKg": 3200,
      "trailer": {
        "attached": true,
        "heightM": 2.1,
        "widthM": 2,
        "lengthM": 4,
        "loadedWeightKg": 1200
      }
    }
  }
}
```

This is a synthetic request example, not a verified real route.

| Intent | Actual costing | Vehicle parameters |
| --- | --- | --- |
| `car` | auto | Complete dimensions/loaded weight optional |
| `commercial_truck` | truck | Complete dimensions/loaded weight required; measured axle load/count optional |
| `car_with_trailer` | auto access | Complete WHOLE-combination dimensions/loaded weight and trailer facts required |
| `road_legal_4x4` | auto, road-first | Mapped unpaved access allowed; complete dimensions/loaded weight optional |

Meters for dimensions; kilograms for actual loaded/axle weight. Limits: height
5 m, width 3 m, length 25 m, loaded weight 60000 kg; truck axle load 40000 kg and
count 2..20. Values are positive; whole-combination dimensions/weight must be at
least the trailer values. Axle load cannot exceed whole loaded weight. Axle
parameters on a non-truck intent are unsupported. Omit `departureTime` for this
ordinary current-time path; planned departure is unsupported.

`coverageAcknowledged` records explicit use of incomplete mapped restrictions.
It does not create a legal or physical guarantee. Trailer-specific bans,
articulation and turning clearance are not evaluated. No synthetic vehicle default
is presented as an actual measured vehicle parameter.

### WAF compatibility

The 2026-10-28 investigation confirmed that CRS 4.29.0 rule 930120 treated
the JSON argument **name** `json.vehicleProfile.coverageAcknowledged` as an
LFI match because its static dictionary contains `.coverage`. This is distinct
from rejection of a profile value by COP or SIM. Keep the wire field and its
validation unchanged.

The reviewed correction excludes only that argument name from rule 930120,
only for the COP host, exact `POST /api/v1/routing/route` URI and JSON content
type. Values, cookies, other argument names and other routes remain inspected.
The installed native engine passed 30 before/after rule-boundary checks,
including LFI values, cookies, other names, SQL injection and XSS. This isolated
result does not establish nginx deployment or authenticated phone acceptance;
record those separately in the operational release evidence.

Root installed rule 1000961 on 2026-10-28 at 18:30:51 UTC. The installation
receipt confirms valid nginx configuration, reload only, a protected original
backup and unchanged other configuration and authentication. Authenticated
Jízda route acceptance remains a separate check.
The external post-deployment probe reached COP authentication with the benign
field (401 without a session); an LFI value in the same field and the request
outside the exact route scope still received 403. These probes used synthetic
data and do not establish acceptance of an authenticated route.

The single subsequent physical-phone check with Jízda 1.2 (68), at
2026-10-28 19:39 UTC, fetched profiles successfully (200) and sent the selected
stored vehicle profile. The route request reached the application and returned
422 `ROUTING_RESTRICTIONS_RELAXATION_REQUIRED`, rather than WAF 403. This confirms
the WAF correction for that request, **not successful route acceptance**.
The start was the phone's approximate location, not the earlier public fixture.
No arrival/access point was selected. SIM's deployed code maps native warning
401 to this rejection; the bounded log check did not find correlated upstream
evidence. The affected point, edge or restriction therefore remains unknown.
Do not attribute the rejection to the Penny endpoint from historical tests.
The ordinary-car-only user-selected-arrival contract cannot be combined with
`vehicleProfile`; dropping the profile or relaxing restrictions is not a fix.

Source review of [Valhalla 3.8.3 multipass](https://github.com/valhalla/valhalla/blob/a60c7cbfc83e073f50887cd27e0109d02e6b64e5/src/thor/route_action.cc#L424-L475)
shows that warning 401 accompanies an expanded second search pass, including
candidate edges, hierarchy limits and destination-only handling. It does not
identify a prohibited road or prove that the route is safe. The warning is
request-scoped; the current protective rejection also covers warnings from
alternatives. No evidence establishes whether requesting only one variant would
change the physical-phone result. The COP/SIM profile mapping review found no
automatic car-to-truck conversion or enabled `ignore_*` flags. No isolated Czech
Penny graph was available for a real-engine comparison, and synthetic fixtures
must not be presented as that comparison.

### Subsequent physical-phone public-start acceptance

At 2026-10-28 19:49 UTC, the user changed only the start to the explicit public
fixture point, retaining the same stored vehicle profile and Penny destination.
Jízda 1.2 (68) received a fresh COP route response (200), and SDK validation
succeeded at 19:49:10.904 UTC. The displayed route was approximately 190 m / two
minutes. Recording remained off; no arrival opt-in, provider fallback or profile
substitution was used. This is successful authenticated physical-phone acceptance
for that explicit start, profile and destination. It does not explain the prior
422 from the phone's approximate position or establish acceptance of that start.
No further automatic phone requests were made.

### Approximate-origin planning candidate

The subsequent authorized indoor-planning investigation first uses the existing
`alternatives: 1` contract, requested from the outset only for the approximate-
origin planning preview. This is not a retry after a rejected three-variant
request. It preserves the actual start, destination, vehicle profile, snap limits,
closure policy and all returned evidence validation. Exact/manual-origin planning
and active navigation remain separate client flows. No origin-estimate contract,
automatic access substitution or acceptance of native warning 401 is introduced.
COP already admits this request; no production API update is necessary.

The COP mapped-profile suite passes 40 tests, including complete bound proofs
for a single returned route and propagation of a single-route 422 without another
request, profile substitution or changed route count. This is synthetic adapter
verification, not physical-phone proof that the approximate-origin issue is fixed.

The subsequent physical Jízda 1.2 (70) check at 2026-10-28 20:19 UTC confirmed
`approximateOrigin=true`, one requested variant and the stored mapped profile,
but again returned 422 `ROUTING_RESTRICTIONS_RELAXATION_REQUIRED`. Recording was
off and no automatic retry followed. Requesting only one route therefore does
not resolve this incident; the original multipass cause remains unknown.

### Explicit planning-start handoff after the unsuccessful indoor check

COP and SIM support the smallest compatible recovery without a new server
contract: the user selects a planning start on the map and explicitly confirms
it before a new request. Existing `from` is that selected point; the actual stored
vehicle profile, avoid options and every route safety check remain unchanged.
Label the result as a plan from the user's selected point. Keep the measured
approximate position and its uncertainty separately in local client state.
Never replace device GPS, start guidance automatically, assert lawful access or
join the unverified gap to the routed geometry/ETA. Cancelling selection sends
no request. Confirmation permits one new request; a typed rejection still has
no automatic retry or weaker fallback. Changed account, profile, target or start
must invalidate a pending result and require newly bound evidence.

Do not use `/routing/nearest-access` as an automatic substitute: its generic
request lacks a mapped vehicle profile and reviewed-closure binding. Even its
optional directed-edge/map match is not a profile/closure or legal-access proof.
Do not send extra origin-estimate/accuracy/provenance fields in the existing
strict mapped route request. No snap-limit, API schema or production runtime
change is required for a user-selected `from`.

The COP mapped-profile suite now passes 42 tests, including acceptance of fresh
query-bound closure/profile evidence for a changed explicit start and rejection
of evidence retained from the former start. Client implementation, installation
and a physical-phone test of this explicit selection flow remain separate gates.

### Correlated rejection diagnostics candidate

A subsequent user-selected street point near home also returned 422 on Jízda
1.2 (70), at 2026-10-28 20:39 UTC. That request retained the mapped profile and
requested three variants. Neither manual selection nor the earlier single-variant
attempt has therefore established a fix for the home-area route.

The COP source candidate now passes a separate, server-only context to SIM for
route and alternatives calls. It forwards only the documented opaque UUID
`X-Correlation-Id`, never identity credentials, request labels or profile values
as diagnostic headers. Invalid/legacy non-UUID values receive a fresh UUID
internally; the existing public error correlation echo remains compatible.
Tracing context does not enter the routing body, request hashes or route proofs.

Upstream 400/422/429/503 rejections produce a structured operational event with
only `routingCorrelationId`, `upstreamStatus` and a fixed classification:
`ROUTING_RESTRICTIONS_RELAXATION_REQUIRED` or `OTHER_REJECTION`. Provider messages,
arbitrary error codes, request bodies, positions and vehicle/identity values are
not included. No route acceptance rule changes. Detailed short-lived SIM
diagnostics are separately bounded and do not report an actual algorithm or
specific multipass cause unless the engine supplies that evidence.

Candidate verification: 83 tests across correlation, mapped-profile and arrival
suites; API TypeScript build and scoped ESLint pass. This paragraph records source
verification, not production activation or a successful home-origin route.
The broader routing regression run passes 158 tests with two existing opt-in
integration tests skipped. The two route-handler expectations now explicitly
check the additional opaque server context; request-body assertions remain intact.

### COP production deployment on 2026-10-28

The correlation change is deployed from source
`ff3220d83995e1fd49906cb9fb8015c03c9306cf`, image
`sha256:8ffcf1270e12a9a63828790f6dba5ccbcdad39e7a2cba7e36c348aaafad4788c`,
release `release-03cc24beaa954798aff155bfd67b39ae`. Independent post-deployment
checks confirmed the exact running image, healthy API with zero restarts,
HTTP 200 for live/readiness/dependencies and HTTP 401 for an unauthenticated
routing request. The installed runtime guard successfully reads the new active
release; its narrowly extended source preserves the historical account-erasure
and PostgreSQL proof chain. Configuration, credentials, networks and database
state were not changed by this image transition.

The initial global peer comparison failed because three unrelated AKB containers
restarted independently. That failed observation remains preserved. Their image,
container identity, configuration and networking stayed unchanged; subsequent
independent COP application acceptance passed. This is not a claim of global
infrastructure acceptance. Private evidence is retained in the infrastructure
workspace under `reports/cop-routing-off-6403ba7b-2bcf-4225-a3dd-5414738db933/`.

Detailed SIM diagnostics remain off at this COP acceptance point. This deployment
provides correlation evidence; it does not fix or validate the route from the
phone's approximate home position. No additional phone query or TestFlight
publication was performed for this deployment.

### Joint server acceptance with detailed diagnostics off

SIM situation-data API is deployed from
`09cd702ddc6ab27c714d2897eb56ec0e893e4cbe`, image
`sha256:e7175d383a4956f8ea64d5b80b23d1583d4ddca5904e87ee865a591c7fe6b569`.
Independent Root acceptance is `READY_OFF`, recorded at 2026-10-28 23:27:25 UTC
(2026-10-29 CET). The API is healthy with zero restarts. Live health and the
seven-profile catalog returned 200; the protected geo-routing endpoint rejected
an unauthenticated request with 401. DNS resolution and the configured native
Valhalla `/status` request succeeded, reporting version 3.8.3. These probes made
zero routing requests and zero provider-refresh requests.

The initial strict Docker configuration comparison remains recorded as failed.
Two original configuration files were read from the existing VM backup only in
Proxmox RAM. Their complete hashes exactly matched the pre-deployment inventory.
The independent witness accounts for every difference: generated container/image
metadata, reordered environment entries with identical unique key/value mappings,
empty DNS arrays represented as null, and a proven permutation of the same six
mounts. All other resource/security fields, effective mounts, networks and ports
match. Root and the SIM owner accepted only this exact representation-equivalent
case; no general comparison relaxation was introduced. No production VM or data
was restored, and the temporary backup reader was shut down.

The five original SIM Compose files and environment file stayed unchanged. The
additional persistent, application-owned image override is
`/srv/sim/docker-compose.routing-off-5a37914a-8a11-4ea7-9269-612350e77eee.json`;
future deployment must preserve its selection and the required image selectors.
The Root acceptance receipt is retained under
`/srv/x5-production/root-routing-off-release-5a37914a-8a11-4ea7-9269-612350e77eee/sim-independent-acceptance.json`
with SHA-256 `a231a8358bba75de28ab375996856d35488bcbe1235949482955682b54e3b007`.

Detailed diagnostics remain off. No physical iPhone acceptance, successful
approximate-origin route, actual native algorithm, multipass cause or new traffic
freshness guarantee follows from these server checks. A fresh user-controlled
request and a separately bounded diagnostic window remain necessary. No TestFlight
publication is authorized by this server release.

## Capabilities and assessment

### Planning-origin investigation on 2026-10-29 (design pending)

One physical Jízda 70 request returned `ROUTING_LOCATION_NOT_ROUTABLE` at
`native_request`, costing auto, requested time mode none, one requested variant,
zero returned routes and no warning codes. Algorithm and multipass cause were
not reported; the failing endpoint is unknown. Source mapping for this branch is
Valhalla HTTP 400 / numeric 171. No geometry existed for closure validation;
this is not evidence of a closure failure. The diagnostic window was closed
after capture and SIM remained healthy. No retry or TestFlight upload occurred.

Client source review found that Jízda retains the original CLLocation accuracy
and timestamp, but currently sends only coordinates and an approximate flag into
its preview calculation; COP's route request has no uncertainty fields. Existing
client planning limits are 900 seconds and 5000 metres. Approximate may mean age
or coarse accuracy, so neither cause is established for the captured request.
SIM's current known-closure route uses at most 25 metres for every waypoint's
native search and subsequent snap validation.

SIM ADR 0050 proposes a separate planning preview with an immutable measured
anchor and an explicit user-selected planning access point. It is not a frozen
wire contract or implemented API. COP requires a distinct typed result and
purpose-bound verification, unchanged full vehicle/closure/geometry safeguards,
bounded discovery and post-await identity/input revalidation. Manual/address
origins must not fabricate measured accuracy. Candidate selection grants no road
access and must not silently move GPS or enable navigation/recording.

Before implementation, jointly resolve client/server age and accuracy bounds,
actual candidate-provider capabilities and proof binding. Avoid introducing a
new signing secret solely for selection when existing, correctly domain-separated
verification can meet the requirements. COP's binding OpenAPI and unknown-field
rejection remain unchanged until that review; no additional live query is implied.

`GET /api/v1/routing/profiles` adds optional `mappedProfiles`, version
`sim-mapped-road-profile-capabilities-v1`. Keep existing strict `capabilities`
separate. Availability is `disabled` or `requires_runtime_validation`; the latter
is not proof that every requested destination/profile is available. Check each
intent and supported fields. Strict guarantees remain false.

Each raw variant and corresponding map feature must contain identical
`mappedProfileAssessment`, version `sim-mapped-road-profile-assessment-v1`.
COP verifies exact applied profile, `profileHash`, canonical normalized query
`requestHash`, geometry hash, actual costing/version, applied fields, source/map
identity and expiry. Every variant still requires verified known-closure evidence.
Validation occurs before dropping variants. Assessment expiry cannot outlive the
closure evidence; cache only to its real deadline.

`lastMile.target` is the requested coordinate; `mappedEndpoint` must be the final
vertex of rendered road geometry. Only exact coordinate equality permits
`mapped_target`. Otherwise `target_guidance_only` means a non-navigable remaining
bearing/distance to the target. Do not append this segment to road geometry or
steps, include it in road ETA, or present it as verified arrival. The independent
endpoint distance must be at most 25 m. A more distant unmapped target is rejected
as `ROUTING_TARGET_NOT_ROUTABLE`; broader last-mile graph discovery is unsupported
in this release.

`driverDeclaredAuthorization` omitted/false uses mapped access. True requests an
engine permission exemption and is explicitly unsupported (422). The accepted
engine has no scoped private-access grant; blanket `ignore_access` is not used.
This is an engine capability limit, not an adjudication of the driver's permission.
4x4 never ignores reviewed closures, one-way/access restrictions or physical limits.

## Errors and integration

Preserve the COP error envelope and correlation ID. Invalid/conflicting inputs
return 400; unsupported profile/target requests 422; quota 429; unavailable
engine/source/graph 503. Invalid returned assessment becomes COP 502
`ROUTING_VEHICLE_PROFILE_INVALID`. Keep `Retry-After` where supplied. None of these
may retry as a car, switch to Apple routing or contact SIM/Valhalla directly.

Jízda owns its current SDK changes; do not overwrite local voice/measurement or
routing code. Add typed DTOs/capabilities/assessment decoding to the existing
transport, preserve query and all variant assessments, and apply the same exact
canonical vectors as [known closures](26_JIZDA_KNOWN_CLOSURES.md). Persist the
selected intent and actual whole-combination parameters in ride drafts/backups;
show incomplete coverage and target-guidance state in the existing flow.

## Verification and release status

COP tests cover all four intents, immutable wire identity, profile/hash/costing,
source expiry, graph and geometry mismatch, applied fields, whole-combination and
axle consistency, unsolicited/missing assessments, feature binding, endpoint state
and distance, conflicting strict/legacy requests and no downgrade errors.

The released server revisions and actual joint evidence are recorded below.
Strict routes and driver collection remain disabled; existing ordinary closure
routing is preserved. This server acceptance does not establish physical iPhone
navigation or authenticated end-user acceptance.

### COP local candidate verification

The exact shared synthetic SIM fixture for all four intents and two distinct
variants per intent passed through the COP adapter. It remains synthetic contract
evidence, not live restrictions or navigation evidence. Final targeted suite:
113 passed. Full COP suite: 1215 passed / one skipped. Final lint/typecheck and
API/dependency build passed. Skeleton and eleven schema JSON files passed; runtime
AJV compilation and semantic OpenAPI identity are covered by the contract tests.
OpenAPI validation passed with 25 warnings (six additional conditional-schema warnings
in the shared fragment and typed request conditions). The final SIM fixture
changed only explanatory limitations for missing optional vehicle parameters; the
updated exact fixture passed the 38-test profile suite without code changes.

## Joint server production acceptance on 2026-10-04

| Component | Actual deployed revision |
| --- | --- |
| COP API | `d514f4ff10fa57cabbb5502a774f3868eee9e9fc` |
| SIM situation/routing API | `9592372a3cdccce835435a653cc1a44304cbf8a9` |

Later fixture/documentation commits do not change the released code. The exact
shared schema and final synthetic fixture were independently compared against
immutable SIM `9592372`; copies in COP match. Operational image digests, private
source proof, environment fingerprints and rollback records are retained privately.

- SIM reports 294 tests passed using an isolated real database, plus 52 native
  Valhalla 3.8.3 cases on an independently generated synthetic graph. COP reviewed
  the reproducible harness: small/large car and truck dimensions/weight, accepted
  bounds, truck axle load/count, whole-combination trailer length/weight, mapped
  gravel access and rejection of motor-vehicle access restrictions in both directions.
  This proves engine behavior on test data, not complete real-road restriction coverage.
- The packaged COP candidate passed isolated tests without networking: all four
  intents and two distinct synthetic variants, exact profile/hash bindings, rejection
  of wrong costing/target and typed options before contacting the upstream service.
- A temporary COP candidate then contacted actual deployed SIM using only the same
  existing internal networks. It passed all eight mobile queries (four intents in
  both directions), had no public port and was removed. No secrets were copied.
- After API-only COP deployment, the actual running configured adapter independently
  passed the same eight queries: `alternatives=3`, steps/road attributes enabled,
  one native returned variant, 3726 m forward / 3682 m reverse, nine complete indexed
  maneuvers, verified known-closure evidence and current profile/geometry/query/feature/
  engine/dataset/expiry bindings. Truck uses truck costing; other intents use auto.
  The requested count does not cause fabricated alternatives. All these actual
  endpoints were displaced within the accepted tolerance and correctly labelled
  `target_guidance_only`; none was presented as exact arrival.
- Actual scoped-permission and non-truck axle requests returned 422
  `ROUTING_PROFILE_UNSUPPORTED`, with no substitute car route. Unknown options,
  future departure, hazards, invalid/expired assessments and upstream error/no-fallback
  behavior remain covered by isolated server tests; no live outage was injected.
- Existing ordinary car requests remain available. Legacy alternatives 0 and 5
  normalized to 1 and 3 respectively, with one genuine route and ten indexed
  maneuvers each. A fresh strict request returned 422 `ROUTING_SAFETY_UNSUPPORTED`.
- Actual image identity, readiness and health passed. Public readiness returned 200;
  anonymous and malformed routing identities returned 401. A brief API restart
  occurred. Existing environment, networks, ports and secret-file checksums were
  preserved. Driver intake remains false; cleanup/revocation remain enabled.
- Previous images/configuration selection are retained for rollback; a live rollback
  roundtrip was not performed. The active graph remains the accepted map built on
  2026-09-29; no newer graph activation is claimed.

### Remaining acceptance and limitations

Jízda owns the local SDK/UI/persistence/draft/backup integration. COP did not
overwrite its voice, measurement or routing files. End-user OIDC and physical
iPhone navigation, profile changes while driving and displayed target guidance
remain unverified. Neither the synthetic engine cases nor the server pilot replaces
those checks. Wider unmapped last-mile routing, scoped private/forestry permission
exemptions and trailer articulation/specific bans remain explicitly unsupported.

Chroma retrieval was available for the primary managed repository. Reindexing the
release worktree was rejected because this MCP root is not managed; no successful
release index update is claimed. Selected current files were inspected directly.

Diagnostic logger failure is tested separately for both route endpoints: it cannot
replace the original 422, alter its public correlation echo or trigger another
upstream call. Only the new diagnostic emission is caught, not routing failures.

### Assisted planning: authenticated actor boundary (implementation in progress)

The proposed separate planning-origin operations are not deployed. Ordinary COP
routing currently forwards correlation and request time, but no SIM service bearer
or user assertion. SIM has a separate existing geo service-principal lookup; a
read-only infrastructure inventory confirmed principal `cop`, but no corresponding
named credential configuration in the running COP API. This is not evidence of a
working authenticated planning connection.

`routing-planning-actor.ts` derives a domain-separated SHA-256 assertion only from
the existing verified-OIDC request WeakMap. It ignores client headers/body and
decoded-only identities, rejects delimiter ambiguity, and loses authority if the
authenticated bearer changes. It supplies quota/request binding under a separately
authenticated, explicitly allowed COP service; the hash itself is no credential.
Seven isolated tests cover this boundary, including account isolation, refresh,
invalid signature/issuer, lab identity and forged actor input. No production call
or new endpoint activation was performed for these tests.

Joint wire review resolved the full mapped-profile facts, conditional candidate
selection, server-issued dataset for manual planning and separate SDK-verifiable
versus actor-bound hashes. A final additive review restored actual closure evidence;
guard constants alone cannot replace the existing COP verifier.

#### New operations and state

- `POST /api/v1/routing/planning-origin/candidates` accepts a strict `context` with
  version/purpose, UUID contextId, original measured or explicit manual origin,
  destination and complete mapped vehicle profile. Measured metadata preserves the
  original timestamp, accuracy in metres and full/reduced authorization. Accepted
  age is 0–900 seconds; accuracy is greater than zero and at most 5000 metres.
- One locate query searches within 500 metres independently of that accuracy and
  returns zero to three choices. Distances use metres; heading uses degrees in
  [0, 360). Directions are graph candidates, never legal/dimension verification.
  Opposite directions and distinct carriageways must not be silently collapsed.
  Discovery validity is at most 120 seconds and bounded by sample/map validity.
- `POST /api/v1/routing/planning-origin/preview` requires the unchanged context,
  discovery binding/dataset and explicit selection. Candidate selection requires
  its ID/direction metadata; manual selection forbids those fields. Even manual
  planning first obtains a discovery binding, including a `no_candidates` result.
  A selection must remain within 500 metres of the context origin. IDs have no
  historical issuance guarantee in this stateless design and never force an edge.
- Preview performs one fully guarded route computation. The response has a distinct
  `previewPathId`, false navigation/measurement eligibility, an unknown non-navigable
  connector and a purpose-specific assessment. Full original mapped facts and
  `knownClosuresEvidence` remain independently checked. No ordinary route assessment
  is exposed. Saving a plan does not preserve expired authority; departure obtains
  a fresh profile, identity and ordinary route. Independent GPS recording is separate.

The exact schemas are in [binding OpenAPI](../../openapi/openapi.json) and
[runtime schema copy](../api/schemas/planning-origin-v1.schemas.json). The shared
[synthetic fixture](../api/examples/planning-origin-v1.sim-fixture.json) was exported
by SIM code and contains no live/private coordinate evidence or native acceptance.
Its SHA-256 is `b3f9556c89e4d08e60e2f6c99c6cb82cfb3396e0ed993502b9d4baed4bd688bb`.
The accepted SIM fragment SHA-256 is
`82c81759ab8b59b3ead1a311d401029492c72e00b6770c4fc598c1ccb943c08e`.

#### Authentication, limits and deployment configuration

COP accepts only its verified OIDC/BFF identity. It derives
`SHA256("cop-planning-actor-v1" + NUL + issuer + NUL + subject)` server-side and
overwrites `X-COP-Planning-Actor`. Neither body/query identity nor a client header
selects the actor, credential or provider. The OAuth bearer/cookie is never sent
to SIM. The new assertion is pseudonymous quota/request context, not an access key.

SIM authenticates its existing geo bearer principal `cop` and requires explicit
membership in `PLANNING_ORIGIN_ALLOWED_SERVICE_ACTORS` (empty means deny). COP uses
`COP_ROUTING_PLANNING_ENABLED=false` by default and a separate
`COP_ROUTING_PLANNING_SERVICE_TOKEN`. No absent setting borrows an AI, erasure or
other token. Only production secret files may hold the provisioned geo credential.
The existing routing base URL/timeout apply; no public port or network change is
introduced. SIM applies its geo requests-per-minute limit to both service and
opaque actor (default 60), across both operations; counters are bounded and ephemeral.

COP bounds request bodies to 32 KiB and response bodies to 2 MiB, rejects redirects,
and retains its timeout throughout response reading. Final validity is rechecked
after the account-eligibility check completes.
Responses are `no-store`; no result cache/single-flight exists. Account eligibility
is checked before and after the upstream call. Operational request logs keep only
the fixed planning operation and request correlation; no raw body/parser text,
headers, actor, coordinates, IP or free path segments. There are no new analytics.

Errors preserve the COP envelope. Invalid inputs return 400, missing user identity
401, changed bindings 409, rejected/stale planning inputs 422, body excess 413,
quota 429 with bounded Retry-After, invalid evidence 502, and disabled/unconfigured
or unavailable service 503. A SIM service-auth failure is COP 503, not a user-login
401. No error retries, direct Valhalla/OpenAI calls or silent manual substitution.

Production activation remains a separate recorded step after image content/start,
bounded native and authenticated public acceptance. Current source alone does not
prove that the original phone-to-Penny request succeeds. Rollback disables the COP
flag and SIM planning allowlist, then restores the accepted image selectors; ordinary
routing remains unchanged. Keep the approved prior images/configuration available.

Source verification on 2026-10-29: routing/identity/privacy regression 216 passed
with two existing opt-in skips; two packaging/contract-copy tests passed; contract
suite 29 passed. API TypeScript build, scoped ESLint, JSON Schema validation,
skeleton and diff checks passed. OpenAPI lint succeeded with 32 non-fatal warnings
(including inherited conditional-schema composition diagnostics). All pre-existing
OpenAPI paths and schemas were compared semantically and remain unchanged.
The first restricted regression could not open localhost sockets; the unchanged
OIDC tests and final regression passed with loopback permitted. No production or
external-provider request was used to obtain these results. SIM independently
reviewed the COP implementation without a blocking source finding. Native engine,
image startup, production and physical device results are separate records.
