# Qualification of the frozen nine-case SQL candidate

The original SQL, nine-case test, proof, log, patch and `SOURCE-PINS.json` remain
byte-exact unchanged. Their **9/9** result is not reassigned to new sources.
This addendum and one separate actual-PG test qualify that result.

## Control transaction must commit before terminal publication

`resolve_or_seal()` returns its JSON while still inside its caller's transaction.
If a Root wrapper calls it in explicit BEGIN, the JSON alone cannot publish
known-no-effect, quiescence or settlement. The wrapper must observe its actual
control COMMIT and obtain fresh exact-origin terminal readback. A lost control
COMMIT acknowledgement permits only the same-origin readback/probe, never a
blind terminal classification or new work.

`test_outer_seal_pg.py`: **1/1 PASS**, separate owned PostgreSQL fixture. It
demonstrates both branches:

- BEGIN → seal JSON → control ROLLBACK: fresh row is still claimed, and the
  legitimate original XID can subsequently execute and commit. The earlier
  returned no-effect JSON was not durable closure.
- BEGIN → seal → control COMMIT + fresh readback: row is terminal sealed and
  the still-open original transaction cannot pass the executor gate.

Proof: `outer-seal-proof.json`; log: `owned-outer-seal-run.log`. The same pinned
existing PG18.6 image was used with network none, read-only rootfs, no ports,
binds or volumes; own tmpfs data and container were removed. Volumes **29 → 29**.
Only this concrete additional transaction-risk case ran; the original nine-case
suite was not repeated. Native delivery/custody/Root composition remain false.

## Revocation is a source seam, not existing revoke/erasure proof

`contributor-revocation-source-v1` is solely a narrow SQL/XID mechanical seam.
It does not contain the current SIM batch/contributor advisory locks, global
account-fence/consent/intake admission or an accepted identity/erasure guard.
Its origin journal stores a contributor hash; future actual use needs separate
privacy, retention, account-unlink and Root-guard acceptance. No such acceptance
or retention period is granted here. Current intake can still recreate receipts
unless its separate real admission checks are preserved and adapted. The source
function can replace revocation expiry; actual expiry policy remains unaccepted.
Its fixture test proves only contributor-bounded current SQL effects.

The candidate schema/LOGIN roles apply only to owned fixtures and are not a
production migration. Actual Root-controlled origin/control connection and
producer composition, protected authentication, accepted refs/lineage and native
RPC/delivery/custody are not implemented or accepted. No SIM source, production
data, real identity/GPS or credentials were used or changed.
