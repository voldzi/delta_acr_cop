# 04 Component View

## API Gateway

Zajišťuje autentizaci, rate limiting, idempotency, směrování na ingest, Source Registry, COP query, symbology, audit a AI endpointy.

## Ingest pipeline

Přijímá single i batch eventy, validuje OpenAPI/JSON Schema, ověřuje Source Registry, doplňuje ingest metadata a publikuje události do event busu.

## Canonical model service

Převádí validované události na interní canonical objekty. Externí formáty nesmí pronikat do fusion ani COP state.

## Fusion engine

Provádí korelaci podle času, polohy, domény, typu objektu a trust profilu zdroje. Výstupem je vysvětlitelný COP object state a conflict flags.

## Distribution gateway

Poskytuje snapshot, delta updates, degraded mode, stream reconnect a area-of-interest subscription.

## AI Gateway

Abstrahuje AI providery, provádí policy check, redaction, structured output validation a audit.
