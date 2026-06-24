# 14 Client PoC Demo Guide

Tento runbook je praktický scénář pro řízenou klientskou ukázku. Cíl není
ukázat všechny funkce, ale ukázat jasný krizový příběh, ve kterém CSM/COP
pomáhá občanům, operátorům a krizovému štábu sdílet stejný situační obraz.

## Cíl Ukázky

Klient má po 20-30 minutách pochopit:

- kde vzniká událost,
- jaké riziko se týká občanů,
- odkud pochází data,
- jak uživatel přidá hlášení,
- jak se hlášení dostane do mapy a chatu,
- jak operátor pracuje se skupinou, zákresem a médii,
- jak systém zachovává audit, oprávnění a oddělení providerů.

## Role

| Role | Účet | Co ukazuje |
| --- | --- | --- |
| Operátor | demo operátor | mapový workspace, vrstvy, detail, chat, zákresy |
| Druhý operátor | demo operátor 2 | ověření skupinového E2EE chatu a notifikací |
| Občan | iOS/web klient | hlášení s polohou a médiem |
| Technik | admin/provoz | health, dependencies, provider observability |
| Pozorovatel | bez účtu | veřejná mapa a veřejné vrstvy bez ukládání profilu |

Konkrétní účty a hesla nepatří do dokumentace. Ukládají se jen v provozním
secret managementu nebo se před ukázkou vytvoří ručně v Keycloaku.

## Před Demo Checklist

1. Ověřit produkci:
   ```sh
   curl -fsS https://cop.zeleznalady.cz/health/ready
   ```
2. Ověřit interní závislosti na `docker.home.cz`:
   ```sh
   cd /srv/cop
   set -a; . ./.env; set +a
   curl -fsS -H "Authorization: Bearer ${COP_PUBLIC_LAB_VALUE:-$COP_LAB_TOKEN}" \
     http://127.0.0.1:4310/health/dependencies
   ```
3. Otevřít aplikaci v desktop Chrome/Safari a v mobilním Safari.
4. Přihlásit demo operátora.
5. Ověřit, že profil má jméno, roli, organizaci a avatar.
6. Ověřit, že jsou dostupné vrstvy:
   - meteorologické výstrahy,
   - radar/srážky,
   - povodně a voda,
   - komunitní hlášení,
   - mobilní síť,
   - komunikace/doprava,
   - uživatelské zákresy.
7. Ověřit, že `cop-chat` ukazuje pouze připravené PoC konverzace, lidská
   jména a ne technické Matrix identifikátory.
8. Ověřit, že galerie médií otevře fotku, PDF a video.
9. Ověřit, že zákres po refreshi zůstane na mapě.
10. Ověřit, že druhý demo operátor po prvním otevření chatu vidí stejnou
    skupinu a stejnou historii bez nutnosti odejít ze stránky a vrátit se.

## Spuštění Dema Z Menu

Pro klientskou ukázku má být demo spouštěné z aplikace, ne jen ručním SQL nebo
skriptem. V menu operátora/admina má být položka `Demo scénáře`, viditelná jen
v pilotním režimu a jen pro oprávněné účty.

Položka má nabízet:

- `Připravit demo Povodeň` - vytvoří nebo obnoví scénář
  `flood-central-bohemia`,
- `Resetovat demo` - smaže pouze objekty označené tímto demo scénářem,
- `Spustit průvodce demo` - otevře krokový průchod mapou, chatem, hlášením,
  zákresem, MCP a edge částí,
- `Stav demo` - ukáže, zda jsou připravené vrstvy, skupiny, média, chat,
  edge uzel a MCP nástroje.

Demo launcher nesmí zapisovat přímo z browseru do databáze. Web má volat pouze
chráněné COP API endpointy. Ty spouští server-side seed/reset přes běžné domain
služby a auditují akci operátora. Všechny demo objekty musí nést
`demoScenarioId=flood-central-bohemia` a v UI musí být jasný štítek
`DEMO DATA`.

Produkční API kontrakt:

| Endpoint | Účel |
| --- | --- |
| `GET /api/v1/demo/scenarios` | seznam dostupných scénářů a jejich stav |
| `POST /api/v1/demo/scenarios/{scenarioId}/seed` | idempotentně připraví demo data |
| `POST /api/v1/demo/scenarios/{scenarioId}/reset` | smaže jen data daného scénáře |
| `GET /api/v1/demo/scenarios/{scenarioId}/status` | stav seedovaných objektů a závislostí |

Endpointy vyžadují přihlášeného operátora nebo autorizovaný lab token. Seed je
idempotentní: opakované spuštění nevytváří duplicitní skupiny, hlášení ani
zákresy. Reset maže pouze objekty označené `demoScenarioId` pro daný scénář,
včetně demo skupiny, demo hlášení, demo zákresů a demo auditních záznamů.

Seed zároveň vloží do metadata demo skupiny `demoConversation`, aby webový a
nativní klient mohly ukázat živě působící konverzaci s krátkým vláknem,
připnutým kontextem a kartami médií. Jde o prezentační metadata, ne o plaintext
náhradu Matrix/E2EE chatu.

## Doporučený Demo Seed

Demo seed se má připravit jako resetovatelný scénář `flood-central-bohemia`.
Seed data musí být označená jako demonstrační.

### Událost

- název: `Povodeň - Středočeský kraj`,
- stav: `Aktivní`,
- oblast: Praha a okolí Vltavy/Berounky/Labe podle zvoleného scénáře,
- začátek: pevný čas pro demo,
- závažnost: `warning` nebo `critical` podle scénáře,
- veřejný popis: krátký civilní text, bez technických provider detailů.

### Mapové Vrstvy

Zapnout jako výchozí:

- radarová srážková vrstva,
- meteorologické výstrahy,
- povodňové body a oblasti,
- komunitní hlášení,
- uživatelské zákresy,
- komunikace a dopravní omezení,
- mobilní síť pouze jako kontext.

Vypnout jako výchozí:

- diagnostické provider vrstvy,
- surové technické vstupy,
- dlouhé debug/provenance kódy.

### Hlášení

Seed má obsahovat nejméně:

1. `Zatopený podjezd`
   - závažnost: `warning`,
   - platnost: 6 hodin,
   - média: fotografie,
   - viditelnost: krizová skupina.
2. `Poškozená lávka`
   - závažnost: `critical`,
   - platnost: 24 hodin,
   - média: video,
   - viditelnost: vybraná skupina.
3. `Dobrovolnické místo`
   - závažnost: `info`,
   - platnost: 12 hodin,
   - média: PDF instrukce,
   - viditelnost: veřejné.

### Zákresy

Seed má obsahovat:

- polygon zasažené oblasti,
- linii uzávěry nebo neprůjezdné komunikace,
- bod evakuačního místa,
- textový popisek `Dočasné shromaždiště`,
- měření vzdálenosti mezi rizikovým místem a evakuačním bodem.

### Chat A Skupiny

Aktuální řízený PoC seed připravuje jednu hlavní skupinu:

- `DEMO Povodeň - Středočeský kraj`,
- prezentační název konverzace `Krizový štáb - Povodeň`,
- členy `lab`, první demo operátor a druhý demo operátor,
- připnutý kontext mapy na aktivní událost,
- několik lidských zpráv:
  - potvrzení přijetí hlášení,
  - žádost o doplnění fotografie,
  - rozhodnutí o uzávěře,
  - odkaz na mapový detail.

Staré testovací skupiny a staré Matrix místnosti před PoC do ukázky nepatří.
Před klientským průchodem musí být CSM Messaging metadata bez historických
konverzací. Po prvním reálném otevření skupiny v `cop-chat` má existovat jedna
E2EE Matrix místnost pro PoC skupinu. COP web nemá vlastní paralelní chatové
skupiny pro hlášení; lidská komunikace patří do `cop-chat`.

### Edge A MCP

Seed má připravit také demonstraci technických požadavků, ale v uživatelsky
srozumitelné podobě:

- federovaný uzel `node_edge_pilot_01` se stavem `online` nebo `degraded`,
- jeden offline event vložený do edge outboxu, například hlášení z lokálního
  pracoviště,
- centrální replay event, který se po synchronizaci objeví v COP mapě,
- jeden DLQ/rejected příklad jen pro technickou část ukázky,
- auditovaný MCP dotaz na seznam uzlů nebo situační replay.

MCP se v demo neukazuje jako surový protokol. V UI má být prezentovaný jako
`Analytický asistent` nebo `Auditovaný asistent`, který používá pouze
allowlistované read-only nástroje. Edge se ukazuje jako `Lokální pracoviště`
nebo `Terénní uzel`, ne jako náhrada centrálního COP.

## Demo Flow

### 1. Přehled

Otevřít mapu a ukázat aktivní událost. Vysvětlit, že mapa není statický GIS,
ale pracovní plocha pro krizovou situaci.

Ukázat:

- aktivní událost v horní liště,
- rizikové vrstvy,
- stav providerů,
- radar a výstrahy.

### 2. Data A Důvěryhodnost

Kliknout na výstrahu nebo povodňový prvek a ukázat:

- zdroj,
- čas aktualizace,
- platnost,
- stale/degraded stav jen pokud je relevantní,
- confidence a dataQuality v detailu, ne jako rušivý text na mapě.

### 3. Komunitní Hlášení

Ukázat hlášení občana:

- text,
- poloha,
- závažnost,
- platnost rizika,
- média,
- ACL médií.

Vysvětlit, že mapa může ukázat veřejný text, ale média se otevřou jen
oprávněným uživatelům.

### 4. Chat

Otevřít chat skupiny a ukázat:

- lidský seznam konverzací,
- připnutý mapový kontext,
- zprávu s odkazem na hlášení,
- přílohy a polohu.

Pro kontrolu před ukázkou se přihlásí dva demo operátoři za sebou. První pošle
zprávu do skupiny, druhý ji po přihlášení uvidí hned po otevření stejné
konverzace a odpoví. První operátor potom musí po opětovném otevření vidět obě
zprávy ve stejné skupině.

Neukazovat technické Matrix identifikátory, bootstrap ani E2EE debug texty v
běžném režimu.

### 5. Zákres

Zapnout zákresy:

- nakreslit uzávěru,
- přidat evakuační bod,
- změnit barvu/průhlednost,
- uložit do skupiny nebo události,
- refreshnout stránku a ověřit, že zákres zůstane.

### 6. Mobilní Průchod

Na iPhone ukázat:

- otevření mapy,
- přepnutí vrstvy,
- detail hlášení,
- vytvoření nového hlášení,
- otevření chatu jako samostatné mobilní obrazovky.

### 7. Provozní Důvěra

Na závěr ukázat provozní stav:

- API ready,
- dependencies,
- provider health,
- cache/stale informaci,
- auditovatelný tok dat.

### 8. MCP/Auditovaný Asistent

Otevřít část `Analytický asistent` nebo technický panel pro operátora a ukázat:

- MCP handshake `POST /api/v1/mcp` s metodou `initialize`,
- seznam dostupných nástrojů přes MCP metodu `tools/list`,
- auditované volání `cop.federation.nodes.list` přes MCP metodu `tools/call`,
- audit událost `MCP_TOOL_INVOKED`,
- že nástroj vrací pouze policy-filtered data a neumí měnit stav systému.

V demo je důležité říct, že MCP není integrační backbone a není autonomní
rozhodovač. Je to kontrolovaná read-only vrstva pro asistivní analýzu,
diagnostiku a auditovatelné dotazy. Kompatibilní REST endpoint
`GET /api/v1/mcp/tools` lze použít jen jako jednoduchý smoke test.

### 9. Edge/Offline Režim

Ukázat edge část jako krátký řízený scénář:

1. Otevřít `https://cop.zeleznalady.cz/edge/status` nebo interní provozní panel.
2. Ukázat registraci uzlu `node_edge_pilot_01` a heartbeat.
3. Simulovat lokální offline hlášení do edge outboxu.
4. Spustit sync a ukázat `POST /api/v1/edge/outbox/flush`.
5. Ukázat, že centrální COP event/replay obsahuje novou událost.
6. Ukázat potvrzení replay cursoru přes
   `POST /api/v1/edge/replay-cursors/{nodeId}/ack`.

Tato část má prokázat, že systém umí pracovat s lokálním outboxem, pozdější
synchronizací, replayem a auditem. Není cílem tvrdit, že pilotní edge runtime
je finální air-gapped produkt.

## Pokrytí Požadavků V Demo

| Požadavek | Jak se demonstruje |
| --- | --- |
| Server-to-server provider data | SIM vrstvy počasí, safety, flight, mobile a provider health |
| Civilní mapový obraz | vrstvy rizik, radar, hlášení, zákresy a zjednodušené mapové režimy |
| Uživatelská hlášení | report s polohou, rizikem, platností, fotkou/PDF/videem a ACL |
| Skupiny a komunikace | chat skupiny s připnutým mapovým kontextem |
| Média a oprávnění | galerie médií dostupná jen oprávněným uživatelům |
| Zákresy | polygon/linie/bod/text/measure jako samostatná vrstva |
| Audit | audit akcí operátora, MCP tool invoke, report a změny zákresu |
| MCP | read-only tool registry a auditované volání nástroje |
| Edge | edge node heartbeat, lokální outbox, flush, replay a cursor ack |
| Mobilní návaznost | iPhone/iPad průchod, deep linky a iOS API kontrakt |
| Observability | health/dependencies/provider observability/stale data |

## Co Neříkat A Neukazovat

- Netvrdit, že data o stavu BTS jsou potvrzený realtime stav operátora.
- Netvrdit, že radar/grid předpovídá budoucnost bez SIM nowcast metadat.
- Nezobrazovat interní tokeny, sourceId jako hlavní text ani technické chyby.
- Neukazovat AI jako rozhodovací autoritu.
- Nepoužívat vojenský jazyk pro civilní scénář.

## Doporučená Závěrečná Věta

„Toto není jen mapa. Je to společný krizový workspace: data od providerů,
hlášení od lidí, komunikace skupin, média, zákresy, oprávnění, audit a
připravená cesta k mobilnímu a edge použití.“
