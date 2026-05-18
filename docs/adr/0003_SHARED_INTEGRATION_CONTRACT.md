# ADR-0003: Shared Integration Contract

## Status

Accepted

## Context

Externí zdroje musí bezpečně posílat data do COP a SIM tým potřebuje stabilní rozhraní.

## Decision

Zavádí se Shared Integration Contract v1 založený na `/api/v1`, OpenAPI, JSON Schema, standardním error modelu, idempotency a Source Registry.

## Consequences

Kontrakt zjednodušuje paralelní vývoj. Breaking změny budou nákladnější a musí být verzované.

## Alternatives Considered

Ad hoc integrace přes interní message broker. Odmítnuto, protože by z COP interní implementace udělala externí API.

## Follow-up Actions

V implementačním kroku vygenerovat typy a contract tests z kontraktu.
