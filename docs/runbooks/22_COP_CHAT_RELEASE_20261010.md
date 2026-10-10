# 22 COP standalone chat release and SIM acceptance

Evidence date: 2026-10-10. Status: implementation and local checks complete;
production chat replacement and joint SIM acceptance are pending.

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

## Published and production evidence

To be completed after the exact revision passes CI and production readback.
