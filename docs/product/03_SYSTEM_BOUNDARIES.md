# 03 System Boundaries

Hlavní COP systém vlastní canonical model, ingest API, fusion, COP state, distribuci, webový klient, NATO renderer, AI Gateway, Source Registry, audit a policy enforcement.

SIM projekt je externí producent dat. Nevlastní COP state, NATO renderer, policy enforcement ani interní datové modely hlavního systému. Jeho závazkem je generovat validní události podle Shared Integration Contract v1.

## Hranice

- Stabilní hranice: REST/OpenAPI, JSON Schema, streaming protocol a chybový model.
- Nestabilní interní oblast: databázové schéma, interní messaging, implementace fusion a UI komponenty.
- Zakázaná vazba: přímý přístup SIM do databáze nebo interního event busu COP.
