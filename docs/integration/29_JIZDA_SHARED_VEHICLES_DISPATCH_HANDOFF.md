# 29. Jízda shared vehicles and private Dispatch delivery

Updated: 2026-10-04. Implementation in progress; NOT deployed and NOT accepted
on a physical iPhone. Existing production routing is a separate delivered feature.
No driver location/traffic consent has been granted on behalf of a user.

## Contract source and integration

New JSON-first contract: [shared-mobility-v1.openapi.json](../api/shared-mobility-v1.openapi.json).
Release source branch: `codex/shared-vehicles-dispatch`, worktree:
`/Users/voldzi/.codex/worktrees/jizda-routing-safety/01 COP`.
Full binding OpenAPI there: `openapi/openapi.json`; primary standalone copy above
contains identical new schemas/operations for Jízda to inspect. OpenAPI validation passed with no errors and 26 warnings. Publication status will be appended; do not infer running endpoints from this file.
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
