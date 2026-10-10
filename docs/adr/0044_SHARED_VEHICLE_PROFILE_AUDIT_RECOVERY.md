# ADR0044: shared profile, audited corrections and exact owner recovery

Status: accepted implementation, joint mobile acceptance pending;2026-10-05.

Keep existing endpoints and compatible additive version1 fields. Store exact owner-declared SIM mapped profile with powertrain; preserve stored profile on old updates and require owner for change. Bind stable local vehicle UUID to server vehicle within authenticated current owner scope, never names/plates. Existing event snapshots are immutable history: attach reviewed correction target/reason, record revision confirmation and void audit, preserve original author/payload. Current care reminder snapshot derives from whole active state, separately from costs/history. Use current account/vehicle/revision and capability gates. Routing assessment still comes from SIM; dimensions are declarations, not physical attestation.

Guard-only rollback must preserve profile/binding and correction/audit history, reject unsafe old edits and cease advertising these capabilities. No dependency, identity, CallKit/Matrix or real-data change belongs to this release. Existing30day deleted-domain/receipt retention stays unchanged. See integration41 for exact semantics, gates and delivery proof.
