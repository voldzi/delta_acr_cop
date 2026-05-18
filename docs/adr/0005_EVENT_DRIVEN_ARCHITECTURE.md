# ADR-0005: Event-driven Architecture

## Status

Accepted

## Context

Situační data přicházejí průběžně z více zdrojů a musí být validovaná, auditovaná, replayovatelná a distribuovaná v deltas.

## Decision

Pipeline hlavního COP systému bude event-driven. Každá změna vstupuje jako canonical event envelope.

## Consequences

Architektura lépe podporuje realtime distribuci, replay a audit. Vyžaduje řešení ordering, idempotency a backpressure.

## Alternatives Considered

Periodické polling importy. Odmítnuto pro horší latenci a slabší audit průběžných změn.

## Follow-up Actions

Vybrat event bus pro MVP a doplnit ADR pro konkrétní technologii.
