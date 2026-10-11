# Authoritative shared vehicle odometer snapshot v1

Status2026-10-05: explicit compatible contract implemented and tested locally; public pins and production verification pending. Receipt release38 remains independently published/deployed.

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
