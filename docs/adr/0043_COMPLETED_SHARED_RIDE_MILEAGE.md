# ADR0043: Completed shared rides and calculated mileage

Date2026-10-05. Status: accepted compatible implementation, publication/deployment pending.

Drivers and owners need one shared vehicle mileage state and owner access to all ride/cost authors. Ride summaries expose distance/duration/purpose without GPS traces. A completed distance is not an instrument reading. Add typed v1 ride details with stable trip identity/actual interval/optional explicitly entered end reading. Keep v1 DTO enums unchanged; new optional v2 snapshot distinguishes known readings and estimated calculated mileage.

Calculate under the existing transaction lock from all current records, last actual reading and complete nonoverlapping later rides. Covered rides are not added twice. Overlap with another ride or calibration, invalid/future/legacy interval, duplicate or overflow requires review. Corrections and tombstones recompute; no mutable accumulating counter. Reserve immutable per-vehicle tripId including tombstones; refuse detail-free overwrite. An explicit owner initial seed is allowed only without prior shared readings/calculation, preserving CAS/idempotence.

Only new independent typed-v1 ride insertion may use historical dataRevision1..current; current membership/recordRide, absent record ID and unique trip ID remain mandatory. All old payloads and edits use exact CAS. Do not mutate durable requests on retry. Capability rideInsertPolicy advertises this explicitly. ReadVehicle exposes the same nonfinancial mileage state/all ride authors; existing readCosts protects detailed costs. Do not change authentication, calls, Matrix, private history or actual user records for acceptance.

See [handoff40](../integration/40_SHARED_VEHICLE_COMPLETED_RIDE_MILEAGE.md).

Delivery: COP runtime0c27532 and SDK7257af3 published and API production deployed2026-10-05T18:10:43UTC. Detailed test/runtime/guard-only rollback evidence is in integration40; real-phone joint acceptance remains separate.
