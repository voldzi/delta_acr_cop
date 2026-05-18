# ADR-0006: NATO Renderer in Main COP

## Status

Accepted

## Context

Symbolika musí být konzistentní ve webovém, mobilním a edge klientovi. Externí zdroje by jinak mohly posílat různé nebo nekompatibilní symboly.

## Decision

NATO symbol resolver a renderer patří do hlavního COP systému. Externí zdroje posílají canonical objektové atributy, nikoli finální symbol code.

## Consequences

COP kontroluje mapping a fallback pravidla. SIM je jednodušší a méně provázaný. Renderer vyžaduje vlastní testy a katalog.

## Alternatives Considered

Nechat SIM generovat symboly. Odmítnuto kvůli nekonzistenci a nevhodnému rozdělení odpovědností.

## Follow-up Actions

Vytvořit mapping katalog, golden tests a symbol resolve endpoint.
