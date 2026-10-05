# Completed shared rides and mileage v2

Status2026-10-05: compatible contract implemented/tested locally; public pins/image verification/deployment pending. No changes to identity, calls, Matrix or real user records.

## Additive contract and host

ride_summary retains distanceKm/durationSeconds/purpose. Optional details: version1,tripId(UUID stable local Ride.id even after recovery),startedAt/endedAt(actual UTC timestamps),optional endOdometerKm(actual explicitly entered driver reading). No coordinates, destination or passengers. No end reading invented from GPS. recordId/opId and CAS remain durable; tripId is unique for a vehicle including tombstones, so a retried summary cannot be recreated under another record ID. Replacing detailed rides without details is409, not silent loss.

Optional initial:true on odometer explicitly seeds an owner reading through existing editVehicle/CAS/idempotence. Accept only with no prior active reading and no known/calculated shared state; it is not a replacement/migration of private history. Source occurredAt is actual reading date. Existing ordinary readings/corrections retain semantics.

Optional odometerSnapshotV2(version2,status unknown|known|estimated|reviewRequired,dataRevision,valueKm?,observedAt?,source?,basisKm?,basisObservedAt?,basisSource?,includedRideCount?,unconfirmedDistanceKm?,reason?) on SharedVehicle/Sync/Receipt. New source supports odometer|energy|service|ride_summary. Capabilities advertise odometerSnapshotVersions:[1,2],rideDetailsVersions:[1],initialOdometerSupported:true only after acceptance. Old v1 enums are unchanged; v1 snapshot returns review without a new reason/source enum when only v2 can express current state. Absence/stale/unsupported/unknown/review is never zero or private local mileage. Host explicitly labels estimated as calculated, never actual instrument reading. Server role/availability/current account+vehicle/revision remain required.

## Projection

Whole current state under the same transaction lock; readings are odometer, energy/service readings and optional ride actual end reading. Date-order/corrections/tombstones retain prior monotonic and review rules. Last actual reading anchors the calculation. Fully finished rides before/on that reading are covered and not added. Add each deduplicated, complete non-overlapping ride after it once using exact thousandths of kilometers. A ride spanning the reading cannot be split without GPS traces, so reviewRequired instead of a guessed remainder. Overlapping intervals, legacy later rides without intervals, duplicate trip IDs, invalid/future intervals or numeric overflow require review without a confident current value. Revisions/deletions deterministically recompute; no mutable cumulative mileage counter. Without a baseline, state remains unknown and owner may establish a real initial reading.

All readVehicle members see the same snapshot and all ride summaries/authors; owner already sees all cost records with readCosts. Owner/client statistics fold the latest nondeleted revision per recordId, not every sync event. No account-ID choice by client, no author/cost/GPS in public mileage snapshot. No real records or membership changed for tests.

## Gates

Initial seed concurrency/idempotence; two drivers/owner without cost permission; duplicate trip/new record IDs/legacy edits; delayed and reordered rides; exact sum/overlap/anchor reset/no double counting; actual end reading/calculation labels; partial pagination; correction/tombstone/revision/restart; real PostgreSQL and exact image; rollback protection of detailed rides. Actual phone acceptance remains separate.


## Explicit append policy

rideInsertPolicy:"append_only_membership_cas" permits only a fresh detailed-v1 ride record with expectedRecordRevision0, no existing recordId/tripId and a valid historical expectedDataRevision in1..current. Membership revision and current recordRide are strict. Old summaries and all edits retain strict dataRevision CAS. Do not mutate the durable request under the same operationId. Future revision, duplicate/reserved trip or record identity and revoked/mismatched membership remain conflicts. Snapshot is whole-state after atomic insertion; receipt retries retain the original historical snapshot/revision, which must not overwrite a newer view. Initial:true requires owner and no preexisting active reading/known/estimated state; missing baseline is not permission to replace a review state with a private calculated value. known means a declared instrument reading, not independent sensor verification.


## Swift integration

New public file CSMSharedVehicleRideMileage.swift:
- CSMSharedVehicleRideDetails(version:Int=1,tripId:UUID,startedAt:String,endedAt:String,endOdometerKm:String?=nil); RideSummary.details optional/default-nil final init parameter.
- Odometer.initial optional Bool/default-nil final init parameter; only true is a valid wire seed flag, never encode false. Requires owner/current vehicle/actual reading date.
- CSMSharedVehicleOdometerSnapshotV2(version:Int=2,status:CSMSharedVehicleMileageStatus,dataRevision:Int,valueKm:String?=nil,observedAt:String?=nil,source:CSMSharedVehicleMileageSource?=nil,basisKm:String?=nil,basisObservedAt:String?=nil,basisSource:CSMSharedVehicleMileageSource?=nil,includedRideCount:Int?=nil,unconfirmedDistanceKm:String?=nil,reason:CSMSharedVehicleMileageReason?=nil).
- Source(recordId:UUID,recordRevision:Int,recordKind:.odometer|.energy|.service|.ride_summary). Status .unknown|.known|.estimated|.reviewRequired. Reason exact snake_case wire values; no change to v1 enums.
- SharedVehicle/Sync/Receipt.odometerSnapshotV2 optional and default-nil final init argument. Capabilities optional rideDetailsVersions,initialOdometerSupported,rideInsertPolicy/default-nil init arguments.
- Public supportsOdometerSnapshotV2,supportsRideDetailsV1,supportsInitialOdometer,supportsCommutativeRideInsert. These signal contract support, not permission/readiness.
- knownValueKm(for:expectedRevision)->String? only known; estimatedValueKm(for:expectedRevision)->String? only estimated, validates exact basis+delta and metadata. Both reject unsupported/stale/unknown/review. No zero/private fallback. Use current account/vehicle scope and matching current dataRevision; render a visible calculated label for estimated. Original receipt retries must not overwrite newer cached state.
