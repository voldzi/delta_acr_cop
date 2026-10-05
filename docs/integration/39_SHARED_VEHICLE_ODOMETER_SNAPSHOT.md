# Authoritative shared vehicle odometer snapshot v1

Prior v1 release evidence; compatible ride calculation is documented in [handoff40](40_SHARED_VEHICLE_COMPLETED_RIDE_MILEAGE.md), current production profile/audit delivery in [handoff41](41_SHARED_VEHICLE_PROFILE_AUDIT_RECOVERY.md). Use its latest guard-only rollback after sealed profile/audit fields exist.

Status2026-10-05: compatible contract published; COP API-only production delivery completed at16:24:40UTC and verified read-only at16:26:25UTC. Receipt release38 remains independently published/deployed.

## Contract

Add optional odometerSnapshot to SharedVehicle, SharedVehicleSync and SharedVehicleReceipt. Advertise optional odometerSnapshotVersions:[1] only after tests. Snapshot version1,status unknown|known|reviewRequired,dataRevision; valueKm(decimal kilometer string) only when known. observedAt is source record occurredAt; source includes recordId/recordRevision/recordKind(odometer|energy|service), no author, amount, notes, GPS or station. reason is no_observations,conflicting_observations,decreasing_observation,invalid_observation,invalid_correction,future_observation. Absent capability/snapshot is unsupported/unknown, never zero. Supporting host accepts matching snapshot/response dataRevision only, ignores stale revision, never derives from paged events or personal CloudKit.

## Projection and access

Server derives under the same transaction lock from all current non-tombstoned records: odometer.odometerKm, energy.details.odometerKm and service.odometerKm. An energy or service receipt remains one atomic operation. Values are observations, not additions. Dates, not submission order, determine the latest. Valid active odometer corrections exclude their referenced original observation; deletion removes the correction's exclusion. Invalid references, self/cyclic correction, invalid values/dates or future observation beyond5minutes require review, no confident current value. Contradictory equal-date observations or any decrease in chronological active observations require review. Same-date equal numeric values coalesce deterministically by recordId. A valid monotonic history yields the latest observation. Deletion/revision changes recompute deterministically; after explicit removal of latest, older remaining observation may become current with its own date/source, never masquerading as a newer reading.

Snapshot is available with readVehicle, independent of readCosts and pagination. Original expense/energy/service payloads remain protected by readCosts. Vehicle/author/CAS/idempotence/retention remain unchanged. No real user records, accounts, membership, GPS or private CloudKit data are changed for verification. Authenticated phone acceptance remains separate.

## Required checks

Owner versus driver without readCosts; energy/service/odometer in one receipt; historical and same-date contradictions; no summation; correction chain/cycle/deletion; stale revision and concurrency; first incomplete sync page still returns whole-state snapshot; no price/note/author leakage; compatibility missing snapshot; real PostgreSQL and exact image readback; production availability and safe rollback to receipt-only image (capability absent).


## Swift model

`CSMSharedVehicleOdometerSnapshot(version:Int=1,status:CSMSharedVehicleOdometerStatus,dataRevision:Int,valueKm:String?=nil,observedAt:String?=nil,source:CSMSharedVehicleOdometerSource?=nil,reason:CSMSharedVehicleOdometerReason?=nil)`. Status enum `.unknown/.known/.reviewRequired`. Source initializer `recordId:UUID,recordRevision:Int,recordKind:CSMSharedVehicleOdometerRecordKind(.odometer/.energy/.service)`. Reason enum uses exact snake_case wire values above. SharedVehicle/SharedVehicleSync/SharedVehicleReceipt gain `odometerSnapshot` optional and default-nil final init argument. Capabilities gains optional odometerSnapshotVersions/default-nil init argument and `supportsOdometerSnapshotV1`. `snapshot.knownValueKm(for:vehicle.dataRevision)` checks version/status/revision, source and timestamp/decimal validity, accepting fractional ISO8601; nil must not become zero. Host also requires server capability version1 and its current account/vehicle scope.

## Local verification

Server1306PASS/5skip; lint/typecheck pass, binding OpenAPI valid (26existingwarnings),11schemas and skeleton pass. Five new whole-state checks cover all receipt kinds, dates/equality/contradictions, correction chain/cycle/tombstone, no invented mileage, owner/driver without prices and incomplete sync page. Real isolated PostgreSQL test validates snapshot across independent connections/restart and receipt CAS/idempotence; temporary database removed. SDK mandatory full gate PASS:30appunit,5UI,121packageXCTest(1skip),2SwiftTesting,2accessibility audits on explicit COP iPhoneDuo. Three new snapshot tests cover typed roundtrip/fractional timestamp/stale revision, unknown/review/unsupported versions and legacy vehicle decode. Real phone authenticated shared snapshot acceptance remains separate.


## Published delivery and production evidence

- SDK: `6388f7e365b8f02c24c48f6835b5b4312d823744`, branch `codex/shared-mobility-sdk`. Clean public commit archive:7snapshot/receipt tests PASS, no unrelated local modifications included.
- COP code: `85af0438bc3d95cdc8013b8fee94470f1c05182b`, branch `codex/shared-vehicle-odometer-snapshot`.
- Main binding JSON SHA256: `eaa9a2620ae217a39313f975f955a0848dcab40be0497129614ab53526c594cd`.
- Mobility fragment SHA256: `37684f51710459096fbace2151bc36fb953f8151bb9abfee1b81d04eb38a5be8`.
- Production image: `sha256:9a6641a24a292a116b7174406db6344465382868e98ba3ff11e5a2bb24d0b5f6`, tag `delta-acr-cop-api:odometer-85af043`, start2026-10-05T16:24:40.883346296Z.
- Safe rollback: receipt-only `sha256:1539f6813a70650dc0d2e520d7c68c7ca75322c50f7675d829747ad852c4c05e`, retained tag `delta-acr-cop-api:odometer-rollback-20261005`. Tested absent odometer capability, retained typed receipts/omission guard. No database rollback or user-record rewrite.
- Exact release image network-none acceptance:452artifact hashes, signed synthetic OIDC, whole-state snapshot in one receipt, owner/driver without readCosts equality, paged sync independently correct, cost/note exclusion, two-account isolation, idempotence and omission409. Rollback446artifact hashes and legacy receipt boundaries PASS. Both isolated images use memory-only synthetic accounts/vehicles, no production users/GPS.
- Read-only production16:26:25UTC:452runtime artifact hashes match; health/live,ready,dependencies200; six anonymous boundaries401; primary PostgreSQL and exactly one dedicated Dispatch lease ready/generation1. Measurementsfalse/sharedMobilitytrue/Dispatchtrue unchanged. Configuration/secrets/compose and134other containers unchanged; SIM/Messaging/identity and web unaffected.
- Evidence host: `/home/voldzi/cop-deployments/shared-odometer-20261005/`. Physical authenticated shared receipt/snapshot/role/offline acceptance remains to be completed by Jízda and the users. Builds and synthetic HTTP/database checks do not establish phone acceptance.

Post-deploy stability recheck at2026-10-05T16:31:22.328Z (6min41s after start): three health200, all six anonymous boundaries401, primary PostgreSQL and exactly one dedicated Dispatch lease ready/generation1; flags unchanged. No real user or record was modified.
