# ADR-0004: Data-first COP Architecture

## Status

Accepted

## Context

COP nesmí být pouze mapa. Potřebuje audit, provenance, history, policy filtering a více klientů.

## Decision

Systém bude data-first. Canonical model, COP state a event pipeline jsou zdrojem pravdy. Mapové UI je konzument.

## Consequences

Architektura podporuje více klientů, audit a edge režim. Vyžaduje důsledný model a oddělení prezentace.

## Alternatives Considered

Map-first aplikace s logikou v klientovi. Odmítnuto kvůli slabé auditovatelnosti a obtížné distribuci.

## Follow-up Actions

Navrhnout canonical model package a COP state interfaces.
