# 32. COP Dispatch lease: recovery proposal and runtime evidence

Status: runtime restored by an explicitly approved API-only restart. Automatic recovery and readiness changes are proposed, not implemented or deployed.
Date: 2026-10-05.

## Observed production state

Before restart, two independent read-only queries found zero granted PostgreSQL advisory locks `(731031, 1)`. Shared mobility and private Dispatch flags were true. The configured PostgreSQL endpoint `haproxy.home.cz:5000` was reachable, primary (`pg_is_in_recovery=false`), and the mobility table existed. No user content was queried.

The packaged production implementation acquires this session lock only in `initializeDispatch` during API startup. A pool/lease connection error sets `dispatchOwner=false`; it has no reacquisition path. This explains how Dispatch can remain unavailable after connectivity returns. The original TCP/failover trigger and the affected iPhone response are unconfirmed. Database lock absence does not directly expose the process-local flag.

`GET /health/live`, `/health/ready` and `/health/dependencies` all returned 200 before restart despite the missing lock. Their status therefore did not prove Dispatch availability. No authenticated user request was fabricated: account initialization is a write, even on a GET.

## Approved operational recovery

The human user expressly approved restarting only COP API after disclosure that active position shares would stop. At 2026-10-05 08:08:49 CEST the existing container was restarted without recreation or a release:

- Container: `e6542a22796a0b1cd827c3038547ae78b70300c6f1804c0cbb0c1c2ec19cfc47`.
- API image: `sha256:d4f9b1f6ee9121f85640e6445a0926928a0c07271a77b617256ec1b9e200e5b8`.
- Production checkout: `6583cb5ab659044cc681294ee291f9b08135a4bc`.
- Configuration, mounts, image, other containers and checkout verified unchanged.
- All three health endpoints returned 200 after restart.
- Read-only check confirmed exactly one granted Dispatch lease. A second check at 08:11:28 CEST (2 minutes 38 seconds after startup) still found one lease and all three health endpoints returned 200. This is a short observation, not proof of long-term recovery.

Startup deliberately invalidates active shares and clears old in-memory position ciphertext. Users must explicitly restart sharing; there is no automatic reactivation. No test accounts/data, direct SQL user changes, measurement activation or other service restart occurred.

## Proposed permanent fix — separate server stage

1. Give the Dispatch lease an explicit lifecycle: `unavailable`, `recovering`, `ready`, `stopped`. Mark unavailable on connection error/end and verified lock loss, with a monotonically changing generation to reject stale work.
2. Use a bounded heartbeat on the lease-owning connection to verify primary role and ownership by its backend. Do not treat a healthy arbitrary pooled connection as proof of ownership.
3. Recover with a single retry task and bounded backoff/jitter. Obtain the exclusive session lock on a dedicated connection; a competing instance must stay unavailable. Shut down/cancel recovery on service close. Do not add a public port or change networking.
4. While unavailable/recovering, keep private Dispatch fail-closed with existing `503 DISPATCH_UNAVAILABLE`, not 403 or implicit fallback. Do not expose stale in-memory points.
5. On loss clear the old RAM point cache. Before making a newly acquired generation ready, atomically invalidate prior active shares using the existing restart semantics. A recovered connection must never restore consent or resume publishing automatically. Coordinate the expected interruption with mobile consumers.
6. Include enabled Dispatch lease state in readiness/dependency reporting; keep endpoint names and compatible COP error/correlation envelope. Preserve basic liveness. Update binding OpenAPI and the health documentation if fields/status semantics change.
7. Log only lifecycle category/generation/correlation and retry counts, without coordinates, ciphertext, account identifiers, DSNs or credentials.

## Required acceptance for the separate stage

- Real PostgreSQL tests for a lease connection disconnect while the database stays reachable, reconnect/failover, and unavailable database.
- Exactly one holder across two competing API instances; no retry task/connection leak.
- Ready remains false until ownership and prior-share invalidation are confirmed.
- In-flight old-generation publication/snapshot cannot reintroduce a point after loss/recovery.
- Active shares stay stopped, points absent, users must grant/start again.
- Correct 503 and readiness during recovery, healthy account/API behaviour assessed separately.
- Shutdown cancellation, rollout/rollback and read-only production lease verification; no synthetic production users.

## Mobile delivery

The independent SDK correction is published in COP-Mobile branch `codex/shared-mobility-sdk`, commit `1f2e9f7`. It shares OIDC refresh and exposes same-account restoration without Matrix logout. Final simulator package regression: 103 passed, one private road replay skipped; 13 new authentication/restoration tests passed. Physical iPhone acceptance remains pending and is not replaced by server health or simulator success.
