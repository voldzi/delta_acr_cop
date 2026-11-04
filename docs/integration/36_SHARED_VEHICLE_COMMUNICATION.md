# Shared vehicle communication: contract and implementation boundary

Status 2026-11-04: implemented source candidate with admission disabled; not
deployed or production accepted. Personal messages, direct calls and GPS
consent retain their existing behavior.

## Client contract

Binding JSON models are `SharedVehicleConversationRequest` and
`SharedVehicleConversationReceipt` in the main OpenAPI and the shared mobility
contract. The request contains only an operation UUID and the expected positive
membership revision. COP derives the actor, vehicle roster, logical conversation
and Matrix binding on the server. A browser/mobile client must not choose any of
these or submit an enforcement assertion.

The receipt identifies the COP mobility account UUID (not the OIDC subject),
vehicle UUID, operation UUID, current membership revision, stable logical
conversation, exact Matrix room and room generation. Its fixed scope is `shared_vehicle`, history policy
`from_membership`, revocation `server_enforced`. A timestamp describes an
observation, not an access credential or permission to use a cached receipt.
`confirmed: true` is reserved for actual membership and notification enforcement.
Pending, unknown or unavailable provider state cannot produce this receipt.

HTTP 202 preparation uses `SharedVehicleConversationPending` with
`confirmed: false` and `state: join_required`. The SDK represents it as the typed
`CSMSharedVehicleConversationStateError.joinRequired`, code
`VEHICLE_COMMUNICATION_JOIN_REQUIRED`. It does not select or join a room. The host
checks its current account, operation, vehicle, revision and epoch before an
explicit invitation action, then reloads membership and requests a fresh joined
receipt. Retries are bounded and explicit.

The additive SDK file is
[`CSMSharedVehicleCommunicationContracts.swift`](sdk/shared-vehicle-communication-v1/CSMSharedVehicleCommunicationContracts.swift).
Copy only that file into the public SDK's CSMCommunicationKit source target;
the adjacent `main.swift` is a standalone synthetic test, not a library source.
This file alone does not add networking, select a chat, join a room or enable UI.

Runtime facade names (source handed to Jízda):

```swift
requestSharedVehicleConversation(
    vehicleId: UUID,
    request: CSMSharedVehicleConversationRequest,
    expectedScope: String
) async throws -> CSMSharedVehicleConversationReceipt

selectSharedVehicleConversation(
    receipt: CSMSharedVehicleConversationReceipt,
    expectedScope: String
) async throws
```

The implementation direction is [ADR 0060](../adr/0060_SHARED_VEHICLE_CONVERSATION_ROOM_GENERATIONS.md):
roster changes preserve the same logical conversation and Matrix room.
COP advances recipientEpoch when the accepted audience changes. Native drafts/outbox and
callback fences must distinguish the exact room, and retired rooms are never
automatically reactivated or used as a delivery fallback.

Before selection the host reloads both its account and vehicle membership,
compares the exact operation, account, vehicle and revision, and checks its
session and request epoch before/after every await. Selection must separately
verify fresh server mapping and Matrix joined state. It must not call the current
generic automatic room-join path on an unverified room. The host must reject
late results after account change, removal, revision change or replacement of
the pending operation. Selection never starts a call.

## Required server enforcement

The source review found that COP `MessagingProvider` only exposes additive
membership synchronization. Messaging `add_members` merges members and invites
them into Matrix; it does not revoke members. Current room creation uses
`private_chat` and encryption without an explicit vehicle history/power policy.
Metadata membership changes alone cannot prevent direct Matrix clients from
receiving future messages. Therefore generic group creation is not a substitute
for this integration.

Authoritative membership must be implemented with a durable per-vehicle binding,
operation hashes, revision comparison and revocation recovery. Messaging needs
actual Matrix removal of both joined and invited removed users, readback, and
notification audience enforcement at delivery time. New membership grants must
come from a committed current COP roster. A stale reconcile/job must not undo a
newer revocation. Pending distributed work stays pending; it is not a completed
revocation. No distributed transaction across COP, Messaging and Matrix is assumed.

A service-controlled room must prevent ordinary members changing invites,
join/history policy or power levels through direct Matrix APIs, as well as deny
generic Messaging add-members/room-binding operations. History policy must be
configured from room creation, with safe E2EE session rotation/key sharing.
Do not share old Megolm keys automatically with newly accepted members. Removal
cannot erase already delivered plaintext or keys from another device.

The isolated `assertVehicleConversationEnforcement` guard checks complete roster,
revision, vehicle, existing binding and required enforcement evidence. Passing
these structural checks does not establish that a provider performed the work;
only trusted server code may construct that evidence after actual readback.

## Implementation and acceptance, 4 November 2026

Source candidate includes the public conversation endpoint, source projection,
retry worker and Messaging close path. Both production admission flags remain
false; this is not a deployed capability. The SDK facade and fresh audience
checker were handed to Jízda with exact hashes in the adjacent HANDOFF.md.

COP persists a single immutable intent and recipient epoch in VehicleState,
in the same transaction as accepted membership changes. It stores no duplicate
subjects, names, message text, keys or GPS context. Provider calls happen after
commit, outside source transactions. A persistent 60-second lease and exact
operation/revision compare-and-swap reject stale completion. Further membership
changes cannot skip a pending cutover or active readback lease. Capability-only
changes preserve the audience epoch. A bounded worker retries four pending cars
at a time, retaining the exact original operation. Missing canonical identity or
account erasure fences deny projection.

For enrolled cars, membershipChange, inviteAccept and vehicleDelete may return
HTTP202 with the original receipt plus confirmed:false and
communicationState:pending. Source membership is committed, native access is
not confirmed complete. Clients must preserve the exact operation/body and show
pending until retry returns200confirmed:true. They must not discard local history
or claim a successful native removal. Unenrolled cars retain their existing200
behavior. Binding schemas are SharedVehicleMutationPending and
SharedVehicleCreationPending. Conversation preparation itself has separate
202join_required semantics; a provider outage returns503, never a ready receipt.

Vehicle closure uses a separate strict server-only close operation with pinned
issuer, existing service authentication and closed_vehicle purpose, without a
human actor header. It can only retire the exact existing conversation and room binding; it cannot
create or grant a room. A closure proof for a different conversation remains
pending even if the room string matches. A deleted vehicle is not pruned before native closure completes.
Account erasure cannot cross pending work or an active lease, including a
just-removed historical member; its accepted purge queues the remaining owner
or closed-vehicle cleanup without retaining a removed actor for impersonation.

Messaging persists pending via whole-store CAS, uses a PostgreSQL vehicle lock
for native side effects and actual notification handoff, and checks current
joined membership plus concrete event access for each recipient. Identity and
native provisioning use their existing owner locks before that publication lock;
the caller must not hold recipient locks across a GenServer call that reacquires
them. The owner regression test covers this cross-process deadlock.

Evidence (separate acceptance surfaces):

- COP: 73 focused source tests plus4 signed local HTTP tests pass; API typecheck
  and focused ESLint pass. Signed route checks include outsider denial, room
  injection rejection, pending mutation202, exact-operation retry200 and replacement-owner recovery
  after an expired lease without allowing the late former owner to overwrite it.
- Messaging:260 tests pass,41 skip in an isolated data directory. Three earlier
  PostgreSQL17 tests passed for competing CAS, durable pending despite rollback
  and actual publication/cutover lock ordering. Local fake-owner tests cover
  provisioning/lock order, ineffective kick remaining pending and machine closure.
- Real isolated Synapse1.156.0 protocol checks passed: actual invite/kick readback,
  prejoin and leave-gap denial, policy mutation denial and current joined proof.
 403 or404 without event data is a valid denied result. This ACL probe used
  placeholder ciphertext and is not itself crypto acceptance.
- Jízda independently ran the actual SDK Megolm test with persistent original
  stores/devices: plaintext decryption, changed session after removal, rejoin
  decryption and no leave-gap/new-member prejoin history. The first harness run
  failed because it expected403 where Synapse returned404; its original evidence
  is preserved. A read-only probe and continuation with the same stores/devices
  passed. Status: actual-native-crypto-phased-acceptance-passed. No key reset,
  import/export of prior keys, production users or real phones were involved.
-31 SDK simulator tests and Jízda's app builds/domain tests passed separately.
  They do not establish physical delivery or production acceptance.

Still required before activation: Jízda typed mutation202 handling, dedicated
controller custody/provisioning, guarded paired release, actual live COP source
and native identity integration and notification handoff acceptance. APNs and
physical-iPhone acceptance remain separate. No TestFlight upload is authorized.

## Operations and rollback

COP_SHARED_VEHICLE_COMMUNICATION_ENABLED defaults false. Messaging uses
CSM_SHARED_VEHICLE_COMMUNICATION_ADMISSION_ENABLED=false plus a separately
reviewed CSM_VEHICLE_CONTROLLER_MATRIX_USER_ID and custody flag. Capability
requires healthy database_v2 authority, PostgreSQL pool>=2 and actual controller
readiness, including closed-vehicle cleanup support. No new service token or
public Matrix management endpoint is introduced.

After enrollment, rollback means disabling new admission/UI while keeping the
same durable owner and cleanup-capable writer running. Never restore an older
writer that can overwrite pending state; never clear a pending intent to obtain
success. Retain source binding/operation evidence needed for denied late
handoff. Already delivered text, keys, SDK transactions and APNs cannot be recalled.
Personal messages/direct calls and independent GPS consent remain unchanged.
