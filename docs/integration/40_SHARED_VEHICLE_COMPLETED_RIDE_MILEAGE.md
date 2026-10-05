# Completed shared rides and mileage v2

Status2026-10-05: compatible contract and public SDK published; COP API production deployment completed at18:10:43UTC, initial read-only runtime verified18:11:31UTC. No changes to identity, calls, Matrix or real user records.

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


## Published delivery and verification

- SDK `7257af34e944a1a45ac8a2e0b49f4e79a197f558`, branch `codex/shared-mobility-sdk`. Six intended files only; unrelated local mobile work was not published. Clean public archive:11 targeted ride/odometer/receipt tests PASS.
- COP implementation `0c27532617c04ad3e668df2f9e42b474d2c0618b`, branch `codex/shared-vehicle-ride-mileage`. Documentation-only delivery evidence follows this runtime revision.
- Binding main JSON SHA256 `dd30bc1d54775a2e30e7f825c4d96004a393520790c6c07dcbbca8dd371f77ec`; mobility fragment `568906c92f48ae33685fd88c9e68630b80d33f3a9c915d615226762f28eb9db5`.
- Production image `sha256:145e11d774298df048939481eee56a553f6e1db2d33cdec7281a45818bf281d9`, tag `delta-acr-cop-api:ride-mileage-0c27532`, start2026-10-05T18:10:43.004666509Z. Extends prior odometer image with API runtime and contracts, no dependency/config changes.
- Guard-only rollback `sha256:3bfaefbc98dc24a64811d9757529e6526ee74a3e65a6e81bdfca61854b050464`, tag `delta-acr-cop-api:ride-mileage-safe-rollback-20261005`. Extends old v1 image; refuses every legacy update of detailed rides with409 and keeps their payload. Any active detailed ride causes conservative v1reviewRequired; no v2/ride capability advertised. Never use unguarded old image after accepting detailed rides. Rollback disables host new features through absent capabilities; it does not delete history or transform calculated values into readings.
- Full server1313PASS/6skip across164files; targeted17PASS including7new mileage cases; lint/typecheck,11schemas, skeleton, binding OpenAPI (26existingwarnings) and public analytics disabled guards PASS. Guarded PostgreSQL test separately executed with8PASS against loopback temporary PostgreSQL16, independent concurrent connections; temporary database removed. Default full suite skips that guarded external-database case.
- SDK mandatory full gate PASS:30appunit,5UI,125packageXCTest(1skip),2SwiftTesting,2accessibility audits on explicit COP simulator. New4 tests plus clean-pin11 verify legacy decode, metadata/revision safety, known versus estimated, exact decimal consistency and capabilities.
- Exact release and rollback images tested with isolated synthetic signed OIDC accounts, in-memory state and network none. Release hashes461 files; rollback hashes2patched files. Release verifies actual route responses, same old dataRevision concurrent independent appends, preserved original retry receipt, two authors/identities and same whole-state snapshot without prices, pagination, duplicate/omission/member/future fences and400unexpected GPS. Baseline100 plus10.125+20.25 becomes estimated130.375; later actual129 is known and covers those rides without addition. ISO UTC milliseconds and floor duration accepted. Rollback verifies details remain intact after rejected legacy edit and current mileage is not falsely declared known. These are isolated acceptance tests, not real-user production writes.
- Runtime initial proof18:11:31UTC:461 file hashes match, threehealth200, sixanonymous401, PostgreSQL primary with exactly one dedicated Dispatch lease ready/generation1. Measurementsfalse/sharedMobilitytrue/Dispatchtrue preserved. Env/compose/config hashes and134other container identities unchanged. Production read-only checks did not use real users' records or alter membership.
- Evidence directory on docker.home.cz `/home/voldzi/cop-deployments/shared-ride-mileage-20261005/`: image manifest, release/rollback acceptance logs, deployment before/after, runtime checks and guarded deploy script.

Actual two-phone authenticated ride, account switch, offline/restart replay and UI-label acceptance must be supplied by Jízda. Simulator gates and isolated server evidence do not prove those. No actual GPS/trip/receipt/account membership was modified to manufacture acceptance.

Stability proof2026-10-05T18:16:10.150Z,5min27s after restart: threehealth200/sixanonymous401, primary PostgreSQL/exactlyone dedicated Dispatch lease ready generation1,461runtime hashes unchanged. Independent final config/file/container comparison PASS for all134other containers. No unresolved runtime gate; actual authenticated physical-device acceptance remains unverified here. Final Chroma SDK reindex6files/49chunks and COP source15files/661chunks completed; delivery-doc incremental index follows.
