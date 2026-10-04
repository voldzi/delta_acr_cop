# COP public analytics — vcode-public-v1

Date: 2026-10-04. Preparation only; collection disabled, notice not approved or
published. No second analytics service/database is created.

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
with SRI; no local analytics logic is forked. The collector adapter and website
registration are not yet installed. VCode exclusively coordinates DMZ routing.
Do not edit DMZ virtualhosts concurrently. No new
REST API or network route is implemented by this preparation. Provision the collector through the owner-approved shared deployment configuration;
do not proxy arbitrary destinations or connect new networks without review.
CSP must allow only own-origin runtime/collector. The PWA must not cache or replay
collector requests. Central retention: daily cleanup after 180 days including
anonymous sessions; VCode owns backups, retention and restore acceptance.

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
No live collection, browser acceptance or rollback roundtrip is claimed here.

## Preparation evidence and blockers

COP web image currently running: independently verified running on 2026-10-04;
private digest retained outside this public document. COP server checkout d514f4f.
This local analytics preparation has not changed production. Forty-three focused tests passed (21 privacy-boundary and 22 service-worker
routing tests). Web typecheck/production build, scoped lint, release guard and
skeleton passed. The web build retains its existing large-chunk warning. Chroma retrieval failed to connect; selected files were inspected directly.

VCode supplied the corrected pinned runtime: its fetch and the COP script loader
both use no-referrer. Runtime SRI matches the supplied final artifact. Registered
website ID is prepared; collection remains false. VCode reports the isolated
collector deployed, but COP domain proxy/trusted-edge/browser/dashboard acceptance
is still pending. Central VCode exclusively owns that deployment and the single
CZ/EN owner review. No production analytics rollout or privacy publication is
claimed. Existing unrelated API/voice/AI edits are preserved.
