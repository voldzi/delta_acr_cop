# ADR 0052: Approved shared-vehicle account-erasure policy

Status: policy approved; local source candidate; production activation blocked.
Date: 2026-10-13.

## Human decision and scope

The account owner approved: **delete own contributions and personal links;
transfer the owned vehicle to another authorized member first**. Other authors'
shared-vehicle records are preserved. Sharing a record does not create a blanket
retention exception. This decision approves no new financial retention,
production deletion, deployment, provider permission or secret.

The existing one-account `csm-mobile` login remains unchanged. Local feature
disable, installation unlink and deletion of the entire COP account remain
separate operations.

## Decision

Before full-account confirmation establishes its permanent fence, every active
shared vehicle owned by that account must already have been transferred through
the existing owner-only `transfer_ownership` operation. The recipient must be a
distinct, authorized existing member with a valid persisted identity/account
binding and no local deletion fence. Full-domain integration must also reject a
recipient fenced by the global account-erasure coordinator before local cleanup.
A stale local owner binding is cleared on transfer, not assigned to the recipient.
Ownership is verified from current stored state, never inferred from a name,
email or historical owner label.

A sole owner without an eligible member must first add an eligible member and
complete the transfer. The server must not choose a recipient, invent a new
owner or delete the vehicle and other authors' records to bypass this condition.
Ownership/provenance uncertainty blocks before a new fence; a later detected
change prevents a completed cleanup proof.

Own records, including ordinary deletion tombstones, must be physically removed
together with their historical copies. Other authors' events can contain those
copies or the departing member's identity in a vehicle snapshot, so event
authorship alone is insufficient. Personal membership and owner-binding links
are removed. Cross-account cached results must not expose erased records,
personal links or stale affected projections or revive old writes. Their
operation hash/timestamp may remain as an expired replay guard; this is not an
anonymous-data or legal-retention claim.

Current mileage/care projections use surviving records. Historical snapshots
lose affected optional projections rather than receiving current values
presented as historical facts. A different author's correction/reference to the
departing account's record blocks cleanup before fencing: its personal source
link cannot be removed by silently rewriting or deleting that other author's
record. A cursor for every affected vehicle is invalidated through the existing
membership revision, including when the departing account had already left.

The stored record author is the original author even when an owner edits it.
If A's latest edit remains B's current record content, deleting only records
with `authorAccountId=A` retains A's contribution. Such unresolved current
edits block acceptance. The server must not silently restore old content or
rewrite B's record to claim A's contribution was erased.

## Local component versus complete domain adapter

The local `SharedVehicleErasureService` candidate provides actor-specific
assessment, local vehicle cleanup and a permanent local identity/account fence
against new writes and receipt replay. It deliberately is **not** registered as
a completed `mobility_dispatch` adapter. Vehicle cleanup does not establish
erasure of mobility identity, Dispatch, invitation providers or the whole COP
account. The source factory still connects only `cop_sessions_profiles`; all ten
other required adapters remain missing. Global deletion capability stays false
and its usable URL stays absent.

The mobility store serializes all transactions with the `mobility-v1` PostgreSQL
transaction lock, with a serial test-memory equivalent. Local cleanup and
writers must use that boundary and check the permanent local fence. This does
not prove real PostgreSQL, provider, restore or physical client acceptance.

An active Dispatch group owner has no approved transfer policy or transfer API
in this decision. Group ownership remains unresolved; automatic group deletion
or reassignment is not authorized by the vehicle policy. Claimed invitation
notifications may be in flight outside SQL. The current mobility account stores
only its current email, which cannot prove every historical invitation or
provider copy. These boundaries remain unverified and cannot receive a synthetic
completed proof.

## Activation and verification

The local source phase requires targeted ownership, two-account isolation,
historical-copy, cached-result, replay and concurrent-write tests. Exact current
results are recorded in [integration 43](../integration/43_ACCOUNT_SAFETY_COMPLETION.md)
after they run. The earlier 165-test gate covers the preceding published source,
not this new component.

Full-account activation still requires real adapters for every domain, accepted
retention and provider permissions, stable guard/rollback enforcement, isolated
synthetic-account acceptance and a separately coordinated production rollout.
No production account is deleted and no deployment, secret or grant is created
by this policy or documentation change.
