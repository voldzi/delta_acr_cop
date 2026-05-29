# ADR-0008: Professional UX Without Weapon Workflow

## Status

Accepted

## Context

Zadání požaduje profesionální situační UX, ale systém nesmí implementovat targeting nebo weapon workflow.

## Decision

UX bude zaměřené na situační přehled, vrstvy, realtime data, confidence, provenance, zdroje, degraded/offline režim a timeline/replay. Nebude obsahovat ovládací prvky pro použití síly.

## Consequences

UI zůstává bezpečně v rozsahu datové a situační platformy. Některé operační požadavky mimo tento rozsah budou muset být explicitně odmítnuty nebo řešeny v jiných systémech.

## Alternatives Considered

Rozšířit UI o akční workflow. Odmítnuto kvůli bezpečnostnímu a funkčnímu vymezení systému.

## Follow-up Actions

Při návrhu frontend skeletonu kontrolovat, že texty a controls neimplikují targeting ani navádění.
