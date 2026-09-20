# Driver reporting and guidance release

Release date: 2026-09-21. Scope: observation freshness, independent support,
spatial native feed, GPS capture quality, Czech maneuver speech, and reliable
iPhone/CarPlay controls. This record does not certify the entire navigation plan.

## Verified locally

- COP: `pnpm check` — 131 files, 1,053 tests; schemas, OpenAPI, typecheck and
  ESLint pass. OpenAPI retains six pre-existing warnings.
- COP: `pnpm build`, `bash scripts/validate-skeleton.sh` pass. Existing Cesium
  large-chunk warning remains.
- COP Mobile: all 28 unit, 4 UI and 2 accessibility tests pass after correcting
  the offline fallback button's accessibility grouping. The initial failed UI
  run was repaired, not waived.
- Shared native kit: `xcodebuild -scheme CSMCommunicationKit-Package ... test`
  — 46 tests pass, including six spatial feed and COP-only transport regressions.
  The regular iOS script now includes this package suite.
- Jizda: `swift test` — 73 tests; Debug and Release simulator builds including
  watchOS pass. Final incremental build follows the last wording/quality fixes.
- Toolchain: Xcode 27.0 (27A266a), iOS/watchOS SDK 27. Native results are simulator
  or pure-domain results, not a signed physical-device drive.

Policy replays exercise city/motorway speech cadence, tunnel/call suppression,
GPS bounce and reroute reset. They do not measure road-matching accuracy,
real audio routing, battery, ETA error or thermal behavior.

Local result bundle for shared tests: `/tmp/cop-driver-feed-suite-20260921.xcresult`.
App test bundles are in the COPMobile DerivedData `Logs/Test` directory, dated
2026-09-21 00:12 (app tests) and 00:14 (accessibility).

## Deployment status

Before this release, `/srv/cop` on `docker.home.cz` was clean at
`b876e993a5f36acd4a1349802a9d9344daf13a9e`. Production rollout and post-release
smoke results will be appended after they complete.

## PostgreSQL verification

After building the candidate API image, before replacing the running service:

```bash
cd /srv/cop
docker compose run --rm -T --no-deps --entrypoint node cop-api scripts/smoke-community-store.mjs
```

This calls the real compiled store in a uniquely generated isolated schema.
It verifies author exclusion, one-vote replacement, spatial filtering, exact
expiry, historical access and group metadata. It drops only that generated
schema in `finally`. It does not call the public report-submission API or send
community notifications. A passed run must also print `isolatedSchemaRemoved`.

## Rollback

Preserve the database and environment. Return to the previously deployed code:

```bash
cd /srv/cop
git checkout --detach b876e993a5f36acd4a1349802a9d9344daf13a9e
docker compose build cop-api cop-web
docker compose up -d cop-api cop-web
curl --fail http://127.0.0.1:4310/health/live
curl --fail http://127.0.0.1:4310/health/ready
curl --fail http://127.0.0.1:4310/health/dependencies
```

Repeat the authenticated car-route smoke described in
[SIM routing](19_SIM_LIVE_TRAFFIC_ROUTING.md). No destructive migration is part
of this release. Native rollback uses prior Jizda `2542d85` with its paired
COP Mobile shared kit at `bda962c`; retain user data and Keychain.

## Remaining gates

See [the delivery plan](../product/14_DRIVER_NAVIGATION_AND_REPORTING_PLAN.md).
Road-edge enrichment, provider-neutral Jizda routing/SIM migration and full voice
reporting remain implementation work. Apple CarPlay capabilities, real-device
acceptance and a multi-region measured pilot remain release gates.
