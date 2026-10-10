# 20 COP code health: security, performance and dependencies

Evidence date: 2026-10-07. Scope: COP API, web, chat and shared packages.
Status: repaired and verified; API/web integration was deployed on 2026-10-10
through the separately verified crisis-notification release. The standalone chat
runtime remains on its previous image. See the final deployment note below.

## Scope and evidence limits

Work uses an isolated checkout on `codex/cop-performance-security`. Unrelated
changes in the original developer checkout are preserved. Chroma retrieval was
attempted but its local server was unavailable, so selected source files and
contracts were inspected directly. Production inventory was read-only; no
attack test, user-data export, AI request or live load test was performed.

The audit is not a security certification or a claim of perfect optimization.
Dependency advisories, synthetic negative tests, builds, rendered public pages
and authenticated/device acceptance are separate forms of evidence.

## Concrete repairs

| Boundary           | Repair                                                                                                                                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protected input    | Authenticate before JSON body parsing; preserve CORS preflight.                                                                                                                                                                                                                                                     |
| Public input       | Explicit 64 KiB map-query, 256 KiB Matrix-push and 1 KiB logout limits; existing correlation-aware 413 envelope. Media attachment limit is separate.                                                                                                                                                                |
| OIDC/JWKS          | Reject malformed claims and missing subject; bound JWKS to 5 seconds/256 KiB, use single-flight refresh and failure cooldown; reject credential redirects.                                                                                                                                                          |
| Server proxies     | Fixed API origin/path; reject absolute request targets, strip hop-by-hop headers, cancel disconnected/expired requests.                                                                                                                                                                                             |
| OIDC token proxy   | 64 KiB input/256 KiB response and 30-second deadline; never follow a token POST redirect.                                                                                                                                                                                                                           |
| Remote bodies      | Bound streamed weather/camera reads; validate each allowed redirect, reject URL credentials and cover the response body with the deadline.                                                                                                                                                                          |
| SIM Router         | Reject redirects and bound response bytes; no new direct external fallback or activation.                                                                                                                                                                                                                           |
| Logs               | Request path only; remove query, pairing tokens and raw geocoding search terms.                                                                                                                                                                                                                                     |
| Source registry    | Explicit integration/security administrator mutations; validate merged PATCH and immutable identity before changing state.                                                                                                                                                                                          |
| Integration data   | Protect domain/outbox/replay/DLQ reads and writes with service/admin roles, including MCP bypasses; ordinary citizen sessions receive 403.                                                                                                                                                                          |
| Canonical data     | Explicit ingest roles, per-item batch policy, verified classification and public release policy on ingest and all read/evidence paths. Bind historical/current labels to the actual source, server-owned ingest clock and payload; reject differing event-ID reuse and deduplicate identical retries. See ADR 0039. |
| Static files       | Validate decoded paths and resolved file root; reject malformed/NUL paths and symlink escape.                                                                                                                                                                                                                       |
| Compression        | Brotli quality 4, correct `q=0` handling; avoid expensive quality 11 on first asset request.                                                                                                                                                                                                                        |
| Initial map bundle | Explicit nonrecursive chunks; optional Cesium/3D/XR must remain outside the initial static import graph, enforced by release check.                                                                                                                                                                                 |
| Cesium assets      | Replace static-copy dependency with a tested fixed-directory plugin; retain only required Assets/ThirdParty/Widgets/Workers roots.                                                                                                                                                                                  |

No CSP relaxation, global CallKit change, analytics activation, AI routing switch
or deletion of audit/history is included.

## Dependencies

The original 2026-10-07 audit updated 37 unique direct libraries (49 manifest
references) within the selected compatible release lines and moved pnpm from
10.33.0 to 10.34.6. Its full dependency audit decreased from 13 advisories
(4 high, 7 moderate, 2 low) to zero across 630 reported dependencies. Those
figures describe that original snapshot, not a permanent assurance.

Registry revalidation on **2026-10-10** used an isolated clone of the published
PR head `6893fb60ce0601b25d0d87468402df8c61198438`. Its unchanged lock already
passed the current production audit: **zero advisories / 321 dependencies**.
The refresh additionally updates **15 unique direct libraries / 22 manifest
references**, using the latest stable releases in the supported release lines.
No production checkout or runtime was changed by this refresh. New lockfile
SHA-256:
`d140cd501ed234ad1e6be527966c58b2c8200a09f4bc0e60884be3a86cd14810`.

The refreshed lock passes both the production audit (**314 dependencies**) and
the full audit (**623 dependencies**) with **zero advisories at every severity**.
No audit ignore, vulnerability suppression or new package override was needed.
CI fails from `low` severity. The original removal of the unpatched `braces`
chain with `vite-plugin-static-copy` is preserved.

The lock retains patched [Fastify 5.12.5](https://github.com/fastify/fastify/security/advisories/GHSA-4mh8-r7rc-xpvc),
[fast-uri 3.1.8 / 4.2.1](https://github.com/fastify/fast-uri/security/advisories/GHSA-hrr3-gc8f-f4qj),
[ip-address 10.7.3](https://github.com/beaugunderson/ip-address/security/advisories/GHSA-j6r3-76f7-8jcv)
and [DOMPurify 3.4.16](https://github.com/cure53/DOMPurify/security/advisories/GHSA-6688-9rhm-gjv2).
The advisory inventory is separate from exploit reachability: COP has no direct
HTTP/2 trailer, subnet helper or DOMPurify `IN_PLACE` usage in the inspected
source. A clean dependency audit does not certify the whole application.

CI actions are upgraded to Node 24 runtime releases and pinned to verified full
commit SHA: checkout 7.0.1, setup-node 7.0.0 and Gitleaks 3.0.0. The workflow
token is read-only, checkout does not persist credentials and implicit package
cache is disabled. [GitHub removed Node 20 action runtime on 2026-09-23](https://github.blog/changelog/2026-09-23-node-20-is-no-longer-available-in-github-actions/).
The actual hosted workflow remains a separate verification after publishing.

| Selected dependency        | Candidate version              |
| -------------------------- | ------------------------------ |
| Fastify                    | 5.12.5                         |
| React / React DOM          | 19.3.0                         |
| MapLibre                   | 6.13.0                         |
| Cesium                     | 1.146.0                        |
| LiveKit client / server    | 2.22.4 / 2.19.1                |
| Matrix SDK                 | 42.4.0                         |
| PDF.js / JSZip             | 6.4.299 / 3.10.2               |
| Vite / Vitest              | 8.3.4 / 5.0.3                  |
| Redocly                    | 2.62.1                         |
| ESLint / typescript-eslint | 10.12.0 / 8.71.1               |
| Node types                 | 24.19.2 (Node 24 runtime line) |
| Lucide / TanStack table    | 1.55.0 / 9.2.8                 |

Not every published major is adopted automatically:

- Matrix stays on the supported 42.x release line, refreshed to [42.4.0](https://github.com/matrix-org/matrix-js-sdk/releases/tag/v42.4.0). Its OAuth request logger excludes request/response bodies and redacts query values; the installed source was checked. [43.0.0 changes OAuth refresh ownership and RTC events](https://github.com/matrix-org/matrix-js-sdk/releases/tag/v43.0.0), requiring coordinated login/call/device regression. Keep the `matrix-events-sdk` 2.0.0 override.
- TypeScript 6.0.3 remains: [TypeScript 7 removes the JavaScript compiler API](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/); the installed ESLint parser supports `<6.1.0`.
- Three 0.185.1/types 0.185.4 remain: [r186 changes geometry/disposal APIs](https://github.com/mrdoob/three.js/wiki/Migration-Guide#185--186); XR regression is a separate migration.
- Node types stay on 24 rather than 26, matching the supported runtime. This refresh uses local Node 24.20.0; the original production inventory showed Node 24.21.0 and was not repeated by this dependency-only refresh.
- pnpm stays on the project's 10.x release line rather than introducing a package-manager major migration.

After installation, `pnpm outdated -r --format json` lists only the five
deliberately deferred packages above (`@types/node`, `matrix-js-sdk`,
`typescript`, `three`, `@types/three`). Their `current` equals `wanted`; no
compatible direct-library update remains in the selected ranges. This registry
result is time-bound to 2026-10-10.

Refresh verification on local Node 24.20.0:

- Frozen offline installation: all **17 workspace projects**, unchanged lock.
- Type-check and ESLint: pass, zero warnings. The first complete
  `pnpm format:check` reported 17 existing source/test/static files. Running the
  installed Prettier 3.9.10 on precisely those files produced formatting-only
  changes; the repeated **full format check passes**, as does `git diff --check`.
- Schemas: **11 pass**. Binding OpenAPI: zero errors, 24 existing warnings.
  The first schema command was blocked by the sandbox's `tsx` IPC pipe
  permission; the repeat with that local IPC permission passed.
- Full suite: **1,426 pass / 2 skipped / 0 failures**, 166 passing files and two
  skipped PostgreSQL integration files without dedicated test databases.
  Run used two workers and took 28.58 seconds. A process fetch guard admitted
  only loopback requests and recorded **zero unexpected external fetch attempts**.
  This full test run preceded the subsequent formatting-only repair.
- Serial workspace build: all **16 workspace build scripts pass**. Vite retains
  its generic large-chunk warning; the actual gzip budget gate passes without
  changing thresholds.
- Bundle budgets, actual static-server smoke, public analytics default-off guard,
  repository skeleton and whitespace checks: pass. Web/chat initial static graphs
  remain **184.9 / 104.9 KiB gzip**, within 250 / 135 KiB budgets; optional
  engines remain outside their initial static graphs. The temporary static-server
  processes were stopped by the smoke check.

No production rollout, hosted CI rerun, authenticated Matrix/E2EE/voice test or
physical-device acceptance was performed by this dependency refresh. The
verification record below belongs to the original audit candidate and is
preserved with its original dates and limitations.

## Verification record

The final full local suite at candidate `5f0d24a` passed: **1,426 tests**, two
PostgreSQL integration tests skipped because dedicated test databases were not
provided (166 passing files, two skipped files). No production database was
used. Type-check/ESLint (zero warnings), 11 schemas, binding OpenAPI (24 remaining
conditional/legacy warnings, zero errors), skeleton, bundle budgets, real
static-server behavior and the analytics release guard passed. All 17 workspace
builds passed at `6cb37c2`; the final changed API was rebuilt and its emitted
JavaScript contains the new event-ID/provenance protections.

The final local rerun at `5f0d24a` also passed all 1,426 tests with an explicit
process fetch guard permitting only loopback providers and **zero unexpected
external fetch attempts**. Diagnosis had exposed real Nominatim requests in
four chat/weather fixtures and SDK profile fallback in two Matrix group-call
fixtures. Deterministic geocoder and complete synthetic SDK profiles now replace
those test dependencies; fixtures assert zero fetch and stop group sessions to
clear background work. The complete Matrix test file passed 72/72. This changes
tests, not production AI/geocoding/Matrix behavior or service deadlines.

The final regression set covers copied protected IDs and payloads with a forged
client ingest time, retained PostgreSQL-style history after restart, immutable
single/batch IDs, atomic security rejection, identical retry deduplication,
correct server timestamps, fresh legitimate public updates and the actual
mixed valid/invalid batch response against OpenAPI. PostgreSQL-style regression
uses isolated fixtures; it is not a real-database migration/restore acceptance.

An independent isolated Linux gate uses Node 24.21 on a dedicated X5 COP job,
with no production secrets, public ports or external runtime network. Linux
skeleton, all 19 storage tests, 11 schemas, OpenAPI and lint passed at `6cb37c2`.
The full Linux suite at that snapshot was **not clean**: 1,393 tests passed,
10 failed and two were skipped. Nine failures exceeded the default 5,000 ms
test deadline; one asynchronous job lacked its expected result within the test
window. Duration was 1,214.9 seconds, with most tracked time in module imports
and test environments. These are recorded as failed checks on the shared host,
not silently converted to successful application acceptance. The remainder of
that superseded gate was stopped before rebuilding final source. Focused final
source checks at `c7b2663` passed: **81/81 API/provenance/contract tests**, all
17 workspace builds, 11 schemas, OpenAPI, bundle budgets, static runtime and
analytics guard. The dedicated build took 55.42 seconds. The two original
contract failures are covered by that passing 81-test set. An initial recheck
filter matched no cases, so its exit status is not counted as test evidence.
The four other affected files were rechecked without a name filter or changing
resource limits/timeouts: 64 passed and four chat/weather fixtures still failed.
Diagnosis proved those four were calling the real Nominatim geocoder despite
mocked AI providers; its eight-second deadline exceeded the five-second unit
limit. They now inject a deterministic existing geocoder and assert zero fetch
calls (`3c80124`). Production geocoding and timeout semantics are unchanged.
The subsequent five-file Linux run at `3c80124` passed 79/80. All four fixed
fixtures passed; a different surrounding-hydro test exceeded 5,000 ms on that
run. Worker startup averaged 8.94 seconds. That timing failure remains recorded,
and a clean full final Linux/hosted CI gate is still required before production
activation. No source change was made to conceal it. This does not replace a
full final Linux run. No production threshold or test timeout was relaxed to
obtain a passing result.

Controlled browser comparison uses the same updated dependencies for old and
new code, clean anonymous desktop (1440×900) and mobile (390×844) contexts,
DNT/GPC and blocked service workers, and only the public synthetic flood demo.
Both rendered the map without JavaScript errors or horizontal overflow.

| Initial public-demo measurement                 |     Previous code |   Candidate |
| ----------------------------------------------- | ----------------: | ----------: |
| Resources transferred from the local COP origin |       1,701,935 B | 1,034,017 B |
| Eager Cesium/3D requests                        | Cesium JS and CSS |        None |
| Desktop FCP / LCP                               |  4,700 / 5,820 ms | 68 / 380 ms |
| Mobile FCP / LCP                                |  4,668 / 5,784 ms | 64 / 360 ms |

The transfer reduction is **39.2%** for this specific initial page. Paint times
are local diagnostic evidence, not a production latency promise: compression,
host load, cache and network differ in production. The candidate keeps Brotli
quality 4 and loads the large Cesium engine only when entering 3D.

Measured gzip release budgets: web initial static graph 184.9/250 KiB; chat
104.9/135 KiB; Cesium 1,118.9/1,150 KiB; 3D workspace 6.3/10 KiB; web CSS
34.2/35 KiB; chat CSS 15.1/16 KiB. React 19.3 requires 66.0 KiB and the explicit
React budget is 67 KiB. The budget check traverses actual manifest imports and
unique CSS rather than accepting a tiny entry stub. Cesium/3D/XR are absent
from the 2D route's static graph; Matrix/PDF/ZIP are absent from the initial
chat shell.

Anonymous chat shell rendered without JavaScript errors or horizontal overflow.
All five synthetic demo steps and restart passed on desktop and mobile, with
real map markers and explicit stale/unverified outage state. Mobile map camera
changes cancelled eight public raster requests (`ERR_ABORTED`); these are
recorded, not hidden as successful transfers. No unexpected request failures,
JavaScript/console errors or origins were observed.

The separate 3D walkthrough used a real loopback COP API with one canonical,
explicitly public synthetic object, in-memory stores, no credentials, no
external providers and external API fetch forbidden. All 18 API responses were
200 JSON; WebGL drawing, synthetic object detail via shared fragment, focus,
refresh and limited rendering mode passed. The initial static-only smoke lacked
an API reverse proxy and is not evidence of data loading; this separate API
walkthrough resolved that test setup limitation. Direct pointer selection of
a 3D marker, authenticated chat, E2EE and voice acceptance remain unverified.
The test API was stopped. Frontend render evidence is from `6cb37c2`; final
canonical-policy changes are independently covered by the final API tests.

## Remaining work and release boundary

- No guarantee is made about all authentication, E2EE, voice or physical-device
  workflows from anonymous rendering. Current production Matrix recovery and
  nonblocking history backfill are preserved; cross-device decryption still
  requires real-device acceptance.
- Federation has a privileged service role boundary; per-node actor delegation
  is not yet provisioned. Source/node identifiers alone are not an actor
  credential. Complete node-specific identity scope before granting independently
  operated nodes this global integration role.
- Target CDS/ABAC semantics for classification `releasability` and
  `handlingCaveats` remain unresolved in `docs/06_OPEN_QUESTIONS.md`. This audit
  does not invent tag semantics or certify that target policy; it enforces the
  current UNCLASSIFIED/public-release boundary.
- In-memory event/idempotency/audit growth and durable stream-bus retention need
  an approved retention/index plan. Do not delete protected history or audit as
  a performance shortcut. Validate realistic long-duration ingest before a
  scale claim.
- Production dependency health already reported a degraded SIM-search upstream;
  distinguish that pre-existing condition from this candidate's own health.
- Legacy persisted canonical objects without verified classification are kept
  but withheld from the shared public feed until a fresh validated update.
  Do not mass-label historical rows as public to avoid this migration boundary.
- Production activation must preserve the approved X5 runtime guard, Compose
  overrides, secrets, network attachments and existing AI flags. Use the
  [X5 deployment/rollback runbook](19_COP_X5_STORAGE.md); build/test success is
  separate from deployment and authenticated acceptance.

## Delivery

The candidate is published on `codex/cop-performance-security`, based on the
production source `046b577` and incorporating current main fixes. Review targets
`codex/cop-x5-storage` so unrelated pre-existing production features are not
presented as new changes against main. Production release is not performed by
this audit. GitHub-hosted CI and authenticated/mobile acceptance remain separate
gates.

Local smoke/API servers were stopped. All dedicated Linux validation containers
and the audit-only helper image were removed. Only this job's regenerable work,
dependencies, caches and temporary directories were removed under the COP storage
and job locks. The managed X5 job is completed; retained logs and source archives
remain subject to the existing 14-day / 10 GiB staging policy. No broad Docker
prune, production restart, secret change, global builder/data-root change or
protected-data deletion is part of this audit.

## Final integrated deployment (2026-10-10)

The dependency-only branch `3f9c6aa` passed hosted CI
[38065818418](https://github.com/voldzi/delta_acr_cop/actions/runs/38065818418).
The combined API/web release `a58b73f` then passed its own hosted CI
[38066956522](https://github.com/voldzi/delta_acr_cop/actions/runs/38066956522):
**1,581 tests passed / 8 skipped**, both workflow jobs successful, including
Docker builds and secret scan. Its production dependency audit reports
**zero advisories / 346 dependencies**. These figures include restored existing
production features and the new notification/news modules; they supersede the
earlier candidate's release gate, not its historical measurements.

API and web are now deployed. Actual image IDs, runtime health, rollback
protection, preserved production features and remaining SIM/device acceptance
are recorded in [runbook 21](21_COP_CRISIS_NOTIFICATIONS.md). The standalone
chat image, edge, MCP, networks and AI routing flags remain unchanged.
Dependencies and source repairs prepared for the standalone chat still need a
separate coordinated rollout. No perfect-security, full physical acceptance or
long-duration performance claim follows from the successful audit and release.
