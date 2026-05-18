# 07 Data Architecture

Datová architektura odděluje vstupní události, canonical model, COP state, historii, provenance a distribuční pohledy.

## Vrstvy

- Raw ingress metadata: auditní evidence přijetí a validace.
- Canonical event envelope: verzovaná událost přenositelná mezi týmy.
- Canonical object model: interní reprezentace pozorování, objektů, tracků, incidentů a reportů.
- COP state: aktuální policy-filtered stav s geospatial a temporal indexem.
- History/provenance: dohledatelnost původu, transformací a confidence.

## Doporučené technologie

PostgreSQL/PostGIS pro durable state a geospatial dotazy, Redis/KeyDB pro hot state, event bus pro pipeline a objektové úložiště pro přílohy. Výběr bude potvrzen ADR v implementační fázi.
