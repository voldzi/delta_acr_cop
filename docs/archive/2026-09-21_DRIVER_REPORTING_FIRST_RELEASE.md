# Driver reporting and guidance release

Release date: 2026-09-21. Scope: observation freshness, independent support,
spatial native feed, GPS capture quality, Czech maneuver speech, and reliable
iPhone/CarPlay controls. This record does not certify the entire navigation plan.

## Verified locally

- COP: `pnpm check`, followed by final `pnpm lint` / `pnpm test` after the
  database and health fixes — 131 files, 1,054 tests; schemas, OpenAPI, typecheck and
  ESLint pass. The final complete suite also includes the public-health redaction
  regression. OpenAPI retains six pre-existing warnings.
- COP: `pnpm build`, `bash scripts/validate-skeleton.sh` pass. Existing Cesium
  large-chunk warning remains.
- COP Mobile: all 28 unit, 4 UI and 2 accessibility tests pass after correcting
  the offline fallback button's accessibility grouping. The initial failed UI
  run was repaired, not waived.
- Shared native kit: `xcodebuild -scheme CSMCommunicationKit-Package ... test`
  — 46 tests pass, including six spatial feed and COP-only transport regressions.
  The regular iOS script now includes this package suite.
- Jizda: `swift test` — 73 tests; Debug and Release simulator builds including
  watchOS pass. Final incremental builds and the signed Debug build for the
  connected iPhone16v on iOS 27 also pass.
- Toolchain: Xcode 27.0 (27A266a), iOS/watchOS SDK 27. Native results are simulator
  or pure-domain results, not a signed physical-device drive.

Policy replays exercise city/motorway speech cadence, tunnel/call suppression,
GPS bounce and reroute reset. They do not measure road-matching accuracy,
real audio routing, battery, ETA error or thermal behavior.

Local result bundle for shared tests: `/tmp/cop-driver-feed-suite-20260921.xcresult`.
App test bundles are in the COPMobile DerivedData `Logs/Test` directory, dated
2026-09-21 00:19:11 (app tests) and 00:20:49 (accessibility). The final shared-kit
bundle is in CSMCommunicationKit DerivedData `Logs/Test`, dated 00:20:32.

## Deployment status

Before this release, `/srv/cop` on `docker.home.cz` was clean at
`b876e993a5f36acd4a1349802a9d9344daf13a9e`.

Deployed and verified on 2026-09-21:

- API code revision: `67ffda1`; web image code: `7f10f25` (later commits affect API/docs only).
- GitHub: COP branch `codex/native-communications`; COP Mobile `f194a63` on
  `codex/native-communications`; Jizda `a742a1a` on `codex/stabilizace-aplikace`.
- PostgreSQL smoke passes all six checks; isolated schema removal confirmed.
- `/health/live`, `/health/ready`, `/health/dependencies`: HTTP 200, overall `ok`.
  Community report storage is `postgres: ready` and routing is `ok`.
- Public COP web: HTTP 200.
- Automobile route: 6,493 m, 1,120 seconds in COP and directly through the server's
  SIM adapter. Same source snapshot, all ten `liveSpeeds` fields match; one route
  geometry feature. No extra delay was added by COP.
- Final live traffic: `degraded`, coverage 40.89%, age 278 seconds. An earlier
  cold-start check had age 5,419 seconds; this is why age must override a generic
  `degraded` label. Routing worked in both cases.
- Public dependency health no longer returns the routing base URL.
- Observed upstream limits: flight source `degraded` (zero tracks); SIM search
  `degraded` with 1,000 results. These are not reported as fully healthy sources.
- Native sources were built and pushed; no new App Store/TestFlight release or
  installation on the phone is claimed.

The 3,738 ms final smoke interval includes both sequential COP and direct SIM
requests. It is one operational smoke observation, not a route latency benchmark.

## PostgreSQL verification

After building the candidate API image, before replacing the running service:

```bash
cd /srv/cop
docker compose run --rm -T --no-deps --entrypoint node cop-api scripts/smoke-community-store.mjs
```

This calls the real compiled store in a uniquely generated isolated schema.
It uses a pool of one connection to detect nested acquisition deadlocks.
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

Repeat the authenticated car-route smoke inside the API container (the token
stays inside that container):

```bash
docker compose exec -T cop-api node --input-type=module <<'JS'
const response = await fetch('http://127.0.0.1:4310/api/v1/routing/route', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.COP_LAB_TOKEN}` },
  body: JSON.stringify({ profileId: 'car', includeSteps: true,
    from: { lat: 50.075, lon: 14.438 }, to: { lat: 50.100, lon: 14.480 } }),
  signal: AbortSignal.timeout(60000)
});
const data = await response.json();
if (!response.ok || !(data.routes?.[0]?.durationSeconds > 0)) throw new Error('Car routing smoke failed');
console.log({ status: response.status, durationSeconds: data.routes[0].durationSeconds });
JS
```

See also [SIM routing](../integration/19_SIM_LIVE_TRAFFIC_ROUTING.md). No destructive migration is part
of this release. Native rollback uses prior Jizda `2542d85` with its paired
COP Mobile shared kit at `bda962c`; retain user data and Keychain.

## Remaining gates

See [the delivery plan](../product/14_DRIVER_NAVIGATION_AND_REPORTING_PLAN.md).
Road-edge enrichment, provider-neutral Jizda routing/SIM migration and full voice
reporting remain implementation work. Apple CarPlay capabilities, real-device
acceptance and a multi-region measured pilot remain release gates.

The first candidate PostgreSQL run revealed a nested connection acquisition in
`createGroup`: it queried members from the pool before releasing the transaction
client. The fix uses the member `INSERT ... RETURNING` result in the transaction.
The failed smoke cleaned its isolated schema and production stayed on the prior
revision until revalidation.

The post-deployment diagnostic audit found that public dependency health included
the internal routing base URL. The follow-up uses a generic server-side routing
detail and adds a regression proving the configured host/path never appears in
public health. Operational source configuration remains server-owned.
