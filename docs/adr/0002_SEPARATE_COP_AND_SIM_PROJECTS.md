# ADR-0002: Separate COP and SIM Projects

## Status

Accepted

## Context

SIM je externí producent syntetických dat. Hlavní COP systém je datová platforma, renderer, policy engine a distribuční vrstva.

## Decision

COP a SIM budou oddělené projekty. SIM komunikuje pouze přes Shared Integration Contract v1 a nesdílí interní databáze, typy ani event bus COP.

## Consequences

Oddělení umožní nezávislý vývoj a testování. Vyžaduje disciplinované contract tests a verzování.

## Alternatives Considered

Vyvíjet SIM jako interní modul COP. Odmítnuto kvůli těsné vazbě a horší testovatelnosti kontraktu.

## Follow-up Actions

Připravit contract test suite použitelnou oběma projekty.
