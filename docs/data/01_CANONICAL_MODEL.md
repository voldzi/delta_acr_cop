# 01 Canonical Model

Canonical model chrání core logiku před externími formáty. Všechny zdroje, včetně SIM, se převádějí do jednotných entit.

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
