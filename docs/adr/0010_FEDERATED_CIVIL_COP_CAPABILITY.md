# ADR-0010: Federated Civil COP Capability

## Status

Accepted

## Context

Analýza práce Jana Ryšavého o využití AI pro vícezdrojová data a navazující
AI review potvrzují, že COP nesmí být chápán pouze jako mapová obrazovka.
Pro provozní civilní nasazení musí COP fungovat jako schopnost nad daty,
procesy, bezpečností, spoluprací, vysvětlitelností a auditovatelnými
rozhodnutími člověka.

CSM/COP má zároveň civilní účel: informování osob, ochrana osob, sdílení
hlášení, krizová spolupráce a situační orientace. Profesionální a APP-6/NATO
zobrazení je volitelný režim. Systém nesmí obsahovat targeting, navádění,
weapon workflow ani doporučení použití síly.

## Decision

COP bude veden jako federovaná civilní situační schopnost:

- COP API je rozhodovací a prezentační backend.
- Web a iOS/iPadOS klienti jsou klientské aplikace stejného kontraktu.
- SIM je server-to-server provider dat, ne veřejný frontend ani mobilní zdroj.
- CSM Messaging je autoritativní pro zprávy, zařízení a push doručení.
- Externí a budoucí lokální uzly se připojují přes katalogy, OpenAPI,
  eventové kontrakty a geodatové kontrakty, ne přes ad hoc UI integrace.
- MCP/agentní rozhraní je pouze AI/tool vrstva; není páteří integračního
  modelu.

## Integration Boundaries

- REST/OpenAPI: stabilní veřejné a server-to-server operace.
- AsyncAPI/event envelope: změny, audit, replay a notifikační rozhodování.
- OGC/GeoJSON/raster contracts: mapová a prostorová data.
- MCP: dotazy AI asistenta, tool orchestrace a vysvětlení dat.

## Canonical Model

Všechny doménové objekty, nejen tracky, musí mít společná governance metadata:

- identitu a typ entity,
- zdroj a provenance,
- confidence/dataQuality/stale,
- classification/release policy,
- časovou platnost,
- vlastníka nebo odpovědnou skupinu,
- korelační ID a auditní stopu.

Autoritativní rozšíření je popsáno v
[Canonical Entity Model v2](../data/07_CANONICAL_ENTITY_MODEL_V2.md).

## AI Boundary

AI smí pomáhat se shrnutím, vysvětlením, detekcí konfliktů, kvalitou dat,
návrhem filtrů, překladem a přípravou reportu. AI nesmí autonomně rozhodovat,
prioritizovat cíle, doporučovat zásah, plánovat útok/obranu ani poskytovat
taktické navádění.

## Consequences

- Nové funkce se modelují jako entity a eventy, ne jako izolované UI stavy.
- iOS kontrakt používá stejné entity jako web a nesmí přímo volat SIM.
- Technické provider/source detaily patří do provenance/diagnostiky, ne do
  běžného občanského UI.
- Každá významná změna API, eventů, geodat nebo AI musí aktualizovat
  dokumentaci a schémata.

## Alternatives Considered

- Single-page map application only: odmítnuto, protože neřeší audit,
  spolupráci, notifikace, mobilní klienty ani federované zdroje.
- MCP as primary integration layer: odmítnuto, protože MCP je vhodné pro AI
  nástroje, ne jako náhrada OpenAPI, eventů a geodatových kontraktů.
- Direct provider access from mobile clients: odmítnuto kvůli bezpečnosti,
  cache strategii, governance a jednotnému rozhodování COP.
