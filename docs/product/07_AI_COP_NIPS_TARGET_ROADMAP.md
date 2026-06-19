# 07 AI-COP/NIPS Target Roadmap

Tento dokument převádí zadání pilotu AI-COP/NIPS do cílového stavu pro CSM/COP,
SIM, CSM Messaging a nativní klienty. Pilot ještě nebyl vyhlášen, proto je
cíl dokončit aplikaci tak, aby se dala do soutěže přihlásit jako ucelené
řešení, ne jako MVP.

## Cíl Řešení

CSM/COP má být civilní federovaná situační schopnost pro krizové situace:

- mapový a datový COP workspace,
- server-to-server datoví provideři,
- mobilní a webový klient,
- komunitní hlášení a média,
- skupiny a šifrovaná komunikace,
- auditované AI asistivní funkce,
- offline/edge režim,
- otevřené kontrakty pro další uzly a aplikace.

Systém zůstává civilní. Nesmí obsahovat targeting, navádění, weapon workflow,
autonomní rozhodnutí nebo doporučení použití síly.

## Pilotní Uzly

Minimální pilotní federace musí mít tři logické uzly. Mohou běžet v jednom
prostředí, ale musí být oddělené kontrakty, identitou, auditní stopou a
eventovým modelem.

| Uzel | Úloha | Stávající základ | Co doplnit |
| --- | --- | --- | --- |
| `central-orchestrator` | centrální orchestrace, audit, registry, AI/MCP, replay | COP API, Keycloak, PostgreSQL, audit docs | event bus, node registry, replay/DLQ, MCP Gateway, AI audit |
| `civil-crisis-node` | civilní krizový COP workspace, mapy, hlášení, skupiny | COP Web, map catalog, community reports, Messaging bridge | incident/resource/capacity model, exporty, role workspace |
| `edge-node` | lokální/offline práce v terénu | PWA/iOS kontrakty, offline snapshot | offline write outbox, conflict resolution, local event log |
| `provider-node` | datové zdroje a simulace | SIM, Mission Arena, TAK Gateway, safety/flight/situation data | provider event publication, observability bridge |

## Požadavky Pilotního Zadání A Stav

| Oblast | Stav v CSM/COP | Gap |
| --- | --- | --- |
| COP mapa | existuje profesionální mapový workspace, katalog vrstev, detail objektu | dokončit UX stabilizaci, zjednodušit občanský/profesionální skin |
| Server-to-server data | SIM poskytuje katalogy/features/observability | sjednotit provider health do federačního observability modelu |
| Kanonický model | `docs/data/07_CANONICAL_ENTITY_MODEL_V2.md` | doplnit incident/resource/capacity/task entity do API |
| OpenAPI | JSON-first `openapi/openapi.json` | doplnit nové pilotní endpointy a Swift/TS generation runbook |
| AsyncAPI | směr popsán v integraci | založit a udržovat `asyncapi/asyncapi.json` |
| CloudEvents | koncept event envelope existuje | implementovat produkční event publisher, replay a DLQ |
| OGC/GeoJSON | provider features používají GeoJSON | doplnit OGC API Features kompatibilní adapter |
| Offline edge | PWA snapshot a degraded mode | offline zápis hlášení/zákresu/incidentu, outbox a sync |
| Fusion/dedup | provenance/confidence model existuje | incident/object fusion service, analyst confirm/reject |
| AI | roadmap existuje | MCP Gateway, tool allowlist, auditované AI výstupy, evaluace |
| Security | RBAC/ABAC dokumenty existují | plná enforcement matice, SBOM, scan report, security test pack |
| Messaging/push | CSM Messaging integrace existuje | notifications intake, delivery audit, deep links, device registry |
| iOS/iPadOS | API dokumentace existuje | offline queue, device registration, deep link detail endpointy |

## Implementační Proud 1: Federace A Eventy

Priorita pro pilot. Bez eventů a replaye není řešení federované.

1. Zavést node registry:
   - `nodeId`, `nodeRole`, `nodeName`, `classificationMax`, `capabilities`,
     `lastSeenAt`, `health`, `softwareVersion`.
2. Implementovat CloudEvents domain publisher v COP API.
3. Zvolit pilotní broker: NATS JetStream nebo Kafka-compatible broker.
4. Přidat replay podle `eventId`, `eventType`, času, entity a nodeId.
5. Přidat DLQ a audit každého odmítnutého eventu.
6. Doplnit AsyncAPI jako závazný kontrakt.

Pilotní kanály jsou definované v `asyncapi/asyncapi.json`.

## Implementační Proud 2: Doménové Entity

Zadání vyžaduje entity pro incidenty, zdroje, úkoly, senzory, výstrahy a audit.

První implementační sada:

- `incident`: událost/workspace s geometrií, stavem, závažností a vazbami,
- `resource`: kapacita nebo prostředek pro civilní krizové řízení,
- `task`: pracovní úkol s lidským potvrzením, bez weapon workflow,
- `sensorObservation`: měřená/modelovaná hodnota,
- `alert`: výstraha s validitou, jistotou a doporučeným občanským postupem,
- `evidence`: médium/dokument s ACL,
- `sketchDrawing`: ruční zákres.

Každá entita musí používat metadata z Canonical Entity Model v2.

## Implementační Proud 3: Offline Edge

Edge uzel musí zvládnout nejméně 30 minut bez spojení.

Požadovaný stav:

- lokální vytvoření incidentu, hlášení, zákresu a komentáře,
- lokální event log a outbox,
- poslední známý stav mapy a detailu,
- sync po návratu spojení do 5 minut,
- konflikt s vysvětlením a ručním potvrzením,
- jasné označení dat vzniklých offline.

## Implementační Proud 4: AI A MCP

AI je asistivní vrstva, ne rozhodovací autorita.

Minimální MCP nástroje:

- `search_incidents`,
- `get_incident_detail`,
- `search_resources`,
- `get_area_summary`,
- `propose_alert`,
- `propose_task`,
- `explain_fusion`.

Pravidla:

- každý tool call má audit s uživatelem, rolí, účelem, correlationId a časem,
- state-changing návrhy vyžadují explicitní potvrzení člověkem,
- výstup AI musí rozlišit fakt, odhad a doporučení,
- výstup musí citovat zdroje a ukázat nejistotu,
- AI nesmí obejít RBAC/ABAC.

## Implementační Proud 5: Bezpečnost A Audit

Pilot musí být prokazatelně bezpečný, i když nejde o produkční 24/7 systém.

Povinné výstupy:

- RBAC/ABAC enforcement matice,
- audit coverage report,
- SBOM CycloneDX,
- dependency/license report,
- vulnerability scan,
- AI/MCP security test pack,
- export governance test,
- session/device policy pro web a iOS.

Klasifikační štítky pilotu:

- `PUBLIC`,
- `INTERNAL`,
- `SENSITIVE`,
- `RESTRICTED_SIMULATED`.

## Implementační Proud 6: Demo Scénáře

Pilot musí mít opakovatelnou ukázku.

### Scénář A: Povodeň

SIM vygeneruje hydro/meteo výstrahu, obecní hlášení, kapacity evakuace a
polohu prostředků. COP provede ingest, zobrazí mapu, sloučí související
incidenty, AI připraví situační shrnutí, operátor potvrdí výstrahu a systém
vytvoří auditovanou notifikaci do CSM Messaging.

### Scénář B: Edge Offline

Edge klient ztratí spojení, vytvoří lokální incident a zákres, po obnově
spojení synchronizuje eventy. Konflikt se zobrazí operátorovi a je vyřešen
ručně.

### Scénář C: Agent Query

Analytik se zeptá na evakuační kapacity v ohrožené oblasti. Agent použije jen
povolené nástroje, vrátí shrnutí se zdroji, nejistotou a auditní stopou.

### Scénář D: Security Governance

Uživatel s nižší rolí nevidí omezená data, AI nedokáže obejít oprávnění,
export respektuje roli a state-changing akce vyžaduje potvrzení.

## Akceptační Cíle

| Metrika | Cíl |
| --- | --- |
| Incident viditelný v uzlu | do 10 s |
| Federované doručení eventu | do 30 s |
| Sync po 30min offline | do 5 min |
| API p95 | do 800 ms |
| AI odpověď | do 20 s |
| Export | do 30 s |
| Audit coverage | 100 % definovaných akcí |
| Dedupe/fusion | 85 % F1 nebo písemně obhájená alternativa |

## Dodávky Pro Soutěž

| Dodávka | Obsah | Stav |
| --- | --- | --- |
| D1 | projektový plán a rizika | doplnit z tohoto dokumentu |
| D2 | cílová architektura | částečně v `docs/architecture` |
| D3 | data/API/event kontrakty | OpenAPI existuje, AsyncAPI založit |
| D4 | MVP federace 3 uzlů | implementovat |
| D5 | AI/MCP | implementovat |
| D6 | offline edge | rozšířit |
| D7 | security package | doplnit |
| D8 | cvičení/demo | připravit |
| D9 | dokumentace a školení | průběžně doplňovat |
| D10 | final report/roadmap | vznikne po pilotním běhu |

## První Praktický Krok

Implementačně pokračovat v tomto pořadí:

1. `asyncapi/asyncapi.json` jako závazný event kontrakt.
2. Domain event publisher v COP API.
3. Node registry a federated health endpoint.
4. Offline outbox pro hlášení, zákresy a incidenty.
5. MCP Gateway s minimální sadou nástrojů.
6. Incident/resource/capacity model a demo scénář Povodeň.

