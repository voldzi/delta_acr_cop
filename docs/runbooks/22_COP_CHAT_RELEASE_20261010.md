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
