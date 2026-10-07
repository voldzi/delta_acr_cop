# 20 COP code health: security, performance and dependencies

Evidence date: 2026-10-07. Scope: COP API, web, chat and shared packages.
Status: candidate repairs; production images have not been switched by this audit.

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

| Boundary | Repair |
| --- | --- |
| Protected input | Authenticate before JSON body parsing; preserve CORS preflight. |
| Public input | Explicit 64 KiB map-query, 256 KiB Matrix-push and 1 KiB logout limits; existing correlation-aware 413 envelope. Media attachment limit is separate. |
| OIDC/JWKS | Reject malformed claims and missing subject; bound JWKS to 5 seconds/256 KiB, use single-flight refresh and failure cooldown; reject credential redirects. |
| Server proxies | Fixed API origin/path; reject absolute request targets, strip hop-by-hop headers, cancel disconnected/expired requests. |
| OIDC token proxy | 64 KiB input/256 KiB response and 30-second deadline; never follow a token POST redirect. |
| Remote bodies | Bound streamed weather/camera reads; validate each allowed redirect, reject URL credentials and cover the response body with the deadline. |
| SIM Router | Reject redirects and bound response bytes; no new direct external fallback or activation. |
| Logs | Request path only; remove query, pairing tokens and raw geocoding search terms. |
| Source registry | Explicit integration/security administrator mutations; validate merged PATCH and immutable identity before changing state. |
| Integration data | Protect domain/outbox/replay/DLQ reads and writes with service/admin roles, including MCP bypasses; ordinary citizen sessions receive 403. |
| Canonical data | Explicit ingest roles, per-item batch policy, verified classification and public release policy on ingest and all read/evidence paths. See ADR 0039. |
| Static files | Validate decoded paths and resolved file root; reject malformed/NUL paths and symlink escape. |
| Compression | Brotli quality 4, correct `q=0` handling; avoid expensive quality 11 on first asset request. |
| Initial map bundle | Explicit nonrecursive chunks; optional Cesium/3D/XR must remain outside the initial static import graph, enforced by release check. |
| Cesium assets | Replace static-copy dependency with a tested fixed-directory plugin; retain only required Assets/ThirdParty/Widgets/Workers roots. |

No CSP relaxation, global CallKit change, analytics activation, AI routing switch
or deletion of audit/history is included.

## Dependencies

Against the npm registry, 37 unique direct libraries (49 manifest references)
were updated within the selected compatible release lines. pnpm moved from
10.33.0 to 10.34.6. Frozen offline installation passed for all 17 workspace
projects. Lockfile SHA-256:
`1cd6a605815feeb3d094e6cd2016c3665a4231406bbca2315d3821f325d4b905`.

The full dependency audit decreased from 13 advisories (4 high, 7 moderate,
2 low) to **zero at every severity**, across 630 reported dependencies. No
ignore rule or vulnerability suppression was added. CI now fails from `low`
severity. The unpatched `braces` chain was removed with `vite-plugin-static-copy`.

CI actions are upgraded to Node 24 runtime releases and pinned to verified full
commit SHA: checkout 7.0.1, setup-node 7.0.0 and Gitleaks 3.0.0. The workflow
token is read-only, checkout does not persist credentials and implicit package
cache is disabled. [GitHub removed Node 20 action runtime on 2026-09-23](https://github.blog/changelog/2026-09-23-node-20-is-no-longer-available-in-github-actions/).
The actual hosted workflow remains a separate verification after publishing.

| Selected dependency | Candidate version |
| --- | --- |
| Fastify | 5.12.5 |
| React / React DOM | 19.3.0 |
| MapLibre | 6.13.0 |
| Cesium | 1.146.0 |
| LiveKit client / server | 2.22.3 / 2.19.1 |
| PDF.js / JSZip | 6.4.299 / 3.10.2 |
| Vite / Vitest | 8.3.3 / 5.0.3 |
| Redocly | 2.60.0 |
| ESLint / typescript-eslint | 10.12.0 / 8.71.1 |
| Node types | 24.19.1 (Node 24 runtime line) |

Not every published major is adopted automatically:

- Matrix 42.3.0 remains: [43.0.0 changes OAuth refresh ownership and RTC events](https://github.com/matrix-org/matrix-js-sdk/releases/tag/v43.0.0), requiring coordinated login/call/device regression. Keep the `matrix-events-sdk` 2.0.0 override.
- TypeScript 6.0.3 remains: [TypeScript 7 removes the JavaScript compiler API](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/); the installed ESLint parser supports `<6.1.0`.
- Three 0.185.1/types 0.185.4 remain: [r186 changes geometry/disposal APIs](https://github.com/mrdoob/three.js/wiki/Migration-Guide#185--186); XR regression is a separate migration.
- Node types stay on 24 rather than 26, matching the supported runtime. Production inventory showed Node 24.21.0.
- pnpm stays on the project's 10.x release line rather than introducing a package-manager major migration.

## Verification record

Initial targeted verification: 19 web/chat HTTP, chunk and asset tests passed.
New API negative tests passed in the initial targeted run; two existing positive
tests received overload 503 on the heavily contended Mac. A full clean Linux
gate is required before accepting the candidate; it uses a dedicated COP X5
job and builder, no production configuration, no public ports and no runtime
external network. Results are recorded here after that gate finishes.

Baseline browser evidence used clean anonymous desktop/mobile contexts with
DNT/GPC, service workers blocked and only the public synthetic flood demo.
The old initial graph preloaded an approximately 838 kB Brotli Cesium response.
Both pages transferred about 1.66 MB and reported no JavaScript error or
horizontal overflow. The Mac was simultaneously saturated by an unrelated iOS
simulator; measured paint/compression times are diagnostic, not representative
latency commitments. The code comparison uses the same updated dependencies
for baseline and candidate to isolate chunk/compression behavior.

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
- Production activation must preserve the approved X5 runtime guard, Compose
  overrides, secrets, network attachments and existing AI flags. Use the
  [X5 deployment/rollback runbook](19_COP_X5_STORAGE.md); build/test success is
  separate from deployment and authenticated acceptance.
