# Messaging recovery and automatic vehicle conversation — 9 November 2026

## Observed cause and repair

Synapse rejected startup because `device_inbox_sequence=630, is_called=true`
was behind the durable `to_device` position `master=660`. Both associated tables
(`device_inbox`, `device_federation_outbox`) were empty. Empty tables did not
invalidate that durable floor. The encoding and locale were valid; unsafe locale
mode was not enabled. The origin of the sequence drift remains unproven.

The resulting upstream outage surfaced in Messaging as refusal to hydrate the
account-safety database replay. The replay journal, original identities, catalogs,
permissions and materialized fences had passed separate read-only checks.
No replay/startup/pin decision was bypassed to make the application start.

One reviewed operation advanced only this sequence to 660 (`is_called=true`, next
ID 661), after stopping every observed Synapse writer and proving no other database
sessions. The old and target snapshots, exact runtime/config/network hashes,
stopped peers and actual apply/commit readback are in
[the immutable repair receipt](sequence-receipt.json).

The same Synapse container, image and configuration restarted. The independent
Python maintenance client used the already pinned Synapse image, no homeserver
entrypoint, no ports, a read-only root and bounded tmpfs. Runtime credentials were
kept only in server RAM/stdin. The client was removed before restart. The helper
is [read-only by default](../../../scripts/synapse-sequence/repair.py); apply uses
an exact plan CAS and an exclusive one-attempt marker. It cannot be blindly reused.
After uncertainty it only reads back; it never retries setval or rewinds a counter.
Unproven readback leaves the service stopped for investigation.

Six sequence-bound tests and three isolated DB-API client tests passed. The latter
cover no-result table locks, stale snapshot rejection before setval, and Python
optimization rejection before opening a database connection. These are fixtures,
not a claim that an isolated PostgreSQL instance was exercised. The actual live
apply and post-commit readback are separately recorded.

## Runtime and COP release

[Final live health](final-health.json) records Synapse and Messaging healthy,
Messaging live/ready 200 and COP ready 200. Messaging recovered through its normal
startup path. The historical Messaging restart count is retained; it did not rise
after the recorded successful start. No credentials, messages, recovery secrets,
user identifiers or vehicle details are included in these receipts.

COP source `c7efa00417e51d57b26ad4c6087abe0aae778f54`, image
`sha256:31bc362158845c8487a25392a79249d77b377c86e46fb459deb715aa04e0568f`,
was prepared and activated using the existing application-owned release broker.
The exact-image expanded suite passed 141 tests, with no failures or pending tests;
the broker's required tests, compatibility checks and normal live activation gate
also passed. The deployed generation is `aa0673362aac41c3892df549925c83ee`, release
`release-8e334f6c8c5d40e7bc9ff53b8a732e9a`. It is recorded by the broker's persistent
accepted release state; no infrastructure-admin deployment or generic sudo grant
was needed.

A read-only aggregate after activation found one active vehicle, one ready
conversation projection, no pending/missing projection and no ready membership
revision mismatch. The new COP container was healthy with restart count zero.
The projection was created by the application worker, not by manual data edits
or replaying the owner's vehicle-create request.

## Native acceptance and remaining boundary

Jízda reviewed the immutable COP patch and the exact sequence-repair helper.
Its prepared 1.2 (94) client covers stable chat UI refresh, degraded list handling,
and explicit entry into a managed vehicle conversation. Its SDK/domain/UI/build
checks are separate from installation on the owner's iPhone.

A ready projection does not mean the viewer joined Matrix or received a message.
Native acceptance still requires the available phone and updated client: ordinary
Communication list with the vehicle title, explicit join using the existing typed
vehicle facade, correct current account, and stable recovery/UI. No forced join,
new identity, key reset, agent-generated message, call or GPS sample was used.
Jízda confirms the older 401/recovery report had already been overcome; no new 401
is claimed reproduced or newly fixed by the sequence repair. Physical acceptance
of build 94 remains unverified while the phone is unavailable.

The earlier [exact Messaging firewall release](../messaging-device-delete-20261106/README.md)
is preserved separately. The sequence incident is not evidence of a firewall
fault and did not require another firewall relaxation.

## Return and future preflight

Never roll the repaired counter backwards. If another startup error appears,
retain the higher counter and inspect it read-only. Never delete `stream_positions`
or create a new empty homeserver as a workaround. Before activating a restored
Synapse database, compare durable stream positions and both table maxima against
sequence last value/is_called and inventory all writers.

COP backfill has now published a managed binding: restoring a predecessor which
omits enrollment is not an automatically safe rollback. Preserve the same room,
intent and membership fences; use a separately reviewed code return if needed.
Admission OFF pauses new backfill but must preserve pending revocation/closure work.
Existing owner vehicle, local history, unsent records and encryption keys remain
outside this release's mutation scope.
