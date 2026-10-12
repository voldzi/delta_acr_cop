# 23 COP service-account stability acceptance

Date: 2026-10-12. Source prepared; this document does not claim production cutover.

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
