# ADR 0035: Separate incomplete ordinary closure evidence from strict routing

Date: 2026-10-03. Status: accepted design; joint activation pending.

Ordinary navigation needs useful avoidance of verified known closures even when
complete national coverage cannot be proven. This cannot satisfy or replace the
mandatory closure assessment of ADR0034.

Add `sim-known-road-closures-v1` per ordinary route variant with incomplete coverage,
normalized request hash, geometry hash, graph/source/engine identity and short
validity. Validate all raw variants independently in COP before filtering or
rendering. Source truth and exclusion-polygon review remain SIM responsibilities.

For an individually verified entire closed structure, SIM may conservatively
exclude both directions while preserving sourceDirection=unknown. Explicit
sourceDirection/enforcedDirection/reason distinguish what the source proves from
what the engine avoids. A fuzzy reference line alone cannot create such evidence.
No one-way-to-both override or complete-coverage claim is permitted. Engine failure,
expiry or revision races must not fall back to discarded exclusions. Missing
metadata means unknown, not accepted enforcement. Strict inputs cannot downgrade.

The shared SDK receives additive optional fields through a scoped handoff, preserving
Jízda's concurrent local changes. Production activation awaits matching immutable
SIM contract and actual source/engine evidence; physical acceptance is separate.
