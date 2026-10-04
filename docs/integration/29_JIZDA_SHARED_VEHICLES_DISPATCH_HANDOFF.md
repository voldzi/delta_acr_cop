# 29. Jízda shared vehicles and private Dispatch delivery

Updated: 2026-10-04. Implementation in progress; NOT deployed and NOT accepted
on a physical iPhone. Existing production routing is a separate delivered feature.
No driver location/traffic consent has been granted on behalf of a user.

## Contract source and integration

New JSON-first contract: [shared-mobility-v1.openapi.json](../api/shared-mobility-v1.openapi.json).
Release source branch: `codex/shared-vehicles-dispatch`, worktree:
`/Users/voldzi/.codex/worktrees/jizda-routing-safety/01 COP`.
Full binding OpenAPI there: `openapi/openapi.json`; primary standalone copy above
contains identical new schemas/operations for Jízda to inspect. OpenAPI validation passed with no errors and 26 warnings. Published contract revision `84531df` on `codex/shared-vehicles-dispatch`; do not infer running endpoints from this file.
Architecture/crypto/retention decision: release `docs/adr/0031_SHARED_VEHICLES_AND_PRIVATE_DISPATCH.md`.

Public SDK DTO/facade source now exists in COP Mobile:
`packages/CSMCommunicationKit/Sources/CSMCommunicationKit/CSMMobilityContracts.swift`
and `CSMMobility.swift`. Publication/build acceptance is pending. No generic token/HTTP bridge is planned.
Jízda must not access CSMCore, adopt private Matrix internals or activate gates
until the purpose-scoped SDK and joint acceptance are complete.

## Decisions

- Account is server UUID uniquely mapped to verified issuer+sub. Email verification
  comes from signed IdP claims; invitation accepts only the matching verified email.
- Vehicle creation shares only explicitly approved name/plate/VIN. Personal ride
  history, passengers and attachments never auto migrate. Owner+four drivers max.
- Mutations use persisted operation UUIDs, base data/membership revisions, concrete
  receipts. Read-only capabilities filter costs; concurrency rejects stale values.
- Liters/kWh/odometer decimal strings; money currency+integer minor-unit strings.
  Odometer is observations with explicit audited corrections, not summed ride GPS.
- Dispatch group membership is independent of vehicle membership. Recipient keys,
  exact audience hash and active-only roster must be ready before explicit share.
- Map point coordinates are recipient-encrypted and transient/latest-only. No GPS
  history, replay, Matrix timeline, SIM export or automatic restart/consent.
- Stop/hide confirmation is separate from accepted/pending network requests. Private
  zone entry sends stop metadata, never the private zone geometry.
- Registration remains unverified until actual IdP login-page registration and
  verified email are tested; creating an API account does not register an IdP user.

## Current evidence and blockers

Server behavior, PostgreSQL transaction/restart tests, SDK build/tests, deployment,
authenticated two-user acceptance and physical iPhone acceptance are pending.
Existing local Mobile routing/voice/measurement edits are preserved. No new
production secret or SIM private-data path has been created. The existing
analytics/routing production delivery remains intact.

UI integration belongs in Jízda's existing Pasažéři tab as requested by the human;
an ordinary personal passenger is not automatically a COP account or invited user.

Apple toolchain blocker: the selected workstation now has Xcode 27.1 (27A9269),
iOS SDK 27.1; COP Mobile requires approved Xcode 27.0 (27A266a)/SDK27.0.
No SDK release build with an unapproved toolchain is claimed or used to bypass
that mandatory gate. Contract review/server implementation can continue.

## Invitation delivery clarification

Invitations are addressed by verified email and discovered through the authenticated
`mobilityInvitations` inbox. Acceptance uses invitation UUID plus a fresh operation
UUID; identity comes solely from the verified session and matching verified email,
not possession of a link or a client email assertion. Creating an invitation is
nonenumerating and returns queued equally for existing/unknown accounts. This
phase does not claim SMTP delivery: Jízda must say “pozvánka připravena v COP”,
not “e-mail doručen”. Actual registration/email verification still belong to IdP.

## SDK and E2EE status

Typed source facade/DTO syntax diagnostics passed. Jízda independently reports
Debug+Release compilation of its application including these public SDK sources on
27.1, and 309 tests/58 fixture assertions; see its acceptance archive. This is not
COP Mobile's approved27.0 acceptance, nor live server/crypto verification.
The purpose-owned E2EE facade will be in `CSMDispatchEncryption.swift`; it is not
yet implemented. Jízda must not use typed transport to submit plaintext coordinates.

## Active integration update

The public crypto source now exists as `CSMDispatchEncryption.swift`:
`init(expectedScope:)`, `registerDevice(name:)`, `sealGPS(_:share:readiness:sequence:now:)`,
`openPoint(_:in:now:)`, and confirmed `revokeDevice(operationId:)`.
It owns account-scoped non-syncing ThisDeviceOnly Keychain material. No raw key
or general HTTP interface is exposed. Metadata recovery is `dispatchOwnedShares`;
use it to STOP orphaned sessions, never to restore consent or resume GPS.

Create/accept responses are now authoritative wrappers:
`CSMSharedVehicleCreationReceipt {operationId, confirmed, vehicle}` and
`CSMDispatchGroupCreationReceipt {operationId, confirmed, group}`. The wrapper
belongs to the exact requested operation; use its assigned UUID and revisions.
Invitation queued receipts remain separate and do not invent data revisions.

14 targeted backend tests passed, including isolated real PostgreSQL rollback,
concurrent operation/revision tests and actual RS256/JWKS two-account HTTP checks.
The human subsequently explicitly approved installed Xcode27.1/build27A9269/SDK27.1
in Jízda turn `01a10762-dadd-7b70-bc0e-f8ba8d5ecf80`, superseding the earlier27.0
choice. The exact verifier now passes; new crypto SDK testing is running. No SDK
revision or production activation is claimed yet. Existing client gates stay false.

SDK implementation `02df251`, formatting follow-up release `e6a6416` on
`codex/shared-mobility-sdk` is being published. The exact isolated source checkout
passed **69 package tests** on approved27.1; the full current Mobile working tree
passed89 package tests (contains unrelated unpublished routing/voice changes).
Notification cleanup uses one owned immutable Sendable subscription wrapper;
it does not mark the facade or account state unchecked Sendable. The reported
nonisolated-deinit failure is fixed. Full app check is rerunning on available27.1
runtime after default27.0 runtime was unavailable. Physical acceptance is pending.

Final SDK revision now published: **`7e95bd9`**, `codex/shared-mobility-sdk`.
Its isolated checkout passed **70 package tests** on the exact approved27.1 pin.
`dispatchCancelStart(request: CSMDispatchStartCancel, expectedScope:)` accepts
`operationId` (new cancellation UUID) and `startOperationId` (persisted start UUID).
Receipt returns both unchanged plus confirmed:true and serverTimestamp. Cancel
is account-bound, persists a tombstone before any late start, and stops an already
committed matching share; restart cannot erase the cancellation. Do not clear the
pending barrier from ownedShares alone. Server timeout/cancel/late-start and other
account isolation test passed; final targeted backend set is16 tests.

Mandatory COP Mobile check passed on available27.1 simulator: app tests,89 package
tests and2 accessibility tests. The selected default27.0 runtime was unavailable;
the supported simulator selection variable chose installed27.1. No gate bypass or
OS minimum change. Full check preceded the final added cancellation/credential
binding methods; those passed the final70-test isolated SDK suite separately.
Server deployment is being prepared with protected DB/config backup and rollback.
No actual user consent is granted; Jízda production gates remain its own decision.
