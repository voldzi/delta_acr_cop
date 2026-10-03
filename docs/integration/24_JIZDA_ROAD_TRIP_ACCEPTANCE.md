# 24. COP–SIM–Jízda road-trip delivery and acceptance

Date: 2026-10-03. Status: published optional integration, NOT deployed or activated.
This record addresses Jízda's `docs/routing-handoff.md`. It does not authorize
production-data changes, new vehicle-profile activation or measurement collection.

## Published revisions

| Component | Branch | Implementation revision |
| --- | --- | --- |
| COP API / JSON OpenAPI | `codex/jizda-routing-contract` | `e721d276e03982deee43fcfccaea398a7acaa762` |
| COP Mobile / CSMCommunicationKit | `codex/jizda-routing-safety` | `b1d47d09e86b475c6a4a792cf9d94d87caf6f726` |
| SIM / Valhalla adapter | `codex/jizda-routing-safety` | `ffc49d83d78167610741fbd248eb039bee47459a` |

This report is a subsequent documentation commit. Revisions above identify the
implementation; repository HEAD may additionally contain this acceptance record.
Jízda still uses a local SDK path: publishing a branch does not update that path.
Unrelated AI and China voice changes in the main checkouts have been preserved.

## Delivered behavior and boundaries

The [contract and integration steps](23_JIZDA_ROAD_TRIP_CONTRACT.md) and authoritative
[COP JSON OpenAPI](../../openapi/openapi.json) define `sim-road-trip-v1`, typed
capabilities, immutable trip snapshots and per-variant assessment. The SDK exposes
`drivingCapabilities()`, `drivingRoutes(from:to:trip:alternatives:)`, and
`navigationRoutes(for:trip,at:)`. Existing authenticated COP endpoints remain.

COP rejects invalid values and any unverifiable alternative; parameters are not
silently discarded. Hashes bind the whole trip and actual geometry. Errors retain
HTTP 400/422/429/503, machine codes, Retry-After and COP correlationId. A strict
request never becomes MapKit, an emergency profile or an unconstrained route.

Car/auto and commercial truck/truck are prepared for runtime validation. Trailer,
axles, planned departure and approved entrances remain explicitly unsupported by
SIM. One-direction closures remain unsupported; reviewed both-direction polygons
are the current source boundary. Mapped vehicle restrictions remain incomplete.
These limitations are returned or rejected rather than hidden.

The SDK revision also publishes the pre-existing local tunnel DTO/test additions,
so adopting this branch does not remove Jízda's route-bound tunnel decoding.
No roundabout exit bearing is invented. The actual 5-versus-4 exit dispute remains
unresolved pending junction/vehicle/direction verification.

## Verified in this delivery

| Scope | Result | Evidence / limits |
| --- | --- | --- |
| COP full unit/integration suite | 1127 passed, 1 skipped | Full run before final enrichment-flag passthrough; final routing suite covers that change |
| Final COP routing suites | 26 passed | Request validation, every-variant identity/geometry/expiry, status propagation, legacy compatibility and actual synthetic SIM fixture |
| COP type check / lint / build | Passed | Build retains existing web chunk-size warnings |
| Skeleton / JSON schemas | Passed / 9 validated | Chroma retrieval and reindex unavailable: server connection failed |
| JSON OpenAPI | Valid, 18 warnings | No errors; includes conditional-schema linter warnings from shared schemas |
| SDK routing / HTTP / tunnel suites | 22 passed | Xcode 27.0 (27A266a), iOS 27.0 simulator; actual request body and authenticated capability transport checked |
| SDK device fixtures / project / skeleton | 19 fixtures valid; checks passed | Does not establish real-device behavior |
| COP Mobile full application check | FAILED | Two unchanged chat UI tests could not find `chat.workspace`; app-wide release gate is not green |
| COP ↔ SIM actual HTTP boundary | Passed | SIM HTTP app used synthetic engine/closure dependencies; COP returned 200/two variants, anonymous 401 and preserved full outgoing body |
| SIM full suite / SDA routing | 361 passed, 6 PostgreSQL skipped; SDA 218 passed, including 26 new routing tests | Typecheck/build/skeleton/OpenAPI valid; 143 paths / 245 schemas |
| Actual Valhalla 3.8.3 | Payload and synthetic polygon compatibility passed | tileset 1790679143; auto/truck accepted dimensions, kg→t, via and snap25m; forward/reverse detoured outside per-request polygon. This does not validate real restrictions or closure-source coverage |
| Physical iPhone / actual Jízda drive | Not performed | SDK adoption and joint device acceptance still required |

All nine shared schema definitions match SIM after the prescribed RoadTrip name
and reference prefixing. SIM rejects engine warnings/clamping and checks surplus
alternatives before limiting the returned count. Strict fire/flood avoidance is
422 while an approved source is unavailable. Legacy fallback does not label a
dropped engine exclusion as applied.

The cross-runtime fixture is committed as
`docs/api/examples/road-trip-v1.sim-{request,response,manifest}.json`. Canonical
request hashes matched the implementations in both repositories. Authenticated
COP `buildServer.inject` accepted the real SIM HTTP response; unauthorized COP
requests did not issue another upstream call. This is a server boundary test,
not a production OIDC session or actual driving test.

The fixture uses an injected synthetic Valhalla engine and reviewed closure source
at a fixed `2026-10-03T12:00:00Z`. It is already expired at wall-clock time and must
not be treated as a live safety assessment or a confirmed real closure.

Local evidence:

- `/private/tmp/cop-sim-routing-boundary-result.json`
- `/private/tmp/cop-routing-tests.log`
- `/private/tmp/cop-routing-lint.log`, `/private/tmp/cop-routing-build.log`
- `/private/tmp/cop-routing-openapi.log`
- `/private/tmp/cop-routing-sdk-test.log`
- `/private/tmp/cop-routing-sdk-build/Logs/Test/Test-CSMCommunicationKit-Package-2026.10.03_13-43-50-+0200.xcresult`
- `/private/tmp/cop-routing-mobile-check.log`
- `/Users/voldzi/Library/Developer/Xcode/DerivedData/COPMobile-anroxvotfwpldygnocrxgvyyfaak/Logs/Test/Test-COPMobile-2026.10.03_13-31-13-+0200.xcresult`

The failing app tests are
`testChatRemainsReachableAfterMapFailure` and `testChatRemainsReachableWhileMapLoads`.
Their cause has not been isolated; unchanged test files do not prove a pre-existing
failure. The full check stopped before later package/accessibility stages; targeted
SDK tests were run independently.

## Production status

No routing deployment, secret update, network change or profile activation was
performed. Read-only COP production check: `/srv/cop` on `docker.home.cz`, commit
`d70e64c`, healthy API container, image
`sha256:ecb258c535d1b09f11626f7de23b0bb698119526caf0cdbf945fd5033707db57`.
The unrelated untracked AI Router overlay was preserved.

SIM read-only baseline: checkout `dba75d609f4db3f398399e1178346a10c425a9f5`,
healthy/live+ready 200, no public SDA port; running image
`sha256:00b842865ef8d31610a57e69fcfd34c65a9a8f31c9b9731a73c16c5ea0a7f882`
from measurement runtime `b3e94c9b02e480268fd8b51c284069602b9fa2c1`. The new
routing revision is not running there. SIM intake remains false and revocation
true.

SIM strict routing is default-off (`ROUTING_STRICT_TRIPS_ENABLED=false`). Exact
accepted engine versions and a reviewed graph-bound closure snapshot must be
configured and validated before any activation. No synthetic closure was inserted
into production. Voluntary GPS intake and live aggregate ETA remain inactive.

SIM detailed evidence and rollback runbook:

- [SIM acceptance record](https://github.com/voldzi/delta_acr_sim/blob/ffc49d83d78167610741fbd248eb039bee47459a/docs/archive/2026-10-03_STRICT_ROAD_TRIP_ACCEPTANCE.md)
- [SIM strict routing runbook](https://github.com/voldzi/delta_acr_sim/blob/ffc49d83d78167610741fbd248eb039bee47459a/docs/runbooks/18_STRICT_ROAD_TRIP_ROUTING.md)

## Handoff to Jízda and next acceptance

1. Pin SDK revision `b1d47d09e86b475c6a4a792cf9d94d87caf6f726` or update the local
   package checkout explicitly, preserving unrelated work. Use the contract marker
   `CSMCommunicationRuntime.roadTripContractVersion`.
2. Implement the exact steps in handoff 23: capabilities first, complete actual
   vehicle values in m/kg, fresh request UUID, frozen snapshot, typed via/stop,
   strict overload, every-route validity check and no fallback on strict errors.
3. Keep new profiles inactive while capability flag is off or any requirement is
   unsupported. Do not infer trailer/axle/entrance support from schema availability.
4. Jointly verify production engine and graph update cadence, approved closure
   source/coverage, expiry/revocation/revision races, all alternatives and stop legs,
   under/over mapped vehicle limits and actual reroutes before deployment activation.
5. Confirm the reported III/44520 bridge closure (50.1257919/17.3629376, OSM
   48835964) against an authoritative current source. No permanent mobile blacklist.
6. Complete real-iPhone roundabout entry/exit count and direction, GPS/tunnel
   recovery, speech, portrait/landscape and Dynamic Type. Resolve the app-wide
   chat UI gate before claiming a green COP Mobile release.
7. Treat approved entrances/last-mile and one-direction edge closures as later
   explicitly supported capabilities. Unknown access is not permission.

Publishing and passing synthetic boundary tests do not complete these acceptance
gates. Production deployment and activating profiles are separate decisions.
