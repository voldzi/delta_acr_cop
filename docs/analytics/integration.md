# COP public analytics — vcode-public-v1

Date: 2026-10-04. Web integration deployed with collection disabled; notice not
approved or published. No second analytics service/database is created.

## Scope

Repository: delta_acr_cop. Production origin: https://cop.zeleznalady.cz.
Only exact `/demo/flood-central-bohemia` may submit a pageview. It is a fixed
synthetic demonstration, not a live report. `/ardos-demo` is a redirect, not a
separate measured page. `/`, chat, XR/globe, device pairing and every other path
are excluded. No clicks, demo steps, map interactions, coordinates, content,
accounts, reports, communications, forms, dynamic IDs, query or fragments.
The bridge only receives `location.pathname`; it does not read URL search/hash,
title, referrer, application state or authentication credentials.

## Configuration and required shared components

`COP_PUBLIC_ANALYTICS_ENABLED=false` and empty
`COP_PUBLIC_ANALYTICS_WEBSITE_ID` are build defaults. The registered public ID
`59b949ec-6052-41c7-82fe-955258ddb7e1` is documented in .env.example. Docker passes the values
only to cop-web. The website ID is public registration metadata, not a secret.
Only this origin and a UUID-shaped ID are accepted. No script is loaded while
collection is disabled, offline or suppressed by DNT/GPC.

VCode owns shared runtime and collector registration. Required same-origin paths:

- `GET /analytics/v1/tracker.js`: pinned shared runtime, global
  `window.vcodePublicAnalytics.create` (never the generic auto tracker).
- `POST /analytics/v1/events`: shared collector adapter restricted to this host,
  registered website ID and exact allowed path. Reject arbitrary events/properties,
  origins and credentials. Do not expose dashboard/admin routes.

The runtime contract is create({websiteId,collectorPath,allowedPaths,
allowedEvents:[],autoPageview:false,autoClick:false,captureTitle:false,
captureReferrer:false,credentials:'omit',offline:'discard'}) → {pageview(path)}.
The script itself is loaded with no-referrer. Shared runtime must also suppress
request referrers, cookies, query strings and fragments, respect DNT/GPC before
send and discard offline data without local/session storage or delayed retries.
Collector must verify trusted edge forwarding, never trust browser-supplied IPs,
disable access/payload logs and avoid storing raw addresses. Central Umami uses
rotating anonymous identifiers; this is not proof of zero personal-data handling.

The exact versioned runtime artifact is pinned in public/analytics/v1/tracker.js
with SRI; no local analytics logic is forked. VCode reports the registered website and COP edge collector deployed. VCode exclusively coordinates DMZ routing.
Do not edit DMZ virtualhosts concurrently. No new
REST API or network route is implemented by this preparation. Provision the collector through the owner-approved shared deployment configuration;
do not proxy arbitrary destinations or connect new networks without review.
CSP must allow only own-origin runtime/collector. The PWA must not cache or replay
collector requests. Central retention: maximum 180 days including anonymous sessions and backups,
with active purge at 170 days plus daily rotating backups; VCode owns backups, retention and restore acceptance.

## SPA and release acceptance

The public demo mounts the bridge. In-memory path/generation guards deduplicate
StrictMode/concurrent observations and cancel a queued load when navigation has
left the public path. No history monkeypatch, click listener or data persistence.
Popstate rechecks the current exact path. Runtime errors do not affect COP.

Run `pnpm check:analytics`, profile privacy boundary tests, web typecheck/build
and skeleton validation. After shared components and notice approval, use an
isolated test website: one public pageview, no duplicate on rerender, no private
path/event, no DNT/GPC/offline send, no query/title/referrer/cookies in actual
network payload/headers, correct trusted edge address handling, 180-day cleanup
and authenticated dashboard visibility. Then rebuild with enabled config and
record exact image/revision. Do not count test traffic as production visits.
Rollback: rebuild/redeploy with enabled=false, then verify no runtime load/send.
No live collection or live rollback roundtrip is claimed here. Disabled browser
acceptance is recorded below.

## Preparation evidence and blockers

COP web image currently running: independently verified running on 2026-10-04;
private digest retained outside this public document. COP server checkout d514f4f.
The production web release is recorded below. Forty-three focused tests passed (21 privacy-boundary and 22 service-worker
routing tests). Web typecheck/production build, scoped lint, release guard and
skeleton passed. The web build retains its existing large-chunk warning. Chroma retrieval failed to connect; selected files were inspected directly.

VCode supplied the corrected pinned runtime: its fetch and the COP script loader
both use no-referrer. Runtime SRI matches the supplied final artifact. Registered
website ID is prepared; collection remains false. VCode reports the isolated
collector deployed, and it reports isolated domain proxy/trusted-edge/storage tests passed without
increasing actual counts. COP independently verified public tracker identity and
the disabled browser behavior; activated dashboard acceptance remains pending. Central VCode exclusively owns that deployment and the single
CZ/EN owner review. No production analytics activation or privacy publication is claimed. Existing unrelated API/voice/AI edits are preserved.

## Edge integration ownership

VCode reports include `/etc/nginx/vcode-analytics/cop.zeleznalady.cz.conf`
in the active HTTPS virtualhost. It owns that private include and edge secret;
neither contents nor token are copied into Git. COP does not change the DMZ.

## Disabled production deployment — 2026-10-04

COP web artifact source: `3b82d4fcd99fd7d2a27a323a3527c5839da2669d`, published
on `codex/cop-public-analytics`. This release changes only cop-web. API container
and image remain unchanged (`d514f4f` server release). The environment, ports,
networks and secret/overlay file fingerprints were independently preserved.
Private image digests, artifact/config fingerprints and rollback image selection
are held in the owner's private deployment journal.

The initial full server-side Docker build was cancelled before switching any
service: the shared host had load over 120 and fully used swap. Only this agent's
build child was interrupted. No other service/process was stopped. The final web
was instead built locally from the exact existing production build configuration
with analytics=false and the registered website ID. Its public output was packaged
over the unchanged existing runtime/dependencies, without another Node build on
production. Source files bundled in the base image are not the runtime source of
this frontend artifact; deployed compiled assets and release label carry the new
revision. The previous web image is retained. No live rollback roundtrip performed.

Actual public readiness returned 200, web liveness returned 200 and the container
was running with the expected image and analytics=false release label.
`GET /analytics/v1/tracker.js` returned 200 with the exact final shared SRI.
Browser acceptance in the public demo: map and scenario rendered, opening the
scenario worked, analytics script elements=0, analytics network requests=0 during
load and interaction, proposed privacy notice absent. The captured network event
window was neither truncated nor incomplete (no more pages). No collector request
was manufactured and actual visit counts were not used for this test.

Remaining: the single concrete owner approval of the shared CZ/EN notice, followed
by publication/enabled rebuild and active isolated browser/dashboard acceptance.
DNT/GPC, private-route and offline boundaries have 43 automated tests; their active
production-browser verification follows approval. DMZ changes remain owned solely
by VCode. This document does not claim collection is already active.

## Canonical development adoption

The isolated web integration is also narrowly adopted in the primary COP checkout
and its current development branch `codex/shared-ai-router-cop`. Existing dirty
AI/voice/API changes and the Dispatch review are preserved separately. There is
no production service change in this adoption and no merge of unfinished work.

`pnpm check`, `pnpm check:release`, GitHub CI and `Dockerfile.web` all invoke
`check:analytics`. The guard checks the actual public-demo mount, privacy notice,
exact public allowlist, mandatory safe configuration, PWA bypass, default-off
configuration and pinned artifact integrity. Isolated destructive test fixtures
verify that removing the bridge/mount, changing the artifact, dropping the PWA
bypass or bypassing the Docker build guard makes release validation fail.
Future COP releases must carry this integration and keep central owner-approved
enablement configuration; no automatic activation or widening of paths is added.

Canonical adoption acceptance: 50 targeted tests passed (43 boundary/PWA +7
release guard cases), scoped lint, web typecheck/production build and skeleton
passed. The unrelated working files were verified byte-for-byte before staging.
This adoption does not authorize a full production rebuild of other services
from the development checkout; the deployed web remains the scoped 3b82d4f
artifact and production API remains d514f4f.

## Pending notice synchronization — 2026-10-04

The unpublished CZ/EN proposal and hidden demo notice match the shared VCode
privacy-review source at `ef5cbf7`, including retained general browser, operating
system and device categories, and exclusion of full network headers and inferred
geographic location. Future publication must use that current shared wording.
The single central owner review remains pending; no deployment, notice publication
or collection activation was performed for this synchronization.

## Authorized activation release — 2026-10-04

Owner approval verified directly in VCode user turn `01a10681-2286-7912-a3a3-2ee371fcbfd8`
(“Souhlasím”), recorded by VCode `0527093`; exact text source `ef5cbf7`.
Public supplements: `/analytics/privacy-cs.html` and `/analytics/privacy-en.html`.
Only `/demo/flood-central-bohemia` is measured. Persist production
`COP_PUBLIC_ANALYTICS_ENABLED=true` and the existing registered website ID in
the production build configuration for subsequent releases. Default development
configuration remains off. Central registry activation and ingest acceptance are
separate owner-coordinated steps, after the public text is checked.

### Activation acceptance and central handoff

Deployed web artifact source `52d0175`, image
`sha256:fe45d9709d6ed8162a0fa11a8b60f1ea04b7bd6df9de4bb78b9ad5de31ea2c66`.
Production build configuration persists `COP_PUBLIC_ANALYTICS_ENABLED=true`,
website ID `59b949ec-6052-41c7-82fe-955258ddb7e1`; corresponding compiled VITE
flags are true and that ID. Only the web was recreated. API container ID/image
and environment fingerprint, web networks and ports were unchanged. Actual image
and release labels were checked. Public readiness returned 200. Prior image
`sha256:ca1d7187d6a823bfa75ee9439c000b938c8592d19ed75d182be6ff6cacf5ef66`
is retained as `delta-acr-cop-web:rollback-analytics-on-52d0175`.
Private deployment journal: `/home/voldzi/cop-deployments/analytics-on-52d0175`.
No live rollback roundtrip was performed.

- Both public supplement URLs returned 200, contain four exact approved
  paragraphs each, and no scripts; both were visibly verified in the browser.
- The actual production demo rendered the map/scenario and expandable exact
  CS/EN notice with links to both supplements. One pinned runtime loaded and one
  POST was attempted; test delivery was blocked in the browser before reaching
  the collector to avoid manufacturing actual production visits. Captured body:
  `{"website":"59b949ec-6052-41c7-82fe-955258ddb7e1","name":"pageview","path":"/demo/flood-central-bohemia"}`.
- `/`, `/chat/`, `/mobile/pair/testfixture`: zero analytics scripts and zero
  analytics requests in actual browser checks. These were anonymous boundary
  screens, not authenticated private-session acceptance.
- In the mounted production SPA, temporary developer overrides for navigator
  DNT=1, GPC=true and online=false followed by leave/return popstate observations
  each produced zero analytics requests. Network windows were complete and not
  truncated. These are simulated browser signals after mount, not genuine browser
  preference changes or a real network disconnect. Cold-start and queued-load
  signal boundaries are covered by the automated suite. Overrides and request
  blocking were removed; the temporary tab ended on the static notice.
- 50 targeted automated tests passed; local enabled production build, release
  guard, skeleton and diff checks passed. Existing large-chunk warning remains.
- Central VCode separately reports actual edge DNT/GPC 204 with no stored record
  and runtime offline tests. COP has not independently performed that collector
  acceptance. Registry activation and final isolated ingest check await VCode's
  announcement. Frontend activation alone is not confirmed analytics ingestion.

Rollback restores the retained web image and the prior analytics flags recorded
in the private journal, recreates only cop-web with no build/dependency restart,
and verifies no tracker/collector request. API and other integrations stay intact.
The approval/activation section supersedes earlier pending/default-off statuses
in this historical deployment chronology.
