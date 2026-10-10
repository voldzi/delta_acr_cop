# 22 COP standalone chat release and SIM acceptance

Evidence date: 2026-10-10. Status: standalone chat deployed and runtime
verified; joint SIM cache/access-contract server acceptance passed.

## Reviewed scope

The release installs the already audited chat/server and compatible dependency
updates from runbook 20. It preserves API-owned AI routing, billing and provider
selection, voice, Matrix/E2EE, existing configuration and network attachments.
No AI routing flag is changed by this rollout.

The old chat image is
`6f5ec214e4993746930418e4c7701525083296e987df7809b3a9f108ef87b82b`.
Its actual embedded chat source was compared with the candidate. Only the
previously reviewed AI-dialog/test formatting differs; no deployed chat source
feature is missing. The actual previous runtime uses Node 24.21.0, UID 0 and
ships build dependencies.

`Dockerfile.chat` now copies only built `dist` and the Node built-in-module
server, runs as `node` (UID 1000), and starts `node server.mjs` directly.
Both required web workspace package manifests/sources are present in build
stages so frozen installation can resolve the shared workspace correctly.
The application starts without a package manager. The final application layer
contains no source tree or workspace development dependency directory; tools
bundled in the upstream Node base image are not claimed to be absent.

## Verification and deployment gate

- Local targeted static server/OIDC proxy, AI dialog and Matrix SDK tests:
  **94 passed**. Local static-runtime smoke passed for web and chat.
  The first sandboxed run was blocked by loopback `listen EPERM`; the repeat
  with local test-port permission passed. This is not a production failure.
- Hosted CI includes a chat Docker build and actual image startup check.
- The standard COP deployment wrapper runs `scripts/check-chat-image.mjs`
  inside the exact built chat image before replacement, with no external
  network, read-only filesystem and dropped capabilities. It verifies UID,
  packaging, health, supported chat fallback, missing-asset rejection and
  token-proxy method rejection. It does not contact an identity or AI provider.
- Production readback must verify the actual chat image, HTML/asset bytes and
  compression/cache headers, token-proxy method boundary, public health and
  unchanged images/configuration/network of all other COP services.

Run only `bash scripts/deploy-production.sh cop-chat` on `docker.home.cz`,
using the reviewed revision, existing overrides and dedicated X5 builder.
Preserve the original chat image under a dedicated rollback tag before build.
Do not enable BYOK or full Router routing as part of this library rollout.

## Rollback

Acquire the COP storage lock, verify the X5 UUID/filesystem and saved baseline,
and recreate only `cop-chat` with the protected immutable old image using a
temporary Compose image override. Verify actual image ID, chat HTTP/asset
readback and the baseline health of all services before declaring rollback
successful. Preserve `.env`, database, other service images and network
attachments. No global Docker prune or volume deletion.

## Joint SIM boundary

SIM owns the source/response cache expiry fix and the OpenAPI authentication
declaration for internal public source metadata. COP retains its 300-second
snapshot limit, rejects stale/invalid input and preserves authenticated consent
and evaluate operations. Validate a cache hit, explicit aged-input rejection,
fresh-input recovery and candidate expiry with sanitised metadata. Do not
manufacture freshness by replacing source timestamps with response time.

The previous mismatch and exact positive/rejection evidence are in
[runbook 21](21_COP_CRISIS_NOTIFICATIONS.md). Record new SIM contract and deployed
revision before marking these findings resolved. No new token, public port or
network is provisioned implicitly.

Physical authenticated two-device messaging/E2EE/voice and locked-screen push
acceptance remain separate; anonymous HTTP smoke and a successful build do not
prove those flows. No test message or AI request is sent to ordinary users.

### SIM findings resolved and jointly verified

The stale readiness response originated in the SIM Nginx gateway cache, which
could reuse an old response despite the backend's current age/readiness
calculation. SIM changed only the two exact candidate/news gateway locations to
`proxy_cache off` and `Cache-Control: no-store`; shared provider caches remain
active. No timestamp cache-busting query is required and COP keeps its
300-second maximum snapshot age.

SIM deployed code:
`1c9c3135ee66ab0ca82441792de24155992a7dcc`.
Safety Data image:
`6bbe0c651a4e4729761c050a12ab434a2bbbbd3cfdd397c0dc82f252f15afec4`.
Gateway config SHA-256:
`7b97987f30288ed78176fa003b74da219a2fd29623d6b7c170f8740ed4b0688b`.
Gateway reload completed at **16:57:37 UTC**. Independent Docker readback
confirmed the Safety image healthy with no published ports, and the same
gateway container `0b8ae33d370e993387707428e832b0e955ced22dabb50c7e9a9d9826c61879c9`
with the reported config hash; no gateway image/container replacement.

The binding SIM OpenAPI now explicitly declares `security: []` for these two
existing internal read-only GET operations. This documents network-restricted
access to public source metadata; it does not make them public Internet routes.
Global bearer authentication and private/admin contracts remain in place.
No new token, port, network or database change was required.

Owner-reported SIM verification: **160/160 Safety tests**, **20/20 contract and
deployment tests**, plus a real Nginx fixture proving bypass/no-store,
upstream 503 without stale 200, public 403 and unchanged flight-cache
MISS/HIT/STALE behavior. SIM reported all eight unrelated container IDs
preserved and private rollback backups retained separately for API and gateway.

Independent COP production acceptance used the same URL twice without a cache
buster or evaluation-time header:

| COP request time (UTC) | Source snapshot (UTC) | SIM age |  COP age | Result                        |
| ---------------------- | --------------------- | ------: | -------: | ----------------------------- |
| 16:58:43.501           | 16:58:43.577          |     0 s | -0.076 s | Ready, 4 candidates, no-store |
| 16:58:45.607           | 16:58:43.577          | 2.033 s |  2.030 s | Ready, 4 candidates, no-store |

The small negative first age is the time between COP starting the request and
SIM creating a fresh snapshot, within the existing clock tolerance. The second
response has a new `generatedAt` and correctly advanced age for the same
snapshot. Both passed the deployed COP normalizer.

- A 301-second `ready` snapshot clone and an expired candidate were rejected
  by deployed COP code **in RAM**, without modifying SIM or dispatching a push.
- Direct SIM news is no-store and remains metadata-only, with null location
  and no push eligibility. The separate COP informational display cache is
  deliberately unchanged.
- Independent public HTTPS tests returned **403** for both internal SIM paths
  and **401** for unauthenticated `/api/v1/scenarios`. COP consent/evaluate
  also returned **401**. SIM additionally reported router-admin 401.
- Final COP server readback: candidate contract ready/complete with four
  candidates, all three ČT24 sources ok, worker enabled, **zero opted-in
  profiles / zero delivery ledger rows**. Zero news items is an allowed
  informational result, not a fabricated incident or provider failure.
- No external AI request, test message or test notification was sent.

These two server findings are closed. Real opt-in, authenticated cross-device
E2EE/voice, Messaging redelivery and physical background/locked-screen delivery
remain unverified; this acceptance does not claim them.

## Published and production evidence

Published and deployed code:
`4427d04fe2fc907d45ba5d135ad4c2411ee507bc`,
[PR #4](https://github.com/voldzi/delta_acr_cop/pull/4).
[CI 38069061371](https://github.com/voldzi/delta_acr_cop/actions/runs/38069061371)
passed both jobs, all existing gates and the new chat Docker/startup gates:
**1,581 tests passed / 8 dedicated-database skips**, zero known dependency
vulnerabilities. The exact startup check passed under UID 1000, read-only
filesystem, dropped capabilities and no external network.

Production chat image SHA-256:
`c725555613d38d5183c85a309cf5f163ac93baa2461af555ee935e93dd329827`.
Completed scoped release job:
`/srv/x5-production/staging/cop/job-15219d731e4a455b870698ca0ce6e205`.
The job retains protected pre-release configuration backup metadata, immutable
old image override, before/after health and configuration/network evidence.
Protected rollback tag: `delta-acr-cop-chat:rollback-chat-20261010`.

- Six actual chat route/method checks passed. The entry asset served internally
  and through `https://cop.zeleznalady.cz/chat/` matches the exact image bytes;
  entry SHA-256 is
  `f6512dc597e69cff43d707faddd40d18e7680ca8a54aaf9cb8469318b403d03c`.
  Brotli and immutable cache headers passed. Node 24.21.0 / UID 1000 and
  absence of workspace build dependencies were verified in the running image.
- Actual image size decreased from **713,821,013 to 183,891,652 bytes**,
  approximately **74%**. The protected old image remains available for rollback;
  this is not a claim of immediately reclaimed disk space or reduced latency.
- Browser readback rendered the anonymous production chat interface with OIDC
  sign-in and chat filters, with no captured console errors. The temporary
  test tab was closed. No login, private-message inspection, message, AI query
  or push was performed by this readback.
- Before/after invariants proved **only the chat image changed**. API, web,
  edge and MCP image IDs, all network attachments, chat runtime configuration
  hash/port bindings and existing AI/mobility/dispatch/worker flags remained
  identical. Worker remains enabled without granting individual consent.
- API live/ready and public demo remain 200/ok; Dispatch and worker remain
  healthy. Existing degraded `ai-gateway` and `sim-search-data-source` states
  were preserved and are not presented as resolved by this chat update.
- X5 preflight passed; post-release capacity was approximately **56 GiB free**
  on the expanded filesystem (72% occupied). No global Docker prune, shared
  builder change, volume deletion or database migration occurred.

The final chat release succeeded, so its failure rollback was not forced.
The old immutable image was running and independently read back before the
release; the lock-protected rollback procedure is prepared. Physical
authenticated E2EE/voice and two-device acceptance remain unverified.

## Follow-up: cold source loading and COP dispatch freshness

A later independent production check timed out after 15 seconds on
`/notifications/candidates` with all four alert layers and a Czech Republic
bbox. The same COP container reached the gateway in 78 ms and metadata-only
news in 878 ms. This is a separate backend cold-loading finding; the earlier
gateway-cache and access-contract evidence above remains dated evidence.
SIM subsequently measured a candidate response without flood in 1,960 ms,
while isolated hydro for a small bbox also exceeded 15 seconds. The running
candidate path waited for a country-wide hydro refresh without an overall
deadline. SIM owns the bounded-loading fix and separate source-cache freshness
repair; final production acceptance of that follow-up is recorded below.

COP also found that its 30-second worker cache could outlive a source snapshot
that was already close to the 300-second maximum. The deadline now follows
the earliest of collection `generatedAt + 300 s` and source
`snapshotGeneratedAt + 300 s`. It bounds cache expiry, is checked on reuse,
and remains attached to each candidate across device eligibility and durable
claim checks until immediately before Messaging intake. Authenticated manual
evaluation passes the complete normalized collection into the same worker.
No API shape, consent, maximum age, model routing or billing flag changed.

COP code: `73021ce90e397322e07da9c10a47d9fcf260f0fb`.
[Linux CI 38083433847](https://github.com/voldzi/delta_acr_cop/actions/runs/38083433847)
passed all gates, including dependency audit and actual Docker builds/startup.
Local verification passed skeleton, 11 JSON schemas, OpenAPI (24 existing
warnings), type check, lint, build and **1,585 tests / 8 dedicated-database
skips**. The targeted notification tests passed **56/56**, including cache
expiry/fresh recovery, source-fetch delay and snapshot expiry during device
and claim checks. Initial schema execution was blocked by sandbox IPC
`listen EPERM`; the permitted repeat passed.

The standard scoped API deployment succeeded. Actual API image:
`14b4d19d34a107ab933cd1068b41e07007ba3f90a37acd2ab09118a148c48556`.
Evidence job:
`/srv/x5-production/staging/cop/job-cb44677dc0564a369b9f844a365263be`.
Before/after invariants proved only the API image changed; chat/web/edge/MCP
images, all network names, port bindings, COP runtime configuration hashes
and AI/mobility/dispatch/worker flags stayed identical. BYOK and full-chat
Router activation remain disabled. The actual new compiled helper rejected
an expired snapshot in RAM without any network call or notification.

Protected API rollback tag:
`delta-acr-cop-api:rollback-snapshot-deadline-20261010`, immutable old image
`770e4a650d97bfd8ec9cbf037f4ff4a62040c66ab511b69707d73d94fe8ebefb`.
The release job retains `rollback.yml`, baseline health and before/after
invariants. Use the standard storage lock/preflight and existing Compose
overrides to recreate only API with that override, then verify its immutable
image and baseline health. This successful release did not force rollback.

Post-release live/ready/dependencies and the public demo returned HTTP 200.
Messaging, Dispatch, voice stores/media, the worker and SIM search were `ok`.
The existing AI gateway dependency still timed out after 10 seconds and was
`degraded`; this rollout does not claim repaired AI-provider availability.

Retrieval did not locate the current scoped cache/dispatch implementation;
the exact source, contract and runbooks were inspected directly.

### Follow-up SIM deployment and independent acceptance

SIM deployed `219d8b01a7bf882f7c2157055ae8797cae84e4a3` on
`codex/crisis-sources-notifications`. Independent Docker readback confirmed
Safety image
`10615c34f3452e18a8b0da43e1becde7b5e368d292bcbf3f038b6e994064c46d`
healthy and the COP API image above healthy. SIM reported **193/193 Safety
tests**, **21 contract/deploy/gateway tests**, type check/build/skeleton and
OpenAPI passing with five existing lint warnings. Its invariants proved only
Safety image changed, preserving other container identities, gateway/Compose
and X5 hashes, mount/port/network settings and environment values. An initial
environment-array hash difference was ordering only; values were compared.

The candidate path now has an overall budget and coalesces source warming in
the background. Snapshot provenance retains the oldest genuinely used current
source-cache timestamp, including nested hot/coalesced/stale evidence.
Hydro observation expiry is `observedAt + 2 h` and does not advance on reread.
The notification snapshot maximum remains 300 seconds. Provider refresh
cadence, gateway no-store and all existing access controls are preserved.

SIM's live COP-to-SIM cold query returned **503**
`SAFETY_NOTIFICATION_INPUT_UNAVAILABLE` after **8,255 ms**, instead of the
old 15-second timeout. A later single read of the same URL after natural
background warming returned **200/incomplete** in **89 ms**, with zero
candidates because the limit was reached. This does not mean a safe area or
complete alert coverage. No force refresh, cache-buster or retry loop was used.

Independent COP production acceptance in the new image:

| Check | Result |
| --- | --- |
| All four layers, bbox `12,48,19,51`, limit 100 | HTTP 200 in 97 ms; `incomplete`, `input_limit_reached`, zero candidates, no-store; normalized as possibly truncated and unusable for dispatch |
| HZS, fire, same URL twice without auth/cache-buster | HTTP 200, ready/complete in 141 ms and 5 ms; zero currently eligible candidates is valid |
| HZS source snapshot | Unchanged `2026-10-10T20:35:13.020Z`; absolute age correctly advanced `213.451 → 215.458 s`, with new response times `20:38:46.471Z` and `20:38:48.477Z` |
| 301-second source clone | Rejected by the deployed normalizer and deadline helper, in RAM only |
| Cached source at 299 seconds, reused two seconds later | Deadline remained source-based and reuse was rejected, in RAM only |
| COP consent and evaluation without a session | Both HTTP 401 |
| Public SIM HTTPS boundary | `https://sim.zeleznalady.cz` candidates/news both 403; private scenarios 401 |

The smoke initially asserted ready for the bounded full-country query; its
expectation was corrected to the documented incomplete/zero-candidate
contract. No server rule or payload was relaxed to pass a test.
The sanitized server proof is `production-freshness-proof.jsonl` in the COP
release evidence job. No user content, raw source payload, private messages,
AI query or notification was sent or persisted by these checks.

SIM retains old immutable Safety image `6bbe0c651a4e4729761c050a12ab434a2bbbbd3cfdd397c0dc82f252f15afec4`
and private rollback configuration backup
`/srv/sim/.deploy-crisis-backups/2026-10-10T20-35-02-457Z-219d8b01a7bf`.
Restore only Safety through SIM's standard release procedure and recheck the
image, health, gateway/config invariants and COP rejection of old snapshots.
The successful final deployment did not force rollback. Ordinary authenticated
device/opt-in delivery and existing AI gateway availability remain separately
unverified/unresolved as described above; BYOK/full routing remain disabled.
