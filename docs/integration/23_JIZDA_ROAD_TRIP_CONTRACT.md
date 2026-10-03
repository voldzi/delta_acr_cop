# 23. Jízda: immutable road-trip routing through COP

Implementation contract: `trip.version=sim-road-trip-v1`, assessment
`sim-road-trip-assessment-v1`, capabilities `sim-road-trip-capabilities-v1`.
SIM owns engine routing, graph freshness and closure truth. COP owns the
existing authenticated facade; CSMCommunicationKit contacts COP only.
This does not activate profiles, real GPS collection or live measurement ETA.

## Compatibility and transport

Use existing GET `/api/v1/routing/profiles` and POST `/api/v1/routing/route`
or `/alternatives`. The catalog adds optional `capabilities`; absence means no
strict-trip support. `requires_runtime_validation` is not a healthy-source claim.
Legacy responses, four-field `vehicleAssessment` and plain-car SDK calls remain
readable. Legacy four-field weight is tonnes; the NEW complete trip uses kg.
New optional legacy `via` (ordered, maximum 12) and `departureTime` survive COP.
Malformed coordinates, unknown fields and invalid values fail 400 rather than
being clamped, discarded or converted into an unconstrained car request.

A strict request supplies top-level `profileId=car`, `from`, `to`,
`avoid` including `road_closure`, optional alternatives 1..3, and `trip`.
Do not combine trip with legacy vehicle/via/departureTime. `trip.intent` selects
ordinary-car `auto` or commercial-truck `truck`; neither grants emergency access.
The exact shared schemas are in JSON OpenAPI as `RoadTrip*` and in
`docs/api/schemas/road-trip-v1.schemas.json`, copied from SIM's binding source.

## Immutable values and units

| Field | Unit / bound | Meaning |
| --- | --- | --- |
| heightM / widthM / lengthM | m; >0, max 8 / 5 / 30 | Actual whole loaded combination |
| loadedWeightKg | kg; >0, max 100000 | Actual loaded total, including attached trailer |
| axleLoadKg | kg; >0, max 40000 and <= total | Greatest loaded axle; currently unsupported |
| axleCount | integer 2..10 | Currently unsupported |
| trailer | attached=false alone, or complete dimensions/weight/axles | Trailer part, never implicitly added to total; currently unsupported |
| departure | now, or depart_at + UTC timestamp ending Z | Planned departure currently unsupported |
| preferences | explicit avoidTolls / preferPaved booleans | Costs/preferences, separate from mandatory legal constraints |
| requirements | roadClosures/legalAccess/vehicleLimits=mandatory | Cannot be downgraded by client or fallback |
| waypoints | 0..12 ordered via/stop with point | All legs use the same whole-trip requirements |
| destination | road_point or approved_entrance+entranceId | Entrance requires authoritative server lookup; currently unsupported |

Bounds validate software input; they are not legal limits. Unknown required
vehicle values must not be guessed. Approved entrance/4x4 capability never implies
permission to drive cross-country, in a forest or on private roads.

## Every variant is bound to the request and geometry

SIM hashes canonical JSON `{from,to,avoid:sortedUnique,trip}` using SHA-256.
Object keys sort recursively, array order stays intact, numbers are not rounded,
and labels remain part of identity. Every variant carries `assessment` with
requestId/requestHash/appliedHash/appliedTrip plus its own canonical GeoJSON
geometryHash. COP verifies hashes against the actual outgoing body and returned
geometry before filtering routes; an unsafe alternative cannot be hidden by
keeping only the primary. Route features must match the assessed variant too.

COP requires the actual Valhalla engine, no fallback, intent-appropriate costing,
all mandatory vehicle fields applied, all waypoint counts applied, current graph
metadata matching response coverage, reviewed closure snapshot and a result
validity strictly in the future and no later than closure validity. The client
must revalidate validity during navigation, variant selection and reroute. Each
new calculation gets a fresh requestId; preserve the same trip requirements.
Mapped vehicle restrictions remain incomplete: this is not absolute access truth.

Structured `steps[].roundabout` adds enter/exit phase, valhalla_maneuver source,
provider_supplied/unknown countState, positive exitCount only when supplied, and
optional provider exitRoadNames/signNames. Invalid structured metadata is omitted.
Existing roundaboutExitCount is retained. No fabricated bearings or count inferred
from screenshots. Shape indexes always refer to the variant's complete geometry.

## Errors and fallback

400 invalid input, 422 unsupported mandatory requirements, 429 limits, 503 missing/
stale/changed safety source, 502 engine failure or unverified assessment. COP
preserves SIM's ROUTING_* machine code and numeric Retry-After in its existing
correlationId envelope, without returning upstream endpoint/diagnostics. No
automatic retry into a different engine or unconstrained request. Strict fire/flood
avoidance is 422 without an approved source; engine warnings/clamping are 502.
Legacy fallback cannot claim an engine exclusion that it discarded.

Use `navigationRoutes(for:trip,at:)` for strict routes. Never use legacy
`requiresMapKitFallback` to authorize fallback for a strict trip. The new runtime
facade throws for empty/old/unverified responses; legacy MapKit fallback remains
available only through the old unrestricted integration under host policy.

## SDK handoff to Jízda

Published revisions and verification results are recorded in the
[acceptance report](24_JIZDA_ROAD_TRIP_ACCEPTANCE.md).
SDK contract marker: `CSMCommunicationRuntime.roadTripContractVersion`.

1. Pin the published COP Mobile revision; Jízda's local path dependency otherwise
   keeps using its current checkout. Preserve unrelated China voice work.
2. Read `drivingCapabilities()` through existing OIDC. Missing capabilities,
   disabled flag or unsupported intent/fields keep new profiles inactive.
3. Create immutable `CSMRoadTrip` from actual selected-vehicle values; weight kg.
   Freeze preferences, total loaded weight, stops and destination with the trip.
4. Call `drivingRoutes(from:to:trip:alternatives:)`. No direct SIM/Valhalla client,
   emergency substitute, Apple fallback or silent omission on errors.
5. Select only `navigationRoutes(for:trip,at:)`, recheck expiry, cancel stale
   responses when the request/vehicle changes, and preserve snapshot on recovery.
6. Show mapped restriction coverage and uncertainty. Render structured roundabout
   metadata without inventing exit bearings or legal rights.

Examples in `docs/api/examples/road-trip-v1.request.json` and source test fixtures
are synthetic boundary examples, not proof of real closures or passable roads.

## Activation acceptance still required

Authoritative graph-bound closure coverage and engine restriction validation are
required before activation. The reported III/44520 bridge, OSM 48835964,
50.1257919/17.3629376 remains an unverified report, not a permanent blacklist.
Check both directions, off-corridor/route-center closures, expiry/revocation,
revision changes during calculation, all variants/stops/reroutes/fallbacks,
under/over mapped height/weight, parallel roads, and graph update cadence.

A source that only supports both-direction polygons must declare one-direction
closures unsupported. A SRTI representative point is insufficient. Do not insert
synthetic or invented closures into production to manufacture acceptance.

Physical iPhone tests must cover actual roundabout entry/direction/vehicle exits
(the screenshot count 5 vs 4 is unresolved), GPS/tunnel recovery, speech,
portrait/landscape, Dynamic Type and approved-entrance/last-mile boundaries.
Successful builds and synthetic fixtures do not complete these gates.

The `road-trip-v1.sim-{request,response,manifest}.json` examples capture an actual
SIM HTTP app response using injected SYNTHETIC Valhalla/closure dependencies at
2026-10-03T12:00:00Z. COP checked the response through its authenticated handler:
200/two variants, anonymous401, equal canonical hashes, all outgoing flags kept.
The dated fixture is expired at wall-clock time and must never be used as live
closure evidence or published as a production navigation result.
