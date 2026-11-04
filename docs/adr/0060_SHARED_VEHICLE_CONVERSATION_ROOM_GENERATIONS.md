# ADR 0060: membership-controlled vehicle conversation

Status: accepted implementation direction, not deployed. Revised 2026-11-04.

## Context and scope

A vehicle has one server-owned conversation and one stable Matrix room. Accepted
COP vehicle membership determines its audience. Personal conversations and calls
keep their existing behavior; GPS still requires separate consent. There is no
existing vehicle conversation to migrate.

The earlier staged proposal required rotating the physical room on every roster
change. That is deferred optional hardening, not a prerequisite of this feature.
Joined history enforces access at each actual membership period. A previously
authorized historical event delivered after rejoining is not itself evidence of
a new-content leak. Previously delivered plaintext and keys cannot be recalled.

## Decision

- Use one stable logical conversation and stable native room. Room generation
  identifies a binding; normal roster changes do not replace it.
- Set E2EE, joined history, invite-only access, no guests and no federation at
  creation. A reviewed noninteractive nonadmin controller owns room policy.
  Never silently reuse an administrator or AI bot with crypto devices.
- Persist pending before native effects. Remove joined outsiders and cancel
  their outstanding invitations, then verify actual policy and membership.
  Never confirm a revocation merely because an HTTP action was accepted.
- Invite current members without force-joining them. The client explicitly
  accepts a verified exact invitation; selection does not autojoin arbitrary
  rooms. A typed join_required preparation is not a confirmed receipt.
- Serialize native cutover and actual notification handoff for each vehicle.
  Immediately before handoff check current metadata, actual recipient joined
  state and the recipient's access to the concrete event. Pending means deny.
  Already handed-off notifications cannot be recalled.
- COP owns recipientEpoch and advances it on every accepted roster change,
  including removal/rejoin. Capability-only changes may keep the epoch.
  Cached receipts also bind membershipRevision, actor and operation. Queued
  outgoing drafts retain their captured audience epoch and never automatically
  replay/re-encrypt to a different audience; retain the draft for explicit reuse.
- A pending native revocation cannot be skipped by a later regrant. Persisted
  operation identity and compare-and-swap reject late completions and writers.
- Managed room membership and binding cannot be changed through generic group
  APIs or ordinary Matrix member permissions. Server identity/roster come only
  from canonical COP data, never from the mobile request.
- Deleting a vehicle retires its room, removes ordinary senders and invitations,
  and preserves only technical evidence necessary for delayed-delivery denial.
  Account erasure must remove member identity references using the existing
  owner lifecycle; it does not authorize retaining message bodies or keys.

## Acceptance and deployment

Staged DTOs are not an enabled capability. Required acceptance covers actual
Synapse invite/kick readback, outsider prejoin and removed-member leave-gap event
access, actual SDK E2EE/session key behavior, pending/restart/race handling and
actual native push handoff. Mock transport tests alone are insufficient.
No TestFlight upload is authorized. Production controls remain in force; an
older writer must never overwrite enrolled pending state during recovery.

## References

- [Staged COP contract](../integration/36_SHARED_VEHICLE_COMMUNICATION.md).
- [Matrix history visibility](https://spec.matrix.org/v1.16/client-server-api/#room-history-visibility).
- [Matrix power levels](https://spec.matrix.org/v1.16/client-server-api/#mroompower_levels).
