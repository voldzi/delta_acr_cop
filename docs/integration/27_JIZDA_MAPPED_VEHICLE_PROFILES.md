# 27. Explicit ordinary vehicle profiles for Jízda

Date: 2026-10-04. Joint implementation in progress; production activation and
physical-device acceptance are not yet claimed.

## Wire contract

Use the existing authenticated `POST /api/v1/routing/route` or `/alternatives`.
Jízda does not call SIM directly. Set `profileId: "car"` explicitly and add
`vehicleProfile`. Do not combine it with legacy `vehicle` or strict `trip`.
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

## Capabilities and assessment

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

Actual engine restrictions, published SIM fixture identity, production release
and physical iPhone checks will be recorded after joint verification. Existing
strict routes and driver collection remain disabled. Existing ordinary closure
routing is preserved; this draft does not claim a new deployed profile release.

### COP local candidate verification

The exact shared synthetic SIM fixture for all four intents and two distinct
variants per intent passed through the COP adapter. It remains synthetic contract
evidence, not live restrictions or navigation evidence. Final targeted suite:
110 passed. Full COP suite: 1212 passed / one skipped. Final lint/typecheck and
API/dependency build passed. Skeleton and eleven schema JSON files passed; runtime
AJV compilation and semantic OpenAPI identity are covered by the contract tests.
OpenAPI validation passed with 22 warnings (three additional composition warnings
in the exact shared fragment). Live engine and production profile acceptance are
not yet claimed.
