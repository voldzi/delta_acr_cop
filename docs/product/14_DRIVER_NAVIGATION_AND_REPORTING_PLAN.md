# 14 Driver Navigation and Reporting Plan

## Goal

Build Jizda into a professional Czech driver navigation application with a
calm, truthful driving UI and an audited reporting loop that improves COP.
The target experience borrows Waze's low-friction route and hazard reporting
workflow, while keeping COP's provenance, access control and operator review.

## Ownership decision

COP is the authoritative store for community reports, their media, lifecycle,
access policy, confirmations and audit history. SIM remains a server-side data
provider and enrichment/routing service. It may correlate reports with traffic,
incidents, closures and the Valhalla road graph, but it must not become a second
authoritative community-report database.

The intended flow is:

`Jizda / COP Mobile / COP Web -> COP API -> COP report store -> reviewed fusion`

`COP API <-> SIM enrichment and routing -> Valhalla`

Browsers and native clients never receive SIM or Valhalla credentials or
internal endpoint addresses.

## Delivery phases

### Phase 1 — Shared driver-report contract

- add traffic-specific report categories without removing existing values;
- accept structured road context: direction, speed, road name/reference and
  capture time;
- accept bounded client context for Jizda, COP Mobile and COP Web;
- preserve the existing UUID idempotency contract for offline retries;
- expose the fields in OpenAPI and the shared TypeScript client;
- add API and contract tests, including malformed context rejection.

### Phase 2 — Native reporting and offline outbox

- add a one-action and voice-first report composer to Jizda;
- use the same contract from COP Mobile;
- queue reports locally when offline and keep the original `observedAt`;
- retry with the same UUID idempotency key;
- show pending, accepted and failed states without blocking navigation;
- never upload a ride history or continuous location trail as part of a report.

### Phase 3 — Confirmation, expiry and trust

- add `still_there` and `not_there` confirmations with one current vote per
  authenticated actor and report;
- calculate a transparent confidence summary from freshness, independent
  reporters, confirmations and source quality;
- automatically expire short-lived traffic reports by category;
- keep moderation and lifecycle history; never hard-delete an active report;
- protect the service with rate limits, abuse controls and privacy-safe audit.

Status on 2026-09-20: the production slice is implemented. COP stores one
replaceable `still_there`/`not_there` value per authenticated actor, returns
aggregate confirmation and confidence summaries, applies category-specific
expiry, rejects confirmation of stale or inactive reports and records the
change in audit. COP Web exposes the same controls. The shared native module
provides a stateless authenticated report feed and Jizda presents nearby
reports with safe confirmation controls on iPhone and CarPlay.

### Phase 4 — Road matching and SIM enrichment

- send submitted traffic reports from COP to a versioned SIM enrichment
  adapter using an outbox/event flow;
- map the report to a Valhalla edge and carriageway without changing the
  original observation;
- store enrichment results and provenance back in COP;
- merge probable duplicates by category, time, road edge and direction;
- require operator/policy confirmation before a report becomes a routing
  closure or materially changes routes.

### Phase 5 — Professional navigation core

- make one route response authoritative for geometry, maneuvers and ETA;
- fix camera zoom, free-pan vehicle movement and reroute stability;
- add truthful lane guidance only when structured lane data exists;
- add Czech spoken maneuver guidance and sound priority rules;
- use SIM live speeds exactly once and show freshness/coverage honestly;
- support continuation on an already calculated route during network loss.

### Phase 6 — Driver UI and CarPlay

- implement destination search, route alternatives and a quiet active-driving
  hierarchy: maneuver, map, arrival and one priority alert;
- make report creation possible by voice and a small number of safe actions;
- share one navigation session between phone and CarPlay;
- obtain and validate the Apple navigation/CarPlay entitlements;
- verify touch, rotary input, calls, reconnects, large text and night mode.

### Phase 7 — Pilot and release

- run repeatable GPS replay tests for city, motorway, tunnels, parallel roads,
  roundabouts, reroutes and offline recovery;
- measure route latency, ETA error, camera stability, crash-free sessions,
  memory, thermal behavior and battery use;
- pilot in multiple Czech regions with staged rollout and rollback controls;
- publish only measured claims with sample size and collection window.

## First implementation slice

The first slice is complete when COP accepts a traffic report from Jizda with
a stable idempotency key, observation time, road context and client context;
returns the same normalized data; rejects malformed context; documents the
contract; and passes typecheck, tests and OpenAPI validation.

Status on 2026-09-20: implemented and validated. COP accepts the four new
traffic categories, bounded capture and road context, and idempotent offline
retries through the existing report endpoint. The Phase 2 foundation is also
implemented: Jizda provides an iPhone and CarPlay reporting flow, uses the
shared authenticated COP communication runtime, and retains unsent reports in
the encrypted outbox for idempotent retry. A signed-in physical-device drive
remains the release acceptance gate before wider pilot use.

## Safety and privacy invariants

- A report is an observation, not a confirmed incident or routing closure.
- A client-declared app identity or road name is provenance context, not proof.
- One report contains one observation point; it does not silently include a
  complete ride or location history.
- Reporter identity is not exposed on the public map.
- SIM/Valhalla endpoints and credentials stay server-side.
- Existing report categories, web workflow and map layers remain compatible.

## Delivery status — 2026-09-21

Implemented software for this release:

- Phases 1–3: authenticated reports, encrypted offline retries, observation-based
  expiry, independent support, nearby feed and confirmations on iPhone/CarPlay.
- Phase 4: durable PostgreSQL enrichment queue, verified dataset + directed-edge
  SIM contract, conservative ambiguity, version/lease race protection and
  presentation clustering without deleting original observations or adding votes.
- Phase 5: Jizda now uses its own immutable route from COP/SIM. Geometry,
  maneuver indices and ETA come from one response. Traffic time is counted once;
  degraded/missing traffic permits a valid route; stale data is visibly warned.
  Cancellation and failed refresh retain the correct session/last route.
- Phase 6: up to three stationary-selectable iPhone/CarPlay alternatives and a confirmed
  foreground Siri/Shortcuts report action using the same encrypted outbox.
  iPhone and CarPlay share route, progress, Czech speech and priority alerts.

The production route matcher now has a repeatable synthetic replay for city
turns/noise, 1,000 motorway samples, opposite parallel carriageways, off-route
movement, reroute identity, roundabout loops, offline/tunnel projection bounds
and invalid GPS. This caught and fixed missing travel-course disambiguation and
invalid-GPS rejection. ETA/speech/capture/recovery domain tests remain separate.

Structured source-only lane guidance is implemented: validated direction masks,
fresh confident GPS, next maneuver only, iPhone arrows/text fallback and CarPlay
lane-position text. Missing or inconsistent provider data hides lane advice.
The production smoke returned no lane records, so actual lane presentation still
requires real-road/visual acceptance. Recorded real-world GPS traces, iPhone
battery, thermal, end-to-end latency and real-road accuracy remain pilot gates;
synthetic macOS matcher timings do not establish these metrics.

External release gates: paid Apple managed capabilities and archive/TestFlight
validation; signed-in physical iPhone/Siri testing; wired/wireless CarPlay;
measured latency, ETA accuracy, camera behavior, battery/thermal and crash-free
sessions in a multi-region driving pilot. These cannot be marked complete by
compilation or server deployment. No market-leadership claim is supported.

Validation, deployed revisions and rollback evidence are recorded in
[the driver integration release record](../integration/20_DRIVER_REPORTING_RELEASE.md).
