# 01 Application Overview

Civilní situační mapa je modulární aplikace složená z API serveru, source-neutral mapového katalogu, COP state, distribuční vrstvy, webového klienta, komunitních hlášení, messaging integrace, Source Registry, AI Gateway a auditní infrastruktury.

Repozitář obsahuje produkční pilotní implementaci. Dokumentace definuje moduly, hranice a kontrakty tak, aby web, nativní iOS/iPadOS klient a externí poskytovatelé dat používali stejný bezpečný model.

## Hlavní tok

Externí poskytovatel dat publikuje katalog a features přes provider kontrakt. COP server provider data čte server-side, aplikuje policy, normalizuje je do mapového katalogu a klientům poskytuje pouze source-neutral API. Uživatelé mohou vytvářet civilní hlášení s polohou a médii; přístup k médiím řídí ACL na úrovni přílohy. Lidská komunikace a skupiny patří do samostatné aplikace `cop-chat`, která je do COP vložená jako chatový panel.
