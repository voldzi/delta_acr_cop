# Driver retention XID store-channel SOURCE CANDIDATE

Status: **owned mechanical PostgreSQL fixture only; not deployable or accepted native authority**.
The earlier proposal `5dbc6f42…993282` remains unchanged as input. This candidate
implements the selected DB role/XID/lock mechanics instead of an app-only if/marker.

## Concrete source

`candidate.sql` defines a restricted NOLOGIN function owner, a registrar/control
role, an executor role and an ordinary runtime role, in the owned fixture only.
Runtime and executor have no direct DELETE on any of the four measurement tables
and no origin journal DML/TRUNCATE. Runtime cannot select privileged roles or call
the destructive/control functions. All functions use fixed SQL, qualified table
names, protected ownership and a fixed search path; PUBLIC execution is revoked.

The trusted test controller owns both connections: the origin connection reads
its actual `pg_current_xact_id()`, PID and backend start directly; the separate
control connection registers/claims before effects. SQL additionally verifies
the live executor backend, current database and low XID bits, then the executor
checks the **full XID8**, PID/start and fixture store incarnation at its gate.
The ordinary runtime supplies none of these. The fixture uses local trust
authentication and is not evidence of production Root role authentication.

The immutable journal binds operation, original permit, body/schema digests,
stored cutoff, store incarnation and fixed operation kind. These are synthetic
fixture values. They are not accepted registry bodies, four typed references,
lineage/continuity evidence or financial/accounting outcome evidence.

State transitions are one-way:

```text
prepared → claimed → committed
prepared/claimed → sealed_no_effect
```

Claim is durable once through the separate control connection. After rollback,
a new transaction cannot reuse it because its actual XID differs. The fixed
executor first locks the origin and checks the exact claim; its two expiration
DELETE statements, receipt cascades to intervals/ETA and committed marker share
the **same origin transaction**. Cutoff is read from the immutable row, not chosen
again by the executor. Permanent fence data is outside that plan.

The Root sealer uses the same row lock. An active executor makes it return busy;
a committed marker resolves commit; otherwise it can durably seal the exact
existing origin against late entry. Missing origin remains unknown. A seal
obtained before the executor gate bars even the still-live original transaction.
This proves that exact origin's allowed effect closure, **not** PostgreSQL
ROLLBACK receipt, physical backend shutdown or owner-wide drain/replay.
The seal function's returned JSON inside a transaction is not a durable seal:
control COMMIT and fresh exact-origin readback are required.

Lost claim acknowledgement must lead only to original-origin probing and
rollback/disposal, with no later execution from historical claim ACK. Lost
COMMIT acknowledgement resolves from the original durable marker/seal, never
blind retry or a new permit. The source fixture does not implement native RPC
delivery or the production error/acknowledgement handler.

## Contributor revocation SOURCE seam

The second fixed executor reads one Root-registered contributor hash and
revocation-until value from the immutable origin, writes its revocation and
deletes only that contributor's current receipts/cascades in the same claimed
transaction. Neither field is a runtime selector. A NULL contributor is denied.

This preserves a concrete integration seam, **not accepted COP identity,
consent, revocation or whole-account erasure authority**. Ordinary intake still
needs its existing revocation/account-fence admission checks. Runtime INSERT can
otherwise recreate receipts; the seam itself does not prevent that. Its Root
registered expiry can replace an earlier/later value; no real expiry policy is
approved here. SIM must separately adapt its actual intake/revoke/erasure paths
and privileges rather than blindly install this fixture schema.

## Own verification

Real owned PostgreSQL **18.6**, pinned existing image:
`sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873`.
**9/9 PASS, 0 skipped**, second attempt; `proof.json` and
`owned-run-attempt-2.log` record that run and exact tested source pins.

1. Seventeen raw DELETE/journal/role/executor bypass attempts denied.
2. Claim duplication, changed immutable registration and post-seal claim denied.
3. Commit marker plus all four table effects; permanent fence preserved.
4. Original rollback restores effects; subsequent actual XID cannot reuse claim.
5. Original transaction alive at seal; late executor denied, no rollback inferred.
6. Active executor lock keeps sealer pending; resolution only after origin ends.
7. Originating COMMIT completion withheld **from the controller**; durable
   readback resolves committed with one destructive invocation. This is not a
   packet-loss or native RPC test: psql itself is the PostgreSQL protocol client.
8. Missing origin stays unknown; rows later than exact cutoff are retained.
9. Contributor-bound revocation seam preserves the other contributor and rejects
   a missing contributor; actual consent/erasure authority remains false.

First attempt stopped before tests because the image's temporary init server
passed readiness immediately before restart. `proof-attempt-1.json` and its log
retain the error. The harness now waits for final postgres PID1. A read-only peer
also found a conditional CHECK/NULL issue; it was fixed before the passing run
and the contributor case exercises rejection.

No image pull/build/install, application import, production SQL or real data/GPS.
Container: network none, read-only rootfs, unprivileged postgres, capabilities
dropped, no ports/binds/volumes; three tmpfs paths. Prepared transactions are zero
**in this fixture only**. Own container was removed, volume count **29 → 29**,
no Docker context change and no prune. Data vanished with its tmpfs; source,
test log, proof and pins remain offline. The schema is a minimal relational
fixture, not the full installed SIM schema or actual installed constraints.

## Still unresolved before application integration

The actual Root-controlled origin/control connection composition, protected
profile and fixed pool budgets, producer, native transport/delivery/custody,
current store incarnation/lineage/restore continuity and accepted registry refs
are **not implemented or accepted** here. A fixture login/UUID/XID/JSON result
does not supply that authority. There is no new secret, caller-selected path,
boolean factory, Node app DB/XID/pool/SQL selector or accepted installer.

Conditional fixed whole-COP expiry is only the jointly selected SOURCE minimum.
Actual no-retain/report policy and installed four-effect closure need owner
acceptance; historical routing datasets are inside this store-wide fixture plan.
This code creates no production permission or production migration/grants.
No continuous exe/kernel identity across external COMMIT is required.
