# Shared vehicle communication: contract and implementation boundary

Status 2026-11-04: staged DTO and enforcement validation only. No new public
endpoint, runtime capability, vehicle chat or production activation exists in
this change. Existing personal messages, direct calls and GPS consent are unchanged.

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

Agreed runtime facade names (implementation pending):

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

## Verification so far

- 21 isolated TypeScript checks passed: exact roster, two distinct accounts,
  duplicate/extra/missing/removed members, old revision, cross-vehicle evidence,
  binding replacement, verified generation retirement and unknown enforcement. Client input cannot select actor,
  members, conversation, room, history or revocation policy.
- The standalone Swift executable passed DTO decoding, account/vehicle/operation
  isolation, late revision, invalid room/timestamp and unsupported enum checks.
- OpenAPI validation passed with warnings, including two intentionally unused
  staged components; no endpoint availability is implied.

Not yet verified: actual provider membership saga, direct Matrix bypass denial,
new message and queued notification revocation, E2EE history/key behavior,
restart/retry/late response integration, native runtime facade or production.
No real account was used and nothing was uploaded to TestFlight.

## 4 November implementation checkpoint (not activation)

The request-only facade is staged alongside the DTO in
`docs/integration/sdk/shared-vehicle-communication-v1/`. It uses the host's
existing authenticated mobility transport, verifies the current mobility account
and vehicle membership, and separates HTTP 200 ready from HTTP 202 join_required.
It never selects or joins. `recipientEpoch` is server-owned; the client request
still contains only operationId and expectedMembershipRevision.

COP checks: 43 focused tests, API TypeScript check, focused ESLint, skeleton,
OpenAPI validation (35 warnings), standalone DTO checks and request-facade Swift
6 typecheck against minimal runtime stubs passed. The stub check is not an iOS
SDK build or device acceptance. Native selection, explicit invitation acceptance
and captured recipient-epoch checks on all outgoing queue paths remain pending.

The separate Messaging candidate keeps the physical room stable, requires actual
current recipient joined readback before handoff and includes a durable CAS fence.
Its local suite passed 256 tests with 41 skips; three additional opted-in tests
passed against an isolated PostgreSQL 17 instance, then its container and private
fixture were removed. The three tests cover competing CAS writers, durable pending
state despite a failed publication transaction and publication/handoff lock ordering.
They do not establish real Synapse/SDK E2EE or APNs acceptance. No production flag,
controller account, existing conversation, user history or GPS consent was changed.

A subsequent source-only native handoff adds explicit invitation acceptance,
nonjoining selection and recipient-epoch journal guards. The candidate full SDK
built for iOS Simulator; all23 MatrixDraftSubmissionTests passed. Exact application
instructions and baseline hashes are in the adjacent SDK `HANDOFF.md`. This
supersedes the earlier checkpoint's statement that native facade source was
missing; real Synapse/E2EE/push acceptance and server projection remain pending.

The c78169a cached epoch comparison is not by itself a fresh send authority.
The required follow-up patch uses a server/own-native-identity checker before
new managed handoff/replay.31 isolated simulator tests passed, including actual
checker code over synthetic intercepted HTTP. See SDK HANDOFF.md patch2; the
COP durable source projection/endpoint/lifecycle and actual Megolm acceptance
remain missing and production activation is still prohibited by readiness.
