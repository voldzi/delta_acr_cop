# ADR 0060: managed vehicle chat and immutable Matrix room generations

Status: accepted implementation direction, not deployed. 2026-11-04.

## Context

Jízda requires a shared chat whose membership comes from accepted COP vehicle
membership. Dispatch participants currently open a personal DM. The existing
Messaging group adapter only adds members and cannot establish vehicle revocation.
There is no existing vehicle chat to migrate.

Revocation within one E2EE room requires both native membership/key handling and
an immutable grant context for queued delivery, including notifications first
delivered after someone has left and rejoined. A current user-only membership
check cannot distinguish such an old delivery. A timestamp is not a membership
epoch. A new Synapse enqueue plugin is outside the chosen implementation.

## Decision

- One server-owned logical conversation belongs to a vehicle. An actual change
  to its accepted account roster creates a new, monotonically numbered Matrix
  room generation. A capability/role change without a roster change advances the
  vehicle membership revision but preserves the room generation.
- A durable pending fence precedes external effects. The old room becomes read
  only, with explicit plain/encrypted/call-event write thresholds and no active
  ordinary members or outstanding invitations. Actual policy/member readback is
  required. Old room IDs remain in the delivery deny registry.
- The replacement room has E2EE, joined history, invitation-only access, no
  guests and no federation from creation. A dedicated noninteractive nonadmin
  service controller owns its policy. No password, token, crypto device or key
  is given to clients on behalf of the controller. The existing administrator
  account is not silently reused as a room member.
- Current accepted members receive invitations. Nobody is force-joined. A
  requester receives a confirmed receipt only after actual joined readback.
  HTTP 202 with a typed `join_required` preparation is not confirmation.
- A metadata CAS and a PostgreSQL transaction advisory lock serialize each
  vehicle's policy cutover with the actual delivery handoff across processes.
  Pending work cannot be superseded by a regrant that skips its native retirement
  barrier. Unknown outcomes stay pending; old rooms are never a fallback.
- Ordinary group member mutation/binding cannot modify a managed conversation.
  Direct Matrix policy also prevents users changing invites, power levels or
  history policy. A server-only actor/roster adapter derives identities from COP.
- SDK selection, messages, paging, read state, notification actions and drafts
  bind the account, logical conversation and exact room/generation. Old outbox
  journals and drafts are preserved and cannot be resent to new recipients
  automatically. Explicitly reusing text creates a new outgoing intent.
- Historical room IDs/keys are not shared with newly accepted members. Already
  delivered data cannot be recalled. Old local history remains account-owned;
  it is not silently promoted to the current generation.
- Direct calls remain in their existing personal conversations. This feature
  introduces no vehicle group calls or PTT. GPS retains its independent consent.

## Deployment and lifecycle

The DTO/model publication is not a capability or an activation. The controller
custody, real Synapse policy/negative tests, new-room E2EE roundtrip, source
membership race/restart, stale delivery and native outbox regressions must pass
before production activation. No TestFlight upload is authorized here.

There is no automatic older-image rollback after managed metadata enrollment:
an old writer could overwrite a newer whole-store fence. Recovery preserves the
CAS, immutable generation registry and pending operation; forward repair is
preferred. Existing protected production deployment controls remain in force.

Technical retired-room evidence must survive while delayed delivery or a
recoverable copy can refer to it. It does not authorize retaining message bodies,
credentials or unnecessary user links. Existing account erasure must enumerate
all generations through the Matrix owner and remove active metadata/user links.
The implementation must test this lifecycle rather than infer it from schema
or successful room creation.

## References

- [COP staged contract and acceptance](../integration/36_SHARED_VEHICLE_COMMUNICATION.md).
- [Matrix power levels](https://spec.matrix.org/v1.16/client-server-api/#mroompower_levels).
- [Synapse impersonation without creating a device](https://element-hq.github.io/synapse/latest/admin_api/user_admin_api.html#login-as-a-user).
