# ADR 0041: Lossless shared vehicle receipt details

Date: 2026-10-05. Status: accepted implementation; deployment evidence follows in the integration handoff.

## Context

Jízda must reuse its existing fuel, charging and service forms for private and shared vehicles. The previous shared contract cannot retain their complete receipt details. A supporting server must not advertise capability before successful persistence and isolation tests.

## Decision

Add optional, strictly typed version 1 details to the existing energy/service records and optional explicit capabilities. Keep existing route names, unit enums, receipt identity, idempotence and revision semantics. Each service receipt has one total and an exact same-currency item breakdown; reject inconsistent new receipts. Preserve vehicle membership, author and readCosts boundaries.

Shared storage accepts explicit station/place text snapshots; this release adds no precise coordinates, live GPS or automatic private-record transfer. Do not represent CNG/hydrogen quantities as liters. Missing capability or unknown detail version disables detail editing. Refuse replacing an existing detailed record with a detail-free record, including after a downgrade. Prepare and test a guard-only compatibility rollback image before production delivery.

## Consequences

Old detail-free records remain usable by old clients. Detail-capable clients submit complete confirmed objects; field omission within that object is explicit removal. Supporting clients must show validation, permissions and unavailable fields in the existing forms. Physical-device acceptance and production authenticated receipt acceptance are separate from synthetic unit/database/image verification.

See [contract and handoff](../integration/38_SHARED_VEHICLE_RECORD_DETAILS.md).
