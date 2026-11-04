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
vehicle UUID, operation UUID, current membership revision, stable conversation
and Matrix room. Its fixed scope is `shared_vehicle`, history policy
`from_membership`, revocation `server_enforced`. A timestamp describes an
observation, not an access credential or permission to use a cached receipt.
`confirmed: true` is reserved for actual membership and notification enforcement.
Pending, unknown or unavailable provider state cannot produce this receipt.

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

- 18 isolated TypeScript checks passed: exact roster, two distinct accounts,
  duplicate/extra/missing/removed members, old revision, cross-vehicle evidence,
  binding replacement and unknown enforcement. Client input cannot select actor,
  members, conversation, room, history or revocation policy.
- The standalone Swift executable passed DTO decoding, account/vehicle/operation
  isolation, late revision, invalid room/timestamp and unsupported enum checks.
- OpenAPI validation passed with warnings, including two intentionally unused
  staged components; no endpoint availability is implied.

Not yet verified: actual provider membership saga, direct Matrix bypass denial,
new message and queued notification revocation, E2EE history/key behavior,
restart/retry/late response integration, native runtime facade or production.
No real account was used and nothing was uploaded to TestFlight.
