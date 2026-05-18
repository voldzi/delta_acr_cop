# ADR-0001: Documentation-first Approach

## Status

Accepted

## Context

COP a SIM projekty se mají vyvíjet paralelně a bezpečně. Bez dokumentovaných hranic by vznikla těsná vazba na interní implementaci.

## Decision

Nejdříve vzniká dokumentační, architektonický a kontraktový baseline. Implementace bude následovat až po odsouhlasení hranic a quality gates.

## Consequences

Tým získá stabilní zadání a sníží integrační riziko. Nevýhodou je nutnost průběžně hlídat, aby dokumentace nezastarala vůči implementaci.

## Alternatives Considered

Začít rovnou implementací skeletonu. Odmítnuto kvůli riziku nejasných integračních hranic.

## Follow-up Actions

Vytvořit skeleton až proti publikovanému OpenAPI, JSON Schema a ADR.
