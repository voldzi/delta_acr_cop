# Driver navigation and reporting release

Release date: 2026-09-21. Scope: authoritative COP/SIM navigation in Jizda,
traffic freshness, alternatives on iPhone/CarPlay, confirmed Siri reporting,
source-only lane advice and durable directional road-report enrichment.
This is a tested pilot candidate, not completed physical-driving acceptance.

## Versions and publication

- Jizda: `675cbbb`, branch `codex/stabilizace-aplikace`.
- COP Mobile/shared kit: `987aad2`, branch `codex/native-communications`.
- SIM runtime: `f5f7a74`, main; `c0a7f61` additionally records reviewed local
  Chroma configuration/path updates without runtime changes.
- COP web runtime: `7ad8f9b`; API runtime: `c5f2ef5`.
- Final deployment verified: both COP API and SIM situation-data-api containers
  are healthy; database and live-routing smoke pass after readiness.

All four source repositories are published to GitHub. Native binaries were
built locally; no App Store/TestFlight publication, phone installation or
physical drive is claimed. Earlier release evidence is preserved in
[the archived first release](../archive/2026-09-21_DRIVER_REPORTING_FIRST_RELEASE.md).

## Validation

- COP: typecheck/ESLint, 132 test files / 1,059 tests, schema/OpenAPI validation,
  build, skeleton, bundle budgets and static-runtime serving smoke pass.
  OpenAPI retains six existing warnings; Cesium retains its existing chunk
  advisory while passing the explicit size budget.
- SIM situation-data-api: typecheck, build, 6 test files / 94 tests, skeleton,
  JSON OpenAPI generation check and validation pass. Tests cover ordered/reversed
  leg joins, arrival maneuvers, provenance, parallel-road ambiguity and heading.
- COP Mobile: 28 unit, 4 UI and 2 accessibility tests pass. Final shared-kit
  suite: 53 tests pass, including route DTOs, missing/degraded/stale traffic,
  COP-only authenticated transport, clustered feed and lane masks.
- Jizda: 78 domain tests pass. Debug simulator, Release simulator and signed
  Debug `generic/platform=iOS` builds pass, including the watch companion.
  Xcode 27.0 / SDK 27; app minimum iOS/watchOS 27. Warnings remain errors.
  Independent `codesign --verify --deep --strict` passes with system Keychain
  access (valid on disk and designated requirement satisfied); the sandbox-only
  attempt lacked certificate trust access. Info.plist minimum OS is 27.0.
- Real COP response was decoded by the production Swift DTOs and date decoder:
  one valid route, 8 maneuvers, 890 seconds for the second test coordinate pair.
- The production matcher is compiled directly by
  `Jizda/scripts/test-navigation-replay.sh`. Eight scenarios pass: city turns
  and noise; 1,000 motorway samples; opposite parallel carriageways; off-route
  deviation; reroute identity; roundabout loop; offline/tunnel projection bounds;
  invalid GPS. Only route input is doubled, not the matching algorithm.
- One optimized macOS replay: matcher median 0.00275 ms, p95 0.00304 ms, max
  0.666 ms over 1,000 synthetic samples. This measures only this matcher on this
  Mac; it is not an iPhone latency, battery, thermal or accuracy claim.

Local logs: `/tmp/cop-navigation-final-{lint,tests,build}.log`,
`/tmp/cop-mobile-navigation-final.log`, `/tmp/cop-native-lanes-tests.log`,
`/tmp/sim-road-final-{typecheck,tests,build,openapi}.log`,
`/tmp/jizda-navigation-{domain-final,replay,release-final,signed-final}.log`.
Temporary logs are session evidence; the commands and conclusions here are the
durable record. Production smoke is committed under `scripts/`.

## Production integration evidence

SIM and COP run on `docker.home.cz` from `/srv/sim` and `/srv/cop`.
Only situation-data-api, cop-api and cop-web were recreated. Valhalla, routing
tiles, unrelated services, production environment files and the existing SIM
observability override were preserved.

- Public COP web and `/health/ready`: HTTP 200.
- COP live/ready/dependency health: HTTP 200, overall ok. PostgreSQL report store,
  routing and the new `community-road-enrichment` dependency report ok.
- Final checked automobile route on `c5f2ef5`: 6,304 m, 923 seconds,
  372 geometry vertices, 8 contiguous typed maneuvers.
  COP and SIM returned the same snapshot and identical duration and all ten
  live-speed fields. No extra traffic delay was added.
- Live traffic: degraded due to 40.89% mapping coverage. Source age reached
  13 seconds after adaptive refresh and was 542 seconds at the final smoke.
  Cold-start data initially had age 20,713 seconds;
  the app's age override warns until fresh data arrives. Route remained usable.
- Directed-road enrichment: matched with verified dataset
  `sim-routing-2026-09-20-1789879440`. Missing direction/close competing roads
  remain ambiguous; observations do not create automatic routing closures.
- Flight data remained degraded and SIM search fluctuated between ok/degraded.
  These upstream source limits are not claimed resolved by this navigation change.
- No lane data appeared in these live smoke routes. Source-only lane rendering is
  fixture-tested; actual visual/road acceptance remains a pilot gate.

The real PostgreSQL candidate smoke passed all 11 checks and confirmed removal
of its isolated schema: author exclusion, replacement vote, spatial filter,
expiry boundary, history, group metadata, lease recovery, stale-lease rejection,
directional duplicate cluster, invalidation after editing and distant reports
remaining separate. It sends no public fake report or community notification.

Reproduce before activating a new API image:

```bash
cd /srv/cop
docker compose run --rm -T --no-deps --entrypoint node cop-api scripts/smoke-community-store.mjs
```

After activation, wait for readiness before requesting the route:

```bash
cd /srv/cop
docker compose up -d --no-deps --wait --wait-timeout 90 cop-api
docker compose exec -T cop-api node scripts/smoke-driver-navigation.mjs
```

The first immediate smoke after the final API restart hit ECONNREFUSED while
the port was still opening. Waiting for container health and rerunning passed;
this startup race did not change routing data or bypass a check.

The routing smoke keeps its authentication inside the container, checks public
health redaction, contiguous maneuver indices, engine route quality, exact
same-snapshot SIM timing, all ten live fields and versioned road matching. It
also rejects internal endpoint or token leakage in the route response.

## Rollback

Prior running images were tagged before any build. Preserve database and env;
no destructive schema reversal is necessary. Restore the actual prior binaries:

```bash
cd /srv/cop
docker image tag delta-acr-cop-api:rollback-20260921-navigation delta-acr-cop-api:local
docker image tag delta-acr-cop-web:rollback-20260921-navigation delta-acr-cop-web:local
docker compose up -d --no-deps --force-recreate cop-api cop-web
curl --fail http://127.0.0.1:4310/health/live
curl --fail http://127.0.0.1:4310/health/ready

cd /srv/sim
docker image tag sim-situation-data-api:rollback-20260921-navigation sim-situation-data-api
docker compose up -d --no-deps --force-recreate situation-data-api
```

Rollback COP checkout reference: `ff83789330825f2bbcfb803bfe6ea8b2ab7efa05`
(API code `67ffda1`, web code `7f10f25`); SIM prior runtime checkout:
`95c0bbbe34584f970b31d054b4b32a7070f251cf`.
Restore the images above without overwriting production-specific working files.
The prior SIM may not provide native maneuver indices. Pair a development native
rollback with Jizda `a742a1a` and shared kit `f194a63`; retain local data/Keychain.
A distributed native build needs a forward fix, not an assumed forced downgrade.

For enrichment-only containment set `COP_ROAD_ENRICHMENT_ENABLED=false` in the
server environment and recreate cop-api. Queued work remains durable and does
not block reports or routing. Original observations and their votes are never
removed by presentation clustering.

## Remaining release acceptance

No outstanding known compile/test failure remains. Before wider distribution,
verify the actual signed-in iPhone and watch, confirmed Siri flow, calls/audio
interruptions, lane presentation, wired/wireless CarPlay and reconnects. Managed
CarPlay/Siri/push/CloudKit capabilities and paid Release archive/TestFlight
validation remain Apple distribution gates. Record real GPS traces and measured
ETA error, route latency, camera stability, battery, thermal and crash-free
sessions across Czech regions. Synthetic tests and a server smoke cannot satisfy
these gates or support a market-leadership claim.
