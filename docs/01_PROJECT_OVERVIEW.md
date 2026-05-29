# 01 Project Overview

**Civilní situační mapa (CSM/COP)** je civilní situační systém pro příjem mapových a komunitních dat přes API, jejich převod do canonical modelu, korelaci, tvorbu aktuálního situačního obrazu a bezpečnou distribuci oprávněným webovým a nativním klientům.

Systém je navržen jako samostatná prezentační a policy platforma. SIM a další projekty jsou externí poskytovatelé dat a komunikují s COP přes verzované integrační kontrakty. COP vlastní mapový katalog, uživatelské profily, komunitní hlášení, media ACL, audit, RBAC/ABAC, webový klient a kontrakty pro iOS/iPadOS. Profesionální symbolika je dostupná jako volitelný režim zobrazení, civilní režim je výchozí.

## Hlavní capability

- source-neutral mapový katalog a univerzální `/api/v1/map/query`,
- canonical data model, provenance a confidence,
- serverový temporal store a historie stop,
- snapshot, SSE stream a degraded/offline režim,
- civilní a profesionální režim mapové symboliky,
- komunitní hlášení s polohou, přílohami a media ACL,
- skupiny a bezpečná vazba na CSM Messaging/Matrix,
- Source Registry, observabilita a provider health,
- audit, RBAC/ABAC a uživatelské profily,
- guardrailed AI asistence pouze pro informační/reportovací úlohy.

## Aktuální stav

Produkční pilot běží jako webový klient a API server nasazovaný na `docker.home.cz` a publikovaný přes DMZ. Dokumentace v tomto repozitáři je závazná i pro nativní iOS/iPadOS klienty.
