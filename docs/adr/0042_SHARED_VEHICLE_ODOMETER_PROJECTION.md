# ADR0042: Authoritative shared odometer projection

Date2026-10-05. Status: accepted compatible implementation, published and production-delivered; see handoff39 for exact evidence and pending phone acceptance.

The shared vehicle's kilometer state must match across employees and owners, while costs remain separately restricted. Never reconstruct it from incomplete sync pages or rewrite a person's private CloudKit vehicle.

Derive a versioned optional odometerSnapshot from complete active record state under the existing transaction lock. Attach to vehicle/list, sync envelope and operation receipt; capability/version/revision gates determine support. Energy/service remain a single receipt/transaction. Use observation dates and exact decimal kilometers, not summation or arrival order. Corrections/tombstones are explicit and deterministic; conflicting/decreasing/future/invalid observations produce reviewRequired without a confident value. ReadVehicle authorizes only odometer value/date/source-record reference, never costs, notes, author or GPS. DataRevision supplies cache/CAS ordering. Missing/unsupported snapshot is unknown, never zero.

No persisted migration or user-data modification is needed; downgrade to the receipt-only image preserves all records, omits the new capability and must disable snapshot use in supporting clients. Separate real-phone acceptance from synthetic/database/image/runtime tests.

See [handoff39](../integration/39_SHARED_VEHICLE_ODOMETER_SNAPSHOT.md).
