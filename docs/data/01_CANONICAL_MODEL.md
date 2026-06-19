# 01 Canonical Model

Canonical model chrání core logiku před externími formáty. Všechny zdroje,
včetně SIM, se převádějí do jednotných entit.

Aktuální rozšířený model pro civilní COP je popsán v
[07 Canonical Entity Model v2](07_CANONICAL_ENTITY_MODEL_V2.md). Tento dokument
zůstává stručným historickým baseline pro původní ingest/track model.

## Minimální entity

- `SourceSystem`, `SourceDevice`,
- `Observation`, `ObservedObject`, `Track`,
- `Unit`, `Platform`, `UAV`, `Aircraft`,
- `MissileTrack` jako situační datová entita bez weapon workflow,
- `RescueAsset`, `Incident`, `Report`,
- `AreaOfInterest`, `Layer`,
- `ConfidenceAssessment`, `ProvenanceRecord`,
- `AccessPolicyTag`.

Canonical model musí být verzovaný a testovatelný přes JSON Schema a contract tests.

## V2 Rozšíření

Nové funkce nesmí vytvářet izolované resource modely bez governance metadat.
Hlášení, média, výstrahy, uživatelské zóny, zákresy, notifikace i AI shrnutí
mají používat společné koncepty `releasePolicy`, `confidence`, `dataQuality`,
`provenance`, `validFrom` a `validUntil`.
