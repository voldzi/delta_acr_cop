# 01 Project Overview

**ACR COP Data Fabric / SITDATA-COP** je hlavní COP systém pro příjem situačních dat přes API, jejich převod do canonical modelu, korelaci, tvorbu COP state a bezpečnou distribuci oprávněným klientům.

Systém je navržen jako samostatná platforma. Samostatně vyvíjený SIM projekt je pouze externí producent dat a komunikuje s COP přes verzovaný integrační kontrakt. Renderer NATO symboliky, AI Gateway, Source Registry, audit, RBAC/ABAC a webový COP klient patří do hlavního COP projektu.

## Hlavní capability

- ingest událostí a dávek z externích zdrojů,
- canonical data model a event envelope,
- correlation/fusion pipeline,
- COP state store a temporal history,
- subscription, snapshot a delta distribuce,
- NATO symbol resolver a renderer,
- Source Registry se stavem zdrojů,
- audit, observabilita, provenance a confidence,
- AI asistence přes provider abstraction,
- degraded/offline režim,
- DELTA-inspired webové UI bez weapon workflow.

## Aktuální stav

Tento baseline je dokumentační a architektonický. Produkční aplikace, databázové migrace a deploy artefakty budou vytvořeny v navazujících krocích.
