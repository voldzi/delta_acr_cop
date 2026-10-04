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
