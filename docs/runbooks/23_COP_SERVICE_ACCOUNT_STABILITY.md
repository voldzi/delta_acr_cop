# 23 COP service-account stability acceptance

Date: 2026-10-12. API and Edge/MCP stages are deployed; final acceptance and lab
removal remain pending.

## Current verified production stage

The Edge/MCP stage started at **2026-10-12 21:53:56 CEST** and passed the unchanged
standard gate with all 26 dependencies `ok`. The host checkout is
`f84fe6f6177d70a533620ea86dd154376bfe7c3a`; application revisions differ by service:

- API remains application source `3a0101270bfb59b9bcf61eb2126588fc1f688fe7`, image
  `sha256:6d3fedf34265e4697fcea6dc23c38fc531a2d0f0eae45451671f71b86561b5a3`.
  Authentication remains `hybrid`, lab access `true`, two service bindings,
  four allowed client IDs (`cop-web,csm-mobile,cop-edge-pilot-sync,cop-mcp-readonly`)
  and BFF enabled. The nullable-expiry correction in `f84fe6f` remains source-only
  until a separate final API release.
- Edge is deployed from `f84fe6f` with OIDC, image
  `sha256:8b7b58dd63586ef87ff07f96307136731de3977d840ee659cfee372fe5615745`.
- MCP is deployed from `f84fe6f` with OIDC, image
  `sha256:1f1a7cd133e00316229487b17882ee4d7f9185cd7f41ac6406032bcecf5209fa`.
- Web and chat retain their original images. Their publication and API lab
  removal have not been completed by this stage.

The staged Edge/MCP runtime is Node **24.21.0**, Alpine **3.24.2**, x64. Its
resolved base is
`sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1`;
the frozen lock fingerprint is
`89326942986b1d781be5fa011198969b14baa3e11bc88272c93de57ab3053ca2`.
Do not assume runtime/base/dependency identity with the older images.

The sole real strict observation window **passed for Edge and MCP**: each
completed 610 real seconds and 62 actual readiness samples, with exit code 0 and
the final `strictAcceptancePassed=true`. Each separate helper verified three RSA
grants with 300-second lifetime, zero roles and exactly one `cop-api` audience,
and observed two helper-token rotations. Edge recorded 61 advancing sync times
with autosync enabled, no future times and age at most 30 seconds; MCP readiness
used its own running provider throughout. The owner-verified final readback at
**2026-10-12 22:18:50 CEST** confirmed unchanged container/image/start identities,
zero restarts, no OOM, all 26 API dependencies `ok`, the preserved API/BFF/auth
stage and original web/chat images. Edge outbox was empty and sync age 0.23 s.
Observer
`33730a091cdfc932885a0a130429d341e50653cd3b49499003d0ad57bc213460`
repairs only the helper's ESM import URL resolution. Its 35 offline assertions
and two full synthetic transport fixtures are instrumentation checks, not
production acceptance. Verified helper-grant counts concern a separate token
cache; they are not counters from the running services. The isolated
outage checks cold helper acquisition; failure during warm renewal remains
source-fixture evidence, not a production identity-provider outage.

Final API release and public-build activation remain on hold pending an explicit
next scoped GO. SIM/global database/network
changes are not authorized by this stage.

## Confirmed source defects and boundaries

- SIM search and situation requests cleared their timers after headers. The
  complete exchange now retains the existing deadline and rejects oversized
  bodies/redirects without retries. A native loopback fixture verified closure
  after a stalled HTTP 503 body and a successful response-body timeout, followed
  by success: six requests for two adapters, no retry.
- Stream initialization now owns and closes provisional listeners on connect or
  LISTEN failure/cancellation. Publication cannot certify listener availability.
  Shutdown claims concern these owned listeners, not a redesign of PostgreSQL
  schema/query timeouts.
- Search diagnostic fields now match SIM. COP preserves source timestamps,
  source evaluation time and its own receipt time separately. Known expiry is
  rechecked after each body and after all index pages arrive. COP-derived counts
  are separately labeled; source freshness is never overwritten.
- Invalid summary counts cannot hide a returned stale entity. Missing quality,
  warnings, source time or expiry remains unknown, not confirmed zero/freshness.
- Every owned pool has an idle-error handler, a fixed default component name and
  bounded RAM counters. Limits, transactions, TLS, DSN precedence and explicit
  Dispatch names remain unchanged. Counts are not shared database totals.

The historical failed API gate remains causally unknown: its container and
failed-response metadata were not retained. The defects above have direct
regression evidence but are not retrospectively declared its cause.

Track persistence remains degraded after a failed operation. Current code may
skip writes or remove a queued batch before a failure. A successful connectivity
read alone cannot certify persistence completeness. This release does not reset
that state or introduce unreviewed replay/reconciliation.

The first production API stage of `3a01012` passed the unchanged health gate.
Its diagnostic invalid-expiry count prompted a source-contract check; actual
entity values were not read or stored. SIM permits explicit null deadlines as
absence. A minimal source followup corrects that classification and preserves
stale/expiry/health behavior. It is not declared deployed by this document, and
no inference that all production items were null is made from an aggregate.
Followup validation: 68 targeted search/page tests, API TypeScript build, selected
ESLint and diff check passed; these are source checks, not another deployment.

## Source checks

- Full suite: 1,852 passed, 8 skipped (database prerequisites absent).
- TypeScript/ESLint, complete workspace build, formatting and skeleton passed.
- Eleven JSON schemas and binding OpenAPI passed; 24 existing OpenAPI warnings.
- Generated YAML exactly matched binding JSON; analytics and bundle guards passed.
- Native static web/chat smoke passed. Initial restricted local HTTP runs failed
  with sandbox `EPERM`; the same checks passed with local test-server permission.
- Independent source review cleared deadline, listener cleanup, pool configuration,
  multi-page expiry and strict diagnostic privacy boundaries.

Read-only baseline observation at 20:31 CEST found 13 established TCP sockets
owned by the COP API process to its configured PostgreSQL port. This is neither
per-store nor database-wide attribution. Earlier shared database counts cannot
be assigned to COP using that evidence.

## Coordinated production sequence

1. Coordinate one build/deploy slot with SIM and infrastructure. Verify the exact
   SIM/COP source pins, unchanged health comparator and preserved other services.
2. Use the existing documented X5 deployment script with `--exclude-env` snapshots.
   Preserve all four production Compose overlays, original image identities and
   nonsecret rollback flags. Secrets stay only in the existing `/srv/cop/.env`.
3. Stage only the API with service bindings, preserving web/native client IDs,
   hybrid authentication and lab access initially. Require the unchanged health
   gate plus bounded normal-processing pool/source metadata. Investigate real
   failures; do not adjust retries, roles or the comparator to pass.
4. Stage only Edge/MCP clients with OIDC. Check empty owned outbox, actual normal
   service health, exact restricted grants and denials. Prove renewal across two
   five-minute token lifetimes; simulate provider outage in an isolated helper.
5. Preserve actual web/native access. Reuse the prior human UI evidence as a
   baseline and distinguish new post-change observation from captured HTTP proof.
6. Build/deploy web/chat with empty public lab values. Disable API lab access last;
   require anonymous/invalid bearer denial and retained OIDC/BFF/native operation.

No broad Docker prune, network change, global PostgreSQL limit/role change or
termination of another application's connection is part of this sequence.

## Rollback and evidence

Use the scoped rollback in [Keycloak runbook](08_KEYCLOAK_COP.md) and the
[X5 runbook](19_COP_X5_STORAGE.md). Restore the exact original service image and
nonsecret flags in place; never restore/copy a whole `.env` for these credentials.
Recreate only affected services without rebuilding the rollback image. Recheck
X5/Sharp guard, all overlays, standard dependency comparison and client access.

The earlier attempted stage/rollback is recorded in the
[archived report](../archive/2026-10-12_COP_SERVICE_AUTH_ROLLOUT.md).
Record source/build, deployment, service renewal, lab removal and user acceptance
as separate results. Refer to [ADR 0047](../adr/0047_PROVIDER_PROVENANCE_AND_STREAM_OWNERSHIP.md)
for the diagnostic and provenance decision.
