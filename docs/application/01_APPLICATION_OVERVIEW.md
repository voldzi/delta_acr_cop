# 01 Application Overview

Hlavní COP aplikace je modulární platforma složená z API, datové pipeline, COP state, distribuční vrstvy, webového klienta, NATO rendereru, Source Registry, AI Gateway a auditní infrastruktury.

Baseline neimplementuje produkční kód. Definuje moduly, hranice a kontrakty tak, aby navazující skeleton mohl vzniknout konzistentně.

## Hlavní tok

Externí zdroj pošle událost přes ingest API. API ověří zdroj, validuje schema, aplikuje idempotency, publikuje událost do pipeline, aktualizuje COP state a distribuuje snapshot nebo delta oprávněným klientům.
